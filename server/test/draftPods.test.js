import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Isolate the account store, same reasoning as rooms.test.js.
process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-draft-test-${crypto.randomUUID()}.json`);
process.env.DISCONNECT_GRACE_MS = '200';
// Near-instant so every one of this test's 15x4 picks resolves via the
// auto-pick timer instead of a manual choice — see playOutDraftClient below,
// which never sends a manual 'draftPick' at all. This deliberately exercises
// the "player never responds in time" path for every single pick.
process.env.DRAFT_PICK_TIMER_MS = '20';

const { server, wss } = await import('../index.js');

let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `ws://localhost:${port}/ws`;
});

after(async () => {
  for (const client of wss.clients) client.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
});

// Same queueing message helper as rooms.test.js — a naive one-shot
// ws.once('message') drops messages that arrive back-to-back in the same
// tick, which happens constantly here (draftPickConfirmed immediately
// followed by the next draftUpdate, or a bonus card immediately followed by
// nothing further until the next real event).
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(baseUrl);
    ws.__queue = [];
    ws.__waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      if (ws.__waiters.length) ws.__waiters.shift()(msg);
      else ws.__queue.push(msg);
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws) {
  if (ws.__queue.length) return Promise.resolve(ws.__queue.shift());
  return new Promise((resolve) => ws.__waiters.push(resolve));
}

async function identify(ws, token) {
  ws.send(JSON.stringify({ type: 'identify', token }));
  return nextMessage(ws);
}

// Drives one seat through an entire pod with no manual picks at all (every
// one of its 15 picks is left to the auto-pick timer), picks a fixed hero
// the instant it's offered, and forfeits the moment any bracket match
// starts — whoever's forfeit the server processes first loses that match,
// so the bracket still resolves to a real winner/runner-up without either
// client needing to actually play a hand of cards. Resolves with this
// seat's final draftPrize.
async function playOutDraftClient(ws) {
  for (let i = 0; i < 500; i++) {
    const msg = await nextMessage(ws);
    if (msg.type === 'draftBonusCard') {
      ws.send(JSON.stringify({ type: 'draftHeroPick', faction: 'albura' }));
    } else if (msg.type === 'matchStart') {
      ws.send(JSON.stringify({ type: 'action', action: { kind: 'forfeit' } }));
    } else if (msg.type === 'draftPrize') {
      return msg.prize;
    }
  }
  throw new Error('draftPrize never arrived within the message budget');
}

describe('draft pods over real WebSocket connections', () => {
  test('4 players queue, draft 16 cards each via auto-pick, choose a hero, and the bracket resolves with prizes for all 4', async () => {
    const sockets = await Promise.all([connect(), connect(), connect(), connect()]);
    const idents = [];
    for (const ws of sockets) idents.push(await identify(ws, null));
    for (const ident of idents) assert.ok(ident.account.token);

    sockets.forEach((ws, i) => ws.send(JSON.stringify({ type: 'queueDraft', token: idents[i].account.token })));

    const prizes = await Promise.all(sockets.map((ws) => playOutDraftClient(ws)));

    const commonPrizes = prizes.filter((p) => p.commonCard);
    const packPrizes = prizes.filter((p) => p.packs);
    assert.equal(commonPrizes.length, 2, 'the two semifinal losers should each get a consolation common card');
    for (const p of commonPrizes) assert.equal(p.commonCard.rarity, 'common');

    assert.equal(packPrizes.length, 2, 'the two finalists should each get pack prizes');
    const packCounts = packPrizes.map((p) => p.packs.length).sort();
    assert.deepEqual(packCounts, [1, 2], 'runner-up gets 1 pack, champion gets 2');

    sockets.forEach((ws) => ws.close());
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-tournament-test-${crypto.randomUUID()}.json`);
process.env.DISCONNECT_GRACE_MS = '200';

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

function fullDeck(prefix) {
  const deck = {};
  for (let i = 1; i <= 8; i++) deck[`${prefix}${i}`] = 2;
  return deck;
}

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

// Forfeits the moment any bracket match starts — whoever's forfeit the
// server processes first loses that match, so the bracket still resolves
// to a real winner/runner-up without either client needing to actually
// play a hand of cards (same trick as draftPods.test.js).
async function playOutTournamentClient(ws) {
  for (let i = 0; i < 50; i++) {
    const msg = await nextMessage(ws);
    if (msg.type === 'matchStart') {
      ws.send(JSON.stringify({ type: 'action', action: { kind: 'forfeit' } }));
    } else if (msg.type === 'tournamentPrize') {
      return msg.prize;
    }
  }
  throw new Error('tournamentPrize never arrived within the message budget');
}

describe('tournament pods over real WebSocket connections', () => {
  test('4 players queue with their own deck, no drafting, and the bracket resolves with prizes for all 4', async () => {
    const sockets = await Promise.all([connect(), connect(), connect(), connect()]);
    const idents = [];
    for (const ws of sockets) idents.push(await identify(ws, null));

    const factions = ['albura', 'ignara', 'umbra', 'terra'];
    const prefixes = ['a', 'g', 'u', 't'];
    sockets.forEach((ws, i) => {
      ws.send(JSON.stringify({
        type: 'queueTournament',
        token: idents[i].account.token,
        faction: factions[i],
        deck: fullDeck(prefixes[i]),
      }));
    });

    const prizes = await Promise.all(sockets.map((ws) => playOutTournamentClient(ws)));

    const commonPrizes = prizes.filter((p) => p.commonCard);
    const packPrizes = prizes.filter((p) => p.packs);
    assert.equal(commonPrizes.length, 2, 'the two semifinal losers should each get a consolation common card');
    for (const p of commonPrizes) assert.equal(p.commonCard.rarity, 'common');

    assert.equal(packPrizes.length, 2, 'the two finalists should each get pack prizes');
    const packCounts = packPrizes.map((p) => p.packs.length).sort();
    assert.deepEqual(packCounts, [1, 2], 'runner-up gets 1 pack, champion gets 2');

    sockets.forEach((ws) => ws.close());
  });

  test('rejects queueing with an invalid deck', async () => {
    const ws = await connect();
    const ident = await identify(ws, null);
    ws.send(JSON.stringify({ type: 'queueTournament', token: ident.account.token, faction: 'albura', deck: { a1: 99 } }));
    const err = await nextMessage(ws);
    assert.equal(err.type, 'error');
    ws.close();
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Isolate the account store, same reasoning as draftPods.test.js.
process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-draft-bot-test-${crypto.randomUUID()}.json`);
process.env.DISCONNECT_GRACE_MS = '200';
// Keep the pod bot-fallback timeout, bot pick "thinking time", and the bot
// match's per-step delay all short so this suite runs fast instead of
// waiting out the real human-watchable defaults.
process.env.DRAFT_POD_BOT_TIMEOUT_MS = '80';
process.env.BOT_PICK_DELAY_MIN_MS = '2';
process.env.BOT_PICK_DELAY_MAX_MS = '6';
process.env.BOT_STEP_DELAY_MIN_MS = '2';
process.env.BOT_STEP_DELAY_MAX_MS = '6';
// The real player's client in this test never sends a manual draftPick
// either — same as draftPods.test.js's playOutDraftClient — so its own
// picks must resolve via the auto-pick timer too, kept just as short.
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

describe('draft pod bot fallback', () => {
  test('a lone player in the draft queue is padded out to a full pod with bots after the timeout, and the bracket resolves', async () => {
    const ws = await connect();
    const ident = await identify(ws, null);

    ws.send(JSON.stringify({ type: 'queueDraft', token: ident.account.token }));
    const queued = await nextMessage(ws);
    assert.equal(queued.type, 'draftQueued');
    assert.equal(queued.waiting, 1);
    assert.equal(queued.needed, 4);

    let bracketUpdate = null;
    let prize = null;
    for (let i = 0; i < 500 && !prize; i++) {
      const msg = await nextMessage(ws);
      if (msg.type === 'draftBonusCard') {
        ws.send(JSON.stringify({ type: 'draftHeroPick', faction: 'albura' }));
      } else if (msg.type === 'matchStart') {
        assert.ok(matchStartIsAgainstBot(msg), 'the real player must land in a match against one of the pod bots');
        ws.send(JSON.stringify({ type: 'action', action: { kind: 'forfeit' } }));
      } else if (msg.type === 'draftBracketUpdate') {
        bracketUpdate = msg;
      } else if (msg.type === 'draftPrize') {
        prize = msg.prize;
      }
    }

    assert.ok(prize, 'the real player must still receive a draftPrize once the bracket resolves');
    assert.ok(bracketUpdate, 'the real player must receive at least one bracket status update');
    assert.equal(bracketUpdate.seats.length, 4);
    const botSeats = bracketUpdate.seats.filter((s) => s.isBot);
    assert.equal(botSeats.length, 3, 'the other 3 seats must all be bots filled in after the queue timed out');
    for (const seat of botSeats) {
      assert.ok(seat.name, 'every bot seat must have a display name');
    }

    ws.close();
  });

  test('4 real players who queue within the bot-timeout window draft together, no bots involved', async () => {
    const sockets = await Promise.all([connect(), connect(), connect(), connect()]);
    const idents = [];
    for (const s of sockets) idents.push(await identify(s, null));

    sockets.forEach((s, i) => s.send(JSON.stringify({ type: 'queueDraft', token: idents[i].account.token })));

    async function playOut(s) {
      for (let i = 0; i < 500; i++) {
        const msg = await nextMessage(s);
        if (msg.type === 'draftBonusCard') {
          s.send(JSON.stringify({ type: 'draftHeroPick', faction: 'terra' }));
        } else if (msg.type === 'matchStart') {
          s.send(JSON.stringify({ type: 'action', action: { kind: 'forfeit' } }));
        } else if (msg.type === 'draftBracketUpdate' && msg.seats.some((seat) => seat.isBot)) {
          throw new Error('no seat should be a bot when 4 real players queued together');
        } else if (msg.type === 'draftPrize') {
          return msg.prize;
        }
      }
      throw new Error('draftPrize never arrived within the message budget');
    }

    const prizes = await Promise.all(sockets.map(playOut));
    assert.equal(prizes.length, 4);

    sockets.forEach((s) => s.close());
  });
});

function matchStartIsAgainstBot(msg) {
  return typeof msg.opponentName === 'string' && msg.opponentName.length > 0;
}

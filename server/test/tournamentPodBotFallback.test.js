import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Isolate the account store, same reasoning as tournamentPods.test.js.
process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-tournament-bot-test-${crypto.randomUUID()}.json`);
process.env.DISCONNECT_GRACE_MS = '200';
// Keep the pod bot-fallback timeout and the bot match's per-step "thinking
// time" both short so this suite runs fast instead of waiting out the real
// human-watchable defaults.
process.env.TOURNAMENT_POD_BOT_TIMEOUT_MS = '80';
process.env.BOT_STEP_DELAY_MIN_MS = '2';
process.env.BOT_STEP_DELAY_MAX_MS = '6';

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

describe('tournament pod bot fallback', () => {
  test('a lone player in the tournament queue is padded out to a full pod with bots after the timeout, and the bracket resolves', async () => {
    const ws = await connect();
    const ident = await identify(ws, null);

    ws.send(JSON.stringify({ type: 'queueTournament', token: ident.account.token, faction: 'albura', deck: fullDeck('a') }));
    const queued = await nextMessage(ws);
    assert.equal(queued.type, 'tournamentQueued');
    assert.equal(queued.waiting, 1);
    assert.equal(queued.needed, 4);

    let bracketUpdate = null;
    let prize = null;
    for (let i = 0; i < 100 && !prize; i++) {
      const msg = await nextMessage(ws);
      if (msg.type === 'matchStart') {
        assert.ok(msg.opponentName, 'the real player must land in a match against a named bot opponent');
        ws.send(JSON.stringify({ type: 'action', action: { kind: 'forfeit' } }));
      } else if (msg.type === 'tournamentBracketUpdate') {
        bracketUpdate = msg;
      } else if (msg.type === 'tournamentPrize') {
        prize = msg.prize;
      }
    }

    assert.ok(prize, 'the real player must still receive a tournamentPrize once the bracket resolves');
    assert.ok(bracketUpdate, 'the real player must receive at least one bracket status update');
    assert.equal(bracketUpdate.seats.length, 4);
    const botSeats = bracketUpdate.seats.filter((s) => s.isBot);
    assert.equal(botSeats.length, 3, 'the other 3 seats must all be bots filled in after the queue timed out');
    for (const seat of botSeats) {
      assert.ok(seat.name, 'every bot seat must have a display name');
    }

    ws.close();
  });

  test('4 real players who queue within the bot-timeout window play together, no bots involved', async () => {
    const sockets = await Promise.all([connect(), connect(), connect(), connect()]);
    const idents = [];
    for (const s of sockets) idents.push(await identify(s, null));

    const factions = ['albura', 'ignara', 'umbra', 'terra'];
    const prefixes = ['a', 'g', 'u', 't'];
    sockets.forEach((s, i) => {
      s.send(JSON.stringify({
        type: 'queueTournament',
        token: idents[i].account.token,
        faction: factions[i],
        deck: fullDeck(prefixes[i]),
      }));
    });

    async function playOut(s) {
      for (let i = 0; i < 50; i++) {
        const msg = await nextMessage(s);
        if (msg.type === 'matchStart') {
          s.send(JSON.stringify({ type: 'action', action: { kind: 'forfeit' } }));
        } else if (msg.type === 'tournamentBracketUpdate' && msg.seats.some((seat) => seat.isBot)) {
          throw new Error('no seat should be a bot when 4 real players queued together');
        } else if (msg.type === 'tournamentPrize') {
          return msg.prize;
        }
      }
      throw new Error('tournamentPrize never arrived within the message budget');
    }

    const prizes = await Promise.all(sockets.map(playOut));
    assert.equal(prizes.length, 4);

    sockets.forEach((s) => s.close());
  });
});

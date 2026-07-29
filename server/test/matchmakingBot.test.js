import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Isolate the account store so repeated test runs don't pile up fake
// accounts in the real dev server's server/data/accounts.json.
process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-matchmaking-bot-test-${crypto.randomUUID()}.json`);

// Keep the bot-fallback timeout and its per-step "thinking time" both
// short so this suite runs fast instead of waiting out the real
// human-watchable 5s/600-2200ms defaults.
process.env.QUICK_MATCH_BOT_TIMEOUT_MS = '80';
process.env.BOT_STEP_DELAY_MIN_MS = '2';
process.env.BOT_STEP_DELAY_MAX_MS = '6';
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

describe('quick match bot fallback', () => {
  test('a lone player in the queue gets matched against a bot after the timeout', async () => {
    const a = await connect();
    const identA = await identify(a, null);

    a.send(JSON.stringify({ type: 'quickMatch', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const queued = await nextMessage(a);
    assert.equal(queued.type, 'queued');

    const matchStart = await nextMessage(a);
    assert.equal(matchStart.type, 'matchStart');
    assert.ok(matchStart.opponentName, 'the bot opponent must have a display name');
    assert.doesNotMatch(matchStart.opponentName, /^Jugador\d+$/, "a bot's name must read as a real chosen username, not the auto-generated default");

    a.close();
  });

  test('the bot match actually plays out to a real matchEnd (forfeit-to-resolve)', async () => {
    const a = await connect();
    const identA = await identify(a, null);

    a.send(JSON.stringify({ type: 'quickMatch', token: identA.account.token, faction: 'terra', deck: fullDeck('t') }));
    await nextMessage(a); // queued
    const matchStart = await nextMessage(a);
    assert.equal(matchStart.type, 'matchStart');

    a.send(JSON.stringify({ type: 'action', action: { kind: 'forfeit' } }));
    const end = await nextMessage(a);
    assert.equal(end.type, 'matchEnd');
    assert.equal(end.youWon, false);
    assert.equal(end.state.winner, 'p2', "the bot (p2) must be recorded as the winner from the human's own mirrored view");

    a.close();
  });

  test('canceling the queue before the timeout prevents the bot match', async () => {
    const a = await connect();
    const identA = await identify(a, null);

    a.send(JSON.stringify({ type: 'quickMatch', token: identA.account.token, faction: 'umbra', deck: fullDeck('u') }));
    await nextMessage(a); // queued
    a.send(JSON.stringify({ type: 'cancelQuickMatch' }));

    // Wait well past the (shortened) bot timeout — no matchStart should ever arrive.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(a.__queue.length, 0, 'no matchStart (or anything else) should have arrived after canceling');

    a.close();
  });

  test('two real players who queue within the bot-timeout window are paired with each other, not a bot', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    a.send(JSON.stringify({ type: 'quickMatch', token: identA.account.token, faction: 'ignara', deck: fullDeck('g') }));
    await nextMessage(a); // queued
    b.send(JSON.stringify({ type: 'quickMatch', token: identB.account.token, faction: 'terra', deck: fullDeck('t') }));

    const [matchStartA, matchStartB] = await Promise.all([nextMessage(a), nextMessage(b)]);
    assert.equal(matchStartA.type, 'matchStart');
    assert.equal(matchStartB.type, 'matchStart');
    assert.equal(matchStartA.opponentFaction, 'terra');
    assert.equal(matchStartB.opponentFaction, 'ignara');

    a.close();
    b.close();
  });
});

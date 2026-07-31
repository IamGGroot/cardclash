import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Isolate the account store, same reasoning as rooms.test.js.
process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-match-timeout-test-${crypto.randomUUID()}.json`);
process.env.DISCONNECT_GRACE_MS = '200';
// Keep the match's wall-clock budget short so this suite runs fast instead
// of waiting out the real 5-minute default.
process.env.MATCH_TIME_LIMIT_MS = '150';

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

describe('match timeout', () => {
  test('matchStart carries a matchDeadline roughly MATCH_TIME_LIMIT_MS in the future', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    a.send(JSON.stringify({ type: 'createRoom', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const created = await nextMessage(a);
    const before = Date.now();
    b.send(JSON.stringify({ type: 'joinRoom', token: identB.account.token, code: created.code, faction: 'ignara', deck: fullDeck('g') }));
    const [matchStartA, matchStartB] = await Promise.all([nextMessage(a), nextMessage(b)]);

    for (const msg of [matchStartA, matchStartB]) {
      assert.ok(typeof msg.matchDeadline === 'number', 'matchStart must carry a matchDeadline timestamp');
      assert.ok(msg.matchDeadline >= before, 'deadline must be in the future relative to when the match started');
      assert.ok(msg.matchDeadline <= before + 150 + 100, 'deadline must land close to the configured MATCH_TIME_LIMIT_MS');
    }

    a.close();
    b.close();
  });

  test('when the timer runs out, whoever has more hero HP at that instant wins — not a draw', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    // Terra's special deals 2 direct damage to the enemy hero, usable turn 1
    // with no mana cost — gives p1 (a, the room creator, always active first)
    // a clean, deterministic HP lead over p2 (b) before the timer fires.
    a.send(JSON.stringify({ type: 'createRoom', token: identA.account.token, faction: 'terra', deck: fullDeck('a') }));
    const created = await nextMessage(a);
    b.send(JSON.stringify({ type: 'joinRoom', token: identB.account.token, code: created.code, faction: 'albura', deck: fullDeck('g') }));
    await Promise.all([nextMessage(a), nextMessage(b)]);

    a.send(JSON.stringify({ type: 'action', action: { kind: 'special' } }));
    const step = await nextMessage(a);
    assert.equal(step.type, 'step');
    assert.equal(step.state.p1.hp, 20, "dealing damage doesn't change the attacker's own hp");
    assert.equal(step.state.p2.hp, 18, "Terra's special must land its 2 damage on the opponent's hero");
    await nextMessage(b); // the mirrored step, not needed for the assertion

    // Neither side ever ends their turn or forfeits — the only thing that
    // can end this match now is the timeout itself.
    const [endA, endB] = await Promise.all([nextMessage(a), nextMessage(b)]);
    assert.equal(endA.type, 'matchEnd');
    assert.equal(endB.type, 'matchEnd');
    assert.equal(endA.youWon, true, 'p1 (a) had more hp at the timeout and must be declared the winner');
    assert.equal(endB.youWon, false);
    assert.equal(endA.state.winner, 'p1');

    a.close();
    b.close();
  });

  test('a tied-hp timeout still produces a real winner, never a draw', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    a.send(JSON.stringify({ type: 'createRoom', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const created = await nextMessage(a);
    b.send(JSON.stringify({ type: 'joinRoom', token: identB.account.token, code: created.code, faction: 'ignara', deck: fullDeck('g') }));
    await Promise.all([nextMessage(a), nextMessage(b)]);

    // Neither side acts at all — hp stays tied at the default starting value
    // for both, forcing the coin-flip branch of the timeout winner logic.
    const [endA, endB] = await Promise.all([nextMessage(a), nextMessage(b)]);
    assert.equal(endA.type, 'matchEnd');
    assert.equal(endB.type, 'matchEnd');
    assert.notEqual(endA.state.winner, 'draw', 'a tied-hp timeout must still pick a real winner, not a draw');
    assert.ok(['p1', 'p2'].includes(endA.state.winner));
    // Each client's state is mirrored so 'p1' always means "me" (see
    // server/protocol.js's viewFor) — youWon must agree with that for both
    // sides regardless of which one actually won the coin flip.
    assert.equal(endA.youWon, endA.state.winner === 'p1');
    assert.equal(endB.youWon, endB.state.winner === 'p1');
    assert.notEqual(endA.youWon, endB.youWon, 'exactly one side must be declared the winner');

    a.close();
    b.close();
  });
});

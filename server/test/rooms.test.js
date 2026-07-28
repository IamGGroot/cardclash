import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Isolate the account store so repeated test runs don't pile up fake
// accounts in the real dev server's server/data/accounts.json.
process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-rooms-test-${crypto.randomUUID()}.json`);

// Keep any leftover forfeit-on-disconnect timers short so a test that
// doesn't play a match to completion (and just closes its sockets) doesn't
// hold the test process open for the real 30s default.
process.env.DISCONNECT_GRACE_MS = '200';

const { server, wss } = await import('../index.js');
const { applyMatchTrophies } = await import('../accounts.js');

let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `ws://localhost:${port}/ws`;
});

after(async () => {
  // wss.close() alone doesn't drop already-open client connections, and a
  // lingering socket keeps the process (and `node --test`) alive well past
  // the test run — terminate everything explicitly so the file actually exits.
  for (const client of wss.clients) client.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
});

function fullDeck(prefix) {
  // 8 unique cards x 2 copies = 16, matching DECK_SIZE/MAX_COPIES.
  const deck = {};
  for (let i = 1; i <= 8; i++) deck[`${prefix}${i}`] = 2;
  return deck;
}

// A naive `ws.once('message', ...)` per call drops messages that arrive
// back-to-back in the same tick (e.g. reconnecting gets 'identified' then
// 'matchStart' with nothing awaited in between on the server side) — the
// second message's event fires before the test even registers a listener
// for it. Queueing every message from a single persistent listener, and
// having nextMessage() drain the queue first, makes message order/timing
// irrelevant to the test.
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

describe('room lifecycle over real WebSocket connections', () => {
  test('two players can create/join a room and reach a synced matchStart', async () => {
    const a = await connect();
    const b = await connect();

    const identA = await identify(a, null);
    const identB = await identify(b, null);
    assert.ok(identA.account.token);
    assert.ok(identB.account.token);

    a.send(JSON.stringify({ type: 'createRoom', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const created = await nextMessage(a);
    assert.equal(created.type, 'roomCreated');
    assert.ok(created.code);

    b.send(JSON.stringify({ type: 'joinRoom', token: identB.account.token, code: created.code, faction: 'ignara', deck: fullDeck('g') }));
    const [matchStartA, matchStartB] = await Promise.all([nextMessage(a), nextMessage(b)]);

    assert.equal(matchStartA.type, 'matchStart');
    assert.equal(matchStartB.type, 'matchStart');
    // Each client is mirrored to see itself as p1.
    assert.equal(matchStartA.state.active, 'p1');
    assert.equal(matchStartB.state.active, 'p2'); // it's p1's (A's) turn, so from B's mirrored view the active side is p2
    // Opponent hand contents must never be revealed — only counts.
    assert.ok(matchStartA.state.p2.hand.every((c) => c === null));
    assert.equal(matchStartA.state.p2.hand.length, matchStartB.state.p1.hand.length);

    a.close();
    b.close();
  });

  test('rejects a join with an invalid/oversized deck', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    a.send(JSON.stringify({ type: 'createRoom', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const created = await nextMessage(a);

    const badDeck = { a1: 99 };
    b.send(JSON.stringify({ type: 'joinRoom', token: identB.account.token, code: created.code, faction: 'ignara', deck: badDeck }));
    const err = await nextMessage(b);
    assert.equal(err.type, 'error');

    a.close();
    b.close();
  });

  test('an action from the wrong player (not their turn) is rejected, and a legal endTurn syncs both sides', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    a.send(JSON.stringify({ type: 'createRoom', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const created = await nextMessage(a);
    b.send(JSON.stringify({ type: 'joinRoom', token: identB.account.token, code: created.code, faction: 'ignara', deck: fullDeck('g') }));
    await Promise.all([nextMessage(a), nextMessage(b)]);

    // It's A's turn (mirrored active === 'p1' for A) — B trying to act should be rejected.
    b.send(JSON.stringify({ type: 'action', action: { kind: 'levelUp', attr: 'might' } }));
    const rejected = await nextMessage(b);
    assert.equal(rejected.type, 'error');

    // A ends the turn; both sides should receive a matching 'step' broadcast.
    a.send(JSON.stringify({ type: 'action', action: { kind: 'endTurn' } }));
    const [stepA, stepB] = await Promise.all([nextMessage(a), nextMessage(b)]);
    assert.equal(stepA.type, 'step');
    assert.equal(stepB.type, 'step');
    assert.equal(stepA.state.active, 'p2'); // now B's turn, from A's view
    assert.equal(stepB.state.active, 'p1'); // from B's own mirrored view, it's their turn

    a.close();
    b.close();
  });

  test('forfeit ends the match and declares the opponent the winner', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    a.send(JSON.stringify({ type: 'createRoom', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const created = await nextMessage(a);
    b.send(JSON.stringify({ type: 'joinRoom', token: identB.account.token, code: created.code, faction: 'ignara', deck: fullDeck('g') }));
    await Promise.all([nextMessage(a), nextMessage(b)]);

    a.send(JSON.stringify({ type: 'action', action: { kind: 'forfeit' } }));
    const [endA, endB] = await Promise.all([nextMessage(a), nextMessage(b)]);
    assert.equal(endA.type, 'matchEnd');
    assert.equal(endB.type, 'matchEnd');
    assert.equal(endA.youWon, false);
    assert.equal(endB.youWon, true);
    // The client only actually reads state.winner (via renderBattle ->
    // endMatch), not youWon — it must be mirrored per-viewer too, or the
    // loser's own client reads winner === 'p1' as themselves and shows a
    // victory screen for a match they lost.
    assert.equal(endA.state.winner, 'p2', "the forfeiting player's own mirrored view must show p2 (not them) winning");
    assert.equal(endB.state.winner, 'p1', "the winner's own mirrored view must show p1 (themselves) winning");

    // Fresh accounts start at 0 trophies. The loser is at the "Aldea Novata"
    // arena floor (threshold 0), so the loss clamps to a 0 delta instead of
    // going negative; the winner gets the full flat trophy gain.
    assert.equal(endA.trophyDelta, 0);
    assert.equal(endA.trophies, 0);
    assert.equal(endB.trophyDelta, 30);
    assert.equal(endB.trophies, 30);

    a.close();
    b.close();
  });

  test('quick match does not pair players whose trophies are far apart', async () => {
    const farToken = crypto.randomUUID();
    // Push this account's trophies well past the base matchmaking gap so it
    // clears the "Aldea Novata" floor and keeps climbing on each win.
    for (let i = 0; i < 10; i++) applyMatchTrophies(farToken, true);

    const a = await connect();
    const b = await connect();
    const identA = await identify(a, farToken);
    const identB = await identify(b, null); // fresh account, 0 trophies

    a.send(JSON.stringify({ type: 'quickMatch', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const queuedA = await nextMessage(a);
    assert.equal(queuedA.type, 'queued');

    b.send(JSON.stringify({ type: 'quickMatch', token: identB.account.token, faction: 'umbra', deck: fullDeck('u') }));
    const queuedB = await nextMessage(b);
    assert.equal(queuedB.type, 'queued', 'the trophy gap is far wider than the base matchmaking window, so they must not pair yet');

    a.close();
    b.close();
  });

  test('quick match pairs two waiting players automatically', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    a.send(JSON.stringify({ type: 'quickMatch', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const queued = await nextMessage(a);
    assert.equal(queued.type, 'queued');

    b.send(JSON.stringify({ type: 'quickMatch', token: identB.account.token, faction: 'umbra', deck: fullDeck('u') }));
    const [matchStartA, matchStartB] = await Promise.all([nextMessage(a), nextMessage(b)]);
    assert.equal(matchStartA.type, 'matchStart');
    assert.equal(matchStartB.type, 'matchStart');
    assert.equal(matchStartA.opponentFaction, 'umbra');
    assert.equal(matchStartB.opponentFaction, 'albura');

    a.close();
    b.close();
  });

  test('a disconnected player who does not return within the grace period forfeits', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    a.send(JSON.stringify({ type: 'createRoom', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const created = await nextMessage(a);
    b.send(JSON.stringify({ type: 'joinRoom', token: identB.account.token, code: created.code, faction: 'ignara', deck: fullDeck('g') }));
    await Promise.all([nextMessage(a), nextMessage(b)]);

    const disconnectNotice = nextMessage(b);
    a.close();
    const notice = await disconnectNotice;
    assert.equal(notice.type, 'opponentDisconnected');

    const end = await nextMessage(b); // fires once the (shortened) grace period elapses
    assert.equal(end.type, 'matchEnd');
    assert.equal(end.youWon, true);

    b.close();
  });

  test('reconnecting with the same token before the grace period cancels the forfeit', async () => {
    const a = await connect();
    const b = await connect();
    const identA = await identify(a, null);
    const identB = await identify(b, null);

    a.send(JSON.stringify({ type: 'createRoom', token: identA.account.token, faction: 'albura', deck: fullDeck('a') }));
    const created = await nextMessage(a);
    b.send(JSON.stringify({ type: 'joinRoom', token: identB.account.token, code: created.code, faction: 'ignara', deck: fullDeck('g') }));
    await Promise.all([nextMessage(a), nextMessage(b)]);

    const disconnectNotice = nextMessage(b);
    a.close();
    await disconnectNotice;

    const a2 = await connect();
    const reconnectedNotice = nextMessage(b);
    const rejoined = await identify(a2, identA.account.token);
    assert.equal(rejoined.type, 'identified');

    const matchStart = await nextMessage(a2);
    assert.equal(matchStart.type, 'matchStart');
    assert.equal(matchStart.reconnected, true);
    assert.equal((await reconnectedNotice).type, 'opponentReconnected');

    // No forfeit should follow — b must NOT receive a matchEnd shortly after.
    const raced = await Promise.race([
      nextMessage(b).then(() => 'message'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 250)),
    ]);
    assert.equal(raced, 'timeout');

    a2.close();
    b.close();
  });
});

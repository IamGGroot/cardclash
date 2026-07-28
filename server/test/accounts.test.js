import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Point the account store at a throwaway file so these tests never touch a
// real accounts.json, then import the modules under test.
process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-test-${crypto.randomUUID()}.json`);

const {
  getOrCreateAccount,
  setUsername,
  linkGoogleAccount,
  unlinkGoogleAccount,
  deleteAccount,
  getLeaderboard,
  getRank,
  addFriend,
  getFriendsList,
  publicAccount,
} = await import('../accounts.js');

function googleProfile(overrides = {}) {
  return { sub: 'google-sub-1', email: 'player@example.com', name: 'Real Name', ...overrides };
}

describe('linkGoogleAccount', () => {
  test('first-time link attaches googleId/email to the current account, preserving its progress', () => {
    const token = crypto.randomUUID();
    const before = getOrCreateAccount(token);
    before.currency.coins = 500;
    setUsername(token, 'MyChosenName');

    const linked = linkGoogleAccount(token, googleProfile());

    assert.equal(linked.token, token, 'links onto the same account, does not create a new one');
    assert.equal(linked.googleId, 'google-sub-1');
    assert.equal(linked.email, 'player@example.com');
    assert.equal(linked.currency.coins, 500, 'anonymous progress must survive the link');
    assert.equal(linked.username, 'MyChosenName', 'a username the player already chose must not be overwritten');
  });

  test('adopts the Google display name only when the account still has an auto-generated username', () => {
    const token = crypto.randomUUID();
    getOrCreateAccount(token); // username is auto-generated "JugadorNNNN" at this point

    const linked = linkGoogleAccount(token, googleProfile({ sub: 'google-sub-2', name: 'Ada Lovelace' }));

    assert.equal(linked.username, 'Ada Lovelace');
  });

  test('signing in again with the same Google identity switches to the previously-linked account', () => {
    const firstToken = crypto.randomUUID();
    getOrCreateAccount(firstToken).currency.gems = 42;
    const firstLink = linkGoogleAccount(firstToken, googleProfile({ sub: 'google-sub-3' }));

    // A different browser/device — a brand-new anonymous token — signs in
    // with the SAME Google account.
    const secondToken = crypto.randomUUID();
    getOrCreateAccount(secondToken);
    const secondLink = linkGoogleAccount(secondToken, googleProfile({ sub: 'google-sub-3' }));

    assert.equal(secondLink.token, firstToken, 'must switch to the account this Google identity was already linked to');
    assert.equal(secondLink.currency.gems, 42, 'the original linked account\'s progress must be what comes back');
  });
});

describe('publicAccount', () => {
  test('exposes googleLinked/email without leaking the raw googleId', () => {
    const token = crypto.randomUUID();
    getOrCreateAccount(token);
    const linked = linkGoogleAccount(token, googleProfile({ sub: 'google-sub-4' }));
    const pub = publicAccount(linked);

    assert.equal(pub.googleLinked, true);
    assert.equal(pub.email, 'player@example.com');
    assert.equal('googleId' in pub, false, 'the raw Google subject id is server-internal, not for the client');
  });

  test('reports googleLinked: false for an anonymous account', () => {
    const token = crypto.randomUUID();
    const account = getOrCreateAccount(token);
    assert.equal(publicAccount(account).googleLinked, false);
  });
});

describe('unlinkGoogleAccount', () => {
  test('removes the Google identity but keeps everything else about the account', () => {
    const token = crypto.randomUUID();
    getOrCreateAccount(token).currency.coins = 100;
    linkGoogleAccount(token, googleProfile({ sub: 'google-sub-unlink' }));

    const unlinked = unlinkGoogleAccount(token);

    assert.equal('googleId' in unlinked, false);
    assert.equal('email' in unlinked, false);
    assert.equal(unlinked.currency.coins, 100, 'progress must survive unlinking');
    assert.equal(publicAccount(unlinked).googleLinked, false);
  });
});

describe('deleteAccount', () => {
  test('removes the account — the same token later gets a brand-new one', () => {
    const token = crypto.randomUUID();
    getOrCreateAccount(token).wins = 7;

    deleteAccount(token);
    const recreated = getOrCreateAccount(token);

    assert.equal(recreated.wins, 0, 'must be a fresh account, not the deleted one resurrected');
  });
});

describe('getLeaderboard / getRank', () => {
  async function setTrophies(token, trophies) {
    const { saveAccount } = await import('../db.js');
    const account = getOrCreateAccount(token);
    account.trophies = trophies;
    saveAccount(token, account);
  }

  test('entries are sorted by trophies, descending', () => {
    const board = getLeaderboard(1000);
    for (let i = 1; i < board.length; i++) {
      assert.ok(board[i - 1].trophies >= board[i].trophies, 'leaderboard must never increase down the list');
    }
  });

  test('a higher-trophy account always outranks a lower one (lower rank number = better)', async () => {
    const lower = crypto.randomUUID();
    const higher = crypto.randomUUID();
    await setTrophies(lower, 10000);
    await setTrophies(higher, 20000);

    assert.ok(getRank(higher) < getRank(lower));
  });

  test('returns null for a token that has no account', () => {
    assert.equal(getRank('definitely-not-a-real-token'), null);
  });

  test('entries expose rank/username/trophies and nothing account-sensitive', () => {
    const [entry] = getLeaderboard(1);
    assert.ok('rank' in entry && 'username' in entry && 'trophies' in entry);
    assert.equal('token' in entry, false);
  });
});

describe('addFriend / getFriendsList', () => {
  test('adding a friend is mutual', () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    getOrCreateAccount(a);
    getOrCreateAccount(b);

    const res = addFriend(a, b);

    assert.equal(res.ok, true);
    assert.ok(getFriendsList(a).some((f) => f.token === b));
    assert.ok(getFriendsList(b).some((f) => f.token === a));
  });

  test('rejects adding yourself', () => {
    const a = crypto.randomUUID();
    getOrCreateAccount(a);
    const res = addFriend(a, a);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid');
  });

  test('rejects a code that is not a real account', () => {
    const a = crypto.randomUUID();
    getOrCreateAccount(a);
    const res = addFriend(a, 'not-a-real-token');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'not_found');
  });

  test('adding the same friend twice does not duplicate them', () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    getOrCreateAccount(a);
    getOrCreateAccount(b);
    addFriend(a, b);
    addFriend(a, b);
    assert.equal(getFriendsList(a).filter((f) => f.token === b).length, 1);
  });

  test('a deleted friend silently drops out of the list instead of erroring', () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    getOrCreateAccount(a);
    getOrCreateAccount(b);
    addFriend(a, b);

    deleteAccount(b);

    assert.deepEqual(getFriendsList(a), []);
  });
});

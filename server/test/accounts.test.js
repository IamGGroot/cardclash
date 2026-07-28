import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Point the account store at a throwaway file so these tests never touch a
// real accounts.json, then import the modules under test.
process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-test-${crypto.randomUUID()}.json`);

const { getOrCreateAccount, setUsername, linkGoogleAccount, publicAccount } = await import('../accounts.js');

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

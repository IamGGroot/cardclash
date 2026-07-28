import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Point the account store at a throwaway file so these tests never touch a
// real accounts.json, then import the modules under test.
process.env.DB_FILE = path.join(os.tmpdir(), `cardclash-test-${crypto.randomUUID()}.json`);

const { verifyStripeSignature, handleCheckoutCompleted } = await import('../payments.js');
const { getAccount, getOrCreateAccount, creditCurrency } = await import('../accounts.js');

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret';

  function sign(rawBody, secretKey, timestamp = Math.floor(Date.now() / 1000)) {
    const signedPayload = `${timestamp}.${rawBody}`;
    const v1 = crypto.createHmac('sha256', secretKey).update(signedPayload, 'utf8').digest('hex');
    return `t=${timestamp},v1=${v1}`;
  }

  test('accepts a correctly signed payload', () => {
    const body = JSON.stringify({ hello: 'world' });
    const header = sign(body, secret);
    assert.equal(verifyStripeSignature(body, header, secret), true);
  });

  test('rejects a payload signed with the wrong secret', () => {
    const body = JSON.stringify({ hello: 'world' });
    const header = sign(body, 'whsec_wrong_secret');
    assert.equal(verifyStripeSignature(body, header, secret), false);
  });

  test('rejects a tampered body even with a valid-looking signature', () => {
    const header = sign(JSON.stringify({ hello: 'world' }), secret);
    const tampered = JSON.stringify({ hello: 'mallory' });
    assert.equal(verifyStripeSignature(tampered, header, secret), false);
  });

  test('rejects a stale timestamp (replay protection)', () => {
    const body = JSON.stringify({ hello: 'world' });
    const oldTimestamp = Math.floor(Date.now() / 1000) - 10_000;
    const header = sign(body, secret, oldTimestamp);
    assert.equal(verifyStripeSignature(body, header, secret), false);
  });

  test('rejects a missing signature header', () => {
    assert.equal(verifyStripeSignature('{}', undefined, secret), false);
  });
});

describe('creditCurrency idempotency', () => {
  test('a repeated eventId does not grant currency twice (webhook retry safety)', () => {
    const account = getOrCreateAccount(null);
    creditCurrency(account.token, 'gems', 100, { eventId: 'evt_123', source: 'stripe' });
    creditCurrency(account.token, 'gems', 100, { eventId: 'evt_123', source: 'stripe' });
    const after = getAccount(account.token);
    assert.equal(after.currency.gems, 100);
  });

  test('distinct eventIds each grant currency', () => {
    const account = getOrCreateAccount(null);
    creditCurrency(account.token, 'coins', 500, { eventId: 'evt_a' });
    creditCurrency(account.token, 'coins', 500, { eventId: 'evt_b' });
    const after = getAccount(account.token);
    assert.equal(after.currency.coins, 1000);
  });
});

describe('handleCheckoutCompleted', () => {
  test('credits the account named in the session metadata', () => {
    const account = getOrCreateAccount(null);
    const event = {
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: { object: { metadata: { skuId: 'gems_small', accountToken: account.token } } },
    };
    const result = handleCheckoutCompleted(event);
    assert.equal(result.ok, true);
    const after = getAccount(account.token);
    assert.equal(after.currency.gems, 100); // gems_small grants 100 gems
  });

  test('the welcome offer grants both coins and gems', () => {
    const account = getOrCreateAccount(null);
    const event = {
      id: 'evt_checkout_2',
      type: 'checkout.session.completed',
      data: { object: { metadata: { skuId: 'welcome_offer', accountToken: account.token } } },
    };
    handleCheckoutCompleted(event);
    const after = getAccount(account.token);
    assert.equal(after.currency.coins, 600);
    assert.equal(after.currency.gems, 250);
  });

  test('returns ok:false when metadata is missing (malformed/foreign event)', () => {
    const result = handleCheckoutCompleted({ id: 'evt_bad', data: { object: {} } });
    assert.equal(result.ok, false);
  });

  test('a retried webhook delivery for the same event does not double-grant either currency', () => {
    const account = getOrCreateAccount(null);
    const event = {
      id: 'evt_checkout_retry',
      type: 'checkout.session.completed',
      data: { object: { metadata: { skuId: 'welcome_offer', accountToken: account.token } } },
    };
    handleCheckoutCompleted(event);
    handleCheckoutCompleted(event); // Stripe redelivering the same event
    const after = getAccount(account.token);
    assert.equal(after.currency.coins, 600);
    assert.equal(after.currency.gems, 250);
  });
});

// Player identity for the multiplayer server. A player is always identified
// first by an opaque token the client generates once and stores in
// localStorage (see src/net.js) — that's enough to (a) give every player a
// stable name across matches and (b) hold a server-authoritative currency
// ledger that real payments can credit without trusting anything the client
// says about its own balance. Google Sign-In (see linkGoogleAccount below)
// is an optional identity layered on top: it lets the same account survive
// a cleared browser/new device, but the token-based account is still what
// everything else in this file operates on.
import crypto from 'node:crypto';
import { getAccount as dbGetAccount, saveAccount, findAccountByGoogleId } from './db.js';
import { applyMatchResult } from '../src/ladder.js';

export function getAccount(token) {
  return dbGetAccount(token);
}

function randomUsername() {
  return `Jugador${Math.floor(1000 + Math.random() * 9000)}`;
}

export function getOrCreateAccount(token) {
  const id = token && typeof token === 'string' ? token : crypto.randomUUID();
  let account = getAccount(id);
  if (!account) {
    account = {
      token: id,
      createdAt: new Date().toISOString(),
      username: randomUsername(),
      wins: 0,
      losses: 0,
      trophies: 0,
      currency: { coins: 0, gems: 0, dust: 0 },
      transactions: [],
    };
    saveAccount(id, account);
  }
  return account;
}

export function setUsername(token, username) {
  const account = getOrCreateAccount(token);
  const clean = String(username || '').trim().slice(0, 20);
  if (!clean) return account;
  account.username = clean;
  saveAccount(token, account);
  return account;
}

// Called after the server has verified a Google ID token (see
// server/googleAuth.js) — `profile` is the trusted { sub, email, name } from
// that token, never anything the client claimed directly.
//
// Two cases:
//  - This Google identity was already linked to an account before (they
//    signed in on another device, or came back after clearing this one) →
//    switch to that account; whatever local/anonymous progress the caller's
//    `currentToken` had is left behind (it's a stray anonymous session, not
//    meant to overwrite a real account's history).
//  - First time this Google identity has ever signed in → attach it to the
//    caller's CURRENT account, preserving all of its anonymous progress
//    instead of starting over.
export function linkGoogleAccount(currentToken, profile) {
  const existing = findAccountByGoogleId(profile.sub);
  if (existing) return existing;
  const account = getOrCreateAccount(currentToken);
  account.googleId = profile.sub;
  account.email = profile.email || null;
  if (profile.name && (!account.username || /^Jugador\d+$/.test(account.username))) {
    account.username = String(profile.name).trim().slice(0, 20);
  }
  saveAccount(account.token, account);
  return account;
}

export function recordMatchResult(token, won) {
  const account = getOrCreateAccount(token);
  if (won) account.wins += 1;
  else account.losses += 1;
  saveAccount(token, account);
  return account;
}

export function applyMatchTrophies(token, won) {
  const account = getOrCreateAccount(token);
  const { trophies, delta } = applyMatchResult(account.trophies || 0, won);
  account.trophies = trophies;
  saveAccount(token, account);
  return { trophies, delta };
}

// Credits currency onto a player's server-side balance. `eventId` should be
// a value that's unique per real-world event (e.g. a Stripe event id) so
// that retried webhook deliveries can't double-grant the same purchase.
export function creditCurrency(token, currency, amount, { eventId, source = 'unknown' } = {}) {
  const account = getOrCreateAccount(token);
  if (eventId && account.transactions.some((t) => t.eventId === eventId)) {
    return { account, alreadyApplied: true };
  }
  if (!(currency in account.currency)) return { account, alreadyApplied: false };
  account.currency[currency] += amount;
  account.transactions.push({
    id: crypto.randomUUID(),
    eventId: eventId ?? null,
    currency,
    amount,
    source,
    at: new Date().toISOString(),
  });
  saveAccount(token, account);
  return { account, alreadyApplied: false };
}

export function publicAccount(account) {
  return {
    token: account.token,
    username: account.username,
    wins: account.wins,
    losses: account.losses,
    trophies: account.trophies || 0,
    currency: account.currency,
    googleLinked: Boolean(account.googleId),
    email: account.email || null,
  };
}

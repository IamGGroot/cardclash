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
import {
  getAccount as dbGetAccount,
  saveAccount,
  findAccountByGoogleId,
  allAccounts,
  deleteAccount as dbDeleteAccount,
} from './db.js';
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
      friends: [],
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

// Removes the Google identity from an account without touching anything
// else — the account keeps its token, progress, currency, friends. The
// player can link a Google account again later (their own or a different
// one); nothing here notifies whatever Google identity used to be attached.
export function unlinkGoogleAccount(token) {
  const account = getOrCreateAccount(token);
  delete account.googleId;
  delete account.email;
  saveAccount(token, account);
  return account;
}

// Permanently deletes an account. The caller (server/index.js) is
// responsible for treating this as the destructive, player-confirmed action
// it is — nothing here asks for confirmation or can undo it.
export function deleteAccount(token) {
  dbDeleteAccount(token);
}

// Top `limit` accounts by trophies, for the public leaderboard screen —
// deliberately exposes only what publicAccount() would (no token, no
// email), since this list is visible to every player, not just the account
// owner.
export function getLeaderboard(limit = 50) {
  return Object.values(allAccounts())
    .sort((a, b) => (b.trophies || 0) - (a.trophies || 0))
    .slice(0, limit)
    .map((account, i) => ({ rank: i + 1, username: account.username, trophies: account.trophies || 0 }));
}

// Where this account currently sits in the full (not just top-`limit`)
// ranking — used to show "you're #142" even when the player isn't in the
// visible top of the leaderboard screen.
export function getRank(token) {
  const sorted = Object.values(allAccounts()).sort((a, b) => (b.trophies || 0) - (a.trophies || 0));
  const idx = sorted.findIndex((a) => a.token === token);
  return idx === -1 ? null : idx + 1;
}

// Friend codes are just account tokens — no separate identity system, so
// "adding a friend" is symmetric and immediate (no request/accept step).
// Rejects adding yourself or a token that isn't a real account.
export function addFriend(token, friendToken) {
  if (!friendToken || typeof friendToken !== 'string' || friendToken === token) {
    return { ok: false, reason: 'invalid' };
  }
  const friendAccount = getAccount(friendToken);
  if (!friendAccount) return { ok: false, reason: 'not_found' };
  const account = getOrCreateAccount(token);
  account.friends = account.friends || [];
  if (!account.friends.includes(friendToken)) account.friends.push(friendToken);
  friendAccount.friends = friendAccount.friends || [];
  if (!friendAccount.friends.includes(token)) friendAccount.friends.push(token);
  saveAccount(token, account);
  saveAccount(friendToken, friendAccount);
  return { ok: true };
}

// Resolves each stored friend token to their current (public-safe) profile.
// A friend whose account no longer exists (deleted) is silently dropped —
// see db.js's deleteAccount for why no cleanup pass is needed elsewhere.
export function getFriendsList(token) {
  const account = getOrCreateAccount(token);
  return (account.friends || [])
    .map((friendToken) => getAccount(friendToken))
    .filter(Boolean)
    .map((a) => ({ token: a.token, username: a.username, trophies: a.trophies || 0 }));
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

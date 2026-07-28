// Player identity for the multiplayer server. Deliberately lightweight: no
// password/email/OAuth yet — a player is identified by an opaque token the
// client generates once and stores in localStorage (see src/net.js). This is
// enough to (a) give every player a stable name across matches and (b) hold
// a server-authoritative currency ledger that real payments can credit
// without trusting anything the client says about its own balance.
//
// A real account system (email+password or OAuth, so a player isn't locked
// out the moment they clear browser storage) is the natural next step — flagged
// in the project summary rather than built here, since it's a genuinely
// separate feature (recovery flow, verification emails, etc.).
import crypto from 'node:crypto';
import { getAccount as dbGetAccount, saveAccount } from './db.js';
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
  };
}

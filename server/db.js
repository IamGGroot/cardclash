// Minimal JSON-file persistence for player accounts (identity + server-side
// currency ledger). This intentionally is NOT a real database — it's the
// smallest thing that (a) survives a server restart and (b) makes it obvious
// where to plug in Postgres/SQLite/whatever later: everything account-related
// goes through the three functions below, so swapping the storage engine
// means rewriting this one file, not anything that calls it.
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

const dbFile = path.resolve(env('DB_FILE', './data/accounts.json'));

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch {
    cache = { accounts: {} };
  }
  return cache;
}

function persist() {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  // Write to a temp file then rename, so a crash mid-write can't leave a
  // half-written (corrupt) accounts.json behind.
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, dbFile);
}

export function getAccount(token) {
  return load().accounts[token] ?? null;
}

export function saveAccount(token, account) {
  const db = load();
  db.accounts[token] = account;
  persist();
  return account;
}

export function allAccounts() {
  return load().accounts;
}

// Linear scan is fine at this scale (see the file-level note above about
// this being a stand-in for a real DB) — a real database would index this
// by googleId instead.
export function findAccountByGoogleId(googleId) {
  const accounts = load().accounts;
  return Object.values(accounts).find((a) => a.googleId === googleId) ?? null;
}

// Destructive — wipes every account. Gated behind ADMIN_SECRET at the HTTP
// layer (see server/index.js), never called from normal gameplay code.
export function resetAllAccounts() {
  cache = { accounts: {} };
  persist();
}

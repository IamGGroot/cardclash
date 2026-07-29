import './env.js';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { HEROES } from '../src/cards.js';
import { env } from './env.js';
import {
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
} from './accounts.js';
import { verifyGoogleIdToken, googleSignInConfigured } from './googleAuth.js';
import { resetAllAccounts } from './db.js';
import { listSkus, getSku } from './skus.js';
import { createCheckoutSession, verifyStripeSignature, handleCheckoutCompleted, webhookConfigured } from './payments.js';
import {
  registerHeroes,
  createRoom,
  joinRoom,
  queueQuickMatch,
  cancelQuickMatch,
  handleAction,
  handleDisconnect,
  tryReconnect,
  roomStats,
} from './rooms.js';
import {
  queueDraftEntry,
  cancelDraftQueue,
  handleDraftPick,
  handleDraftHeroPick,
  handleDraftDisconnect,
  draftStats,
} from './draftPods.js';
import { queueTournamentEntry, cancelTournamentQueue, handleTournamentDisconnect, tournamentStats } from './tournamentPods.js';

registerHeroes(HEROES);

const PORT = Number(env('PORT', '8791'));
const ALLOWED_ORIGINS = env('ALLOWED_ORIGINS', '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsOrigin(req) {
  if (ALLOWED_ORIGINS.includes('*')) return '*';
  const origin = req.headers.origin;
  return origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || '';
}

function withCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature');
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return {};
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  withCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, ...roomStats(), ...draftStats(), ...tournamentStats(), paymentsConfigured: webhookConfigured(), googleSignInConfigured: googleSignInConfigured() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/skus') {
      sendJson(res, 200, { skus: listSkus().map(({ stripePriceId, ...s }) => s) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/account') {
      const { token, username } = await readJson(req);
      let account = getOrCreateAccount(token);
      if (username) account = setUsername(account.token, username);
      sendJson(res, 200, { account: publicAccount(account) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/google') {
      const { token, idToken } = await readJson(req);
      if (!googleSignInConfigured()) {
        sendJson(res, 501, { error: 'Google Sign-In no está configurado en el servidor.' });
        return;
      }
      const profile = await verifyGoogleIdToken(idToken);
      if (!profile) {
        sendJson(res, 401, { error: 'Token de Google inválido.' });
        return;
      }
      const account = linkGoogleAccount(token, profile);
      sendJson(res, 200, { account: publicAccount(account) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/google/unlink') {
      const { token } = await readJson(req);
      const account = unlinkGoogleAccount(token);
      sendJson(res, 200, { account: publicAccount(account) });
      return;
    }

    // Player-initiated, permanent — the client is responsible for its own
    // confirmation step before ever calling this (see ui.js's delete-account
    // flow). No recovery path exists once this runs.
    if (req.method === 'POST' && url.pathname === '/api/account/delete') {
      const { token } = await readJson(req);
      if (!token) {
        sendJson(res, 400, { error: 'Falta token.' });
        return;
      }
      deleteAccount(token);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/leaderboard') {
      const { token } = await readJson(req);
      sendJson(res, 200, { leaderboard: getLeaderboard(50), myRank: token ? getRank(token) : null });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/friends/list') {
      const { token } = await readJson(req);
      sendJson(res, 200, { friends: getFriendsList(token) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/friends/add') {
      const { token, friendToken } = await readJson(req);
      const result = addFriend(token, friendToken);
      if (!result.ok) {
        const message = result.reason === 'not_found' ? 'No existe ninguna cuenta con ese código.' : 'Código inválido.';
        sendJson(res, 400, { error: message });
        return;
      }
      sendJson(res, 200, { friends: getFriendsList(token) });
      return;
    }

    // Destructive admin tool, not part of normal gameplay — wipes every
    // account. Disabled unless ADMIN_SECRET is set, and even then only
    // responds to a request carrying the exact matching secret (any
    // mismatch, including "unset", looks like a 404 rather than a 403, so
    // it doesn't advertise its own existence).
    if (req.method === 'POST' && url.pathname === '/api/admin/reset-accounts') {
      const adminSecret = env('ADMIN_SECRET');
      const { secret } = await readJson(req);
      if (!adminSecret || secret !== adminSecret) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      resetAllAccounts();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/payments/checkout') {
      const { token, skuId } = await readJson(req);
      if (!token || !skuId) {
        sendJson(res, 400, { error: 'Falta token o skuId.' });
        return;
      }
      getOrCreateAccount(token);
      const result = await createCheckoutSession(skuId, token);
      sendJson(res, result.error ? 501 : 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/payments/webhook') {
      const raw = await readRawBody(req);
      const secret = env('STRIPE_WEBHOOK_SECRET');
      if (!secret) {
        sendJson(res, 501, { error: 'Webhook no configurado.' });
        return;
      }
      const signature = req.headers['stripe-signature'];
      if (!verifyStripeSignature(raw.toString('utf8'), signature, secret)) {
        sendJson(res, 400, { error: 'Firma inválida.' });
        return;
      }
      const event = JSON.parse(raw.toString('utf8'));
      if (event.type === 'checkout.session.completed') {
        handleCheckoutCompleted(event);
      }
      sendJson(res, 200, { received: true });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'internal error' });
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let identified = false;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }

    if (msg.type === 'identify') {
      const account = getOrCreateAccount(msg.token);
      identified = true;
      // Confirm identity first, then (if applicable) re-attach to an
      // in-progress match — so the client always sees 'identified' before
      // any 'matchStart' that reconnecting might trigger.
      ws.send(JSON.stringify({ type: 'identified', account: publicAccount(account) }));
      tryReconnect(ws, account.token);
      return;
    }

    if (!identified) {
      ws.send(JSON.stringify({ type: 'error', message: 'Identificate antes de jugar.' }));
      return;
    }

    switch (msg.type) {
      case 'createRoom': {
        const account = getOrCreateAccount(msg.token);
        const result = createRoom({ ws, token: account.token, faction: msg.faction, deck: msg.deck, autoPlay: Boolean(msg.autoPlay) });
        if (result.error) ws.send(JSON.stringify({ type: 'error', message: result.error }));
        break;
      }
      case 'joinRoom': {
        const account = getOrCreateAccount(msg.token);
        const result = joinRoom({ ws, token: account.token, code: msg.code, faction: msg.faction, deck: msg.deck, autoPlay: Boolean(msg.autoPlay) });
        if (result.error) ws.send(JSON.stringify({ type: 'error', message: result.error }));
        break;
      }
      case 'quickMatch': {
        const account = getOrCreateAccount(msg.token);
        const result = queueQuickMatch({ ws, token: account.token, faction: msg.faction, deck: msg.deck, autoPlay: Boolean(msg.autoPlay) });
        if (result.error) ws.send(JSON.stringify({ type: 'error', message: result.error }));
        break;
      }
      case 'cancelQuickMatch':
        cancelQuickMatch(ws);
        break;
      case 'action':
        handleAction(ws, msg.action || {});
        break;
      case 'queueDraft': {
        const account = getOrCreateAccount(msg.token);
        queueDraftEntry({ ws, token: account.token });
        break;
      }
      case 'cancelDraftQueue':
        cancelDraftQueue(ws);
        break;
      case 'draftPick':
        handleDraftPick(ws, msg.cardId);
        break;
      case 'draftHeroPick':
        handleDraftHeroPick(ws, msg.faction);
        break;
      case 'queueTournament': {
        const account = getOrCreateAccount(msg.token);
        const result = queueTournamentEntry({ ws, token: account.token, faction: msg.faction, deck: msg.deck });
        if (result.error) ws.send(JSON.stringify({ type: 'error', message: result.error }));
        break;
      }
      case 'cancelTournamentQueue':
        cancelTournamentQueue(ws);
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
    handleDraftDisconnect(ws);
    handleTournamentDisconnect(ws);
  });
});

// Only auto-listen when run directly (`node index.js`) — tests import this
// module to get the configured `server` instance and pick their own
// (ephemeral) port instead.
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  server.listen(PORT, () => {
    console.log(`Card Clash multiplayer server listening on :${PORT} (ws path: /ws)`);
  });
}

export { server, wss };

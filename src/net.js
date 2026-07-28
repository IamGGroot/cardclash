// WebSocket client for online multiplayer. Talks to server/index.js. The
// client never runs game logic itself in online mode — it sends intents
// (createRoom/joinRoom/quickMatch/action) and applies whatever state the
// server broadcasts back, exactly the way ui.js already reuses its single
// state object for the vs-AI game, just fed from the network instead of a
// local engine call. See server/protocol.js for why the state always arrives
// "mirrored" so this client can keep pretending it's always p1.
const TOKEN_KEY = 'cardclash_net_token';

// Set this to your deployed backend's host (e.g.
// 'cardclash-server.up.railway.app', no protocol, no trailing slash) once
// server/ is deployed somewhere real. Only used when the client itself
// isn't running on localhost — local dev always talks to localhost:8791
// regardless of this value, and a `?wsHost=` query param always wins over
// both (handy for pointing a local client at a staging backend).
const PRODUCTION_WS_HOST = 'cardclash-production-b093.up.railway.app';

function hostOverride() {
  return new URLSearchParams(location.search).get('wsHost');
}

function backendHost() {
  const override = hostOverride();
  if (override) return override;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return `${location.hostname}:8791`;
  }
  return PRODUCTION_WS_HOST || `${location.hostname}:8791`;
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${backendHost()}/ws`;
}

function apiBase() {
  const proto = location.protocol === 'https:' ? 'https:' : 'http:';
  return `${proto}//${backendHost()}`;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

let ws = null;
let account = null;
let connectPromise = null;
const listeners = {};

export function on(type, handler) {
  (listeners[type] ||= []).push(handler);
}
export function off(type, handler) {
  if (!listeners[type]) return;
  listeners[type] = listeners[type].filter((h) => h !== handler);
}
function emit(type, msg) {
  for (const h of listeners[type] || []) h(msg);
}

export function getAccount() {
  return account;
}

export function isConnected() {
  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

// Resolves once the connection is open AND identified (account known).
// Safe to call repeatedly — returns the same in-flight/settled promise.
export function connect() {
  if (connectPromise) return connectPromise;
  connectPromise = new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    try {
      socket = new WebSocket(wsUrl());
    } catch (err) {
      connectPromise = null;
      reject(err);
      return;
    }
    ws = socket;

    ws.onopen = () => {
      send({ type: 'identify', token: getToken() });
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'identified') {
        account = msg.account;
        setToken(account.token);
        if (!settled) {
          settled = true;
          resolve(account);
        }
      }
      emit(msg.type, msg);
    };
    ws.onerror = () => {
      if (!settled) {
        settled = true;
        connectPromise = null;
        reject(new Error('No se pudo conectar con el servidor.'));
      }
    };
    ws.onclose = () => {
      ws = null;
      connectPromise = null;
      account = null;
      emit('disconnected');
    };
  });
  return connectPromise;
}

export function disconnect() {
  if (ws) ws.close();
  ws = null;
  connectPromise = null;
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

export function createRoom(faction, deck) {
  send({ type: 'createRoom', token: getToken(), faction, deck });
}
export function joinRoom(code, faction, deck) {
  send({ type: 'joinRoom', token: getToken(), code, faction, deck });
}
export function quickMatch(faction, deck) {
  send({ type: 'quickMatch', token: getToken(), faction, deck });
}
export function cancelQuickMatch() {
  send({ type: 'cancelQuickMatch' });
}
export function sendAction(action) {
  send({ type: 'action', action });
}

// ---- REST helpers (payments + account lookups outside a live match) ----

export async function fetchAccount() {
  const res = await fetch(`${apiBase()}/api/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: getToken() }),
  });
  const data = await res.json();
  if (data.account) setToken(data.account.token);
  return data.account;
}

export async function renameAccount(username) {
  const res = await fetch(`${apiBase()}/api/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: getToken(), username }),
  });
  const data = await res.json();
  if (data.account) setToken(data.account.token);
  return data.account;
}

export async function fetchSkus() {
  const res = await fetch(`${apiBase()}/api/skus`);
  const data = await res.json();
  return data.skus || [];
}

// Starts a real-money purchase: asks the server for a Stripe Checkout URL
// and returns it. Callers should redirect the browser there (or open it in a
// new tab) — this deliberately does not touch window.location itself so the
// caller can confirm with the player first. Fails clearly if the server
// hasn't got Stripe keys configured yet (see server/.env.example).
export async function startCheckout(skuId) {
  const res = await fetch(`${apiBase()}/api/payments/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: getToken(), skuId }),
  });
  return res.json();
}

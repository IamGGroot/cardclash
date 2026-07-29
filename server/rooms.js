// Room lifecycle, matchmaking, and the authoritative per-action loop. The
// server never trusts the client's copy of the game state — every action
// message is replayed through src/actions.js against the server's own
// `battle` state (built with src/battle.js, the exact same engine the
// single-player client uses against the bot), and only the *result* is
// broadcast back out. A modified client can lie about what it wants to do,
// but not about what happens.
import crypto from 'node:crypto';
import { newGame } from '../src/battle.js';
import { getHero, cardsForFaction } from '../src/cards.js';
import {
  applyLevelUp,
  applySpecial,
  applyDeploy,
  applySpell,
  applyMove,
  applyAttack,
  applyEndTurn,
} from '../src/actions.js';
import { runAutoDeckTurnSteps } from '../src/autoDeck.js';
import { viewFor, mirrorStep } from './protocol.js';
import { recordMatchResult, applyMatchTrophies, getOrCreateAccount } from './accounts.js';
import { env } from './env.js';

const MAX_COPIES = 2;
const DECK_SIZE = 16;
const DISCONNECT_GRACE_MS = Number(env('DISCONNECT_GRACE_MS', '30000'));
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easier to read aloud/type

// Quick Match pairs the closest trophy count available; the acceptable gap
// widens the longer someone's been waiting, so a lone player in a quiet
// lobby still eventually gets matched instead of waiting forever.
const QUICK_MATCH_BASE_GAP = 150;
const QUICK_MATCH_GAP_PER_SEC = 25;

const rooms = new Map(); // code -> room
const wsToPlayer = new Map(); // ws -> { code, side }
const tokenToRoom = new Map(); // token -> code, for reconnect
const quickQueue = []; // [{ ws, token, faction, deck, trophies, queuedAt }]

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// A deck is a { cardId: count } map, same shape as save.decks[faction] on
// the client. Reject anything a legitimate deckbuilder couldn't produce
// rather than trusting the client's arithmetic.
export function validateDeck(deck, faction) {
  if (!deck || typeof deck !== 'object') return false;
  const legalIds = new Set([...cardsForFaction(faction), ...cardsForFaction('neutral')].map((c) => c.id));
  let total = 0;
  for (const [cardId, count] of Object.entries(deck)) {
    if (!legalIds.has(cardId)) return false;
    if (!Number.isInteger(count) || count < 0 || count > MAX_COPIES) return false;
    total += count;
  }
  return total > 0 && total <= DECK_SIZE;
}

function otherSide(side) {
  return side === 'p1' ? 'p2' : 'p1';
}

function makeRoom(code, quickMatch) {
  const room = {
    code,
    createdAt: Date.now(),
    quickMatch,
    players: {
      p1: null, // { ws, token, faction, deck, disconnectTimer }
      p2: null,
    },
    state: null,
    finished: false,
  };
  rooms.set(code, room);
  return room;
}

function attachPlayer(room, side, { ws, token, faction, deck, autoPlay }) {
  room.players[side] = { ws, token, faction, deck, autoPlay: Boolean(autoPlay), disconnectTimer: null };
  wsToPlayer.set(ws, { code: room.code, side });
  tokenToRoom.set(token, room.code);
}

function startMatch(room, { perkThreshold } = {}) {
  const p1 = room.players.p1;
  const p2 = room.players.p2;
  const heroP1 = findHero(p1.faction);
  const heroP2 = findHero(p2.faction);
  room.state = newGame(p1.deck, heroP1.id, p2.deck, heroP2.id, { perkThreshold });

  for (const side of ['p1', 'p2']) {
    const player = room.players[side];
    const opponent = room.players[otherSide(side)];
    send(player.ws, {
      type: 'matchStart',
      code: room.code,
      opponentFaction: opponent.faction,
      state: viewFor(room.state, side),
    });
  }
  // Fire-and-forget: newGame() always leaves p1 active, so if that side is
  // an Autodeckbuilder deck its turn needs to start driving itself right
  // away instead of waiting on an action that will never arrive.
  runAutoPlayTurns(room);
}

function findHero(faction) {
  // Small indirection so a missing/unknown faction fails loudly instead of
  // crashing newGame with heroId=undefined.
  const hero = HEROES_BY_FACTION[faction];
  if (!hero) throw new Error(`unknown faction: ${faction}`);
  return hero;
}

// Built once from cards.js's HEROES export — see setHeroes() below, called
// from index.js after import so this module doesn't need its own copy.
let HEROES_BY_FACTION = {};
export function registerHeroes(heroes) {
  HEROES_BY_FACTION = Object.fromEntries(heroes.map((h) => [h.faction, h]));
}

// Builds and starts a room directly from two already-known players, with no
// WS-message-driven createRoom/joinRoom handshake — used by
// server/draftPods.js to start each bracket match (semis/final) once the
// pod already knows both players' decks and heroes. `onFinished(winnerSide,
// room)` fires once, right as the room is torn down in endMatch(), so the
// caller can chain into the next bracket stage or award prizes.
export function startDirectMatch(playerA, playerB, { perkThreshold, quickMatch = false, onFinished } = {}) {
  const code = generateCode();
  const room = makeRoom(code, quickMatch);
  if (onFinished) room.onFinished = onFinished;
  attachPlayer(room, 'p1', playerA);
  attachPlayer(room, 'p2', playerB);
  startMatch(room, { perkThreshold });
  return room;
}

export function createRoom({ ws, token, faction, deck, autoPlay }) {
  if (!validateDeck(deck, faction)) return { error: 'Mazo inválido.' };
  const code = generateCode();
  const room = makeRoom(code, false);
  attachPlayer(room, 'p1', { ws, token, faction, deck, autoPlay });
  send(ws, { type: 'roomCreated', code });
  return { code };
}

export function joinRoom({ ws, token, code, faction, deck, autoPlay }) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) return { error: 'No existe una sala con ese código.' };
  if (room.players.p2) return { error: 'Esa sala ya está completa.' };
  if (!validateDeck(deck, faction)) return { error: 'Mazo inválido.' };
  attachPlayer(room, 'p2', { ws, token, faction, deck, autoPlay });
  startMatch(room);
  return { code: room.code };
}

// How much trophy gap is currently acceptable for this queued entry —
// starts at QUICK_MATCH_BASE_GAP and widens the longer they've waited.
function queueGap(entry) {
  const waitedSec = (Date.now() - entry.queuedAt) / 1000;
  return QUICK_MATCH_BASE_GAP + waitedSec * QUICK_MATCH_GAP_PER_SEC;
}

// Greedily pairs the closest-trophy match available in the queue, repeating
// until no eligible pair remains (more than one pair can become eligible in
// a single pass if several similar-trophy players queued up close together).
function pairFromQueue() {
  let paired = true;
  while (paired && quickQueue.length >= 2) {
    paired = false;
    let bestI = -1;
    let bestJ = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < quickQueue.length; i++) {
      for (let j = i + 1; j < quickQueue.length; j++) {
        const a = quickQueue[i];
        const b = quickQueue[j];
        const diff = Math.abs(a.trophies - b.trophies);
        if (diff <= Math.min(queueGap(a), queueGap(b)) && diff < bestDiff) {
          bestDiff = diff;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI === -1) break;
    const b = quickQueue.splice(bestJ, 1)[0];
    const a = quickQueue.splice(bestI, 1)[0];
    const code = generateCode();
    const room = makeRoom(code, true);
    attachPlayer(room, 'p1', a);
    attachPlayer(room, 'p2', b);
    startMatch(room);
    paired = true;
  }
}

export function queueQuickMatch({ ws, token, faction, deck, autoPlay }) {
  if (!validateDeck(deck, faction)) return { error: 'Mazo inválido.' };
  // Drop any stale queue entry for this token (e.g. a reconnect/retry).
  const existingIdx = quickQueue.findIndex((q) => q.token === token);
  if (existingIdx !== -1) quickQueue.splice(existingIdx, 1);

  const trophies = getOrCreateAccount(token).trophies || 0;
  quickQueue.push({ ws, token, faction, deck, autoPlay, trophies, queuedAt: Date.now() });
  pairFromQueue();
  // Pairing may have already matched this exact entry above — only tell the
  // caller they're queued if they're still waiting.
  if (quickQueue.some((q) => q.ws === ws)) {
    send(ws, { type: 'queued' });
  }
  return {};
}

export function cancelQuickMatch(ws) {
  const idx = quickQueue.findIndex((q) => q.ws === ws);
  if (idx !== -1) quickQueue.splice(idx, 1);
}

function endMatch(room, winnerSide) {
  if (room.finished || !room.state) return;
  room.finished = true;
  room.state.winner = winnerSide;
  for (const side of ['p1', 'p2']) {
    const player = room.players[side];
    if (!player) continue;
    recordMatchResult(player.token, side === winnerSide);
    const { trophies, delta } = applyMatchTrophies(player.token, side === winnerSide);
    send(player.ws, {
      type: 'matchEnd',
      state: viewFor(room.state, side),
      youWon: side === winnerSide,
      trophies,
      trophyDelta: delta,
    });
    clearTimeout(player.disconnectTimer);
    wsToPlayer.delete(player.ws);
    tokenToRoom.delete(player.token);
  }
  rooms.delete(room.code);
  if (room.onFinished) room.onFinished(winnerSide, room);
}

function broadcastStep(room, step) {
  for (const side of ['p1', 'p2']) {
    const player = room.players[side];
    if (!player) continue;
    send(player.ws, { type: 'step', step: mirrorStep(step, side), state: viewFor(room.state, side) });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const AUTO_PLAY_STEP_DELAY_MS = Number(env('AUTO_PLAY_STEP_DELAY_MS', '900'));

// Drives whichever side is currently active for as long as that side is an
// Autodeckbuilder deck — one call covers both "one bot's turn, then hand
// back to a human opponent" and "bot vs bot," since it just keeps looping
// while the active side keeps being autoPlay. room.autoPlaying guards
// against two overlapping invocations (e.g. one from startMatch, one from
// handleAction's endTurn landing back to back) stepping on the same state.
async function runAutoPlayTurns(room) {
  if (room.autoPlaying) return;
  room.autoPlaying = true;
  try {
    while (!room.finished && room.state && !room.state.winner) {
      const side = room.state.active;
      const player = room.players[side];
      if (!player || !player.autoPlay) return;

      for (const step of runAutoDeckTurnSteps(room.state, side)) {
        broadcastStep(room, step);
        if (room.state.winner) break;
        await sleep(AUTO_PLAY_STEP_DELAY_MS);
      }
      if (room.state.winner) {
        endMatch(room, room.state.winner);
        return;
      }
      const endStep = applyEndTurn(room.state);
      if (endStep) broadcastStep(room, endStep);
      await sleep(AUTO_PLAY_STEP_DELAY_MS);
    }
  } finally {
    room.autoPlaying = false;
  }
}

const ATTRS = new Set(['might', 'magic', 'destiny']);
const ROWS = new Set(['front', 'back']);

function isLane(n) {
  return Number.isInteger(n) && n >= 0 && n < 4;
}

export function handleAction(ws, action) {
  const entry = wsToPlayer.get(ws);
  if (!entry) return;
  const room = rooms.get(entry.code);
  if (!room || !room.state || room.finished) return;
  const { side } = entry;
  const state = room.state;

  if (action.kind !== 'forfeit' && state.active !== side) {
    send(ws, { type: 'error', message: 'No es tu turno.' });
    return;
  }

  let step = null;
  try {
    switch (action.kind) {
      case 'levelUp':
        if (ATTRS.has(action.attr)) step = applyLevelUp(state, side, action.attr);
        break;
      case 'special': {
        const hero = getHero(state[side].heroId);
        if (hero) step = applySpecial(state, side, hero.special.id);
        break;
      }
      case 'deploy':
        if (Number.isInteger(action.handIdx) && isLane(action.laneIndex) && ROWS.has(action.row)) {
          step = applyDeploy(state, side, action.handIdx, action.laneIndex, action.row);
        }
        break;
      case 'spell':
        if (Number.isInteger(action.handIdx)) {
          step = applySpell(state, side, action.handIdx, toCanonicalTarget(action.target, side));
        }
        break;
      case 'move':
        if (isLane(action.fromLane) && ROWS.has(action.fromRow) && isLane(action.toLane) && ROWS.has(action.toRow)) {
          step = applyMove(state, side, action.fromLane, action.fromRow, action.toLane, action.toRow);
        }
        break;
      case 'attack':
        if (isLane(action.laneIndex) && ROWS.has(action.row) && action.target && typeof action.target.type === 'string') {
          step = applyAttack(state, side, action.laneIndex, action.row, action.target);
        }
        break;
      case 'endTurn':
        step = applyEndTurn(state);
        break;
      case 'forfeit':
        endMatch(room, otherSide(side));
        return;
      default:
        break;
    }
  } catch (err) {
    send(ws, { type: 'error', message: 'Acción inválida.' });
    return;
  }

  if (!step) {
    send(ws, { type: 'error', message: 'Esa jugada no es válida.' });
    return;
  }

  broadcastStep(room, step);
  if (state.winner) endMatch(room, state.winner);
  // Whatever just happened may have handed the turn to an autoPlay side
  // (most commonly: this was an endTurn) — no-ops immediately if not.
  else runAutoPlayTurns(room);
}

function toCanonicalTarget(target, senderSide) {
  if (!target || !target.side || senderSide !== 'p2') return target;
  return { ...target, side: otherSide(target.side) };
}

export function handleDisconnect(ws) {
  cancelQuickMatch(ws);
  const entry = wsToPlayer.get(ws);
  if (!entry) return;
  const room = rooms.get(entry.code);
  if (!room || room.finished) return;
  const { side } = entry;
  const player = room.players[side];
  if (!player) return;

  // No match ever started (e.g. the creator closed the tab while still
  // waiting for an opponent) — there's no one to declare a winner over, just
  // drop the room instead of scheduling a forfeit.
  if (!room.state) {
    wsToPlayer.delete(ws);
    tokenToRoom.delete(player.token);
    rooms.delete(room.code);
    return;
  }

  const opponent = room.players[otherSide(side)];
  send(opponent && opponent.ws, { type: 'opponentDisconnected', graceMs: DISCONNECT_GRACE_MS });

  player.disconnectTimer = setTimeout(() => {
    endMatch(room, otherSide(side));
  }, DISCONNECT_GRACE_MS);
}

// Called when a fresh WebSocket identifies with a token that was mid-match —
// re-attaches it to the same room/side and cancels the forfeit timer.
export function tryReconnect(ws, token) {
  const code = tokenToRoom.get(token);
  if (!code) return false;
  const room = rooms.get(code);
  if (!room || room.finished) return false;
  const side = room.players.p1 && room.players.p1.token === token ? 'p1' : room.players.p2 && room.players.p2.token === token ? 'p2' : null;
  if (!side) return false;

  const player = room.players[side];
  clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  wsToPlayer.delete(player.ws);
  player.ws = ws;
  wsToPlayer.set(ws, { code, side });

  const opponent = room.players[otherSide(side)];
  send(opponent && opponent.ws, { type: 'opponentReconnected' });
  send(ws, { type: 'matchStart', code, opponentFaction: opponent.faction, state: viewFor(room.state, side), reconnected: true });
  return true;
}

export function roomStats() {
  return { activeRooms: rooms.size, queued: quickQueue.length };
}

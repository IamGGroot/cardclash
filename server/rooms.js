// Room lifecycle, matchmaking, and the authoritative per-action loop. The
// server never trusts the client's copy of the game state — every action
// message is replayed through src/actions.js against the server's own
// `battle` state (built with src/battle.js, the exact same engine the
// single-player client uses against the bot), and only the *result* is
// broadcast back out. A modified client can lie about what it wants to do,
// but not about what happens.
import crypto from 'node:crypto';
import { newGame } from '../src/battle.js';
import { CARDS, getHero } from '../src/cards.js';
import {
  applyLevelUp,
  applySpecial,
  applyDeploy,
  applyReplace,
  applySpell,
  applyMove,
  applyAttack,
  applyEndTurn,
} from '../src/actions.js';
import { runAutoDeckTurnSteps } from '../src/autoDeck.js';
import { runAiTurnSteps } from '../src/ai.js';
import { viewFor, mirrorStep } from './protocol.js';
import { recordMatchResult, applyMatchTrophies, getOrCreateAccount } from './accounts.js';
import { env } from './env.js';

const MAX_COPIES = 2;
const DECK_SIZE = 16;
const DISCONNECT_GRACE_MS = Number(env('DISCONNECT_GRACE_MS', '30000'));
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easier to read aloud/type

// Every match (Quick Match, Autodeckbuilder, Draft/Torneo bracket) is capped
// at a fixed wall-clock budget from the moment it starts — not turns — so a
// slow or stalling player can't hold a match (or, worse, a whole draft/
// tournament pod waiting on their bracket result) open indefinitely. On
// expiry, whoever has more hero HP at that instant wins; an exact tie is
// broken by a coin flip rather than a draw, since the rest of the match
// pipeline (trophies, bracket advancement) all expect a real winner.
const MATCH_TIME_LIMIT_MS = Number(env('MATCH_TIME_LIMIT_MS', String(5 * 60 * 1000)));

// Quick Match pairs the closest trophy count available; the acceptable gap
// widens the longer someone's been waiting, so a lone player in a quiet
// lobby still eventually gets matched instead of waiting forever. Since
// there's no offline vs-AI mode on the client anymore (online-only per
// product decision), anyone who's waited QUICK_MATCH_BOT_TIMEOUT_MS without
// a real opponent gets matched against a bot standing in as one instead —
// see matchWithBot() below.
const QUICK_MATCH_BASE_GAP = 150;
const QUICK_MATCH_GAP_PER_SEC = 25;
const QUICK_MATCH_BOT_TIMEOUT_MS = Number(env('QUICK_MATCH_BOT_TIMEOUT_MS', '5000'));
// Randomized "thinking time" before each of the bot's actions, so its turns
// don't play out instantly like a script — wide enough to read as a person
// deciding, not so wide it feels like lag.
const BOT_STEP_DELAY_MIN_MS = Number(env('BOT_STEP_DELAY_MIN_MS', '600'));
const BOT_STEP_DELAY_MAX_MS = Number(env('BOT_STEP_DELAY_MAX_MS', '2200'));

// A pregenerated pool of gamertag-style names for the matchmaking bot
// fallback — deliberately distinct from accounts.js's auto-generated
// "JugadorNNNN" default so a bot opponent reads as a real chosen username.
const BOT_NAMES = [
  'DragónVeloz', 'SombraNocturna', 'GuerreroDeAlba', 'FuriaIgnara', 'LoboDeAcero',
  'CazadorEstelar', 'AlmaDePiedra', 'VientoOscuro', 'LlamaEterna', 'CuervoBlanco',
  'EspadaSilente', 'RayoCarmesí', 'HielorFatal', 'CenizaViva', 'GolemAncestral',
  'FenixCaído', 'NocheEterna', 'PuñoDeHierro', 'AlbaSagrada', 'TormentaGris',
  'SangreFria', 'RaízProfunda', 'EcoDelAbismo', 'GarraSalvaje', 'MurallaViva',
  'DestellosDeUmbra', 'CazadorSilente', 'RunaDorada', 'PielDePiedra', 'VozDelBosque',
];

// Exported: server/draftPods.js and server/tournamentPods.js reuse this same
// name pool for their own 5s-then-bot pod fallback, so a bot reads the same
// whether it's standing in for a Quick Match, Draft, or Torneo opponent.
export function randomBotName() {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}

function randomDelay(min, max) {
  return min + Math.random() * (max - min);
}

// Mirrors src/store.js's client-side buildAiDeck(): a random 16-card deck
// pulled from the whole card pool, any faction mix — matching how a real
// player's own freeform deck can look (see store.js's deck rework).
function buildBotDeck() {
  const pool = [...CARDS].sort(() => Math.random() - 0.5);
  const deck = {};
  let total = 0;
  for (const card of pool) {
    if (total >= DECK_SIZE) break;
    const take = Math.min(MAX_COPIES, DECK_SIZE - total);
    deck[card.id] = take;
    total += take;
  }
  return deck;
}

// Exported: server/draftPods.js and server/tournamentPods.js's own 5s pod
// bot-fallback reuses this exact factory to fill missing seats — same deck
// shape, same name pool, same isBot/botName contract startMatch already
// knows how to drive (see startMatch/opponentDisplayName/runBotOpponentTurns
// below), so a pod's bot seats behave identically to a Quick Match bot.
export function createBotOpponent(autoPlay) {
  const factions = Object.keys(HEROES_BY_FACTION);
  const faction = factions[Math.floor(Math.random() * factions.length)];
  return {
    ws: null,
    token: `bot-${crypto.randomUUID()}`,
    faction,
    deck: buildBotDeck(),
    autoPlay,
    isBot: true,
    botName: randomBotName(),
  };
}

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

// A deck is a { cardId: count } map, same shape as save.deck on the client
// (a single freeform deck, not split by faction — see store.js's deck
// rework, decks can mix any faction's cards freely now). Reject anything a
// legitimate deckbuilder couldn't produce rather than trusting the
// client's arithmetic. A player's chosen faction/hero (special ability +
// attribute track) is validated separately and has no bearing on which
// cards are legal in their deck.
const ALL_CARD_IDS = new Set(CARDS.map((c) => c.id));
export function validateDeck(deck) {
  if (!deck || typeof deck !== 'object') return false;
  let total = 0;
  for (const [cardId, count] of Object.entries(deck)) {
    if (!ALL_CARD_IDS.has(cardId)) return false;
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
    matchTimer: null,
    matchDeadline: null, // Date.now()-based timestamp, sent to clients so their own countdown survives reconnects/latency without needing to re-derive it
  };
  rooms.set(code, room);
  return room;
}

function attachPlayer(room, side, { ws, token, faction, deck, autoPlay, isBot, botName }) {
  room.players[side] = {
    ws,
    token,
    faction,
    deck,
    autoPlay: Boolean(autoPlay),
    isBot: Boolean(isBot),
    botName: botName || null,
    disconnectTimer: null,
  };
  // Bots have no real socket to reconnect, so skip tracking them for that —
  // their token is just a throwaway id, not worth indexing.
  if (ws) {
    wsToPlayer.set(ws, { code: room.code, side });
    tokenToRoom.set(token, room.code);
  }
}

function startMatch(room, { perkThreshold } = {}) {
  const p1 = room.players.p1;
  const p2 = room.players.p2;
  const heroP1 = findHero(p1.faction);
  const heroP2 = findHero(p2.faction);
  room.state = newGame(p1.deck, heroP1.id, p2.deck, heroP2.id, { perkThreshold });
  armMatchTimer(room);

  for (const side of ['p1', 'p2']) {
    const player = room.players[side];
    const opponent = room.players[otherSide(side)];
    send(player.ws, {
      type: 'matchStart',
      code: room.code,
      opponentFaction: opponent.faction,
      opponentName: opponentDisplayName(opponent),
      state: viewFor(room.state, side),
      matchDeadline: room.matchDeadline,
    });
  }
  // Fire-and-forget: newGame() always leaves p1 active, so if that side is
  // an Autodeckbuilder deck or the matchmaking bot fallback, its turn needs
  // to start driving itself right away instead of waiting on an action that
  // will never arrive.
  runAutoPlayTurns(room);
  runBotOpponentTurns(room);
}

// Whoever has more hero HP at the instant the match's time budget runs out
// wins; an exact tie is a coin flip (see MATCH_TIME_LIMIT_MS above for why
// this never resolves as a draw).
function timeoutWinner(state) {
  if (state.p1.hp === state.p2.hp) return Math.random() < 0.5 ? 'p1' : 'p2';
  return state.p1.hp > state.p2.hp ? 'p1' : 'p2';
}

function armMatchTimer(room) {
  clearTimeout(room.matchTimer);
  room.matchDeadline = Date.now() + MATCH_TIME_LIMIT_MS;
  room.matchTimer = setTimeout(() => {
    if (room.finished || !room.state || room.state.winner) return;
    endMatch(room, timeoutWinner(room.state));
  }, MATCH_TIME_LIMIT_MS);
  // A match that's abandoned without ever forfeiting (rare, but the disconnect
  // grace period + reconnect window means it can outlive a short test run)
  // shouldn't hold the Node process open on this timer alone.
  room.matchTimer.unref?.();
}

// Exported as displayNameFor: draftPods.js/tournamentPods.js reuse this to
// label pod seats in their own bracket-status broadcasts, not just the 1v1
// opponent nameplate this file sends via matchStart.
export function displayNameFor(player) {
  if (player.isBot) return player.botName;
  return getOrCreateAccount(player.token).username;
}
const opponentDisplayName = displayNameFor;

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
export function startDirectMatch(playerA, playerB, { perkThreshold, quickMatch = false, onFinished, onStarted } = {}) {
  const code = generateCode();
  const room = makeRoom(code, quickMatch);
  if (onFinished) room.onFinished = onFinished;
  attachPlayer(room, 'p1', playerA);
  attachPlayer(room, 'p2', playerB);
  startMatch(room, { perkThreshold });
  // Fires synchronously, once room.matchDeadline is set — lets a caller like
  // draftPods.js/tournamentPods.js attach this match's deadline onto its own
  // bracket-status broadcast, since the 2 pod seats not playing this match
  // have no other way to learn "how much time is left in the live round."
  if (onStarted) onStarted(room);
  return room;
}

export function createRoom({ ws, token, faction, deck, autoPlay }) {
  if (!validateDeck(deck)) return { error: 'Mazo inválido.' };
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
  if (!validateDeck(deck)) return { error: 'Mazo inválido.' };
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
    clearTimeout(a.botTimer);
    clearTimeout(b.botTimer);
    const code = generateCode();
    const room = makeRoom(code, true);
    attachPlayer(room, 'p1', a);
    attachPlayer(room, 'p2', b);
    startMatch(room);
    paired = true;
  }
}

// Fires QUICK_MATCH_BOT_TIMEOUT_MS after an entry joins the queue — if it's
// still waiting by then (no real opponent found), matches it against a bot
// standing in for one instead of leaving the player waiting indefinitely,
// since there's no offline vs-AI mode to fall back to anymore.
function matchWithBot(entry) {
  const idx = quickQueue.indexOf(entry);
  if (idx === -1) return; // already matched with a real player in the meantime
  quickQueue.splice(idx, 1);
  const bot = createBotOpponent(entry.autoPlay);
  const code = generateCode();
  const room = makeRoom(code, true);
  attachPlayer(room, 'p1', entry);
  attachPlayer(room, 'p2', bot);
  startMatch(room);
}

export function queueQuickMatch({ ws, token, faction, deck, autoPlay }) {
  if (!validateDeck(deck)) return { error: 'Mazo inválido.' };
  // Drop any stale queue entry for this token (e.g. a reconnect/retry).
  const existingIdx = quickQueue.findIndex((q) => q.token === token);
  if (existingIdx !== -1) {
    clearTimeout(quickQueue[existingIdx].botTimer);
    quickQueue.splice(existingIdx, 1);
  }

  const trophies = getOrCreateAccount(token).trophies || 0;
  const entry = { ws, token, faction, deck, autoPlay, trophies, queuedAt: Date.now(), botTimer: null };
  quickQueue.push(entry);
  pairFromQueue();
  // Pairing may have already matched this exact entry above — only tell the
  // caller they're queued (and start the bot-fallback timer) if they're
  // still waiting.
  if (quickQueue.includes(entry)) {
    send(ws, { type: 'queued' });
    entry.botTimer = setTimeout(() => matchWithBot(entry), QUICK_MATCH_BOT_TIMEOUT_MS);
  }
  return {};
}

export function cancelQuickMatch(ws) {
  const idx = quickQueue.findIndex((q) => q.ws === ws);
  if (idx !== -1) {
    clearTimeout(quickQueue[idx].botTimer);
    quickQueue.splice(idx, 1);
  }
}

function endMatch(room, winnerSide) {
  if (room.finished || !room.state) return;
  room.finished = true;
  clearTimeout(room.matchTimer);
  room.state.winner = winnerSide;
  for (const side of ['p1', 'p2']) {
    const player = room.players[side];
    if (!player) continue;
    // The bot fallback isn't a real account — recording its "results" would
    // just accumulate throwaway rows in the account store for no reason.
    let trophies = 0;
    let delta = 0;
    if (!player.isBot) {
      recordMatchResult(player.token, side === winnerSide);
      ({ trophies, delta } = applyMatchTrophies(player.token, side === winnerSide));
    }
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

// Drives the matchmaking bot fallback's turn (Modo Normal only — an
// Autodeckbuilder-mode bot instead gets autoPlay:true and is handled by
// runAutoPlayTurns above, same 1-card-per-turn logic a human's own
// Autodeckbuilder deck uses). Uses the full ai.js turn logic — deploy,
// spells, attacks, hero action — with a randomized pause before each step
// so the bot doesn't play out its whole turn instantly. Shares
// room.autoPlaying as its reentrancy guard with runAutoPlayTurns; safe
// because a given active side is never both autoPlay and isBot-non-auto at
// once, and both functions bail out synchronously (before any await) when
// it's not their kind of side to drive, so the guard is never left stuck.
async function runBotOpponentTurns(room) {
  if (room.autoPlaying) return;
  room.autoPlaying = true;
  try {
    while (!room.finished && room.state && !room.state.winner) {
      const side = room.state.active;
      const player = room.players[side];
      if (!player || !player.isBot || player.autoPlay) return;

      await sleep(randomDelay(BOT_STEP_DELAY_MIN_MS, BOT_STEP_DELAY_MAX_MS));
      for (const step of runAiTurnSteps(room.state, side)) {
        broadcastStep(room, step);
        if (room.state.winner) break;
        await sleep(randomDelay(BOT_STEP_DELAY_MIN_MS, BOT_STEP_DELAY_MAX_MS));
      }
      if (room.state.winner) {
        endMatch(room, room.state.winner);
        return;
      }
      const endStep = applyEndTurn(room.state);
      if (endStep) broadcastStep(room, endStep);
      await sleep(randomDelay(BOT_STEP_DELAY_MIN_MS, BOT_STEP_DELAY_MAX_MS));
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
      case 'replace':
        if (Number.isInteger(action.handIdx) && isLane(action.laneIndex) && ROWS.has(action.row)) {
          step = applyReplace(state, side, action.laneIndex, action.row, action.handIdx);
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
  else {
    // Whatever just happened may have handed the turn to an autoPlay side or
    // the matchmaking bot fallback (most commonly: this was an endTurn) —
    // both no-op immediately if the newly-active side isn't theirs to drive.
    runAutoPlayTurns(room);
    runBotOpponentTurns(room);
  }
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
  send(ws, {
    type: 'matchStart',
    code,
    opponentFaction: opponent.faction,
    opponentName: opponentDisplayName(opponent),
    state: viewFor(room.state, side),
    matchDeadline: room.matchDeadline,
    reconnected: true,
  });
  return true;
}

export function roomStats() {
  return { activeRooms: rooms.size, queued: quickQueue.length };
}

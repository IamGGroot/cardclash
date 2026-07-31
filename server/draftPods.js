// Draft pod lifecycle: 4 players queue, pack-and-pass through 3 boosters
// each (+ a free 16th neutral card), pick a hero, then play a 3-match
// bracket (two semis + a final) against their own pod using the exact same
// 1v1 engine as any other online match (via rooms.js's startDirectMatch —
// see that file for why the bracket doesn't need its own battle protocol).
// Parallel to server/rooms.js, not a modification of it.
import crypto from 'node:crypto';
import { getCard, HEROES } from '../src/cards.js';
import * as Draft from '../src/draft.js';
import { startDirectMatch, randomBotName, displayNameFor } from './rooms.js';
import { env } from './env.js';

const PICK_TIMER_MS = Number(env('DRAFT_PICK_TIMER_MS', String(Draft.PICK_TIMER_MS)));
const HERO_FACTIONS = new Set(HEROES.map((h) => h.faction));

// Same "wait a bit for real opponents, then fall back to bots" shape as
// Quick Match's QUICK_MATCH_BOT_TIMEOUT_MS in rooms.js — a lone (or
// short-handed) draft queue fills its remaining seats with bots instead of
// leaving the player waiting on 3 more strangers indefinitely.
const POD_BOT_TIMEOUT_MS = Number(env('DRAFT_POD_BOT_TIMEOUT_MS', '5000'));
// Bots "think" between picks like a real drafter skimming the pack, not an
// instant script — reuses the same randomized-delay feel as the Quick Match
// bot's BOT_STEP_DELAY_MIN_MS/MAX_MS in rooms.js.
const BOT_PICK_DELAY_MIN_MS = Number(env('BOT_PICK_DELAY_MIN_MS', '900'));
const BOT_PICK_DELAY_MAX_MS = Number(env('BOT_PICK_DELAY_MAX_MS', '2600'));

function randomDelay(min, max) {
  return min + Math.random() * (max - min);
}

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

const draftQueue = []; // [{ ws, token }]
const pods = new Map(); // podId -> pod
const wsToPod = new Map(); // ws -> { podId, seatIndex } — only while a pod is in the picking/heroPick phase
let draftQueueBotTimer = null;

function generatePodId() {
  return `pod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createDraftBotEntry() {
  return { ws: null, token: `bot-${crypto.randomUUID()}`, isBot: true, botName: randomBotName() };
}

// ---- Queue ----

export function queueDraftEntry({ ws, token }) {
  if (draftQueue.some((e) => e.token === token)) return {};
  draftQueue.push({ ws, token });
  if (draftQueue.length >= Draft.POD_SIZE) {
    clearTimeout(draftQueueBotTimer);
    draftQueueBotTimer = null;
    const entries = draftQueue.splice(0, Draft.POD_SIZE);
    startPod(entries);
  } else {
    send(ws, { type: 'draftQueued', waiting: draftQueue.length, needed: Draft.POD_SIZE });
    if (!draftQueueBotTimer) draftQueueBotTimer = setTimeout(fillDraftQueueWithBots, POD_BOT_TIMEOUT_MS);
  }
  return {};
}

// Fires POD_BOT_TIMEOUT_MS after the first entry joins an under-strength
// queue — pads it out to a full pod with bots instead of leaving 1-3 real
// players waiting indefinitely for strangers who may never show up.
function fillDraftQueueWithBots() {
  draftQueueBotTimer = null;
  if (draftQueue.length === 0) return; // everyone cancelled in the meantime
  const entries = draftQueue.splice(0, draftQueue.length);
  while (entries.length < Draft.POD_SIZE) entries.push(createDraftBotEntry());
  startPod(entries);
}

export function cancelDraftQueue(ws) {
  const idx = draftQueue.findIndex((e) => e.ws === ws);
  if (idx !== -1) draftQueue.splice(idx, 1);
  if (draftQueue.length === 0 && draftQueueBotTimer) {
    clearTimeout(draftQueueBotTimer);
    draftQueueBotTimer = null;
  }
}

// ---- Pod / picking ----

function startPod(entries) {
  const id = generatePodId();
  const seats = entries.map(({ ws, token, isBot, botName }) => ({
    ws,
    token,
    isBot: Boolean(isBot),
    botName: botName || null,
    picks: [], // card ids, in pick order — 15 drafted + 1 free bonus = 16
    currentPack: null, // card ids currently held by this seat, or null between packs
    doneDrafting: false,
    heroFaction: null,
    pickTimer: null,
    packQueue: [], // packs that arrived while this seat was still deciding on currentPack
  }));
  const pod = { id, seats, packRound: 0, seatsFinishedRound: 0, phase: 'picking', bracket: null };
  pods.set(id, pod);
  // Bots have no real socket — only real seats are worth indexing here.
  seats.forEach((seat, i) => {
    if (seat.ws) wsToPod.set(seat.ws, { podId: id, seatIndex: i });
  });
  startPackRound(pod);
  return pod;
}

function startPackRound(pod) {
  pod.seatsFinishedRound = 0;
  for (let i = 0; i < Draft.POD_SIZE; i++) {
    const seat = pod.seats[i];
    if (seat.doneDrafting) continue; // shouldn't happen (a round only starts if nobody's finished), defensive
    deliverPack(pod, i, Draft.openDraftPack().map((c) => c.id));
  }
}

// A seat can only actively decide on one pack at a time, but with 4 packs
// circulating at once it's entirely normal for a second (or third) one to
// arrive before this seat has finished its current one — queue it instead
// of clobbering currentPack, or those cards vanish and the seat can never
// reach its full pick count (the draft hangs forever waiting for it).
function deliverPack(pod, seatIndex, pack) {
  const seat = pod.seats[seatIndex];
  if (seat.currentPack) {
    seat.packQueue.push(pack);
    return;
  }
  seat.currentPack = pack;
  sendPackUpdate(pod, seatIndex);
  armPickTimer(pod, seatIndex);
}

// Called right after a seat finishes with its current pack (picked its last
// card from it, or passed the rest along) — pulls the next queued pack, if
// any, into active decision.
function activateNextPack(pod, seatIndex) {
  const seat = pod.seats[seatIndex];
  seat.currentPack = null;
  if (seat.packQueue.length === 0) return;
  deliverPack(pod, seatIndex, seat.packQueue.shift());
}

function sendPackUpdate(pod, seatIndex) {
  const seat = pod.seats[seatIndex];
  send(seat.ws, {
    type: 'draftUpdate',
    pack: seat.currentPack.map((id) => getCard(id)),
    pickCount: seat.picks.length,
    totalPicks: Draft.TOTAL_PICKS,
  });
}

// A bot seat "picks" through this exact same expiry path a slow human would
// hit — just with a short, randomized human-like delay instead of the full
// pick timer — so bot picking needs no separate code path at all.
function armPickTimer(pod, seatIndex) {
  const seat = pod.seats[seatIndex];
  clearTimeout(seat.pickTimer);
  const delay = seat.isBot ? randomDelay(BOT_PICK_DELAY_MIN_MS, BOT_PICK_DELAY_MAX_MS) : PICK_TIMER_MS;
  seat.pickTimer = setTimeout(() => {
    if (!seat.currentPack || seat.currentPack.length === 0) return;
    const randomId = seat.currentPack[Math.floor(Math.random() * seat.currentPack.length)];
    handlePick(pod, seatIndex, randomId);
  }, delay);
}

export function handleDraftPick(ws, cardId) {
  const entry = wsToPod.get(ws);
  if (!entry) return;
  const pod = pods.get(entry.podId);
  if (!pod || pod.phase !== 'picking') return;
  const seat = pod.seats[entry.seatIndex];
  if (!seat.currentPack || !seat.currentPack.includes(cardId)) return;
  handlePick(pod, entry.seatIndex, cardId);
}

function handlePick(pod, seatIndex, cardId) {
  const seat = pod.seats[seatIndex];
  clearTimeout(seat.pickTimer);
  const pack = seat.currentPack;
  const idx = pack.indexOf(cardId);
  if (idx === -1) return;
  pack.splice(idx, 1);
  seat.picks.push(cardId);
  // Confirms this exact pick to the seat that made it, whether it was a
  // manual click or the timer's random auto-pick — the client's collection
  // is entirely client-trusted (same as every other card source in this
  // app), so it needs to be told explicitly what landed either way instead
  // of only ever finding out for picks it made deliberately.
  send(seat.ws, { type: 'draftPickConfirmed', card: getCard(cardId), pickCount: seat.picks.length });

  if (seat.picks.length === Draft.TOTAL_PICKS) {
    // 15th main pick just landed — immediately draw the free 16th
    // (Gremio Errante) card, same moment the client shows the reveal.
    const bonus = Draft.drawBonusNeutralCard();
    seat.picks.push(bonus.id);
    seat.doneDrafting = true;
    seat.currentPack = null;
    seat.packQueue = []; // any packs still queued for this seat are simply skipped for them from here on
    send(seat.ws, { type: 'draftBonusCard', card: bonus, picks: seat.picks.map((id) => getCard(id)) });
    if (seat.isBot) {
      const factions = [...HERO_FACTIONS];
      const faction = factions[Math.floor(Math.random() * factions.length)];
      setTimeout(() => applyHeroPick(pod.id, seatIndex, faction), randomDelay(BOT_PICK_DELAY_MIN_MS, BOT_PICK_DELAY_MAX_MS));
    }
    if (pod.seats.every((s) => s.doneDrafting)) pod.phase = 'heroPick';
    return;
  }

  if (pack.length > 0) {
    const nextSeat = Draft.nextPackAssignment(seatIndex, pod.packRound, Draft.POD_SIZE);
    deliverPack(pod, nextSeat, pack);
    activateNextPack(pod, seatIndex);
    return;
  }

  // This pack (one of the POD_SIZE circulating this round) is spent. Null
  // this out *now* — an empty array is still truthy, so leaving the stale
  // reference in place would make the next deliverPack (from startPackRound
  // below) think this seat is still busy and queue the fresh pack instead
  // of handing it over, stranding the seat with nothing active.
  seat.currentPack = null;
  pod.seatsFinishedRound += 1;
  if (pod.seatsFinishedRound === Draft.POD_SIZE) {
    pod.packRound += 1;
    if (pod.packRound < Draft.PACKS_PER_PLAYER) {
      // Reassigns every not-yet-done seat (including this one) a fresh
      // pack directly — activateNextPack below must NOT also run for
      // seatIndex, or it would immediately null out what this just set.
      startPackRound(pod);
      return;
    }
  }
  activateNextPack(pod, seatIndex);
}

// ---- Hero pick ----

export function handleDraftHeroPick(ws, faction) {
  const entry = wsToPod.get(ws);
  if (!entry) return;
  applyHeroPick(entry.podId, entry.seatIndex, faction);
}

function applyHeroPick(podId, seatIndex, faction) {
  const pod = pods.get(podId);
  if (!pod) return;
  const seat = pod.seats[seatIndex];
  if (!seat.doneDrafting || seat.heroFaction || !HERO_FACTIONS.has(faction)) return;
  seat.heroFaction = faction;
  if (pod.seats.every((s) => s.heroFaction)) startBracket(pod);
}

// ---- Bracket ----

function deckFromPicks(picks) {
  const deck = {};
  for (const id of picks) deck[id] = (deck[id] || 0) + 1;
  return deck;
}

function seatToRoomPlayer(pod, seatIndex) {
  const seat = pod.seats[seatIndex];
  return {
    ws: seat.ws,
    token: seat.token,
    faction: seat.heroFaction,
    deck: deckFromPicks(seat.picks),
    autoPlay: false,
    isBot: seat.isBot,
    botName: seat.botName,
  };
}

// `bracketEntry` is the exact semis[i]/final object this match corresponds
// to — stamping its deadline directly (rather than searching pod.bracket by
// seat pair) means it works identically for both semis and the final.
function startBracketMatch(pod, seatA, seatB, bracketEntry, onDone) {
  startDirectMatch(seatToRoomPlayer(pod, seatA), seatToRoomPlayer(pod, seatB), {
    perkThreshold: Draft.DRAFT_PERK_THRESHOLD,
    onStarted: (room) => {
      bracketEntry.deadline = room.matchDeadline;
      broadcastBracket(pod);
    },
    onFinished: (winnerSide) => {
      const winnerSeat = winnerSide === 'p1' ? seatA : seatB;
      const loserSeat = winnerSide === 'p1' ? seatB : seatA;
      onDone(winnerSeat, loserSeat);
    },
  });
}

function awardPrize(pod, seatIndex, prize) {
  send(pod.seats[seatIndex].ws, { type: 'draftPrize', prize });
}

// Broadcasts the pod's whole bracket shape/progress to every seat (real ws
// only — send() no-ops for bots) — drives the client's floating
// bracket-status button + subscreen, since the 2 seats not currently in a
// live match otherwise have no visibility into what's happening in their pod.
function broadcastBracket(pod) {
  const payload = {
    type: 'draftBracketUpdate',
    seats: pod.seats.map((seat) => ({ name: displayNameFor(seat), isBot: seat.isBot })),
    semis: pod.bracket.semis,
    final: pod.bracket.final,
  };
  for (const seat of pod.seats) send(seat.ws, payload);
}

function startBracket(pod) {
  pod.phase = 'bracket';
  // No more draft-phase messages expected from these seats — the bracket's
  // matches register their own wsToPlayer entries in rooms.js independently.
  for (const seat of pod.seats) wsToPod.delete(seat.ws);

  const { semis } = Draft.seedBracket([0, 1, 2, 3]);
  pod.bracket = { semis: semis.map(([i, j]) => ({ players: [i, j], winner: null })), final: null };
  broadcastBracket(pod);

  const semiResults = [null, null];
  semis.forEach(([i, j], semiIndex) => {
    startBracketMatch(pod, i, j, pod.bracket.semis[semiIndex], (winnerSeat, loserSeat) => {
      semiResults[semiIndex] = { winner: winnerSeat, loser: loserSeat };
      pod.bracket.semis[semiIndex].winner = winnerSeat;
      awardPrize(pod, loserSeat, { commonCard: Draft.drawRandomCommonCard() });
      if (semiResults.every((r) => r)) {
        pod.bracket.final = { players: [semiResults[0].winner, semiResults[1].winner], winner: null };
      }
      broadcastBracket(pod);
      if (semiResults.every((r) => r)) {
        startBracketMatch(pod, semiResults[0].winner, semiResults[1].winner, pod.bracket.final, (finalWinner, finalLoser) => {
          pod.bracket.final.winner = finalWinner;
          awardPrize(pod, finalWinner, { packs: ['gem_pack', 'coin_pack'] });
          awardPrize(pod, finalLoser, { packs: ['coin_pack'] });
          broadcastBracket(pod);
          pod.phase = 'done';
          pods.delete(pod.id);
        });
      }
    });
  });
}

// ---- Disconnect ----

// No special mid-draft recovery: a disconnected seat's picks keep landing
// via the same random-autopick timer path a slow-but-connected seat would
// hit, and once in the bracket, rooms.js's own handleDisconnect (registered
// independently per bracket match via startDirectMatch/attachPlayer)
// already covers it. This just stops queueing someone who left.
export function handleDraftDisconnect(ws) {
  cancelDraftQueue(ws);
}

export function draftStats() {
  return { draftQueued: draftQueue.length, draftPods: pods.size };
}

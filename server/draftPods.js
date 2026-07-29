// Draft pod lifecycle: 4 players queue, pack-and-pass through 3 boosters
// each (+ a free 16th neutral card), pick a hero, then play a 3-match
// bracket (two semis + a final) against their own pod using the exact same
// 1v1 engine as any other online match (via rooms.js's startDirectMatch —
// see that file for why the bracket doesn't need its own battle protocol).
// Parallel to server/rooms.js, not a modification of it.
import { getCard, HEROES } from '../src/cards.js';
import * as Draft from '../src/draft.js';
import { startDirectMatch } from './rooms.js';
import { env } from './env.js';

const PICK_TIMER_MS = Number(env('DRAFT_PICK_TIMER_MS', String(Draft.PICK_TIMER_MS)));
const HERO_FACTIONS = new Set(HEROES.map((h) => h.faction));

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

const draftQueue = []; // [{ ws, token }]
const pods = new Map(); // podId -> pod
const wsToPod = new Map(); // ws -> { podId, seatIndex } — only while a pod is in the picking/heroPick phase

function generatePodId() {
  return `pod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Queue ----

export function queueDraftEntry({ ws, token }) {
  if (draftQueue.some((e) => e.token === token)) return {};
  draftQueue.push({ ws, token });
  if (draftQueue.length >= Draft.POD_SIZE) {
    const entries = draftQueue.splice(0, Draft.POD_SIZE);
    startPod(entries);
  } else {
    send(ws, { type: 'draftQueued', waiting: draftQueue.length, needed: Draft.POD_SIZE });
  }
  return {};
}

export function cancelDraftQueue(ws) {
  const idx = draftQueue.findIndex((e) => e.ws === ws);
  if (idx !== -1) draftQueue.splice(idx, 1);
}

// ---- Pod / picking ----

function startPod(entries) {
  const id = generatePodId();
  const seats = entries.map(({ ws, token }) => ({
    ws,
    token,
    picks: [], // card ids, in pick order — 15 drafted + 1 free bonus = 16
    currentPack: null, // card ids currently held by this seat, or null between packs
    doneDrafting: false,
    heroFaction: null,
    pickTimer: null,
    packQueue: [], // packs that arrived while this seat was still deciding on currentPack
  }));
  const pod = { id, seats, packRound: 0, seatsFinishedRound: 0, phase: 'picking' };
  pods.set(id, pod);
  seats.forEach((seat, i) => wsToPod.set(seat.ws, { podId: id, seatIndex: i }));
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

function armPickTimer(pod, seatIndex) {
  const seat = pod.seats[seatIndex];
  clearTimeout(seat.pickTimer);
  seat.pickTimer = setTimeout(() => {
    if (!seat.currentPack || seat.currentPack.length === 0) return;
    const randomId = seat.currentPack[Math.floor(Math.random() * seat.currentPack.length)];
    handlePick(pod, seatIndex, randomId);
  }, PICK_TIMER_MS);
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
  const pod = pods.get(entry.podId);
  if (!pod) return;
  const seat = pod.seats[entry.seatIndex];
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
  return { ws: seat.ws, token: seat.token, faction: seat.heroFaction, deck: deckFromPicks(seat.picks), autoPlay: false };
}

function startBracketMatch(pod, seatA, seatB, onDone) {
  startDirectMatch(seatToRoomPlayer(pod, seatA), seatToRoomPlayer(pod, seatB), {
    perkThreshold: Draft.DRAFT_PERK_THRESHOLD,
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

function startBracket(pod) {
  pod.phase = 'bracket';
  // No more draft-phase messages expected from these seats — the bracket's
  // matches register their own wsToPlayer entries in rooms.js independently.
  for (const seat of pod.seats) wsToPod.delete(seat.ws);

  const { semis } = Draft.seedBracket([0, 1, 2, 3]);
  const semiResults = [null, null];
  semis.forEach(([i, j], semiIndex) => {
    startBracketMatch(pod, i, j, (winnerSeat, loserSeat) => {
      semiResults[semiIndex] = { winner: winnerSeat, loser: loserSeat };
      awardPrize(pod, loserSeat, { commonCard: Draft.drawRandomCommonCard() });
      if (semiResults.every((r) => r)) {
        startBracketMatch(pod, semiResults[0].winner, semiResults[1].winner, (finalWinner, finalLoser) => {
          awardPrize(pod, finalWinner, { packs: ['gem_pack', 'coin_pack'] });
          awardPrize(pod, finalLoser, { packs: ['coin_pack'] });
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

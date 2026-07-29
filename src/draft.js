// Draft mode: 4 players pack-and-pass through 3 five-card boosters, get one
// free 16th card from the neutral Gremio Errante pool, pick a hero, then
// play a 3-match bracket (two semis + a final) against their own pod.
// Shared by both the server (server/draftPods.js, authoritative) and the
// client (src/ui.js, thin renderer of whatever the server broadcasts) —
// same convention as src/battle.js/src/ladder.js: everything here must stay
// pure/DOM-free.
import { CARDS, cardsForFaction } from './cards.js';
import { WEIGHTS_GEM, weightedPick } from './economy.js';

export const PACK_SIZE = 5;
export const PACKS_PER_PLAYER = 3;
export const POD_SIZE = 4;
export const TOTAL_PICKS = PACK_SIZE * PACKS_PER_PLAYER; // 15 — the 16th is the free bonus card, not a pick
export const PICK_TIMER_MS = 20000;
export const DRAFT_ENTRY_SKU = { id: 'draft_entry', label: 'Entrada a Draft', priceLabel: '$3.99' };
// vs. the normal 4 — see factionPerks.js's state.perkThreshold.
export const DRAFT_PERK_THRESHOLD = 2;

function randomFrom(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

// One 5-card pack pulled from the *entire* card pool (all factions +
// neutral) — draft deliberately isn't faction-locked, same as a real Magic
// draft isn't color-locked. Reuses economy.js's Sobre Premium rarity
// distribution since it's the same size/tier. Returns full card objects
// (same shape as economy.js's openPack), not bare ids.
export function openDraftPack() {
  const results = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    const rarity = weightedPick(WEIGHTS_GEM);
    const pool = CARDS.filter((c) => c.rarity === rarity);
    results.push(randomFrom(pool));
  }
  return results;
}

// The free 16th card, drawn once a player's 15 main picks are done — always
// from the Gremio Errante (neutral) pool, flat random (no rarity weighting
// requested for this one).
export function drawBonusNeutralCard() {
  return randomFrom(cardsForFaction('neutral'));
}

// 3rd/4th place consolation prize — a random common card from anywhere.
export function drawRandomCommonCard() {
  return randomFrom(CARDS.filter((c) => c.rarity === 'common'));
}

// Which seat receives the pack a given seat just picked from, for a pack
// currently on round `round` (0-indexed: round 0 is everyone's first
// pack). Alternates direction by round, same as a real Magic draft with an
// odd pack count (round 0 passes left, round 1 passes right, round 2 passes
// left) — so nobody ever sees the exact same pack pass order twice.
export function nextPackAssignment(seatIndex, round, podSize = POD_SIZE) {
  const direction = round % 2 === 0 ? 1 : -1;
  return (seatIndex + direction + podSize) % podSize;
}

// [seat0, seat1, seat2, seat3] (queue-arrival order) -> semifinal pairs.
// Seat 0 (first to queue) plays the last to queue, seat 1 plays seat 2 —
// arbitrary but deterministic, there's no prior ranking to seed by.
export function seedBracket(seatOrder) {
  const [a, b, c, d] = seatOrder;
  return { semis: [[a, d], [b, c]] };
}

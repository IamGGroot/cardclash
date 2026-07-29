// Shared 4-player bracket helpers — used by both src/draft.js (Draft mode)
// and src/tournament.js (Torneo mode), since both play the same "2 semis +
// a final" format and award the same shape of consolation prize to
// whoever's eliminated in the semis. Pure/DOM-free, same convention as
// src/battle.js.
import { CARDS } from './cards.js';

export const POD_SIZE = 4;

function randomFrom(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

// [seat0, seat1, seat2, seat3] (queue-arrival order) -> semifinal pairs.
// Seat 0 (first to queue) plays the last to queue, seat 1 plays seat 2 —
// arbitrary but deterministic, there's no prior ranking to seed by.
export function seedBracket(seatOrder) {
  const [a, b, c, d] = seatOrder;
  return { semis: [[a, d], [b, c]] };
}

// 3rd/4th place consolation prize — a random common card from anywhere.
export function drawRandomCommonCard() {
  return randomFrom(CARDS.filter((c) => c.rarity === 'common'));
}

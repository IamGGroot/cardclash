import { CARDS, cardsForFaction, getCard } from './cards.js';

const SAVE_KEY = 'cardclash_save_v2';
const MAX_COPIES = 2;
const DECK_SIZE = 16; // = 8 unique cards per faction × 2 copies

// Disenchanting a copy grants dust; crafting a copy spends it. Crafting costs
// noticeably more than disenchanting gives back, so dust closes the "stuck
// with duplicates" loop without making a specific card trivially free.
const DUST_VALUE = { common: 5, rare: 15, epic: 40, legendary: 100 };
const CRAFT_COST = { common: 25, rare: 100, epic: 300, legendary: 800 };

// A new player owns just enough to field one full, curve-complete deck per
// playable faction. Every other card (extra spells/fortunes plus the whole
// neutral pool) has to be pulled from packs, so the pack/gem economy has
// something to unlock instead of everyone starting with the full collection.
const STARTER_CARD_IDS = [
  'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8',
  'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8',
  'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8',
  't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8',
];

function emptyCollection() {
  const collection = {};
  for (const card of CARDS) collection[card.id] = 0;
  return collection;
}

function autoDeckFrom(collection, faction) {
  const deck = {};
  let total = 0;
  for (const card of cardsForFaction(faction)) {
    if (total >= DECK_SIZE) break;
    const owned = collection[card.id] || 0;
    const take = Math.min(owned, MAX_COPIES, DECK_SIZE - total);
    if (take > 0) {
      deck[card.id] = take;
      total += take;
    }
  }
  return deck;
}

// A brand-new save owns nothing yet — the onboarding faction-pick screen
// (src/ui.js renderFactionPick) is what actually grants a starter deck, via
// grantStarterDeck() below, right after the player chooses. This keeps
// "installing the app" and "choosing your faction" as two separate,
// inspectable steps instead of baking a choice into freshSave() itself.
//
// `deck`/`autoDeck` are each a single freeform { cardId: count } map — deck
// building isn't mono-faction anymore (any owned card can go in either
// deck), so there's exactly one Normal deck and one Autodeckbuilder deck
// per player, not one of each per faction.
function freshSave() {
  return {
    coins: 300,
    gems: 50,
    dust: 0,
    collection: emptyCollection(),
    deck: {},
    autoDeck: {},
  };
}

// Grants the 8 unique starter cards (2 copies each = DECK_SIZE) for one
// chosen faction and immediately builds the starting deck from them —
// called once, right after the player picks their starting faction. The
// deck is freeform from here on; this just seeds it single-faction since
// that's all the player owns yet.
export function grantStarterDeck(state, faction) {
  for (const id of STARTER_CARD_IDS) {
    if (getCard(id).faction !== faction) continue;
    state.collection[id] = MAX_COPIES;
  }
  state.deck = autoDeckFrom(state.collection, faction);
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return freshSave();
    const parsed = JSON.parse(raw);
    if (!parsed.collection) return freshSave();
    if (typeof parsed.dust !== 'number') parsed.dust = 0;
    // Backfill cards/factions added since this save was created, so they
    // show up (locked, same as any other unpulled card) instead of being
    // silently missing from the collection/deckbuilder.
    for (const card of CARDS) {
      if (!(card.id in parsed.collection)) parsed.collection[card.id] = 0;
    }
    // Migrate the old one-deck-per-faction save shape (save.decks[faction])
    // into the new single freeform deck — keep whichever faction deck was
    // actually selected to play, falling back to the first non-empty one.
    if (!parsed.deck) {
      const legacy = parsed.decks || {};
      parsed.deck = { ...(legacy[parsed.selectedFaction] || Object.values(legacy).find((d) => Object.keys(d).length) || {}) };
    }
    if (!parsed.autoDeck) {
      const legacy = parsed.autoDecks || {};
      parsed.autoDeck = { ...(legacy[parsed.selectedAutoFaction] || Object.values(legacy).find((d) => Object.keys(d).length) || {}) };
    }
    delete parsed.decks;
    delete parsed.autoDecks;
    return parsed;
  } catch {
    return freshSave();
  }
}

export function save(state) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

// Used by the "delete account" flow — wipes local game progress so a
// reload starts fully fresh (onboarding, empty collection) instead of
// keeping cards/decks tied to a server account that no longer exists.
export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

export function addCardsToCollection(state, cards) {
  for (const card of cards) {
    state.collection[card.id] = (state.collection[card.id] || 0) + 1;
  }
}

// deckKey selects which deck to read/write — 'deck' (default, the normal
// manually-played deck) or 'autoDeck' (the Autodeckbuilder deck, same
// collection, same 16-card/MAX_COPIES rules, just a separate build). Either
// deck can freely mix cards from any faction plus neutral.
export function deckCount(state, deckKey = 'deck') {
  return Object.values(state[deckKey] || {}).reduce((a, b) => a + b, 0);
}

export function canAddToDeck(state, cardId, deckKey = 'deck') {
  const deck = state[deckKey];
  const inDeck = deck[cardId] || 0;
  const owned = state.collection[cardId] || 0;
  return inDeck < owned && inDeck < MAX_COPIES && deckCount(state, deckKey) < DECK_SIZE;
}

export function addToDeck(state, cardId, deckKey = 'deck') {
  if (!canAddToDeck(state, cardId, deckKey)) return false;
  const deck = state[deckKey];
  deck[cardId] = (deck[cardId] || 0) + 1;
  return true;
}

export function removeFromDeck(state, cardId, deckKey = 'deck') {
  const deck = state[deckKey];
  const inDeck = deck[cardId] || 0;
  if (inDeck <= 0) return false;
  deck[cardId] = inDeck - 1;
  if (deck[cardId] === 0) delete deck[cardId];
  return true;
}

// Every faction (+neutral) present in a deck, with how many cards of each —
// used to remind players in the deckbuilder which factions are close to the
// 4-creature perk threshold (see src/factionPerks.js).
export function deckFactionBreakdown(deck) {
  const counts = {};
  for (const [cardId, count] of Object.entries(deck)) {
    const card = getCard(cardId);
    if (!card) continue;
    counts[card.faction] = (counts[card.faction] || 0) + count;
  }
  return counts;
}

export function disenchant(state, cardId) {
  const owned = state.collection[cardId] || 0;
  if (owned <= 0) return { ok: false };
  const card = getCard(cardId);
  const value = DUST_VALUE[card.rarity] || 0;
  state.collection[cardId] = owned - 1;
  state.dust = (state.dust || 0) + value;
  // Keep both decks that referenced this card in sync with the new copy
  // count.
  for (const deckKey of ['deck', 'autoDeck']) {
    const deck = state[deckKey];
    if (deck && (deck[cardId] || 0) > state.collection[cardId]) {
      deck[cardId] = state.collection[cardId];
      if (deck[cardId] === 0) delete deck[cardId];
    }
  }
  return { ok: true, dustGained: value };
}

// Bulk-disenchants every copy beyond MAX_COPIES for every owned card — decks
// never use more than MAX_COPIES anyway, so anything past that is pure pack-
// pull overflow sitting idle. Reuses disenchant() per excess copy so the
// dust value lookup and deck-sync guard stay in one place.
export function disenchantExcess(state) {
  let totalDust = 0;
  let cardsAffected = 0;
  for (const card of CARDS) {
    const owned = state.collection[card.id] || 0;
    const excess = owned - MAX_COPIES;
    if (excess <= 0) continue;
    cardsAffected += 1;
    for (let i = 0; i < excess; i++) {
      const res = disenchant(state, card.id);
      if (res.ok) totalDust += res.dustGained;
    }
  }
  return { totalDust, cardsAffected };
}

export function craft(state, cardId) {
  const card = getCard(cardId);
  const cost = CRAFT_COST[card.rarity] || 0;
  if ((state.dust || 0) < cost) return { ok: false, reason: 'dust' };
  state.dust -= cost;
  state.collection[cardId] = (state.collection[cardId] || 0) + 1;
  return { ok: true };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Same 16-card cap the player is held to, so matches stay fair — a random
// 8 unique cards (2 copies each) from the WHOLE card pool each time
// (unrestricted by faction, matching the fact that a real player's deck can
// freely mix factions now too). Used only for the matchmaking bot fallback
// (src/net.js quick-match) impersonating a real opponent.
export function buildAiDeck() {
  const pool = shuffle(CARDS);
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

// Replaces the deck entirely with a random legal build from cards the
// player actually owns, any faction mix — unlike buildAiDeck, which assumes
// an unlimited card pool, this respects owned copy counts, so a thin
// collection just yields a smaller-than-16 deck rather than pulling cards
// out of nowhere.
export function autoBuildDeck(state, deckKey = 'deck') {
  const pool = shuffle(CARDS);
  const deck = {};
  let total = 0;
  for (const card of pool) {
    if (total >= DECK_SIZE) break;
    const owned = state.collection[card.id] || 0;
    if (owned <= 0) continue;
    const take = Math.min(owned, MAX_COPIES, DECK_SIZE - total);
    deck[card.id] = take;
    total += take;
  }
  state[deckKey] = deck;
  return deck;
}

export const CONSTANTS = { MAX_COPIES, DECK_SIZE, DUST_VALUE, CRAFT_COST };

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// store.js's load()/save() talk to the browser's localStorage — Node has no
// such global, so we provide a tiny in-memory stand-in before importing it.
// (store.js only touches localStorage inside function bodies, never at
// module load time, so this only needs to exist before those are called.)
class MemoryStorage {
  #data = new Map();
  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null;
  }
  setItem(key, value) {
    this.#data.set(key, String(value));
  }
  removeItem(key) {
    this.#data.delete(key);
  }
  clear() {
    this.#data.clear();
  }
}
globalThis.localStorage = new MemoryStorage();

const Store = await import('../src/store.js');
const { CARDS, FACTIONS } = await import('../src/cards.js');

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('load / freshSave', () => {
  test('a fresh save owns nothing and has no deck yet — onboarding grants the starter deck', () => {
    const save = Store.load();
    assert.equal(save.coins, 300);
    assert.equal(save.gems, 50);
    assert.equal(save.dust, 0);
    assert.equal(Store.deckCount(save, 'deck'), 0);
    assert.equal(Store.deckCount(save, 'autoDeck'), 0);
    const ownedCount = CARDS.filter((c) => (save.collection[c.id] || 0) > 0).length;
    assert.equal(ownedCount, 0, 'a fresh save owns no cards until onboarding grants a starter deck');
  });

  test('persists across a save/load round trip', () => {
    const save = Store.load();
    save.coins = 12345;
    Store.save(save);
    const reloaded = Store.load();
    assert.equal(reloaded.coins, 12345);
  });

  test('backfills any card missing from an older save as locked (owned 0), not free', () => {
    const staleSave = {
      coins: 100,
      gems: 20,
      dust: 0,
      collection: { a1: 2 }, // deliberately missing every other known card id
      deck: { a1: 2 },
    };
    globalThis.localStorage.setItem('cardclash_save_v2', JSON.stringify(staleSave));
    const loaded = Store.load();
    assert.equal(loaded.collection.a1, 2, 'existing ownership must be preserved');
    for (const card of CARDS) {
      assert.ok(card.id in loaded.collection, `${card.id} should have been backfilled`);
    }
    assert.equal(loaded.collection.a11, 0, 'a newly-added card must backfill as locked, not owned');
  });

  test('migrates a legacy per-faction save (save.decks[faction]) into the single freeform deck', () => {
    const staleSave = {
      coins: 0,
      gems: 0,
      dust: 0,
      collection: {},
      decks: { albura: { a1: 2 }, ignara: {} },
      autoDecks: { terra: { t1: 2 } },
      selectedFaction: 'albura',
      selectedAutoFaction: 'terra',
    };
    globalThis.localStorage.setItem('cardclash_save_v2', JSON.stringify(staleSave));
    const loaded = Store.load();
    assert.deepEqual(loaded.deck, { a1: 2 }, 'must migrate the selected faction\'s deck, not just any faction\'s');
    assert.deepEqual(loaded.autoDeck, { t1: 2 });
    assert.equal('decks' in loaded, false, 'legacy per-faction bucket must not linger in the migrated save');
    assert.equal('autoDecks' in loaded, false);
  });

  test('corrupt localStorage falls back to a fresh save instead of throwing', () => {
    globalThis.localStorage.setItem('cardclash_save_v2', '{not valid json');
    assert.doesNotThrow(() => Store.load());
    assert.equal(Store.load().coins, 300);
  });
});

describe('grantStarterDeck', () => {
  test('grants a legal, full 16-card deck for the chosen faction only', () => {
    const save = Store.load();
    Store.grantStarterDeck(save, 'ignara');
    assert.equal(Store.deckCount(save, 'deck'), Store.CONSTANTS.DECK_SIZE);
    for (const card of CARDS) {
      if (card.faction === 'ignara') continue;
      assert.equal(save.collection[card.id] || 0, 0, `${card.id} (${card.faction}) must not be granted by choosing ignara`);
    }
  });

  test('is idempotent — choosing the same faction again does not exceed MAX_COPIES', () => {
    const save = Store.load();
    Store.grantStarterDeck(save, 'terra');
    Store.grantStarterDeck(save, 'terra');
    for (const card of CARDS.filter((c) => c.faction === 'terra')) {
      assert.ok((save.collection[card.id] || 0) <= Store.CONSTANTS.MAX_COPIES);
    }
    assert.equal(Store.deckCount(save, 'deck'), Store.CONSTANTS.DECK_SIZE);
  });
});

describe('deck management (freeform — any faction mix)', () => {
  function bareSave() {
    return { coins: 0, gems: 0, dust: 0, collection: { a1: 2, a2: 1, t1: 1 }, deck: {} };
  }

  test('canAddToDeck requires an owned, uncapped copy and room in the deck', () => {
    const save = bareSave();
    assert.equal(Store.canAddToDeck(save, 'a1'), true);
    assert.equal(Store.canAddToDeck(save, 'a3'), false, 'a3 is not owned at all');
  });

  test('a deck can freely mix cards from different factions', () => {
    const save = bareSave();
    assert.equal(Store.addToDeck(save, 'a1'), true);
    assert.equal(Store.addToDeck(save, 't1'), true);
    assert.deepEqual(save.deck, { a1: 1, t1: 1 });
  });

  test('addToDeck cannot exceed MAX_COPIES even if more are owned', () => {
    const save = bareSave();
    assert.equal(Store.addToDeck(save, 'a1'), true);
    assert.equal(Store.addToDeck(save, 'a1'), true);
    assert.equal(Store.addToDeck(save, 'a1'), false, 'a third copy exceeds MAX_COPIES');
    assert.equal(save.deck.a1, Store.CONSTANTS.MAX_COPIES);
  });

  test('addToDeck cannot exceed copies actually owned', () => {
    const save = bareSave();
    Store.addToDeck(save, 'a2'); // only 1 owned
    const res = Store.addToDeck(save, 'a2');
    assert.equal(res, false);
    assert.equal(save.deck.a2, 1);
  });

  test('removeFromDeck decrements and deletes the entry once it hits zero', () => {
    const save = bareSave();
    Store.addToDeck(save, 'a1');
    Store.removeFromDeck(save, 'a1');
    assert.equal('a1' in save.deck, false);
  });

  test('removeFromDeck on a card not in the deck is a safe no-op', () => {
    const save = bareSave();
    assert.equal(Store.removeFromDeck(save, 'a1'), false);
  });

  test('deckCount sums all copies across the whole deck', () => {
    const save = bareSave();
    Store.addToDeck(save, 'a1');
    Store.addToDeck(save, 'a1');
    Store.addToDeck(save, 't1');
    assert.equal(Store.deckCount(save), 3);
  });

  test('a deck cannot exceed DECK_SIZE total copies even across many factions', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: {}, deck: {} };
    for (const card of CARDS) save.collection[card.id] = 2;
    for (const card of CARDS) {
      Store.addToDeck(save, card.id);
      Store.addToDeck(save, card.id);
    }
    assert.equal(Store.deckCount(save), Store.CONSTANTS.DECK_SIZE);
  });

  test('the autoDeck is a separate deck from the normal deck', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: { a1: 2 }, deck: {}, autoDeck: {} };
    Store.addToDeck(save, 'a1', 'deck');
    assert.equal(Store.deckCount(save, 'deck'), 1);
    assert.equal(Store.deckCount(save, 'autoDeck'), 0);
  });
});

describe('deckFactionBreakdown', () => {
  test('tallies how many cards of each faction are in a deck', () => {
    const breakdown = Store.deckFactionBreakdown({ a1: 2, t1: 1, n1: 1 });
    assert.equal(breakdown.albura, 2);
    assert.equal(breakdown.terra, 1);
    assert.equal(breakdown.neutral, 1);
  });

  test('an empty deck has an empty breakdown', () => {
    assert.deepEqual(Store.deckFactionBreakdown({}), {});
  });
});

describe('addCardsToCollection', () => {
  test('increments existing counts and creates new ones', () => {
    const save = { collection: { a1: 1 } };
    Store.addCardsToCollection(save, [{ id: 'a1' }, { id: 'a2' }]);
    assert.equal(save.collection.a1, 2);
    assert.equal(save.collection.a2, 1);
  });
});

describe('dust: disenchant / craft', () => {
  test('disenchanting a copy grants dust scaled by rarity and decrements the count', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: { a1: 2 }, deck: {} }; // a1 is common
    const res = Store.disenchant(save, 'a1');
    assert.equal(res.ok, true);
    assert.equal(res.dustGained, Store.CONSTANTS.DUST_VALUE.common);
    assert.equal(save.collection.a1, 1);
    assert.equal(save.dust, Store.CONSTANTS.DUST_VALUE.common);
  });

  test('cannot disenchant a card you do not own', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: {}, deck: {} };
    const res = Store.disenchant(save, 'a1');
    assert.equal(res.ok, false);
    assert.equal(save.dust, 0);
  });

  test('disenchanting below what a deck references trims that deck back into a legal state', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: { a1: 2 }, deck: { a1: 2 } };
    Store.disenchant(save, 'a1');
    assert.equal(save.deck.a1, 1, 'deck copy count must never exceed owned copies');
    Store.disenchant(save, 'a1');
    assert.equal('a1' in save.deck, false, 'a fully-disenchanted card is removed from the deck entirely');
  });

  test('crafting spends dust and grants a copy, gated by rarity cost', () => {
    const save = { coins: 0, gems: 0, dust: Store.CONSTANTS.CRAFT_COST.common, collection: {}, deck: {} };
    const res = Store.craft(save, 'a1');
    assert.equal(res.ok, true);
    assert.equal(save.dust, 0);
    assert.equal(save.collection.a1, 1);
  });

  test('crafting fails gracefully with insufficient dust and spends nothing', () => {
    const save = { coins: 0, gems: 0, dust: 1, collection: {}, deck: {} };
    const res = Store.craft(save, 'a11'); // legendary, expensive
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'dust');
    assert.equal(save.dust, 1);
    assert.equal(save.collection.a11 ?? 0, 0);
  });

  test('a full disenchant-then-craft round trip on the same card is dust-negative (crafting costs more than disenchanting refunds)', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: { a11: 1 }, deck: {} }; // legendary
    const { dustGained } = Store.disenchant(save, 'a11');
    assert.ok(dustGained < Store.CONSTANTS.CRAFT_COST.legendary, 'crafting the same card back must not be free value');
  });
});

describe('disenchantExcess', () => {
  test('disenchants only the copies above MAX_COPIES, leaving exactly MAX_COPIES behind', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: { a1: 5, a2: 1 }, deck: {} }; // both common
    const res = Store.disenchantExcess(save);
    assert.equal(save.collection.a1, Store.CONSTANTS.MAX_COPIES);
    assert.equal(save.collection.a2, 1, 'a card at or under MAX_COPIES must be untouched');
    assert.equal(res.cardsAffected, 1);
    assert.equal(res.totalDust, (5 - Store.CONSTANTS.MAX_COPIES) * Store.CONSTANTS.DUST_VALUE.common);
    assert.equal(save.dust, res.totalDust);
  });

  test('is a safe no-op when nothing exceeds MAX_COPIES', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: { a1: 2 }, deck: {} };
    const res = Store.disenchantExcess(save);
    assert.equal(res.cardsAffected, 0);
    assert.equal(res.totalDust, 0);
    assert.equal(save.collection.a1, 2);
    assert.equal(save.dust, 0);
  });

  test('trims the deck referencing the disenchanted excess back into a legal state', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: { a1: 4 }, deck: { a1: 2 } };
    Store.disenchantExcess(save);
    assert.equal(save.deck.a1, Store.CONSTANTS.MAX_COPIES, 'deck usage was already within MAX_COPIES, so it must be untouched');
  });
});

describe('buildAiDeck (matchmaking bot fallback)', () => {
  test('always builds exactly DECK_SIZE cards, matching the player\'s own cap', () => {
    const deck = Store.buildAiDeck();
    const total = Object.values(deck).reduce((a, b) => a + b, 0);
    assert.equal(total, Store.CONSTANTS.DECK_SIZE);
  });

  test('never exceeds MAX_COPIES of any single card', () => {
    const deck = Store.buildAiDeck();
    for (const count of Object.values(deck)) assert.ok(count <= Store.CONSTANTS.MAX_COPIES);
  });

  test('can freely mix cards from more than one faction, matching real freeform decks', () => {
    const decks = Array.from({ length: 10 }, () => Store.buildAiDeck());
    const anyMixed = decks.some((deck) => {
      const factions = new Set(Object.keys(deck).map((id) => CARDS.find((c) => c.id === id).faction));
      return factions.size > 1;
    });
    assert.ok(anyMixed, 'expected at least one multi-faction bot deck across 10 builds');
  });

  test('varies between calls so matches do not always look the same', () => {
    const decks = Array.from({ length: 10 }, () => JSON.stringify(Store.buildAiDeck()));
    assert.ok(new Set(decks).size > 1, 'expected at least some variety across 10 builds');
  });
});

describe('autoBuildDeck', () => {
  test('only uses cards the player actually owns, across any faction', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: { a1: 2, t1: 2 }, deck: {} };
    const deck = Store.autoBuildDeck(save);
    for (const id of Object.keys(deck)) assert.ok(save.collection[id] > 0);
    assert.equal(Store.deckCount(save), Object.values(save.collection).reduce((a, b) => a + Math.min(b, Store.CONSTANTS.MAX_COPIES), 0));
  });

  test('writes into the requested deckKey (deck vs autoDeck)', () => {
    const save = { coins: 0, gems: 0, dust: 0, collection: { a1: 2 }, deck: {}, autoDeck: {} };
    Store.autoBuildDeck(save, 'autoDeck');
    assert.deepEqual(save.deck, {});
    assert.deepEqual(save.autoDeck, { a1: 2 });
  });
});

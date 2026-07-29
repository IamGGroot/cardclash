import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cardsForFaction, CARDS } from '../src/cards.js';
import {
  openDraftPack,
  drawBonusNeutralCard,
  drawRandomCommonCard,
  nextPackAssignment,
  seedBracket,
  PACK_SIZE,
  POD_SIZE,
  PACKS_PER_PLAYER,
  TOTAL_PICKS,
} from '../src/draft.js';

describe('openDraftPack', () => {
  test('always returns exactly PACK_SIZE cards from the full pool', () => {
    for (let i = 0; i < 20; i++) {
      const pack = openDraftPack();
      assert.equal(pack.length, PACK_SIZE);
      for (const card of pack) assert.ok(CARDS.includes(card), 'every card must come from the real pool');
    }
  });

  test('TOTAL_PICKS matches 3 packs of 5 cards each', () => {
    assert.equal(TOTAL_PICKS, PACK_SIZE * PACKS_PER_PLAYER);
    assert.equal(TOTAL_PICKS, 15);
  });
});

describe('drawBonusNeutralCard', () => {
  test('always draws from the neutral (Gremio Errante) pool', () => {
    const neutralIds = new Set(cardsForFaction('neutral').map((c) => c.id));
    for (let i = 0; i < 20; i++) {
      const card = drawBonusNeutralCard();
      assert.ok(neutralIds.has(card.id));
    }
  });
});

describe('drawRandomCommonCard', () => {
  test('always draws a common-rarity card', () => {
    for (let i = 0; i < 20; i++) {
      assert.equal(drawRandomCommonCard().rarity, 'common');
    }
  });
});

describe('nextPackAssignment', () => {
  test('round 0 passes left (seat+1), round 1 passes right (seat-1), round 2 passes left again', () => {
    for (let seat = 0; seat < POD_SIZE; seat++) {
      assert.equal(nextPackAssignment(seat, 0, POD_SIZE), (seat + 1) % POD_SIZE);
      assert.equal(nextPackAssignment(seat, 1, POD_SIZE), (seat - 1 + POD_SIZE) % POD_SIZE);
      assert.equal(nextPackAssignment(seat, 2, POD_SIZE), (seat + 1) % POD_SIZE);
    }
  });

  test('never assigns a pack back to the seat that just picked from it', () => {
    for (let round = 0; round < PACKS_PER_PLAYER; round++) {
      for (let seat = 0; seat < POD_SIZE; seat++) {
        assert.notEqual(nextPackAssignment(seat, round, POD_SIZE), seat);
      }
    }
  });
});

describe('seedBracket', () => {
  test('pairs seat 0 with the last seat, and the two middle seats together', () => {
    const { semis } = seedBracket([0, 1, 2, 3]);
    assert.deepEqual(semis, [[0, 3], [1, 2]]);
  });

  test('every seat appears in exactly one semifinal pair', () => {
    const { semis } = seedBracket(['a', 'b', 'c', 'd']);
    const flat = semis.flat();
    assert.deepEqual([...flat].sort(), ['a', 'b', 'c', 'd']);
  });
});

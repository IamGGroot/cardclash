import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, endTurn } from '../src/battle.js';
import { runAutoDeckTurn } from '../src/autoDeck.js';

describe('Autodeckbuilder turns', () => {
  test('plays at most one card per turn even with plenty of mana and playable options', () => {
    const state = newGame({ a1: 20 }, 'hero-albura', { a1: 20 }, 'hero-ignara');
    state.p1.resource = 10;
    state.p1.resourceMax = 10;
    state.p1.might = 10;
    const handBefore = state.p1.hand.length;
    runAutoDeckTurn(state, 'p1');
    assert.equal(state.p1.hand.length, handBefore - 1, 'exactly one card should have left the hand');
  });

  test("picks the hero action automatically instead of leaving it unused", () => {
    const state = newGame({ a1: 20 }, 'hero-albura', { a1: 20 }, 'hero-ignara');
    runAutoDeckTurn(state, 'p1');
    assert.equal(state.p1.heroActionUsed, true);
  });

  test('two autodeckbuilder decks can play a full match against each other without hanging', () => {
    const p1Deck = { a1: 4, a2: 4, a7: 4, a9: 4 };
    const p2Deck = { t1: 4, t2: 4, t7: 4, t8: 4 };
    const state = newGame(p1Deck, 'hero-albura', p2Deck, 'hero-terra');
    let turns = 0;
    while (state.winner === null && turns < 500) {
      runAutoDeckTurn(state, state.active);
      if (state.winner !== null) break;
      endTurn(state);
      turns += 1;
    }
    assert.ok(state.winner !== null, 'the match should reach a winner within a bounded number of turns');
  });
});

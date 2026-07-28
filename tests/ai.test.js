import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/battle.js';
import { runAiTurn } from '../src/ai.js';

// The AI always acts as 'p2'. These tests hand-craft board states and assert
// on the *outcome* of a full AI turn rather than reaching into ai.js's
// private helpers, since none of them are exported.

describe('AI combat decisions', () => {
  test('does not throw across many simulated games with varied decks', () => {
    const decks = [
      { a1: 2, a2: 2, a7: 2 },
      { g1: 2, g2: 2, g7: 2 },
      { u1: 2, u7: 2, u11: 2 },
    ];
    for (let i = 0; i < 15; i++) {
      const playerDeck = decks[i % decks.length];
      const aiDeck = decks[(i + 1) % decks.length];
      const state = newGame(playerDeck, 'hero-albura', aiDeck, 'hero-ignara');
      state.active = 'p2';
      assert.doesNotThrow(() => runAiTurn(state));
    }
  });

  test('avoids a losing trade: does not attack into a creature that would kill it without dying itself', () => {
    const state = newGame({ a1: 20 }, 'hero-albura', { a1: 20 }, 'hero-ignara');
    state.active = 'p2';
    state.p2.hand = [];
    state.p2.resource = 0;
    // AI's melee creature: weak, would die to retaliate without killing the defender
    state.p2.battlefield[0].front = {
      instanceId: 'ai1', cardId: 'g2', atk: 1, retaliate: 1, life: 2, maxLife: 2, canAttack: true,
    };
    // Player's defender: survives the hit and its retaliate would kill the attacker
    state.p1.battlefield[0].front = {
      instanceId: 'p1a', cardId: 'a5', atk: 1, retaliate: 5, life: 20, maxLife: 20, canAttack: false,
    };
    runAiTurn(state);
    assert.equal(state.p1.battlefield[0].front.life, 20, 'the defender should be untouched');
  });

  test('repositions a creature that has no profitable attack instead of forcing a bad trade', () => {
    const state = newGame({ a1: 20 }, 'hero-albura', { a1: 20 }, 'hero-ignara');
    state.active = 'p2';
    state.p2.hand = [];
    state.p2.resource = 0;
    state.p2.battlefield[0].front = {
      instanceId: 'ai1', cardId: 'g2', atk: 1, retaliate: 1, life: 2, maxLife: 2, canAttack: true,
    };
    state.p1.battlefield[0].front = {
      instanceId: 'p1a', cardId: 'a5', atk: 1, retaliate: 5, life: 20, maxLife: 20, canAttack: false,
    };
    // lane 1 on the player's side is completely empty, a safer lane to sit in
    runAiTurn(state);
    const stillInLane0 = state.p2.battlefield[0].front;
    const movedToAnotherLane = state.p2.battlefield.some((lane, i) => i !== 0 && lane.front?.instanceId === 'ai1');
    assert.ok(!stillInLane0 || movedToAnotherLane === false, 'sanity: creature is somewhere');
    assert.equal(stillInLane0, null, 'the AI should have moved out of lane 0');
  });

  test('takes a free kill when available instead of a risky trade', () => {
    const state = newGame({ a1: 20 }, 'hero-albura', { a1: 20 }, 'hero-ignara');
    state.active = 'p2';
    state.p2.hand = [];
    state.p2.resource = 0;
    state.p2.battlefield[0].front = {
      instanceId: 'ai1', cardId: 'g2', atk: 5, retaliate: 1, life: 5, maxLife: 5, canAttack: true,
    };
    state.p1.battlefield[0].front = {
      instanceId: 'p1a', cardId: 'a1', atk: 1, retaliate: 1, life: 3, maxLife: 3, canAttack: false,
    };
    runAiTurn(state);
    assert.equal(state.p1.battlefield[0].front, null, 'the weak defender should have been killed');
  });

  test('a shooter always attacks even into a high-retaliate defender (immune to retaliate)', () => {
    const state = newGame({ a1: 20 }, 'hero-albura', { a1: 20 }, 'hero-ignara');
    state.active = 'p2';
    state.p2.hand = [];
    state.p2.resource = 0;
    state.p2.battlefield[0].back = {
      instanceId: 'ai1', cardId: 'g4', atk: 1, retaliate: 1, life: 3, maxLife: 3, canAttack: true,
    };
    state.p1.battlefield[0].front = {
      instanceId: 'p1a', cardId: 'a5', atk: 1, retaliate: 99, life: 20, maxLife: 20, canAttack: false,
    };
    runAiTurn(state);
    assert.equal(state.p1.battlefield[0].front.life, 19, 'the shooter should have chipped 1 damage in safely');
    assert.equal(state.p2.battlefield[0].back?.life, 3, 'the shooter itself should be untouched');
  });
});

describe('AI spell targeting', () => {
  test('a destroy-creature spell targets the biggest threat, not the first one found', () => {
    const state = newGame({ a1: 20 }, 'hero-albura', { u11: 1 }, 'hero-umbra'); // Sentencia de Umbra: destroy_creature
    state.active = 'p2';
    state.p2.hand = ['u11'];
    state.p2.resource = 10;
    state.p2.magic = 10;
    state.p1.battlefield[0].front = {
      instanceId: 'weak', cardId: 'a1', atk: 1, retaliate: 1, life: 2, maxLife: 2, canAttack: false,
    };
    state.p1.battlefield[2].front = {
      instanceId: 'big', cardId: 'a6', atk: 8, retaliate: 8, life: 9, maxLife: 9, canAttack: false,
    };
    runAiTurn(state);
    assert.equal(state.p1.battlefield[0].front?.instanceId, 'weak', 'the weaker creature should survive');
    assert.equal(state.p1.battlefield[2].front, null, 'the biggest threat should be destroyed');
  });

  test('an enemy_any damage spell finishes off a killable creature instead of hitting face', () => {
    // hero-umbra's special (draw_card) is hp-neutral, unlike Ignara's — this
    // isolates the spell-targeting decision from an unrelated hero-action side effect.
    const state = newGame({ a1: 20 }, 'hero-albura', { g11: 1 }, 'hero-umbra'); // Chispa del Destino: damage_1
    state.active = 'p2';
    state.p2.hand = ['g11'];
    state.p2.resource = 10;
    state.p2.destiny = 10;
    const hpBefore = state.p1.hp;
    state.p1.battlefield[0].front = {
      instanceId: 'lowlife', cardId: 'a1', atk: 1, retaliate: 1, life: 1, maxLife: 5, canAttack: false,
    };
    runAiTurn(state);
    assert.equal(state.p1.battlefield[0].front, null, 'the 1-life creature should have been sniped');
    assert.equal(state.p1.hp, hpBefore, 'no face damage should have been dealt instead');
  });
});

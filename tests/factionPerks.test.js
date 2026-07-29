import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/battle.js';
import { getActiveFactionPerks, getStatModifier } from '../src/factionPerks.js';

function deployCreature(state, side, laneIndex, row, cardId = 't1') {
  state[side].battlefield[laneIndex][row] = {
    instanceId: `${side}-${laneIndex}-${row}`,
    cardId,
    atk: 1,
    retaliate: 1,
    life: 2,
    maxLife: 2,
    canAttack: false,
  };
}

describe('factionPerks activation threshold', () => {
  test('defaults to 4 creatures when no perkThreshold is set on the match', () => {
    const deck = { t1: 16 };
    const state = newGame(deck, 'hero-terra', deck, 'hero-terra');
    deployCreature(state, 'p1', 0, 'front');
    deployCreature(state, 'p1', 1, 'front');
    assert.equal(getActiveFactionPerks(state, 'p1').length, 0, '2 creatures should not activate the default 4-threshold');
    deployCreature(state, 'p1', 2, 'front');
    deployCreature(state, 'p1', 3, 'front');
    const active = getActiveFactionPerks(state, 'p1');
    assert.equal(active.length, 1, '4 creatures should activate the default threshold');
    assert.equal(active[0].id, 'terra');
  });

  test('Draft mode (perkThreshold: 2) activates the aura at 2 creatures instead of 4', () => {
    const deck = { t1: 16 };
    const state = newGame(deck, 'hero-terra', deck, 'hero-terra', { perkThreshold: 2 });
    deployCreature(state, 'p1', 0, 'front');
    assert.equal(getActiveFactionPerks(state, 'p1').length, 0, '1 creature should not activate a 2-threshold');
    deployCreature(state, 'p1', 1, 'front');
    assert.equal(getActiveFactionPerks(state, 'p1').length, 1, '2 creatures should activate a 2-threshold');
  });
});

describe('mixed-faction decks can activate two perks at once', () => {
  test('4 Terra + 4 Ignara creatures on the same side activate both auras simultaneously', () => {
    const deck = { t1: 8, g1: 8 };
    const state = newGame(deck, 'hero-terra', deck, 'hero-terra');
    deployCreature(state, 'p1', 0, 'front', 't1');
    deployCreature(state, 'p1', 0, 'back', 't1');
    deployCreature(state, 'p1', 1, 'front', 't1');
    deployCreature(state, 'p1', 1, 'back', 't1');
    deployCreature(state, 'p1', 2, 'front', 'g1');
    deployCreature(state, 'p1', 2, 'back', 'g1');
    deployCreature(state, 'p1', 3, 'front', 'g1');
    deployCreature(state, 'p1', 3, 'back', 'g1');
    const active = getActiveFactionPerks(state, 'p1').map((p) => p.id).sort();
    assert.deepEqual(active, ['ignara', 'terra']);
    // Both stack: +1 life (Terra) and +1 atk (Ignara) on the same creature.
    const mod = getStatModifier(state, 'p1');
    assert.equal(mod.life, 1);
    assert.equal(mod.atk, 1);
  });

  test('neutral creatures never count toward any faction threshold', () => {
    const deck = { n1: 16 };
    const state = newGame(deck, 'hero-terra', deck, 'hero-terra');
    for (let i = 0; i < 4; i++) deployCreature(state, 'p1', i, 'front', 'n1');
    assert.equal(getActiveFactionPerks(state, 'p1').length, 0);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/battle.js';
import { getFactionPerk } from '../src/factionPerks.js';

function deployCreature(state, side, laneIndex, row) {
  state[side].battlefield[laneIndex][row] = {
    instanceId: `${side}-${laneIndex}-${row}`,
    cardId: 't1',
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
    assert.equal(getFactionPerk(state, 'p1').active, false, '2 creatures should not activate the default 4-threshold');
    deployCreature(state, 'p1', 2, 'front');
    deployCreature(state, 'p1', 3, 'front');
    assert.equal(getFactionPerk(state, 'p1').active, true, '4 creatures should activate the default threshold');
  });

  test('Draft mode (perkThreshold: 2) activates the aura at 2 creatures instead of 4', () => {
    const deck = { t1: 16 };
    const state = newGame(deck, 'hero-terra', deck, 'hero-terra', { perkThreshold: 2 });
    deployCreature(state, 'p1', 0, 'front');
    assert.equal(getFactionPerk(state, 'p1').active, false, '1 creature should not activate a 2-threshold');
    deployCreature(state, 'p1', 1, 'front');
    assert.equal(getFactionPerk(state, 'p1').active, true, '2 creatures should activate a 2-threshold');
  });
});

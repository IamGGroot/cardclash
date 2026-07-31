import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/battle.js';
import { applyLevelUp, applySpecial, applyDeploy, applyReplace, applyMove, applyAttack, applyEndTurn } from '../src/actions.js';

// Same helpers as tests/battle.test.js — kept local since actions.js is a
// thin wrapper and doesn't need the full battle.test.js fixture surface.
function freshGame({ resource = 10, might = 6, magic = 6, destiny = 6 } = {}) {
  const state = newGame({ a1: 20 }, 'hero-albura', { a1: 20 }, 'hero-ignara');
  state.p1.resource = resource;
  state.p1.resourceMax = resource;
  state.p1.might = might;
  state.p1.magic = magic;
  state.p1.destiny = destiny;
  return state;
}

function placeCreature(state, side, laneIndex, row, overrides = {}) {
  state[side].battlefield[laneIndex][row] = {
    instanceId: 'test-' + Math.random(),
    cardId: 'a1',
    atk: 1,
    retaliate: 1,
    life: 2,
    maxLife: 2,
    canAttack: false,
    ...overrides,
  };
  return state[side].battlefield[laneIndex][row];
}

describe('applyLevelUp', () => {
  test('returns a levelUp step and raises the attribute on success', () => {
    const state = freshGame({ might: 0 });
    const step = applyLevelUp(state, 'p1', 'might');
    assert.deepEqual(step, { type: 'levelUp', side: 'p1', attr: 'might' });
    assert.equal(state.p1.might, 1);
  });

  test('returns null when the hero action was already used this turn', () => {
    const state = freshGame();
    applyLevelUp(state, 'p1', 'might');
    const second = applyLevelUp(state, 'p1', 'magic');
    assert.equal(second, null);
  });
});

describe('applySpecial', () => {
  test('returns a special step and applies the effect', () => {
    const state = freshGame();
    state.p1.hp = 10;
    const step = applySpecial(state, 'p1', 'heal_hero_2');
    assert.deepEqual(step, { type: 'special', side: 'p1', effectId: 'heal_hero_2' });
    assert.equal(state.p1.hp, 12);
  });
});

describe('applyDeploy', () => {
  test('returns a deploy step carrying the card and slot on success', () => {
    const state = freshGame();
    const cardId = state.p1.hand.find((id) => id) ?? 'a1';
    state.p1.hand = [cardId];
    const step = applyDeploy(state, 'p1', 0, 1, 'front');
    assert.ok(step);
    assert.equal(step.type, 'deploy');
    assert.equal(step.side, 'p1');
    assert.equal(step.laneIndex, 1);
    assert.equal(step.row, 'front');
    assert.equal(step.card.id, cardId);
    assert.ok(state.p1.battlefield[1].front);
  });

  test('returns null when the slot is already occupied', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front');
    state.p1.hand = [state.p1.hand[0]];
    const step = applyDeploy(state, 'p1', 0, 0, 'front');
    assert.equal(step, null);
  });
});

describe('applyReplace', () => {
  test('returns a replace step carrying both cards and the slot on success', () => {
    const state = freshGame();
    const oldCreature = placeCreature(state, 'p1', 0, 'front', { cardId: 'a2' });
    state.p1.hand = ['a1'];
    const step = applyReplace(state, 'p1', 0, 'front', 0);
    assert.ok(step);
    assert.equal(step.type, 'replace');
    assert.equal(step.side, 'p1');
    assert.equal(step.laneIndex, 0);
    assert.equal(step.row, 'front');
    assert.equal(step.card.id, 'a1');
    assert.equal(step.oldCard.id, 'a2');
    assert.notEqual(state.p1.battlefield[0].front.instanceId, oldCreature.instanceId);
    assert.equal(state.p1.battlefield[0].front.cardId, 'a1');
  });

  test('returns null when the slot is empty', () => {
    const state = freshGame();
    state.p1.hand = ['a1'];
    const step = applyReplace(state, 'p1', 0, 'front', 0);
    assert.equal(step, null);
  });
});

describe('applyMove', () => {
  test('returns a move step with from/to on success', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { canAttack: true });
    const step = applyMove(state, 'p1', 0, 'front', 1, 'front');
    assert.ok(step);
    assert.equal(step.type, 'move');
    assert.deepEqual(step.from, { laneIndex: 0, row: 'front' });
    assert.deepEqual(step.to, { laneIndex: 1, row: 'front' });
    assert.equal(state.p1.battlefield[0].front, null);
    assert.ok(state.p1.battlefield[1].front);
  });

  test('returns null for a creature that cannot act', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { canAttack: false });
    const step = applyMove(state, 'p1', 0, 'front', 1, 'front');
    assert.equal(step, null);
  });
});

describe('applyAttack', () => {
  test('face attack step reports no retaliate damage', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { canAttack: true, atk: 3 });
    const step = applyAttack(state, 'p1', 0, 'front', { type: 'face' });
    assert.ok(step);
    assert.equal(step.type, 'attack');
    assert.equal(step.attackerAtk, 3);
    assert.equal(step.retaliateDamage, 0);
    assert.equal(state.p2.hp, 17);
  });

  test('a surviving defender retaliates and the step reports the damage', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { canAttack: true, atk: 1, life: 5, maxLife: 5 });
    placeCreature(state, 'p2', 0, 'front', { life: 5, maxLife: 5, retaliate: 2 });
    const step = applyAttack(state, 'p1', 0, 'front', { type: 'creature', row: 'front' });
    assert.equal(step.retaliateDamage, 2);
    assert.equal(state.p1.battlefield[0].front.life, 3, 'attacker takes the retaliate hit');
  });

  test('a lethal hit reports no retaliate since the defender dies', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { canAttack: true, atk: 5 });
    placeCreature(state, 'p2', 0, 'front', { life: 2, maxLife: 2, retaliate: 4 });
    const step = applyAttack(state, 'p1', 0, 'front', { type: 'creature', row: 'front' });
    assert.equal(step.retaliateDamage, 0);
    assert.equal(state.p1.battlefield[0].front.life, 2, 'attacker takes no damage from a dead defender');
  });

  test('returns null when the attacker cannot act', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { canAttack: false });
    const step = applyAttack(state, 'p1', 0, 'front', { type: 'face' });
    assert.equal(step, null);
  });
});

describe('applyEndTurn', () => {
  test('flips the active side and reports who it was', () => {
    const state = freshGame();
    const step = applyEndTurn(state);
    assert.deepEqual(step, { type: 'endTurn', side: 'p1' });
    assert.equal(state.active, 'p2');
  });
});

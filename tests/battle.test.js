import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame,
  startTurn,
  endTurn,
  levelUpAttribute,
  useHeroSpecial,
  playCreature,
  playSpellOrFortune,
  getValidAttackTargets,
  getValidMoveTargets,
  moveCreature,
  attack,
} from '../src/battle.js';

// Small helper: a fresh game with plenty of resource/attributes already
// granted, so tests can play cards without grinding through turns first.
// The deck is deliberately oversized (20 copies) so the opening hand deal
// and any extra draws during a test never accidentally empty the deck and
// trigger fatigue damage as a side effect unrelated to what's being tested.
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

describe('newGame', () => {
  test('deals a 3-card opening hand to each player and starts p1 with a fresh turn', () => {
    const state = newGame({ a1: 2, a2: 2 }, 'hero-albura', { a1: 2, a2: 2 }, 'hero-ignara');
    assert.equal(state.p1.hand.length, 4); // 3 opening + 1 draw from startTurn(p1)
    assert.equal(state.p2.hand.length, 3); // p2 hasn't had a turn yet
    assert.equal(state.active, 'p1');
    assert.equal(state.turn, 1);
    assert.equal(state.p1.hp, 20);
    assert.equal(state.winner, null);
  });

  test('initializes empty per-match stats', () => {
    const state = newGame({ a1: 2 }, 'hero-albura', { a1: 2 }, 'hero-ignara');
    assert.deepEqual(state.stats, { heroDamageDealt: 0, creaturesKilled: 0, creaturesPlayed: 0 });
  });
});

describe('turn structure', () => {
  test('resourceMax increases by 1 each of that side\'s turns, capped at 12', () => {
    const state = newGame({ a1: 20 }, 'hero-albura', { a1: 20 }, 'hero-ignara');
    assert.equal(state.p1.resourceMax, 1);
    for (let i = 0; i < 20; i++) {
      endTurn(state); // p2's turn
      endTurn(state); // back to p1
    }
    assert.equal(state.p1.resourceMax, 12);
    assert.equal(state.p1.resource, 12);
  });

  test('endTurn alternates active side and increments turn counter only on return to p1', () => {
    const state = newGame({ a1: 2 }, 'hero-albura', { a1: 2 }, 'hero-ignara');
    assert.equal(state.turn, 1);
    endTurn(state);
    assert.equal(state.active, 'p2');
    assert.equal(state.turn, 1);
    endTurn(state);
    assert.equal(state.active, 'p1');
    assert.equal(state.turn, 2);
  });

  test('drawing from an empty deck deals increasing fatigue damage instead', () => {
    // newGame() itself already calls startTurn('p1') once, so with an empty
    // deck p1 has already taken one fatigue hit (fatigue 1) by the time it
    // returns — capture state right after that as the baseline.
    const state = newGame({}, 'hero-albura', {}, 'hero-ignara');
    assert.equal(state.p1.fatigue, 1);
    const hpAfterFirstFatigue = state.p1.hp;
    startTurn(state, 'p1'); // fatigue 2
    assert.equal(state.p1.fatigue, 2);
    assert.equal(state.p1.hp, hpAfterFirstFatigue - 2);
  });

  test('creatures become ready to act again at the start of their owner\'s turn', () => {
    const state = freshGame();
    const c = placeCreature(state, 'p1', 0, 'front', { canAttack: false });
    startTurn(state, 'p1');
    assert.equal(c.canAttack, true);
  });
});

describe('hero action (level up or special, never both)', () => {
  test('levelUpAttribute increases the attribute and consumes the hero action', () => {
    const state = freshGame({ might: 0 });
    const res = levelUpAttribute(state, 'p1', 'might');
    assert.equal(res.ok, true);
    assert.equal(state.p1.might, 1);
    assert.equal(state.p1.heroActionUsed, true);
  });

  test('a second hero action in the same turn is rejected', () => {
    const state = freshGame();
    levelUpAttribute(state, 'p1', 'might');
    const second = levelUpAttribute(state, 'p1', 'magic');
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'used');
  });

  test('useHeroSpecial applies the hero\'s effect and also consumes the hero action', () => {
    const state = freshGame();
    state.p1.hp = 10;
    const res = useHeroSpecial(state, 'p1', 'heal_hero_2'); // Elara Lumen's special
    assert.equal(res.ok, true);
    assert.equal(state.p1.hp, 12);
    assert.equal(levelUpAttribute(state, 'p1', 'might').ok, false);
  });

  test('rejects an unknown attribute name', () => {
    const state = freshGame();
    const res = levelUpAttribute(state, 'p1', 'not-a-real-attribute');
    assert.equal(res.ok, false);
  });
});

describe('playCreature', () => {
  test('deploys into an empty legal slot and spends resource', () => {
    const state = freshGame();
    const before = state.p1.resource;
    state.p1.hand = ['a1']; // Novicio: cost 1, requirement 1, melee
    const res = playCreature(state, 'p1', 0, 0, 'front');
    assert.equal(res.ok, true);
    assert.equal(state.p1.battlefield[0].front.cardId, 'a1');
    assert.equal(state.p1.resource, before - 1);
    assert.equal(state.p1.hand.length, 0);
  });

  test('increments stats.creaturesPlayed only for p1', () => {
    const state = freshGame();
    state.p1.hand = ['a1'];
    playCreature(state, 'p1', 0, 0, 'front');
    assert.equal(state.stats.creaturesPlayed, 1);

    state.p2.resource = 10;
    state.p2.might = 6;
    state.p2.hand = ['a1'];
    playCreature(state, 'p2', 0, 1, 'front');
    assert.equal(state.stats.creaturesPlayed, 1, 'p2 deploys must not count toward the player-facing stat');
  });

  test('rejects when the slot is already occupied', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front');
    state.p1.hand = ['a1'];
    const res = playCreature(state, 'p1', 0, 0, 'front');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'occupied');
  });

  test('rejects when might is below the card requirement', () => {
    const state = freshGame({ might: 0 });
    state.p1.hand = ['a5']; // Vengador Sacro, requirement 4
    const res = playCreature(state, 'p1', 0, 0, 'front');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'requirement');
  });

  test('rejects when resource is insufficient', () => {
    const state = freshGame({ resource: 0 });
    state.p1.hand = ['a1'];
    const res = playCreature(state, 'p1', 0, 0, 'front');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'resource');
  });

  test('a melee card can only be placed in the front row', () => {
    const state = freshGame();
    state.p1.hand = ['a1']; // melee
    const res = playCreature(state, 'p1', 0, 0, 'back');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'placement');
  });

  test('a shooter card can only be placed in the back row', () => {
    const state = freshGame();
    state.p1.hand = ['a3']; // Sanadora de Alba, shooter
    const res = playCreature(state, 'p1', 0, 0, 'front');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'placement');
  });

  test('a flyer card can be placed in either row', () => {
    const state = freshGame();
    state.p1.hand = ['a4', 'a4']; // Ala de Luz, flyer
    assert.equal(playCreature(state, 'p1', 0, 0, 'front').ok, true);
    assert.equal(playCreature(state, 'p1', 0, 1, 'back').ok, true);
  });

  test('a deployed creature starts unable to attack the turn it enters', () => {
    const state = freshGame();
    state.p1.hand = ['a1'];
    playCreature(state, 'p1', 0, 0, 'front');
    assert.equal(state.p1.battlefield[0].front.canAttack, false);
  });

  test('an onDeploy ability fires immediately', () => {
    const state = freshGame();
    state.p1.hp = 10;
    state.p1.hand = ['a3']; // Sanadora de Alba: onDeploy heal_hero_2
    playCreature(state, 'p1', 0, 0, 'back');
    assert.equal(state.p1.hp, 12);
  });
});

describe('playSpellOrFortune', () => {
  test('rejects when magic is below a spell\'s requirement', () => {
    const state = freshGame({ magic: 0 });
    state.p1.hand = ['a7']; // Bendición de Alba, spell, requirement 2
    const res = playSpellOrFortune(state, 'p1', 0, undefined);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'requirement');
  });

  test('rejects when destiny is below a fortune\'s requirement', () => {
    const state = freshGame({ destiny: 0 });
    state.p1.hand = ['a8']; // Favor de Alba, fortune, requirement 2
    const res = playSpellOrFortune(state, 'p1', 0, undefined);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'requirement');
  });

  test('a resolved spell moves to the discard pile', () => {
    const state = freshGame();
    state.p1.hand = ['a8']; // draw_2, target none
    playSpellOrFortune(state, 'p1', 0, undefined);
    assert.deepEqual(state.p1.discard, ['a8']);
  });

  test('draw_2 draws two cards', () => {
    const state = freshGame();
    state.p1.hand = ['a8'];
    const before = state.p1.hand.length + state.p1.deck.length; // sanity baseline unaffected by draw
    playSpellOrFortune(state, 'p1', 0, undefined);
    assert.equal(state.p1.hand.length, 2); // a8 discarded, 2 new cards drawn
  });

  test('buff_2_2 raises atk/life/maxLife on the targeted ally creature', () => {
    const state = freshGame();
    const target = placeCreature(state, 'p1', 0, 'front', { atk: 1, life: 2, maxLife: 2 });
    state.p1.hand = ['a7'];
    playSpellOrFortune(state, 'p1', 0, { side: 'p1', laneIndex: 0, row: 'front' });
    assert.equal(target.atk, 3);
    assert.equal(target.life, 4);
    assert.equal(target.maxLife, 4);
  });

  test('heal_creature_2 cannot heal past maxLife', () => {
    const state = freshGame();
    const target = placeCreature(state, 'p1', 0, 'front', { life: 4, maxLife: 5 });
    state.p1.hand = ['a9'];
    playSpellOrFortune(state, 'p1', 0, { side: 'p1', laneIndex: 0, row: 'front' });
    assert.equal(target.life, 5);
  });
});

describe('getValidAttackTargets', () => {
  test('an empty enemy lane offers only a face attack', () => {
    const state = freshGame();
    const options = getValidAttackTargets(state, 'p1', 0, 'melee');
    assert.deepEqual(options, [{ type: 'face' }]);
  });

  test('a melee/flyer attacker facing an occupied front row may only hit the front', () => {
    const state = freshGame();
    placeCreature(state, 'p2', 0, 'front');
    placeCreature(state, 'p2', 0, 'back');
    const options = getValidAttackTargets(state, 'p1', 0, 'melee');
    assert.deepEqual(options, [{ type: 'creature', row: 'front' }]);
  });

  test('a shooter may hit the back row even if the front is occupied', () => {
    const state = freshGame();
    placeCreature(state, 'p2', 0, 'front');
    placeCreature(state, 'p2', 0, 'back');
    const options = getValidAttackTargets(state, 'p1', 0, 'shooter');
    assert.deepEqual(options, [
      { type: 'creature', row: 'front' },
      { type: 'creature', row: 'back' },
    ]);
  });

  test('an empty front with an occupied back offers the back row to anyone', () => {
    const state = freshGame();
    placeCreature(state, 'p2', 0, 'back');
    const options = getValidAttackTargets(state, 'p1', 0, 'melee');
    assert.deepEqual(options, [{ type: 'creature', row: 'back' }]);
  });
});

describe('move mechanic', () => {
  test('a creature that has already acted this turn cannot move', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { canAttack: false });
    const res = moveCreature(state, 'p1', 0, 'front', 1, 'front');
    assert.equal(res.ok, false);
  });

  test('moving relocates the creature and marks it as spent', () => {
    const state = freshGame();
    const c = placeCreature(state, 'p1', 0, 'front', { canAttack: true });
    const res = moveCreature(state, 'p1', 0, 'front', 2, 'front');
    assert.equal(res.ok, true);
    assert.equal(state.p1.battlefield[0].front, null);
    assert.equal(state.p1.battlefield[2].front, c);
    assert.equal(c.canAttack, false);
  });

  test('cannot move into an occupied slot', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { canAttack: true });
    placeCreature(state, 'p1', 1, 'front');
    const res = moveCreature(state, 'p1', 0, 'front', 1, 'front');
    assert.equal(res.ok, false);
  });

  test('getValidMoveTargets respects placement row restrictions', () => {
    const state = freshGame();
    const options = getValidMoveTargets(state, 'p1', 0, 'front', 'melee');
    assert.ok(options.every((o) => o.row === 'front'));
    assert.ok(!options.some((o) => o.laneIndex === 0)); // excludes its own current slot
  });
});

describe('combat', () => {
  test('a face attack damages the enemy hero by the attacker\'s atk and tracks heroDamageDealt for p1', () => {
    const state = freshGame();
    const attacker = placeCreature(state, 'p1', 0, 'front', { atk: 3, canAttack: true });
    const hpBefore = state.p2.hp;
    const res = attack(state, 'p1', 0, 'front', { type: 'face' });
    assert.equal(res.ok, true);
    assert.equal(state.p2.hp, hpBefore - 3);
    assert.equal(state.stats.heroDamageDealt, 3);
    assert.equal(attacker.canAttack, false);
  });

  test('a spent (already-acted) creature cannot attack again', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { canAttack: false });
    const res = attack(state, 'p1', 0, 'front', { type: 'face' });
    assert.equal(res.ok, false);
  });

  test('melee vs melee: defender retaliates if it survives the hit', () => {
    const state = freshGame();
    const attacker = placeCreature(state, 'p1', 0, 'front', { atk: 2, life: 5, canAttack: true });
    const defender = placeCreature(state, 'p2', 0, 'front', { life: 10, retaliate: 3 });
    attack(state, 'p1', 0, 'front', { type: 'creature', row: 'front' });
    assert.equal(defender.life, 8); // 10 - 2
    assert.equal(attacker.life, 2); // 5 - 3 retaliate
  });

  test('a lethal hit prevents retaliation', () => {
    const state = freshGame();
    const attacker = placeCreature(state, 'p1', 0, 'front', { atk: 10, life: 5, canAttack: true });
    placeCreature(state, 'p2', 0, 'front', { life: 3, retaliate: 99 });
    attack(state, 'p1', 0, 'front', { type: 'creature', row: 'front' });
    assert.equal(attacker.life, 5, 'no retaliate damage should have applied');
    assert.equal(state.p2.battlefield[0].front, null, 'the dead defender is swept off the board');
  });

  test('a shooter attacker never takes retaliate damage even if the defender survives', () => {
    const state = freshGame();
    const attacker = placeCreature(state, 'p1', 0, 'back', { cardId: 'g4', atk: 1, life: 5, canAttack: true }); // g4 = Susurro de Ceniza, placement: shooter
    placeCreature(state, 'p2', 0, 'front', { life: 10, retaliate: 99 });
    // shooter attacking from the back row targets the front row creature
    attack(state, 'p1', 0, 'back', { type: 'creature', row: 'front' });
    assert.equal(attacker.life, 5, 'shooters are immune to retaliate');
  });

  test('killing an enemy creature via combat increments stats.creaturesKilled for p1 only', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { atk: 10, canAttack: true });
    placeCreature(state, 'p2', 0, 'front', { life: 1 });
    attack(state, 'p1', 0, 'front', { type: 'creature', row: 'front' });
    assert.equal(state.stats.creaturesKilled, 1);
  });

  test('a creature dying to its own retaliate does not count toward stats.creaturesKilled', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { atk: 1, life: 1, canAttack: true });
    placeCreature(state, 'p2', 0, 'front', { life: 99, retaliate: 99 });
    attack(state, 'p1', 0, 'front', { type: 'creature', row: 'front' });
    assert.equal(state.stats.creaturesKilled, 0, 'p1 losing its own creature is not a kill');
  });

  test('an onCombatDamage ability triggers on the attacker after dealing damage', () => {
    const state = freshGame();
    state.p1.hp = 10;
    placeCreature(state, 'p1', 0, 'front', { cardId: 'u5', atk: 3, canAttack: true }); // heals 1 on combat damage
    const res = attack(state, 'p1', 0, 'front', { type: 'face' });
    assert.equal(res.attackerAbility, 'heal_hero_1');
    assert.equal(state.p1.hp, 11);
  });
});

describe('win conditions', () => {
  test('p1 wins when the enemy hero drops to 0 or below', () => {
    const state = freshGame();
    placeCreature(state, 'p1', 0, 'front', { atk: 999, canAttack: true });
    attack(state, 'p1', 0, 'front', { type: 'face' });
    assert.equal(state.winner, 'p1');
  });

  test('p1 hero reaching 0 hp results in a p2 win', () => {
    const state = freshGame();
    state.p1.hp = 0;
    // checkWin() runs at the end of every state-changing action — any valid
    // p2 action re-evaluates it, even one that doesn't touch hp itself.
    useHeroSpecial(state, 'p2', 'draw_card');
    assert.equal(state.winner, 'p2');
  });

  test('both heroes at 0 hp at once results in a draw', () => {
    const state = freshGame();
    state.p1.hp = 0;
    state.p2.hp = 0;
    useHeroSpecial(state, 'p2', 'draw_card');
    assert.equal(state.winner, 'draw');
  });
});

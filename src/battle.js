import { getCard } from './cards.js';
import { effectiveAtk, effectiveRetaliate, effectiveLife } from './factionPerks.js';

const MAX_RESOURCE = 12;
const HAND_LIMIT = 7;
const START_HP = 20;
const LANES = 4;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function expandDeck(deckCounts) {
  const cards = [];
  for (const [cardId, count] of Object.entries(deckCounts)) {
    for (let i = 0; i < count; i++) cards.push(cardId);
  }
  return shuffle(cards);
}

function emptyBattlefield() {
  return Array.from({ length: LANES }, () => ({ front: null, back: null }));
}

function newPlayer(deckCounts, heroId) {
  const deck = expandDeck(deckCounts);
  const hand = [];
  for (let i = 0; i < 3 && deck.length; i++) hand.push(deck.shift());
  return {
    heroId,
    hp: START_HP,
    resourceMax: 0,
    resource: 0,
    might: 0,
    magic: 0,
    destiny: 0,
    heroActionUsed: false,
    deck,
    hand,
    discard: [],
    exile: [],
    battlefield: emptyBattlefield(),
    fatigue: 0,
  };
}

let uid = 1;
function nextId() {
  return 'inst' + uid++;
}

// perkThreshold overrides factionPerks.js's default 4-creature activation
// threshold for this match — Draft mode plays at 2 (see src/draft.js);
// every other caller omits it and gets the normal threshold.
export function newGame(playerDeck, playerHeroId, aiDeck, aiHeroId, { perkThreshold } = {}) {
  const state = {
    turn: 1,
    active: 'p1',
    winner: null,
    p1: newPlayer(playerDeck, playerHeroId),
    p2: newPlayer(aiDeck, aiHeroId),
    // Player-side (p1) totals for this match, read by the missions system
    // when the match ends — see cleanupBattlefield/attack/applyEffect below.
    stats: { heroDamageDealt: 0, creaturesKilled: 0, creaturesPlayed: 0 },
  };
  if (perkThreshold) state.perkThreshold = perkThreshold;
  startTurn(state, 'p1');
  return state;
}

function draw(state, side, count = 1) {
  const p = state[side];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      p.fatigue += 1;
      p.hp -= p.fatigue;
      continue;
    }
    const cardId = p.deck.shift();
    if (p.hand.length < HAND_LIMIT) p.hand.push(cardId);
  }
}

export function startTurn(state, side) {
  const p = state[side];
  p.resourceMax = Math.min(MAX_RESOURCE, p.resourceMax + 1);
  p.resource = p.resourceMax;
  p.heroActionUsed = false;
  for (const lane of p.battlefield) {
    // Buildings (see cards.js) are static — they hold their slot and can be
    // attacked, but never act themselves, so they never become ready.
    if (lane.front && !getCard(lane.front.cardId).building) lane.front.canAttack = true;
    if (lane.back && !getCard(lane.back.cardId).building) lane.back.canAttack = true;
  }
  draw(state, side, 1);
}

export function endTurn(state) {
  if (state.winner) return;
  state.active = state.active === 'p1' ? 'p2' : 'p1';
  if (state.active === 'p1') state.turn += 1;
  startTurn(state, state.active);
}

// ---- Hero action: exactly one per turn, either level up or special ----

export function levelUpAttribute(state, side, attr) {
  const p = state[side];
  if (p.heroActionUsed) return { ok: false, reason: 'used' };
  if (!['might', 'magic', 'destiny'].includes(attr)) return { ok: false };
  p[attr] += 1;
  p.heroActionUsed = true;
  return { ok: true };
}

export function useHeroSpecial(state, side, effectId) {
  const p = state[side];
  if (p.heroActionUsed) return { ok: false, reason: 'used' };
  applyEffect(state, side, effectId, undefined, undefined);
  p.heroActionUsed = true;
  cleanupBattlefield(state, side);
  checkWin(state);
  return { ok: true };
}

// ---- Playing cards ----

export function playCreature(state, side, handIdx, laneIndex, row) {
  const p = state[side];
  const cardId = p.hand[handIdx];
  const card = getCard(cardId);
  if (!card || card.type !== 'creature') return { ok: false };
  if (card.cost > p.resource) return { ok: false, reason: 'resource' };
  if (p.might < card.requirement) return { ok: false, reason: 'requirement' };
  const legalRow = card.placement === 'melee' ? 'front' : card.placement === 'shooter' ? 'back' : row;
  if (card.placement !== 'flyer' && legalRow !== row) return { ok: false, reason: 'placement' };
  const lane = p.battlefield[laneIndex];
  if (!lane || lane[row]) return { ok: false, reason: 'occupied' };

  const instance = {
    instanceId: nextId(),
    cardId,
    atk: card.atk,
    retaliate: card.retaliate,
    life: card.life,
    maxLife: card.life,
    canAttack: false,
  };
  lane[row] = instance;
  p.resource -= card.cost;
  p.hand.splice(handIdx, 1);
  if (side === 'p1') state.stats.creaturesPlayed += 1;

  if (card.ability && card.ability.trigger === 'onDeploy') {
    applyEffect(state, side, card.ability.effect, undefined, undefined);
  }
  cleanupBattlefield(state, side);
  checkWin(state);
  return { ok: true };
}

export function playSpellOrFortune(state, side, handIdx, target) {
  const p = state[side];
  const cardId = p.hand[handIdx];
  const card = getCard(cardId);
  if (!card || (card.type !== 'spell' && card.type !== 'fortune')) return { ok: false };
  if (card.cost > p.resource) return { ok: false, reason: 'resource' };
  const attr = card.type === 'spell' ? 'magic' : 'destiny';
  if (p[attr] < card.requirement) return { ok: false, reason: 'requirement' };

  p.resource -= card.cost;
  p.hand.splice(handIdx, 1);
  p.discard.push(cardId);
  applyEffect(state, side, card.effect, target, card.value);
  cleanupBattlefield(state, side);
  checkWin(state);
  return { ok: true };
}

// ---- Targeting ----

export function getValidAttackTargets(state, side, laneIndex, placement) {
  const enemy = side === 'p1' ? state.p2 : state.p1;
  const lane = enemy.battlefield[laneIndex];
  const options = [];
  if (lane.front) {
    options.push({ type: 'creature', row: 'front' });
    if (placement === 'shooter' && lane.back) options.push({ type: 'creature', row: 'back' });
  } else if (lane.back) {
    options.push({ type: 'creature', row: 'back' });
  } else {
    options.push({ type: 'face' });
  }
  return options;
}

// A ready creature may attack OR move (not both) — reposition to any empty,
// placement-legal slot on its own side of the battlefield.
export function getValidMoveTargets(state, side, laneIndex, row, placement) {
  const p = state[side];
  const rowsAllowed = placement === 'melee' ? ['front'] : placement === 'shooter' ? ['back'] : ['front', 'back'];
  const options = [];
  for (let l = 0; l < p.battlefield.length; l++) {
    for (const r of rowsAllowed) {
      if (l === laneIndex && r === row) continue;
      if (!p.battlefield[l][r]) options.push({ laneIndex: l, row: r });
    }
  }
  return options;
}

export function moveCreature(state, side, fromLane, fromRow, toLane, toRow) {
  const p = state[side];
  const creature = p.battlefield[fromLane] && p.battlefield[fromLane][fromRow];
  if (!creature || !creature.canAttack) return { ok: false };
  if (p.battlefield[toLane][toRow]) return { ok: false };
  const card = getCard(creature.cardId);
  const rowsAllowed = card.placement === 'melee' ? ['front'] : card.placement === 'shooter' ? ['back'] : ['front', 'back'];
  if (!rowsAllowed.includes(toRow)) return { ok: false };

  p.battlefield[fromLane][fromRow] = null;
  p.battlefield[toLane][toRow] = creature;
  creature.canAttack = false;
  return { ok: true };
}

// ---- Combat ----

export function attack(state, side, laneIndex, row, target) {
  const p = state[side];
  const enemy = side === 'p1' ? state.p2 : state.p1;
  const enemySide = side === 'p1' ? 'p2' : 'p1';
  const attacker = p.battlefield[laneIndex] && p.battlefield[laneIndex][row];
  if (!attacker || !attacker.canAttack) return { ok: false };

  attacker.canAttack = false;

  const attackerCard = getCard(attacker.cardId);
  const atkValue = effectiveAtk(state, side, attacker);
  let attackerAbility = null;
  let defenderAbility = null;

  if (target.type === 'face') {
    enemy.hp -= atkValue;
    if (side === 'p1') state.stats.heroDamageDealt += atkValue;
    attackerAbility = triggerCombatAbility(state, side, attacker);
  } else {
    const defender = enemy.battlefield[laneIndex][target.row];
    if (!defender) return { ok: false };
    defender.life -= atkValue;
    attackerAbility = triggerCombatAbility(state, side, attacker);
    if (effectiveLife(state, enemySide, defender) > 0 && attackerCard.placement !== 'shooter') {
      attacker.life -= effectiveRetaliate(state, enemySide, defender);
      defenderAbility = triggerCombatAbility(state, enemySide, defender);
    }
  }

  cleanupBattlefield(state, side);
  checkWin(state);
  return { ok: true, attackerAbility, defenderAbility };
}

function triggerCombatAbility(state, side, creatureInstance) {
  const card = getCard(creatureInstance.cardId);
  if (card && card.ability && card.ability.trigger === 'onCombatDamage') {
    applyEffect(state, side, card.ability.effect, undefined, undefined);
    return card.ability.effect;
  }
  return null;
}

// ---- Effects ----

// Numeric magnitudes live in the effect id itself (e.g. "heal_hero_4",
// "buff_2_2") so new cards can pick any value without a new switch case —
// only mechanics that aren't "apply N to a thing" get an explicit branch.
function targetCreature(state, target) {
  if (target && target.side && target.laneIndex !== undefined) {
    const lane = state[target.side].battlefield[target.laneIndex];
    return lane[target.row];
  }
  return null;
}

function applyEffect(state, side, effectId, target, value) {
  const p = state[side];
  const enemy = side === 'p1' ? state.p2 : state.p1;
  const enemyHpBefore = enemy.hp;
  const finishEffect = () => {
    if (side === 'p1' && enemy.hp < enemyHpBefore) {
      state.stats.heroDamageDealt += enemyHpBefore - enemy.hp;
    }
  };

  let m;
  if ((m = /^heal_hero_(\d+)$/.exec(effectId))) {
    p.hp = Math.min(START_HP, p.hp + Number(m[1]));
    return finishEffect();
  }
  if ((m = /^heal_creature_(\d+)$/.exec(effectId))) {
    const creature = targetCreature(state, target);
    if (creature) creature.life = Math.min(creature.maxLife, creature.life + Number(m[1]));
    return finishEffect();
  }
  if ((m = /^damage_enemy_hero_(\d+)$/.exec(effectId))) {
    enemy.hp -= Number(m[1]);
    return finishEffect();
  }
  if ((m = /^damage_(\d+)_hero$/.exec(effectId))) {
    enemy.hp -= Number(m[1]);
    return finishEffect();
  }
  if ((m = /^damage_(\d+)$/.exec(effectId))) {
    const creature = targetCreature(state, target);
    if (creature) creature.life -= Number(m[1]);
    else enemy.hp -= Number(m[1]);
    return finishEffect();
  }
  if ((m = /^buff_(\d+)_(\d+)$/.exec(effectId))) {
    const creature = targetCreature(state, target);
    if (creature) {
      creature.atk += Number(m[1]);
      creature.life += Number(m[2]);
      creature.maxLife += Number(m[2]);
    }
    return finishEffect();
  }
  if ((m = /^debuff_(\d+)_(\d+)$/.exec(effectId))) {
    const creature = targetCreature(state, target);
    if (creature) {
      creature.atk = Math.max(0, creature.atk - Number(m[1]));
      creature.life -= Number(m[2]);
    }
    return finishEffect();
  }
  if (effectId === 'draw_card') {
    draw(state, side, 1);
    return finishEffect();
  }
  if ((m = /^draw_(\d+)$/.exec(effectId))) {
    draw(state, side, Number(m[1]));
    return finishEffect();
  }

  switch (effectId) {
    case 'destroy_creature': {
      const creature = targetCreature(state, target);
      if (creature) creature.life = 0;
      break;
    }
    case 'reanimate': {
      const creatureIds = p.discard.filter((id) => getCard(id).type === 'creature');
      if (creatureIds.length && p.hand.length < HAND_LIMIT) {
        const pick = creatureIds[Math.floor(Math.random() * creatureIds.length)];
        p.discard.splice(p.discard.indexOf(pick), 1);
        p.hand.push(pick);
      }
      break;
    }
    case 'reanimate_to_play': {
      const creatureIds = p.discard.filter((id) => getCard(id).type === 'creature');
      if (creatureIds.length) {
        const pick = creatureIds[Math.floor(Math.random() * creatureIds.length)];
        const pickCard = getCard(pick);
        const rowsAllowed =
          pickCard.placement === 'melee' ? ['front'] : pickCard.placement === 'shooter' ? ['back'] : ['front', 'back'];
        const emptySlots = [];
        for (let l = 0; l < p.battlefield.length; l++) {
          for (const r of rowsAllowed) {
            if (!p.battlefield[l][r]) emptySlots.push({ l, r });
          }
        }
        if (emptySlots.length) {
          const slot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
          p.discard.splice(p.discard.indexOf(pick), 1);
          p.battlefield[slot.l][slot.r] = {
            instanceId: nextId(),
            cardId: pick,
            atk: pickCard.atk,
            retaliate: pickCard.retaliate,
            life: pickCard.life,
            maxLife: pickCard.life,
            canAttack: false,
          };
        }
      }
      break;
    }
    default:
      break;
  }

  finishEffect();
}

// Runs to a fixed point (not just one pass) because a death can drop a
// side below the 4-creature perk threshold, which retroactively lowers
// effectiveLife for whatever else that perk was propping up — e.g. Terra
// losing its +2 Vida aura can chain-kill an already-damaged ally the
// instant the 4th creature dies.
function cleanupBattlefield(state, actingSide) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const side of ['p1', 'p2']) {
      const p = state[side];
      for (const lane of p.battlefield) {
        for (const row of ['front', 'back']) {
          const creature = lane[row];
          if (creature && effectiveLife(state, side, creature) <= 0) {
            p.discard.push(creature.cardId);
            lane[row] = null;
            if (actingSide === 'p1' && side === 'p2') {
              state.stats.creaturesKilled += 1;
            }
            changed = true;
          }
        }
      }
    }
  }
}

function checkWin(state) {
  if (state.p1.hp <= 0 && state.p2.hp <= 0) state.winner = 'draw';
  else if (state.p1.hp <= 0) state.winner = 'p2';
  else if (state.p2.hp <= 0) state.winner = 'p1';
}

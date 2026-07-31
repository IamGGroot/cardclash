import { getCard } from './cards.js';
import {
  levelUpAttribute,
  useHeroSpecial,
  playCreature,
  replaceCreature,
  playSpellOrFortune,
  moveCreature,
  attack,
  endTurn,
} from './battle.js';

// Applies one atomic action to `state` and returns a "step" descriptor of
// what happened (or null if the action was illegal). This is the single
// source of truth for "what counts as one turn action" — shared by the bot
// (ai.js), the multiplayer server (authoritative validation), and the online
// client's optimistic local execution. Because all three go through the same
// wrappers, they produce identically-shaped steps that the UI's step
// animator (animateOpponentStep in ui.js) can render regardless of whether
// the move came from the bot or a real remote player.

export function applyLevelUp(state, side, attr) {
  const res = levelUpAttribute(state, side, attr);
  return res.ok ? { type: 'levelUp', side, attr } : null;
}

export function applySpecial(state, side, effectId) {
  const res = useHeroSpecial(state, side, effectId);
  return res.ok ? { type: 'special', side, effectId } : null;
}

export function applyDeploy(state, side, handIdx, laneIndex, row) {
  const cardId = state[side].hand[handIdx];
  const card = cardId ? getCard(cardId) : null;
  const res = playCreature(state, side, handIdx, laneIndex, row);
  return res.ok ? { type: 'deploy', side, card, laneIndex, row } : null;
}

// Sacrifices your own creature at (laneIndex, row) and deploys a hand
// creature into that slot in its place — see replaceCreature in battle.js.
export function applyReplace(state, side, laneIndex, row, handIdx) {
  const oldCreature = state[side].battlefield[laneIndex] && state[side].battlefield[laneIndex][row];
  const oldCard = oldCreature ? getCard(oldCreature.cardId) : null;
  const cardId = state[side].hand[handIdx];
  const card = cardId ? getCard(cardId) : null;
  const res = replaceCreature(state, side, laneIndex, row, handIdx);
  return res.ok ? { type: 'replace', side, card, oldCard, laneIndex, row } : null;
}

export function applySpell(state, side, handIdx, target) {
  const cardId = state[side].hand[handIdx];
  const card = cardId ? getCard(cardId) : null;
  const res = playSpellOrFortune(state, side, handIdx, target);
  return res.ok ? { type: 'spell', side, card, target } : null;
}

export function applyMove(state, side, fromLane, fromRow, toLane, toRow) {
  const creature = state[side].battlefield[fromLane] && state[side].battlefield[fromLane][fromRow];
  const card = creature ? getCard(creature.cardId) : null;
  const res = moveCreature(state, side, fromLane, fromRow, toLane, toRow);
  return res.ok
    ? { type: 'move', side, card, from: { laneIndex: fromLane, row: fromRow }, to: { laneIndex: toLane, row: toRow } }
    : null;
}

export function applyAttack(state, side, laneIndex, row, target) {
  const enemySide = side === 'p1' ? 'p2' : 'p1';
  const attacker = state[side].battlefield[laneIndex] && state[side].battlefield[laneIndex][row];
  if (!attacker || !attacker.canAttack) return null;
  const card = getCard(attacker.cardId);
  const isShooter = card.placement === 'shooter';
  const defender = target.type === 'creature' ? state[enemySide].battlefield[laneIndex][target.row] : null;
  const attackerAtk = attacker.atk;
  const defenderRetaliate = defender ? defender.retaliate : 0;
  const defenderLifeBefore = defender ? defender.life : null;

  const res = attack(state, side, laneIndex, row, target);
  if (!res.ok) return null;

  const retaliated = defender !== null && defenderLifeBefore - attackerAtk > 0 && !isShooter;
  return {
    type: 'attack',
    side,
    card,
    laneIndex,
    row,
    target,
    attackerAtk,
    retaliateDamage: retaliated ? defenderRetaliate : 0,
    res,
  };
}

export function applyEndTurn(state) {
  const from = state.active;
  endTurn(state);
  return { type: 'endTurn', side: from };
}

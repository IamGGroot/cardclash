import { getCard, getHero } from './cards.js';
import { getValidAttackTargets, getValidMoveTargets } from './battle.js';
import { applyLevelUp, applySpecial, applyDeploy, applySpell, applyMove, applyAttack } from './actions.js';
import { effectiveAtk, effectiveRetaliate, effectiveLife } from './factionPerks.js';

function handCards(state, side) {
  return state[side].hand.map((cardId, idx) => ({ idx, cardId }));
}

export function chooseHeroAction(state, side) {
  const p = state[side];
  const hand = state[side].hand.map((cardId) => ({ card: getCard(cardId) }));
  const needsMight = hand.some((h) => h.card.type === 'creature' && h.card.requirement > p.might);
  const needsMagic = hand.some((h) => h.card.type === 'spell' && h.card.requirement > p.magic);
  const needsDestiny = hand.some((h) => h.card.type === 'fortune' && h.card.requirement > p.destiny);

  const attr = needsMight ? 'might' : needsMagic ? 'magic' : needsDestiny ? 'destiny' : null;
  if (attr) return applyLevelUp(state, side, attr);

  const hero = getHero(p.heroId);
  if (hero) return applySpecial(state, side, hero.special.id);
  return applyLevelUp(state, side, 'might');
}

export function* castSpellsAndFortunesSteps(state, side) {
  const enemySide = side === 'p1' ? 'p2' : 'p1';
  let acted = true;
  while (acted) {
    acted = false;
    const p = state[side];
    const hand = handCards(state, side).map(({ idx, cardId }) => ({ idx, card: getCard(cardId) }));
    for (const { idx, card } of hand) {
      if (card.type !== 'spell' && card.type !== 'fortune') continue;
      const attr = card.type === 'spell' ? 'magic' : 'destiny';
      if (card.cost > p.resource || p[attr] < card.requirement) continue;

      let target;
      if (card.target === 'enemy_creature') {
        target = bestEnemyTarget(state, enemySide, card.effect === 'destroy_creature' ? Infinity : card.value);
        if (!target) continue;
      } else if (card.target === 'enemy_any') {
        // Only worth targeting a creature if the hit actually finishes it off —
        // otherwise burning the enemy hero directly (undefined target) is better value.
        const candidate = bestEnemyTarget(state, enemySide, card.value);
        if (candidate) {
          const creature = state[enemySide].battlefield[candidate.laneIndex][candidate.row];
          if (effectiveLife(state, enemySide, creature) <= (card.value || 0)) target = candidate;
        }
      } else if (card.target === 'ally_creature') {
        target = card.effect.startsWith('heal_creature_') ? mostDamagedAllyTarget(state, side) : bestAllyTarget(state, side);
        if (!target) continue;
      }

      const step = applySpell(state, side, idx, target);
      if (step) {
        acted = true;
        yield step;
        break;
      }
    }
  }
}

// Highest raw threat (atk+life) among the opponent's creatures; a lethal option
// (life at or below killValue) is weighted heavily so a finishing blow wins out.
function bestEnemyTarget(state, enemySide, killValue) {
  const enemy = state[enemySide];
  let best = null;
  let bestScore = -Infinity;
  for (let laneIndex = 0; laneIndex < enemy.battlefield.length; laneIndex++) {
    for (const row of ['front', 'back']) {
      const creature = enemy.battlefield[laneIndex][row];
      if (!creature) continue;
      const atk = effectiveAtk(state, enemySide, creature);
      const life = effectiveLife(state, enemySide, creature);
      let score = atk * 2 + life;
      if (killValue !== undefined && life <= killValue) score += 1000;
      if (score > bestScore) {
        bestScore = score;
        best = { side: enemySide, laneIndex, row };
      }
    }
  }
  return best;
}

function bestAllyTarget(state, side) {
  const p = state[side];
  let best = null;
  let bestAtk = -Infinity;
  for (let laneIndex = 0; laneIndex < p.battlefield.length; laneIndex++) {
    for (const row of ['front', 'back']) {
      const creature = p.battlefield[laneIndex][row];
      if (!creature) continue;
      const atk = effectiveAtk(state, side, creature);
      if (atk > bestAtk) {
        bestAtk = atk;
        best = { side, laneIndex, row };
      }
    }
  }
  return best;
}

function mostDamagedAllyTarget(state, side) {
  const p = state[side];
  let best = null;
  let bestDeficit = 0;
  for (let laneIndex = 0; laneIndex < p.battlefield.length; laneIndex++) {
    for (const row of ['front', 'back']) {
      const creature = p.battlefield[laneIndex][row];
      if (!creature) continue;
      const deficit = creature.maxLife - creature.life;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = { side, laneIndex, row };
      }
    }
  }
  return best;
}

export function* deployCreaturesSteps(state, side) {
  let acted = true;
  while (acted) {
    acted = false;
    const p = state[side];
    const hand = handCards(state, side)
      .map(({ idx, cardId }) => ({ idx, card: getCard(cardId) }))
      .filter((h) => h.card.type === 'creature' && h.card.cost <= p.resource && p.might >= h.card.requirement)
      .sort((a, b) => b.card.cost - a.card.cost);

    for (const { idx, card } of hand) {
      const rowsToTry = card.placement === 'melee' ? ['front'] : card.placement === 'shooter' ? ['back'] : ['back', 'front'];
      let step = null;
      for (const row of rowsToTry) {
        for (let laneIndex = 0; laneIndex < p.battlefield.length; laneIndex++) {
          if (p.battlefield[laneIndex][row]) continue;
          step = applyDeploy(state, side, idx, laneIndex, row);
          if (step) break;
        }
        if (step) break;
      }
      if (step) {
        acted = true;
        yield step;
        break;
      }
    }
  }
}

function tryReposition(state, side, laneIndex, row, card) {
  const enemySide = side === 'p1' ? 'p2' : 'p1';
  const moveOptions = getValidMoveTargets(state, side, laneIndex, row, card.placement);
  const openLane = moveOptions.find((m) => {
    const enemyLane = state[enemySide].battlefield[m.laneIndex];
    return !enemyLane.front && !enemyLane.back;
  });
  if (!openLane) return null;
  return applyMove(state, side, laneIndex, row, openLane.laneIndex, openLane.row);
}

export function* runAttacksSteps(state, side) {
  const p = state[side];
  const enemySide = side === 'p1' ? 'p2' : 'p1';
  for (let laneIndex = 0; laneIndex < p.battlefield.length; laneIndex++) {
    for (const row of ['front', 'back']) {
      const creature = p.battlefield[laneIndex][row];
      if (!creature || !creature.canAttack) continue;
      const card = getCard(creature.cardId);
      const options = getValidAttackTargets(state, side, laneIndex, card.placement);
      if (!options.length) continue;

      const faceOption = options.find((o) => o.type === 'face');
      const creatureOptions = options.filter((o) => o.type === 'creature');
      const enemyLane = state[enemySide].battlefield[laneIndex];
      const isShooter = card.placement === 'shooter';
      const atk = effectiveAtk(state, side, creature);
      const life = effectiveLife(state, side, creature);

      // Best case: a hit that kills the defender outright.
      const killOption = creatureOptions.find(
        (o) => enemyLane[o.row] && atk >= effectiveLife(state, enemySide, enemyLane[o.row])
      );
      // Otherwise, only attack if it's safe — shooters never take retaliate,
      // melee/flyers only if they'd survive the defender's retaliate hit.
      const safeOption = creatureOptions.find(
        (o) => enemyLane[o.row] && (isShooter || life > effectiveRetaliate(state, enemySide, enemyLane[o.row]))
      );

      let target = faceOption || killOption || safeOption;

      if (!target && creatureOptions.length) {
        // Only a losing trade is on offer — reposition to an open lane instead
        // of throwing the creature away; if it can't move, just hold back.
        const step = tryReposition(state, side, laneIndex, row, card);
        if (step) yield step;
        continue;
      }

      if (target && state.winner === null) {
        const step = applyAttack(state, side, laneIndex, row, target);
        if (step) yield step;
      }
      if (state.winner) return;
    }
  }
}

// Drives one AI turn as a sequence of atomic, already-applied steps so the
// caller can animate/pause between them instead of only seeing the end result.
// side defaults to 'p2' (the AI opponent) but every step above is genuinely
// side-agnostic, so this doubles as a generic "play this side optimally for
// one turn" bot — see autoDeck.js, which reuses the pieces above directly
// with a per-turn card limit instead of calling this wrapper.
export function* runAiTurnSteps(state, side = 'p2') {
  const heroStep = chooseHeroAction(state, side);
  if (heroStep) yield heroStep;
  if (state.winner) return;

  yield* castSpellsAndFortunesSteps(state, side);
  if (state.winner) return;

  yield* deployCreaturesSteps(state, side);
  if (state.winner) return;

  yield* runAttacksSteps(state, side);
}

// Convenience wrapper for callers (tests, non-UI contexts) that just want the
// whole AI turn applied at once, without observing individual steps.
export function runAiTurn(state, side = 'p2') {
  for (const _step of runAiTurnSteps(state, side)) {
    // draining the generator applies every step synchronously
  }
}

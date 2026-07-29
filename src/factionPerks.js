import { getHero } from './cards.js';

// Each faction's passive battlefield aura. Purely a function of the current
// board — not a one-time trigger — so it turns on and off live as
// creatures are deployed, killed, or moved, for both sides independently.
// "ally" auras buff their own side; "enemy" auras (Umbra) project onto the
// opponent's side instead.
export const FACTION_PERKS = {
  albura: {
    id: 'albura',
    name: 'Vigilancia de Alba',
    icon: '🛡️',
    target: 'ally',
    stat: 'retaliate',
    amount: 2,
    text: '+2 Contraataque a tus criaturas mientras tengas 4 o más en el campo.',
  },
  ignara: {
    id: 'ignara',
    name: 'Furia de Ignara',
    icon: '🔥',
    target: 'ally',
    stat: 'atk',
    amount: 2,
    text: '+2 Ataque a tus criaturas mientras tengas 4 o más en el campo.',
  },
  umbra: {
    id: 'umbra',
    name: 'Sombra de Umbra',
    icon: '🌑',
    target: 'enemy',
    stat: 'atk_life',
    amount: -1,
    text: '-1 Ataque y Vida a las criaturas rivales mientras tengas 4 o más criaturas en el campo.',
  },
  terra: {
    id: 'terra',
    name: 'Bastión de Terra',
    icon: '⛰️',
    target: 'ally',
    stat: 'life',
    amount: 2,
    text: '+2 Vida a tus criaturas mientras tengas 4 o más en el campo.',
  },
};

const ACTIVATION_THRESHOLD = 4;

export function countFieldCreatures(player) {
  let n = 0;
  for (const lane of player.battlefield) {
    if (lane.front) n++;
    if (lane.back) n++;
  }
  return n;
}

// The perk belonging to `side`'s hero (by faction), plus whether it's
// currently active. Returns null for factions without a perk (neutral has
// no hero, so it never reaches here in practice).
export function getFactionPerk(state, side) {
  const p = state[side];
  const hero = getHero(p.heroId);
  const perk = hero && FACTION_PERKS[hero.faction];
  if (!perk) return null;
  return { ...perk, active: countFieldCreatures(p) >= ACTIVATION_THRESHOLD };
}

function applyPerkStat(mod, perk) {
  if (perk.stat === 'atk_life') {
    mod.atk += perk.amount;
    mod.life += perk.amount;
  } else {
    mod[perk.stat] += perk.amount;
  }
}

// Net {atk, retaliate, life} modifier every creature belonging to `side`
// currently receives: its own side's ally perk (if active) plus the
// opposing side's perk if that one projects onto opponents (Umbra).
export function getStatModifier(state, side) {
  const mod = { atk: 0, retaliate: 0, life: 0 };
  const own = getFactionPerk(state, side);
  if (own && own.active && own.target === 'ally') applyPerkStat(mod, own);
  const enemySide = side === 'p1' ? 'p2' : 'p1';
  const enemy = getFactionPerk(state, enemySide);
  if (enemy && enemy.active && enemy.target === 'enemy') applyPerkStat(mod, enemy);
  return mod;
}

// Effective (post-aura) combat stats for a creature belonging to `side`.
// The underlying instance fields (creature.atk/retaliate/life/maxLife)
// are never mutated by the aura — only by permanent buff/debuff effects —
// so these recompute fresh every time the board changes, and a perk
// turning off mid-fight can retroactively finish off a creature it was
// propping up (see cleanupBattlefield's fixed-point loop in battle.js).
export function effectiveAtk(state, side, creature) {
  return Math.max(0, creature.atk + getStatModifier(state, side).atk);
}

export function effectiveRetaliate(state, side, creature) {
  return Math.max(0, creature.retaliate + getStatModifier(state, side).retaliate);
}

export function effectiveLife(state, side, creature) {
  return creature.life + getStatModifier(state, side).life;
}

// A creature's current HP *ceiling* under the active aura — used to tell
// whether its life is genuinely buffed/nerfed (for UI coloring) as opposed
// to merely damaged, which also makes effectiveLife differ from the card's
// printed value but isn't a buff/nerf at all.
export function effectiveMaxLife(state, side, creature) {
  return creature.maxLife + getStatModifier(state, side).life;
}

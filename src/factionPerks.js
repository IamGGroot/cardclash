import { getCard } from './cards.js';

// Each faction's passive battlefield aura. Purely a function of the current
// board — not a one-time trigger — so it turns on and off live as
// creatures are deployed, killed, or moved, for both sides independently.
// "ally" auras buff their own side; "enemy" auras (Umbra) project onto the
// opponent's side instead.
//
// Activation is driven entirely by how many creatures of THAT faction a
// player has on the field — not by which hero they picked. Since deck
// building no longer requires a single faction (see store.js), a player can
// field enough creatures of two different factions at once to have two
// auras active simultaneously; the amounts below were halved from the old
// mono-faction-only design (where at most one aura could ever be active at
// a time) to keep a two-aura stack from just being strictly double the old
// max power.
export const FACTION_PERKS = {
  albura: {
    id: 'albura',
    name: 'Vigilancia de Alba',
    icon: '🛡️',
    target: 'ally',
    stat: 'retaliate',
    amount: 1,
    text: '+1 Contraataque a tus criaturas mientras tengas 4 o más de Albura en el campo.',
  },
  ignara: {
    id: 'ignara',
    name: 'Furia de Ignara',
    icon: '🔥',
    target: 'ally',
    stat: 'atk',
    amount: 1,
    text: '+1 Ataque a tus criaturas mientras tengas 4 o más de Ignara en el campo.',
  },
  umbra: {
    id: 'umbra',
    name: 'Sombra de Umbra',
    icon: '🌑',
    target: 'enemy',
    stat: 'atk_life',
    amount: -1,
    text: '-1 Ataque y Vida a las criaturas rivales mientras tengas 4 o más de Umbra en el campo.',
  },
  terra: {
    id: 'terra',
    name: 'Bastión de Terra',
    icon: '⛰️',
    target: 'ally',
    stat: 'life',
    amount: 1,
    text: '+1 Vida a tus criaturas mientras tengas 4 o más de Terra en el campo.',
  },
};

const DEFAULT_ACTIVATION_THRESHOLD = 4;

// Total creatures on the field, regardless of faction.
export function countFieldCreatures(player) {
  let n = 0;
  for (const lane of player.battlefield) {
    if (lane.front) n++;
    if (lane.back) n++;
  }
  return n;
}

// Per-faction breakdown of this player's own battlefield — neutral cards
// never count toward any faction's threshold, since they don't belong to
// one.
export function countFieldCreaturesByFaction(player) {
  const counts = {};
  for (const lane of player.battlefield) {
    for (const slot of [lane.front, lane.back]) {
      if (!slot) continue;
      const card = getCard(slot.cardId);
      if (!card || card.faction === 'neutral') continue;
      counts[card.faction] = (counts[card.faction] || 0) + 1;
    }
  }
  return counts;
}

// Every perk currently active for `side` — zero, one, or more at once. The
// activation threshold is normally 4, but battle.js's newGame can stamp a
// lower state.perkThreshold onto the match (Draft mode plays it at 2 — see
// src/draft.js).
export function getActiveFactionPerks(state, side) {
  const threshold = state.perkThreshold || DEFAULT_ACTIVATION_THRESHOLD;
  const counts = countFieldCreaturesByFaction(state[side]);
  return Object.values(FACTION_PERKS).filter((perk) => (counts[perk.id] || 0) >= threshold);
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
// currently receives: the sum of its own side's active ally perks, plus any
// of the opposing side's active perks that project onto opponents (Umbra).
export function getStatModifier(state, side) {
  const mod = { atk: 0, retaliate: 0, life: 0 };
  for (const perk of getActiveFactionPerks(state, side)) {
    if (perk.target === 'ally') applyPerkStat(mod, perk);
  }
  const enemySide = side === 'p1' ? 'p2' : 'p1';
  for (const perk of getActiveFactionPerks(state, enemySide)) {
    if (perk.target === 'enemy') applyPerkStat(mod, perk);
  }
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

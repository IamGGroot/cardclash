// Trophy ladder: online-only competitive progression, Clash Royale-style.
// This file is imported by BOTH the server (server/accounts.js, for the
// authoritative trophy math) and the client (src/ui.js, for the Liga screen
// and reward claiming) — same convention as src/battle.js/src/cards.js.
// Everything above the "client-only" marker below must stay pure/DOM-free.

export const TROPHY_WIN = 30;
export const TROPHY_LOSS = 24;

export const ARENAS = [
  { id: 'aldea', name: 'Aldea Novata', threshold: 0, icon: '🏕️' },
  { id: 'bastion', name: 'Bastión de Piedra', threshold: 300, icon: '🛡️' },
  { id: 'encrucijada', name: 'Encrucijada Errante', threshold: 700, icon: '🧭' },
  { id: 'torre', name: 'Torre Arcana', threshold: 1200, icon: '🔮' },
  { id: 'cripta', name: 'Cripta Umbría', threshold: 1800, icon: '💀' },
  { id: 'forja', name: 'Forja de Ignara', threshold: 2500, icon: '🔥' },
  { id: 'trono', name: 'Trono de Alba', threshold: 3300, icon: '⚜️' },
  { id: 'picos', name: 'Picos de Terra', threshold: 4200, icon: '⛰️' },
  { id: 'corona', name: 'Corona Eterna', threshold: 5200, icon: '👑' },
].map((a, i) => ({
  ...a,
  reward: {
    coins: 50 + i * 40,
    gems: i % 2 ? 15 + i * 5 : 0,
    dust: i % 3 === 2 ? 30 + i * 15 : 0,
    // Not every arena — only a handful of milestones past the early game
    // throw in a Draft/Torneo entry, escalating toward the top arena.
    ...(i === 3 || i === 7 ? { draftEntries: 1 } : {}),
    ...(i === 5 ? { tournamentEntries: 1 } : {}),
    ...(i === 8 ? { draftEntries: 1, tournamentEntries: 1 } : {}),
  },
}));

// Trophy road: besides the 9 big arena milestones above, Clash Royale-style
// ladders also hand out a small chest every few hundred trophies *within*
// each arena, so there's always a nearby reward to chase instead of one big
// gap. Fine-grained chest tiers are generated between each arena and the
// next at a fixed trophy interval; the arena's own milestone is folded into
// the same list (as a 'arena'-kind tier, id === arena.id, unchanged from
// before) so existing claimedTiers data for arena rewards keeps working.
const TIER_STEP = 100;

function buildChestReward(arenaIndex, stepIndex) {
  return {
    coins: 15 + arenaIndex * 8 + stepIndex * 2,
    gems: stepIndex % 3 === 0 ? 5 + arenaIndex * 2 : 0,
    dust: stepIndex % 4 === 0 ? 10 + arenaIndex * 4 : 0,
  };
}

function buildTiers() {
  const tiers = [];
  for (let i = 0; i < ARENAS.length; i++) {
    const arena = ARENAS[i];
    tiers.push({ id: arena.id, arenaId: arena.id, kind: 'arena', threshold: arena.threshold, icon: arena.icon, name: arena.name, reward: arena.reward });
    const next = ARENAS[i + 1];
    if (!next) continue;
    const steps = Math.floor((next.threshold - arena.threshold) / TIER_STEP);
    for (let s = 1; s < steps; s++) {
      tiers.push({
        id: `${arena.id}_t${s}`,
        arenaId: arena.id,
        kind: 'chest',
        threshold: arena.threshold + s * TIER_STEP,
        icon: '🎁',
        reward: buildChestReward(i, s),
      });
    }
  }
  return tiers;
}

export const TIERS = buildTiers();

export function getArenaIndex(trophies) {
  let idx = 0;
  for (let i = 0; i < ARENAS.length; i++) {
    if (ARENAS[i].threshold <= trophies) idx = i;
  }
  return idx;
}

export function getArena(trophies) {
  return ARENAS[getArenaIndex(trophies)];
}

// Once you've reached an arena, losses can never push you back out of it —
// only wins carry you further. Matches Clash Royale's "can't drop a league".
export function getArenaFloor(trophies) {
  return getArena(trophies).threshold;
}

// Pure: given trophies BEFORE the match and whether this side won, returns
// the new total and the delta actually applied (post-floor-clamp).
export function applyMatchResult(trophies, won) {
  const before = trophies || 0;
  if (won) return { trophies: before + TROPHY_WIN, delta: TROPHY_WIN };
  const after = Math.max(getArenaFloor(before), before - TROPHY_LOSS);
  return { trophies: after, delta: after - before };
}

// ---- Client-only below: touches `save`, never imported by the server ----

export function ensureLadderSave(save) {
  if (!save.ladder) save.ladder = { claimedTiers: [] };
  if (typeof save.trophies !== 'number') save.trophies = 0;
  return save.ladder;
}

export function syncTrophies(save, trophies) {
  ensureLadderSave(save);
  if (typeof trophies === 'number') save.trophies = trophies;
}

export function isTierClaimed(save, tierId) {
  return ensureLadderSave(save).claimedTiers.includes(tierId);
}

export function isTierClaimable(save, tierId) {
  const tier = TIERS.find((t) => t.id === tierId);
  if (!tier) return false;
  ensureLadderSave(save);
  return save.trophies >= tier.threshold && !isTierClaimed(save, tierId);
}

export function claimTierReward(save, tierId) {
  if (!isTierClaimable(save, tierId)) return { ok: false };
  const tier = TIERS.find((t) => t.id === tierId);
  save.coins += tier.reward.coins || 0;
  save.gems += tier.reward.gems || 0;
  save.dust = (save.dust || 0) + (tier.reward.dust || 0);
  save.draftEntries = (save.draftEntries || 0) + (tier.reward.draftEntries || 0);
  save.tournamentEntries = (save.tournamentEntries || 0) + (tier.reward.tournamentEntries || 0);
  save.ladder.claimedTiers.push(tierId);
  return { ok: true, reward: tier.reward };
}

export function countClaimable(save) {
  ensureLadderSave(save);
  return TIERS.filter((t) => isTierClaimable(save, t.id)).length;
}

export function getProgressToNextArena(save) {
  ensureLadderSave(save);
  const idx = getArenaIndex(save.trophies);
  const current = ARENAS[idx];
  const next = ARENAS[idx + 1] || null;
  if (!next) return { current, next: null, pct: 100 };
  const span = next.threshold - current.threshold;
  const into = save.trophies - current.threshold;
  return { current, next, pct: Math.min(100, Math.round((into / span) * 100)) };
}

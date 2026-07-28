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
  reward: { coins: 50 + i * 40, gems: i % 2 ? 15 + i * 5 : 0, dust: i % 3 === 2 ? 30 + i * 15 : 0 },
}));

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

export function isTierClaimed(save, arenaId) {
  return ensureLadderSave(save).claimedTiers.includes(arenaId);
}

export function isTierClaimable(save, arenaId) {
  const arena = ARENAS.find((a) => a.id === arenaId);
  if (!arena) return false;
  ensureLadderSave(save);
  return save.trophies >= arena.threshold && !isTierClaimed(save, arenaId);
}

export function claimTierReward(save, arenaId) {
  if (!isTierClaimable(save, arenaId)) return { ok: false };
  const arena = ARENAS.find((a) => a.id === arenaId);
  save.coins += arena.reward.coins || 0;
  save.gems += arena.reward.gems || 0;
  save.dust = (save.dust || 0) + (arena.reward.dust || 0);
  save.ladder.claimedTiers.push(arenaId);
  return { ok: true, reward: arena.reward };
}

export function countClaimable(save) {
  ensureLadderSave(save);
  return ARENAS.filter((a) => isTierClaimable(save, a.id)).length;
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

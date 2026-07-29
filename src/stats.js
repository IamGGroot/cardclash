// Lifetime (never-reset) stat counters backing permanent achievements
// (src/achievements.js) — deliberately separate from src/missions.js's
// `save.missions.progress`, which is wiped every day. Any module can bump a
// counter here without needing to know about achievements.js at all.
// Pure/DOM-free, safe to import from anywhere.

export function ensureStats(save) {
  if (!save.stats) save.stats = {};
  return save.stats;
}

export function bumpStat(save, key, amount = 1) {
  if (amount <= 0) return;
  ensureStats(save);
  save.stats[key] = (save.stats[key] || 0) + amount;
}

// For "peak" style stats (e.g. highest trophies ever reached) that must
// never go down even though the underlying value can.
export function bumpStatMax(save, key, value) {
  ensureStats(save);
  save.stats[key] = Math.max(save.stats[key] || 0, value);
}

export function getStat(save, key) {
  ensureStats(save);
  return save.stats[key] || 0;
}

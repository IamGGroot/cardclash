const SEASON_LENGTH_DAYS = 14;
const XP_PER_LEVEL = 100;
const MAX_LEVEL = 30;

// XP granted per source — missions feed the pass on top of just playing
// matches, so both "grind dailies" and "just play" players make progress.
export const XP_REWARDS = {
  matchWin: 15,
  matchLoss: 5,
  missionEasy: 10,
  missionMedium: 20,
  missionHard: 35,
};

function buildRewards() {
  const rewards = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const milestone = level % 10 === 0;
    const free = { coins: 20 + level * 2 };
    if (level % 5 === 0) free.dust = 15;

    const premium = { coins: 30 + level * 3, gems: 8 + Math.floor(level / 2) };
    if (level % 5 === 0) premium.dust = 40;
    if (milestone) {
      premium.gems += 50;
      premium.dust = (premium.dust || 0) + 100;
      // The premium track's big every-10-levels milestones also throw in a
      // Draft/Torneo entry — level 30 (the very top of the pass) gives one
      // of each instead of picking just one.
      if (level === 30) {
        premium.draftEntries = 1;
        premium.tournamentEntries = 1;
      } else if (level === 20) {
        premium.tournamentEntries = 1;
      } else {
        premium.draftEntries = 1;
      }
    }

    rewards.push({ level, free, premium });
  }
  return rewards;
}

export const REWARDS = buildRewards();
export const CONSTANTS = { SEASON_LENGTH_DAYS, XP_PER_LEVEL, MAX_LEVEL };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

export function ensureSeasonPass(save) {
  const today = todayStr();
  const sp = save.seasonPass;
  if (!sp || daysBetween(sp.startDate, today) >= SEASON_LENGTH_DAYS) {
    save.seasonPass = { startDate: today, xp: 0, premiumUnlocked: false, claimedFree: [], claimedPremium: [] };
  }
  return save.seasonPass;
}

export function daysRemaining(save) {
  const sp = ensureSeasonPass(save);
  return Math.max(0, SEASON_LENGTH_DAYS - daysBetween(sp.startDate, todayStr()));
}

export function getLevel(save) {
  const sp = ensureSeasonPass(save);
  return Math.min(MAX_LEVEL, Math.floor(sp.xp / XP_PER_LEVEL) + 1);
}

export function getLevelProgress(save) {
  const sp = ensureSeasonPass(save);
  const level = getLevel(save);
  if (level >= MAX_LEVEL) return { current: XP_PER_LEVEL, target: XP_PER_LEVEL };
  return { current: sp.xp % XP_PER_LEVEL, target: XP_PER_LEVEL };
}

export function addSeasonXp(save, amount) {
  if (amount <= 0) return;
  const sp = ensureSeasonPass(save);
  sp.xp = Math.min(sp.xp + amount, MAX_LEVEL * XP_PER_LEVEL);
}

export function isPremiumUnlocked(save) {
  return ensureSeasonPass(save).premiumUnlocked;
}

// Deliberately not gem-purchasable — the premium track is a real-money
// unlock (see economy.js SEASON_PASS_SKU + ui.js's mock-purchase flow), the
// same "real money only" boundary the coin/gem/dust SKUs already draw
// around themselves. This just flips the flag once payment has "happened".
export function unlockPremium(save) {
  const sp = ensureSeasonPass(save);
  if (sp.premiumUnlocked) return { ok: false };
  sp.premiumUnlocked = true;
  return { ok: true };
}

export function isRewardClaimed(save, level, track) {
  const sp = ensureSeasonPass(save);
  return (track === 'premium' ? sp.claimedPremium : sp.claimedFree).includes(level);
}

export function isRewardClaimable(save, level, track) {
  const sp = ensureSeasonPass(save);
  if (level > getLevel(save)) return false;
  if (track === 'premium' && !sp.premiumUnlocked) return false;
  return !isRewardClaimed(save, level, track);
}

export function claimReward(save, level, track) {
  if (!isRewardClaimable(save, level, track)) return { ok: false };
  const sp = ensureSeasonPass(save);
  const entry = REWARDS.find((r) => r.level === level);
  if (!entry) return { ok: false };
  const reward = track === 'premium' ? entry.premium : entry.free;
  save.coins += reward.coins || 0;
  save.gems += reward.gems || 0;
  save.dust = (save.dust || 0) + (reward.dust || 0);
  save.draftEntries = (save.draftEntries || 0) + (reward.draftEntries || 0);
  save.tournamentEntries = (save.tournamentEntries || 0) + (reward.tournamentEntries || 0);
  (track === 'premium' ? sp.claimedPremium : sp.claimedFree).push(level);
  return { ok: true, reward };
}

export function countClaimable(save) {
  const sp = ensureSeasonPass(save);
  const level = getLevel(save);
  let count = 0;
  for (let l = 1; l <= level; l++) {
    if (!sp.claimedFree.includes(l)) count++;
    if (sp.premiumUnlocked && !sp.claimedPremium.includes(l)) count++;
  }
  return count;
}

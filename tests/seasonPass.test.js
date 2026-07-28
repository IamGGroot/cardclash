import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  REWARDS,
  CONSTANTS,
  ensureSeasonPass,
  daysRemaining,
  getLevel,
  getLevelProgress,
  addSeasonXp,
  isPremiumUnlocked,
  unlockPremium,
  isRewardClaimed,
  isRewardClaimable,
  claimReward,
  countClaimable,
} from '../src/seasonPass.js';

function bareSave() {
  return { coins: 0, gems: 1000, dust: 0 };
}

describe('season lifecycle', () => {
  test('a fresh save starts a season today at level 1 with nothing claimed', () => {
    const save = bareSave();
    const sp = ensureSeasonPass(save);
    assert.equal(sp.startDate, new Date().toISOString().slice(0, 10));
    assert.equal(sp.xp, 0);
    assert.equal(sp.premiumUnlocked, false);
    assert.equal(getLevel(save), 1);
    assert.equal(daysRemaining(save), CONSTANTS.SEASON_LENGTH_DAYS);
  });

  test('a season older than SEASON_LENGTH_DAYS resets xp, premium, and claims', () => {
    const old = new Date();
    old.setDate(old.getDate() - (CONSTANTS.SEASON_LENGTH_DAYS + 1));
    const save = {
      ...bareSave(),
      seasonPass: {
        startDate: old.toISOString().slice(0, 10),
        xp: 500,
        premiumUnlocked: true,
        claimedFree: [1, 2],
        claimedPremium: [1],
      },
    };
    ensureSeasonPass(save);
    assert.equal(save.seasonPass.xp, 0);
    assert.equal(save.seasonPass.premiumUnlocked, false);
    assert.deepEqual(save.seasonPass.claimedFree, []);
    assert.deepEqual(save.seasonPass.claimedPremium, []);
  });

  test('a season within its window is left untouched', () => {
    const save = bareSave();
    ensureSeasonPass(save);
    addSeasonXp(save, 250);
    ensureSeasonPass(save);
    assert.equal(save.seasonPass.xp, 250);
  });
});

describe('xp and leveling', () => {
  test('getLevel advances every XP_PER_LEVEL xp, starting at level 1 with 0 xp', () => {
    const save = bareSave();
    assert.equal(getLevel(save), 1);
    addSeasonXp(save, CONSTANTS.XP_PER_LEVEL);
    assert.equal(getLevel(save), 2);
    addSeasonXp(save, CONSTANTS.XP_PER_LEVEL * 3);
    assert.equal(getLevel(save), 5);
  });

  test('level is capped at MAX_LEVEL no matter how much xp accrues', () => {
    const save = bareSave();
    addSeasonXp(save, CONSTANTS.XP_PER_LEVEL * 999);
    assert.equal(getLevel(save), CONSTANTS.MAX_LEVEL);
  });

  test('xp itself is also capped, not just the reported level', () => {
    const save = bareSave();
    addSeasonXp(save, CONSTANTS.XP_PER_LEVEL * 999);
    assert.equal(save.seasonPass.xp, CONSTANTS.MAX_LEVEL * CONSTANTS.XP_PER_LEVEL);
  });

  test('a non-positive xp amount is a no-op', () => {
    const save = bareSave();
    addSeasonXp(save, 0);
    addSeasonXp(save, -10);
    assert.equal(save.seasonPass?.xp ?? 0, 0);
  });

  test('getLevelProgress reports xp within the current level, resetting each level', () => {
    const save = bareSave();
    addSeasonXp(save, 30);
    assert.deepEqual(getLevelProgress(save), { current: 30, target: CONSTANTS.XP_PER_LEVEL });
    addSeasonXp(save, CONSTANTS.XP_PER_LEVEL); // crosses into level 2
    assert.deepEqual(getLevelProgress(save), { current: 30, target: CONSTANTS.XP_PER_LEVEL });
  });

  test('getLevelProgress shows a full bar at the max level', () => {
    const save = bareSave();
    addSeasonXp(save, CONSTANTS.XP_PER_LEVEL * 999);
    const progress = getLevelProgress(save);
    assert.equal(progress.current, progress.target);
  });
});

describe('premium unlock', () => {
  test('unlocking flips the flag without touching gems — this is a real-money unlock, not a gem sink', () => {
    const save = bareSave();
    const res = unlockPremium(save);
    assert.equal(res.ok, true);
    assert.equal(isPremiumUnlocked(save), true);
    assert.equal(save.gems, 1000, 'gems must be untouched');
  });

  test('cannot unlock twice', () => {
    const save = bareSave();
    unlockPremium(save);
    const res = unlockPremium(save);
    assert.equal(res.ok, false);
  });

  test('unlocking works even with zero gems, since it never spends them', () => {
    const save = { ...bareSave(), gems: 0 };
    const res = unlockPremium(save);
    assert.equal(res.ok, true);
    assert.equal(save.gems, 0);
  });
});

describe('claiming rewards', () => {
  test('the free track reward at level 1 is claimable from the start', () => {
    const save = bareSave();
    assert.equal(isRewardClaimable(save, 1, 'free'), true);
  });

  test('a level above the player\'s current level is not claimable', () => {
    const save = bareSave();
    assert.equal(isRewardClaimable(save, 5, 'free'), false);
  });

  test('the premium track is locked until premium is unlocked, even at reachable levels', () => {
    const save = bareSave();
    assert.equal(isRewardClaimable(save, 1, 'premium'), false);
    unlockPremium(save);
    assert.equal(isRewardClaimable(save, 1, 'premium'), true);
  });

  test('claimReward grants the reward, marks it claimed, and blocks a second claim', () => {
    const save = bareSave();
    const before = { coins: save.coins, gems: save.gems, dust: save.dust };
    const res = claimReward(save, 1, 'free');
    assert.equal(res.ok, true);
    const reward = REWARDS.find((r) => r.level === 1).free;
    assert.equal(save.coins, before.coins + (reward.coins || 0));
    assert.equal(save.gems, before.gems + (reward.gems || 0));
    assert.equal(save.dust, before.dust + (reward.dust || 0));
    assert.equal(isRewardClaimed(save, 1, 'free'), true);
    assert.equal(claimReward(save, 1, 'free').ok, false, 'a second claim must be rejected');
  });

  test('free and premium claims at the same level are independent', () => {
    const save = bareSave();
    unlockPremium(save);
    claimReward(save, 1, 'free');
    assert.equal(isRewardClaimed(save, 1, 'premium'), false);
    assert.equal(isRewardClaimable(save, 1, 'premium'), true);
  });

  test('countClaimable counts every unclaimed reward up to the current level, both tracks once premium is unlocked', () => {
    const save = bareSave();
    addSeasonXp(save, CONSTANTS.XP_PER_LEVEL * 2); // level 3
    assert.equal(countClaimable(save), 3, 'free-only: levels 1-3');
    unlockPremium(save);
    assert.equal(countClaimable(save), 6, 'free + premium across levels 1-3');
    claimReward(save, 1, 'free');
    assert.equal(countClaimable(save), 5);
  });
});

describe('reward catalog sanity', () => {
  test('every level from 1 to MAX_LEVEL has a reward entry', () => {
    assert.equal(REWARDS.length, CONSTANTS.MAX_LEVEL);
    for (let level = 1; level <= CONSTANTS.MAX_LEVEL; level++) {
      assert.ok(REWARDS.some((r) => r.level === level), `missing reward for level ${level}`);
    }
  });

  test('every premium reward is worth at least as much as its free counterpart at the same level', () => {
    for (const entry of REWARDS) {
      const freeValue = (entry.free.coins || 0) + (entry.free.gems || 0) * 10 + (entry.free.dust || 0);
      const premiumValue = (entry.premium.coins || 0) + (entry.premium.gems || 0) * 10 + (entry.premium.dust || 0);
      assert.ok(premiumValue > freeValue, `level ${entry.level} premium reward should outvalue free`);
    }
  });
});

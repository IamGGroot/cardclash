import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACH_SECTIONS,
  ACHIEVEMENTS,
  getStatValue,
  getAchievementProgress,
  isAchievementComplete,
  isAchievementClaimed,
  claimAchievement,
  countClaimable,
  countClaimableInSection,
  getChainTiers,
  getActiveChainTier,
  getSectionChains,
} from '../src/achievements.js';
import { bumpStat } from '../src/stats.js';

function freshSave() {
  return { coins: 0, gems: 0, dust: 0, collection: {} };
}

describe('achievement catalog integrity', () => {
  test('every achievement belongs to a real section and has a positive-coins-or-other reward', () => {
    for (const a of ACHIEVEMENTS) {
      assert.ok(ACH_SECTIONS[a.category], `${a.id} references unknown category ${a.category}`);
      const r = a.reward;
      assert.ok((r.coins || 0) + (r.gems || 0) + (r.dust || 0) + (r.draftEntries || 0) + (r.tournamentEntries || 0) > 0, `${a.id} has an empty reward`);
    }
  });

  test('every id is unique', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('at least 5 sections, each with 20-30 achievements', () => {
    const sectionIds = Object.keys(ACH_SECTIONS);
    assert.ok(sectionIds.length >= 5, `expected at least 5 sections, got ${sectionIds.length}`);
    for (const id of sectionIds) {
      const count = ACHIEVEMENTS.filter((a) => a.category === id).length;
      assert.ok(count >= 20 && count <= 30, `section ${id} has ${count} achievements, expected 20-30`);
    }
  });

  test('every chain has exactly 5 tiers with strictly increasing targets and rewards', () => {
    const chainIds = [...new Set(ACHIEVEMENTS.map((a) => a.chain))];
    for (const chainId of chainIds) {
      const tiers = getChainTiers(chainId);
      assert.equal(tiers.length, 5, `chain ${chainId} must have exactly 5 tiers`);
      for (let i = 1; i < tiers.length; i++) {
        assert.ok(tiers[i].target > tiers[i - 1].target, `chain ${chainId} tier ${i + 1} target must exceed tier ${i}`);
        assert.equal(tiers[i].tier, i + 1);
      }
    }
  });

  test('the 5th tier of every chain is meaningfully harder than the 1st (at least 10x the target)', () => {
    // coll_archive (own every card) and league_seasonlevel (hit the season
    // pass's own level cap) are bounded by real limits elsewhere in the
    // game (118 total cards, MAX_LEVEL 30) — their tier 5 IS the hardest
    // reachable milestone even though the multiplier looks smaller.
    const cappedByGameLimit = new Set(['coll_archive', 'league_seasonlevel']);
    const chainIds = [...new Set(ACHIEVEMENTS.map((a) => a.chain))];
    for (const chainId of chainIds) {
      const tiers = getChainTiers(chainId);
      const minRatio = cappedByGameLimit.has(chainId) ? 5 : 10;
      assert.ok(
        tiers[4].target >= tiers[0].target * minRatio,
        `chain ${chainId}'s tier 5 (${tiers[4].target}) should be a serious grind vs tier 1 (${tiers[0].target})`
      );
    }
  });
});

describe('getStatValue', () => {
  test('reads a plain counter straight from save.stats', () => {
    const save = freshSave();
    bumpStat(save, 'battles', 7);
    assert.equal(getStatValue(save, 'battles'), 7);
  });

  test('computes collectionSize live from save.collection, no counter needed', () => {
    const save = freshSave();
    save.collection = { a1: 2, a2: 1, a3: 0 };
    assert.equal(getStatValue(save, 'collectionSize'), 2); // a3 has 0 copies, doesn't count
  });
});

describe('progress / claim lifecycle', () => {
  test('a tier is not complete until its stat reaches the target', () => {
    const save = freshSave();
    const tier1 = getChainTiers('combat_veteran')[0];
    bumpStat(save, 'battles', tier1.target - 1);
    assert.equal(isAchievementComplete(save, tier1), false);
    bumpStat(save, 'battles', 1);
    assert.equal(isAchievementComplete(save, tier1), true);
  });

  test('claiming grants the reward once and marks it claimed permanently', () => {
    const save = freshSave();
    const tier1 = getChainTiers('combat_veteran')[0];
    bumpStat(save, 'battles', tier1.target);
    const res = claimAchievement(save, tier1.id);
    assert.equal(res.ok, true);
    assert.equal(save.coins, tier1.reward.coins);
    assert.equal(isAchievementClaimed(save, tier1.id), true);

    const again = claimAchievement(save, tier1.id);
    assert.equal(again.ok, false);
    assert.equal(save.coins, tier1.reward.coins, 'reward must not be granted twice');
  });

  test('claiming does NOT reset stat progress — unlike daily missions, achievements never roll back', () => {
    const save = freshSave();
    const tier1 = getChainTiers('combat_veteran')[0];
    bumpStat(save, 'battles', tier1.target);
    claimAchievement(save, tier1.id);
    assert.equal(getStatValue(save, 'battles'), tier1.target);
  });

  test('getActiveChainTier returns the first unclaimed tier, so the chain is progressive', () => {
    const save = freshSave();
    const tiers = getChainTiers('combat_veteran');
    bumpStat(save, 'battles', tiers[4].target); // enough to complete every tier at once
    assert.equal(getActiveChainTier(save, 'combat_veteran').id, tiers[0].id, 'tier 1 must be claimed before tier 2 unlocks as active');
    claimAchievement(save, tiers[0].id);
    assert.equal(getActiveChainTier(save, 'combat_veteran').id, tiers[1].id);
  });

  test('a tier claimable via one chain does not unlock a claim on an unrelated chain', () => {
    const save = freshSave();
    const veteranTier1 = getChainTiers('combat_veteran')[0];
    bumpStat(save, 'battles', veteranTier1.target);
    const championTier1 = getChainTiers('combat_champion')[0];
    assert.equal(isAchievementComplete(save, championTier1), false);
  });

  test('an override value (e.g. seasonPassLevel, which is computed outside save.stats) is honored over the stat lookup', () => {
    const save = freshSave();
    const tier1 = getChainTiers('league_seasonlevel')[0];
    const res = claimAchievement(save, tier1.id, { seasonPassLevel: tier1.target });
    assert.equal(res.ok, true);
  });

  test('countClaimable and countClaimableInSection agree with a manual scan', () => {
    const save = freshSave();
    bumpStat(save, 'battles', 999999);
    bumpStat(save, 'wins', 999999);
    const manualCombat = ACHIEVEMENTS.filter((a) => a.category === 'combat' && isAchievementComplete(save, a) && !isAchievementClaimed(save, a.id)).length;
    assert.equal(countClaimableInSection(save, 'combat'), manualCombat);
    assert.ok(countClaimable(save) >= manualCombat);
  });

  test('getSectionChains groups every achievement in a category into its chains, none missing', () => {
    const chains = getSectionChains('collection');
    const total = chains.reduce((sum, tiers) => sum + tiers.length, 0);
    const expected = ACHIEVEMENTS.filter((a) => a.category === 'collection').length;
    assert.equal(total, expected);
  });
});

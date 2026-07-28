import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSIONS,
  MISSION_CATEGORIES,
  DIFFICULTY_WEIGHT,
  ensureDailyMissions,
  getMissionProgress,
  isMissionComplete,
  isMissionClaimed,
  addMissionProgress,
  claimMission,
  countClaimable,
  getCategoryProgress,
  getOverallProgress,
} from '../src/missions.js';

function bareSave() {
  return { coins: 0, gems: 0 };
}

describe('daily reset', () => {
  test('a fresh save gets today\'s date with empty progress and no claims', () => {
    const save = bareSave();
    const m = ensureDailyMissions(save);
    assert.equal(m.date, new Date().toISOString().slice(0, 10));
    assert.deepEqual(m.progress, {});
    assert.deepEqual(m.claimed, []);
  });

  test('a stale date wipes progress and claims for the new day', () => {
    const save = { ...bareSave(), missions: { date: '2000-01-01', progress: { battles: 5 }, claimed: ['play_1_match'] } };
    ensureDailyMissions(save);
    assert.notEqual(save.missions.date, '2000-01-01');
    assert.deepEqual(save.missions.progress, {});
    assert.deepEqual(save.missions.claimed, []);
  });

  test('the same day is left untouched across repeated calls', () => {
    const save = bareSave();
    ensureDailyMissions(save);
    addMissionProgress(save, 'battles', 1);
    ensureDailyMissions(save);
    assert.equal(save.missions.progress.battles, 1);
  });
});

describe('progress tracking', () => {
  test('addMissionProgress accumulates and getMissionProgress clamps at the mission target', () => {
    const save = bareSave();
    const mission = MISSIONS.find((m) => m.statKey === 'battles');
    addMissionProgress(save, 'battles', 1);
    assert.equal(getMissionProgress(save, mission), 1);
    addMissionProgress(save, 'battles', 999);
    assert.equal(getMissionProgress(save, mission), mission.target, 'progress must not exceed the mission target');
  });

  test('a non-positive amount is a no-op', () => {
    const save = bareSave();
    addMissionProgress(save, 'battles', 0);
    addMissionProgress(save, 'battles', -5);
    assert.equal(save.missions.progress.battles ?? 0, 0);
  });

  test('isMissionComplete reflects whether progress has reached the target', () => {
    const save = bareSave();
    const mission = MISSIONS.find((m) => m.target > 1);
    assert.equal(isMissionComplete(save, mission), false);
    addMissionProgress(save, mission.statKey, mission.target);
    assert.equal(isMissionComplete(save, mission), true);
  });

  test('two missions sharing a statKey both track off the same counter', () => {
    const save = bareSave();
    const shared = MISSIONS.filter((m) => m.statKey === 'packsOpened');
    assert.ok(shared.length >= 2, 'expected multiple missions keyed on packsOpened');
    addMissionProgress(save, 'packsOpened', 1);
    assert.equal(isMissionComplete(save, shared[0]), true, 'the easier one should already be done');
  });
});

describe('claiming', () => {
  test('cannot claim an incomplete mission', () => {
    const save = bareSave();
    const mission = MISSIONS[0];
    assert.equal(claimMission(save, mission.id), false);
    assert.equal(save.coins, 0);
  });

  test('claiming a completed mission grants its reward exactly once', () => {
    const save = bareSave();
    const mission = MISSIONS.find((m) => m.reward.coins && m.reward.gems);
    addMissionProgress(save, mission.statKey, mission.target);
    assert.equal(claimMission(save, mission.id), true);
    assert.equal(save.coins, mission.reward.coins);
    assert.equal(save.gems, mission.reward.gems);
    assert.equal(claimMission(save, mission.id), false, 'a second claim must be rejected');
    assert.equal(save.coins, mission.reward.coins, 'reward must not be granted twice');
  });

  test('claiming an unknown mission id is a safe no-op', () => {
    const save = bareSave();
    assert.equal(claimMission(save, 'not-a-real-mission'), false);
  });

  test('isMissionClaimed reflects claim state', () => {
    const save = bareSave();
    const mission = MISSIONS[0];
    addMissionProgress(save, mission.statKey, mission.target);
    assert.equal(isMissionClaimed(save, mission), false);
    claimMission(save, mission.id);
    assert.equal(isMissionClaimed(save, mission), true);
  });

  test('countClaimable counts only completed, unclaimed missions', () => {
    const save = bareSave();
    assert.equal(countClaimable(save), 0);
    const [first, second] = MISSIONS;
    addMissionProgress(save, first.statKey, first.target);
    addMissionProgress(save, second.statKey, second.target);
    assert.equal(countClaimable(save), 2);
    claimMission(save, first.id);
    assert.equal(countClaimable(save), 1);
  });
});

describe('mission catalog sanity', () => {
  test('every mission has a unique id', () => {
    const ids = MISSIONS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every mission grants at least one currency', () => {
    for (const m of MISSIONS) {
      assert.ok((m.reward.coins || 0) + (m.reward.gems || 0) > 0, `${m.id} grants no reward`);
    }
  });

  test('every mission belongs to a known category', () => {
    for (const m of MISSIONS) {
      assert.ok(['combat', 'collection', 'economy'].includes(m.category), `${m.id} has unknown category`);
    }
  });
});

describe('weighted progress bars', () => {
  test('getCategoryProgress target equals the sum of that category\'s mission weights', () => {
    const save = bareSave();
    for (const cat of Object.keys(MISSION_CATEGORIES)) {
      const missions = MISSIONS.filter((m) => m.category === cat);
      const expectedTarget = missions.reduce((sum, m) => sum + DIFFICULTY_WEIGHT[m.difficulty], 0);
      assert.equal(getCategoryProgress(save, cat).target, expectedTarget);
    }
  });

  test('claiming a mission fills its category bar by that mission\'s difficulty weight', () => {
    const save = bareSave();
    const mission = MISSIONS.find((m) => m.category === 'combat');
    const before = getCategoryProgress(save, 'combat').current;
    addMissionProgress(save, mission.statKey, mission.target);
    claimMission(save, mission.id);
    const after = getCategoryProgress(save, 'combat').current;
    assert.equal(after - before, DIFFICULTY_WEIGHT[mission.difficulty]);
  });

  test('completing but not claiming a mission does not move its category bar', () => {
    const save = bareSave();
    const mission = MISSIONS[0];
    addMissionProgress(save, mission.statKey, mission.target);
    assert.equal(isMissionComplete(save, mission), true);
    assert.equal(getCategoryProgress(save, mission.category).current, 0);
  });

  test('a category with everything claimed reports current === target', () => {
    const save = bareSave();
    for (const m of MISSIONS.filter((m) => m.category === 'economy')) {
      addMissionProgress(save, m.statKey, m.target);
      claimMission(save, m.id);
    }
    const progress = getCategoryProgress(save, 'economy');
    assert.equal(progress.current, progress.target);
  });

  test('getOverallProgress target equals the sum of every mission\'s weight, across all categories', () => {
    const save = bareSave();
    const expectedTarget = MISSIONS.reduce((sum, m) => sum + DIFFICULTY_WEIGHT[m.difficulty], 0);
    assert.equal(getOverallProgress(save).target, expectedTarget);
  });

  test('getOverallProgress current sums claimed weight across every category, not just one', () => {
    const save = bareSave();
    const fromEachCategory = Object.keys(MISSION_CATEGORIES).map((cat) => MISSIONS.find((m) => m.category === cat));
    let expected = 0;
    for (const m of fromEachCategory) {
      addMissionProgress(save, m.statKey, m.target);
      claimMission(save, m.id);
      expected += DIFFICULTY_WEIGHT[m.difficulty];
    }
    assert.equal(getOverallProgress(save).current, expected);
  });
});

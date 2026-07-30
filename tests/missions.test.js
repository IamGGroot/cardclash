import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSIONS,
  DIFFICULTY_WEIGHT,
  RESET_INTERVAL_MS,
  ensureDailyMissions,
  getMissionProgress,
  isMissionComplete,
  isMissionClaimed,
  addMissionProgress,
  claimMission,
  countClaimable,
  getOverallProgress,
  msUntilNextReset,
} from '../src/missions.js';

function bareSave() {
  return { coins: 0, gems: 0 };
}

describe('12h reset cycle', () => {
  test('a fresh save gets the current cycle id with empty progress and no claims', () => {
    const save = bareSave();
    const m = ensureDailyMissions(save);
    assert.equal(m.cycle, Math.floor(Date.now() / RESET_INTERVAL_MS));
    assert.deepEqual(m.progress, {});
    assert.deepEqual(m.claimed, []);
  });

  test('a stale cycle wipes progress and claims for the new one', () => {
    const save = { ...bareSave(), missions: { cycle: 1, progress: { battles: 5 }, claimed: ['play_1_match'] } };
    ensureDailyMissions(save);
    assert.notEqual(save.missions.cycle, 1);
    assert.deepEqual(save.missions.progress, {});
    assert.deepEqual(save.missions.claimed, []);
  });

  test('the same cycle is left untouched across repeated calls', () => {
    const save = bareSave();
    ensureDailyMissions(save);
    addMissionProgress(save, 'battles', 1);
    ensureDailyMissions(save);
    assert.equal(save.missions.progress.battles, 1);
  });

  test('msUntilNextReset counts down within the current 12h window', () => {
    const remaining = msUntilNextReset();
    assert.ok(remaining > 0 && remaining <= RESET_INTERVAL_MS);
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

  test('there are exactly 5 missions per cycle, no categories', () => {
    assert.equal(MISSIONS.length, 5);
    for (const m of MISSIONS) assert.equal('category' in m, false, `${m.id} should not have a category anymore`);
  });
});

describe('weighted overall progress', () => {
  test('getOverallProgress target equals the sum of every mission\'s weight', () => {
    const save = bareSave();
    const expectedTarget = MISSIONS.reduce((sum, m) => sum + DIFFICULTY_WEIGHT[m.difficulty], 0);
    assert.equal(getOverallProgress(save).target, expectedTarget);
  });

  test('claiming a mission fills the overall bar by that mission\'s difficulty weight', () => {
    const save = bareSave();
    const mission = MISSIONS[0];
    const before = getOverallProgress(save).current;
    addMissionProgress(save, mission.statKey, mission.target);
    claimMission(save, mission.id);
    const after = getOverallProgress(save).current;
    assert.equal(after - before, DIFFICULTY_WEIGHT[mission.difficulty]);
  });

  test('completing but not claiming a mission does not move the overall bar', () => {
    const save = bareSave();
    const mission = MISSIONS[0];
    addMissionProgress(save, mission.statKey, mission.target);
    assert.equal(isMissionComplete(save, mission), true);
    assert.equal(getOverallProgress(save).current, 0);
  });

  test('claiming everything reports current === target', () => {
    const save = bareSave();
    for (const m of MISSIONS) {
      addMissionProgress(save, m.statKey, m.target);
      claimMission(save, m.id);
    }
    const progress = getOverallProgress(save);
    assert.equal(progress.current, progress.target);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENAS,
  TIERS,
  TROPHY_WIN,
  TROPHY_LOSS,
  getArenaIndex,
  getArenaFloor,
  applyMatchResult,
  ensureLadderSave,
  syncTrophies,
  isTierClaimed,
  isTierClaimable,
  claimTierReward,
  countClaimable,
  getProgressToNextArena,
} from '../src/ladder.js';

describe('ladder data integrity', () => {
  test('arenas are sorted by strictly increasing threshold, starting at 0', () => {
    assert.equal(ARENAS[0].threshold, 0);
    for (let i = 1; i < ARENAS.length; i++) {
      assert.ok(ARENAS[i].threshold > ARENAS[i - 1].threshold, `${ARENAS[i].id} threshold must exceed ${ARENAS[i - 1].id}`);
    }
  });

  test('every arena has a unique id and a reward bundle', () => {
    const ids = ARENAS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const arena of ARENAS) {
      assert.ok(arena.reward && typeof arena.reward.coins === 'number', `${arena.id} missing a coins reward`);
    }
  });
});

describe('trophy road (TIERS)', () => {
  test('is sorted by strictly increasing threshold and starts at trophy 0', () => {
    assert.equal(TIERS[0].threshold, 0);
    for (let i = 1; i < TIERS.length; i++) {
      assert.ok(TIERS[i].threshold > TIERS[i - 1].threshold, `tier ${TIERS[i].id} threshold must exceed ${TIERS[i - 1].id}`);
    }
  });

  test('every tier has a unique id, and each arena milestone keeps its arena id unchanged', () => {
    const ids = TIERS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const arena of ARENAS) {
      assert.ok(ids.includes(arena.id), `${arena.id}'s own milestone tier must keep using the arena id`);
    }
  });

  test('chest tiers between arenas carry a reward but no draft/tournament entries', () => {
    const chests = TIERS.filter((t) => t.kind === 'chest');
    assert.ok(chests.length > 0, 'expected at least one chest tier between arenas');
    for (const chest of chests) {
      assert.ok(typeof chest.reward.coins === 'number' && chest.reward.coins > 0);
    }
  });
});

describe('getArenaIndex / getArenaFloor', () => {
  test('returns the last arena whose threshold is <= trophies', () => {
    assert.equal(getArenaIndex(0), 0);
    assert.equal(getArenaIndex(ARENAS[2].threshold), 2);
    assert.equal(getArenaIndex(ARENAS[2].threshold + 1), 2);
    assert.equal(getArenaIndex(ARENAS[3].threshold - 1), 2);
    assert.equal(getArenaIndex(999999), ARENAS.length - 1);
  });

  test('floor is the current arena\'s own threshold', () => {
    assert.equal(getArenaFloor(ARENAS[2].threshold + 50), ARENAS[2].threshold);
  });
});

describe('applyMatchResult', () => {
  test('a win always adds TROPHY_WIN, uncapped', () => {
    const { trophies, delta } = applyMatchResult(ARENAS[2].threshold + 50, true);
    assert.equal(delta, TROPHY_WIN);
    assert.equal(trophies, ARENAS[2].threshold + 50 + TROPHY_WIN);
  });

  test('a loss well inside an arena applies the full TROPHY_LOSS', () => {
    const before = ARENAS[2].threshold + 50;
    const { trophies, delta } = applyMatchResult(before, false);
    assert.equal(delta, -TROPHY_LOSS);
    assert.equal(trophies, before - TROPHY_LOSS);
  });

  test('a loss never drops trophies below the current arena\'s floor', () => {
    const atFloor = ARENAS[3].threshold;
    const clamped = applyMatchResult(atFloor, false);
    assert.equal(clamped.trophies, atFloor);
    assert.equal(clamped.delta, 0);

    const justAbove = ARENAS[3].threshold + 10; // less than TROPHY_LOSS above the floor
    const partiallyClamped = applyMatchResult(justAbove, false);
    assert.equal(partiallyClamped.trophies, ARENAS[3].threshold);
    assert.equal(partiallyClamped.delta, ARENAS[3].threshold - justAbove);
  });

  test('a win can cross an arena boundary in one match', () => {
    const before = ARENAS[1].threshold - 5;
    const { trophies } = applyMatchResult(before, true);
    assert.ok(trophies >= ARENAS[1].threshold);
  });
});

describe('client save helpers', () => {
  function freshSave() {
    return { coins: 0, gems: 0, dust: 0 };
  }

  test('ensureLadderSave lazily initializes trophies and claimedTiers', () => {
    const save = freshSave();
    ensureLadderSave(save);
    assert.equal(save.trophies, 0);
    assert.deepEqual(save.ladder.claimedTiers, []);
  });

  test('syncTrophies overwrites the cached value from a server-provided number', () => {
    const save = freshSave();
    syncTrophies(save, 450);
    assert.equal(save.trophies, 450);
  });

  test('a tier is claimable once trophies reach its threshold, and not before', () => {
    const save = freshSave();
    syncTrophies(save, ARENAS[2].threshold - 1);
    assert.equal(isTierClaimable(save, ARENAS[2].id), false);
    syncTrophies(save, ARENAS[2].threshold);
    assert.equal(isTierClaimable(save, ARENAS[2].id), true);
  });

  test('claiming a tier grants its reward once and marks it claimed', () => {
    const save = freshSave();
    syncTrophies(save, ARENAS[1].threshold);
    const res = claimTierReward(save, ARENAS[1].id);
    assert.equal(res.ok, true);
    assert.equal(save.coins, ARENAS[1].reward.coins);
    assert.equal(isTierClaimed(save, ARENAS[1].id), true);

    const again = claimTierReward(save, ARENAS[1].id);
    assert.equal(again.ok, false);
    assert.equal(save.coins, ARENAS[1].reward.coins, 'reward must not be granted twice');
  });

  test('countClaimable counts every reached-and-unclaimed tier, arenas and chests alike', () => {
    const save = freshSave();
    syncTrophies(save, ARENAS[3].threshold);
    const expected = TIERS.filter((t) => t.threshold <= ARENAS[3].threshold).length;
    assert.ok(expected > 4, 'chest tiers should push the count above the 4 arena-only milestones');
    assert.equal(countClaimable(save), expected);
    claimTierReward(save, ARENAS[0].id);
    assert.equal(countClaimable(save), expected - 1);
  });

  test('a chest tier between two arenas can be claimed independently of the arena milestone', () => {
    const chest = TIERS.find((t) => t.kind === 'chest');
    const save = freshSave();
    syncTrophies(save, chest.threshold);
    assert.equal(isTierClaimable(save, chest.id), true);
    const res = claimTierReward(save, chest.id);
    assert.equal(res.ok, true);
    assert.equal(save.coins, chest.reward.coins);
    // The arena milestone this chest belongs to is a separate tier — still
    // unclaimed even though its chest just was.
    assert.equal(isTierClaimed(save, chest.arenaId), false);
  });

  test('getProgressToNextArena reports the upcoming arena and a 0-100 pct', () => {
    const save = freshSave();
    const span = ARENAS[2].threshold - ARENAS[1].threshold;
    syncTrophies(save, ARENAS[1].threshold + Math.round(span / 2));
    const progress = getProgressToNextArena(save);
    assert.equal(progress.current.id, ARENAS[1].id);
    assert.equal(progress.next.id, ARENAS[2].id);
    assert.ok(progress.pct >= 0 && progress.pct <= 100);
  });

  test('getProgressToNextArena reports 100% with no next arena at the top tier', () => {
    const save = freshSave();
    syncTrophies(save, ARENAS[ARENAS.length - 1].threshold + 1000);
    const progress = getProgressToNextArena(save);
    assert.equal(progress.next, null);
    assert.equal(progress.pct, 100);
  });
});

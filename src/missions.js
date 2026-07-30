export const DIFFICULTY_LABEL = { easy: 'Fácil', medium: 'Media', hard: 'Difícil' };
export const DIFFICULTY_WEIGHT = { easy: 1, medium: 2, hard: 3 };

// Flat list, no categories — 5 short missions that cycle twice a day so
// there's always something fresh to check in on, without needing a whole
// day to clear.
export const MISSIONS = [
  { id: 'play_1_match', difficulty: 'easy', title: 'Primer combate', text: 'Jugá 1 partida.', target: 1, statKey: 'battles', reward: { coins: 25 } },
  { id: 'deploy_6_creatures', difficulty: 'easy', title: 'Movilización', text: 'Desplegá 6 criaturas en batalla.', target: 6, statKey: 'creaturesPlayed', reward: { coins: 25 } },
  { id: 'win_1_match', difficulty: 'medium', title: 'Racha ganadora', text: 'Ganá 1 partida.', target: 1, statKey: 'wins', reward: { coins: 60, gems: 8 } },
  { id: 'destroy_3_creatures', difficulty: 'medium', title: 'Cazador', text: 'Destruí 3 criaturas enemigas.', target: 3, statKey: 'creaturesKilled', reward: { coins: 55 } },
  { id: 'watch_1_ad', difficulty: 'easy', title: 'Publicista', text: 'Mirá un anuncio.', target: 1, statKey: 'adsWatched', reward: { gems: 12 } },
];

// Missions reset every 12h on a fixed clock grid (00:00/12:00 UTC), not
// calendar days — RESET_INTERVAL_MS both drives which cycle we're in and
// (via ui.js's countdown timer) how long is left until the next one.
export const RESET_INTERVAL_MS = 12 * 60 * 60 * 1000;

function currentCycleId() {
  return Math.floor(Date.now() / RESET_INTERVAL_MS);
}

export function ensureDailyMissions(save) {
  const cycle = currentCycleId();
  if (!save.missions || save.missions.cycle !== cycle) {
    save.missions = { cycle, progress: {}, claimed: [] };
  }
  return save.missions;
}

export function getMissionProgress(save, mission) {
  ensureDailyMissions(save);
  return Math.min(mission.target, save.missions.progress[mission.statKey] || 0);
}

export function isMissionComplete(save, mission) {
  return getMissionProgress(save, mission) >= mission.target;
}

export function isMissionClaimed(save, mission) {
  ensureDailyMissions(save);
  return save.missions.claimed.includes(mission.id);
}

export function addMissionProgress(save, statKey, amount = 1) {
  ensureDailyMissions(save);
  if (amount <= 0) return;
  save.missions.progress[statKey] = (save.missions.progress[statKey] || 0) + amount;
}

export function claimMission(save, missionId) {
  ensureDailyMissions(save);
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission || save.missions.claimed.includes(missionId) || !isMissionComplete(save, mission)) return false;
  save.coins += mission.reward.coins || 0;
  save.gems += mission.reward.gems || 0;
  save.missions.claimed.push(missionId);
  return true;
}

export function countClaimable(save) {
  ensureDailyMissions(save);
  return MISSIONS.filter((m) => isMissionComplete(save, m) && !isMissionClaimed(save, m)).length;
}

// Weighted "fill" progress — each mission contributes points scaled by its
// difficulty once claimed, so the bar fills faster from harder missions
// than from stacking up easy ones.
export function getOverallProgress(save) {
  ensureDailyMissions(save);
  const target = MISSIONS.reduce((sum, m) => sum + DIFFICULTY_WEIGHT[m.difficulty], 0);
  const current = MISSIONS.reduce((sum, m) => sum + (isMissionClaimed(save, m) ? DIFFICULTY_WEIGHT[m.difficulty] : 0), 0);
  return { current, target };
}

// Milliseconds until the current 12h cycle ends — drives the home widget's
// and the full Misiones screen's countdown timer.
export function msUntilNextReset() {
  const cycle = currentCycleId();
  return (cycle + 1) * RESET_INTERVAL_MS - Date.now();
}

export const MISSION_CATEGORIES = {
  combat: { id: 'combat', label: 'Combate', icon: '⚔️' },
  collection: { id: 'collection', label: 'Colección', icon: '🃏' },
  economy: { id: 'economy', label: 'Economía', icon: '💰' },
};

export const DIFFICULTY_LABEL = { easy: 'Fácil', medium: 'Media', hard: 'Difícil' };
export const DIFFICULTY_WEIGHT = { easy: 1, medium: 2, hard: 3 };

export const MISSIONS = [
  { id: 'play_1_match', category: 'combat', difficulty: 'easy', title: 'Primer combate', text: 'Jugá 1 partida.', target: 1, statKey: 'battles', reward: { coins: 30 } },
  { id: 'deploy_6_creatures', category: 'combat', difficulty: 'easy', title: 'Movilización', text: 'Desplegá 6 criaturas en batalla.', target: 6, statKey: 'creaturesPlayed', reward: { coins: 30 } },
  { id: 'win_2_matches', category: 'combat', difficulty: 'medium', title: 'Racha ganadora', text: 'Ganá 2 partidas.', target: 2, statKey: 'wins', reward: { coins: 80, gems: 10 } },
  { id: 'destroy_5_creatures', category: 'combat', difficulty: 'medium', title: 'Cazador', text: 'Destruí 5 criaturas enemigas.', target: 5, statKey: 'creaturesKilled', reward: { coins: 70 } },
  { id: 'deal_15_hero_damage', category: 'combat', difficulty: 'hard', title: 'Golpe directo', text: 'Hacé 15 de daño al héroe enemigo.', target: 15, statKey: 'heroDamage', reward: { coins: 150, gems: 20 } },
  { id: 'open_1_pack', category: 'collection', difficulty: 'easy', title: 'Curioso', text: 'Abrí 1 sobre.', target: 1, statKey: 'packsOpened', reward: { coins: 40 } },
  { id: 'open_3_packs', category: 'collection', difficulty: 'hard', title: 'Coleccionista', text: 'Abrí 3 sobres.', target: 3, statKey: 'packsOpened', reward: { gems: 25 } },
  { id: 'watch_1_ad', category: 'economy', difficulty: 'easy', title: 'Publicista', text: 'Mirá un anuncio.', target: 1, statKey: 'adsWatched', reward: { gems: 15 } },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function ensureDailyMissions(save) {
  const today = todayStr();
  if (!save.missions || save.missions.date !== today) {
    save.missions = { date: today, progress: {}, claimed: [] };
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
// difficulty once claimed, so a group's bar fills faster from harder
// missions than from stacking up easy ones.
function weightedProgress(missions, save) {
  const target = missions.reduce((sum, m) => sum + DIFFICULTY_WEIGHT[m.difficulty], 0);
  const current = missions.reduce((sum, m) => sum + (isMissionClaimed(save, m) ? DIFFICULTY_WEIGHT[m.difficulty] : 0), 0);
  return { current, target };
}

export function getCategoryProgress(save, categoryId) {
  ensureDailyMissions(save);
  return weightedProgress(MISSIONS.filter((m) => m.category === categoryId), save);
}

export function getOverallProgress(save) {
  ensureDailyMissions(save);
  return weightedProgress(MISSIONS, save);
}

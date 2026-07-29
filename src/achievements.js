// Permanent achievements — unlike src/missions.js's daily missions (which
// reset every day), these never reset: once a tier is claimed it stays
// claimed forever. Organized into sections, each made of 5-tier "chains"
// that share one underlying stat and escalate in both target and reward —
// tier 5 of every chain is a deliberate long-haul grind, not a quick clear.
// Client-only (mirrors the "client-only" convention of ladder.js/
// seasonPass.js) — progress is read from `save.stats` (src/stats.js) plus a
// handful of values computed live from other parts of `save`.

import { getStat } from './stats.js';
import { CARDS } from './cards.js';

export const ACH_SECTIONS = {
  combat: { id: 'combat', label: 'Combate', icon: '⚔️' },
  collection: { id: 'collection', label: 'Colección', icon: '🃏' },
  fortune: { id: 'fortune', label: 'Fortuna', icon: '💰' },
  league: { id: 'league', label: 'Liga', icon: '🏆' },
  modes: { id: 'modes', label: 'Modos de juego', icon: '🎲' },
  dedication: { id: 'dedication', label: 'Dedicación', icon: '⏳' },
};

export const DIFFICULTY_LABEL = { easy: 'Fácil', medium: 'Media', hard: 'Difícil' };
const TIER_DIFFICULTY = ['easy', 'easy', 'medium', 'hard', 'hard'];
// Shared escalation curve for every chain's reward, tier over tier — tier 5
// pays out 60x tier 1's base, matching how much longer it takes to earn.
const TIER_MULT = [1, 3, 8, 20, 60];

function coinRewards(base) {
  return TIER_MULT.map((m) => ({ coins: Math.round(base * m) }));
}
function gemRewards(base) {
  return TIER_MULT.map((m) => ({ gems: Math.round(base * m) }));
}
function dustRewards(base) {
  return TIER_MULT.map((m) => ({ dust: Math.round(base * m) }));
}
function mixedRewards(coinsBase, gemsBase) {
  return TIER_MULT.map((m) => ({ coins: Math.round(coinsBase * m), gems: Math.round(gemsBase * m) }));
}

function buildChain({ id, category, statKey, targets, title, text, rewards }) {
  return targets.map((target, i) => ({
    id: `${id}_${i + 1}`,
    chain: id,
    tier: i + 1,
    tierCount: targets.length,
    category,
    statKey,
    difficulty: TIER_DIFFICULTY[i],
    title: title(target, i + 1),
    text: text(target),
    target,
    reward: rewards[i],
  }));
}

// ---- Computed stats: values read live from other parts of `save` rather
// than an incrementing counter, so they're always accurate without needing
// a bump() call at every place that could change them. ----
const COMPUTED_STATS = {
  collectionSize: (save) => Object.entries(save.collection || {}).filter(([, n]) => n > 0).length,
  legendariesOwned: (save) => {
    const legendaryIds = new Set(CARDS.filter((c) => c.rarity === 'legendary').map((c) => c.id));
    return Object.entries(save.collection || {}).filter(([id, n]) => n > 0 && legendaryIds.has(id)).length;
  },
};

export function getStatValue(save, statKey) {
  if (COMPUTED_STATS[statKey]) return COMPUTED_STATS[statKey](save);
  return getStat(save, statKey);
}

// ---------------------------------------------------------------- combat --
const combatChains = [
  buildChain({
    id: 'combat_veteran',
    category: 'combat',
    statKey: 'battles',
    targets: [10, 50, 200, 500, 1500],
    title: (t) => `Veterano de Guerra ${t}`,
    text: (t) => `Jugá ${t} partidas, sin importar el resultado.`,
    rewards: coinRewards(15),
  }),
  buildChain({
    id: 'combat_champion',
    category: 'combat',
    statKey: 'wins',
    targets: [5, 30, 120, 400, 1000],
    title: (t) => `Campeón ${t}`,
    text: (t) => `Ganá ${t} partidas.`,
    rewards: mixedRewards(20, 3),
  }),
  buildChain({
    id: 'combat_slayer',
    category: 'combat',
    statKey: 'creaturesKilled',
    targets: [25, 125, 500, 1500, 4000],
    title: (t) => `Verdugo ${t}`,
    text: (t) => `Destruí ${t} criaturas enemigas.`,
    rewards: coinRewards(12),
  }),
  buildChain({
    id: 'combat_direct',
    category: 'combat',
    statKey: 'heroDamage',
    targets: [100, 500, 2000, 6000, 15000],
    title: (t) => `Golpe Directo ${t}`,
    text: (t) => `Acumulá ${t} de daño al héroe enemigo.`,
    rewards: mixedRewards(15, 2),
  }),
  buildChain({
    id: 'combat_commander',
    category: 'combat',
    statKey: 'creaturesPlayed',
    targets: [40, 200, 800, 2500, 6000],
    title: (t) => `Comandante ${t}`,
    text: (t) => `Desplegá ${t} criaturas en batalla.`,
    rewards: coinRewards(10),
  }),
];

// ------------------------------------------------------------ collection --
const collectionChains = [
  buildChain({
    id: 'coll_packs',
    category: 'collection',
    statKey: 'packsOpened',
    targets: [5, 25, 75, 200, 500],
    title: (t) => `Coleccionista de Sobres ${t}`,
    text: (t) => `Abrí ${t} sobres, del tipo que sea.`,
    rewards: gemRewards(4),
  }),
  buildChain({
    id: 'coll_craft',
    category: 'collection',
    statKey: 'cardsCrafted',
    targets: [3, 15, 50, 150, 400],
    title: (t) => `Alquimista ${t}`,
    text: (t) => `Crafteá ${t} cartas con polvo desencantador.`,
    rewards: dustRewards(20),
  }),
  buildChain({
    id: 'coll_dust',
    category: 'collection',
    statKey: 'dustEarned',
    targets: [50, 250, 1000, 3000, 8000],
    title: (t) => `Desencantador ${t}`,
    text: (t) => `Conseguí ${t} de polvo desencantando cartas.`,
    rewards: coinRewards(8),
  }),
  buildChain({
    id: 'coll_archive',
    category: 'collection',
    statKey: 'collectionSize',
    targets: [15, 40, 70, 100, 118],
    title: (t) => `Archivista ${t}`,
    text: (t) => `Tené ${t} cartas distintas en tu colección.`,
    rewards: gemRewards(6),
  }),
  buildChain({
    id: 'coll_legendary',
    category: 'collection',
    statKey: 'legendariesOwned',
    targets: [1, 3, 6, 9, 12],
    title: (t) => `Cazador de Leyendas ${t}`,
    text: (t) => `Conseguí ${t} cartas legendarias distintas.`,
    rewards: [
      { gems: 20 },
      { gems: 50 },
      { gems: 120 },
      { gems: 250 },
      { gems: 500, dust: 400 },
    ],
  }),
];

// ---------------------------------------------------------------- fortune --
const fortuneChains = [
  buildChain({
    id: 'fortune_coins',
    category: 'fortune',
    statKey: 'coinsEarned',
    targets: [500, 3000, 15000, 60000, 200000],
    title: (t) => `Fortuna Acumulada ${t}`,
    text: (t) => `Ganá un total de ${t} monedas jugando y mirando anuncios.`,
    rewards: gemRewards(5),
  }),
  buildChain({
    id: 'fortune_ads',
    category: 'fortune',
    statKey: 'adsWatched',
    targets: [3, 15, 50, 150, 400],
    title: (t) => `Publicista ${t}`,
    text: (t) => `Mirá ${t} anuncios.`,
    rewards: coinRewards(15),
  }),
  buildChain({
    id: 'fortune_entries',
    category: 'fortune',
    statKey: 'entriesBought',
    targets: [1, 5, 15, 40, 100],
    title: (t) => `Comprador de Entradas ${t}`,
    text: (t) => `Comprá ${t} entradas a Draft o Torneo en la tienda.`,
    rewards: gemRewards(8),
  }),
  buildChain({
    id: 'fortune_shop',
    category: 'fortune',
    statKey: 'shopPurchases',
    targets: [3, 10, 30, 80, 200],
    title: (t) => `Cliente Frecuente ${t}`,
    text: (t) => `Realizá ${t} compras en la tienda.`,
    rewards: coinRewards(18),
  }),
  buildChain({
    id: 'fortune_dailydeal',
    category: 'fortune',
    statKey: 'dailyDealsBought',
    targets: [3, 10, 30, 80, 200],
    title: (t) => `Cazador de Ofertas ${t}`,
    text: (t) => `Comprá ${t} ofertas de la Tienda del Día.`,
    rewards: dustRewards(15),
  }),
];

// ----------------------------------------------------------------- league --
const leagueChains = [
  buildChain({
    id: 'league_trophies',
    category: 'league',
    statKey: 'peakTrophies',
    targets: [300, 1200, 2500, 4200, 5200],
    title: (t) => `Ascenso a la Cima ${t}`,
    text: (t) => `Alcanzá ${t} trofeos en la Liga.`,
    rewards: [
      { coins: 100, gems: 15 },
      { coins: 300, gems: 40 },
      { coins: 700, gems: 90 },
      { coins: 1400, gems: 180, draftEntries: 1 },
      { coins: 3000, gems: 400, tournamentEntries: 1 },
    ],
  }),
  buildChain({
    id: 'league_chests',
    category: 'league',
    statKey: 'ladderTiersClaimed',
    targets: [5, 15, 30, 45, 52],
    title: (t) => `Cazatesoros ${t}`,
    text: (t) => `Reclamá ${t} cofres del camino de trofeos.`,
    rewards: coinRewards(12),
  }),
  buildChain({
    id: 'league_seasonlevel',
    category: 'league',
    statKey: 'seasonPassLevel',
    targets: [5, 10, 20, 27, 30],
    title: (t) => `Maestro del Pase ${t}`,
    text: (t) => `Alcanzá el nivel ${t} del Pase de Temporada.`,
    rewards: gemRewards(10),
  }),
  buildChain({
    id: 'league_seasonclaims',
    category: 'league',
    statKey: 'seasonRewardsClaimed',
    targets: [5, 20, 45, 70, 100],
    title: (t) => `Recolector del Pase ${t}`,
    text: (t) => `Reclamá ${t} recompensas del Pase de Temporada en total.`,
    rewards: dustRewards(12),
  }),
  buildChain({
    id: 'league_online_wins',
    category: 'league',
    statKey: 'onlineWins',
    targets: [5, 25, 100, 300, 800],
    title: (t) => `Gloria en Línea ${t}`,
    text: (t) => `Ganá ${t} partidas Online.`,
    rewards: mixedRewards(18, 3),
  }),
];

// ----------------------------------------------------------------- modes --
const modesChains = [
  buildChain({
    id: 'modes_draft_played',
    category: 'modes',
    statKey: 'draftsPlayed',
    targets: [1, 3, 8, 20, 50],
    title: (t) => `Aprendiz de Draft ${t}`,
    text: (t) => `Completá ${t} drafts (llegá hasta el final del torneo).`,
    rewards: coinRewards(25),
  }),
  buildChain({
    id: 'modes_draft_won',
    category: 'modes',
    statKey: 'draftsWon',
    targets: [1, 3, 8, 15, 30],
    title: (t) => `Campeón del Draft ${t}`,
    text: (t) => `Ganá ${t} drafts (1er puesto).`,
    rewards: [
      { draftEntries: 1 },
      { gems: 40, draftEntries: 1 },
      { gems: 100, draftEntries: 2 },
      { gems: 220, draftEntries: 3 },
      { gems: 500, draftEntries: 5 },
    ],
  }),
  buildChain({
    id: 'modes_tourney_played',
    category: 'modes',
    statKey: 'tournamentsPlayed',
    targets: [1, 3, 8, 20, 50],
    title: (t) => `Retador de Torneos ${t}`,
    text: (t) => `Completá ${t} torneos (llegá hasta el final).`,
    rewards: coinRewards(25),
  }),
  buildChain({
    id: 'modes_tourney_won',
    category: 'modes',
    statKey: 'tournamentsWon',
    targets: [1, 3, 8, 15, 30],
    title: (t) => `Campeón del Torneo ${t}`,
    text: (t) => `Ganá ${t} torneos (1er puesto).`,
    rewards: [
      { tournamentEntries: 1 },
      { gems: 40, tournamentEntries: 1 },
      { gems: 100, tournamentEntries: 2 },
      { gems: 220, tournamentEntries: 3 },
      { gems: 500, tournamentEntries: 5 },
    ],
  }),
  buildChain({
    id: 'modes_auto',
    category: 'modes',
    statKey: 'autoDeckMatches',
    targets: [5, 25, 100, 300, 800],
    title: (t) => `Piloto Automático ${t}`,
    text: (t) => `Jugá ${t} partidas en modo Autodeckbuilder.`,
    rewards: coinRewards(12),
  }),
];

// ------------------------------------------------------------ dedication --
const dedicationChains = [
  buildChain({
    id: 'dedication_missions',
    category: 'dedication',
    statKey: 'dailyMissionsClaimedTotal',
    targets: [10, 50, 150, 400, 1000],
    title: (t) => `Cumplidor ${t}`,
    text: (t) => `Reclamá ${t} misiones diarias en total.`,
    rewards: dustRewards(10),
  }),
  buildChain({
    id: 'dedication_login',
    category: 'dedication',
    statKey: 'loginDays',
    targets: [3, 14, 45, 120, 365],
    title: (t) => `Fiel a Card Clash ${t}`,
    text: (t) => `Entrá al juego ${t} días distintos.`,
    rewards: gemRewards(6),
  }),
  buildChain({
    id: 'dedication_friends',
    category: 'dedication',
    statKey: 'friendsAdded',
    targets: [1, 3, 6, 10, 20],
    title: (t) => `Sociable ${t}`,
    text: (t) => `Agregá ${t} amigos.`,
    rewards: coinRewards(20),
  }),
  buildChain({
    id: 'dedication_entries',
    category: 'dedication',
    statKey: 'entriesConsumed',
    targets: [1, 5, 15, 40, 100],
    title: (t) => `Competidor Incansable ${t}`,
    text: (t) => `Entrá a la fila de Draft o Torneo ${t} veces.`,
    rewards: coinRewards(20),
  }),
  buildChain({
    id: 'dedication_seasons',
    category: 'dedication',
    statKey: 'seasonsCompleted',
    targets: [1, 3, 6, 10, 15],
    title: (t) => `Superviviente de Temporadas ${t}`,
    text: (t) => `Viví ${t} temporadas completas del Pase (14 días cada una).`,
    rewards: [
      { gems: 60 },
      { gems: 150 },
      { gems: 320 },
      { gems: 600, draftEntries: 2 },
      { gems: 1200, tournamentEntries: 2, draftEntries: 2 },
    ],
  }),
];

export const ACHIEVEMENTS = [
  ...combatChains,
  ...collectionChains,
  ...fortuneChains,
  ...leagueChains,
  ...modesChains,
  ...dedicationChains,
].flat();

// seasonPassLevel is computed live (SeasonPass.getLevel), not a stat
// counter — ui.js feeds it in via getAchievementProgress's `overrides`
// param since achievements.js can't import seasonPass.js without risking a
// cycle (seasonPass.js already imports nothing from here, but keeping the
// dependency one-directional is simpler to reason about).
export function getAchievementProgress(save, achievement, overrides = {}) {
  if (achievement.statKey in overrides) return Math.min(achievement.target, overrides[achievement.statKey]);
  return Math.min(achievement.target, getStatValue(save, achievement.statKey));
}

export function isAchievementComplete(save, achievement, overrides = {}) {
  return getAchievementProgress(save, achievement, overrides) >= achievement.target;
}

export function ensureAchievementsSave(save) {
  if (!save.achievementsClaimed) save.achievementsClaimed = [];
  return save.achievementsClaimed;
}

export function isAchievementClaimed(save, achievementId) {
  return ensureAchievementsSave(save).includes(achievementId);
}

export function claimAchievement(save, achievementId, overrides = {}) {
  const achievement = ACHIEVEMENTS.find((a) => a.id === achievementId);
  if (!achievement) return { ok: false };
  if (isAchievementClaimed(save, achievementId)) return { ok: false };
  if (!isAchievementComplete(save, achievement, overrides)) return { ok: false };
  save.coins += achievement.reward.coins || 0;
  save.gems += achievement.reward.gems || 0;
  save.dust = (save.dust || 0) + (achievement.reward.dust || 0);
  save.draftEntries = (save.draftEntries || 0) + (achievement.reward.draftEntries || 0);
  save.tournamentEntries = (save.tournamentEntries || 0) + (achievement.reward.tournamentEntries || 0);
  ensureAchievementsSave(save).push(achievementId);
  return { ok: true, reward: achievement.reward };
}

export function countClaimableInSection(save, categoryId, overrides = {}) {
  return ACHIEVEMENTS.filter(
    (a) => a.category === categoryId && isAchievementComplete(save, a, overrides) && !isAchievementClaimed(save, a.id)
  ).length;
}

export function countClaimable(save, overrides = {}) {
  return ACHIEVEMENTS.filter((a) => isAchievementComplete(save, a, overrides) && !isAchievementClaimed(save, a.id)).length;
}

// A chain is "active" at its first not-yet-claimed tier — everything after
// that stays locked/hidden until the player catches up, which is what
// keeps the block progressive instead of showing 5 open bars at once.
export function getChainTiers(chainId) {
  return ACHIEVEMENTS.filter((a) => a.chain === chainId).sort((a, b) => a.tier - b.tier);
}

export function getActiveChainTier(save, chainId, overrides = {}) {
  const tiers = getChainTiers(chainId);
  return tiers.find((t) => !isAchievementClaimed(save, t.id)) || tiers[tiers.length - 1];
}

function chainIdsForCategory(categoryId) {
  const ids = [];
  for (const a of ACHIEVEMENTS) if (a.category === categoryId && !ids.includes(a.chain)) ids.push(a.chain);
  return ids;
}

export function getSectionChains(categoryId) {
  return chainIdsForCategory(categoryId).map((chainId) => getChainTiers(chainId));
}

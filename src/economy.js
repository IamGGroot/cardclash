import { CARDS } from './cards.js';

const WEIGHTS_COIN = { common: 72, rare: 22, epic: 5, legendary: 1 };
const WEIGHTS_GEM = { common: 45, rare: 33, epic: 17, legendary: 5 };
const WEIGHTS_LEGENDARY = { common: 15, rare: 35, epic: 35, legendary: 15 };

export const PACKS = {
  coin_pack: { label: 'Sobre de Bronce', cost: 100, currency: 'coins', size: 3, weights: WEIGHTS_COIN },
  gem_pack: { label: 'Sobre Premium', cost: 60, currency: 'gems', size: 5, weights: WEIGHTS_GEM },
  legendary_pack: { label: 'Sobre Legendario', cost: 300, currency: 'gems', size: 5, weights: WEIGHTS_LEGENDARY },
  // Faction-themed packs guarantee every card comes from that faction (no
  // neutral/off-faction pulls diluting it), so they cost 1.5x the bronze
  // pack they're otherwise identical to.
  albura_pack: { label: 'Sobre de Albura', cost: 150, currency: 'coins', size: 3, weights: WEIGHTS_COIN, faction: 'albura' },
  ignara_pack: { label: 'Sobre de Ignara', cost: 150, currency: 'coins', size: 3, weights: WEIGHTS_COIN, faction: 'ignara' },
  umbra_pack: { label: 'Sobre de Umbra', cost: 150, currency: 'coins', size: 3, weights: WEIGHTS_COIN, faction: 'umbra' },
  terra_pack: { label: 'Sobre de Terra', cost: 150, currency: 'coins', size: 3, weights: WEIGHTS_COIN, faction: 'terra' },
};

export const GEM_SKUS = [
  { id: 'gems_small', gems: 100, priceLabel: '$0.99' },
  { id: 'gems_medium', gems: 550, priceLabel: '$4.99' },
  { id: 'gems_large', gems: 1200, priceLabel: '$9.99' },
];

export const COIN_SKUS = [
  { id: 'coins_small', coins: 500, priceLabel: '$0.99' },
  { id: 'coins_medium', coins: 1500, priceLabel: '$2.99' },
  { id: 'coins_large', coins: 4000, priceLabel: '$4.99' },
];

export const WELCOME_OFFER = { id: 'welcome_offer', label: 'Oferta de Bienvenida', coins: 600, gems: 250, priceLabel: '$2.99' };

// Real-money only — deliberately not a gems/coins price, so the premium
// track can't be bought with an in-game currency that's itself purchasable
// or earnable through play (see SeasonPass.unlockPremium).
export const SEASON_PASS_SKU = { id: 'season_pass_premium', label: 'Pase de Temporada Premium', priceLabel: '$4.99' };

// Deliberately poor value compared to gems/coins: dust converts straight
// into specific cards via crafting, so it's priced steep to keep packs (not
// a card shop) the main way to fill out a collection.
export const DUST_SKUS = [
  { id: 'dust_small', dust: 100, priceLabel: '$1.99' },
  { id: 'dust_medium', dust: 300, priceLabel: '$4.99' },
  { id: 'dust_large', dust: 800, priceLabel: '$9.99' },
];

function weightedPick(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [rarity, w] of Object.entries(weights)) {
    if (roll < w) return rarity;
    roll -= w;
  }
  return 'common';
}

export function openPack(packId) {
  const pack = PACKS[packId];
  const results = [];
  for (let i = 0; i < pack.size; i++) {
    const rarity = weightedPick(pack.weights);
    const pool = CARDS.filter((c) => c.rarity === rarity && (!pack.faction || c.faction === pack.faction));
    const card = pool[Math.floor(Math.random() * pool.length)];
    results.push(card);
  }
  return results;
}

export function matchReward(won) {
  return won ? { coins: 30 } : { coins: 10 };
}

export const AD_REWARD = { coins: 40 };

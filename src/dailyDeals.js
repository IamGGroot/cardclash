import { CARDS, getCard } from './cards.js';
import { addCardsToCollection } from './store.js';

// Slots 1-2 are fixed rarities payable in coins. Slot 3 is the premium
// gem-only slot: usually epic, with a ~1-in-7 (once-a-week-ish) chance of
// rolling legendary instead — a rare guaranteed pick to complement packs.
const LEGENDARY_CHANCE = 1 / 7;

const PRICES = {
  common: { amount: 80, currency: 'coins' },
  rare: { amount: 220, currency: 'coins' },
  epic: { amount: 70, currency: 'gems' },
  legendary: { amount: 120, currency: 'gems' },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pickDailyDeals() {
  const thirdSlotRarity = Math.random() < LEGENDARY_CHANCE ? 'legendary' : 'epic';
  const rarities = ['common', 'rare', thirdSlotRarity];
  return rarities.map((rarity) => {
    const pool = CARDS.filter((c) => c.rarity === rarity);
    const card = pool[Math.floor(Math.random() * pool.length)];
    return { cardId: card.id, rarity, ...PRICES[rarity] };
  });
}

export function ensureDailyDeals(save) {
  const today = todayStr();
  if (!save.dailyDeals || save.dailyDeals.date !== today) {
    save.dailyDeals = { date: today, deals: pickDailyDeals(), purchased: [] };
  }
  return save.dailyDeals;
}

export function isDealPurchased(save, cardId) {
  ensureDailyDeals(save);
  return save.dailyDeals.purchased.includes(cardId);
}

export function buyDeal(save, cardId) {
  ensureDailyDeals(save);
  const deal = save.dailyDeals.deals.find((d) => d.cardId === cardId);
  if (!deal || save.dailyDeals.purchased.includes(cardId)) return { ok: false };
  const balance = deal.currency === 'coins' ? save.coins : save.gems;
  if (balance < deal.amount) return { ok: false, reason: 'balance' };
  if (deal.currency === 'coins') save.coins -= deal.amount;
  else save.gems -= deal.amount;
  addCardsToCollection(save, [getCard(cardId)]);
  save.dailyDeals.purchased.push(cardId);
  return { ok: true };
}

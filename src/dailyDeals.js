import { CARDS, getCard } from './cards.js';
import { addCardsToCollection } from './store.js';

// Slots 1-2 are fixed rarities payable in coins. Slot 3 is the premium
// gem-only slot: usually epic, with a ~1-in-7 (once-a-week-ish) chance of
// rolling legendary instead — a rare guaranteed pick to complement packs.
const LEGENDARY_CHANCE = 1 / 7;
// The premium slot can also, rarer still, offer a Draft/Torneo entry
// instead of a card entirely — priced like the legendary roll it replaces.
const ENTRY_CHANCE = 1 / 10;

const PRICES = {
  common: { amount: 80, currency: 'coins' },
  rare: { amount: 220, currency: 'coins' },
  epic: { amount: 70, currency: 'gems' },
  legendary: { amount: 120, currency: 'gems' },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pickThirdSlot() {
  if (Math.random() < ENTRY_CHANCE) {
    const entryType = Math.random() < 0.5 ? 'draft' : 'tournament';
    // Not `rarity: 'legendary'` — that label is reserved for the actual
    // legendary-card roll below, which tests/dailyDeals.test.js measures the
    // frequency of; an entry deal is priced the same but a distinct outcome.
    return { id: `entry_${entryType}`, entryType, rarity: 'entry', ...PRICES.legendary };
  }
  const rarity = Math.random() < LEGENDARY_CHANCE ? 'legendary' : 'epic';
  const pool = CARDS.filter((c) => c.rarity === rarity);
  const card = pool[Math.floor(Math.random() * pool.length)];
  return { id: card.id, cardId: card.id, rarity, ...PRICES[rarity] };
}

function pickDailyDeals() {
  const deals = ['common', 'rare'].map((rarity) => {
    const pool = CARDS.filter((c) => c.rarity === rarity);
    const card = pool[Math.floor(Math.random() * pool.length)];
    return { id: card.id, cardId: card.id, rarity, ...PRICES[rarity] };
  });
  deals.push(pickThirdSlot());
  return deals;
}

export function ensureDailyDeals(save) {
  const today = todayStr();
  if (!save.dailyDeals || save.dailyDeals.date !== today) {
    save.dailyDeals = { date: today, deals: pickDailyDeals(), purchased: [] };
  }
  return save.dailyDeals;
}

export function isDealPurchased(save, id) {
  ensureDailyDeals(save);
  return save.dailyDeals.purchased.includes(id);
}

export function buyDeal(save, id) {
  ensureDailyDeals(save);
  const deal = save.dailyDeals.deals.find((d) => d.id === id);
  if (!deal || save.dailyDeals.purchased.includes(id)) return { ok: false };
  const balance = deal.currency === 'coins' ? save.coins : save.gems;
  if (balance < deal.amount) return { ok: false, reason: 'balance' };
  if (deal.currency === 'coins') save.coins -= deal.amount;
  else save.gems -= deal.amount;
  if (deal.entryType === 'draft') save.draftEntries = (save.draftEntries || 0) + 1;
  else if (deal.entryType === 'tournament') save.tournamentEntries = (save.tournamentEntries || 0) + 1;
  else addCardsToCollection(save, [getCard(deal.cardId)]);
  save.dailyDeals.purchased.push(id);
  return { ok: true };
}

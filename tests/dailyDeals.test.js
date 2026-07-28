import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ensureDailyDeals, isDealPurchased, buyDeal } from '../src/dailyDeals.js';

function bareSave() {
  return { coins: 1000, gems: 1000, collection: {} };
}

describe('ensureDailyDeals', () => {
  test('always produces exactly 3 deals: common, rare, and a premium (epic or legendary) slot', () => {
    const save = bareSave();
    const { deals } = ensureDailyDeals(save);
    assert.equal(deals.length, 3);
    assert.equal(deals[0].rarity, 'common');
    assert.equal(deals[1].rarity, 'rare');
    assert.ok(['epic', 'legendary'].includes(deals[2].rarity));
  });

  test('common and rare slots are always paid in coins; the premium slot always in gems', () => {
    const save = bareSave();
    const { deals } = ensureDailyDeals(save);
    assert.equal(deals[0].currency, 'coins');
    assert.equal(deals[1].currency, 'coins');
    assert.equal(deals[2].currency, 'gems');
  });

  test('is stable for the same save across repeated calls on the same day', () => {
    const save = bareSave();
    const first = ensureDailyDeals(save);
    const second = ensureDailyDeals(save);
    assert.deepEqual(first, second);
  });

  test('a stale date rerolls the deals and clears purchases', () => {
    const save = { ...bareSave(), dailyDeals: { date: '2000-01-01', deals: [], purchased: ['a1'] } };
    ensureDailyDeals(save);
    assert.notEqual(save.dailyDeals.date, '2000-01-01');
    assert.deepEqual(save.dailyDeals.purchased, []);
    assert.equal(save.dailyDeals.deals.length, 3);
  });

  test('the premium slot lands on legendary roughly 1 in 7 times', () => {
    let legendaryCount = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const { deals } = ensureDailyDeals(bareSave());
      if (deals[2].rarity === 'legendary') legendaryCount++;
    }
    const frequency = legendaryCount / N;
    assert.ok(frequency > 0.09 && frequency < 0.20, `legendary frequency ${frequency} is out of the expected ~1/7 range`);
  });
});

describe('buyDeal', () => {
  test('a successful purchase deducts the right currency and grants the card', () => {
    const save = bareSave();
    const { deals } = ensureDailyDeals(save);
    const deal = deals[0]; // common, coins
    const coinsBefore = save.coins;
    const res = buyDeal(save, deal.cardId);
    assert.equal(res.ok, true);
    assert.equal(save.coins, coinsBefore - deal.amount);
    assert.equal(save.collection[deal.cardId], 1);
    assert.equal(isDealPurchased(save, deal.cardId), true);
  });

  test('cannot buy the same daily deal twice', () => {
    const save = bareSave();
    const { deals } = ensureDailyDeals(save);
    const deal = deals[0];
    buyDeal(save, deal.cardId);
    const res = buyDeal(save, deal.cardId);
    assert.equal(res.ok, false);
    assert.equal(save.collection[deal.cardId], 1, 'must not grant a second copy');
  });

  test('fails gracefully with insufficient balance and spends nothing', () => {
    const save = { coins: 0, gems: 0, collection: {} };
    const { deals } = ensureDailyDeals(save);
    const res = buyDeal(save, deals[2].cardId); // premium slot
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'balance');
    assert.equal(save.gems, 0);
  });

  test('buying a card id that is not one of today\'s deals fails', () => {
    const save = bareSave();
    ensureDailyDeals(save);
    const res = buyDeal(save, 'not-a-deal-today');
    assert.equal(res.ok, false);
  });
});

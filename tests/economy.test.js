import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PACKS, DUST_SKUS, GEM_SKUS, COIN_SKUS, openPack, AD_REWARD, AD_DAILY_LIMIT, canWatchAd, recordAdWatch, adsWatchedToday } from '../src/economy.js';
import { FACTIONS } from '../src/cards.js';

describe('faction-themed packs', () => {
  test('every playable faction (not neutral) has a themed pack', () => {
    for (const faction of Object.keys(FACTIONS)) {
      if (faction === 'neutral') continue;
      const pack = Object.values(PACKS).find((p) => p.faction === faction);
      assert.ok(pack, `missing a themed pack for ${faction}`);
    }
  });

  test('there is no themed pack for the neutral pool', () => {
    assert.equal(Object.values(PACKS).some((p) => p.faction === 'neutral'), false);
  });

  test('a themed pack costs 1.5x the equivalent untargeted pack of the same currency/size', () => {
    const base = PACKS.coin_pack;
    for (const pack of Object.values(PACKS).filter((p) => p.faction)) {
      assert.equal(pack.currency, base.currency);
      assert.equal(pack.size, base.size);
      assert.equal(pack.cost, base.cost * 1.5);
    }
  });

  test('opening a themed pack only ever yields cards from that faction', () => {
    for (const [packId, pack] of Object.entries(PACKS)) {
      if (!pack.faction) continue;
      for (let i = 0; i < 20; i++) {
        const results = openPack(packId);
        assert.ok(
          results.every((c) => c.faction === pack.faction),
          `${packId} produced a card outside ${pack.faction}`
        );
      }
    }
  });

  test('an untargeted pack can produce cards from more than one faction over many pulls', () => {
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      for (const card of openPack('coin_pack')) seen.add(card.faction);
    }
    assert.ok(seen.size > 1, 'expected variety across many bronze pack openings');
  });
});

describe('dust purchases', () => {
  test('DUST_SKUS exist and scale in size with price', () => {
    assert.ok(DUST_SKUS.length >= 2);
    const sorted = [...DUST_SKUS].sort((a, b) => a.dust - b.dust);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].dust > sorted[i - 1].dust);
    }
  });

  test('every SKU list (gems, coins, dust) has a price label', () => {
    for (const sku of [...GEM_SKUS, ...COIN_SKUS, ...DUST_SKUS]) {
      assert.ok(sku.priceLabel && sku.priceLabel.startsWith('$'));
    }
  });
});

describe('daily ad-watch cap', () => {
  function freshSave() {
    return { coins: 0 };
  }

  test('AD_REWARD pays 10 coins', () => {
    assert.equal(AD_REWARD.coins, 10);
  });

  test('can watch ads up to the daily limit, then is blocked', () => {
    const save = freshSave();
    for (let i = 0; i < AD_DAILY_LIMIT; i++) {
      assert.equal(canWatchAd(save), true, `should allow ad #${i + 1}`);
      recordAdWatch(save);
    }
    assert.equal(adsWatchedToday(save), AD_DAILY_LIMIT);
    assert.equal(canWatchAd(save), false);
  });

  test('the count resets on a new day', () => {
    const save = { ...freshSave(), adWatch: { date: '2000-01-01', count: AD_DAILY_LIMIT } };
    assert.equal(canWatchAd(save), true);
    assert.equal(adsWatchedToday(save), 0);
  });
});

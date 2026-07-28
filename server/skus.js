// Server-side view of the real-money catalog. Imports the actual SKU
// definitions from src/economy.js (the same list the shop screen renders)
// so the catalog only exists in one place, and attaches each one to a
// Stripe Price ID read from the environment — see server/.env.example.
import { GEM_SKUS, COIN_SKUS, DUST_SKUS, WELCOME_OFFER } from '../src/economy.js';
import { env } from './env.js';

const ALL_SKUS = [...GEM_SKUS, ...COIN_SKUS, ...DUST_SKUS, WELCOME_OFFER];

function currencyGrantOf(sku) {
  if ('gems' in sku && sku.gems) return { currency: 'gems', amount: sku.gems };
  if ('coins' in sku && sku.coins) return { currency: 'coins', amount: sku.coins };
  if ('dust' in sku && sku.dust) return { currency: 'dust', amount: sku.dust };
  return null;
}

export function getSku(skuId) {
  const sku = ALL_SKUS.find((s) => s.id === skuId);
  if (!sku) return null;
  const grant = currencyGrantOf(sku);
  const priceId = env(`STRIPE_PRICE_${skuId}`);
  return grant && { ...sku, ...grant, stripePriceId: priceId || null };
}

// The welcome offer grants two currencies at once (coins + gems) — special-
// cased here since the generic single-currency grant above can't express it.
export function grantsFor(skuId) {
  if (skuId === WELCOME_OFFER.id) {
    return [
      { currency: 'coins', amount: WELCOME_OFFER.coins },
      { currency: 'gems', amount: WELCOME_OFFER.gems },
    ];
  }
  const sku = getSku(skuId);
  return sku ? [{ currency: sku.currency, amount: sku.amount }] : [];
}

export function listSkus() {
  return ALL_SKUS.map((s) => getSku(s.id)).filter(Boolean);
}

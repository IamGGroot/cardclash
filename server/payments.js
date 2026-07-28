// Stripe integration, talking to Stripe's REST API directly over fetch
// instead of pulling in the `stripe` npm package — this is a small enough
// surface (create a Checkout Session, verify+handle one webhook event) that
// hand-rolling it keeps the dependency list at just `ws` and makes the exact
// HTTP calls being made fully visible in one file.
//
// Nothing here runs against real money until STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET are set (see .env.example) — every function below
// checks for that and fails loudly/cleanly rather than pretending to work.
import crypto from 'node:crypto';
import { env } from './env.js';
import { getSku, grantsFor } from './skus.js';
import { creditCurrency, getOrCreateAccount } from './accounts.js';

export function paymentsConfigured() {
  return Boolean(env('STRIPE_SECRET_KEY'));
}

export function webhookConfigured() {
  return Boolean(env('STRIPE_WEBHOOK_SECRET'));
}

// Creates a Stripe Checkout Session for one SKU and returns its hosted URL.
// `accountToken` is stamped onto the session so the webhook handler knows
// whose server-side balance to credit once payment actually succeeds —
// currency is granted from the webhook, never from this call, since this
// call only proves the player *started* checkout, not that they paid.
export async function createCheckoutSession(skuId, accountToken) {
  if (!paymentsConfigured()) {
    return { error: 'Los pagos no están configurados en este servidor todavía.' };
  }
  const sku = getSku(skuId);
  if (!sku) return { error: `SKU desconocido: ${skuId}` };
  if (!sku.stripePriceId) {
    return { error: `Falta configurar STRIPE_PRICE_${skuId} en el servidor.` };
  }

  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price]': sku.stripePriceId,
    'line_items[0][quantity]': '1',
    success_url: env('CHECKOUT_SUCCESS_URL', 'http://localhost:8790/?checkout=success'),
    cancel_url: env('CHECKOUT_CANCEL_URL', 'http://localhost:8790/?checkout=cancel'),
    client_reference_id: accountToken,
    'metadata[skuId]': skuId,
    'metadata[accountToken]': accountToken,
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) return { error: data?.error?.message || 'Stripe rechazó la solicitud.' };
  return { url: data.url, sessionId: data.id };
}

// Verifies the `Stripe-Signature` header by hand (HMAC-SHA256 over
// "<timestamp>.<rawBody>" using the webhook signing secret), the same
// algorithm Stripe's own SDKs implement — see Stripe's "Verify webhook
// signatures manually" docs. `rawBody` must be the exact, unparsed request
// body: signatures are computed over raw bytes, so parsing-then-restringifying
// JSON would break verification.
export function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=')));
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const gotBuf = Buffer.from(v1, 'hex');
  if (expectedBuf.length !== gotBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, gotBuf);
}

// Handles one verified `checkout.session.completed` event: credits the
// buyer's server-side currency ledger. Idempotent on event.id, so a webhook
// Stripe retries (which it will, on any non-2xx or timeout) can't grant the
// same purchase twice.
export function handleCheckoutCompleted(event) {
  const session = event.data?.object;
  const skuId = session?.metadata?.skuId;
  const accountToken = session?.metadata?.accountToken || session?.client_reference_id;
  if (!skuId || !accountToken) return { ok: false, reason: 'missing metadata' };

  getOrCreateAccount(accountToken);
  const grants = grantsFor(skuId);
  for (const grant of grants) {
    // A single event (e.g. the welcome offer) can grant more than one
    // currency — key idempotency per (event, currency) so the second grant
    // isn't mistaken for a duplicate delivery of the first.
    creditCurrency(accountToken, grant.currency, grant.amount, { eventId: `${event.id}:${grant.currency}`, source: 'stripe' });
  }
  return { ok: true, accountToken, grants };
}

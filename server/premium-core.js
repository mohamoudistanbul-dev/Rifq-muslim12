/**
 * Pure Premium rules — no database, no network, so they can be tested directly.
 *
 * The single most important rule lives here: entitlement is derived from a
 * stored subscription row with a real expiry, never from a client claim.
 */

export const PLAN_PERIODS = ['month', 'year', 'lifetime'];

/** Catalogue used only to seed an empty database; the admin owns it afterwards. */
export const DEFAULT_PLANS = [
  {
    code: 'monthly',
    title: 'Premium Monthly',
    priceCents: 299,
    currency: 'USD',
    period: 'month',
    productId: 'rifq_premium_monthly',
    benefits: ['Ad-free experience', 'Exclusive Kid Academy lessons', 'Advanced quiz pack', 'Extra learning resources'],
    sort: 1,
  },
  {
    code: 'yearly',
    title: 'Premium Yearly',
    priceCents: 2499,
    currency: 'USD',
    period: 'year',
    productId: 'rifq_premium_yearly',
    benefits: ['Ad-free experience', 'Exclusive Kid Academy lessons', 'Advanced quiz pack', 'Extra learning resources', 'Two months free'],
    sort: 2,
  },
  {
    code: 'lifetime',
    title: 'Premium Lifetime',
    priceCents: 5999,
    currency: 'USD',
    period: 'lifetime',
    productId: 'rifq_premium_lifetime',
    benefits: ['One payment, permanent access', 'Ad-free experience', 'Exclusive Kid Academy lessons', 'Advanced quiz pack'],
    sort: 3,
  },
];

const STATUSES_THAT_KEEP_ACCESS = new Set(['active', 'canceled', 'grace']);

/** Validate and normalise an admin-supplied plan. Throws on invalid input. */
export function normalizePlan(input = {}) {
  const code = String(input.code || '').trim().toLowerCase();
  const title = String(input.title || '').trim();
  const period = PLAN_PERIODS.includes(input.period) ? input.period : 'month';
  const rawPrice = Number(input.priceCents);
  const priceCents = Number.isFinite(rawPrice) ? Math.max(0, Math.round(rawPrice)) : 0;
  const currency = String(input.currency || 'USD').toUpperCase().slice(0, 3);
  const productId = String(input.productId || '').trim();
  const benefits = Array.isArray(input.benefits)
    ? input.benefits.map((b) => String(b).trim()).filter(Boolean).slice(0, 12)
    : [];

  if (!/^[a-z0-9_-]{2,40}$/.test(code)) {
    throw new Error('Plan code must be 2-40 characters: lowercase letters, digits, - or _.');
  }
  if (!title) throw new Error('Plan title is required.');
  if (!productId) throw new Error('A store product ID is required.');
  if (period !== 'lifetime' && priceCents <= 0) {
    throw new Error('Recurring plans need a price greater than zero.');
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code.');

  return {
    code,
    title,
    period,
    priceCents,
    currency,
    productId,
    benefits,
    active: input.active === false || input.active === 0 || input.active === '0' ? 0 : 1,
    sort: Number.isFinite(Number(input.sort)) ? Number(input.sort) : 0,
  };
}

/** Expiry for a newly started plan; `null` means a lifetime purchase. */
export function planExpiry(period, from = new Date()) {
  if (period === 'lifetime') return null;
  const date = new Date(from.getTime());
  if (period === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

/**
 * Pick the best live subscription from a user's rows.
 * A row counts only while its stored expiry is in the future; a refunded or
 * expired row can never keep Premium open.
 */
export function entitlementFrom(rows = [], now = Date.now()) {
  const live = (rows || []).filter((row) => {
    if (!STATUSES_THAT_KEEP_ACCESS.has(String(row.status || ''))) return false;
    if (!row.expires_at) return true; // lifetime
    const expiry = Date.parse(row.expires_at);
    return Number.isFinite(expiry) && expiry > now;
  });

  if (live.length === 0) {
    return { premium: false, planCode: null, provider: null, expiresAt: null, autoRenew: false, lifetime: false, status: 'free' };
  }

  const lifetime = live.find((row) => !row.expires_at);
  const best =
    lifetime ||
    [...live].sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))[0];

  return {
    premium: true,
    planCode: best.plan_code || null,
    productId: best.product_id || null,
    provider: best.provider || null,
    expiresAt: best.expires_at || null,
    autoRenew: Boolean(best.auto_renew),
    lifetime: !best.expires_at,
    status: best.status,
    startedAt: best.started_at || null,
  };
}

/** Map Google Play subscriptionsv2 states onto our stored statuses. */
export function googleStateToStatus(state) {
  switch (String(state || '').toUpperCase()) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return 'active';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'grace';
    case 'SUBSCRIPTION_STATE_CANCELED':
      return 'canceled';
    case 'SUBSCRIPTION_STATE_ON_HOLD':
    case 'SUBSCRIPTION_STATE_PAUSED':
      return 'paused';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'expired';
    case 'SUBSCRIPTION_STATE_PENDING':
      return 'pending';
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return 'canceled';
    default:
      return 'pending';
  }
}

/**
 * Read the entitlement from a verified Google subscriptionsv2 payload.
 * Returns null when the payload does not contain a usable line item.
 */
export function googleEntitlement(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const line = Array.isArray(payload.lineItems) ? payload.lineItems[0] : null;
  if (!line) return null;
  const status = googleStateToStatus(payload.subscriptionState);
  return {
    status,
    productId: String(line.productId || ''),
    expiresAt: line.expiryTime ? new Date(line.expiryTime).toISOString() : null,
    autoRenew: Boolean(payload.autoRenewing),
    orderId: String(payload.latestOrderId || ''),
  };
}

/** Read the entitlement from a verified App Store receipt. */
export function appleEntitlement(payload, productId) {
  if (!payload || payload.status !== 0) return null;
  const items = [
    ...(Array.isArray(payload.latest_receipt_info) ? payload.latest_receipt_info : []),
    ...(Array.isArray(payload.receipt?.in_app) ? payload.receipt.in_app : []),
  ].filter((item) => !productId || item.product_id === productId);

  if (items.length === 0) return null;

  const withExpiry = items.filter((item) => item.expires_date_ms);
  const best = withExpiry.length
    ? withExpiry.sort((a, b) => Number(b.expires_date_ms) - Number(a.expires_date_ms))[0]
    : items[items.length - 1];

  const expiry = Number(best.expires_date_ms);
  return {
    status: 'active',
    productId: best.product_id,
    expiresAt: Number.isFinite(expiry) && expiry > 0 ? new Date(expiry).toISOString() : null,
    autoRenew: true,
    orderId: String(best.transaction_id || best.original_transaction_id || ''),
  };
}

/** Which providers have server credentials configured right now. */
export function premiumConfigured(env = process.env) {
  return {
    google: Boolean(env.GOOGLE_PLAY_SA_JSON),
    apple: Boolean(env.APPLE_SHARED_SECRET),
    googlePackage: env.GOOGLE_PLAY_PACKAGE || 'com.rifqmuslim.app',
  };
}

/** Human-readable price for the client ("$2.99", "24.99 USD" as fallback). */
export function formatPrice(priceCents, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(Number(priceCents) / 100);
  } catch {
    return `${(Number(priceCents) / 100).toFixed(2)} ${currency}`;
  }
}

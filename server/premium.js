import express from 'express';
import crypto from 'node:crypto';
import { db, newId, nowIso, auditLog } from './db.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from './auth.js';
import {
  DEFAULT_PLANS,
  normalizePlan,
  planExpiry,
  entitlementFrom,
  googleEntitlement,
  appleEntitlement,
  premiumConfigured,
} from './premium-core.js';

/**
 * Premium subscriptions.
 *
 * Nothing here grants Premium because a client asked for it. A subscription row
 * is written only after:
 *   - Google Play or the App Store confirmed the purchase over the server's own
 *     credentials, or
 *   - a Super Admin made an explicit, audited manual grant.
 * Entitlement is then recomputed from the stored expiry on every request, so a
 * refund, a cancelled renewal or an expired plan closes access automatically.
 */
export const premiumRouter = express.Router();
export const premiumAdminRouter = express.Router();

/* --------------------------------- helpers -------------------------------- */

const PLAN_COLUMNS =
  'id, code, title, price_cents, currency, period, product_id, benefits, active, sort, updated_at';

function planJson(row) {
  let benefits = [];
  try {
    benefits = JSON.parse(row.benefits || '[]');
  } catch {
    benefits = [];
  }
  return {
    code: row.code,
    title: row.title,
    priceCents: row.price_cents,
    currency: row.currency,
    period: row.period,
    productId: row.product_id,
    benefits,
    active: Boolean(row.active),
    sort: row.sort,
    updatedAt: row.updated_at,
  };
}

function seedPlans() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM premium_plans').get();
  if (n > 0) return;
  for (const input of DEFAULT_PLANS) {
    const plan = normalizePlan(input);
    db.prepare(
      `INSERT INTO premium_plans (id, code, title, price_cents, currency, period, product_id, benefits, active, sort, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId(),
      plan.code,
      plan.title,
      plan.priceCents,
      plan.currency,
      plan.period,
      plan.productId,
      JSON.stringify(plan.benefits),
      plan.active,
      plan.sort,
      nowIso()
    );
  }
  console.log('[premium] seeded the default plan catalogue');
}
seedPlans();

function planByCode(code) {
  return db.prepare(`SELECT ${PLAN_COLUMNS} FROM premium_plans WHERE code = ?`).get(String(code || '').toLowerCase());
}

function planByProduct(productId) {
  return db
    .prepare(`SELECT ${PLAN_COLUMNS} FROM premium_plans WHERE product_id = ? AND active = 1`)
    .get(String(productId || ''));
}

function subscriptionsFor(userId) {
  return db
    .prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

function entitlementFor(userId) {
  return entitlementFrom(subscriptionsFor(userId));
}

function saveSubscription(input) {
  const existing = db
    .prepare('SELECT id FROM subscriptions WHERE provider = ? AND purchase_token = ?')
    .get(input.provider, input.purchaseToken);

  if (existing) {
    db.prepare(
      `UPDATE subscriptions
          SET user_id = ?, plan_code = ?, product_id = ?, order_id = ?, status = ?,
              started_at = COALESCE(started_at, ?), expires_at = ?, auto_renew = ?,
              last_verified_at = ?, detail = ?
        WHERE id = ?`
    ).run(
      input.userId,
      input.planCode,
      input.productId,
      input.orderId || '',
      input.status,
      input.startedAt || nowIso(),
      input.expiresAt,
      input.autoRenew ? 1 : 0,
      nowIso(),
      input.detail || '',
      existing.id
    );
    return existing.id;
  }

  const id = newId();
  db.prepare(
    `INSERT INTO subscriptions
       (id, user_id, provider, plan_code, product_id, purchase_token, order_id, status,
        started_at, expires_at, auto_renew, last_verified_at, detail, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    input.userId,
    input.provider,
    input.planCode,
    input.productId,
    input.purchaseToken,
    input.orderId || '',
    input.status,
    input.startedAt || nowIso(),
    input.expiresAt,
    input.autoRenew ? 1 : 0,
    nowIso(),
    input.detail || '',
    nowIso()
  );
  return id;
}

/* ------------------------------ rate limiting ----------------------------- */

const attempts = new Map();
function allow(key, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

/* ------------------------- Google Play verification ----------------------- */

let googleToken = { value: '', expiresAt: 0 };

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function googleAccessToken() {
  if (googleToken.value && googleToken.expiresAt > Date.now() + 60_000) return googleToken.value;

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.GOOGLE_PLAY_SA_JSON || '{}');
  } catch {
    throw new Error('GOOGLE_PLAY_SA_JSON is not valid JSON.');
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('The Google Play service account needs client_email and private_key.');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: issuedAt,
      exp: issuedAt + 3600,
    })
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = base64url(signer.sign(serviceAccount.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google Play authentication failed (${res.status}).`);
  }
  googleToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return googleToken.value;
}

async function verifyGooglePurchase(plan, token) {
  const accessToken = await googleAccessToken();
  const pkg = premiumConfigured().googlePackage;
  const auth = { authorization: `Bearer ${accessToken}` };

  if (plan.period === 'lifetime') {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      pkg
    )}/purchases/products/${encodeURIComponent(plan.product_id)}/tokens/${encodeURIComponent(token)}`;
    const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google Play rejected the purchase (${res.status}).`);
    if (Number(data.purchaseState) !== 0) {
      return { status: 'pending', expiresAt: null, autoRenew: false, orderId: data.orderId || '', detail: 'purchase_not_completed' };
    }
    return {
      status: 'active',
      expiresAt: null,
      autoRenew: false,
      orderId: data.orderId || '',
      detail: 'one_time_product',
    };
  }

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    pkg
  )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Play rejected the subscription (${res.status}).`);

  const entitlement = googleEntitlement(data);
  if (!entitlement) throw new Error('Google Play returned no subscription line item.');
  return {
    status: entitlement.status,
    expiresAt: entitlement.expiresAt,
    autoRenew: entitlement.autoRenew,
    orderId: entitlement.orderId,
    detail: String(data.subscriptionState || ''),
  };
}

/* --------------------------- App Store verification ----------------------- */

async function verifyApplePurchase(plan, receipt) {
  const secret = process.env.APPLE_SHARED_SECRET;
  if (!secret) throw new Error('Apple verification is not configured.');

  const body = JSON.stringify({
    'receipt-data': receipt,
    password: secret,
    'exclude-old-transactions': true,
  });

  const post = async (url) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  let result = await post('https://buy.itunes.apple.com/verifyReceipt');
  if (result.data?.status === 21007) {
    result = await post('https://sandbox.itunes.apple.com/verifyReceipt');
  }
  if (result.data?.status !== 0) {
    throw new Error(`The App Store could not verify this receipt (status ${result.data?.status ?? result.status}).`);
  }

  const entitlement = appleEntitlement(result.data, plan.product_id);
  if (!entitlement) throw new Error('The receipt does not contain this product.');
  return {
    status: entitlement.status,
    expiresAt: entitlement.expiresAt,
    autoRenew: entitlement.autoRenew,
    orderId: entitlement.orderId,
    detail: 'app_store_receipt',
  };
}

/* -------------------------------- public API ------------------------------ */

premiumRouter.get('/plans', (_req, res) => {
  const rows = db
    .prepare(`SELECT ${PLAN_COLUMNS} FROM premium_plans WHERE active = 1 ORDER BY sort, price_cents`)
    .all();
  res.json({ plans: rows.map(planJson), configured: premiumConfigured() });
});

premiumRouter.get('/status', (req, res) => {
  const configured = premiumConfigured();
  if (!req.user) {
    return res.json({ premium: false, status: 'anonymous', configured, subscriptions: [] });
  }
  const entitlement = entitlementFor(req.user.id);
  const rows = subscriptionsFor(req.user.id).slice(0, 5).map((row) => ({
    id: row.id,
    provider: row.provider,
    planCode: row.plan_code,
    status: row.status,
    expiresAt: row.expires_at,
    autoRenew: Boolean(row.auto_renew),
    startedAt: row.started_at,
    lastVerifiedAt: row.last_verified_at,
  }));
  res.json({ ...entitlement, configured, subscriptions: rows });
});

premiumRouter.post('/verify', requireAuth, async (req, res) => {
  if (!allow(`verify:${req.user.id}`, 8)) {
    return res.status(429).json({ error: 'Too many verification attempts. Please wait a minute.' });
  }

  const provider = String(req.body?.provider || '').toLowerCase();
  const productId = String(req.body?.productId || '');
  const token = String(req.body?.purchaseToken || req.body?.receipt || '');
  if (!['google', 'apple'].includes(provider)) {
    return res.status(400).json({ error: 'Unknown purchase provider.' });
  }
  if (!token) return res.status(400).json({ error: 'A purchase token or receipt is required.' });

  const plan = planByProduct(productId);
  if (!plan) return res.status(400).json({ error: 'This product is not in the plan catalogue.' });

  const configured = premiumConfigured();
  if (!configured[provider]) {
    return res.status(503).json({
      error:
        provider === 'google'
          ? 'Google Play verification is not configured on the server yet. Add the Play service account in Settings → Environment variables.'
          : 'App Store verification is not configured on the server yet. Add the App Store shared secret in Settings → Environment variables.',
      configured,
      granted: false,
    });
  }

  try {
    const verified =
      provider === 'google' ? await verifyGooglePurchase(plan, token) : await verifyApplePurchase(plan, token);

    if (!['active', 'grace', 'canceled'].includes(verified.status)) {
      return res.status(409).json({
        error: `The store reports this purchase as "${verified.status}", so Premium was not activated.`,
        granted: false,
        storeStatus: verified.status,
      });
    }
    if (verified.expiresAt && Date.parse(verified.expiresAt) <= Date.now()) {
      return res.status(409).json({ error: 'This purchase has already expired.', granted: false });
    }

    saveSubscription({
      userId: req.user.id,
      provider,
      planCode: plan.code,
      productId: plan.product_id,
      purchaseToken: token,
      orderId: verified.orderId,
      status: verified.status,
      startedAt: nowIso(),
      expiresAt: verified.expiresAt,
      autoRenew: verified.autoRenew,
      detail: verified.detail,
    });
    auditLog(req.user, 'premium.verified', `${provider}:${plan.code}`);

    return res.json({ granted: true, ...entitlementFor(req.user.id), configured });
  } catch (err) {
    console.error('[premium] verification failed:', err.message);
    return res.status(502).json({
      error: 'The store could not confirm this purchase, so Premium was not activated. No access was granted.',
      detail: err.message,
      granted: false,
    });
  }
});

premiumRouter.post('/restore', requireAuth, async (req, res) => {
  if (!allow(`restore:${req.user.id}`, 6)) {
    return res.status(429).json({ error: 'Too many restore attempts. Please wait a minute.' });
  }
  const configured = premiumConfigured();
  const rows = subscriptionsFor(req.user.id);
  let rechecked = 0;
  let failed = 0;

  for (const row of rows.filter((r) => ['google', 'apple'].includes(r.provider)).slice(0, 5)) {
    const plan = planByCode(row.plan_code);
    if (!plan || !configured[row.provider] || !row.purchase_token) continue;
    try {
      const verified =
        row.provider === 'google'
          ? await verifyGooglePurchase(plan, row.purchase_token)
          : await verifyApplePurchase(plan, row.purchase_token);
      db.prepare(
        'UPDATE subscriptions SET status = ?, expires_at = ?, auto_renew = ?, last_verified_at = ?, detail = ? WHERE id = ?'
      ).run(
        verified.status,
        verified.expiresAt,
        verified.autoRenew ? 1 : 0,
        nowIso(),
        verified.detail || '',
        row.id
      );
      rechecked += 1;
    } catch {
      failed += 1;
    }
  }

  res.json({
    ...entitlementFor(req.user.id),
    configured,
    rechecked,
    failed,
    note:
      rechecked === 0 && !configured.google && !configured.apple
        ? 'Store verification is not configured on the server, so only purchases already verified earlier can be restored.'
        : undefined,
  });
});

/* ------------------------------ admin surface ----------------------------- */

premiumAdminRouter.use(requireAdmin);

premiumAdminRouter.get('/plans', (_req, res) => {
  const rows = db.prepare(`SELECT ${PLAN_COLUMNS} FROM premium_plans ORDER BY sort, price_cents`).all();
  res.json({ plans: rows.map(planJson), configured: premiumConfigured() });
});

premiumAdminRouter.post('/plans', requireSuperAdmin, (req, res) => {
  let plan;
  try {
    plan = normalizePlan(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (planByCode(plan.code)) return res.status(409).json({ error: 'A plan with this code already exists.' });

  db.prepare(
    `INSERT INTO premium_plans (id, code, title, price_cents, currency, period, product_id, benefits, active, sort, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    newId(),
    plan.code,
    plan.title,
    plan.priceCents,
    plan.currency,
    plan.period,
    plan.productId,
    JSON.stringify(plan.benefits),
    plan.active,
    plan.sort,
    nowIso()
  );
  auditLog(req.user, 'premium.plan.created', plan.code);
  res.status(201).json({ plan: planJson(planByCode(plan.code)) });
});

premiumAdminRouter.put('/plans/:code', requireSuperAdmin, (req, res) => {
  const existing = planByCode(req.params.code);
  if (!existing) return res.status(404).json({ error: 'Plan not found.' });

  const current = planJson(existing);
  let plan;
  try {
    plan = normalizePlan({
      ...current,
      ...(req.body || {}),
      code: existing.code,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    `UPDATE premium_plans
        SET title = ?, price_cents = ?, currency = ?, period = ?, product_id = ?,
            benefits = ?, active = ?, sort = ?, updated_at = ?
      WHERE code = ?`
  ).run(
    plan.title,
    plan.priceCents,
    plan.currency,
    plan.period,
    plan.productId,
    JSON.stringify(plan.benefits),
    plan.active,
    plan.sort,
    nowIso(),
    existing.code
  );
  auditLog(req.user, 'premium.plan.updated', existing.code);
  res.json({ plan: planJson(planByCode(existing.code)) });
});

premiumAdminRouter.delete('/plans/:code', requireSuperAdmin, (req, res) => {
  const existing = planByCode(req.params.code);
  if (!existing) return res.status(404).json({ error: 'Plan not found.' });
  db.prepare('UPDATE premium_plans SET active = 0, updated_at = ? WHERE code = ?').run(nowIso(), existing.code);
  auditLog(req.user, 'premium.plan.disabled', existing.code);
  res.json({ plan: planJson(planByCode(existing.code)) });
});

premiumAdminRouter.get('/subscriptions', (req, res) => {
  const status = String(req.query.status || '').trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const rows = status
    ? db
        .prepare(
          `SELECT s.*, u.email, u.name FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id
            WHERE s.status = ? ORDER BY s.created_at DESC LIMIT ?`
        )
        .all(status, limit)
    : db
        .prepare(
          `SELECT s.*, u.email, u.name FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id
            ORDER BY s.created_at DESC LIMIT ?`
        )
        .all(limit);

  res.json({
    subscriptions: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email || '',
      name: row.name || '',
      provider: row.provider,
      planCode: row.plan_code,
      status: row.status,
      expiresAt: row.expires_at,
      autoRenew: Boolean(row.auto_renew),
      startedAt: row.started_at,
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
    })),
    configured: premiumConfigured(),
  });
});

premiumAdminRouter.get('/summary', (_req, res) => {
  const now = nowIso();
  const active = db
    .prepare(
      "SELECT COUNT(*) AS n FROM subscriptions WHERE status IN ('active','canceled','grace') AND (expires_at IS NULL OR expires_at > ?)"
    )
    .get(now).n;
  const expired = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE expires_at IS NOT NULL AND expires_at <= ?').get(now).n;
  const manual = db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE provider = 'manual'").get().n;
  res.json({ active, expired, manual, configured: premiumConfigured() });
});

premiumAdminRouter.post('/grant', requireSuperAdmin, (req, res) => {
  const planCode = String(req.body?.planCode || '');
  const days = Math.max(1, Math.min(3650, Number(req.body?.days) || 0));
  const email = String(req.body?.email || '').trim().toLowerCase();
  const userId = String(req.body?.userId || '');

  const plan = planByCode(planCode);
  if (!plan) return res.status(400).json({ error: 'Unknown plan code.' });

  const user = userId
    ? db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId)
    : db.prepare('SELECT id, email FROM users WHERE lower(email) = ?').get(email);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const expiresAt = plan.period === 'lifetime' && !days ? null : new Date(Date.now() + days * 86_400_000).toISOString();
  const id = saveSubscription({
    userId: user.id,
    provider: 'manual',
    planCode: plan.code,
    productId: plan.product_id,
    purchaseToken: `manual:${newId()}`,
    orderId: '',
    status: 'active',
    startedAt: nowIso(),
    expiresAt,
    autoRenew: false,
    detail: `manual grant by ${req.user.email}`,
  });
  auditLog(req.user, 'premium.grant', `${user.email} ${plan.code} until ${expiresAt || 'lifetime'}`);
  res.status(201).json({ id, userId: user.id, planCode: plan.code, expiresAt });
});

premiumAdminRouter.post('/revoke', requireSuperAdmin, (req, res) => {
  const subscriptionId = String(req.body?.subscriptionId || '');
  const reason = String(req.body?.reason || '').slice(0, 200);
  const row = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId);
  if (!row) return res.status(404).json({ error: 'Subscription not found.' });

  db.prepare('UPDATE subscriptions SET status = ?, expires_at = ?, detail = ? WHERE id = ?').run(
    'revoked',
    nowIso(),
    reason || 'revoked by administrator',
    subscriptionId
  );
  auditLog(req.user, 'premium.revoke', `${row.user_id} ${row.plan_code}: ${reason || 'no reason given'}`);
  res.json({ ok: true });
});

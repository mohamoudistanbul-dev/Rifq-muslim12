import express from 'express';
import { db, nowIso, auditLog } from './db.js';
import { requireAdmin, isAdminRole } from './auth.js';
import { entitlementFrom } from './premium-core.js';
import { decideAccess, normalizeItem, normalizeTier, itemCounts } from './access-core.js';

/**
 * Free/Premium control over the content that already exists in RIFQ Muslim.
 *
 * The registry (premium_items) is seeded from the real catalogues, so the owner
 * manages actual surahs, reciters, hadith collections, Kid Academy lessons and
 * quiz categories — not an empty demo list. Seeding uses INSERT OR IGNORE, so an
 * administrator's Free/Premium decision survives restarts and new content
 * simply appears as free.
 *
 * Two guarantees:
 *   1. The client never decides access. It asks this API, and every content
 *      route that serves protected material re-checks on the server.
 *   2. Nothing is locked until the owner marks it premium: the seeded default is
 *      free + enabled + published, so adding this system changed nobody's access.
 */

export const accessRouter = express.Router();
export const accessAdminRouter = express.Router();

const COLUMNS = 'key, category, title, description, tier, enabled, published, source, sort, updated_at, updated_by';

/* ------------------------------- registry -------------------------------- */

function rowJson(row) {
  if (!row) return null;
  return {
    key: row.key,
    category: row.category,
    title: row.title,
    description: row.description,
    tier: row.tier,
    enabled: Boolean(row.enabled),
    published: Boolean(row.published),
    source: row.source,
    sort: row.sort,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function getItem(key) {
  return db.prepare(`SELECT ${COLUMNS} FROM premium_items WHERE key = ?`).get(String(key || ''));
}

function listItems({ category = '', tier = '', status = '', q = '' } = {}) {
  let rows = db.prepare(`SELECT ${COLUMNS} FROM premium_items ORDER BY category, sort, title`).all();
  const needle = String(q || '').trim().toLowerCase();

  return rows.filter((row) => {
    if (category && category !== 'all' && row.category !== category) return false;
    if (tier && tier !== 'all' && row.tier !== tier) return false;
    if (status === 'enabled' && !row.enabled) return false;
    if (status === 'disabled' && row.enabled) return false;
    if (status === 'draft' && row.published) return false;
    if (status === 'published' && !row.published) return false;
    if (needle) {
      const haystack = `${row.key} ${row.title} ${row.description} ${row.category}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

const QUIZ_CATEGORY_LABELS = {
  quran: 'Quran quiz',
  hadith: 'Hadith quiz',
  worship: 'Prayer and worship quiz',
  history: 'Islamic history quiz',
  prophets: 'Prophets quiz',
  manners: 'Islamic manners quiz',
};

/** Build the eligible items from the catalogues that already exist. */
async function catalogEntries() {
  const entries = [];

  try {
    const audio = await import('./quran-audio.js');
    const surahs =
      typeof audio.surahCatalog === 'function'
        ? audio.surahCatalog()
        : Array.isArray(audio.SURAHS)
          ? audio.SURAHS
          : [];
    surahs.forEach((surah, index) => {
      const number = Number(surah?.number) || index + 1;
      const label = [surah?.englishName, surah?.englishNameTranslation, surah?.name, surah?.latin]
        .find((value) => typeof value === 'string' && value.trim());
      entries.push({
        key: `quran.surah.${number}`,
        category: 'quran',
        title: label ? `${label} (Surah ${number})` : `Surah ${number}`,
        description: 'Quran reading',
        sort: number,
      });
    });

    (Array.isArray(audio.RECITERS) ? audio.RECITERS : []).forEach((reciter, index) => {
      entries.push({
        key: `audio.reciter.${reciter.id}`,
        category: 'audio',
        title: reciter.name || reciter.id,
        description: 'Quran recitation audio',
        sort: index + 1,
      });
    });
  } catch (err) {
    console.warn('[access] Quran catalogue unavailable:', err.message);
  }

  try {
    const hadith = await import('./hadith.js');
    (Array.isArray(hadith.HADITH_COLLECTIONS) ? hadith.HADITH_COLLECTIONS : []).forEach((collection, index) => {
      entries.push({
        key: `hadith.collection.${collection.key}`,
        category: 'hadith',
        title: collection.name || collection.key,
        description: collection.arabicName || 'Hadith collection',
        sort: index + 1,
      });
    });
  } catch (err) {
    console.warn('[access] Hadith catalogue unavailable:', err.message);
  }

  try {
    const kids = await import('./kids-data.js');
    (Array.isArray(kids.KIDS_LESSONS) ? kids.KIDS_LESSONS : []).forEach((lesson, index) => {
      const title = Array.isArray(lesson.title) ? lesson.title[0] : lesson.title;
      entries.push({
        key: `kids.lesson.${lesson.id}`,
        category: 'kids',
        title: String(title || lesson.id),
        description: `Kid Academy · ${lesson.kind || 'lesson'}`,
        sort: Number(lesson.sort) || index + 1,
      });
    });
  } catch (err) {
    console.warn('[access] Kid Academy catalogue unavailable:', err.message);
  }

  try {
    const quiz = await import('./quiz.js');
    const bank = Array.isArray(quiz.QUIZ_BANK) ? quiz.QUIZ_BANK : [];
    const categories = [...new Set(bank.map((question) => question.category).filter(Boolean))];
    categories.forEach((category, index) => {
      entries.push({
        key: `quiz.category.${category}`,
        category: 'quiz',
        title: QUIZ_CATEGORY_LABELS[category] || `${category} quiz`,
        description: 'Quiz category',
        sort: index + 1,
      });
    });
    [2, 3].forEach((level) => {
      entries.push({
        key: `quiz.level.${level}`,
        category: 'quiz',
        title: level === 3 ? 'Advanced quiz level' : 'Intermediate quiz level',
        description: `Questions at level ${level}`,
        sort: 100 + level,
      });
    });
  } catch (err) {
    console.warn('[access] Quiz catalogue unavailable:', err.message);
  }

  try {
    const duas = await import('./duas-data.js');
    (Array.isArray(duas.DUA_CATEGORIES) ? duas.DUA_CATEGORIES : []).forEach((category, index) => {
      entries.push({
        key: `duas.category.${category.id}`,
        category: 'duas',
        title: category.title || category.id,
        description: 'Duas and Adhkar category',
        sort: index + 1,
      });
    });
  } catch {
    /* Duas are bundled in the client; the owner can still add items by hand. */
  }

  return entries;
}

let seeding = null;

/** Seed once per process; safe to call from any route. */
/**
 * Run a write batch atomically.
 *
 * The database wrapper exposes exec/prepare only (no transaction helper), so the
 * batch is wrapped in explicit BEGIN/COMMIT with a rollback on failure — a
 * half-applied set of owner changes must never be persisted.
 */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

export function ensureRegistry() {
  if (!seeding) {
    seeding = (async () => {
      const entries = await catalogEntries();
      const insert = db.prepare(
        `INSERT OR IGNORE INTO premium_items (key, category, title, description, tier, enabled, published, source, sort, updated_at, updated_by)
         VALUES (?,?,?,?, 'free', 1, 1, 'catalog', ?, ?, 'system')`
      );
      tx(() => {
        for (const row of entries) {
          insert.run(row.key, row.category, row.title, row.description, row.sort || 0, nowIso());
        }
      });
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM premium_items').get();
      console.log(`[access] registry ready with ${n} controllable items`);
    })().catch((err) => {
      seeding = null;
      console.warn('[access] registry seeding failed:', err.message);
    });
  }
  return seeding;
}

/* ------------------------------- entitlement ------------------------------ */

function premiumFor(userId) {
  if (!userId) return false;
  const rows = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').all(userId);
  return entitlementFrom(rows).premium;
}

/** Decision for one item and the current caller. */
export function accessFor(req, key) {
  const item = rowJson(getItem(key));
  const decision = decideAccess(item, {
    premium: premiumFor(req.user?.id),
    role: req.user?.role || '',
  });
  return { key, item, ...decision };
}

/**
 * Server-side enforcement for a content route. Returns 402 when the item is
 * premium and the caller has no live entitlement, so a modified client cannot
 * read protected content by skipping the UI.
 */
export function requireItemAccess(keyOrFn) {
  return (req, res, next) => {
    const key = typeof keyOrFn === 'function' ? keyOrFn(req) : keyOrFn;
    if (!key) return next();
    const decision = accessFor(req, key);
    if (decision.allowed) return next();

    if (decision.locked) {
      return res.status(402).json({
        error: 'This content is part of RIFQ Muslim Premium.',
        code: 'premium_required',
        item: decision.item,
        locked: true,
      });
    }
    return res.status(404).json({
      error: decision.reason === 'disabled' ? 'This content is currently unavailable.' : 'Content not found.',
      code: decision.reason,
      locked: false,
    });
  };
}

/* ------------------------------ public API ------------------------------- */

accessRouter.get('/access/items', async (req, res) => {
  await ensureRegistry();
  const staff = isAdminRole(req.user?.role);
  const premium = premiumFor(req.user?.id);
  const category = String(req.query.category || '').trim();

  const rows = listItems({ category, status: staff ? '' : 'published' });
  const items = rows
    .map((row) => {
      const item = rowJson(row);
      const decision = decideAccess(item, { premium, role: req.user?.role || '' });
      if (!decision.visible && !staff) return null;
      return {
        key: item.key,
        category: item.category,
        title: item.title,
        description: item.description,
        tier: item.tier,
        enabled: item.enabled,
        published: item.published,
        locked: decision.locked,
        allowed: decision.allowed,
        reason: decision.reason,
      };
    })
    .filter(Boolean);

  const categories = [...new Set(rows.map((row) => row.category))].sort();
  res.json({ items, categories, premium, staff, generatedAt: nowIso() });
});

accessRouter.get('/access/check', async (req, res) => {
  await ensureRegistry();
  const key = String(req.query.key || '').trim();
  if (!key) return res.status(400).json({ error: 'A content key is required.' });
  const decision = accessFor(req, key);
  // Staff may inspect a disabled or unpublished item; ordinary visitors get 404.
  if (isAdminRole(req.user?.role) && decision.item) {
    return res.status(200).json({ ...decision, staff: true });
  }
  res.status(decision.allowed ? 200 : decision.locked ? 402 : 404).json(decision);
});

/* ------------------------------- admin API ------------------------------- */

accessAdminRouter.use(requireAdmin);

accessAdminRouter.get('/items', async (req, res) => {
  await ensureRegistry();
  const rows = listItems({
    category: String(req.query.category || ''),
    tier: String(req.query.tier || ''),
    status: String(req.query.status || ''),
    q: String(req.query.q || ''),
  });
  const premium = premiumFor(req.user?.id);
  const items = rows.map((row) => {
    const item = rowJson(row);
    const decision = decideAccess(item, { premium, role: req.user?.role || '' });
    return { ...item, locked: decision.locked, allowed: decision.allowed, accessReason: decision.reason };
  });
  const all = listItems({}).map(rowJson);

  res.json({
    items,
    total: items.length,
    counts: itemCounts(all),
    categories: [...new Set(all.map((item) => item.category))].sort(),
  });
});

accessAdminRouter.put('/items/:key', (req, res) => {
  const existing = rowJson(getItem(req.params.key));
  if (!existing) return res.status(404).json({ error: 'That content item is not in the registry.' });

  let next;
  try {
    next = normalizeItem({ ...existing, ...(req.body || {}) }, existing);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    `UPDATE premium_items
        SET title = ?, description = ?, category = ?, tier = ?, enabled = ?, published = ?, updated_at = ?, updated_by = ?
      WHERE key = ?`
  ).run(
    next.title,
    next.description,
    next.category,
    next.tier,
    next.enabled ? 1 : 0,
    next.published ? 1 : 0,
    nowIso(),
    req.user.email || req.user.id,
    existing.key
  );

  const changes = [];
  if (existing.tier !== next.tier) changes.push(`tier ${existing.tier} → ${next.tier}`);
  if (existing.enabled !== next.enabled) changes.push(next.enabled ? 'enabled' : 'disabled');
  if (existing.published !== next.published) changes.push(next.published ? 'published' : 'unpublished');
  if (existing.title !== next.title) changes.push(`title "${existing.title}" → "${next.title}"`);
  if (existing.description !== next.description) changes.push('description edited');

  auditLog(
    req.user,
    next.tier === 'premium' ? 'premium.item.premium' : 'premium.item.free',
    `${existing.key}${changes.length ? `: ${changes.join(', ')}` : ''}`
  );

  const item = rowJson(getItem(existing.key));
  res.json({ item, changes, by: req.user.email || req.user.id });
});

accessAdminRouter.post('/items/bulk', (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.map(String).slice(0, 500) : [];
  if (keys.length === 0) return res.status(400).json({ error: 'Select at least one item.' });

  const tier = req.body?.tier === undefined ? null : normalizeTier(req.body.tier);
  if (req.body?.tier !== undefined && !tier) {
    return res.status(400).json({ error: 'Tier must be either free or premium.' });
  }
  const enabled = req.body?.enabled === undefined ? null : Boolean(req.body.enabled);
  const published = req.body?.published === undefined ? null : Boolean(req.body.published);
  if (tier === null && enabled === null && published === null) {
    return res.status(400).json({ error: 'Nothing to change.' });
  }

  const update = db.prepare(
    `UPDATE premium_items
        SET tier = COALESCE(?, tier), enabled = COALESCE(?, enabled), published = COALESCE(?, published),
            updated_at = ?, updated_by = ?
      WHERE key = ?`
  );
  let changed = 0;
  tx(() => {
    for (const key of keys) {
      const result = update.run(
        tier,
        enabled === null ? null : enabled ? 1 : 0,
        published === null ? null : published ? 1 : 0,
        nowIso(),
        req.user.email || req.user.id,
        key
      );
      changed += result.changes;
    }
  });

  auditLog(
    req.user,
    tier === 'premium' ? 'premium.bulk.premium' : tier === 'free' ? 'premium.bulk.free' : 'premium.bulk.updated',
    `${changed} item(s)${enabled === null ? '' : enabled ? ' enabled' : ' disabled'}${
      published === null ? '' : published ? ' published' : ' unpublished'
    }`
  );

  res.json({ changed, requested: keys.length });
});

accessAdminRouter.post('/items', (req, res) => {
  const key = String(req.body?.key || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,80}$/.test(key)) {
    return res.status(400).json({ error: 'Key must be 3-80 characters: lowercase letters, digits, dot, dash or underscore.' });
  }
  if (getItem(key)) return res.status(409).json({ error: 'An item with this key already exists.' });

  let item;
  try {
    item = normalizeItem({ ...(req.body || {}), key });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    `INSERT INTO premium_items (key, category, title, description, tier, enabled, published, source, sort, updated_at, updated_by)
     VALUES (?,?,?,?,?,?,?, 'custom', 0, ?, ?)`
  ).run(
    key,
    item.category,
    item.title,
    item.description,
    item.tier,
    item.enabled ? 1 : 0,
    item.published ? 1 : 0,
    nowIso(),
    req.user.email || req.user.id
  );

  auditLog(req.user, 'premium.item.created', `${key} (${item.tier})`);
  res.status(201).json({ item: rowJson(getItem(key)) });
});

accessAdminRouter.delete('/items/:key', (req, res) => {
  const existing = rowJson(getItem(req.params.key));
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  if (existing.source !== 'custom') {
    return res.status(409).json({
      error: 'Catalogue items cannot be deleted. Disable them instead so the content stays in the app.',
    });
  }
  db.prepare('DELETE FROM premium_items WHERE key = ?').run(existing.key);
  auditLog(req.user, 'premium.item.deleted', existing.key);
  res.json({ ok: true });
});

/** What a free visitor sees for one item — used by the admin Preview button. */
accessAdminRouter.get('/items/:key/preview', (req, res) => {
  const item = rowJson(getItem(req.params.key));
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const asFree = decideAccess(item, { premium: false, role: '' });
  const asPremium = decideAccess(item, { premium: true, role: '' });
  res.json({
    item,
    free: { ...asFree, upgradeScreen: asFree.locked },
    premium: asPremium,
    note: asFree.locked
      ? 'A free user opening this item will see the Premium upgrade screen.'
      : asFree.allowed
        ? 'Free users can open this item right now.'
        : 'This item is not visible to anyone while it is disabled or unpublished.',
  });
});

accessAdminRouter.get('/overview', async (req, res) => {
  await ensureRegistry();
  const now = nowIso();

  const premiumUsers = db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS n FROM subscriptions
        WHERE status IN ('active','canceled','grace') AND (expires_at IS NULL OR expires_at > ?)`
    )
    .get(now).n;

  const active = db
    .prepare(
      `SELECT COUNT(*) AS n FROM subscriptions
        WHERE status IN ('active','canceled','grace') AND (expires_at IS NULL OR expires_at > ?)`
    )
    .get(now).n;

  const expired = db
    .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE expires_at IS NOT NULL AND expires_at <= ?")
    .get(now).n;

  const revoked = db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'revoked'").get().n;

  const revenueRows = db
    .prepare(
      `SELECT p.currency AS currency, SUM(p.price_cents) AS cents, COUNT(*) AS purchases
         FROM subscriptions s
         JOIN premium_plans p ON p.code = s.plan_code
        WHERE s.provider IN ('google','apple') AND s.status IN ('active','canceled','grace')
          AND (s.expires_at IS NULL OR s.expires_at > ?)
        GROUP BY p.currency`
    )
    .all(now);

  const history = db
    .prepare(
      `SELECT s.id, s.user_id, s.provider, s.plan_code, s.status, s.expires_at, s.created_at,
              u.email, u.name
         FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id
        ORDER BY s.created_at DESC LIMIT 20`
    )
    .all()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email || '',
      name: row.name || '',
      provider: row.provider,
      planCode: row.plan_code,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));

  const all = listItems({}).map(rowJson);

  res.json({
    premiumUsers,
    active,
    expired,
    revoked,
    counts: itemCounts(all),
    revenue: revenueRows.map((row) => ({
      currency: row.currency,
      cents: Number(row.cents) || 0,
      purchases: Number(row.purchases) || 0,
    })),
    revenueNote:
      revenueRows.length === 0
        ? 'No store purchase has been verified yet, so there is no recorded revenue. Store payouts remain in your Google Play and App Store consoles.'
        : 'Recorded from verified store purchases in this database; payouts and taxes remain in your store consoles.',
    history,
  });
});

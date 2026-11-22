/**
 * Scheduled announcements for RIFQ Muslim.
 *
 * An admin can write a message now and choose when it should go out, edit it
 * while it is still scheduled, cancel it, or send it immediately. The scheduler
 * below sends whatever is due through the same code path as a manual message:
 * one inbox row per recipient plus a real push attempt per registered device.
 *
 * Only the server sends. Nothing here invents a delivery: the stored counts come
 * from deliverBroadcast() and sendPushToUsers().
 */
import { db, newId, nowIso, auditLog, deliverBroadcast, broadcastRecipients } from './db.js';
import { sendPushToUsers } from './push.js';
import { allowedUserIds, isCategory, normalizeLang, routeFor } from './notify-center.js';

db.exec(`
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  audience TEXT NOT NULL DEFAULT 'all',
  audience_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  sent_at TEXT,
  recipients INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  push_sent INTEGER NOT NULL DEFAULT 0,
  push_failed INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_announcements_due ON announcements(status, scheduled_at);
`);

/* Columns added after the first release. ALTER keeps existing rows and data. */
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((entry) => entry.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

ensureColumn('announcements', 'category', "TEXT NOT NULL DEFAULT 'announcements'");
ensureColumn('announcements', 'lang', "TEXT NOT NULL DEFAULT 'en'");
ensureColumn('announcements', 'title_so', 'TEXT');
ensureColumn('announcements', 'body_so', 'TEXT');
ensureColumn('announcements', 'title_ar', 'TEXT');
ensureColumn('announcements', 'body_ar', 'TEXT');
ensureColumn('announcements', 'skipped', 'INTEGER NOT NULL DEFAULT 0');

const allUserIds = () => db.prepare('SELECT id FROM users').all().map((row) => row.id);

export function shapeAnnouncement(row) {
  if (!row) return null;
  let audienceIds = [];
  try {
    audienceIds = JSON.parse(row.audience_ids || '[]');
  } catch {
    audienceIds = [];
  }
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    link: row.link || '',
    audience: row.audience,
    audienceIds,
    status: row.status,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    sentAt: row.sent_at || null,
    recipients: Number(row.recipients || 0),
    delivered: Number(row.delivered || 0),
    failed: Number(row.failed || 0),
    pushSent: Number(row.push_sent || 0),
    pushFailed: Number(row.push_failed || 0),
    category: row.category || 'announcements',
    lang: normalizeLang(row.lang),
    translations: {
      so: { title: row.title_so || '', body: row.body_so || '' },
      ar: { title: row.title_ar || '', body: row.body_ar || '' },
    },
    skipped: Number(row.skipped || 0),
    note: row.note || null,
  };
}

export function listAnnouncements(limit = 60) {
  const take = Math.min(200, Math.max(1, Number(limit) || 60));
  return db
    .prepare('SELECT * FROM announcements ORDER BY scheduled_at DESC LIMIT ?')
    .all(take)
    .map(shapeAnnouncement);
}

export function getAnnouncement(id) {
  return shapeAnnouncement(db.prepare('SELECT * FROM announcements WHERE id = ?').get(id));
}

function normalizeWhen(value) {
  const when = new Date(String(value || ''));
  if (Number.isNaN(when.getTime())) return null;
  return when.toISOString();
}

export function createAnnouncement(actor, input) {
  const title = String(input?.title || '').trim().slice(0, 120);
  const body = String(input?.body || '').trim().slice(0, 1000);
  const link = String(input?.link || '').trim().slice(0, 300);
  const audience = String(input?.audience || 'all') === 'selected' ? 'selected' : 'all';
  const scheduledAt = normalizeWhen(input?.scheduledAt) || nowIso();
  const audienceIds = Array.isArray(input?.userIds) ? [...new Set(input.userIds.map(String).filter(Boolean))] : [];
  const category = isCategory(input?.category) ? String(input.category) : 'announcements';
  const lang = normalizeLang(input?.lang);

  if (title.length < 3 || body.length < 3) return { error: 'Title and message are required.' };
  if (audience === 'selected' && !audienceIds.length) return { error: 'Choose at least one recipient.' };

  /* Optional Somali/Arabic wording. Empty means "fall back to the main text". */
  const pick = (code, field) => String(input?.translations?.[code]?.[field] || '').trim().slice(0, 1000);
  const titleSo = pick('so', 'title').slice(0, 120);
  const bodySo = pick('so', 'body');
  const titleAr = pick('ar', 'title').slice(0, 120);
  const bodyAr = pick('ar', 'body');

  const id = newId();
  db.prepare(
    `INSERT INTO announcements (id, title, body, link, audience, audience_ids, status, scheduled_at, created_at, created_by,
       category, lang, title_so, body_so, title_ar, body_ar)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    title,
    body,
    link,
    audience,
    JSON.stringify(audienceIds),
    'scheduled',
    scheduledAt,
    nowIso(),
    actor?.id || null,
    category,
    lang,
    titleSo || null,
    bodySo || null,
    titleAr || null,
    bodyAr || null
  );
  auditLog(actor || { id: null, email: 'system' }, 'admin.announcement.create', `${category}: ${title} at ${scheduledAt}`);
  return { item: getAnnouncement(id) };
}

export function updateAnnouncement(actor, id, patch) {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!row) return { error: 'Announcement not found.', status: 404 };
  if (row.status === 'sent') return { error: 'A sent announcement can no longer be edited.', status: 409 };

  const title = patch?.title === undefined ? row.title : String(patch.title).trim().slice(0, 120);
  const body = patch?.body === undefined ? row.body : String(patch.body).trim().slice(0, 1000);
  const link = patch?.link === undefined ? row.link : String(patch.link).trim().slice(0, 300);
  const audience = patch?.audience === undefined ? row.audience : String(patch.audience) === 'selected' ? 'selected' : 'all';
  const scheduledAt =
    patch?.scheduledAt === undefined ? row.scheduled_at : normalizeWhen(patch.scheduledAt) || row.scheduled_at;
  const audienceIds =
    patch?.userIds === undefined
      ? row.audience_ids
      : JSON.stringify([...new Set((patch.userIds || []).map(String).filter(Boolean))]);

  if (title.length < 3 || body.length < 3) return { error: 'Title and message are required.', status: 400 };

  const category = patch?.category === undefined ? row.category : isCategory(patch.category) ? String(patch.category) : row.category;
  const lang = patch?.lang === undefined ? row.lang : normalizeLang(patch.lang);
  const translation = (code, field) => {
    const value = patch?.translations?.[code]?.[field];
    if (value === undefined) return field === 'title' ? row[`title_${code}`] : row[`body_${code}`];
    return String(value).trim().slice(0, 1000) || null;
  };

  db.prepare(
    `UPDATE announcements SET title = ?, body = ?, link = ?, audience = ?, audience_ids = ?, scheduled_at = ?, status = ?,
       category = ?, lang = ?, title_so = ?, body_so = ?, title_ar = ?, body_ar = ? WHERE id = ?`
  ).run(
    title,
    body,
    link,
    audience,
    audienceIds,
    scheduledAt,
    'scheduled',
    category,
    lang,
    translation('so', 'title'),
    translation('so', 'body'),
    translation('ar', 'title'),
    translation('ar', 'body'),
    id
  );
  auditLog(actor || { id: null, email: 'system' }, 'admin.announcement.update', id);
  return { item: getAnnouncement(id) };
}

export function cancelAnnouncement(actor, id) {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!row) return { error: 'Announcement not found.', status: 404 };
  if (row.status === 'sent') return { error: 'This announcement has already been sent.', status: 409 };
  db.prepare('UPDATE announcements SET status = ?, note = ? WHERE id = ?').run('cancelled', 'Cancelled before sending.', id);
  auditLog(actor || { id: null, email: 'system' }, 'admin.announcement.cancel', id);
  return { item: getAnnouncement(id) };
}

/** Sends one announcement now (used by the dashboard button and the scheduler). */
export async function sendAnnouncement(actor, id) {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!row) return { error: 'Announcement not found.', status: 404 };
  if (row.status === 'sent') return { error: 'This announcement was already sent.', status: 409 };
  if (row.status === 'cancelled') return { error: 'This announcement was cancelled.', status: 409 };

  const known = new Set(allUserIds());
  let audienceIds = [];
  try {
    audienceIds = JSON.parse(row.audience_ids || '[]');
  } catch {
    audienceIds = [];
  }
  const requested = row.audience === 'all' ? [...known] : audienceIds.filter((uid) => known.has(uid));
  const category = isCategory(row.category) ? row.category : 'announcements';

  if (!requested.length) {
    db.prepare('UPDATE announcements SET status = ?, note = ? WHERE id = ?').run(
      'failed',
      'No matching user accounts exist.',
      id
    );
    return { item: getAnnouncement(id), delivery: { recipients: 0, delivered: 0, failed: 0 }, push: null };
  }

  /* Each recipient's own switches decide first: a category they turned off is
   * never written to their inbox and never pushed to their devices. */
  const gate = allowedUserIds(requested, category);
  const targets = gate.allowed;

  if (!targets.length) {
    db.prepare('UPDATE announcements SET status = ?, note = ?, skipped = ? WHERE id = ?').run(
      'skipped',
      'Every recipient has this notification category switched off in their settings.',
      gate.blocked.length,
      id
    );
    auditLog(actor || { id: null, email: 'system' }, 'admin.announcement.skipped', `${row.title}: all recipients opted out`);
    return {
      item: getAnnouncement(id),
      delivery: { recipients: 0, delivered: 0, failed: 0 },
      push: { users: 0, devices: 0, sent: 0, failed: 0, deferred: 0 },
      blocked: gate.blocked.length,
    };
  }

  /* One wording per language, sent to the recipients who chose that language. */
  const wording = {
    en: { title: row.title, body: row.body },
    so: { title: row.title_so || row.title, body: row.body_so || row.body },
    ar: { title: row.title_ar || row.title, body: row.body_ar || row.body },
  };
  const byLanguage = new Map();
  for (const userId of targets) {
    const lang = gate.languages.get(userId) || 'en';
    if (!byLanguage.has(lang)) byLanguage.set(lang, []);
    byLanguage.get(lang).push(userId);
  }

  const link = row.link || routeFor(category);
  const totals = { recipients: 0, delivered: 0, failed: 0, pushSent: 0, pushFailed: 0, devices: 0, deferred: 0 };
  let lastPush = null;

  for (const [lang, group] of byLanguage) {
    const text = wording[lang] || wording.en;
    const delivery = deliverBroadcast({
      broadcastId: row.id,
      userIds: group,
      kind: 'announcement',
      title: text.title,
      body: text.body,
      link,
    });
    const push = await sendPushToUsers(group, {
      title: text.title,
      body: text.body,
      link,
      broadcastId: row.id,
      tag: `announce-${row.id}`,
      category,
      lang,
    });
    totals.recipients += delivery.recipients;
    totals.delivered += delivery.delivered;
    totals.failed += delivery.failed;
    totals.pushSent += push.sent;
    totals.pushFailed += push.failed;
    totals.devices += push.devices || 0;
    totals.deferred += push.deferred || 0;
    lastPush = push;
  }

  const note = totals.deferred
    ? 'Native push is waiting for Firebase credentials (FCM_SERVICE_ACCOUNT); inbox and web push were delivered.'
    : totals.devices === 0
      ? 'No recipient had a registered device, so this was in-app only.'
      : gate.blocked.length
        ? `${gate.blocked.length} recipient(s) had this category switched off and were skipped.`
        : null;

  db.prepare(
    `UPDATE announcements SET status = ?, sent_at = ?, recipients = ?, delivered = ?, failed = ?, push_sent = ?, push_failed = ?, skipped = ?, note = ?
      WHERE id = ?`
  ).run(
    'sent',
    nowIso(),
    totals.recipients,
    totals.delivered,
    totals.failed,
    totals.pushSent,
    totals.pushFailed,
    gate.blocked.length,
    note,
    id
  );

  auditLog(
    actor || { id: null, email: 'system' },
    'admin.announcement.send',
    `${category}/${row.lang}: ${row.title} -> ${totals.delivered}/${totals.recipients} inbox, ${totals.pushSent} push, ${totals.deferred} deferred`
  );
  return {
    item: getAnnouncement(id),
    delivery: { recipients: totals.recipients, delivered: totals.delivered, failed: totals.failed },
    push: lastPush,
    blocked: gate.blocked.length,
  };
}

export function announcementRecipients(id) {
  return broadcastRecipients(id);
}

/** Sends every announcement whose time has come. */
export async function tickAnnouncements(now = new Date()) {
  const due = db
    .prepare("SELECT * FROM announcements WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 20")
    .all(now.toISOString());
  const results = [];
  for (const row of due) {
    const result = await sendAnnouncement({ id: null, email: 'scheduler' }, row.id);
    results.push({ id: row.id, ok: !result.error, error: result.error || null });
  }
  return results;
}

/** Runs in the server process; a 20 s cadence is well inside "on time" for a
 *  scheduled announcement and cheap enough for a single-vCPU app. */
export function startAnnouncementScheduler(intervalMs = 20000) {
  const tick = () => {
    tickAnnouncements().catch(() => undefined);
  };
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  setTimeout(tick, 3000).unref?.();
  return () => clearInterval(timer);
}

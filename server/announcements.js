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

  if (title.length < 3 || body.length < 3) return { error: 'Title and message are required.' };
  if (audience === 'selected' && !audienceIds.length) return { error: 'Choose at least one recipient.' };

  const id = newId();
  const due = new Date(scheduledAt).getTime() <= Date.now();
  db.prepare(
    `INSERT INTO announcements (id, title, body, link, audience, audience_ids, status, scheduled_at, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    title,
    body,
    link,
    audience,
    JSON.stringify(audienceIds),
    due ? 'scheduled' : 'scheduled',
    scheduledAt,
    nowIso(),
    actor?.id || null
  );
  auditLog(actor || { id: null, email: 'system' }, 'admin.announcement.create', `${title} at ${scheduledAt}`);
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

  db.prepare(
    'UPDATE announcements SET title = ?, body = ?, link = ?, audience = ?, audience_ids = ?, scheduled_at = ?, status = ? WHERE id = ?'
  ).run(title, body, link, audience, audienceIds, scheduledAt, 'scheduled', id);
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
  const targets = row.audience === 'all' ? [...known] : audienceIds.filter((uid) => known.has(uid));

  if (!targets.length) {
    db.prepare('UPDATE announcements SET status = ?, note = ? WHERE id = ?').run(
      'failed',
      'No matching user accounts exist.',
      id
    );
    return { item: getAnnouncement(id), delivery: { recipients: 0, delivered: 0, failed: 0 }, push: null };
  }

  const delivery = deliverBroadcast({
    broadcastId: row.id,
    userIds: targets,
    kind: 'announcement',
    title: row.title,
    body: row.body,
    link: row.link || '',
  });

  const push = await sendPushToUsers(targets, {
    title: row.title,
    body: row.body,
    link: row.link || '/notifications',
    broadcastId: row.id,
    tag: `announce-${row.id}`,
  });

  db.prepare(
    `UPDATE announcements SET status = ?, sent_at = ?, recipients = ?, delivered = ?, failed = ?, push_sent = ?, push_failed = ?, note = ?
      WHERE id = ?`
  ).run(
    'sent',
    nowIso(),
    delivery.recipients,
    delivery.delivered,
    delivery.failed,
    push.sent,
    push.failed,
    push.devices === 0 ? 'No recipient had a registered device, so this was in-app only.' : null,
    id
  );

  auditLog(
    actor || { id: null, email: 'system' },
    'admin.announcement.send',
    `${row.title} -> ${delivery.delivered}/${delivery.recipients} inbox, ${push.sent} push`
  );
  return { item: getAnnouncement(id), delivery, push };
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

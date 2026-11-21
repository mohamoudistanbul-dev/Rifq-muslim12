/**
 * Rich prayer notifications for RIFQ Muslim.
 *
 * Two real behaviours live here, both stored per account:
 *  1. "Already Prayed" — a prayer confirmation for a given day, so the tracker
 *     and the notification agree, and a second tap cannot double count.
 *  2. "Remind in 15 min" — a queued reminder that the server pushes for real
 *     when its time comes, so the snooze works even with the app closed.
 *
 * The payload builder is the single definition of the expanded notification
 * (title with remaining time, prayer time, banner image, progress bar and the
 * three action buttons). The service worker, the Android bridge and the
 * verification script all consume this exact shape.
 */
import { db, newId, nowIso } from './db.js';
import { sendPushToUsers } from './push.js';

export const PRAYER_LABELS = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

export const PRAYER_ACTIONS = [
  { action: 'prayed', title: 'Already Prayed' },
  { action: 'snooze', title: 'Remind in 15 min' },
  { action: 'open', title: 'Open App' },
];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPrayerKey(value) {
  return Object.prototype.hasOwnProperty.call(PRAYER_LABELS, String(value || ''));
}

export function isDayKey(value) {
  return DAY_RE.test(String(value || ''));
}

/** Local calendar day for the caller's timezone, `YYYY-MM-DD`. */
export function dayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function prayerImage(prayer) {
  return isPrayerKey(prayer) ? `/notif/prayer-${prayer}.png` : '/notif/prayer.png';
}

/**
 * The expanded notification, exactly as the device should render it.
 * `progress` drives the Android progress bar (elapsed part of the hour before
 * the prayer); it is clamped so a stale reminder cannot render a negative bar.
 */
export function prayerPayload({
  prayer,
  timeLabel = '',
  remainingMinutes = 0,
  day,
  body,
  url,
} = {}) {
  const label = PRAYER_LABELS[prayer] || 'Prayer';
  const mins = Math.max(0, Math.round(Number(remainingMinutes) || 0));
  const window = 60;
  const title = mins > 0 ? `${label} – ${mins} min remaining` : `${label} — time to pray`;
  const detail =
    body ||
    (timeLabel
      ? `${label} begins at ${timeLabel}. Tap a button below to confirm the prayer or be reminded again.`
      : `${label} is due now. Tap a button below to confirm the prayer or be reminded again.`);
  return {
    kind: 'prayer',
    prayer,
    title,
    body: detail,
    time: timeLabel || null,
    remainingMinutes: mins,
    image: prayerImage(prayer),
    progress: { value: Math.max(0, window - Math.min(window, mins)), max: window },
    url: url || `/athan?prayer=${prayer}`,
    tag: `rifq-prayer-${prayer}-${day || dayKey()}`,
    actions: PRAYER_ACTIONS,
    requireInteraction: true,
  };
}

/* ------------------------------- storage ---------------------------------- */

db.exec(`
CREATE TABLE IF NOT EXISTS prayer_confirmations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prayer TEXT NOT NULL,
  day TEXT NOT NULL,
  source TEXT,
  confirmed_at TEXT NOT NULL,
  UNIQUE(user_id, prayer, day)
);
CREATE INDEX IF NOT EXISTS idx_prayer_conf_user ON prayer_confirmations(user_id, day);

CREATE TABLE IF NOT EXISTS prayer_snoozes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prayer TEXT NOT NULL,
  day TEXT NOT NULL,
  fire_at TEXT NOT NULL,
  title TEXT,
  body TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  sent_at TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_prayer_snooze_due ON prayer_snoozes(status, fire_at);
`);

export function confirmPrayer(userId, { prayer, day, source = 'notification' } = {}) {
  if (!isPrayerKey(prayer)) return { error: 'Unknown prayer.' };
  const target = isDayKey(day) ? day : dayKey();
  const existing = db
    .prepare('SELECT * FROM prayer_confirmations WHERE user_id = ? AND prayer = ? AND day = ?')
    .get(userId, prayer, target);
  if (existing) {
    return { already: true, prayer, day: target, confirmedAt: existing.confirmed_at, source: existing.source };
  }
  const at = nowIso();
  db.prepare(
    'INSERT INTO prayer_confirmations (id, user_id, prayer, day, source, confirmed_at) VALUES (?,?,?,?,?,?)'
  ).run(newId(), userId, prayer, target, String(source || '').slice(0, 40), at);
  return { already: false, prayer, day: target, confirmedAt: at, source };
}

export function undoConfirmation(userId, { prayer, day } = {}) {
  if (!isPrayerKey(prayer)) return { error: 'Unknown prayer.' };
  const target = isDayKey(day) ? day : dayKey();
  const info = db
    .prepare('DELETE FROM prayer_confirmations WHERE user_id = ? AND prayer = ? AND day = ?')
    .run(userId, prayer, target);
  return { removed: Number(info.changes || 0), prayer, day: target };
}

export function listConfirmations(userId, day) {
  const target = isDayKey(day) ? day : dayKey();
  return db
    .prepare('SELECT prayer, day, source, confirmed_at FROM prayer_confirmations WHERE user_id = ? AND day = ? ORDER BY confirmed_at ASC')
    .all(userId, target)
    .map((row) => ({ prayer: row.prayer, day: row.day, source: row.source || null, confirmedAt: row.confirmed_at }));
}

/** Queues a real follow-up reminder; the scheduler pushes it when it is due. */
export function scheduleSnooze(userId, { prayer, day, minutes = 15, title, body, url } = {}) {
  if (!isPrayerKey(prayer)) return { error: 'Unknown prayer.' };
  const mins = Math.min(120, Math.max(5, Math.round(Number(minutes) || 15)));
  const target = isDayKey(day) ? day : dayKey();
  const fireAt = new Date(Date.now() + mins * 60_000).toISOString();
  const label = PRAYER_LABELS[prayer];
  const id = newId();
  db.prepare(
    'INSERT INTO prayer_snoozes (id, user_id, prayer, day, fire_at, title, body, url, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    userId,
    prayer,
    target,
    fireAt,
    String(title || `${label} reminder`).slice(0, 120),
    String(body || `You asked to be reminded about ${label}.`).slice(0, 400),
    String(url || `/athan?prayer=${prayer}`).slice(0, 300),
    'pending',
    nowIso()
  );
  return { id, prayer, day: target, minutes: mins, fireAt };
}

export function listSnoozes(userId, day) {
  const target = isDayKey(day) ? day : dayKey();
  return db
    .prepare('SELECT * FROM prayer_snoozes WHERE user_id = ? AND day = ? ORDER BY fire_at ASC')
    .all(userId, target)
    .map((row) => ({
      id: row.id,
      prayer: row.prayer,
      day: row.day,
      fireAt: row.fire_at,
      status: row.status,
      title: row.title,
      body: row.body,
      url: row.url,
      sentAt: row.sent_at || null,
      error: row.error || null,
    }));
}

export function cancelSnooze(userId, id) {
  const clean = String(id || '').trim();
  if (!clean) return { removed: 0 };
  const info = db
    .prepare("DELETE FROM prayer_snoozes WHERE id = ? AND user_id = ? AND status = 'pending'")
    .run(clean, userId);
  return { removed: Number(info.changes || 0) };
}

/** Per-prayer day summary for the admin dashboard. */
export function prayerSummary(day) {
  const target = isDayKey(day) ? day : dayKey();
  const confirmed = db
    .prepare('SELECT prayer, COUNT(*) AS c FROM prayer_confirmations WHERE day = ? GROUP BY prayer')
    .all(target);
  const snoozed = db
    .prepare("SELECT status, COUNT(*) AS c FROM prayer_snoozes WHERE day = ? GROUP BY status")
    .all(target);
  return {
    day: target,
    confirmed: Object.fromEntries(confirmed.map((row) => [row.prayer, Number(row.c)])),
    snoozes: Object.fromEntries(snoozed.map((row) => [row.status, Number(row.c)])),
  };
}

/* ------------------------------- delivery --------------------------------- */

/**
 * Sends every due snooze. Runs in the server process on a short cadence, so a
 * "Remind in 15 min" tap reaches the phone even if the app was closed since.
 */
export async function tickSnoozes(now = new Date()) {
  const due = db
    .prepare("SELECT * FROM prayer_snoozes WHERE status = 'pending' AND fire_at <= ? ORDER BY fire_at ASC LIMIT 25")
    .all(now.toISOString());

  const results = [];
  for (const row of due) {
    const payload = prayerPayload({
      prayer: row.prayer,
      day: row.day,
      remainingMinutes: 0,
      body: row.body || `You asked to be reminded about ${PRAYER_LABELS[row.prayer]}.`,
      url: row.url || `/athan?prayer=${row.prayer}`,
    });
    let status = 'sent';
    let error = null;
    try {
      const summary = await sendPushToUsers([row.user_id], {
        ...payload,
        title: row.title || payload.title,
        tag: `rifq-snooze-${row.id}`,
      });
      if (summary.devices === 0) {
        status = 'no_device';
        error = 'No device is registered for this account.';
      } else if (summary.sent === 0) {
        status = 'failed';
        error = summary.errors?.[0]?.error || 'The push service refused every device.';
      }
    } catch (err) {
      status = 'failed';
      error = String(err?.message || err).slice(0, 200);
    }
    db.prepare('UPDATE prayer_snoozes SET status = ?, sent_at = ?, error = ? WHERE id = ?').run(
      status,
      nowIso(),
      error,
      row.id
    );
    results.push({ id: row.id, prayer: row.prayer, status, error });
  }
  return results;
}

export function startSnoozeScheduler(intervalMs = 20000) {
  const tick = () => {
    tickSnoozes().catch(() => undefined);
  };
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  const warm = setTimeout(tick, 4000);
  if (typeof warm.unref === 'function') warm.unref();
  return () => clearInterval(timer);
}

/* --------------------------------- routes --------------------------------- */

export function registerRichNotifyRoutes(app, requireAuth, requireAdmin) {
  /** The exact expanded-notification shape, for the app and for checks. */
  app.get('/api/prayers/rich-preview', requireAuth, (req, res) => {
    const prayer = String(req.query?.prayer || 'dhuhr');
    if (!isPrayerKey(prayer)) return res.status(400).json({ error: 'Unknown prayer.' });
    const minutes = Number(req.query?.minutes ?? 30);
    res.json(
      prayerPayload({
        prayer,
        timeLabel: String(req.query?.time || ''),
        remainingMinutes: Number.isFinite(minutes) ? minutes : 30,
        day: isDayKey(req.query?.day) ? String(req.query.day) : dayKey(),
      })
    );
  });

  app.get('/api/prayers/confirmed', requireAuth, (req, res) => {
    const day = isDayKey(req.query?.day) ? String(req.query.day) : dayKey();
    res.json({ day, confirmations: listConfirmations(req.user.id, day) });
  });

  app.post('/api/prayers/confirm', requireAuth, (req, res) => {
    const result = confirmPrayer(req.user.id, {
      prayer: req.body?.prayer,
      day: req.body?.day,
      source: req.body?.source || 'notification',
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.delete('/api/prayers/confirm', requireAuth, (req, res) => {
    const result = undoConfirmation(req.user.id, { prayer: req.body?.prayer, day: req.body?.day });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.get('/api/prayers/snooze', requireAuth, (req, res) => {
    const day = isDayKey(req.query?.day) ? String(req.query.day) : dayKey();
    res.json({ day, snoozes: listSnoozes(req.user.id, day) });
  });

  app.post('/api/prayers/snooze', requireAuth, (req, res) => {
    const result = scheduleSnooze(req.user.id, {
      prayer: req.body?.prayer,
      day: req.body?.day,
      minutes: req.body?.minutes,
      title: req.body?.title,
      body: req.body?.body,
      url: req.body?.url,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result);
  });

  app.delete('/api/prayers/snooze/:id', requireAuth, (req, res) => {
    res.json(cancelSnooze(req.user.id, req.params.id));
  });

  app.get('/api/admin/prayers/summary', requireAdmin, (req, res) => {
    res.json(prayerSummary(isDayKey(req.query?.day) ? String(req.query.day) : dayKey()));
  });
}

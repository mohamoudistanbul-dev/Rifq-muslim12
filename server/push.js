/**
 * Real device delivery for RIFQ Muslim (Web Push).
 *
 * What this does:
 *  - Owns the VAPID key pair. Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
 *    when supplied, otherwise they are generated once and stored in app_settings
 *    so the same identity survives restarts (a browser subscription is bound to
 *    that key, so rotating it silently would break every existing device).
 *  - Stores one row per device subscription, scoped to the signed-in account.
 *  - Actually calls the push service for every device and records what happened.
 *    A failure is stored as a failure: this module never reports "sent" for a
 *    device it could not reach.
 *
 * What this is NOT: a native FCM/APNs client. Inside the Android WebView the
 * platform push service still has to exist (Firebase project + google-services
 * config) for a closed app to wake up; the web build uses the browser's own push
 * service, which needs no account from the owner.
 */
import * as webpush from 'web-push';
import { db, getSetting, setSetting, newId, nowIso } from './db.js';

const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || 'mailto:rifqmuslim@gmail.com');

function ensureColumn(table, column, type) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch {
    /* an older database without this table is handled by the caller */
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS push_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  last_ok_at TEXT,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);
`);

/* Per-notification delivery outcome, so the dashboard can show the truth. */
ensureColumn('notifications', 'push_status', 'TEXT');
ensureColumn('notifications', 'push_error', 'TEXT');
ensureColumn('notifications', 'push_at', 'TEXT');

/* ------------------------------- VAPID keys ------------------------------- */

let cachedKeys = null;

export function vapidKeys() {
  if (cachedKeys) return cachedKeys;
  const envPublic = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPrivate = String(process.env.VAPID_PRIVATE_KEY || '').trim();

  if (envPublic && envPrivate) {
    cachedKeys = { publicKey: envPublic, privateKey: envPrivate, source: 'environment' };
  } else {
    const storedPublic = getSetting('vapid_public');
    const storedPrivate = getSetting('vapid_private');
    if (storedPublic && storedPrivate) {
      cachedKeys = { publicKey: storedPublic, privateKey: storedPrivate, source: 'database' };
    } else {
      const generated = webpush.generateVAPIDKeys();
      setSetting('vapid_public', generated.publicKey);
      setSetting('vapid_private', generated.privateKey);
      cachedKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey, source: 'generated' };
    }
  }

  webpush.setVapidDetails(VAPID_SUBJECT, cachedKeys.publicKey, cachedKeys.privateKey);
  return cachedKeys;
}

/* ------------------------------- devices ---------------------------------- */

function hostOf(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return '';
  }
}

function shapeDevice(row) {
  return {
    id: row.id,
    label: row.label || hostOf(row.endpoint),
    host: hostOf(row.endpoint),
    createdAt: row.created_at,
    lastOkAt: row.last_ok_at || null,
    lastError: row.last_error || null,
    failCount: Number(row.fail_count || 0),
  };
}

export function listDevices(userId) {
  return db
    .prepare('SELECT * FROM push_devices WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map(shapeDevice);
}

/** Saves (or refreshes) one device. The endpoint is unique, so a repeat
 *  subscription from the same browser updates the row instead of duplicating. */
export function saveDevice(userId, subscription, label = '') {
  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  if (!/^https:\/\//i.test(endpoint)) return { error: 'A push endpoint must be an https URL.' };
  if (p256dh.length < 20 || auth.length < 8) return { error: 'The subscription keys are incomplete.' };

  const existing = db.prepare('SELECT * FROM push_devices WHERE endpoint = ?').get(endpoint);
  if (existing) {
    db.prepare('UPDATE push_devices SET user_id = ?, p256dh = ?, auth = ?, label = ? WHERE id = ?').run(
      userId,
      p256dh,
      auth,
      String(label || existing.label || '').slice(0, 80),
      existing.id
    );
    return { device: shapeDevice(db.prepare('SELECT * FROM push_devices WHERE id = ?').get(existing.id)), updated: true };
  }

  const id = newId();
  db.prepare(
    'INSERT INTO push_devices (id, user_id, endpoint, p256dh, auth, label, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, userId, endpoint, p256dh, auth, String(label || '').slice(0, 80), nowIso());
  return { device: shapeDevice(db.prepare('SELECT * FROM push_devices WHERE id = ?').get(id)), updated: false };
}

/** Removes only the caller's own device. */
export function removeDevice(userId, endpoint) {
  const clean = String(endpoint || '').trim();
  const row = db.prepare('SELECT * FROM push_devices WHERE endpoint = ? AND user_id = ?').get(clean, userId);
  if (!row) return 0;
  db.prepare('DELETE FROM push_devices WHERE id = ?').run(row.id);
  return 1;
}

export function deviceCount(userId) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM push_devices WHERE user_id = ?').get(userId);
  return Number(row?.c || 0);
}

/* ------------------------------- delivery --------------------------------- */

function recordResult(broadcastId, userId, state) {
  if (!broadcastId) return;
  const status = state.sent > 0 ? 'sent' : state.devices > 0 ? 'failed' : 'no_device';
  const error = state.sent > 0 ? null : state.lastError || (state.devices === 0 ? 'No device is registered for this account.' : null);
  db.prepare(
    'UPDATE notifications SET push_status = ?, push_error = ?, push_at = ? WHERE broadcast_id = ? AND user_id = ?'
  ).run(status, error ? String(error).slice(0, 200) : null, nowIso(), broadcastId, userId);
}

/**
 * Sends one payload to every registered device of the given users.
 * Returns real counts plus the per-user outcome, including failures.
 */
export async function sendPushToUsers(userIds, payload) {
  vapidKeys();
  const targets = [...new Set((userIds || []).filter(Boolean))];
  const summary = { users: targets.length, devices: 0, sent: 0, failed: 0, removed: 0, perUser: {}, errors: [] };

  const devicesStmt = db.prepare('SELECT * FROM push_devices WHERE user_id = ?');
  const okStmt = db.prepare('UPDATE push_devices SET last_ok_at = ?, last_error = NULL, fail_count = 0 WHERE id = ?');
  const failStmt = db.prepare('UPDATE push_devices SET last_error = ?, fail_count = fail_count + 1 WHERE id = ?');
  const dropStmt = db.prepare('DELETE FROM push_devices WHERE id = ?');

  const body = JSON.stringify({
    title: payload.title || 'RIFQ Muslim',
    body: payload.body || '',
    url: payload.link || payload.url || '/notifications',
    tag: payload.tag || (payload.broadcastId ? `rifq-${payload.broadcastId}` : 'rifq'),
    broadcastId: payload.broadcastId || null,
    /* Rich presentation (expanded image, actions, progress). Absent fields are
     * simply omitted, so existing announcements keep their plain notification. */
    kind: payload.kind || null,
    prayer: payload.prayer || null,
    time: payload.time || null,
    remainingMinutes: Number.isFinite(Number(payload.remainingMinutes)) ? Number(payload.remainingMinutes) : null,
    image: payload.image || null,
    progress: payload.progress || null,
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 3) : null,
    requireInteraction: payload.requireInteraction === true,
  });

  for (const userId of targets) {
    const devices = devicesStmt.all(userId);
    const state = { devices: devices.length, sent: 0, failed: 0, lastError: null };

    for (const device of devices) {
      summary.devices += 1;
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          body,
          { TTL: 3600, urgency: payload.urgency || 'high' }
        );
        okStmt.run(nowIso(), device.id);
        state.sent += 1;
        summary.sent += 1;
      } catch (error) {
        const status = Number(error?.statusCode || 0);
        const message = String(error?.body || error?.message || error).slice(0, 200);
        state.failed += 1;
        state.lastError = message;
        summary.failed += 1;
        // 404/410 mean the browser dropped the subscription: forget it, so the
        // account does not keep a device that can never receive anything.
        if (status === 404 || status === 410) {
          dropStmt.run(device.id);
          summary.removed += 1;
        } else {
          failStmt.run(message, device.id);
        }
        summary.errors.push({ userId, status, error: message });
      }
    }

    summary.perUser[userId] = state;
    recordResult(payload.broadcastId, userId, state);
  }

  return summary;
}

/* --------------------------------- routes --------------------------------- */

export function registerPushRoutes(app, requireAuth) {
  /** The browser needs the public key before it can subscribe. Public by design. */
  app.get('/api/push/key', (req, res) => {
    const keys = vapidKeys();
    res.json({ publicKey: keys.publicKey, source: keys.source });
  });

  app.get('/api/push/status', requireAuth, (req, res) => {
    const devices = listDevices(req.user.id);
    res.json({
      devices,
      count: devices.length,
      publicKey: vapidKeys().publicKey,
      keySource: vapidKeys().source,
    });
  });

  app.post('/api/push/subscribe', requireAuth, (req, res) => {
    const result = saveDevice(req.user.id, req.body?.subscription, req.body?.label);
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(result.updated ? 200 : 201).json({ device: result.device, count: deviceCount(req.user.id) });
  });

  app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
    const removed = removeDevice(req.user.id, req.body?.endpoint);
    res.json({ removed, count: deviceCount(req.user.id) });
  });

  /** Sends a real push to the caller's own devices and reports the truth. */
  app.post('/api/push/test', requireAuth, async (req, res) => {
    const devices = listDevices(req.user.id);
    if (!devices.length) {
      return res.status(200).json({
        devices: 0,
        sent: 0,
        failed: 0,
        message: 'No device is registered yet. Enable background alerts on this device first.',
      });
    }
    const result = await sendPushToUsers([req.user.id], {
      title: 'RIFQ Muslim test',
      body: 'Background alerts are working on this device.',
      url: '/notifications',
      tag: `rifq-test-${Date.now()}`,
    });
    res.json({
      devices: result.devices,
      sent: result.sent,
      failed: result.failed,
      errors: result.errors,
      message:
        result.sent > 0
          ? `Sent to ${result.sent} device(s).`
          : 'The push service refused every device; see errors for the reason.',
    });
  });
}

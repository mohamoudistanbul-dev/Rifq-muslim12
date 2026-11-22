/**
 * Firebase Cloud Messaging (HTTP v1) delivery for RIFQ Muslim.
 *
 * This sits BESIDE the existing Web Push path, it does not replace it:
 *  - Web Push already reaches a browser or an installed PWA with no account
 *    from the owner.
 *  - FCM is what wakes a native Android/iOS build when the app is closed. It
 *    needs the Firebase project's service account on the server and a native
 *    shell that was built with the matching google-services.json.
 *
 * Nothing here invents a delivery. When the service account is absent the
 * module reports `configured: false` and counts the tokens as deferred, so the
 * dashboard can say "waiting for Firebase credentials" instead of "sent".
 *
 * Credentials come from the environment only (never the database, never the
 * client): FCM_SERVICE_ACCOUNT = the full service-account JSON, optionally with
 * FCM_PROJECT_ID to override project_id.
 */
import crypto from 'node:crypto';
import { db, newId, nowIso } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'android',
  label TEXT,
  app_version TEXT,
  language TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_ok_at TEXT,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
`);

const TOKEN_RE = /^[A-Za-z0-9_\-:.]{20,4096}$/;
const PLATFORMS = new Set(['android', 'ios', 'web']);

/* ------------------------------ credentials -------------------------------- */

let cachedAuth = { clientEmail: null, token: null, expiresAt: 0 };

export function fcmCredentials() {
  const raw = String(process.env.FCM_SERVICE_ACCOUNT || '').trim();
  if (!raw) {
    return {
      configured: false,
      reason:
        'FCM_SERVICE_ACCOUNT is not set on the server. Add the Firebase service-account JSON in Settings → Environment variables to enable closed-app push.',
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { configured: false, reason: 'FCM_SERVICE_ACCOUNT is not valid JSON. Paste the whole service-account file.' };
  }
  const projectId = String(parsed.project_id || process.env.FCM_PROJECT_ID || '').trim();
  const clientEmail = String(parsed.client_email || '').trim();
  const privateKey = String(parsed.private_key || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    return {
      configured: false,
      reason: 'The service account is missing project_id, client_email or private_key.',
    };
  }
  return { configured: true, projectId, clientEmail, privateKey };
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** OAuth2 access token from the service account (cached until ~1 min before expiry). */
async function accessToken(creds) {
  if (cachedAuth.clientEmail === creds.clientEmail && cachedAuth.token && cachedAuth.expiresAt > Date.now()) {
    return cachedAuth.token;
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: issuedAt,
      exp: issuedAt + 3600,
    })
  );
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(creds.privateKey);
  const assertion = `${header}.${claims}.${Buffer.from(signature).toString('base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(
      String(json.error_description || json.error || `OAuth token request failed (${res.status})`).slice(0, 200)
    );
  }
  const lifetime = Number(json.expires_in || 3600);
  cachedAuth = {
    clientEmail: creds.clientEmail,
    token: json.access_token,
    expiresAt: Date.now() + Math.max(60, lifetime - 60) * 1000,
  };
  return cachedAuth.token;
}

/* --------------------------------- tokens ---------------------------------- */

function shapeToken(row) {
  return {
    id: row.id,
    platform: row.platform,
    label: row.label || row.platform,
    appVersion: row.app_version || null,
    language: row.language || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOkAt: row.last_ok_at || null,
    lastError: row.last_error || null,
    failCount: Number(row.fail_count || 0),
    tokenTail: String(row.token || '').slice(-6),
  };
}

export function listTokens(userId) {
  return db
    .prepare('SELECT * FROM push_tokens WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId)
    .map(shapeToken);
}

export function tokenCounts() {
  const rows = db.prepare('SELECT platform, COUNT(*) AS c FROM push_tokens GROUP BY platform').all();
  const byPlatform = { android: 0, ios: 0, web: 0 };
  for (const row of rows) byPlatform[row.platform] = Number(row.c || 0);
  const total = Object.values(byPlatform).reduce((sum, n) => sum + n, 0);
  const users = Number(db.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM push_tokens').get()?.c || 0);
  return { total, users, byPlatform };
}

/** Stores or refreshes one device token. A repeat registration updates, never duplicates. */
export function saveToken(userId, input = {}) {
  const token = String(input.token || '').trim();
  const platform = PLATFORMS.has(String(input.platform || '')) ? String(input.platform) : 'android';
  if (!TOKEN_RE.test(token)) return { error: 'That is not a valid device push token.' };
  const label = String(input.label || '').slice(0, 80);
  const appVersion = String(input.appVersion || '').slice(0, 40);
  const language = ['en', 'so', 'ar'].includes(String(input.language || '')) ? String(input.language) : null;

  const existing = db.prepare('SELECT * FROM push_tokens WHERE token = ?').get(token);
  const at = nowIso();
  if (existing) {
    db.prepare(
      'UPDATE push_tokens SET user_id = ?, platform = ?, label = ?, app_version = ?, language = ?, updated_at = ? WHERE id = ?'
    ).run(userId, platform, label || existing.label || '', appVersion || existing.app_version || '', language || existing.language || null, at, existing.id);
    return { token: shapeToken(db.prepare('SELECT * FROM push_tokens WHERE id = ?').get(existing.id)), updated: true };
  }

  const id = newId();
  db.prepare(
    'INSERT INTO push_tokens (id, user_id, token, platform, label, app_version, language, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, userId, token, platform, label, appVersion, language, at, at);
  return { token: shapeToken(db.prepare('SELECT * FROM push_tokens WHERE id = ?').get(id)), updated: false };
}

/** Removes only the caller's own token. */
export function removeToken(userId, token) {
  const clean = String(token || '').trim();
  if (!clean) return 0;
  const info = db.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').run(clean, userId);
  return Number(info.changes || 0);
}

/* -------------------------------- payloads --------------------------------- */

/** Android notification channel per category, so prayer and radio alerts can have
 *  different importance without changing every other channel. */
export function channelFor(category) {
  switch (String(category || '')) {
    case 'prayer':
      return 'rifq_prayer';
    case 'prayer_reminders':
      return 'rifq_prayer_reminders';
    case 'quran':
      return 'rifq_quran';
    case 'quran_radio':
      return 'rifq_radio';
    case 'kids':
      return 'rifq_kids';
    case 'adhkar':
      return 'rifq_adhkar';
    default:
      return 'rifq_announcements';
  }
}

/**
 * One FCM v1 message. `notification` carries what the system tray shows; `data`
 * carries the in-app destination so a tap can open the right screen even when
 * the payload is handled by a background service.
 */
export function fcmMessage(token, payload = {}) {
  const title = String(payload.title || 'RIFQ Muslim').slice(0, 160);
  const body = String(payload.body || '').slice(0, 900);
  const url = String(payload.url || payload.link || '/notifications').slice(0, 300);
  const dir = payload.dir === 'rtl' ? 'rtl' : 'ltr';
  const lang = String(payload.lang || 'en');
  const category = String(payload.category || 'announcements');
  const tag = String(payload.tag || (payload.broadcastId ? `rifq-${payload.broadcastId}` : 'rifq-push'));

  const data = {
    url,
    tag,
    category,
    lang,
    dir,
    kind: String(payload.kind || ''),
    prayer: String(payload.prayer || ''),
    broadcastId: String(payload.broadcastId || ''),
  };

  const message = {
    token,
    notification: { title, body },
    data,
    android: {
      priority: payload.urgency === 'normal' ? 'normal' : 'high',
      notification: {
        channel_id: channelFor(category),
        tag,
        icon: 'ic_stat_rifq',
        color: '#0B3D2E',
        sound: 'default',
        default_vibrate_timings: true,
        ...(payload.image ? { image: String(payload.image).slice(0, 300) } : {}),
      },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          alert: { title, body },
          sound: 'default',
          'mutable-content': 1,
          ...(payload.badge === undefined ? {} : { badge: Number(payload.badge) || 0 }),
        },
        url,
        tag,
        category,
        dir,
      },
    },
    webpush: {
      notification: {
        title,
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        dir,
        lang,
        ...(payload.image ? { image: String(payload.image).slice(0, 300) } : {}),
      },
      fcmOptions: { link: url },
    },
  };

  return { message };
}

/* -------------------------------- delivery --------------------------------- */

/**
 * Sends one payload to every FCM token of the given users.
 *
 * Returns real counts. Tokens the service rejects as unregistered/invalid are
 * deleted (they can never work again); a transient error only increments the
 * failure counter so the device keeps its registration.
 */
export async function sendFcmToUsers(userIds, payload = {}) {
  const targets = [...new Set((userIds || []).filter(Boolean))];
  const summary = {
    configured: false,
    users: targets.length,
    tokens: 0,
    sent: 0,
    failed: 0,
    removed: 0,
    deferred: 0,
    perUser: {},
    errors: [],
  };
  if (!targets.length) return summary;

  const rows = [];
  const stmt = db.prepare('SELECT * FROM push_tokens WHERE user_id = ?');
  for (const userId of targets) {
    const tokens = stmt.all(userId);
    summary.perUser[userId] = { tokens: tokens.length, sent: 0, failed: 0, lastError: null };
    summary.tokens += tokens.length;
    for (const row of tokens) rows.push({ ...row, userId });
  }
  if (!rows.length) return summary;

  const creds = fcmCredentials();
  if (!creds.configured) {
    summary.deferred = rows.length;
    summary.errors.push({ error: creds.reason, code: 'not_configured' });
    for (const userId of targets) {
      summary.perUser[userId].lastError = 'Waiting for Firebase credentials (FCM_SERVICE_ACCOUNT).';
    }
    return summary;
  }

  summary.configured = true;
  let token;
  try {
    token = await accessToken(creds);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 200);
    summary.failed = rows.length;
    summary.errors.push({ error: message, code: 'auth_failed' });
    for (const userId of targets) {
      summary.perUser[userId].failed = summary.perUser[userId].tokens;
      summary.perUser[userId].lastError = message;
    }
    return summary;
  }

  const okStmt = db.prepare('UPDATE push_tokens SET last_ok_at = ?, last_error = NULL, fail_count = 0, updated_at = ? WHERE id = ?');
  const failStmt = db.prepare('UPDATE push_tokens SET last_error = ?, fail_count = fail_count + 1 WHERE id = ?');
  const dropStmt = db.prepare('DELETE FROM push_tokens WHERE id = ?');
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(creds.projectId)}/messages:send`;

  for (const row of rows) {
    const state = summary.perUser[row.userId];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(fcmMessage(row.token, payload)),
      });
      if (res.ok) {
        okStmt.run(nowIso(), nowIso(), row.id);
        state.sent += 1;
        summary.sent += 1;
        continue;
      }
      const json = await res.json().catch(() => ({}));
      const error = json?.error || {};
      const code = String(error?.details?.[0]?.errorCode || error?.status || res.status);
      const message = String(error?.message || `FCM refused the message (${res.status})`).slice(0, 200);
      state.failed += 1;
      state.lastError = message;
      summary.failed += 1;

      const dead =
        res.status === 404 ||
        code === 'UNREGISTERED' ||
        code === 'INVALID_ARGUMENT' && /registration token|not a valid/i.test(message);
      if (dead) {
        dropStmt.run(row.id);
        summary.removed += 1;
        state.tokens = Math.max(0, state.tokens - 1);
      } else {
        failStmt.run(message, row.id);
      }
      summary.errors.push({ userId: row.userId, code, status: res.status, error: message });
    } catch (error) {
      const message = String(error?.message || error).slice(0, 200);
      failStmt.run(message, row.id);
      state.failed += 1;
      state.lastError = message;
      summary.failed += 1;
      summary.errors.push({ userId: row.userId, code: 'network', error: message });
    }
  }

  return summary;
}

/** What the dashboard shows about FCM readiness. Never claims configured without credentials. */
export function fcmStatus() {
  const creds = fcmCredentials();
  const counts = tokenCounts();
  return {
    configured: creds.configured,
    reason: creds.configured ? null : creds.reason,
    projectId: creds.configured ? creds.projectId : null,
    clientEmail: creds.configured ? creds.clientEmail : null,
    tokens: counts,
  };
}

/* --------------------------------- routes ---------------------------------- */

export function registerFcmRoutes(app, requireAuth, requireAdmin) {
  /** Signed-in user registers the native token their shell obtained from FCM. */
  app.post('/api/push/fcm/register', requireAuth, (req, res) => {
    const result = saveToken(req.user.id, req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(result.updated ? 200 : 201).json({
      token: result.token,
      count: tokenCounts().total,
      fcm: { configured: fcmCredentials().configured },
    });
  });

  app.post('/api/push/fcm/unregister', requireAuth, (req, res) => {
    const removed = removeToken(req.user.id, req.body?.token);
    res.json({ removed, count: tokenCounts().total });
  });

  app.get('/api/push/fcm/status', requireAuth, (req, res) => {
    res.json({
      ...fcmStatus(),
      devices: listTokens(req.user.id),
      mine: listTokens(req.user.id).length,
    });
  });

  /** Sends a real FCM message to the caller's own native devices. */
  app.post('/api/push/fcm/test', requireAuth, async (req, res) => {
    const mine = listTokens(req.user.id);
    if (!mine.length) {
      return res.json({
        tokens: 0,
        sent: 0,
        failed: 0,
        configured: fcmCredentials().configured,
        message: 'No native device token is registered for this account yet.',
      });
    }
    const result = await sendFcmToUsers([req.user.id], {
      title: 'RIFQ Muslim test',
      body: 'Native push is working on this device.',
      url: '/notifications',
      tag: `rifq-fcm-test-${Date.now()}`,
      category: 'announcements',
      lang: 'en',
    });
    res.json({
      configured: result.configured,
      tokens: result.tokens,
      sent: result.sent,
      failed: result.failed,
      deferred: result.deferred,
      errors: result.errors,
      message: result.sent > 0
        ? `Sent to ${result.sent} device(s).`
        : result.deferred > 0
          ? 'Firebase credentials are missing on the server, so nothing was sent.'
          : 'Firebase refused every token; see errors for the reason.',
    });
  });

  /** Owner-only view of the whole registry (tokens are masked, never returned raw). */
  app.get('/api/admin/push/fcm', requireAdmin, (req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*, u.email FROM push_tokens t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 200`
      )
      .all();
    res.json({
      ...fcmStatus(),
      devices: rows.map((row) => ({ ...shapeToken(row), email: row.email || null })),
    });
  });
}

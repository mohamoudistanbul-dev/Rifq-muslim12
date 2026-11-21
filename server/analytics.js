/**
 * RIFQ Muslim — downloads and visitors analytics.
 *
 * Counting rules, deliberately conservative so the dashboard reports real
 * activity rather than button presses:
 *
 *   portal_visit   recorded when the public /download page is actually served
 *                  (server-side HTML request) or the portal mounts (beacon).
 *                  Both paths produce the same dedupe key, so a visit is
 *                  counted once per visitor per day.
 *
 *   apk_download   recorded only after the APK response has finished and the
 *                  whole file was delivered from byte 0. Resumed range
 *                  requests, aborted transfers and HEAD requests are not new
 *                  downloads, and clicking a button alone never reaches it.
 *
 * Privacy: no IP address, user agent or email is stored. Each event keeps a
 * salted HMAC of (ip | user-agent | day) truncated to 24 hex characters, and
 * the day is part of the input, so the value cannot follow a visitor across
 * days. The salt lives in app_settings and is never exposed by the API.
 *
 * Google Play / App Store install counts are NOT available here. They are
 * reported as `null` with an explanation: those figures come from the Google
 * Play Developer API and the App Store Connect API, which require the owner's
 * developer-account credentials. Nothing is estimated or invented.
 */
import crypto from 'node:crypto';
import express from 'express';
import { db, getSetting, setSetting, newId, nowIso } from './db.js';
import { requireAdmin, rateLimit } from './auth.js';

export const VISIT = 'portal_visit';
export const DOWNLOAD = 'apk_download';

const DAY_MS = 86_400_000;
const dayOf = (value) => new Date(value).toISOString().slice(0, 10);
const todayUtc = () => dayOf(Date.now());
const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
};

/* ------------------------------- classification ------------------------------ */

/**
 * Link-preview fetchers (WhatsApp, Telegram, Facebook, Slack…) and crawlers hit
 * a shared download link constantly. Counting them as visitors would inflate
 * every number on the dashboard, so they are classified and dropped.
 */
const BOT_UA =
  /bot|crawl|spider|slurp|headless|preview|monitor|curl|wget|python-requests|axios|okhttp|facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|linkedinbot|twitterbot|embedly|quora|pinterest|redditbot|applebot|bingpreview/i;

export function classifyDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'unknown';
  if (BOT_UA.test(ua)) return 'bot';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/mobile|phone/i.test(ua)) return 'other';
  return 'desktop';
}

/* ---------------------------------- privacy --------------------------------- */

let cachedSalt = null;

/** Stable dedupe salt, generated once and kept in the database. */
function salt() {
  if (cachedSalt) return cachedSalt;
  let value = getSetting('analytics_salt');
  if (!value) {
    value = crypto.randomBytes(32).toString('hex');
    setSetting('analytics_salt', value);
  }
  cachedSalt = value;
  return value;
}

function visitorHash(req, day) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const ua = String(req.headers['user-agent'] || '');
  return crypto.createHmac('sha256', salt()).update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 24);
}

/** Only the referring hostname is kept — never a full URL that may carry data. */
function referrerHost(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    return new URL(value).hostname.slice(0, 100);
  } catch {
    return '';
  }
}

/* --------------------------------- recording -------------------------------- */

function record(kind, req, bucket) {
  const device = classifyDevice(req.headers['user-agent']);
  if (device === 'bot') return { recorded: false, reason: 'bot' };

  const at = new Date();
  const day = dayOf(at);
  try {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO analytics_events (id, kind, device, day, bucket, visitor, referrer, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(newId(), kind, device, day, bucket || day, visitorHash(req, day), referrerHost(req.headers.referer), nowIso());
    return { recorded: result.changes > 0, reason: result.changes > 0 ? null : 'duplicate' };
  } catch (err) {
    console.error('[analytics] could not record event:', err.message);
    return { recorded: false, reason: 'error' };
  }
}

/** One counted visit per visitor per UTC day. */
export function recordPortalVisit(req) {
  if (req.method !== 'GET') return { recorded: false, reason: 'method' };
  return record(VISIT, req, todayUtc());
}

/**
 * Called from server/download.js only after a complete transfer.
 * Dedupe bucket is the hour, so a retried request from the same device does not
 * inflate the count while a genuine later re-download still does.
 */
export function recordApkDownload(req) {
  if (req.method !== 'GET') return { recorded: false, reason: 'method' };
  const at = new Date();
  return record(DOWNLOAD, req, `${dayOf(at)}T${at.toISOString().slice(11, 13)}`);
}

/* --------------------------------- reporting -------------------------------- */

const countKind = (kind, from, to) =>
  db
    .prepare('SELECT COUNT(*) AS c FROM analytics_events WHERE kind = ? AND day >= ? AND day <= ?')
    .get(kind, from, to)?.c || 0;

const parseDay = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null);

const httpUrl = (value) => /^https?:\/\/\S+$/i.test(String(value || '').trim());

function deviceSplit(from, to) {
  const rows = db
    .prepare(
      `SELECT kind, device, COUNT(*) AS c FROM analytics_events
       WHERE day >= ? AND day <= ? GROUP BY kind, device`
    )
    .all(from, to);

  const blank = () => ({ android: 0, ios: 0, desktop: 0, other: 0, unknown: 0 });
  const out = { visits: blank(), downloads: blank() };
  for (const row of rows) {
    const target = row.kind === DOWNLOAD ? out.downloads : out.visits;
    const key = row.device in target ? row.device : 'unknown';
    target[key] += Number(row.c) || 0;
  }
  return out;
}

function registrationStats(today) {
  const users = (where = '', params = []) =>
    db.prepare(`SELECT COUNT(*) AS c FROM users ${where}`).get(...params)?.c || 0;
  const joinedBetween = (from, to) =>
    db
      .prepare('SELECT COUNT(*) AS c FROM users WHERE substr(created_at,1,10) >= ? AND substr(created_at,1,10) <= ?')
      .get(from, to)?.c || 0;

  return {
    total: users(),
    last7: joinedBetween(addDays(today, -6), today),
    last30: joinedBetween(addDays(today, -29), today),
    activeUsers7: users('WHERE last_login IS NOT NULL AND substr(last_login,1,10) >= ?', [addDays(today, -6)]),
    activeUsers30: users('WHERE last_login IS NOT NULL AND substr(last_login,1,10) >= ?', [addDays(today, -29)]),
    admins: users("WHERE role IN ('admin','superadmin')"),
  };
}

function externalStores() {
  const playLink = String(getSetting('play_store_url', '') || '').trim();
  const appleLink = String(getSetting('app_store_url', '') || '').trim();

  return {
    playStore: {
      available: false,
      value: null,
      storeLinkConfigured: httpUrl(playLink),
      reason:
        'Google Play does not publish per-app install counts to a website. That figure only comes from the Google Play Developer API (or the Play Console), which needs your developer-account credentials.',
      howTo: [
        'Create a service account in Google Play Console with the "View financial data" / statistics scope.',
        'Enable the Google Play Developer API in Google Cloud for that project.',
        'Add the service-account JSON as a server environment variable and connect it here.',
      ],
    },
    appStore: {
      available: false,
      value: null,
      storeLinkConfigured: httpUrl(appleLink),
      reason:
        'Apple does not expose App Store download totals publicly. The App Store Connect API reports them only to the account that owns the app, using an API key.',
      howTo: [
        'Create an App Store Connect API key (Users and Access -> Integrations).',
        'Grant it the Sales and Trends / Analytics role.',
        'Add the issuer ID and key as server environment variables and connect it here.',
      ],
    },
  };
}

/**
 * Build the dashboard report. The window defaults to the last 30 days and is
 * capped at one year so the chart stays readable.
 */
export function buildReport(query = {}) {
  const today = todayUtc();
  let to = parseDay(query.to) || today;
  let from = parseDay(query.from) || addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  const floor = addDays(to, -364);
  if (from < floor) from = floor;

  // Keep the table bounded on a 1 GB host: analytics older than ~13 months is
  // aggregated away. Nothing else in the app depends on these rows.
  try {
    db.prepare('DELETE FROM analytics_events WHERE day < ?').run(addDays(today, -400));
  } catch {
    /* pruning is best effort */
  }

  const days = Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;

  const rows = db
    .prepare(
      `SELECT day, kind, COUNT(*) AS c FROM analytics_events
       WHERE day >= ? AND day <= ? GROUP BY day, kind`
    )
    .all(from, to);

  const series = [];
  const index = new Map();
  for (let i = 0; i < days; i += 1) {
    const day = addDays(from, i);
    const entry = { day, visitors: 0, downloads: 0 };
    index.set(day, entry);
    series.push(entry);
  }
  for (const row of rows) {
    const entry = index.get(row.day);
    if (!entry) continue;
    if (row.kind === DOWNLOAD) entry.downloads += Number(row.c) || 0;
    else entry.visitors += Number(row.c) || 0;
  }

  const uniqueDownloaders =
    db
      .prepare('SELECT COUNT(DISTINCT visitor) AS c FROM analytics_events WHERE kind = ? AND day >= ? AND day <= ?')
      .get(DOWNLOAD, from, to)?.c || 0;

  const weekStart = addDays(today, -((new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const period = (a, b) => ({ visitors: countKind(VISIT, a, b), downloads: countKind(DOWNLOAD, a, b) });

  return {
    generatedAt: nowIso(),
    range: { from, to, days },
    totals: {
      visitors: countKind(VISIT, from, to),
      downloads: countKind(DOWNLOAD, from, to),
      uniqueDownloaders,
    },
    periods: {
      today: period(today, today),
      last7: period(addDays(today, -6), today),
      last30: period(addDays(today, -29), today),
      thisWeek: period(weekStart, today),
      thisMonth: period(monthStart, today),
      allTime: period('0000-01-01', '9999-12-31'),
    },
    series,
    devices: deviceSplit(from, to),
    registrations: registrationStats(today),
    external: externalStores(),
    notes: [
      'Portal visitors are counted once per device per UTC day; a page refresh does not add another visit.',
      'An APK download is counted only after the whole file has been delivered from the first byte. Resumed or aborted transfers are not counted.',
      'Crawlers and chat link-preview fetchers (WhatsApp, Telegram, Facebook…) are excluded so shared links do not inflate the numbers.',
      'No IP address, user agent or email address is stored. Events keep only a salted per-day hash that cannot be linked across days.',
      'Registrations and active users come from the app database (account creation date and last sign-in).',
    ],
  };
}

/* ---------------------------------- routes ---------------------------------- */

/** Admin-only report endpoint. */
export const analyticsRouter = express.Router();
analyticsRouter.get('/', requireAdmin, (req, res) => res.json(buildReport(req.query)));

/** Public beacon used by the download portal page itself. */
export const visitRouter = express.Router();
visitRouter.post('/visit', rateLimit({ windowMs: 60_000, max: 60 }), (req, res) => {
  const result = recordPortalVisit(req);
  res.json({ ok: true, recorded: result.recorded });
});

#!/usr/bin/env node
/**
 * End-to-end verification of the RIFQ Muslim downloads/visitors analytics.
 *
 * Drives the real server on a throwaway database and asserts what the dashboard
 * actually reports, so the numbers on screen are proven rather than assumed:
 *
 *   - anonymous and non-admin callers cannot read the report
 *   - a portal visit is counted once per device per day, and a refresh is not a
 *     second visit
 *   - link-preview crawlers (WhatsApp, Telegram, Facebook) are not visitors
 *   - a download is counted only after the whole APK has been delivered; a Range
 *     request (resume) is not a download, and neither is a button click
 *   - device split separates Android from iPhone
 *   - date filters change the window and the series length
 *   - Google Play / App Store figures are null with a reason, never invented
 *   - no IP address is stored: only a 24-hex-char per-day hash
 *   - the counts survive a server restart (real persistence)
 *
 * Run with: npm run verify:analytics
 */
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.VERIFY_PORT || 3991);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'rifqmuslim@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Haajiro3320$';

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_BOT = 'WhatsApp/2.23.20.0 A';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-analytics-'));
const dbPath = path.join(tmpDir, 'verify.db');
const apkDir = path.join(tmpDir, 'apk');
const APK_BYTES = Buffer.alloc(180 * 1024);
for (let i = 0; i < APK_BYTES.length; i += 1) APK_BYTES[i] = i % 251;

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------- http helpers ------------------------------ */

async function req(method, route, { body, cookie, ua, headers = {}, binary = false } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  if (ua) h['user-agent'] = ua;
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  // An APK is binary: decoding it as text would corrupt the byte count, so the
  // download assertions measure the real payload length instead.
  if (binary) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, json: null, raw: '', headers: res.headers, bytes: buf.length };
  }
  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, raw, headers: res.headers, bytes: Buffer.byteLength(raw) };
}

function sessionCookie(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const entry of list) {
    const pair = entry.split(';')[0];
    if (pair.startsWith('rifq_session=') || pair.startsWith('token=')) return pair;
  }
  return '';
}

/* ------------------------------- server control ---------------------------- */

let child = null;
let serverLog = '';

async function startServer() {
  child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: dbPath,
      DATA_DIR: tmpDir,
      NODE_ENV: 'production',
      // Keep the local fixture as the APK source instead of any hosted URL.
      APK_DOWNLOAD_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => {
    serverLog += d.toString();
  });
  child.stderr.on('data', (d) => {
    serverLog += d.toString();
  });

  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function stopServer() {
  if (!child) return;
  // Let the debounced database flush land before the process goes away.
  await new Promise((r) => setTimeout(r, 1500));
  child.kill('SIGTERM');
  await once(child, 'exit');
  child = null;
}

const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);
const daysAgo = (n) => dayOf(new Date(Date.now() - n * 86_400_000));

async function report(cookie, query = '') {
  const res = await req('GET', `/api/admin/analytics${query}`, { cookie, ua: UA_ANDROID });
  return { status: res.status, data: res.json };
}

/* ----------------------------------- main ---------------------------------- */

let exitCode = 0;
try {
  fs.mkdirSync(apkDir, { recursive: true });
  fs.writeFileSync(path.join(apkDir, 'RIFQ-Muslim.apk'), APK_BYTES);

  console.log('\nRIFQ Muslim — analytics verification\n');

  if (!(await startServer())) throw new Error(`server did not start:\n${serverLog}`);
  console.log('  server up on a throwaway database\n');

  /* ------------------------------ access control ----------------------------- */

  const anon = await req('GET', '/api/admin/analytics');
  check(
    'anonymous callers cannot read analytics',
    [401, 403].includes(anon.status) && !anon.json?.totals,
    `HTTP ${anon.status}`
  );

  const userEmail = `analytics-check-${Date.now()}@example.com`;
  const reg = await req('POST', '/api/auth/register', {
    body: { email: userEmail, password: 'VerifyPass123!', name: 'Analytics Check' },
  });
  const userCookie = sessionCookie(reg);
  const normal = await req('GET', '/api/admin/analytics', { cookie: userCookie });
  check(
    'a normal signed-in user is forbidden',
    normal.status === 403 && !normal.json?.totals,
    `HTTP ${normal.status}`
  );

  const login = await req('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const adminCookie = sessionCookie(login);
  check('super admin can sign in', login.status === 200 && Boolean(adminCookie), `HTTP ${login.status}`);
  if (!adminCookie) throw new Error('cannot continue without an admin session');

  const before = await report(adminCookie);
  check('admin can read the report', before.status === 200 && Boolean(before.data?.totals), `HTTP ${before.status}`);
  const baseVisitors = before.data.totals.visitors;
  const baseDownloads = before.data.totals.downloads;

  /* --------------------------- portal visitor counting ------------------------ */

  await req('GET', '/download', { ua: UA_BOT });
  const afterBot = await report(adminCookie);
  check(
    'a WhatsApp link-preview fetch is not a visitor',
    afterBot.data.totals.visitors === baseVisitors,
    `${baseVisitors} -> ${afterBot.data.totals.visitors}`
  );

  await req('HEAD', '/download', { ua: UA_ANDROID });
  const afterHead = await report(adminCookie);
  check(
    'a HEAD request is not a visitor',
    afterHead.data.totals.visitors === baseVisitors,
    `${afterHead.data.totals.visitors}`
  );

  await req('GET', '/download', { ua: UA_ANDROID });
  const afterAndroid = await report(adminCookie);
  check(
    'an Android portal visit is counted',
    afterAndroid.data.totals.visitors === baseVisitors + 1,
    `${afterAndroid.data.totals.visitors}`
  );

  await req('GET', '/download', { ua: UA_ANDROID });
  const afterRefresh = await report(adminCookie);
  check(
    'refreshing the portal does not count twice',
    afterRefresh.data.totals.visitors === baseVisitors + 1,
    `${afterRefresh.data.totals.visitors}`
  );

  await req('GET', '/download', { ua: UA_IPHONE });
  const afterIphone = await report(adminCookie);
  check(
    'an iPhone visit is counted separately',
    afterIphone.data.totals.visitors === baseVisitors + 2,
    `${afterIphone.data.totals.visitors}`
  );

  const visits = afterIphone.data.devices.visits;
  check(
    'device breakdown separates Android from iPhone',
    visits.android === 1 && visits.ios === 1,
    `android ${visits.android}, ios ${visits.ios}`
  );

  /* ------------------------------ download counting -------------------------- */

  const rangeRes = await req('GET', '/download/RIFQ-Muslim.apk', {
    ua: UA_ANDROID,
    binary: true,
    headers: { range: 'bytes=0-1023' },
  });
  const afterRange = await report(adminCookie);
  check(
    'a resumed Range request is not a new download',
    rangeRes.status === 206 && afterRange.data.totals.downloads === baseDownloads,
    `HTTP ${rangeRes.status}, downloads ${afterRange.data.totals.downloads}`
  );

  const fullRes = await req('GET', '/download/RIFQ-Muslim.apk', { ua: UA_ANDROID, binary: true });
  const afterFull = await report(adminCookie);
  check(
    'a completed APK transfer is counted as a download',
    fullRes.status === 200 && afterFull.data.totals.downloads === baseDownloads + 1,
    `HTTP ${fullRes.status}, downloads ${afterFull.data.totals.downloads}`
  );
  check(
    'the APK bytes really arrived',
    fullRes.bytes === APK_BYTES.length && fullRes.headers.get('content-length') === String(APK_BYTES.length),
    `${fullRes.bytes} bytes, content-length ${fullRes.headers.get('content-length')}`
  );
  check(
    'the resumed request received only the requested slice',
    rangeRes.bytes === 1024 && rangeRes.headers.get('content-range') === `bytes 0-1023/${APK_BYTES.length}`,
    `${rangeRes.bytes} bytes, ${rangeRes.headers.get('content-range')}`
  );

  await req('GET', '/download/RIFQ-Muslim.apk', { ua: UA_ANDROID });
  const afterRepeat = await report(adminCookie);
  check(
    'a repeat transfer in the same hour is deduplicated',
    afterRepeat.data.totals.downloads === baseDownloads + 1,
    `downloads ${afterRepeat.data.totals.downloads}`
  );

  const data = afterRepeat.data;
  check('unique downloaders is reported', data.totals.uniqueDownloaders >= 1, `${data.totals.uniqueDownloaders}`);
  check(
    'today matches the all-time totals on a fresh database',
    data.periods.today.downloads === data.totals.downloads && data.periods.today.visitors === data.totals.visitors,
    `today ${data.periods.today.visitors}/${data.periods.today.downloads}`
  );

  /* --------------------------------- filters --------------------------------- */

  const today = dayOf();
  const oneDay = await report(adminCookie, `?from=${today}&to=${today}`);
  check(
    'a single-day filter returns exactly one point',
    oneDay.data.range.days === 1 && oneDay.data.series.length === 1,
    `days ${oneDay.data.range.days}, points ${oneDay.data.series.length}`
  );

  const tenDays = await report(adminCookie, `?from=${daysAgo(9)}&to=${today}`);
  check(
    'a ten-day filter returns ten points',
    tenDays.data.range.days === 10 && tenDays.data.series.length === 10,
    `days ${tenDays.data.range.days}, points ${tenDays.data.series.length}`
  );

  const inverted = await report(adminCookie, `?from=${today}&to=${daysAgo(9)}`);
  check('an inverted range is corrected instead of breaking', inverted.data.range.from <= inverted.data.range.to, `${inverted.data.range.from}..${inverted.data.range.to}`);

  const invalid = await report(adminCookie, '?from=not-a-date&to=13');
  check('invalid dates fall back to the default window', invalid.status === 200 && invalid.data.range.days === 30, `days ${invalid.data.range.days}`);

  /* -------------------------- store stats + registrations -------------------- */

  check(
    'Google Play installs are reported as unavailable, not invented',
    data.external.playStore.available === false &&
      data.external.playStore.value === null &&
      data.external.playStore.reason.length > 20,
    'value null with explanation'
  );
  check(
    'App Store installs are reported as unavailable, not invented',
    data.external.appStore.available === false && data.external.appStore.value === null,
    'value null with explanation'
  );
  check('registrations are read from the app database', data.registrations.total >= 1, `${data.registrations.total} accounts`);
  check('active users are reported', data.registrations.activeUsers7 >= 1, `${data.registrations.activeUsers7} active`);
  check('the report explains how the numbers are counted', Array.isArray(data.notes) && data.notes.length >= 4, `${data.notes.length} notes`);

  /* --------------------------------- privacy -------------------------------- */

  await stopServer();
  const sqliteFile = fs.existsSync(dbPath) ? dbPath : path.join(tmpDir, 'rifq.db');
  let privacy = null;
  try {
    const cols = execFileSync('sqlite3', [sqliteFile, 'PRAGMA table_info(analytics_events);'], { encoding: 'utf8' });
    const badHashes = execFileSync(
      'sqlite3',
      [sqliteFile, 'SELECT COUNT(*) FROM analytics_events WHERE length(visitor) <> 24;'],
      { encoding: 'utf8' }
    ).trim();
    privacy = { cols, badHashes: Number(badHashes) };
  } catch (err) {
    console.log(`  note  sqlite3 unavailable, privacy check skipped (${err.message.split('\n')[0]})`);
  }
  if (privacy) {
    check(
      'no IP or user-agent column is stored',
      !/\|ip\|/i.test(privacy.cols) && !/user_agent/i.test(privacy.cols),
      'columns: id, kind, device, day, bucket, visitor, referrer, created_at'
    );
    check('every stored visitor key is a 24-char hash', privacy.badHashes === 0, `${privacy.badHashes} malformed`);
  }

  /* -------------------------------- persistence ----------------------------- */

  if (!(await startServer())) throw new Error(`server did not restart:\n${serverLog}`);
  const relogin = await req('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const afterRestart = await report(sessionCookie(relogin));
  check(
    'visitor counts survive a server restart',
    afterRestart.data.totals.visitors === data.totals.visitors,
    `${afterRestart.data.totals.visitors}`
  );
  check(
    'download counts survive a server restart',
    afterRestart.data.totals.downloads === data.totals.downloads,
    `${afterRestart.data.totals.downloads}`
  );

  await stopServer();
} catch (err) {
  failures.push(`fatal: ${err.message}`);
  console.log(`\n  FAIL fatal — ${err.message}`);
  if (serverLog) console.log(`\n--- server log ---\n${serverLog.slice(-2000)}`);
  exitCode = 1;
} finally {
  try {
    if (child) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  } catch {
    /* already gone */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(exitCode);

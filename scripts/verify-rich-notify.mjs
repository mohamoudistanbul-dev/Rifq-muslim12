/**
 * End-to-end check of the rich prayer notifications.
 *
 * Proves the behaviour behind the expanded notification card:
 *   - the payload the device renders (remaining-time title, prayer time, banner
 *     image, countdown progress, the three action buttons);
 *   - "Already Prayed" really stores a confirmation, and a second tap cannot
 *     count it twice;
 *   - "Remind in 15 min" really queues a future reminder that the server owns,
 *     and it can be cancelled;
 *   - the banner images the notification displays exist and are served;
 *   - the service worker and the Android project actually contain the action
 *     handlers and the receiver, not just the words in a doc;
 *   - ordinary users cannot read the admin summary.
 *
 * Run with: npm run verify:rich
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.VERIFY_PORT || 4597);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'RifqTest!2026';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-rich-'));
const dbPath = path.join(tmpDir, 'rifq.db');

let passed = 0;
const failures = [];

function ok(name, detail = '') {
  passed += 1;
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function bad(name, detail) {
  failures.push(`${name}: ${detail}`);
  console.log(`  FAIL  ${name} — ${detail}`);
}
function check(name, condition, detail = '') {
  if (condition) ok(name, detail);
  else bad(name, detail || 'assertion failed');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor() {
    this.cookie = '';
  }

  async call(method, route, body) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(`${BASE}/api${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const raw = await res.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const entry of setCookie) {
      const pair = entry.split(';')[0];
      if (pair.startsWith('rifq_session=')) this.cookie = pair;
    }
    return { status: res.status, json, raw };
  }

  get(route) {
    return this.call('GET', route);
  }
  post(route, body = {}) {
    return this.call('POST', route, body);
  }
  del(route, body = {}) {
    return this.call('DELETE', route, body);
  }
}

function startServer() {
  const child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: dbPath,
      DATA_DIR: tmpDir,
      SEED_BUNDLED_DB: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function stopServer(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  return false;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  console.log('RIFQ Muslim — rich prayer notifications\n');
  const srv = startServer();
  try {
    const ready = await waitForServer();
    check('the server starts', ready, BASE);

    const anon = new Session();

    /* ------------------------- payload contract --------------------------- */

    const noAuth = await anon.get('/prayers/rich-preview?prayer=dhuhr');
    check('the notification payload requires a signed-in account', noAuth.status === 401, `status ${noAuth.status}`);

    const user = new Session();
    const reg = await user.post('/auth/register', {
      name: 'Rich Test',
      email: `rich.notify.${Date.now()}@example.com`,
      password: PASSWORD,
    });
    check('an account can register', reg.status === 200 || reg.status === 201, `status ${reg.status}`);

    const preview = await user.get('/prayers/rich-preview?prayer=dhuhr&minutes=30&time=13%3A15');
    const card = preview.json || {};
    check('the payload is a prayer card', card.kind === 'prayer' && card.prayer === 'dhuhr', JSON.stringify({ kind: card.kind, prayer: card.prayer }));
    check(
      'the title states the prayer and the remaining time',
      card.title === 'Dhuhr – 30 min remaining',
      String(card.title)
    );
    check('the prayer time is shown', card.time === '13:15', String(card.time));
    check('a banner image is attached', card.image === '/notif/prayer-dhuhr.png', String(card.image));
    check(
      'the countdown progress is a 60-minute window',
      card.progress && card.progress.max === 60 && card.progress.value === 30,
      JSON.stringify(card.progress)
    );
    const actions = Array.isArray(card.actions) ? card.actions : [];
    check('there are exactly three action buttons', actions.length === 3, `count ${actions.length}`);
    const actionKeys = actions.map((entry) => entry?.action);
    check(
      'the buttons are prayed, snooze and open',
      actionKeys.join(',') === 'prayed,snooze,open',
      actionKeys.join(',')
    );
    check(
      'the buttons carry readable labels',
      actions.map((entry) => entry?.title).join('|') === 'Already Prayed|Remind in 15 min|Open App',
      actions.map((entry) => entry?.title).join('|')
    );
    check('tapping the card opens the prayer screen', card.url === '/athan?prayer=dhuhr', String(card.url));

    const dueNow = await user.get('/prayers/rich-preview?prayer=fajr&minutes=0');
    check(
      'a prayer that is due now says so instead of "0 min remaining"',
      String(dueNow.json?.title || '').includes('time to pray'),
      String(dueNow.json?.title)
    );

    const unknown = await user.get('/prayers/rich-preview?prayer=lunch');
    check('an unknown prayer is rejected', unknown.status === 400, `status ${unknown.status}`);

    /* --------------------------- Already Prayed --------------------------- */

    const day = todayKey();
    const first = await user.post('/prayers/confirm', { prayer: 'dhuhr', day, source: 'notification' });
    check('Already Prayed stores the confirmation', first.status === 200 && first.json?.already === false, JSON.stringify(first.json));

    const second = await user.post('/prayers/confirm', { prayer: 'dhuhr', day, source: 'notification' });
    check('a second tap is reported as already confirmed, not counted twice', second.status === 200 && second.json?.already === true, JSON.stringify(second.json));

    const confirmed = await user.get(`/prayers/confirmed?day=${day}`);
    const names = (confirmed.json?.confirmations || []).map((row) => row.prayer);
    check('the confirmation is listed for the day', names.includes('dhuhr'), names.join(','));
    check('only one confirmation exists', names.filter((name) => name === 'dhuhr').length === 1, `count ${names.length}`);

    const badPrayer = await user.post('/prayers/confirm', { prayer: 'brunch', day });
    check('an invalid prayer cannot be confirmed', badPrayer.status === 400, `status ${badPrayer.status}`);

    const undo = await user.del('/prayers/confirm', { prayer: 'dhuhr', day });
    check('a confirmation can be undone', undo.status === 200, `status ${undo.status}`);
    const afterUndo = await user.get(`/prayers/confirmed?day=${day}`);
    check(
      'the undone confirmation is gone',
      !(afterUndo.json?.confirmations || []).some((row) => row.prayer === 'dhuhr')
    );

    /* -------------------------- Remind in 15 min -------------------------- */

    const snooze = await user.post('/prayers/snooze', { prayer: 'asr', minutes: 15 });
    const fireAt = snooze.json?.fireAt ? new Date(snooze.json.fireAt) : null;
    check('Remind in 15 min queues a reminder', snooze.status === 201 && Boolean(fireAt), JSON.stringify(snooze.json));
    const deltaMinutes = fireAt ? Math.round((fireAt.getTime() - Date.now()) / 60000) : -1;
    check('the reminder fires about 15 minutes from now', deltaMinutes >= 14 && deltaMinutes <= 16, `${deltaMinutes} min`);

    const snoozes = await user.get(`/prayers/snooze?day=${day}`);
    const pending = snoozes.json?.snoozes || [];
    check('the queued reminder is visible to the account', pending.some((row) => row.prayer === 'asr'), `count ${pending.length}`);
    check('the queued reminder is still pending', pending.every((row) => row.status === 'pending'), pending.map((row) => row.status).join(','));

    const cancel = await user.del(`/prayers/snooze/${snooze.json?.id}`);
    check('a queued reminder can be cancelled', cancel.status === 200, `status ${cancel.status}`);
    const afterCancel = await user.get(`/prayers/snooze?day=${day}`);
    check('the cancelled reminder is no longer pending', (afterCancel.json?.snoozes || []).length === 0, `count ${(afterCancel.json?.snoozes || []).length}`);

    const badSnooze = await user.post('/prayers/snooze', { prayer: 'brunch' });
    check('a snooze for an invalid prayer is rejected', badSnooze.status === 400, `status ${badSnooze.status}`);

    /* ------------------------------- privacy ------------------------------ */

    const anonConfirm = await anon.post('/prayers/confirm', { prayer: 'dhuhr' });
    check('a signed-out tap cannot write a confirmation', anonConfirm.status === 401, `status ${anonConfirm.status}`);

    const other = new Session();
    await other.post('/auth/register', {
      name: 'Other User',
      email: `rich.other.${Date.now()}@example.com`,
      password: PASSWORD,
    });
    const otherConfirmed = await other.get(`/prayers/confirmed?day=${day}`);
    check(
      'one account never sees another account\'s confirmations',
      (otherConfirmed.json?.confirmations || []).length === 0,
      `count ${(otherConfirmed.json?.confirmations || []).length}`
    );

    const summary = await user.get('/admin/prayers/summary');
    check('the admin summary is closed to ordinary users', summary.status === 403, `status ${summary.status}`);

    /* --------------------------- rendered assets -------------------------- */

    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      const res = await fetch(`${BASE}/notif/prayer-${prayer}.png`);
      const type = res.headers.get('content-type') || '';
      check(`the ${prayer} banner image is served`, res.ok && type.includes('image'), `status ${res.status} ${type}`);
    }

    const sw = fs.readFileSync('public/sw.js', 'utf8');
    check(
      'the service worker renders the expanded image',
      /options\.image\s*=\s*data\.image/.test(sw) && /showNotification/.test(sw)
    );
    check(
      'the service worker forwards the buttons to the device',
      /options\.actions\s*=\s*actions/.test(sw) && /PRAYER_ACTIONS/.test(sw)
    );
    check('the service worker handles the prayed action', /'prayed'/.test(sw) && /prayers\/confirm/.test(sw));
    check('the service worker handles the snooze action', /'snooze'/.test(sw) && /prayers\/snooze/.test(sw));
    check('the service worker keeps actions when the session expired', /rifq-sw-actions/.test(sw));

    const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    check('the Android project registers the action receiver', /PrayerActionReceiver/.test(manifest));

    const kotlin = fs.readFileSync('android/app/src/main/java/com/rifqmuslim/app/PrayerNotifications.kt', 'utf8');
    check('the native notification uses the expanded picture style', /BigPictureStyle/.test(kotlin) && /notif_prayer/.test(kotlin));
    check('the native notification shows a progress bar', /setProgress\(/.test(kotlin));
    check(
      'the native notification has the three buttons',
      /Already Prayed/.test(kotlin) && /Remind in 15 min/.test(kotlin) && /Open App/.test(kotlin)
    );
    check('the native channel is high importance', /IMPORTANCE_HIGH/.test(kotlin));
  } finally {
    await stopServer(srv);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

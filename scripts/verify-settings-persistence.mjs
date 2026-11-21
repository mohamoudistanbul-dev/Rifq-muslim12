/**
 * Website settings persistence check.
 *
 * Proves the requirement that settings entered in the admin dashboard live in
 * the database, not in browser or server memory:
 *
 *   1. boot the real server on a fresh data directory,
 *   2. log in as the Super Admin and save settings through PUT /api/admin/settings,
 *   3. read them back,
 *   4. stop the server completely and start it again on the same directory,
 *   5. read them back again — they must still be there.
 *
 * It also checks /api/config exposes this deployment's own address as shareUrl
 * (the link Invite Friends shares) together with the saved store links, and that
 * the share link is not a referral/redirect link.
 *
 * Run with: npm run verify:settings
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.VERIFY_PORT || 4189);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'rifqmuslim@gmail.com').toLowerCase();
const ADMIN_PASSWORD = 'VerifySettings!2026';

const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.rifqmuslim.app';
const APP_STORE = 'https://apps.apple.com/app/id1234567890';
const TAGLINE = 'Settings persist — verify run';
const CONTACT = 'verify.settings@example.com';

let checks = 0;

function pass(label, detail = '') {
  checks += 1;
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  process.exitCode = 1;
  throw new Error(label);
}

function expect(label, condition, detail = '') {
  if (!condition) fail(label, detail);
  pass(label, detail);
}

function startServer(dataDir) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      DB_PATH: path.join(dataDir, 'rifq.db'),
      // Start from an empty database so the boot seed creates the Super Admin
      // with the password supplied here (test data only, in a temp directory).
      SEED_BUNDLED_DB: '0',
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`  [server] ${String(chunk).trim()}\n`));
  child.stderr.on('data', (chunk) => process.stderr.write(`  [server] ${String(chunk).trim()}\n`));
  return child;
}

async function waitForHealth(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not become healthy');
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timeout = new Promise((resolve) => setTimeout(resolve, 8000));
  await Promise.race([exited, timeout]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await exited;
}

function cookieFrom(res) {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
  return raw.map((value) => String(value).split(';')[0]).join('; ');
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login failed (${res.status}): ${body.error || 'unknown error'}`);
  const cookie = cookieFrom(res);
  if (!cookie) throw new Error('login returned no session cookie');
  return { cookie, user: body.user };
}

function api(cookie) {
  return async (route, init = {}) => {
    const res = await fetch(`${BASE}/api${route}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${route} -> ${res.status}: ${body.error || 'request failed'}`);
    return body;
  };
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-settings-'));
  const dbFile = path.join(dataDir, 'rifq.db');
  let server = null;

  try {
    /* ---------------------------- first boot ---------------------------- */
    server = startServer(dataDir);
    await waitForHealth();
    pass('server started on a fresh data directory', dataDir);

    const { cookie, user } = await login();
    expect('Super Admin can sign in', user?.role === 'superadmin', `role=${user?.role}`);
    const call = api(cookie);

    const initial = await call('/admin/settings');
    expect(
      'settings load with the new store keys present',
      Object.prototype.hasOwnProperty.call(initial.settings || {}, 'play_store_url') &&
        Object.prototype.hasOwnProperty.call(initial.settings || {}, 'app_store_url'),
      Object.keys(initial.settings || {}).length + ' keys'
    );

    const saved = await call('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        tagline: TAGLINE,
        contact_email: CONTACT,
        play_store_url: PLAY_STORE,
        app_store_url: APP_STORE,
        announcement_text: 'Saved through the real admin API',
      }),
    });
    expect('save returns the stored values', saved.settings?.tagline === TAGLINE);
    expect('Play Store link accepted', saved.settings?.play_store_url === PLAY_STORE);
    expect('App Store link accepted', saved.settings?.app_store_url === APP_STORE);

    const reread = await call('/admin/settings');
    expect('settings read back immediately', reread.settings?.tagline === TAGLINE);
    expect('database file exists on the data directory', fs.existsSync(dbFile), dbFile);

    /* ------------------------- restart (reopen) ------------------------- */
    await stopServer(server);
    server = null;
    pass('server stopped');

    server = startServer(dataDir);
    await waitForHealth();
    pass('server restarted on the same data directory');

    const second = await login();
    const call2 = api(second.cookie);
    const after = await call2('/admin/settings');
    expect('settings survived a full server restart', after.settings?.tagline === TAGLINE);
    expect('contact email survived', after.settings?.contact_email === CONTACT);
    expect('Play Store link survived', after.settings?.play_store_url === PLAY_STORE);
    expect('App Store link survived', after.settings?.app_store_url === APP_STORE);
    expect(
      'announcement survived',
      after.settings?.announcement_text === 'Saved through the real admin API'
    );

    /* --------------------------- share links ---------------------------- */
    const config = await call2('/config');
    expect(
      'public config exposes a real absolute app link',
      /^https?:\/\//.test(String(config.shareUrl || '')),
      String(config.shareUrl)
    );
    expect('app link points at this deployment', config.shareUrl === BASE, String(config.shareUrl));
    expect(
      'app link is not a referral or redirect link',
      !/[?&](ref|referral|aff|affiliate|utm_)/i.test(String(config.shareUrl || '')),
      String(config.shareUrl)
    );
    expect('config reports the saved Play Store link', config.playStoreUrl === PLAY_STORE);
    expect('config reports the saved App Store link', config.appStoreUrl === APP_STORE);

    console.log(`\n${checks} checks passed.`);
  } finally {
    await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\nVerification failed: ${err.message}`);
  process.exitCode = 1;
});

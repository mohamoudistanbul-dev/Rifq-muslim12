#!/usr/bin/env node
/**
 * End-to-end verification of the RIFQ Muslim Super Admin system.
 *
 * Starts the real server on a throwaway database, then drives the real HTTP API:
 * unauthenticated access, super admin login, content create/publish/delete and its
 * reflection in the public endpoints, site settings reflected in /api/config,
 * notification delivery, role enforcement for normal users, and password change.
 *
 * Run with: npm run verify:admin
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.VERIFY_PORT || 3987);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'rifqmuslim@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Haajiro3320$';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-admin-'));
const dbPath = path.join(tmpDir, 'verify.db');

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

/* -------------------------------- http client ------------------------------- */

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
      if (pair.startsWith('rifq_session=') || pair.startsWith('token=')) this.cookie = pair;
    }
    return { status: res.status, json, raw, headers: res.headers };
  }

  get(route) {
    return this.call('GET', route);
  }
  post(route, body) {
    return this.call('POST', route, body === undefined ? {} : body);
  }
  patch(route, body) {
    return this.call('PATCH', route, body);
  }
  put(route, body) {
    return this.call('PUT', route, body);
  }
  del(route) {
    return this.call('DELETE', route);
  }
}

async function waitForServer(child, timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.status < 500) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not become ready in time');
}

/* ----------------------------------- suite ---------------------------------- */

async function main() {
  const child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => {
    serverLog += d.toString();
  });
  child.stderr.on('data', (d) => {
    serverLog += d.toString();
  });

  const stop = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  };

  try {
    await waitForServer(child);

    const anon = new Session();
    const admin = new Session();

    console.log('\n1. Admin access control');
    const unauth = await anon.get('/admin/overview');
    check('unauthenticated overview is rejected', unauth.status === 401, `status ${unauth.status}`);

    const badLogin = await anon.post('/auth/login', { email: ADMIN_EMAIL, password: 'wrong-password-here' });
    check('wrong admin password is rejected', badLogin.status === 401 || badLogin.status === 400, `status ${badLogin.status}`);

    const login = await admin.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check('super admin can sign in', login.status === 200, `status ${login.status}`);
    check('session role is superadmin', login.json?.user?.role === 'superadmin', String(login.json?.user?.role));
    check('password never returned to the client', !/password|hash/i.test(login.raw || ''), 'no password fields in payload');

    const overview = await admin.get('/admin/overview');
    check('overview loads for admin', overview.status === 200 && typeof overview.json?.users === 'number');
    check('overview reports media storage', typeof overview.json?.mediaBytes === 'number');

    console.log('\n2. Content CMS reflected on the live app');
    const slug = `verify-article-${Date.now()}`;
    const created = await admin.post('/admin/content', {
      type: 'article',
      title: 'Verification article',
      category: 'Test',
      excerpt: 'Created by the automated admin verification.',
      body: 'Body text used to prove the admin content pipeline works end to end.',
      status: 'draft',
      featured: true,
    });
    const contentId = created.json?.content?.id || created.json?.id;
    check('admin can create content', (created.status === 200 || created.status === 201) && !!contentId, `status ${created.status}`);

    const draftHidden = await anon.get('/content?limit=50');
    const draftVisible = (draftHidden.json?.content || []).some((c) => c.id === contentId);
    check('unpublished draft is not public', !draftVisible);

    const published = await admin.post(`/admin/content/${contentId}/publish`, { published: true });
    check('admin can publish content', published.status === 200, `status ${published.status}`);

    const publicList = await anon.get('/content?limit=50');
    const liveItem = (publicList.json?.content || []).find((c) => c.id === contentId);
    check('published content appears on the public app', !!liveItem, liveItem ? `slug ${liveItem.slug}` : 'not found');

    if (liveItem?.slug) {
      const detail = await anon.get(`/content/${liveItem.slug}`);
      check(
        'public detail page returns the admin text',
        detail.status === 200 && String(detail.json?.content?.body || '').includes('end to end'),
        `status ${detail.status}`
      );
    } else {
      bad('public detail page returns the admin text', 'no slug returned');
    }

    const edited = await admin.patch(`/admin/content/${contentId}`, { title: 'Verification article (edited)' });
    check('admin can edit content', edited.status === 200);
    const afterEdit = await admin.get(`/admin/content?q=Verification%20article`);
    const editedRow = (afterEdit.json?.content || []).find((c) => c.id === contentId);
    check('edit persists in the database', editedRow?.title === 'Verification article (edited)', editedRow?.title || 'missing');

    console.log('\n3. Settings, contact details and notifications');
    const savedSettings = await admin.put('/admin/settings', {
      contact_email: 'rifqmuslim@gmail.com',
      contact_phone: '+252612215593',
      whatsapp: '+252612215593',
      announcement_text: 'Automated verification announcement.',
      announcement_active: 'true',
    });
    check('admin can save site settings', savedSettings.status === 200, `status ${savedSettings.status}`);

    const config = await anon.get('/config');
    check('settings reach the public config', config.status === 200 && config.json?.contactEmail === 'rifqmuslim@gmail.com', String(config.json?.contactEmail));
    check('announcement is published', String(config.json?.announcement || '').includes('Automated verification'));

    const notice = await admin.post('/admin/notifications', {
      title: 'Verification notice',
      body: 'Sent by the automated admin verification.',
    });
    check('admin can send a notification', notice.status === 200 || notice.status === 201, `status ${notice.status}`);
    const notices = await admin.get('/admin/notifications');
    check(
      'notification is stored',
      (notices.json?.notifications || []).some((n) => n.title === 'Verification notice')
    );

    console.log('\n4. Media library');
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AH9gHwAAAAASUVORK5CYII=';
    const upload = await admin.post('/admin/media', {
      mime: 'image/png',
      name: 'verify.png',
      data: `data:image/png;base64,${png}`,
    });
    const mediaUrl = upload.json?.media?.url;
    check('admin can upload media', (upload.status === 200 || upload.status === 201) && !!mediaUrl, `status ${upload.status}`);
    if (mediaUrl) {
      const fetched = await fetch(`${BASE}${mediaUrl}`);
      check('uploaded media is served', fetched.status === 200, `status ${fetched.status}`);
      const mediaId = upload.json?.media?.id;
      if (mediaId) {
        const removed = await admin.del(`/admin/media/${mediaId}`);
        check('admin can delete media', removed.status === 200, `status ${removed.status}`);
      }
    }

    console.log('\n5. User management and role enforcement');
    const userEmail = `verify.user.${Date.now()}@example.com`;
    const registered = await anon.post('/auth/register', {
      name: 'Verify User',
      email: userEmail,
      password: 'VerifyPass123!',
    });
    check('a normal account can register', registered.status === 200 || registered.status === 201, `status ${registered.status}`);

    const normal = new Session();
    const normalLogin = await normal.post('/auth/login', { email: userEmail, password: 'VerifyPass123!' });
    check('normal user can sign in', normalLogin.status === 200, `status ${normalLogin.status}`);

    const forbidden = await normal.get('/admin/overview');
    check('normal user is denied admin access', forbidden.status === 403 || forbidden.status === 401, `status ${forbidden.status}`);

    const forbiddenWrite = await normal.post('/admin/content', { title: 'Should not exist', type: 'article' });
    check('normal user cannot write content', forbiddenWrite.status === 403 || forbiddenWrite.status === 401, `status ${forbiddenWrite.status}`);

    const userList = await admin.get(`/admin/users?q=${encodeURIComponent(userEmail)}`);
    const foundUser = (userList.json?.users || []).find((u) => u.email === userEmail);
    check('admin can find the user', !!foundUser);
    check('admin listing never exposes password hashes', !/password_hash|"hash"/.test(userList.raw || ''));

    if (foundUser) {
      const promoted = await admin.patch(`/admin/users/${foundUser.id}`, { role: 'admin' });
      check('admin can change a role', promoted.status === 200);
      const promotedList = await admin.get(`/admin/users?q=${encodeURIComponent(userEmail)}`);
      const nowAdmin = (promotedList.json?.users || []).find((u) => u.id === foundUser.id);
      check('role change persists', nowAdmin?.role === 'admin', String(nowAdmin?.role));
      await admin.patch(`/admin/users/${foundUser.id}`, { role: 'user' });
    }

    console.log('\n6. Activity log and security');
    const audit = await admin.get('/admin/audit?limit=100');
    const actions = (audit.json?.audit || []).map((a) => a.action);
    check('activity log records admin actions', audit.status === 200 && actions.length > 0, `${actions.length} entries`);
    check(
      'content actions are audited',
      actions.some((a) => /content/i.test(a)),
      actions.slice(0, 4).join(', ')
    );

    const security = await admin.get('/admin/security');
    check('security panel loads', security.status === 200 && !!security.json?.email, String(security.json?.email));
    check('security panel lists administrators', Array.isArray(security.json?.admins));

    console.log('\n7. Password change');
    const wrongCurrent = await admin.post('/admin/password', { current: 'not-the-password', next: 'NewPass1234!' });
    check('password change requires the current password', wrongCurrent.status === 400 || wrongCurrent.status === 401, `status ${wrongCurrent.status}`);

    const changed = await admin.post('/admin/password', { current: ADMIN_PASSWORD, next: 'NewPass1234!' });
    check('admin can change the password', changed.status === 200, `status ${changed.status}`);

    const relogin = new Session();
    const oldPass = await relogin.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check('old password stops working', oldPass.status === 401 || oldPass.status === 400, `status ${oldPass.status}`);
    const newPass = await relogin.post('/auth/login', { email: ADMIN_EMAIL, password: 'NewPass1234!' });
    check('new password works', newPass.status === 200, `status ${newPass.status}`);
    const restored = await relogin.post('/admin/password', { current: 'NewPass1234!', next: ADMIN_PASSWORD });
    check('password can be restored', restored.status === 200, `status ${restored.status}`);

    console.log('\n8. Cleanup');
    const deleted = await admin.del(`/admin/content/${contentId}`);
    check('admin can delete content', deleted.status === 200, `status ${deleted.status}`);
    const afterDelete = await anon.get('/content?limit=50');
    check('deleted content disappears from the public app', !(afterDelete.json?.content || []).some((c) => c.id === contentId));
  } finally {
    stop();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    if (failures.length) {
      console.log(`\nServer log tail:\n${serverLog.split('\n').slice(-25).join('\n')}`);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
  console.log('Super Admin system verified end to end.');
}

main().catch((err) => {
  console.error('verification could not run:', err.message);
  process.exit(1);
});

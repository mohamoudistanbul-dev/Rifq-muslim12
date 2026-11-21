/**
 * End-to-end check of real device delivery in RIFQ Muslim.
 *
 * Proves the paths that decide whether a notification actually reaches a phone:
 *   - the server owns a VAPID key pair and publishes the public half;
 *   - a device subscription is stored per account and never leaks to another;
 *   - an admin message is delivered to the inbox AND pushed to every registered
 *     device, with real sent/failed counts written to the message record;
 *   - a device that cannot be reached is recorded as a failure, not a success;
 *   - announcements can be created, edited, cancelled, sent now, and are sent
 *     automatically by the server when their time comes;
 *   - ordinary users cannot touch any of it.
 *
 * Run with: npm run verify:push
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.VERIFY_PORT || 4593);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'rifqmuslim@gmail.com';
const ADMIN_PASSWORD = 'RifqTest!2026';
const PASSWORD = 'RifqTest!2026';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-push-'));
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
  post(route, body) {
    return this.call('POST', route, body === undefined ? {} : body);
  }
  put(route, body) {
    return this.call('PUT', route, body === undefined ? {} : body);
  }
}

function startServer() {
  const child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: dbPath,
      DATA_DIR: tmpDir,
      NODE_ENV: 'production',
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      SEED_BUNDLED_DB: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srv = { child, out: '' };
  child.stdout.on('data', (d) => {
    srv.out += d.toString();
  });
  child.stderr.on('data', (d) => {
    srv.out += d.toString();
  });
  return srv;
}

async function waitForServer(srv, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (srv.child.exitCode !== null) throw new Error(`server exited early (${srv.child.exitCode}):\n${srv.out}`);
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.status < 500) return;
    } catch {
      /* not listening yet */
    }
    await sleep(300);
  }
  throw new Error(`server did not become ready:\n${srv.out}`);
}

async function stopServer(srv) {
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        srv.child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 6000);
    srv.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    srv.child.kill('SIGTERM');
  });
}

/* A well-formed subscription that no push service will accept. Delivery must be
 * recorded as a failure — that is exactly what this test asserts. */
const fakeDevice = (name) => ({
  endpoint: `https://push.invalid/${name}`,
  keys: { p256dh: 'B'.repeat(80), auth: 'A'.repeat(24) },
});

async function main() {
  const srv = startServer();
  await waitForServer(srv);
  ok('server starts and answers /api/health');

  try {
    const anon = new Session();
    const userA = new Session();
    const userB = new Session();
    const admin = new Session();

    /* ------------------------------- VAPID key ------------------------------ */

    const key = await anon.get('/push/key');
    check('public VAPID key is published for the browser', key.status === 200 && !!key.json?.publicKey, `status ${key.status}`);
    check('key source is reported', typeof key.json?.source === 'string', String(key.json?.source));
    const keyAgain = await anon.get('/push/key');
    check('the same key is reused (existing subscriptions stay valid)', keyAgain.json?.publicKey === key.json?.publicKey);

    /* ----------------------------- access control ---------------------------- */

    const anonStatus = await anon.get('/push/status');
    check('device status requires sign-in', anonStatus.status === 401, `status ${anonStatus.status}`);

    const regA = await userA.post('/auth/register', { name: 'Amina Test', email: 'amina.push@example.com', password: PASSWORD });
    const regB = await userB.post('/auth/register', { name: 'Bilal Test', email: 'bilal.push@example.com', password: PASSWORD });
    check('two accounts register', regA.status === 201 && regB.status === 201, `${regA.status}/${regB.status}`);

    const login = await admin.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check('owner signs in', login.status === 200 && !!login.json?.user?.role, `role ${login.json?.user?.role}`);

    /* --------------------------- device registration ------------------------- */

    const emptyStatus = await userA.get('/push/status');
    check('a new account has no registered device', emptyStatus.json?.count === 0, `count ${emptyStatus.json?.count}`);

    const sub = await userA.post('/push/subscribe', { subscription: fakeDevice('device-a'), label: 'Test phone' });
    check('device subscription is stored', (sub.status === 200 || sub.status === 201) && sub.json?.count === 1, `status ${sub.status} count ${sub.json?.count}`);

    const resub = await userA.post('/push/subscribe', { subscription: fakeDevice('device-a'), label: 'Test phone' });
    check('the same device is not duplicated', resub.json?.count === 1, `count ${resub.json?.count}`);

    const statusA = await userA.get('/push/status');
    check('the account sees its own device', statusA.json?.count === 1 && statusA.json?.devices?.[0]?.host === 'push.invalid');

    const statusB = await userB.get('/push/status');
    check('another account sees none of it', statusB.json?.count === 0, `count ${statusB.json?.count}`);

    const badSub = await userA.post('/push/subscribe', { subscription: { endpoint: 'http://insecure.example/x', keys: {} } });
    check('an invalid subscription is rejected', badSub.status === 400, `status ${badSub.status}`);

    /* --------------------------- admin broadcast push ------------------------ */

    const userSend = await userA.post('/admin/notifications', { title: 'Not allowed', body: 'should fail' });
    check('ordinary user cannot send an admin message', userSend.status === 403, `status ${userSend.status}`);

    const sent = await admin.post('/admin/notifications', { title: 'Jumuah reminder', body: 'Prayer starts at 1pm', audience: 'all' });
    check('admin sends a message to all users', sent.status === 201, `status ${sent.status}`);
    check('delivery counts are reported per message', typeof sent.json?.delivery?.delivered === 'number', JSON.stringify(sent.json?.delivery || {}));
    check('the push attempt is reported, not assumed', typeof sent.json?.push?.devices === 'number', JSON.stringify({ devices: sent.json?.push?.devices, sent: sent.json?.push?.sent, failed: sent.json?.push?.failed }));
    check(
      'an unreachable device is counted as failed, never as sent',
      Number(sent.json?.push?.devices) >= 1 && Number(sent.json?.push?.sent) === 0 && Number(sent.json?.push?.failed) >= 1,
      `devices ${sent.json?.push?.devices} sent ${sent.json?.push?.sent} failed ${sent.json?.push?.failed}`
    );

    const inboxA = await userA.get('/notifications');
    const jumuah = (inboxA.json?.notifications || []).filter((n) => n.title === 'Jumuah reminder');
    check('the message lands in the inbox exactly once', jumuah.length === 1, `${jumuah.length} row(s)`);
    check('the delivery outcome is stored on the recipient row', ['sent', 'failed', 'no_device'].includes(String(jumuah[0]?.pushStatus)), String(jumuah[0]?.pushStatus));
    check('the failure reason is stored', !!jumuah[0]?.pushError, String(jumuah[0]?.pushError || '').slice(0, 60));

    const history = await admin.get('/admin/notifications');
    const row = (history.json?.notifications || []).find((n) => n.title === 'Jumuah reminder');
    check('the dashboard shows device push counts', !!row && Number(row.push_failed) >= 1, `push_failed ${row?.push_failed}`);
    check('the dashboard note explains device delivery', !!row?.delivery_note && /push/i.test(String(row.delivery_note)), String(row?.delivery_note || ''));

    /* ------------------------------- test push ------------------------------- */

    const testB = await userB.post('/push/test', {});
    check('test push with no device explains why', testB.status === 200 && Number(testB.json?.devices) === 0, JSON.stringify({ devices: testB.json?.devices }));

    const testA = await userA.post('/push/test', {});
    check('test push reaches the registered device attempt', Number(testA.json?.devices) >= 1, JSON.stringify({ devices: testA.json?.devices, sent: testA.json?.sent }));
    check('test push reports the real result', Number(testA.json?.sent) === 0 && !!testA.json?.message, String(testA.json?.message || ''));

    /* ----------------------------- announcements ----------------------------- */

    const userAnnounce = await userA.get('/admin/announcements');
    check('announcements are admin-only', userAnnounce.status === 403, `status ${userAnnounce.status}`);

    const created = await admin.post('/admin/announcements', {
      title: 'Eid Mubarak',
      body: 'May Allah accept your worship.',
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      audience: 'all',
    });
    check('a future announcement is scheduled', created.status === 201 && created.json?.item?.status === 'scheduled', `status ${created.status}`);
    const announceId = created.json?.item?.id;

    const edited = await admin.put(`/admin/announcements/${announceId}`, { title: 'Eid Mubarak 1447' });
    check('a scheduled announcement can be edited', edited.status === 200 && edited.json?.item?.title === 'Eid Mubarak 1447', `status ${edited.status}`);

    const shortTitle = await admin.post('/admin/announcements', { title: 'a', body: 'b' });
    check('an empty announcement is rejected', shortTitle.status === 400, `status ${shortTitle.status}`);

    const sentNow = await admin.post(`/admin/announcements/${announceId}/send`, {});
    check('an announcement can be sent immediately', sentNow.status === 200 && sentNow.json?.item?.status === 'sent', `status ${sentNow.status}`);
    check('the sent announcement records inbox and push counts', typeof sentNow.json?.item?.delivered === 'number' && typeof sentNow.json?.item?.pushFailed === 'number', JSON.stringify({ delivered: sentNow.json?.item?.delivered, push: sentNow.json?.item?.pushSent, pushFailed: sentNow.json?.item?.pushFailed }));

    const inboxAfter = await userA.get('/notifications');
    check('the announcement reaches the inbox', (inboxAfter.json?.notifications || []).some((n) => n.title === 'Eid Mubarak 1447'));

    const editSent = await admin.put(`/admin/announcements/${announceId}`, { title: 'Too late' });
    check('a sent announcement cannot be edited', editSent.status === 409, `status ${editSent.status}`);
    const resend = await admin.post(`/admin/announcements/${announceId}/send`, {});
    check('the same announcement is never sent twice', resend.status === 409, `status ${resend.status}`);

    const toCancel = await admin.post('/admin/announcements', {
      title: 'Cancelled reminder',
      body: 'This should never be delivered.',
      scheduledAt: new Date(Date.now() + 7200_000).toISOString(),
      audience: 'all',
    });
    const cancelId = toCancel.json?.item?.id;
    const cancelled = await admin.post(`/admin/announcements/${cancelId}/cancel`, {});
    check('a scheduled announcement can be cancelled', cancelled.status === 200 && cancelled.json?.item?.status === 'cancelled', `status ${cancelled.status}`);
    const sendCancelled = await admin.post(`/admin/announcements/${cancelId}/send`, {});
    check('a cancelled announcement is not sent', sendCancelled.status === 409, `status ${sendCancelled.status}`);

    /* ------------------------ automatic scheduled sending -------------------- */

    const due = await admin.post('/admin/announcements', {
      title: 'Automatic reminder',
      body: 'Sent by the server scheduler.',
      scheduledAt: new Date(Date.now() - 5000).toISOString(),
      audience: 'all',
    });
    const dueId = due.json?.item?.id;
    check('a due announcement is created', !!dueId, `status ${due.status}`);

    let auto = null;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const list = await admin.get('/admin/announcements');
      auto = (list.json?.announcements || []).find((a) => a.id === dueId);
      if (auto && auto.status !== 'scheduled') break;
      await sleep(1500);
    }
    check('the server sends a due announcement on its own', auto?.status === 'sent', `status ${auto?.status}`);
    check('the automatic send records real delivery counts', !!auto && Number(auto.recipients) >= 2, `recipients ${auto?.recipients} delivered ${auto?.delivered}`);

    const autoInbox = await userB.get('/notifications');
    check('the automatic announcement reaches the inbox', (autoInbox.json?.notifications || []).some((n) => n.title === 'Automatic reminder'));

    /* ------------------------------- unsubscribe ----------------------------- */

    const unsub = await userA.post('/push/unsubscribe', { endpoint: fakeDevice('device-a').endpoint });
    check('a device can be removed', unsub.status === 200 && Number(unsub.json?.count) === 0, `count ${unsub.json?.count}`);

    const afterUnsub = await userA.post('/push/test', {});
    check('after removal nothing claims to be delivered', Number(afterUnsub.json?.devices) === 0, JSON.stringify({ devices: afterUnsub.json?.devices }));
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

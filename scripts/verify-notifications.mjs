/**
 * End-to-end check of the RIFQ Muslim notification system.
 *
 * Runs a real server against a throwaway database and proves the paths a user
 * actually depends on:
 *   - an admin message is stored and lands in each targeted user's inbox;
 *   - "all users" and "selected users" reach exactly the right accounts;
 *   - read/unread state is stored server-side and cannot be changed by another
 *     account;
 *   - the dashboard reports real delivery counts;
 *   - bad input is rejected and non-admins are refused;
 *   - history survives a server restart.
 *
 * Run with: npm run verify:notifications
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.VERIFY_PORT || 4591);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'rifqmuslim@gmail.com';
const ADMIN_PASSWORD = 'RifqTest!2026';
const PASSWORD = 'RifqTest!2026';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-notify-'));
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
    await new Promise((r) => setTimeout(r, 300));
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

const titleAll = 'Eid announcement';
const titleSelected = 'Ramadan reminder for you';

async function main() {
  let srv = startServer();
  await waitForServer(srv);
  ok('server starts and answers /api/health');

  const userA = new Session();
  const userB = new Session();
  const admin = new Session();

  const regA = await userA.post('/auth/register', { name: 'Amina Test', email: 'amina@example.com', password: PASSWORD });
  check('user A registers', regA.status === 201, `status ${regA.status}`);
  const regB = await userB.post('/auth/register', { name: 'Bilal Test', email: 'bilal@example.com', password: PASSWORD });
  check('user B registers', regB.status === 201, `status ${regB.status}`);

  const login = await admin.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check('owner signs in to the dashboard', login.status === 200 && login.json?.user?.role, `role ${login.json?.user?.role}`);

  const idA = regA.json?.user?.id;
  const idB = regB.json?.user?.id;
  check('registered accounts have ids', !!idA && !!idB);

  /* ---------------------------- access control ---------------------------- */

  const userSend = await userA.post('/admin/notifications', { title: 'Not allowed', body: 'should fail' });
  check('ordinary user cannot send an admin notification', userSend.status === 403, `status ${userSend.status}`);

  const anon = new Session();
  const anonInbox = await anon.get('/notifications');
  check('inbox requires sign-in', anonInbox.status === 401, `status ${anonInbox.status}`);

  /* ------------------------------ send to all ----------------------------- */

  const sendAll = await admin.post('/admin/notifications', {
    title: titleAll,
    body: 'The RIFQ Muslim team wishes you a blessed Eid.',
    audience: 'all',
  });
  check('admin sends to all users', sendAll.status === 201, `status ${sendAll.status}`);
  const deliveryAll = sendAll.json?.delivery;
  check(
    'every targeted account received the message',
    !!deliveryAll && deliveryAll.delivered === deliveryAll.recipients && deliveryAll.recipients >= 3,
    `${deliveryAll?.delivered}/${deliveryAll?.recipients} delivered, ${deliveryAll?.failed ?? '?'} failed`
  );

  const inboxA1 = await userA.get('/notifications?limit=50');
  check('A opens the inbox', inboxA1.status === 200, `status ${inboxA1.status}`);
  const rowA = (inboxA1.json?.notifications || []).find((n) => n.title === titleAll);
  check('all-users message appears in A inbox', !!rowA);
  check('message carries title, body and date', !!rowA?.body && !!rowA?.createdAt);

  const inboxB1 = await userB.get('/notifications?limit=50');
  check('all-users message appears in B inbox', (inboxB1.json?.notifications || []).some((n) => n.title === titleAll));

  check('a new message counts as unread', Number(inboxA1.json?.unread) >= 1, `unread ${inboxA1.json?.unread}`);
  check('a new message is marked unread on the row', rowA?.read === false);

  /* ------------------------------- read state ----------------------------- */

  const markA = await userA.post('/notifications/read', { ids: [rowA.id] });
  check('A marks the message read', markA.status === 200 && markA.json?.changed === 1, `changed ${markA.json?.changed}`);
  check('unread count drops after reading', Number(markA.json?.unread) === 0, `unread ${markA.json?.unread}`);

  const inboxA2 = await userA.get('/notifications?limit=50');
  check('read state is stored on the server', inboxA2.json?.notifications?.find((n) => n.id === rowA.id)?.read === true);

  const crossMark = await userB.post('/notifications/read', { ids: [rowA.id] });
  check('another account cannot mark A rows read', crossMark.status === 200 && crossMark.json?.changed === 0, `changed ${crossMark.json?.changed}`);

  const inboxB2 = await userB.get('/notifications?limit=50');
  const rowB = (inboxB2.json?.notifications || []).find((n) => n.title === titleAll);
  check('B row stays unread after the cross-account attempt', rowB?.read === false);

  /* --------------------------- send to selected --------------------------- */

  const sendSelected = await admin.post('/admin/notifications', {
    title: titleSelected,
    body: 'This message was sent only to the selected account.',
    audience: 'selected',
    userIds: [idA],
  });
  check('admin sends to a selected user', sendSelected.status === 201, `status ${sendSelected.status}`);
  check(
    'selected send reaches exactly one account',
    sendSelected.json?.delivery?.delivered === 1 && sendSelected.json?.delivery?.recipients === 1,
    `${sendSelected.json?.delivery?.delivered}/${sendSelected.json?.delivery?.recipients}`
  );

  const inboxA3 = await userA.get('/notifications?limit=50');
  check('selected message reaches A', (inboxA3.json?.notifications || []).some((n) => n.title === titleSelected));
  const inboxB3 = await userB.get('/notifications?limit=50');
  check('selected message does not reach B', !(inboxB3.json?.notifications || []).some((n) => n.title === titleSelected));

  /* --------------------------- dashboard status --------------------------- */

  const dash = await admin.get('/admin/notifications');
  const sentRow = (dash.json?.notifications || []).find((n) => n.title === titleSelected);
  check('dashboard lists the sent message', !!sentRow);
  check(
    'dashboard shows real delivery counts',
    Number(sentRow?.delivered) === 1 && Number(sentRow?.recipients) === 1 && Number(sentRow?.failed) === 0,
    `${sentRow?.delivered}/${sentRow?.recipients}, failed ${sentRow?.failed}`
  );

  const detail = await admin.get(`/admin/notifications/${sentRow.id}`);
  check('dashboard shows who received it', detail.status === 200 && detail.json?.recipients?.length === 1);
  check('recipient list carries the account', detail.json?.recipients?.[0]?.email === 'amina@example.com', detail.json?.recipients?.[0]?.email);

  /* ------------------------------ validation ------------------------------ */

  const tooShort = await admin.post('/admin/notifications', { title: 'x', body: 'y', audience: 'all' });
  check('an empty title and message are rejected', tooShort.status === 400, `status ${tooShort.status}`);

  const badTarget = await admin.post('/admin/notifications', {
    title: 'Nobody',
    body: 'This should not be accepted.',
    audience: 'selected',
    userIds: ['does-not-exist'],
  });
  check('a selected send with no real recipient is rejected', badTarget.status === 400, `status ${badTarget.status}`);

  /* ------------------------------- mark all ------------------------------- */

  const markAll = await userA.post('/notifications/read', { all: true });
  check('mark-all-read clears the badge', markAll.status === 200 && Number(markAll.json?.unread) === 0, `unread ${markAll.json?.unread}`);

  /* -------------------------- restart persistence ------------------------- */

  await stopServer(srv);
  srv = startServer();
  await waitForServer(srv);

  const userAAgain = new Session();
  const relogin = await userAAgain.post('/auth/login', { email: 'amina@example.com', password: PASSWORD });
  check('A can sign in after a restart', relogin.status === 200, `status ${relogin.status}`);

  const inboxAfter = await userAAgain.get('/notifications?limit=50');
  const survived = (inboxAfter.json?.notifications || []).find((n) => n.title === titleAll);
  check('message history survives a server restart', !!survived);
  check('read state survives a server restart', survived?.read === true);

  await stopServer(srv);
}

try {
  await main();
} catch (error) {
  bad('harness', error.message);
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

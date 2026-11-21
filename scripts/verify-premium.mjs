/**
 * Owner/Admin Premium Management check for RIFQ Muslim.
 *
 * Proves the paths the owner actually relies on:
 *   - the registry is seeded from the app's own catalogues, so the owner is
 *     managing real content, not a demo list;
 *   - an ordinary account cannot read or write any management endpoint, and
 *     cannot grant itself Premium;
 *   - switching one item to Premium locks it for free visitors and for free
 *     accounts, while the owner keeps access — enforced by the content routes,
 *     not only by the UI;
 *   - a verified grant unlocks the same item, and a revoke locks it again;
 *   - disable, unpublish, rename and preview all behave as documented;
 *   - bulk changes work and every write records who made it;
 *   - catalogue items cannot be deleted (they would vanish from the app) while
 *     custom items can.
 *
 * Run with: npm run verify:premium
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.VERIFY_PORT || 4596);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'rifqmuslim@gmail.com';
const ADMIN_PASSWORD = 'RifqTest!2026';
const PASSWORD = 'RifqTest!2026';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-premium-'));
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
  del(route) {
    return this.call('DELETE', route);
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

async function waitForServer(srv, timeoutMs = 90000) {
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

const contentRoute = (item) => {
  const parts = item.key.split('.');
  if (parts[0] === 'hadith') return `/hadith/${parts.slice(2).join('.')}`;
  if (parts[0] === 'kids') return '/kids/lessons';
  return '';
};

async function main() {
  const srv = startServer();
  await waitForServer(srv);
  ok('server starts and answers /api/health');

  try {
    const anon = new Session();
    const user = new Session();
    const admin = new Session();

    /* ------------------------------- the registry ---------------------------- */

    const anonList = await anon.get('/access/items');
    const all = anonList.json?.items || [];
    check('a visitor can read the public access list', anonList.status === 200 && all.length > 50, `${all.length} items`);
    const categories = anonList.json?.categories || [];
    check(
      'the registry is seeded from the real catalogues',
      ['quran', 'audio'].every((id) => categories.includes(id)),
      categories.join(', ')
    );
    check('everything starts free and open', all.every((item) => item.tier === 'free' && item.allowed && !item.locked));

    /* --------------------------- access control ------------------------------ */

    const reg = await user.post('/auth/register', {
      name: 'Free User',
      email: 'free.premium@example.com',
      password: PASSWORD,
    });
    check('an ordinary account registers', reg.status === 201, `status ${reg.status}`);

    const login = await admin.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check('the owner signs in', login.status === 200 && !!login.json?.user?.role, `role ${login.json?.user?.role}`);

    const forbidden = [
      ['reads the management list', () => user.get('/admin/premium-content/items')],
      ['reads the overview', () => user.get('/admin/premium-content/overview')],
      ['changes an item', () => user.put('/admin/premium-content/items/quran.surah.1', { tier: 'premium' })],
      ['runs a bulk change', () => user.post('/admin/premium-content/items/bulk', { keys: ['quran.surah.1'], tier: 'premium' })],
      ['deletes an item', () => user.del('/admin/premium-content/items/quran.surah.1')],
    ];
    for (const [label, call] of forbidden) {
      const res = await call();
      check(`an ordinary user cannot ${label}`, res.status === 403 || res.status === 401, `status ${res.status}`);
    }

    const selfGrant = await user.post('/admin/premium/grant', { email: 'free.premium@example.com', planCode: 'monthly' });
    check('an ordinary user cannot grant itself Premium', selfGrant.status === 403 || selfGrant.status === 401, `status ${selfGrant.status}`);

    const plans = await anon.get('/premium/plans');
    const planList = plans.json?.plans || [];
    check('subscription plans are published', planList.length > 0, planList.map((p) => p.code).join(', '));

    /* ------------------------- switch content to premium --------------------- */

    const adminList = await admin.get('/admin/premium-content/items');
    check('the owner reads the management list', adminList.status === 200 && adminList.json?.total > 50, `${adminList.json?.total} items`);
    check('counts are reported', typeof adminList.json?.counts?.total === 'number' && adminList.json?.counts?.premium === 0);
    check('management rows carry the access decision', adminList.json?.items?.every((i) => typeof i.allowed === 'boolean'));

    const rows = adminList.json?.items || [];
    const target = rows.find((i) => i.category === 'hadith') || rows.find((i) => i.category === 'kids');
    check('a real catalogue item is available to switch', !!target, target ? target.key : 'none');

    if (!target) throw new Error('no gated catalogue item was seeded');

    const route = contentRoute(target);
    check('the target maps to a real content route', !!route, route || 'no route');

    const toPremium = await admin.put(`/admin/premium-content/items/${encodeURIComponent(target.key)}`, { tier: 'premium' });
    check('the owner sets an item to Premium', toPremium.status === 200 && toPremium.json?.item?.tier === 'premium', `status ${toPremium.status}`);
    check('the change is described', Array.isArray(toPremium.json?.changes) && toPremium.json.changes.length > 0, (toPremium.json?.changes || []).join(', '));
    check('the change records who made it', toPremium.json?.by === ADMIN_EMAIL, String(toPremium.json?.by));

    /* --------------------------- enforcement --------------------------------- */

    const anonCheck = await anon.get(`/access/check?key=${encodeURIComponent(target.key)}`);
    check('a visitor is told the item is Premium', anonCheck.status === 402 && anonCheck.json?.locked === true, `status ${anonCheck.status}`);

    const userCheck = await user.get(`/access/check?key=${encodeURIComponent(target.key)}`);
    check('a free account is refused', userCheck.status === 402, `status ${userCheck.status}`);

    if (target.category === 'hadith') {
      const freeContent = await user.get(route);
      check('the content route itself refuses a free account', freeContent.status === 402, `status ${freeContent.status}`);
      const ownerContent = await admin.get(route);
      check('the owner still opens the content', ownerContent.status === 200, `status ${ownerContent.status}`);
    } else {
      const freeLessons = await user.get('/kids/lessons');
      const locked = (freeLessons.json?.lessons || []).find((l) => l.id === target.key.split('.')[2]);
      check('the lesson is locked for a free account', !!locked && locked.locked === true, JSON.stringify(locked?.locked));
      check('its content is not sent to a free account', locked ? locked.body === null : false, String(locked?.body));
      const ownerLessons = await admin.get('/kids/lessons');
      const open = (ownerLessons.json?.lessons || []).find((l) => l.id === target.key.split('.')[2]);
      check('the owner still receives the content', !!open && open.body !== null);
    }

    const publicList = await anon.get('/access/items');
    const lockedRow = (publicList.json?.items || []).find((i) => i.key === target.key);
    check('the public list reports it as locked', !!lockedRow && lockedRow.locked === true);

    /* ------------------------- verified grant unlocks ------------------------ */

    const grant = await admin.post('/admin/premium/grant', {
      email: 'free.premium@example.com',
      planCode: (planList.find((p) => p.period === 'lifetime') || planList[0]).code,
      days: 30,
    });
    check('the owner grants a verified subscription', grant.status === 201 && !!grant.json?.id, `status ${grant.status}`);

    const afterGrant = await user.get(`/access/check?key=${encodeURIComponent(target.key)}`);
    check('the Premium account now opens the item', afterGrant.status === 200 && afterGrant.json?.allowed === true, `status ${afterGrant.status}`);

    const userList = await user.get('/access/items');
    check('the account is reported as Premium', userList.json?.premium === true);

    if (target.category === 'hadith') {
      const content = await user.get(route);
      check('the content route serves the Premium account', content.status === 200, `status ${content.status}`);
    } else {
      const lessons = await user.get('/kids/lessons');
      const open = (lessons.json?.lessons || []).find((l) => l.id === target.key.split('.')[2]);
      check('the lesson body is served to the Premium account', !!open && open.body !== null);
    }

    const overview = await admin.get('/admin/premium-content/overview');
    check('the overview counts the Premium account', overview.json?.premiumUsers >= 1, `premiumUsers ${overview.json?.premiumUsers}`);
    check('the overview counts active subscriptions', overview.json?.active >= 1, `active ${overview.json?.active}`);
    check(
      'the subscription appears in history',
      (overview.json?.history || []).some((h) => h.email === 'free.premium@example.com' && h.provider === 'manual')
    );

    /* ------------------------------- revoke ---------------------------------- */

    const revoke = await admin.post('/admin/premium/revoke', { subscriptionId: grant.json.id, reason: 'verification test' });
    check('the owner revokes the subscription', revoke.status === 200, `status ${revoke.status}`);
    const afterRevoke = await user.get(`/access/check?key=${encodeURIComponent(target.key)}`);
    check('access falls back to Free immediately', afterRevoke.status === 402, `status ${afterRevoke.status}`);

    /* --------------------- disable, draft, rename, preview ------------------- */

    const disable = await admin.put(`/admin/premium-content/items/${encodeURIComponent(target.key)}`, { enabled: false });
    check('the owner can disable an item', disable.status === 200 && disable.json?.item?.enabled === false);
    const hidden = await anon.get(`/access/check?key=${encodeURIComponent(target.key)}`);
    check('a disabled item is not visible to visitors', hidden.status === 404, `status ${hidden.status}`);
    const ownerStill = await admin.get(`/access/check?key=${encodeURIComponent(target.key)}`);
    check('the owner can still inspect a disabled item', ownerStill.status === 200, `status ${ownerStill.status}`);

    const draft = await admin.put(`/admin/premium-content/items/${encodeURIComponent(target.key)}`, {
      enabled: true,
      published: false,
    });
    check('the owner can unpublish', draft.status === 200 && draft.json?.item?.published === false);
    const notPublic = await anon.get('/access/items');
    check(
      'an unpublished item is absent from the public list',
      !(notPublic.json?.items || []).some((i) => i.key === target.key)
    );
    const staffSees = await admin.get('/admin/premium-content/items');
    check('staff still see the draft', (staffSees.json?.items || []).some((i) => i.key === target.key));

    const renamed = await admin.put(`/admin/premium-content/items/${encodeURIComponent(target.key)}`, {
      published: true,
      tier: 'premium',
      title: 'Owner renamed this item',
      description: 'Edited by the owner from Premium management.',
    });
    check('the owner can edit title and description', renamed.status === 200 && renamed.json?.item?.title === 'Owner renamed this item');
    check('the editor is recorded', renamed.json?.item?.updatedBy === ADMIN_EMAIL, String(renamed.json?.item?.updatedBy));

    const preview = await admin.get(`/admin/premium-content/items/${encodeURIComponent(target.key)}/preview`);
    check('preview shows the free visitor the upgrade screen', preview.json?.free?.upgradeScreen === true);
    check('preview shows Premium accounts keep access', preview.json?.premium?.allowed === true);
    check('preview explains the outcome', typeof preview.json?.note === 'string' && preview.json.note.length > 0);

    /* -------------------------------- bulk ---------------------------------- */

    const audioKeys = (adminList.json?.items || [])
      .filter((i) => i.category === 'audio')
      .map((i) => i.key)
      .slice(0, 3);
    const bulk = await admin.post('/admin/premium-content/items/bulk', { keys: audioKeys, tier: 'premium' });
    check('bulk changes apply to several items', bulk.status === 200 && bulk.json?.changed === audioKeys.length, `${bulk.json?.changed}/${audioKeys.length}`);

    const audioList = await anon.get('/access/items?category=audio');
    const lockedAudio = (audioList.json?.items || []).filter((i) => i.locked);
    check('bulk changes are visible to visitors', lockedAudio.length === audioKeys.length, `${lockedAudio.length} locked`);

    const backToFree = await admin.post('/admin/premium-content/items/bulk', { keys: audioKeys, tier: 'free' });
    check('bulk changes can be reverted', backToFree.status === 200 && backToFree.json?.changed === audioKeys.length);
    const audioOpen = await anon.get('/access/items?category=audio');
    check('reverted audio is open again', (audioOpen.json?.items || []).every((i) => i.tier === 'free'));

    /* ------------------------- catalogue vs custom -------------------------- */

    const deleteSeeded = await admin.del(`/admin/premium-content/items/${encodeURIComponent(target.key)}`);
    check('catalogue items cannot be deleted', deleteSeeded.status === 409, `status ${deleteSeeded.status}`);

    const custom = await admin.post('/admin/premium-content/items', {
      key: 'owner.banner.eid',
      category: 'general',
      title: 'Eid announcement',
      description: 'Custom item created by the owner.',
      tier: 'premium',
    });
    check('the owner can create a custom item', custom.status === 201 && custom.json?.item?.source === 'custom', `status ${custom.status}`);

    const customCheck = await anon.get('/access/check?key=owner.banner.eid');
    check('a custom premium item is gated too', customCheck.status === 402, `status ${customCheck.status}`);

    const removeCustom = await admin.del('/admin/premium-content/items/owner.banner.eid');
    check('a custom item can be deleted', removeCustom.status === 200, `status ${removeCustom.status}`);

    const badTier = await admin.put(`/admin/premium-content/items/${encodeURIComponent(target.key)}`, { tier: 'gold' });
    check('an invalid tier is rejected', badTier.status === 400, `status ${badTier.status}`);

    const badBulk = await admin.post('/admin/premium-content/items/bulk', { keys: [] });
    check('an empty bulk request is rejected', badBulk.status === 400, `status ${badBulk.status}`);

    /* --------------------------- restore and finish ------------------------- */

    const restore = await admin.put(`/admin/premium-content/items/${encodeURIComponent(target.key)}`, {
      tier: 'free',
      enabled: true,
      published: true,
    });
    check('the owner can return an item to Free', restore.status === 200 && restore.json?.item?.tier === 'free');

    const restored = await anon.get(`/access/check?key=${encodeURIComponent(target.key)}`);
    check('free visitors open it again immediately', restored.status === 200, `status ${restored.status}`);
  } finally {
    await stopServer(srv);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* temp folder */
    }
  }

  console.log('');
  if (failures.length) {
    console.log(`${failures.length} failure(s), ${passed} passed:`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`All ${passed} Premium management checks passed.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

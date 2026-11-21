#!/usr/bin/env node
/**
 * End-to-end verification of the RIFQ Muslim blue tick request system.
 *
 * Starts the real server on a throwaway database and data directory, then drives
 * the real HTTP API through the whole lifecycle a user and an administrator
 * actually perform:
 *
 *   validation → submit with picture + private document → duplicate blocked →
 *   applicant cannot see the admin queue or their own private document →
 *   admin reviews the submission → approve → badge and notification appear →
 *   the tick shows on a community post → revoke with a reason → badge gone →
 *   a new request → rejection with a reason → staff accounts are verified by
 *   role and cannot be unverified.
 *
 * Run with: npm run verify:verification
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.VERIFY_PORT || 3991);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'rifqmuslim@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Haajiro3320$';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-verify-'));
const dbPath = path.join(tmpDir, 'verify.db');

/* 1x1 PNG and a minimal PDF, both real files so the server's magic-byte checks
 * are exercised instead of bypassed. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AH9gHwAAAAASUVORK5CYII=';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString(
  'base64'
);

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
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: dbPath,
      DATA_DIR: tmpDir,
      NODE_ENV: 'production',
    },
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
    const applicant = new Session();

    const stamp = Date.now();
    const applicantEmail = `verify.tick.${stamp}@example.com`;
    const applicantPassword = 'VerifyPass123!';

    console.log('\n1. Accounts');
    const adminLogin = await admin.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check('administrator can sign in', adminLogin.status === 200, `status ${adminLogin.status}`);
    check('owner role is superadmin', adminLogin.json?.user?.role === 'superadmin', String(adminLogin.json?.user?.role));

    const registered = await anon.post('/auth/register', {
      name: 'Verify Tick',
      email: applicantEmail,
      password: applicantPassword,
    });
    check(
      'an ordinary account can register',
      registered.status === 200 || registered.status === 201,
      `status ${registered.status}`
    );

    const applicantLogin = await applicant.post('/auth/login', {
      email: applicantEmail,
      password: applicantPassword,
    });
    check('applicant can sign in', applicantLogin.status === 200, `status ${applicantLogin.status}`);
    const applicantId = applicantLogin.json?.user?.id;
    check('applicant starts without a blue tick', applicantLogin.json?.user?.badgeVerified === false || !applicantLogin.json?.user?.badgeVerified);

    const ownerState = await admin.get('/badge/request');
    check(
      'the Owner carries the blue tick automatically',
      ownerState.status === 200 && ownerState.json?.badgeVerified === true,
      `badgeVerified=${ownerState.json?.badgeVerified}`
    );

    console.log('\n2. Request validation');
    const noReason = await applicant.post('/badge/request', {
      fullName: 'Verify Tick',
      reason: 'short',
      avatar: `data:image/png;base64,${PNG}`,
    });
    check('a too-short reason is refused', noReason.status === 400, `status ${noReason.status}`);

    const noName = await applicant.post('/badge/request', {
      reason: 'I am the imam of a mosque and share verified RIFQ Muslim content with the community.',
      avatar: `data:image/png;base64,${PNG}`,
    });
    check('a missing full name is refused', noName.status === 400, `status ${noName.status}`);

    const noPicture = await applicant.post('/badge/request', {
      fullName: 'Verify Tick',
      reason: 'I am the imam of a mosque and share verified RIFQ Muslim content with the community.',
    });
    check('a missing profile picture is refused', noPicture.status === 400, `status ${noPicture.status}`);

    const fakeImage = await applicant.post('/badge/request', {
      fullName: 'Verify Tick',
      reason: 'I am the imam of a mosque and share verified RIFQ Muslim content with the community.',
      avatar: Buffer.from('this is not an image at all').toString('base64'),
      avatarMime: 'image/png',
    });
    check('a file pretending to be an image is refused', fakeImage.status === 400, `status ${fakeImage.status}`);

    console.log('\n3. Submitting a complete request');
    const submitted = await applicant.post('/badge/request', {
      fullName: 'Verify Tick',
      reason: 'I am the imam of a mosque and share verified RIFQ Muslim content with the community.',
      links: ['https://example.org/verify-tick'],
      avatar: `data:image/png;base64,${PNG}`,
      avatarMime: 'image/png',
      documents: [{ name: 'appointment-letter.pdf', mime: 'application/pdf', data: `data:application/pdf;base64,${PDF}` }],
    });
    check('a complete request is accepted', submitted.status === 201, `status ${submitted.status}`);
    const requestId = submitted.json?.request?.id;
    check('the request is stored as pending', submitted.json?.request?.status === 'pending', String(submitted.json?.request?.status));
    check('the reason is stored verbatim', String(submitted.json?.request?.reason || '').includes('imam of a mosque'));
    check('the supporting link is stored', (submitted.json?.request?.links || []).includes('https://example.org/verify-tick'));
    check('the document is attached', (submitted.json?.request?.documents || []).length === 1);
    const avatarUrl = submitted.json?.request?.avatarUrl || '';
    check('the profile picture is stored', /^\/uploads\//.test(avatarUrl), avatarUrl);

    if (avatarUrl) {
      const avatarRes = await fetch(`${BASE}${avatarUrl}`);
      check('the profile picture is served as an image', avatarRes.status === 200, `status ${avatarRes.status}`);
    }

    const duplicate = await applicant.post('/badge/request', {
      fullName: 'Verify Tick',
      reason: 'I am the imam of a mosque and share verified RIFQ Muslim content with the community.',
      avatar: `data:image/png;base64,${PNG}`,
    });
    check('a second pending request is refused', duplicate.status === 409, `status ${duplicate.status}`);

    const ownState = await applicant.get('/badge/request');
    check(
      'the applicant sees their pending status',
      ownState.status === 200 && ownState.json?.request?.status === 'pending',
      String(ownState.json?.request?.status)
    );
    check('the applicant is not verified yet', ownState.json?.badgeVerified === false);

    console.log('\n4. Permissions and document privacy');
    const applicantQueue = await applicant.get('/admin/badge-requests');
    check(
      'an ordinary user cannot open the admin queue',
      applicantQueue.status === 401 || applicantQueue.status === 403,
      `status ${applicantQueue.status}`
    );

    const anonDoc = await fetch(`${BASE}/api/admin/badge-requests/${requestId}/documents/x`);
    check('anonymous document access is refused', anonDoc.status === 401 || anonDoc.status === 403, `status ${anonDoc.status}`);

    const queue = await admin.get('/admin/badge-requests?status=pending');
    check('the administrator sees the queue', queue.status === 200, `status ${queue.status}`);
    const queued = (queue.json?.requests || []).find((r) => r.id === requestId);
    check('the submission is in the queue', !!queued);
    check('the queue shows the submitted full name', queued?.fullName === 'Verify Tick', String(queued?.fullName));
    check('the queue shows the reason', String(queued?.reason || '').includes('imam of a mosque'));
    check('the queue shows the profile picture', !!queued?.avatarUrl, String(queued?.avatarUrl));
    check('the queue lists the private document', (queued?.documents || []).length === 1);
    const docId = queued?.documents?.[0]?.id;
    check('pending count is reported', Number(queue.json?.counts?.pending || 0) >= 1, String(queue.json?.counts?.pending));

    if (docId) {
      const applicantDoc = await applicant.get(`/admin/badge-requests/${requestId}/documents/${docId}`);
      check(
        'the applicant cannot download their own uploaded document',
        applicantDoc.status === 401 || applicantDoc.status === 403,
        `status ${applicantDoc.status}`
      );
      const adminDoc = await fetch(`${BASE}/api/admin/badge-requests/${requestId}/documents/${docId}`, {
        headers: { cookie: admin.cookie },
      });
      check('the administrator can open the document', adminDoc.status === 200, `status ${adminDoc.status}`);
      check(
        'the document is served as a PDF',
        String(adminDoc.headers.get('content-type') || '').includes('pdf'),
        String(adminDoc.headers.get('content-type'))
      );
      check(
        'the document is marked private',
        /private|no-store/i.test(String(adminDoc.headers.get('cache-control') || '')),
        String(adminDoc.headers.get('cache-control'))
      );
      const wrongRequest = await fetch(`${BASE}/api/admin/badge-requests/not-this-request/documents/${docId}`, {
        headers: { cookie: admin.cookie },
      });
      check('a document cannot be fetched through another request id', wrongRequest.status === 404, `status ${wrongRequest.status}`);
    }

    console.log('\n5. Approval');
    const selfDecision = await applicant.patch(`/admin/badge-requests/${requestId}`, { action: 'approve' });
    check(
      'a user cannot approve their own request',
      selfDecision.status === 401 || selfDecision.status === 403,
      `status ${selfDecision.status}`
    );

    const approved = await admin.patch(`/admin/badge-requests/${requestId}`, { action: 'approve' });
    check('the administrator can approve', approved.status === 200, `status ${approved.status}`);

    const afterApprove = await applicant.get('/badge/request');
    check('the applicant is now verified', afterApprove.json?.badgeVerified === true);
    check('the request is marked approved', afterApprove.json?.request?.status === 'approved', String(afterApprove.json?.request?.status));
    check('the approval records the administrator', !!afterApprove.json?.request?.decidedBy, String(afterApprove.json?.request?.decidedBy));
    check('the approval records a date', !!afterApprove.json?.request?.decidedAt);

    const meAfter = await applicant.get('/auth/me');
    const meUser = meAfter.json?.user || meAfter.json;
    check('the session payload reports the blue tick', meUser?.badgeVerified === true, String(meUser?.badgeVerified));

    const decidedAgain = await admin.patch(`/admin/badge-requests/${requestId}`, { action: 'reject', reason: 'duplicate' });
    check('a decided request cannot be decided twice', decidedAgain.status === 409, `status ${decidedAgain.status}`);

    console.log('\n6. Notification on approval');
    const notices = await applicant.get('/notifications');
    check('the applicant has notifications', notices.status === 200 && (notices.json?.notifications || []).length >= 1);
    const approvalNotice = (notices.json?.notifications || []).find((n) => /verified/i.test(n.title || ''));
    check('an approval notification was delivered', !!approvalNotice, approvalNotice?.title);
    check('the notification is unread', Number(notices.json?.unread || 0) >= 1, String(notices.json?.unread));
    check('the notification does not leak the applicant email', !new RegExp(applicantEmail).test(notices.raw || ''));

    const read = await applicant.post('/notifications/read', {});
    check('notifications can be marked read', read.status === 200 && Number(read.json?.unread) === 0, `unread ${read.json?.unread}`);

    console.log('\n7. The tick on community posts');
    const post = await applicant.post('/community/posts', {
      body: 'Verified account posting in the RIFQ Muslim community for the automated check.',
    });
    check('the verified user can post', post.status === 201, `status ${post.status}`);
    const feed = await anon.get('/community/posts');
    const mine = (feed.json?.posts || []).find((p) => p.user_id === applicantId || p.userId === applicantId);
    check('the post is in the public feed', !!mine);
    check('the tick is attached by the server', mine?.author_verified === true, String(mine?.author_verified));

    console.log('\n8. Revoking with a recorded reason');
    const noReasonRevoke = await admin.patch(`/admin/users/${applicantId}/badge`, { verified: false });
    check('a revoke without a reason is refused', noReasonRevoke.status === 400, `status ${noReasonRevoke.status}`);

    const revoked = await admin.patch(`/admin/users/${applicantId}/badge`, {
      verified: false,
      reason: 'Supporting document could not be confirmed.',
    });
    check('the administrator can revoke with a reason', revoked.status === 200, `status ${revoked.status}`);
    check('the revoke clears the tick', revoked.json?.user?.badgeVerified === false);

    const feedAfter = await anon.get('/community/posts');
    const mineAfter = (feedAfter.json?.posts || []).find((p) => p.user_id === applicantId || p.userId === applicantId);
    check('the tick disappears from older posts', mineAfter?.author_verified === false, String(mineAfter?.author_verified));

    const revokeNotice = (await applicant.get('/notifications')).json?.notifications || [];
    check(
      'the user is told the badge was removed',
      revokeNotice.some((n) => /removed/i.test(n.title || '')),
      revokeNotice[0]?.title
    );

    const trail = await admin.get('/verifications');
    check('the badge history loads', trail.status === 200 && Array.isArray(trail.json?.decisions));
    const actions = (trail.json?.decisions || []).map((d) => d.action);
    check('the grant is in the decision history', actions.includes('grant'), actions.slice(0, 5).join(', '));
    check('the revoke is in the decision history', actions.includes('revoke'));
    const revokeRow = (trail.json?.decisions || []).find((d) => d.action === 'revoke');
    check('the revoke reason is recorded', String(revokeRow?.reason || '').includes('could not be confirmed'), String(revokeRow?.reason));

    console.log('\n9. Rejection with a reason');
    const second = await applicant.post('/badge/request', {
      fullName: 'Verify Tick',
      reason: 'Submitting again with a clearer explanation of my community role and activity.',
      avatar: `data:image/png;base64,${PNG}`,
      avatarMime: 'image/png',
    });
    check('a verified-then-revoked user can apply again', second.status === 201, `status ${second.status}`);
    const secondId = second.json?.request?.id;

    const rejected = await admin.patch(`/admin/badge-requests/${secondId}`, {
      action: 'reject',
      reason: 'Please attach a letter from your mosque.',
    });
    check('the administrator can reject with a reason', rejected.status === 200, `status ${rejected.status}`);

    const afterReject = await applicant.get('/badge/request');
    check('the request is marked rejected', afterReject.json?.request?.status === 'rejected', String(afterReject.json?.request?.status));
    check(
      'the rejection reason is visible to the applicant',
      String(afterReject.json?.request?.decisionReason || '').includes('letter from your mosque'),
      String(afterReject.json?.request?.decisionReason)
    );
    check('the applicant stays unverified', afterReject.json?.badgeVerified === false);

    const rejectNotice = (await applicant.get('/notifications')).json?.notifications || [];
    check(
      'the rejection is notified with its reason',
      rejectNotice.some((n) => /not approved/i.test(n.title || '') && /letter from your mosque/.test(n.body || '')),
      rejectNotice[0]?.title
    );

    console.log('\n10. Staff accounts are verified by role');
    const staffEmail = `verify.staff.${stamp}@example.com`;
    const staff = new Session();
    await anon.post('/auth/register', { name: 'Verify Staff', email: staffEmail, password: applicantPassword });
    const staffLogin = await staff.post('/auth/login', { email: staffEmail, password: applicantPassword });
    check('the staff test account can sign in', staffLogin.status === 200, `status ${staffLogin.status}`);
    const staffId = staffLogin.json?.user?.id;

    const promoted = await admin.patch(`/admin/users/${staffId}`, { role: 'admin' });
    check('an administrator can promote a user', promoted.status === 200, `status ${promoted.status}`);

    await admin.get('/verifications');
    const staffState = await staff.get('/badge/request');
    check('a promoted administrator carries the tick', staffState.json?.badgeVerified === true, String(staffState.json?.badgeVerified));

    const unverifyStaff = await admin.patch(`/admin/users/${staffId}/badge`, {
      verified: false,
      reason: 'attempted removal of a staff badge',
    });
    check('a staff badge cannot be removed', unverifyStaff.status === 403, `status ${unverifyStaff.status}`);

    const selfBadge = await admin.patch(`/admin/users/${(adminLogin.json?.user?.id) || 'me'}/badge`, { verified: false });
    check('an administrator cannot change their own badge', selfBadge.status === 403 || selfBadge.status === 404, `status ${selfBadge.status}`);

    console.log('\n11. Data survives a restart');
    const persisted = await admin.get(`/admin/users?q=${encodeURIComponent(applicantEmail)}`);
    const persistedUser = (persisted.json?.users || []).find((u) => u.email === applicantEmail);
    check('the account is still present after the flow', !!persistedUser);
    check('the account is stored unverified after the revoke', persistedUser?.badgeVerified === false);
  } finally {
    stop();
    /* Wait for the spawned server to release the temp files before removing them. */
    await new Promise((r) => setTimeout(r, 300));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    if (failures.length) {
      console.log(`\nServer log tail:\n${serverLog.split('\n').slice(-30).join('\n')}`);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
  console.log('Blue tick verification request system verified end to end.');
}

main().catch((err) => {
  console.error('verification could not run:', err.message);
  process.exit(1);
});

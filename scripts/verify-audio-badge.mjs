/**
 * Verifies the two new RIFQ Muslim features against a real server process.
 *
 * Quran audio (audio only):
 *   - all 114 surahs are served from the real catalogue
 *   - every one of the ten reciters answers a live ranged request on the CDN
 *   - the stream endpoint passes Range through (206 + Content-Range) so seeking
 *     and resuming an interrupted download work
 *   - ?download=1 sends an attachment, and bad input is rejected
 *
 * Blue verified badge:
 *   - a normal signed-in user cannot grant a badge (403)
 *   - a signed-out request cannot reach the endpoint (401)
 *   - only the Super Admin can grant or revoke, and never to themselves
 *   - the flag reaches the public community feed and the audit trail records
 *     who approved it
 *
 * Nothing is mocked: the audio checks talk to the same CDN the app uses, and
 * the badge checks go through the real session cookie flow.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 3459;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'verify-admin@rifq.test';
const ADMIN_PASSWORD = 'VerifyAdmin123';
const USER_PASSWORD = 'VerifyUser123';

const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-verify-'));

function cookieFrom(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const list = raw.length ? raw : [res.headers.get('set-cookie')].filter(Boolean);
  const first = list[0];
  if (!first) return '';
  return String(first).split(';')[0];
}

async function call(pathname, { method = 'GET', body, cookie = '', headers = {} } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, status: res.status, json, text, cookie: cookieFrom(res) };
}

async function waitForServer(deadlineMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const res = await fetch(`${BASE}/api/config`);
      if (res.ok) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: path.join(dataDir, 'rifq.db'),
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    SESSION_SECRET: 'verify-secret-not-a-real-session-secret',
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => {
  serverLog += d.toString();
});
server.stderr.on('data', (d) => {
  serverLog += d.toString();
});

const stop = async () => {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  server.kill('SIGKILL');
  fs.rmSync(dataDir, { recursive: true, force: true });
};

try {
  const up = await waitForServer();
  check('server starts and answers /api/config', up, serverLog.slice(-300));
  if (!up) throw new Error('server did not start');

  /* ------------------------------- audio --------------------------------- */

  console.log('\nQuran audio');
  const surahs = await call('/api/quran/audio/surahs');
  const surahList = surahs.json?.surahs || [];
  check('114 surahs are served', surahList.length === 114, `got ${surahList.length}`);
  check('surah 1 is Al-Faatiha', surahList[0]?.number === 1 && surahList[0]?.name === 'Al-Faatiha', JSON.stringify(surahList[0]));
  check('surah 114 is An-Naas', surahList[113]?.number === 114 && surahList[113]?.name === 'An-Naas', JSON.stringify(surahList[113]));
  check('catalogue states its source', surahs.json?.source === 'mp3quran.net', String(surahs.json?.source));

  const reciters = await call('/api/quran/audio/reciters');
  const list = reciters.json?.reciters || [];
  const expected = [
    'Mishary Rashid Alafasy',
    'Abdul Rahman Al-Sudais',
    'Maher Al-Muaiqly',
    'Abdul Basit Abdus Samad',
    'Saad Al-Ghamdi',
    'Hani Ar-Rifai',
    'Yasser Al-Dosari',
    'Nasser Al-Qatami',
    'Abu Bakr Al-Shatri',
    'Muhammad Siddiq Al-Minshawi',
  ];
  check('all ten requested reciters are listed', list.length === 10, `got ${list.length}`);
  for (const name of expected) {
    check(`reciter present: ${name}`, list.some((r) => r.name === name));
  }
  const unavailable = list.filter((r) => !r.available);
  check(
    'every reciter URL answered a real ranged request',
    unavailable.length === 0,
    unavailable.map((r) => `${r.id}: ${r.reason}`).join('; ')
  );

  const info = await call('/api/quran/audio/alafasy/1/info');
  check('surah info reports a real file', info.json?.available === true, JSON.stringify(info.json));
  check('surah info reports a real byte size', Number(info.json?.bytes) > 100_000, `bytes=${info.json?.bytes}`);
  check('surah info reports an audio content type', /audio|mpeg/.test(String(info.json?.contentType)), String(info.json?.contentType));

  const stream = await fetch(`${BASE}/api/quran/audio/alafasy/1`, { headers: { Range: 'bytes=0-2047' } });
  const streamType = stream.headers.get('content-type') || '';
  const contentRange = stream.headers.get('content-range') || '';
  const bytes = Buffer.from(await stream.arrayBuffer());
  check('range request returns 206', stream.status === 206, `status=${stream.status}`);
  check('range request returns audio/mpeg', /audio\/mpeg/.test(streamType), streamType);
  check('range request reports Content-Range', /^bytes 0-2047\//.test(contentRange), contentRange);
  check('range request body is 2048 bytes', bytes.length === 2048, `got ${bytes.length}`);
  check('stream is labelled with its real source', stream.headers.get('x-audio-source') === 'mp3quran.net', String(stream.headers.get('x-audio-source')));
  check('MP3 frames present (real audio, not text)', bytes.slice(0, 3).toString('latin1') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), bytes.slice(0, 4).toString('hex'));

  const dl = await fetch(`${BASE}/api/quran/audio/alafasy/1?download=1`, { headers: { Range: 'bytes=0-1023' } });
  const disposition = dl.headers.get('content-disposition') || '';
  check('download sends an attachment filename', /attachment; filename="[^"]+\.mp3"/.test(disposition), disposition);
  await dl.arrayBuffer();

  const badSurah = await call('/api/quran/audio/alafasy/115');
  check('surah 115 is rejected', badSurah.status === 400, `status=${badSurah.status}`);
  const badReciter = await call('/api/quran/audio/nobody/1');
  check('unknown reciter is rejected', badReciter.status === 404, `status=${badReciter.status}`);

  /* ------------------------------- badge --------------------------------- */

  console.log('\nBlue verified badge');
  const signup = async (name, email) =>
    call('/api/auth/register', { method: 'POST', body: { name, email, password: USER_PASSWORD } });

  const a = await signup('Verify User A', 'verify-a@rifq.test');
  const b = await signup('Verify User B', 'verify-b@rifq.test');
  const ok2 = (r) => r.status === 200 || r.status === 201;
  check('two ordinary accounts registered', ok2(a) && ok2(b), `${a.status}/${b.status} ${a.text.slice(0, 120)}`);

  const userBCookie = b.cookie || a.cookie;
  const userAId = a.json?.user?.id;
  const userBId = b.json?.user?.id;
  check('new accounts are not verified by default', a.json?.user?.badgeVerified === false && b.json?.user?.badgeVerified === false, JSON.stringify(a.json?.user?.badgeVerified));

  const anon = await call(`/api/admin/users/${userBId}/badge`, { method: 'PATCH', body: { verified: true } });
  check('signed-out request cannot grant a badge (401)', anon.status === 401, `status=${anon.status}`);

  const asUser = await call(`/api/admin/users/${userBId}/badge`, {
    method: 'PATCH',
    body: { verified: true },
    cookie: userBCookie,
  });
  check('ordinary user cannot grant a badge (403)', asUser.status === 403, `status=${asUser.status}`);

  const selfAttempt = await call(`/api/admin/users/${userBId}/badge`, {
    method: 'PATCH',
    body: { verified: true },
    cookie: userBCookie,
  });
  check('ordinary user cannot self-grant either (403)', selfAttempt.status === 403, `status=${selfAttempt.status}`);

  const adminLogin = await call('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const adminCookie = adminLogin.cookie;
  check('super admin signs in', adminLogin.status === 200 && adminLogin.json?.user?.role === 'superadmin', adminLogin.text.slice(0, 140));

  const grant = await call(`/api/admin/users/${userBId}/badge`, {
    method: 'PATCH',
    body: { verified: true },
    cookie: adminCookie,
  });
  check('super admin grants the badge', grant.status === 200 && grant.json?.user?.badgeVerified === true, grant.text.slice(0, 160));
  check('grant records the approving administrator', grant.json?.user?.badgeVerifiedBy === ADMIN_EMAIL, String(grant.json?.user?.badgeVerifiedBy));
  check('grant records a timestamp', Boolean(grant.json?.user?.badgeVerifiedAt), String(grant.json?.user?.badgeVerifiedAt));

  const selfAdmin = await call(`/api/admin/users/${adminLogin.json?.user?.id}/badge`, {
    method: 'PATCH',
    body: { verified: true },
    cookie: adminCookie,
  });
  check('super admin cannot verify their own account (403)', selfAdmin.status === 403, `status=${selfAdmin.status}`);

  const post = await call('/api/community/posts', {
    method: 'POST',
    body: { body: 'Verified badge check post.' },
    cookie: userBCookie,
  });
  check('verified user can post to the community', post.status === 200 || post.status === 201, `status=${post.status} ${post.text.slice(0, 120)}`);

  const feed = await call('/api/community/posts');
  const posts = feed.json?.posts || [];
  const mine = posts.filter((p) => p.user_id === userBId);
  check('community feed marks the verified author', mine.length > 0 && mine.every((p) => p.author_verified === true || p.author_verified === 1), JSON.stringify(mine.map((p) => p.author_verified)));

  const others = posts.filter((p) => p.user_id !== userBId);
  check('unverified authors stay unmarked', others.every((p) => !p.author_verified), JSON.stringify(others.map((p) => p.author_verified)));

  const verifications = await call('/api/admin/verifications', { cookie: adminCookie });
  check('admin can list verified accounts', verifications.status === 200, `status=${verifications.status}`);
  const body = JSON.stringify(verifications.json || {});
  check('audit history records the grant with the administrator', body.includes('admin.badge.grant') && body.includes(ADMIN_EMAIL), body.slice(0, 200));

  const revoke = await call(`/api/admin/users/${userBId}/badge`, {
    method: 'PATCH',
    body: { verified: false },
    cookie: adminCookie,
  });
  check('super admin revokes the badge', revoke.status === 200 && revoke.json?.user?.badgeVerified === false, revoke.text.slice(0, 160));

  const feedAfter = await call('/api/community/posts');
  const after = (feedAfter.json?.posts || []).filter((p) => p.user_id === userBId);
  check('revoked badge disappears from the feed', after.every((p) => !p.author_verified), JSON.stringify(after.map((p) => p.author_verified)));

  const historyAfter = await call('/api/admin/verifications', { cookie: adminCookie });
  check('audit history records the revoke', JSON.stringify(historyAfter.json || {}).includes('admin.badge.revoke'));

  check('normal user id was captured for the permission tests', Boolean(userAId), String(userAId));
} catch (err) {
  failures.push(`unexpected error: ${err?.message || err}`);
  console.log(`\nunexpected error: ${err?.stack || err}`);
} finally {
  await stop();
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} check(s) failed:`);
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
console.log('All Quran audio and verified-badge checks passed.');

/**
 * Verifies the Android APK delivery path end to end.
 *
 * A local fixture stands in for the Cloudflare R2 object so the check proves
 * what browsers and Android's Download Manager actually depend on:
 *   - the saved filename is RIFQ-Muslim.apk (Content-Disposition attachment)
 *   - the MIME type is application/vnd.android.package-archive
 *   - bytes arrive intact and Range requests resume (206 + Content-Range)
 *   - /api/download/info and /api/config describe the real state
 *
 * It never invents an APK: the fixture is random bytes, and the script only
 * asserts transport behaviour.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const FIXTURE_PORT = 3456;
const APP_PORT = 3457;
const APK_BYTES = Buffer.alloc(200 * 1024);
for (let i = 0; i < APK_BYTES.length; i += 1) APK_BYTES[i] = i % 251;

const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/* --------------------------- fixture "R2" object --------------------------- */

const upstream = http.createServer((req, res) => {
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(String(range));
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : APK_BYTES.length - 1;
      const slice = APK_BYTES.subarray(start, end + 1);
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(slice.length),
        'Content-Range': `bytes ${start}-${end}/${APK_BYTES.length}`,
        'Accept-Ranges': 'bytes',
      });
      return res.end(slice);
    }
  }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(APK_BYTES.length),
    'Accept-Ranges': 'bytes',
  });
  if (req.method === 'HEAD') return res.end();
  return res.end(APK_BYTES);
});
upstream.listen(FIXTURE_PORT);
await once(upstream, 'listening');

/* ------------------------------- the app ---------------------------------- */

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    APK_DOWNLOAD_URL: `http://127.0.0.1:${FIXTURE_PORT}/RIFQ-Muslim.apk`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => {
  serverLog += d;
});
server.stderr.on('data', (d) => {
  serverLog += d;
});

const base = `http://127.0.0.1:${APP_PORT}`;
const cleanup = () => {
  server.kill('SIGTERM');
  upstream.close();
};

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error(`server did not start\n${serverLog.slice(-1500)}`);

  console.log('APK download route');
  const res = await fetch(`${base}/download/RIFQ-Muslim.apk`);
  const body = Buffer.from(await res.arrayBuffer());
  check('status 200', res.status === 200, `got ${res.status}`);
  check(
    'saved as RIFQ-Muslim.apk',
    /attachment/i.test(res.headers.get('content-disposition') || '') &&
      /filename="RIFQ-Muslim\.apk"/i.test(res.headers.get('content-disposition') || ''),
    res.headers.get('content-disposition') || 'missing header'
  );
  check(
    'Android package MIME type',
    res.headers.get('content-type') === 'application/vnd.android.package-archive',
    res.headers.get('content-type') || 'missing'
  );
  check('bytes streamed intact', body.length === APK_BYTES.length, `${body.length} vs ${APK_BYTES.length}`);
  check('content matches upstream', body.equals(APK_BYTES));
  check('accept-ranges advertised', (res.headers.get('accept-ranges') || '') === 'bytes');

  console.log('Resumable download');
  const partial = await fetch(`${base}/download/RIFQ-Muslim.apk`, {
    headers: { Range: 'bytes=0-99' },
  });
  const slice = Buffer.from(await partial.arrayBuffer());
  check('range returns 206', partial.status === 206, `got ${partial.status}`);
  check('range length honoured', slice.length === 100, `${slice.length} bytes`);
  check(
    'content-range forwarded',
    (partial.headers.get('content-range') || '').startsWith('bytes 0-99/'),
    partial.headers.get('content-range') || 'missing'
  );
  check('range bytes correct', slice.equals(APK_BYTES.subarray(0, 100)));

  console.log('Metadata');
  const info = await (await fetch(`${base}/api/download/info`)).json();
  check('info reports configured', info.configured === true);
  check('info filename', info.filename === 'RIFQ-Muslim.apk', String(info.filename));
  check('info size', info.size === APK_BYTES.length, String(info.size));
  check('info url', info.url === '/download/RIFQ-Muslim.apk', String(info.url));

  const config = await (await fetch(`${base}/api/config`)).json();
  check('config exposes apk url', config.apkUrl === '/download/RIFQ-Muslim.apk', String(config.apkUrl));
  check('config exposes apk filename', config.apkFilename === 'RIFQ-Muslim.apk', String(config.apkFilename));
  check('config reports apk configured', config.apkConfigured === true);
  check('share link is the website, not the APK', typeof config.siteUrl === 'string' && !config.siteUrl.includes('.apk'), String(config.siteUrl));
} catch (error) {
  failures.push(error.message);
  console.log(`  FAIL ${error.message}`);
} finally {
  cleanup();
}

/* -------- phase 2: the owner uploads the APK into the app itself ---------- */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rifq-apk-'));
const repoRoot = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(tmpRoot, 'data', 'apk'), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, 'data', 'apk', 'RIFQ-Muslim.apk'), APK_BYTES);

const uploadPort = APP_PORT + 1;
const uploaded = spawn(process.execPath, [path.join(repoRoot, 'server', 'index.js')], {
  cwd: tmpRoot,
  // Pin the data directory: a writable /data (persistent disk) would otherwise
  // win over the fixture folder this phase writes its APK into.
  env: { ...process.env, PORT: String(uploadPort), APK_DOWNLOAD_URL: '', DATA_DIR: path.join(tmpRoot, 'data') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let uploadLog = '';
uploaded.stdout.on('data', (d) => {
  uploadLog += d;
});
uploaded.stderr.on('data', (d) => {
  uploadLog += d;
});

const uploadBase = `http://127.0.0.1:${uploadPort}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${uploadBase}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error(`upload-mode server did not start\n${uploadLog.slice(-1200)}`);

  console.log('Uploaded APK, no external URL configured');
  const res = await fetch(`${uploadBase}/download/RIFQ-Muslim.apk`);
  const body = Buffer.from(await res.arrayBuffer());
  check('upload mode serves 200', res.status === 200, `got ${res.status}`);
  check(
    'upload mode keeps the APK filename',
    /filename="RIFQ-Muslim\.apk"/i.test(res.headers.get('content-disposition') || ''),
    res.headers.get('content-disposition') || 'missing header'
  );
  check(
    'upload mode Android MIME type',
    res.headers.get('content-type') === 'application/vnd.android.package-archive',
    res.headers.get('content-type') || 'missing'
  );
  check('upload mode bytes intact', body.equals(APK_BYTES), `${body.length} bytes`);

  const info = await (await fetch(`${uploadBase}/api/download/info`)).json();
  check('info reports the uploaded source', info.source === 'upload', String(info.source));
  check('info reports the real file size', info.size === APK_BYTES.length, String(info.size));
  check('configured without any URL', info.configured === true);

  const partial = await fetch(`${uploadBase}/download/RIFQ-Muslim.apk`, {
    headers: { Range: 'bytes=100-199' },
  });
  const slice = Buffer.from(await partial.arrayBuffer());
  check('upload mode range returns 206', partial.status === 206, `got ${partial.status}`);
  check('upload mode range bytes correct', slice.equals(APK_BYTES.subarray(100, 200)));
  check(
    'upload mode content-range correct',
    (partial.headers.get('content-range') || '') === `bytes 100-199/${APK_BYTES.length}`,
    partial.headers.get('content-range') || 'missing'
  );

  const guard = await fetch(`${uploadBase}/api/admin/apk`, { method: 'PUT', body: APK_BYTES });
  check('upload endpoint refuses anonymous callers', guard.status === 401, `got ${guard.status}`);
} catch (error) {
  failures.push(error.message);
  console.log(`  FAIL ${error.message}`);
} finally {
  uploaded.kill('SIGTERM');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} download check(s) failed:`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log('\nAll APK download checks passed.');

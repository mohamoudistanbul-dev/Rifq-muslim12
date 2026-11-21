/**
 * RIFQ Muslim — proves the Invite Friends section shares the real APK file.
 *
 * The section must deal in the installation file only: no QR code, no printed
 * address, a Download App button that transfers the actual bytes with progress,
 * and an Invite Friends button that hands that same file to the system share
 * sheet (WhatsApp, Telegram, Bluetooth, ...). iPhones must never be offered an
 * Android APK.
 *
 * How the file is supplied to the test:
 *   A small APK-shaped fixture is served by a throwaway HTTP server inside this
 *   script and the app server is pointed at it with APK_DOWNLOAD_URL — the same
 *   remote-proxy path production uses for the Cloudflare R2 file. Nothing is
 *   written into the repository.
 *
 * Usage: npm run verify:invite   (needs `npm run build` first — serves dist)
 * Exits non-zero if any assertion fails.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';

const repo = process.cwd();
const req = createRequire(path.join(repo, 'package.json'));
const pw = req('/opt/appjet/browser/node_modules/playwright/index.js');
const chromium = pw.chromium ?? pw.default?.chromium;

const APP_PORT = 4187;
const FIXTURE_PORT = 4191;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const APK_NAME = 'RIFQ-Muslim.apk';
const APK_MIME = 'application/vnd.android.package-archive';
const FIXTURE_BYTES = 3 * 1024 * 1024;

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

async function waitForServer(url: string, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not answer on ${url}`);
}

/** A byte-identical stand-in for the APK: real ZIP signature, real length. */
function apkFixture(): Buffer {
  const buf = Buffer.alloc(FIXTURE_BYTES);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(buf, 0); // "PK\x03\x04"
  for (let i = 4; i < buf.length; i++) buf[i] = i % 251;
  return buf;
}

async function main() {
  const apk = apkFixture();

  const fixtureServer = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': APK_MIME,
      'Content-Length': String(apk.length),
      'Accept-Ranges': 'bytes',
    });
    // Trickle the bytes so the page has time to render live progress, the way a
    // real 10.5 MB download behaves on a mobile connection.
    const part = Math.ceil(apk.length / 12);
    let sent = 0;
    const tick = () => {
      if (sent >= apk.length) {
        res.end();
        return;
      }
      res.write(apk.subarray(sent, sent + part));
      sent += part;
      setTimeout(tick, 45);
    };
    tick();
  });
  // Bind on all interfaces: the deployment preflight rejects any server in the
  // repository that listens on loopback only, and this fixture is a throwaway
  // process that lives for the length of the check.
  await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, '0.0.0.0', resolve));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(APP_PORT),
    APK_DOWNLOAD_URL: `http://127.0.0.1:${FIXTURE_PORT}/${APK_NAME}`,
  };
  const server = spawn('node', ['server/index.js'], { cwd: repo, env, stdio: 'ignore' });

  let browser: any;
  try {
    await waitForServer(`${BASE}/invite`);

    // The server really does serve an APK, under the fixed filename.
    const infoRes = await fetch(`${BASE}/api/download/info`);
    const info: any = await infoRes.json();
    check('APK source is configured on the server', info.configured === true, JSON.stringify(info));

    const apkRes = await fetch(`${BASE}/download/${APK_NAME}`);
    const disposition = String(apkRes.headers.get('content-disposition') || '');
    check('APK route answers with the file', apkRes.ok, String(apkRes.status));
    check(
      'APK route declares the Android package type',
      (apkRes.headers.get('content-type') || '') === APK_MIME,
      String(apkRes.headers.get('content-type'))
    );
    check(
      'APK route attaches RIFQ-Muslim.apk',
      /attachment/i.test(disposition) && /RIFQ-Muslim\.apk/.test(disposition),
      disposition
    );

    browser = await chromium.launch();

    /* ------------------------------ Android ------------------------------- */
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: ANDROID_UA,
      acceptDownloads: true,
    });

    // Raw string: a transpiled function would carry __name helpers that do not
    // exist inside the page and would silently break these stubs.
    await context.addInitScript({
      content: `
        window.__pct = [];
        window.__shares = [];
        const record = () => {
          const el = document.querySelector('[role="progressbar"]');
          if (!el) return;
          const v = Number(el.getAttribute('aria-valuenow'));
          if (Number.isNaN(v)) return;
          if (window.__pct[window.__pct.length - 1] !== v) window.__pct.push(v);
        };
        // document exists at init time; documentElement may not yet.
        try {
          new MutationObserver(record).observe(document, {
            subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow']
          });
        } catch (e) { /* poller below still records */ }
        setInterval(record, 40);
        try {
          Object.defineProperty(navigator, 'canShare', {
            configurable: true,
            value: function (data) { return !!(data && data.files && data.files.length); }
          });
        } catch (e) {}
        try {
          Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: function (data) {
            const files = (data && data.files) || [];
            window.__shares.push({
              title: data && data.title,
              text: data && data.text,
              files: files.map(function (f) { return { name: f.name, type: f.type, size: f.size }; })
            });
            return Promise.resolve();
            }
          });
        } catch (e) {}
      `,
    });

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e: any) => pageErrors.push(String(e)));

    await page.goto(`${BASE}/invite`, { waitUntil: 'networkidle' });
    await page.getByText('Invite Friends').first().waitFor({ timeout: 20000 });

    check('Invite Friends page renders', await page.getByText('Invite Friends').first().isVisible());

    // 1. No QR code, no address.
    check(
      'no QR image is rendered',
      (await page.locator('img[data-qr-target], [data-qr], [data-invite-qr]').count()) === 0
    );
    check('no QR canvas is rendered', (await page.locator('canvas').count()) === 0);

    const bodyText: string = await page.locator('body').innerText();
    check('no website URL is displayed', !/https?:\/\//i.test(bodyText), bodyText.match(/https?:\/\/\S+/i)?.[0] ?? '');
    check('no median share address is displayed', !/median\.co/i.test(bodyText));
    check('no QR wording remains', !/\bQR\b/i.test(bodyText));
    check('no copyable address remains', !/\bwww\./i.test(bodyText));

    // 2. The two actions.
    const inviteBtn = page.getByRole('button', { name: /^INVITE FRIENDS$/i });
    const downloadBtn = page.getByRole('button', { name: /^DOWNLOAD APP$/i });
    check('Invite Friends button present', (await inviteBtn.count()) === 1);
    check('Download App button present', (await downloadBtn.count()) === 1);
    check('no APK link is shown instead of a file action', (await page.locator('a[href$=".apk"]').count()) === 0);

    // 3. Download App transfers the real file, with progress.
    const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
    await downloadBtn.click();
    const download = await downloadPromise;

    check('download saves the file as RIFQ-Muslim.apk', download.suggestedFilename() === APK_NAME, download.suggestedFilename());
    const savedPath = await download.path();
    const savedSize = savedPath ? (await import('node:fs')).statSync(savedPath).size : 0;
    check('downloaded file contains every byte of the APK', savedSize === FIXTURE_BYTES, `${savedSize} vs ${FIXTURE_BYTES}`);

    const pct: number[] = await page.evaluate(() => (window as any).__pct);
    const live = pct.filter((v) => v > 0 && v < 100);
    check('download progress was shown', pct.length > 0, JSON.stringify(pct.slice(0, 6)));
    // Percentages only exist when the real total size is known, so live values
    // prove the file size reached the page and the bar tracks actual bytes.
    check('progress reported live percentages', live.length >= 2, JSON.stringify(pct));
    check('progress advanced past halfway', Math.max(...pct, 0) >= 50, JSON.stringify(pct.slice(-6)));

    await page.waitForTimeout(400);
    const afterDownload: string = await page.locator('body').innerText();
    check('download success message is shown', /Downloaded/i.test(afterDownload), afterDownload.slice(-160));

    // 4. Invite Friends shares the actual file.
    await inviteBtn.click();
    await page.waitForTimeout(600);
    const shares: any[] = await page.evaluate(() => (window as any).__shares);
    check('the share sheet was opened once', shares.length === 1, JSON.stringify(shares.length));
    const shared = shares[0] ?? {};
    check('exactly one file was shared', (shared.files?.length ?? 0) === 1, JSON.stringify(shared.files));
    check(
      'the shared file is RIFQ-Muslim.apk of the APK type',
      shared.files?.[0]?.name === APK_NAME && shared.files?.[0]?.type === APK_MIME,
      JSON.stringify(shared.files?.[0])
    );
    check('the shared file carries every byte of the APK', shared.files?.[0]?.size === FIXTURE_BYTES, String(shared.files?.[0]?.size));
    check(
      'the invitation message introduces the app',
      /RIFQ Muslim/.test(String(shared.text)) && /Made by Eng Mohamud Yusuf/.test(String(shared.text)),
      String(shared.text)
    );
    check('the invitation message contains no URL', !/https?:\/\//i.test(String(shared.text)), String(shared.text));

    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

    // 5. iPhones are never offered the Android file.
    const iosContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: IOS_UA,
    });
    const iosPage = await iosContext.newPage();
    await iosPage.goto(`${BASE}/invite`, { waitUntil: 'networkidle' });
    await iosPage.waitForTimeout(600);
    const iosText: string = await iosPage.locator('body').innerText();

    check('iOS: no Download App button', (await iosPage.getByRole('button', { name: /DOWNLOAD APP/i }).count()) === 0);
    check('iOS: no Invite Friends button', (await iosPage.getByRole('button', { name: /INVITE FRIENDS/i }).count()) === 0);
    check('iOS: no APK link', (await iosPage.locator('a[href$=".apk"]').count()) === 0);
    check(
      'iOS: explains that the Android file is not offered',
      /not available yet/i.test(iosText) && /App Store/i.test(iosText),
      iosText.slice(0, 200)
    );

    // 6. Nothing else was disturbed.
    for (const route of ['/', '/more', '/quran/1']) {
      const res = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      check(`${route} still serves`, (res?.status() ?? 0) === 200, String(res?.status()));
    }
  } catch (err) {
    check('verification ran to completion', false, String(err));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    fixtureServer.close();
  }

  console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all assertions passed'}`);
  process.exit(failures.length ? 1 : 0);
}

void main();

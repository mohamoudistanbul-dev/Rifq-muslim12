/**
 * RIFQ Muslim — proves the Invite Friends section sends everyone to one link.
 *
 * The Download App button, the QR code and every share action on /invite must
 * all use INVITE_URL (src/lib/inviteLink.ts). This check runs the real server
 * (so the page renders exactly as deployed) and asserts:
 *
 *   - the QR <img> is byte-for-byte the QR encoding of INVITE_URL, computed here
 *     with the same library and options, so a scan cannot open anything else
 *   - the official URL is printed under the QR
 *   - the Download App button is an anchor whose href is INVITE_URL, opening a
 *     new tab with rel=noopener (works on Android and iOS without JS)
 *   - WhatsApp, Facebook and Telegram each receive INVITE_URL in their share URL
 *   - "Copy link" copies INVITE_URL, and the native-share fallback copies it too
 *   - the APK status line (which could say "not available yet") is not shown on
 *     this page, because the button no longer depends on the APK endpoint
 *   - other routes still serve, so nothing else was disturbed
 *
 * Usage: npm run verify:invite   (needs `npm run build` first — serves dist)
 * Exits non-zero if any assertion fails.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { INVITE_URL, INVITE_QR_OPTIONS } from '../src/lib/inviteLink';

const repo = process.cwd();
const req = createRequire(join(repo, 'package.json'));
const QRCode = req('qrcode');
const pw = req('/opt/appjet/browser/node_modules/playwright/index.js');
const chromium = pw.chromium ?? pw.default?.chromium;

const PORT = 4187;
const BASE = `http://127.0.0.1:${PORT}`;

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

async function main() {
  console.log(`Invite Friends link: ${INVITE_URL}\n`);

  const server = spawn('node', ['server/index.js'], {
    cwd: repo,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  let browser: any;
  try {
    await waitForServer(`${BASE}/invite`);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

    // Record what the page asks the OS/browser to do instead of really opening it.
    await context.addInitScript(() => {
      const w = window as any;
      w.__opened = [];
      w.__copied = [];
      w.open = (u: any) => {
        w.__opened.push(String(u));
        return null;
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (s: any) => w.__copied.push(String(s)) },
      });
    });

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e: any) => pageErrors.push(String(e)));

    await page.goto(`${BASE}/invite`, { waitUntil: 'networkidle' });
    await page.waitForSelector('img[data-qr-target]', { timeout: 20000 });

    check('Invite Friends page renders', await page.getByText('Invite Friends').first().isVisible());

    // 2. The QR code encodes exactly the official URL.
    const qrSrc = await page.getAttribute('img[data-qr-target]', 'src');
    const expectedQr = await QRCode.toDataURL(INVITE_URL, INVITE_QR_OPTIONS);
    const declared = await page.getAttribute('img[data-qr-target]', 'data-qr-target');
    check('QR code declares the official URL', declared === INVITE_URL, String(declared));
    check(
      'QR image encodes exactly that URL',
      qrSrc === expectedQr,
      'rendered QR does not match QRCode(INVITE_URL)'
    );
    check('QR image is a PNG data URL', String(qrSrc).startsWith('data:image/png;base64,'));
    check(
      'official URL printed under the QR',
      (await page.getByText(INVITE_URL, { exact: true }).count()) >= 1
    );

    // 1. Download App button.
    const dl = page.locator('a[data-download-url]');
    check('Download App button present', (await dl.count()) === 1);
    const href = await dl.getAttribute('href');
    check('Download App href is the official URL', href === INVITE_URL, String(href));
    const target = await dl.getAttribute('target');
    const rel = String(await dl.getAttribute('rel'));
    check('Download App opens a new tab safely', target === '_blank' && /noopener/.test(rel), `${target} / ${rel}`);
    check('Download App keeps its label', /DOWNLOAD RIFQ MUSLIM/i.test(String(await dl.textContent())));
    check(
      'no "not available yet" status on this page',
      (await page.getByText(/not available yet/i).count()) === 0
    );

    // 3. Every invite/share action carries the same link.
    for (const label of ['WhatsApp', 'Facebook', 'Telegram']) {
      await page.getByRole('button', { name: new RegExp(label, 'i') }).first().click();
    }
    const opened: string[] = await page.evaluate(() => (window as any).__opened);
    check('three share targets opened', opened.length === 3, JSON.stringify(opened));
    check(
      'every share target carries the official URL',
      opened.every((u) => decodeURIComponent(u).includes(INVITE_URL)),
      JSON.stringify(opened)
    );

    await page.getByRole('button', { name: /Copy link/i }).first().click();
    await page.waitForTimeout(300);
    const copied: string[] = await page.evaluate(() => (window as any).__copied);
    check('Copy link copies the official URL', copied[0] === INVITE_URL, JSON.stringify(copied));

    await page.getByRole('button', { name: /More apps/i }).first().click();
    await page.waitForTimeout(400);
    const copiedAgain: string[] = await page.evaluate(() => (window as any).__copied);
    check(
      'native-share fallback copies the official URL',
      copiedAgain[copiedAgain.length - 1] === INVITE_URL,
      JSON.stringify(copiedAgain)
    );

    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

    // Everything else still serves.
    for (const route of ['/', '/more', '/quran/1']) {
      const res = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      check(`${route} still serves`, (res?.status() ?? 0) === 200, String(res?.status()));
    }
  } catch (err) {
    check('verification ran to completion', false, String(err));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }

  console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all assertions passed'}`);
  process.exit(failures.length ? 1 : 0);
}

void main();

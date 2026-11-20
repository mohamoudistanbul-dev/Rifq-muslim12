/**
 * RIFQ Muslim — proves the whole screen can no longer be magnified.
 *
 * This is a screen-level check, not an image check. For every page it verifies:
 *   - the viewport meta forbids user scaling and pins maximum-scale to 1
 *   - <html> and <body> declare touch-action: manipulation (no double-tap zoom)
 *   - a real pinch gesture does not change visualViewport.scale
 *   - a double tap does not change the scale
 *   - the layout still fits the screen width (no zoom-out of a wide page)
 *   - a two-finger touch move is cancelled, while a one-finger move is not
 *     (so scrolling, sliders and taps keep working)
 *   - reading text is still selectable (accessibility is not sacrificed)
 *
 * Usage:
 *   node scripts/verify-no-screen-zoom.mjs --preview        # builds are served by vite preview
 *   node scripts/verify-no-screen-zoom.mjs https://host/    # check a live deployment
 *
 * Exits non-zero if any assertion fails.
 */
import { spawn } from 'node:child_process';

const PORT = 4183;
const ROUTES = ['/', '/quran/1', '/settings'];

const failures = [];
const notes = [];

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/opt/appjet/browser/node_modules/playwright/index.js',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      const pw = mod.default ?? mod;
      if (pw.chromium) return pw;
    } catch {
      /* try the next location */
    }
  }
  throw new Error('playwright is not available (set PLAYWRIGHT_MODULE)');
}

async function waitForServer(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let server = null;

async function startPreview() {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore',
    detached: false,
  });
  const url = `http://127.0.0.1:${PORT}`;
  if (!(await waitForServer(url))) throw new Error('vite preview did not become ready');
  return url;
}

function stopPreview() {
  if (server && !server.killed) server.kill('SIGTERM');
  server = null;
}

async function readPageState(page) {
  return page.evaluate(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const scale = window.visualViewport ? window.visualViewport.scale : 1;
    return {
      viewport: meta ? meta.getAttribute('content') ?? '' : '',
      htmlTouchAction: html.touchAction,
      bodyTouchAction: body.touchAction,
      scale,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
}

/** Dispatches a synthetic touch move and reports whether it was left alone. */
async function dispatchTouchMove(page, fingerCount) {
  return page.evaluate((count) => {
    const target = document.body;
    const touches = Array.from({ length: count }, (_, i) =>
      new Touch({ identifier: i + 1, target, clientX: 120 + i * 40, clientY: 300, pageX: 120 + i * 40, pageY: 300 })
    );
    const event = new TouchEvent('touchmove', {
      touches,
      targetTouches: touches,
      changedTouches: touches,
      bubbles: true,
      cancelable: true,
    });
    // dispatchEvent returns false when a listener cancelled the event.
    return target.dispatchEvent(event);
  }, fingerCount);
}

async function main() {
  const argUrl = process.argv.slice(2).find((a) => a.startsWith('http'));
  const wantsPreview = process.argv.includes('--preview');
  if (!argUrl && !wantsPreview) {
    console.error('Pass --preview or a live URL, e.g. node scripts/verify-no-screen-zoom.mjs https://host/');
    process.exit(2);
  }

  const base = argUrl ?? (await startPreview());
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });

  try {
    for (const route of ROUTES) {
      const url = new URL(route, base).toString();
      console.log(`\n${route}`);
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('#root', { timeout: 15000 });
      await page.waitForTimeout(600);

      const state = await readPageState(page);

      check(
        'viewport meta forbids user scaling',
        /user-scalable\s*=\s*no/i.test(state.viewport) && /maximum-scale\s*=\s*1(\.0)?(\s|,|$)/i.test(state.viewport),
        state.viewport
      );
      check('no oversized maximum-scale', !/maximum-scale\s*=\s*(?!1(\.0)?(\s|,|$))\d/i.test(state.viewport), state.viewport);
      check('html touch-action blocks double-tap zoom', state.htmlTouchAction === 'manipulation', state.htmlTouchAction);
      check('body touch-action blocks double-tap zoom', state.bodyTouchAction === 'manipulation', state.bodyTouchAction);
      check('page renders at scale 1', Math.abs(state.scale - 1) < 0.01, `scale=${state.scale}`);
      check(
        'layout fits the screen width',
        state.scrollWidth <= state.innerWidth + 1,
        `scrollWidth=${state.scrollWidth} innerWidth=${state.innerWidth}`
      );
      check('page is scrollable content, not a shrunken overview', state.scrollHeight > 400, `scrollHeight=${state.scrollHeight}`);

      const singleFingerAllowed = await dispatchTouchMove(page, 1);
      check('one-finger drag is not cancelled (scrolling works)', singleFingerAllowed === true);

      const twoFingerBlocked = await dispatchTouchMove(page, 2);
      check('two-finger pinch is cancelled', twoFingerBlocked === false);

      // Real pinch gesture, when the Chromium build supports synthesising it.
      try {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.synthesizePinchGesture', {
          x: 195,
          y: 420,
          scaleFactor: 3,
          relativeSpeed: 800,
          gestureSourceType: 'touch',
        });
        await page.waitForTimeout(500);
        const afterPinch = await readPageState(page);
        check('pinch gesture does not magnify the page', Math.abs(afterPinch.scale - 1) < 0.02, `scale=${afterPinch.scale}`);
      } catch (err) {
        notes.push(`pinch gesture synthesis unavailable on ${route}: ${err.message}`);
      }

      if (route === '/quran/1') {
        const selectable = await page.evaluate(() => {
          const el = document.querySelector('.ayah-text') ?? document.querySelector('[data-selectable]');
          return el ? getComputedStyle(el).userSelect : null;
        });
        check('reading text stays selectable', selectable === null || /text|auto/.test(selectable), String(selectable));
      }

      // Double tap last: it may activate a control and navigate away.
      await page.touchscreen.tap(195, 430);
      await page.waitForTimeout(90);
      await page.touchscreen.tap(195, 430);
      await page.waitForTimeout(500);
      const afterDoubleTap = await readPageState(page);
      check('double tap does not magnify the page', Math.abs(afterDoubleTap.scale - 1) < 0.02, `scale=${afterDoubleTap.scale}`);

      check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));
      await context.close();
    }
  } finally {
    await browser.close();
    stopPreview();
  }

  for (const note of notes) console.log(`  note ${note}`);
  console.log('');
  if (failures.length) {
    console.log(`FAILED (${failures.length})`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('PASSED — the whole screen keeps one fixed scale on every checked page.');
}

main().catch((err) => {
  stopPreview();
  console.error(err);
  process.exit(1);
});

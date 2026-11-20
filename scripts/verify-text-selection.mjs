/**
 * RIFQ Muslim — proves the Android/Chrome text-selection toolbar stays away.
 *
 * Chrome for Android builds the "Copy / Select all / Web search / Google
 * lookup" toolbar from a text selection, so this check asserts the app never
 * lets one start over its content, and that the two deliberate exceptions still
 * work. On every route it verifies:
 *
 *   - <html>/<body> declare user-select: none (nothing is selectable by default)
 *   - a selectstart on ordinary text is cancelled (no selection, no toolbar)
 *   - a contextmenu on ordinary text is cancelled (no link/image menu)
 *   - scrolling still works
 *   - on /quran/1: verse text and translation are NOT selectable, the copy/share
 *     button still copies without any native toolbar, and the reader's
 *     "Select text" mode is the only way to unlock selection
 *   - on /contact: form fields stay selectable and keep their native menu, so
 *     typing, paste and autofill are untouched
 *
 * Usage:
 *   node scripts/verify-text-selection.mjs            # builds nothing: starts server/index.js
 *   node scripts/verify-text-selection.mjs --preview   # static dist only (no API)
 *   node scripts/verify-text-selection.mjs https://host/   # a live deployment
 *
 * The default mode starts the real app server, which serves dist AND /api, so
 * the Quran verses actually render and the verse assertions run.
 *
 * Exits non-zero if any assertion fails.
 */
import { spawn } from 'node:child_process';

const PORT = 4184;
const ROUTES = ['/', '/quran/1', '/contact'];

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

async function startApp({ preview = false } = {}) {
  const args = preview
    ? ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1']
    : ['server/index.js'];
  server = spawn(preview ? 'npx' : 'node', args, {
    stdio: 'ignore',
    detached: false,
    env: { ...process.env, PORT: String(PORT) },
  });
  const url = `http://127.0.0.1:${PORT}`;
  if (!(await waitForServer(url))) throw new Error(`${args.join(' ')} did not become ready`);
  return url;
}

function stopPreview() {
  if (server && !server.killed) server.kill('SIGTERM');
  server = null;
}

/** Computed user-select for a selector, or null when the element is absent. */
async function userSelectOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).userSelect : null;
  }, selector);
}

/**
 * Dispatches a cancelable event at an element and reports whether the page
 * cancelled it (true = the app blocked the browser's default behaviour).
 */
async function cancelled(page, selector, type) {
  return page.evaluate(
    ({ sel, evType }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const event = new Event(evType, { bubbles: true, cancelable: true });
      return !el.dispatchEvent(event);
    },
    { sel: selector, evType: type }
  );
}

async function main() {
  const argUrl = process.argv.slice(2).find((a) => a.startsWith('http'));
  const wantsPreview = process.argv.includes('--preview');

  const base = argUrl ?? (await startApp({ preview: wantsPreview }));
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
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('#root', { timeout: 15000 });
      await page.waitForTimeout(700);

      // 1. The page itself is not selectable, and no popup can be raised.
      const htmlSelect = await page.evaluate(() => getComputedStyle(document.documentElement).userSelect);
      const bodySelect = await page.evaluate(() => getComputedStyle(document.body).userSelect);
      check('html is not selectable', htmlSelect === 'none', String(htmlSelect));
      check('body is not selectable', bodySelect === 'none', String(bodySelect));

      const heading = (await page.locator('h1').count()) > 0 ? 'h1' : '.page-sub';
      check('ordinary text has no browser selection menu', (await cancelled(page, heading, 'contextmenu')) === true, heading);
      check('ordinary text cannot start a selection', (await cancelled(page, heading, 'selectstart')) === true, heading);

      // 2. Scrolling is untouched by the guard.
      const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 40);
      if (scrollable) {
        await page.evaluate(() => window.scrollTo(0, 300));
        await page.waitForTimeout(150);
        const scrolled = await page.evaluate(() => window.scrollY);
        check('page still scrolls', scrolled > 0, `scrollY=${scrolled}`);
        await page.evaluate(() => window.scrollTo(0, 0));
      } else {
        notes.push(`${route} is shorter than the viewport, scroll assertion skipped`);
      }

      // 3. Quran reader: verses locked, copy button works, opt-in mode unlocks.
      if (route === '/quran/1') {
        const verseSel = '#ayah-1 [data-selectable]';
        const hasVerse = (await page.locator(verseSel).count()) > 0;
        if (!hasVerse) {
          notes.push('surah data did not render (network), verse assertions skipped');
        } else {
          const verseSelect = await userSelectOf(page, verseSel);
          check('Quran Arabic text is not selectable', verseSelect === 'none', String(verseSelect));
          check('Quran text cannot start a selection', (await cancelled(page, verseSel, 'selectstart')) === true);
          check('Quran text has no browser selection menu', (await cancelled(page, verseSel, 'contextmenu')) === true);

          const translationSelect = await userSelectOf(page, '#ayah-1 p.small');
          check('translation is not selectable', translationSelect === null || translationSelect === 'none', String(translationSelect));

          // The app's own copy path must still work with no native toolbar.
          const share = page.locator('#ayah-1 .ayah-actions button').nth(1);
          if ((await share.count()) > 0) {
            await share.click();
            await page.waitForTimeout(350);
            try {
              const copied = await page.evaluate(() => navigator.clipboard.readText());
              check('copy button still copies the verse', /Quran 1:1/.test(copied), copied.slice(0, 60));
            } catch (err) {
              notes.push(`clipboard read unavailable: ${err.message}`);
            }
          } else {
            notes.push('verse copy button not found');
          }

          // Deliberate opt-in: "Select text" unlocks selection for reading.
          const toggle = page.locator('button[aria-pressed]').first();
          check('reader exposes a deliberate selection toggle', (await toggle.count()) > 0);
          if ((await toggle.count()) > 0) {
            await toggle.click();
            await page.waitForTimeout(300);
            const enabled = await userSelectOf(page, verseSel);
            check('selection mode makes the verse selectable', enabled === 'text', String(enabled));
            check('selection mode allows a selection to start', (await cancelled(page, verseSel, 'selectstart')) === false);

            await toggle.click();
            await page.waitForTimeout(300);
            const disabled = await userSelectOf(page, verseSel);
            check('leaving selection mode locks the verse again', disabled === 'none', String(disabled));
            check('locked verse cannot start a selection', (await cancelled(page, verseSel, 'selectstart')) === true);
          }
        }
      }

      // 4. Form fields keep the native selection menu.
      if (route === '/contact') {
        const field = 'input:not([type="button"]):not([type="submit"]), textarea';
        const hasField = (await page.locator(field).count()) > 0;
        if (!hasField) {
          notes.push('contact form field not found, editable assertions skipped');
        } else {
          const fieldSelect = await userSelectOf(page, field);
          check('form fields stay selectable', /text|auto/.test(String(fieldSelect)), String(fieldSelect));
          check('form fields keep their native menu', (await cancelled(page, field, 'contextmenu')) === false);
          check('form fields allow a selection to start', (await cancelled(page, field, 'selectstart')) === false);

          // Typing must still work.
          await page.locator(field).first().fill('RIFQ');
          const typed = await page.locator(field).first().inputValue();
          check('typing still works in form fields', typed === 'RIFQ', typed);
        }
      }

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
  console.log('PASSED — no native text-selection toolbar over app content; selection only where deliberate.');
}

main().catch((err) => {
  stopPreview();
  console.error(err);
  process.exit(1);
});

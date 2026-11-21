#!/usr/bin/env node
/**
 * Contrast regression check for the Hadith and Athan screens.
 *
 * Both screens once rendered white cards with inherited (near-white) text in
 * the dark theme: the text was present in the DOM, so a visibility assertion
 * passed while the user saw a blank white panel. This check therefore measures
 * real computed colours in a browser, in both themes, and fails when a text
 * colour does not contrast with the background it is painted on.
 *
 * Usage: node scripts/verify-contrast.mjs
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/appjet/browser/node_modules/playwright');

const PORT = Number(process.env.PORT || 4599);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME =
  process.env.CHROME_PATH || '/opt/appjet/browser-binaries/chromium-1234/chrome-linux64/chrome';

const TARGETS = {
  '/hadith': [
    '.page-title',
    '.chip',
    '.muted.small',
    '.hadith-arabic',
    '.hadith-text',
    '.hadith-grade',
    '.btn-ghost',
    '.empty',
  ],
  '/athan': [
    '.page-title',
    '.athan-title',
    '.athan-label',
    '.athan-time',
    '.athan-meta',
    '.athan-note',
    '.badge-gold',
    '.badge-soft',
    '.select',
  ],
};

const results = [];
let failures = 0;

function parseColor(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function channel(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function isLarge(fontSize, fontWeight) {
  const bold = Number(fontWeight) >= 700;
  return fontSize >= 24 || (bold && fontSize >= 18.66);
}

function record(page, theme, selector, data) {
  if (!data) return;
  const fg = parseColor(data.fg);
  const bg = parseColor(data.bg);
  if (!fg || !bg) return;
  const r = ratio(fg, bg);
  const large = isLarge(data.fontSize, data.fontWeight);
  const min = large ? 3 : 4.5;
  const ok = r >= min;
  if (!ok) failures += 1;
  results.push({ page, theme, selector, ratio: Number(r.toFixed(2)), min, ok });
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const measure = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.1) return null;

  const toColor = (value) => {
    const m = String(value).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };

  // Walk ancestors for the surface this text is actually painted on.
  // Gradient backgrounds carry their colour in background-image, not
  // background-color, so both are inspected.
  const surfaceOf = (node) => {
    let cur = node;
    while (cur) {
      const style = getComputedStyle(cur);
      const bg = toColor(style.backgroundColor);
      if (bg && bg.a >= 0.9) return bg;
      if (style.backgroundImage && style.backgroundImage !== 'none') {
        const grad = toColor(style.backgroundImage);
        if (grad) return grad;
      }
      cur = cur.parentElement;
    }
    const body = toColor(getComputedStyle(document.body).backgroundColor);
    return body && body.a >= 0.9 ? body : { r: 255, g: 255, b: 255, a: 1 };
  };

  const fg = toColor(cs.color);
  const bg = surfaceOf(el);
  return {
    fg: `rgb(${fg.r},${fg.g},${fg.b})`,
    bg: `rgb(${bg.r},${bg.g},${bg.b})`,
    fontSize: parseFloat(cs.fontSize),
    fontWeight: cs.fontWeight,
    text: (el.textContent || '').trim().slice(0, 40),
  };
};

async function main() {
  const server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  let browser;
  try {
    const up = await waitForServer(`${BASE}/`);
    if (!up) throw new Error(`server did not start on ${BASE}`);

    browser = await chromium.launch({ executablePath: CHROME });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    for (const [route, selectors] of Object.entries(TARGETS)) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.page-title', { timeout: 20000 });
      // Give the data-backed screens a moment to paint their cards.
      await page.waitForTimeout(2500);

      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
        }, theme);
        await page.waitForTimeout(150);

        for (const selector of selectors) {
          record(route, theme, selector, await page.evaluate(measure, selector));
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }

  if (!results.length) {
    console.error('CONTRAST CHECK INCONCLUSIVE: no measurable text was found.');
    process.exit(1);
  }

  const width = Math.max(...results.map((r) => r.selector.length));
  for (const r of results) {
    console.log(
      `${r.ok ? 'ok  ' : 'FAIL'} ${r.page.padEnd(8)} ${r.theme.padEnd(5)} ${r.selector.padEnd(width)} ${String(
        r.ratio
      ).padStart(6)}:1 (min ${r.min})`
    );
  }

  const themes = new Set(results.map((r) => `${r.page}:${r.theme}`));
  console.log(`\n${results.length} measurements across ${themes.size} page/theme combinations.`);
  if (failures) {
    console.error(`CONTRAST CHECK FAILED: ${failures} measurement(s) below the WCAG AA minimum.`);
    process.exit(1);
  }
  console.log('CONTRAST CHECK PASSED: all measured text meets WCAG AA in both themes.');
}

main().catch((err) => {
  console.error('CONTRAST CHECK ERROR:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Contrast regression check for the Hadith and Athan screens.
 *
 * Why this exists: both screens once painted cards with `var(--card, #fff)` —
 * a token the design system never defines — while body text inherited
 * var(--text). In dark mode that is near-white text on a white card. The text
 * was present in the DOM, so text/visibility assertions passed while the user
 * saw a blank white panel.
 *
 * How it measures: rather than reconstructing backgrounds from CSS (gradients,
 * translucent tints and backdrop-filters make that guesswork), this check
 * screenshots each text element and samples the ACTUAL painted pixels around
 * its glyphs, then compares them with the computed text colour. Pixels that
 * match the text colour are discarded so a glyph can't be mistaken for its
 * backdrop, and the least favourable remaining sample is used.
 *
 * Usage: node scripts/verify-contrast.mjs
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';

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
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function channel(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = la > lb ? la : lb;
  const lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

function isLarge(fontSize, fontWeight) {
  return fontSize >= 24 || (Number(fontWeight) >= 700 && fontSize >= 18.66);
}

/** Minimal PNG reader for 8-bit RGB/RGBA screenshots. */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType})`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          v = (v + a) & 255;
          break;
        case 2:
          v = (v + b) & 255;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 255;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 255;
          break;
        }
        default:
          throw new Error(`unsupported PNG filter ${filter}`);
      }
      cur[x] = v;
    }
  }
  return { width, height, bpp, data: out };
}

function pixelAt(img, x, y) {
  const px = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const i = py * img.width * img.bpp + px * img.bpp;
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
}

function distance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function record(page, theme, selector, data) {
  if (!data) return;
  const fg = parseColor(data.color);
  if (!fg) return;
  if (fg.a < 0.2) {
    results.push({ page, theme, selector, skipped: true, fg: data.color });
    return;
  }

  // A sample taken inside a rounded or padded element can land on a glyph
  // edge. Those are blends rather than surfaces, so they are dropped unless
  // nothing else was captured.
  const clean = data.samples.filter((s) => ratio(fg, s) > 1.6);
  const pool = clean.length ? clean : data.samples;
  let worst = null;
  let worstRatio = Infinity;
  for (const sample of pool) {
    const r = ratio(fg, sample);
    if (r < worstRatio) {
      worstRatio = r;
      worst = sample;
    }
  }
  if (!worst) return;

  const large = isLarge(data.fontSize, data.fontWeight);
  const min = large ? 3 : 4.5;
  const ok = worstRatio >= min;
  if (!ok) failures += 1;

  const rgb = (c) => `rgb(${c.r},${c.g},${c.b})`;
  results.push({
    page,
    theme,
    selector,
    ratio: Number(worstRatio.toFixed(2)),
    min,
    ok,
    fg: rgb(fg),
    bg: rgb(worst),
    text: data.text,
    chain: data.chain,
  });
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

async function sampleElement(page, selector) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return null;
  if (!(await locator.isVisible())) return null;

  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(60);
  // The sticky top bar would otherwise cover the element being sampled.
  await locator.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    if (top < 92) window.scrollBy(0, top - 96);
  });
  await page.waitForTimeout(60);

  const info = await locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const bgMatch = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const bgParts = bgMatch
      ? bgMatch[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      : [];
    const bgAlpha = bgParts.length > 3 ? bgParts[3] : 1;
    const ownBg = bgAlpha > 0.05 || (cs.backgroundImage && cs.backgroundImage !== 'none');
    const chain = [];
    let cur = el;
    while (cur && chain.length < 8) {
      const style = getComputedStyle(cur);
      const bg = style.backgroundColor;
      const img = style.backgroundImage;
      if ((bg && bg !== 'rgba(0, 0, 0, 0)') || (img && img !== 'none')) {
        chain.push(
          `${cur.tagName.toLowerCase()}${cur.className && typeof cur.className === 'string' ? '.' + cur.className.trim().split(/\s+/).join('.') : ''} bg=${bg} img=${img === 'none' ? '-' : img.slice(0, 60)}`
        );
      }
      cur = cur.parentElement;
    }
    return {
      color: cs.color,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      text: (el.textContent || '').trim().slice(0, 40),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      ownBg: Boolean(ownBg),
      chain,
    };
  });

  const { rect } = info;
  if (rect.w < 4 || rect.h < 4) return null;

  // Capture the element plus a margin. The margin matters for elements that
  // paint nothing themselves: their text sits on an ancestor's surface.
  const margin = 8;
  const vp = page.viewportSize() || { width: 390, height: 844 };
  const clip = {
    x: Math.max(0, Math.min(rect.x - margin, vp.width - 2)),
    y: Math.max(0, Math.min(rect.y - margin, vp.height - 2)),
    width: 0,
    height: 0,
  };
  clip.width = Math.max(1, Math.min(rect.w + margin * 2, vp.width - clip.x));
  clip.height = Math.max(1, Math.min(rect.h + margin * 2, vp.height - clip.y));

  const shot = await page.screenshot({ clip });
  const img = decodePng(shot);
  const w = img.width;
  const h = img.height;

  const ix = rect.x - clip.x;
  const iy = rect.y - clip.y;
  const iw = rect.w;
  const ih = rect.h;

  // Centre lines avoid rounded corners, which would otherwise sample the page
  // showing through a pill-shaped element.
  const inside = [
    [ix + iw / 2, iy + 2],
    [ix + iw / 2, iy + ih - 3],
    [ix + 2, iy + ih / 2],
    [ix + iw - 3, iy + ih / 2],
  ];
  // Just outside the box: the surface an element without its own background is
  // actually painted on. Offsets clear the 3px accent borders used on rows.
  const outside = [
    [ix + iw / 2, iy - 5],
    [ix + iw / 2, iy + ih + 5],
    [ix - 5, iy + ih / 2],
    [ix + iw + 5, iy + ih / 2],
  ];

  const inBounds = ([x, y]) => x >= 0 && y >= 0 && x <= w - 1 && y <= h - 1;
  const chosen = info.ownBg ? inside.filter(inBounds) : outside.filter(inBounds);
  const points = chosen.length ? chosen : inside.filter(inBounds);

  const samples = points.map(([x, y]) => pixelAt(img, x, y));
  return { ...info, samples };
}

async function main() {
  const server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  let browser;
  try {
    if (!(await waitForServer(`${BASE}/`))) throw new Error(`server did not start on ${BASE}`);

    browser = await chromium.launch({ executablePath: CHROME });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    for (const [route, selectors] of Object.entries(TARGETS)) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.page-title', { timeout: 20000 });
      await page.waitForTimeout(2500); // let data-backed cards paint

      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
        }, theme);
        await page.waitForTimeout(150);

        for (const selector of selectors) {
          record(route, theme, selector, await sampleElement(page, selector));
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
    if (r.skipped) {
      console.log(`skip ${r.page.padEnd(8)} ${r.theme.padEnd(5)} ${r.selector.padEnd(width)} transparent text`);
      continue;
    }
    console.log(
      `${r.ok ? 'ok  ' : 'FAIL'} ${r.page.padEnd(8)} ${r.theme.padEnd(5)} ${r.selector.padEnd(width)} ${String(
        r.ratio
      ).padStart(6)}:1 (min ${r.min})  ${r.fg} on ${r.bg}  "${r.text}"`
    );
    if (!r.ok) for (const line of r.chain || []) console.log(`       └ ${line}`);
  }

  const combos = new Set(results.map((r) => `${r.page}:${r.theme}`));
  console.log(`\n${results.length} measurements across ${combos.size} page/theme combinations.`);
  if (failures) {
    console.error(`CONTRAST CHECK FAILED: ${failures} measurement(s) below the WCAG AA minimum.`);
    process.exit(1);
  }
  console.log('CONTRAST CHECK PASSED: sampled text meets WCAG AA in both themes.');
}

main().catch((err) => {
  console.error('CONTRAST CHECK ERROR:', err.message);
  process.exit(1);
});

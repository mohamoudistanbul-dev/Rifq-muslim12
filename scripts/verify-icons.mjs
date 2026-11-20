/**
 * RIFQ Muslim icon verification.
 *
 * Proves that the shipped icon set is the uploaded artwork and not a placeholder
 * or a different design:
 *
 *  1. every required file exists at the exact pixel size Android/PWA expect;
 *  2. the "exact" variants still match public/logo-source.png pixel for pixel
 *     (within resampling error), i.e. they were generated from that file;
 *  3. the manifest, index.html, the adaptive-icon XML and the splash theme all
 *     point at those files, and the manifest's declared sizes are real;
 *  4. the transparent/opaque expectations hold (maskable + apple-touch are
 *     opaque, adaptive foreground is transparent).
 *
 * Run with: node scripts/verify-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const SRC = path.join(root, 'public/logo-source.png');
const RES = path.join(root, 'android/app/src/main/res');

let failures = 0;
const ok = (label) => console.log(`  ok   ${label}`);
const bad = (label, detail) => {
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};
const check = (label, fn) => {
  try {
    const detail = fn();
    if (detail === false) bad(label);
    else ok(label + (typeof detail === 'string' ? ` (${detail})` : ''));
  } catch (err) {
    bad(label, err && err.message ? err.message : String(err));
  }
};

const dims = (file) =>
  execFileSync('identify', ['-format', '%w %h', file], { encoding: 'utf8' }).trim();
const opaque = (file) =>
  execFileSync('identify', ['-format', '%[opaque]', file], { encoding: 'utf8' }).trim() === 'true';

/** RMSE (0..1) between two images, after bringing `file` up to the master size. */
function rmseAgainstMaster(file) {
  const up = path.join(tmpdir(), `rifq-up-${process.pid}-${path.basename(file)}`);
  execFileSync('convert', [file, '-filter', 'Lanczos', '-resize', '1254x1254!', up]);
  let metric = '';
  try {
    metric = execFileSync('compare', ['-metric', 'RMSE', up, SRC, 'null:'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    metric = String((err && err.stderr) || '');
  }
  const match = String(metric).match(/\(([\d.eE+-]+)\)/);
  return match ? Number(match[1]) : NaN;
}

console.log('\nicons from the uploaded master image');

check('master icon is the uploaded artwork (1254x1254 PNG)', () => {
  if (!existsSync(SRC)) throw new Error('public/logo-source.png is missing');
  const d = dims(SRC);
  if (d !== '1254 1254') throw new Error(`unexpected size ${d}`);
  return d.replace(' ', 'x');
});

/* ------------------------------ required sizes ----------------------------- */
const exactIcons = [
  ['public/icons/icon-1024.png', 1024],
  ['public/icons/icon-512.png', 512],
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-maskable-512.png', 512],
  ['public/icons/icon-maskable-192.png', 192],
  ['public/icons/apple-touch-icon-180.png', 180],
  ['public/icons/favicon-48.png', 48],
  ['public/icons/favicon-32.png', 32],
  ['public/icons/favicon-16.png', 16],
  ['public/favicon.png', 96],
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192],
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png', 48],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png', 72],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png', 96],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png', 144],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png', 192],
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png', 108],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png', 162],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png', 216],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png', 324],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png', 432],
  ['android/app/src/main/res/drawable-nodpi/ic_splash_logo.png', 512],
];

for (const [rel, size] of exactIcons) {
  check(`${rel} is ${size}x${size}`, () => {
    const file = path.join(root, rel);
    if (!existsSync(file)) throw new Error('missing');
    const d = dims(file);
    if (d !== `${size} ${size}`) throw new Error(`got ${d}`);
    return `${size}x${size}`;
  });
}

check('public/favicon.ico exists (browsers request it by default)', () => {
  const file = path.join(root, 'public/favicon.ico');
  if (!existsSync(file)) throw new Error('missing');
  return `${Math.round(readFileSync(file).length / 1024)} KB`;
});

/* --------------------------- fidelity to the upload ------------------------ */
const fidelityTargets = [
  'public/icons/icon-1024.png',
  'public/icons/icon-512.png',
  'public/icons/icon-192.png',
  'public/icons/favicon-48.png',
  'public/icons/favicon-32.png',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-hdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-mdpi/ic_launcher.png',
];

for (const rel of fidelityTargets) {
  check(`${rel} matches the uploaded artwork`, () => {
    const score = rmseAgainstMaster(path.join(root, rel));
    if (!Number.isFinite(score)) throw new Error('could not compare images');
    if (score > 0.06) throw new Error(`differs from the master image (RMSE ${score.toFixed(3)})`);
    return `RMSE ${score.toFixed(3)}`;
  });
}

/* ------------------------------- transparency ------------------------------ */
check('maskable + apple-touch icons are opaque (no black-corner artefact)', () => {
  for (const rel of [
    'public/icons/icon-maskable-512.png',
    'public/icons/icon-maskable-192.png',
    'public/icons/apple-touch-icon-180.png',
  ]) {
    if (!opaque(path.join(root, rel))) throw new Error(`${rel} has transparent pixels`);
  }
  return 'opaque';
});

check('adaptive foreground and splash logo keep a transparent margin', () => {
  for (const rel of [
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png',
    'android/app/src/main/res/drawable-nodpi/ic_splash_logo.png',
  ]) {
    if (opaque(path.join(root, rel))) throw new Error(`${rel} should keep transparency`);
  }
  return 'transparent';
});

/* ------------------------------ manifest wiring ---------------------------- */
const manifest = JSON.parse(
  readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'),
);

check('manifest names the app and starts standalone at /', () => {
  if (manifest.short_name !== 'RIFQ Muslim') throw new Error(`short_name=${manifest.short_name}`);
  if (manifest.start_url !== '/') throw new Error(`start_url=${manifest.start_url}`);
  if (manifest.display !== 'standalone') throw new Error(`display=${manifest.display}`);
  return `${manifest.icons.length} icons`;
});

check('every manifest icon exists at its declared size', () => {
  for (const icon of manifest.icons) {
    const file = path.join(root, 'public', icon.src.replace(/^\//, ''));
    if (!existsSync(file)) throw new Error(`${icon.src} missing`);
    const [w, h] = dims(file).split(' ');
    if (`${w}x${h}` !== icon.sizes) throw new Error(`${icon.src} is ${w}x${h}, declared ${icon.sizes}`);
  }
  const maskable = manifest.icons.filter((i) => (i.purpose || '').includes('maskable'));
  if (!maskable.length) throw new Error('no maskable icon declared');
  return `${manifest.icons.length} icons, ${maskable.length} maskable`;
});

/* ------------------------------- html wiring ------------------------------- */
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const hrefs = [...html.matchAll(/<link[^>]+href="(\/[^"]+)"/g)].map((m) => m[1]);

check('index.html links the manifest and the uploaded favicon files', () => {
  const required = [
    '/manifest.webmanifest',
    '/favicon.ico',
    '/icons/favicon-32.png',
    '/icons/icon-192.png',
    '/icons/apple-touch-icon-180.png',
  ];
  for (const href of required) {
    if (!html.includes(href)) throw new Error(`${href} not linked`);
  }
  return `${hrefs.length} local links`;
});

check('every icon file index.html links actually exists', () => {
  const iconHrefs = hrefs.filter((h) => !h.startsWith('/src/') && h !== '/manifest.webmanifest');
  for (const href of iconHrefs) {
    const file = path.join(root, 'public', href.replace(/^\//, ''));
    if (!existsSync(file)) throw new Error(`${href} is linked but missing`);
  }
  return `${iconHrefs.length} files`;
});

/* ------------------------------ android wiring ----------------------------- */
check('adaptive launcher icon uses the generated bitmap foreground', () => {
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const xml = readFileSync(path.join(RES, `mipmap-anydpi-v26/${name}`), 'utf8');
    if (!xml.includes('@mipmap/ic_launcher_foreground')) throw new Error(`${name} foreground`);
    if (!xml.includes('@color/ic_launcher_background')) throw new Error(`${name} background`);
  }
  return 'mipmap foreground + colour background';
});

check('launcher background colour is defined', () => {
  const xml = readFileSync(path.join(RES, 'values/colors.xml'), 'utf8');
  if (!/<color name="ic_launcher_background">/.test(xml)) throw new Error('missing colour');
  return 'defined';
});

check('splash theme points at the uploaded artwork, old vector removed', () => {
  const theme = readFileSync(path.join(RES, 'values/themes.xml'), 'utf8');
  if (!theme.includes('@drawable/ic_splash_logo')) throw new Error('splash icon not referenced');
  if (!existsSync(path.join(RES, 'drawable-nodpi/ic_splash_logo.png'))) {
    throw new Error('splash PNG missing');
  }
  for (const stale of [
    'drawable/ic_splash_logo.xml',
    'drawable/ic_launcher_foreground.xml',
    'drawable/ic_launcher_background.xml',
  ]) {
    if (existsSync(path.join(RES, stale))) throw new Error(`${stale} still present`);
  }
  return 'drawable-nodpi/ic_splash_logo.png';
});

check('AndroidManifest declares the launcher icon and round icon', () => {
  const xml = readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  if (!xml.includes('android:icon="@mipmap/ic_launcher"')) throw new Error('icon');
  if (!xml.includes('android:roundIcon="@mipmap/ic_launcher_round"')) throw new Error('roundIcon');
  return 'declared';
});

console.log(
  failures === 0
    ? '\nPASSED — every icon comes from the uploaded image and is wired everywhere.\n'
    : `\nFAILED — ${failures} icon check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

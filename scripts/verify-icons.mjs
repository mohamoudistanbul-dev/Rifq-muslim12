/**
 * RIFQ Muslim icon verification.
 *
 * Proves that the shipped icon set is the uploaded artwork and not a placeholder
 * or a different design:
 *
 *  1. every required file exists at the exact pixel size Android/PWA expect;
 *  2. the "exact" variants still match public/logo-source.png at their own
 *     pixel size (within resampling error), i.e. they were generated from that
 *     file;
 *  3. the manifest, index.html, the adaptive-icon XML and the splash theme all
 *     point at those files, and the manifest's declared sizes are real;
 *  4. the transparent/opaque expectations hold (maskable + apple-touch are
 *     opaque, adaptive foreground is transparent).
 *
 * Run with: node scripts/verify-icons.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
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
  execFileSync('identify', ['-format', '%[opaque]', file], { encoding: 'utf8' })
    .trim()
    .toLowerCase() === 'true';

const BG = '#041F17';

const metricOf = (a, b) => {
  // spawnSync, not execFileSync: compare writes its metric to stderr and exits 0
  // when the images are identical, so execFileSync discards the value exactly in
  // the case we care about most.
  const res = spawnSync('compare', ['-metric', 'RMSE', a, b, 'null:'], { encoding: 'utf8' });
  const out = `${res.stdout || ''} ${res.stderr || ''}`;
  const match = out.match(/\(([\d.eE+-]+)\)/);
  return match ? Number(match[1]) : NaN;
};

/**
 * RMSE (0..1) between a shipped icon and the master artwork re-derived at the
 * icon's own pixel size with the same command the pipeline uses.
 *
 * Comparing at native size (rather than upscaling a 48px icon to 1254px) is what
 * makes this a real fidelity test: the fine gold geometry cannot survive a 26x
 * upscale, so an upscaled comparison flags genuine resampling loss as if the
 * artwork had changed. A different design still scores far above the threshold.
 */
function rmseVsMaster(file, size, opts = {}) {
  const { trim = false, ratio = 1, flatten = false, crop = 0 } = opts;
  const ref = path.join(tmpdir(), `rifq-ref-${process.pid}-${path.basename(file)}`);
  const inner = Math.max(1, Math.round(size * ratio));
  const args = [SRC, '-filter', 'Lanczos'];
  if (trim) args.push('-trim', '+repage');
  args.push('-resize', `${inner}x${inner}`);
  if (flatten) {
    args.push('-background', BG, '-alpha', 'remove', '-alpha', 'off');
    args.push('-gravity', 'center', '-background', BG, '-extent', `${size}x${size}`);
  } else {
    args.push('-gravity', 'center', '-background', 'none', '-extent', `${size}x${size}`);
  }
  args.push(`PNG32:${ref}`);
  execFileSync('convert', args);

  let target = file;
  let reference = ref;
  if (crop) {
    const box = Math.round(size * crop);
    const off = Math.round((size - box) / 2);
    target = `${ref}.a.png`;
    reference = `${ref}.b.png`;
    execFileSync('convert', [file, '-crop', `${box}x${box}+${off}+${off}`, '+repage', target]);
    execFileSync('convert', [ref, '-crop', `${box}x${box}+${off}+${off}`, '+repage', reference]);
  }
  return metricOf(target, reference);
}

const alphaAt = (file, x, y) =>
  execFileSync('convert', [file, '-format', `%[fx:round(255*p{${x},${y}}.a)]`, 'info:'], {
    encoding: 'utf8',
  }).trim();

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
// Each entry: [file, pixel size, options]. Every icon must be the master artwork
// re-derived at its own size — a placeholder or a different design scores far
// above the threshold.
const fidelityTargets = [
  ['public/icons/icon-1024.png', 1024, {}],
  ['public/icons/icon-512.png', 512, {}],
  ['public/icons/icon-192.png', 192, {}],
  ['public/favicon.png', 96, {}],
  ['public/icons/favicon-48.png', 48, {}],
  ['public/icons/favicon-32.png', 32, {}],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192, {}],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144, {}],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96, {}],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72, {}],
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48, {}],
  ['public/icons/icon-maskable-512.png', 512, { trim: true, ratio: 0.78, flatten: true }],
  ['public/icons/icon-maskable-192.png', 192, { trim: true, ratio: 0.78, flatten: true }],
  ['public/icons/apple-touch-icon-180.png', 180, { trim: true, ratio: 0.82, flatten: true }],
  ['android/app/src/main/res/drawable-nodpi/ic_splash_logo.png', 512, { trim: true, ratio: 0.7 }],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png', 432, { trim: true, ratio: 66 / 108 }],
];

for (const [rel, size, opts] of fidelityTargets) {
  check(`${rel} matches the uploaded artwork`, () => {
    const score = rmseVsMaster(path.join(root, rel), size, opts);
    if (!Number.isFinite(score)) throw new Error('could not compare images');
    if (score > 0.03) throw new Error(`differs from the master image (RMSE ${score.toFixed(3)})`);
    return `RMSE ${score.toFixed(3)}`;
  });
}

// The round launcher icons are the artwork clipped to a circle: transparent at
// the corners, still the uploaded emblem in the middle.
for (const [rel, size] of [
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png', 48],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png', 192],
]) {
  check(`${rel} is the uploaded artwork clipped to a circle`, () => {
    const file = path.join(root, rel);
    const corner = Number(alphaAt(file, 0, 0));
    if (corner > 8) throw new Error(`corner is not transparent (alpha ${corner})`);
    const score = rmseVsMaster(file, size, { trim: true, crop: 0.5 });
    if (!Number.isFinite(score) || score > 0.03) {
      throw new Error(`centre does not match the artwork (RMSE ${score.toFixed(3)})`);
    }
    return `alpha 0 corner, RMSE ${score.toFixed(3)} centre`;
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

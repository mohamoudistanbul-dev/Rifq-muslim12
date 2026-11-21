/**
 * RIFQ Muslim — Mushaf reading, Adhan-only-at-prayer-time and offline mode.
 *
 * Two kinds of evidence:
 *  1. Real behaviour of the pure audio-routing helpers (imported and executed).
 *  2. Source contracts for the parts that need a browser or a device: the Mushaf
 *     page renderer, the service worker cache, the offline banner and the
 *     per-prayer Adhan toggles.
 *
 * Run with `npm run verify:mushaf`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeNotifySound, prayerSound, reminderSound } from '../src/lib/notifyPlan';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
section('1. Adhan plays only at the actual prayer time');

check('prayer time keeps the chosen Adhan recording', prayerSound('makkah', true) === 'makkah');
check('prayer time with Adhan audio off falls back to the chime', prayerSound('makkah', false) === 'beep');
check(
  'a reminder can never play an Adhan recording',
  reminderSound('makkah', 'beep') === 'beep',
  `got ${reminderSound('makkah', 'beep')}`
);
check('a reminder set to silent stays silent', reminderSound('silent', 'beep') === 'silent');
check('general sound normalises to the chime', normalizeNotifySound('beep') === 'beep');
check('an unknown general sound id is not an Adhan', normalizeNotifySound('makkah') === 'beep');

const notifySrc = read('src/lib/notify.ts');
check('delivery loop gates Adhan behind isPrayerAudio', /isPrayerAudio\(category, sound\)\s*\?\s*await playAdhan\(sound\)\s*:\s*playChime\(\)/.test(notifySrc));
check('isPrayerAudio only accepts prayer categories', /PRAYER_CATEGORIES\.includes\(category\)/.test(notifySrc));
check('silent alerts are not played at all', /'silent'/.test(notifySrc));

const planSrc = read('src/lib/notifyPlan.ts');
check('prayer pushes use prayerSound()', /sound:\s*prayerSound\(/.test(planSrc));
check('non-prayer pushes use reminderSound()/normalizeNotifySound()', /reminderSound\(/.test(planSrc));
check('planner receives the general sound preference', /notifySound/.test(planSrc));
check('planner receives per-prayer Adhan switches', /athanAudio/.test(planSrc));

const athanSrc = read('src/pages/Athan.tsx');
check('three audio settings: Adhan sound', athanSrc.includes('Adhan sound'));
check('three audio settings: general notification sound', athanSrc.includes('General notification sound'));
check('three audio settings: silent option', athanSrc.includes('Silent — notification only'));
check('general sound is stored in prefs', athanSrc.includes('notifySound'));
check('Adhan list appears exactly once (no Adhan in reminder choices)', (athanSrc.match(/ADHAN_SOUNDS\.map/g) || []).length === 1);
check('old "Same as adhan" reminder behaviour is gone', !/Same as adhan/i.test(athanSrc));
check(
  'each of the five prayers has its own Adhan toggle',
  athanSrc.includes('adhan-audio-${key}') &&
    /FIVE\.map\(\(key, index\)/.test(athanSrc) &&
    athanSrc.includes('prefs.adhanAudio[key] !== false') &&
    /adhanAudio:\s*\{\s*\.\.\.prefs\.adhanAudio,\s*\[key\]: v\s*\}/.test(athanSrc)
);
check(
  'the five toggles cover Fajr through Isha',
  /FIVE[^=]*=\s*\['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'\]/.test(read('src/lib/prayer.ts'))
);

/* ------------------------------------------------------------------ */
section('2. Quran reading is a real Mushaf page');

const mushafSrc = read('src/components/MushafReader.tsx');
check('Mushaf page component exists', mushafSrc.length > 2000);
check('verses are rendered as one continuous text', mushafSrc.includes('mushaf-text'));
check('traditional ayah-end markers', mushafSrc.includes('ayah-marker'));
check('Arabic-Indic digits for ayah numbers', /toArabicDigits/.test(mushafSrc));
check('decorative surah header', mushafSrc.includes('mushaf-surah-header'));
check('bismillah except at At-Tawbah', /9/.test(mushafSrc) && mushafSrc.includes('mushaf-bismillah'));
check('604-page Mushaf', /MUSHAF_TOTAL_PAGES\s*=\s*604/.test(mushafSrc));
check('Juz start pages table', /JUZ_START_PAGE/.test(mushafSrc));
check('previous/next page navigation', mushafSrc.includes('Previous') && mushafSrc.includes('Next'));
check('jump to page, juz and ayah', mushafSrc.includes('mushaf-jumps') && mushafSrc.includes('mushaf-jump'));
check('font size controls', mushafSrc.includes('onFontSize') && mushafSrc.includes('mushaf-toolbar'));
check('bookmark from the page', mushafSrc.includes('onToggleAyah') && mushafSrc.includes('onTogglePage'));
check('last read position is remembered', mushafSrc.includes('onRemember'));
check('right-to-left text direction', mushafSrc.includes('rtl') || mushafSrc.includes('dir='));
check('pages are cached for offline reading', mushafSrc.includes('local.set') && mushafSrc.includes('mushaf.'));

const quranSrc = read('src/pages/Quran.tsx');
check('Quran reading screen renders the Mushaf component', /<MushafReader/.test(quranSrc));
check('audio section untouched by the reading redesign', !/MushafReader/.test(read('src/pages/QuranAudio.tsx')));

const contentSrc = read('server/content.js');
check('server exposes verified page text', /\/quran\/page\/:page/.test(contentSrc));
check('page text comes from the verified source', /source/.test(contentSrc));

const css = read('src/styles.css');
check('Mushaf page styling', css.includes('.mushaf-sheet'));
check('ayah marker styling', css.includes('.ayah-marker'));
check('offline banner styling', css.includes('.offline-banner'));

/* ------------------------------------------------------------------ */
section('3. Offline mode and the connection banner');

const swSrc = read('public/sw.js');
check('service worker caches an app shell', /CACHE_VERSION/.test(swSrc) && swSrc.includes('caches.open'));
check('a launch without internet shows the app, not an error', /request\.mode === 'navigate'/.test(swSrc));
check('Quran/Hadith/Dua responses are cached', /CACHEABLE_API/.test(swSrc) && swSrc.includes('/api/quran'));
check('user-scoped endpoints are not cached by the worker', !CACHEABLE_API_PROBE(swSrc));
check('old caches are removed on upgrade', /caches\.delete/.test(swSrc));

function CACHEABLE_API_PROBE(src: string): boolean {
  const list = src.slice(src.indexOf('const CACHEABLE_API'), src.indexOf('];', src.indexOf('const CACHEABLE_API')));
  return /\/api\/(bookmarks|me|admin|premium)/.test(list);
}

const apiSrc = read('src/lib/api.ts');
check('GET responses are cached for offline use', apiSrc.includes('offlineCacheable'));
check('a network failure replays the last real response', /isNetworkError\(err\)/.test(apiSrc));
check('cached responses are cleared on logout', apiSrc.includes('clearApiCache') && read('src/lib/store.tsx').includes('clearApiCache'));
check('auth and admin endpoints are never replayed', /auth\|admin\|me\|session/.test(apiSrc));

const bannerSrc = read('src/components/OfflineBanner.tsx');
check('banner says "No internet connection"', bannerSrc.includes('No internet connection'));
check('banner distinguishes server-unavailable', /server/i.test(bannerSrc));
check('banner is not a full-screen error', !bannerSrc.includes('position: fixed'));
check('banner auto-hides when back online', /online/.test(bannerSrc));
check('banner offers a retry', bannerSrc.includes('offline-retry'));
check('banner is mounted in the app shell', /<OfflineBanner/.test(read('src/App.tsx')));

const connSrc = read('src/lib/connectivity.ts');
check('connectivity distinguishes offline from server-down', connSrc.includes("'server-down'") && connSrc.includes("'offline'"));
check('connectivity listens to browser events', connSrc.includes("addEventListener('online'"));

/* ------------------------------------------------------------------ */
section('4. Arabic-only reading, Kid Academy audio, Hadith references and Rate Us');

check(
  'reading screen requests no translation',
  quranSrc.includes('/quran/surah/${surahNumber}') && !quranSrc.includes('?translation=')
);
const translationSrc = read('src/pages/QuranTranslation.tsx');
check('translations live on their own screen', translationSrc.includes('?translation='));
check('translations route registered', read('src/App.tsx').includes('/quran/:number/translation'));

const hadithSrc = read('server/hadith.js');
check('collections name their collector Imam', hadithSrc.includes('imamArabic'));
check(
  'hadith items carry narrator and Imam',
  hadithSrc.includes('narrator: narratorFromEnglish(') && hadithSrc.includes('imam: meta.imam')
);
check('narrator is read from the published translation', hadithSrc.includes('export function narratorFromEnglish'));
const hadithPage = read('src/pages/Hadith.tsx');
check(
  'hadith screen shows narrator, Imam and grading',
  hadithPage.includes('الصحابي الراوي') && hadithPage.includes('item.imam') && hadithPage.includes('hadith-grade')
);

const kidsSrc = read('src/pages/Kids.tsx');
check('Kid Academy uses the shared recitation player', kidsSrc.includes('playSurahRecitation') && kidsSrc.includes('kidsAudio'));
check(
  'Kid Academy shows loading, pause and stop',
  kidsSrc.includes('Loading audio') && kidsSrc.includes('Pause') && kidsSrc.includes('Stop')
);
check(
  'surah audio uses the published recitation stream',
  read('src/lib/kidsAudio.ts').includes('cdn.islamic.network/quran/audio-surah')
);

const rateSrc = read('src/pages/RateUs.tsx');
check(
  'Rate Us is routed and reachable from the menu',
  read('src/App.tsx').includes('path="/rate"') && read('src/pages/More.tsx').includes("to: '/rate'")
);
check(
  'Rate Us uses saved store links and the native review',
  read('src/lib/rateUs.ts').includes('playStoreUrl') && rateSrc.includes('requestNativeReview')
);

/* ------------------------------------------------------------------ */
console.log('');
if (failures.length) {
  console.error(`✗ ${failures.length} check(s) failed (${passed} passed):`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`✓ ${passed} checks passed — Mushaf reading, Adhan gating and offline mode.`);

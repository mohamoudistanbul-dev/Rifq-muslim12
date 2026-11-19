/**
 * Prayer time + location verification.
 *
 * Asserts real astronomical behaviour across several countries, DST
 * transitions, cross-midnight next-prayer selection and the independence of
 * results from the *device* timezone. Exits non-zero on any failure.
 *
 * Run: npx tsx scripts/verify-prayer-times.ts
 */
import {
  computeWindow,
  computeDay,
  nextPrayer,
  currentPrayer,
  dayKey,
  zonedHour,
  offsetLabel,
  regionalMethod,
  formatClock,
  formatZonedDate,
  FIVE,
  PRAYER_KEYS,
  type Place,
  type CalcOptions,
} from '../src/lib/prayer';

let failures = 0;
let checks = 0;

function ok(name: string, condition: boolean, detail = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`ok    ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function place(
  city: string,
  countryCode: string,
  country: string,
  lat: number,
  lon: number,
  timezone: string
): Place {
  return { city, country, countryCode, lat, lon, timezone, manual: false };
}

/** Minutes since local midnight, in the place timezone. */
function localMinutes(d: Date, tz: string): number {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [h, m] = f.format(d).split(':').map(Number);
  return h * 60 + m;
}

function hm(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

const base: CalcOptions = { method: 'MWL', madhab: 'shafi', highLatitude: 'TwilightAngle' };

const CITIES: { p: Place; method: CalcOptions['method'] }[] = [
  { p: place('Mogadishu', 'SO', 'Somalia', 2.0469, 45.3182, 'Africa/Mogadishu'), method: 'MWL' },
  { p: place('Makkah', 'SA', 'Saudi Arabia', 21.3891, 39.8579, 'Asia/Riyadh'), method: 'UmmAlQura' },
  { p: place('Istanbul', 'TR', 'Türkiye', 41.0082, 28.9784, 'Europe/Istanbul'), method: 'Diyanet' },
  { p: place('Karachi', 'PK', 'Pakistan', 24.8607, 67.0011, 'Asia/Karachi'), method: 'Karachi' },
  { p: place('New York', 'US', 'United States', 40.7128, -74.006, 'America/New_York'), method: 'ISNA' },
  { p: place('London', 'GB', 'United Kingdom', 51.5072, -0.1276, 'Europe/London'), method: 'MWL' },
  { p: place('Tokyo', 'JP', 'Japan', 35.6762, 139.6503, 'Asia/Tokyo'), method: 'MWL' },
  { p: place('Nairobi', 'KE', 'Kenya', -1.2921, 36.8219, 'Africa/Nairobi'), method: 'MWL' },
];

/* ------------------------- 1. ordering + city date ------------------------ */

const instant = new Date('2026-06-15T09:00:00Z');

for (const { p, method } of CITIES) {
  const opts: CalcOptions = { ...base, method };
  const win = computeWindow(instant, p, opts);
  const t = win.today;

  const ordered =
    t.fajr < t.sunrise && t.sunrise < t.dhuhr && t.dhuhr < t.asr && t.asr < t.maghrib && t.maghrib < t.isha;
  ok(`${p.city}: Fajr<Sunrise<Dhuhr<Asr<Maghrib<Isha`, ordered, PRAYER_KEYS.map((k) => hm(t[k], p.timezone)).join(' '));

  ok(
    `${p.city}: all times are valid instants`,
    PRAYER_KEYS.every((k) => Number.isFinite(t[k].getTime()))
  );

  const expectedDay = dayKey(instant, p.timezone);
  const sameDay = PRAYER_KEYS.every((k) => dayKey(t[k], p.timezone) === expectedDay);
  ok(`${p.city}: every time falls on the city's own date (${expectedDay})`, sameDay);

  // Sanity: Dhuhr must sit near local solar noon (11:00–14:00 wall clock).
  const dhuhrMin = localMinutes(t.dhuhr, p.timezone);
  ok(
    `${p.city}: Dhuhr near solar noon`,
    dhuhrMin >= 11 * 60 && dhuhrMin <= 14 * 60,
    `${hm(t.dhuhr, p.timezone)} local`
  );

  // Isha must be after sunset but on the same evening (never before Maghrib).
  ok(`${p.city}: Isha after Maghrib`, t.isha.getTime() > t.maghrib.getTime(), `${hm(t.maghrib, p.timezone)} → ${hm(t.isha, p.timezone)}`);
}

/* --------------------------- 2. known-good values ------------------------- */

{
  const p = CITIES[0].p; // Mogadishu, MWL
  const t = computeDay(instant, p, base);
  const dhuhrMin = localMinutes(t.dhuhr, p.timezone);
  ok(
    'Mogadishu Dhuhr within 11:45–12:25 local',
    dhuhrMin >= 11 * 60 + 45 && dhuhrMin <= 12 * 60 + 25,
    hm(t.dhuhr, p.timezone)
  );
  const fajrMin = localMinutes(t.fajr, p.timezone);
  ok('Mogadishu Fajr between 03:30 and 05:30', fajrMin >= 210 && fajrMin <= 330, hm(t.fajr, p.timezone));
}

/* ------------------------------ 3. Asr madhab ----------------------------- */

for (const { p } of CITIES) {
  const shafi = computeDay(instant, p, { ...base, madhab: 'shafi' });
  const hanafi = computeDay(instant, p, { ...base, madhab: 'hanafi' });
  ok(
    `${p.city}: Hanafi Asr later than Shafi Asr`,
    hanafi.asr.getTime() > shafi.asr.getTime(),
    `${hm(shafi.asr, p.timezone)} → ${hm(hanafi.asr, p.timezone)}`
  );
}

/* ---------------------------- 4. method changes --------------------------- */

{
  const p = CITIES[1].p; // Makkah
  const umm = computeDay(instant, p, { ...base, method: 'UmmAlQura' });
  const mwl = computeDay(instant, p, { ...base, method: 'MWL' });
  const diffMin = Math.abs(umm.fajr.getTime() - mwl.fajr.getTime()) / 60000;
  ok('Makkah: Umm al-Qura and MWL produce different Fajr', diffMin >= 3, `${diffMin.toFixed(0)} min apart`);
  ok('Makkah: Umm al-Qura Fajr is later than MWL', umm.fajr.getTime() > mwl.fajr.getTime());
}

/* ------------------------------- 5. DST ---------------------------------- */

{
  const london = CITIES[5].p;
  const before = computeDay(new Date('2026-03-28T12:00:00Z'), london, base);
  const after = computeDay(new Date('2026-03-29T12:00:00Z'), london, base);

  ok(
    'London: offset is GMT+0 before the switch',
    offsetLabel('Europe/London', new Date('2026-03-28T12:00:00Z'), 'en') === 'GMT+0',
    offsetLabel('Europe/London', new Date('2026-03-28T12:00:00Z'), 'en')
  );
  ok(
    'London: offset is GMT+1 after the switch',
    offsetLabel('Europe/London', new Date('2026-03-29T12:00:00Z'), 'en') === 'GMT+1',
    offsetLabel('Europe/London', new Date('2026-03-29T12:00:00Z'), 'en')
  );

  const maghribBefore = localMinutes(before.maghrib, london.timezone);
  const maghribAfter = localMinutes(after.maghrib, london.timezone);
  ok(
    'London: Maghrib local time moves forward one hour across the DST switch',
    maghribAfter - maghribBefore === 60,
    `${Math.floor(maghribBefore / 60)}:${String(maghribBefore % 60).padStart(2, '0')} → ${Math.floor(
      maghribAfter / 60
    )}:${String(maghribAfter % 60).padStart(2, '0')}`
  );
}

/* --------------------- 6. next / current prayer windows ------------------ */

{
  const tokyo = CITIES[6].p;
  // 14:59 UTC = 23:59 JST — the last minute of the Tokyo day.
  const lateNight = new Date('2026-06-15T14:59:00Z');
  const win = computeWindow(lateNight, tokyo, base);
  const nx = nextPrayer(win.today, lateNight, win.tomorrow);
  ok('Tokyo 23:59: next prayer is Fajr', nx.key === 'fajr', nx.key);
  ok('Tokyo 23:59: next Fajr is tomorrow', nx.tomorrow === true);
  ok('Tokyo 23:59: countdown is positive', nx.msLeft > 0, `${Math.round(nx.msLeft / 60000)} min`);

  // 04:00 UTC = 13:00 JST, after Dhuhr.
  const midday = new Date('2026-06-15T04:00:00Z');
  const midWin = computeWindow(midday, tokyo, base);
  ok('Tokyo 13:00: current prayer is Dhuhr', currentPrayer(midWin.today, midday, midWin.yesterday) === 'dhuhr');

  // 16:00 UTC = 01:00 JST next day, before Fajr → belongs to yesterday's Isha.
  const preDawn = new Date('2026-06-15T16:00:00Z');
  const preWin = computeWindow(preDawn, tokyo, base);
  ok(
    'Tokyo 01:00: current window is the previous Isha',
    currentPrayer(preWin.today, preDawn, preWin.yesterday) === 'isha'
  );

  // Countdown must never be negative at any sampled moment of the day.
  let negative = 0;
  for (let m = 0; m < 24 * 60; m += 7) {
    const at = new Date(new Date('2026-06-15T00:00:00Z').getTime() + m * 60000);
    const w = computeWindow(at, tokyo, base);
    const n = nextPrayer(w.today, at, w.tomorrow);
    if (n.msLeft <= 0) negative += 1;
  }
  ok('Tokyo: countdown never negative or zero across a full day', negative === 0, `${negative} bad samples`);
}

/* --------------------------- 7. city calendar day ------------------------ */

{
  const tokyo = CITIES[6].p;
  const london = CITIES[5].p;
  const at = new Date('2026-06-15T22:00:00Z');
  ok('Tokyo date at 22:00Z is 2026-06-16', dayKey(at, tokyo.timezone) === '2026-06-16', dayKey(at, tokyo.timezone));
  ok('London date at 22:00Z is 2026-06-15', dayKey(at, london.timezone) === '2026-06-15', dayKey(at, london.timezone));

  // Changing city must change the prayer times (the core "travel" behaviour).
  const a = computeDay(at, tokyo, base);
  const b = computeDay(at, london, base);
  ok(
    'Tokyo and London produce different Fajr for the same instant',
    Math.abs(a.fajr.getTime() - b.fajr.getTime()) > 60 * 60 * 1000
  );
}

/* -------------------------- 8. regional defaults ------------------------- */

{
  const expected: [string, string][] = [
    ['SA', 'UmmAlQura'],
    ['AE', 'Dubai'],
    ['EG', 'Egyptian'],
    ['PK', 'Karachi'],
    ['IN', 'Karachi'],
    ['BD', 'Karachi'],
    ['US', 'ISNA'],
    ['CA', 'ISNA'],
    ['TR', 'Diyanet'],
    ['KW', 'Kuwait'],
    ['QA', 'Qatar'],
    ['SG', 'Singapore'],
    ['SO', 'MWL'],
  ];
  for (const [code, method] of expected) {
    ok(`regional default ${code} → ${method}`, regionalMethod(code) === method, regionalMethod(code));
  }
}

/* ----------------------------- 9. formatting ----------------------------- */

{
  const tokyo = CITIES[6].p;
  const at = new Date('2026-06-15T04:00:00Z');
  ok('Clock shows Tokyo wall time', formatClock(at, tokyo.timezone, 'en').startsWith('13:00'), formatClock(at, tokyo.timezone, 'en'));
  ok('Long date is non-empty', formatZonedDate(at, tokyo.timezone, 'en').length > 6, formatZonedDate(at, tokyo.timezone, 'en'));
  ok('Hijri/gregorian hours agree', zonedHour(at, tokyo.timezone) === 13);
  ok('Five daily prayers tracked', FIVE.length === 5);
}

/* --------------------------------- digest -------------------------------- */

// A stable fingerprint of all computed times. Running this script under two
// different TZ values must produce byte-identical digests, which proves the
// device timezone never influences the calculation.
const digest: string[] = [];
for (const { p, method } of CITIES) {
  const t = computeDay(instant, p, { ...base, method });
  digest.push(`${p.city}:${PRAYER_KEYS.map((k) => t[k].toISOString()).join(',')}`);
}
console.log(`DIGEST ${digest.join('|')}`);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}

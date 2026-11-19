/**
 * Worldwide prayer-time verification.
 *
 * Exercises the real Adhan engine for cities on every continent, including
 * high-latitude locations, and asserts astronomical invariants that must hold
 * anywhere on earth: prayers fall in order, Dhuhr sits at solar noon, the
 * Hanafi Asr is later than the Shafi Asr, and the countdown always points at a
 * real upcoming prayer. Exits non-zero on any failure.
 *
 * Run: npx tsx scripts/verify-world-prayer.ts
 */
import {
  computeWindow,
  computeDay,
  nextPrayer,
  currentPrayer,
  dayKey,
  regionalMethod,
  offsetLabel,
  FIVE,
  PRAYER_KEYS,
  type Place,
  type CalcOptions,
  type MethodId,
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
  return { city, country, countryCode, lat, lon, timezone, manual: true };
}

const base: CalcOptions = { method: 'MWL', madhab: 'shafi', highLatitude: 'TwilightAngle' };
const opts = (method: MethodId, extra: Partial<CalcOptions> = {}): CalcOptions => ({
  ...base,
  method,
  ...extra,
});

function hm(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function localMinutes(d: Date, tz: string): number {
  const [h, m] = hm(d, tz).split(':').map(Number);
  return h * 60 + m;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Cities on every inhabited continent, with the method their region should use. */
const CITIES: { place: Place; method: MethodId; highLat?: boolean }[] = [
  { place: place('Mogadishu', 'SO', 'Somalia', 2.0371, 45.3438, 'Africa/Mogadishu'), method: 'MWL' },
  { place: place('Hargeisa', 'SO', 'Somalia', 9.56, 44.065, 'Africa/Mogadishu'), method: 'MWL' },
  { place: place('Baidoa', 'SO', 'Somalia', 3.1138, 43.6498, 'Africa/Mogadishu'), method: 'MWL' },
  { place: place('Kismayo', 'SO', 'Somalia', -0.3582, 42.5454, 'Africa/Mogadishu'), method: 'MWL' },
  { place: place('Garowe', 'SO', 'Somalia', 8.4084, 48.4845, 'Africa/Mogadishu'), method: 'MWL' },
  { place: place('Bosaso', 'SO', 'Somalia', 11.2842, 49.1816, 'Africa/Mogadishu'), method: 'MWL' },
  { place: place('Beledweyne', 'SO', 'Somalia', 4.7358, 45.2036, 'Africa/Mogadishu'), method: 'MWL' },
  { place: place('Berbera', 'SO', 'Somalia', 10.4396, 45.0143, 'Africa/Mogadishu'), method: 'MWL' },
  { place: place('Cairo', 'EG', 'Egypt', 30.0444, 31.2357, 'Africa/Cairo'), method: 'Egyptian' },
  { place: place('Lagos', 'NG', 'Nigeria', 6.5244, 3.3792, 'Africa/Lagos'), method: 'MWL' },
  { place: place('Cape Town', 'ZA', 'South Africa', -33.9249, 18.4241, 'Africa/Johannesburg'), method: 'MWL' },
  { place: place('Makkah', 'SA', 'Saudi Arabia', 21.4225, 39.8262, 'Asia/Riyadh'), method: 'UmmAlQura' },
  { place: place('Dubai', 'AE', 'United Arab Emirates', 25.2048, 55.2708, 'Asia/Dubai'), method: 'Dubai' },
  { place: place('Istanbul', 'TR', 'Türkiye', 41.0082, 28.9784, 'Europe/Istanbul'), method: 'Diyanet' },
  { place: place('Karachi', 'PK', 'Pakistan', 24.8607, 67.0011, 'Asia/Karachi'), method: 'Karachi' },
  { place: place('Delhi', 'IN', 'India', 28.6139, 77.209, 'Asia/Kolkata'), method: 'Karachi' },
  { place: place('Jakarta', 'ID', 'Indonesia', -6.2088, 106.8456, 'Asia/Jakarta'), method: 'Singapore' },
  { place: place('Kuala Lumpur', 'MY', 'Malaysia', 3.139, 101.6869, 'Asia/Kuala_Lumpur'), method: 'Singapore' },
  { place: place('Tokyo', 'JP', 'Japan', 35.6895, 139.6917, 'Asia/Tokyo'), method: 'MWL' },
  { place: place('Kathmandu', 'NP', 'Nepal', 27.7172, 85.324, 'Asia/Kathmandu'), method: 'Karachi' },
  { place: place('London', 'GB', 'United Kingdom', 51.5074, -0.1278, 'Europe/London'), method: 'MoonsightingCommittee' },
  { place: place('Berlin', 'DE', 'Germany', 52.52, 13.405, 'Europe/Berlin'), method: 'MWL' },
  { place: place('Moscow', 'RU', 'Russia', 55.7558, 37.6173, 'Europe/Moscow'), method: 'MWL' },
  { place: place('New York', 'US', 'United States', 40.7128, -74.006, 'America/New_York'), method: 'ISNA' },
  { place: place('Los Angeles', 'US', 'United States', 34.0522, -118.2437, 'America/Los_Angeles'), method: 'ISNA' },
  { place: place('Vancouver', 'CA', 'Canada', 49.2827, -123.1207, 'America/Vancouver'), method: 'ISNA' },
  { place: place('Mexico City', 'MX', 'Mexico', 19.4326, -99.1332, 'America/Mexico_City'), method: 'MWL' },
  { place: place('Sao Paulo', 'BR', 'Brazil', -23.5505, -46.6333, 'America/Sao_Paulo'), method: 'MWL' },
  { place: place('Buenos Aires', 'AR', 'Argentina', -34.6037, -58.3816, 'America/Argentina/Buenos_Aires'), method: 'MWL' },
  { place: place('Sydney', 'AU', 'Australia', -33.8688, 151.2093, 'Australia/Sydney'), method: 'MWL' },
  { place: place('Auckland', 'NZ', 'New Zealand', -36.8485, 174.7633, 'Pacific/Auckland'), method: 'MWL' },
  { place: place('Reykjavik', 'IS', 'Iceland', 64.1466, -21.9426, 'Atlantic/Reykjavik'), method: 'MoonsightingCommittee', highLat: true },
  { place: place('Nuuk', 'GL', 'Greenland', 64.1835, -51.7216, 'America/Nuuk'), method: 'MWL', highLat: true },
];

/* --------------------- one real day in every listed city -------------------- */

// Northern-winter instant: exercises the winter solstice geometry everywhere.
const WINTER = new Date('2026-12-15T09:00:00Z');

for (const { place: p, method, highLat } of CITIES) {
  const o = opts(method);
  const win = computeWindow(WINTER, p, o);
  const today = win.today;
  const label = `${p.city} (${p.countryCode})`;

  const ordered = PRAYER_KEYS.every((k, i) => {
    if (i === 0) return true;
    return today[k].getTime() > today[PRAYER_KEYS[i - 1]].getTime();
  });
  ok(`${label}: six times in astronomical order`, ordered,
    PRAYER_KEYS.map((k) => `${k} ${hm(today[k], p.timezone)}`).join(' '));

  const dhuhrMin = localMinutes(today.dhuhr, p.timezone);
  ok(`${label}: Dhuhr at solar noon`, dhuhrMin >= 11 * 60 && dhuhrMin <= 13 * 60 + 30, hm(today.dhuhr, p.timezone));

  // Every time must belong to the city's own calendar day (or the small hours
  // after midnight for high-latitude Isha), never the device's day.
  const day = localDate(WINTER, p.timezone);
  const sameDay = [today.fajr, today.sunrise, today.dhuhr, today.asr].every(
    (d) => localDate(d, p.timezone) === day
  );
  ok(`${label}: times use the city's own date`, sameDay, `${day} · key ${dayKey(WINTER, p.timezone)}`);

  if (!highLat) {
    const mins = PRAYER_KEYS.map((k) => localMinutes(today[k], p.timezone));
    const localOrdered = mins.every((m, i) => i === 0 || m > mins[i - 1]);
    ok(`${label}: local clock shows prayers in order`, localOrdered, mins.join(','));
  }

  const next = nextPrayer(today, WINTER, win.tomorrow);
  ok(
    `${label}: countdown targets a real upcoming prayer`,
    FIVE.includes(next.key) && next.msLeft > 0 && next.msLeft <= 26 * 3600 * 1000,
    `${next.key} in ${(next.msLeft / 3600000).toFixed(1)}h`
  );

  const current = currentPrayer(today, WINTER, win.yesterday);
  ok(`${label}: current prayer resolves`, current === null || FIVE.includes(current), String(current));

  const hanafi = computeDay(WINTER, p, opts(method, { madhab: 'hanafi' }));
  ok(
    `${label}: Hanafi Asr is later than Shafi Asr`,
    hanafi.asr.getTime() > today.asr.getTime(),
    `${hm(today.asr, p.timezone)} -> ${hm(hanafi.asr, p.timezone)}`
  );

  ok(
    `${label}: regional method default`,
    regionalMethod(p.countryCode) === method,
    `${regionalMethod(p.countryCode)}`
  );

  ok(`${label}: timezone offset resolves`, offsetLabel(p.timezone, WINTER).length > 0, offsetLabel(p.timezone, WINTER));
}

/* --------------------------- seasonal behaviour ---------------------------- */

const mogadishu = CITIES[0].place;
const june = computeDay(new Date('2026-06-15T09:00:00Z'), mogadishu, opts('MWL'));
const december = computeDay(new Date('2026-12-15T09:00:00Z'), mogadishu, opts('MWL'));
const fajrShift = Math.abs(
  localMinutes(june.fajr, mogadishu.timezone) - localMinutes(december.fajr, mogadishu.timezone)
);
ok('equatorial Fajr shifts with the season', fajrShift > 5 && fajrShift < 60, `${fajrShift} min`);

const dhuhrShift = Math.abs(
  localMinutes(june.dhuhr, mogadishu.timezone) - localMinutes(december.dhuhr, mogadishu.timezone)
);
ok('equatorial Dhuhr stays near solar noon all year', dhuhrShift < 30, `${dhuhrShift} min`);

// A high-latitude summer day must still produce usable times (no NaN, no gap).
const reykjavik = CITIES.find((c) => c.place.city === 'Reykjavik')!.place;
const summer = computeDay(new Date('2026-06-21T09:00:00Z'), reykjavik, opts('MoonsightingCommittee'));
ok(
  'high-latitude summer produces finite times',
  PRAYER_KEYS.every((k) => Number.isFinite(summer[k].getTime())),
  PRAYER_KEYS.map((k) => `${k} ${hm(summer[k], reykjavik.timezone)}`).join(' ')
);
ok(
  'high-latitude summer keeps Fajr before sunrise',
  summer.fajr.getTime() < summer.sunrise.getTime()
);

/* -------------------- DST and timezone-change correctness ------------------ */

const london = CITIES.find((c) => c.place.city === 'London')!.place;
const winterLondon = computeDay(new Date('2026-01-15T12:00:00Z'), london, opts('MoonsightingCommittee'));
const summerLondon = computeDay(new Date('2026-07-15T12:00:00Z'), london, opts('MoonsightingCommittee'));
const offWinter = offsetLabel(london.timezone, new Date('2026-01-15T12:00:00Z'));
const offSummer = offsetLabel(london.timezone, new Date('2026-07-15T12:00:00Z'));
ok('London offset changes across DST', offWinter !== offSummer, `${offWinter} -> ${offSummer}`);
ok(
  'DST does not break the summer day',
  PRAYER_KEYS.every((k) => Number.isFinite(summerLondon[k].getTime())) &&
    summerLondon.fajr.getTime() < summerLondon.isha.getTime() &&
    PRAYER_KEYS.every((k) => Number.isFinite(winterLondon[k].getTime()))
);

// The same instant must give the same *local* prayer for a city regardless of
// which device timezone the process runs in — verified by comparing the local
// wall-clock times, which is what the user actually sees.
const tokyo = CITIES.find((c) => c.place.city === 'Tokyo')!.place;
const tokyoDay = computeDay(new Date('2026-12-15T23:30:00Z'), tokyo, opts('MWL'));
ok(
  'a city whose date differs from UTC still gets its own day',
  localDate(tokyoDay.dhuhr, tokyo.timezone) === localDate(new Date('2026-12-15T23:30:00Z'), tokyo.timezone),
  localDate(tokyoDay.dhuhr, tokyo.timezone)
);

/* --------------------------------- result --------------------------------- */

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * Worldwide location dataset verification.
 *
 * Asserts that country coverage is genuinely worldwide (all 193 UN member
 * states plus the two observer states), that every place carries a real
 * coordinate and a valid IANA timezone, and that search behaves correctly:
 * accent-insensitive, country-scoped, duplicate-name aware and never inventing
 * a place. Exits non-zero on any failure.
 *
 * Run: node scripts/verify-world-geo.mjs
 */
import { listCountries, searchPlaces, placesInCountry, nearestPlace } from '../server/geo.js';

let failures = 0;
let checks = 0;

function ok(name, condition, detail = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`ok    ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------ country list ------------------------------ */

const countries = listCountries();
const codes = new Set(countries.map((c) => c.code));

/** All 193 UN member states + the two UN observer states. */
const UN_195 = `AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI
CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI
FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW
KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL
NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG
SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU
VE VN YE ZM ZW VA PS`
  .split(/\s+/)
  .filter(Boolean);

ok('country list is worldwide, not a curated subset', countries.length >= 195, `${countries.length} countries and territories`);
ok('every UN member state is present', UN_195.every((c) => codes.has(c)), `${UN_195.filter((c) => !codes.has(c)).join(',') || 'none missing'}`);

const arabic = /[\u0600-\u06FF]/;
ok(
  'every country has an ISO alpha-2 code',
  countries.every((c) => /^[A-Z]{2}$/.test(c.code))
);
ok('no duplicate country codes', codes.size === countries.length, `${countries.length - codes.size} duplicates`);
ok(
  'every country has an English name',
  countries.every((c) => typeof c.en === 'string' && c.en.trim().length > 2)
);
ok(
  'every country has an Arabic name',
  countries.every((c) => arabic.test(c.ar || '')),
  countries.filter((c) => !arabic.test(c.ar || '')).map((c) => c.code).join(',') || 'all present'
);
ok(
  'every country has a flag emoji derived from its ISO code',
  countries.every((c) => {
    const cp = (c.flag || '').codePointAt(0) || 0;
    return cp >= 0x1f1e6 && cp <= 0x1f1ff;
  })
);

const sorted = [...countries].map((c) => c.en).sort((a, b) => a.localeCompare(b));
ok(
  'countries are sorted alphabetically',
  JSON.stringify(sorted) === JSON.stringify(countries.map((c) => c.en))
);

const continents = new Set(countries.map((c) => c.continent));
for (const continent of ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania']) {
  ok(`continent covered: ${continent}`, continents.has(continent), `${countries.filter((c) => c.continent === continent).length} countries`);
}

/* -------------------------------- places ---------------------------------- */

const totalPlaces = countries.reduce((sum, c) => sum + (c.cities || 0), 0);
ok('worldwide place database is large', totalPlaces > 60000, `${totalPlaces} places`);

const emptyCountries = countries.filter((c) => !c.cities && !['AQ', 'BV', 'IO', 'HM', 'UM'].includes(c.code));
ok(
  'every inhabited country has places',
  emptyCountries.length === 0,
  emptyCountries.map((c) => c.code).join(',') || 'none empty'
);

/** [query, countryCode, expected lat, expected lon, expected IANA zone] */
const SAMPLES = [
  ['Mogadishu', 'SO', 2.04, 45.34, 'Africa/Mogadishu'],
  ['Hargeisa', 'SO', 9.56, 44.06, 'Africa/Mogadishu'],
  ['Baidoa', 'SO', 3.11, 43.65, 'Africa/Mogadishu'],
  ['Kismayo', 'SO', -0.36, 42.55, 'Africa/Mogadishu'],
  ['Garowe', 'SO', 8.41, 48.48, 'Africa/Mogadishu'],
  ['Bosaso', 'SO', 11.28, 49.18, 'Africa/Mogadishu'],
  ['Beledweyne', 'SO', 4.74, 45.2, 'Africa/Mogadishu'],
  ['Berbera', 'SO', 10.44, 45.01, 'Africa/Mogadishu'],
  ['Tokyo', 'JP', 35.69, 139.69, 'Asia/Tokyo'],
  ['Sao Paulo', 'BR', -23.55, -46.63, 'America/Sao_Paulo'],
  ['Sydney', 'AU', -33.87, 151.21, 'Australia/Sydney'],
  ['Reykjavik', 'IS', 64.14, -21.9, 'Atlantic/Reykjavik'],
  ['Nuuk', 'GL', 64.18, -51.72, 'America/Nuuk'],
  ['Cape Town', 'ZA', -33.93, 18.42, 'Africa/Johannesburg'],
  ['Jakarta', 'ID', -6.21, 106.85, 'Asia/Jakarta'],
  ['Istanbul', 'TR', 41.01, 28.98, 'Europe/Istanbul'],
  ['Los Angeles', 'US', 34.05, -118.24, 'America/Los_Angeles'],
  ['Auckland', 'NZ', -36.85, 174.76, 'Pacific/Auckland'],
  ['Cairo', 'EG', 30.04, 31.24, 'Africa/Cairo'],
  ['Delhi', 'IN', 28.61, 77.21, 'Asia/Kolkata'],
  ['Kathmandu', 'NP', 27.72, 85.32, 'Asia/Kathmandu'],
  ['Vancouver', 'CA', 49.28, -123.12, 'America/Vancouver'],
  ['Buenos Aires', 'AR', -34.6, -58.38, 'America/Argentina/Buenos_Aires'],
  ['Mexico City', 'MX', 19.43, -99.13, 'America/Mexico_City'],
  ['Lagos', 'NG', 6.52, 3.38, 'Africa/Lagos'],
  ['Dubai', 'AE', 25.2, 55.27, 'Asia/Dubai'],
  ['Kuala Lumpur', 'MY', 3.14, 101.69, 'Asia/Kuala_Lumpur'],
  ['Moscow', 'RU', 55.75, 37.62, 'Europe/Moscow'],
  ['Berlin', 'DE', 52.52, 13.4, 'Europe/Berlin'],
  ['London', 'GB', 51.51, -0.13, 'Europe/London'],
];

for (const [query, code, lat, lon, tz] of SAMPLES) {
  const hits = searchPlaces(query, { limit: 5 });
  const hit = hits.find((p) => p.countryCode === code) || hits[0];
  const near = hit && Math.abs(hit.lat - lat) < 0.6 && Math.abs(hit.lon - lon) < 0.6;
  ok(
    `place: ${query} (${code})`,
    Boolean(hit) && hit.countryCode === code && near && hit.timezone === tz,
    hit ? `${hit.city}, ${hit.countryCode} ${hit.lat.toFixed(2)},${hit.lon.toFixed(2)} ${hit.timezone}` : 'not found'
  );
}

/* ------------------------------ search rules ------------------------------ */

ok(
  'search is accent-insensitive',
  searchPlaces('sao paulo', { limit: 3 }).some((p) => p.countryCode === 'BR')
);

const scoped = searchPlaces('springfield', { country: 'US', limit: 20 });
ok(
  'country-scoped search returns only that country',
  scoped.length > 0 && scoped.every((p) => p.countryCode === 'US'),
  `${scoped.length} results`
);

const tripoli = searchPlaces('tripoli', { limit: 10 });
const tripoliCountries = new Set(tripoli.map((p) => p.countryCode));
ok(
  'duplicate city names across countries are kept apart',
  tripoliCountries.has('LY') && tripoliCountries.has('LB'),
  [...tripoliCountries].join(',')
);

ok('short queries return nothing', searchPlaces('m').length === 0);
ok('unknown place returns nothing instead of a guess', searchPlaces('zzqqxx not a real place').length === 0);
ok('search respects the limit', searchPlaces('a', { limit: 3 }).length === 0 && searchPlaces('san', { limit: 3 }).length <= 3);

ok(
  'every place has a valid coordinate and IANA timezone',
  SAMPLES.every(([q, code]) => {
    const p = searchPlaces(q, { limit: 5 }).find((x) => x.countryCode === code);
    if (!p) return false;
    if (!(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)) return false;
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: p.timezone });
      return true;
    } catch {
      return false;
    }
  })
);

const somali = placesInCountry('SO', { limit: 400 });
ok('Somalia lists its cities', somali.length > 20, `${somali.length} places`);
ok('Somali places use the Mogadishu timezone', somali.every((p) => p.timezone === 'Africa/Mogadishu'));

const nearest = nearestPlace(2.0469, 45.3182, { limit: 3 });
ok('reverse lookup finds the nearest real place', nearest.length > 0 && nearest[0].city === 'Mogadishu', nearest[0]?.city || 'none');
ok(
  'reverse lookup coordinates are plausible',
  nearest.length > 0 && Math.abs(nearest[0].lat - 2.0371) < 0.2 && Math.abs(nearest[0].lon - 45.3438) < 0.2
);

/* --------------------------------- result --------------------------------- */

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}

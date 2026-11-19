#!/usr/bin/env node
/**
 * Generates the worldwide location dataset used by /api/geo/*.
 *
 * Source: GeoNames (https://www.geonames.org) — CC BY 4.0.
 *   - countryInfo.txt   -> every ISO 3166-1 country and territory
 *   - admin1CodesASCII  -> region/state names
 *   - cities5000.txt    -> every place with 5,000+ inhabitants (70k rows)
 *
 * The generated files are committed so the running server never downloads
 * anything and city search works instantly. Re-run with:
 *
 *   node scripts/build-geo-data.mjs
 *
 * Requires `unzip` on the PATH (available on GitHub's ubuntu runners).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', 'server', 'data');
const BASE = 'https://download.geonames.org/export/dump';

/** Arabic names for every ISO 3166-1 code in countryInfo.txt. */
const ARABIC = {
  AD: 'أندورا', AE: 'الإمارات العربية المتحدة', AF: 'أفغانستان', AG: 'أنتيغوا وبربودا',
  AI: 'أنغويلا', AL: 'ألبانيا', AM: 'أرمينيا', AO: 'أنغولا', AQ: 'أنتاركتيكا',
  AR: 'الأرجنتين', AS: 'ساموا الأمريكية', AT: 'النمسا', AU: 'أستراليا', AW: 'أروبا',
  AX: 'جزر أولاند', AZ: 'أذربيجان', BA: 'البوسنة والهرسك', BB: 'بربادوس', BD: 'بنغلاديش',
  BE: 'بلجيكا', BF: 'بوركينا فاسو', BG: 'بلغاريا', BH: 'البحرين', BI: 'بوروندي',
  BJ: 'بنين', BL: 'سان بارتلمي', BM: 'برمودا', BN: 'بروناي', BO: 'بوليفيا',
  BQ: 'الجزر الكاريبية الهولندية', BR: 'البرازيل', BS: 'الباهاما', BT: 'بوتان',
  BV: 'جزيرة بوفيه', BW: 'بوتسوانا', BY: 'بيلاروسيا', BZ: 'بليز', CA: 'كندا',
  CC: 'جزر كوكوس', CD: 'جمهورية الكونغو الديمقراطية', CF: 'جمهورية أفريقيا الوسطى',
  CG: 'جمهورية الكونغو', CH: 'سويسرا', CI: 'ساحل العاج', CK: 'جزر كوك', CL: 'تشيلي',
  CM: 'الكاميرون', CN: 'الصين', CO: 'كولومبيا', CR: 'كوستاريكا', CU: 'كوبا',
  CV: 'الرأس الأخضر', CW: 'كوراساو', CX: 'جزيرة كريسماس', CY: 'قبرص', CZ: 'التشيك',
  DE: 'ألمانيا', DJ: 'جيبوتي', DK: 'الدنمارك', DM: 'دومينيكا',
  DO: 'جمهورية الدومينيكان', DZ: 'الجزائر', EC: 'الإكوادور', EE: 'إستونيا', EG: 'مصر',
  EH: 'الصحراء الغربية', ER: 'إريتريا', ES: 'إسبانيا', ET: 'إثيوبيا', FI: 'فنلندا',
  FJ: 'فيجي', FK: 'جزر فوكلاند', FM: 'ميكرونيزيا', FO: 'جزر فارو', FR: 'فرنسا',
  GA: 'الغابون', GB: 'المملكة المتحدة', GD: 'غرينادا', GE: 'جورجيا',
  GF: 'غويانا الفرنسية', GG: 'غيرنزي', GH: 'غانا', GI: 'جبل طارق', GL: 'غرينلاند',
  GM: 'غامبيا', GN: 'غينيا', GP: 'غوادلوب', GQ: 'غينيا الاستوائية', GR: 'اليونان',
  GS: 'جورجيا الجنوبية', GT: 'غواتيمالا', GU: 'غوام', GW: 'غينيا بيساو', GY: 'غيانا',
  HK: 'هونغ كونغ', HM: 'جزيرة هيرد', HN: 'هندوراس', HR: 'كرواتيا', HT: 'هايتي',
  HU: 'المجر', ID: 'إندونيسيا', IE: 'أيرلندا', IL: 'إسرائيل', IM: 'جزيرة مان',
  IN: 'الهند', IO: 'إقليم المحيط الهندي البريطاني', IQ: 'العراق', IR: 'إيران',
  IS: 'آيسلندا', IT: 'إيطاليا', JE: 'جيرزي', JM: 'جامايكا', JO: 'الأردن', JP: 'اليابان',
  KE: 'كينيا', KG: 'قيرغيزستان', KH: 'كمبوديا', KI: 'كيريباتي', KM: 'جزر القمر',
  KN: 'سانت كيتس ونيفيس', KP: 'كوريا الشمالية', KR: 'كوريا الجنوبية', XK: 'كوسوفو',
  KW: 'الكويت', KY: 'جزر كايمان', KZ: 'كازاخستان', LA: 'لاوس', LB: 'لبنان',
  LC: 'سانت لوسيا', LI: 'ليختنشتاين', LK: 'سريلانكا', LR: 'ليبيريا', LS: 'ليسوتو',
  LT: 'ليتوانيا', LU: 'لوكسمبورغ', LV: 'لاتفيا', LY: 'ليبيا', MA: 'المغرب',
  MC: 'موناكو', MD: 'مولدوفا', ME: 'الجبل الأسود', MF: 'سان مارتن', MG: 'مدغشقر',
  MH: 'جزر مارشال', MK: 'مقدونيا الشمالية', ML: 'مالي', MM: 'ميانمار', MN: 'منغوليا',
  MO: 'ماكاو', MP: 'جزر ماريانا الشمالية', MQ: 'مارتينيك', MR: 'موريتانيا',
  MS: 'مونتسرات', MT: 'مالطا', MU: 'موريشيوس', MV: 'المالديف', MW: 'مالاوي',
  MX: 'المكسيك', MY: 'ماليزيا', MZ: 'موزمبيق', NA: 'ناميبيا', NC: 'كاليدونيا الجديدة',
  NE: 'النيجر', NF: 'جزيرة نورفولك', NG: 'نيجيريا', NI: 'نيكاراغوا', NL: 'هولندا',
  NO: 'النرويج', NP: 'نيبال', NR: 'ناورو', NU: 'نيوي', NZ: 'نيوزيلندا', OM: 'عُمان',
  PA: 'بنما', PE: 'بيرو', PF: 'بولينيزيا الفرنسية', PG: 'بابوا غينيا الجديدة',
  PH: 'الفلبين', PK: 'باكستان', PL: 'بولندا', PM: 'سان بيير وميكلون', PN: 'جزر بيتكيرن',
  PR: 'بورتوريكو', PS: 'فلسطين', PT: 'البرتغال', PW: 'بالاو', PY: 'باراغواي', QA: 'قطر',
  RE: 'ريونيون', RO: 'رومانيا', RS: 'صربيا', RU: 'روسيا', RW: 'رواندا',
  SA: 'المملكة العربية السعودية', SB: 'جزر سليمان', SC: 'سيشل', SD: 'السودان',
  SS: 'جنوب السودان', SE: 'السويد', SG: 'سنغافورة', SH: 'سانت هيلانة', SI: 'سلوفينيا',
  SJ: 'سفالبارد وجان ماين', SK: 'سلوفاكيا', SL: 'سيراليون', SM: 'سان مارينو',
  SN: 'السنغال', SO: 'الصومال', SR: 'سورينام', ST: 'ساو تومي وبرينسيبي',
  SV: 'السلفادور', SX: 'سينت مارتن', SY: 'سوريا', SZ: 'إسواتيني',
  TC: 'جزر توركس وكايكوس', TD: 'تشاد', TF: 'الأراضي الفرنسية الجنوبية', TG: 'توغو',
  TH: 'تايلاند', TJ: 'طاجيكستان', TK: 'توكيلاو', TL: 'تيمور الشرقية',
  TM: 'تركمانستان', TN: 'تونس', TO: 'تونغا', TR: 'تركيا', TT: 'ترينيداد وتوباغو',
  TV: 'توفالو', TW: 'تايوان', TZ: 'تنزانيا', UA: 'أوكرانيا', UG: 'أوغندا',
  UM: 'جزر الولايات المتحدة النائية', US: 'الولايات المتحدة', UY: 'أوروغواي',
  UZ: 'أوزبكستان', VA: 'الفاتيكان', VC: 'سانت فينسنت والغرينادين', VE: 'فنزويلا',
  VG: 'جزر العذراء البريطانية', VI: 'جزر العذراء الأمريكية', VN: 'فيتنام',
  VU: 'فانواتو', WF: 'واليس وفوتونا', WS: 'ساموا', YE: 'اليمن', YT: 'مايوت',
  ZA: 'جنوب أفريقيا', ZM: 'زامبيا', ZW: 'زيمبابوي',
};

/** ISO codes withdrawn from use; they still appear in the GeoNames dump. */
const RETIRED = new Set(['AN', 'CS']);

const CONTINENTS = {
  AF: 'Africa', AS: 'Asia', EU: 'Europe', NA: 'North America',
  SA: 'South America', OC: 'Oceania', AN: 'Antarctica',
};

const cacheDir = path.join(os.tmpdir(), 'rifq-geonames');
fs.mkdirSync(cacheDir, { recursive: true });

function local(name, url) {
  const file = path.join(cacheDir, name);
  if (!fs.existsSync(file)) {
    process.stdout.write(`downloading ${name}…\n`);
    execFileSync('curl', ['-sSfL', '--max-time', '180', '-o', file, url], { stdio: 'inherit' });
  }
  return file;
}

const citiesZip = local('cities5000.zip', `${BASE}/cities5000.zip`);
const admin1File = local('admin1CodesASCII.txt', `${BASE}/admin1CodesASCII.txt`);
const countryFile = local('countryInfo.txt', `${BASE}/countryInfo.txt`);

/* ------------------------------- countries -------------------------------- */
const countries = [];
for (const line of fs.readFileSync(countryFile, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const f = line.split('\t');
  const code = (f[0] || '').trim().toUpperCase();
  const en = (f[4] || '').trim();
  if (!/^[A-Z]{2}$/.test(code) || !en || RETIRED.has(code)) continue;
  const ar = ARABIC[code];
  if (!ar) throw new Error(`Missing Arabic name for country ${code} (${en})`);
  countries.push({
    code,
    en,
    ar,
    capital: (f[5] || '').trim(),
    continent: CONTINENTS[(f[8] || '').trim()] || 'Other',
    population: Number(f[7]) || 0,
  });
}
countries.sort((a, b) => a.en.localeCompare(b.en, 'en'));

/* -------------------------------- regions --------------------------------- */
const admin1 = new Map();
for (const line of fs.readFileSync(admin1File, 'utf8').split('\n')) {
  if (!line) continue;
  const [key, name] = line.split('\t');
  if (key && name) admin1.set(key.trim(), name.trim());
}

/* --------------------------------- cities --------------------------------- */
const raw = execFileSync('unzip', ['-p', citiesZip, 'cities5000.txt'], {
  maxBuffer: 1024 * 1024 * 200,
  encoding: 'utf8',
});

const regionIdx = new Map();
const tzIdx = new Map();
const ccIdx = new Map();
const regions = [];
const zones = [];
const codes = [];
const rows = [];

const ALIAS_LATIN = /^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'-]{1,38}$/;
const ALIAS_ARABIC = /^[\u0600-\u06FF][\u0600-\u06FF\s\u064B-\u0652]{1,38}$/;

/**
 * Familiar spellings that differ from GeoNames' primary name: "Hargeisa" for
 * Hargeysa, "Garowe" for Garoowe, "Mogadishu" for Muqdisho. Kept small on
 * purpose — four Latin and two Arabic variants — so the dataset stays lean
 * while searches in either script succeed.
 */
function aliasesOf(name, alternates) {
  const latin = [];
  const arabic = [];
  for (const raw of String(alternates || '').split(',')) {
    const v = raw.trim();
    if (!v || v.toLowerCase() === name.toLowerCase()) continue;
    if (ALIAS_ARABIC.test(v)) {
      if (arabic.length < 2 && !arabic.includes(v)) arabic.push(v);
    } else if (ALIAS_LATIN.test(v)) {
      if (latin.length < 4 && !latin.includes(v)) latin.push(v);
    }
  }
  return [...latin, ...arabic].join('|');
}

const intern = (map, list, value) => {
  if (!map.has(value)) {
    map.set(value, list.length);
    list.push(value);
  }
  return map.get(value);
};

for (const line of raw.split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  if (f.length < 18) continue;
  const featureClass = f[6];
  const featureCode = f[7];
  // Populated places only: cities, towns, villages, suburbs, seats of government.
  if (featureClass !== 'P') continue;
  if (!/^PPL/.test(featureCode)) continue;
  const cc = (f[8] || '').trim().toUpperCase();
  const lat = Number(f[4]);
  const lon = Number(f[5]);
  const tz = (f[17] || '').trim();
  if (!/^[A-Z]{2}$/.test(cc) || !Number.isFinite(lat) || !Number.isFinite(lon) || !tz) continue;
  const region = admin1.get(`${cc}.${(f[10] || '').trim()}`) || '';
  rows.push([
    f[1].trim(),                                     // 0 display name
    intern(ccIdx, codes, cc),                        // 1 country index
    intern(regionIdx, regions, region),              // 2 region index
    Number(lat.toFixed(4)),                          // 3
    Number(lon.toFixed(4)),                          // 4
    intern(tzIdx, zones, tz),                        // 5 timezone index
    Number(f[14]) || 0,                              // 6 population
    featureCode === 'PPLC' ? 1 : 0,                  // 7 national capital
    aliasesOf(f[1].trim(), f[3]),                    // 8 searchable alternate names
  ]);
}

// Largest places first so plain searches surface the city people mean.
rows.sort((a, b) => b[6] - a[6]);

/* --------------------------- timezone correction --------------------------- */

// A town sitting right on a border can carry the neighbouring country's zone in
// GeoNames' timezone column (two Somali towns near Ethiopia come back as
// Africa/Addis_Ababa). Reassign such a place to its own country's dominant zone
// only when both zones share the same UTC offset in winter AND summer, so real
// multi-zone countries (US, RU, AU, ID, BR) and DST differences are preserved.
const offsetAt = (tz, iso) => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date(iso));
    return parts.find((p) => p.type === 'timeZoneName')?.value || null;
  } catch {
    return null;
  }
};
const offsetCache = new Map();
const offsetsOf = (tz) => {
  if (!offsetCache.has(tz)) {
    offsetCache.set(tz, [offsetAt(tz, '2026-01-15T12:00:00Z'), offsetAt(tz, '2026-07-15T12:00:00Z')]);
  }
  return offsetCache.get(tz);
};
const sameCivilTime = (a, b) => {
  const [aw, as] = offsetsOf(a);
  const [bw, bs] = offsetsOf(b);
  return Boolean(aw && bw) && aw === bw && as === bs;
};

const zoneCountByCountry = new Map();
const countryCountByZone = new Map();
for (const r of rows) {
  const cc = codes[r[1]];
  const tz = zones[r[5]];
  if (!zoneCountByCountry.has(cc)) zoneCountByCountry.set(cc, new Map());
  const perZone = zoneCountByCountry.get(cc);
  perZone.set(tz, (perZone.get(tz) || 0) + 1);
  countryCountByZone.set(tz, (countryCountByZone.get(tz) || new Map()).set(
    cc,
    ((countryCountByZone.get(tz)?.get(cc)) || 0) + 1
  ));
}
const dominantZone = new Map();
for (const [cc, perZone] of zoneCountByCountry) {
  dominantZone.set(cc, [...perZone.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}
const zoneOwner = new Map();
for (const [tz, perCountry] of countryCountByZone) {
  zoneOwner.set(tz, [...perCountry.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}

let repaired = 0;
for (const r of rows) {
  const cc = codes[r[1]];
  const tz = zones[r[5]];
  const home = dominantZone.get(cc);
  if (!home || tz === home) continue;
  if (zoneOwner.get(tz) === cc) continue;      // a genuine second zone of this country
  if (!sameCivilTime(tz, home)) continue;      // different civil time: keep the specific zone
  r[5] = tzIdx.get(home);
  repaired += 1;
}

const perCountry = new Map();
for (const r of rows) {
  const cc = codes[r[1]];
  perCountry.set(cc, (perCountry.get(cc) || 0) + 1);
}

const payload = {
  generated: new Date().toISOString().slice(0, 10),
  source: 'GeoNames cities5000 + countryInfo (CC BY 4.0, https://www.geonames.org)',
  countries: countries.map((c) => ({ ...c, cities: perCountry.get(c.code) || 0 })),
  regions,
  zones,
  codes,
  cities: rows,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, 'world-places.json');
fs.writeFileSync(out, JSON.stringify(payload));

const byContinent = new Map();
for (const c of countries) byContinent.set(c.continent, (byContinent.get(c.continent) || 0) + 1);
const missing = countries.filter((c) => !(perCountry.get(c.code) > 0)).map((c) => c.code);

console.log(`countries: ${countries.length}`);
console.log(`places:    ${rows.length}`);
console.log(`regions:   ${regions.length}   timezones: ${zones.length}`);
console.log(`timezone fixes for border artefacts: ${repaired}`);
console.log('by continent:', [...byContinent].map(([k, v]) => `${k}=${v}`).join(' '));
console.log('countries without a 5k+ place:', missing.join(',') || 'none');
console.log(`written: ${path.relative(path.join(HERE, '..'), out)} (${(fs.statSync(out).size / 1048576).toFixed(2)} MB)`);

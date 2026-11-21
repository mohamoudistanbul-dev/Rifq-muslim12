/**
 * Focused checks for the smart location rules in src/lib/geoAuto.ts.
 *
 * These assert the behaviour the app promises: one prompt at most, no repeated
 * asking after a block, no continuous tracking, and an honest fallback when GPS
 * is switched off. Run with `npm run verify:geo`.
 */
import {
  EMPTY_GEO,
  distanceKm,
  errorKind,
  hasMoved,
  hintForError,
  mayAsk,
  needsRefrash,
  shouldRefrashSilently,
  MIN_MS,
  type GeoRecord,
} from '../src/lib/geoAuto';

let pass = 0;
const fails: string[] = [];

function ok(name: string, cond: boolean): void {
  if (cond) pass += 1;
  else fails.push(name);
}

const rec = (over: Partial<GeoRecord> = {}): GeoRecord => ({ ...EMPTY_GEO, ...over });

const MOGADISHU = { lat: 2.0469, lon: 45.3182 };
const NAIROBI = { lat: -1.2921, lon: 36.8219 };
const NEARBY = { lat: 2.0569, lon: 45.3182 }; // ~1.1 km away
const HARGEISA = { lat: 9.56, lon: 44.065 };

/* ------------------------------- distance -------------------------------- */
ok('same point is 0 km', distanceKm(2.0469, 45.3182, 2.0469, 45.3182) < 0.001);
const toNairobi = distanceKm(MOGADISHU.lat, MOGADISHU.lon, NAIROBI.lat, NAIROBI.lon);
ok('Mogadishu to Nairobi is ~1000 km', toNairobi > 950 && toNairobi < 1100);
const toHargeisa = distanceKm(MOGADISHU.lat, MOGADISHU.lon, HARGEISA.lat, HARGEISA.lon);
ok('Mogadishu to Hargeisa is ~840 km', toHargeisa > 800 && toHargeisa < 900);

/* -------------------------------- movement ------------------------------- */
ok('first ever fix counts as a move', hasMoved(rec(), MOGADISHU.lat, MOGADISHU.lon));
ok(
  'a 1 km wobble is not a move',
  !hasMoved(rec({ lastLat: MOGADISHU.lat, lastLon: MOGADISHU.lon }), NEARBY.lat, NEARBY.lon)
);
ok(
  'a new city is a move',
  hasMoved(rec({ lastLat: MOGADISHU.lat, lastLon: MOGADISHU.lon }), HARGEISA.lat, HARGEISA.lon)
);
ok(
  'a new country is a move',
  hasMoved(rec({ lastLat: MOGADISHU.lat, lastLon: MOGADISHU.lon }), NAIROBI.lat, NAIROBI.lon)
);

/* -------------------------------- freshness ------------------------------ */
const NOW = 1_800_000_000_000;
ok('no fix yet needs a refresh', needsRefrash(rec(), NOW));
ok('a fix 5 minutes old is fresh', !needsRefrash(rec({ lastFixAt: NOW - 5 * 60_000 }), NOW));
ok('a fix 20 minutes old is stale', needsRefrash(rec({ lastFixAt: NOW - 20 * 60_000 }), NOW));
ok('the freshness window is 15 minutes', MIN_MS === 15 * 60_000);

/* ------------------------------ error causes ----------------------------- */
ok('code 1 is a permission block', errorKind(1) === 'blocked');
ok('code 2 is GPS off / unavailable', errorKind(2) === 'unavailable');
ok('code 3 is a timeout', errorKind(3) === 'timeout');
ok('an unknown code stays unknown', errorKind(99) === 'unknown');

/* -------------------------------- hints ---------------------------------- */
const blockedSaved = hintForError('blocked', true);
const blockedBare = hintForError('blocked', false);
ok('blocked with a saved place mentions the last saved location', /last saved location/i.test(blockedSaved));
ok('blocked without a saved place points at manual selection', /choose your city manually/i.test(blockedBare));
const gpsOffSaved = hintForError('unavailable', true);
const gpsOffBare = hintForError('unavailable', false);
ok('GPS off with a saved place mentions the last known location', /last known location/i.test(gpsOffSaved));
ok('GPS off without a saved place points at manual selection', /choose your city manually/i.test(gpsOffBare));
ok('no hint ever claims permission is fine when it is blocked', !/permission is off/i.test(gpsOffSaved));

/* --------------------------- asking discipline --------------------------- */
ok('first-time setup may ask', mayAsk(rec()));
ok('an allowed grant does not need asking', !mayAsk(rec({ permission: 'allowed' })));
ok('a blocked grant must never ask again', !mayAsk(rec({ permission: 'blocked' })));

/* ------------------------ silent refresh policy -------------------------- */
ok(
  'silent refresh runs for an allowed, stale, GPS user',
  shouldRefrashSilently(rec({ permission: 'allowed', lastFixAt: NOW - 60 * 60_000 }), false, NOW)
);
ok(
  'silent refresh is skipped for a fresh fix',
  !shouldRefrashSilently(rec({ permission: 'allowed', lastFixAt: NOW - 60_000 }), false, NOW)
);
ok(
  'silent refresh never overrides a manual city',
  !shouldRefrashSilently(rec({ permission: 'allowed', lastFixAt: null }), true, NOW)
);
ok(
  'a blocked permission is never refreshed silently',
  !shouldRefrashSilently(rec({ permission: 'blocked', lastFixAt: null }), false, NOW)
);
ok(
  'an unset permission is never refreshed silently',
  !shouldRefrashSilently(rec({ permission: 'unset', lastFixAt: null }), false, NOW)
);

/* ------------------------------- reporting ------------------------------- */
console.log(`geo rules: ${pass}/${pass + fails.length} checks passed`);
if (fails.length) {
  console.error('failed:');
  for (const f of fails) console.error(` - ${f}`);
  process.exit(1);
}

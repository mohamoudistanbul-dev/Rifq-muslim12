import {
  Coordinates,
  CalculationMethod,
  CalculationParameters,
  PrayerTimes,
  Madhab,
  HighLatitudeRule,
  Qibla,
} from 'adhan';

export type PrayerKey = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const PRAYER_KEYS: PrayerKey[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
export const FIVE: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export type MethodId =
  | 'MWL'
  | 'UmmAlQura'
  | 'Egyptian'
  | 'Karachi'
  | 'ISNA'
  | 'Diyanet'
  | 'Dubai'
  | 'Kuwait'
  | 'Qatar'
  | 'Singapore'
  | 'MoonsightingCommittee'
  | 'Tehran';

export const METHODS: { id: MethodId; label: string; note?: string }[] = [
  { id: 'MWL', label: 'Muslim World League', note: 'Default worldwide' },
  { id: 'UmmAlQura', label: 'Umm al-Qura (Makkah)' },
  { id: 'Egyptian', label: 'Egyptian General Authority' },
  { id: 'Karachi', label: 'University of Islamic Sciences, Karachi' },
  { id: 'ISNA', label: 'Islamic Society of North America' },
  { id: 'Diyanet', label: 'Diyanet İşleri (Türkiye)' },
  { id: 'Dubai', label: 'Dubai (UAE)' },
  { id: 'Kuwait', label: 'Kuwait' },
  { id: 'Qatar', label: 'Qatar' },
  { id: 'Singapore', label: 'Singapore / MUIS' },
  { id: 'MoonsightingCommittee', label: 'Moonsighting Committee' },
  { id: 'Tehran', label: 'Institute of Geophysics, Tehran' },
];

export type HighLat = 'MiddleOfTheNight' | 'SeventhOfTheNight' | 'TwilightAngle';

export const HIGH_LAT: { id: HighLat; label: string }[] = [
  { id: 'MiddleOfTheNight', label: 'Middle of the night' },
  { id: 'SeventhOfTheNight', label: 'One seventh of the night' },
  { id: 'TwilightAngle', label: 'Angle based (recommended)' },
];

/**
 * Regional default calculation method. Applied automatically for a newly
 * detected/selected country so that, for example, a Makkah user is not given
 * MWL timings. An explicit user choice always wins (see CalcOptions.methodAuto).
 */
const REGION_METHOD: Record<string, MethodId> = {
  SO: 'MWL',
  ET: 'MWL',
  KE: 'MWL',
  DJ: 'MWL',
  SD: 'MWL',
  SS: 'MWL',
  NG: 'MWL',
  GH: 'MWL',
  SN: 'MWL',
  ML: 'MWL',
  MR: 'MWL',
  TZ: 'MWL',
  UG: 'MWL',
  ZA: 'MWL',
  SA: 'UmmAlQura',
  AE: 'Dubai',
  EG: 'Egyptian',
  PK: 'Karachi',
  IN: 'Karachi',
  BD: 'Karachi',
  AF: 'Karachi',
  TR: 'Diyanet',
  KW: 'Kuwait',
  QA: 'Qatar',
  SG: 'Singapore',
  MY: 'Singapore',
  ID: 'Singapore',
  BN: 'Singapore',
  US: 'ISNA',
  CA: 'ISNA',
  GB: 'MoonsightingCommittee',
};

export function regionalMethod(countryCode?: string): MethodId {
  if (!countryCode) return 'MWL';
  return REGION_METHOD[countryCode.toUpperCase()] || 'MWL';
}

export interface Place {
  lat: number;
  lon: number;
  city: string;
  region?: string;
  country: string;
  countryCode: string;
  flag?: string;
  timezone: string;
  manual: boolean;
}

export interface CalcOptions {
  method: MethodId;
  madhab: 'shafi' | 'hanafi';
  highLatitude: HighLat;
  /** True while the method follows the regional default rather than a user choice. */
  methodAuto?: boolean;
  /** Per-prayer minute tuning used to match a local mosque. */
  adjustments?: Partial<Record<PrayerKey, number>>;
}

function baseParams(method: MethodId): CalculationParameters {
  switch (method) {
    case 'UmmAlQura':
      return CalculationMethod.UmmAlQura();
    case 'Egyptian':
      return CalculationMethod.Egyptian();
    case 'Karachi':
      return CalculationMethod.Karachi();
    case 'ISNA':
      return CalculationMethod.NorthAmerica();
    case 'Diyanet':
      return CalculationMethod.Turkey();
    case 'Dubai':
      return CalculationMethod.Dubai();
    case 'Kuwait':
      return CalculationMethod.Kuwait();
    case 'Qatar':
      return CalculationMethod.Qatar();
    case 'Singapore':
      return CalculationMethod.Singapore();
    case 'MoonsightingCommittee':
      return CalculationMethod.MoonsightingCommittee();
    case 'Tehran':
      return CalculationMethod.Tehran();
    case 'MWL':
    default:
      return CalculationMethod.MuslimWorldLeague();
  }
}

const clampAdjust = (n: unknown): number => {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  return Math.max(-30, Math.min(30, Math.round(value)));
};

export function buildParams(opts: CalcOptions): CalculationParameters {
  const params = baseParams(opts.method);
  params.madhab = opts.madhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  params.highLatitudeRule =
    opts.highLatitude === 'SeventhOfTheNight'
      ? HighLatitudeRule.SeventhOfTheNight
      : opts.highLatitude === 'TwilightAngle'
        ? HighLatitudeRule.TwilightAngle
        : HighLatitudeRule.MiddleOfTheNight;
  if (opts.adjustments) {
    const a = opts.adjustments;
    params.adjustments = {
      fajr: clampAdjust(a.fajr),
      sunrise: clampAdjust(a.sunrise),
      dhuhr: clampAdjust(a.dhuhr),
      asr: clampAdjust(a.asr),
      maghrib: clampAdjust(a.maghrib),
      isha: clampAdjust(a.isha),
    };
  }
  return params;
}

/* --------------------------- timezone-aware dates --------------------------- */

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function isValidTimeZone(timezone?: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date of an instant *in a given timezone* (not the device's). */
export function zonedParts(date: Date, timezone: string): DateParts {
  if (isValidTimeZone(timezone)) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: timezone,
      }).formatToParts(date);
      const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
      const year = pick('year');
      const month = pick('month');
      const day = pick('day');
      if (year && month && day) return { year, month, day };
    } catch {
      /* fall through to device date */
    }
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export function partsKey(parts: DateParts): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function addDays(parts: DateParts, days: number): DateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Adhan reads `date.getFullYear()/getMonth()/getDate()` — the runtime's local
 * calendar date. Passing a floating local noon that carries the *target city's*
 * date makes the calculation independent of the device timezone, and noon keeps
 * it clear of midnight DST transitions.
 */
function floatingDate(parts: DateParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
}

function assertPlace(place: Place): void {
  if (!Number.isFinite(place.lat) || Math.abs(place.lat) > 90) {
    throw new Error('Invalid latitude');
  }
  if (!Number.isFinite(place.lon) || Math.abs(place.lon) > 180) {
    throw new Error('Invalid longitude');
  }
}

/* ------------------------------ prayer times ------------------------------- */

export function computeDayForParts(
  parts: DateParts,
  place: Place,
  opts: CalcOptions
): Record<PrayerKey, Date> {
  assertPlace(place);
  const times = new PrayerTimes(
    new Coordinates(place.lat, place.lon),
    floatingDate(parts),
    buildParams(opts)
  );
  return {
    fajr: times.fajr,
    sunrise: times.sunrise,
    dhuhr: times.dhuhr,
    asr: times.asr,
    maghrib: times.maghrib,
    isha: times.isha,
  };
}

/** Prayer times for the calendar date that `date` falls on in the place's timezone. */
export function computeDay(
  date: Date,
  place: Place,
  opts: CalcOptions
): Record<PrayerKey, Date> {
  return computeDayForParts(zonedParts(date, place.timezone), place, opts);
}

/** Yesterday / today / tomorrow around an instant, each in the city's own calendar. */
export function computeWindow(
  date: Date,
  place: Place,
  opts: CalcOptions
): {
  yesterday: Record<PrayerKey, Date>;
  today: Record<PrayerKey, Date>;
  tomorrow: Record<PrayerKey, Date>;
} {
  const parts = zonedParts(date, place.timezone);
  return {
    yesterday: computeDayForParts(addDays(parts, -1), place, opts),
    today: computeDayForParts(parts, place, opts),
    tomorrow: computeDayForParts(addDays(parts, 1), place, opts),
  };
}

export function nextPrayer(
  times: Record<PrayerKey, Date>,
  now = new Date(),
  tomorrowTimes?: Record<PrayerKey, Date>
): { key: PrayerKey; at: Date; msLeft: number; tomorrow: boolean } {
  for (const key of PRAYER_KEYS) {
    if (times[key].getTime() > now.getTime()) {
      return { key, at: times[key], msLeft: times[key].getTime() - now.getTime(), tomorrow: false };
    }
  }
  // After Isha: use tomorrow's real Fajr, not a naive +24h (DST would be wrong).
  const at = tomorrowTimes
    ? tomorrowTimes.fajr
    : new Date(times.fajr.getTime() + 24 * 3600 * 1000);
  return { key: 'fajr', at, msLeft: Math.max(0, at.getTime() - now.getTime()), tomorrow: true };
}

/**
 * The prayer whose time window we are currently in. Between midnight and Fajr
 * the window still belongs to yesterday's Isha, so the previous day is used.
 */
export function currentPrayer(
  times: Record<PrayerKey, Date>,
  now = new Date(),
  previousTimes?: Record<PrayerKey, Date>
): PrayerKey | null {
  let current: PrayerKey | null = null;
  for (const key of FIVE) {
    if (times[key].getTime() <= now.getTime()) current = key;
  }
  if (!current && previousTimes && previousTimes.isha.getTime() <= now.getTime()) {
    return 'isha';
  }
  return current;
}

export function qiblaBearing(lat: number, lon: number): number {
  return Qibla(new Coordinates(lat, lon));
}

/** Hour of day (0-23) at a given timezone. */
export function zonedHour(date: Date, timezone: string): number {
  if (!isValidTimeZone(timezone)) return date.getHours();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    return Number.isFinite(hour) ? hour % 24 : date.getHours();
  } catch {
    return date.getHours();
  }
}

/** Emoji flag from an ISO 3166-1 alpha-2 country code. */
export function flagFromCode(code?: string): string {
  const cc = (code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/* -------------------------------- formatting ------------------------------- */

function localeFor(lang: string): string {
  return lang === 'ar' ? 'ar-SA' : lang === 'so' ? 'so-SO' : 'en-GB';
}

/** Format an instant in the place's own timezone (falls back to device time, never UTC). */
export function formatTime(date: Date, timezone: string, lang = 'en', hour12 = true): string {
  const zone = isValidTimeZone(timezone) ? timezone : undefined;
  try {
    return new Intl.DateTimeFormat(localeFor(lang), {
      hour: '2-digit',
      minute: '2-digit',
      hour12,
      timeZone: zone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12 }).format(date);
  }
}

/** Live clock (with seconds) in the selected city's timezone. */
export function formatClock(date: Date, timezone: string, lang = 'en', hour12 = true): string {
  const zone = isValidTimeZone(timezone) ? timezone : undefined;
  try {
    return new Intl.DateTimeFormat(localeFor(lang), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12,
      timeZone: zone,
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}

/** Long date (weekday, day month year) in the selected city's timezone. */
export function formatZonedDate(date: Date, timezone: string, lang = 'en'): string {
  const zone = isValidTimeZone(timezone) ? timezone : undefined;
  try {
    return new Intl.DateTimeFormat(localeFor(lang), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: zone,
    }).format(date);
  } catch {
    return date.toDateString();
  }
}

/** UTC offset label for a timezone at a given instant, e.g. "GMT+3". */
export function offsetLabel(timezone: string, date = new Date(), lang = 'en'): string {
  if (!isValidTimeZone(timezone)) return '';
  try {
    const parts = new Intl.DateTimeFormat(localeFor(lang), {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Local calendar date (YYYY-MM-DD) for a place, used for scheduling. */
export function dayKey(date: Date, timezone: string): string {
  return partsKey(zonedParts(date, timezone));
}

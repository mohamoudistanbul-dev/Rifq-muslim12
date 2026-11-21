import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { get, patch, post, local } from './api';
import { dirOf, translate, type Lang } from './i18n';
import {
  computeWindow,
  nextPrayer as computeNext,
  currentPrayer as computeCurrent,
  dayKey,
  flagFromCode,
  formatClock,
  formatCountdown,
  formatZonedDate,
  offsetLabel,
  regionalMethod,
  zonedParts,
  FIVE,
  type CalcOptions,
  type Place,
  type PrayerKey,
} from './prayer';
import { hijriDate, type HijriDate } from './hijri';
import { startAlertLoop, planFor, requestPermission, syncNativeSchedule, upcomingOccasionAlerts } from './notify';
import type { CategoryPrefs, CustomReminder } from './notifyPlan';
import {
  EMPTY_GEO,
  errorKind,
  hasMoved,
  hintForError,
  shouldRefrashSilently,
  type GeoRecord,
} from './geoAuto';

export interface Prefs {
  notifyEnabled: boolean;
  prayerAlerts: Record<string, boolean>;
  preReminder: number; // minutes before, 0 = off
  athanSound: string;
  /** General notification sound for reminders: `beep` (chime) or `silent`. */
  notifySound: string;
  /** Per-prayer Adhan audio switches; the notification still shows when off. */
  adhanAudio: Record<string, boolean>;
  vibration: boolean;
  dailyQuran: boolean;
  dailyDua: boolean;
  dailyHadith: boolean;
  /** Per-category time, sound, vibration and frequency for daily reminders. */
  categories: CategoryPrefs;
  /** Reminders the user created themselves. */
  customReminders: CustomReminder[];
  quranFontSize: number;
  hour12: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  notifyEnabled: false,
  prayerAlerts: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
  preReminder: 0,
  athanSound: 'makkah',
  notifySound: 'beep',
  adhanAudio: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
  vibration: true,
  dailyQuran: true,
  dailyDua: false,
  dailyHadith: false,
  categories: {
    quran: { enabled: true, time: '08:00', sound: 'default', vibrate: true, frequency: 'daily' },
    hadith: { enabled: false, time: '12:30', sound: 'default', vibrate: true, frequency: 'daily' },
    dua: { enabled: false, time: '18:00', sound: 'default', vibrate: true, frequency: 'daily' },
    adhkarMorning: { enabled: true, time: '06:30', sound: 'default', vibrate: true, frequency: 'daily' },
    adhkarEvening: { enabled: true, time: '18:30', sound: 'default', vibrate: true, frequency: 'daily' },
    occasions: { enabled: false, time: '09:00', sound: 'default', vibrate: true, frequency: 'daily' },
  },
  customReminders: [],
  quranFontSize: 28,
  hour12: true,
};

/**
 * Merges saved preferences with the defaults, including the nested notification
 * groups, and carries the older flat daily reminders into the new structure so
 * an existing user does not lose a choice they already made.
 */
export function normalizePrefs(raw: unknown): Prefs {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<Prefs>;
  const savedCats = (
    saved.categories && typeof saved.categories === 'object' ? saved.categories : {}
  ) as Partial<CategoryPrefs>;

  const categories = { ...DEFAULT_PREFS.categories } as CategoryPrefs;
  for (const key of Object.keys(categories) as (keyof CategoryPrefs)[]) {
    categories[key] = { ...categories[key], ...(savedCats[key] || {}) };
  }
  if (!savedCats.quran && typeof saved.dailyQuran === 'boolean') {
    categories.quran = { ...categories.quran, enabled: saved.dailyQuran };
  }
  if (!savedCats.hadith && typeof saved.dailyHadith === 'boolean') {
    categories.hadith = { ...categories.hadith, enabled: saved.dailyHadith };
  }
  if (!savedCats.dua && typeof saved.dailyDua === 'boolean') {
    categories.dua = { ...categories.dua, enabled: saved.dailyDua };
  }

  return {
    ...DEFAULT_PREFS,
    ...saved,
    prayerAlerts: { ...DEFAULT_PREFS.prayerAlerts, ...(saved.prayerAlerts || {}) },
    adhanAudio: { ...DEFAULT_PREFS.adhanAudio, ...(saved.adhanAudio || {}) },
    categories,
    customReminders: Array.isArray(saved.customReminders) ? saved.customReminders : [],
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  lang: Lang;
  theme: 'light' | 'dark';
  role: string;
  emailVerified: boolean;
  /** Blue verified tick. Server-controlled: only an administrator can grant it. */
  badgeVerified?: boolean;
  badgeVerifiedAt?: string | null;
  /** Profile picture, saved from a verification request or the admin dashboard. */
  avatarUrl?: string | null;
  prefs: Partial<Prefs>;
  createdAt: string;
}

type LocState = 'idle' | 'locating' | 'granted' | 'denied' | 'error';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

interface Store {
  lang: Lang;
  setLang: (l: Lang) => void;
  dir: 'ltr' | 'rtl';
  t: (phrase: string) => string;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  place: Place | null;
  locState: LocState;
  locError: string;
  /** Discreet explanation when GPS is off or permission is blocked. */
  locationHint: string;
  /** What the platform last told us about location access. */
  geoPermission: GeoRecord['permission'];
  /** When the last real fix was accepted, or null. */
  lastFixAt: number | null;
  /** True while an explicit location request is running. */
  pending: boolean;
  /** Explicit user request. The only path that may re-ask after a block. */
  refreshLocation: () => Promise<void>;
  detectLocation: () => Promise<void>;
  setManualPlace: (p: Place) => void;
  clearPlace: () => void;
  calc: CalcOptions;
  setCalc: (c: Partial<CalcOptions>) => void;
  times: Record<PrayerKey, Date> | null;
  next: { key: PrayerKey; at: Date; msLeft: number; tomorrow: boolean } | null;
  /** Prayer whose time window we are in (yesterday's Isha before Fajr). */
  current: PrayerKey | null;
  countdown: string;
  now: Date;
  /** Live clock HH:MM:SS in the selected place's timezone. */
  localTime: string;
  /** Long date in the selected place's timezone. */
  localDate: string;
  /** UTC offset of the selected place's timezone, e.g. "GMT+3". */
  tzLabel: string;
  hijri: HijriDate | null;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  user: User | null;
  authReady: boolean;
  setUser: (u: User | null) => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  toasts: Toast[];
  toast: (message: string, kind?: Toast['kind']) => void;
  notifyPermission: string;
  requestNotify: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

const DEFAULT_CALC: CalcOptions = {
  method: 'MWL',
  madhab: 'shafi',
  highLatitude: 'TwilightAngle',
  methodAuto: true,
};

/**
 * Normalises any location payload (reverse geocode, search hit, stored value)
 * into a Place. Returns null when the coordinates are not real numbers, so a
 * malformed payload can never turn into a guessed location.
 */
export function normalizePlace(raw: unknown): Place | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  const rawCountry = String(r.country || '');
  const codeRaw = String(r.countryCode || (rawCountry.length === 2 ? rawCountry : '') || '').toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(codeRaw) ? codeRaw : '';
  const city = String(r.city || r.name || r.locality || '').trim();
  return {
    lat,
    lon,
    city: city || 'Location name unavailable',
    region: String(r.region || ''),
    country: rawCountry.length > 2 ? rawCountry : countryCode,
    countryCode,
    flag: String(r.flag || '') || flagFromCode(countryCode),
    timezone: String(r.timezone || 'UTC'),
    manual: Boolean(r.manual),
  };
}

const GEO_KEY = 'geo-state';

/**
 * Read the stored location memory, repairing anything malformed. The record is
 * our own account of what really happened (a fix succeeded, or the platform
 * refused), so a denied permission is never asked for again by itself.
 */
function readGeo(): GeoRecord {
  const raw = local.get<Partial<GeoRecord> | null>(GEO_KEY, null);
  if (!raw || typeof raw !== 'object') return { ...EMPTY_GEO };
  const permission =
    raw.permission === 'allowed' || raw.permission === 'blocked' ? raw.permission : 'unset';
  const num = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    permission,
    askedAt: num(raw.askedAt),
    lastFixAt: num(raw.lastFixAt),
    lastLat: num(raw.lastLat),
    lastLon: num(raw.lastLon),
  };
}

function writeGeo(rec: GeoRecord): void {
  local.set(GEO_KEY, rec);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => local.get<Lang>('lang', 'en'));
  const [theme, setTheme] = useState<'light' | 'dark'>(() => local.get('theme', 'light'));
  const [place, setPlace] = useState<Place | null>(() => normalizePlace(local.get<Place | null>('place', null)));
  const [locState, setLocState] = useState<LocState>(place ? (place.manual ? 'idle' : 'granted') : 'idle');
  const [locError, setLocError] = useState('');
  const [geo, setGeo] = useState<GeoRecord>(() => readGeo());
  const [locationHint, setLocationHint] = useState('');
  const [pending, setPending] = useState(false);
  const [calc, setCalcState] = useState<CalcOptions>(() => local.get<CalcOptions>('calc', DEFAULT_CALC));
  const [prefs, setPrefsState] = useState<Prefs>(() => normalizePrefs(local.get('prefs', {})));
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifyPermission, setNotifyPermission] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const placeRef = useRef<Place | null>(place);

  useEffect(() => {
    placeRef.current = place;
  }, [place]);

  const t = useCallback((phrase: string) => translate(lang, phrase), [lang]);
  const dir = dirOf(lang);

  /* ------------------------------ persistence ------------------------------ */
  useEffect(() => {
    local.set('lang', lang);
    local.set('theme', theme);
    local.set('calc', calc);
    local.set('prefs', prefs);
    if (place) local.set('place', place);
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.documentElement.dataset.theme = theme;
  }, [lang, theme, calc, prefs, place, dir]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3600);
  }, []);

  /* --------------------------------- auth ---------------------------------- */
  const refreshUser = useCallback(async () => {
    try {
      const res = await get<{ user: User | null }>('/auth/me');
      const me = res.user;
      setUser(me);
      if (me) {
        setPrefsState((p) => ({ ...p, ...(me.prefs || {}) }));
      }
    } catch {
      setUser(null);
    } finally {
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await post('/auth/logout');
    // Never leave another account's cached responses behind on this device.
    local.clearApiCache();
    setUser(null);
    toast('Signed out');
  }, [toast]);

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      if (user) void patch('/auth/profile', { lang: l }).catch(() => undefined);
    },
    [user]
  );

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      if (user) void patch('/auth/profile', { theme: nextTheme }).catch(() => undefined);
      return nextTheme;
    });
  }, [user]);

  const setPrefs = useCallback(
    (p: Partial<Prefs>) => {
      setPrefsState((prev) => {
        const merged = { ...prev, ...p };
        if (user) {
          void patch('/auth/profile', { prefs: merged }).catch(() => undefined);
        }
        return merged;
      });
    },
    [user]
  );

  const setCalc = useCallback((c: Partial<CalcOptions>) => {
    setCalcState((prev) => ({ ...prev, ...c }));
  }, []);

  /**
   * Follow the regional default until the user chooses a method themselves.
   * An explicit choice (methodAuto: false) is never overwritten.
   */
  const applyAutoMethod = useCallback((countryCode: string) => {
    setCalcState((prev) => {
      if (prev.methodAuto === false) return prev;
      const method = regionalMethod(countryCode);
      return prev.method === method ? prev : { ...prev, method, methodAuto: true };
    });
  }, []);

  /* ------------------------------- location -------------------------------- */
  const setManualPlace = useCallback(
    (p: Place) => {
      const chosen = normalizePlace({ ...p, manual: true });
      if (!chosen) return;
      setPlace(chosen);
      setLocState('idle');
      setLocError('');
      applyAutoMethod(chosen.countryCode);
    },
    [applyAutoMethod]
  );

  const clearPlace = useCallback(() => {
    setPlace(null);
    local.remove('place');
    setLocState('idle');
  }, []);

  /**
   * Reverse geocode real coordinates. The API returns the place fields flat
   * (city/country/countryCode/timezone), so the whole payload is normalised.
   */
  const resolveCoords = useCallback(
    async (lat: number, lon: number, notify: boolean): Promise<Place | null> => {
      const previous = placeRef.current;
      const res = await get<Record<string, unknown>>(`/geo/reverse?lat=${lat}&lon=${lon}`);
      const resolved = normalizePlace({ ...res, lat, lon, manual: false });
      if (!resolved) return null;
      setPlace(resolved);
      setLocState('granted');
      setLocError('');
      applyAutoMethod(resolved.countryCode);
      const cityChanged =
        !previous || previous.city !== resolved.city || previous.timezone !== resolved.timezone;
      if (notify && cityChanged) toast(`Location updated: ${resolved.city}`, 'success');
      return resolved;
    },
    [applyAutoMethod, toast]
  );

  const remember = useCallback((patch: Partial<GeoRecord>) => {
    setGeo((prev) => {
      const next: GeoRecord = { ...prev, ...patch };
      writeGeo(next);
      return next;
    });
  }, []);

  /**
   * Accept a real fix. The city is only reverse geocoded when the device
   * actually moved (or when the user asked for a refrash), so reopening the app
   * in the same city costs no network call and no battery.
   */
  const applyFix = useCallback(
    async (lat: number, lon: number, opts: { announce: boolean; forced: boolean }): Promise<void> => {
      const nowMs = Date.now();
      if (!opts.forced && !hasMoved(readGeo(), lat, lon)) {
        // Same area: keep the resolved place, just mark the fix fresh.
        remember({ permission: 'allowed', lastFixAt: nowMs, lastLat: lat, lastLon: lon });
        setLocState('granted');
        setLocError('');
        setLocationHint('');
        return;
      }
      try {
        const resolved = await resolveCoords(lat, lon, opts.announce);
        if (!resolved) {
          setLocState('error');
          setLocError('Location unavailable');
          return;
        }
        remember({ permission: 'allowed', lastFixAt: nowMs, lastLat: lat, lastLon: lon });
        setLocState('granted');
        setLocError('');
        setLocationHint('');
      } catch {
        // The coordinates are real; only the city name lookup failed.
        remember({ permission: 'allowed', lastFixAt: nowMs, lastLat: lat, lastLon: lon });
        setLocState('error');
        setLocError('Could not identify the city for these coordinates.');
      }
    },
    [remember, resolveCoords]
  );

  /**
   * A failure is reported honestly and never escalates into another prompt:
   * a blocked permission is remembered, while GPS off keeps the last known
   * location on screen with a one-line explanation.
   */
  const handleGeoError = useCallback(
    (code: number, asked: boolean) => {
      const kind = errorKind(code);
      const hasSaved = Boolean(placeRef.current);
      if (kind === 'blocked') {
        remember({ permission: 'blocked', askedAt: asked ? Date.now() : readGeo().askedAt });
        setLocState('denied');
        setLocError('Location permission denied');
      } else {
        // GPS off or a slow fix must never look like a permission problem. The
        // platform only reaches here after access was granted, so remember that
        // and let later visits refresh silently instead of asking again.
        remember({ permission: 'allowed' });
        setLocState('error');
        setLocError('Location unavailable');
      }
      setLocationHint(hintForError(kind, hasSaved));
    },
    [remember]
  );

  /**
   * Explicit request from a button: the only path allowed to re-ask after a
   * block, and the only one that uses high accuracy.
   */
  const refreshLocation = useCallback(async () => {
    if (!('geolocation' in navigator)) {
      setLocState('error');
      setLocError('This device does not expose a location sensor.');
      return;
    }
    setPending(true);
    setLocState('locating');
    setLocError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void applyFix(pos.coords.latitude, pos.coords.longitude, { announce: true, forced: true })
          .catch(() => undefined)
          .finally(() => setPending(false));
      },
      (err) => {
        handleGeoError(err.code, true);
        setPending(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, [applyFix, handleGeoError]);

  /**
   * Single-shot refrash: no prompt, no watch, at most every 15 minutes, and
   * only after the user has granted access before. A manual city choice always
   * wins, and a GPS-off device keeps showing its last known location.
   */
  const silentRefrash = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    const manual = Boolean(placeRef.current?.manual);
    if (!shouldRefrashSilently(readGeo(), manual, Date.now())) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void applyFix(pos.coords.latitude, pos.coords.longitude, { announce: true, forced: false })
          .catch(() => undefined);
      },
      (err) => handleGeoError(err.code, false),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 }
    );
  }, [applyFix, handleGeoError]);

  // Launch and resume only: there is no interval and no watchPosition, so the
  // app never tracks the user while it sits open.
  useEffect(() => {
    silentRefrash();
    const onVisible = () => {
      if (document.visibilityState === 'visible') silentRefrash();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [silentRefrash]);

  const detectLocation = refreshLocation;

  /* ----------------------------- prayer times ------------------------------ */
  // The city's own calendar date: the device timezone must never decide which
  // day is calculated (Tokyo selected from London is still Tokyo's date).
  const cityDay = place ? dayKey(now, place.timezone) : '';

  const dayWindow = useMemo(() => {
    if (!place) return null;
    try {
      return computeWindow(now, place, calc);
    } catch {
      return null;
    }
  }, [place, calc, cityDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const times = dayWindow?.today ?? null;
  const next = useMemo(
    () => (dayWindow ? computeNext(dayWindow.today, now, dayWindow.tomorrow) : null),
    [dayWindow, now]
  );
  const current = useMemo(
    () => (dayWindow ? computeCurrent(dayWindow.today, now, dayWindow.yesterday) : null),
    [dayWindow, now]
  );
  const countdown = next ? formatCountdown(next.msLeft) : '--:--:--';
  const localTime = place ? formatClock(now, place.timezone, lang, prefs.hour12) : '';
  const localDate = place ? formatZonedDate(now, place.timezone, lang) : '';
  const tzLabel = place ? offsetLabel(place.timezone, now, lang) : '';
  const hijri = useMemo(() => {
    if (!place) return hijriDate(now, lang);
    const parts = zonedParts(now, place.timezone);
    return hijriDate(new Date(parts.year, parts.month - 1, parts.day, 12), lang);
  }, [cityDay, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------- notifications ------------------------------ */
  const requestNotify = useCallback(async () => {
    const result = await requestPermission();
    if (result === 'unsupported') {
      setNotifyPermission('unsupported');
      toast('This browser does not support notifications', 'error');
      return;
    }
    setNotifyPermission(result);
    if (result === 'granted') {
      setPrefs({ notifyEnabled: true });
      toast('Prayer reminders enabled', 'success');
    } else if (result === 'denied') {
      toast('Notifications are blocked. Allow them in the browser or app settings.', 'error');
    } else {
      toast('Notification permission was not granted', 'error');
    }
  }, [setPrefs, toast]);

  // Alert delivery. The loop reads the very same `times` object that renders the
  // countdown, so a notification can never disagree with the clock on screen,
  // and every slot is deduplicated in localStorage (see lib/notify.ts).
  useEffect(() => {
    const build = () => ({
      times,
      city: place?.city || 'your city',
      prefs: {
        notifyEnabled: prefs.notifyEnabled,
        prayerAlerts: prefs.prayerAlerts,
        preReminder: prefs.preReminder,
        athanSound: prefs.athanSound,
        vibration: prefs.vibration,
        categories: prefs.categories,
        custom: prefs.customReminders,
      },
      occasions: upcomingOccasionAlerts(new Date()),
    });
    const stop = startAlertLoop(build);
    // The native alarm clock must agree with the screen: a new city or timezone
    // reschedules every pending athan alarm through the same planner.
    try {
      syncNativeSchedule(planFor(build(), new Date()), new Date());
    } catch {
      /* a failed native sync must never break the in-app reminders */
    }
    return stop;
  }, [prefs, times, place]);

  const value: Store = {
    lang,
    setLang,
    dir,
    t,
    theme,
    toggleTheme,
    place,
    locState,
    locError,
    locationHint,
    geoPermission: geo.permission,
    lastFixAt: geo.lastFixAt,
    pending,
    refreshLocation,
    detectLocation,
    setManualPlace,
    clearPlace,
    calc,
    setCalc,
    times,
    next,
    current,
    countdown,
    now,
    localTime,
    localDate,
    tzLabel,
    hijri,
    prefs,
    setPrefs,
    user,
    authReady,
    setUser,
    refreshUser,
    logout,
    toasts,
    toast,
    notifyPermission,
    requestNotify,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

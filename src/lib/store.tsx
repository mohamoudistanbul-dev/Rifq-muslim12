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

export interface Prefs {
  notifyEnabled: boolean;
  prayerAlerts: Record<string, boolean>;
  preReminder: number; // minutes before, 0 = off
  athanSound: string;
  dailyQuran: boolean;
  dailyDua: boolean;
  dailyHadith: boolean;
  quranFontSize: number;
  hour12: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  notifyEnabled: false,
  prayerAlerts: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
  preReminder: 0,
  athanSound: 'makkah',
  dailyQuran: true,
  dailyDua: false,
  dailyHadith: false,
  quranFontSize: 28,
  hour12: true,
};

export interface User {
  id: string;
  email: string;
  name: string;
  lang: Lang;
  theme: 'light' | 'dark';
  role: string;
  emailVerified: boolean;
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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => local.get<Lang>('lang', 'en'));
  const [theme, setTheme] = useState<'light' | 'dark'>(() => local.get('theme', 'light'));
  const [place, setPlace] = useState<Place | null>(() => normalizePlace(local.get<Place | null>('place', null)));
  const [locState, setLocState] = useState<LocState>(place ? (place.manual ? 'idle' : 'granted') : 'idle');
  const [locError, setLocError] = useState('');
  const [calc, setCalcState] = useState<CalcOptions>(() => local.get<CalcOptions>('calc', DEFAULT_CALC));
  const [prefs, setPrefsState] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...local.get('prefs', {}) }));
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifyPermission, setNotifyPermission] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const firedRef = useRef<Set<string>>(new Set());
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

  const detectLocation = useCallback(async () => {
    if (!('geolocation' in navigator)) {
      setLocState('error');
      setLocError('This device does not expose a location sensor.');
      return;
    }
    setLocState('locating');
    setLocError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const resolved = await resolveCoords(pos.coords.latitude, pos.coords.longitude, true);
          if (!resolved) {
            setLocState('error');
            setLocError('Location unavailable');
          }
        } catch {
          setLocState('error');
          setLocError('Could not identify the city for these coordinates.');
        }
      },
      (err) => {
        setLocState(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied'
            : 'Location unavailable'
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, [resolveCoords]);

  // Follow the user as they move. A manual selection is never overridden.
  useEffect(() => {
    if (!('geolocation' in navigator) || locState === 'denied') return;
    const consider = (lat: number, lon: number) => {
      const currentPlace = placeRef.current;
      if (currentPlace?.manual) return;
      const moved =
        !currentPlace ||
        Math.abs(currentPlace.lat - lat) > 0.02 ||
        Math.abs(currentPlace.lon - lon) > 0.02;
      if (!moved) return;
      void resolveCoords(lat, lon, true).catch(() => undefined);
    };
    const id = navigator.geolocation.watchPosition(
      (pos) => consider(pos.coords.latitude, pos.coords.longitude),
      () => undefined,
      { maximumAge: 120000, timeout: 20000 }
    );
    // A watch may stay silent when the app is reopened in a new city.
    const timer = setInterval(() => {
      if (placeRef.current?.manual) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => consider(pos.coords.latitude, pos.coords.longitude),
        () => undefined,
        { maximumAge: 300000, timeout: 15000 }
      );
    }, 10 * 60 * 1000);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(timer);
    };
  }, [locState, resolveCoords]);

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
    if (typeof Notification === 'undefined') {
      setNotifyPermission('unsupported');
      toast('This browser does not support notifications', 'error');
      return;
    }
    const result = await Notification.requestPermission();
    setNotifyPermission(result);
    if (result === 'granted') {
      setPrefs({ notifyEnabled: true });
      toast('Prayer reminders enabled', 'success');
    } else {
      toast('Notification permission was not granted', 'error');
    }
  }, [setPrefs, toast]);

  // In-app scheduling while the app is open. Android background delivery needs
  // the native shell described in docs/ANDROID_BUILD.md.
  useEffect(() => {
    if (!prefs.notifyEnabled || notifyPermission !== 'granted' || !times || !place) return;
    const id = setInterval(() => {
      const current = new Date();
      for (const key of FIVE) {
        if (prefs.prayerAlerts[key] === false) continue;
        const at = times[key];
        const diff = current.getTime() - at.getTime();
        const slot = `${at.toISOString()}:${key}`;
        if (diff >= 0 && diff < 60000 && !firedRef.current.has(slot)) {
          firedRef.current.add(slot);
          const body =
            key === 'fajr'
              ? `Fajr time in ${place.city}. Prayer is better than sleep.`
              : `It is time for ${key[0].toUpperCase()}${key.slice(1)} in ${place.city}.`;
          try {
            new Notification('RIFQ Muslim', { body, icon: '/icons/icon-192.png', tag: slot });
          } catch {
            /* notification constructor can fail on some platforms */
          }
          if (prefs.athanSound !== 'silent') {
            try {
              new Audio(
                `https://cdn.islamic.network/athan/${prefs.athanSound === 'madinah' ? 'madinah' : 'makkah'}.mp3`
              ).play().catch(() => undefined);
            } catch {
              /* autoplay blocked */
            }
          }
        }
      }
    }, 15000);
    return () => clearInterval(id);
  }, [prefs.notifyEnabled, prefs.prayerAlerts, prefs.athanSound, notifyPermission, times, place]);

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

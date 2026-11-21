/**
 * Prayer notification and Adhan delivery.
 *
 * One engine is used by the countdown, the Athan settings screen and the test
 * button, so what the user sees and what is delivered cannot drift apart:
 *  - the same prayer-time objects that render the clock trigger the alerts;
 *  - every alert is deduplicated by prayer + timestamp in localStorage, so a
 *    reload, a second tab or the 20 s sweep can never double-notify;
 *  - Adhan audio is a real recording streamed from the sound catalogue; the
 *    "chime" and "silent" options are labelled as such instead of pretending
 *    to be an adhan.
 */
import { FIVE } from './prayer';

export type SoundId = 'makkah' | 'madinah' | 'alaqsa' | 'egypt' | 'turkiye' | 'beep' | 'silent';

export interface AdhanSound {
  id: SoundId;
  label: string;
  /** Real recording. `null` means the option is not an adhan. */
  url: string | null;
  note: string;
}

export const ADHAN_SOUNDS: AdhanSound[] = [
  {
    id: 'makkah',
    label: 'Adhan — Makkah al-Mukarramah',
    url: 'https://www.islamcan.com/audio/adhan/azan1.mp3',
    note: 'Recorded adhan',
  },
  {
    id: 'madinah',
    label: 'Adhan — Madinah al-Munawwarah',
    url: 'https://www.islamcan.com/audio/adhan/azan2.mp3',
    note: 'Recorded adhan',
  },
  {
    id: 'alaqsa',
    label: 'Adhan — Al-Aqsa',
    url: 'https://www.islamcan.com/audio/adhan/azan3.mp3',
    note: 'Recorded adhan',
  },
  {
    id: 'egypt',
    label: 'Adhan — Egypt',
    url: 'https://www.islamcan.com/audio/adhan/azan4.mp3',
    note: 'Recorded adhan',
  },
  {
    id: 'turkiye',
    label: 'Adhan — Türkiye',
    url: 'https://www.islamcan.com/audio/adhan/azan5.mp3',
    note: 'Recorded adhan',
  },
  { id: 'beep', label: 'Short chime only', url: null, note: 'Not an adhan — a single chime' },
  { id: 'silent', label: 'Silent notification', url: null, note: 'No sound' },
];

export function soundById(id: string): AdhanSound {
  return ADHAN_SOUNDS.find((s) => s.id === id) || ADHAN_SOUNDS[0];
}

/* ------------------------------- permission ------------------------------- */

export type PermissionState = NotificationPermission | 'unsupported';

export function notificationState(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  const result = await Notification.requestPermission();
  if (result === 'granted') void registerServiceWorker();
  return result;
}

/* ----------------------------- service worker ----------------------------- */

let swPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (swPromise) return swPromise;
  swPromise = (async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready.catch(() => undefined);
      return reg;
    } catch {
      return null;
    }
  })();
  return swPromise;
}

/* -------------------------------- delivery -------------------------------- */

export interface AlertPayload {
  title?: string;
  body: string;
  tag: string;
  vibrate?: boolean;
  url?: string;
}

/** Shows a branded notification, preferring the service worker. */
export async function showAlert(payload: AlertPayload): Promise<boolean> {
  if (notificationState() !== 'granted') return false;
  if (payload.vibrate && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([250, 120, 250]);
    } catch {
      /* vibration is optional */
    }
  }
  const reg = await registerServiceWorker();
  if (reg) {
    try {
      await reg.showNotification(payload.title || 'RIFQ Muslim', {
        body: payload.body,
        tag: payload.tag,
        icon: '/icons/icon-192.png',
        data: { url: payload.url || '/athan' },
        // The adhan recording is played by the page so it can be stopped and
        // so the volume follows the device; the system sound stays silent.
        silent: true,
      });
      return true;
    } catch {
      /* fall through to the constructor */
    }
  }
  try {
    new Notification(payload.title || 'RIFQ Muslim', {
      body: payload.body,
      tag: payload.tag,
      icon: '/icons/icon-192.png',
    });
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------- audio ---------------------------------- */

let currentAudio: HTMLAudioElement | null = null;
let chimeContext: AudioContext | null = null;

export function stopAdhan(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
}

function playChime(): boolean {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    chimeContext = chimeContext || new Ctor();
    const ctx = chimeContext;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1.3);
    return true;
  } catch {
    return false;
  }
}

export async function playAdhan(id: string): Promise<boolean> {
  stopAdhan();
  const sound = soundById(id);
  if (sound.id === 'silent') return true;
  if (!sound.url) return playChime();
  try {
    const el = new Audio(sound.url);
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    currentAudio = el;
    await el.play();
    return true;
  } catch {
    return false;
  }
}

export function isAdhanPlaying(): boolean {
  return !!currentAudio && !currentAudio.paused;
}

/* --------------------------------- testing -------------------------------- */

export interface TestResult {
  shown: boolean;
  played: boolean;
}

export async function testAlert(options: { sound: string; vibrate: boolean; city?: string }): Promise<TestResult> {
  const shown = await showAlert({
    title: 'RIFQ Muslim — test notification',
    body: `Notifications are working${options.city ? ` for ${options.city}` : ''}. This is a test, no prayer time was changed.`,
    tag: 'rifq-test',
    vibrate: options.vibrate,
  });
  const played = await playAdhan(options.sound);
  return { shown, played };
}

/* ------------------------------- scheduling ------------------------------- */

export interface AlertPrefs {
  notifyEnabled: boolean;
  prayerAlerts: Record<string, boolean>;
  preReminder: number;
  athanSound: string;
  vibration: boolean;
  dailyQuran: boolean;
  dailyHadith: boolean;
  dailyDua: boolean;
}

export interface AlertContext {
  times: Record<string, Date> | null;
  city: string;
}

const FIRED_KEY = 'rifq.alerts.fired.v1';
const WINDOW_MS = 90_000;

function firedList(): string[] {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function alreadyFired(slot: string): boolean {
  return firedList().includes(slot);
}

function markFired(slot: string): void {
  try {
    const list = firedList();
    list.push(slot);
    localStorage.setItem(FIRED_KEY, JSON.stringify(list.slice(-500)));
  } catch {
    /* storage may be unavailable in private mode */
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Starts the alert loop. Returns a cleanup function.
 * Uses the exact `times` object the UI renders, so no second calculation.
 */
export function startAlertLoop(getContext: () => AlertContext, getPrefs: () => AlertPrefs): () => void {
  const tick = () => {
    const prefs = getPrefs();
    if (!prefs.notifyEnabled || notificationState() !== 'granted') return;
    const { times, city } = getContext();
    const now = Date.now();

    if (times) {
      for (const key of FIVE) {
        const at = times[key];
        if (!(at instanceof Date) || Number.isNaN(at.getTime())) continue;
        if (prefs.prayerAlerts[key] === false) continue;

        const slot = `prayer:${key}:${at.toISOString()}`;
        const diff = now - at.getTime();
        if (diff >= 0 && diff < WINDOW_MS && !alreadyFired(slot)) {
          markFired(slot);
          void showAlert({
            body:
              key === 'fajr'
                ? `Fajr time in ${city}. Prayer is better than sleep.`
                : `${cap(key)} time in ${city}.`,
            tag: slot,
            vibrate: prefs.vibration,
          });
          void playAdhan(prefs.athanSound);
        }

        if (prefs.preReminder > 0) {
          const preSlot = `pre:${slot}`;
          const preAt = at.getTime() - prefs.preReminder * 60_000;
          const preDiff = now - preAt;
          if (preDiff >= 0 && preDiff < WINDOW_MS && !alreadyFired(preSlot)) {
            markFired(preSlot);
            void showAlert({
              body: `${cap(key)} in ${prefs.preReminder} minutes in ${city}.`,
              tag: preSlot,
              vibrate: prefs.vibration,
            });
          }
        }
      }
    }

    // Daily reminders, fired once per day shortly after 09:00 device time.
    const clock = new Date();
    if (clock.getHours() === 9 && clock.getMinutes() < 5) {
      const dayKey = `${clock.getFullYear()}-${clock.getMonth() + 1}-${clock.getDate()}`;
      const reminders: [boolean, string, string][] = [
        [prefs.dailyQuran, 'quran', 'Your daily Quran reading is waiting in RIFQ Muslim.'],
        [prefs.dailyHadith, 'hadith', 'The hadith of the day is ready in RIFQ Muslim.'],
        [prefs.dailyDua, 'dua', 'A dua for today is waiting for you in RIFQ Muslim.'],
      ];
      for (const [enabled, kind, body] of reminders) {
        if (!enabled) continue;
        const slot = `daily:${kind}:${dayKey}`;
        if (alreadyFired(slot)) continue;
        markFired(slot);
        void showAlert({ body, tag: slot, vibrate: prefs.vibration, url: `/${kind === 'quran' ? 'quran' : kind}` });
      }
    }
  };

  void registerServiceWorker();
  tick();
  const id = window.setInterval(tick, 20_000);
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Clears the dedupe memory — used by the "reschedule now" control. */
export function resetAlertMemory(): void {
  try {
    localStorage.removeItem(FIRED_KEY);
  } catch {
    /* ignore */
  }
}

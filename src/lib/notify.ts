/**
 * Notification and Adhan delivery for RIFQ Muslim.
 *
 * One engine drives every notification in the app: the five prayers, the
 * pre-prayer reminder, the daily Quran / hadith / dua reminders, morning and
 * evening adhkar, Islamic occasions and the user's own reminders.
 *
 * Guarantees:
 *  - the schedule is computed once, in `notifyPlan`, from the same prayer-time
 *    objects that render the countdown, so a notification cannot disagree with
 *    the clock on screen;
 *  - every slot is deduplicated in localStorage, so a reload, a second tab or
 *    the 20 s sweep can never deliver the same alert twice;
 *  - on Android the plan is handed to the native alarm scheduler, which is what
 *    makes delivery work when the app is closed (a web page alone cannot);
 *  - audio is a real recording with working play / pause / stop, and the two
 *    non-adhan options are labelled as such instead of pretending.
 */
import { FIVE } from './prayer';
import { OCCASIONS, hijriDate } from './hijri';
import { pushAdhan, pushBanner } from './foreground';
import {
  categoryLabel,
  localDayKey,
  planAlerts,
  dueAlerts,
  upcomingAlerts,
  type CategoryId,
  type CategoryPrefs,
  type CustomReminder,
  type OccasionDate,
  type PlannedAlert,
} from './notifyPlan';

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

/** Categories that are one of the five prayers, i.e. that open the Adhan screen. */
const PRAYER_CATEGORIES: string[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/**
 * The one gate that decides whether a sound id may start the Adhan recording.
 * Only a prayer-time alert qualifies; everything else gets the chime.
 */
function isPrayerAudio(category: string | undefined, sound: string | undefined): boolean {
  if (!sound || sound === 'beep' || sound === 'silent') return false;
  return !!category && PRAYER_CATEGORIES.includes(category);
}

/* ------------------------------- permission ------------------------------- */

export type PermissionState = NotificationPermission | 'unsupported';

export function notificationState(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

export async function requestPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') void registerServiceWorker();
    return result;
  } catch {
    return notificationState();
  }
}

/* ------------------------------ capabilities ------------------------------ */

export interface NativeBridge {
  available: boolean;
  schedulePrayer(id: string, atMillis: number, title: string, body: string): boolean;
  cancelPrayer(id: string): void;
}

function nativeBridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { RifqNativeBridge?: NativeBridge }).RifqNativeBridge;
  return bridge && bridge.available ? bridge : null;
}

export function isNativeApp(): boolean {
  return !!nativeBridge();
}

export type BackgroundMode = 'native-alarm' | 'pwa-push-required' | 'foreground-only';

export interface Capabilities {
  native: boolean;
  ios: boolean;
  standalone: boolean;
  serviceWorker: boolean;
  permission: PermissionState;
  /** How (and whether) alerts can arrive with the app closed. */
  background: BackgroundMode;
  /** Whether the adhan recording itself plays with the app closed. */
  adhanWhenClosed: boolean;
}

export function capabilities(): Capabilities {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);
  const native = isNativeApp();
  return {
    native,
    ios,
    standalone,
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    permission: notificationState(),
    background: native ? 'native-alarm' : ios ? 'pwa-push-required' : 'foreground-only',
    // A native alarm posts a notification; a full adhan recording with the app
    // closed would need a foreground media service, which this build does not
    // ship. Never claim otherwise.
    adhanWhenClosed: false,
  };
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
  /** Set for a prayer alert: enables the expanded image and the action buttons. */
  prayer?: string;
  /** Banner image rendered by the expanded notification. */
  image?: string;
}

/** Shows a branded notification, preferring the native bridge, then the worker. */
export async function showAlert(payload: AlertPayload): Promise<boolean> {
  // A user who is actively using the app must see the alert straight away, even
  // if the system notification is suppressed or permission was declined. The
  // banner is deduplicated by the same tag as the notification.
  pushBanner({
    title: payload.title || 'RIFQ Muslim',
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    kind: /rifq-test/i.test(payload.tag) ? 'test' : 'reminder',
  });

  if (notificationState() !== 'granted') return false;

  if (payload.vibrate && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([250, 120, 250]);
    } catch {
      /* vibration is optional */
    }
  }

  // Inside the Android app `window.Notification` is replaced by the native
  // bridge, so this path posts a real system notification.
  if (nativeBridge()) {
    try {
      new Notification(payload.title || 'RIFQ Muslim', {
        body: payload.body,
        tag: payload.tag,
        icon: '/icons/icon-192.png',
      });
      return true;
    } catch {
      /* fall through */
    }
  }

  const reg = await registerServiceWorker();
  if (reg) {
    try {
      // `image` and `actions` are part of the Notifications spec but are not
      // declared in this TypeScript DOM lib, so the object is asserted to the
      // spec shape instead of being narrowed to the local type.
      const options = {
        body: payload.body,
        tag: payload.tag,
        icon: '/icons/icon-192.png',
        data: { url: payload.url || '/athan', prayer: payload.prayer || null },
        // The adhan recording is played by the page so it can be paused and
        // stopped; the system sound stays silent.
        silent: true,
        // A prayer alert is expandable: banner image, remaining-time title and
        // the three working buttons handled by the service worker.
        image: payload.image || (payload.prayer ? `/notif/prayer-${payload.prayer}.png` : undefined),
        actions: payload.prayer
          ? [
              { action: 'prayed', title: 'Already Prayed' },
              { action: 'snooze', title: 'Remind in 15 min' },
              { action: 'open', title: 'Open App' },
            ]
          : undefined,
        requireInteraction: Boolean(payload.prayer),
      } as NotificationOptions;
      await reg.showNotification(payload.title || 'RIFQ Muslim', options);
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

export interface AudioSnapshot {
  soundId: SoundId | null;
  playing: boolean;
  paused: boolean;
  position: number;
  duration: number;
  label: string;
  error: string | null;
}

const EMPTY_AUDIO: AudioSnapshot = {
  soundId: null,
  playing: false,
  paused: false,
  position: 0,
  duration: 0,
  label: '',
  error: null,
};

let currentAudio: HTMLAudioElement | null = null;
let chimeContext: AudioContext | null = null;
let audioSnapshot: AudioSnapshot = EMPTY_AUDIO;
const audioListeners = new Set<(snapshot: AudioSnapshot) => void>();

function emitAudio(patch: Partial<AudioSnapshot>): void {
  audioSnapshot = { ...audioSnapshot, ...patch };
  for (const listener of audioListeners) {
    try {
      listener(audioSnapshot);
    } catch {
      /* a broken listener must not stop playback */
    }
  }
}

export function subscribeAudio(listener: (snapshot: AudioSnapshot) => void): () => void {
  audioListeners.add(listener);
  listener(audioSnapshot);
  return () => {
    audioListeners.delete(listener);
  };
}

export function audioState(): AudioSnapshot {
  return audioSnapshot;
}

export function isAdhanPlaying(): boolean {
  return !!currentAudio && !currentAudio.paused;
}

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
  emitAudio(EMPTY_AUDIO);
}

export function pauseAdhan(): boolean {
  if (!currentAudio || currentAudio.paused) return false;
  try {
    currentAudio.pause();
    emitAudio({ playing: false, paused: true });
    return true;
  } catch {
    return false;
  }
}

export async function resumeAdhan(): Promise<boolean> {
  if (!currentAudio) return false;
  try {
    await currentAudio.play();
    emitAudio({ playing: true, paused: false, error: null });
    return true;
  } catch {
    return false;
  }
}

export function playChime(): boolean {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    chimeContext = chimeContext || new Ctor();
    const ctx = chimeContext;
    if (ctx.state === 'suspended') void ctx.resume();
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
    emitAudio({ soundId: 'beep', playing: true, paused: false, label: 'Short chime', position: 0, duration: 1.3, error: null });
    window.setTimeout(() => {
      if (audioSnapshot.soundId === 'beep') emitAudio(EMPTY_AUDIO);
    }, 1400);
    return true;
  } catch {
    return false;
  }
}

export async function playAdhan(id: string): Promise<boolean> {
  stopAdhan();
  const sound = soundById(id);

  if (sound.id === 'silent') {
    emitAudio({ soundId: 'silent', label: sound.label, playing: false, paused: false });
    return true;
  }
  if (!sound.url) return playChime();

  try {
    const el = new Audio(sound.url);
    el.preload = 'auto';
    currentAudio = el;

    el.addEventListener('loadedmetadata', () => {
      if (currentAudio !== el) return;
      emitAudio({ duration: Number.isFinite(el.duration) ? el.duration : 0 });
    });
    el.addEventListener('timeupdate', () => {
      if (currentAudio !== el) return;
      emitAudio({ position: el.currentTime });
    });
    el.addEventListener('ended', () => {
      if (currentAudio === el) stopAdhan();
    });
    el.addEventListener('error', () => {
      if (currentAudio === el) {
        currentAudio = null;
        emitAudio({
          ...EMPTY_AUDIO,
          soundId: sound.id,
          label: sound.label,
          error: 'This recording could not be loaded. Check your connection and try again.',
        });
      }
    });

    emitAudio({
      soundId: sound.id,
      label: sound.label,
      playing: false,
      paused: false,
      position: 0,
      duration: 0,
      error: null,
    });

    await el.play();
    emitAudio({ playing: true, paused: false });
    return true;
  } catch {
    currentAudio = null;
    emitAudio({
      ...EMPTY_AUDIO,
      soundId: sound.id,
      label: sound.label,
      error: 'Playback did not start. Check the device volume and try again.',
    });
    return false;
  }
}

/* --------------------------- native alarm bridge --------------------------- */

const NATIVE_KEY = 'rifq.native.alarms.v1';

function readNativeIds(): string[] {
  try {
    const raw = localStorage.getItem(NATIVE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function writeNativeIds(ids: string[]): void {
  try {
    localStorage.setItem(NATIVE_KEY, JSON.stringify(ids.slice(0, 200)));
  } catch {
    /* storage may be unavailable in private mode */
  }
}

export interface NativeSyncResult {
  supported: boolean;
  scheduled: number;
  cancelled: number;
}

/**
 * Hands the next seven days of the plan to the Android alarm scheduler and
 * cancels anything that is no longer planned. This is what delivers alerts when
 * the app is closed; without it the plan would only run while the page is alive.
 */
export function syncNativeSchedule(planned: PlannedAlert[], now: Date): NativeSyncResult {
  const bridge = nativeBridge();
  if (!bridge) return { supported: false, scheduled: 0, cancelled: 0 };

  const upcoming = upcomingAlerts(planned, now, 7 * 86400000, 60);
  const nextIds = new Set<string>();
  let scheduled = 0;

  for (const alert of upcoming) {
    try {
      if (bridge.schedulePrayer(alert.slot, alert.at.getTime(), alert.title, alert.body)) {
        nextIds.add(alert.slot);
        scheduled += 1;
      }
    } catch {
      /* one failed alarm must not stop the rest */
    }
  }

  let cancelled = 0;
  for (const id of readNativeIds()) {
    if (nextIds.has(id)) continue;
    try {
      bridge.cancelPrayer(id);
      cancelled += 1;
    } catch {
      /* nothing to cancel */
    }
  }

  writeNativeIds([...nextIds]);
  return { supported: true, scheduled, cancelled };
}

export function clearNativeSchedule(): void {
  const bridge = nativeBridge();
  if (!bridge) return;
  for (const id of readNativeIds()) {
    try {
      bridge.cancelPrayer(id);
    } catch {
      /* ignore */
    }
  }
  writeNativeIds([]);
}

/* --------------------------------- testing -------------------------------- */

export interface LoopState {
  times: Record<string, Date> | null;
  city: string;
  prefs: {
    notifyEnabled: boolean;
    prayerAlerts: Record<string, boolean>;
    preReminder: number;
    athanSound: string;
    vibration: boolean;
    categories: CategoryPrefs;
    custom: CustomReminder[];
  };
  occasions: OccasionDate[];
}

export function planFor(state: LoopState, now = new Date()): PlannedAlert[] {
  return planAlerts({
    now,
    times: state.times,
    city: state.city,
    prayerAlerts: state.prefs.prayerAlerts,
    preReminder: state.prefs.preReminder,
    vibration: state.prefs.vibration,
    athanSound: state.prefs.athanSound,
    notifySound: state.prefs.notifySound,
    athanAudio: state.prefs.adhanAudio,
    categories: state.prefs.categories,
    custom: state.prefs.custom,
    occasions: state.occasions,
  });
}

/** The next alert of one category, used by the per-category test buttons. */
export function sampleFor(state: LoopState, category: CategoryId): PlannedAlert | null {
  const planned = planFor(state);
  return planned.find((a) => a.category === category) || null;
}

export interface TestResult {
  shown: boolean;
  played: boolean;
  title: string;
  body: string;
  sound: string;
}

/**
 * Delivers a real notification for one category, using the wording that
 * category would actually produce. The tag carries a timestamp so a test is
 * never suppressed by the dedupe memory.
 */
export async function testCategory(category: CategoryId, state: LoopState): Promise<TestResult> {
  const sample = sampleFor(state, category);
  const title = sample ? `Test — ${sample.title}` : 'RIFQ Muslim — test notification';
  const body = sample
    ? sample.body
    : `Notifications are working for ${state.city}. This is a test; no prayer time was changed.`;
  const sound =
    sample?.sound ||
    (PRAYER_CATEGORIES.includes(category) ? state.prefs.athanSound : 'beep');

  const shown = await showAlert({
    title,
    body,
    tag: `rifq-test:${category}:${Date.now()}`,
    vibrate: sample?.vibrate ?? state.prefs.vibration,
    url: sample?.url,
    prayer: PRAYER_CATEGORIES.includes(category) ? String(category) : undefined,
  });
  // A prayer test reproduces the real prayer experience: the banner and the
  // in-app Adhan card with its "Already Prayed" and "Remind in 15 min"
  // buttons, so the buttons can be exercised without waiting for a prayer.
  if (PRAYER_CATEGORIES.includes(category)) {
    pushAdhan({
      title: sample?.title || 'Prayer reminder',
      body,
      prayer: String(category),
      sound,
      tag: `test:${category}:${Date.now()}`,
    });
  }

  // A reminder test must never play the Adhan recording.
  const played = isPrayerAudio(category, sound) ? await playAdhan(sound) : playChime();
  return { shown, played, title, body, sound };
}

/** Kept for the simple "send a test notification" button. */
export async function testAlert(options: {
  sound: string;
  vibrate: boolean;
  city?: string;
}): Promise<TestResult> {
  const title = 'RIFQ Muslim — test notification';
  const body = `Notifications are working${options.city ? ` for ${options.city}` : ''}. This is a test, no prayer time was changed.`;
  const shown = await showAlert({ title, body, tag: `rifq-test:${Date.now()}`, vibrate: options.vibrate });
  const played = await playAdhan(options.sound);
  return { shown, played, title, body, sound: options.sound };
}

/* ------------------------------- scheduling ------------------------------- */

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

function markFired(slot: string): void {
  try {
    const list = firedList();
    if (list.includes(slot)) return;
    list.push(slot);
    localStorage.setItem(FIRED_KEY, JSON.stringify(list.slice(-800)));
  } catch {
    /* storage may be unavailable in private mode */
  }
}

/** Clears the dedupe memory — used by the "reschedule now" control. */
export function resetAlertMemory(): void {
  try {
    localStorage.removeItem(FIRED_KEY);
  } catch {
    /* ignore */
  }
}

function syncSignature(state: LoopState, now: Date): string {
  return JSON.stringify({
    day: localDayKey(now),
    times: state.times
      ? Object.fromEntries(Object.entries(state.times).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : null]))
      : null,
    prayers: state.prefs.prayerAlerts,
    pre: state.prefs.preReminder,
    sound: state.prefs.athanSound,
    categories: state.prefs.categories,
    custom: state.prefs.custom,
    occasions: state.occasions,
    enabled: state.prefs.notifyEnabled,
  });
}

/**
 * Starts the alert loop. Returns a cleanup function.
 * Runs every 20 s, on return to the foreground, and immediately on start.
 */
export function startAlertLoop(getState: () => LoopState): () => void {
  let lastSync = '';

  const tick = () => {
    const state = getState();
    const now = new Date();
    const enabled = state.prefs.notifyEnabled && notificationState() === 'granted';
    const planned = planFor(state, now);

    if (!enabled) {
      // Turning notifications off must also cancel the Android alarms, or they
      // would still fire while the app is closed.
      if (lastSync !== 'off') {
        lastSync = 'off';
        clearNativeSchedule();
      }
      return;
    }

    for (const alert of dueAlerts(planned, now, WINDOW_MS, firedList())) {
      markFired(alert.slot);
      void showAlert({
        title: alert.title,
        body: alert.body,
        tag: alert.slot,
        vibrate: alert.vibrate,
        url: alert.url,
        // A prayer alert carries its key, so the device renders the expanded
        // card with the banner image and the three action buttons.
        prayer: PRAYER_CATEGORIES.includes(alert.category) ? String(alert.category) : undefined,
      });
      // With the app open, a prayer also opens the branded Adhan screen; the
      // Adhan recording itself is started from there, so it is never played
      // twice for the same slot.
      if (PRAYER_CATEGORIES.includes(alert.category)) {
        pushAdhan({
          title: alert.title,
          body: alert.body,
          prayer: alert.category,
          sound: alert.sound,
          tag: alert.slot,
        });
      }
      // The Adhan recording belongs to the prayer time itself. Reminders,
      // pre-prayer notices and admin messages get the general sound instead.
      if (alert.sound === 'silent') {
        /* the user chose silence for this category */
      } else if (isPrayerAudio(alert.category, alert.sound)) {
        void playAdhan(alert.sound);
      } else {
        playChime();
      }
    }

    const signature = syncSignature(state, now);
    if (signature !== lastSync) {
      lastSync = signature;
      syncNativeSchedule(planned, now);
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

/* -------------------------------- occasions ------------------------------- */

/** Islamic occasions falling in the next `days` days, as local date keys. */
export function upcomingOccasionAlerts(now: Date, days = 8): OccasionDate[] {
  const out: OccasionDate[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const hijri = hijriDate(day);
    if (!hijri) continue;
    const occasion = OCCASIONS.find((o) => o.month === hijri.month && o.day === hijri.day);
    if (occasion) {
      out.push({ name: occasion.title, date: localDayKey(day), note: occasion.note });
    }
  }
  return out;
}

/* ------------------------------- UI helpers ------------------------------- */

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
  pre: 'Pre-prayer reminder',
  quran: categoryLabel('quran'),
  hadith: categoryLabel('hadith'),
  dua: categoryLabel('dua'),
  adhkarMorning: categoryLabel('adhkarMorning'),
  adhkarEvening: categoryLabel('adhkarEvening'),
  occasions: categoryLabel('occasions'),
  custom: 'Your reminders',
};

export { FIVE };

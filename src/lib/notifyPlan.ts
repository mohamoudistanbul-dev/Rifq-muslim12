/**
 * Pure notification planning.
 *
 * This module contains no DOM, no storage and no timers, so the whole schedule
 * (prayers, pre-prayer reminders, daily reminders, adhkar, Islamic occasions and
 * user-created reminders) can be tested in Node with `npm run verify:notify`.
 *
 * The app, the Adhan screen preview and the Android alarm scheduler all consume
 * these exact objects, so a delivered notification can never disagree with what
 * the screen lists.
 */

export const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerKey = (typeof PRAYER_KEYS)[number];

export const DAILY_CATEGORIES = [
  'quran',
  'hadith',
  'dua',
  'adhkarMorning',
  'adhkarEvening',
  'occasions',
] as const;
export type DailyCategory = (typeof DAILY_CATEGORIES)[number];

export type CategoryId = PrayerKey | 'pre' | DailyCategory | 'custom';
export type Frequency = 'daily' | 'weekdays' | 'friday' | 'once';

export interface CategoryPref {
  enabled: boolean;
  /** Local wall-clock time, `HH:MM`. */
  time: string;
  /** Sound id from ADHAN_SOUNDS, or `default`. */
  sound: string;
  vibrate: boolean;
  frequency: Frequency;
}

export type CategoryPrefs = Record<DailyCategory, CategoryPref>;

export interface CustomReminder {
  id: string;
  title: string;
  body: string;
  /** Local wall-clock time, `HH:MM`. */
  time: string;
  frequency: 'daily' | 'weekly' | 'once';
  /** `YYYY-MM-DD`; anchors a weekly reminder and dates a one-off. */
  date?: string;
  enabled: boolean;
}

export interface OccasionDate {
  name: string;
  /** Local `YYYY-MM-DD`. */
  date: string;
  note?: string;
}

export interface PlanInput {
  /** General notification sound for reminders: `beep` (chime) or `silent`. */
  notifySound?: string;
  /** Per-prayer Adhan audio switches; a missing key means enabled. */
  athanAudio?: Record<string, boolean>;
  now: Date;
  /** Today's prayer times, from the same engine that renders the countdown. */
  times: Record<string, Date> | null;
  city: string;
  prayerAlerts: Record<string, boolean>;
  /** Minutes before the adhan, 0 = off. */
  preReminder: number;
  vibration: boolean;
  athanSound: string;
  categories: CategoryPrefs;
  custom: CustomReminder[];
  occasions: OccasionDate[];
  /** How many days of daily reminders to lay out. Default 8. */
  days?: number;
}

export interface PlannedAlert {
  /** Stable dedupe key: one alert per slot, ever. */
  slot: string;
  category: CategoryId;
  at: Date;
  title: string;
  body: string;
  sound: string;
  vibrate: boolean;
  url: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseHHMM(value: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Builds a Date at a local wall-clock time on the calendar day of `day`. */
export function atLocal(day: Date, time: string): Date | null {
  const parsed = parseHHMM(time);
  if (!parsed) return null;
  const out = new Date(day.getFullYear(), day.getMonth(), day.getDate(), parsed.h, parsed.m, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}

function dayAllows(day: Date, frequency: Frequency): boolean {
  const dow = day.getDay();
  if (frequency === 'weekdays') return dow >= 1 && dow <= 5;
  if (frequency === 'friday') return dow === 5;
  return true;
}

const DAILY_COPY: Record<DailyCategory, { label: string; body: string; url: string }> = {
  quran: {
    label: 'Daily Quran reminder',
    body: 'Your daily Quran reading is waiting in RIFQ Muslim.',
    url: '/quran',
  },
  hadith: {
    label: 'Daily hadith reminder',
    body: 'The hadith of the day is ready in RIFQ Muslim.',
    url: '/hadith',
  },
  dua: {
    label: 'Daily dua reminder',
    body: 'A dua for today is waiting for you in RIFQ Muslim.',
    url: '/duas',
  },
  adhkarMorning: {
    label: 'Morning adhkar reminder',
    body: 'Morning adhkar — begin the day with the remembrance of Allah.',
    url: '/duas',
  },
  adhkarEvening: {
    label: 'Evening adhkar reminder',
    body: 'Evening adhkar — end the day with the remembrance of Allah.',
    url: '/duas',
  },
  occasions: {
    label: 'Islamic occasion reminder',
    body: 'An Islamic occasion is on the calendar today.',
    url: '/calendar',
  },
};

export function categoryLabel(category: DailyCategory): string {
  return DAILY_COPY[category].label;
}

/**
 * Audio routing — the single Adhan rule for the whole app.
 *
 * The Adhan recording is reserved for one event: a real prayer time arriving.
 * Pre-prayer notices, Quran/Hadith/Dua reminders, adhkar, Islamic occasions,
 * user reminders and admin messages all use the general notification sound (or
 * silence). Because the app, the Adhan screen and the native alarm scheduler
 * all read these helpers, none of them can start drifting apart.
 */
export const NOTIFY_SOUND_IDS = ['beep', 'silent'] as const;
export type NotifySoundId = (typeof NOTIFY_SOUND_IDS)[number];

export function normalizeNotifySound(id: string | undefined): NotifySoundId {
  return id === 'silent' ? 'silent' : 'beep';
}

/** Sound for a daily reminder, user reminder or admin message. */
export function reminderSound(prefSound: string | undefined, general: string | undefined): string {
  const g = normalizeNotifySound(general);
  if (prefSound === 'default') return g;
  if (prefSound && (NOTIFY_SOUND_IDS as readonly string[]).includes(prefSound)) return prefSound;
  // An Adhan id saved by an older build must never fire on a reminder.
  return g;
}

/** Sound for a prayer alert: the Adhan only while that prayer's audio is on. */
export function prayerSound(
  athanSound: string | undefined,
  audioEnabled: boolean | undefined
): string {
  return audioEnabled && athanSound && athanSound !== 'silent' ? athanSound : 'beep';
}

/** True only for a real prayer alert that carries an Adhan recording. */
export function isPrayerAudio(category: string, sound: string): boolean {
  return (
    (PRAYER_KEYS as readonly string[]).includes(category) &&
    sound !== 'beep' &&
    sound !== 'silent'
  );
}

/** Lays out every alert the app can deliver, newest last. */
export function planAlerts(input: PlanInput): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  const city = input.city || 'your city';

  if (input.times) {
    for (const key of PRAYER_KEYS) {
      const at = input.times[key];
      if (!(at instanceof Date) || Number.isNaN(at.getTime())) continue;
      if (input.prayerAlerts[key] === false) continue;

      out.push({
        slot: `prayer:${key}:${at.toISOString()}`,
        category: key,
        at,
        title: `RIFQ Muslim — ${cap(key)}`,
        body:
          key === 'fajr'
            ? `Fajr time in ${city}. Prayer is better than sleep.`
            : `${cap(key)} time in ${city}.`,
        sound: prayerSound(input.athanSound, input.athanAudio?.[key] !== false),
        vibrate: input.vibration,
        url: '/athan',
      });

      if (input.preReminder > 0) {
        out.push({
          slot: `pre:${key}:${at.toISOString()}`,
          category: 'pre',
          at: new Date(at.getTime() - input.preReminder * 60_000),
          title: `RIFQ Muslim — ${cap(key)} soon`,
          body: `${cap(key)} in ${input.preReminder} minutes in ${city}.`,
          sound: normalizeNotifySound(input.notifySound),
          vibrate: input.vibration,
          url: '/athan',
        });
      }
    }
  }

  const days = Math.max(1, Math.min(31, input.days ?? 8));
  const occasionByDay = new Map(input.occasions.map((o) => [o.date, o]));

  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate() + offset);
    const dayKey = localDayKey(day);

    for (const category of DAILY_CATEGORIES) {
      const pref = input.categories[category];
      if (!pref || !pref.enabled) continue;
      if (!dayAllows(day, pref.frequency)) continue;
      const at = atLocal(day, pref.time);
      if (!at) continue;

      const copy = DAILY_COPY[category];
      let body = copy.body;
      let title = `RIFQ Muslim — ${copy.label.replace(' reminder', '')}`;

      if (category === 'occasions') {
        const occasion = occasionByDay.get(dayKey);
        if (!occasion) continue;
        title = `RIFQ Muslim — ${occasion.name}`;
        body = occasion.note
          ? `${occasion.name}. ${occasion.note}. Confirm the date with your local mosque.`
          : `${occasion.name} is today. Confirm the date with your local mosque.`;
      }

      out.push({
        slot: `daily:${category}:${dayKey}`,
        category,
        at,
        title,
        body,
        sound: reminderSound(pref.sound, input.notifySound),
        vibrate: pref.vibrate,
        url: copy.url,
      });
    }

    for (const reminder of input.custom) {
      if (!reminder.enabled) continue;
      const at = atLocal(day, reminder.time);
      if (!at) continue;
      if (reminder.frequency === 'once' && reminder.date !== dayKey) continue;
      if (reminder.frequency === 'weekly') {
        const anchor = reminder.date ? new Date(`${reminder.date}T12:00:00`) : input.now;
        if (!Number.isNaN(anchor.getTime()) && anchor.getDay() !== day.getDay()) continue;
      }
      out.push({
        slot: `custom:${reminder.id}:${dayKey}`,
        category: 'custom',
        at,
        title: `RIFQ Muslim — ${reminder.title || 'Reminder'}`,
        body: reminder.body || reminder.title || 'Your reminder from RIFQ Muslim.',
        sound: normalizeNotifySound(input.notifySound),
        vibrate: true,
        url: '/more',
      });
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

/** Alerts whose time has arrived within the delivery window and not fired yet. */
export function dueAlerts(
  planned: PlannedAlert[],
  now: Date,
  windowMs: number,
  fired: Iterable<string>
): PlannedAlert[] {
  const seen = new Set(fired);
  const picked: PlannedAlert[] = [];
  const used = new Set<string>();
  for (const alert of planned) {
    const diff = now.getTime() - alert.at.getTime();
    if (diff < 0 || diff >= windowMs) continue;
    if (seen.has(alert.slot) || used.has(alert.slot)) continue;
    used.add(alert.slot);
    picked.push(alert);
  }
  return picked;
}

/** Future alerts, for the native alarm scheduler and the "next up" line. */
export function upcomingAlerts(
  planned: PlannedAlert[],
  now: Date,
  horizonMs: number,
  limit = 40
): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  for (const alert of planned) {
    const delta = alert.at.getTime() - now.getTime();
    if (delta <= 0 || delta > horizonMs) continue;
    out.push(alert);
    if (out.length >= limit) break;
  }
  return out;
}

export function nextAlert(planned: PlannedAlert[], now: Date): PlannedAlert | null {
  for (const alert of planned) {
    if (alert.at.getTime() > now.getTime()) return alert;
  }
  return null;
}

/** `HH:MM` in a given timezone, used to show a reminder's time next to a city. */
export function formatClock(date: Date, timeZone?: string, hour12 = true): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12,
      timeZone,
    }).format(date);
  } catch {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}

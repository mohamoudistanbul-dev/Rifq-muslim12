/**
 * Foreground alert bus for RIFQ Muslim.
 *
 * A web page cannot draw a system heads-up banner by itself, and a user who is
 * actively reading the app should still see an alert immediately instead of
 * waiting for the notification shade. This module is the single channel the
 * notification engine uses to raise:
 *
 *  - a floating banner at the top of the screen for any alert category, and
 *  - the full-screen Adhan screen when a prayer time arrives while the app is open.
 *
 * Both are fed by the same planned alert that produced the system notification,
 * so the banner, the Adhan screen and the notification can never disagree.
 * Delivery is deduplicated by tag, because the alert loop sweeps every 20 s and
 * must not repeat itself.
 */

export type ForegroundKind = 'prayer' | 'reminder' | 'admin' | 'test';

export interface ForegroundBanner {
  id: string;
  title: string;
  body: string;
  /** Screen the banner opens when tapped. */
  url: string;
  kind: ForegroundKind;
}

export interface AdhanCall {
  id: string;
  title: string;
  body: string;
  /** Prayer key: fajr, dhuhr, asr, maghrib or isha. */
  prayer: string;
  /** Sound id from notify.ts, so the Adhan screen plays the chosen recording. */
  sound: string;
}

const bannerListeners = new Set<(banner: ForegroundBanner) => void>();
const adhanListeners = new Set<(call: AdhanCall) => void>();
const seen = new Map<string, number>();
const SEEN_MS = 60_000;
let counter = 0;

/** True only while the page is actually on screen. */
export function isForeground(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function firstTime(key: string): boolean {
  const now = Date.now();
  for (const [id, at] of seen) {
    if (now - at > SEEN_MS) seen.delete(id);
  }
  if (seen.has(key)) return false;
  seen.set(key, now);
  return true;
}

export function onBanner(listener: (banner: ForegroundBanner) => void): () => void {
  bannerListeners.add(listener);
  return () => {
    bannerListeners.delete(listener);
  };
}

export function onAdhan(listener: (call: AdhanCall) => void): () => void {
  adhanListeners.add(listener);
  return () => {
    adhanListeners.delete(listener);
  };
}

/** Raises an in-app banner. Returns null when the app is not visible. */
export function pushBanner(input: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  kind?: ForegroundKind;
}): ForegroundBanner | null {
  if (!isForeground()) return null;
  const key = input.tag ? `banner:${input.tag}` : `banner:${input.title}|${input.body}`;
  if (!firstTime(key)) return null;
  counter += 1;
  const banner: ForegroundBanner = {
    id: `${Date.now()}-${counter}`,
    title: input.title || 'RIFQ Muslim',
    body: input.body,
    url: input.url || '/notifications',
    kind: input.kind || 'reminder',
  };
  for (const listener of bannerListeners) {
    try {
      listener(banner);
    } catch {
      /* a broken listener must not stop delivery */
    }
  }
  return banner;
}

/** Opens the Adhan screen for a prayer that has just arrived. */
export function pushAdhan(input: {
  title: string;
  body: string;
  prayer: string;
  sound: string;
  tag?: string;
}): AdhanCall | null {
  if (!isForeground()) return null;
  const key = input.tag ? `adhan:${input.tag}` : `adhan:${input.prayer}|${input.title}`;
  if (!firstTime(key)) return null;
  counter += 1;
  const call: AdhanCall = {
    id: `${Date.now()}-${counter}`,
    title: input.title,
    body: input.body,
    prayer: input.prayer,
    sound: input.sound,
  };
  for (const listener of adhanListeners) {
    try {
      listener(call);
    } catch {
      /* a broken listener must not stop delivery */
    }
  }
  return call;
}

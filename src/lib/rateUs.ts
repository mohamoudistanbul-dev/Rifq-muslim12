/**
 * Rate Us.
 *
 * The app is not on Google Play or the App Store yet, so this module never
 * invents a listing address: it reads the official store links the Super Admin
 * saved in Website settings (/api/config → playStoreUrl / appStoreUrl) and
 * reports "not published" when they are empty.
 *
 * Order of preference:
 *  1. the native in-app review dialog (Play Core / StoreKit), when the packaged
 *     app exposes the bridge method;
 *  2. the official store listing, when a link is configured;
 *  3. a friendly explanation plus direct feedback channels.
 */

import { get } from './api';

export interface StoreLinks {
  playStoreUrl: string;
  appStoreUrl: string;
  contactEmail: string;
}

interface NativeBridge {
  requestReview?: () => boolean | void;
}

const PROMPT_KEY = 'rate.promptedAt';
const PROMPT_INTERVAL = 120 * 24 * 60 * 60 * 1000; // at most once every 120 days

function bridge(): NativeBridge | null {
  const candidate =
    (window as unknown as { RifqNative?: NativeBridge }).RifqNative ||
    (window as unknown as { RifqNativeBridge?: NativeBridge }).RifqNativeBridge;
  return candidate || null;
}

/** True when the packaged Android/iOS build can show the native review dialog. */
export function hasNativeReview(): boolean {
  const native = bridge();
  return Boolean(native && typeof native.requestReview === 'function');
}

/** Ask the native shell for the in-app review flow. Returns false when unavailable. */
export function requestNativeReview(): boolean {
  const native = bridge();
  if (!native || typeof native.requestReview !== 'function') return false;
  try {
    native.requestReview();
    return true;
  } catch {
    return false;
  }
}

export type Platform = 'android' | 'ios' | 'other';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'other';
}

export async function loadStoreLinks(): Promise<StoreLinks> {
  const config = await get<{
    playStoreUrl?: string;
    appStoreUrl?: string;
    contactEmail?: string;
  }>('/config');
  return {
    playStoreUrl: (config.playStoreUrl || '').trim(),
    appStoreUrl: (config.appStoreUrl || '').trim(),
    contactEmail: (config.contactEmail || 'rifqmuslim@gmail.com').trim(),
  };
}

/**
 * Whether a gentle "enjoying RIFQ Muslim?" prompt may be shown now.
 * It is deliberately rare, and never shown twice for the same install period.
 */
export function promptDue(): boolean {
  try {
    const last = Number(localStorage.getItem(PROMPT_KEY) || 0);
    return !last || Date.now() - last > PROMPT_INTERVAL;
  } catch {
    return false;
  }
}

export function markPrompted(): void {
  try {
    localStorage.setItem(PROMPT_KEY, String(Date.now()));
  } catch {
    /* storage unavailable — prompt simply stays due */
  }
}

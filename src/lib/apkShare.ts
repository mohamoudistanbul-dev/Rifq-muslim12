/**
 * Real Android APK delivery for the Invite Friends section.
 *
 * The installation file is streamed from our own origin
 * (/download/RIFQ-Muslim.apk), so the browser can read the actual bytes with
 * progress, save them as RIFQ-Muslim.apk, and hand the very same file to the
 * Android share sheet (WhatsApp, Telegram, Bluetooth, ...). No download page,
 * link or QR code is involved anywhere in this flow.
 */
import { APK_FILENAME, APK_PATH } from './download';

export const APK_MIME = 'application/vnd.android.package-archive';

/** Short invitation body. Deliberately contains no URL. */
export const INVITE_MESSAGE =
  'Prayer times, the Holy Quran, authentic Hadith, Qibla and daily worship in one app. ' +
  'Made by Eng Mohamud Yusuf.';

export type Platform = 'android' | 'ios' | 'other';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  // iPadOS 13+ reports a desktop Safari agent but still reports touch points.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

export interface ApkProgress {
  received: number;
  total: number;
  /** 0-100. Stays 0 while the size is still unknown. */
  percent: number;
}

export type ApkFailure = 'not_published' | 'unreachable' | 'network' | 'empty';

export class ApkError extends Error {
  readonly code: ApkFailure;

  constructor(code: ApkFailure, message: string) {
    super(message);
    this.name = 'ApkError';
    this.code = code;
  }
}

/**
 * Downloads the APK into memory, reporting real progress as bytes arrive.
 *
 * fetch() rather than a navigation is what makes progress possible: the
 * response body is read chunk by chunk, so the user sees actual megabytes
 * instead of an indefinite spinner.
 */
export async function fetchApkFile(
  onProgress?: (progress: ApkProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(APK_PATH, {
      signal,
      cache: 'no-store',
      headers: { Accept: APK_MIME },
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApkError('network', 'The app file could not be downloaded. Check your connection and try again.');
  }

  if (res.status === 503) {
    throw new ApkError('not_published', 'The Android app file is not published yet. Please try again soon.');
  }
  if (res.status === 502) {
    throw new ApkError('unreachable', 'The app file could not be reached right now. Please try again.');
  }
  if (!res.ok) {
    throw new ApkError('unreachable', `The app file could not be downloaded (error ${res.status}).`);
  }

  const total = Number(res.headers.get('content-length') || 0) || 0;

  if (!res.body) {
    const whole = await res.blob();
    const done: ApkProgress = { received: whole.size, total: whole.size || total, percent: 100 };
    onProgress?.(done);
    return whole;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.length;
    onProgress?.({
      received,
      total,
      percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
    });
  }

  const blob = new Blob(chunks as unknown as BlobPart[], { type: APK_MIME });
  if (blob.size === 0) {
    throw new ApkError('empty', 'The app file came back empty. Please try again.');
  }
  onProgress?.({ received: blob.size, total: blob.size || total, percent: 100 });
  return blob;
}

/**
 * Saves the already-downloaded file as RIFQ-Muslim.apk.
 *
 * Returns false when this browser/WebView cannot save a Blob, so the caller can
 * fall back to the server's own attachment response instead of failing.
 */
export function saveApkFile(blob: Blob): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  if (!('download' in anchor)) {
    URL.revokeObjectURL(url);
    return false;
  }

  anchor.href = url;
  anchor.download = APK_FILENAME;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // The download manager may still be reading the blob; release it later.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

type ShareNavigator = {
  share?: (data: { title?: string; text?: string; files?: File[] }) => Promise<void>;
  canShare?: (data?: { title?: string; text?: string; files?: File[] }) => boolean;
};

function shareNavigator(): ShareNavigator | null {
  if (typeof navigator === 'undefined') return null;
  return navigator as unknown as ShareNavigator;
}

/** True when this device can attach a file to the system share sheet. */
export function canShareApkFile(): boolean {
  const nav = shareNavigator();
  return !!nav && typeof nav.share === 'function' && typeof nav.canShare === 'function';
}

/**
 * Hands the real APK to the platform share sheet.
 *
 * Returns 'file' when the installation file itself was shared, or 'text' when
 * the platform cannot attach files and only the invitation text went out.
 * Throws with name 'AbortError' if the user closes the sheet.
 */
export async function shareApkFile(blob: Blob, text = INVITE_MESSAGE): Promise<'file' | 'text'> {
  const nav = shareNavigator();
  if (!nav || typeof nav.share !== 'function') {
    throw new Error('share-unsupported');
  }

  const file = new File([blob], APK_FILENAME, { type: APK_MIME, lastModified: Date.now() });

  let withFile = false;
  if (typeof nav.canShare === 'function') {
    try {
      withFile = nav.canShare({ files: [file] });
    } catch {
      withFile = false;
    }
  }

  if (withFile) {
    await nav.share({ files: [file], title: 'RIFQ Muslim', text });
    return 'file';
  }

  await nav.share({ title: 'RIFQ Muslim', text });
  return 'text';
}

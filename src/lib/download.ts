import { get } from './api';

export interface ApkInfo {
  configured: boolean;
  filename: string;
  url: string;
  size: number | null;
}

export const APK_FILENAME = 'RIFQ-Muslim.apk';
export const APK_PATH = `/download/${APK_FILENAME}`;

const FALLBACK: ApkInfo = { configured: false, filename: APK_FILENAME, url: APK_PATH, size: null };

export async function fetchApkInfo(): Promise<ApkInfo> {
  try {
    return await get<ApkInfo>('/download/info');
  } catch {
    return FALLBACK;
  }
}

/**
 * Start the APK download.
 *
 * A plain navigation (not fetch/XHR) is what works on real Android devices:
 * Chrome hands the response to the Download Manager, which shows its own
 * progress notification, survives a screen lock and can resume a partial file.
 * The server answers with `Content-Disposition: attachment` so the saved file is
 * always named RIFQ-Muslim.apk.
 */
export function startApkDownload(url: string = APK_PATH) {
  window.location.assign(url);
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Public download portal + invitation helpers.
 *
 * Every invitation, QR code and social button shares ONE permanent address:
 * `/download` on this deployment (or PUBLIC_APP_URL once a custom domain is
 * attached). The portal itself decides what to offer the visitor's device, so a
 * single link works for Android and iPhone without ever sending an APK to an
 * iPhone.
 *
 * Nothing here invents a link: when the server has not reported a portal
 * address the current origin is used.
 */

export const PORTAL_PATH = '/download';

/** Exact wording requested for every invitation. */
export const INVITE_PREFIX = 'Join me on Rifq Muslim! Download the app here:';

export type Platform = 'android' | 'ios' | 'other';

/**
 * Android or iPhone detection.
 *
 * `?platform=android|ios` is an explicit override, used by the manual switch on
 * the portal and by the automated checks, so the two layouts can be verified
 * without a real phone.
 */
export function detectPlatform(search: string, userAgent: string, touchPoints: number): Platform {
  const override = new URLSearchParams(search).get('platform');
  if (override === 'android' || override === 'ios') return override;
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  // iPadOS 13+ reports a desktop Safari agent but still reports touch points.
  if (/Macintosh/i.test(userAgent) && touchPoints > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

/** Detection for the current browser. */
export function platformHere(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  return detectPlatform(window.location.search, navigator.userAgent || '', navigator.maxTouchPoints || 0);
}

/** The permanent public download page address. */
export function portalUrl(configured?: string | null): string {
  const value = String(configured || '').trim();
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value;
  if (typeof window === 'undefined') return PORTAL_PATH;
  return `${window.location.origin}${PORTAL_PATH}`;
}

/** The invitation body, including the portal address. */
export function inviteMessage(url: string): string {
  return `${INVITE_PREFIX} ${url}`;
}

/** Clipboard write with a fallback for browsers and WebViews without the async API. */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

export interface ShareChannel {
  id: 'whatsapp' | 'telegram' | 'messenger' | 'facebook' | 'sms';
  label: string;
  color: string;
  /** Some channels take the link, some the whole invitation text. */
  href: (url: string, message: string) => string;
}

/**
 * Direct channel buttons. The native share sheet is still the primary action —
 * these are shortcuts for the apps people actually use, and they work in a
 * plain browser where navigator.share is unavailable.
 */
export const SHARE_CHANNELS: ShareChannel[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    color: '#25D366',
    href: (_url, message) => `https://wa.me/?text=${encodeURIComponent(message)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    color: '#229ED9',
    href: (url, message) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`,
  },
  {
    id: 'messenger',
    label: 'Messenger',
    color: '#0084FF',
    href: (url) => `fb-messenger://share/?link=${encodeURIComponent(url)}`,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    color: '#1877F2',
    href: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: 'sms',
    label: 'SMS',
    color: '#d4af37',
    href: (_url, message) => `sms:?&body=${encodeURIComponent(message)}`,
  },
];

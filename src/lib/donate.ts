/**
 * PayPal donation link helpers.
 *
 * The owner's link is never hardcoded: it arrives from `/api/config`, which
 * reads PAYPAL_DONATE_URL or the Super Admin setting. Everything here is pure so
 * the amount handling can be verified without a browser, and an invalid or
 * missing link simply produces no href — the UI then says so honestly instead of
 * sending people to a made-up address.
 */

const PAYPAL_HOSTS = ['paypal.com', 'www.paypal.com', 'paypal.me', 'www.paypal.me'];

/** Suggested amounts offered next to the donate button. */
export const DONATION_PRESETS = [5, 10, 20, 50] as const;

/** Guard rail for the "Other" amount field. */
export const MAX_DONATION = 100000;

export type AmountMode = 'placeholder' | 'paypal-me' | 'none';

/** True only for real PayPal hosts over HTTPS — no look-alike domains. */
export function isPaypalUrl(raw: string): boolean {
  const value = (raw || '').trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return PAYPAL_HOSTS.includes(host) || host.endsWith('.paypal.com');
  } catch {
    return false;
  }
}

/**
 * How the configured link can carry a chosen amount:
 *  - `placeholder`: the link contains `{amount}` (hosted donate button, etc.)
 *  - `paypal-me`:   a paypal.me/<handle> link, which accepts /<amount>
 *  - `none`:        the amount is chosen on PayPal's own page
 */
export function amountMode(raw: string): AmountMode {
  if (!isPaypalUrl(raw)) return 'none';
  if (raw.includes('{amount}')) return 'placeholder';
  const host = new URL(raw.trim()).hostname.toLowerCase();
  return host === 'paypal.me' || host === 'www.paypal.me' ? 'paypal-me' : 'none';
}

/** A positive amount with at most two decimals, or null when unusable. */
export function sanitizeAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const n = typeof input === 'number' ? input : Number(String(input).replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0 || n > MAX_DONATION) return null;
  return Math.round(n * 100) / 100;
}

/** The final PayPal URL for a chosen amount (null = let PayPal ask). */
export function buildDonateUrl(raw: string, amount?: number | null): string {
  const base = (raw || '').trim();
  if (!isPaypalUrl(base)) return '';

  const mode = amountMode(base);
  const safe = sanitizeAmount(amount ?? null);

  if (mode === 'placeholder') {
    if (safe) return base.replace(/\{amount\}/g, String(safe));
    // No amount chosen: drop the empty parameter rather than send a broken link.
    return base
      .replace(/([?&])amount=\{amount\}(&?)/g, (_match, sep: string, amp: string) =>
        sep === '?' && amp ? '?' : amp ? sep : '',
      )
      .replace(/[?&]$/, '');
  }

  if (mode === 'paypal-me' && safe) {
    const url = new URL(base);
    const handle = url.pathname.replace(/\/+$/, '').replace(/\/\d+(\.\d+)?$/, '');
    url.pathname = `${handle}/${safe}`;
    return url.toString();
  }

  return base;
}

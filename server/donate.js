import { getSetting } from './db.js';

/**
 * International donations.
 *
 * The PayPal link belongs to the account owner: it comes from PAYPAL_DONATE_URL
 * or from the Super Admin dashboard. It is never hardcoded here, and when it is
 * missing or is not a real PayPal HTTPS URL we report "not configured" instead
 * of inventing a link. No PayPal client id/secret is needed for a donation link,
 * so none is read, stored or sent to the browser.
 */

const PAYPAL_HOSTS = ['paypal.com', 'www.paypal.com', 'paypal.me', 'www.paypal.me'];

/** Only real PayPal hosts over HTTPS; look-alike domains are rejected. */
export function normalizeDonateUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  const host = url.hostname.toLowerCase();
  if (!PAYPAL_HOSTS.includes(host) && !host.endsWith('.paypal.com')) return '';
  // Keep an `{amount}` placeholder readable instead of percent-encoded.
  return url.toString().replace(/%7B/gi, '{').replace(/%7D/gi, '}');
}

/** The owner's donation link, or '' when nothing valid is configured. */
export function donateUrl() {
  return normalizeDonateUrl(process.env.PAYPAL_DONATE_URL || getSetting('paypal_donate_url', ''));
}

/** ISO currency for the donation amount chips (defaults to USD). */
export function donateCurrency() {
  const raw = String(process.env.PAYPAL_CURRENCY || getSetting('paypal_currency', 'USD') || 'USD').toUpperCase();
  return /^[A-Z]{3}$/.test(raw) ? raw : 'USD';
}

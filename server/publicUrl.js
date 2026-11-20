/**
 * One source of truth for the public address of RIFQ Muslim.
 *
 * The deployment runs behind a proxy that always talks plain HTTP to the
 * container, so `req.protocol` alone produced "http://" links for a site that
 * visitors open over HTTPS. Everything that is not loopback is therefore
 * published as https, and a configured PUBLIC_APP_URL (custom domain) wins over
 * the request host so invite links, QR codes and shared metadata stay on the
 * official domain even when the app is also reachable through a platform URL.
 */

export const APP_NAME = 'RIFQ Muslim';
export const APP_TITLE = 'RIFQ Muslim — Your Faith, Your Daily Companion';
export const APP_DESCRIPTION =
  'Prayer times, the Holy Quran, authentic Hadith, Duas, Qibla, Zakat and daily worship. RIFQ Muslim, your faith, your daily companion. Made by Eng Mohamud Yusuf.';
export const MARKER = '<!--APP-META-->';

const trimSlash = (value) => String(value || '').trim().replace(/\/+$/, '');

const configuredBase = () =>
  [process.env.PUBLIC_APP_URL, process.env.PUBLIC_URL]
    .map(trimSlash)
    .find((value) => /^https?:\/\/[^\s/]+/i.test(value)) || '';

export function publicBaseUrl(req) {
  const configured = configuredBase();
  if (configured) return configured;

  const host = (req && typeof req.get === 'function' && req.get('host')) || 'localhost:3000';
  const forwarded = String((req && req.headers && req.headers['x-forwarded-proto']) || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = isLoopback ? forwarded || (req && req.protocol) || 'http' : 'https';
  return `${proto}://${host}`;
}

const escapeAttr = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Canonical + Open Graph tags for the address the visitor actually reached.
 * WhatsApp, Facebook and Telegram read these when an invitation is shared.
 */
export function metaBlock(base) {
  const url = `${base}/`;
  const image = `${base}/logo.svg`;
  return [
    `<link rel="canonical" href="${escapeAttr(url)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${escapeAttr(APP_NAME)}" />`,
    `<meta property="og:title" content="${escapeAttr(APP_TITLE)}" />`,
    `<meta property="og:description" content="${escapeAttr(APP_DESCRIPTION)}" />`,
    `<meta property="og:url" content="${escapeAttr(url)}" />`,
    `<meta property="og:image" content="${escapeAttr(image)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeAttr(APP_TITLE)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(APP_DESCRIPTION)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
  ].join('\n    ');
}

export function renderIndex(html, req) {
  const block = metaBlock(publicBaseUrl(req));
  if (html.includes(MARKER)) return html.replace(MARKER, block);
  // The bundler may drop HTML comments; keep working if the marker is gone.
  return html.includes('</head>') ? html.replace('</head>', `  ${block}\n  </head>`) : html;
}

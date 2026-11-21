/**
 * The official RIFQ Muslim share/download link.
 *
 * Only the Invite Friends section uses this: the Download App button, the QR
 * code and every share action on that page read this one constant, so an
 * invitation can never point somewhere different from the QR code printed
 * beside it.
 *
 * Other pages keep resolving their own link from /api/config (siteUrl /
 * downloadUrl), so changing this file deliberately does not move them.
 */
export const INVITE_URL = 'https://median.co/share/bnylzxd#apk';

/** Exact options the Invite QR code is rendered with (unchanged design). */
export const INVITE_QR_OPTIONS = {
  margin: 1,
  width: 320,
  color: { dark: '#0b3b2e', light: '#ffffff' },
};

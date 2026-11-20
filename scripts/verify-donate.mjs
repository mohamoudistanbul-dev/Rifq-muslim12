/**
 * Verifies the PayPal donation path.
 *
 * Two halves, both honest:
 *   1. Pure link/amount logic — the owner's link is only ever used as given; a
 *      look-alike or non-HTTPS host produces no href at all, and amounts are only
 *      attached when the link can actually carry them (paypal.me/<handle> or an
 *      `{amount}` placeholder).
 *   2. The real server — /api/config publishes the configured link, publishes an
 *      empty string when it is missing or invalid, and never leaks PayPal client
 *      ids or secrets.
 *
 * Run with: npx tsx scripts/verify-donate.mjs
 */
import { spawn } from 'node:child_process';
import {
  DONATION_PRESETS,
  amountMode,
  buildDonateUrl,
  isPaypalUrl,
  sanitizeAmount,
} from '../src/lib/donate.ts';

let failures = 0;
const is = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

/* ------------------------------ link validation ----------------------------- */

is('empty link is not usable', isPaypalUrl(''), false);
is('plain http is rejected', isPaypalUrl('http://paypal.me/rifqmuslim'), false);
is('look-alike host is rejected', isPaypalUrl('https://paypal.com.secure-pay.example/donate'), false);
is('paypal in the path is not enough', isPaypalUrl('https://example.com/paypal.me/x'), false);
is('javascript scheme is rejected', isPaypalUrl('javascript:alert(1)'), false);
is('paypal.me is accepted', isPaypalUrl('https://paypal.me/rifqmuslim'), true);
is(
  'hosted donate button is accepted',
  isPaypalUrl('https://www.paypal.com/donate?hosted_button_id=ABC123'),
  true,
);
is('paypal subdomain is accepted', isPaypalUrl('https://business.paypal.com/donate'), true);

/* -------------------------------- amount mode ------------------------------- */

is('placeholder mode', amountMode('https://www.paypal.com/donate?amount={amount}'), 'placeholder');
is('paypal.me mode', amountMode('https://paypal.me/rifqmuslim'), 'paypal-me');
is('hosted button has no amount support', amountMode('https://www.paypal.com/donate?hosted_button_id=ABC'), 'none');

/* ------------------------------ amount building ----------------------------- */

is(
  'placeholder receives the amount',
  buildDonateUrl('https://www.paypal.com/donate?hosted_button_id=ABC&amount={amount}', 20),
  'https://www.paypal.com/donate?hosted_button_id=ABC&amount=20',
);
is(
  'placeholder is removed when no amount is chosen',
  buildDonateUrl('https://www.paypal.com/donate?hosted_button_id=ABC&amount={amount}', null),
  'https://www.paypal.com/donate?hosted_button_id=ABC',
);
is(
  'placeholder leading query is cleaned up',
  buildDonateUrl('https://www.paypal.com/donate?amount={amount}&currency_code=USD', null),
  'https://www.paypal.com/donate?currency_code=USD',
);
is(
  'paypal.me appends the amount',
  buildDonateUrl('https://paypal.me/rifqmuslim', 5),
  'https://paypal.me/rifqmuslim/5',
);
is(
  'paypal.me without an amount stays untouched',
  buildDonateUrl('https://paypal.me/rifqmuslim', null),
  'https://paypal.me/rifqmuslim',
);
is(
  'paypal.me replaces an existing amount segment',
  buildDonateUrl('https://paypal.me/rifqmuslim/10', 50),
  'https://paypal.me/rifqmuslim/50',
);
is(
  'hosted button never gets an invented amount',
  buildDonateUrl('https://www.paypal.com/donate?hosted_button_id=ABC', 50),
  'https://www.paypal.com/donate?hosted_button_id=ABC',
);
is('invalid link produces no href', buildDonateUrl('https://example.com/donate', 10), '');
is('missing link produces no href', buildDonateUrl('', 10), '');

/* ------------------------------ amount sanitising --------------------------- */

is('decimal amount is kept', sanitizeAmount('15.5'), 15.5);
is('comma decimal is understood', sanitizeAmount('1,5'), 1.5);
is('two decimals only', sanitizeAmount('15.555'), 15.56);
is('zero is rejected', sanitizeAmount('0'), null);
is('negative is rejected', sanitizeAmount('-5'), null);
is('text is rejected', sanitizeAmount('abc'), null);
is('empty is rejected', sanitizeAmount(''), null);
is('absurd amount is rejected', sanitizeAmount(100001), null);
is('presets are the expected four', [...DONATION_PRESETS], [5, 10, 20, 50]);

/* --------------------------------- real server ------------------------------ */

const waitForHealth = async (port, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const withServer = async (port, env, run) => {
  const child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: 'ignore',
  });
  try {
    const up = await waitForHealth(port);
    if (!up) throw new Error(`server on ${port} did not become ready`);
    const config = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
    await run(config);
  } finally {
    child.kill('SIGTERM');
  }
};

const LINK = 'https://paypal.me/rifqmuslim';

await withServer(4599, { PAYPAL_DONATE_URL: LINK }, (config) => {
  is('configured link is published', config.paypalDonateUrl, LINK);
  is('currency defaults to USD', config.paypalCurrency, 'USD');
  const keys = Object.keys(config).map((k) => k.toLowerCase());
  is(
    'no PayPal credentials in the public config',
    keys.filter((k) => /client_?id|secret|password|token/.test(k)),
    [],
  );
});

await withServer(4600, { PAYPAL_DONATE_URL: 'https://secure-paypal.example.com/donate' }, (config) => {
  is('look-alike host is not published', config.paypalDonateUrl, '');
});

await withServer(4601, { PAYPAL_DONATE_URL: '', PAYPAL_CURRENCY: 'eur' }, (config) => {
  is('missing link stays empty', config.paypalDonateUrl, '');
  is('currency is normalised', config.paypalCurrency, 'EUR');
});

if (failures > 0) {
  console.error(`\n${failures} donation check(s) failed`);
  process.exit(1);
}
console.log('\nAll PayPal donation checks passed.');

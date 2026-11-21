/**
 * Notification planning checks — `npm run verify:notify`.
 *
 * Exercises the pure planner the app actually uses: prayer alerts, the
 * pre-prayer reminder, every daily category, adhkar, Islamic occasions, user
 * reminders, dedupe and the native-alarm horizon. No DOM, no network.
 */
import {
  atLocal,
  categoryLabel,
  DAILY_CATEGORIES,
  dueAlerts,
  localDayKey,
  nextAlert,
  parseHHMM,
  planAlerts,
  upcomingAlerts,
  type CustomReminder,
  type PlanInput,
} from '../src/lib/notifyPlan';

let pass = 0;
const failures: string[] = [];

function ok(name: string) {
  pass += 1;
  console.log(`  ok   ${name}`);
}
function bad(name: string, detail: string) {
  failures.push(`${name} — ${detail}`);
  console.log(`  FAIL ${name} — ${detail}`);
}
function check(name: string, condition: boolean, detail = '') {
  if (condition) ok(name);
  else bad(name, detail || 'assertion failed');
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, `expected ${b}, got ${a}`);
}

/** A Friday, so weekday and Friday-only frequencies are both testable. */
function fridayAt(hour = 0): Date {
  const day = new Date(2026, 0, 2, hour, 0, 0, 0);
  while (day.getDay() !== 5) day.setDate(day.getDate() + 1);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
}

const NOW = fridayAt(0);

function localAt(h: number, m: number, base = NOW): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);
}

const TIMES: Record<string, Date> = {
  fajr: localAt(5, 0),
  sunrise: localAt(6, 25),
  dhuhr: localAt(12, 15),
  asr: localAt(15, 30),
  maghrib: localAt(18, 0),
  isha: localAt(19, 20),
};

const CATEGORIES: PlanInput['categories'] = {
  quran: { enabled: true, time: '08:00', sound: 'default', vibrate: true, frequency: 'daily' },
  hadith: { enabled: true, time: '12:30', sound: 'beep', vibrate: false, frequency: 'daily' },
  dua: { enabled: false, time: '18:00', sound: 'default', vibrate: true, frequency: 'daily' },
  adhkarMorning: { enabled: true, time: '06:30', sound: 'default', vibrate: true, frequency: 'daily' },
  adhkarEvening: { enabled: true, time: '18:30', sound: 'default', vibrate: true, frequency: 'daily' },
  occasions: { enabled: true, time: '09:00', sound: 'default', vibrate: true, frequency: 'daily' },
};

const CUSTOM: CustomReminder[] = [
  { id: 'daily1', title: 'Read Quran', body: 'Ten minutes', time: '21:00', frequency: 'daily', enabled: true },
  {
    id: 'weekly1',
    title: 'Surah Al-Kahf',
    body: 'Friday reading',
    time: '09:15',
    frequency: 'weekly',
    date: localDayKey(NOW),
    enabled: true,
  },
  {
    id: 'once1',
    title: 'Zakat review',
    body: 'Yearly',
    time: '10:00',
    frequency: 'once',
    date: localDayKey(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2)),
    enabled: true,
  },
  { id: 'off1', title: 'Off reminder', body: '', time: '11:00', frequency: 'daily', enabled: false },
];

function base(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    now: NOW,
    times: TIMES,
    city: 'Mogadishu',
    prayerAlerts: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
    preReminder: 0,
    vibration: true,
    athanSound: 'makkah',
    categories: CATEGORIES,
    custom: CUSTOM,
    occasions: [],
    ...overrides,
  };
}

console.log('\nParsing and clock helpers');
{
  eq('parseHHMM 05:30', parseHHMM('05:30'), { h: 5, m: 30 });
  eq('parseHHMM single digit hour', parseHHMM('9:05'), { h: 9, m: 5 });
  eq('parseHHMM rejects 24:00', parseHHMM('24:00'), null);
  eq('parseHHMM rejects minute 60', parseHHMM('09:60'), null);
  eq('parseHHMM rejects text', parseHHMM('noon'), null);
  check('localDayKey is zero padded', /^\d{4}-\d{2}-\d{2}$/.test(localDayKey(NOW)), localDayKey(NOW));
  const at = atLocal(NOW, '07:45');
  check(
    'atLocal builds the local wall-clock time',
    !!at && at.getHours() === 7 && at.getMinutes() === 45 && at.getDate() === NOW.getDate(),
    String(at)
  );
  eq('atLocal rejects a bad time', atLocal(NOW, '25:00'), null);
}

console.log('\nPrayer alerts');
{
  const planned = planAlerts(base());
  const prayers = planned.filter((a) => a.category !== 'pre' && a.category !== 'custom' && !DAILY_CATEGORIES.includes(a.category as never));
  eq('five prayer alerts are planned', prayers.length, 5);
  check(
    'fajr slot carries its own wording',
    prayers.some((a) => a.category === 'fajr' && /better than sleep/i.test(a.body)),
    'fajr body missing the reminder'
  );
  check(
    'prayer alerts name the city',
    prayers.every((a) => a.body.includes('Mogadishu')),
    'a prayer body did not include the city'
  );

  const withoutAsr = planAlerts(base({ prayerAlerts: { ...base().prayerAlerts, asr: false } }));
  check('a disabled prayer is not planned', !withoutAsr.some((a) => a.category === 'asr'), 'asr was still planned');

  const withPre = planAlerts(base({ preReminder: 15 }));
  const pre = withPre.filter((a) => a.category === 'pre');
  eq('pre-prayer reminder adds one alert per prayer', pre.length, 5);
  const fajrPre = pre.find((a) => a.slot.startsWith('pre:fajr:'));
  check(
    'pre-prayer reminder is 15 minutes before the adhan',
    !!fajrPre && fajrPre.at.getTime() === TIMES.fajr.getTime() - 15 * 60_000,
    String(fajrPre?.at)
  );
  eq('pre-prayer reminder is off by default', planAlerts(base()).filter((a) => a.category === 'pre').length, 0);

  const first = planAlerts(base()).find((a) => a.category === 'fajr');
  const second = planAlerts(base()).find((a) => a.category === 'fajr');
  check('prayer slot keys are stable for dedupe', !!first && !!second && first.slot === second.slot, 'slot changed between calls');

  const sorted = planned.every((a, i) => i === 0 || planned[i - 1].at.getTime() <= a.at.getTime());
  check('the plan is sorted by time', sorted, 'alerts were out of order');
}

console.log('\nDaily categories');
{
  const planned = planAlerts(base());
  const quran = planned.filter((a) => a.category === 'quran');
  check('the daily Quran reminder is planned for each day', quran.length === 8, `got ${quran.length}`);
  check(
    'the daily reminder uses its configured time',
    quran[0].at.getHours() === 8 && quran[0].at.getMinutes() === 0,
    String(quran[0].at)
  );
  check('a disabled category is not planned', !planned.some((a) => a.category === 'dua'), 'dua was planned while disabled');
  check(
    'the category sound overrides the adhan sound',
    planned.some((a) => a.category === 'hadith' && a.sound === 'beep'),
    'hadith did not use its own sound'
  );
  check(
    'an unset category sound falls back to the adhan sound',
    planned.some((a) => a.category === 'quran' && a.sound === 'makkah'),
    'quran did not fall back to the adhan sound'
  );
  check(
    'a category vibration choice is respected',
    planned.some((a) => a.category === 'hadith' && a.vibrate === false),
    'hadith vibrate was not honoured'
  );
  check(
    'daily slots are unique per day',
    new Set(planned.filter((a) => a.category === 'quran').map((a) => a.slot)).size === 8,
    'duplicate daily slot'
  );
  for (const category of DAILY_CATEGORIES) {
    check(`label exists for ${category}`, categoryLabel(category).length > 3, 'label was empty');
  }
  eq('adhkar morning is planned', planned.filter((a) => a.category === 'adhkarMorning').length, 8);
  eq('adhkar evening is planned', planned.filter((a) => a.category === 'adhkarEvening').length, 8);
}

console.log('\nFrequency rules');
{
  const weekdaysOnly = planAlerts(
    base({
      categories: {
        ...CATEGORIES,
        quran: { enabled: true, time: '08:00', sound: 'default', vibrate: true, frequency: 'weekdays' },
        hadith: { enabled: false, time: '12:30', sound: 'default', vibrate: true, frequency: 'daily' },
        adhkarMorning: { enabled: false, time: '06:30', sound: 'default', vibrate: true, frequency: 'daily' },
        adhkarEvening: { enabled: false, time: '18:30', sound: 'default', vibrate: true, frequency: 'daily' },
        occasions: { enabled: false, time: '09:00', sound: 'default', vibrate: true, frequency: 'daily' },
      },
      custom: [],
    })
  );
  const quranDays = weekdaysOnly.filter((a) => a.category === 'quran').map((a) => a.at.getDay());
  check('weekday frequency skips Saturday and Sunday', !quranDays.includes(0) && !quranDays.includes(6), JSON.stringify(quranDays));
  check('weekday frequency still includes Monday to Friday', quranDays.includes(5), JSON.stringify(quranDays));

  const fridays = planAlerts(
    base({
      categories: {
        ...CATEGORIES,
        quran: { enabled: true, time: '08:00', sound: 'default', vibrate: true, frequency: 'friday' },
        hadith: { enabled: false, time: '12:30', sound: 'default', vibrate: true, frequency: 'daily' },
        adhkarMorning: { enabled: false, time: '06:30', sound: 'default', vibrate: true, frequency: 'daily' },
        adhkarEvening: { enabled: false, time: '18:30', sound: 'default', vibrate: true, frequency: 'daily' },
        occasions: { enabled: false, time: '09:00', sound: 'default', vibrate: true, frequency: 'daily' },
      },
      custom: [],
    })
  );
  const fridayDays = fridays.filter((a) => a.category === 'quran').map((a) => a.at.getDay());
  check('Friday frequency only plans Fridays', fridayDays.every((d) => d === 5), JSON.stringify(fridayDays));
}

console.log('\nIslamic occasions');
{
  const todayKey = localDayKey(NOW);
  const withOccasion = planAlerts(
    base({
      occasions: [{ name: 'Day of Arafah', date: todayKey, note: 'The day of Arafah' }],
      custom: [],
    })
  );
  const occasion = withOccasion.filter((a) => a.category === 'occasions');
  eq('only the matching day is planned', occasion.length, 1);
  check('the occasion title names the occasion', /Arafah/.test(occasion[0].title), occasion[0].title);
  check(
    'the occasion body asks for local confirmation',
    /local mosque/i.test(occasion[0].body),
    occasion[0].body
  );
  check('the occasion slot is date keyed', occasion[0].slot === `daily:occasions:${todayKey}`, occasion[0].slot);

  const withoutOccasion = planAlerts(base({ occasions: [], custom: [] }));
  eq('no occasion, no occasion alert', withoutOccasion.filter((a) => a.category === 'occasions').length, 0);
}

console.log('\nUser reminders');
{
  const planned = planAlerts(base({ occasions: [] }));
  const daily = planned.filter((a) => a.slot.startsWith('custom:daily1:'));
  eq('a daily reminder is planned every day', daily.length, 8);
  check(
    'a daily reminder keeps its time',
    daily[0].at.getHours() === 21 && daily[0].at.getMinutes() === 0,
    String(daily[0].at)
  );

  const weekly = planned.filter((a) => a.slot.startsWith('custom:weekly1:'));
  check('a weekly reminder only lands on its weekday', weekly.every((a) => a.at.getDay() === 5), JSON.stringify(weekly.map((a) => a.at.getDay())));
  eq('a weekly reminder fires once in eight days', weekly.length, 1);

  const once = planned.filter((a) => a.slot.startsWith('custom:once1:'));
  eq('a one-off reminder is planned once', once.length, 1);
  eq('the one-off reminder is on its date', once[0].slot, `custom:once1:${localDayKey(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2))}`);

  check('a disabled reminder is not planned', !planned.some((a) => a.slot.startsWith('custom:off1:')), 'disabled reminder was planned');
  check(
    'a reminder carries its own message',
    planned.some((a) => a.slot.startsWith('custom:daily1:') && a.body === 'Ten minutes'),
    'reminder body was replaced'
  );
}

console.log('\nDedupe and delivery window');
{
  const planned = planAlerts(base({ occasions: [] }));
  const fajr = planned.find((a) => a.category === 'fajr')!;

  const due = dueAlerts(planned, new Date(fajr.at.getTime() + 5_000), 90_000, []);
  check('an alert inside the window is due', due.some((a) => a.slot === fajr.slot), 'fajr was not due');

  const early = dueAlerts(planned, new Date(fajr.at.getTime() - 5_000), 90_000, []);
  check('an alert before its time is not due', !early.some((a) => a.slot === fajr.slot), 'fajr fired early');

  const late = dueAlerts(planned, new Date(fajr.at.getTime() + 120_000), 90_000, []);
  check('an alert past the window is not due', !late.some((a) => a.slot === fajr.slot), 'fajr fired late');

  const already = dueAlerts(planned, new Date(fajr.at.getTime() + 5_000), 90_000, [fajr.slot]);
  check('a fired slot is never repeated', !already.some((a) => a.slot === fajr.slot), 'fajr repeated');

  const twice = dueAlerts(planned, new Date(fajr.at.getTime() + 5_000), 90_000, []);
  check('one slot appears once per sweep', twice.filter((a) => a.slot === fajr.slot).length === 1, 'duplicate in one sweep');
}

console.log('\nNative alarm horizon');
{
  const planned = planAlerts(base({ occasions: [] }));
  const upcoming = upcomingAlerts(planned, NOW, 7 * 86400000, 60);
  check('the native schedule is bounded', upcoming.length <= 60, `got ${upcoming.length}`);
  check(
    'the native schedule only contains future alerts',
    upcoming.every((a) => a.at.getTime() > NOW.getTime()),
    'a past alert was scheduled'
  );
  check(
    'the native schedule stays inside the horizon',
    upcoming.every((a) => a.at.getTime() - NOW.getTime() <= 7 * 86400000),
    'an alert was scheduled beyond seven days'
  );
  const limited = upcomingAlerts(planned, NOW, 7 * 86400000, 3);
  eq('the native schedule respects its limit', limited.length, 3);

  const next = nextAlert(planned, NOW);
  check('the next alert is the earliest future one', !!next && next.at.getTime() === planned.find((a) => a.at.getTime() > NOW.getTime())!.at.getTime(), 'wrong next alert');
  eq('nextAlert returns null when everything is past', nextAlert(planned, new Date(NOW.getTime() + 60 * 86400000)), null);
}

console.log('\nResilience');
{
  const noTimes = planAlerts(base({ times: null, occasions: [] }));
  check('the plan still builds without prayer times', noTimes.length > 0, 'no alerts without times');
  check('no prayer alert without prayer times', !noTimes.some((a) => ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].includes(a.category)), 'a prayer was planned without times');

  const emptyCity = planAlerts(base({ city: '', occasions: [] }));
  check('an empty city falls back to a readable phrase', emptyCity.some((a) => a.body.includes('your city')), 'city text was empty');

  const badTime = planAlerts(
    base({
      categories: { ...CATEGORIES, quran: { enabled: true, time: '99:99', sound: 'default', vibrate: true, frequency: 'daily' } },
      custom: [],
      occasions: [],
    })
  );
  check('an invalid reminder time is skipped, not thrown', !badTime.some((a) => a.category === 'quran'), 'invalid time produced an alert');

  const allOff = planAlerts(
    base({
      categories: {
        quran: { enabled: false, time: '08:00', sound: 'default', vibrate: true, frequency: 'daily' },
        hadith: { enabled: false, time: '12:30', sound: 'default', vibrate: true, frequency: 'daily' },
        dua: { enabled: false, time: '18:00', sound: 'default', vibrate: true, frequency: 'daily' },
        adhkarMorning: { enabled: false, time: '06:30', sound: 'default', vibrate: true, frequency: 'daily' },
        adhkarEvening: { enabled: false, time: '18:30', sound: 'default', vibrate: true, frequency: 'daily' },
        occasions: { enabled: false, time: '09:00', sound: 'default', vibrate: true, frequency: 'daily' },
      },
      custom: [],
      prayerAlerts: { fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false },
    })
  );
  eq('everything off produces no alerts', allOff.length, 0);
}

const total = pass + failures.length;
console.log(`\n${pass}/${total} checks passed`);
if (failures.length) {
  console.error('\nFailures:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('Notification planning verified.\n');

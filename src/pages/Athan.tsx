import React, { useEffect, useMemo, useState } from 'react';
import { Page } from '../components/Shell';
import { useStore } from '../lib/store';
import { FIVE } from '../lib/prayer';
import {
  ADHAN_SOUNDS,
  CATEGORY_LABELS,
  capabilities,
  notificationState,
  pauseAdhan,
  playAdhan,
  resetAlertMemory,
  resumeAdhan,
  stopAdhan,
  subscribeAudio,
  testCategory,
  upcomingOccasionAlerts,
  type AudioSnapshot,
  type LoopState,
  type TestResult,
} from '../lib/notify';
import {
  nextAlert,
  planAlerts,
  type CategoryId,
  type CustomReminder,
  type DailyCategory,
  type Frequency,
} from '../lib/notifyPlan';

/**
 * Athan & notifications.
 *
 * Every control here is wired to the same plan the delivery loop uses, so the
 * schedule shown on this screen is the schedule that runs. Categories the
 * platform cannot deliver with the app closed say so instead of pretending.
 */

const PRAYER_AR: Record<string, string> = {
  fajr: 'الفجر',
  dhuhr: 'الظهر',
  asr: 'العصر',
  maghrib: 'المغرب',
  isha: 'العشاء',
};

const DAILY_ORDER: DailyCategory[] = [
  'quran',
  'hadith',
  'dua',
  'adhkarMorning',
  'adhkarEvening',
  'occasions',
];

const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays (Mon–Fri)',
  friday: 'Fridays only',
  once: 'Once',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Toggle({
  checked,
  onChange,
  label,
  sub,
  last,
  right,
  prayer,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
  last?: boolean;
  right?: React.ReactNode;
  prayer?: string;
  testId?: string;
}) {
  return (
    <div className={`athan-row${last ? ' is-last' : ''}`} data-prayer={prayer} data-testid={testId}>
      <div className="athan-row-main">
        <div className="athan-label">
          {label}
          {prayer ? (
            <span className="athan-ar" dir="rtl" lang="ar">
              {PRAYER_AR[prayer] || ''}
            </span>
          ) : null}
        </div>
        {sub ? <div className="athan-meta">{sub}</div> : null}
      </div>
      {right}
      <label className="switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
        />
        <span className="track" aria-hidden="true" />
      </label>
    </div>
  );
}

export default function Athan() {
  const { prefs, setPrefs, requestNotify, times, place, toast } = useStore();
  const [audio, setAudio] = useState<AudioSnapshot>({
    soundId: null,
    playing: false,
    paused: false,
    position: 0,
    duration: 0,
    label: '',
    error: null,
  });
  const [testBusy, setTestBusy] = useState<CategoryId | null>(null);
  const [testResult, setTestResult] = useState<{ category: CategoryId; result: TestResult } | null>(null);
  const [draft, setDraft] = useState<CustomReminder>({
    id: '',
    title: '',
    body: '',
    time: '20:00',
    frequency: 'daily',
    date: '',
    enabled: true,
  });

  useEffect(() => subscribeAudio(setAudio), []);
  useEffect(() => () => stopAdhan(), []);

  const caps = useMemo(() => capabilities(), []);
  const permission = notificationState();
  const granted = permission === 'granted';

  const state: LoopState = useMemo(
    () => ({
      times,
      city: place?.city || 'your city',
      prefs: {
        notifyEnabled: prefs.notifyEnabled,
        prayerAlerts: prefs.prayerAlerts,
        preReminder: prefs.preReminder,
        athanSound: prefs.athanSound,
        vibration: prefs.vibration,
        categories: prefs.categories,
        custom: prefs.customReminders,
      },
      occasions: upcomingOccasionAlerts(new Date()),
    }),
    [times, place, prefs]
  );

  const next = useMemo(() => {
    const planned = planAlerts({
      now: new Date(),
      times: state.times,
      city: state.city,
      prayerAlerts: state.prefs.prayerAlerts,
      preReminder: state.prefs.preReminder,
      vibration: state.prefs.vibration,
      athanSound: state.prefs.athanSound,
      categories: state.prefs.categories,
      custom: state.prefs.custom,
      occasions: state.occasions,
    });
    return nextAlert(planned, new Date());
  }, [state]);

  const timeLabel = (key: string) => {
    const at = times?.[key as keyof typeof times];
    if (!(at instanceof Date)) return '—';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: prefs.hour12,
        timeZone: place?.timezone,
      }).format(at);
    } catch {
      return at.toLocaleTimeString();
    }
  };

  const updateCategory = (id: DailyCategory, patch: Partial<(typeof prefs.categories)[DailyCategory]>) => {
    setPrefs({ categories: { ...prefs.categories, [id]: { ...prefs.categories[id], ...patch } } });
  };

  const runTest = async (category: CategoryId) => {
    setTestBusy(category);
    setTestResult(null);
    const result = await testCategory(category, state);
    setTestResult({ category, result });
    setTestBusy(null);
    if (!result.shown) {
      toast(
        permission === 'granted'
          ? 'The system did not show the notification. Check the app’s notification settings.'
          : 'Notifications are not allowed yet — tap “Allow notifications” first.',
        'error'
      );
    }
  };

  const addReminder = () => {
    if (!draft.title.trim()) {
      toast('Give the reminder a title first.', 'error');
      return;
    }
    if ((draft.frequency === 'once' || draft.frequency === 'weekly') && !draft.date) {
      toast('Choose the date for this reminder.', 'error');
      return;
    }
    const reminder: CustomReminder = {
      ...draft,
      id: `r${Date.now()}`,
      title: draft.title.trim(),
      body: draft.body.trim(),
    };
    setPrefs({ customReminders: [...prefs.customReminders, reminder] });
    setDraft({ id: '', title: '', body: '', time: '20:00', frequency: 'daily', date: '', enabled: true });
    toast('Reminder saved.', 'success');
  };

  const removeReminder = (id: string) => {
    setPrefs({ customReminders: prefs.customReminders.filter((r) => r.id !== id) });
  };

  const toggleReminder = (id: string, enabled: boolean) => {
    setPrefs({
      customReminders: prefs.customReminders.map((r) => (r.id === id ? { ...r, enabled } : r)),
    });
  };

  const backgroundCopy =
    caps.background === 'native-alarm'
      ? 'Delivered by the Android alarm scheduler, so alerts still arrive when the app is closed.'
      : caps.background === 'pwa-push-required'
        ? 'iOS delivers alerts with the app closed only through web push; this build does not ship a push service, so alerts arrive while the app is open.'
        : 'A browser tab cannot schedule alerts after it is closed. Install the app for background delivery.';

  const testCategories: CategoryId[] = [
    'fajr',
    'dhuhr',
    'asr',
    'maghrib',
    'isha',
    'pre',
    'quran',
    'hadith',
    'dua',
    'adhkarMorning',
    'adhkarEvening',
    'occasions',
    'custom',
  ];

  return (
    <Page title="Athan & Notifications">
      <p className="muted small" style={{ margin: '0 0 14px' }}>
        All alerts are calculated from{' '}
        {place ? `${place.city}, ${place.country}` : 'your selected location'} using the same engine as the Home
        countdown.
        {next ? (
          <>
            {' '}
            Next: <strong>{next.title.replace('RIFQ Muslim — ', '')}</strong> at{' '}
            {next.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
          </>
        ) : null}
      </p>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="athan-title">Permission</h2>
        <div className="athan-perm-row">
          <div className="athan-row-main">
            <div className="athan-label">Notification permission</div>
            <div className="athan-meta">
              {permission === 'granted'
                ? 'Allowed on this device.'
                : permission === 'denied'
                  ? 'Blocked. Re-enable it in the app or browser settings.'
                  : permission === 'unsupported'
                    ? 'This browser does not support notifications.'
                    : 'Not requested yet.'}
            </div>
          </div>
          <span className={granted ? 'badge-soft' : 'badge-gold'}>
            {granted ? 'GRANTED' : permission.toUpperCase()}
          </span>
        </div>

        {!granted && permission !== 'unsupported' ? (
          <div className="athan-card-actions">
            <button type="button" className="btn btn-primary btn-block" onClick={() => void requestNotify()}>
              Allow notifications
            </button>
          </div>
        ) : null}

        <p className="athan-note">
          {backgroundCopy}
          {caps.native ? ' Adhan sound with the app closed needs a foreground media service, which this build does not include.' : ''}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="athan-title">Prayer alerts</h2>

        <Toggle
          checked={prefs.notifyEnabled}
          onChange={(v) => setPrefs({ notifyEnabled: v })}
          label="All notifications"
          sub="Master switch — turning this off also cancels scheduled Android alarms"
          testId="master-toggle"
        />

        {FIVE.map((key, index) => (
          <Toggle
            key={key}
            prayer={key}
            checked={prefs.prayerAlerts[key] !== false}
            onChange={(v) => setPrefs({ prayerAlerts: { ...prefs.prayerAlerts, [key]: v } })}
            label={cap(key)}
            sub={key === 'fajr' ? 'Fajr uses its own reminder wording' : undefined}
            last={index === FIVE.length - 1}
            right={<span className="athan-time">{timeLabel(key)}</span>}
            testId={`toggle-${key}`}
          />
        ))}

        <div className="athan-row is-last">
          <div className="athan-row-main">
            <div className="athan-label">Pre-prayer reminder</div>
            <div className="athan-meta">A quiet chime before the adhan</div>
          </div>
          <select
            className="select"
            value={prefs.preReminder}
            onChange={(e) => setPrefs({ preReminder: Number(e.target.value) })}
            aria-label="Pre-prayer reminder"
            style={{ width: 'auto', minWidth: 120 }}
          >
            {[0, 5, 10, 15, 20, 30].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'Off' : `${m} min before`}
              </option>
            ))}
          </select>
        </div>

        <p className="athan-note">
          Times come from your saved location and calculation method. Turning one prayer off stops only that prayer.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="athan-title">Daily reminders</h2>
        <p className="athan-meta" style={{ margin: '0 0 10px' }}>
          Each reminder has its own time, sound, vibration and repeat day.
        </p>

        {DAILY_ORDER.map((id) => {
          const pref = prefs.categories[id];
          return (
            <div className="athan-cat" key={id} data-testid={`cat-${id}`}>
              <Toggle
                checked={pref.enabled}
                onChange={(v) => updateCategory(id, { enabled: v })}
                label={CATEGORY_LABELS[id]}
                sub={pref.enabled ? `${FREQUENCY_LABEL[pref.frequency]} at ${pref.time}` : 'Off'}
                last
              />
              {pref.enabled ? (
                <div className="athan-grid">
                  <label className="athan-field">
                    <span>Time</span>
                    <input
                      type="time"
                      className="select athan-time-input"
                      value={pref.time}
                      onChange={(e) => updateCategory(id, { time: e.target.value })}
                      aria-label={`${CATEGORY_LABELS[id]} time`}
                    />
                  </label>
                  <label className="athan-field">
                    <span>Repeat</span>
                    <select
                      className="select"
                      value={pref.frequency}
                      onChange={(e) => updateCategory(id, { frequency: e.target.value as Frequency })}
                      aria-label={`${CATEGORY_LABELS[id]} repeat`}
                    >
                      <option value="daily">Every day</option>
                      <option value="weekdays">Weekdays</option>
                      <option value="friday">Fridays</option>
                    </select>
                  </label>
                  <label className="athan-field">
                    <span>Sound</span>
                    <select
                      className="select"
                      value={pref.sound}
                      onChange={(e) => updateCategory(id, { sound: e.target.value })}
                      aria-label={`${CATEGORY_LABELS[id]} sound`}
                    >
                      <option value="default">Same as adhan setting</option>
                      {ADHAN_SOUNDS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="athan-field athan-field-inline">
                    <span>Vibrate</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={pref.vibrate}
                        onChange={(e) => updateCategory(id, { vibrate: e.target.checked })}
                        aria-label={`${CATEGORY_LABELS[id]} vibration`}
                      />
                      <span className="track" aria-hidden="true" />
                    </label>
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="athan-title">Your reminders</h2>

        {prefs.customReminders.length === 0 ? (
          <p className="athan-meta" style={{ margin: '0 0 10px' }}>
            No personal reminders yet. Add one below — it is stored on this device and restored when you reopen the app.
          </p>
        ) : (
          prefs.customReminders.map((reminder) => (
            <div className="athan-reminder" key={reminder.id}>
              <div className="athan-row-main">
                <div className="athan-label">{reminder.title}</div>
                <div className="athan-meta">
                  {FREQUENCY_LABEL[reminder.frequency]} at {reminder.time}
                  {reminder.date ? ` · ${reminder.date}` : ''}
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={reminder.enabled}
                  onChange={(e) => toggleReminder(reminder.id, e.target.checked)}
                  aria-label={`${reminder.title} enabled`}
                />
                <span className="track" aria-hidden="true" />
              </label>
              <button
                type="button"
                className="btn btn-ghost athan-mini"
                onClick={() => removeReminder(reminder.id)}
                aria-label={`Delete ${reminder.title}`}
              >
                Delete
              </button>
            </div>
          ))
        )}

        <div className="athan-grid" style={{ marginTop: 10 }}>
          <label className="athan-field">
            <span>Title</span>
            <input
              className="select"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Read Surah Al-Kahf"
              aria-label="Reminder title"
            />
          </label>
          <label className="athan-field">
            <span>Message</span>
            <input
              className="select"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="Friday reading"
              aria-label="Reminder message"
            />
          </label>
          <label className="athan-field">
            <span>Time</span>
            <input
              type="time"
              className="select athan-time-input"
              value={draft.time}
              onChange={(e) => setDraft({ ...draft, time: e.target.value })}
              aria-label="Reminder time"
            />
          </label>
          <label className="athan-field">
            <span>Repeat</span>
            <select
              className="select"
              value={draft.frequency}
              onChange={(e) => setDraft({ ...draft, frequency: e.target.value as CustomReminder['frequency'] })}
              aria-label="Reminder repeat"
            >
              <option value="daily">Every day</option>
              <option value="weekly">Weekly</option>
              <option value="once">Once</option>
            </select>
          </label>
          {draft.frequency !== 'daily' ? (
            <label className="athan-field">
              <span>{draft.frequency === 'weekly' ? 'First date' : 'Date'}</span>
              <input
                type="date"
                className="select"
                value={draft.date || ''}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                aria-label="Reminder date"
              />
            </label>
          ) : null}
        </div>

        <div className="athan-card-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={addReminder}>
            Add reminder
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="athan-title">Adhan sound</h2>
        <select
          className="select"
          value={prefs.athanSound}
          onChange={(e) => setPrefs({ athanSound: e.target.value })}
          aria-label="Adhan sound"
        >
          {ADHAN_SOUNDS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} — {s.note}
            </option>
          ))}
        </select>

        <div className="athan-card-actions">
          {!audio.playing && !audio.paused ? (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => void playAdhan(prefs.athanSound)}
            >
              ▶ Preview this sound
            </button>
          ) : null}

          {audio.playing ? (
            <button type="button" className="btn btn-ghost btn-block" onClick={() => pauseAdhan()}>
              ⏸ Pause
            </button>
          ) : null}

          {audio.paused ? (
            <button type="button" className="btn btn-primary btn-block" onClick={() => void resumeAdhan()}>
              ▶ Resume
            </button>
          ) : null}

          {audio.playing || audio.paused ? (
            <button type="button" className="btn btn-ghost btn-block" onClick={() => stopAdhan()}>
              ⏹ Stop
            </button>
          ) : null}
        </div>

        {audio.label && (audio.playing || audio.paused) ? (
          <p className="athan-status" role="status">
            {audio.playing ? 'Playing' : 'Paused'}: {audio.label}
            {audio.duration > 0
              ? ` · ${Math.floor(audio.position)}s / ${Math.floor(audio.duration)}s`
              : ''}
          </p>
        ) : null}

        {audio.error ? (
          <p className="athan-status" role="alert">
            {audio.error}
          </p>
        ) : null}

        <p className="athan-note">
          The adhan options stream real recordings from a public adhan archive. If a recording cannot be fetched the app
          says so instead of pretending it played. &ldquo;Short chime&rdquo; and &ldquo;Silent&rdquo; are labelled as
          not being adhan recordings.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="athan-title">Test each category</h2>
        <p className="athan-meta" style={{ margin: '0 0 10px' }}>
          Sends the real notification and sound for that category right now.
        </p>

        <div className="athan-test-grid">
          {testCategories.map((category) => (
            <button
              key={category}
              type="button"
              className="btn btn-ghost athan-test-btn"
              onClick={() => void runTest(category)}
              disabled={testBusy !== null}
              data-testid={`test-${category}`}
            >
              {testBusy === category ? 'Sending…' : CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>

        {testResult ? (
          <p className="athan-status" role="status" data-testid="test-result">
            <strong>{CATEGORY_LABELS[testResult.category]}:</strong>{' '}
            {testResult.result.shown ? 'notification delivered' : 'notification NOT delivered'} ·{' '}
            {testResult.result.played ? 'audio started' : 'no audio started'}. Message: “{testResult.result.body}”
          </p>
        ) : null}

        <div className="athan-card-actions">
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => {
              resetAlertMemory();
              toast('Alert memory cleared — today’s reminders can notify again.', 'success');
            }}
          >
            Reschedule today’s alerts
          </button>
        </div>

        <p className="athan-note">
          Each slot is recorded once it fires, so reloading the app or opening a second tab cannot repeat the same
          notification. Test notifications use their own tag and never consume a real slot.
        </p>
      </div>

      <div className="card">
        <h2 className="athan-title">Device behaviour</h2>

        <Toggle
          checked={prefs.vibration}
          onChange={(v) => setPrefs({ vibration: v })}
          label="Vibrate with prayer alerts"
          sub="Where the device allows it"
          last
        />

        <ul className="athan-facts">
          <li>Platform: {caps.native ? 'Android app' : caps.ios ? 'iOS / Safari' : 'Browser'}</li>
          <li>Background delivery: {caps.background}</li>
          <li>Adhan sound with the app closed: {caps.adhanWhenClosed ? 'yes' : 'no'}</li>
          <li>Notification permission: {caps.permission}</li>
        </ul>
      </div>
    </Page>
  );
}

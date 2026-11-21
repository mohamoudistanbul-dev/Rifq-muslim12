import React, { useEffect, useState } from 'react';
import { Page } from '../components/Shell';
import { useStore } from '../lib/store';
import { FIVE } from '../lib/prayer';
import {
  ADHAN_SOUNDS,
  isAdhanPlaying,
  notificationState,
  playAdhan,
  resetAlertMemory,
  stopAdhan,
  testAlert,
} from '../lib/notify';

/**
 * Athan & notifications screen.
 *
 * Layout note: styled from the RIFQ design tokens (src/screens.css). The
 * previous inline `var(--card, #fff)` cards rendered white on white in the
 * dark theme, so prayer names, times and toggles were unreadable.
 */

const PRAYER_AR: Record<string, string> = {
  fajr: 'الفجر',
  dhuhr: 'الظهر',
  asr: 'العصر',
  maghrib: 'المغرب',
  isha: 'العشاء',
};

function Toggle({
  checked,
  onChange,
  label,
  sub,
  last,
  right,
  prayer,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
  last?: boolean;
  right?: React.ReactNode;
  prayer?: string;
}) {
  return (
    <div className={`athan-row${last ? ' is-last' : ''}`} data-prayer={prayer}>
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
        {/* The styles draw the toggle on .track; without it the row showed an
            empty label and the control was invisible. */}
        <span className="track" aria-hidden="true" />
      </label>
    </div>
  );
}

export default function Athan() {
  const { prefs, setPrefs, requestNotify, times, place, toast } = useStore();
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'running' | 'done'>('idle');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => () => stopAdhan(), []);

  const permission = notificationState();
  const granted = permission === 'granted';

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

  const preview = async (id: string) => {
    setPreviewing(id);
    const ok = await playAdhan(id);
    if (!ok) toast('This sound could not be played. Check your connection or device volume.', 'error');
    setTimeout(() => setPreviewing((cur) => (cur === id ? null : cur)), 6000);
  };

  const runTest = async () => {
    setTestState('running');
    setTestMessage('');
    const result = await testAlert({
      sound: prefs.athanSound,
      vibrate: prefs.vibration,
      city: place?.city,
    });
    const parts: string[] = [];
    parts.push(
      result.shown
        ? 'Notification delivered.'
        : permission === 'granted'
          ? 'Notification could not be shown.'
          : 'Notifications are not allowed yet — tap "Allow notifications".'
    );
    parts.push(
      result.played
        ? prefs.athanSound === 'silent'
          ? 'Silent option selected, no sound played.'
          : 'Adhan audio started.'
        : 'Audio did not start (device volume, autoplay or connection).'
    );
    setTestMessage(parts.join(' '));
    setTestState('done');
  };

  return (
    <Page title="Athan & Notifications">
      <p className="muted small" style={{ margin: '0 0 14px' }}>
        Prayer alerts are calculated from {place ? `${place.city}, ${place.country}` : 'your selected location'} using the
        same engine that shows the countdown on the Home screen.
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
                  ? 'Blocked. Re-enable it in your browser or Android app settings.'
                  : permission === 'unsupported'
                    ? 'This browser does not support notifications.'
                    : 'Not requested yet.'}
            </div>
          </div>
          <span className={granted ? 'badge-soft' : 'badge-gold'}>{granted ? 'GRANTED' : permission.toUpperCase()}</span>
        </div>

        {!granted && permission !== 'unsupported' ? (
          <div className="athan-card-actions">
            <button type="button" className="btn btn-primary btn-block" onClick={() => void requestNotify()}>
              Allow notifications
            </button>
          </div>
        ) : null}

        <p className="athan-note">
          Android and iOS only deliver notifications while the app is closed if the app is installed and the system battery
          optimisation allows it. A website in a browser tab cannot guarantee background delivery — the installed app is
          required for that.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="athan-title">Prayer alerts</h2>

        <Toggle
          checked={prefs.notifyEnabled}
          onChange={(v) => setPrefs({ notifyEnabled: v })}
          label="Prayer notifications"
          sub="Master switch for all five prayers"
        />

        {FIVE.map((key, index) => (
          <Toggle
            key={key}
            prayer={key}
            checked={prefs.prayerAlerts[key] !== false}
            onChange={(v) => setPrefs({ prayerAlerts: { ...prefs.prayerAlerts, [key]: v } })}
            label={key.charAt(0).toUpperCase() + key.slice(1)}
            sub={key === 'fajr' ? 'Fajr has its own reminder wording' : undefined}
            last={index === FIVE.length - 1}
            right={<span className="athan-time">{timeLabel(key)}</span>}
          />
        ))}

        <p className="athan-note">
          Times come from your saved location and calculation method. Turning a prayer off stops only that prayer&rsquo;s
          alert; the others keep their schedule.
        </p>
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
          <button type="button" className="btn btn-ghost btn-block" onClick={() => void preview(prefs.athanSound)}>
            {previewing === prefs.athanSound ? 'Playing… tap to replay' : 'Preview this sound'}
          </button>
        </div>

        {isAdhanPlaying() ? (
          <div className="athan-card-actions">
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={() => {
                stopAdhan();
                setPreviewing(null);
              }}
            >
              Stop playback
            </button>
          </div>
        ) : null}

        <p className="athan-note">
          The Adhan recordings stream from a public archive of adhan audio. If a recording cannot be fetched, the app tells
          you instead of pretending the adhan played.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="athan-title">Behaviour</h2>

        <Toggle
          checked={prefs.vibration}
          onChange={(v) => setPrefs({ vibration: v })}
          label="Vibrate with the notification"
          sub="Where the device allows it"
        />

        <div className="athan-row">
          <div className="athan-row-main">
            <div className="athan-label">Pre-prayer reminder</div>
            <div className="athan-meta">A quiet reminder before the adhan</div>
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

        <Toggle checked={prefs.dailyQuran} onChange={(v) => setPrefs({ dailyQuran: v })} label="Daily Quran reminder" />
        <Toggle checked={prefs.dailyHadith} onChange={(v) => setPrefs({ dailyHadith: v })} label="Daily hadith reminder" />
        <Toggle
          checked={prefs.dailyDua}
          onChange={(v) => setPrefs({ dailyDua: v })}
          label="Daily dua reminder"
          last
        />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="athan-title">Test</h2>
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => void runTest()}
          disabled={testState === 'running'}
        >
          {testState === 'running' ? 'Sending test…' : 'Send a test notification'}
        </button>

        {testMessage ? (
          <p className="athan-status" role="status">
            {testMessage}
          </p>
        ) : null}

        <div className="athan-card-actions">
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => {
              resetAlertMemory();
              toast('Alert memory cleared — today’s prayers can notify again.', 'success');
            }}
          >
            Reschedule today’s alerts
          </button>
        </div>

        <p className="athan-note">
          Each prayer slot is recorded once it fires, so reloading the app or opening a second tab will not repeat the same
          notification.
        </p>
      </div>
    </Page>
  );
}

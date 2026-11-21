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

const GOLD = '#d4af37';
const EMERALD = '#0f5132';

const S: Record<string, React.CSSProperties> = {
  header: { marginBottom: 14 },
  h1: { fontSize: 22, margin: '0 0 4px', color: EMERALD, fontWeight: 700 },
  sub: { margin: 0, fontSize: 13, opacity: 0.75 },
  card: {
    background: 'var(--card, #fff)',
    border: `1px solid ${GOLD}55`,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    boxShadow: '0 2px 10px rgba(15,81,50,0.06)',
  },
  cardTitle: { fontSize: 15, fontWeight: 700, margin: '0 0 10px', color: EMERALD },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
  },
  rowLast: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 0',
  },
  label: { fontSize: 14, fontWeight: 600 },
  meta: { fontSize: 12, opacity: 0.7, marginTop: 2 },
  time: { fontSize: 13, fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
  select: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${GOLD}88`,
    background: 'transparent',
    fontSize: 14,
    color: 'inherit',
  },
  button: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: 'none',
    background: EMERALD,
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  buttonGhost: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 12,
    border: `1px solid ${GOLD}`,
    background: 'transparent',
    color: EMERALD,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  note: {
    fontSize: 12,
    lineHeight: 1.5,
    opacity: 0.8,
    margin: '10px 0 0',
  },
  pill: {
    display: 'inline-block',
    padding: '3px 9px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.2,
  },
};

function Toggle({
  checked,
  onChange,
  label,
  sub,
  last,
  right,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
  last?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div style={last ? S.rowLast : S.row}>
      <div style={{ flex: 1 }}>
        <div style={S.label}>{label}</div>
        {sub ? <div style={S.meta}>{sub}</div> : null}
      </div>
      {right}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 20, height: 20, accentColor: EMERALD }}
          aria-label={label}
        />
      </label>
    </div>
  );
}

export default function Athan() {
  const { prefs, setPrefs, notifyPermission, requestNotify, times, place, toast } = useStore();
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
    <Page>
      <div style={S.header}>
        <h1 style={S.h1}>Athan &amp; Notifications</h1>
        <p style={S.sub}>
          Prayer alerts are calculated from {place ? `${place.city}, ${place.country}` : 'your selected location'} using the same
          engine that shows the countdown on the Home screen.
        </p>
      </div>

      <div style={S.card}>
        <h2 style={S.cardTitle}>Permission</h2>
        <div style={S.row}>
          <div>
            <div style={S.label}>Notification permission</div>
            <div style={S.meta}>
              {permission === 'granted'
                ? 'Allowed on this device.'
                : permission === 'denied'
                  ? 'Blocked. Re-enable it in your browser or Android app settings.'
                  : permission === 'unsupported'
                    ? 'This browser does not support notifications.'
                    : 'Not requested yet.'}
            </div>
          </div>
          <span
            style={{
              ...S.pill,
              background: granted ? 'rgba(15,81,50,0.12)' : 'rgba(212,175,55,0.18)',
              color: granted ? EMERALD : '#8a6d1f',
            }}
          >
            {granted ? 'GRANTED' : permission.toUpperCase()}
          </span>
        </div>
        {!granted && permission !== 'unsupported' ? (
          <div style={{ marginTop: 12 }}>
            <button type="button" style={S.button} onClick={() => void requestNotify()}>
              Allow notifications
            </button>
          </div>
        ) : null}
        <p style={S.note}>
          Android and iOS only deliver notifications while the app is closed if the app is installed and the system battery
          optimisation allows it. A website in a browser tab cannot guarantee background delivery — the installed app is
          required for that.
        </p>
      </div>

      <div style={S.card}>
        <h2 style={S.cardTitle}>Prayer alerts</h2>
        <Toggle
          checked={prefs.notifyEnabled}
          onChange={(v) => setPrefs({ notifyEnabled: v })}
          label="Prayer notifications"
          sub="Master switch for all five prayers"
        />
        {FIVE.map((key, index) => (
          <Toggle
            key={key}
            checked={prefs.prayerAlerts[key] !== false}
            onChange={(v) => setPrefs({ prayerAlerts: { ...prefs.prayerAlerts, [key]: v } })}
            label={key.charAt(0).toUpperCase() + key.slice(1)}
            sub={key === 'fajr' ? 'Fajr has its own reminder wording' : undefined}
            last={index === FIVE.length - 1}
            right={<span style={S.time}>{timeLabel(key)}</span>}
          />
        ))}
      </div>

      <div style={S.card}>
        <h2 style={S.cardTitle}>Adhan sound</h2>
        <select
          style={S.select}
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
        <div style={{ marginTop: 12 }}>
          <button type="button" style={S.buttonGhost} onClick={() => void preview(prefs.athanSound)}>
            {previewing === prefs.athanSound ? 'Playing… tap to replay' : 'Preview this sound'}
          </button>
        </div>
        {isAdhanPlaying() ? (
          <div style={{ marginTop: 10 }}>
            <button type="button" style={S.buttonGhost} onClick={() => { stopAdhan(); setPreviewing(null); }}>
              Stop playback
            </button>
          </div>
        ) : null}
        <p style={S.note}>
          The four Adhan recordings stream from a public archive of adhan audio. If a recording cannot be fetched, the app
          tells you instead of pretending the adhan played.
        </p>
      </div>

      <div style={S.card}>
        <h2 style={S.cardTitle}>Behaviour</h2>
        <Toggle
          checked={prefs.vibration}
          onChange={(v) => setPrefs({ vibration: v })}
          label="Vibrate with the notification"
          sub="Where the device allows it"
        />
        <div style={S.row}>
          <div style={{ flex: 1 }}>
            <div style={S.label}>Pre-prayer reminder</div>
            <div style={S.meta}>A quiet reminder before the adhan</div>
          </div>
          <select
            style={{ ...S.select, width: 'auto', minWidth: 110 }}
            value={prefs.preReminder}
            onChange={(e) => setPrefs({ preReminder: Number(e.target.value) })}
            aria-label="Pre-prayer reminder"
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

      <div style={S.card}>
        <h2 style={S.cardTitle}>Test</h2>
        <button
          type="button"
          style={{ ...S.button, opacity: testState === 'running' ? 0.7 : 1 }}
          onClick={() => void runTest()}
          disabled={testState === 'running'}
        >
          {testState === 'running' ? 'Sending test…' : 'Send a test notification'}
        </button>
        {testMessage ? (
          <p style={{ ...S.note, color: EMERALD }} role="status">
            {testMessage}
          </p>
        ) : null}
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            style={S.buttonGhost}
            onClick={() => {
              resetAlertMemory();
              toast('Alert memory cleared — today’s prayers can notify again.', 'success');
            }}
          >
            Reschedule today’s alerts
          </button>
        </div>
        <p style={S.note}>
          Each prayer slot is recorded once it fires, so reloading the app or opening a second tab will not repeat the same
          notification.
        </p>
      </div>
    </Page>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import DeviceDelivery from './DeviceDelivery';

export type NotifyCategory = {
  id: string;
  emoji: string;
  route: string;
  label: Record<string, string>;
  hint: Record<string, string>;
  defaultEnabled: boolean;
};

export type NotifyLang = { id: string; label: string; native: string; dir: string };

export type NotifyPrefs = {
  language: string;
  enabled: boolean;
  categories: Record<string, boolean>;
  updatedAt: string | null;
};

export type FcmStatus = {
  configured: boolean;
  reason: string | null;
  projectId: string | null;
  tokens: { total: number; users: number; byPlatform: Record<string, number> };
  devices: Array<{
    id: string;
    platform: string;
    label: string;
    tokenTail: string;
    lastOkAt: string | null;
    lastError: string | null;
  }>;
};

/**
 * Notification settings for one account.
 *
 * Every switch here is stored on the server by /api/notifications/prefs, and the
 * server is what enforces it: a category that is switched off is never written to
 * the inbox and never pushed to a device. The native-delivery panel reports the
 * real state of Firebase rather than assuming it works.
 */
export default function NotificationCenter() {
  const [categories, setCategories] = useState<NotifyCategory[]>([]);
  const [languages, setLanguages] = useState<NotifyLang[]>([]);
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [fcm, setFcm] = useState<FcmStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [catalog, mine, status] = await Promise.all([
      api<{ languages: NotifyLang[]; categories: NotifyCategory[] }>('/notifications/catalog').catch(() => null),
      api<{ prefs: NotifyPrefs }>('/notifications/prefs').catch(() => null),
      api<FcmStatus>('/push/fcm/status').catch(() => null),
    ]);
    if (catalog) {
      setCategories(catalog.categories || []);
      setLanguages(catalog.languages || []);
    }
    if (mine) setPrefs(mine.prefs);
    if (status) setFcm(status);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<NotifyPrefs>) {
    if (!prefs) return;
    setBusy(true);
    setNote(null);
    const optimistic: NotifyPrefs = {
      ...prefs,
      ...patch,
      categories: { ...prefs.categories, ...(patch.categories || {}) },
    };
    setPrefs(optimistic);
    try {
      const res = await api<{ prefs: NotifyPrefs }>('/notifications/prefs', { method: 'PUT', body: patch });
      setPrefs(res.prefs);
      setNote({ ok: true, text: 'Saved.' });
    } catch (error) {
      setPrefs(prefs);
      setNote({ ok: false, text: error instanceof Error ? error.message : 'That could not be saved.' });
    } finally {
      setBusy(false);
    }
  }

  async function testNative() {
    setBusy(true);
    setTestResult(null);
    try {
      const res = await api<{ message: string; sent: number; deferred: number; failed: number }>('/push/fcm/test', {
        method: 'POST',
        body: {},
      });
      setTestResult(res.message);
      await load();
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'The test could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  const label = (entry: NotifyCategory) =>
    entry.label[prefs?.language || 'en'] || entry.label.en || entry.id;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card">
        <h3 className="section-title">All notifications</h3>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small">Receive notifications from RIFQ Muslim</span>
          <button
            className={`switch ${prefs?.enabled ? 'on' : ''}`}
            aria-label="Toggle all notifications"
            data-testid="notif-master"
            disabled={busy || !prefs}
            onClick={() => void save({ enabled: !prefs?.enabled })}
          />
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Turning this off stops every category below, including prayer reminders, until you switch it back on.
        </p>
      </div>

      <div className="card">
        <h3 className="section-title">Notification language</h3>
        <div className="chips">
          {languages.map((lang) => (
            <button
              key={lang.id}
              className={`chip ${prefs?.language === lang.id ? 'active' : ''}`}
              data-testid={`notif-lang-${lang.id}`}
              disabled={busy || !prefs}
              onClick={() => void save({ language: lang.id })}
            >
              {lang.native}
              {lang.dir === 'rtl' ? ' · RTL' : ''}
            </button>
          ))}
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Notifications written by the server arrive in this language. Messages an administrator writes use the wording
          they supplied for each language.
        </p>
      </div>

      <div className="card">
        <h3 className="section-title">Categories</h3>
        <div className="stack" style={{ gap: 10 }}>
          {categories.map((entry) => {
            const on = prefs?.categories?.[entry.id] ?? entry.defaultEnabled;
            return (
              <div key={entry.id} className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600 }}>
                    <span aria-hidden style={{ marginRight: 6 }}>
                      {entry.emoji}
                    </span>
                    {label(entry)}
                  </div>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    {entry.hint[prefs?.language || 'en'] || entry.hint.en || ''}
                  </p>
                </div>
                <button
                  className={`switch ${on ? 'on' : ''}`}
                  aria-label={`Toggle ${entry.label.en || entry.id} notifications`}
                  data-testid={`notif-cat-${entry.id}`}
                  disabled={busy || !prefs || !prefs.enabled}
                  onClick={() => void save({ categories: { [entry.id]: !on } })}
                />
              </div>
            );
          })}
        </div>
        {prefs && !prefs.enabled ? (
          <p className="tiny" style={{ color: 'var(--gold)', marginBottom: 0 }}>
            All notifications are switched off, so these categories are paused.
          </p>
        ) : null}
        {note ? (
          <p className="small" style={{ marginTop: 8, color: note.ok ? 'var(--gold)' : '#e0655b' }} role="status">
            {note.text}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h3 className="section-title">This device</h3>
        <DeviceDelivery />
      </div>

      <div className="card">
        <h3 className="section-title">Native push (Android &amp; iOS app)</h3>
        {fcm?.configured ? (
          <p className="small" data-testid="fcm-status" style={{ marginTop: 0 }}>
            Connected to Firebase project <strong>{fcm.projectId}</strong>. {fcm.tokens.total} device token(s)
            registered{fcm.tokens.users ? ` across ${fcm.tokens.users} account(s)` : ''}.
          </p>
        ) : (
          <p className="small" data-testid="fcm-status" style={{ marginTop: 0, color: 'var(--gold)' }}>
            Not configured yet: {fcm?.reason || 'the server has no Firebase service account.'}
          </p>
        )}
        {fcm?.devices?.length ? (
          <ul className="small" style={{ margin: '4px 0 8px', paddingInlineStart: 18 }}>
            {fcm.devices.slice(0, 5).map((device) => (
              <li key={device.id}>
                {device.platform} · •••{device.tokenTail}
                {device.lastOkAt ? ' · last delivery accepted' : device.lastError ? ` · ${device.lastError}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        <button className="btn btn-soft btn-block" type="button" disabled={busy} onClick={() => void testNative()}>
          Send a test notification to this account
        </button>
        {testResult ? (
          <p className="small" style={{ marginBottom: 0, marginTop: 8 }} role="status">
            {testResult}
          </p>
        ) : null}
        <p className="tiny muted" style={{ marginTop: 8, marginBottom: 0 }}>
          In the installed app, closed-app delivery needs the Firebase service account on the server plus a native build
          made with the same Firebase project. Without it, alerts still arrive as web push and in the inbox.
        </p>
      </div>
    </div>
  );
}

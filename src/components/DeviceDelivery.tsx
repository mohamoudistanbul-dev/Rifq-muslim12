import React, { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { disableDevice, enableDevice, getStatus, pushSupported, sendTestPush, type PushStatus } from '../lib/push';

/**
 * Shows whether this device can actually receive background alerts, and lets
 * the user turn them on or send a real test push. The state shown is the
 * server's record for this account, not a local guess.
 */
export default function DeviceDelivery() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    try {
      setStatus(await getStatus());
      setSignedOut(false);
    } catch (error) {
      setStatus(null);
      if (error instanceof ApiError && error.status === 401) setSignedOut(true);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function act(fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fn();
      setNote({ ok: res.ok, text: res.message });
      await refresh();
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : 'That did not work.' });
    } finally {
      setBusy(false);
    }
  }

  const count = status?.count ?? 0;
  const supported = pushSupported();

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2 className="athan-title">Background delivery</h2>
      <p className="athan-meta" style={{ marginTop: 0 }}>
        {signedOut
          ? 'Sign in to register this device for background alerts.'
          : count > 0
            ? `${count} device${count === 1 ? '' : 's'} registered. Messages reach this account even when the app is closed.`
            : 'No device registered yet. Turn this on so messages arrive while the app is closed.'}
      </p>

      {!supported ? (
        <p className="athan-meta" style={{ color: 'var(--gold)' }}>
          This browser does not support background push. Use Chrome on Android, or the installed app.
        </p>
      ) : null}

      {status?.devices?.length ? (
        <ul className="athan-meta" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {status.devices.map((device) => (
            <li key={device.id}>
              {device.label || device.host}
              {device.lastOkAt ? ' · last delivery accepted' : ' · not delivered yet'}
              {device.lastError ? ` · last error: ${device.lastError}` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {note ? (
        <p className="athan-meta" style={{ margin: '8px 0 0', color: note.ok ? undefined : '#e0655b' }}>
          {note.text}
        </p>
      ) : null}

      {!signedOut ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            disabled={busy || !supported}
            onClick={() => act(() => enableDevice())}
          >
            {busy ? 'Working…' : 'Enable on this device'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={busy || count === 0}
            onClick={() => act(sendTestPush)}
          >
            Send test notification
          </button>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={busy || count === 0}
            onClick={() => act(disableDevice)}
          >
            Turn off
          </button>
        </div>
      ) : null}
    </div>
  );
}

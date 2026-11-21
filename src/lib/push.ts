/**
 * Real background delivery for RIFQ Muslim.
 *
 * The browser registers this device with the server as a Web Push subscription.
 * The server then pushes to it, so a message from the admin team reaches the
 * phone even when the app is closed.
 *
 * Everything here reports what actually happened. Nothing pretends a
 * notification was delivered when no device is registered.
 */
import { api } from './api';

export type PushDevice = {
  id: string;
  label: string;
  host: string;
  createdAt: string;
  lastOkAt: string | null;
  lastError: string | null;
  failCount: number;
};

export type PushStatus = {
  devices: PushDevice[];
  count: number;
  publicKey: string | null;
  keySource: string;
};

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** VAPID keys travel as base64url; PushManager needs raw bytes. */
function keyToBytes(base64: string): Uint8Array {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}

export async function getStatus(): Promise<PushStatus> {
  return api<PushStatus>('/push/status');
}

export async function enableDevice(label = ''): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) {
    return {
      ok: false,
      message: 'This browser cannot receive background push. Use Chrome on Android, or install the app.',
    };
  }
  if (Notification.permission === 'denied') {
    return {
      ok: false,
      message: 'Notifications are blocked for this app. Allow them in your browser or Android settings, then try again.',
    };
  }

  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, message: 'Permission was not granted, so no notification can be delivered yet.' };
  }

  const reg = await activeRegistration();
  const key = await api<{ publicKey: string | null }>('/push/key');
  if (!key.publicKey) {
    return { ok: false, message: 'The server has no push key configured yet.' };
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(key.publicKey) as unknown as BufferSource,
    });
  }

  await api('/push/subscribe', {
    method: 'POST',
    body: { subscription: sub.toJSON(), label: label || `${navigator.platform || 'Device'}` },
  });
  return { ok: true, message: 'Background alerts are on for this device.' };
}

export async function disableDevice(): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) return { ok: false, message: 'This browser does not support background push.' };
  const reg = await activeRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: false, message: 'This device is not registered for background alerts.' };
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
  return { ok: true, message: 'Background alerts are off for this device.' };
}

export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  const res = await api<{ devices: number; sent: number; failed: number; message: string }>('/push/test', {
    method: 'POST',
    body: {},
  });
  return { ok: res.sent > 0, message: res.message };
}

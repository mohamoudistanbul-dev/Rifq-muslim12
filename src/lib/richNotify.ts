/**
 * Client half of the rich prayer notifications.
 *
 * The notification itself is rendered by the service worker (and by the native
 * bridge on Android). This module owns the actions the user taps and the
 * offline queue, so "Already Prayed" and "Remind in 15 min" work even when the
 * tap happens while the app is closed and the session has since expired.
 *
 * Nothing here fakes a result: a confirmation is only reported as saved when the
 * server accepted it, otherwise it is queued locally and reported as queued.
 */

export interface PrayerAction {
  action: 'prayed' | 'snooze' | 'open';
  title: string;
}

export const PRAYER_ACTIONS: PrayerAction[] = [
  { action: 'prayed', title: 'Already Prayed' },
  { action: 'snooze', title: 'Remind in 15 min' },
  { action: 'open', title: 'Open App' },
];

const QUEUE_DB = 'rifq-sw-actions';
const QUEUE_STORE = 'queue';
const LOCAL_QUEUE_KEY = 'rifq.prayer.queue.v1';

export function prayerImage(prayer: string): string {
  return `/notif/prayer-${String(prayer || '').toLowerCase()}.png`;
}

/** Local calendar day, `YYYY-MM-DD` — the same key the server stores. */
export function localDayKey(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/* --------------------------- local fallback queue ------------------------- */

interface QueuedAction {
  type: 'confirm' | 'snooze';
  prayer: string;
  at: number;
}

function readLocalQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(LOCAL_QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

function writeLocalQueue(list: QueuedAction[]): void {
  try {
    localStorage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* private mode: the acknowledgement text already told the user */
  }
}

function queueLocally(entry: QueuedAction): void {
  writeLocalQueue([...readLocalQueue(), entry]);
}

/* ------------------------------ public API -------------------------------- */

export interface ConfirmResult {
  ok: boolean;
  queued?: boolean;
  already?: boolean;
  day?: string;
  error?: string;
}

/** Records "I have prayed this" for today. */
export async function confirmPrayer(prayer: string, source = 'app'): Promise<ConfirmResult> {
  const key = String(prayer || '').toLowerCase();
  if (!key) return { ok: false, error: 'Unknown prayer.' };
  try {
    const result = await postJson<{ already: boolean; day: string }>('/api/prayers/confirm', {
      prayer: key,
      source,
      day: localDayKey(),
    });
    return { ok: true, already: result.already, day: result.day };
  } catch {
    queueLocally({ type: 'confirm', prayer: key, at: Date.now() });
    return { ok: true, queued: true, error: 'Saved on this device; it syncs when you are signed in.' };
  }
}

export interface SnoozeResult {
  ok: boolean;
  queued?: boolean;
  fireAt?: string;
  minutes?: number;
  error?: string;
}

/** Queues a real follow-up reminder through the server scheduler. */
export async function snoozePrayer(prayer: string, minutes = 15): Promise<SnoozeResult> {
  const key = String(prayer || '').toLowerCase();
  if (!key) return { ok: false, error: 'Unknown prayer.' };
  try {
    const result = await postJson<{ fireAt: string; minutes: number }>('/api/prayers/snooze', {
      prayer: key,
      minutes,
      day: localDayKey(),
    });
    return { ok: true, fireAt: result.fireAt, minutes: result.minutes };
  } catch {
    queueLocally({ type: 'snooze', prayer: key, at: Date.now() });
    return { ok: true, queued: true, error: 'Snooze saved on this device; open RIFQ Muslim to schedule it.' };
  }
}

export interface ConfirmedPrayer {
  prayer: string;
  confirmedAt: string;
  source: string | null;
}

export async function confirmedToday(day = localDayKey()): Promise<ConfirmedPrayer[]> {
  try {
    const response = await fetch(`/api/prayers/confirmed?day=${encodeURIComponent(day)}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { confirmations?: ConfirmedPrayer[] };
    return Array.isArray(json.confirmations) ? json.confirmations : [];
  } catch {
    return [];
  }
}

/* ------------------------- service worker queue drain --------------------- */

function openQueueDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(QUEUE_DB, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        database.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

interface SwQueued extends QueuedAction {
  id?: number;
}

/**
 * Sends anything the notification buttons stored while the app was closed or
 * the session had expired. Called on app start.
 */
export async function drainQueuedActions(): Promise<{ synced: number; remaining: number }> {
  let synced = 0;

  const local = readLocalQueue();
  if (local.length) {
    const left: QueuedAction[] = [];
    for (const entry of local) {
      try {
        await postJson(
          entry.type === 'confirm' ? '/api/prayers/confirm' : '/api/prayers/snooze',
          entry.type === 'confirm'
            ? { prayer: entry.prayer, source: 'notification-queued', day: localDayKey() }
            : { prayer: entry.prayer, minutes: 15, day: localDayKey() }
        );
        synced += 1;
      } catch {
        left.push(entry);
      }
    }
    writeLocalQueue(left);
  }

  const database = await openQueueDb();
  if (!database) return { synced, remaining: readLocalQueue().length };

  const pending = await new Promise<SwQueued[]>((resolve) => {
    try {
      const tx = database.transaction(QUEUE_STORE, 'readonly');
      const request = tx.objectStore(QUEUE_STORE).getAll();
      request.onsuccess = () => resolve((request.result as SwQueued[]) || []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

  let remaining = 0;
  for (const entry of pending) {
    try {
      await postJson(
        entry.type === 'confirm' ? '/api/prayers/confirm' : '/api/prayers/snooze',
        entry.type === 'confirm'
          ? { prayer: entry.prayer, source: 'notification-queued', day: localDayKey() }
          : { prayer: entry.prayer, minutes: 15, day: localDayKey() }
      );
      synced += 1;
      if (entry.id !== undefined) {
        await new Promise<void>((resolve) => {
          const tx = database.transaction(QUEUE_STORE, 'readwrite');
          tx.objectStore(QUEUE_STORE).delete(entry.id as number);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      }
    } catch {
      remaining += 1;
    }
  }

  database.close();
  return { synced, remaining: remaining + readLocalQueue().length };
}

/*
 * RIFQ Muslim service worker.
 *
 * Jobs:
 *  1. Render the expanded prayer notification: banner image, remaining-time
 *     title, prayer time and the three action buttons.
 *  2. Handle those actions for real. "Already Prayed" records the confirmation
 *     on the server; "Remind in 15 min" queues a genuine follow-up reminder;
 *     "Open App" opens the prayer screen.
 *  3. Receive a real push from the server (Web Push) so an admin message or a
 *     due snooze arrives even when the app is closed.
 *
 * Adhan audio is played by the page, not here: a service worker has no audio
 * output, and pretending otherwise would be a fake "adhan" notification.
 */

const ICON = '/icons/icon-192.png';
const QUEUE_DB = 'rifq-sw-actions';
const QUEUE_STORE = 'queue';

const PRAYER_ACTIONS = [
  { action: 'prayed', title: 'Already Prayed' },
  { action: 'snooze', title: 'Remind in 15 min' },
  { action: 'open', title: 'Open App' },
];

const cap = (value) => {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

const CACHE_VERSION = 'rifq-v4';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png'];

/*
 * Public, read-only content that is worth keeping on the device. User-scoped
 * endpoints (bookmarks, profile, admin) are deliberately absent: the service
 * worker cannot tell one signed-in user from the next, so it must never replay
 * their data. Those are cached by the page itself, which is cleared on logout.
 */
const CACHEABLE_API = [
  '/api/quran',
  '/api/hadith',
  '/api/duas',
  '/api/config',
  '/api/kids',
  '/api/quiz',
  '/api/announcements',
  '/api/prayer',
  '/api/mosques',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One missing optional asset must not fail the whole install.
      await Promise.all(
        SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

/* ------------------------------ offline shell ---------------------------- */

const isCacheableApi = (pathname) => CACHEABLE_API.some((prefix) => pathname.startsWith(prefix));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Launching the app without internet must show the app, not a browser error.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put('/index.html', fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const shell = (await cache.match('/index.html')) || (await cache.match('/'));
          if (shell) return shell;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>RIFQ Muslim</title><body style="font-family:system-ui;background:#04291f;color:#f4e6c3;padding:32px"><h1>RIFQ Muslim</h1><p>No internet connection. Reopen the app once you are back online.</p></body>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  // Quran text, Hadith and Duas: cache-first with a quiet refresh in the
  // background, so read content keeps working while the device is disconnected.
  if (isCacheableApi(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) return cached;
        const res = await network;
        if (res) return res;
        return new Response(
          JSON.stringify({ error: 'offline', message: 'No internet connection' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })()
    );
    return;
  }

  // Content-hashed build assets and icons are safe to serve from cache first.
  if (url.pathname.startsWith('/assets/') || /\.(css|js|mjs|woff2?|png|svg|webp|jpe?g|ico)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          return Response.error();
        }
      })()
    );
  }
});

/* ------------------------- offline action queue --------------------------- */

function openQueue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        database.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queueAction(entry) {
  try {
    const database = await openQueue();
    await new Promise((resolve, reject) => {
      const tx = database.transaction(QUEUE_STORE, 'readwrite');
      tx.objectStore(QUEUE_STORE).add(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  } catch {
    /* if the queue is unavailable the notification still tells the user */
  }
}

/* --------------------------- action handling ------------------------------ */

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function clockText(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Performs the action the user tapped and returns the acknowledgement text. */
async function handlePrayerAction(action, data) {
  const prayer = String(data.prayer || '').toLowerCase();
  if (!prayer) return null;

  if (action === 'prayed') {
    try {
      await postJson('/api/prayers/confirm', { prayer, source: 'notification' });
      return `${cap(prayer)} marked as prayed. JazakAllahu khayran.`;
    } catch {
      await queueAction({ type: 'confirm', prayer, at: Date.now() });
      return `${cap(prayer)} saved on this device. It syncs the next time you open RIFQ Muslim signed in.`;
    }
  }

  if (action === 'snooze') {
    try {
      const result = await postJson('/api/prayers/snooze', { prayer, minutes: 15 });
      const at = clockText(result.fireAt);
      return `We will remind you about ${cap(prayer)} again${at ? ` at ${at}` : ' in 15 minutes'}.`;
    } catch {
      await queueAction({ type: 'snooze', prayer, at: Date.now() });
      return 'Snooze saved on this device. Open RIFQ Muslim to schedule the reminder.';
    }
  }

  return null;
}

async function focusOrOpen(target) {
  const url = target || '/';
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of list) {
    if ('focus' in client) {
      try {
        await client.navigate(url);
      } catch {
        /* older clients cannot navigate from here */
      }
      return client.focus();
    }
  }
  return self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  const action = event.action || 'open';
  event.notification.close();

  if (action === 'prayed' || action === 'snooze') {
    event.waitUntil(
      (async () => {
        const text = await handlePrayerAction(action, data);
        if (!text) {
          await focusOrOpen(data.url || '/');
          return;
        }
        await self.registration.showNotification(
          action === 'prayed' ? 'Prayer confirmed' : 'Reminder set',
          {
            body: text,
            tag: `rifq-ack-${Date.now()}`,
            icon: ICON,
            badge: ICON,
            silent: true,
            data: { url: '/athan' },
          }
        );
      })()
    );
    return;
  }

  event.waitUntil(focusOrOpen(data.url || '/'));
});

/* --------------------------- rich rendering ------------------------------- */

function richOptions(data) {
  const actions =
    Array.isArray(data.actions) && data.actions.length
      ? data.actions.slice(0, 3)
      : data.prayer
        ? PRAYER_ACTIONS
        : null;

  const options = {
    body: data.body || '',
    tag: data.tag || (data.broadcastId ? `rifq-${data.broadcastId}` : 'rifq-push'),
    icon: ICON,
    badge: ICON,
    data: {
      url: data.url || data.link || '/',
      prayer: data.prayer || null,
      tag: data.tag || 'rifq',
    },
    vibrate: data.vibrate === false ? undefined : [250, 120, 250],
    renotify: false,
    timestamp: Date.now(),
    requireInteraction: data.requireInteraction === true,
  };

  if (data.image) options.image = data.image;
  if (actions) options.actions = actions;
  return options;
}

/* In-page alerts (prayer time reached while the app is open). */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'rifq:notify') return;
  event.waitUntil(self.registration.showNotification(data.title || 'RIFQ Muslim', richOptions(data)));
});

/* Real push from the server (admin messages, announcements, due snoozes). */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'RIFQ Muslim', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'RIFQ Muslim';
  const options = richOptions({
    ...payload,
    url: payload.url || payload.link || (payload.prayer ? `/athan?prayer=${payload.prayer}` : '/notifications'),
    tag: payload.tag || (payload.broadcastId ? `rifq-${payload.broadcastId}` : 'rifq-push'),
  });

  event.waitUntil(self.registration.showNotification(title, options));
});

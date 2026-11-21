/*
 * RIFQ Muslim service worker.
 *
 * Two jobs:
 *  1. Show a branded notification while the app is not in the foreground.
 *  2. Receive a real push message from the server (Web Push) and show it, so a
 *     message from the admin team arrives even when the app is closed.
 *
 * Adhan audio is played by the page, not here: a service worker has no audio
 * output, and claiming otherwise would be a fake "adhan" notification.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  const target = data.url || '/';
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          try {
            client.navigate(target);
          } catch {
            /* older clients cannot navigate from here */
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

/* In-page alerts (prayer time reached while the app is open). */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'rifq:notify') return;
  event.waitUntil(
    self.registration.showNotification(data.title || 'RIFQ Muslim', {
      body: data.body || '',
      tag: data.tag || 'rifq',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
      silent: true,
      vibrate: data.vibrate === false ? undefined : [250, 120, 250],
    })
  );
});

/* Real push from the server (admin messages, announcements). */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'RIFQ Muslim', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'RIFQ Muslim';
  const options = {
    body: payload.body || '',
    tag: payload.tag || (payload.broadcastId ? `rifq-${payload.broadcastId}` : 'rifq-push'),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url || payload.link || '/notifications' },
    vibrate: payload.vibrate === false ? undefined : [250, 120, 250],
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

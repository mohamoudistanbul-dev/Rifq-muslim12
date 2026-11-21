/*
 * RIFQ Muslim service worker.
 *
 * It exists for one job: showing a branded notification when the app is not in
 * the foreground. Prayer times are calculated in the app (same engine that
 * renders the countdown) and posted here, so no time is ever invented here.
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

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'rifq:notify') return;
  event.waitUntil(
    self.registration.showNotification(data.title || 'RIFQ Muslim', {
      body: data.body || '',
      tag: data.tag || 'rifq',
      icon: '/icons/icon-192.png',
      data: { url: data.url || '/' },
      silent: true,
      vibrate: data.vibrate === false ? undefined : [250, 120, 250],
    })
  );
});

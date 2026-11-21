# RIFQ Muslim — Notifications and Quran background audio

This document states exactly what runs today, what depends on the device, and what
still needs an account or credential. Nothing here is a claim of a completed
real-device test.

## 1. What the app does now

### Floating banners while the app is open

`src/lib/foreground.ts` is a small event bus. `showAlert()` in `src/lib/notify.ts`
always publishes to it, so a user who is inside the app sees the alert even when
Android/iOS notification permission is denied.

`src/components/ForegroundAlerts.tsx` renders the banner stack (mounted once in
`src/App.tsx`): RIFQ Muslim icon, title, message, **Open** (routes to the related
screen) and dismiss. Banners expire after 9 seconds and are capped at three.

A web page cannot draw a true system heads-up banner itself; the system banner
comes from the notification itself (Android high-importance channel / iOS banner
presentation), and the in-app banner covers the "user is looking at the app" case.

### Prayer time with the app open

When a prayer alert fires, the app also shows the branded Adhan screen: prayer
name, local clock, the real Adhan recording with Play/Stop, **Prayer settings** and
**Dismiss**. The recording is not started twice for one slot — the slot key in
`localStorage` (`rifq.alerts.fired`) still guarantees one alert per slot, so
reloading or opening a second tab cannot repeat it.

### Background and closed app

- **Browser tab:** `public/sw.js` shows the notification and routes a tap to
  `data.url`. A closed browser tab cannot schedule anything; this is a platform
  limit, and the Athan screen says so in plain words.
- **Installed Android app:** the WebView bridge schedules the same plan through
  `syncNativeSchedule()` into `PrayerAlarmReceiver` / `PrayerNotifications`
  (exact alarms, boot re-registration).
- **Push messages from the owner/admin:** `server/push.js` (web-push, VAPID) sends
  to every registered device, stores `push_status` / `push_error` per recipient and
  shows the counts in the Admin dashboard. Delivery is reported, never assumed.

### Quran audio in the background

`src/lib/quranPlayer.tsx` owns exactly one `<audio>` element for the whole app, so
navigating between screens never destroys playback. It publishes Media Session
metadata (Surah in Arabic and English, reciter, artwork), handles
play/pause/previous/next/seek/stop from the lock screen, reports playback state and
position, and restores the last Surah and position on return.

Leaving the app does **not** pause recitation. The Now Playing screen has a
**Background on/off** control (persisted as `rifq.quranAudio.background`); turning it
off pauses the audio when the app is hidden. Interruptions (calls, headphone
unplug) are handled by the platform audio session.

## 2. What still needs a native build or an account

| Item | State | What is required |
| --- | --- | --- |
| System notification banner, Android/iOS | Works when permission is granted | User taps **Allow notifications** |
| Alerts with the app fully closed (push) | Server side complete | A signed APK/IPA with a push service; browsers use Web Push, which is already configured |
| Firebase Cloud Messaging | Not configured | `google-services.json` + FCM server key for native push on Android |
| APNs (iOS) | Not configured | Apple developer account, APNs key, `UIBackgroundModes: audio` + push entitlement |
| Media foreground service (Android 8+) | Permissions declared in `AndroidManifest.xml` | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `MODIFY_AUDIO_SETTINGS` are declared; a `MediaSessionService` must be added in the native project to hold playback when the OS reclaims the WebView |
| iOS background audio | Not configured | `Info.plist` → `UIBackgroundModes` → `audio` in the iOS project |
| Real-device verification | Not performed here | Install the built APK/IPA on a phone and repeat the checks below |

The WebView is already configured with `mediaPlaybackRequiresUserGesture = false`
(`MainActivity.kt`), which is what allows recitation to start and continue without
a fresh user gesture.

## 3. Device test checklist (run on a real phone)

Notifications:

1. Deny permission, open a prayer test → in-app banner still appears.
2. Grant permission, send a test → system banner appears at the top of the screen.
3. Open the app, background it, wait for a reminder → notification appears.
4. Close the app completely, wait for a reminder → notification appears (installed
   app: exact alarm; browser: not possible, by design).
5. Tap a notification → the related screen opens.
6. Send an owner message from Admin → it appears in the inbox once and the
   dashboard shows real sent/failed counts.

Quran audio:

1. Start a Surah, open WhatsApp → audio continues.
2. Lock the screen → audio continues, lock-screen controls work.
3. Press pause on the lock screen → playback pauses.
4. Return to RIFQ Muslim → same Surah and position.
5. Press Stop → playback ends and the notification disappears.
6. Turn **Background off** → hiding the app pauses the audio.

## Rich prayer notifications (expanded card with action buttons)

A prayer reminder is no longer a plain line of text. When it is due, the
notification expands into a branded card and its three buttons do real work.

### What the notification shows

| Element | Source |
| --- | --- |
| App icon and name | `ic_stat_rifq`, `RIFQ Muslim` |
| Title with remaining time | `"Dhuhr – 30 min remaining"`, built by `prayerPayload()` in `server/rich-notify.js` |
| Prayer time | sub-text, e.g. `Dhuhr · 13:15` |
| Islamic banner image | `/notif/prayer-<prayer>.png` (web push) and `res/drawable-nodpi/notif_prayer.png` (`BigPictureStyle`, native) |
| Progress bar | the 60-minute countdown window, `setProgress` natively and `progress` in the push payload |
| Action buttons | Already Prayed · Remind in 15 min · Open App |

### What the buttons actually do

* **Already Prayed** — writes a confirmation for that prayer and day. In the app
  it calls `POST /api/prayers/confirm`; from the service worker it posts the same
  request and, if the session has expired, queues the tap in IndexedDB
  (`rifq-sw-actions`) so the app replays it on the next open. On Android
  `PrayerActionReceiver` records it in `rifq_prayer_log` with a `pending` entry
  that the WebView layer syncs when the app opens. A second tap returns
  `already: true` instead of counting twice.
* **Remind in 15 min** — creates a real queued reminder in `prayer_snoozes`. The
  server's `startSnoozeScheduler()` pushes it when its time comes, so the
  follow-up arrives even with the app closed. On Android it schedules a genuine
  `AlarmManager` alarm through the existing prayer-alarm path.
* **Open App** — opens `/athan?prayer=<key>`.

### Channels, heads-up banners and duplicates

The `rifq_athan` channel is created at `IMPORTANCE_HIGH`, so Android shows a
heads-up banner whenever the user allows it, on the lock screen
(`VISIBILITY_PUBLIC`) and with vibration. One notification per prayer per day
(tag `rifq-prayer-<prayer>-<yyyyMMdd>`), so a re-fired alarm replaces the old card
instead of stacking duplicates.

### Admin announcements

`sendPushToUsers` now forwards `kind`, `prayer`, `time`, `remainingMinutes`,
`image`, `progress`, `actions` and `requireInteraction` when present, so an
announcement can carry its own image and open the full message on tap.

### Endpoints

* `POST /api/prayers/confirm` `{prayer, day?, source?}` — idempotent confirmation.
* `DELETE /api/prayers/confirm` — undo.
* `GET /api/prayers/confirmed?day=` — the day's confirmations.
* `POST /api/prayers/snooze` `{prayer, minutes?}` / `GET` / `DELETE /:id`.
* `GET /api/prayers/rich-preview?prayer=&remaining=` — the exact payload shape.
* `GET /api/admin/prayers/summary` — confirmations and pending snoozes (admin).

### iOS

iOS shows the title, body, image attachment and tap-to-open, and action buttons
appear when the app registers them through `UNUserNotificationCenter`. iOS does
not support Android's expanded `BigPictureStyle` layout or an in-notification
progress bar; those two are Android-only by platform design.

### Verify

```bash
npm run verify:rich     # confirm, undo, snooze queue, rich payload, admin gating
```

### Device checklist (rich card)

1. Turn on a prayer reminder, wait for it (or use **Test notification**).
2. Expand the notification: banner image, `"<Prayer> – N min remaining"`, prayer
   time and the progress bar must all be visible.
3. Tap **Already Prayed** → the card closes, a confirmation appears, and the
   tracker shows that prayer as done (not counted twice on a second tap).
4. Tap **Remind in 15 min** → a new reminder really arrives 15 minutes later.
5. Tap **Open App** → Rifq Muslim opens on the prayer screen.
6. Confirm no duplicate cards appear for the same prayer.

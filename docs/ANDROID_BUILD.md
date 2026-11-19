# RIFQ Muslim — Android build & release guide

RIFQ Muslim (رِفْق مسلم) — *Your Faith, Your Daily Companion*
Made by Eng Mohamud Yusuf.

The application is a React + TypeScript client with an Express API. The same
codebase ships as a web/PWA build and, through Capacitor, as a real standalone
Android application (no browser shortcut, no WebView bookmark).

---

## 1. What is in this repository

| Path | Purpose |
| --- | --- |
| `src/` | React client (all 30+ screens, emerald/gold design system, en/ar/so + RTL) |
| `server/` | Express API: auth, prefs, bookmarks, tasbih, tracker, community, contact, admin, content proxy |
| `public/` | Icons, manifest, brand assets |
| `Dockerfile` | Production image (Node 22 Alpine, non-root, port 3000) |
| `dist/` | Built client (produced by `npm run build`) |

The API is the only source of user data. The Android shell loads the bundled
client and talks to the deployed API over HTTPS.

---

## 2. Prerequisites for an Android build

Android packaging **cannot** run inside the AppJet sandbox (no Android SDK,
no Gradle Android plugin, no signing keystore). Build it on a workstation or CI
runner with:

- Node.js 22 LTS or newer
- JDK 17 (required by the current Android Gradle Plugin)
- Android SDK Platform 34 + Build Tools 34.0.0 (`sdkmanager` / Android Studio)
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` exported
- A signing keystore that you generate and keep private

---

## 3. Add the Android project (Capacitor)

```bash
# 1. install the wrapper (not committed here on purpose: it needs the SDK)
npm install --save-dev @capacitor/cli
npm install @capacitor/core @capacitor/android

# 2. point the packaged app at the deployed API (see §4)
npx cap init "RIFQ Muslim" com.rifqmuslim.app --web-dir=dist

# 3. build the client, then add the Android platform
npm run build
npx cap add android
npx cap sync android
```

### Identity and branding (required)

Edit `android/app/build.gradle` and `android/app/src/main/AndroidManifest.xml`:

```gradle
android {
    namespace "com.rifqmuslim.app"
    defaultConfig {
        applicationId "com.rifqmuslim.app"
        minSdkVersion 23
        targetSdkVersion 34
        versionCode 1
        versionName "1.0.0"
    }
}
```

```xml
<application
    android:label="RIFQ Muslim"
    android:icon="@mipmap/ic_launcher"
    android:theme="@style/AppTheme">
```

- App label must be exactly `RIFQ Muslim`.
- Launcher icon: generate from `public/icon-512.png` (Android Studio →
  Image Asset, adaptive icon, emerald background + gold foreground).
- Splash screen: emerald background with the RIFQ Muslim logo
  (`android/app/src/main/res/drawable/splash.xml`, `values/styles.xml`).
- Recent-apps card uses the same label and icon automatically.

### Permissions (`AndroidManifest.xml`)

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-feature android:name="android.hardware.location.gps" android:required="false" />
<uses-feature android:name="android.hardware.sensor.compass" android:required="false" />
```

### Plugins used by the app's device features

```bash
npm install @capacitor/geolocation @capacitor/local-notifications \
            @capacitor/share @capacitor/haptics @capacitor/device
npx cap sync android
```

| Feature | Plugin / platform API |
| --- | --- |
| GPS location, city detection | `@capacitor/geolocation` + the app's reverse-geocode API |
| Athan + prayer reminders | `@capacitor/local-notifications` (schedule per prayer, reschedule on location/timezone change) |
| Tasbih haptics | `@capacitor/haptics` |
| Invite Friends (WhatsApp/Telegram/SMS/native share) | `@capacitor/share` |
| Qibla compass | `window.DeviceOrientationEvent` (WebView sensor bridge) |

Notifications are scheduled locally, so they work without a server push
account. Android 13+ requires the runtime `POST_NOTIFICATIONS` permission;
Android 12+ restricts exact alarms — the app schedules with
`allowWhileIdle` and falls back to an inexact alarm, which can fire a few
minutes late on aggressively battery-optimised devices. Users should exempt
RIFQ Muslim from battery optimisation for the most accurate Athan.

---

## 4. Configure the API endpoint

The packaged build serves the UI from the local bundle, so it cannot use the
relative `/api` path. Provide the deployed backend at build time:

```bash
VITE_API_BASE="https://YOUR-DEPLOYED-APP.example.com/api" npm run build
npx cap sync android
```

`src/lib/api.ts` reads `VITE_API_BASE` (default `/api` for the web build).
The backend must allow the WebView origin (`capacitor://localhost` /
`https://localhost`) — see the CORS notes in `server/index.js`.

---

## 5. Signing (never commit the keystore)

```bash
keytool -genkeypair -v -keystore rifq-release.keystore \
  -alias rifq -keyalg RSA -keysize 2048 -validity 10000
```

`android/keystore.properties` (add to `.gitignore`):

```properties
storeFile=/absolute/path/rifq-release.keystore
storePassword=********
keyAlias=rifq
keyPassword=********
```

`android/app/build.gradle`:

```gradle
def keystoreProperties = new Properties()
def keystoreFile = rootProject.file("keystore.properties")
if (keystoreFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystoreFile))
}
android {
    signingConfigs {
        release {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
    buildTypes { release { signingConfig signingConfigs.release } }
}
```

Keep the keystore and passwords in a password manager: losing them prevents
updates to the same Google Play listing.

---

## 6. Build APK and AAB

```bash
cd android
./gradlew clean

# installable APK (sideload / testing)
./gradlew assembleRelease
#  → android/app/build/outputs/apk/release/app-release.apk

# Google Play bundle
./gradlew bundleRelease
#  → android/app/build/outputs/bundle/release/app-release.aab
```

Install and smoke-test on a device or emulator:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.rifqmuslim.app/.MainActivity
```

Check on the device: app icon + label, splash screen, GPS permission prompt,
city detection, prayer countdown, Athan notification, Quran audio, Tasbih
haptics, Qibla compass, Arabic RTL, back button, Recent Apps branding.

---

## 7. iOS (future)

The same Capacitor project supports iOS: `npx cap add ios` on macOS with
Xcode, then `npx cap sync ios`. Nothing in the client is Android-specific
except the notification scheduling plugin, which has an iOS counterpart.

---

## 8. Honest status of the Android artifacts

| Artifact | Status |
| --- | --- |
| Complete source code | ✅ in this repository |
| Reproducible build instructions | ✅ this document |
| Web/PWA build + deployed backend | ✅ built and running |
| Signed APK | ❌ not produced here — the sandbox has no Android SDK, Gradle Android plugin or signing keystore |
| Signed AAB | ❌ same reason; run §6 on a machine with the SDK |

No APK or AAB is claimed unless the Gradle build above actually completes on a
machine with the Android toolchain.

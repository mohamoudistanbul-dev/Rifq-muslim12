# Building the RIFQ Muslim APK with GitHub Actions

This document is the companion to `.github/workflows/android-apk.yml`. It covers
running the workflow from an Android phone, downloading the APK, and — separately
and optionally — configuring **secure** release signing with GitHub Secrets.

The toolchain used by CI matches `docs/ANDROID_BUILD.md` exactly: **JDK 17**,
**Android SDK Platform 35**, **Build-Tools 35.0.0**, **Gradle 8.9** (the committed
wrapper), **AGP 8.7.3**, **Kotlin 2.0.21**, all built from the `android/` folder.

---

## 1. What the workflow does

| Job | Trigger | Output |
| --- | --- | --- |
| `debug-apk` | Automatic on push to `main` touching `android/**`, or manual run | `app-debug.apk` artifact, signed with the standard Android **debug** key |
| `release-apk` | Manual run, only when repository variable `ENABLE_RELEASE_SIGNING` is `true` | Signed `app-release.apk` + `app-release.aab` |

The debug APK installs on any phone for testing. It **cannot** be uploaded to
Google Play — that needs the signed release build in §4.

No paid service, no account secret and no keystore is required for the debug job.

---

## 2. Run the workflow from your Android phone

### 2.1 Start the build

1. Open **https://github.com/mohamoudistanbul-dev/Rifq-muslim12** in Chrome on the phone.
2. Tap the **☰ menu → Actions**.
3. Tap **Build RIFQ Muslim Android APK** in the left list.
4. Tap the **Run workflow** button (right side), choose branch **main**, leave
   `app_url` as it is, then tap the green **Run workflow**.
   - If you do not see "Run workflow", open the page menu and choose
     **Desktop site** — the mobile layout sometimes hides it.
5. Refresh after a few seconds; a new run appears with a yellow dot. A full
   first run takes roughly **4–8 minutes** (Gradle downloads on the first run).

> The GitHub **mobile app** cannot download Actions artifacts. Use Chrome (or any
> mobile browser) with **Desktop site** enabled for the download step.

### 2.2 Download the APK

1. Tap the run that just finished — it shows a green ✅.
2. Scroll to the bottom of the run summary page to the **Artifacts** box.
3. Tap **rifq-muslim-debug-apk** — the phone downloads a `.zip`.
4. Open the phone's **Files** app (usually *Downloads*), tap the zip and
   **Extract**. You get `app-debug.apk`.

Artifacts are kept for **30 days** and require being signed in to GitHub — they
are private to your account, not a public download link.

### 2.3 Install it on the phone

1. Tap the extracted `app-debug.apk`.
2. Android asks to allow installs from your file manager/browser:
   **Settings → Install unknown apps → allow** for that app, then go back.
3. Tap **Install**, then **Open**.
4. You should see the emerald/gold **RIFQ Muslim** splash, then the Home screen,
   with no address bar, tabs or Chrome branding. The launcher icon appears in
   your app drawer as **RIFQ Muslim**.

If Play Protect warns about an unknown developer, choose **Install anyway** —
this is expected for a debug-signed APK.

### 2.4 Useful run details

- Build logs: tap any step inside the run to expand its output.
- The **Verify APK output** step prints the file size and SHA-256 of the APK.
- To change which server the app loads, run the workflow again and set
  `app_url` (must be **HTTPS**).

---

## 3. Building locally instead (no GitHub)

```bash
cd android
./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

See `docs/ANDROID_BUILD.md` §3–§4 for the SDK/JDK prerequisites.

---

## 4. Optional: secure release signing with GitHub Secrets

Only needed for a Play Store AAB or a distributable signed APK. **Never commit a
keystore, `keystore.properties`, or any password** — the repository ignores
`*.jks`, `*.keystore` and `keystore.properties` for exactly this reason.

### 4.1 Create the keystore (once, offline)

On a trusted computer with JDK 17:

```bash
keytool -genkeypair -v -keystore rifq-release.jks -alias rifq \
  -keyalg RSA -keysize 4096 -validity 10000
```

Back the `.jks` file up somewhere safe. If you lose it you can never update the
same Play Store listing again.

### 4.2 Store it as secrets (never in the repository)

Convert the keystore to base64 text:

```bash
# macOS
base64 -i rifq-release.jks | tr -d '\n' > keystore.b64
# Linux
base64 -w0 rifq-release.jks > keystore.b64
```

In GitHub open **Settings → Secrets and variables → Actions**, tab **Secrets**,
and add four repository secrets:

| Secret name | Value |
| --- | --- |
| `KEYSTORE_BASE64` | full contents of `keystore.b64` (one long line) |
| `KEYSTORE_STORE_PASSWORD` | the keystore password |
| `KEYSTORE_KEY_ALIAS` | `rifq` (or the alias you chose) |
| `KEYSTORE_KEY_PASSWORD` | the key password |

Then open the **Variables** tab and add:

| Variable name | Value |
| --- | --- |
| `ENABLE_RELEASE_SIGNING` | `true` |

The `release-apk` job runs only when that variable is `true`. Until then it is
skipped, so the default debug build needs no secrets at all.

### 4.3 How the secrets are handled

- The workflow decodes the keystore into `android/rifq-release.jks` and writes
  `android/keystore.properties` **only on the ephemeral runner**, with `chmod 600`.
- Passwords are read from the environment and never `echo`ed; GitHub also masks
  secret values in logs.
- An `if: always()` step deletes both files at the end of the job.
- Nothing is committed back; the repository stays free of signing material.
- Build artifacts are private to your account and expire after 30 days.

### 4.4 Rotating or revoking

Delete or replace the secrets at any time in **Settings → Secrets and variables →
Actions**. To stop signed builds entirely, set `ENABLE_RELEASE_SIGNING` to `false`
or delete it.

### 4.5 Play Store upload

`app-release.aab` is the file Google Play expects. Before each upload, increase
`versionCode` in `android/app/build.gradle.kts` (`docs/ANDROID_BUILD.md` §8).

---

## 5. Honest status

- This workflow has been written and syntax-validated, but **no APK has been
  produced by GitHub Actions yet** — that requires a run on GitHub's runners,
  which cannot be triggered from here (no GitHub credentials are available in
  this environment).
- The workflow installs its own JDK 17 and Android SDK, so it does not depend on
  this sandbox's toolchain.
- First run is the slowest; later runs reuse the Gradle cache.

Check the run result before relying on the artifact: a green ✅ on the
`debug-apk` job and a downloadable `rifq-muslim-debug-apk` artifact mean the APK
really exists.

# Dependency Security Coverage — RIFQ Muslim

**Status: PARTIAL.** This document records exactly what the automated dependency
scan covers, what it cannot cover, and how to close the gap.

It is **not** a statement that the application is secure.

---

## 1. What was scanned

| Field | Value |
| --- | --- |
| Ecosystem | npm |
| Resolved dependency file | `package-lock.json` |
| Packages checked | 159 |
| Known advisories found | 0 |
| Blocking (high/critical) findings | 0 |
| Scanner | OSV-Scanner 2.7.0 |
| Policy | `workspace-dependencies-v1` |
| Scan date | 2026-11-19 |

The npm graph covers the JavaScript bundle that the web app serves and that the
Android WebView loads.

## 2. What was NOT scanned — the gap

The scan result is reported as **`incomplete`**, not `passed`, because part of the
repository has no resolvable dependency graph:

- `android/build.gradle.kts`
- `android/app/build.gradle.kts`

Neither has a Gradle lockfile, and the repository has **no**
`gradle/libs.versions.toml` version catalog. The scanner only reads *resolved*
dependency files, so the entire Android dependency graph sits outside coverage.

Evidence — a repository-wide search returns only `package-lock.json`:

```
find . -maxdepth 3 \( -name "*.lockfile" -o -name "gradle.lockfile" \
       -o -name "package-lock.json" \) -not -path "*/node_modules/*"
./package-lock.json
```

### Declared Android dependencies that are therefore unscanned

| Coordinate | Version | Kind | Declared in |
| --- | --- | --- | --- |
| `com.android.application` | 8.7.3 | Gradle plugin | `android/build.gradle.kts` |
| `org.jetbrains.kotlin.android` | 2.0.21 | Gradle plugin | `android/build.gradle.kts` |
| `androidx.core:core-ktx` | 1.13.1 | Library | `android/app/build.gradle.kts` |
| `androidx.appcompat:appcompat` | 1.7.0 | Library | `android/app/build.gradle.kts` |
| `androidx.core:core-splashscreen` | 1.0.1 | Library | `android/app/build.gradle.kts` |
| `androidx.webkit:webkit` | 1.11.0 | Library | `android/app/build.gradle.kts` |
| `com.google.android.material:material` | 1.12.0 | Library | `android/app/build.gradle.kts` |

Resolved from `google()` and `mavenCentral()` (`android/settings.gradle.kts`),
with `RepositoriesMode.FAIL_ON_PROJECT_REPOS`. SDK levels: `compileSdk = 35`,
`minSdk = 24`, `targetSdk = 35`, JVM target 17.

These are the **direct** declarations only. The transitive dependencies of these
seven coordinates are also unscanned — the real graph is substantially larger.

## 3. Why the gap exists — measured, not assumed

Producing a Gradle lockfile requires actually resolving the graph. Two
prerequisites were tested directly in this environment on 2026-11-19.

### 3.1 Network and JVM are NOT the obstacle

| Probe | Result |
| --- | --- |
| `java -version` | OpenJDK 21.0.11 present |
| Gradle wrapper | `gradle-8.9-bin.zip`, wrapper JAR present |
| `https://dl.google.com/dl/android/maven2/.../core-ktx-1.13.1.pom` | HTTP **200** |
| `https://services.gradle.org/distributions/gradle-8.9-bin.zip` | HTTP **307** (reachable) |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | both **empty** |
| SDK directories (`/opt/android*`, `/usr/lib/android-sdk`, `~/Android`) | **none** |
| `sdkmanager`, `adb`, `gradle` | **absent** |

The wrapper downloaded and ran, so the toolchain itself is usable.

### 3.2 Resolution fails on Android variant matching

A minimal audit project was created with the same five library coordinates and
`google()` + `mavenCentral()`, then resolved with the repository's wrapper:

```
./gradlew -p <audit> --write-locks --no-daemon dependencies
```

Every coordinate failed. The reported cause was not a network error:

```
androidx.core:core-ktx:1.13.1 FAILED
  Could not resolve androidx.core:core-ktx:1.13.1.
  No matching variant of androidx.core:core-ktx:1.13.1 was found.
  The consumer was configured to find a library for use during compile-time,
  compatible with Java 21, preferably in the form of class files ... but:
    - Variant 'releaseVariantReleaseApiPublication' declares a library for use
      during compile-time, and its dependencies declared externally
    - Variant 'releaseVariantReleaseRuntimePublication' ...
```

AndroidX publishes **AAR** variants (`releaseVariantRelease*Publication`). Only
the Android Gradle Plugin registers the attribute compatibility rules that let a
consumer select them; a plain `java-library` project cannot. The run emitted a
218-byte lockfile containing only `empty=annotationProcessor,testAnnotationProcessor`
— i.e. **no resolved graph** — so it was **discarded and not committed**.

### 3.3 The two real prerequisites

1. **Android SDK** platform 35 + build-tools, via `sdkmanager`.
2. **The Android Gradle Plugin**, whose variant rules are what make AAR
dependencies resolvable at all.

Neither is installable here: native Android is source-only in this environment,
and SDK installation is outside AppJet's supported capabilities. A hand-written
or externally synthesized lockfile would be invented data, not evidence, so none
was created.

## 4. How to close the gap

### (a) Continuous monitoring — already added

`.github/dependabot.yml` enables weekly update and advisory monitoring for
`npm`, `gradle` (directory `/android`) and `github-actions`. This runs on GitHub,
which is where the Android build actually happens, so it gives ongoing coverage
without needing an Android SDK locally.

### (b) One-off full graph — on a machine or CI with the Android SDK

```bash
cd android
./gradlew :app:dependencies --write-locks
```

For Gradle to emit a lockfile, dependency locking must be enabled first in
`android/app/build.gradle.kts`:

```kotlin
dependencyLocking { lockAllConfigurations() }
```

Commit the resulting `android/app/gradle.lockfile`, then rerun the repository
security scan; the scanner detects supported lockfiles and will fold the Gradle
graph into coverage.

> This snippet is deliberately **not** applied in the repository yet: it changes
> the Android build, cannot be verified here (no Android SDK), and an unverified
> change could break the APK workflow. Apply it together with a real build.

## 5. Also outside scanner scope

- **Remotely loaded assets** (fonts, recitation audio URLs): availability and
  licensing questions, not advisory coverage.
- **Source-code security** (authorization, input handling, secret exposure): a
  separate review; an advisory scan does not address it.
- **Deployed container OS patching**: the deploy builder scans the final image
  separately from this dependency scan.
- **Native Android runtime**: the npm result describes the JavaScript bundle, and
  says nothing about the native shell (AndroidX libraries, WebView, splash).

## 6. Honest summary

No known advisory is outstanding for the 159 npm packages resolved on
2026-11-19 — that is the whole extent of the positive evidence.

Seven declared Android coordinates and their transitive graph, plus everything in
§5, remain **unverified**. Treat the dependency posture as partially checked until
a Gradle lockfile is committed or Dependabot reports on the `gradle` ecosystem.

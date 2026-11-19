# Dependency Security Coverage — RIFQ Muslim

**Status: PARTIAL — substantially improved.** This document records exactly what
the automated dependency scan covers, what it cannot cover, and how to close the
rest.

It is **not** a statement that the application is secure.

---

## 1. What was scanned

### 1.1 npm — the web bundle and WebView JavaScript

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

### 1.2 Gradle — the Android libraries and build plugins

| Field | Value |
| --- | --- |
| Ecosystem | Maven |
| Resolved dependency file | `deps-audit/gradle.lockfile` |
| Components resolved | 200 |
| Direct coordinates | 7 — AGP 8.7.3, kotlin-gradle-plugin 2.0.21, and the five AndroidX/Material libraries |
| Resolution source | real resolution against `google()` + `mavenCentral()` |
| Android SDK required | **no** — see §3.3 |
| Regenerate with | `android/gradlew -p deps-audit --write-locks resolveAudit` |

This closes the gap described in earlier revisions of this document. Both the
AndroidX/Material library graph **and** the AGP/Kotlin plugin artifacts, including
their transitive closure, are now resolvable and committed as a lockfile, so they
are inside scan coverage.

## 2. What is still NOT covered

### 2.1 The scanner's per-project warnings

The scan still reports `incomplete`, with one warning per Android build file:

```
No resolved dependency file for android/app/build.gradle.kts.
No resolved dependency file for android/build.gradle.kts.
```

This is **not** the same gap as before. The *packages* declared in those files are
now resolved and scanned via `deps-audit/gradle.lockfile` (§1.2). What remains is
Gradle-native locking of those two projects themselves, which requires applying AGP
against a real Android SDK — impossible here (§3.4).

### 2.2 Not expressible as a lockfile at all

| Item | Why |
| --- | --- |
| Gradle distribution (`gradle-8.9-bin.zip`) | Referenced by `gradle-wrapper.properties`; not a Maven coordinate |
| Android SDK platform 35 / build-tools | Installed by `sdkmanager`, not resolved as a dependency |
| Plugin *execution* behavior | Lockfiles capture artifacts, not whether AGP configures a build successfully |

## 3. Why the gap existed, and how it was closed

### 3.1 Network and JVM were never the obstacle

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

### 3.2 A plain Gradle project cannot select AndroidX variants

A minimal audit project resolving the five library coordinates failed on every one:

```
androidx.core:core-ktx:1.13.1 FAILED
  No matching variant of androidx.core:core-ktx:1.13.1 was found.
  The consumer was configured to find a library for use during compile-time,
  compatible with Java 21, preferably in the form of class files ... but:
    - Variant 'releaseVariantReleaseApiPublication' declares a library for use
      during compile-time, and its dependencies declared externally
    - Variant 'releaseVariantReleaseRuntimePublication' ...
```

AndroidX publishes **AAR** variants (`releaseVariantRelease*Publication`). The
Android Gradle Plugin normally registers the attribute compatibility rules that
let a consumer select them; a stock `java-library` project does not.

### 3.3 The rule that was missing is one class

`deps-audit/` supplies exactly that rule and nothing else:

```groovy
class AarRule implements AttributeCompatibilityRule<LibraryElements> {
    void execute(CompatibilityCheckDetails<LibraryElements> details) {
        if (details.consumerValue != null && details.consumerValue.name == 'aar') {
            details.compatible()
        }
    }
}
```

registered via `dependencies { attributesSchema { attribute(LIBRARY_ELEMENTS_ATTRIBUTE) { ... } } }`,
with the audited configuration requesting `usage=java-runtime`,
`category=library`, `libraryelements=aar`.

Resolution then succeeds in two stages, both without an SDK and without AGP:

| Stage | Coordinates | Result |
| --- | --- | --- |
| Libraries | the five AndroidX/Material coordinates | `RESOLVED_COMPONENTS=64` |
| Plugins added | `com.android.tools.build:gradle:8.7.3`, `org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21` | `RESOLVED_COMPONENTS=200` |

No hand-written versions, no synthesized lockfile.

(An earlier Kotlin DSL attempt failed with `Unresolved reference:
attributesSchema`; the documented location is the dependency handler, and the
Groovy DSL exposes it directly.)

### 3.4 What genuinely still requires the SDK

The compatibility rule makes AAR *artifacts* selectable, which is all a scan needs.
It cannot make AGP **execute**, so `android/app/build.gradle.kts` cannot be locked
natively here. That needs:

1. **Android SDK** platform 35 + build-tools, via `sdkmanager`.
2. **The Android Gradle Plugin** running against that SDK.

Neither is installable here: native Android is source-only in this environment, and
SDK installation is outside AppJet's supported capabilities. A hand-written
lockfile for those two projects would be invented data, not evidence, so none was
created.

## 4. How to close the remainder

### (a) Continuous monitoring — already added

`.github/dependabot.yml` enables weekly update and advisory monitoring for
`npm`, `gradle` (directory `/android`) and `github-actions`. This runs on GitHub,
which is where the Android build actually happens, so it gives ongoing coverage
without needing an Android SDK locally.

### (b) Native lockfile — on a machine or CI with the Android SDK

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
security scan; the per-project warnings in §2.1 disappear. At that point
`deps-audit/` is redundant and can be deleted.

> The `dependencyLocking` snippet is deliberately **not** applied in the
> repository: it changes the Android build, cannot be verified here (no Android
> SDK), and an unverified change could break the APK workflow. Apply it together
> with a real build.

## 5. Also outside scanner scope

- **Remotely loaded assets** (fonts, recitation audio URLs): availability and
  licensing questions, not advisory coverage.
- **Source-code security** (authorization, input handling, secret exposure): a
  separate review; an advisory scan does not address it.
- **Deployed container OS patching**: the deploy builder scans the final image
  separately from this dependency scan.
- **Native Android runtime**: the npm result describes the JavaScript bundle, and
  the Gradle result describes artifact *versions*; neither exercises the native
  shell at runtime.

## 6. Honest summary

No known advisory is outstanding for the npm packages, and the full 200-component
Android dependency set — AGP, Kotlin plugin, AndroidX, Material and their
transitives — is now inside coverage with 0 high/critical findings.

Still unverified: Gradle-native locking of `android/build.gradle.kts` and
`android/app/build.gradle.kts` (hence the `incomplete` status), the Gradle
distribution and SDK components themselves, everything in §5, and anything the
advisory database has not yet published. Treat the dependency posture as partially
checked until a native `android/app` lockfile is committed or Dependabot reports on
the `gradle` ecosystem.

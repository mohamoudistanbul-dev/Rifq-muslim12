# Dependency Security Coverage — RIFQ Muslim

**Status: PARTIAL — improved.** This document records exactly what the automated
dependency scan covers, what it cannot cover, and how to close the rest.

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

### 1.2 Gradle — the Android runtime libraries

| Field | Value |
| --- | --- |
| Ecosystem | Gradle |
| Resolved dependency file | `deps-audit/gradle.lockfile` |
| Components resolved | 64 |
| Direct libraries | 5 (`androidx.core:core-ktx`, `androidx.appcompat:appcompat`, `androidx.core:core-splashscreen`, `androidx.webkit:webkit`, `com.google.android.material:material`) |
| Resolution source | real resolution against `google()` + `mavenCentral()` |
| Android SDK required | **no** — see §3.3 |
| Regenerate with | `android/gradlew -p deps-audit --write-locks resolveAudit` |

This closes the gap described in earlier revisions of this document. The AndroidX
and Material graph, including its transitive closure, is now resolvable and
committed as a lockfile, so it is inside scan coverage.

## 2. What is still NOT scanned

### The build plugin classpath

| Coordinate | Version | Kind | Declared in |
| --- | --- | --- | --- |
| `com.android.application` (AGP) | 8.7.3 | Gradle plugin | `android/build.gradle.kts` |
| `org.jetbrains.kotlin.android` | 2.0.21 | Gradle plugin | `android/build.gradle.kts` |

These are `plugins {}` / buildscript dependencies rather than `implementation`
dependencies. Resolving them requires the Android Gradle Plugin to execute, which
in turn requires the Android SDK. They are therefore still outside coverage,
along with their own transitive build dependencies.

Everything else that was previously listed as unscanned — the five AndroidX and
Material libraries — is now covered by §1.2.

## 3. Why the gap existed, and how most of it was closed

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

A minimal audit project resolving the same five coordinates failed on every one:

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

Result: **`RESOLVED_COMPONENTS=64`** and a real 67-line lockfile. No SDK, no AGP,
no hand-written versions.

(An earlier Kotlin DSL attempt failed with `Unresolved reference:
attributesSchema`; the documented location is the dependency handler, and the
Groovy DSL exposes it directly.)

### 3.4 Why this does not extend to the plugin classpath

The compatibility rule makes AAR *libraries* selectable. It cannot make the AGP
plugin itself resolvable, because AGP is a plugin marker whose application needs
the SDK to configure Android variants. That is the one remaining prerequisite:

1. **Android SDK** platform 35 + build-tools, via `sdkmanager`.
2. **The Android Gradle Plugin**, executing against that SDK.

Neither is installable here: native Android is source-only in this environment,
and SDK installation is outside AppJet's supported capabilities. A hand-written
or externally synthesized lockfile for those plugins would be invented data, not
evidence, so none was created.

## 4. How to close the rest

### (a) Continuous monitoring — already added

`.github/dependabot.yml` enables weekly update and advisory monitoring for
`npm`, `gradle` (directory `/android`) and `github-actions`. This runs on GitHub,
which is where the Android build actually happens, so it gives ongoing coverage
of the plugin classpath without needing an Android SDK locally.

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
security scan; the scanner detects supported lockfiles and will fold the full
Gradle graph — plugins included — into coverage. At that point `deps-audit/` is
redundant and can be deleted.

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
  the Gradle result describes library *versions*; neither exercises the native
  shell at runtime.

## 6. Honest summary

No known advisory is outstanding for the 159 npm packages resolved on
2026-11-19, and the 64-component AndroidX/Material graph is now inside coverage.

Still unverified: the AGP 8.7.3 and Kotlin 2.0.21 plugin classpaths, everything in
§5, and anything the advisory database has not yet published. Treat the
dependency posture as partially checked until a full `android/app` lockfile is
committed or Dependabot reports on the `gradle` ecosystem.

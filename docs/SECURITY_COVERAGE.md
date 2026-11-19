# Dependency Security Coverage — RIFQ Muslim

**Status: PARTIAL — coverage improved, 27 blocking findings open.** This document
records exactly what the automated dependency scan covers, what it found, what it
cannot cover, and how to close the rest.

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

### 1.3 What the expanded scan found — 27 blocking findings

The scan now covers **358 packages** (159 npm + 199 Maven) and reports **61
advisories, 27 of them high or critical**. None are hidden or suppressed; they are
listed here with scope.

| Artifact | Version | Worst severity | Fixed in | Blocking |
| --- | --- | --- | --- | --- |
| `org.bouncycastle:bcprov-jdk18on` | 1.77 | CRITICAL 9.3 | 1.80.2 / 1.85 | 4 |
| `io.netty:netty-handler` | 4.1.93.Final | CRITICAL 9.1 | 4.1.137.Final | 5 |
| `io.netty:netty-codec-http` | 4.1.93.Final | HIGH 8.7 | 4.1.136.Final | 12 |
| `io.netty:netty-codec-http2` | 4.1.93.Final | HIGH 8.7 | 4.1.136.Final | 4 |
| `io.netty:netty-codec` | 4.1.93.Final | HIGH 8.7 | 4.1.136.Final | 2 |
| `com.google.guava:guava` | 32.0.1-jre | HIGH 8.2 | 33.7.2 | 1 |
| `com.google.protobuf:protobuf-java` | 3.22.3 | HIGH 8.7 | 3.25.5 | 1 |
| `commons-io:commons-io` | 2.13.0 | HIGH 8.7 | 2.14.0 | 1 |
| `org.jdom:jdom2` | 2.0.6 | HIGH | 2.0.6.1 | 1 |
| `org.bitbucket.b_c:jose4j` | 0.9.5 | HIGH | 0.9.6 | 1 |
| `org.bouncycastle:bcpkix-jdk18on` | 1.77 | MODERATE | 1.84 | 0 |
| `org.apache.commons:commons-compress` | 1.21 | MODERATE | 1.26.0 | 0 |

#### Scope — these are build-toolchain artifacts, not APK contents

Every affected coordinate is a transitive dependency of **AGP 8.7.3** or the
**Kotlin Gradle plugin**, pulled onto the *build machine's* classpath. The APK
ships AndroidX, Material and kotlin-stdlib; it does not bundle Netty, BouncyCastle,
Guava, protobuf or commons-io, and a user's phone never executes them.

That lowers the end-user impact but does not make them unreal: they are supply-chain
risk for the machine or CI runner that produces the release, and a compromised build
is a compromised release. They are reported, not dismissed.

#### Why they are not patched in this repository

The versions are chosen by AGP 8.7.3 itself. Forcing newer Netty/BouncyCastle in
`deps-audit/` would make the lockfile describe a graph the Android build does not
use — fabricated evidence, not a fix. The only genuine remedy is a newer AGP.

That was tested against both upgrade paths. Resolving the same audit project with
**AGP 8.13.2** (latest 8.x, the *compatible* path) and with **AGP 9.5.1** (latest
overall, the *major* path) gave:

| Artifact | AGP 8.7.3 (current) | AGP 8.13.2 | AGP 9.5.1 | Fixed in |
| --- | --- | --- | --- | --- |
| `io.netty:*` (all modules) | 4.1.93.Final | 4.1.110.Final | *absent* | 4.1.136 / 4.1.137 |
| `protobuf-java` | 3.22.3 | 3.25.5 — **cleared** | 3.25.5 — **cleared** | 3.25.5 |
| `commons-io` | 2.13.0 | 2.16.1 — **cleared** | 2.16.1 — **cleared** | 2.14.0 |
| `guava` | 32.0.1-jre | 33.3.1-jre | 33.4.0-jre | 33.7.2 |
| `bcprov-jdk18on` | 1.77 | 1.79 | 1.80.2 | 1.85 |
| `jdom2` | 2.0.6 | 2.0.6 | 2.0.6 | 2.0.6.1 |
| `jose4j` | 0.9.5 | 0.9.5 | 0.9.5 | 0.9.6 |
| Components resolved | 200 | 200 | 166 | |

**No AGP release available today clears all 27 findings.** The compatible path
(8.13.2) fixes only protobuf and commons-io and still needs a Gradle wrapper bump to
8.13. The major path (9.5.1) also drops Netty, but Guava, BouncyCastle, jdom2 and
jose4j remain affected because AGP 9.x itself still pins them below their fix
versions. The residue is therefore an upstream packaging problem, not something this
repository can resolve by choosing a different version.

Neither upgrade was applied. Both are unverifiable here — this environment has no
Android SDK to compile against — and both change the Android build that produces the
user's only APK. Applying an unverified major migration to silence a scanner would
trade a build-time supply-chain risk for a real chance of breaking the release
pipeline. They are documented instead, to be done in CI where the result can be
compiled and tested.

## 2. What is still NOT covered

### 2.1 The scanner's per-project warnings

The scan reports `incomplete` (and now also `failed`, because of the blocking
findings in §1.3), with one warning per Android build file:

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

Coverage is now 358 packages across npm and Maven, including the full Android
dependency set (AGP, Kotlin plugin, AndroidX, Material and their transitives).

**The result is not clean.** 27 high/critical advisories are open. All of them sit
in the build toolchain's transitive closure (Netty, BouncyCastle, Guava, protobuf,
commons-io, jdom2, jose4j), none in the libraries the APK ships, and none are
patched here because the fix is an AGP major upgrade that cannot be verified in
this environment (§1.3).

Still unverified: Gradle-native locking of `android/build.gradle.kts` and
`android/app/build.gradle.kts` (hence the `incomplete` status), the Gradle
distribution and SDK components themselves, everything in §5, and anything the
advisory database has not yet published.

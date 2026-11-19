# Android dependency audit project

This directory exists **only** so the Android dependencies used by `android/` can be
resolved into a real lockfile for vulnerability scanning. It is not part of the
Android application build and the APK is unaffected by it.

## Why it is needed

`android/build.gradle.kts` and `android/app/build.gradle.kts` declare Gradle plugins
and AndroidX libraries, but AndroidX publishes its artifacts as **AAR** with
AGP-specific Gradle variants (`releaseVariantReleaseApiPublication` /
`...RuntimePublication`). A plain `java-library` project therefore fails with:

```
No matching variant of androidx.core:core-ktx:1.13.1 was found
```

and no lockfile can be produced. This environment has no Android SDK
(`ANDROID_HOME` unset, no `sdkmanager`), so the real Android project cannot be
resolved here either.

The fix is a one-line Gradle **attribute compatibility rule** that tells Gradle an
AAR consumer may accept the published variants. With that rule the graph resolves
without AGP and without the SDK.

## What it covers

Everything declared in the two Android build files, plus full transitive closure —
**200 components**:

| Coordinate | Version | Declared in |
| --- | --- | --- |
| `com.android.tools.build:gradle` (AGP) | 8.7.3 | `android/build.gradle.kts` |
| `org.jetbrains.kotlin:kotlin-gradle-plugin` | 2.0.21 | `android/build.gradle.kts` |
| `androidx.core:core-ktx` | 1.13.1 | `android/app/build.gradle.kts` |
| `androidx.appcompat:appcompat` | 1.7.0 | `android/app/build.gradle.kts` |
| `androidx.core:core-splashscreen` | 1.0.1 | `android/app/build.gradle.kts` |
| `androidx.webkit:webkit` | 1.11.0 | `android/app/build.gradle.kts` |
| `com.google.android.material:material` | 1.12.0 | `android/app/build.gradle.kts` |

Versions come from real resolution against `google()` and `mavenCentral()` —
nothing is hand-written or guessed.

## What it does NOT cover

* **Plugin execution.** The AGP and Kotlin plugin *artifacts* are resolved and
  locked, but this project never applies them. Whether AGP can configure a real
  Android build against SDK 35 is still only proven by the GitHub Actions APK
  workflow.
* **The Gradle distribution itself** (`gradle-8.9-bin.zip`, referenced by
  `android/gradle/wrapper/gradle-wrapper.properties`). The wrapper distribution is
  not a Maven coordinate, so no lockfile can express it.
* **Android SDK components** (platform 35, build-tools) — these come from
  `sdkmanager`, not from a dependency graph.
* Resources, manifest merging and anything else only the Android build performs.

So a clean scan of this lockfile means *the Android dependency artifacts are
advisory-free*, not that the whole Android toolchain is verified.

## Regenerating

From the repository root, using the Android project's wrapper:

```bash
android/gradlew -p deps-audit --write-locks resolveAudit
```

Expect `RESOLVED_COMPONENTS=200`. To audit a different dependency set, edit the
`audit` configuration in `build.gradle` and re-run.

If you later have the Android SDK available, prefer generating the lockfile from
the real build (`android/app/build.gradle.kts` with `dependencyLocking` enabled)
and delete this directory.

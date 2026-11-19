# Android dependency audit project

This directory exists **only** so the Android libraries used by `android/app` can be
resolved into a real lockfile for vulnerability scanning. It is not part of the
Android application build and the APK is unaffected by it.

## Why it is needed

`android/app/build.gradle.kts` declares AndroidX and Material dependencies, but
AndroidX publishes its artifacts as **AAR** with AGP-specific Gradle variants
(`releaseVariantReleaseApiPublication` / `...RuntimePublication`). A plain
`java-library` project therefore fails with:

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

The five libraries declared in `android/app/build.gradle.kts`, plus their full
transitive closure — **64 components**:

| Coordinate | Version |
| --- | --- |
| `androidx.core:core-ktx` | 1.13.1 |
| `androidx.appcompat:appcompat` | 1.7.0 |
| `androidx.core:core-splashscreen` | 1.0.1 |
| `androidx.webkit:webkit` | 1.11.0 |
| `com.google.android.material:material` | 1.12.0 |

Versions come from real resolution against `google()` and `mavenCentral()` —
nothing is hand-written or guessed.

## What it does NOT cover

* The **build plugin classpath**: AGP 8.7.3, Kotlin 2.0.21 and their transitive
  build dependencies. These are `buildscript`/`plugins` dependencies, not
  `implementation` dependencies, and resolving them requires the Android SDK.
* Resources, manifest merging and anything else that only the Android build does.

So a clean scan of this lockfile means *the runtime libraries are advisory-free*,
not that the whole Android toolchain is.

## Regenerating

From the repository root, using the Android project's wrapper:

```bash
android/gradlew -p deps-audit --write-locks resolveAudit
```

Expect `RESOLVED_COMPONENTS=64`. To audit a different dependency set, edit the
`audit` configuration in `build.gradle` and re-run.

If you later have the Android SDK available, prefer generating the lockfile from
the real build (`android/app/build.gradle.kts` with `dependencyLocking` enabled)
and delete this directory.

# Dependency Security Coverage — RIFQ Muslim

**Status: INCOMPLETE, but zero known findings in the packages that are covered.**

This document records exactly what the automated dependency scan covers, what it
reports, what it **cannot** cover in this environment, and how to close the rest.
It is **not** a statement that the application is secure.

Last updated: 2026-11-20 — scan re-run on the current application revision
(AGP 8.13.2 / Gradle 8.14.4 / Kotlin 2.4.21).

---

## 1. Latest scan result

| Field | Value |
| --- | --- |
| Scanner | OSV-Scanner 2.7.0 |
| Policy | `workspace-dependencies-v1` |
| Packages checked | **444** |
| Known advisories | **0** |
| Blocking (high/critical) | **0** |
| Reported status | `incomplete` |

`incomplete` is **not** a findings result — it is the scanner saying it could not
attribute a resolved dependency file to one Android build script. See §3.

Re-run evidence for this revision: the committed lockfiles still carry every
advisory-named fixed version, so the zero-findings result describes the packages that
are actually built and shipped —
`android/buildscript-gradle.lockfile`: netty 4.1.137.Final, bcprov-jdk18on 1.85,
guava 33.7.2-jre, jose4j 0.9.6, jdom2 2.0.6.1, commons-compress 1.26.0,
commons-lang3 3.18.0;
`android/app/gradle.lockfile`: netty 4.1.137.Final, guava 33.7.2-jre,
protobuf-java 3.25.5;
`deps-audit/gradle.lockfile`: the same pins plus protobuf-java 3.25.5.

## 2. What is covered, and by which file

| Ecosystem | Resolved dependency file | What it locks |
| --- | --- | --- |
| npm | `package-lock.json` | the web/WebView bundle (React, Vite, Express, SQLite driver, etc.) |
| Maven / Gradle | `android/app/gradle.lockfile` | the APK's library graph: AndroidX, Material, kotlin-stdlib and their transitives |
| Maven / Gradle | `android/buildscript-gradle.lockfile` | the **plugin classpath**: AGP, Kotlin Gradle plugin and everything they pull onto the build machine |
| Maven / Gradle | `deps-audit/gradle.lockfile` | audit-only project used to resolve AAR variants without the Android SDK (§4) |

All four are committed and reproducible; none were hand-written.

### 2.2 Manifest inventory — nothing else is silently uncovered

Enumerating every dependency manifest in the repository (excluding `node_modules/`,
`dist/` and `.git/`) returns exactly these files and no others:

```
package.json / package-lock.json                       npm (web + server bundle)
android/app/build.gradle.kts / gradle.lockfile          :app library graph
android/build.gradle.kts / buildscript-gradle.lockfile  plugin classpath
deps-audit/build.gradle / gradle.lockfile               audit-only AAR resolution
```

There is no `requirements.txt`, `pyproject.toml`, `pom.xml`, `go.mod`, `Cargo.toml`,
`Gemfile` or `composer.json` anywhere in the repository, so no other ecosystem sits
outside the scan. Every manifest that declares dependencies has a committed resolved
lockfile beside it; the single exception is `android/build.gradle.kts`, which declares
none of its own (§3).

Reconciliation against the report itself (`packages_checked: 444`,
`ecosystems: ["Maven", "npm"]`, `unmatched_packages: 0`):

| Source | Resolved entries |
| --- | --- |
| `package-lock.json` | 160 |
| `android/app/gradle.lockfile` | 196 |
| `android/buildscript-gradle.lockfile` | 149 |
| `deps-audit/gradle.lockfile` | 200 (mirrors the `:app` AAR graph) |

`unmatched_packages: 0` means every resolved package in those files was matched against
the advisory database — none were dropped as unparseable. The report carries exactly one
warning, the expected one:

> No resolved dependency file for android/build.gradle.kts. Generate the normal project
> lockfile when appropriate; do not invent versions or install a test framework.

### 2.1 Upgrades that produced this result

The earlier scan reported 27 high/critical advisories, all in AGP 8.7.3's transitive
toolchain. They were cleared by upgrading and pinning, not by suppressing:

| Artifact | Before | Now |
| --- | --- | --- |
| AGP / Gradle / Kotlin | 8.7.3 / 8.9 / 2.0.21 | **8.13.2 / 8.14.4 / 2.4.21** |
| `io.netty:*` | 4.1.93.Final | **4.1.137.Final** |
| `org.bouncycastle:*` | 1.77 | **1.85** |
| `com.google.guava:guava` | 32.0.1-jre | **33.7.2-jre** |
| `com.google.protobuf:protobuf-java` | 3.22.3 | **3.25.5** |
| `org.bitbucket.b_c:jose4j` | 0.9.5 | **0.9.6** |
| `org.jdom:jdom2` | 2.0.6 | **2.0.6.1** |
| `org.apache.commons:commons-compress` | 1.21 | **1.26.0** |
| `org.apache.commons:commons-lang3` | — | **3.18.0** |

Verification after the upgrade: `./android/gradlew -p android buildEnvironment` and
`./android/gradlew -p android :app:dependencies` both exit 0 against the committed
lock state, so the pins resolve rather than break the graph.

## 3. The one gap that remains — and why it cannot be closed here

The scan emits:

```
No resolved dependency file for android/build.gradle.kts.
```

The scanner only credits a **project-level** `gradle.lockfile` to that build file.
Gradle writes that file only for configurations resolved *in that project*, and
`android/build.gradle.kts` applies no plugins to itself — it only configures
subprojects. Running the documented command there reports:

```
Root project 'RifqMuslim' — No configurations
```

so no `android/gradle.lockfile` can be produced, even with
`dependencyLocking { lockAllConfigurations() }`. The **packages** that file would
describe are not missing from the scan: they are the plugin classpath, and
`android/buildscript-gradle.lockfile` locks them (the scanner reads all 444 packages
from it). What is missing is the scanner's bookkeeping association, not evidence.

A hand-written `android/gradle.lockfile` would silence the warning with invented
data, so none was created.

**Missing capability, stated plainly:** OSV-Scanner 2.7.0 cannot associate a
buildscript-only lockfile with the build script that produces it, and Gradle cannot
emit a project-level lockfile for a root project that applies no plugins. No
repository change closes this, and adding an artificial configuration just to produce
that file would be fabricating build structure. It is a scanner bookkeeping
limitation, not a set of unexamined dependencies.

### 3.1 Not expressible as a dependency file at all

| Item | Why |
| --- | --- |
| Gradle distribution (`gradle-8.14.4-bin.zip`) | referenced by `gradle-wrapper.properties`, not a Maven coordinate |
| Android SDK platform / build-tools | installed by `sdkmanager`, not resolved as a dependency |
| Plugin *execution* behaviour | lockfiles capture artifacts, not whether AGP configures a build successfully |

### 3.2 Android compile is still unverified here

This environment has no Android SDK (`ANDROID_HOME`, `sdkmanager`, `adb` all absent),
and native Android is source-only in AppJet. Kotlin/Java compilation, APK/AAB output
and device behaviour are therefore **not** verified locally; your GitHub Actions
workflow (`.github/workflows/android-apk.yml`) is the first real compile. See
`docs/ANDROID_BUILD.md`.

## 4. How the AAR graph is resolved without the SDK

AndroidX publishes AAR variants, which a stock `java-library` consumer cannot select;
AGP normally registers the compatibility rules. `deps-audit/` supplies exactly that
rule (an `AttributeCompatibilityRule` marking `libraryelements=aar` compatible) so the
real coordinates resolve and can be locked, with no SDK and no AGP.

## 5. Outside scanner scope

- **Source-level security** — authorization, input handling, secret exposure. The
  application enforces this in code (server-side `requireAuth`/`requireAdmin`/
  `requireSuperAdmin`, hashed passwords, session cookies, no secrets in the bundle)
  and in `scripts/verify-audio-badge.mjs`, which asserts the permission matrix.
- **Deployed container OS patching** — the deploy builder scans the final image
  separately from this dependency scan.
- **Remote assets** (recitation audio URLs, fonts) — availability and licensing, not
  advisories.
- **Runtime behaviour** — neither npm nor Gradle results exercise the native shell.

## 6. Honest summary

444 packages were checked and **0 advisories** were reported, which is a real
improvement over the 27 blocking findings of the previous revision — achieved by
upgrading AGP/Gradle/Kotlin and pinning patched versions, then re-verifying that the
graph still resolves.

The scan is still reported as `incomplete`, for one reason only: OSV wants a
project-level `android/gradle.lockfile` that Gradle cannot produce for a
plugin-free root project. No lockfile was fabricated and no finding was suppressed.
Unknown: anything the advisory database has not yet published, the Gradle
distribution and SDK components themselves, and everything in §5.

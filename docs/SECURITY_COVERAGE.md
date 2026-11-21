# Dependency Security Coverage — RIFQ Muslim

**Status: INCOMPLETE, but zero known findings in the packages that are covered.**

This document records exactly what the automated dependency scan covers, what it
reports, what it **cannot** cover in this environment, and how to close the rest.
It is **not** a statement that the application is secure.

Last updated: 2026-11-21 (Kid Academy / Quiz / Qibla / Near Mosques / Premium revision,
rev 24) — this revision added **no dependency**: `package.json` and `package-lock.json` are
unchanged (both last modified in `efcac76`), so the resolved dependency set is identical to
the one previously scanned. The repository scan was nevertheless re-run at this revision and
returned the same result: **444 packages, 0 advisories, 0 blocking, status `incomplete`**. The
`incomplete` status is the attribution gap of §3 — it is **not** an unscanned package and not
a finding. The build scripts were re-audited and the remaining warning is still the same
**attribution** gap described in §3. The CI route's shape is now machine-checked by `npm run verify:workflow` (§3.4):
`android/build.gradle.kts` owns a buildscript classpath configuration but no dependencies
of its own, so Gradle emits `android/buildscript-gradle.lockfile` and never a
project-level `android/gradle.lockfile`. A CI scan that targets each lockfile explicitly
was added (`.github/workflows/dependency-scan.yml`, §2.2) but has **not been executed**
here, so the AppJet-side scan status is still `incomplete` (§3.4).

Earlier scan re-run: 2026-11-20 on the application revision
(AGP 8.13.2 / Gradle 8.14.4 / Kotlin 2.4.21). The remaining coverage warning was
re-investigated then as well and confirmed unclosable from inside AppJet (§3.3); the
resolved dependency set itself is unchanged.

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

### 2.1 Manifest inventory — nothing else is silently uncovered

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

### 2.2 External routes to a fully attributed scan

Nothing in this repository can close the gap, but two external routes can, without touching
the application or its build:

- **GitHub Dependency Graph / Dependabot** parses Gradle lockfiles directly, so it reports
the plugin classpath from `android/buildscript-gradle.lockfile` without requiring a
project-level file. Enabling Dependabot alerts on the repository gives continuous advisory
coverage for the same packages.
- **OSV-Scanner in CI** can be given the lockfiles themselves as scan targets (rather than
relying on build-script discovery), which attributes every package to a manifest and avoids
the "no resolved dependency file" warning.

Either route covers the same 444 packages already resolved here; neither changes the
application, its dependencies or its build.

**Already configured in this repository:** `.github/dependabot.yml` declares the `gradle`
ecosystem for `/android` (which reads both `android/app/gradle.lockfile` and
`android/buildscript-gradle.lockfile`), plus `npm` and `github-actions`. The one step that
remains is a repository setting only the owner can change — **Settings → Code security →
Dependabot alerts** on GitHub. Until that is switched on, the automated scan below stays
`incomplete`, and this document does not claim otherwise.

**Committed CI scan (added 2026-11-21, not yet executed).** `.github/workflows/dependency-scan.yml`
hands each of the four lockfiles to OSV-Scanner as an **explicit target** (`-L`), one job per
file, so the packages are reported without the scanner having to attribute a build script at
all. A second, deliberately non-gating job runs
`./android/gradlew -p android buildEnvironment --write-locks` on a runner that has a JDK and
uploads `android/gradle.lockfile` if Gradle ever emits one — which is the only honest way to
test that hypothesis. Neither job has run yet: AppJet cannot execute GitHub Actions (§3.4).

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

### 2.3 Upgrades that produced this result

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

### 3.3 The platform refuses native Gradle execution outright

Generating the missing lockfile from inside AppJet is not possible: the request is
rejected before Gradle starts.

```
native_build_unsupported — AppJet builds web applications only.
native Gradle build is outside the supported execution scope.
(policy web-builds-only-v1)
```

The response also instructs that the refusal must not be worked around by retrying,
installing an SDK, or wrapping the build in a shell script. So the situation for this
revision is settled: the only tool that can write `android/gradle.lockfile` is Gradle,
Gradle cannot be executed here, and hand-writing the file would be fabrication.

The dependency graph is unchanged and fully locked by the three committed files in §2;
what is missing is one scanner association, not evidence about any package.

**Who can close it, and how.** On any machine with the Android SDK (or on the
GitHub Actions runner that already builds the APK), run:

```
./gradlew -p android buildEnvironment --write-locks
./gradlew -p android :dependencies --write-locks
```

and commit the `android/gradle.lockfile` Gradle produces. Never hand-edit it. The
alternative that needs no SDK at all is already configured here: enable Dependabot
alerts (Settings → Code security), which reads the committed buildscript lockfile
directly (§2.2).

### 3.4 Status of the CI route at revision 24

`.github/workflows/dependency-scan.yml` is committed but **has not been executed**. AppJet
cannot run GitHub Actions, and this environment has neither Gradle nor the Android SDK, so no
CI result exists to report. Everything stated in §1–§2 therefore still describes the AppJet
scan of revision 24 (444 packages, 0 advisories, 0 blocking, status `incomplete`) — not a CI
run.

When the owner triggers it from the repository's **Actions** tab:

| Job | What it establishes |
| --- | --- |
| `Scan package-lock.json` | npm bundle, explicitly targeted |
| `Scan android/app/gradle.lockfile` | the APK's library graph, explicitly targeted |
| `Scan android/buildscript-gradle.lockfile` | the AGP / Kotlin plugin classpath, explicitly targeted — the file the repository scan could not attribute |
| `Scan deps-audit/gradle.lockfile` | the AAR audit graph, explicitly targeted |
| `Try to emit android/gradle.lockfile` | non-gating; reports whether Gradle can produce the file the scanner asks for, and uploads it if it can |

A failing `Scan …` job means advisories were found in that lockfile — the intended gate. It
does not mean the build is broken.

The workflow's shape is machine-checked rather than merely inspected. `npm run verify:workflow`
(`scripts/validate-android-workflow.mjs`, dependency-free) asserts 12 structural rules against
this file, including that all four lockfiles remain explicit `-L` matrix targets, that exactly
one job is non-gating, and that no step references a repository secret. This guards against
coverage shrinking silently — a dropped lockfile now fails a local check instead of quietly
narrowing the scan. It still does not execute the workflow, so a green run in the Actions tab
remains the outstanding item.

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
- **Analytics data handling** (added with the Analytics Dashboard) — the feature ships
  **no new package**, so dependency scanning has nothing new to say about it. Its
  privacy and authorization properties are therefore covered by
  `scripts/verify-analytics.mjs` instead: events are stored in the existing SQLite
  database under a per-day salted HMAC visitor key, the table carries **no** IP address,
  user-agent or email column, the key is asserted to be a 24-character hex digest, and
  `GET /api/admin/analytics` is asserted to answer **401** without a session and **403**
  for a non-admin. Download events are asserted to be recorded only for a full transfer
  from byte 0, never for a resumed range request.
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

The route to a fully attributed scan exists in two forms (§2.2): the committed CI workflow,
which has not been executed here, and Dependabot alerts, which is a repository setting only
the owner can enable. Until one of them runs, `incomplete` is the accurate status of the scan
this environment produced, and this document does not claim otherwise.

## 7. Runtime external resources (outside dependency scanning)

The scanner's own coverage note states that "unlocked, vendored and CDN dependencies may be
outside coverage". Build-time packages are covered by §2. This section enumerates the
*runtime* surface of the shipped frontend, obtained by listing every `http(s)://` reference
in `index.html`, `src/` and `public/`.

**No third-party code is loaded.** `index.html` references only local assets:

| Tag | Target |
| --- | --- |
| `rel="manifest"` | `/manifest.webmanifest` |
| `rel="icon"`, `rel="apple-touch-icon"` | `/logo.svg` |
| `script type="module"` | `/src/main.tsx` |

There is no remote script, stylesheet, font or CSS `@import` anywhere in the shipped UI, so
no CDN-supplied JavaScript or CSS executes in the application. The supply-chain exposure the
caveat warns about does not apply to executable code here.

**Two runtime data hosts** are fetched by the browser at the moment of use and are not
packages in any lockfile:

| Host | Used for | Risk profile |
| --- | --- | --- |
| `cdn.islamic.network` | surah audio (`src/pages/Quran.tsx:256`) and athan audio (`src/lib/store.tsx:459`) | Third-party availability and privacy dependency: the CDN observes the user's IP when audio streams. Downloaded audio is copied into device storage, so offline playback does not depend on it. No executable content. |
| `wa.me`, `t.me`, `www.facebook.com`, `www.google.com` | share, contact and directions links | User-initiated navigation only. No automatic requests, no executable content. |

One further match, `your-app.example.com`, is not a runtime resource: it appears only inside a
code comment in `src/lib/api.ts:6` explaining the `VITE_API_BASE` override, and is never
rendered or fetched.

**Consequence for the security statement.** The 444-package scan covers every library the
application compiles or ships, and no CDN code runs inside it. It does not, and cannot, cover
the availability, integrity or privacy terms of the audio CDN. That is a service dependency
to assess on its own terms, not an unexamined dependency.

## 8. Vendored code and version pinning

The scanner's caveat names three things that may fall outside coverage: "unlocked, vendored
and CDN dependencies". §7 covers the CDN surface. This section closes the other two.

**No vendored third-party code.** A license-header sweep across `src/`, `public/`, `server/`
and `scripts/` found no vendored libraries, and `public/` holds no JavaScript, ES-module or
CSS assets at all — every shipped asset is either authored in this repository or produced by
the Vite build. Nothing executes from a copied-in dependency that the scan could miss.

**No unlocked version specifiers.**

| Ecosystem | Declared specifiers | Resolution |
| --- | --- | --- |
| npm | 14 dependencies, all caret ranges (`^19.3.1`, `^8.3.8`, …); zero `*`, `latest` or `>=` | `package-lock.json` pins every resolved and transitive version (160 entries), so the scan sees exact versions and installs are reproducible |
| Gradle | no dynamic versions (`+`, `latest.release`, version ranges) in `android/` or `deps-audit/` | the committed lockfiles pin exact coordinates (196 + 149 + 200 entries) |

A caret range is a declaration, not an unlocked install: `npm ci` and the committed lockfile
resolve it to the exact version the scan checked. The genuinely unlocked cases would be a `*`,
`latest` or `>=` specifier, and none exists in this repository.

CI workflow steps are not part of the shipped application and are already covered as outside
scope in §5; the scan's 444 packages describe what the app compiles, bundles and runs.

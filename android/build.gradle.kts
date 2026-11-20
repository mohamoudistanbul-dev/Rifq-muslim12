// Top-level build file. Plugin versions are declared once and applied in :app.
//
// Security pins: the Android Gradle Plugin pulls older transitive libraries that carry
// published advisories. These are build-time tooling artifacts (never bundled into the
// APK), and the versions below are the fixed releases named by the advisories. The same
// pins are mirrored in deps-audit/build.gradle so its lockfile keeps describing exactly
// what this build resolves.
//   io.netty        -> 4.1.137.Final (GHSA-c4c3-7fpv-j4q5 and the 4.1.13x fixes)
//   org.bouncycastle -> 1.85          (GHSA-574f-3g2m-x479, GHSA-9pwp-9qqc-pr26)
//   com.google.guava:guava -> 33.7.2-jre (GHSA-xxph-c9ww-hj94)
//   org.bitbucket.b_c:jose4j -> 0.9.6     (JWT/JOSE parsing fixes)
//   org.jdom:jdom2     -> 2.0.6.1         (XXE fix)
//   commons-compress   -> 1.26.0          (GHSA-4265-ccf5-phj5, GHSA-4g9r-vxhx-9pgx)
//   commons-lang3      -> 3.18.0          (GHSA-j288-q9x7-2f5v)
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    configurations.classpath {
        resolutionStrategy {
            eachDependency {
                when {
                    requested.group == "io.netty" -> useVersion("4.1.137.Final")
                    requested.group == "org.bouncycastle" -> useVersion("1.85")
                    requested.group == "com.google.guava" && requested.name == "guava" ->
                        useVersion("33.7.2-jre")
                    requested.group == "org.bitbucket.b_c" -> useVersion("0.9.6")
                    requested.group == "org.jdom" && requested.name == "jdom2" ->
                        useVersion("2.0.6.1")
                    requested.group == "org.apache.commons" && requested.name == "commons-compress" ->
                        useVersion("1.26.0")
                    requested.group == "org.apache.commons" && requested.name == "commons-lang3" ->
                        useVersion("3.18.0")
                }
            }
        }
    }
}

plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.4.21" apply false
}

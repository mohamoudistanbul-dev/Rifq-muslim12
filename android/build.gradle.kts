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
                }
            }
        }
    }
}

plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}

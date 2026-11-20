import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing is read from android/keystore.properties, which is never committed.
// See docs/ANDROID_BUILD.md §5 for generating the keystore with keytool.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}
val hasReleaseKeystore = keystorePropertiesFile.exists()

// HTTPS origin of the RIFQ Muslim backend. Override with -Prifq.appUrl=...
val appUrl = (project.findProperty("rifq.appUrl") as String?)
    ?: "https://rifqmuslim.dev.ap-jt.com"

android {
    namespace = "com.rifqmuslim.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rifqmuslim.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "RIFQ_APP_URL", "\"$appUrl\"")
        vectorDrawables.useSupportLibrary = true
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Kept off deliberately: R8 shrinking is not exercised by any automated
            // test in this repository, and an unverified shrinker pass can break the
            // WebView JavaScript bridge at runtime. Enable after testing on a device.
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (hasReleaseKeystore) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/AL2.0",
            "META-INF/LGPL2.1",
            "META-INF/*.kotlin_module"
        )
    }
}

// Kotlin 2.x requires the compilerOptions DSL; the old kotlinOptions.jvmTarget
// string form is an error since Kotlin 2.2+.
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// Build-tooling security pins, mirrored from android/build.gradle.kts. These libraries reach
// this module through AGP's lint and test-platform classpaths, never through the APK runtime,
// and the versions below are the fixed releases named by the advisories. They are applied
// before locking so app/gradle.lockfile describes the patched graph the scanner reads.
configurations.configureEach {
    resolutionStrategy.eachDependency {
        when {
            requested.group == "io.netty" -> useVersion("4.1.137.Final")
            requested.group == "org.bouncycastle" -> useVersion("1.85")
            requested.group == "com.google.guava" && requested.name == "guava" ->
                useVersion("33.7.2-jre")
            requested.group == "com.google.protobuf" -> useVersion("3.25.5")
            requested.group == "org.bitbucket.b_c" -> useVersion("0.9.6")
            requested.group == "org.jdom" && requested.name == "jdom2" -> useVersion("2.0.6.1")
            requested.group == "org.apache.commons" && requested.name == "commons-compress" ->
                useVersion("1.26.0")
            requested.group == "org.apache.commons" && requested.name == "commons-lang3" ->
                useVersion("3.18.0")
        }
    }
}

// Dependency locking: app/gradle.lockfile is the resolved dependency list for this module.
// It is what the repository security scan reads for AndroidX + Material, and it pins what
// CI resolves. Regenerate after changing dependencies below:
//   ./gradlew -p android :app:dependencies --write-locks
configurations.configureEach {
    resolutionStrategy.activateDependencyLocking()
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.google.android.material:material:1.12.0")
}

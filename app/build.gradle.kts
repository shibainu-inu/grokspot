plugins {
    id("com.android.application")
}

android {
    namespace = "com.grokbot.grokspot"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.grokbot.grokspot"
        minSdk = 30
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }
}

dependencies {
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}

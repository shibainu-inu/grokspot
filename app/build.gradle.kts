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
        versionCode = 2
        versionName = "0.2.0"
    }

    // Compressed in the APK and unpacked on install: the APK stays ~2.5 MB smaller.
    packaging.jniLibs.useLegacyPackaging = true
}

// ngrok-java ships its native library at the root of the jar, which Android drops.
// Put it where Android looks for native code; NgrokTunnel loads it before ngrok does.
// Its JNI_OnLoad also returns JNI_VERSION_1_8, which Android refuses ("Bad JNI version");
// the copy is patched to return JNI_VERSION_1_6, the highest Android accepts. Nothing
// in 1.8 is used: it only adds functions for Java modules.
val ngrokNative by configurations.creating

abstract class ExtractNgrokJni : DefaultTask() {
    @get:InputFiles abstract val jars: ConfigurableFileCollection
    @get:OutputDirectory abstract val outputDir: DirectoryProperty
    @get:Inject abstract val files: FileSystemOperations
    @get:Inject abstract val archives: ArchiveOperations

    @TaskAction
    fun extract() {
        files.sync {
            jars.forEach { from(archives.zipTree(it)) { include("libngrok_java.so") } }
            into(outputDir.dir("armeabi-v7a"))
        }
        val lib = outputDir.file("armeabi-v7a/libngrok_java.so").get().asFile
        val bytes = lib.readBytes()
        // ngrok-java-native 1.1.1, linux-android-armv7: "movs r0, #8; movt r0, #1" in JNI_OnLoad.
        val at = 0x14b5da
        val expected = byteArrayOf(0x08, 0x20, 0xc0.toByte(), 0xf2.toByte(), 0x01, 0x00)
        check(bytes.copyOfRange(at, at + expected.size).contentEquals(expected)) {
            "libngrok_java.so is not the build this patch is for: check JNI_OnLoad before updating ngrok-java"
        }
        bytes[at] = 0x06
        lib.writeBytes(bytes)
    }
}

val extractNgrokJni by tasks.registering(ExtractNgrokJni::class) { jars.from(ngrokNative) }
androidComponents.onVariants { variant ->
    variant.sources.jniLibs?.addGeneratedSourceDirectory(extractNgrokJni, ExtractNgrokJni::outputDir)
}

dependencies {
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // ngrok tunnel to the MCP server (NgrokTunnel). Only the 32-bit ARM build: the Echo Spot's ABI.
    implementation("com.ngrok:ngrok-java-native:1.1.1:linux-android-armv7")
    ngrokNative("com.ngrok:ngrok-java-native:1.1.1:linux-android-armv7") { isTransitive = false }
}

package com.ngrok

/**
 * Starts ngrok-java's native runtime on Android (NgrokTunnel).
 *
 * ngrok's own loader copies the library out of its jar, which Android leaves out,
 * and when that fails it also skips Runtime.init. This lives in com.ngrok to reach
 * that package-private call after the library has been loaded from lib/.
 */
internal object AndroidRuntime {
    private var started = false

    @Synchronized
    fun start() {
        if (started) return
        System.loadLibrary("ngrok_java")
        Runtime.init(Runtime.getLogger())
        started = true
    }
}

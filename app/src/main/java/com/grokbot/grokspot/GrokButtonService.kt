package com.grokbot.grokspot

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Accessibility service that owns the Grok button and the screen.
 *
 * The Echo Spot's only power key is remapped to the Grok button (BUTTON_1, see
 * device/Vendor_2454_Product_6500.kl), so this service takes over what the
 * power key did, from whatever is on screen:
 * - press: handed to the GrokSpot page; while the power menu is open, closes it
 * - double press: turns the screen off
 * - 3-second hold: opens the power menu
 *
 * It also turns the screen off when the room stays dark and back on when the
 * light comes back. It reads no screen content; window events are used only to
 * tell whether the power menu is showing.
 */
class GrokButtonService : AccessibilityService(), SensorEventListener {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var power: PowerManager
    private var sensors: SensorManager? = null
    /** Keeps the CPU awake while the screen is off so the light sensor still reports. */
    private var cpuLock: PowerManager.WakeLock? = null

    private var buttonDown = false
    private var holdFired = false
    /** The press that woke the screen only wakes it; it is not also a Grok button press. */
    private var wakePress = false
    /**
     * Set when the screen goes off; the next button press is the one that wakes
     * it. The screen-on broadcast arrives after that press has already started,
     * so it cannot be used to recognise it. Cleared shortly after the screen
     * comes on by other means (light, adb), so a later press is not swallowed.
     */
    private var expectWakePress = false

    private val forgetWakePress = Runnable { expectWakePress = false }
    private var pendingPress = false
    private var powerMenuOpen = false

    private var lux = -1f
    private var darkSince = 0L
    private var lastActivity = 0L
    private var lastLuxLog = 0L

    private val holdForPowerMenu = Runnable {
        holdFired = true
        powerMenuOpen = performGlobalAction(GLOBAL_ACTION_POWER_DIALOG)
        GrokButton.onHold?.invoke()
    }

    private val singlePress = Runnable {
        pendingPress = false
        GrokButton.onPress?.invoke()
    }

    private val darkCheck = object : Runnable {
        override fun run() {
            checkDarkness()
            handler.postDelayed(this, DARK_CHECK_MS)
        }
    }

    override fun onServiceConnected() {
        instance = this
        power = getSystemService(Context.POWER_SERVICE) as PowerManager
        cpuLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GrokSpot:light").apply {
            setReferenceCounted(false)
            acquire()
        }
        sensors = (getSystemService(Context.SENSOR_SERVICE) as SensorManager).also { manager ->
            val light = manager.getDefaultSensor(Sensor.TYPE_LIGHT)
            if (light == null) Log.w(TAG, "No light sensor: automatic screen off is disabled")
            else manager.registerListener(this, light, SensorManager.SENSOR_DELAY_NORMAL)
        }
        lastActivity = SystemClock.elapsedRealtime()
        handler.postDelayed(darkCheck, DARK_CHECK_MS)
        registerReceiver(screenState, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
        })
    }

    private val screenState = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            handler.removeCallbacks(forgetWakePress)
            if (intent.action == Intent.ACTION_SCREEN_OFF) {
                expectWakePress = true
            } else {
                noteActivity()
                handler.postDelayed(forgetWakePress, WAKE_PRESS_MS)
            }
        }
    }

    override fun onUnbind(intent: Intent?): Boolean {
        handler.removeCallbacksAndMessages(null)
        unregisterReceiver(screenState)
        sensors?.unregisterListener(this)
        cpuLock?.release()
        instance = null
        return super.onUnbind(intent)
    }

    // ------------------------------------------------------------ Grok button

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_BUTTON_1) return false
        noteActivity()
        when (event.action) {
            KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0 && !buttonDown) {
                buttonDown = true
                holdFired = false
                wakePress = expectWakePress || !power.isInteractive
                expectWakePress = false
                if (!wakePress) handler.postDelayed(holdForPowerMenu, POWER_MENU_HOLD_MS)
            }
            KeyEvent.ACTION_UP -> {
                handler.removeCallbacks(holdForPowerMenu)
                if (buttonDown && !holdFired && !wakePress) onRelease()
                buttonDown = false
                wakePress = false
            }
        }
        return true
    }

    private fun onRelease() {
        Log.d(TAG, "Button released: powerMenuOpen=$powerMenuOpen pendingPress=$pendingPress")
        when {
            powerMenuOpen -> {
                powerMenuOpen = false
                performGlobalAction(GLOBAL_ACTION_BACK)
            }
            pendingPress -> {
                // Second press inside the window: screen off instead of a press.
                handler.removeCallbacks(singlePress)
                pendingPress = false
                turnScreenOff("double press")
            }
            else -> {
                pendingPress = true
                handler.postDelayed(singlePress, DOUBLE_PRESS_MS)
            }
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val name = event.className?.toString().orEmpty()
        Log.d(TAG, "Window ${event.packageName} / $name")
        // The power menu is SystemUI's GlobalActions dialog; any other window means it has closed.
        powerMenuOpen = event.packageName == SYSTEM_UI && name.contains("GlobalActions")
    }

    override fun onInterrupt() = Unit

    // ------------------------------------------------------------ screen

    private fun turnScreenOff(reason: String) {
        Log.i(TAG, "Screen off ($reason), lux=$lux")
        performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
    }

    @Suppress("DEPRECATION")
    @SuppressLint("WakelockTimeout")
    private fun turnScreenOn(reason: String) {
        Log.i(TAG, "Screen on ($reason), lux=$lux")
        // A bright wake lock with ACQUIRE_CAUSES_WAKEUP is the only way an app can
        // light the screen; the activity's FLAG_KEEP_SCREEN_ON holds it after that.
        power.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "GrokSpot:wake",
        ).acquire(WAKE_HOLD_MS)
    }

    /** Resets the darkness timer; call it on any interaction (button, voice). */
    fun noteActivity() {
        lastActivity = SystemClock.elapsedRealtime()
    }

    override fun onSensorChanged(event: SensorEvent) {
        val previous = lux
        lux = event.values[0]
        val now = SystemClock.elapsedRealtime()
        if (now - lastLuxLog >= LUX_LOG_MS) {
            lastLuxLog = now
            Log.d(TAG, "Light $lux lux")
        }
        if (lux < DARK_LUX) {
            if (previous < 0 || previous >= DARK_LUX) darkSince = now
        } else {
            darkSince = 0L
        }
        // Lights coming on (dark -> bright) wakes the screen, however it was turned off.
        if (previous in 0f..<DARK_LUX && lux >= BRIGHT_LUX && !power.isInteractive) {
            turnScreenOn("light on")
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun checkDarkness() {
        if (!power.isInteractive || darkSince == 0L) return
        val now = SystemClock.elapsedRealtime()
        if (now - darkSince >= DARK_OFF_MS && now - lastActivity >= DARK_OFF_MS) {
            turnScreenOff("dark room")
        }
    }

    companion object {
        private const val TAG = "GrokSpot"
        private const val SYSTEM_UI = "com.android.systemui"
        private const val POWER_MENU_HOLD_MS = 3000L
        private const val DOUBLE_PRESS_MS = 350L
        private const val WAKE_HOLD_MS = 3000L
        /** How long after the screen comes on a press still counts as the one that woke it. */
        private const val WAKE_PRESS_MS = 800L
        private const val DARK_CHECK_MS = 10_000L
        private const val LUX_LOG_MS = 5_000L

        /** Below this the room counts as dark; the screen goes off after DARK_OFF_MS of it. */
        const val DARK_LUX = 5f
        /** Rising past this from dark wakes the screen (the gap avoids flicker at dusk). */
        const val BRIGHT_LUX = 20f
        const val DARK_OFF_MS = 2 * 60 * 1000L

        private var instance: GrokButtonService? = null

        val isRunning: Boolean get() = instance != null

        /** The latest light reading in lux, or -1 before the first one. */
        val lightLevel: Float get() = instance?.lux ?: -1f

        fun noteActivity() {
            instance?.noteActivity()
        }
    }
}

/** Where the service hands Grok button presses to the visible page. */
object GrokButton {
    var onPress: (() -> Unit)? = null
    var onHold: (() -> Unit)? = null
}

package com.grokbot.grokspot

import android.Manifest
import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var voice: VoiceSession
    private val mcpState: (McpServer.ExternalState) -> Unit = { s ->
        val duration = s.durationSec?.let { (it * 1000).toLong().toString() } ?: "null"
        runOnUiThread { callPage("grokspot.external.state(${JSONObject.quote(s.state)}, $duration)") }
    }
    private val mcpQuery: (String, (String?) -> Unit) -> Unit = { script, reply ->
        runOnUiThread { webView.evaluateJavascript(script) { reply(it) } }
    }
    /** A 160 px PNG of this window, for get_avatar_state. */
    private val mcpSnapshot: ((ByteArray?) -> Unit) -> Unit = { reply ->
        runOnUiThread {
            val view = window.decorView
            if (view.width == 0) { reply(null); return@runOnUiThread }
            val full = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
            android.view.PixelCopy.request(window, full, { result ->
                if (result != android.view.PixelCopy.SUCCESS) { reply(null); return@request }
                val small = android.graphics.Bitmap.createScaledBitmap(full, 160, 160 * view.height / view.width, true)
                val png = java.io.ByteArrayOutputStream()
                small.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, png)
                reply(png.toByteArray())
            }, handler)
        }
    }
    /** The OAuth pairing code (McpAuth) shown on the face page until it is used or expires. */
    private val mcpPairing: (McpAuth.PairingEvent) -> Unit = { event ->
        val script = when (event) {
            is McpAuth.PairingEvent.Show ->
                "grokspot.pairing.show(${JSONObject.quote(event.code)}, ${JSONObject.quote(event.client)}, ${event.expiresInMs})"
            is McpAuth.PairingEvent.Approved -> "grokspot.pairing.done(${JSONObject.quote(event.client)})"
            McpAuth.PairingEvent.Hide -> "grokspot.pairing.hide()"
        }
        runOnUiThread { callPage(script) }
    }
    private val handler = Handler(Looper.getMainLooper())
    private val openSettings = Runnable { openSystemSettings() }
    private var holdX = 0f
    private var holdY = 0f

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // 画面を消すとロック画面になるので、点けたときにその上へすぐ顔を出す（暗証番号なしの端末）。
        setShowWhenLocked(true)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // assets/ 以下を https://appassets.androidplatform.net/assets/ として配信する。
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(getColor(R.color.background))
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100
            }
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
            }
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.i(TAG, "${message.messageLevel()} ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                    return true
                }
            }
        }
        setContentView(webView)

        // ホームアプリとして使うので、戻るキーで閉じないようにする。
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })

        hideSystemBars()
        // The page shows its text in the language Android picked for this app's resources,
        // so the screen, the settings and Grok's voice always agree.
        webView.loadUrl("$PAGE_URL?lang=${getString(R.string.ui_language)}")

        voice = VoiceSession(this, object : VoiceSession.Listener {
            override fun onVoiceEvent(type: String, detail: String?) {
                callPage("grokspot.voice.event(${JSONObject.quote(type)}, ${detail?.let(JSONObject::quote) ?: "null"})")
            }

            override fun onVoiceLevel(level: Float) {
                callPage("grokspot.voiceLevel($level)")
            }
        })
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
        }

        // MCP: lets an agent elsewhere (the user's GrokBot) set the face, alongside Grok Voice.
        McpServer.onState = mcpState
        McpServer.onPairing = mcpPairing
        McpServer.queryPage = mcpQuery
        McpServer.takeSnapshot = mcpSnapshot
        McpServer.start(applicationContext)
    }

    /** Grok ボタン: 会話を始める・終える。 */
    private fun toggleVoice() {
        if (voice.isActive) {
            voice.stop()
        } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
        } else {
            voice.start()
        }
    }

    /**
     * The Grok button (the Echo Spot's "mic off" button, remapped to BUTTON_1 by
     * device/Vendor_2454_Product_6500.kl) is handled by GrokButtonService, which
     * sees it from any screen. This is only a fallback for when that service is
     * off: a press still starts or ends a conversation, but there is no power menu or screen off.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_BUTTON_1) return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_UP) toggleVoice()
        return true
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        // Touching the face counts as activity, so a dark room does not switch it off mid-use.
        if (event.actionMasked == MotionEvent.ACTION_DOWN) GrokButtonService.noteActivity()
        trackSettingsHold(event)
        return super.dispatchTouchEvent(event)
    }

    /**
     * 抜け道: 顔を1本指で SETTINGS_HOLD_MS 押し続けると Android の設定を開く。
     * ホームアプリになっても、ここから既定のホームを Launcher3 に戻せる。
     */
    private fun trackSettingsHold(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                holdX = event.x
                holdY = event.y
                handler.postDelayed(openSettings, SETTINGS_HOLD_MS)
            }
            MotionEvent.ACTION_MOVE -> {
                val slop = ViewConfiguration.get(this).scaledTouchSlop
                if (Math.hypot((event.x - holdX).toDouble(), (event.y - holdY).toDouble()) > slop) {
                    handler.removeCallbacks(openSettings)
                }
            }
            MotionEvent.ACTION_POINTER_DOWN,
            MotionEvent.ACTION_UP,
            MotionEvent.ACTION_CANCEL -> handler.removeCallbacks(openSettings)
        }
    }

    private fun openSystemSettings() {
        Log.i(TAG, "Settings hold: opening system settings")
        val open = {
            startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        // ロック画面の上に出ているときは、先にロックを外してから開く。
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (keyguard.isKeyguardLocked) {
            keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() = open()
            })
        } else {
            open()
        }
    }

    private fun callPage(script: String) {
        webView.evaluateJavascript("window.grokspot && $script", null)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        McpServer.pageVisible = true
        GrokButton.onPress = { toggleVoice() }
        GrokButton.onHold = { callPage("grokspot.button('hold')") }
        if (!GrokButtonService.isRunning) {
            Log.w(TAG, "GrokButtonService is off: no power menu, screen off or light sensing")
        }
    }

    override fun onPause() {
        McpServer.pageVisible = false
        handler.removeCallbacks(openSettings)
        GrokButton.onPress = null
        GrokButton.onHold = null
        webView.onPause()
        super.onPause()
    }

    override fun onStop() {
        // 設定などへ移ったらマイクを手放す。
        voice.stop()
        super.onStop()
    }

    override fun onDestroy() {
        // A recreated activity (e.g. after a language change) may already have taken over.
        if (McpServer.onState === mcpState) McpServer.onState = null
        if (McpServer.onPairing === mcpPairing) McpServer.onPairing = null
        if (McpServer.queryPage === mcpQuery) McpServer.queryPage = null
        if (McpServer.takeSnapshot === mcpSnapshot) McpServer.takeSnapshot = null
        webView.destroy()
        super.onDestroy()
    }

    /** immersive sticky: バーを隠し、端からスワイプしたときだけ一時的に出す。 */
    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    private companion object {
        const val TAG = "GrokSpot"
        const val SETTINGS_HOLD_MS = 5_000L
        const val REQUEST_MIC = 1
        const val PAGE_URL = "https://appassets.androidplatform.net/assets/web/index.html"
    }
}

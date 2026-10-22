package com.grokbot.grokspot

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.sqrt

/**
 * One Grok Voice conversation (wss://api.x.ai/v1/realtime, speech to speech).
 *
 * The Grok button starts it; it ends on a second press or after IDLE_TIMEOUT_MS
 * without speech or replies. Mic audio goes up as 24 kHz PCM and the reply audio
 * is played as it arrives. What happens is reported to [listener] as plain event
 * names (see [Listener.onVoiceEvent]); the page turns those into avatar states.
 *
 * The avatar_state "side channel" is the set_avatar_state function: the model
 * calls it next to speaking, so the state never ends up in the audio.
 */
class VoiceSession(private val context: Context, private val listener: Listener) {

    interface Listener {
        /**
         * Called on the main thread. type is one of connected, speech_started,
         * speech_stopped, response_created, audio_started, tool_call (detail: name),
         * avatar_state (detail: state), response_done (detail: "continuing" when
         * a follow-up response was requested), error (detail: message), disconnected.
         */
        fun onVoiceEvent(type: String, detail: String? = null)

        /** Reply loudness 0..1 while it plays, on the main thread. */
        fun onVoiceLevel(level: Float)
    }

    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var socket: WebSocket? = null
    private var mic: Thread? = null
    private var player: Player? = null
    @Volatile private var running = false

    // Per response, touched only on the OkHttp reader thread.
    private var responseHasAudio = false
    private val avatarCalls = mutableListOf<String>()

    private val idleTimeout = Runnable {
        Log.i(TAG, "No conversation for ${IDLE_TIMEOUT_MS / 1000} s, closing")
        stop()
    }

    val isActive: Boolean get() = running

    /** Opens the session. Returns false (and reports an error) when there is no API key. */
    fun start(): Boolean {
        if (running) return true
        val key = File(context.filesDir, KEY_FILE).takeIf { it.isFile }?.readText()?.trim()
        if (key.isNullOrEmpty()) {
            Log.e(TAG, "No API key: run scripts/set-api-key.ps1")
            emit("error", "no api key")
            emit("disconnected")
            return false
        }
        running = true
        val request = Request.Builder()
            .url("$URL?model=$MODEL")
            .header("Authorization", "Bearer $key")
            .build()
        socket = client.newWebSocket(request, Events())
        touch()
        return true
    }

    fun stop() {
        if (!running) return
        running = false
        main.removeCallbacks(idleTimeout)
        socket?.close(1000, "bye")
        socket = null
        mic?.interrupt()
        mic = null
        player?.release()
        player = null
        emit("disconnected")
    }

    /** Pushes the idle timeout back; called whenever the conversation moves. */
    private fun touch() {
        main.removeCallbacks(idleTimeout)
        main.postDelayed(idleTimeout, IDLE_TIMEOUT_MS)
        main.post { GrokButtonService.noteActivity() }
    }

    private fun emit(type: String, detail: String? = null) {
        main.post { listener.onVoiceEvent(type, detail) }
    }

    private fun send(json: JSONObject) {
        socket?.send(json.toString())
    }

    private fun sessionConfig(): JSONObject {
        val search = searchTools()
        val tools = JSONArray().put(JSONObject()
            .put("type", "function")
            .put("name", AVATAR_FUNCTION)
            .put("description", context.getString(R.string.avatar_function_description))
            .put("parameters", JSONObject()
                .put("type", "object")
                .put("properties", JSONObject().put("state", JSONObject()
                    .put("type", "string")
                    .put("enum", JSONArray(AVATAR_STATES))))
                .put("required", JSONArray().put("state"))))
        // Built-in tools: run on xAI's side within the reply, nothing to send back.
        search.forEach { tools.put(JSONObject().put("type", it)) }
        // Instructions in the device language (res/values*/strings.xml), so Grok speaks it too.
        var instructions = context.resources.getStringArray(R.array.voice_instructions).joinToString("\n")
        if (search.isNotEmpty()) {
            instructions += "\n" + context.getString(R.string.voice_search_instruction, search.joinToString(" / "))
        }
        instructions += "\n" + nowLine()
        return JSONObject()
            .put("type", "session.update")
            .put("session", JSONObject()
                .put("voice", VOICE)
                .put("instructions", instructions)
                .put("turn_detection", JSONObject().put("type", "server_vad"))
                .put("audio", JSONObject()
                    .put("input", JSONObject().put("format", pcmFormat()))
                    .put("output", JSONObject().put("format", pcmFormat())))
                .put("tools", tools))
    }

    /**
     * The search tools the user turned on (files/voice_search, written by
     * scripts/set-voice-search.ps1). Off by default: searches cost extra.
     */
    private fun searchTools(): List<String> {
        val text = File(context.filesDir, SEARCH_FILE).takeIf { it.isFile }?.readText().orEmpty()
        // Letters only: a file written from Windows PowerShell may start with a byte order mark.
        val wanted = text.split(',', ' ', '\n').map { token -> token.filter(Char::isLetter).lowercase() }.toSet()
        return listOfNotNull("web_search".takeIf { "web" in wanted }, "x_search".takeIf { "x" in wanted })
    }

    private fun pcmFormat() = JSONObject().put("type", "audio/pcm").put("rate", SAMPLE_RATE)

    /**
     * Today's date, time and time zone. Without it Grok guessed an old date and
     * searched for stale results (e.g. "today's weather" in a month long past).
     */
    private fun nowLine(): String {
        val format = java.text.SimpleDateFormat("yyyy-MM-dd (EEE) HH:mm", java.util.Locale.ENGLISH)
        return "Current date and time: ${format.format(java.util.Date())}, time zone ${java.util.TimeZone.getDefault().id}."
    }

    private inner class Events : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            Log.i(TAG, "Connected (search: ${searchTools().ifEmpty { listOf("off") }.joinToString()})")
            send(sessionConfig())
            player = Player()
            mic = Thread(::recordLoop, "GrokSpot-mic").also { it.start() }
            emit("connected")
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!running) return
            val event = JSONObject(text)
            when (val type = event.optString("type")) {
                "input_audio_buffer.speech_started" -> {
                    // Barge-in: stop the reply that is playing.
                    player?.flush()
                    touch()
                    emit("speech_started")
                }
                "input_audio_buffer.speech_stopped" -> emit("speech_stopped")
                "response.created" -> {
                    responseHasAudio = false
                    avatarCalls.clear()
                    touch()
                    emit("response_created")
                }
                "response.output_audio.delta", "response.audio.delta" -> {
                    val pcm = Base64.decode(event.optString("delta"), Base64.DEFAULT)
                    if (!responseHasAudio) {
                        responseHasAudio = true
                        player?.enqueue { emit("audio_started") }
                    }
                    player?.write(pcm)
                }
                "response.function_call_arguments.done" -> onFunctionCall(event)
                "response.done" -> onResponseDone()
                "error" -> {
                    val message = event.optJSONObject("error")?.optString("message") ?: text
                    Log.w(TAG, "Server error: $message")
                    emit("error", message)
                }
                "conversation.item.input_audio_transcription.completed" ->
                    Log.i(TAG, "User: ${event.optString("transcript")}")
                "response.output_audio_transcript.done" ->
                    Log.i(TAG, "Grok: ${event.optString("transcript")}")
                else -> Log.v(TAG, "Event $type")
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.e(TAG, "Connection failed: ${response?.code} ${t.message}")
            if (running) emit("error", t.message ?: "connection failed")
            main.post { stop() }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            Log.i(TAG, "Closed: $code $reason")
            main.post { stop() }
        }
    }

    private fun onFunctionCall(event: JSONObject) {
        val name = event.optString("name")
        val callId = event.optString("call_id")
        if (name in BUILT_IN_TOOLS) {
            // xAI runs the search itself and carries on with the reply; just show it on the face.
            Log.i(TAG, "Grok uses $name")
            emit("tool_call", name)
            return
        }
        if (name != AVATAR_FUNCTION) {
            Log.w(TAG, "Unknown function $name")
            emit("tool_call", name)
            sendFunctionOutput(callId, JSONObject().put("error", "unknown function"))
            send(JSONObject().put("type", "response.create"))
            return
        }
        val state = runCatching { JSONObject(event.optString("arguments")).optString("state") }.getOrNull()
        Log.i(TAG, "Avatar state from Grok: $state")
        avatarCalls += callId
        // Show it in step with the audio queued so far.
        if (!state.isNullOrEmpty()) player?.enqueue { emit("avatar_state", state) }
    }

    private fun onResponseDone() {
        touch()
        avatarCalls.forEach { sendFunctionOutput(it, JSONObject().put("ok", true)) }
        // Grok ends a response at a set_avatar_state call and waits for its result before going on,
        // even in the middle of an answer; without this the answer stopped after a few words.
        val continuing = avatarCalls.isNotEmpty()
        avatarCalls.clear()
        if (continuing) send(JSONObject().put("type", "response.create"))
        val detail = if (continuing) "continuing" else null
        // Report the end once the reply has finished playing, not when it finished arriving.
        player?.enqueue {
            touch()
            emit("response_done", detail)
        } ?: emit("response_done", detail)
    }

    private fun sendFunctionOutput(callId: String, output: JSONObject) {
        send(JSONObject()
            .put("type", "conversation.item.create")
            .put("item", JSONObject()
                .put("type", "function_call_output")
                .put("call_id", callId)
                .put("output", output.toString())))
    }

    @SuppressLint("MissingPermission") // MainActivity asks for RECORD_AUDIO before starting a session.
    private fun recordLoop() {
        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minBuffer, CHUNK_BYTES * 4),
            )
        } catch (e: Exception) {
            null
        }
        if (record?.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "Microphone unavailable at $SAMPLE_RATE Hz")
            record?.release()
            emit("error", "microphone unavailable")
            main.post { stop() }
            return
        }
        val echoCanceler = if (AcousticEchoCanceler.isAvailable()) {
            AcousticEchoCanceler.create(record.audioSessionId)?.apply { enabled = true }
        } else null
        Log.i(TAG, "Mic ${record.sampleRate} Hz, echo canceler ${echoCanceler?.enabled ?: "none"}")
        val buffer = ByteArray(CHUNK_BYTES)
        record.startRecording()
        try {
            while (running && !Thread.currentThread().isInterrupted) {
                val read = record.read(buffer, 0, buffer.size)
                if (read <= 0) continue
                // Without an echo canceler the mic would hear the reply and interrupt it.
                if (echoCanceler == null && player?.isPlaying == true) continue
                send(JSONObject()
                    .put("type", "input_audio_buffer.append")
                    .put("audio", Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP)))
            }
        } finally {
            record.stop()
            echoCanceler?.release()
            record.release()
        }
    }

    /**
     * Plays reply audio on its own thread. Markers queued with [enqueue] run when
     * playback reaches them, so events line up with what is heard.
     */
    private inner class Player {
        private val queue = LinkedBlockingQueue<Any>()
        private val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build())
            .setAudioFormat(AudioFormat.Builder()
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .build())
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        @Volatile private var framesWritten = 0L
        @Volatile private var generation = 0
        private var lastLevelAt = 0L
        @Volatile var isPlaying = false
            private set
        private val thread = Thread(::loop, "GrokSpot-player").also { it.start() }

        fun write(pcm: ByteArray) = queue.put(pcm)
        fun enqueue(marker: () -> Unit) = queue.put(marker)

        /** Drops everything not yet heard (the user started talking). */
        fun flush() {
            generation++
            queue.clear()
            track.pause()
            track.flush()
            framesWritten = track.playbackHeadPosition.toLong()
            track.play()
            isPlaying = false
            main.post { listener.onVoiceLevel(0f) }
        }

        fun release() {
            queue.clear()
            thread.interrupt()
        }

        @Suppress("UNCHECKED_CAST")
        private fun loop() {
            track.play()
            try {
                while (true) {
                    val item = queue.poll(200, TimeUnit.MILLISECONDS)
                    if (item == null) {
                        if (isPlaying && track.playbackHeadPosition >= framesWritten) {
                            isPlaying = false
                            main.post { listener.onVoiceLevel(0f) }
                        }
                        continue
                    }
                    when (item) {
                        is ByteArray -> play(item)
                        else -> {
                            drain()
                            (item as () -> Unit)()
                        }
                    }
                }
            } catch (_: InterruptedException) {
            } finally {
                track.stop()
                track.release()
            }
        }

        private fun play(pcm: ByteArray) {
            isPlaying = true
            val started = generation
            // Write in ~33 ms slices so the level follows what is heard.
            var offset = 0
            while (offset < pcm.size && generation == started) {
                val size = minOf(LEVEL_SLICE_BYTES, pcm.size - offset)
                val level = rms(pcm, offset, size)
                track.write(pcm, offset, size)
                framesWritten += size / 2
                offset += size
                val now = SystemClock.elapsedRealtime()
                if (now - lastLevelAt >= 33) {
                    lastLevelAt = now
                    main.post { listener.onVoiceLevel(level) }
                }
            }
        }

        /** Waits until everything written so far has been heard. */
        private fun drain() {
            while (track.playbackHeadPosition < framesWritten && queue.isEmpty()) Thread.sleep(20)
        }

        private fun rms(pcm: ByteArray, offset: Int, size: Int): Float {
            var sum = 0.0
            var i = offset
            while (i + 1 < offset + size) {
                val sample = (pcm[i].toInt() and 0xff) or (pcm[i + 1].toInt() shl 8)
                sum += sample.toDouble() * sample
                i += 2
            }
            val value = sqrt(sum / (size / 2).coerceAtLeast(1)) / 32768.0
            return (value * 4).coerceIn(0.0, 1.0).toFloat()
        }
    }

    private companion object {
        const val TAG = "GrokVoice"
        const val URL = "wss://api.x.ai/v1/realtime"
        const val MODEL = "grok-voice-latest"
        const val VOICE = "eve"
        const val KEY_FILE = "xai_api_key"
        const val SEARCH_FILE = "voice_search"
        const val SAMPLE_RATE = 24_000
        const val CHUNK_BYTES = SAMPLE_RATE / 25 * 2 // 40 ms of mono PCM16
        const val LEVEL_SLICE_BYTES = SAMPLE_RATE / 30 * 2
        const val IDLE_TIMEOUT_MS = 60_000L
        const val AVATAR_FUNCTION = "set_avatar_state"
        val BUILT_IN_TOOLS = setOf("web_search", "x_search")

        // grokbot-web の状態名のうち、ニュアンスとして AI が選べるもの。
        val AVATAR_STATES = listOf(
            "happy", "excited", "curious", "confused", "surprised", "sad", "angry",
            "thinking", "working", "searching", "celebrate", "bored", "alerting", "notifying",
        )
    }
}

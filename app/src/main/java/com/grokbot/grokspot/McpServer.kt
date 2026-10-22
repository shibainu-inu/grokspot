package com.grokbot.grokspot

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.UUID
import java.util.concurrent.Executors

/**
 * A minimal MCP server (Model Context Protocol, Streamable HTTP transport) so an
 * agent such as the user's own GrokBot can change the avatar on the screen.
 *
 * - Endpoint: POST http://<device>:[PORT]/mcp with JSON-RPC 2.0 messages; the
 *   reply is plain JSON (no SSE stream, so GET /mcp answers 405).
 * - One tool: set_avatar_state(state). Unknown states are ignored, not errors.
 * - Auth is always on. Either OAuth 2.1 (McpAuth: the client registers itself
 *   and the user approves with a code shown on the Echo Spot), or the device's
 *   own token (files/mcp_token, made on first start; scripts/set-mcp-token.ps1)
 *   as "Authorization: Bearer <token>" or "?key=<token>".
 * - Requests to /mcp carrying an Origin header are refused: no browser should
 *   call it, and it blocks DNS rebinding from web pages on the same network.
 *
 * It runs for the life of the app process, apart from VoiceSession; states go
 * to the page through [onState] (MainActivity), which applies the same
 * priorities as Grok Voice's own set_avatar_state.
 */
object McpServer {

    const val PORT = 8765
    private const val TAG = "GrokMcp"
    private const val TOKEN_FILE = "mcp_token"
    private const val MAX_BODY = 64 * 1024
    private const val JSON_TYPE = "application/json; charset=utf-8"
    private val PROTOCOL_VERSIONS = listOf("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")

    /** The states the tool offers (GrokSpot × GrokBot アバター出力インターフェース 仕様). */
    val STATES = listOf(
        "idle", "listening", "thinking", "working", "searching", "happy", "excited", "curious",
        "confused", "surprised", "sad", "angry", "celebrate", "bored", "alerting", "notifying",
    )

    private const val CAPTION_MAX = 8
    private const val MAX_DURATION_SEC = 600

    /** A state from set_avatar_state: caption null = the state's default, "" = none. */
    data class ExternalState(val state: String, val caption: String?, val durationSec: Double?)

    /** Shows a state on the page; set by MainActivity while it exists. Called on a worker thread. */
    @Volatile var onState: ((ExternalState) -> Unit)? = null

    /** Runs a script on the page and hands back its JSON result (get_avatar_state). */
    @Volatile var queryPage: ((String, (String?) -> Unit) -> Unit)? = null

    /** Takes a small PNG of the screen (get_avatar_state include_image). */
    @Volatile var takeSnapshot: (((ByteArray?) -> Unit) -> Unit)? = null

    /** The face page is in the foreground (MainActivity resumed). */
    @Volatile var pageVisible = false

    /** Shows or hides the pairing code on the page; set by MainActivity. Called on a worker thread. */
    @Volatile var onPairing: ((McpAuth.PairingEvent) -> Unit)? = null

    private var server: ServerSocket? = null
    private lateinit var appContext: Context
    private lateinit var filesDir: File
    private lateinit var auth: McpAuth
    private var version = "0"
    private val workers = Executors.newCachedThreadPool()

    @Synchronized
    fun start(context: Context) {
        if (server != null) return
        appContext = context.applicationContext
        filesDir = context.filesDir
        version = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
        ensureToken()
        auth = McpAuth(filesDir) { event ->
            if (event is McpAuth.PairingEvent.Show) wakeScreen()
            onPairing?.invoke(event)
        }
        val socket = try {
            ServerSocket(PORT, 16, InetAddress.getByName("0.0.0.0"))
        } catch (e: Exception) {
            Log.e(TAG, "Cannot listen on port $PORT", e)
            return
        }
        server = socket
        Thread({
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (_: Exception) { break }
                workers.execute { serve(client) }
            }
        }, "GrokSpot-mcp").start()
        Log.i(TAG, "MCP server on port $PORT")
    }

    private fun token(): String? =
        File(filesDir, TOKEN_FILE).takeIf { it.isFile }?.readText()?.trim()?.takeIf { it.isNotEmpty() }

    /** Secure by default: the device makes its own token the first time. */
    private fun ensureToken() {
        if (token() != null) return
        val bytes = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        val made = android.util.Base64.encodeToString(bytes,
            android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)
        File(filesDir, TOKEN_FILE).writeText(made)
        Log.i(TAG, "Made a new MCP token")
    }

    /** Turns the screen on so the pairing code can be read. */
    @Suppress("DEPRECATION") // ACQUIRE_CAUSES_WAKEUP still works on Android 11 and has no replacement for this.
    private fun wakeScreen() {
        val power = appContext.getSystemService(android.os.PowerManager::class.java)
        power.newWakeLock(android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
            android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP, "GrokSpot:pairing").acquire(10_000)
        GrokButtonService.noteActivity()
    }

    // ------------------------------------------------------------------ HTTP

    private class Request(val method: String, val path: String, val query: Map<String, String>,
                          val headers: Map<String, String>, val body: ByteArray)

    private fun serve(client: Socket) {
        client.use { socket ->
            socket.soTimeout = 15_000
            val input = BufferedInputStream(socket.getInputStream())
            val output = socket.getOutputStream()
            val request = try { readRequest(input) } catch (e: Exception) {
                Log.w(TAG, "Bad request: ${e.message}")
                respond(output, 400, "text/plain", "bad request")
                return
            } ?: return
            try {
                handle(request, output)
            } catch (e: Exception) {
                Log.e(TAG, "Request failed", e)
                respond(output, 500, "text/plain", "internal error")
            }
        }
    }

    private fun readLine(input: InputStream): String? {
        val line = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) return if (line.size() == 0) null else line.toString("UTF-8")
            if (b == '\n'.code) return line.toString("UTF-8").trimEnd('\r')
            line.write(b)
            if (line.size() > 8192) throw IllegalArgumentException("header line too long")
        }
    }

    private fun readRequest(input: InputStream): Request? {
        val start = readLine(input) ?: return null
        val parts = start.split(" ")
        require(parts.size >= 2) { "bad request line" }
        val headers = mutableMapOf<String, String>()
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) break
            val colon = line.indexOf(':')
            if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
        }
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        require(length in 0..MAX_BODY) { "body too large" }
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) break
            read += n
        }
        val target = parts[1]
        val q = target.indexOf('?')
        val path = if (q >= 0) target.substring(0, q) else target
        val query = if (q < 0) emptyMap() else target.substring(q + 1).split('&').mapNotNull {
            val eq = it.indexOf('=')
            if (eq <= 0) null else it.substring(0, eq) to URLDecoder.decode(it.substring(eq + 1), "UTF-8")
        }.toMap()
        return Request(parts[0].uppercase(), path, query, headers, body)
    }

    private fun respond(out: OutputStream, status: Int, type: String?, body: String,
                        extra: Map<String, String> = emptyMap()) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val reason = mapOf(200 to "OK", 201 to "Created", 202 to "Accepted", 204 to "No Content",
            302 to "Found", 400 to "Bad Request", 401 to "Unauthorized", 403 to "Forbidden",
            404 to "Not Found", 405 to "Method Not Allowed", 500 to "Internal Server Error")[status] ?: "OK"
        val head = StringBuilder("HTTP/1.1 $status $reason\r\n")
        if (type != null) head.append("Content-Type: $type\r\n")
        head.append("Content-Length: ${bytes.size}\r\nConnection: close\r\nCache-Control: no-store\r\n")
        extra.forEach { (k, v) -> head.append("$k: $v\r\n") }
        head.append("\r\n")
        out.write(head.toString().toByteArray(Charsets.UTF_8))
        out.write(bytes)
        out.flush()
    }

    /** The public base URL the client used (through a tunnel this is its https host). */
    private fun baseUrl(request: Request): String {
        val host = request.headers["x-forwarded-host"] ?: request.headers["host"] ?: "localhost:$PORT"
        val proto = request.headers["x-forwarded-proto"]?.substringBefore(',')?.trim() ?: "http"
        return "$proto://$host"
    }

    /**
     * MCP endpoint paths: /mcp, or /mcp/<anything> (e.g. /mcp/v3). A new path
     * makes a client that caches tools per URL (Grok's connectors) fetch them
     * again; every path serves the same server.
     */
    private fun isMcpPath(path: String) = path == "/mcp" || MCP_VARIANT.matches(path)
    private val MCP_VARIANT = Regex("/mcp/[A-Za-z0-9_-]{1,32}")

    private const val RESOURCE_METADATA = "/.well-known/oauth-protected-resource"

    private fun handle(request: Request, out: OutputStream) {
        val base = baseUrl(request)
        if (isMcpPath(request.path)) { handleMcp(request, out, base); return }
        // RFC 9728: the metadata for /mcp/v3 lives at /.well-known/oauth-protected-resource/mcp/v3.
        if (request.method == "GET" && request.path.startsWith(RESOURCE_METADATA)) {
            val resource = request.path.removePrefix(RESOURCE_METADATA).ifEmpty { "/mcp" }
            if (isMcpPath(resource)) {
                respond(out, 200, JSON_TYPE, auth.resourceMetadata(base, resource).toString(), CORS)
                return
            }
        }
        when (request.path) {
            "/" -> if (request.method == "GET") {
                respond(out, 200, "text/plain; charset=utf-8", "GrokSpot MCP server: POST /mcp\n")
                return
            }
            "/.well-known/oauth-authorization-server", "/.well-known/openid-configuration" ->
                if (request.method == "GET") { respond(out, 200, JSON_TYPE, auth.serverMetadata(base).toString(), CORS); return }
            "/register" -> if (request.method == "POST") {
                val body = try { JSONObject(request.body.toString(Charsets.UTF_8)) } catch (_: Exception) { JSONObject() }
                val (status, reply) = auth.register(body)
                respond(out, status, JSON_TYPE, reply.toString(), CORS)
                return
            }
            "/authorize" -> { handleAuthorize(request, out, base); return }
            "/token" -> if (request.method == "POST") {
                val (status, reply) = auth.token(parseForm(request.body), basicClientId(request))
                respond(out, status, JSON_TYPE, reply.toString(), CORS)
                return
            }
        }
        if (request.method == "OPTIONS") { respond(out, 204, null, "", CORS); return }
        respond(out, 404, "text/plain", "not found")
    }

    private fun handleMcp(request: Request, out: OutputStream, base: String) {
        if (request.headers.containsKey("origin")) {
            Log.w(TAG, "Refused a request with Origin ${request.headers["origin"]}")
            respond(out, 403, "text/plain", "origin not allowed")
            return
        }
        val bearer = request.headers["authorization"]?.takeIf { it.startsWith("Bearer ", ignoreCase = true) }
            ?.substring(7)?.trim()
        val key = request.query["key"]
        val expected = token()
        val allowed = (expected != null && (bearer == expected || key == expected)) ||
            (bearer != null && auth.isValidAccessToken(bearer))
        if (!allowed) {
            // Points OAuth clients at the metadata (RFC 9728), so a URL alone is enough to connect.
            val challenge = "Bearer resource_metadata=\"$base$RESOURCE_METADATA${request.path}\"" +
                (if (bearer != null) ", error=\"invalid_token\"" else "") + ", scope=\"${McpAuth.SCOPE}\""
            respond(out, 401, "text/plain", "unauthorized", mapOf("WWW-Authenticate" to challenge))
            return
        }
        when (request.method) {
            "POST" -> handlePost(request, out)
            // No server-initiated stream: every reply goes back on its POST.
            "GET" -> respond(out, 405, "text/plain", "no event stream", mapOf("Allow" to "POST, DELETE"))
            "DELETE" -> respond(out, 204, null, "")
            else -> respond(out, 405, "text/plain", "method not allowed", mapOf("Allow" to "POST, DELETE"))
        }
    }

    // ---------------------------------------------------------------- OAuth

    /** Metadata, registration and tokens may be read by browser-based MCP clients too. */
    private val CORS = mapOf(
        "Access-Control-Allow-Origin" to "*",
        "Access-Control-Allow-Headers" to "Authorization, Content-Type, MCP-Protocol-Version",
        "Access-Control-Allow-Methods" to "GET, POST, OPTIONS",
    )

    private fun parseForm(body: ByteArray): Map<String, String> =
        body.toString(Charsets.UTF_8).split('&').mapNotNull {
            val eq = it.indexOf('=')
            if (eq <= 0) null else URLDecoder.decode(it.substring(0, eq), "UTF-8") to
                URLDecoder.decode(it.substring(eq + 1), "UTF-8")
        }.toMap()

    /** client_id from "Authorization: Basic", for clients that send it that way. */
    private fun basicClientId(request: Request): String? {
        val header = request.headers["authorization"] ?: return null
        if (!header.startsWith("Basic ", ignoreCase = true)) return null
        return try {
            String(android.util.Base64.decode(header.substring(6).trim(), android.util.Base64.DEFAULT))
                .substringBefore(':').let { URLDecoder.decode(it, "UTF-8") }
        } catch (_: Exception) { null }
    }

    private fun handleAuthorize(request: Request, out: OutputStream, base: String) {
        when (request.method) {
            "GET" -> when (val result = auth.startAuthorization(request.query)) {
                is McpAuth.AuthorizeResult.Page -> page(out, result.id, result.clientName, result.redirectOrigin, null)
                is McpAuth.AuthorizeResult.Redirect -> respond(out, 302, null, "", mapOf("Location" to result.location))
                is McpAuth.AuthorizeResult.Fail -> message(out, 400, result.message)
            }
            "POST" -> {
                // The approval form posts to itself; refuse a cross-site post.
                val origin = request.headers["origin"]
                if (origin != null && origin != "null" && origin != base) {
                    respond(out, 403, "text/plain", "origin not allowed")
                    return
                }
                val form = parseForm(request.body)
                when (val result = auth.approve(form["request"].orEmpty(), form["code"].orEmpty(), form["deny"] != null)) {
                    is McpAuth.ApproveResult.Redirect -> respond(out, 302, null, "", mapOf("Location" to result.location))
                    is McpAuth.ApproveResult.Retry -> page(out, result.id, result.clientName, result.redirectOrigin,
                        appContext.getString(R.string.pair_wrong, result.attemptsLeft))
                    McpAuth.ApproveResult.Expired -> message(out, 400, appContext.getString(R.string.pair_expired))
                }
            }
            else -> respond(out, 405, "text/plain", "method not allowed", mapOf("Allow" to "GET, POST"))
        }
    }

    private fun html(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace("\"", "&quot;").replace("'", "&#39;")

    private fun pageHeaders(formTarget: String?) = mapOf(
        "Content-Security-Policy" to "default-src 'none'; style-src 'unsafe-inline'; " +
            "form-action 'self'${formTarget?.let { " $it" } ?: ""}; frame-ancestors 'none'",
        "X-Frame-Options" to "DENY",
        "Referrer-Policy" to "no-referrer",
    )

    private fun shell(title: String, inner: String) = """
        <!doctype html><html lang="${appContext.getString(R.string.ui_language)}"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1"><title>${html(title)}</title>
        <style>
        body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1c1c1c;color:#eee;font:16px/1.5 system-ui,sans-serif}
        main{width:min(360px,90vw);text-align:center}
        h1{font-size:20px;margin:0 0 8px}
        p{color:#bbb;margin:0 0 16px}
        .client{color:#fff;font-weight:600}
        input{width:100%;box-sizing:border-box;font-size:32px;letter-spacing:8px;text-align:center;padding:10px;border-radius:12px;border:1px solid #555;background:#111;color:#fff}
        .row{display:flex;gap:10px;margin-top:16px}
        button{flex:1;font-size:16px;padding:12px;border-radius:12px;border:0;cursor:pointer}
        .ok{background:#4cc2ff;color:#000;font-weight:600}.no{background:#333;color:#ddd}
        .err{color:#ff8a7a}
        .dest{color:#8fd6ff;font-size:14px}
        </style></head><body><main>$inner</main></body></html>
    """.trimIndent()

    /** The approval page: type the code shown on the Echo Spot. */
    private fun page(out: OutputStream, id: String, clientName: String, redirectOrigin: String, error: String?) {
        val title = appContext.getString(R.string.pair_title)
        val inner = """
            <h1>${html(title)}</h1>
            <p><span class="client">${html(clientName)}</span>
              <br><span class="dest">→ ${html(redirectOrigin.substringAfter("://"))}</span>
              <br>${html(appContext.getString(R.string.pair_prompt))}</p>
            ${error?.let { "<p class=\"err\">${html(it)}</p>" } ?: ""}
            <form method="post" action="/authorize">
              <input type="hidden" name="request" value="${html(id)}">
              <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" autofocus required>
              <div class="row">
                <button class="no" name="deny" value="1" formnovalidate>${html(appContext.getString(R.string.pair_deny))}</button>
                <button class="ok" type="submit">${html(appContext.getString(R.string.pair_allow))}</button>
              </div>
            </form>
        """.trimIndent()
        respond(out, 200, "text/html; charset=utf-8", shell(title, inner), pageHeaders(redirectOrigin))
    }

    private fun message(out: OutputStream, status: Int, text: String) {
        val title = appContext.getString(R.string.pair_title)
        respond(out, status, "text/html; charset=utf-8", shell(title, "<h1>${html(title)}</h1><p>${html(text)}</p>"),
            pageHeaders(null))
    }

    // -------------------------------------------------------------- JSON-RPC

    private fun handlePost(request: Request, out: OutputStream) {
        val text = request.body.toString(Charsets.UTF_8).trim()
        val parsed = try {
            if (text.startsWith("[")) JSONArray(text) else JSONObject(text)
        } catch (e: Exception) {
            respond(out, 400, JSON_TYPE, error(null, -32700, "Parse error").toString())
            return
        }
        val messages = if (parsed is JSONArray) (0 until parsed.length()).map { parsed.getJSONObject(it) }
            else listOf(parsed as JSONObject)
        var sessionId: String? = null
        val replies = messages.mapNotNull { message ->
            if (message.optString("method") == "initialize") sessionId = UUID.randomUUID().toString()
            dispatch(message)
        }
        val extra = sessionId?.let { mapOf("Mcp-Session-Id" to it) } ?: emptyMap()
        when {
            replies.isEmpty() -> respond(out, 202, null, "", extra) // only notifications
            parsed is JSONArray -> respond(out, 200, JSON_TYPE, JSONArray(replies).toString(), extra)
            else -> respond(out, 200, JSON_TYPE, replies[0].toString(), extra)
        }
    }

    /** The reply to one message, or null for a notification. */
    private fun dispatch(message: JSONObject): JSONObject? {
        val id = message.opt("id")
        val method = message.optString("method")
        if (id == null || id == JSONObject.NULL) {
            Log.i(TAG, "Notification $method")
            return null
        }
        val params = message.optJSONObject("params") ?: JSONObject()
        return when (method) {
            "initialize" -> {
                val asked = params.optString("protocolVersion")
                result(id, JSONObject()
                    .put("protocolVersion", if (asked in PROTOCOL_VERSIONS) asked else PROTOCOL_VERSIONS[0])
                    .put("capabilities", JSONObject().put("tools", JSONObject().put("listChanged", false)))
                    .put("serverInfo", JSONObject().put("name", "grokspot").put("version", version))
                    .put("instructions", INSTRUCTIONS))
            }
            "ping" -> result(id, JSONObject())
            "tools/list" -> { Log.i(TAG, "tools/list"); result(id, JSONObject().put("tools", JSONArray().put(setStateTool()).put(getStateTool()))) }
            "tools/call" -> callTool(id, params)
            else -> error(id, -32601, "Method not found: $method")
        }
    }

    private const val INSTRUCTIONS =
        "GrokSpot shows your face on an Echo Spot, a small round display on the user's desk. " +
        "Use set_avatar_state to show what you are doing or feeling: thinking while you work out an answer, " +
        "searching or working while you use tools, then a feeling (happy, surprised, ...) when you reply. " +
        "Nothing you set is spoken. Calls are optional; the face looks after itself when you do not call."

    /** One line per state, so the model can tell close states apart (shown in the tool description). */
    private val STATE_GUIDE = listOf(
        "idle: calm, nothing going on (hands the face back to its own idle life)",
        "listening: paying attention to the user",
        "thinking: working out an answer (the head becomes typing dots)",
        "working: busy with a task or a tool",
        "searching: looking something up",
        "happy: pleased, gentle joy",
        "excited: bouncy, eager anticipation",
        "celebrate: a big success worth a party (big spin and rainbow trails)",
        "curious: interested, wants to know more",
        "confused: did not understand, needs clarification",
        "surprised: unexpected news",
        "sad: sorry or disappointed",
        "angry: annoyed (use sparingly)",
        "bored: waiting with nothing to do",
        "alerting: something needs the user's attention or went wrong (a \"!\")",
        "notifying: a new result or message is ready (calmer than alerting)",
    )

    private fun setStateTool() = JSONObject()
        .put("name", "set_avatar_state")
        .put("description", "画面に表示されているアバターの表情・状態を変更する。音声には影響しない。 " +
            "Changes the expression/state of the avatar on the Echo Spot screen. It does not affect speech. " +
            "Typical flow: thinking while composing, searching/working while using tools, then a feeling such as " +
            "happy when replying. The state stays until the next call, duration_sec, or 30 seconds, then the face " +
            "returns to its idle life. States:\n" + STATE_GUIDE.joinToString("\n"))
        .put("inputSchema", JSONObject()
            .put("type", "object")
            .put("properties", JSONObject()
                .put("state", JSONObject()
                    .put("type", "string")
                    .put("description", "表示する状態名 / the state to show")
                    .put("enum", JSONArray(STATES)))
                .put("caption", JSONObject()
                    .put("type", "string")
                    .put("description", "Optional: one emoji or a short word shown under the face, up to $CAPTION_MAX characters " +
                        "(e.g. \"🎉\", \"検索中\", \"要確認\"). Not a sentence. Omit it for a default (an emoji " +
                        "for feelings, a word for actions); pass \"\" for none. It disappears when the state does."))
                .put("duration_sec", JSONObject()
                    .put("type", "number")
                    .put("minimum", 1).put("maximum", MAX_DURATION_SEC)
                    .put("description", "Optional: go back to idle after this many seconds (default 30).")))
            .put("required", JSONArray().put("state")))

    private fun getStateTool() = JSONObject()
        .put("name", "get_avatar_state")
        .put("description", "アバターの今の状態を返す。 Returns the avatar's current state, when it last changed, " +
            "what set it (mcp, voice conversation, or its own idle life), the caption, and viewer_connected " +
            "(the screen is on and showing the face; it cannot tell whether a person is looking). " +
            "Set include_image to also get a small picture of the screen.")
        .put("inputSchema", JSONObject()
            .put("type", "object")
            .put("properties", JSONObject()
                .put("include_image", JSONObject()
                    .put("type", "boolean")
                    .put("description", "Also return a small PNG of the screen (default false)."))))

    private fun callTool(id: Any, params: JSONObject): JSONObject {
        val args = params.optJSONObject("arguments") ?: JSONObject()
        return when (val name = params.optString("name")) {
            "set_avatar_state" -> setState(id, args)
            "get_avatar_state" -> getState(id, args)
            else -> error(id, -32602, "Unknown tool: $name")
        }
    }

    private fun setState(id: Any, args: JSONObject): JSONObject {
        val state = args.optString("state")
        // Unknown states are ignored, as voice.js does: still a success, just not applied.
        val applied = state in STATES
        val caption = if (args.has("caption") && !args.isNull("caption")) shorten(args.optString("caption")) else null
        val duration = if (args.has("duration_sec")) args.optDouble("duration_sec").takeIf { !it.isNaN() }
            ?.coerceIn(1.0, MAX_DURATION_SEC.toDouble()) else null
        Log.i(TAG, "set_avatar_state($state)${if (applied) "" else " ignored"}")
        if (applied) onState?.invoke(ExternalState(state, caption, duration))
        val outcome = JSONObject().put("ok", true).put("applied", applied)
            .put("viewer_connected", viewerConnected())
        return toolResult(id, outcome)
    }

    private fun getState(id: Any, args: JSONObject): JSONObject {
        Log.i(TAG, "get_avatar_state")
        val status = queryPage?.let { query ->
            val latch = java.util.concurrent.CountDownLatch(1)
            var reply: String? = null
            query("JSON.stringify(window.grokspot && grokspot.external.status())") { reply = it; latch.countDown() }
            latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
            // evaluateJavascript returns the JSON string as a JSON string literal.
            reply?.let { runCatching { JSONObject(JSONArray("[$it]").getString(0)) }.getOrNull() }
        } ?: JSONObject().put("state", JSONObject.NULL)
        status.put("viewer_connected", viewerConnected())
        val result = JSONObject()
        val content = JSONArray().put(JSONObject().put("type", "text").put("text", status.toString()))
        if (args.optBoolean("include_image")) {
            snapshot()?.let { png ->
                content.put(JSONObject().put("type", "image").put("mimeType", "image/png")
                    .put("data", android.util.Base64.encodeToString(png, android.util.Base64.NO_WRAP)))
            }
        }
        return result(id, result.put("content", content).put("structuredContent", status).put("isError", false))
    }

    private fun toolResult(id: Any, outcome: JSONObject) = result(id, JSONObject()
        .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", outcome.toString())))
        .put("structuredContent", outcome)
        .put("isError", false))

    /** Trims a caption to CAPTION_MAX characters (code points), dropping control characters. */
    private fun shorten(text: String): String {
        val clean = text.filter { !it.isISOControl() }.trim()
        val points = clean.codePointCount(0, clean.length)
        if (points <= CAPTION_MAX) return clean
        return clean.substring(0, clean.offsetByCodePoints(0, CAPTION_MAX - 1)) + "…"
    }

    private fun viewerConnected(): Boolean {
        val power = appContext.getSystemService(android.os.PowerManager::class.java)
        return power.isInteractive && pageVisible
    }

    /** A small PNG of the screen, or null. */
    private fun snapshot(): ByteArray? {
        val take = takeSnapshot ?: return null
        val latch = java.util.concurrent.CountDownLatch(1)
        var png: ByteArray? = null
        take { png = it; latch.countDown() }
        latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
        return png
    }

    private fun result(id: Any, result: JSONObject) =
        JSONObject().put("jsonrpc", "2.0").put("id", id).put("result", result)

    private fun error(id: Any?, code: Int, message: String) =
        JSONObject().put("jsonrpc", "2.0").put("id", id ?: JSONObject.NULL)
            .put("error", JSONObject().put("code", code).put("message", message))
}

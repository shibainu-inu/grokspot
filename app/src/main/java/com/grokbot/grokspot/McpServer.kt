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
 * - Optional auth: if files/mcp_token exists (scripts/set-mcp-token.ps1), every
 *   request needs "Authorization: Bearer <token>" or "?key=<token>" in the URL.
 * - Requests carrying an Origin header are refused: no browser should call this,
 *   and it blocks DNS rebinding from web pages on the same network.
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

    /** Shows a state on the page; set by MainActivity while it exists. Called on a worker thread. */
    @Volatile var onState: ((String) -> Unit)? = null

    private var server: ServerSocket? = null
    private lateinit var filesDir: File
    private var version = "0"
    private val workers = Executors.newCachedThreadPool()

    @Synchronized
    fun start(context: Context) {
        if (server != null) return
        filesDir = context.filesDir
        version = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
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
        Log.i(TAG, "MCP server on port $PORT (auth ${if (token() != null) "on" else "off"})")
    }

    private fun token(): String? =
        File(filesDir, TOKEN_FILE).takeIf { it.isFile }?.readText()?.trim()?.takeIf { it.isNotEmpty() }

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
        val reason = mapOf(200 to "OK", 202 to "Accepted", 204 to "No Content", 400 to "Bad Request",
            401 to "Unauthorized", 403 to "Forbidden", 404 to "Not Found", 405 to "Method Not Allowed",
            500 to "Internal Server Error")[status] ?: "OK"
        val head = StringBuilder("HTTP/1.1 $status $reason\r\n")
        if (type != null) head.append("Content-Type: $type\r\n")
        head.append("Content-Length: ${bytes.size}\r\nConnection: close\r\n")
        extra.forEach { (k, v) -> head.append("$k: $v\r\n") }
        if (status == 401) head.append("WWW-Authenticate: Bearer\r\n")
        head.append("\r\n")
        out.write(head.toString().toByteArray(Charsets.UTF_8))
        out.write(bytes)
        out.flush()
    }

    private fun handle(request: Request, out: OutputStream) {
        if (request.path == "/" && request.method == "GET") {
            respond(out, 200, "text/plain; charset=utf-8", "GrokSpot MCP server: POST /mcp\n")
            return
        }
        if (request.path != "/mcp") { respond(out, 404, "text/plain", "not found"); return }
        if (request.headers.containsKey("origin")) {
            Log.w(TAG, "Refused a request with Origin ${request.headers["origin"]}")
            respond(out, 403, "text/plain", "origin not allowed")
            return
        }
        val expected = token()
        if (expected != null) {
            val given = request.headers["authorization"]?.removePrefix("Bearer ")?.trim() ?: request.query["key"]
            if (given != expected) { respond(out, 401, "text/plain", "unauthorized"); return }
        }
        when (request.method) {
            "POST" -> handlePost(request, out)
            // No server-initiated stream: every reply goes back on its POST.
            "GET" -> respond(out, 405, "text/plain", "no event stream", mapOf("Allow" to "POST, DELETE"))
            "DELETE" -> respond(out, 204, null, "")
            else -> respond(out, 405, "text/plain", "method not allowed", mapOf("Allow" to "POST, DELETE"))
        }
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
            Log.d(TAG, "Notification $method")
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
                    .put("instructions", "GrokSpot shows your face on an Echo Spot. Call set_avatar_state " +
                        "whenever your expression should change with the conversation; it is not spoken."))
            }
            "ping" -> result(id, JSONObject())
            "tools/list" -> result(id, JSONObject().put("tools", JSONArray().put(toolDefinition())))
            "tools/call" -> callTool(id, params)
            else -> error(id, -32601, "Method not found: $method")
        }
    }

    private fun toolDefinition() = JSONObject()
        .put("name", "set_avatar_state")
        .put("description", "画面に表示されているアバターの表情・状態を変更する。音声には影響しない。" +
            " Changes the expression/state of the avatar shown on the screen. It does not affect speech.")
        .put("inputSchema", JSONObject()
            .put("type", "object")
            .put("properties", JSONObject().put("state", JSONObject()
                .put("type", "string")
                .put("description", "表示する状態名 / the state to show")
                .put("enum", JSONArray(STATES))))
            .put("required", JSONArray().put("state")))

    private fun callTool(id: Any, params: JSONObject): JSONObject {
        val name = params.optString("name")
        if (name != "set_avatar_state") return error(id, -32602, "Unknown tool: $name")
        val state = params.optJSONObject("arguments")?.optString("state").orEmpty()
        // Unknown states are ignored, as voice.js does: still a success, just not applied.
        val applied = state in STATES
        Log.i(TAG, "set_avatar_state($state)${if (applied) "" else " ignored"}")
        if (applied) onState?.invoke(state)
        val outcome = JSONObject().put("ok", true).put("applied", applied)
        return result(id, JSONObject()
            .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", outcome.toString())))
            .put("structuredContent", outcome)
            .put("isError", false))
    }

    private fun result(id: Any, result: JSONObject) =
        JSONObject().put("jsonrpc", "2.0").put("id", id).put("result", result)

    private fun error(id: Any?, code: Int, message: String) =
        JSONObject().put("jsonrpc", "2.0").put("id", id ?: JSONObject.NULL)
            .put("error", JSONObject().put("code", code).put("message", message))
}

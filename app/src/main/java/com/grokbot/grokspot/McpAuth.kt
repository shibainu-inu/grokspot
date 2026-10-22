package com.grokbot.grokspot

import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * OAuth 2.1 for the MCP server, so an MCP client (Grok's custom connector) can
 * connect with only the server URL: it discovers this authorization server,
 * registers itself, and sends the user to [authorize] to approve.
 *
 * Approval is a pairing code made on the spot: a request only shows "touch to
 * accept" on the Echo Spot; touching the screen makes six digits, which the person
 * types into the approval page. Only someone in front of the device can connect
 * a client, and there is no code to guess until they touch it. Registrations and
 * requests are rate limited.
 *
 * - Metadata: RFC 9728 (protected resource), RFC 8414 (authorization server)
 * - Clients: dynamic registration (RFC 7591), or an HTTPS client_id that is a
 *   client metadata document
 * - Authorization code with PKCE S256 only; public clients (no secret)
 * - Access tokens last ACCESS_TTL_MS, refresh tokens REFRESH_TTL_MS and rotate.
 *   Only SHA-256 hashes of tokens are stored (files/mcp_oauth.json).
 */
class McpAuth(private val filesDir: File, private val pairing: (PairingEvent) -> Unit) {

    /** What the screen should show about a pending approval. */
    sealed class PairingEvent {
        /** A client asks to connect: ask the person to touch the screen to accept (no code yet). */
        data class Request(val client: String, val expiresInMs: Long) : PairingEvent()
        /** The person touched the screen: show the code to type into the approval page. */
        data class Show(val code: String, val client: String, val expiresInMs: Long) : PairingEvent()
        data class Approved(val client: String) : PairingEvent()
        object Hide : PairingEvent()
    }

    private class Pending(
        val id: String, val clientId: String, val clientName: String, val redirectUri: String,
        val challenge: String, val state: String?, val scope: String?,
        /** Made only when the person touches the Echo Spot, so there is nothing to guess before. */
        var code: String?, var expires: Long, var attempts: Int = 0,
    )

    private class Grant(val clientId: String, val redirectUri: String, val challenge: String,
                        val scope: String?, val expires: Long)

    private val random = SecureRandom()
    private val registrations = mutableListOf<Long>()
    private val requests = mutableListOf<Long>()
    private val pending = LinkedHashMap<String, Pending>()
    private val grants = HashMap<String, Grant>()
    private val storeFile = File(filesDir, STORE_FILE)
    private val store: JSONObject = load()

    // -------------------------------------------------------------- metadata

    /** `path` is the MCP endpoint the client uses (/mcp, or a variant such as /mcp/v3). */
    fun resourceMetadata(base: String, path: String = "/mcp") = JSONObject()
        .put("resource", "$base$path")
        .put("authorization_servers", JSONArray().put(base))
        .put("bearer_methods_supported", JSONArray().put("header"))
        .put("scopes_supported", JSONArray().put(SCOPE))
        .put("resource_name", "GrokSpot")

    fun serverMetadata(base: String) = JSONObject()
        .put("issuer", base)
        .put("authorization_endpoint", "$base/authorize")
        .put("token_endpoint", "$base/token")
        .put("registration_endpoint", "$base/register")
        .put("response_types_supported", JSONArray().put("code"))
        .put("grant_types_supported", JSONArray().put("authorization_code").put("refresh_token"))
        .put("code_challenge_methods_supported", JSONArray().put("S256"))
        .put("token_endpoint_auth_methods_supported", JSONArray().put("none"))
        .put("scopes_supported", JSONArray().put(SCOPE))
        .put("client_id_metadata_document_supported", true)

    // ---------------------------------------------------------- registration

    /**
     * Dynamic client registration. Returns the response JSON, or an OAuth error.
     * Anyone who knows the URL can register, so registrations are rate limited, and a
     * client that never gets approved is forgotten after UNAPPROVED_TTL_MS. Approved
     * clients are never pushed out by new ones.
     */
    @Synchronized
    fun register(body: JSONObject): Pair<Int, JSONObject> {
        val now = System.currentTimeMillis()
        registrations.removeAll { now - it > REGISTER_WINDOW_MS }
        if (registrations.size >= MAX_REGISTRATIONS) {
            Log.w(TAG, "Too many client registrations")
            return 429 to oauthError("temporarily_unavailable", "too many registrations, try again later")
        }
        val uris = body.optJSONArray("redirect_uris")
            ?: return 400 to oauthError("invalid_redirect_uri", "redirect_uris is required")
        val list = (0 until uris.length()).map { uris.getString(it) }
        if (list.isEmpty() || !list.all(::allowedRedirect)) {
            return 400 to oauthError("invalid_redirect_uri", "redirect URIs must be https (or http on localhost)")
        }
        val name = body.optString("client_name").take(80).ifEmpty { "MCP client" }
        val id = "gs_" + randomToken(18)
        val clients = store.getJSONObject("clients")
        pruneClients(clients)
        if (unapprovedCount(clients) >= MAX_UNAPPROVED) {
            return 429 to oauthError("temporarily_unavailable", "too many pending clients, try again later")
        }
        registrations += now
        clients.put(id, JSONObject().put("redirect_uris", JSONArray(list)).put("name", name)
            .put("created", now).put("approved", false))
        save()
        Log.i(TAG, "Registered OAuth client \"$name\"")
        return 201 to JSONObject()
            .put("client_id", id)
            .put("client_id_issued_at", System.currentTimeMillis() / 1000)
            .put("client_name", name)
            .put("redirect_uris", JSONArray(list))
            .put("grant_types", JSONArray().put("authorization_code").put("refresh_token"))
            .put("response_types", JSONArray().put("code"))
            .put("token_endpoint_auth_method", "none")
    }

    /** Forgets clients that were registered but never approved within UNAPPROVED_TTL_MS. */
    private fun pruneClients(clients: JSONObject) {
        val now = System.currentTimeMillis()
        clients.keys().asSequence().toList().forEach { id ->
            val c = clients.getJSONObject(id)
            // Clients stored before "approved" existed were approved (they have tokens).
            if (c.has("approved") && !c.optBoolean("approved") && now - c.optLong("created") > UNAPPROVED_TTL_MS) {
                clients.remove(id)
            }
        }
    }

    private fun unapprovedCount(clients: JSONObject) =
        clients.keys().asSequence().count { clients.getJSONObject(it).let { c -> c.has("approved") && !c.optBoolean("approved") } }

    /** Marks a client approved once it gets its first tokens. */
    private fun markApproved(clientId: String) {
        val c = store.getJSONObject("clients").optJSONObject(clientId) ?: return
        c.put("approved", true)
    }

    /** The redirect URIs and name of a client: registered here, or a metadata document URL. */
    private fun client(clientId: String): Pair<List<String>, String>? {
        synchronized(this) {
            store.getJSONObject("clients").optJSONObject(clientId)?.let { c ->
                val uris = c.getJSONArray("redirect_uris")
                return (0 until uris.length()).map { uris.getString(it) } to c.optString("name")
            }
        }
        if (!clientId.startsWith("https://")) return null
        return try {
            val doc = fetchJson(clientId)
            if (doc.optString("client_id") != clientId) return null
            val uris = doc.optJSONArray("redirect_uris") ?: return null
            val list = (0 until uris.length()).map { uris.getString(it) }.filter(::allowedRedirect)
            list to doc.optString("client_name").take(80).ifEmpty { URL(clientId).host }
        } catch (e: Exception) {
            Log.w(TAG, "Client metadata document failed: ${e.message}")
            null
        }
    }

    private fun fetchJson(url: String): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Accept", "application/json")
        connection.inputStream.use { input ->
            val bytes = input.readNBytesCompat(64 * 1024)
            return JSONObject(String(bytes, Charsets.UTF_8))
        }
    }

    private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (out.size() < limit) {
            val n = read(buffer, 0, minOf(buffer.size, limit - out.size()))
            if (n < 0) break
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }

    private fun allowedRedirect(uri: String): Boolean = try {
        val url = URL(uri)
        url.protocol == "https" || (url.protocol == "http" && url.host in setOf("localhost", "127.0.0.1"))
    } catch (_: Exception) {
        false
    }

    // --------------------------------------------------------- authorization

    sealed class AuthorizeResult {
        /** Show the approval page for this pending request. */
        data class Page(val id: String, val clientName: String, val redirectOrigin: String) : AuthorizeResult()
        /** Redirect the browser (success, or an error the client should see). */
        data class Redirect(val location: String) : AuthorizeResult()
        /** A problem the browser should see (the client cannot be trusted with a redirect). */
        data class Fail(val message: String) : AuthorizeResult()
        /** Too many requests lately; try again later. */
        object Busy : AuthorizeResult()
    }

    /** GET /authorize: checks the request and starts a pairing. */
    fun startAuthorization(query: Map<String, String>): AuthorizeResult {
        val clientId = query["client_id"] ?: return AuthorizeResult.Fail("client_id is missing")
        val (uris, name) = client(clientId) ?: return AuthorizeResult.Fail("unknown client")
        val redirect = query["redirect_uri"] ?: uris.singleOrNull() ?: return AuthorizeResult.Fail("redirect_uri is missing")
        if (redirect !in uris) return AuthorizeResult.Fail("redirect_uri is not registered for this client")
        val state = query["state"]
        if (query["response_type"] != "code") return AuthorizeResult.Redirect(errorRedirect(redirect, "unsupported_response_type", state))
        val challenge = query["code_challenge"]
        if (challenge.isNullOrEmpty() || query["code_challenge_method"] != "S256") {
            return AuthorizeResult.Redirect(errorRedirect(redirect, "invalid_request", state, "PKCE S256 is required"))
        }
        val now = System.currentTimeMillis()
        val request = Pending(randomToken(16), clientId, name, redirect, challenge, state, query["scope"],
            null, now + PAIRING_TTL_MS)
        synchronized(this) {
            requests.removeAll { now - it > REQUEST_WINDOW_MS }
            if (requests.size >= MAX_REQUESTS) {
                Log.w(TAG, "Too many connection requests")
                return AuthorizeResult.Busy
            }
            requests += now
            // Only the newest request is shown on the screen.
            pending.clear()
            pending[request.id] = request
        }
        Log.i(TAG, "Connection request from \"$name\"")
        pairing(PairingEvent.Request(name, PAIRING_TTL_MS))
        return AuthorizeResult.Page(request.id, name, URL(redirect).let { "${it.protocol}://${it.authority}" })
    }

    /**
     * The person touched the Echo Spot's screen: if a connection request is waiting,
     * make its code now and show it. Returns true if a code was made.
     */
    fun accept(): Boolean {
        val now = System.currentTimeMillis()
        val request = synchronized(this) {
            pending.values.lastOrNull()?.takeIf { it.code == null && it.expires > now }?.also {
                it.code = (0 until 6).map { random.nextInt(10) }.joinToString("")
                it.expires = now + PAIRING_TTL_MS
            }
        } ?: return false
        Log.i(TAG, "Pairing accepted on the screen for \"${request.clientName}\"")
        pairing(PairingEvent.Show(request.code!!, request.clientName, PAIRING_TTL_MS))
        return true
    }

    sealed class ApproveResult {
        data class Redirect(val location: String) : ApproveResult()
        /** Wrong code (attemptsLeft), or the screen was not touched yet (notAccepted). */
        data class Retry(val id: String, val clientName: String, val redirectOrigin: String, val attemptsLeft: Int,
                         val notAccepted: Boolean = false) : ApproveResult()
        object Expired : ApproveResult()
    }

    /** POST /authorize: the person typed the code shown on the screen (or denied). */
    fun approve(id: String, typed: String, deny: Boolean): ApproveResult {
        val request = synchronized(this) { pending[id] } ?: return ApproveResult.Expired
        if (request.expires < System.currentTimeMillis()) {
            finishPairing(request)
            return ApproveResult.Expired
        }
        if (deny) {
            finishPairing(request)
            return ApproveResult.Redirect(errorRedirect(request.redirectUri, "access_denied", request.state))
        }
        val code = request.code
            ?: return ApproveResult.Retry(id, request.clientName, URL(request.redirectUri).let { "${it.protocol}://${it.authority}" },
                MAX_ATTEMPTS - request.attempts, notAccepted = true)
        val digits = typed.filter(Char::isDigit)
        if (!MessageDigest.isEqual(digits.toByteArray(), code.toByteArray())) {
            request.attempts += 1
            val left = MAX_ATTEMPTS - request.attempts
            if (left <= 0) {
                finishPairing(request)
                return ApproveResult.Redirect(errorRedirect(request.redirectUri, "access_denied", request.state, "too many wrong codes"))
            }
            return ApproveResult.Retry(id, request.clientName, URL(request.redirectUri).let { "${it.protocol}://${it.authority}" }, left)
        }
        finishPairing(request)
        val grant = randomToken(24)
        synchronized(this) {
            grants.values.removeAll { it.expires < System.currentTimeMillis() }
            grants[grant] = Grant(request.clientId, request.redirectUri, request.challenge, request.scope,
                System.currentTimeMillis() + CODE_TTL_MS)
        }
        Log.i(TAG, "Pairing approved for \"${request.clientName}\"")
        pairing(PairingEvent.Approved(request.clientName))
        val sep = if ('?' in request.redirectUri) '&' else '?'
        return ApproveResult.Redirect(request.redirectUri + sep + "code=" + enc(grant) +
            (request.state?.let { "&state=" + enc(it) } ?: ""))
    }

    private fun finishPairing(request: Pending) {
        synchronized(this) { pending.remove(request.id) }
        pairing(PairingEvent.Hide)
    }

    // ----------------------------------------------------------------- token

    /** POST /token. Returns status and JSON body. */
    fun token(form: Map<String, String>, basicClientId: String?): Pair<Int, JSONObject> {
        val clientId = form["client_id"] ?: basicClientId ?: return 401 to oauthError("invalid_client", "client_id is required")
        return when (form["grant_type"]) {
            "authorization_code" -> {
                val code = form["code"] ?: return 400 to oauthError("invalid_request", "code is required")
                val grant = synchronized(this) { grants.remove(code) }
                    ?: return 400 to oauthError("invalid_grant", "unknown or used code")
                if (grant.expires < System.currentTimeMillis()) return 400 to oauthError("invalid_grant", "code expired")
                if (grant.clientId != clientId) return 400 to oauthError("invalid_grant", "code was issued to another client")
                form["redirect_uri"]?.let { if (it != grant.redirectUri) return 400 to oauthError("invalid_grant", "redirect_uri mismatch") }
                val verifier = form["code_verifier"] ?: return 400 to oauthError("invalid_request", "code_verifier is required")
                if (!MessageDigest.isEqual(s256(verifier).toByteArray(), grant.challenge.toByteArray())) {
                    return 400 to oauthError("invalid_grant", "PKCE verification failed")
                }
                200 to issueTokens(clientId, grant.scope)
            }
            "refresh_token" -> {
                val refresh = form["refresh_token"] ?: return 400 to oauthError("invalid_request", "refresh_token is required")
                val entry = takeToken(refresh, "refresh") ?: return 400 to oauthError("invalid_grant", "unknown refresh token")
                if (entry.optString("client") != clientId) return 400 to oauthError("invalid_grant", "refresh token was issued to another client")
                200 to issueTokens(clientId, entry.optString("scope").ifEmpty { null })
            }
            else -> 400 to oauthError("unsupported_grant_type", "use authorization_code or refresh_token")
        }
    }

    @Synchronized
    private fun issueTokens(clientId: String, scope: String?): JSONObject {
        val access = randomToken(32)
        val refresh = randomToken(32)
        val now = System.currentTimeMillis()
        markApproved(clientId)
        val tokens = store.getJSONArray("tokens")
        tokens.put(tokenEntry(access, "access", clientId, scope, now + ACCESS_TTL_MS))
        tokens.put(tokenEntry(refresh, "refresh", clientId, scope, now + REFRESH_TTL_MS))
        pruneTokens()
        save()
        return JSONObject()
            .put("access_token", access)
            .put("token_type", "Bearer")
            .put("expires_in", ACCESS_TTL_MS / 1000)
            .put("refresh_token", refresh)
            .put("scope", scope ?: SCOPE)
    }

    private fun tokenEntry(token: String, type: String, client: String, scope: String?, expires: Long) = JSONObject()
        .put("hash", sha256Hex(token)).put("type", type).put("client", client)
        .put("scope", scope ?: SCOPE).put("expires", expires)

    /** Removes and returns a refresh token's entry (refresh tokens rotate). */
    @Synchronized
    private fun takeToken(token: String, type: String): JSONObject? {
        val hash = sha256Hex(token)
        val tokens = store.getJSONArray("tokens")
        for (i in 0 until tokens.length()) {
            val entry = tokens.getJSONObject(i)
            if (entry.optString("hash") == hash && entry.optString("type") == type) {
                tokens.remove(i)
                save()
                return if (entry.optLong("expires") > System.currentTimeMillis()) entry else null
            }
        }
        return null
    }

    /** True if `token` is a live access token issued here. */
    @Synchronized
    fun isValidAccessToken(token: String): Boolean {
        val hash = sha256Hex(token)
        val tokens = store.getJSONArray("tokens")
        val now = System.currentTimeMillis()
        for (i in 0 until tokens.length()) {
            val entry = tokens.getJSONObject(i)
            if (entry.optString("type") == "access" && entry.optString("hash") == hash) return entry.optLong("expires") > now
        }
        return false
    }

    private fun pruneTokens() {
        val tokens = store.getJSONArray("tokens")
        val now = System.currentTimeMillis()
        val kept = JSONArray()
        for (i in 0 until tokens.length()) {
            val entry = tokens.getJSONObject(i)
            if (entry.optLong("expires") > now) kept.put(entry)
        }
        // Keep the newest entries if a client keeps asking.
        val start = maxOf(0, kept.length() - MAX_TOKENS)
        val trimmed = JSONArray()
        for (i in start until kept.length()) trimmed.put(kept.get(i))
        store.put("tokens", trimmed)
    }

    // --------------------------------------------------------------- helpers

    private fun load(): JSONObject = try {
        JSONObject(storeFile.readText())
    } catch (_: Exception) {
        JSONObject()
    }.apply {
        if (!has("clients")) put("clients", JSONObject())
        if (!has("tokens")) put("tokens", JSONArray())
    }

    @Synchronized
    private fun save() {
        val tmp = File(filesDir, "$STORE_FILE.tmp")
        tmp.writeText(store.toString())
        tmp.renameTo(storeFile)
    }

    private fun randomToken(bytes: Int): String {
        val b = ByteArray(bytes)
        random.nextBytes(b)
        return Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    private fun s256(verifier: String): String = Base64.encodeToString(
        MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),
        Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    private fun sha256Hex(text: String) =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun enc(text: String) = java.net.URLEncoder.encode(text, "UTF-8")

    private fun errorRedirect(redirect: String, error: String, state: String?, description: String? = null): String {
        val sep = if ('?' in redirect) '&' else '?'
        return redirect + sep + "error=" + enc(error) +
            (description?.let { "&error_description=" + enc(it) } ?: "") +
            (state?.let { "&state=" + enc(it) } ?: "")
    }

    private fun oauthError(error: String, description: String) =
        JSONObject().put("error", error).put("error_description", description)

    companion object {
        private const val TAG = "GrokMcp"
        const val SCOPE = "avatar"
        private const val STORE_FILE = "mcp_oauth.json"
        private const val PAIRING_TTL_MS = 5 * 60 * 1000L
        private const val CODE_TTL_MS = 60 * 1000L
        private const val ACCESS_TTL_MS = 24 * 60 * 60 * 1000L
        private const val REFRESH_TTL_MS = 180L * 24 * 60 * 60 * 1000L
        private const val MAX_ATTEMPTS = 5
        // Rate limits for what anyone with the URL can do.
        private const val MAX_REGISTRATIONS = 5
        private const val REGISTER_WINDOW_MS = 10 * 60 * 1000L
        private const val MAX_UNAPPROVED = 10
        private const val UNAPPROVED_TTL_MS = 60 * 60 * 1000L
        private const val MAX_REQUESTS = 5
        private const val REQUEST_WINDOW_MS = 10 * 60 * 1000L
        private const val MAX_TOKENS = 200
    }
}

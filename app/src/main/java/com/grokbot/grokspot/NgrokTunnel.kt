package com.grokbot.grokspot

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Log
import com.ngrok.AndroidRuntime
import com.ngrok.Forwarder
import com.ngrok.Session
import java.io.File
import java.net.URL
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Opens an ngrok tunnel to the MCP server from the device itself, so an agent on
 * the internet can reach it without a PC in between.
 *
 * Off until files/ngrok_authtoken exists (scripts/set-ngrok.ps1). files/ngrok_domain
 * picks the endpoint's domain, e.g. a free static domain; without it ngrok gives a
 * random one. Requests arrive with X-Forwarded-For, so McpServer treats them as
 * coming through a tunnel: only OAuth gets in.
 *
 * The ngrok session reconnects by itself after a network drop, but by then its
 * backoff has grown and it can take minutes. So when the network is back (validated
 * again after a loss) the session is replaced at once.
 */
object NgrokTunnel {

    private const val TAG = "GrokNgrok"
    private const val TOKEN_FILE = "ngrok_authtoken"
    private const val DOMAIN_FILE = "ngrok_domain"
    private const val RETRY_MS = 30_000L

    private var thread: Thread? = null
    @Volatile private var session: Session? = null
    @Volatile private var forwarder: Forwarder.Endpoint? = null
    /** Wakes the tunnel thread: the network came back. */
    private val networkBack = LinkedBlockingQueue<Unit>()

    /** The public URL once the tunnel is up. */
    val url: String? get() = forwarder?.url

    @Synchronized
    fun start(context: Context) {
        if (thread != null) return
        val files = context.filesDir
        val version = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
        thread = Thread({
            while (true) {
                if (forwarder == null) {
                    try {
                        // Read each time, so a token written later is picked up without restarting the app.
                        val token = read(File(files, TOKEN_FILE))
                        if (token != null) connect(token, read(File(files, DOMAIN_FILE)), version)
                    } catch (e: Throwable) {
                        Log.w(TAG, "Tunnel failed, retrying in ${RETRY_MS / 1000} s: ${e.message}")
                        close()
                    }
                }
                try {
                    if (networkBack.poll(RETRY_MS, TimeUnit.MILLISECONDS) != null && forwarder != null) {
                        Log.i(TAG, "Network back, reconnecting")
                        close()
                    }
                } catch (_: InterruptedException) {
                    return@Thread
                }
            }
        }, "GrokSpot-ngrok").apply { isDaemon = true; start() }
        watchNetwork(context)
    }

    private fun watchNetwork(context: Context) {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            private var lost = false

            override fun onLost(network: Network) {
                lost = true
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                if (lost && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                    lost = false
                    networkBack.offer(Unit)
                }
            }
        })
    }

    private fun close() {
        runCatching { session?.close() }
        session = null
        forwarder = null
    }

    private fun connect(token: String, domain: String?, version: String) {
        // ngrok-java looks for its library inside the jar, which Android leaves out; the build
        // puts it in lib/ instead (app/build.gradle.kts), and this loads it from there.
        AndroidRuntime.start()
        val opened = Session.withAuthtoken(token)
            .addClientInfo("grokspot", version)
            .connect()
        session = opened
        val endpoint = opened.httpEndpoint()
        if (domain != null) endpoint.domain(domain)
        forwarder = endpoint.forward(URL("http://127.0.0.1:${McpServer.PORT}"))
        Log.i(TAG, "Tunnel up: ${forwarder?.url}")
    }

    private fun read(file: File): String? =
        file.takeIf { it.isFile }?.readText()?.trim()?.removePrefix("﻿")?.takeIf { it.isNotEmpty() }
}

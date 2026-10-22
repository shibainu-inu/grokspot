# GrokSpot の MCP サーバーを PC から呼んで、動作を確かめる（簡易 MCP クライアント）。
# 使い方:
#   powershell -File scripts\mcp-call.ps1 curious                 # adb の転送で、つないだ Echo Spot に送る
#   powershell -File scripts\mcp-call.ps1 happy -Url http://10.0.0.5:8765/mcp   # LAN 内の IP に送る
#   powershell -File scripts\mcp-call.ps1 -List                   # ツールの一覧を見る
# トークンを設定してあるときは -Token <トークン> を付ける。
param(
    [Parameter(Position = 0)][string]$State,
    [string]$Url,
    [string]$Token,
    [switch]$List,
    [string]$Serial
)
$ErrorActionPreference = 'Stop'

if (-not $Url) {
    # USB でつないだ端末のポート 8765 を、PC の 8765 に転送する。
    $target = if ($Serial) { @('-s', $Serial) } else { @() }
    adb @target forward tcp:8765 tcp:8765 | Out-Null
    $Url = 'http://127.0.0.1:8765/mcp'
}
$headers = @{ Accept = 'application/json, text/event-stream' }
if ($Token) { $headers.Authorization = "Bearer $Token" }

function Invoke-Mcp($method, $params, $id) {
    $message = @{ jsonrpc = '2.0'; method = $method }
    if ($null -ne $params) { $message.params = $params }
    if ($null -ne $id) { $message.id = $id }
    $body = [Text.Encoding]::UTF8.GetBytes(($message | ConvertTo-Json -Depth 10 -Compress))
    Invoke-RestMethod -Method Post -Uri $Url -Headers $headers -ContentType 'application/json' -Body $body
}

$init = Invoke-Mcp 'initialize' @{
    protocolVersion = '2025-06-18'
    capabilities = @{}
    clientInfo = @{ name = 'grokspot-mcp-call'; version = '1' }
} 1
Write-Host "接続: $($init.result.serverInfo.name) $($init.result.serverInfo.version) (MCP $($init.result.protocolVersion))"
Invoke-Mcp 'notifications/initialized' $null $null | Out-Null

if ($List -or -not $State) {
    $tools = Invoke-Mcp 'tools/list' @{} 2
    $tools.result.tools | ForEach-Object { Write-Host "- $($_.name): $($_.description)"; Write-Host "  state: $($_.inputSchema.properties.state.enum -join ', ')" }
    exit 0
}

$reply = Invoke-Mcp 'tools/call' @{ name = 'set_avatar_state'; arguments = @{ state = $State } } 3
Write-Host "set_avatar_state($State) -> $($reply.result.content[0].text)"

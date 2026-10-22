# GrokSpot の MCP サーバーに認証トークンを設定する（インターネットに公開する前に必須）。
# トークンを作って端末のアプリ専用領域に書き込み、GrokBot 側に登録する接続先 URL を表示する。
# 使い方:   powershell -File scripts\set-mcp-token.ps1
# 解除:     powershell -File scripts\set-mcp-token.ps1 -Remove   （LAN 内だけで使うとき）
# 端末を複数つないでいるときは -Serial <adb のシリアル> で選ぶ。
param(
    [string]$Serial,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$package = 'com.grokbot.grokspot'
$target = if ($Serial) { @('-s', $Serial) } else { @() }

if ($Remove) {
    adb @target shell "run-as $package rm -f files/mcp_token"
    Write-Host 'MCP のトークンを削除しました（認証なしに戻りました）。'
    exit 0
}

# 32 バイトの乱数を URL に入れても安全な文字だけで表す。
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$token | adb @target shell "run-as $package sh -c 'mkdir -p files && cat > files/mcp_token && chmod 600 files/mcp_token'"
Write-Host 'MCP のトークンを書き込みました。すぐに有効になります。'
Write-Host ''
Write-Host 'GrokBot などに登録するときは、次のどちらかを使ってください（このトークンは再表示できません）:'
Write-Host "  ヘッダー:  Authorization: Bearer $token"
Write-Host "  URL:       https://<トンネルのホスト名>/mcp?key=$token"

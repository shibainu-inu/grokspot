# GrokSpot の MCP サーバーの認証を管理する。
# 端末は最初の起動時に自分でトークンを作るので、普段は何もしなくてよい
# （Grok などの MCP クライアントは OAuth でつながり、画面に触れて出るコードで許可する）。
# このトークンは USB や同じ LAN からの動作確認用で、トンネル（インターネット）経由では使えない。
# 使い方:
#   powershell -File scripts\set-mcp-token.ps1 -Show     # 今のトークンを表示する
#   powershell -File scripts\set-mcp-token.ps1           # トークンを作り直す（古いトークンは使えなくなる）
#   powershell -File scripts\set-mcp-token.ps1 -RevokeOAuth  # OAuth で許可したクライアントをすべて取り消す
# 表示されたトークンは他人に見せないこと（画面共有や会話に貼らない）。
# 端末を複数つないでいるときは -Serial <adb のシリアル> で選ぶ。
param(
    [string]$Serial,
    [switch]$Show,
    [switch]$RevokeOAuth
)
$ErrorActionPreference = 'Stop'
$package = 'com.grokbot.grokspot'
$target = if ($Serial) { @('-s', $Serial) } else { @() }

function Restart-App {
    adb @target shell "am force-stop $package; am start -n $package/.MainActivity" | Out-Null
}

if ($RevokeOAuth) {
    adb @target shell "run-as $package rm -f files/mcp_oauth.json"
    Restart-App
    Write-Host 'OAuth で許可したクライアントをすべて取り消しました。つなぎ直すときは、もう一度画面のコードで許可してください。'
    exit 0
}

if ($Show) {
    $token = (adb @target shell "run-as $package cat files/mcp_token").Trim()
} else {
    # 32 バイトの乱数を URL に入れても安全な文字だけで表す。
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $token | adb @target shell "run-as $package sh -c 'mkdir -p files && cat > files/mcp_token && chmod 600 files/mcp_token'"
    Write-Host 'MCP のトークンを作り直しました。すぐに有効になります。'
}
Write-Host ''
Write-Host 'USB や同じ LAN から MCP サーバーを呼ぶときは、次のヘッダーを付けてください（トンネル経由では使えません）:'
Write-Host "  Authorization: Bearer $token"

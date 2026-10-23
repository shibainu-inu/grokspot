# Grok Voice（ボタンで話す会話）の声を選ぶ。既定は eve。
# 使い方:
#   powershell -File scripts\set-voice.ps1 iris      # 声を iris にする（xAI の声の名前か、カスタムボイスの ID）
#   powershell -File scripts\set-voice.ps1 -Reset    # 既定の eve に戻す
#   powershell -File scripts\set-voice.ps1           # 今の設定を表示
# 次に会話を始めたときから効く。使える声は xAI のドキュメントで確かめる。
# 端末を複数つないでいるときは -Serial <adb のシリアル> で選ぶ。
param(
    [Parameter(Position = 0)][string]$Voice,
    [string]$Serial,
    [switch]$Reset
)
$ErrorActionPreference = 'Stop'
$package = 'com.grokbot.grokspot'
$target = if ($Serial) { @('-s', $Serial) } else { @() }

if ($Reset) {
    adb @target shell "run-as $package rm -f files/voice_name"
} elseif ($Voice) {
    if ($Voice -notmatch '^[A-Za-z0-9_-]+$') {
        Write-Host '声の名前は英数字と - _ だけで指定してください（例: iris）。'
        exit 1
    }
    $Voice.ToLowerInvariant() | adb @target shell "run-as $package sh -c 'mkdir -p files && cat > files/voice_name'"
}

$now = ((adb @target shell "run-as $package sh -c 'cat files/voice_name 2>/dev/null'") -join '').Trim()
if (-not $now) { Write-Host 'Grok Voice の声: eve（既定）' }
else { Write-Host "Grok Voice の声: $now（次の会話から）" }

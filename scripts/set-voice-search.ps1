# Grok Voice（ボタンで話す会話）の検索をオン・オフする。既定はオフ（検索には別料金がかかる）。
# 使い方:
#   powershell -File scripts\set-voice-search.ps1 -Web        # Web 検索だけオン
#   powershell -File scripts\set-voice-search.ps1 -Web -X     # Web 検索と X 検索をオン
#   powershell -File scripts\set-voice-search.ps1 -Off        # 検索をオフ
#   powershell -File scripts\set-voice-search.ps1             # 今の設定を表示
# 次に会話を始めたときから効く。料金は README の「Grok Voice の料金」を参照。
# 端末を複数つないでいるときは -Serial <adb のシリアル> で選ぶ。
param(
    [string]$Serial,
    [switch]$Web,
    [switch]$X,
    [switch]$Off
)
$ErrorActionPreference = 'Stop'
$package = 'com.grokbot.grokspot'
$target = if ($Serial) { @('-s', $Serial) } else { @() }

if ($Off) {
    adb @target shell "run-as $package rm -f files/voice_search"
} elseif ($Web -or $X) {
    $tools = @()
    if ($Web) { $tools += 'web' }
    if ($X) { $tools += 'x' }
    ($tools -join ',') | adb @target shell "run-as $package sh -c 'mkdir -p files && cat > files/voice_search'"
}

$now = (adb @target shell "run-as $package sh -c 'cat files/voice_search 2>/dev/null'") -join ''
$now = $now.Trim()
$label = @()
if ($now -match 'web') { $label += 'Web 検索' }
if ($now -match '(^|,)x') { $label += 'X 検索' }
if ($label.Count -eq 0) { Write-Host 'Grok Voice の検索: オフ' }
else { Write-Host ('Grok Voice の検索: ' + ($label -join ' と ') + ' がオン（次の会話から）') }

# xAI API キーを Echo Spot の GrokSpot アプリ専用領域に書き込む。
# キーはクリップボードから読み、画面にもファイルにも残さない（APK と git にも入らない）。
# 使い方: キーをコピーしてから  powershell -File scripts\set-api-key.ps1
# 端末から消すとき:              powershell -File scripts\set-api-key.ps1 -Remove
# 端末を複数つないでいるときは -Serial <adb のシリアル> で選ぶ。
param(
    [string]$Serial,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$package = 'com.grokbot.grokspot'
$target = if ($Serial) { @('-s', $Serial) } else { @() }

if ($Remove) {
    adb @target shell "run-as $package rm -f files/xai_api_key"
    Write-Host 'API キーを端末から削除しました。'
    exit 0
}

$key = (Get-Clipboard -Raw)
if ($key) { $key = $key.Trim() }
if (-not $key -or $key -notmatch '^xai-[A-Za-z0-9]{20,}$') {
    Write-Host 'クリップボードに xAI の API キー（xai- で始まる文字列）がありません。コピーしてからもう一度実行してください。'
    exit 1
}

# 標準入力で渡すので、キーはコマンドラインにも出ない。
$key | adb @target shell "run-as $package sh -c 'mkdir -p files && cat > files/xai_api_key && chmod 600 files/xai_api_key'"
$length = (adb @target shell "run-as $package sh -c 'tr -d ""\r\n"" < files/xai_api_key | wc -c'").Trim()
Set-Clipboard -Value ' '
Write-Host "API キーを書き込みました（$length 文字）。クリップボードは空にしました。"

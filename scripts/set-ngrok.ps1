# ngrok の authtoken とドメインを Echo Spot の GrokSpot アプリ専用領域に書き込む。
# 書き込むと、アプリが自分で ngrok のトンネルを開き、PC なしで MCP サーバーに外から届くようになる。
# authtoken はクリップボードから読み、画面にもファイルにも残さない（APK と git にも入らない）。
# 使い方: authtoken をコピーしてから  powershell -File scripts\set-ngrok.ps1 -Domain example.ngrok-free.app
# 端末から消すとき:                    powershell -File scripts\set-ngrok.ps1 -Remove
# アプリは 30 秒ごとに見ているので、再起動しなくても書き込んでしばらくするとつながる。
# 書き換えたときは、アプリを次に起動したときから反映される。
# 無料プランは同時に1つしかつながらないので、PC で同じ authtoken の ngrok を動かしているなら止めておく。
param(
    [string]$Domain,
    [string]$Serial,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$package = 'com.grokbot.grokspot'
$target = if ($Serial) { @('-s', $Serial) } else { @() }

if ($Remove) {
    adb @target shell "run-as $package rm -f files/ngrok_authtoken files/ngrok_domain"
    Write-Host 'ngrok の設定を端末から削除しました。'
    exit 0
}

$token = (Get-Clipboard -Raw)
if ($token) { $token = $token.Trim() }
if (-not $token -or $token -notmatch '^[A-Za-z0-9_]{30,}$') {
    Write-Host 'クリップボードに ngrok の authtoken がありません。ngrok のダッシュボードでコピーしてからもう一度実行してください。'
    exit 1
}

# 標準入力で渡すので、authtoken はコマンドラインにも出ない。
$token | adb @target shell "run-as $package sh -c 'mkdir -p files && cat > files/ngrok_authtoken && chmod 600 files/ngrok_authtoken'"
Set-Clipboard -Value ' '
if ($Domain) {
    $Domain = $Domain.Trim() -replace '^https?://', '' -replace '/.*$', ''
    adb @target shell "run-as $package sh -c 'echo $Domain > files/ngrok_domain'"
    Write-Host "authtoken とドメイン（$Domain）を書き込みました。クリップボードは空にしました。"
} else {
    adb @target shell "run-as $package rm -f files/ngrok_domain"
    Write-Host 'authtoken を書き込みました（ドメインは ngrok が毎回決めます）。クリップボードは空にしました。'
}

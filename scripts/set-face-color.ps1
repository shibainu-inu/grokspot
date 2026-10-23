# 顔・目・背景の色を変える。既定は白い顔・黒い目・黒い背景（黒い Echo Spot に合う色）。
# 使い方:
#   powershell -File scripts\set-face-color.ps1 pink                          # 顔をピンク（#ff309c）に
#   powershell -File scripts\set-face-color.ps1 pink -Eye white -Background white   # 白い Echo Spot 向け
#   powershell -File scripts\set-face-color.ps1 '#cfe8ff'                     # 好きな色を 16 進数で
#   powershell -File scripts\set-face-color.ps1 -Reset                        # 既定に戻す
#   powershell -File scripts\set-face-color.ps1                               # 今の設定を表示
# 色の名前: pink #ff309c（GrokBot のピンク）、softpink #ffd1dc、white（顔と目は #ffffff、背景は #f4f5f7）、black。
# 指定しなかったものは既定のまま。陰影は顔に自動で付く。
# 反映はアプリが次に起動したとき（端末の再起動など）から。
# 端末を複数つないでいるときは -Serial <adb のシリアル> で選ぶ。
param(
    [Parameter(Position = 0)][string]$Color,
    [string]$Eye,
    [string]$Background,
    [string]$Serial,
    [switch]$Reset
)
$ErrorActionPreference = 'Stop'
$package = 'com.grokbot.grokspot'
$target = if ($Serial) { @('-s', $Serial) } else { @() }
$named = @{ pink = 'ff309c'; softpink = 'ffd1dc'; white = 'ffffff'; black = '0c0c0c' }

function ToHex([string]$value, [string]$whiteAs = 'ffffff') {
    $key = $value.ToLowerInvariant()
    if ($key -eq 'white') { return $whiteAs }
    $hex = if ($named.ContainsKey($key)) { $named[$key] } else { $value.TrimStart('#') }
    if ($hex -notmatch '^[0-9A-Fa-f]{6}$') {
        Write-Host "色「$value」が分かりません。pink / softpink / white / black か、#ffd1dc のような 16 進数 6 桁で指定してください。"
        exit 1
    }
    return $hex.ToLowerInvariant()
}

if ($Reset) {
    adb @target shell "run-as $package rm -f files/face_color"
} elseif ($Color -or $Eye -or $Background) {
    $lines = @()
    if ($Color) { $lines += 'body=' + (ToHex $Color) }
    if ($Eye) { $lines += 'eye=' + (ToHex $Eye) }
    if ($Background) { $lines += 'background=' + (ToHex $Background 'f4f5f7') }
    ($lines -join "`n") | adb @target shell "run-as $package sh -c 'mkdir -p files && cat > files/face_color'"
}

$now = (adb @target shell "run-as $package sh -c 'cat files/face_color 2>/dev/null'") -join ' '
$parts = @()
if ($now -match 'body=([0-9a-f]{6})') { $parts += "顔 #$($Matches[1])" } else { $parts += '顔 白（既定）' }
if ($now -match 'eye=([0-9a-f]{6})') { $parts += "目 #$($Matches[1])" } else { $parts += '目 黒（既定）' }
if ($now -match 'background=([0-9a-f]{6})') { $parts += "背景 #$($Matches[1])" } else { $parts += '背景 黒（既定）' }
Write-Host ('色: ' + ($parts -join '、') + '（アプリの次の起動から）')

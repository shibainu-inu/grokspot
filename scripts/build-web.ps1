# grokbot-web をビルドし、アプリが読み込む 1 ファイルの JS (assets/web/grokbot.js) を作り直す。
# 使い方: .\scripts\build-web.ps1
$ErrorActionPreference = 'Stop'
$web = Join-Path $PSScriptRoot '..\..\grokbot-web' | Resolve-Path
$out = Join-Path $PSScriptRoot '..\app\src\main\assets\web\grokbot.js'
# BSD-3-Clause の著作権表示を、配布する JS の先頭に残す。
$banner = '/*! grokbot-web (modified for GrokSpot) | BSD-3-Clause | Copyright (c) 2026, nasawz; Copyright (c) 2026, grokbot-web contributors | see THIRD_PARTY_NOTICES.md */'

Push-Location $web
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
    & .\node_modules\.bin\esbuild.cmd dist/index.js --bundle --format=iife --global-name=GrokBotLib `
        --target=chrome100 --minify --legal-comments=inline --outfile=$out
    if ($LASTEXITCODE -ne 0) { throw 'esbuild failed' }
    # esbuild.cmd は cmd 経由で引数を渡すので、"|" を含む --banner は使わずここで先頭に足す。
    $js = [IO.File]::ReadAllText($out)
    [IO.File]::WriteAllText($out, $banner + "`n" + $js, (New-Object Text.UTF8Encoding $false))
    Write-Host "grokbot-web $(git rev-parse --short HEAD) -> $out"
} finally {
    Pop-Location
}

# セットアップ手順

Echo Spot を GrokSpot 専用端末にするまでの手順です。コマンドは Windows の PowerShell で、リポジトリのフォルダー（`grokspot`）から実行する前提で書いています。

> 手順 6（ボタンの割り当て）だけは root 権限で端末のシステム領域を書き換えます。ほかの手順は通常のアプリの設定で、いつでも元に戻せます。元に戻す方法は最後にまとめています。

## 0. 前提

- Echo Spot（第1世代）に LineageOS 18.1（Android 11）が入っていて、開発者オプションの「USB デバッグ」が有効になっていること
- PC から `adb devices` で端末が見えること
- Android Studio、Node.js、Git が入っていること

PowerShell のセッションに環境変数がない場合は、ビルドの前に設定してください。

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

> Android Studio 同梱の JDK が新しい（Java 25）ため、Gradle 9.x（ラッパーは 9.8.2）と AGP 9.4.1 を使っています。

## 1. 顔の描画ライブラリ（準備不要）

顔の描画ライブラリ [grokbot-web](https://github.com/Coiggahou2002/grokbot-web) は、ビルド済みのもの（`app/src/main/assets/web/grokbot.js`）をリポジトリに同梱しています。**この手順は飛ばして構いません。**

同梱版は、grokbot-web（2026-09-09 時点の main）に GrokSpot 用の機能を足してビルドした **改変版** です。

| 追加した機能 | GrokSpot での用途 |
|---|---|
| `eyeOpen` | まぶたを連続的に開け閉めする（まばたき・半目・眠り） |
| `eyeOpenEach` | 片目ずつの開き具合（ウインク） |
| `eyeGap` / `eyeWidth` / `minEyeGap` | 状態ごとの目の間隔・幅の調整 |
| `evenEyes` | 作業中などに左右の目を揃える |
| `bodyScale` / `lidAxis` | 体と目の比率、まぶたの閉じる向き |
| `maxFrameRate` | 描き直しの回数に上限を付ける |
| `manualFrames` / `frame()` | 描画のタイミングを motion.js から指定する（体の動きと目を同じフレームで描く） |

描画ライブラリ自体を改造したい場合は、grokbot-web を取得して同じ機能を加え、このリポジトリと同じ階層に `grokbot-web` として置いてから `.\scripts\build-web.ps1` を実行すると、`grokbot.js` が作り直されます。

## 2. アプリをビルドしてインストールする

```powershell
.\gradlew.bat :app:installDebug
```

端末が複数つながっている場合は、先に `$env:ANDROID_SERIAL = '<シリアル>'` を設定してください。

## 3. マイクの使用を許可する

アプリを起動し、Grok ボタンを押す（または起動直後）と「Allow GrokSpot to record audio?」と出るので、**While using the app** をタップします。
PC から許可する場合：

```powershell
adb shell pm grant com.grokbot.grokspot android.permission.RECORD_AUDIO
```

## 4. xAI の API キーを書き込む

[xAI Console](https://console.x.ai/) で API キーを作り、**クリップボードにコピーしてから**実行します。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-api-key.ps1
```

- キーはアプリ専用領域（`/data/data/com.grokbot.grokspot/files/xai_api_key`）に保存されます。画面・APK・リポジトリには残りません。書き込み後、クリップボードは空にします。
- 消すときは `-Remove` を付けて実行します。
- Claude Code などから `!` で実行する場合は bash 経由になるので、パスはスラッシュ区切りで書いてください（`C:/.../scripts/set-api-key.ps1`）。

## 5. ボタン用のサービスを有効にする

`GrokButtonService` はユーザー補助（アクセシビリティ）サービスです。Grok ボタンの押し方の判定と、暗い部屋での画面のオン・オフを担当します。画面の内容は読みません。

```powershell
adb shell settings put secure enabled_accessibility_services com.grokbot.grokspot/com.grokbot.grokspot.GrokButtonService
adb shell settings put secure accessibility_enabled 1
```

（端末の「設定 → ユーザー補助 → GrokSpot」から有効にしても同じです。）

## 6. マイクオフボタンを Grok ボタンにする（root が必要）

この LineageOS の移植版では、本体上部の「マイクオフ」ボタンが電源キー（`KEY_POWER`）として報告されます。これを `BUTTON_1` に割り当て直し、GrokSpot が受け取れるようにします。

1. 端末の「設定 → システム → 開発者向けオプション」で **Rooted debugging** を有効にする
2. キー配置ファイルを置いて再起動する

```powershell
adb root
adb push device\Vendor_2454_Product_6500.kl /data/system/devices/keylayout/
adb shell chmod 644 /data/system/devices/keylayout/Vendor_2454_Product_6500.kl
adb shell chown system:system /data/system/devices/keylayout/Vendor_2454_Product_6500.kl
adb reboot
```

割り当て後のボタンの動きは次のとおりです（端末にほかの電源キーはないので、電源の操作もこのボタンで行います）。

| 操作 | 動き |
|---|---|
| 画面が消えているときに押す | 画面がつく（会話は始まらない） |
| 押す | 会話を始める／終える |
| 2 回押す | 画面を消す |
| 3 秒長押し | 電源メニュー（電源オフ・再起動） |
| 電源メニュー表示中に押す | 電源メニューを閉じる |

## 7. ホームアプリにする

GrokSpot は戻る操作を無効にしているため、ホームアプリにすると端末だけではランチャーや設定に行けなくなります。代わりの抜け道として、**顔を指 1 本で 5 秒押し続けると Android の設定が開きます**。

```powershell
adb shell cmd package set-home-activity com.grokbot.grokspot/.MainActivity
```

再起動すると、ロック画面の上に直接顔が表示されます（暗証番号なしのロック画面を前提にしています）。

## 8. タイムゾーンと言語

**タイムゾーン**：待機中の暮らしは、端末の時計で「夜」（22〜6 時）を判定します。端末が GMT のままだと夜がずれるので、住んでいる地域に合わせてください。

```powershell
adb shell service call alarm 3 s16 Asia/Tokyo
```

**言語**：GrokSpot は日本語・英語・中国語（簡体字）に対応し、端末の言語設定に従います。画面の文字・設定画面の文言・Grok が話す言語がそろって切り替わります。端末の「設定 → システム → 言語」で変えるか、root が使える場合は次のようにします。

```powershell
adb root
adb shell setprop persist.sys.locale ja-JP    # en-US / zh-CN
adb reboot
```

## 動作確認

1. Grok ボタンを押す → 顔が目覚め、画面の縁が青く光って「話しかけてください」と出る
2. 話しかける → 輪が明るくなり「聞いています…」→ 考え中の「・・・」→ Grok が話す
3. もう一度ボタンを押す → 会話が終わり、待機中の暮らしに戻る

ログは次で見られます。

```powershell
adb logcat -s GrokVoice GrokSpot
```

デバッグビルドでは、PC から WebView を直接操作できます（`chrome://inspect` からも開けます）。

```powershell
adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof com.grokbot.grokspot)
```

DevTools のコンソールで使える主な関数：

| 関数 | 内容 |
|---|---|
| `setBotState('radar')` | 表情を直接切り替える |
| `startTour()` | 主な状態を順に見せる |
| `grokspotLife.play('doodle')` / `setEnergy(0.1)` / `status()` | 待機中の暮らしを試す |
| `grokspot.voice.event('speech_started')` | 会話のイベントをまねる |

## 元に戻す

| 戻したいもの | 方法 |
|---|---|
| ホームアプリ | 顔を 5 秒押して設定を開き「アプリ → デフォルトのアプリ → ホームアプリ」、または `adb shell cmd package set-home-activity com.android.launcher3/com.android.launcher3.uioverrides.QuickstepLauncher` |
| ボタンの割り当て | `adb root` のあと `adb shell rm /data/system/devices/keylayout/Vendor_2454_Product_6500.kl` して再起動 |
| ユーザー補助サービス | `adb shell settings delete secure enabled_accessibility_services` |
| API キー | `scripts\set-api-key.ps1 -Remove` |
| アプリ全体 | 先にホームアプリを戻してから `adb uninstall com.grokbot.grokspot` |

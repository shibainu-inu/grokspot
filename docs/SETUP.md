# セットアップ手順

Echo Spot を GrokSpot 専用端末にするまでの手順です。コマンドは Windows の PowerShell で、リポジトリのフォルダー（`grokspot`）から実行する前提で書いています。

> 前半（A・B）は、Echo Spot に LineageOS を入れるまでの**流れと、つまずきやすい点**のまとめです。作者が 2 台の Echo Spot で実際に行った手順で、詳しい内容と最新の情報は XDA のスレッドが正です。**端末の書き換えは元に戻せない場合があり、自己責任で行ってください。**
> 後半（0〜9）は、GrokSpot のインストールと設定です。手順 6（ボタンの割り当て）だけは root 権限で端末のシステム領域を書き換えます。ほかの手順は通常のアプリの設定で、いつでも元に戻せます。元に戻す方法は最後にまとめています。

## A. LineageOS を入れる（流れと注意点）

参考先（非公式）：
- アンロックと TWRP：[XDA - UNLOCK/ROOT/TWRP for Echo Spot 2017 (rook)](https://xdaforums.com/t/unlock-root-twrp-unbrick-amazon-echo-spot-2017-rook.4754878/)（作業の前に、最初の投稿の注意書きを必ず読んでください）
- LineageOS 18.1 の ROM：[XDA - LineageOS 18.1 for the Amazon Echo Spot (2017)](https://xdaforums.com/t/rom-unofficial-11-rook-lineageos-18-1-for-the-amazon-echo-spot-2017.4762459/)、ダウンロードは [amazon-oss/releases](https://github.com/amazon-oss/releases/releases/tag/lineage-18.1-rook-v0.3)

用意するもの：
- データ通信ができる Micro USB ケーブル（充電専用のものでは PC から見えません）
- Windows の PC と、次の 3 つのファイル
  - **amonet-rook v2.0.0**（XDA の最初の投稿の添付。解凍した `amonet\fastbrick.bat` を使う）
  - **Google USB Driver**（[Android の開発者サイト](https://developer.android.com/studio/run/win-usb) から。解凍すると `android_winusb.inf` がある）
  - **LineageOS 18.1 の rook 用の zip**（作者が使ったのは `lineage-18.1-20251108-UNOFFICIAL-rook.zip`）
- 時間の余裕（ロック解除は始めたら中断できません）

### A-1. 端末の状態を確かめる

1. 普段どおり電源を入れ、Alexa の初期設定をして Wi-Fi につなぎます。
2. Alexa の「設定 → 端末のオプション → 端末のソフトウェアバージョン」で、Fire OS の版を確かめます。作者の 2 台はどちらも **5.5.6.9** でロック解除できました。対応する版は XDA のスレッドで確かめてください。
3. Micro USB の端子は、**背面のカバーの下に隠れています**（電源ジャックとイヤホンジャックの間）。薄いヘラなどで、カバーをそっと外します。

### A-2. ロックを解除する（amonet）

1. 電源ケーブルを抜いて、端末の電源を切ります。
2. 上部の **音量上・音量下・ミュートの 3 つのボタンを押したまま**、電源ケーブルをつなぎます。画面に `=> FASTBOOT mode...` と出るまで押し続けます。
3. Micro USB で PC につなぎ、`fastbrick.bat` をダブルクリックします（先に起動しておいても構いません。端末が見つかるまで待ちます）。
4. **PC が端末を見つけないとき（つまずきやすい点）**：Windows は、FASTBOOT モードの Echo Spot に自動ではドライバーを当てません。デバイスマネージャーを開くと、「ほかのデバイス」に黄色い三角の付いた **Android** があります。
   1. それを右クリック →「ドライバーの更新」→「コンピューターを参照してドライバーを検索」→「コンピューター上の利用可能なドライバーの一覧から選択」
   2. 「ディスク使用」で Google USB Driver の `android_winusb.inf` を選び、**Android Bootloader Interface** を入れます
   3. 入ると、待っていた `fastbrick.bat` が端末を見つけます（`Detected: ROOK - Echo Spot 1st Generation - 2017`）
5. `Type "YES" to continue` と出たら `YES`（大文字）と入れて Enter を押します。**そのあとは終わるまで、ケーブル・電源・PC に一切触らないでください。**
6. 端末が再起動して **TWRP** が出れば成功です。「Keep System Read-Only?」の画面では **Swipe to Allow Modifications** をスワイプします。

ロック解除のあとは、電源をつなぐときに **音量上** を押しておくと TWRP が起動します（XDA によると、**音量下** なら fastboot）。

> **してはいけないこと**：BOOTLOADER・LK・Preloader・TZ（TEE）のパーティションを書き換えないでください。復旧できなくなります（XDA の注意書き）。

### A-3. LineageOS を書き込む（TWRP）

1. **Wipe → Advanced Wipe** で、**Dalvik / ART Cache・System・Data・Cache** にチェックを入れてスワイプします（Internal Storage も消して構いません）。ほかの項目は選ばないでください。
   - Wipe の画面の「Swipe to Factory Reset」ではなく、Advanced Wipe を使います（Factory Reset は System を消しません）。
2. **ここで「Reboot System」を押さないでください（つまずきやすい点）。** System を消したので、起動できる OS がありません。画面が止まったままになり、壊れたように見えます。
   - 押してしまったときは、**電源ケーブルを抜き、音量上を押しながらつなぎ直す**と TWRP に戻れます。
3. 戻るボタンでメインメニューに戻り、**Mount** を開きます。ボタンが **「Disable MTP」と表示されていれば、MTP はすでにオン**です。押さないでください（押すと PC から見えなくなります。「Enable MTP」と出ているときだけ押します）。
4. PC のエクスプローラーに出る **Internal Storage** に、LineageOS の zip をコピーします。
   - Wipe はこのコピーより先に済ませてください（Internal Storage は Data の中にあり、あとで Wipe すると zip も消えます）。
5. **Install** → zip を選ぶ → 下の **✓** → **Swipe to confirm Flash** をスワイプします。
6. **Installation Successful** と出たら **Reboot System** を押します。初回の起動は数分かかります。時計の画面（「Discover Trust」の通知）が出れば成功です。

## B. LineageOS の初期設定

1. **Wi-Fi につなぐ**：画面の下から上にスワイプしてクイック設定を開き、Wi-Fi を長押しします。
   - **つまずきやすい点**：Wi-Fi の画面でパスワードを入れると、**数字が入力できない**ことがあります。そのときは、まず適当なパスワードでネットワークを登録し、登録したネットワークの「ネットワークの詳細」で右上の **鉛筆のマーク（編集）** を押して、正しいパスワードを入れ直します（この画面なら数字も入ります）。
2. **開発者向けオプションを出す**：Settings → About tablet（端末情報）→ **Build number** を、「You are now a developer!（デベロッパーになりました）」と出るまで何回かタップします。
3. **USB デバッグをオンにする**：Settings → System → Advanced → Developer options → **USB debugging** をオンにします。
4. **PC から見えるか確かめる**：USB でつないで `adb devices` を実行します。`unauthorized` と出たら、Echo Spot の画面の「USB デバッグを許可しますか？」で許可します。`device` と出れば準備完了です。
5. **表示の言語とタイムゾーン**：Settings → System → Languages & input → Languages で言語を追加し、一番上にドラッグします。タイムゾーンは Settings → System → Date & time で合わせます（手順 8 のコマンドでも設定できます）。

## 0. 前提

- Echo Spot（第1世代）に LineageOS 18.1（Android 11）が入っていて、開発者オプションの「USB デバッグ」が有効になっていること（上の A・B）
- PC から `adb devices` で端末が見えること
- Android Studio と Git が入っていること（Node.js は顔の描画ライブラリを改造する場合のみ必要）
- リポジトリを取得していること：`git clone https://github.com/shibainu-inu/grokspot.git`

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

ビルドの途中で `Unable to strip the following libraries ... libngrok_java.so` と出ますが、問題ありません（ngrok のライブラリをそのまま入れるという意味です）。インストールしただけでは、アプリはまだ起動しません。

## 3. マイクの使用を許可する

PC から許可します。

```powershell
adb shell pm grant com.grokbot.grokspot android.permission.RECORD_AUDIO
```

（端末のアプリ一覧から GrokSpot を開き、「Allow GrokSpot to record audio?」で **While using the app** をタップしても同じです。）

## 4. xAI の API キーを書き込む

[xAI Console](https://console.x.ai/) で API キーを作り、**コピーしてから**スクリプトを実行します。**キーはどこにも貼り付けません。** スクリプトがクリップボードから読んで、端末に書き込みます。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-api-key.ps1
```

- 順番に気をつけてください。キーをコピーしたあとにコマンドをコピーすると、クリップボードの中身がコマンドに置き換わります。先にコマンドを入力しておき、キーをコピーしてから Enter を押します。
- xAI Console のキーは、作ったときにしか全文を表示できません。作ったらその場で書き込むのが確実です。端末ごとにキーを分けておくと、あとで 1 台だけ止められます。
- キーはアプリ専用領域（`/data/data/com.grokbot.grokspot/files/xai_api_key`）に保存されます。画面・APK・リポジトリには残りません。書き込み後、クリップボードは空にします。
- 消すときは `-Remove` を付けて実行します。
- Claude Code などから `!` で実行する場合は bash 経由になるので、パスはスラッシュ区切りで書いてください（`C:/.../scripts/set-api-key.ps1`）。

### 検索（任意）

Grok Voice の検索は、料金がかかるので最初はオフです。オンにする方法と料金の目安は、README の「Grok Voice の料金と検索」を見てください。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-voice-search.ps1 -Web
```

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
adb shell mkdir -p /data/system/devices/keylayout
adb push device\Vendor_2454_Product_6500.kl /data/system/devices/keylayout/Vendor_2454_Product_6500.kl
adb shell chown -R system:system /data/system/devices
adb shell chmod 644 /data/system/devices/keylayout/Vendor_2454_Product_6500.kl
adb shell restorecon -R /data/system/devices
adb reboot
```

置き先のフォルダーは、新しく入れた LineageOS にはまだないので、最初に作ります。再起動後、`adb shell dumpsys input` の `mtk-kpd` の項に `KeyLayoutFile: /data/system/devices/keylayout/Vendor_2454_Product_6500.kl` と出ていれば効いています。

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

**表示の言語**：画面の文字と設定画面の文言は、端末の言語に合わせて日本語・英語・中国語（簡体字）で表示されます（ほかの言語では英語）。LineageOS は英語で始まるので、手順 B-5 の画面操作で変えるか、root が使える場合は次のようにします。

```powershell
adb root
adb shell setprop persist.sys.locale ja-JP    # en-US / zh-CN
adb reboot
```

**会話の言語**：Grok は、話しかけた言葉の言語で答えます。端末の言語が英語のままでも、日本語で話しかければ日本語で返ってきます。

## 9. 声と顔の色（任意）

声と顔の色は、端末ごとに変えられます。声は次の会話から、色はアプリの次の起動から効きます。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-voice.ps1 iris                                    # 声を iris に（既定は eve）
powershell -ExecutionPolicy Bypass -File scripts\set-face-color.ps1 pink -Eye white -Background white   # 白い Echo Spot 向け
adb reboot                                                                                             # 色を反映する
```

- **声**：xAI の声の名前（eve、ara、rex、sal、leo のほか、2026 年に増えた iris など）か、xAI で作ったカスタムボイスの ID を指定します。使える声は xAI のドキュメントで確かめてください。`-Reset` で eve に戻ります。
- **色**：顔・目・背景をそれぞれ指定できます。色の名前は `pink`（GrokBot のピンク #ff309c）、`softpink`（#ffd1dc）、`white`、`black`。`'#cfe8ff'` のような 16 進数でも指定できます。顔には陰影が自動で付きます。背景が明るいと、画面下の案内の文字は濃い青になります。`-Reset` で既定（白い顔・黒い目・黒い背景）に戻ります。

### Tips：AI のコーディングツールと一緒に進める

PC の Claude Code などの AI のコーディングツールを使い、Echo Spot を Micro USB でつないだまま作業すると、構築も調整もずっと楽になります。作者もこの方法で作っています。

- **構築**：この手順書を渡して「この手順で進めて」と頼むと、`adb` のコマンドを順に実行し、エラーが出ればその場で原因を調べてくれます。端末の画面での操作だけ、自分で行います。
- **調整**：「声を変えて」「顔を水色に」「待機中の動きを減らして」などと頼めば、スクリプトの設定から、指示文（`res/values*/strings.xml` の `voice_instructions`）や画面（`assets/web/`）の書き換えまで、小さな変更で好きな形にできます。
- **確かめる**：`adb logcat`（会話の内容・表情・検索）や画面のスクリーンショット（`adb shell screencap`）を AI が読めるので、「声が変わったか」「検索したか」などをログで確かめてもらえます。
- API キーや ngrok の authtoken は、会話に貼らないでください。クリップボードから読むスクリプト（`set-api-key.ps1`、`set-ngrok.ps1`）を自分で実行します。

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
| `grokspotLife.play('tryOrbit')` / `play('dance')` / `setEnergy(0.1)` / `setMood('playful')` / `setSpeed(5)` / `status()` | 待機中の暮らしを試す（`setSpeed` は早送り。`1` で元に戻る） |
| `grokspot.voice.event('speech_started')` | 会話のイベントをまねる |

## 元に戻す

| 戻したいもの | 方法 |
|---|---|
| ホームアプリ | 顔を 5 秒押して設定を開き「アプリ → デフォルトのアプリ → ホームアプリ」、または `adb shell cmd package set-home-activity com.android.launcher3/com.android.launcher3.uioverrides.QuickstepLauncher` |
| ボタンの割り当て | `adb root` のあと `adb shell rm /data/system/devices/keylayout/Vendor_2454_Product_6500.kl` して再起動 |
| ユーザー補助サービス | `adb shell settings delete secure enabled_accessibility_services` |
| API キー | `scripts\set-api-key.ps1 -Remove` |
| 声・顔の色 | `scripts\set-voice.ps1 -Reset`、`scripts\set-face-color.ps1 -Reset` |
| Grok Voice の検索 | `scripts\set-voice-search.ps1 -Off` |
| ngrok のトンネル | `scripts\set-ngrok.ps1 -Remove` |
| アプリ全体 | 先にホームアプリを戻してから `adb uninstall com.grokbot.grokspot` |

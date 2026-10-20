# GrokSpot

Echo Spot（2017年発売の丸い画面の Amazon 端末）を、**話しかけると顔で応える GrokBot 専用端末**に作り変える Android アプリです。
LineageOS を入れた Echo Spot の上で動き、xAI の Grok Voice API と音声で会話します。

> **非公式プロジェクトです。** xAI・Amazon とは一切関係がなく、承認も受けていません。
> 「Grok」は xAI の商標、「Echo Spot」は Amazon の商標です。

<p align="center">
  <img src="docs/screenshot-listening.png" width="240" alt="話しかけるのを待っている GrokSpot">
</p>

![状態ごとの変形](docs/screenshot-morphs.png)

## なぜ作ったか

- **眠っている端末を生かすため。** Alexa の役目を終えた Echo Spot は、丸い画面・マイク・スピーカー・光センサーがそろった、置き場所を選ばない小さな端末です。
- **AI に「顔」を持たせるため。** 音声だけの AI は、今聞いているのか、考えているのか、話し終えたのかが分かりにくいものです。顔の表情と動きでそれを伝えます。
- **生き物のように見せるため。** 待機中も止まった絵にはせず、自分で見回したり、うたた寝したり、夜は眠ったりします。触ると反応します。

## できること

| 機能 | 内容 |
|---|---|
| 音声会話 | 本体上部のボタン（元はマイクオフボタン）を押すと Grok Voice と会話。もう一度押すか、60 秒話さないと終了 |
| 表情の連動 | 会話の進み具合（聞いている → 考えている → 話している → 待機）を表情で表示。Grok が自分で表情を選ぶこともある |
| 入力待ちの表示 | 話しかけてよいときは画面の縁が青く光り、「話しかけてください」と出る |
| 待機中の暮らし | 休む・見回す・考えごと・鼻歌・遊ぶ・落書き・うたた寝・睡眠を、「元気」の値に合わせて自然につなぐ。夜は朝まで眠る |
| タッチ | 目と頭が指を追う。頭のてっぺんを撫でる・目をつつく・体をつつく・何もない所を触る・連打で反応が変わる |
| 変形とエフェクト | 考え中の「・・・」、警告の「！」、レーダー、進捗リング、ペンなど 14 種の変形と、紙吹雪・虹色の軌跡 |
| 専用端末として | ホームアプリとして起動。暗い部屋では画面が消え、明るくなるとつく。ボタン長押しで電源メニュー |

スクリーンショット：待機中の暮らし（遊ぶ → 鼻歌 → うとうと → 睡眠 → 起床）

![待機中の暮らし](docs/screenshot-life.png)

## 必要なもの

- **Echo Spot（第1世代、2017年）** に **LineageOS 18.1（Android 11）** を入れたもの。
  非公式の移植版を使っています。入れ方はこのリポジトリでは扱いません。端末を書き換えると元に戻せない場合があるので、自己責任で行ってください。
- Windows PC（スクリプトは PowerShell 用。Android のビルド自体は macOS / Linux でも可能）
  - Android Studio（同梱の JDK と Android SDK を使用）
  - Node.js（顔の描画ライブラリのビルド用）
  - adb（Android SDK Platform-Tools）
- **xAI の API キー**（Grok Voice の利用料金がかかります）

## クイックスタート

詳しい手順は [docs/SETUP.md](docs/SETUP.md) を見てください。おおまかな流れは次のとおりです。

```powershell
# 1. アプリをビルドして Echo Spot に入れる（顔の描画ライブラリはビルド済みのものを同梱）
.\gradlew.bat :app:installDebug

# 2. API キーをクリップボードにコピーしてから、端末に書き込む
powershell -ExecutionPolicy Bypass -File scripts\set-api-key.ps1

# 3. ボタン用のサービスを有効にし、ホームアプリにする（SETUP.md の手順 5〜7）
```

## 構成

```
app/src/main/java/com/grokbot/grokspot/
  MainActivity.kt        全画面の WebView。ボタンで会話の開始・終了、5 秒長押しで設定を開く抜け道
  VoiceSession.kt        Grok Voice（wss://api.x.ai/v1/realtime）との会話。マイク送信・音声再生・イベント通知
  GrokButtonService.kt   ユーザー補助サービス。ボタン操作（押す・2 回押し・長押し）と、暗い部屋での画面オン・オフ
app/src/main/assets/web/
  index.html             顔のページ。入力待ちの輪と文字
  grokbot.js             顔の描画ライブラリ（grokbot-web に機能を足してビルドしたもの）
  motion.js              体の動き・まばたき・目線・14 種の変形
  fx.js                  紙吹雪・虹色の軌跡・変形の部品の描画
  actions.js             「聞く」「考える」などの動作 → 表情の対応表
  voice.js               会話のイベント → 表情（仕様は docs/DESIGN.md）
  life.js                待機中の暮らし（元気の値、昼と夜）
  touch.js               タッチの位置ごとの反応
device/
  Vendor_2454_Product_6500.kl   マイクオフボタンを Grok ボタンにするキー配置
scripts/
  build-web.ps1          描画ライブラリを改造したときに grokbot.js を作り直す（通常は不要）
  set-api-key.ps1        API キーを端末のアプリ専用領域に書き込む
docs/
  SETUP.md               端末の準備からインストールまでの詳しい手順
  DESIGN.md              設計の意図と仕組み
  AVATAR-STATE-SPEC.md   会話中のアバター状態遷移の仕様（Grok Voice API 版）
```

設計の考え方（なぜ関数呼び出しで表情を渡すのか、なぜ会話中に割り込めないのか、など）は [docs/DESIGN.md](docs/DESIGN.md) に、会話中のアバターの状態遷移は Grok と共同でまとめた仕様書 [docs/AVATAR-STATE-SPEC.md](docs/AVATAR-STATE-SPEC.md) にあります。

## 既知の制約

- **Grok の話の途中で割り込めません。** Echo Spot にはエコーキャンセラーがないため、Grok が話している間はマイクの音を送っていません。
- **日本語向けです。** 画面の文字と Grok への指示文は日本語です。夜の判定は日本時間で行います。
- **API キーは端末内に平文で置きます。** 一人で使う専用端末を想定しています。キーはアプリ専用領域（他のアプリからは読めない）に置き、APK とリポジトリには入りません。
- デバッグビルドを前提にしています（API キーの書き込みに `run-as` を使うため）。
- Echo Spot（LineageOS 18.1）以外の端末では試していません。

## クレジットとライセンス

- 顔の描画は [grokbot-web](https://github.com/Coiggahou2002/grokbot-web)（BSD-3-Clause）を使っています。grokbot-web は [nasawz/GrokBot](https://github.com/nasawz/GrokBot)（Flutter 版、BSD-3-Clause）の移植です。表情・形・状態のデザインは原作者のものです。
  同梱版は、grokbot-web に GrokSpot 用の機能（まぶた、ウインク、目の間隔、フレームレートの上限など）を足してビルドした **改変版** です。追加した機能の一覧は [docs/SETUP.md](docs/SETUP.md) の手順 1 にあります。
- 体の動き（motion.js）は、xAI の記事 [Designing Grok Bot](https://x.ai/news/designing-grok-bot) で公開されているアバターの振る舞いを参考に、独自に実装したものです。
- 同梱・依存しているソフトウェアのライセンス表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にまとめています。
- GrokSpot 自体は [BSD-3-Clause](LICENSE) です。

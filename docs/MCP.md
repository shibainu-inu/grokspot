# MCP サーバー（GrokBot から顔を動かす）

スマホや PC で使っている自分の GrokBot から、Echo Spot の顔を動かせるようにする仕組みです。GrokSpot は [MCP](https://modelcontextprotocol.io/)（Model Context Protocol）のサーバーを内蔵し、ツール `set_avatar_state` を 1 つ公開しています。

- 元の仕様：「GrokSpot × GrokBot アバター出力インターフェース 仕様（実装担当向け）」2026-10-22（Grok 著）
- 実装：`app/src/main/java/com/grokbot/grokspot/McpServer.kt`（サーバー）、`McpAuth.kt`（OAuth）、`app/src/main/assets/web/external.js`（顔への反映）、`pairing.js`（確認コードの表示）

## 概要

| 項目 | 内容 |
|---|---|
| トランスポート | Streamable HTTP（MCP 標準。応答は JSON で返し、SSE のストリームは使わない） |
| エンドポイント | `POST http://<Echo Spot の IP>:8765/mcp` |
| ポート | 8765（固定。`McpServer.PORT`） |
| 起動 | アプリの起動と同時に自動で立ち上がる。ボタンの会話（Grok Voice）とは独立して動く |
| ツール | `set_avatar_state`（顔を変える）、`get_avatar_state`（今の顔を知る） |
| 認証 | 常に必要。OAuth 2.1（Echo Spot の画面に出る確認コードで許可）か、端末のトークン（後述） |
| 対応プロトコル版 | 2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05 |

### ツール

追加の引数は省略できます。`set_avatar_state(state)` だけの使い方はそのまま使えます。

**1 回呼べば完結します。** 呼ぶと、その状態を基本の秒数（下の表）だけ表示して、自動で待機中の暮らしに戻ります。締めに `idle` などを送る必要はありません。もっと長く見せたいときだけ `duration_sec` を付けます（例：大事なお知らせは `alerting` を `duration_sec: 30` で。長い作業中は `working` を `duration_sec: 120` で出し、終わったら気持ちを送る）。呼ぶ目安は、毎回の返信で 1 回（多くても 2 回）です。途中経過（`thinking`・`searching`・`working`）は任意で、長い調べものや作業のときだけ使います。

#### `set_avatar_state`

| 引数 | 型 | 内容 |
|---|---|---|
| `state`（必須） | 文字列 | 表示する状態。下の 16 個のどれか |
| `duration_sec` | 数値 | 状態の基本の秒数の代わりに、この秒数だけ表示してから待機（idle）に戻る（1〜600） |

結果は `{"ok": true, "applied": true, "viewer_connected": true}` です。候補にない状態名は無視して、エラーにせず `applied: false` を返します（voice.js と同じ扱い）。`viewer_connected` は「画面が点いていて顔が表示されている」ことで、人が見ているかまでは分かりません。

**状態の目安**（ツールの説明文にも秒数つきで書いてあり、Grok はこれを見て選びます。秒数は GrokBot と相談して決めた値です）

| 状態 | 使う場面 | 基本の秒数 | 画面下の一言 |
|---|---|---|---|
| `idle` | 落ち着いている。何もない（待機中の暮らしに戻す） | 0（すぐ） | なし |
| `listening` | ユーザーの話に耳を傾けている | 5 | 👂 |
| `thinking` | 答えを考えている（頭が「・・・」になる） | 7 | 💭 |
| `working` | 作業やツールの実行中 | 7 | 📝 |
| `searching` | 調べもの中 | 7 | 🔍 |
| `happy` | うれしい、穏やかな喜び | 4 | ❤️ |
| `excited` | わくわくしている、期待 | 5 | ✨ |
| `celebrate` | 大成功のお祝い（大回転と虹色の軌跡） | 7 | 🎉 |
| `curious` | 興味がある、もっと知りたい | 5 | 👀 |
| `confused` | 分からない、確認したい | 5 | ❓ |
| `surprised` | 思いがけない知らせ | 3 | ⁉️ |
| `sad` | 残念、申し訳ない | 6 | 💧 |
| `angry` | むっとしている（控えめに） | 4 | 💢 |
| `bored` | することがなく待っている | 10 | 💤 |
| `alerting` | ユーザーの確認が必要、うまくいかなかった（「！」になる） | 8 | ❗ |
| `notifying` | 新しい結果やお知らせがある（alerting より穏やか） | 5 | 📩 |

画面下の一言は、状態ごとに決まったものが出ます。ボットが自分で書く欄はありません（書けるようにしていたときは、ボットが毎回、返信の話題を表す言葉を書いてしまい、気持ちの印になりませんでした）。一言はすべて絵文字で、端末の言語にかかわらず同じです。`alerting` と `notifying` の絵文字は、未読のしるしと同じです。表示は、ボタンで会話するときの「話しかけてください」と同じ場所（画面の下）・同じ青い文字です。ボタンの会話中にマイクの案内文と重なるときは、案内文を隠します（青い輪は残ります）。

#### 未読のしるし

`notifying` と `alerting` は、表示が終わって待機中の暮らしに戻ったあとも、画面の下に小さなしるしを残します（`notifying` は 📩、`alerting` は ❗。両方あれば並べて出す）。その場で見ていなくても、あとで気づけるようにするためです。

- 消えるのは、**画面に触れたとき**（見た合図）か、**ボットが `idle` を送ったとき**（既読の合図）
- 一言やマイクの案内文が出ている間は、同じ場所なので隠れる（消えはしない）
- 画面が消えていても残るので、点いたときに気づける
- ボットは `get_avatar_state` の `unread` で、ユーザーがもう見たかを確かめられる

#### `get_avatar_state`

今の顔の状態を返します。

| 返り値 | 内容 |
|---|---|
| `state` / `since` | 今の状態と、それに変わった時刻 |
| `source` | 誰がその顔にしたか：`mcp`（MCP から）、`voice`（ボタンの会話中）、`idle_life`（待機中の暮らし） |
| `caption` | 今出ている一言（状態ごとの既定のもの） |
| `last_mcp_state` / `last_mcp_at` | 最後に MCP から送られた状態と時刻 |
| `viewer_connected` | 画面が点いていて顔が表示されているか |
| `unread` / `unread_kinds` | 未読のしるしが残っているか、その種類（`alerting`・`notifying`） |

`include_image: true` を付けると、画面の小さな画像（160 px の PNG）も返します。

### ボットの状態に合わせた自動の動きについて

Grok の連携（カスタムコネクタ）では、Grok がツールを呼ぶ直前に MCP の接続を開き、呼んだら閉じます。返信を考えている途中や、ほかのツールを使っている様子は Echo Spot に届かないので、「ボットが考えている間は自動で thinking」のような切り替えは、今の仕組みではできません。代わりに次の形で補います。

そこで、役割を次のように分けています。

| 役割 | 担当 |
|---|---|
| 途中経過（考え中・検索中など） | 公式アプリの小さなアバター。GrokSpot では任意（長い調べものや作業のときだけ） |
| LLM が意思を持って示す表現（喜び・驚き・注意喚起など） | GrokSpot のメイン。1 回呼べば、基本の秒数だけ強調付きで表示する |
| 何も来ないときの動き | GrokSpot の待機中の暮らし（補助） |

各状態には基本の秒数があるので、送りっぱなしでも自然に待機中の暮らしに戻り、「終わったのにまだ考え中」のようなずれが起きにくくなっています。

Echo Spot 自身での会話（ボタンで話す Grok Voice）では、会話のイベントから自動で切り替わります（[AVATAR-STATE-SPEC.md](AVATAR-STATE-SPEC.md)）。

## 顔への反映と優先順位

| いつ | どうなるか |
|---|---|
| 会話していないとき | 待機中の暮らしに代わってその状態を、状態ごとの基本の秒数（`duration_sec` で変えられる）だけ表示し、その後は暮らしに戻る。途中で別の状態が来たらすぐ切り替える。同じ状態をもう一度呼ぶと、時間を数え直す。`idle` を送るとすぐ暮らしに戻る |
| Grok Voice で会話中・ユーザーが話している | 無視する（ユーザーの発話 `listening` が最優先） |
| 会話中・Grok が応答している | Grok Voice 自身の `set_avatar_state` と同じ扱い。その応答が終わるまで保ち、最低 2 秒表示する |
| 会話中・応答と応答の間 | 表示する。次のイベント（ユーザーの発話など）で切り替わる |

優先順位はアバター状態遷移の仕様（[AVATAR-STATE-SPEC.md](AVATAR-STATE-SPEC.md)）と同じです。

### 状態が変わったときの強調

MCP から送られた状態を表示するときは、毎回 1 回だけ強調表示をします。「AI が自分の意思で顔を変えた」ことが分かり、表情を見逃しにくくするためです（Grok の追加仕様）。

- 頭が少しだけ大きく弾み、まばたきする
- 画面の縁が、ボタンの会話の青い輪と同じ見た目で一度だけ光って消える（約 1.8 秒）

同じ状態がもう一度送られたときも強調します。会話中にユーザーが話していて受け付けなかったときは、強調しません。マイクの入力待ちの輪はゆっくり明滅し続けるのに対し、こちらは一度光るだけなので、「話しかけてよい」の印とは区別できます。

## 動作確認（PC から）

USB（adb）でつないだ Echo Spot に、PC から送れます。スクリプトが adb の転送（PC の 8765 → 端末の 8765）を設定し、認証のトークンも adb で端末から読んで使います。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mcp-call.ps1 -List     # ツールの一覧
powershell -ExecutionPolicy Bypass -File scripts\mcp-call.ps1 curious   # 顔を curious にする
```

同じ LAN にいるなら、端末の IP に直接送れます（端末の IP は「設定 → ネットワーク → Wi-Fi」か `adb shell ip -4 addr show wlan0` で確認できます）。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mcp-call.ps1 happy -Url http://<Echo Spot の IP>:8765/mcp
```

curl などで送るときは、トークンを付けます（`scripts\set-mcp-token.ps1 -Show` で表示できます）。

```bash
curl -X POST http://<Echo Spot の IP>:8765/mcp -H "Content-Type: application/json" \
  -H "Authorization: Bearer <トークン>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"set_avatar_state","arguments":{"state":"happy"}}}'
```

公式の [MCP Inspector](https://github.com/modelcontextprotocol/inspector) でも確認できます（ブラウザ版の Inspector なら、OAuth の流れもそのまま試せます）。

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8765/mcp --transport http \
  --header "Authorization: Bearer <トークン>" --method tools/list
```

### ネットワークの注意

- Android（LineageOS）にはファイアウォールがないので、端末側の設定は不要です。
- つながらないときは、Wi-Fi ルーターやスマホのテザリングの「端末どうしの通信を禁止する」設定（AP アイソレーション、プライバシーセパレーター）を確認してください。
- 端末の IP はルーターに決められるので変わることがあります。固定したいときはルーター側で割り当てを予約してください。

## GrokBot（公式の Grok）に登録する

Grok のカスタムコネクタは、**インターネットから届く URL** しか登録できません（`localhost` や LAN のアドレスは受け付けません）。そのため、自分のトンネルで公開用の URL を作ります（[xAI のドキュメント](https://docs.x.ai/grok/connectors)）。登録画面には URL の欄しかなく、認証は OAuth で進めます。

1. **トンネルを用意する**。GrokSpot は [ngrok](https://ngrok.com/) のトンネルを**アプリの中で**開きます。PC を動かし続ける必要はありません。ngrok は HTTPS の 443 番ポートだけでつながるので、制限の厳しいネットワークでも使えます。
   1. ngrok の無料アカウントを作り、ダッシュボードで **authtoken** と、**Domains** にある固定ドメイン（`<名前>.ngrok-free.dev` など、無料で 1 つ）を確かめます。
   2. authtoken をコピーしてから、Echo Spot を USB でつないだ PC で次を実行します。authtoken はクリップボードから読み、画面にもファイルにも残しません（会話や共有画面に貼らないでください）。

      ```powershell
      powershell -ExecutionPolicy Bypass -File scripts\set-ngrok.ps1 -Domain <あなたの固定ドメイン>.ngrok-free.dev
      ```

   3. 30 秒ほどでアプリがトンネルを開きます（再起動は要りません）。開いたかは `adb logcat -s GrokNgrok` の `Tunnel up` で確かめられます。

   無料プランでは同じ authtoken で同時に 1 か所しかつながりません。PC でも同じドメインの ngrok を動かしているなら止めてください。

   アプリのトンネルを使わず、自分で用意したトンネル（PC の ngrok や cloudflared など）で `http://<Echo Spot の IP>:8765` か `adb forward tcp:8765 tcp:8765` の先を公開しても構いません。そのときは `set-ngrok.ps1` は実行しないでください。

2. **Grok に登録する**：[grok.com/connectors](https://grok.com/connectors) → **New Connector** → **Custom** で、次の URL を入れます（トークンは不要です）。

   ```
   https://<あなたの固定ドメイン>.ngrok-free.dev/mcp
   ```

3. **画面に触れて、出たコードで許可する**：許可画面が開き、Echo Spot の画面に「接続の申請があります。受け付けるときは画面に触れてください」と出ます（画面が消えていれば点きます）。**Echo Spot の画面に触れると 6 桁のコードが出る** ので、それを許可画面に入力して「許可する」を押します。
   - 許可画面には、接続を求めているクライアントの名前と、許可後に戻る先のドメインが出ます。心当たりがなければ「拒否する」を押してください。
   - コードは画面に触れたときに初めて作られます。触れる前に入力しても受け付けません。
   - 申請とコードの有効期限はそれぞれ 5 分、コードを入力できるのは 5 回までです。
   - 申請は 10 分に 5 回まで、クライアントの登録も 10 分に 5 回までです。超えると「しばらく待って」と表示されます。
   - ngrok の無料ドメインでは、許可画面の前に ngrok の注意画面（「Visit Site」）が一度出ることがあります。そのまま進んでください。

4. Grok との会話で「今の表情を curious にして」と頼んで、顔が変わるか確かめます。

許可は 24 時間ごとに自動で更新され（更新用の鍵は 180 日有効）、つなぎ直す必要はありません。

### Grok に入れておく指示（おすすめ）

GrokSpot はサーバー側からも、LLM に顔を使ってもらうよう次の 4 か所で促しています。

- ツールの説明文：冒頭で「返信のたびに 1 回呼ぶ」「音声に出ない・安全・締め不要」と伝える
- 接続時の案内文：GrokSpot が「あなたの顔」であり、呼ばないと顔が動かないことを伝える
- ツールの付加情報（MCP の annotations）：壊すことはなく何度呼んでもよい操作だと示し、表示名を付ける
- 呼び出しの結果：「次の返信でも 1 回呼んで」と添える（結果は会話に残るので、その会話の間は呼び続けてもらいやすい）

それでも、これだけでは LLM はあまりツールを呼んでくれません（実際に使って分かったこと）。顔がよく動くようにするには、Grok の設定でいつも読ませる指示（カスタム指示など）に、次の文を入れてください。作者の環境でも、同じ趣旨の指示を入れて動かしています。

```
私のデスクには Echo Spot があり、GrokSpot というツールであなたの顔を表示しています。
返信するたびに、その返信の気持ちに合わせて GrokSpot の set_avatar_state を 1 回呼んでください（多くても 2 回）。
例：お礼や完了は happy、質問は curious、驚く話は surprised、大きな成功は celebrate、注意してほしいことは alerting、お知らせは notifying。
締めの呼び出しは要りません。呼んだことは返信の中で触れなくて構いません。
```

英語の場合：

```
There is an Echo Spot on my desk that shows your face through the GrokSpot tool.
In every reply, call GrokSpot's set_avatar_state once with the feeling that fits that reply (twice at most).
For example: happy for thanks or something done, curious for a question, surprised for news, celebrate for a big
success, alerting for something I should check, notifying for a new result.
No closing call is needed, and you do not have to mention the call in your reply.
```

### OAuth に対応していないクライアントの場合

インターネット（トンネル）経由では、OAuth でしかつなげません。URL にトークンを入れる方式はありません。漏れやすく、漏れると画面での許可を素通りできてしまうためです。

端末のトークン（`Authorization: Bearer <トークン>`）は、USB や同じ LAN から動作確認するときだけ使えます（上の「動作確認（PC から）」）。

### 許可の取り消し

| 取り消したいもの | 方法 |
|---|---|
| OAuth で許可したクライアント全部 | `scripts\set-mcp-token.ps1 -RevokeOAuth`（すぐに反映されます） |
| 動作確認用の端末のトークン | `scripts\set-mcp-token.ps1`（作り直すと古いトークンは使えなくなる） |

### ツールを更新したとき

Grok は、ツールの一覧と説明を **URL ごとに** 覚えて持ち続けるようです。コネクタの画面で再読み込みしても、同じ URL で削除・登録し直しても、Echo Spot に一覧を取りに来ませんでした（2026-10-22 に確認）。

GrokSpot を更新してツールや説明が変わったときは、**URL の末尾を変えて** 登録し直してください。`/mcp` のほか `/mcp/v2`、`/mcp/v3` のように `/mcp/` の後ろに英数字を付けた URL も、同じサーバーとして受け付けます（OAuth の情報もその URL に合わせて返します）。

```
https://<あなたの固定ドメイン>.ngrok-free.dev/mcp/v3
```

呼び出し自体は登録し直さなくても新しい仕組みで動きますが、Grok が新しい引数や説明に気づくには、新しい URL での登録が必要です。古いコネクタの許可は `scripts\set-mcp-token.ps1 -RevokeOAuth`（全部取り消し）で消せます。

### トンネルの運用

- 固定ドメインなら、トンネルがつなぎ直しても URL は変わらず、登録し直す必要はありません。
- Wi-Fi が切れても、戻ってインターネットにつながったと Android が確かめた時点で、すぐにつなぎ直します（2026-10-23 の確認では、Wi-Fi を戻してから 7 秒）。
- トンネルをやめるときは `scripts\set-ngrok.ps1 -Remove` で authtoken を消し、アプリを起動し直します。ドメインや authtoken を書き換えたときも、反映は次の起動からです。
- トンネルを止めても、LAN 内からは引き続き使えます。

#### ngrok のライブラリについて

アプリは [ngrok-java](https://github.com/ngrok/ngrok-java)（1.1.1、32 ビット ARM の Android 版）を使います。そのままでは Android で動かないため、2 か所に手を加えています。

- **ネイティブライブラリの置き場所**：ngrok-java は本体（`libngrok_java.so`）を jar の中に入れて実行時に取り出しますが、Android のビルドはその .so を APK に入れません。ビルドのときに jar から取り出して APK の `lib/` に入れ、アプリから読み込みます。ngrok 自身の読み込みは失敗するので、飛ばされる初期化（`Runtime.init`）は `com.ngrok.AndroidRuntime` から呼びます。
- **JNI の版**：本体の `JNI_OnLoad` が JNI 1.8 を返し、Android（1.6 まで）が読み込みを拒否します（`Bad JNI version`）。ビルドのときに、その戻り値の 1 バイトを 1.6 に書き換えます。1.8 で増えたのは Java のモジュール用の関数だけで、ngrok は使っていません。書き換える場所の中身が想定と違えばビルドを止めるので、ngrok-java の版を上げたときは場所を調べ直してください（`app/build.gradle.kts`）。

APK は約 2.6 MB 大きくなります（インストール後に展開される本体は約 6 MB）。

## セキュリティ

| 対策 | 内容 |
|---|---|
| 認証は常に必要 | 認証のない `/mcp` への要求は 401 で拒否し、OAuth の情報の場所を返す（RFC 9728）。インターネットから入れるのは OAuth だけ |
| OAuth 2.1 | 認可コード＋PKCE（S256）のみ。クライアントは動的登録（RFC 7591）か、クライアント情報の URL（Client ID Metadata Document）。戻り先は https（か localhost）に限る |
| 画面に触れて許可 | 申請が来ても、Echo Spot の画面に触れるまでコードは作られない。触れたときに出る 6 桁（有効 5 分・5 回まで）が必要。目の前に端末がある人しか許可できず、当てずっぽうで当てるコードもない |
| 回数の上限 | 申請は 10 分に 5 回、クライアントの登録も 10 分に 5 回まで。許可まで進まなかったクライアントは 1 時間で消え、許可済みのクライアントが押し出されることはない |
| 鍵の保存 | アクセス用の鍵（24 時間）と更新用の鍵（180 日、使うたびに作り直す）は、ハッシュ（SHA-256）だけを端末に保存する |
| 許可画面 | 他のサイトへの埋め込み禁止（`frame-ancestors 'none'`）、外部の読み込み禁止（CSP）、別サイトからの送信を拒否 |
| ngrok の authtoken | アプリ専用の領域（`files/ngrok_authtoken`、本人だけ読める）に置く。APK や git には入らない。書き込みはクリップボードから標準入力で渡し、コマンドラインにも出さない |
| 端末のトークン | 最初の起動時に端末が作る。`Authorization: Bearer` のヘッダーでだけ使え、USB や LAN からの要求に限る。トンネル経由の要求（`X-Forwarded-For` などが付いたもの）では使えない。URL に入れる方式はない |
| Origin の拒否 | `/mcp` への `Origin` ヘッダー付きの要求（＝ブラウザからの要求）は 403 で拒否する。同じ LAN の Web ページから勝手に呼ばれるのを防ぐ（DNS リバインディング対策） |
| できることの範囲 | 顔の状態を変えることだけ。音声・マイク・端末の操作には触れない |

## 今後（ロードマップ）

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | MCP サーバーと `set_avatar_state` | 完了 |
| 2 | GrokBot へのサーバー登録 | 完了（2026-10-22、ngrok 経由で登録し、Grok から顔が変わることを確認） |
| 3 | 動作確認と調整、GrokBot が自分から使うかの観察 | これから |
| 4 | 状態のバリエーションを増やす | 使われ方を見てから |
| 5 | 双方向化（タッチなどを GrokBot に伝える） | 検討 |
| 6 | 公式アプリとのより自然な連携 | 検討 |

## 配布に向けた課題（今後）

| 課題 | 今 | 方向性 |
|---|---|---|
| PC が要る | 初期設定のときだけ（authtoken の書き込み）。トンネルはアプリが開く（2026-10-23） | 端末の画面から設定できるようにするか検討 |
| 認証 | OAuth 2.1 ＋画面の確認コード（実装済み） | Grok の実際のコネクタで OAuth が最後まで通るかを確かめる |
| 初期設定 | ngrok の authtoken とドメインを書き込み、URL を登録して画面のコードを入力する | 手順をさらに減らす |
| 中継の運営 | 各自の ngrok アカウント | 共有の中継サーバーは置かない方針（運営が不要で、他人の通信を預からない）。各自が自分のトンネルのアカウントを使う |
| ngrok-java | 2024-09 の 1.1.1 から更新がない。Android 向けに 2 か所手を加えている | 動かなくなったら、版の更新か別の方法を検討 |

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

追加の引数はすべて省略できます。`set_avatar_state(state)` だけの使い方はそのまま使えます。

#### `set_avatar_state`

| 引数 | 型 | 内容 |
|---|---|---|
| `state`（必須） | 文字列 | 表示する状態。下の 16 個のどれか |
| `caption` | 文字列 | 顔の上に出す一言（15 文字まで、超えた分は「…」）。省略すると既定の一言、`""` なら出さない。状態が変わると消える |
| `duration_sec` | 数値 | この秒数で待機（idle）に戻る（1〜600、既定 30） |

結果は `{"ok": true, "applied": true, "viewer_connected": true}` です。候補にない状態名は無視して、エラーにせず `applied: false` を返します（voice.js と同じ扱い）。`viewer_connected` は「画面が点いていて顔が表示されている」ことで、人が見ているかまでは分かりません。

**状態の目安**（ツールの説明文にも書いてあり、Grok はこれを見て選びます）

| 状態 | 使う場面 | 既定の一言 |
|---|---|---|
| `idle` | 落ち着いている。何もない（待機中の暮らしに戻す） | なし |
| `listening` | ユーザーの話に耳を傾けている | 聞いてるよ |
| `thinking` | 答えを考えている（頭が「・・・」になる） | 考え中… |
| `working` | 作業やツールの実行中 | 作業中… |
| `searching` | 調べもの中 | 調べ中… |
| `happy` | うれしい、穏やかな喜び | 😊 |
| `excited` | わくわくしている、期待 | 🤩 |
| `celebrate` | 大成功のお祝い（大回転と虹色の軌跡） | 🎉 |
| `curious` | 興味がある、もっと知りたい | 👀 |
| `confused` | 分からない、確認したい | ❓ |
| `surprised` | 思いがけない知らせ | 😲 |
| `sad` | 残念、申し訳ない | 😢 |
| `angry` | むっとしている（控えめに） | 💢 |
| `bored` | することがなく待っている | 💤 |
| `alerting` | ユーザーの確認が必要、うまくいかなかった（「！」になる） | 要確認！ |
| `notifying` | 新しい結果やお知らせがある（alerting より穏やか） | お知らせ |

既定の一言は端末の言語（日本語・英語・中国語）で出ます。

#### `get_avatar_state`

今の顔の状態を返します。

| 返り値 | 内容 |
|---|---|
| `state` / `since` | 今の状態と、それに変わった時刻 |
| `source` | 誰がその顔にしたか：`mcp`（MCP から）、`voice`（ボタンの会話中）、`idle_life`（待機中の暮らし） |
| `caption` | 今出ている一言 |
| `last_mcp_state` / `last_mcp_at` | 最後に MCP から送られた状態と時刻 |
| `viewer_connected` | 画面が点いていて顔が表示されているか |

`include_image: true` を付けると、画面の小さな画像（160 px の PNG）も返します。

### ボットの状態に合わせた自動の動きについて

Grok の連携（カスタムコネクタ）では、Grok がツールを呼ぶ直前に MCP の接続を開き、呼んだら閉じます。返信を考えている途中や、ほかのツールを使っている様子は Echo Spot に届かないので、「ボットが考えている間は自動で thinking」のような切り替えは、今の仕組みではできません。代わりに次の形で補います。

- ボットが考え始めに `thinking`、ツールの前に `searching` や `working`、返信のときに気持ちを送る（説明文でこの流れを勧めています）
- `duration_sec` と既定の 30 秒で、送りっぱなしでも自動で待機中の暮らしに戻る
- ボットが何も送らなくても、顔は待機中の暮らしで自然に動き続ける

Echo Spot 自身での会話（ボタンで話す Grok Voice）では、会話のイベントから自動で切り替わります（[AVATAR-STATE-SPEC.md](AVATAR-STATE-SPEC.md)）。

## 顔への反映と優先順位

| いつ | どうなるか |
|---|---|
| 会話していないとき | 待機中の暮らしに代わってその状態を、次の呼び出しまで（最長 **30 秒**）表示し、その後は暮らしに戻る。30 秒以内にもう一度呼ぶと延長される。`idle` を送るとすぐ暮らしに戻る |
| Grok Voice で会話中・ユーザーが話している | 無視する（ユーザーの発話 `listening` が最優先） |
| 会話中・Grok が応答している | Grok Voice 自身の `set_avatar_state` と同じ扱い。その応答が終わるまで保ち、最低 2 秒表示する |
| 会話中・応答と応答の間 | 表示する。次のイベント（ユーザーの発話など）で切り替わる |

優先順位はアバター状態遷移の仕様（[AVATAR-STATE-SPEC.md](AVATAR-STATE-SPEC.md)）と同じです。

### 状態が変わったときの強調

MCP から送られた状態を表示するときは、毎回 1 回だけ強調表示をします。「AI が自分の意思で顔を変えた」ことが分かり、表情を見逃しにくくするためです（Grok の追加仕様）。

- 頭が少しだけ大きく弾み、まばたきする
- 頭の縁から白い光の輪が 2 重に広がって消える（約 0.9 秒）。後ろでやわらかく光る

同じ状態がもう一度送られたときも強調します。会話中にユーザーが話していて受け付けなかったときは、強調しません。マイクの入力待ちを示す青い輪（画面の縁）とは、色と位置で区別しています。

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

1. **トンネルを立てる**。おすすめは [ngrok](https://ngrok.com/) です（無料アカウントで固定の URL が 1 つもらえ、HTTPS の 443 番ポートだけでつながるので、制限の厳しいネットワークでも使えます）。

   ```powershell
   winget install --id Ngrok.Ngrok -e
   ngrok update                                  # winget の版は古いことがある
   # authtoken は会話や共有画面に出さないよう、自分の PowerShell ウィンドウで設定する
   ngrok config add-authtoken <ngrok の authtoken>
   # USB でつないだ PC から（adb の転送を使う）
   adb forward tcp:8765 tcp:8765
   ngrok http 8765 --url https://<あなたの固定ドメイン>.ngrok-free.dev
   # Echo Spot と同じ LAN にいる PC からなら、転送なしで
   ngrok http http://<Echo Spot の IP>:8765 --url https://<あなたの固定ドメイン>.ngrok-free.dev
   ```

   固定ドメインは ngrok のダッシュボードの **Domains** にあります。

   [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) のクイックトンネル（`cloudflared tunnel --url http://127.0.0.1:8765`）も使えますが、外向きの 7844 番ポートを使うので、会社や学校などのネットワークではつながらないことがあります。また URL が毎回変わります。

2. **Grok に登録する**：[grok.com/connectors](https://grok.com/connectors) → **New Connector** → **Custom** で、次の URL を入れます（トークンは不要です）。

   ```
   https://<あなたの固定ドメイン>.ngrok-free.dev/mcp
   ```

3. **画面のコードで許可する**：許可画面が開き、同時に **Echo Spot の画面に 6 桁のコード** が出ます（画面が消えていれば点きます）。許可画面にそのコードを入力して「許可する」を押します。
   - 許可画面には、接続を求めているクライアントの名前と、許可後に戻る先のドメインが出ます。心当たりがなければ「拒否する」を押してください。
   - コードの有効期限は 5 分、入力できるのは 5 回までです。
   - ngrok の無料ドメインでは、許可画面の前に ngrok の注意画面（「Visit Site」）が一度出ることがあります。そのまま進んでください。

4. Grok との会話で「今の表情を curious にして」と頼んで、顔が変わるか確かめます。

許可は 24 時間ごとに自動で更新され（更新用の鍵は 180 日有効）、つなぎ直す必要はありません。

### OAuth に対応していないクライアントの場合

URL にトークンを付けて登録します。トークンは端末が最初の起動時に作っています。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-mcp-token.ps1 -Show
```

```
https://<あなたの固定ドメイン>.ngrok-free.dev/mcp?key=<トークン>
```

ヘッダーを設定できるクライアントなら、`Authorization: Bearer <トークン>` を使います。URL のトークンは、トンネルの記録や画面共有に残りやすいので、OAuth が使えるならそちらを使ってください。

### 許可の取り消し

| 取り消したいもの | 方法 |
|---|---|
| OAuth で許可したクライアント全部 | `scripts\set-mcp-token.ps1 -RevokeOAuth`（アプリが再起動します） |
| URL・ヘッダー用のトークン | `scripts\set-mcp-token.ps1`（作り直すと古いトークンは使えなくなる） |

### トンネルの運用

- ngrok の固定ドメインなら、トンネルを立て直しても URL は変わらず、登録し直す必要はありません。cloudflared のクイックトンネルは毎回 URL が変わるので、そのたびに登録し直します。
- トンネルを止めると、Grok からは届かなくなります（LAN 内からは引き続き使えます）。PC の起動時に自動で立てたいときは、ngrok を Windows のサービスとして登録します（`ngrok service install`）。

## セキュリティ

| 対策 | 内容 |
|---|---|
| 認証は常に必要 | 認証のない `/mcp` への要求は 401 で拒否し、OAuth の情報の場所を返す（RFC 9728） |
| OAuth 2.1 | 認可コード＋PKCE（S256）のみ。クライアントは動的登録（RFC 7591）か、クライアント情報の URL（Client ID Metadata Document）。戻り先は https（か localhost）に限る |
| 確認コード | 許可には、Echo Spot の画面に出る 6 桁が必要。有効 5 分・5 回まで。目の前に端末がある人しか許可できない |
| 鍵の保存 | アクセス用の鍵（24 時間）と更新用の鍵（180 日、使うたびに作り直す）は、ハッシュ（SHA-256）だけを端末に保存する |
| 許可画面 | 他のサイトへの埋め込み禁止（`frame-ancestors 'none'`）、外部の読み込み禁止（CSP）、別サイトからの送信を拒否 |
| 端末のトークン | 最初の起動時に端末が作る。`Authorization: Bearer` か `?key=` で使える（OAuth に対応していないクライアント用） |
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

今のトンネルは開発用の構成です（PC で ngrok を動かし、USB の adb 転送で Echo Spot に中継する）。誰でも安全に使える形にするには、次を検討します。

| 課題 | 今 | 方向性 |
|---|---|---|
| PC が要る | PC で ngrok と adb 転送を動かし続ける | Echo Spot だけで完結させる（アプリにトンネルを組み込む、または端末上でトンネルのエージェントを動かす）。後回し |
| 認証 | OAuth 2.1 ＋画面の確認コード（実装済み） | Grok の実際のコネクタで OAuth が最後まで通るかを確かめる |
| 初期設定 | URL を登録して画面のコードを入力するだけ（実装済み）。トークンも端末が作る | トンネルを立てる手順をさらに減らす |
| 中継の運営 | 各自の ngrok アカウント | 共有の中継サーバーは置かない方針（運営が不要で、他人の通信を預からない）。各自が自分のトンネルのアカウントを使う |

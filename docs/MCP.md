# MCP サーバー（GrokBot から顔を動かす）

スマホや PC で使っている自分の GrokBot から、Echo Spot の顔を動かせるようにする仕組みです。GrokSpot は [MCP](https://modelcontextprotocol.io/)（Model Context Protocol）のサーバーを内蔵し、ツール `set_avatar_state` を 1 つ公開しています。

- 元の仕様：「GrokSpot × GrokBot アバター出力インターフェース 仕様（実装担当向け）」2026-10-22（Grok 著）
- 実装：`app/src/main/java/com/grokbot/grokspot/McpServer.kt`（サーバー）、`app/src/main/assets/web/external.js`（顔への反映）

## 概要

| 項目 | 内容 |
|---|---|
| トランスポート | Streamable HTTP（MCP 標準。応答は JSON で返し、SSE のストリームは使わない） |
| エンドポイント | `POST http://<Echo Spot の IP>:8765/mcp` |
| ポート | 8765（固定。`McpServer.PORT`） |
| 起動 | アプリの起動と同時に自動で立ち上がる。ボタンの会話（Grok Voice）とは独立して動く |
| ツール | `set_avatar_state(state)` の 1 つ |
| 認証 | 既定はなし（LAN 内向け）。トークンを設定すると必須になる（後述） |
| 対応プロトコル版 | 2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05 |

### ツールの定義

```json
{
  "name": "set_avatar_state",
  "description": "画面に表示されているアバターの表情・状態を変更する。音声には影響しない。 Changes the expression/state of the avatar shown on the screen. It does not affect speech.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "state": {
        "type": "string",
        "description": "表示する状態名 / the state to show",
        "enum": ["idle", "listening", "thinking", "working", "searching", "happy", "excited", "curious",
                 "confused", "surprised", "sad", "angry", "celebrate", "bored", "alerting", "notifying"]
      }
    },
    "required": ["state"]
  }
}
```

結果は `{"ok": true, "applied": true}` です。候補にない状態名は無視して、エラーにせず `{"ok": true, "applied": false}` を返します（voice.js と同じ扱い）。

## 顔への反映と優先順位

| いつ | どうなるか |
|---|---|
| 会話していないとき | 待機中の暮らしに代わってその状態を **15 秒** 表示し、その後は暮らしに戻る。15 秒以内にもう一度呼ぶと延長される。`idle` を送るとすぐ暮らしに戻る |
| Grok Voice で会話中・ユーザーが話している | 無視する（ユーザーの発話 `listening` が最優先） |
| 会話中・Grok が応答している | Grok Voice 自身の `set_avatar_state` と同じ扱い。その応答が終わるまで保ち、最低 2 秒表示する |
| 会話中・応答と応答の間 | 表示する。次のイベント（ユーザーの発話など）で切り替わる |

優先順位はアバター状態遷移の仕様（[AVATAR-STATE-SPEC.md](AVATAR-STATE-SPEC.md)）と同じです。

## 動作確認（PC から）

USB（adb）でつないだ Echo Spot に、PC から送れます。スクリプトが adb の転送（PC の 8765 → 端末の 8765）を自動で設定します。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mcp-call.ps1 -List     # ツールの一覧
powershell -ExecutionPolicy Bypass -File scripts\mcp-call.ps1 curious   # 顔を curious にする
```

同じ LAN にいるなら、端末の IP に直接送れます（端末の IP は「設定 → ネットワーク → Wi-Fi」か `adb shell ip -4 addr show wlan0` で確認できます）。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mcp-call.ps1 happy -Url http://<Echo Spot の IP>:8765/mcp
```

curl の場合：

```bash
curl -X POST http://<Echo Spot の IP>:8765/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"set_avatar_state","arguments":{"state":"happy"}}}'
```

公式の [MCP Inspector](https://github.com/modelcontextprotocol/inspector) でも確認できます。

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8765/mcp --transport http --method tools/list
```

### ネットワークの注意

- Android（LineageOS）にはファイアウォールがないので、端末側の設定は不要です。
- つながらないときは、Wi-Fi ルーターやスマホのテザリングの「端末どうしの通信を禁止する」設定（AP アイソレーション、プライバシーセパレーター）を確認してください。
- 端末の IP はルーターに決められるので変わることがあります。固定したいときはルーター側で割り当てを予約してください。

## GrokBot（公式の Grok）に登録する

Grok のカスタムコネクタは、**インターネットから届く URL** しか登録できません（`localhost` や LAN のアドレスは受け付けません）。そのため、トンネルで公開用の URL を作ります（[xAI のドキュメント](https://docs.x.ai/grok/connectors)）。

> **公開する前に、必ずトークンを設定してください。** トークンなしで公開すると、URL を知っている誰でも顔を変えられます。

1. **トークンを設定する**（端末に保存され、すぐに有効になります。表示されたトークンは控えておいてください）

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\set-mcp-token.ps1
   ```

2. **トンネルを立てる**。おすすめは [ngrok](https://ngrok.com/) です（無料アカウントで固定の URL が 1 つもらえ、HTTPS の 443 番ポートだけでつながるので、制限の厳しいネットワークでも使えます）。

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

3. **Grok に登録する**：[grok.com/connectors](https://grok.com/connectors) → **New Connector** → **Custom** で、次の URL を入れます。認証方式を選ぶ欄があれば「なし」にします（トークンは URL に入っているため）。

   ```
   https://<あなたの固定ドメイン>.ngrok-free.dev/mcp?key=<トークン>
   ```

   ヘッダーを設定できる画面なら、`Authorization: Bearer <トークン>` を使っても構いません。

4. Grok との会話で「今の表情を curious にして」と頼んで、顔が変わるか確かめます。

- ngrok の固定ドメインなら、トンネルを立て直しても URL は変わらず、登録し直す必要はありません。cloudflared のクイックトンネルは毎回 URL が変わるので、そのたびに登録し直します。
- トンネルを止めると、Grok からは届かなくなります（LAN 内からは引き続き使えます）。PC の起動時に自動で立てたいときは、ngrok を Windows のサービスとして登録します（`ngrok service install`）。
- トークンをやめるときは `scripts\set-mcp-token.ps1 -Remove`（LAN 内だけで使う場合）。

## セキュリティ

| 対策 | 内容 |
|---|---|
| トークン | `files/mcp_token` があれば、`Authorization: Bearer` か `?key=` が一致しない要求を 401 で拒否する |
| Origin の拒否 | `Origin` ヘッダー付きの要求（＝ブラウザからの要求）は 403 で拒否する。同じ LAN の Web ページから勝手に呼ばれるのを防ぐ（DNS リバインディング対策） |
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

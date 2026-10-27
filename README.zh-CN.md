# GrokSpot

[日本語](README.md) | [English](README.en.md) | **中文**

这是一款 Android 应用，可以把 Echo Spot（Amazon 于 2017 年推出的圆形屏幕设备）改造成**和你说话时会用表情回应的 GrokBot 专用设备**。
它运行在刷入 LineageOS 的 Echo Spot 上，通过 xAI 的 Grok Voice API 与你语音对话。

> **这是一个非官方项目。** 与 xAI、Amazon 没有任何关系，也未获得其认可。
> “Grok”是 xAI 的商标，“Echo Spot”是 Amazon 的商标。

<p align="center">
  <img src="docs/screenshot-listening.png" width="240" alt="等待你说话的 GrokSpot">
</p>

![各状态的变形](docs/screenshot-morphs.png)

## 为什么做这个

- 看着 GrokBot 的头像，我突然想：如果把它显示在 Echo Spot 上会怎样？买了一台二手的，发现它的静音按钮图标看起来就像 Grok，从此再也想不出它还能有别的用途。
- **为了给 AI 一张“脸”。** 只有声音的 AI，很难看出它是在听、在思考，还是已经说完了。GrokSpot 用表情和动作把这些表现出来。
- **为了让它像活着一样。** 待机时也不会变成一张静止的画：它会自己东张西望、打盹，晚上会睡觉。你碰它，它会有反应。

## 功能

| 功能 | 说明 |
|---|---|
| 语音对话 | 按下机身顶部的按钮（原本是麦克风关闭按钮）即可与 Grok Voice 对话。打开搜索后，天气、新闻等问题 Grok 会搜索网页和 X 后回答。再按一次，或 60 秒不说话，对话结束 |
| 表情联动 | 用表情显示对话的进展（在听 → 在思考 → 在说话 → 待机）。有时 Grok 会自己选择表情 |
| 等待输入的提示 | 可以说话时，屏幕边缘会亮起蓝光，并显示提示文字 |
| 待机时的日常 | 休息时也会不停做些小动作，并把东张西望、想事情、哼歌、涂鸦、玩耍、尝试变形等每次重新组合、自然衔接。心情和精力会影响它的选择，偶尔还会打喷嚏或一个人跳舞。晚上一直睡到早上 |
| 触摸 | 眼睛和头会跟着手指转动。摸头顶、戳眼睛、戳身体、碰空白处、连续点击，反应各不相同 |
| 从 GrokBot 控制（MCP） | 内置的 MCP 服务器（端口 8765）提供工具 `set_avatar_state`（屏幕下方会显示与状态相符的表情符号）和 `get_avatar_state`，手机或电脑上的 GrokBot 可以借此改变表情。详见 [docs/MCP.md](docs/MCP.md)（日语） |
| 变形和特效 | 思考中的“…”、警告的“！”、雷达、进度环、笔等 14 种变形，以及彩纸和彩虹轨迹 |
| 作为专用设备 | 作为主屏幕应用启动。房间变暗时屏幕熄灭，变亮时重新点亮。长按按钮打开电源菜单 |
| 声音和颜色 | 每台设备都可以选择 Grok 的声音（eve、iris 等）以及脸、眼睛和背景的颜色。例如白色的 Echo Spot 可以用粉色的脸配白色背景 |

截图：待机时的日常（玩耍 → 哼歌 → 犯困 → 睡觉 → 醒来）

![待机时的日常](docs/screenshot-life.png)

## 需要准备

- 刷入 **LineageOS 18.1（Android 11）** 的 **Echo Spot（第一代，2017 年）**。
  使用的是非官方移植版。刷机的**大致流程和容易出错的地方**整理在 [docs/SETUP.md](docs/SETUP.md) 的 A、B 两节（日语；作者在两台设备上実际操作的步骤）。详细内容和最新信息以下方的 XDA 帖子为准。**改动设备可能无法恢复原状，请自行承担风险。**

  刷机参考（非官方）：
  - 解锁和 TWRP：[XDA - UNLOCK/ROOT/TWRP for Echo Spot 2017 (rook)](https://xdaforums.com/t/unlock-root-twrp-unbrick-amazon-echo-spot-2017-rook.4754878/)
  - LineageOS 18.1 ROM：[XDA - LineageOS 18.1 for the Amazon Echo Spot (2017)](https://xdaforums.com/t/rom-unofficial-11-rook-lineageos-18-1-for-the-amazon-echo-spot-2017.4762459/)
  - 下载构建版本：[amazon-oss/releases](https://github.com/amazon-oss/releases/releases/tag/lineage-18.1-rook-v0.3)
- Windows 电脑（脚本使用 PowerShell；Android 构建本身在 macOS / Linux 上也可以）
  - Android Studio（使用其附带的 JDK 和 Android SDK）
  - Node.js（仅在修改表情绘制库时需要。仓库已附带构建好的版本，平时不需要）
  - adb（Android SDK Platform-Tools）
- **xAI 的 API 密钥**（Grok Voice 按用量收费，参考下方的“[Grok Voice 的费用与搜索](#grok-voice-的费用与搜索)”）

`docs/` 下的详细文档和脚本输出的信息都是日语。应用的屏幕文字和设置界面的文字会跟随设备语言在日语、英语和中文之间切换，Grok 则会用你说话的语言回答。

## 快速开始

详细步骤见 [docs/SETUP.md](docs/SETUP.md)（日语）。大致流程如下：

```powershell
# 0. 给 Echo Spot 刷入 LineageOS，并打开 USB 调试（SETUP.md 的 A、B 两节）
git clone https://github.com/shibainu-inu/grokspot.git
cd grokspot

# 1. 构建应用并安装到 Echo Spot（表情绘制库已附带构建好的版本）
.\gradlew.bat :app:installDebug

# 2. 把 API 密钥复制到剪贴板，然后写入设备
powershell -ExecutionPolicy Bypass -File scripts\set-api-key.ps1

# 3. 启用按钮服务，并设为主屏幕应用（SETUP.md 的第 5～7 步）

# 4. 设置显示语言和时区（SETUP.md 的 B-5 或第 8 步）。Grok 会用你说话的语言回答

# 5. 按喜好更改声音和颜色（SETUP.md 的第 9 步）
powershell -ExecutionPolicy Bypass -File scripts\set-voice.ps1 iris
powershell -ExecutionPolicy Bypass -File scripts\set-face-color.ps1 pink -Eye white -Background white
```

> **小技巧**：在电脑上使用 Claude Code 等 AI 编程工具，并用 Micro USB 连着 Echo Spot 进行操作，构建和调整都会轻松很多。把安装文档交给它，它会依次执行 `adb` 命令；“把脸改成浅蓝色”“换个声音”之类的调整，也只需让它稍微修改脚本和设置。详见 [docs/SETUP.md](docs/SETUP.md) 的“Tips”。

### Grok Voice 的费用与搜索

用按钮进行的对话（Grok Voice）按 xAI API 的用量计费。价格可能会变，使用前请查看 [xAI 的价格页面](https://docs.x.ai/docs/models)（以下为 2026 年 10 月时的参考价格）。

| 项目 | 参考价格 |
|---|---|
| Grok Voice（语音对话） | 每分钟 0.08 美元（每小时 4.80 美元） |
| 网页搜索 | 每 1,000 次約 5 美元（每次約 0.005 美元） |
| X 搜索 | 每 1,000 次約 5 美元。也有消息称已改为按获取的帖子和个人资料数量计费，单次搜索可能更贵 |

- 对话只在按下按钮之后、到再按一次或 60 秒不说话自动断开之前保持连接。未连接时不产生费用。
- 费用主要取决于对话的时长。使用搜索时回答往往更长，语音费用也会相应增加。
- 如果担心用量，可以在 xAI 控制台查看用量或设置上限。

**搜索默认是关闭的。** 关闭时也能对话，但无法回答天气、新闻等最新信息。要打开搜索，请在电脑上运行以下命令（从下一次对话开始生效）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-voice-search.ps1 -Web        # 只打开网页搜索（推荐）
powershell -ExecutionPolicy Bypass -File scripts\set-voice-search.ps1 -Web -X     # 同时打开 X 搜索
powershell -ExecutionPolicy Bypass -File scripts\set-voice-search.ps1 -Off        # 关闭
powershell -ExecutionPolicy Bypass -File scripts\set-voice-search.ps1             # 查看当前设置
```

打开搜索后，Grok 会在需要时自己先搜索再回答。搜索期间，表情会变成“正在找”的样子。

### 用自己的 GrokBot 控制表情（可选）

也可以从手机或电脑上的 Grok（grok.com）改变表情。应用会用你自己的 ngrok 账号打开隧道，公开 Echo Spot 的 MCP 服务器，再把这个 URL 注册为 Grok 的自定义连接器。不需要让电脑一直开着，也不经过共享的中转服务器。

详细步骤（ngrok 的设置、注册连接器、用触摸屏幕后出现的 6 位验证码进行授权、给 Grok 的指示等）见 [docs/MCP.md](docs/MCP.md)（日语；推荐给 Grok 的指示也附有英文版）。

授权完成后，对 Grok 说“把 Echo Spot 的表情改成 curious”，屏幕上的表情就会变化。授权使用 OAuth 2.1，需要输入触摸 Echo Spot 屏幕后出现的验证码，所以只有站在 Echo Spot 面前的人才能授权。

## 文件结构

```
app/src/main/java/com/grokbot/grokspot/
  MainActivity.kt        全屏 WebView。按钮开始和结束对话；长按表情 5 秒可打开系统设置（应急入口）
  VoiceSession.kt        与 Grok Voice（wss://api.x.ai/v1/realtime）的对话：麦克风上传、音频播放、事件通知
  McpServer.kt           MCP 服务器（Streamable HTTP，端口 8765）。工具 set_avatar_state / get_avatar_state
  McpAuth.kt             MCP 的 OAuth 2.1（用屏幕上的验证码授权）
  NgrokTunnel.kt         在应用内打开连接 MCP 服务器的 ngrok 隧道（Wi-Fi 恢复后立即重连）
  GrokButtonService.kt   无障碍服务：按钮操作（按下、双击、长按），以及暗处的屏幕开关
app/src/main/assets/web/
  index.html             表情页面，包括等待输入的光环和文字
  i18n.js                屏幕文字（日语、英语、中文）
  grokbot.js             表情绘制库（在 grokbot-web 上加入新功能后构建的版本）
  motion.js              身体动作、眨眼、视线和 14 种变形
  fx.js                  彩纸、彩虹轨迹和变形部件的绘制
  actions.js             “听”“思考”等动作 → 表情的对应表
  voice.js               对话事件 → 表情（规范见 docs/AVATAR-STATE-SPEC.md）
  external.js            来自 MCP 的状态 → 表情、屏幕下方的表情符号、边缘的光
  pairing.js             在屏幕上显示 OAuth 验证码
  life.js                待机时的日常（精力值、白天和夜晚）
  touch.js               根据触摸位置做出的反应
device/
  Vendor_2454_Product_6500.kl   把麦克风关闭按钮变成 Grok 按钮的按键映射
scripts/
  build-web.ps1          修改绘制库后重新生成 grokbot.js（平时不需要）
  set-api-key.ps1        把 API 密钥写入设备上应用的私有存储
  set-voice-search.ps1   打开或关闭 Grok Voice 的搜索（网页、X；默认关闭）
  set-mcp-token.ps1      管理 MCP 认证（显示或重建令牌、撤销 OAuth 授权）
  mcp-call.ps1           从电脑调用 MCP 服务器，检查是否正常工作
  set-ngrok.ps1          写入 ngrok 的 authtoken 和域名，让应用打开隧道
  set-voice.ps1          选择 Grok Voice 的声音（默认 eve）
  set-face-color.ps1     选择脸、眼睛和背景的颜色（默认白色的脸、黑色的眼睛、黑色背景）
docs/（日语）
  SETUP.md               从准备设备到安装的详细步骤
  DESIGN.md              设计意图和工作原理
  AVATAR-STATE-SPEC.md   对话中头像状态变化的规范（Grok Voice API 版）
  MCP.md                 MCP 服务器的用法，以及注册到 GrokBot 的步骤
```

设计思路（为什么用函数调用传递表情、为什么对话中不能打断等）见 [docs/DESIGN.md](docs/DESIGN.md)；对话中头像的状态变化见与 Grok 共同整理的规范 [docs/AVATAR-STATE-SPEC.md](docs/AVATAR-STATE-SPEC.md)。

## 已知限制

- **麦克风灵敏度不高。** Echo Spot 的麦克风灵敏度一般，可能需要离设备稍近一些说话，或者声音大一点，才能稳定识别。
- 実际使用中发现，孩子们本来就习惯大声且近距离说话，所以似乎不太受影响。他们一起玩的时候倒是帮了大忙。
- **Grok 说话时不能打断。** Echo Spot 没有回声消除功能，所以 Grok 说话时不会发送麦克风的声音。
- **显示语言支持日语、英语和中文（简体）。** 屏幕文字和设置界面的文字会跟随设备语言切换（其他语言时使用英语）。Grok 会用你说话的语言回答。要添加语言，请在 `res/values-xx/strings.xml` 和 `assets/web/i18n.js` 中添加。
- **API 密钥以明文保存在设备中。** 本应用设想的是一个人使用的专用设备。密钥保存在应用的私有存储中（其他应用无法读取），不会进入 APK 和仓库。
- 以调试版构建为前提（写入 API 密钥时使用 `run-as`）。
- 未在 Echo Spot（LineageOS 18.1）以外的设备上测试过。

## 致谢和许可

- 表情使用 [grokbot-web](https://github.com/Coiggahou2002/grokbot-web)（BSD-3-Clause）绘制。grokbot-web 是 [nasawz/GrokBot](https://github.com/nasawz/GrokBot)（Flutter 版，BSD-3-Clause）的移植版。表情、形状和状态的设计归原作者所有。
  附带的是在 grokbot-web 上加入 GrokSpot 用功能（眼睑、眨单眼、眼距、帧率上限等）后构建的**修改版**。新增功能的列表见 [docs/SETUP.md](docs/SETUP.md) 的第 1 步。
- 身体动作（motion.js）参考了 xAI 的文章 [Designing Grok Bot](https://x.ai/news/designing-grok-bot) 中公开的头像行为，由作者独立实现。
- 附带和依赖的软件的许可声明汇总在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中。
- GrokSpot 本身采用 [BSD-3-Clause](LICENSE) 许可。

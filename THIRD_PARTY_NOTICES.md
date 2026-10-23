# Third-party notices

GrokSpot bundles the following software.

## grokbot-web

- Used as: `app/src/main/assets/web/grokbot.js`, a **modified** build: grokbot-web as of 2026-09-09
  with face options added for GrokSpot (eyeOpen, eyeOpenEach, eyeGap, eyeWidth, minEyeGap,
  evenEyes, bodyScale, lidAxis, maxFrameRate, manualFrames/frame()). See docs/SETUP.md, step 1.
- Upstream: https://github.com/Coiggahou2002/grokbot-web (a port of https://github.com/nasawz/GrokBot)
- License: BSD-3-Clause

```
BSD 3-Clause License

Copyright (c) 2026, nasawz
Copyright (c) 2026, grokbot-web contributors
All rights reserved.

This project is a TypeScript / Canvas 2D port of nasawz/GrokBot
(https://github.com/nasawz/GrokBot). The expression, shape and state tables and
the rendering and animation math are derived from that work and remain under
the license below.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Gradle dependencies (not vendored; downloaded at build time)

| Library | License |
|---|---|
| AndroidX Activity, Core KTX, WebKit | Apache-2.0 |
| OkHttp 4.12.0 (and Okio) | Apache-2.0 |
| Kotlin standard library | Apache-2.0 |
| ngrok-java 1.1.1 and ngrok-java-native 1.1.1 (linux-android-armv7) | Apache-2.0 OR MIT |
| SLF4J API 2.0.6 | MIT |

ngrok-java-native's `libngrok_java.so` is **modified** when the APK is built: the value its
`JNI_OnLoad` returns is changed from JNI_VERSION_1_8 to JNI_VERSION_1_6 (one byte), because
Android refuses 1.8. The library is also moved from the jar into the APK's `lib/`. See
`app/build.gradle.kts` and docs/MCP.md. Upstream: https://github.com/ngrok/ngrok-java

If you distribute a built APK, include these notices with it.

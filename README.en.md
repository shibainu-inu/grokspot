## Known limitations

- **The microphone is not very sensitive.** The Echo Spot's mic has modest sensitivity, so you may need to speak a little closer to the device or a bit louder for it to pick you up reliably.
- From using it: kids tend to speak loudly and close by anyway, so it doesn't seem to bother them much. They've been playing with it, which is helpful.
- **You can't interrupt Grok while it speaks.** The Echo Spot has no echo canceler, so the mic audio is not sent while Grok is talking.
- **Display languages are Japanese, English and Chinese (Simplified).** The screen texts and the settings texts follow the device language (English for any other language). Grok answers in the language you speak to it. To add a language, add it to `res/values-xx/strings.xml` and `assets/web/i18n.js`.
- **The API key is stored on the device in plain text.** It is meant for a dedicated device used by one person. The key is kept in the app's private storage (other apps can't read it) and is never in the APK or the repository.
- It assumes a debug build (writing the API key uses `run-as`).
- Not tested on devices other than the Echo Spot (LineageOS 18.1).
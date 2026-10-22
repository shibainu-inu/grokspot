// GrokSpot i18n: the words shown on the page, per language.
//
// The app opens the page as index.html?lang=ja|en|zh, using the language
// Android picked for its own resources (res/values*/strings.xml), so the page,
// the Android settings and Grok's spoken language always match. Opened without
// it (a desktop browser), the browser language decides. Unknown → English.
//
// To add a language: add a column here and a res/values-xx/strings.xml.
(function () {
  'use strict';

  var STRINGS = {
    en: {
      'mic.waiting': 'Talk to me',
      'mic.hearing': 'Listening…',
      'pair.title': 'Connection request',
      'pair.hint': 'Enter this code on the approval page',
      'pair.done': 'Connected',
      'caption.thinking': 'Thinking',
      'caption.working': 'Working',
      'caption.searching': 'Searching',
      'caption.alerting': 'Check this',
      'caption.notifying': 'News',
      'caption.listening': 'Listening',
    },
    ja: {
      'mic.waiting': '話しかけてください',
      'mic.hearing': '聞いています…',
      'pair.title': '接続の確認',
      'pair.hint': '許可画面にこのコードを入力してください',
      'pair.done': '接続しました',
      'caption.thinking': '考え中',
      'caption.working': '作業中',
      'caption.searching': '検索中',
      'caption.alerting': '要確認',
      'caption.notifying': 'お知らせ',
      'caption.listening': '聞いてる',
    },
    zh: {
      'mic.waiting': '请跟我说话',
      'mic.hearing': '正在听…',
      'pair.title': '连接确认',
      'pair.hint': '请在授权页面输入此代码',
      'pair.done': '已连接',
      'caption.thinking': '思考中',
      'caption.working': '处理中',
      'caption.searching': '搜索中',
      'caption.alerting': '请确认',
      'caption.notifying': '新消息',
      'caption.listening': '在听',
    },
  };
  var HTML_LANG = { en: 'en', ja: 'ja', zh: 'zh-Hans' };

  function pick() {
    var asked = new URLSearchParams(location.search).get('lang');
    if (asked && STRINGS[asked]) return asked;
    var browser = (navigator.language || 'en').toLowerCase();
    if (browser.indexOf('ja') === 0) return 'ja';
    // Simplified Chinese only; Traditional Chinese falls back to English like the app does.
    if (browser.indexOf('zh') === 0 && !/-(tw|hk|mo|hant)/.test(browser)) return 'zh';
    return 'en';
  }

  var lang = pick();
  document.documentElement.lang = HTML_LANG[lang];

  window.grokspotI18n = {
    lang: lang,
    /** The text for `key` in the current language (English if missing). */
    t: function (key) {
      var text = STRINGS[lang][key];
      return text !== undefined ? text : STRINGS.en[key];
    },
  };
})();

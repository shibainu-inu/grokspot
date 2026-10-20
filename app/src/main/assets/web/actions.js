// GrokSpot actions: what the device is doing → which avatar state it shows.
//
// The voice integration (and anything else) calls grokspot.act('listen') and
// so on instead of naming avatar states directly. The table follows the Grok
// Bot avatar motion system (x.ai: idle, working, waiting, blocked, thinking,
// done) and, for the other states, uses taken from watching the avatar's
// behaviour.
(function () {
  'use strict';

  // then/ms: a one-off reaction that settles into another action afterwards.
  var ACTIONS = {
    idle: { state: 'idle', note: '待機中：life.js が休む・眺める・うたた寝・眠るなどを自分で続ける' },
    wake: { state: 'waking', then: 'idle', ms: 3000, note: '呼ばれて目覚める（紙吹雪が少し出る）' },
    listen: { state: 'listening', note: 'ユーザーが話している' },
    think: { state: 'thinking', note: '考え中（顔が「・・・」になる）' },
    search: { state: 'searching', note: 'Web 検索・調べもの' },
    work: { state: 'working', note: 'ツール実行などの作業中' },
    speak: { state: 'dictating', note: 'Grok が話している（音量で点の波が動く）' },
    wait: { state: 'bored', note: '返事待ち' },
    help: { state: 'alerting', note: '手助けが必要・エラー（顔が「！」になる）' },
    notify: { state: 'notifying', note: '新しい結果・通知' },
    happy: { state: 'happy', then: 'idle', ms: 4000, note: 'お礼を言われた・うまくいった' },
    done: { state: 'celebrate', then: 'idle', ms: 4200, note: '大きな作業が完了（虹色の軌跡）' },
    sleep: { state: 'sleeping', note: '長く使われていない' },
    shutdown: { state: 'powering-down', note: '終了する' },
  };

  // Going idle hands the face to life.js (resting, looking around, dozing off,
  // sleeping...). Coming back from something else gives it a little energy.
  var IDLE_BOOST = 0.15;

  var followTimer = null;
  var current = null;

  function show(state) {
    window.grokspotLife.stop();
    if (window.stopTour) window.stopTour();
    window.motion.setState(state);
  }

  /** Shows the avatar for `name` (a key of ACTIONS). Returns false for an unknown action. */
  function act(name) {
    var action = ACTIONS[name];
    if (!action) {
      console.warn('grokspot.act: unknown action ' + name);
      return false;
    }
    clearTimeout(followTimer);
    current = name;
    // During a conversation idle just means waiting for the user, so no life.
    var talking = window.grokspot.voice && window.grokspot.voice.connected();
    if (name === 'idle' && !talking) {
      window.grokspotLife.resume(IDLE_BOOST);
      return true;
    }
    show(action.state);
    if (action.then) followTimer = setTimeout(function () { act(action.then); }, action.ms);
    return true;
  }

  /**
   * Shows an avatar state by its grokbot-web name, outside the ACTIONS table
   * (the voice integration and Grok's own set_avatar_state use this).
   * Returns false for an unknown state, leaving the current one.
   */
  function state(name) {
    if (!window.isBotState(name)) {
      console.warn('grokspot.state: unknown state ' + name);
      return false;
    }
    clearTimeout(followTimer);
    current = null;
    show(name);
    return true;
  }

  /**
   * The Grok button (Echo Spot "mic off" button). A press starts or ends a
   * conversation in the app itself; the page only hears 'hold', sent once a
   * 3-second hold has opened the power menu.
   */
  function button(kind) {
    console.info('Grok button: ' + kind);
  }

  window.grokspot = {
    act: act,
    state: state,
    button: button,
    actions: ACTIONS,
    current: function () { return current; },
    /** Voice level 0..1 while speaking; call it ~10-30 times a second from the audio. */
    voiceLevel: function (level) { window.motion.setVoiceLevel(level); },
    burst: function () { window.motion.burst(); },
  };
})();

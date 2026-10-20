// Grok Voice → avatar state (GrokBot アバター状態連携 仕様書).
//
// The app (VoiceSession.kt) reports the realtime API's events as
// grokspot.voice.event(type, detail). Only these switch the avatar on their own:
//
//   speech_started   → listening   the user started talking (always wins)
//   response_created → thinking    Grok started on a reply
//   audio_started    → working     the reply's audio started playing
//   tool_call        → searching   Grok called a tool
//   response_done    → idle        the reply finished playing
//   disconnected     → idle
//
// Grok can also pick a state itself through set_avatar_state (avatar_state).
// That state wins over thinking/working/searching until the reply ends or the
// user speaks, and is shown for at least AI_STATE_MIN_MS.
//
// Whether the mic is open is shown apart from the face (ring and hint in
// index.html): "waiting" while it waits for the user, "hearing" while the user
// talks, nothing while Grok thinks or speaks (the mic is muted then).
(function () {
  'use strict';

  var AI_STATE_MIN_MS = 2000;
  // Speech that never gets a reply (a cough, the TV) should not leave it listening.
  var LISTEN_TIMEOUT_MS = 8000;
  // How long a failed start shows the "!" face.
  var FAIL_MS = 3000;

  var connected = false;
  var shown = null;
  var aiState = null;
  var aiSince = 0;
  var pending = null;
  var failed = false;

  var MIC_HINTS = { waiting: '話しかけてください', hearing: '聞いています…' };
  var micHint = document.getElementById('mic-hint');

  function mic(mode) {
    if (mode) {
      document.body.dataset.mic = mode;
      micHint.textContent = MIC_HINTS[mode];
    } else {
      delete document.body.dataset.mic;
    }
  }

  function cancelPending() {
    clearTimeout(pending);
    pending = null;
  }

  function later(ms, fn) {
    cancelPending();
    pending = setTimeout(function () { pending = null; fn(); }, ms);
  }

  function apply(state) {
    if (state === shown) return;
    shown = state;
    if (state === 'idle') window.grokspot.act('idle');
    else window.grokspot.state(state);
  }

  /** An automatic (event driven) state; Grok's own pick holds it off. */
  function auto(state) {
    cancelPending();
    if (!aiState) apply(state);
  }

  function event(type, detail) {
    console.info('voice: ' + type + (detail ? ' ' + detail : ''));
    switch (type) {
      case 'connected':
        connected = true;
        failed = false;
        aiState = null;
        cancelPending();
        shown = null;
        window.grokspot.act('wake');
        mic('waiting');
        break;
      case 'speech_started':
        aiState = null;
        cancelPending();
        apply('listening');
        mic('hearing');
        later(LISTEN_TIMEOUT_MS, function () {
          apply('idle');
          mic('waiting');
        });
        break;
      case 'speech_stopped':
        break;
      case 'response_created':
        auto('thinking');
        mic(null);
        break;
      case 'audio_started':
        auto('working');
        break;
      case 'tool_call':
        if (shown !== 'listening') auto('searching');
        break;
      case 'avatar_state':
        if (!window.isBotState(detail)) {
          console.warn('voice: ignoring unknown avatar_state ' + detail);
          return;
        }
        if (shown === 'listening') return;
        cancelPending();
        aiState = detail;
        aiSince = Date.now();
        apply(detail);
        break;
      case 'response_done':
        // A follow-up reply is on its way, or the user has already cut in.
        if (detail === 'continuing' || shown === 'listening') return;
        var wait = aiState ? Math.max(0, AI_STATE_MIN_MS - (Date.now() - aiSince)) : 0;
        later(wait, function () {
          aiState = null;
          apply('idle');
          mic('waiting');
        });
        break;
      case 'error':
        // Errors during a conversation leave the face alone; a failed start shows "!".
        if (!connected) {
          failed = true;
          cancelPending();
          apply('alerting');
        }
        break;
      case 'disconnected':
        connected = false;
        aiState = null;
        mic(null);
        later(failed ? FAIL_MS : 0, function () {
          failed = false;
          apply('idle');
        });
        break;
      default:
        console.warn('voice: unknown event ' + type);
    }
  }

  window.grokspot.voice = {
    event: event,
    connected: function () { return connected; },
  };
})();

// GrokSpot external states: the avatar set from outside, over MCP
// (McpServer.kt, tool set_avatar_state), for example by the user's own GrokBot
// chatting on a phone or PC.
//
// - During a Grok Voice conversation the state goes through voice.js
//   (external_state), so its priorities apply: the user speaking wins, and
//   during a reply it holds like Grok Voice's own set_avatar_state.
// - Otherwise it takes the face over from the idle life until the next call or
//   the hold (duration_sec, or by default STEP_HOLD_MS for in-progress states and
//   HOLD_MS for the rest), then the idle life comes back.
//   "idle" hands the face back at once. A new call restarts the hold.
// - Every change that is shown gets one emphasis, so it is clear the agent chose
//   this face: the head pops and blinks (motion.emphasize) and the screen edge
//   lights up once, in the same style as the mic ring.
// - A caption goes with the state, in the same place and style as the mic hint
//   ("話しかけてください"): an emoji or a short word, the agent's own or by default
//   (an emoji for a feeling, a word for an action). It goes away with the state.
(function () {
  'use strict';

  // Long enough not to be missed (追加仕様：状態変更時の強調＋キープ).
  // In-progress states go stale fast (the reply is usually done within seconds), feelings can linger.
  var STEP_HOLD_MS = 7000;
  var HOLD_MS = 15000;
  var STEPS = { thinking: true, searching: true, working: true };
  var MAX_HOLD_MS = 600000;
  // How often to check that the captioned state is still the one showing.
  var CAPTION_CHECK_MS = 400;

  // Default captions. Feelings get an emoji; actions a word: in English for every
  // language (WORD), or from i18n.js (caption.<state>) for the rest.
  // No face emoji: they are hard to make out at this size on the Echo Spot.
  var EMOJI = {
    happy: '❤️', excited: '✨', celebrate: '🎉', curious: '👀', confused: '❓',
    surprised: '⁉️', sad: '💧', angry: '💢', bored: '💤',
  };
  var WORD = { thinking: 'Thinking', working: 'Working', searching: 'Searching', listening: 'Listening' };
  var PHRASE = { alerting: true, notifying: true };

  var hold = null;
  var ring = document.getElementById('mcp-ring');
  var bubble = document.getElementById('caption');
  var captionState = null;
  var captionCheck = null;
  var last = { state: null, since: null, caption: null };

  /** The one-off emphasis: a pop and blink of the head and a flash of the screen edge. */
  function emphasize() {
    window.motion.emphasize();
    ring.classList.remove('flash');
    // Restart the animation even if it is still running.
    void ring.offsetWidth;
    ring.classList.add('flash');
  }

  function talking() {
    return window.grokspot.voice && window.grokspot.voice.connected();
  }

  function defaultCaption(name) {
    if (EMOJI[name]) return EMOJI[name];
    if (WORD[name]) return WORD[name];
    if (PHRASE[name]) return window.grokspotI18n.t('caption.' + name);
    return '';
  }

  function hideCaption() {
    clearInterval(captionCheck);
    captionCheck = null;
    captionState = null;
    bubble.classList.remove('show');
    document.body.classList.remove('captioned');
    last.caption = null;
  }

  function showCaption(name, text) {
    hideCaption();
    if (!text) return;
    bubble.textContent = text;
    // A lone emoji is drawn bigger than words.
    bubble.classList.toggle('emoji', /^\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*$/u.test(text));
    bubble.classList.add('show');
    document.body.classList.add('captioned');
    captionState = name;
    last.caption = text;
    // Gone as soon as the face shows something else (the hold ended, a conversation moved on).
    captionCheck = setInterval(function () {
      if (window.getBotState() !== captionState) hideCaption();
    }, CAPTION_CHECK_MS);
  }

  /**
   * Shows `name` from an external agent. caption: text, "" for none, or
   * null for the default. holdMs: how long before the idle life returns.
   * Returns false for an unknown state.
   */
  function state(name, caption, holdMs) {
    if (!window.isBotState(name)) {
      console.warn('external: ignoring unknown state ' + name);
      return false;
    }
    console.info('external: ' + name + (caption ? ' "' + caption + '"' : ''));
    clearTimeout(hold);
    hold = null;
    var text = caption === null || caption === undefined ? defaultCaption(name) : caption;
    var ms = Math.min(holdMs || (STEPS[name] ? STEP_HOLD_MS : HOLD_MS), MAX_HOLD_MS);

    if (talking()) {
      window.grokspot.voice.event('external_state', name);
      // Skipped while the user is speaking: then there is nothing to emphasize.
      if (window.getBotState() !== name) return true;
      emphasize();
      showCaption(name, text);
      remember(name);
      // In a conversation the voice integration owns the face; the hold only times the caption.
      hold = setTimeout(hideCaption, ms);
      return true;
    }
    emphasize();
    if (name === 'idle') {
      hideCaption();
      window.grokspot.act('idle');
      remember(name);
      return true;
    }
    window.grokspot.state(name);
    showCaption(name, text);
    remember(name);
    hold = setTimeout(function () {
      hold = null;
      // A conversation that started meanwhile owns the face now.
      if (!talking()) window.grokspot.act('idle');
    }, ms);
    return true;
  }

  function remember(name) {
    last.state = name;
    last.since = new Date().toISOString();
  }

  /** For get_avatar_state: what the face shows now and who put it there. */
  function status() {
    var now = window.getBotState();
    var source = talking() ? 'voice'
      : hold && last.state === now ? 'mcp'
      : window.grokspotLife.running() ? 'idle_life'
      : 'app';
    return {
      state: now,
      since: window.motion.stateSince ? new Date(window.motion.stateSince).toISOString() : null,
      source: source,
      caption: captionState === now ? last.caption : null,
      last_mcp_state: last.state,
      last_mcp_at: last.since,
    };
  }

  window.grokspot.external = { state: state, status: status, emphasize: emphasize };
})();

// GrokSpot external states: the avatar set from outside, over MCP
// (McpServer.kt, tool set_avatar_state), for example by the user's own GrokBot
// chatting on a phone or PC.
//
// - During a Grok Voice conversation the state goes through voice.js
//   (external_state), so its priorities apply: the user speaking wins, and
//   during a reply it holds like Grok Voice's own set_avatar_state.
// - Otherwise it takes the face over from the idle life until the next call or
//   the hold (duration_sec, or the state's own time from McpServer.BASE_SECONDS),
//   then the idle life comes back. One call is enough; no closing call is needed.
//   "idle" hands the face back at once. A new call restarts the hold.
// - Every change that is shown gets one emphasis, so it is clear the agent chose
//   this face: the head pops and blinks (motion.emphasize) and the screen edge
//   lights up once, in the same style as the mic ring.
// - A caption goes with the state, in the same place and style as the mic hint
//   ("話しかけてください"): the state's own emoji (feelings) or word (actions); the
//   agent does not choose it. It goes away with the state.
// - notifying and alerting also leave an unread mark (📩 / ❗) at the bottom of
//   the screen after they end, so a notice is not missed when nobody was
//   looking. A touch on the screen or an idle from the agent clears it.
(function () {
  'use strict';

  // Used only if the app sends no time (McpServer always sends the state's own time).
  var HOLD_MS = 5000;
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

  var UNREAD_MARKS = { alerting: '❗', notifying: '📩' };

  var hold = null;
  var unread = {};
  var unreadBox = document.getElementById('unread');
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

  function showUnread() {
    var marks = ['alerting', 'notifying'].filter(function (k) { return unread[k]; });
    unreadBox.textContent = marks.map(function (k) { return UNREAD_MARKS[k]; }).join(' ');
    document.body.classList.toggle('unread', marks.length > 0);
  }

  function markUnread(name) {
    if (!UNREAD_MARKS[name]) return;
    unread[name] = true;
    showUnread();
  }

  function clearUnread(why) {
    if (!unread.alerting && !unread.notifying) return;
    console.info('external: unread cleared (' + why + ')');
    unread = {};
    showUnread();
  }

  // Touching the screen means the person has seen it.
  document.addEventListener('pointerdown', function () { clearUnread('touch'); });

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
   * Shows `name` from an external agent, with the state's own caption.
   * holdMs: how long before the idle life returns. Returns false for an unknown state.
   */
  function state(name, holdMs) {
    if (!window.isBotState(name)) {
      console.warn('external: ignoring unknown state ' + name);
      return false;
    }
    console.info('external: ' + name);
    clearTimeout(hold);
    hold = null;
    var text = defaultCaption(name);
    var ms = Math.min(holdMs || HOLD_MS, MAX_HOLD_MS);

    if (talking()) {
      window.grokspot.voice.event('external_state', name);
      // Skipped while the user is speaking: then there is nothing to emphasize.
      if (window.getBotState() !== name) return true;
      emphasize();
      showCaption(name, text);
      markUnread(name);
      remember(name);
      // In a conversation the voice integration owns the face; the hold only times the caption.
      hold = setTimeout(hideCaption, ms);
      return true;
    }
    emphasize();
    if (name === 'idle') {
      clearUnread('idle');
      hideCaption();
      window.grokspot.act('idle');
      remember(name);
      return true;
    }
    window.grokspot.state(name);
    showCaption(name, text);
    markUnread(name);
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
      unread: !!(unread.alerting || unread.notifying),
      unread_kinds: ['alerting', 'notifying'].filter(function (k) { return unread[k]; }),
      last_mcp_state: last.state,
      last_mcp_at: last.since,
    };
  }

  window.grokspot.external = { state: state, status: status, emphasize: emphasize };
})();

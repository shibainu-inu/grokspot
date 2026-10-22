// GrokSpot external states: the avatar set from outside, over MCP
// (McpServer.kt, tool set_avatar_state), for example by the user's own GrokBot
// chatting on a phone or PC.
//
// - During a Grok Voice conversation the state goes through voice.js
//   (external_state), so its priorities apply: the user speaking wins, and
//   during a reply it holds like Grok Voice's own set_avatar_state.
// - Otherwise it takes the face over from the idle life for HOLD_MS, then the
//   idle life comes back. "idle" hands the face back at once. A new call
//   restarts the hold, so an agent can keep a state up by sending it again.
(function () {
  'use strict';

  var HOLD_MS = 15000;
  var hold = null;

  function talking() {
    return window.grokspot.voice && window.grokspot.voice.connected();
  }

  /** Shows `name` from an external agent. Returns false for an unknown state. */
  function state(name) {
    if (!window.isBotState(name)) {
      console.warn('external: ignoring unknown state ' + name);
      return false;
    }
    console.info('external: ' + name);
    clearTimeout(hold);
    hold = null;
    if (talking()) {
      window.grokspot.voice.event('external_state', name);
      return true;
    }
    if (name === 'idle') {
      window.grokspot.act('idle');
      return true;
    }
    window.grokspot.state(name);
    hold = setTimeout(function () {
      hold = null;
      // A conversation that started meanwhile owns the face now.
      if (!talking()) window.grokspot.act('idle');
    }, HOLD_MS);
    return true;
  }

  window.grokspot.external = { state: state };
})();

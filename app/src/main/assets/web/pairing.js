// GrokSpot pairing: approving an MCP client (OAuth, McpAuth.kt) from the screen.
// The app calls request() when a client asks to connect (the screen says "touch
// to accept"; a touch anywhere goes to the app, which then makes the code),
// show() with the code to type into the approval page, hide() when it is used
// or dropped, and done() once it is approved.
(function () {
  'use strict';

  var DONE_MS = 2500;

  var box = document.getElementById('pairing');
  var title = box.querySelector('.pair-title');
  var client = box.querySelector('.pair-client');
  var code = box.querySelector('.pair-code');
  var hint = box.querySelector('.pair-hint');
  var timer = null;

  function t(key) { return window.grokspotI18n.t(key); }

  function open(ms) {
    clearTimeout(timer);
    box.classList.add('show');
    timer = setTimeout(hide, ms);
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    box.classList.remove('show');
  }

  /** A client asks to connect: ask for a touch; no code exists yet. */
  function request(name, ms) {
    title.textContent = t('pair.request');
    client.textContent = name;
    code.textContent = '';
    hint.textContent = t('pair.touch');
    open(ms);
  }

  /** Shows `digits` (six) for `ms`, saying which client asked. */
  function show(digits, name, ms) {
    title.textContent = t('pair.title');
    client.textContent = name;
    code.textContent = digits.slice(0, 3) + ' ' + digits.slice(3);
    hint.textContent = t('pair.hint');
    open(ms);
  }

  /** The request was approved: a short "connected", then the face again with a flourish. */
  function done(name) {
    title.textContent = t('pair.done');
    client.textContent = name;
    code.textContent = '✓';
    hint.textContent = '';
    open(DONE_MS);
    window.grokspot.external.emphasize();
  }

  window.grokspot.pairing = { request: request, show: show, hide: hide, done: done };
})();

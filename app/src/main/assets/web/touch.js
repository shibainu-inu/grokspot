// GrokSpot touch: reacting to where the screen is touched.
//
// The eyes always turn toward the finger, and follow it while it moves. A tap
// then gets a reaction by where it landed, measured from the head centre in
// face units (the head is a circle of radius 114 units):
//
//   top of the head      pat      happy / shy / proud
//   on the eyes          eye      flinch, surprised then shy or confused
//   rest of the head     body     flinch, laughing / playful (ticklish)
//   empty screen         outside  looks there, curious
//   5 taps within 3 s    pester   angry, then sulks (bored)
//
// The reactions themselves live in life.js, which also wakes a sleeping bot on
// any touch. During a conversation only the eyes and the flinch respond, so the
// avatar states stay with the voice integration.
(function () {
  'use strict';

  var HEAD_RADIUS = 114;
  var UNITS_ACROSS = 259; // the face canvas spans 259 units
  var PAT_ABOVE = -52;     // dy above this is the top of the head
  var EYES = { x: 55, top: -38, bottom: 32 };
  var PESTER_TAPS = 5;
  var PESTER_MS = 3000;
  var DRAG_SLOP_PX = 12;

  var stage = document.getElementById('stage');
  var down = null;
  var taps = [];

  /** Where a pointer event is, relative to the head centre, in units. */
  function locate(event) {
    var rect = stage.getBoundingClientRect();
    var unit = rect.width / UNITS_ACROSS;
    return {
      dx: (event.clientX - (rect.left + rect.width / 2)) / unit,
      dy: (event.clientY - (rect.top + rect.height / 2)) / unit,
    };
  }

  function classify(at) {
    var dist = Math.sqrt(at.dx * at.dx + at.dy * at.dy);
    if (dist > HEAD_RADIUS) return 'outside';
    if (at.dy < PAT_ABOVE) return 'pat';
    if (Math.abs(at.dx) < EYES.x && at.dy > EYES.top && at.dy < EYES.bottom) return 'eye';
    return 'body';
  }

  function talking() {
    return window.grokspot.voice && window.grokspot.voice.connected();
  }

  document.addEventListener('pointerdown', function (event) {
    down = { x: event.clientX, y: event.clientY, dragged: false };
    var at = locate(event);
    window.motion.lookAt(at.dx, at.dy, 1500);
  });

  document.addEventListener('pointermove', function (event) {
    if (!down) return;
    if (!down.dragged && Math.hypot(event.clientX - down.x, event.clientY - down.y) > DRAG_SLOP_PX) {
      down.dragged = true;
    }
    if (down.dragged) {
      var at = locate(event);
      window.motion.lookAt(at.dx, at.dy, 1200);
    }
  });

  document.addEventListener('pointercancel', function () { down = null; });

  document.addEventListener('pointerup', function (event) {
    var dragged = down && down.dragged;
    down = null;
    if (dragged) return; // following the finger was the reaction
    if (window.tourActive && window.tourActive()) {
      window.nextTourStep();
      return;
    }

    var at = locate(event);
    var kind = classify(at);
    var now = Date.now();
    taps = taps.filter(function (t) { return now - t < PESTER_MS; });
    taps.push(now);
    if (taps.length >= PESTER_TAPS) {
      taps = [];
      kind = 'pester';
    }

    if (kind === 'eye' || kind === 'body' || kind === 'pester') window.motion.flinch(at.dx, at.dy);
    window.motion.lookAt(at.dx, at.dy, kind === 'outside' ? 3000 : 1500);
    console.info('touch: ' + kind + ' at ' + Math.round(at.dx) + ',' + Math.round(at.dy));
    if (!talking()) window.grokspotLife.poke(kind);
  });
})();

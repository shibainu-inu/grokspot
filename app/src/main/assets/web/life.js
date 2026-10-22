// GrokSpot life: what the bot does on its own while nobody is talking to it.
//
// The aim is a face that seems alive and busy with its own little world, and
// never looks like a loop:
//
// - Rest is never still: between activities it glances around, looks at you,
//   hops, wiggles, perks up, yawns when sleepy (MICRO).
// - Activities are put together from parts each time: an optional lead-in
//   (notices something, ponders...), a main part, and a reaction that depends
//   on how it went (proud, laughing, puzzled, shy...).
// - Many main parts are "experiments" with the morphs: it tries the orbit, the
//   radar, the progress ring, throws a dot to itself and catches it...
// - What it did lately is remembered, so recent things are unlikely and things
//   it has not done for a while come back.
// - A slowly drifting mood (cheerful, calm, bored, playful) tilts the choices;
//   touches, conversations, the time of day and being left alone move it.
// - Rarely, a special moment: a sneeze, chasing an invisible fly, a little
//   dance, getting dizzy, a twitch in its sleep.
// - Energy drains while awake (faster at night) and comes back in sleep, so it
//   gets sleepy in a natural rhythm and sleeps through the night.
//
// actions.js starts this whenever the bot goes idle and stops it for anything
// else (a conversation, an MCP state), so it never fights them. Touches are
// handed in through poke() (touch.js).
(function () {
  'use strict';

  var SECOND = 1000;
  var MINUTE = 60 * SECOND;

  // Energy 1 → 0 in about 45 minutes awake by day, 15 minutes at night; 0 → 1 in about 20 minutes asleep.
  var DRAIN_DAY = 1 / (45 * MINUTE);
  var DRAIN_NIGHT = 1 / (15 * MINUTE);
  var RECOVER = 1 / (20 * MINUTE);
  // Night by the device's local time, so set the device time zone (docs/SETUP.md, step 8).
  var NIGHT_FROM = 22;
  var NIGHT_UNTIL = 6;

  // Pace ("よく動く"): rest between activities, and how often a small gesture happens during it.
  var REST = [4 * SECOND, 11 * SECOND];
  var MICRO_EVERY = [1.8 * SECOND, 4.5 * SECOND];
  // Mood drifts every few minutes; a special moment is rare and never twice in a row soon.
  var MOOD_EVERY = [3 * MINUTE, 6 * MINUTE];
  var RARE_CHANCE = 0.07;
  var RARE_COOLDOWN = 4 * MINUTE;
  // Left alone this long, it gets bored.
  var LONELY_AFTER = 20 * MINUTE;
  // While asleep, how often to check whether it is time to get up, stir or twitch.
  var SLEEP_CHECK = 30 * SECOND;

  function rand(min, max) { return min + Math.random() * (max - min); }
  function pickOne(list) { return list[Math.floor(Math.random() * list.length)]; }
  function chance(p) { return Math.random() < p; }

  // ---------------------------------------------------------------- moves
  // Small motions that do not change the face's state.

  function glance() {
    window.motion.lookAt(rand(-130, 130), rand(-90, 90), rand(700, 1800));
  }

  function lookAtYou() {
    window.motion.lookAt(0, 0, rand(1200, 2200));
    window.motion.blink(performance.now());
  }

  function hop() { window.motion.bounce(performance.now()); }

  function perk() { window.motion.emphasize(); } // a little pop and a blink

  function wiggle() { window.motion.flinch(rand(-40, 40), rand(-20, 20)); }

  function twirl() { window.motion.spin(1); }

  /** A quick shiver of the whole face (#stage is not moved by motion.js). */
  function shiver() {
    var frames = [];
    for (var j = 0; j < 9; j += 1) {
      var a = (j % 2 ? -1 : 1) * (1 - j / 9);
      frames.push({ transform: 'translate(' + (7 * a).toFixed(1) + 'px,0) rotate(' + (3 * a).toFixed(1) + 'deg)' });
    }
    frames.push({ transform: 'none' });
    document.getElementById('stage').animate(frames, { duration: 560, easing: 'linear' });
  }

  // ---------------------------------------------------------------- parts
  // A step is { s: state, t: [min, max] ms } and/or { act: fn } (run when the step starts),
  // with an optional { every: [ms, fn] } repeated while the step lasts.

  function S(state, min, max, extra) {
    var step = { s: state, t: [min * SECOND, (max || min) * SECOND] };
    if (extra) for (var k in extra) step[k] = extra[k];
    return step;
  }
  function A(fn) { return { act: fn }; }

  // Lead-ins: how an activity starts (often there is none).
  var INTROS = [
    [S('curious', 1.6, 2.8, { act: glance })],
    [S('surprised', 0.9, 1.3, { act: perk })],
    [S('thinking', 1.8, 3.2)],
    [S('listening', 1.8, 3)],
    [S('suspicious', 1.6, 2.6, { act: glance })],
    [A(lookAtYou), S('idle', 1, 1.6)],
  ];

  // Reactions, by how the main part went.
  var OUTROS = {
    good: [
      [S('proud', 2, 3.2)], [S('happy', 2, 3.2)], [S('laughing', 1.6, 2.6)],
      [S('excited', 1.6, 2.4, { act: hop })], [A(twirl), S('happy', 2, 3)],
    ],
    meh: [
      [S('confused', 1.8, 3)], [S('shy', 1.8, 2.6)], [S('bored', 2, 3.5)],
      [S('suspicious', 1.6, 2.6)], [A(lookAtYou), S('shy', 1.6, 2.4)],
    ],
    none: [[]],
  };

  // Main parts. moods: weight per mood; min: least energy; day: not at night.
  // results: chances of { good, meh, none } for the reaction.
  var MAINS = {
    lookAround: {
      steps: [S('curious', 3.5, 6.5, { every: [700, glance] })],
      moods: { cheerful: 2, calm: 3, bored: 2, playful: 1.5 }, results: { good: 0.3, meh: 0.2, none: 0.5 },
    },
    daydream: {
      steps: [S('thinking', 3.5, 7)],
      moods: { cheerful: 1, calm: 3, bored: 2, playful: 0.5 }, results: { good: 0.5, meh: 0.3, none: 0.2 },
    },
    hum: {
      steps: [S('humming', 5, 10)],
      moods: { cheerful: 3, calm: 1.5, bored: 0.5, playful: 1.5 }, min: 0.3, day: true, results: { good: 0.6, none: 0.4 },
    },
    doodle: {
      steps: [S('writing', 5, 9)],
      moods: { cheerful: 2, calm: 1.5, bored: 1, playful: 1 }, min: 0.3, results: { good: 0.6, meh: 0.3, none: 0.1 },
    },
    play: {
      steps: [S('playful', 2.5, 4, { every: [1200, hop] }), S('laughing', 1.4, 2.2)],
      moods: { cheerful: 2, calm: 0.5, bored: 0.5, playful: 3 }, min: 0.5, day: true, results: { good: 0.5, none: 0.5 },
    },
    bounce: {
      steps: [S('bouncing', 2.6, 4.2)],
      moods: { cheerful: 1.5, calm: 0.2, bored: 0.5, playful: 2.5 }, min: 0.6, day: true, results: { good: 0.7, none: 0.3 },
    },
    // Throws a dot to itself and catches it.
    catchDot: {
      steps: [S('sending', 1.5, 1.6), S('receiving', 1.7, 1.8), S('sending', 1.5, 1.6), S('receiving', 1.7, 1.8)],
      moods: { cheerful: 1.5, calm: 0.5, bored: 1, playful: 2.5 }, min: 0.4, results: { good: 0.6, meh: 0.3, none: 0.1 },
    },
    // Experiments: tries a morph to see what it does.
    tryOrbit: {
      steps: [S('orbit', 3, 5)],
      moods: { cheerful: 1.5, calm: 1, bored: 1.5, playful: 1.5 }, results: { good: 0.6, meh: 0.3, none: 0.1 },
    },
    tryRadar: {
      steps: [S('radar', 2.6, 4, { every: [900, glance] })],
      moods: { cheerful: 1, calm: 1.5, bored: 1.5, playful: 1 }, results: { good: 0.3, meh: 0.5, none: 0.2 },
    },
    tryProgress: {
      steps: [S('progress', 2.7, 3.2)],
      moods: { cheerful: 1.5, calm: 1, bored: 1.5, playful: 1 }, results: { good: 0.7, meh: 0.2, none: 0.1 },
    },
    tryGather: {
      steps: [S('spawning', 2.1, 2.3)],
      moods: { cheerful: 1, calm: 1, bored: 1, playful: 1.5 }, results: { good: 0.6, meh: 0.3, none: 0.1 },
    },
    trySatellites: {
      steps: [S('uploading', 3, 4.5)],
      moods: { cheerful: 1, calm: 1, bored: 1.5, playful: 1 }, results: { good: 0.5, meh: 0.3, none: 0.2 },
    },
    tryWhirl: {
      steps: [S('loading', 2.6, 3.6)],
      moods: { cheerful: 1.5, calm: 0.5, bored: 1, playful: 1.5 }, min: 0.4, results: { good: 0.6, meh: 0.3, none: 0.1 },
    },
    trySing: {
      steps: [S('dictating', 2.4, 4)],
      moods: { cheerful: 2, calm: 1, bored: 0.5, playful: 1 }, day: true, results: { good: 0.6, meh: 0.2, none: 0.2 },
    },
    bored: {
      steps: [S('bored', 5, 10)],
      moods: { cheerful: 0.2, calm: 1, bored: 3, playful: 0.3 }, results: { meh: 0.3, none: 0.7 },
    },
  };

  // Special moments: rare, memorable, never twice close together.
  var RARE = {
    sneeze: [S('surprised', 0.5, 0.7), A(function () { shiver(); wiggle(); hop(); }), S('shy', 1.8, 2.6)],
    flyChase: [S('searching', 3, 4, { every: [320, function () { window.motion.lookAt(rand(-150, 150), rand(-110, 110), 400); }] }),
      S('surprised', 0.8, 1.1, { act: perk }), S('laughing', 1.6, 2.4)],
    dance: [S('playful', 1.2, 1.5, { act: hop }), A(twirl), S('excited', 1.5, 1.8, { act: hop }),
      A(function () { window.motion.startTrick('spinBounce', performance.now()); }), S('celebrate', 2.6, 3.2), S('proud', 2, 2.8)],
    dizzy: [A(function () { window.motion.startTrick('dizzy', performance.now()); }), S('confused', 2.4, 3.2), S('laughing', 1.4, 2)],
  };

  // ------------------------------------------------------------------ state

  var running = false;
  var speed = 1;
  var energy = 0.9;
  var mood = 'cheerful';
  var moodAt = Date.now();
  var lastTick = Date.now();
  var lastTouch = Date.now();
  var lastRare = -Infinity;
  var lastDone = {};      // main part → time it last ran
  var recent = [];        // last main parts, newest first
  var timer = null;
  var everyTimer = null;
  var activity = null;
  var state = null;
  var restUntil = 0;

  function now() { return Date.now(); }

  function isNight() {
    var hour = new Date().getHours();
    return hour >= NIGHT_FROM || hour < NIGHT_UNTIL;
  }

  /** Brings energy up to date for the time passed in the current state. */
  function account() {
    var t = now();
    var dt = (t - lastTick) * speed;
    lastTick = t;
    if (state === 'sleeping') energy += dt * RECOVER;
    else energy -= dt * (isNight() ? DRAIN_NIGHT : DRAIN_DAY);
    energy = Math.min(1, Math.max(0, energy));
  }

  function show(name) {
    account();
    state = name;
    if (window.stopTour) window.stopTour();
    window.motion.setState(name);
  }

  function wait(ms, fn) {
    clearTimeout(timer);
    timer = setTimeout(fn, ms / speed);
  }

  function stopEvery() {
    clearInterval(everyTimer);
    everyTimer = null;
  }

  // ------------------------------------------------------------------- mood

  /** Mood drifts with the time of day, energy and how long it has been left alone. */
  function driftMood() {
    if ((now() - moodAt) * speed < rand(MOOD_EVERY[0], MOOD_EVERY[1])) return;
    var hour = new Date().getHours();
    var w = { cheerful: 1, calm: 1, bored: 0.5, playful: 0.8 };
    if (hour >= 6 && hour < 11) { w.cheerful += 1; w.playful += 0.8; }
    else if (hour >= 18 || isNight()) { w.calm += 1.5; w.playful *= 0.4; }
    else w.calm += 0.5;
    if (energy < 0.4) { w.calm += 1; w.bored += 0.5; w.playful *= 0.3; }
    if ((now() - lastTouch) * speed > LONELY_AFTER) w.bored += 1.5;
    w[mood] += 1; // moods tend to last
    setMood(weighted(w));
  }

  function setMood(next) {
    moodAt = now();
    if (next !== mood) console.info('life: mood ' + mood + ' → ' + next);
    mood = next;
  }

  function weighted(weights) {
    var total = 0;
    var k;
    for (k in weights) total += Math.max(0, weights[k]);
    var roll = Math.random() * total;
    for (k in weights) {
      roll -= Math.max(0, weights[k]);
      if (roll < 0) return k;
    }
    return k;
  }

  // --------------------------------------------------------------- choosing

  function pickMain() {
    var night = isNight();
    var weights = {};
    Object.keys(MAINS).forEach(function (name) {
      var m = MAINS[name];
      var w = m.moods[mood] || 0;
      if (m.min && energy < m.min) w = 0;
      if (m.day && night) w = 0;
      var age = recent.indexOf(name);
      if (age === 0 || age === 1) w *= 0.08;
      else if (age > 1) w *= 0.45;
      // Things not done for a while come back: up to double after 15 minutes.
      var since = lastDone[name] === undefined ? Infinity : (now() - lastDone[name]) * speed;
      w *= 1 + Math.min(1, since / (15 * MINUTE));
      weights[name] = w;
    });
    // Sleepy: nod off instead.
    if (energy < 0.45) weights.doze = (night ? 7 : 4) * (1 - energy);
    return weighted(weights);
  }

  function remember(name) {
    lastDone[name] = now();
    recent.unshift(name);
    if (recent.length > 6) recent.pop();
  }

  /** Lead-in + main + a reaction to how it went. */
  function compose(name) {
    var m = MAINS[name];
    var steps = [];
    if (chance(0.45)) steps = steps.concat(pickOne(INTROS));
    steps = steps.concat(m.steps);
    steps = steps.concat(pickOne(OUTROS[weighted(m.results)]));
    return steps;
  }

  // ---------------------------------------------------------------- running

  function runSteps(steps, then) {
    var i = 0;
    var step = function () {
      stopEvery();
      if (!running) return;
      if (i >= steps.length) { then(); return; }
      var s = steps[i++];
      if (s.s) show(s.s);
      if (s.act) s.act();
      if (s.every) everyTimer = setInterval(s.every[1], s.every[0] / speed);
      if (!s.t) { step(); return; }
      wait(rand(s.t[0], s.t[1]), step);
    };
    step();
  }

  /** Rest: idle, but with a small gesture every few seconds. */
  function rest() {
    activity = null;
    show('idle');
    restUntil = now() + rand(REST[0], REST[1]) / speed;
    wait(rand(MICRO_EVERY[0], MICRO_EVERY[1]), restTick);
  }

  function restTick() {
    if (now() >= restUntil) { next(); return; }
    micro();
  }

  function continueRest() {
    if (state !== 'idle') show('idle');
    wait(rand(MICRO_EVERY[0], MICRO_EVERY[1]), restTick);
  }

  /** One small gesture; a few briefly change the face and come back. */
  function micro() {
    var w = { glance: 4, you: 2, hop: 1.2, perk: 1, wiggle: 1, twirl: 0.3, blink: 1.2, smile: 0.8 };
    if (energy < 0.4) { w.yawn = 2.5; w.hop *= 0.3; w.twirl = 0; }
    if (mood === 'playful') { w.hop += 1.5; w.twirl += 0.4; }
    if (mood === 'bored') w.sigh = 1.5;
    switch (weighted(w)) {
      case 'glance': glance(); break;
      case 'you': lookAtYou(); break;
      case 'hop': hop(); break;
      case 'perk': perk(); break;
      case 'wiggle': wiggle(); break;
      case 'twirl': twirl(); break;
      case 'blink': window.motion.blink(performance.now()); break;
      case 'smile': runSteps([S('happy', 1.2, 2)], continueRest); return;
      case 'yawn': runSteps([S('drowsy', 1.6, 2.4)], continueRest); return;
      case 'sigh': runSteps([S('bored', 1.6, 2.6)], continueRest); return;
    }
    continueRest();
  }

  function next() {
    account();
    driftMood();
    if (chance(RARE_CHANCE) && (now() - lastRare) * speed > RARE_COOLDOWN && energy > 0.3 && !isNight()) {
      var rare = pickOne(Object.keys(RARE));
      lastRare = now();
      begin(rare, RARE[rare]);
      return;
    }
    var name = pickMain();
    if (name === 'doze') { doze(); return; }
    remember(name);
    begin(name, compose(name));
  }

  function begin(name, steps) {
    activity = name;
    console.info('life: ' + name + ' (' + mood + ', energy ' + energy.toFixed(2) + (isNight() ? ', night' : '') + ')');
    runSteps(steps, rest);
  }

  // ------------------------------------------------------------------ sleep

  /** Nods off, then shakes it off or falls asleep. */
  function doze() {
    activity = 'doze';
    console.info('life: doze (energy ' + energy.toFixed(2) + ')');
    runSteps([S('drowsy', 10, 22)], function () {
      if (energy < 0.3 || chance(0.45)) sleep();
      else runSteps([A(perk), S('curious', 1.6, 2.4)], rest); // jerks awake: "I wasn't sleeping!"
    });
  }

  function sleep() {
    activity = 'sleep';
    show('sleeping');
    wait(SLEEP_CHECK, sleepCheck);
  }

  /** While asleep: get up once rested (not before morning), stir, or twitch now and then. */
  function sleepCheck() {
    account();
    if (energy >= 1 && !isNight()) { wakeUp(); return; }
    if (chance(0.06)) {
      console.info('life: stir');
      runSteps([S('drowsy', 5, 9)], sleep);
      return;
    }
    if (chance(0.12)) wiggle(); // a twitch in its sleep
    wait(SLEEP_CHECK, sleepCheck);
  }

  function wakeUp() {
    console.info('life: wake up (energy ' + energy.toFixed(2) + ')');
    setMood(isNight() ? 'calm' : 'cheerful');
    runSteps([S('waking', 3), S('curious', 1.6, 2.4, { act: glance })], rest);
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Takes over the face. After a conversation or other interaction it starts
   * from a short rest with a little extra energy, in a good mood.
   */
  function resume(boost) {
    if (running) return;
    running = true;
    account();
    if (boost) {
      energy = Math.min(1, energy + boost);
      if (!isNight()) setMood('cheerful');
    }
    rest();
  }

  function stop() {
    if (!running) return;
    account();
    running = false;
    clearTimeout(timer);
    timer = null;
    stopEvery();
    activity = null;
    state = null;
  }

  // Reactions to a touch, by where it landed (touch.js decides the kind).
  // Each kind has a few variants so repeated taps do not look canned.
  var REACTIONS = {
    pat: [ // top of the head
      [S('happy', 3, 4)],
      [S('shy', 2, 3), S('happy', 2.5, 3.5)],
      [S('proud', 3, 4)],
    ],
    eye: [ // right on the eyes
      [S('surprised', 1.4, 1.8), S('shy', 2.5, 3.5)],
      [S('surprised', 1.4, 1.8), S('confused', 2.5, 3.5)],
    ],
    body: [ // the rest of the head: ticklish
      [S('laughing', 2, 3)],
      [S('playful', 3, 4)],
      [S('laughing', 1.6, 2.2), S('happy', 2, 3)],
    ],
    outside: [ // the empty screen around it: what was that?
      [S('curious', 3, 5)],
      [S('surprised', 1.2, 1.6), S('curious', 3, 4)],
    ],
    pester: [ // many taps in a row
      [S('angry', 2.5, 3.5), S('bored', 4, 6)],
      [S('confused', 2, 3), S('angry', 2, 3)],
    ],
  };
  var lastPoke = null;

  /**
   * A touch: wakes it if asleep, otherwise reacts to where it was touched
   * (kind: pat, eye, body, outside or pester; defaults to body). Being played
   * with makes it playful for a while; being pestered, grumpy-bored.
   */
  function poke(kind) {
    if (!running) return;
    lastTouch = now();
    if (state === 'sleeping' || state === 'drowsy') {
      energy = Math.min(1, energy + 0.1);
      wakeUp();
      return;
    }
    // A new touch while already reacting to the same kind keeps the current reaction going.
    if (activity === 'poke' && lastPoke === kind && kind !== 'pester') return;
    lastPoke = kind;
    if (kind === 'pester') setMood('bored');
    else if (kind === 'pat' || kind === 'body' || kind === 'eye') setMood('playful');
    begin('poke', pickOne(REACTIONS[kind] || REACTIONS.body));
  }

  window.grokspotLife = {
    resume: resume,
    stop: stop,
    poke: poke,
    running: function () { return running; },
    status: function () {
      account();
      return { activity: activity, state: state, energy: energy, mood: mood, night: isNight(), recent: recent.slice() };
    },
    // For testing from DevTools.
    /** Runs a main part (with lead-in and reaction), a special moment, 'doze' or 'sleep' now. */
    play: function (name) {
      if (!running) return;
      if (MAINS[name]) { remember(name); begin(name, compose(name)); }
      else if (RARE[name]) begin(name, RARE[name]);
      else if (name === 'doze') doze();
      else if (name === 'sleep') sleep();
    },
    setEnergy: function (value) { account(); energy = value; },
    setMood: setMood,
    /** Time multiplier for previewing (e.g. 4 = four times faster); 1 is normal. */
    setSpeed: function (value) { account(); speed = Math.max(0.1, value); },
  };
})();

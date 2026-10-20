// GrokSpot life: what the bot does on its own while nobody is talking to it.
//
// Instead of a fixed idle face it rests, looks around, daydreams, hums, plays,
// doodles, bounces, gets bored, nods off and sleeps, one short "activity" at a
// time, and reacts to touches (see touch.js). Activities
// are chains of avatar states that flow into each other (bored → drowsy →
// sleeping → waking → idle), picked at random with weights that follow an
// energy level: energy drains while awake (faster at night) and comes back
// while asleep, so it gets sleepy in a natural rhythm and sleeps through the night.
//
// actions.js starts this whenever the bot goes idle and stops it for anything
// else (a conversation, a reaction), so it never fights the voice integration.
(function () {
  'use strict';

  var SECOND = 1000;
  var MINUTE = 60 * SECOND;

  // Energy 1 → 0 in about 45 minutes awake by day, 15 minutes at night;
  // 0 → 1 in about 20 minutes asleep.
  var DRAIN_DAY = 1 / (45 * MINUTE);
  var DRAIN_NIGHT = 1 / (15 * MINUTE);
  var RECOVER = 1 / (20 * MINUTE);
  // 夜の判定は端末のタイムゾーン設定に左右されないよう、日本時間で行う。
  var TIME_ZONE = 'Asia/Tokyo';
  var NIGHT_FROM = 22;
  var NIGHT_UNTIL = 6;

  function rand(min, max) { return min + Math.random() * (max - min); }

  // An activity is a list of [state, minMs, maxMs] steps, played in order.
  // `when(energy, night)` gives its weight (0 = not now).
  var ACTIVITIES = {
    lookAround: {
      steps: [['curious', 5 * SECOND, 9 * SECOND]],
      when: function (e) { return e > 0.3 ? 3 : 1; },
    },
    daydream: {
      steps: [['thinking', 6 * SECOND, 12 * SECOND], ['happy', 2.5 * SECOND, 4 * SECOND]],
      when: function (e) { return e > 0.25 ? 2 : 1; },
    },
    ponder: {
      steps: [['thinking', 5 * SECOND, 9 * SECOND], ['confused', 3 * SECOND, 5 * SECOND]],
      when: function (e) { return e > 0.3 ? 1 : 0; },
    },
    hum: {
      steps: [['humming', 8 * SECOND, 16 * SECOND], ['happy', 2.5 * SECOND, 4 * SECOND]],
      when: function (e, night) { return e > 0.4 && !night ? 2 : 0; },
    },
    play: {
      steps: [['playful', 5 * SECOND, 8 * SECOND], ['laughing', 2 * SECOND, 3.5 * SECOND], ['happy', 2.5 * SECOND, 4 * SECOND]],
      when: function (e, night) { return e > 0.6 && !night ? 1.5 : 0; },
    },
    // Turns into a pencil and doodles for a while, pleased with the result.
    doodle: {
      steps: [['writing', 7 * SECOND, 12 * SECOND], ['proud', 2.5 * SECOND, 3.5 * SECOND]],
      when: function (e, night) { return e > 0.45 && !night ? 0.8 : 0; },
    },
    // Bounces like a ball out of sheer energy.
    bounce: {
      steps: [['bouncing', 3 * SECOND, 5 * SECOND], ['excited', 2 * SECOND, 3 * SECOND]],
      when: function (e, night) { return e > 0.75 && !night ? 0.6 : 0; },
    },
    proud: {
      steps: [['proud', 4 * SECOND, 6 * SECOND]],
      when: function (e) { return e > 0.5 ? 0.5 : 0; },
    },
    shy: {
      steps: [['shy', 3.5 * SECOND, 5 * SECOND]],
      when: function () { return 0.4; },
    },
    // Something caught its eye: a start, a closer look, then relief.
    startle: {
      steps: [['surprised', 1.8 * SECOND, 2.4 * SECOND], ['suspicious', 3 * SECOND, 5 * SECOND], ['curious', 3 * SECOND, 5 * SECOND]],
      when: function (e) { return e > 0.35 ? 0.4 : 0; },
    },
    bored: {
      steps: [['bored', 10 * SECOND, 20 * SECOND]],
      when: function (e) { return e < 0.7 ? 2 : 0.8; },
    },
    // Nods off, then either shakes it off or falls asleep (decided at the end).
    doze: {
      steps: [['drowsy', 15 * SECOND, 35 * SECOND]],
      when: function (e, night) { return e < 0.45 ? (night ? 6 : 4) * (1 - e) : 0; },
      then: function (e) { return e < 0.3 || Math.random() < 0.4 ? 'sleep' : null; },
    },
    sleep: {
      steps: [['sleeping', Infinity, Infinity]],
      when: function () { return 0; },
    },
  };

  // Rest (plain idle) between activities.
  var REST_MIN = 15 * SECOND;
  var REST_MAX = 45 * SECOND;
  // While asleep, how often to check whether it is time to get up or stir.
  var SLEEP_CHECK = 30 * SECOND;
  var STIR_CHANCE = 0.06;

  var running = false;
  var energy = 0.9;
  var lastTick = Date.now();
  var timer = null;
  var activity = null;
  var lastActivity = null;
  var state = null;

  function isNight() {
    var hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    return hour >= NIGHT_FROM || hour < NIGHT_UNTIL;
  }

  /** Brings energy up to date for the time passed in the current state. */
  function account() {
    var now = Date.now();
    var dt = now - lastTick;
    lastTick = now;
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
    timer = setTimeout(fn, ms);
  }

  function rest() {
    activity = null;
    show('idle');
    wait(rand(REST_MIN, REST_MAX), next);
  }

  function pick() {
    account();
    var night = isNight();
    var total = 0;
    var weights = {};
    Object.keys(ACTIVITIES).forEach(function (name) {
      var w = name === lastActivity ? 0 : ACTIVITIES[name].when(energy, night);
      weights[name] = w;
      total += w;
    });
    var roll = Math.random() * total;
    for (var name in weights) {
      roll -= weights[name];
      if (roll < 0) return name;
    }
    return 'lookAround';
  }

  function start(name) {
    activity = name;
    lastActivity = name;
    console.info('life: ' + name + ' (energy ' + energy.toFixed(2) + (isNight() ? ', night' : '') + ')');
    play(0);
  }

  function play(index) {
    var def = ACTIVITIES[activity];
    if (index >= def.steps.length) {
      var follow = def.then && def.then(energy);
      if (follow) start(follow);
      else rest();
      return;
    }
    var step = def.steps[index];
    show(step[0]);
    if (step[0] === 'sleeping') {
      wait(SLEEP_CHECK, sleepCheck);
      return;
    }
    wait(rand(step[1], step[2]), function () { play(index + 1); });
  }

  function next() {
    start(pick());
  }

  /** While asleep: get up once rested (not before morning), or stir now and then. */
  function sleepCheck() {
    account();
    var night = isNight();
    if (energy >= 1 && !night) {
      wakeUp();
    } else if (Math.random() < STIR_CHANCE) {
      // Turns over: half wakes, then drops back off.
      console.info('life: stir');
      show('drowsy');
      wait(rand(6 * SECOND, 10 * SECOND), function () {
        show('sleeping');
        wait(SLEEP_CHECK, sleepCheck);
      });
    } else {
      wait(SLEEP_CHECK, sleepCheck);
    }
  }

  function wakeUp() {
    console.info('life: wake up (energy ' + energy.toFixed(2) + ')');
    activity = null;
    show('waking');
    wait(3 * SECOND, rest);
  }

  /**
   * Takes over the face. After a conversation or other interaction it starts
   * from a short rest with a little extra energy.
   */
  function resume(boost) {
    if (running) return;
    running = true;
    account();
    if (boost) energy = Math.min(1, energy + boost);
    rest();
  }

  function stop() {
    if (!running) return;
    account();
    running = false;
    clearTimeout(timer);
    timer = null;
    activity = null;
    state = null;
  }

  // Reactions to a touch, by where it landed (touch.js decides the kind).
  // Each kind has a few variants so repeated taps do not look canned.
  var REACTIONS = {
    pat: [ // top of the head
      [['happy', 3 * SECOND, 4 * SECOND]],
      [['shy', 2 * SECOND, 3 * SECOND], ['happy', 2.5 * SECOND, 3.5 * SECOND]],
      [['proud', 3 * SECOND, 4 * SECOND]],
    ],
    eye: [ // right on the eyes
      [['surprised', 1.4 * SECOND, 1.8 * SECOND], ['shy', 2.5 * SECOND, 3.5 * SECOND]],
      [['surprised', 1.4 * SECOND, 1.8 * SECOND], ['confused', 2.5 * SECOND, 3.5 * SECOND]],
    ],
    body: [ // the rest of the head: ticklish
      [['laughing', 2 * SECOND, 3 * SECOND]],
      [['playful', 3 * SECOND, 4 * SECOND]],
      [['laughing', 1.6 * SECOND, 2.2 * SECOND], ['happy', 2 * SECOND, 3 * SECOND]],
    ],
    outside: [ // the empty screen around it: what was that?
      [['curious', 3 * SECOND, 5 * SECOND]],
      [['surprised', 1.2 * SECOND, 1.6 * SECOND], ['curious', 3 * SECOND, 4 * SECOND]],
    ],
    pester: [ // many taps in a row
      [['angry', 2.5 * SECOND, 3.5 * SECOND], ['bored', 4 * SECOND, 6 * SECOND]],
      [['confused', 2 * SECOND, 3 * SECOND], ['angry', 2 * SECOND, 3 * SECOND]],
    ],
  };

  /**
   * A touch: wakes it if asleep, otherwise reacts to where it was touched
   * (kind: pat, eye, body, outside or pester; defaults to body).
   */
  function poke(kind) {
    if (!running) return;
    if (state === 'sleeping' || state === 'drowsy') {
      energy = Math.min(1, energy + 0.1);
      wakeUp();
      return;
    }
    var variants = REACTIONS[kind] || REACTIONS.body;
    // A new touch while already reacting to the same kind keeps the current reaction going.
    if (activity === 'poke' && lastPoke === kind && kind !== 'pester') return;
    lastPoke = kind;
    ACTIVITIES.poke = { steps: variants[Math.floor(Math.random() * variants.length)], when: function () { return 0; } };
    start('poke');
  }
  var lastPoke = null;

  window.grokspotLife = {
    resume: resume,
    stop: stop,
    poke: poke,
    running: function () { return running; },
    status: function () {
      account();
      return { activity: activity, state: state, energy: energy, night: isNight() };
    },
    /** For testing from DevTools: jump to an activity now, or set the energy. */
    play: function (name) { if (running && ACTIVITIES[name]) start(name); },
    setEnergy: function (value) { account(); energy = value; },
  };
})();

// GrokSpot motion layer: drives a grokbot-web GrokBot with the body motion,
// eyelids, gaze and spins of the Grok Bot avatar motion system
// (https://x.ai/news/designing-grok-bot). Numbers follow the published
// behaviour; the code is our own.
//
// Body motion is applied as CSS transforms on the face canvas, so the
// library only has to repaint the eyes. Units are face units (the body is
// 210 units wide), converted to CSS pixels with the canvas scale.
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var SPRING_STEP = 1 / 120;

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function sign() { return Math.random() < 0.5 ? -1 : 1; }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) { return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); }
  function smootherstep(t) { return t * t * t * (t * (6 * t - 15) + 10); }
  function hump(t) { return Math.sin(clamp(t, 0, 1) * Math.PI); }

  var CENTER = 114.2705;
  // The bot is drawn with bodyScale 228.541 / 210, so the head radius is half of 228.541.
  var HEAD_RADIUS = CENTER;
  // Side dots are drawn once at this radius (units) and scaled from there.
  var DOT_RADIUS = 22;

  // Eye tuning per state, as in the lifecycle tour: idle and working get large
  // eyes, every other state smaller eyes set further apart.
  var WIDE_EYES = { size: 1, gap: 1, eyeWidth: 1.2, eyeHeight: 1.16 };
  var BASE_EYES = { size: 0.86, gap: 1.18, eyeWidth: 0.96, eyeHeight: 0.92 };
  var EYE_TWEAKS = {
    angry: { gap: 1.28, size: 0.78, eyeWidth: 0.88, eyeHeight: 0.84 },
    suspicious: { gap: 1.24, size: 0.82, eyeWidth: 0.9 },
    confused: { gap: 1.2, size: 0.84, eyeWidth: 0.9 },
    scared: { size: 0.8, eyeWidth: 0.9, eyeHeight: 0.88 },
    surprised: { size: 0.76, eyeWidth: 0.86, eyeHeight: 0.86 },
    excited: { size: 0.78, eyeWidth: 0.88, eyeHeight: 0.88 },
    celebrate: { size: 0.74, eyeWidth: 0.84, eyeHeight: 0.84 },
    happy: { size: 0.76, eyeWidth: 0.86, eyeHeight: 0.84 },
    curious: { size: 0.84 },
    drowsy: { size: 0.92, eyeWidth: 0.96 },
    bored: { size: 0.92, eyeWidth: 0.96 },
    sad: { size: 0.92, eyeWidth: 0.96 },
    playful: { size: 0.84, gap: 1.2 },
  };
  var TUNE_MS = 280;

  function eyeTune(state) {
    if (state === 'idle' || state === 'working') return WIDE_EYES;
    var tweak = EYE_TWEAKS[state] || {};
    return {
      size: Math.min(tweak.size !== undefined ? tweak.size : BASE_EYES.size, 0.92),
      gap: Math.max(tweak.gap !== undefined ? tweak.gap : BASE_EYES.gap, 1.14),
      eyeWidth: Math.min(tweak.eyeWidth !== undefined ? tweak.eyeWidth : BASE_EYES.eyeWidth, 1),
      eyeHeight: Math.min(tweak.eyeHeight !== undefined ? tweak.eyeHeight : BASE_EYES.eyeHeight, 1),
    };
  }

  function mixTune(from, to, k) {
    return {
      size: from.size + (to.size - from.size) * k,
      gap: from.gap + (to.gap - from.gap) * k,
      eyeWidth: from.eyeWidth + (to.eyeWidth - from.eyeWidth) * k,
      eyeHeight: from.eyeHeight + (to.eyeHeight - from.eyeHeight) * k,
    };
  }

  // States that hold one expression, and lids that never drop below a floor.
  var PINNED_EXPRESSION = { suspicious: 14, confused: 14, drowsy: 4, bored: 4, sad: 4 };
  var LID_FLOOR = { drowsy: 0.8, bored: 0.8, sad: 0.8 };

  // Morphs: the head shrinks into a small part of a symbol. Value is the head radius scale (units).
  // Parts other than dots/wave/bang are drawn on the effects canvas (morphParts).
  var MORPHS = {
    thinking: 'dots', alerting: 'bang', dictating: 'wave',
    orbit: 'orbit', radar: 'radar', progress: 'progress', spawning: 'gather',
    sending: 'send', receiving: 'receive', uploading: 'dock', bouncing: 'ball',
    loading: 'whirl', writing: 'pencil', 'powering-down': 'standby',
  };
  var MORPH_SIZE = {
    dots: 22, bang: 13, wave: 16, orbit: 19, radar: 19, progress: 19, gather: 19,
    send: 20, receive: 20, dock: 20, ball: 18, whirl: 15, pencil: 17, standby: 13,
  };
  // These states play their morph in cycles: held for this long, then back to
  // the face for MORPH_REST_MS, then again.
  var MORPH_HOLD = { progress: 2500, spawning: 2000 };
  var MORPH_REST_MS = 1500;
  // emphasize(): how long each ring takes to spread, the delay of the second one, and their colour.
  var EMPHASIS_MS = 750;
  var EMPHASIS_GAP_MS = 160;
  var EMPHASIS_COLOR = '#ffffff';
  // Virtual spin (rad/s) that flings the ribbon trails while loading or humming.
  var WHIRL_BASE = { loading: 3, humming: 1.6 };

  // Working evens its whole pool into calm eyes of the resting size: x.ai evens
  // 7 and 16; 11 (wide open) and 10 are included too, since 11 is twice the
  // length of the others and made the eyes jump in size as the pool cycled.
  var EVEN_EYES = { working: [7, 16, 11, 10] };
  // States that wink one eye now and then.
  var WINKING = { idle: true, happy: true, excited: true, curious: true, playful: true };
  var WINK_MS = 320;

  /** Pseudo voice level for the wave when no real audio level is coming in. */
  function idleVoice(now, slot) {
    return (0.42 + 0.29 * Math.sin(0.0021 * now) * Math.sin(0.0034 * now) + 0.29 * Math.sin(0.0013 * now + 1.7)) *
      (0.55 + 0.45 * Math.sin(0.012 * now - 1.05 * Math.abs(slot)));
  }

  /** Typing-dot wave: dot `slot` (0, 1, 2) lifts as the crest passes, every 1.4 s. */
  function dotWave(sinceMs, slot, amount) {
    var phase = ((sinceMs / 1400 + 0.119) % 1 + 1) % 1;
    var r = Math.abs(phase - slot / 3);
    r = Math.min(r, 1 - r);
    var crest = Math.exp(-(r * r) / 0.045);
    return { lift: 9 * crest * amount, pop: 0.84 + 0.22 * crest, tone: 1 - 0.5 * (1 - crest) };
  }

  /**
   * The pencil's nib over a 2.5 s cycle: writes a squiggly line left to right,
   * then lifts and arcs back. x, y in units from the centre, rot in degrees.
   */
  function pencilPen(ms) {
    var q = ((ms / 2500) % 1 + 1) % 1;
    var sway = Math.sin(0.0006 * ms);
    if (q < 0.68) {
      var e = q / 0.68;
      var env = clamp(e / 0.08, 0, 1) * clamp((1 - e) / 0.08, 0, 1);
      return { x: -54 + e * e * (3 - 2 * e) * 118, y: 26, wig: 3.2 * Math.sin(24 * e) * env, rot: 17 + sway, lift: false };
    }
    var k = easeInOutCubic((q - 0.68) / 0.32);
    return { x: 64 - 118 * k, y: 26 - 20 * Math.sin(Math.PI * k), wig: 0, rot: 17 - 2 * Math.sin(Math.PI * k) + sway, lift: true };
  }

  /** Damped spring toward `target`. */
  function Spring(value, omega, zeta) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.omega = omega;
    this.zeta = zeta;
  }
  Spring.prototype.step = function (dt) {
    var w = this.omega;
    this.v += (-2 * this.zeta * w * this.v - w * w * (this.x - this.target)) * dt;
    this.x += this.v * dt;
  };

  // Bounce: four decaying hops (height in units, duration in seconds).
  var HOPS = [{ h: 48, d: 0.5 }, { h: 28, d: 0.382 }, { h: 14, d: 0.27 }, { h: 6, d: 0.177 }];
  var HOPS_SECONDS = HOPS.reduce(function (sum, hop) { return sum + hop.d; }, 0);

  // Gaze saccades per state: target ranges in units (x up to ±15, y up to ±9)
  // and the wait before the next one, in ms.
  function saccade(state) {
    switch (state) {
      case 'idle': return { x: 0, y: 0, wait: [2500, 5500] };
      case 'listening': return { x: 15 * rand(-0.3, 0.3), y: 9 * rand(-0.25, 0.25), wait: [2200, 4200] };
      case 'thinking': return { x: sign() * rand(0.5, 1) * 15, y: -9 * rand(0.4, 1), wait: [1500, 2800] };
      case 'searching': return { x: sign() * rand(0.7, 1) * 15, y: 9 * rand(-1, 1), wait: [550, 1150] };
      case 'working': return { x: 15 * rand(-0.4, 0.4), y: 9 * rand(0.4, 1), wait: [1200, 2400] };
      case 'excited': return { x: 15 * rand(-1, 1), y: 9 * rand(-1, 0.3), wait: [700, 1400] };
      case 'surprised': return { x: 0, y: 0, wait: [1600, 2600] };
      case 'suspicious': return { x: 15 * sign(), y: 2.7, wait: [2200, 4200] };
      case 'angry': return { x: 15 * rand(-0.2, 0.2), y: 1.8, wait: [1800, 3200] };
      case 'drowsy': return { x: 15 * rand(-0.4, 0.4), y: 9 * rand(0.4, 1), wait: [2500, 4500] };
      case 'happy': return { x: 15 * rand(-0.7, 0.7), y: -9 * rand(0, 0.6), wait: [1800, 3400] };
      case 'curious': return { x: sign() * rand(0.6, 1) * 15, y: 9 * rand(-1, 1), wait: [950, 1900] };
      case 'confused': return { x: sign() * rand(0.5, 1) * 15, y: 9 * rand(-0.6, 1), wait: [1100, 2300] };
      case 'bored': return { x: sign() * rand(0.7, 1) * 15, y: 9 * rand(0.4, 0.9), wait: [3000, 6000] };
      case 'proud': return { x: 15 * rand(-0.3, 0.3), y: -9 * rand(0.3, 0.7), wait: [2600, 4600] };
      case 'shy': return { x: sign() * rand(0.6, 1) * 15, y: 9 * rand(0.5, 1), wait: [2000, 4000] };
      case 'sad': return { x: 15 * rand(-0.3, 0.3), y: 9 * rand(0.6, 1), wait: [2800, 5000] };
      case 'laughing': return { x: 15 * rand(-0.5, 0.5), y: -9 * rand(0.2, 0.6), wait: [800, 1700] };
      case 'scared': return { x: sign() * rand(0.7, 1) * 15, y: 9 * rand(-0.6, 0.6), wait: [450, 1050] };
      case 'playful': return { x: sign() * rand(0.5, 1) * 15, y: -9 * rand(0, 0.6), wait: [900, 1800] };
      case 'notifying': {
        var far = Math.random() < 0.72;
        return { x: (far ? 0.45 : 0.1) * 15, y: -9 * (far ? 0.3 : 0.05), wait: [1200, 2400] };
      }
      default: return { x: 15 * rand(-0.4, 0.4), y: 9 * rand(-0.3, 0.3), wait: [2500, 5000] };
    }
  }

  function GrokSpotMotion(bot, elements) {
    this.bot = bot;
    this.face = elements.face;
    this.shade = elements.shade;
    this.sideDots = elements.sideDots;
    this.bangBar = elements.bangBar;
    this.blinkCadence = elements.blinkCadence;
    this.fx = elements.fx || null;
    // Frame-rate cap: the 2 ms slack keeps 30 fps on a 60 Hz display at every other frame.
    this.frameMs = 1000 / (elements.frameRate || 30) - 2;

    // Body: rotation (deg), offset (units), scale. Eyes: lid, size, gaze.
    this.rot = new Spring(0, 5, 0.9);
    this.x = new Spring(0, 3.5, 1);
    this.y = new Spring(0, 4, 1);
    this.scale = new Spring(1, 10, 0.8);
    this.lid = new Spring(1, 26, 1);
    this.eye = new Spring(1, 9, 0.85);
    this.gazeX = new Spring(0, 13, 1);
    this.gazeY = new Spring(0, 13, 1);
    this.spinSpring = null;
    // Turning the head toward something the user touched (radians of head turn).
    this.lookTurn = new Spring(0, 7, 1);

    // Morph amount, cross-fade between two morphs, and the half turn the head makes entering or leaving one.
    this.morphIn = new Spring(0, 14, 1);
    this.morphMix = new Spring(1, 11, 1);
    this.morphTurn = new Spring(0, 14, 1);
    this.morph = null;
    this.prevMorph = null;
    this.morphStart = 0;
    this.morphActive = false;
    this.morphDir = 1;
    this.morphReleased = false;
    this.morphReleasedAt = 0;
    this.whirlAngle = 0;
    this.humming = new Spring(0, 6, 1);
    this.ink = [];
    this.receiveCycle = -1;
    this.receiveAngle = -0.7;

    this.tuneFrom = eyeTune(bot.options.state);
    this.tuneTo = this.tuneFrom;
    this.tuneStart = 0;

    this.start = performance.now();
    this.last = this.start;
    this.driftSeed = rand(0, TAU);
    this.lidKeys = [];
    this.trick = null;
    this.hopStart = -1;
    this.lastApplied = '';
    this.state = null;
    this.enter(bot.options.state, this.start);

    this.tick = this.tick.bind(this);
    if (this.fx) {
      var resize = this.resizeEffects.bind(this);
      window.addEventListener('resize', resize);
      resize();
    }
    requestAnimationFrame(this.tick);
  }

  GrokSpotMotion.prototype.resizeEffects = function () {
    this.fx.resize(this.unit(), window.innerWidth / 2, window.innerHeight / 2);
  };

  /** Confetti burst from the head (for events such as a finished answer). */
  GrokSpotMotion.prototype.burst = function () {
    if (this.fx) this.fx.burst(22, 1.1, 0.3);
  };

  /**
   * Marks a deliberate change of face (an agent chose it over MCP): the head
   * pops a little and blinks, and two bright rings ripple out from its edge.
   */
  GrokSpotMotion.prototype.emphasize = function () {
    var now = performance.now();
    this.emphasisAt = now;
    this.scale.v += 1.6;
    this.blink(now);
  };

  /** Switches state: resets per-state timers and blinks. */
  GrokSpotMotion.prototype.setState = function (name) {
    var pinned = PINNED_EXPRESSION[name];
    this.bot.update({
      springFrequency: name === 'searching' || name === 'excited' ? 10 : 6,
      evenEyes: EVEN_EYES[name] || [],
      state: name,
      expression: pinned === undefined ? null : pinned,
    });
    this.enter(name, performance.now());
  };

  GrokSpotMotion.prototype.enter = function (name, now) {
    if (this.state !== null) {
      this.tuneFrom = this.tune(now);
      this.tuneTo = eyeTune(name);
      this.tuneStart = now;
    }
    this.state = name;
    this.entered = now;
    this.morphReleased = false;
    this.nextSaccade = now + rand(500, 1400);
    this.nextBlink = now + rand(1500, 7000);
    this.nextNudge = now + rand(500, 1200);
    this.nextPose = now + rand(1200, 2200);
    this.nextSpin = now + (name === 'excited' ? rand(400, 1100)
      : name === 'searching' ? rand(800, 1600)
      : name === 'working' ? rand(1200, 2400)
      : rand(6000, 10000));
    this.nextFlourish = now + rand(2500, 5000);
    this.nextWild = name === 'celebrate' ? now + 140 : Infinity;
    this.poseEnd = 0;
    this.shakeEnd = 0;
    this.nodOff = 0;
    this.dragCycle = -1;
    this.notified = false;
    this.burstDone = false;
    this.nextWink = now + rand(4500, 10000);
    this.winkStart = -Infinity;
    if (name !== 'drowsy' && name !== 'waking' && name !== 'sleeping') this.blink(now);
  };

  /** Eye tuning at `now`, easing over 280 ms after a state change. */
  GrokSpotMotion.prototype.tune = function (now) {
    var k = smootherstep(clamp((now - this.tuneStart) / TUNE_MS, 0, 1));
    return mixTune(this.tuneFrom, this.tuneTo, k);
  };

  /** Tracks which morph the state asks for, cross-fading and half-turning on change. */
  GrokSpotMotion.prototype.updateMorph = function (now) {
    var want = MORPHS[this.state] || null;
    var hold = MORPH_HOLD[this.state];
    if (want && hold && want === this.morph) {
      if (!this.morphReleased && now - this.morphStart > hold) {
        this.morphReleased = true;
        this.morphReleasedAt = now;
      } else if (this.morphReleased && now - this.morphReleasedAt > MORPH_REST_MS) {
        this.morphReleased = false;
        this.morphStart = now;
      }
    }
    var on = !!want && !(hold && this.morphReleased);
    this.morphIn.target = on ? 1 : 0;
    if (want && want !== this.morph) {
      if (this.morph && this.morphIn.x > 0.02) {
        this.prevMorph = this.morph;
        this.morphMix.x = 0;
      } else {
        this.prevMorph = null;
        this.morphMix.x = 1;
      }
      this.morphMix.v = 0;
      this.morphMix.target = 1;
      this.morph = want;
      this.morphStart = now;
    }
    if (!want && this.morphIn.x < 0.004) { this.morph = null; this.prevMorph = null; }
    if (this.morphMix.x > 0.996) this.prevMorph = null;
    if (on !== this.morphActive) {
      this.morphActive = on;
      if (this.morphActive) this.morphDir = sign();
      this.morphTurn.target += Math.PI * this.morphDir;
    }
  };

  /** How much of morph `name` is showing, 0..1. */
  GrokSpotMotion.prototype.morphWeight = function (name) {
    var amount = clamp(this.morphIn.x, 0, 1);
    var mix = clamp(this.morphMix.x, 0, 1);
    if (name === this.morph) return amount * mix;
    if (name === this.prevMorph) return amount * (1 - mix);
    return 0;
  };

  /** Lid keyframes: shut, hold, overshoot open, settle; sometimes a double blink. */
  GrokSpotMotion.prototype.blink = function (now) {
    this.lidKeys.push(
      { at: now, v: 0.05 }, { at: now + 70, v: 0.05 },
      { at: now + 150, v: 1.08 }, { at: now + 300, v: 1 });
    if (Math.random() < 0.14) this.lidKeys.push({ at: now + 370, v: 0.05 }, { at: now + 480, v: 1 });
  };

  GrokSpotMotion.prototype.spin = function (turns, direction) {
    if (this.spinSpring || this.trick) return;
    this.spinSpring = new Spring(0, 6.2, 1);
    this.spinSpring.target = (turns || 1) * TAU * (direction || sign());
  };

  GrokSpotMotion.prototype.startTrick = function (kind, now) {
    if (this.trick || this.spinSpring) return;
    var turns = kind === 'dizzy' ? Math.round(rand(3, 4)) : kind === 'wild' ? 9 : 1;
    this.trick = { kind: kind, start: now, dir: sign(), turns: turns };
  };

  /**
   * Looks toward a point for `ms` (taps, a finger moving on the screen).
   * dx, dy: the point relative to the head centre, in units. Far points get the
   * full glance (±15, ±9) and the head leans a little toward them.
   */
  GrokSpotMotion.prototype.lookAt = function (dx, dy, ms) {
    var dist = Math.sqrt(dx * dx + dy * dy);
    var reach = clamp(dist / 90, 0, 1);
    var nx = dist > 0 ? dx / dist : 0;
    var ny = dist > 0 ? dy / dist : 0;
    this.attention = {
      gazeX: 15 * nx * reach,
      gazeY: 9 * ny * reach,
      leanX: 7 * nx * reach,
      leanY: 8 * ny * reach,
      rot: 6 * nx * reach,
      turn: 0.35 * nx * reach,
      until: performance.now() + (ms || 1500),
    };
    this.nextSaccade = this.attention.until;
  };

  /** Flinches away from a point on the head (dx, dy in units from the centre). */
  GrokSpotMotion.prototype.flinch = function (dx, dy) {
    var dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    this.x.v -= 60 * dx / dist;
    this.y.v -= 60 * dy / dist;
    this.rot.v -= 90 * dx / dist;
    this.blink(performance.now());
  };

  GrokSpotMotion.prototype.bounce = function (now) {
    if (this.hopStart < 0) this.hopStart = now;
  };

  /** Body targets for the current state. `r` is seconds since start, `s` since entering. */
  GrokSpotMotion.prototype.pose = function (now, r, s) {
    var p = { rot: 0, x: 0, y: 0, scale: 1, lid: 1, eye: 1 };
    var t;
    switch (this.state) {
      case 'sleeping':
        t = Math.min(s / 2, 1);
        var settle = hump(s / 0.5);
        p.rot = 4 * t + 2 * Math.sin(0.25 * r);
        p.x = -2 * t;
        p.y = 8 * t + 3 * Math.sin(0.55 * r) - 5 * settle;
        p.scale = 1 + 0.016 * Math.sin(0.55 * r) + 0.05 * settle;
        break;
      case 'waking':
        if (s < 0.75) {
          p.eye = 1 + 0.08 * clamp(s / 0.6, 0, 1);
          p.y = 4 - 10 * clamp(s / 0.75, 0, 1);
          p.scale = 1.02;
          if (s > 0.2 && !this.burstDone && this.fx) {
            this.burstDone = true;
            this.fx.burst(Math.round(rand(9, 13)), 0.8);
          }
        } else if (s >= 1.45) {
          t = Math.min((s - 1.45) / 0.65, 1);
          p.rot = 6 * Math.sin(t * Math.PI * 3) * (1 - t);
          p.y = 2 * Math.sin(0.9 * r);
        }
        break;
      case 'idle':
        p.rot = 1.5 * Math.sin(0.5 * r) + 0.6 * Math.sin(0.17 * r);
        p.x = Math.sin(0.27 * r);
        p.y = 1.2 * Math.sin(0.85 * r);
        p.scale = 1 + 0.007 * Math.sin(0.85 * r);
        break;
      case 'listening':
        p.rot = 8 + 1.5 * Math.sin(0.5 * r);
        p.x = 2;
        p.y = -2 + 0.8 * Math.sin(0.8 * r);
        p.scale = 1.015;
        if (now >= this.nextPose) { this.poseEnd = now + 380; this.nextPose = now + rand(1800, 3200); }
        if (now < this.poseEnd) {
          t = hump(1 - (this.poseEnd - now) / 380);
          p.y += 4.5 * t;
          p.rot += 2 * t;
        }
        break;
      case 'thinking':
        p.rot = -9 + 5 * Math.sin(0.35 * r);
        p.x = 5 * Math.sin(0.3 * r);
        p.y = 2.5 * Math.sin(0.6 * r);
        break;
      case 'searching':
        t = Math.sin(1.3 * r);
        p.rot = 13 * t;
        p.x = 7 * t;
        p.y = 3 * Math.sin(1.7 * r);
        if (now >= this.nextSpin) { this.spin(1); this.nextSpin = now + rand(4000, 7000); }
        break;
      case 'working':
        t = Math.sin(r * Math.PI * 3.2);
        p.rot = 4 + 2.5 * t;
        p.x = 3;
        p.y = 1.5 + 3 * Math.max(0, t);
        p.scale = 1 - 0.02 * Math.max(0, t);
        if (now >= this.nextSpin) { this.spin(1, 1); this.nextSpin = now + rand(6000, 9000); }
        break;
      case 'excited':
        t = (2.2 * r) % 1;
        p.y = 2 - 10 * Math.sin(t * Math.PI);
        p.scale = t < 0.1 ? 0.92 : t < 0.3 ? 1.05 : 1;
        p.x = 4 * Math.sin(1.1 * r);
        p.rot = 7 * Math.sin(r * Math.PI * 2.2);
        p.eye = 1.06;
        if (now >= this.nextSpin) { this.spin(1); this.nextSpin = now + rand(2800, 5000); }
        break;
      case 'surprised':
        t = Math.min(s / 1.2, 1);
        p.x = -4 * (1 - t);
        p.y = -8 * (1 - t);
        p.scale = s < 0.2 ? 1.08 : 1;
        p.eye = 1.15 - 0.08 * t;
        p.rot = 1.5 * Math.sin(11 * r) * (1 - t);
        break;
      case 'suspicious':
        p.rot = -6 + 3 * Math.sin(0.3 * r);
        p.x = -4 * Math.sin(0.25 * r);
        p.y = 1 + 1.2 * Math.sin(0.45 * r);
        p.lid = 0.85;
        if (now >= this.nextNudge) { this.rot.v += 30; this.nextNudge = now + rand(4000, 7000); }
        break;
      case 'angry':
        if (now >= this.nextNudge) {
          this.shakeEnd = now + 420;
          this.y.v += 70;
          this.nextNudge = now + rand(1800, 3200);
        }
        p.rot = now < this.shakeEnd ? 4.5 * Math.sin(0.05 * now) : 0;
        p.y = 3.5;
        p.scale = 0.975;
        break;
      case 'drowsy':
        p.rot = 2.5 * Math.sin(0.32 * r);
        p.x = 1.5 * Math.sin(0.2 * r);
        p.y = 6 + 2.2 * Math.sin(0.36 * r);
        p.scale = 1 + 0.022 * Math.sin(0.36 * r);
        p.lid = 0.34 + 0.07 * Math.sin(0.8 * r);
        if (now >= this.nextPose && !this.nodOff) this.nodOff = now;
        if (this.nodOff) this.nodOffPose(p, (now - this.nodOff) / 1000, now);
        break;
      case 'happy':
        t = Math.sin(2.4 * r);
        p.rot = 3 * Math.sin(1.2 * r);
        p.x = 2.5 * Math.sin(1.1 * r);
        p.y = -3 * Math.abs(t);
        p.scale = 1 + 0.02 * t;
        p.eye = 1.05;
        break;
      case 'curious':
        p.rot = 10 + 6 * Math.sin(0.7 * r);
        p.x = 5 * Math.sin(0.6 * r);
        p.y = -2 + 1.5 * Math.sin(0.9 * r);
        p.scale = 1.01;
        p.eye = 1.08;
        if (now >= this.nextPose) { this.poseEnd = now + 440; this.nextPose = now + rand(1600, 2800); }
        if (now < this.poseEnd) {
          t = hump(1 - (this.poseEnd - now) / 440);
          p.x += 8 * t;
          p.rot += 5 * t;
        }
        break;
      case 'confused':
        t = Math.sin(0.8 * r);
        p.rot = 12 * t;
        p.x = 3 * t;
        p.y = 2 * Math.sin(0.5 * r);
        p.lid = 0.9;
        if (now >= this.nextNudge) { this.rot.v += 22; this.nextNudge = now + rand(2600, 4200); }
        break;
      case 'bored':
        p.rot = -3 + 4 * Math.sin(0.25 * r);
        p.x = 4 * Math.sin(0.2 * r);
        p.y = 5 + 1.5 * Math.sin(0.35 * r);
        p.scale = 0.99;
        p.lid = 0.6;
        p.eye = 0.98;
        if (now >= this.nextNudge) { this.poseEnd = now + 600; this.nextNudge = now + rand(4000, 7000); }
        if (now < this.poseEnd) {
          t = hump(1 - (this.poseEnd - now) / 600);
          p.scale = 1 + 0.05 * t;
          p.y += 3 * t;
        }
        break;
      case 'proud':
        p.rot = 2.5 * Math.sin(0.4 * r);
        p.x = 2 * Math.sin(0.35 * r);
        p.y = -4 + Math.sin(0.6 * r);
        p.scale = 1.03;
        p.eye = 1.02;
        p.lid = 0.9;
        break;
      case 'shy':
        p.rot = -8 + 3 * Math.sin(0.5 * r);
        p.x = -3 + 2 * Math.sin(0.4 * r);
        p.y = 3;
        p.scale = 0.98;
        p.eye = 0.95;
        p.lid = 0.85;
        break;
      case 'sad':
        p.rot = 3 + 2 * Math.sin(0.3 * r);
        p.x = 1.5 * Math.sin(0.25 * r);
        p.y = 7 + Math.sin(0.4 * r);
        p.scale = 0.97;
        p.lid = 0.7;
        p.eye = 0.97;
        break;
      case 'laughing':
        t = Math.sin(r * Math.PI * 6.4);
        p.rot = 4 * t;
        p.x = 2 * Math.sin(2 * r);
        p.y = -5 * Math.abs(t);
        p.scale = 1 + 0.03 * t;
        p.lid = 0.7;
        break;
      case 'scared':
        p.rot = 2 * Math.sin(0.04 * now);
        p.x = -2 + 1.5 * Math.sin(0.05 * now);
        p.y = 2 + Math.sin(1.5 * r);
        p.scale = 0.97;
        p.eye = 1.12;
        p.lid = 1.05;
        break;
      case 'playful':
        p.rot = 8 * Math.sin(1.4 * r);
        p.x = 4 * Math.sin(1.1 * r);
        p.y = -3 * Math.abs(Math.sin(2.2 * r));
        p.scale = 1 + 0.015 * Math.sin(2.2 * r);
        p.eye = 1.06;
        if (now >= this.nextSpin) { this.spin(1); this.nextSpin = now + rand(3500, 6000); }
        break;
      case 'celebrate':
        p.y = -2.5 * Math.abs(Math.sin(1.6 * r));
        p.eye = 1.1;
        p.lid = 1.1;
        if (now >= this.nextWild) { this.startTrick('wild', now); this.nextWild = now + 6200; }
        break;
      case 'dragging': {
        var phase = (s % 3.4) / 3.4;
        var cycle = Math.floor(s / 3.4);
        if (phase < 0.12) {
          p.x = -16; p.y = -22; p.rot = -5;
        } else if (phase < 0.62) {
          p.x = -16 + 32 * easeInOutCubic((phase - 0.12) / 0.5);
          p.y = -22 + 2 * Math.sin(1.4 * r);
          p.rot = 6 * Math.sin(2.6 * r);
          p.eye = 1.06;
        } else {
          if (cycle !== this.dragCycle) { this.dragCycle = cycle; this.y.v += 90; }
          p.x = 16;
        }
        break;
      }
      case 'humming':
        p.rot = 2 * Math.sin(0.4 * r);
        p.x = 1.5 * Math.sin(0.3 * r);
        p.y = 1.5 * Math.sin(0.7 * r);
        break;
      case 'notifying':
        if (!this.notified && s > 0.12) { this.notified = true; this.y.v -= 26; this.blink(now); }
        p.eye = 1 + 0.05 * Math.exp(-3 * s);
        p.rot = 3;
        p.x = 2;
        p.y = -1;
        break;
      default:
        break;
    }
    return p;
  };

  /** Drowsy: the head sinks while the lids close, jerks awake, then settles back. */
  GrokSpotMotion.prototype.nodOffPose = function (p, t, now) {
    var e;
    if (t < 1.7) {
      e = t / 1.7;
      var sink = e * e;
      p.y = 6 + 19 * sink + 2.2 * Math.sin(e * Math.PI * 2.5) * (1 - e);
      p.rot = 10 * sink;
      p.lid = 0.34 - sink * 0.3;
      p.scale = 1 - 0.045 * sink;
    } else if (t < 2) {
      e = Math.sin((t - 1.7) / 0.3 * Math.PI);
      p.y = 25 - 7 * e;
      p.rot = 10 - 4 * e;
      p.lid = 0.04 + 0.42 * e;
    } else if (t < 3.5) {
      e = (t - 2) / 1.5;
      var back = 1 - Math.pow(1 - e, 2.2);
      p.y = 25 - 19 * back;
      p.rot = 10 * (1 - back);
      p.lid = e > 0.32 && e < 0.46 ? 0.05 : 0.46 - 0.12 * back;
    } else {
      this.nodOff = 0;
      this.nextPose = now + rand(1500, 3500);
    }
  };

  /** Occasional flourish in cheerful states. */
  GrokSpotMotion.prototype.flourish = function (now) {
    if (now < this.nextFlourish) return;
    this.nextFlourish = now + rand(9000, 18000);
    var roll = Math.random();
    if (this.state === 'happy' || this.state === 'excited' || this.state === 'proud') {
      if (roll < 0.55) this.spin(1); else this.startTrick('spinBounce', now);
    } else if (this.state === 'playful') {
      if (roll < 0.34) this.startTrick('spinBounce', now);
      else if (roll < 0.62) this.bounce(now);
      else if (roll < 0.86) this.startTrick('dizzy', now);
      else this.spin(1);
    }
  };

  /** Adds the active trick (spin with follow-through) onto the pose; returns the turn angle. */
  GrokSpotMotion.prototype.applyTrick = function (p, add, now) {
    var trick = this.trick;
    if (!trick) return null;
    var t = (now - trick.start) / 1000;
    var dir = trick.dir;
    if (trick.kind === 'spinBounce') {
      if (t < 0.7) return trick.turns * TAU * dir * easeInOutCubic(t / 0.7);
      this.bounce(now);
      this.trick = null;
      return null;
    }
    if (trick.kind === 'dizzy') {
      var spinUp = 0.55 + 0.16 * trick.turns;
      if (t < spinUp) return trick.turns * TAU * dir * (t / spinUp) * (t / spinUp);
      if (t < spinUp + 1.5) {
        var a = t - spinUp;
        var k = Math.pow(1 - a / 1.5, 1.3);
        add.rot += 17 * Math.sin(10 * a) * dir * k;
        add.x += 10 * Math.cos(10 * a) * dir * k;
        add.y += 3 * Math.sin(20 * a) * k;
        p.lid = 0.46 + 0.14 * Math.sin(21 * a);
        p.eye = 1.03;
        return null;
      }
      this.trick = null;
      return null;
    }
    // wild: wind up, race through nine turns, ease out, then wobble dizzily.
    if (t >= 5.49) { this.trick = null; return null; }
    var full = trick.turns * TAU;
    var speed = (full + 0.5) / 2.4625;
    var angle;
    if (t < 0.24) angle = -0.25 * (1 - Math.cos(t / 0.24 * Math.PI));
    else if (t < 0.54) angle = -0.5 + speed * (t - 0.24) * (t - 0.24) / 0.6;
    else if (t < 2.54) angle = -0.5 + speed * (0.15 + (t - 0.54));
    else if (t < 3.79) angle = -0.5 + speed * 2.15 + speed * 1.25 * (1 - Math.pow(1 - (t - 2.54) / 1.25, 4)) / 4;
    else angle = full;
    var wobble = 0;
    if (t > 2.54) {
      var e = Math.min((t - 2.54) / 1.25, 1);
      wobble = e < 0.4 ? 0 : Math.pow((e - 0.4) / 0.6, 2);
      if (t >= 3.79) wobble = Math.pow(1 - (t - 3.79) / 1.7, 1.6);
    }
    var d = Math.max(t - 2.54, 0);
    add.bodyRot += angle / full * 1080 * dir;
    add.rot += 11 * Math.sin(9.2 * d) * dir * wobble;
    add.x += (Math.cos(9.2 * d) - 1) * 6 * dir * wobble;
    add.y += 2.6 * Math.sin(18.4 * d) * wobble;
    add.gazeX += 13 * Math.sin(11.5 * d) * dir * wobble;
    add.gazeY += (Math.cos(9 * d) - 1) * 3.5 * wobble;
    p.lid = 1.14 - 0.44 * wobble + 0.1 * Math.sin(16 * d) * wobble;
    p.eye = 1.12 - 0.09 * wobble;
    return angle * dir;
  };

  /**
   * Checks every animation frame and only draws on every other one. A frame
   * where nothing changes costs the WebView nothing; sleeping on a timer
   * instead wakes too late on the Echo Spot and drops to ~16 fps.
   */
  GrokSpotMotion.prototype.scheduleNext = function () {
    requestAnimationFrame(this.tick);
  };

  GrokSpotMotion.prototype.tick = function (now) {
    if (now - this.last < this.frameMs) {
      this.scheduleNext();
      return;
    }
    var dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    var r = (now - this.start) / 1000;
    var s = (now - this.entered) / 1000;

    var p = this.pose(now, r, s);
    var add = { rot: 0, x: 0, y: 0, bodyRot: 0, gazeX: 0, gazeY: 0 };
    this.flourish(now);
    var trickTurn = this.applyTrick(p, add, now);

    var att = this.attention && now < this.attention.until ? this.attention : null;
    if (!att) this.lookTurn.target = 0;
    if (att) {
      this.gazeX.target = att.gazeX;
      this.gazeY.target = att.gazeY;
      p.x += att.leanX;
      p.y += att.leanY;
      p.rot += att.rot;
      this.lookTurn.target = att.turn;
    } else if (now >= this.nextSaccade) {
      var next = saccade(this.state);
      this.gazeX.target = next.x;
      this.gazeY.target = next.y;
      this.nextSaccade = now + rand(next.wait[0], next.wait[1]);
    }

    var cadence = this.blinkCadence(this.state);
    if (cadence && now >= this.nextBlink) {
      this.blink(now);
      this.nextBlink = now + rand(cadence.min, cadence.max);
    }

    var keyed = null;
    while (this.lidKeys.length && now >= this.lidKeys[0].at) keyed = this.lidKeys.shift().v;
    if (keyed !== null) this.lid.target = keyed;
    else if (!this.lidKeys.length) this.lid.target = Math.max(p.lid, LID_FLOOR[this.state] || 0);
    this.updateMorph(now);
    this.humming.target = this.state === 'humming' ? 1 : 0;

    if (this.state === 'working') {
      // Glancing down-left at the work makes the eyes up to 14% bigger.
      var left = clamp((-this.gazeX.x - 0.5) / 4.5, 0, 1);
      var down = clamp((this.gazeY.x - 3) / 6, 0, 1);
      p.eye *= 1 + 0.14 * left * left * (3 - 2 * left) * down * down * (3 - 2 * down);
    }

    this.rot.target = p.rot;
    this.x.target = p.x;
    this.y.target = p.y;
    this.scale.target = p.scale;
    this.eye.target = p.eye;

    var steps = Math.max(1, Math.ceil(dt / SPRING_STEP));
    var h = dt / steps;
    for (var i = 0; i < steps; i += 1) {
      this.rot.step(h); this.x.step(h); this.y.step(h); this.scale.step(h);
      this.lid.step(h); this.eye.step(h); this.gazeX.step(h); this.gazeY.step(h);
      this.morphIn.step(h); this.morphMix.step(h); this.morphTurn.step(h); this.lookTurn.step(h);
      this.humming.step(h);
      if (this.spinSpring) this.spinSpring.step(h);
    }

    var turn = 0;
    if (this.spinSpring) {
      turn = this.spinSpring.x;
      if (Math.abs(this.spinSpring.target - turn) < 0.004 && Math.abs(this.spinSpring.v) < 0.015) {
        this.spinSpring = null;
        turn = 0;
      }
    } else if (trickTurn !== null) {
      turn = trickTurn;
    }

    var hop = 0;
    if (this.hopStart >= 0) {
      var ht = (now - this.hopStart) / 1000;
      if (ht >= HOPS_SECONDS) this.hopStart = -1;
      else {
        var i0 = 0, begin = 0;
        while (i0 < HOPS.length - 1 && ht >= begin + HOPS[i0].d) { begin += HOPS[i0].d; i0 += 1; }
        var hs = (ht - begin) / HOPS[i0].d;
        hop = -4 * HOPS[i0].h * hs * (1 - hs);
      }
    }

    // Slow eye drift so the gaze never freezes.
    var seed = this.driftSeed;
    var driftX = 1.4 * Math.sin(0.00042 * now + seed) + 0.5 * Math.sin(0.001 * now + 2 * seed);
    var driftY = 0.9 * Math.sin(0.00058 * now + seed);

    // While morphed, the body pose fades out and the head shrinks into the symbol.
    var morphed = clamp(this.morphIn.x, 0, 1);
    var keep = 1 - morphed;
    var dots = this.morphWeight('dots');
    var bang = this.morphWeight('bang');
    var stateSecs = (now - this.entered) / 1000;
    var center = dotWave(now - this.morphStart, 1, morphed);
    var pop = dots > 0 ? 1 + (center.pop - 1) * (dots / Math.max(morphed, 0.001)) : 1;
    if (bang > 0) pop *= 1 + 0.04 * Math.exp(-((stateSecs % 2.2) * 5.5)) * bang;
    var mix = clamp(this.morphMix.x, 0, 1);
    var headSize = this.morph
      ? MORPH_SIZE[this.morph] * mix + MORPH_SIZE[this.prevMorph || this.morph] * (1 - mix)
      : 19;
    var tune = this.tune(now);
    var mm = this.morphMotion(now, stateSecs, dt);
    pop *= mm.pulse;

    // Wink: one eye closes and reopens over 320 ms.
    if (WINKING[this.state] && now >= this.nextWink) {
      this.winkStart = now;
      this.winkEye = Math.random() < 0.5 ? 0 : 1;
      this.nextWink = now + rand(4500, 10000);
    }
    var winkT = (now - this.winkStart) / WINK_MS;
    var wink = winkT >= 0 && winkT < 1 ? Math.max(winkT < 0.42 ? 1 - winkT / 0.42 : (winkT - 0.42) / 0.58, 0.04) : 1;

    // Where the head is drawn this frame, for effects that hug it (the emphasis rings).
    this.headX = (this.x.x + add.x) * keep + mm.x;
    this.headY = (this.y.x + add.y + hop) * keep - center.lift * dots + 58 * bang + mm.y;
    this.headScale = this.scale.x * keep + headSize / CENTER * pop * morphed;

    this.render({
      x: this.headX,
      y: this.headY,
      rot: (this.rot.x + add.rot + add.bodyRot) * keep + mm.rot,
      scale: this.headScale,
      opacity: (1 - (1 - center.tone) * dots) * mm.opacity,
      turn: turn + this.morphTurn.x + this.lookTurn.x,
      gazeX: this.gazeX.x + add.gazeX + driftX,
      gazeY: this.gazeY.x + add.gazeY + driftY,
      lid: morphed > 0.5 ? 0 : Math.max(this.lid.x, 0.04) * tune.eyeHeight,
      eye: clamp(this.eye.x, 0.2, 2) * tune.size,
      eyeGap: tune.gap,
      eyeWidth: tune.eyeWidth,
      eyeOpenEach: this.winkEye === 0 ? [wink, 1] : [1, wink],
    });
    this.renderParts(dots, this.morphWeight('wave'), now);
    this.renderBang(bang, stateSecs);
    if (this.fx) {
      this.fx.belt = 1 + (52 / CENTER - 1) * this.morphWeight('whirl');
      this.fx.setParts(this.morphParts(now, stateSecs));
      this.fx.update(now, dt, turn + this.whirlAngle,
        (!!this.trick && this.trick.kind === 'wild') || this.state === 'humming');
    }
    // Paint the eyes in this same frame as the transforms above (the bot runs with manualFrames).
    this.bot.frame(now);
    this.scheduleNext();
  };

  GrokSpotMotion.prototype.render = function (f) {
    var unit = this.unit();
    var move = 'translate(' + (f.x * unit).toFixed(2) + 'px,' + (f.y * unit).toFixed(2) + 'px)';
    var opacity = f.opacity.toFixed(3);
    this.face.style.transform = move + ' rotate(' + f.rot.toFixed(2) + 'deg) scale(' + f.scale.toFixed(4) + ')';
    this.face.style.opacity = opacity;
    // The shading stays lit from the same side, so it moves and breathes but does not rotate.
    this.shade.style.transform = 'translate(-50%,-50%) ' + move + ' scale(' + f.scale.toFixed(4) + ')';
    this.shade.style.opacity = opacity;

    var patch = {
      turn: f.turn,
      gaze: { x: f.gazeX / 13.2, y: f.gazeY / 8.4 },
      eyeOpen: f.lid,
      eyeScale: f.eye,
      eyeGap: f.eyeGap,
      eyeWidth: f.eyeWidth,
      eyeOpenEach: f.eyeOpenEach,
    };
    // With the eyes shut inside a morph nothing visible changes, so skip the repaint.
    var key = patch.eyeOpen === 0 ? 'hidden'
      : patch.turn.toFixed(3) + patch.gaze.x.toFixed(3) + patch.gaze.y.toFixed(3) +
        patch.eyeOpen.toFixed(3) + patch.eyeScale.toFixed(3) + patch.eyeGap.toFixed(3) + patch.eyeWidth.toFixed(3) +
        patch.eyeOpenEach[0].toFixed(3) + patch.eyeOpenEach[1].toFixed(3);
    if (key !== this.lastApplied) {
      this.lastApplied = key;
      this.bot.update(patch);
    }
  };

  /** CSS pixels per face unit, and the pixel position of a face-unit coordinate. */
  GrokSpotMotion.prototype.unit = function () { return this.face.clientWidth / 259; };
  function px(units, unit) { return ((units + 15) * unit).toFixed(2) + 'px'; }

  /** Feeds the speaking wave a voice level in 0..1 (for example from the reply audio). */
  GrokSpotMotion.prototype.setVoiceLevel = function (level) {
    this.voiceTarget = clamp(level, 0, 1);
    this.voiceAt = performance.now();
  };

  /**
   * The small dots around a morphed head: the two outer typing dots, which
   * pop out sideways and ride the same wave as the head, and the four dots
   * of the speaking wave, which rise and swell with the voice.
   */
  GrokSpotMotion.prototype.renderParts = function (dotsWeight, waveWeight, now) {
    var parts = [];
    var i;
    if (dotsWeight > 0.004) {
      var homes = [CENTER - 62, CENTER + 62];
      for (i = 0; i < 2; i += 1) {
        var grow = clamp((dotsWeight - 0.12 * i) / (1 - 0.12 * i), 0, 1);
        if (grow <= 0.004) continue;
        var crest = dotWave(now - this.morphStart, i === 0 ? 0 : 2, dotsWeight);
        parts.push({
          x: CENTER + (homes[i] - CENTER) * easeOutBack(grow),
          y: CENTER - crest.lift,
          r: HEAD_RADIUS * 22 / CENTER * 1.02 * easeOutCubic(grow) * crest.pop,
          opacity: easeOutCubic(grow) * crest.tone,
        });
      }
    }
    if (waveWeight > 0.004) {
      var live = now - (this.voiceAt || -Infinity) < 400;
      this.voice = (this.voice || 0) + ((live ? this.voiceTarget : 0) - (this.voice || 0)) * 0.35;
      var slots = [-2, -1, 1, 2];
      for (i = 0; i < slots.length; i += 1) {
        var slot = slots[i];
        var reach = Math.abs(slot);
        var show = clamp((waveWeight - 0.1 * reach) / (1 - 0.1 * reach), 0, 1);
        if (show <= 0.004) continue;
        var level = live
          ? this.voice * (0.55 + 0.45 * Math.sin(0.012 * now - 1.05 * reach))
          : idleVoice(now, slot);
        parts.push({
          x: CENTER + 44 * slot * easeOutBack(show),
          y: CENTER - 6 * clamp(level, 0, 1) * show,
          r: (7 + 9 * clamp(level, 0.08, 1)) * easeOutCubic(show),
          opacity: show,
        });
      }
    }

    var unit = this.unit();
    var base = DOT_RADIUS * unit;
    for (i = 0; i < this.sideDots.length; i += 1) {
      var dot = this.sideDots[i];
      var part = parts[i];
      if (!part) { dot.hidden = true; continue; }
      if (dot.hidden || dot.dataset.unit !== String(unit)) {
        dot.dataset.unit = String(unit);
        dot.style.width = dot.style.height = (2 * base).toFixed(2) + 'px';
        dot.style.left = 'calc(' + px(CENTER, unit) + ' - ' + base.toFixed(2) + 'px)';
        dot.style.top = dot.style.left;
      }
      dot.hidden = false;
      dot.style.transform = 'translate(' + ((part.x - CENTER) * unit).toFixed(2) + 'px,' +
        ((part.y - CENTER) * unit).toFixed(2) + 'px) scale(' + (part.r / DOT_RADIUS).toFixed(4) + ')';
      dot.style.opacity = part.opacity.toFixed(3);
    }
  };

  /**
   * Head motion inside the morphs that move the head itself: the bouncing
   * ball, the whirl's wobble, the pencil writing, the send/receive pulses and
   * the standby flicker. Offsets are in units and already weighted.
   * Also advances the whirl's virtual spin (ribbon trails while loading or humming).
   */
  GrokSpotMotion.prototype.morphMotion = function (now, stateSecs, dt) {
    var out = { x: 0, y: 0, rot: 0, pulse: 1, opacity: 1 };
    var T = now / 1000;
    var w;

    var base = WHIRL_BASE[this.state];
    if (base) {
      var e = stateSecs;
      var rate = e < 0.5 ? 7 * easeInOutCubic(e / 0.5)
        : e < 1.3 ? 7 + (base - 7) * easeInOutCubic((e - 0.5) / 0.8)
        : base + 0.3 * Math.sin(0.5 * e);
      this.whirlAngle += rate * dt;
    }

    w = this.morphWeight('ball');
    if (w > 0.004) {
      var g = 416 / 0.3844;
      var drop = Math.sqrt(80 / g);
      var height;
      if (stateSecs < drop) height = 40 - 0.5 * g * stateSecs * stateSecs;
      else {
        var hopT = (((stateSecs - drop) / 0.62) % 1 + 1) % 1;
        height = 208 * hopT * (1 - hopT);
      }
      out.y += (40 - height) * w;
    }

    w = this.morphWeight('whirl');
    if (w > 0.004) {
      out.x += (2 * Math.sin(0.9 * T) + 0.8 * Math.sin(1.7 * T)) * w;
      out.y += (2.4 * Math.sin(1.3 * T) + 1.2 * Math.sin(0.6 * T)) * w;
    }

    w = this.morphWeight('pencil');
    if (w > 0.004) {
      var pen = pencilPen(stateSecs * 1000);
      out.x += pen.x * w;
      out.y += (pen.y + 0.5 * pen.wig) * w;
      out.rot += pen.rot * w;
    }

    w = this.morphWeight('send');
    if (w > 0.004) {
      var i = ((stateSecs / 1.5) % 1 + 1) % 1;
      out.pulse *= 1 + w * ((i < 0.18 ? -0.06 * Math.sin(Math.PI * i / 0.18) : 0) +
        (i >= 0.18 && i < 0.42 ? 0.05 * Math.sin(Math.PI * (i - 0.18) / 0.24) : 0));
    }

    w = this.morphWeight('receive');
    if (w > 0.004) {
      var l = ((stateSecs / 1.7) % 1 + 1) % 1;
      out.pulse *= 1 + 0.11 * w * Math.sin(Math.PI * clamp((l - 0.58) / 0.34, 0, 1));
    }

    w = this.morphWeight('standby');
    if (w > 0.004) out.opacity *= 1 - (0.28 + 0.2 * Math.sin(0.0016 * now)) * w;
    return out;
  };

  /**
   * Everything the morphs draw around the head (dots, rings, the progress arc,
   * the pencil and its ink), for the effects canvas behind the head.
   */
  GrokSpotMotion.prototype.morphParts = function (now, stateSecs) {
    var parts = [];
    var w, a, k, s, e;
    var tS = stateSecs * 1000;
    var tM = now - this.morphStart;
    var mix = clamp(this.morphMix.x, 0, 1);
    var head = this.morph
      ? MORPH_SIZE[this.morph] * mix + MORPH_SIZE[this.prevMorph || this.morph] * (1 - mix)
      : 19;

    // Emphasis: a soft flash behind the head, then two rings spreading from its edge.
    var since = now - (this.emphasisAt || -Infinity);
    if (since < EMPHASIS_MS + EMPHASIS_GAP_MS) {
      var edge = HEAD_RADIUS * (this.headScale || 1);
      var cx = CENTER + (this.headX || 0);
      var cy = CENTER + (this.headY || 0);
      var flash = clamp(since / EMPHASIS_MS, 0, 1);
      parts.push({ kind: 'dot', x: cx, y: cy, r: edge * (1.04 + 0.1 * easeOutCubic(flash)), opacity: 0.45 * (1 - flash), color: EMPHASIS_COLOR });
      for (k = 0; k < 2; k += 1) {
        s = clamp((since - k * EMPHASIS_GAP_MS) / EMPHASIS_MS, 0, 1);
        if (s <= 0 || s >= 1) continue;
        parts.push({
          kind: 'ring', x: cx, y: cy,
          r: edge * (1.03 + 0.42 * easeOutCubic(s)),
          width: 7 * (1 - s) + 1,
          opacity: (k === 0 ? 0.95 : 0.6) * (1 - s),
          color: EMPHASIS_COLOR,
        });
      }
    }

    // Orbit: five dots on a flat ellipse, biggest at the top.
    w = this.morphWeight('orbit');
    if (w > 0.004) {
      a = easeOutCubic(w);
      var orbitR = 52 * easeOutBack(w);
      for (k = 0; k < 5; k += 1) {
        s = 0.0017 * now + k * TAU / 5;
        var depth = Math.cos(s);
        parts.push({
          kind: 'dot',
          x: CENTER + orbitR * Math.sin(s),
          y: CENTER - 0.42 * orbitR * Math.cos(s),
          r: Math.max(12 * (0.5 + 0.5 * clamp(depth, 0, 1)) * a, 0.3),
          opacity: clamp((depth + 0.4) / 0.6, 0.18, 1) * a,
        });
      }
    }

    // Radar: three rings spreading from the head every 1.3 s.
    w = this.morphWeight('radar');
    if (w > 0.004) {
      a = easeOutCubic(w);
      for (k = 0; k < 3; k += 1) {
        s = ((now / 1300 + k / 3) % 1 + 1) % 1;
        parts.push({ kind: 'ring', x: CENTER, y: CENTER, r: head + (104 - head) * s, width: 3.4 * (1 - 0.55 * s), opacity: a * (1 - s) * 0.9 });
      }
    }

    // Progress: a faint track and an arc filling clockwise from 12 o'clock.
    w = this.morphWeight('progress');
    if (w > 0.004) {
      a = easeOutCubic(w);
      var trackR = 62 * easeOutBack(w);
      var fill = clamp(clamp(tM / 2500, 0, 1) / 0.85, 0, 1);
      parts.push({ kind: 'ring', x: CENTER, y: CENTER, r: trackR, width: 5, opacity: 0.16 * a });
      if (fill > 0.001) parts.push({ kind: 'ring', x: CENTER, y: CENTER, r: trackR, width: 5, opacity: a, from: 0, to: TAU * fill });
    }

    // Gather (spawning): five dots spiral into the head, one after another.
    w = this.morphWeight('gather');
    if (w > 0.004) {
      a = easeOutCubic(w);
      for (k = 0; k < 5; k += 1) {
        s = clamp((tM / 2000 - 0.09 * k) / 0.62, 0, 1);
        if (s >= 1) continue;
        var land = easeOutCubic(s);
        var ang = 2.4 * k + 2.2 * s;
        var d = 96 * (1 - land);
        parts.push({
          kind: 'dot',
          x: CENTER + d * Math.cos(ang),
          y: CENTER + 0.8 * d * Math.sin(ang),
          r: 9 * (0.5 + 0.5 * land) * a,
          opacity: a * clamp(5 * s, 0, 1) * (1 - 0.25 * land),
        });
      }
    }

    // Send: a dot and its ghost launch up-right with a ripple, every 1.5 s.
    w = this.morphWeight('send');
    if (w > 0.004) {
      a = easeOutCubic(w);
      var i = ((tS / 1500) % 1 + 1) % 1;
      var go = clamp((i - 0.18) / 0.55, 0, 1);
      var main = go * go * (0.4 + 0.6 * go);
      if (go > 0 && go < 1) {
        parts.push({ kind: 'dot', x: CENTER + 0.74 * 108 * main, y: CENTER - 0.62 * 108 * main, r: 10 * (1 - 0.55 * main) * a, opacity: a * (1 - main * main) });
        e = clamp((i - 0.26) / 0.55, 0, 1);
        var ghost = e * e * (0.4 + 0.6 * e);
        if (e > 0 && e < 1) {
          parts.push({ kind: 'dot', x: CENTER + 0.74 * 108 * ghost, y: CENTER - 0.62 * 108 * ghost, r: 5 * (1 - 0.6 * ghost) * a, opacity: 0.3 * a * (1 - ghost) });
        }
      }
      e = clamp((i - 0.18) / 0.3, 0, 1);
      if (e > 0 && e < 1) parts.push({ kind: 'ring', x: CENTER, y: CENTER, r: 20 + 34 * easeOutCubic(e), width: 2.8 * (1 - e), opacity: 0.8 * a * (1 - e) });
    }

    // Receive: a dot curves in from a random direction every 1.7 s and is swallowed.
    w = this.morphWeight('receive');
    if (w > 0.004) {
      a = easeOutCubic(w);
      var cycle = Math.floor(tS / 1700);
      if (cycle !== this.receiveCycle) {
        this.receiveAngle = cycle === 0 ? -0.7 : rand(-1.25 * Math.PI, 0.25 * Math.PI);
        this.receiveCycle = cycle;
      }
      var l = ((tS / 1700) % 1 + 1) % 1;
      var n = clamp(l / 0.6, 0, 1);
      if (n < 1) {
        var near = easeOutCubic(n);
        var dist = 108 * (1 - near);
        var bow = 18 * Math.sin(Math.PI * n) * (1 - 0.7 * near);
        var phi = this.receiveAngle;
        parts.push({
          kind: 'dot',
          x: CENTER + Math.cos(phi) * dist - Math.sin(phi) * bow,
          y: CENTER + Math.sin(phi) * dist + Math.cos(phi) * bow,
          r: 3.5 + 6.5 * near,
          opacity: a * clamp(3.5 * n, 0, 1) * (0.3 + 0.7 * near),
        });
      }
      e = clamp((l - 0.58) / 0.32, 0, 1);
      if (e > 0 && e < 1) parts.push({ kind: 'ring', x: CENTER, y: CENTER, r: 20 + 26 * easeOutCubic(e), width: 2.8 * (1 - e), opacity: 0.8 * a * (1 - e) });
    } else {
      this.receiveCycle = -1;
    }

    // Dock (uploading): two satellites fly in from the bottom left and orbit.
    w = this.morphWeight('dock');
    if (w > 0.004) {
      a = easeOutCubic(w);
      for (k = 0; k < 2; k += 1) {
        s = clamp((stateSecs - (0.2 + 1.3 * k)) / 0.9, 0, 1);
        if (s <= 0) continue;
        var fly = easeOutCubic(s);
        var orbit = 0.0011 * now + k * Math.PI;
        var ox = CENTER + 42 * Math.sin(orbit);
        var oy = CENTER + 21 * Math.cos(orbit) + 2 * Math.sin(0.003 * now + k);
        var sx = CENTER - 120 + 30 * k;
        var sy = CENTER + 95;
        parts.push({ kind: 'dot', x: sx + (ox - sx) * fly, y: sy + (oy - sy) * fly, r: (7 + 3 * fly) * a, opacity: a * clamp(4 * s, 0, 1) });
      }
    }

    // Pencil (writing): the head is the nib; the body trails up its axis and the ink follows the tip.
    w = this.morphWeight('pencil');
    if (w > 0.004) {
      var pen = pencilPen(tS);
      // The ink grows while writing and erases from its start on the way back.
      if (w > 0.6 && !pen.lift) {
        var tip = [CENTER + pen.x, CENTER + pen.y + pen.wig + 19];
        var last = this.ink[this.ink.length - 1];
        if (!last || Math.hypot(tip[0] - last[0], tip[1] - last[1]) > 2.4) this.ink.push(tip);
        else this.ink[this.ink.length - 1] = tip;
        if (this.ink.length > 64) this.ink.shift();
      } else {
        this.ink.splice(0, 2);
      }
      var th = (pen.rot - 90) * Math.PI / 180;
      var grow = easeOutCubic(w);
      parts.push({
        kind: 'pill',
        x: CENTER + (pen.x + 68 * Math.cos(th)) * w,
        y: CENTER + (pen.y + 0.15 * pen.wig + 68 * Math.sin(th)) * w,
        w: 30 * grow,
        h: 88 * grow,
        rot: pen.rot * w,
        opacity: clamp(1.6 * w - 0.3, 0, 1),
      });
      parts.push({ kind: 'line', points: this.ink, width: 6, opacity: clamp(1.2 * w, 0, 1) });
    } else if (this.ink.length) {
      this.ink = [];
    }

    // Standby (powering down): a faint breathing glow, and a ring closing in as it goes.
    w = this.morphWeight('standby');
    if (w > 0.004) {
      a = easeOutCubic(w);
      var glow = 0.5 + 0.5 * Math.sin(0.0016 * now);
      parts.push({ kind: 'dot', x: CENTER, y: CENTER, r: 26 + 7 * glow, opacity: a * (0.06 + 0.1 * glow) });
      if (w < 0.995) parts.push({ kind: 'ring', x: CENTER, y: CENTER, r: 104 - 88 * a, width: 2.4, opacity: 0.5 * (1 - a) });
    }

    // Humming: two small dots circle the head on the humming spin.
    w = clamp(this.humming.x, 0, 1);
    if (w > 0.004) {
      var orbitHum = 1.3 * HEAD_RADIUS;
      for (k = 0; k < 2; k += 1) {
        var hum = 0.85 * this.whirlAngle + k * Math.PI;
        var q = 0.55 + 0.45 * clamp((Math.cos(hum) + 1) / 2, 0, 1);
        parts.push({
          kind: 'dot',
          x: CENTER + orbitHum * Math.sin(hum),
          y: CENTER - 0.38 * orbitHum * Math.cos(hum) - 8,
          r: 7.5 * q * w,
          opacity: (0.3 + 0.7 * q) * w,
        });
      }
    }
    return parts;
  };

  /** The bar of the "!" drops in above the head, then gives a short shake every 2.2 s. */
  GrokSpotMotion.prototype.renderBang = function (weight, stateSecs) {
    var bar = this.bangBar;
    if (weight <= 0.004) { bar.hidden = true; return; }
    var unit = this.unit();
    var drop = easeOutCubic(clamp(1.1 * weight, 0, 1));
    var shake = 2.2 * Math.sin(42 * stateSecs) * Math.exp(-((stateSecs % 2.2) * 5.5));
    var grow = clamp(1.2 * weight, 0, 1);
    var pivotX = px(CENTER, unit);
    var pivotY = px(40.3, unit);
    var mid = px(CENTER, unit);
    bar.hidden = false;
    bar.style.transform =
      'translateY(' + ((-26 - (1 - drop) * 70) * unit).toFixed(2) + 'px) ' +
      'translate(' + pivotX + ',' + pivotY + ') rotate(' + shake.toFixed(2) + 'deg) translate(-' + pivotX + ',-' + pivotY + ') ' +
      'translate(' + mid + ',' + mid + ') scale(' + grow.toFixed(3) + ') translate(-' + mid + ',-' + mid + ')';
    bar.style.opacity = clamp(1.5 * weight - 0.2, 0, 1).toFixed(3);
  };

  window.GrokSpotMotion = GrokSpotMotion;
})();

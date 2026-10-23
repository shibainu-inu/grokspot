// GrokSpot effects: the colourful parts of the Grok Bot motion system
// (https://x.ai/news/designing-grok-bot), drawn on two canvases, one behind
// the head and one in front of it.
//
// - Orbit trails: when the head spins fast, rainbow ribbons are flung onto
//   tilted orbits around it, follow the spin, then fade back in.
// - Confetti bursts: dots, streaks and gold stars thrown outward under gravity.
// - Morph parts: the dots, rings, arcs and pencil of the symbols the head
//   morphs into (motion.js computes them every frame, see setParts).
//
// Everything is in face units (the head is 210 units wide, centred on 114.27).
(function () {
  'use strict';

  var CENTER = 114.2705;
  // Morph parts share the head's light grey, drawn behind the head.
  var PART_COLOR = '#dedede';
  var PALETTE = ['#f9705c', '#5b95f0', '#3fbe86', '#f5b13f', '#9a72ee', '#35c3bd'];
  var STAR_COLOR = '#f4c34e';
  var TRAIL_STEP = 0.09;
  var MAX_TRAIL_POINTS = 48;

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function sign() { return Math.random() < 0.5 ? -1 : 1; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function GrokSpotEffects(back, front) {
    this.back = back;
    this.front = front;
    this.backCtx = back.getContext('2d');
    this.frontCtx = front.getContext('2d');
    this.trails = [];
    this.confetti = [];
    this.queue = [];
    this.lanes = [];
    this.count = 4;
    this.hueBase = 0;
    // The head's mid tone; index.html tints it with the face colour.
    this.partColor = PART_COLOR;
    this.lastAngle = 0;
    this.velocity = 0;
    this.launched = false;
    this.dirty = false;
    // Orbit size over the head radius: 1 around the full head, smaller while
    // a small morphed head whirls (loading).
    this.belt = 1;
    this.parts = [];
  }

  /**
   * The morph parts to draw behind the head this frame (face units):
   *   { kind: 'dot', x, y, r, opacity, color? }
   *   { kind: 'ring', x, y, r, width, opacity, from?, to? }  (from/to: arc in radians, 0 = 12 o'clock, clockwise)
   *   { kind: 'pill', x, y, w, h, rot (deg), opacity }
   *   { kind: 'line', points: [[x, y], ...], width, opacity }
   */
  GrokSpotEffects.prototype.setParts = function (parts) {
    this.parts = parts;
  };

  /** Sets the face scale: `unit` CSS px per face unit, head centre at (cx, cy) in CSS px. */
  GrokSpotEffects.prototype.resize = function (unit, cx, cy) {
    var dpr = window.devicePixelRatio || 1;
    var width = window.innerWidth;
    var height = window.innerHeight;
    var canvases = [this.back, this.front];
    for (var i = 0; i < canvases.length; i += 1) {
      canvases[i].width = Math.round(width * dpr);
      canvases[i].height = Math.round(height * dpr);
    }
    this.width = width * dpr;
    this.height = height * dpr;
    this.transform = [unit * dpr, 0, 0, unit * dpr, (cx - CENTER * unit) * dpr, (cy - CENTER * unit) * dpr];
  };

  /** Picks the orbit planes for one spin: one lane normally, three for a big spin. */
  GrokSpotEffects.prototype.planLanes = function (laneCount) {
    var roll = rand(-0.85, 0.85);
    this.lanes = [];
    for (var i = 0; i < laneCount; i += 1) {
      this.lanes.push({ tilt: rand(0.16, 0.5), roll: roll + i * Math.PI / laneCount + rand(-0.12, 0.12) });
    }
    this.count = laneCount > 1 ? 3 * laneCount : Math.round(rand(3, 5));
    this.hueBase = rand(0, 360);
  };

  GrokSpotEffects.prototype.spawnTrail = function (angle, direction, index) {
    if (this.trails.length > 110) return;
    if (!this.lanes.length) this.planLanes(1);
    var lane = this.lanes[index % this.lanes.length];
    var perLane = Math.max(Math.ceil(this.count / this.lanes.length) - 1, 1);
    var width = this.count <= 3 ? rand(8, 10.5) : this.count === 4 ? rand(6.6, 8.6) : rand(5.6, 7.4);
    this.trails.push({
      life: 0,
      max: 9,
      back: 0,
      width: width,
      hue: this.hueBase + 360 * index / Math.max(this.count, 1) + rand(-14, 14),
      hueSpan: rand(45, 95) * sign(),
      hueDrift: rand(18, 42) * sign(),
      angle: angle,
      drift: direction * rand(0.5, 1.1),
      tilt: lane.tilt + rand(-0.04, 0.04),
      roll: lane.roll + rand(-0.05, 0.05),
      radius: 116 * this.belt + Math.floor(index / this.lanes.length) * (38 / perLane) + rand(-1.5, 1.5),
      grow: rand(0, 2.5),
      follow: rand(0.74, 0.94),
      carry: 0,
      arc: rand(2.2, 3.4),
      points: [],
    });
  };

  /** Throws `count` pieces of confetti outward from the head's rim. */
  GrokSpotEffects.prototype.burst = function (count, speed, swirl) {
    count = count || 20;
    speed = speed || 1;
    swirl = swirl || 0;
    if (this.confetti.length > 120) return;
    for (var i = 0; i < count; i += 1) {
      var heading = i / count * Math.PI * 2 + rand(-0.35, 0.35);
      var start = rand(96, 116) * this.belt;
      var velocity = rand(170, 360) * speed;
      var spin = swirl * velocity * 0.2;
      var star = Math.random() < 0.18;
      this.confetti.push({
        x: CENTER + Math.cos(heading) * start,
        y: CENTER + Math.sin(heading) * start,
        vx: Math.cos(heading) * velocity - Math.sin(heading) * spin,
        vy: Math.sin(heading) * velocity + Math.cos(heading) * spin - rand(20, 75),
        life: 0,
        max: rand(0.45, 0.85),
        size: star ? rand(4, 7) : rand(3.5, 8),
        rot: rand(0, 360),
        spin: rand(-260, 260),
        color: star ? STAR_COLOR : PALETTE[Math.floor(Math.random() * PALETTE.length)],
        kind: star ? 'star' : Math.random() < 0.3 ? 'dot' : 'streak',
      });
    }
  };

  /** Point on a trail's tilted orbit, plus its depth (> 0 is in front of the head). */
  function orbitPoint(trail, angle) {
    var a = trail.radius * Math.sin(angle);
    var b = -trail.radius * Math.cos(angle) * Math.sin(trail.tilt);
    var cos = Math.cos(trail.roll);
    var sin = Math.sin(trail.roll);
    return {
      x: CENTER + a * cos - b * sin,
      y: CENTER + a * sin + b * cos,
      angle: angle,
      z: Math.cos(angle) * Math.cos(trail.tilt),
    };
  }

  /**
   * Advances everything by `dt` seconds. `angle` is the head's spin angle in
   * radians; `wide` asks for the three-lane trails of a big spin.
   */
  GrokSpotEffects.prototype.update = function (now, dt, angle, wide) {
    var delta = angle - this.lastAngle;
    if (!isFinite(delta) || Math.abs(delta) > 1.2) delta = 0;
    this.lastAngle = angle;
    var wasSpinning = Math.abs(this.velocity) >= 0.9;
    this.velocity = dt > 0 ? delta / dt : 0;
    var spinning = Math.abs(this.velocity) >= 0.9;
    if (!wasSpinning && spinning) { this.planLanes(wide ? 3 : 1); this.launched = false; }
    if (wasSpinning && !spinning) this.queue.length = 0;

    if (spinning && !this.launched && Math.abs(this.velocity) >= 5) {
      this.launched = true;
      for (var q = 0; q < this.count; q += 1) this.queue.push({ at: now + q * rand(55, 105), index: q });
      this.queue.sort(function (a, b) { return a.at - b.at; });
    }
    while (this.queue.length && now >= this.queue[0].at) {
      var next = this.queue.shift();
      this.spawnTrail(angle - rand(0, 0.18), Math.sign(this.velocity) || 1, next.index);
    }

    this.stepTrails(dt, spinning);
    this.stepConfetti(dt);
    this.draw();
  };

  GrokSpotEffects.prototype.stepTrails = function (dt, spinning) {
    var velocity = this.velocity;
    var kept = [];
    for (var i = 0; i < this.trails.length; i += 1) {
      var trail = this.trails[i];
      trail.life += dt;
      var leaving = !spinning || trail.life / trail.max > 0.55;
      trail.back = clamp(trail.back + (leaving ? dt / 0.5 : -dt / 0.35), 0, 1);
      if (trail.back >= 1) continue;

      if (spinning) {
        trail.carry = velocity * trail.follow;
        trail.angle += velocity * dt * trail.follow + trail.drift * dt;
      } else {
        trail.angle += (trail.carry + trail.drift) * dt;
        trail.carry *= Math.exp(-2.6 * dt);
        trail.drift *= Math.exp(-2.6 * dt);
      }
      trail.radius += trail.grow * dt;

      // Sample the orbit densely enough for a smooth ribbon, then trim it to its arc length.
      var points = trail.points;
      var from = points.length ? points[points.length - 1].angle : trail.angle;
      var span = trail.angle - from;
      var steps = Math.min(Math.ceil(Math.abs(span) / TRAIL_STEP), 24);
      for (var s = 1; s <= steps; s += 1) points.push(orbitPoint(trail, from + span * s / steps));
      if (!points.length) points.push(orbitPoint(trail, trail.angle));
      var arc = trail.arc * (1 - smoothstep(trail.back));
      while (points.length > 2 && Math.abs(trail.angle - points[0].angle) > arc) points.shift();
      var over = Math.abs(trail.angle - points[0].angle) - arc;
      if (points.length >= 2 && over > 0) {
        points[0] = orbitPoint(trail, points[0].angle + Math.sign(trail.angle - points[0].angle) * over);
      }
      if (points.length > MAX_TRAIL_POINTS) points.splice(0, points.length - MAX_TRAIL_POINTS);
      kept.push(trail);
    }
    this.trails = kept;
  };

  GrokSpotEffects.prototype.stepConfetti = function (dt) {
    var kept = [];
    var drag = Math.pow(0.94, 60 * dt);
    for (var i = 0; i < this.confetti.length; i += 1) {
      var piece = this.confetti[i];
      piece.life += dt;
      if (piece.life >= piece.max) continue;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.vx *= drag;
      piece.vy = piece.vy * drag + 40 * dt;
      piece.rot += piece.spin * dt;
      kept.push(piece);
    }
    this.confetti = kept;
  };

  GrokSpotEffects.prototype.draw = function () {
    var busy = this.trails.length > 0 || this.confetti.length > 0 || this.parts.length > 0;
    if (!busy && !this.dirty) return;
    var contexts = [this.backCtx, this.frontCtx];
    for (var c = 0; c < contexts.length; c += 1) {
      var ctx = contexts[c];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      var m = this.transform;
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    }
    for (var k = 0; k < this.parts.length; k += 1) this.drawPart(this.parts[k]);
    for (var i = 0; i < this.trails.length; i += 1) this.drawTrail(this.trails[i]);
    for (var j = 0; j < this.confetti.length; j += 1) this.drawConfetti(this.confetti[j]);
    this.dirty = busy;
  };

  GrokSpotEffects.prototype.drawPart = function (part) {
    if (part.opacity <= 0.004) return;
    var ctx = this.backCtx;
    ctx.globalAlpha = Math.min(1, part.opacity);
    ctx.fillStyle = part.color || this.partColor;
    ctx.strokeStyle = part.color || this.partColor;
    ctx.beginPath();
    switch (part.kind) {
      case 'dot':
        ctx.arc(part.x, part.y, Math.max(part.r, 0.3), 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'ring':
        ctx.lineWidth = part.width;
        ctx.lineCap = 'butt';
        if (part.from === undefined) ctx.arc(part.x, part.y, part.r, 0, Math.PI * 2);
        else ctx.arc(part.x, part.y, part.r, part.from - Math.PI / 2, part.to - Math.PI / 2);
        ctx.stroke();
        break;
      case 'pill': {
        var half = part.w / 2;
        ctx.save();
        ctx.translate(part.x, part.y);
        ctx.rotate(part.rot * Math.PI / 180);
        ctx.arc(0, -part.h / 2 + half, half, Math.PI, 0);
        ctx.arc(0, part.h / 2 - half, half, 0, Math.PI);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'line': {
        var pts = part.points;
        if (pts.length < 2) break;
        ctx.lineWidth = part.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Smooth through the points with midpoint quadratics.
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length - 1; i += 1) {
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.stroke();
        break;
      }
    }
    ctx.globalAlpha = 1;
  };

  /** One ribbon, tapering toward its tail, split into the parts behind and in front of the head. */
  GrokSpotEffects.prototype.drawTrail = function (trail) {
    var points = trail.points;
    var count = points.length;
    if (count < 2) return;
    var length = 0;
    for (var i = 1; i < count; i += 1) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    var head = points[count - 1];
    var shade = 0.72 + 0.28 * clamp(head.z, 0, 1);
    var appear = smoothstep(Math.min(trail.life / 0.34, 1));
    var width = Math.max(trail.width * shade * 1.7 * appear * (1 - 0.72 * trail.back * trail.back), 0.5);
    width = Math.min(width, 0.34 * length);
    var alpha = Math.min(1, trail.life / 0.26);

    // Ribbon edges: offset each point along its normal, wider toward the head.
    var nx = [];
    var ny = [];
    for (var k = 0; k < count; k += 1) {
      var prev = points[k > 0 ? k - 1 : 0];
      var next = points[k < count - 1 ? k + 1 : count - 1];
      var dx = next.x - prev.x;
      var dy = next.y - prev.y;
      var norm = Math.hypot(dx, dy) || 1;
      var half = width * (0.5 + k / (count - 1) * 0.5) / 2;
      nx.push(-dy / norm * half);
      ny.push(dx / norm * half);
    }

    var hue = trail.hue + trail.hueDrift * trail.life;
    var tail = points[0];
    var gradients = [];
    for (var g = 0; g < 2; g += 1) {
      var ctx = g === 0 ? this.backCtx : this.frontCtx;
      var gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      for (var stop = 0; stop < 5; stop += 1) {
        var at = stop / 4;
        var h = ((hue + at * trail.hueSpan) % 360 + 360) % 360;
        gradient.addColorStop(at, 'hsl(' + h.toFixed(0) + ', 56%, ' + (56 + 11 * at).toFixed(0) + '%)');
      }
      gradients.push(gradient);
    }

    // Walk runs of points on the same side of the head; each run overlaps its neighbours by one point.
    var start = 0;
    while (start < count) {
      var front = points[start].z >= 0;
      var end = start;
      while (end + 1 < count && (points[end + 1].z >= 0) === front) end += 1;
      var from = Math.max(start - 1, 0);
      var to = Math.min(end + 1, count - 1);
      if (to > from) {
        var target = front ? this.frontCtx : this.backCtx;
        target.globalAlpha = alpha;
        target.fillStyle = gradients[front ? 1 : 0];
        target.beginPath();
        for (var a = from; a <= to; a += 1) {
          if (a === from) target.moveTo(points[a].x + nx[a], points[a].y + ny[a]);
          else target.lineTo(points[a].x + nx[a], points[a].y + ny[a]);
        }
        for (var b = to; b >= from; b -= 1) target.lineTo(points[b].x - nx[b], points[b].y - ny[b]);
        target.closePath();
        target.fill();
        // Round end caps go in their own fill: in the ribbon's path their winding could cancel it out.
        if (from === 0 || to === count - 1) {
          target.beginPath();
          if (from === 0) capAt(target, points[0], nx[0], ny[0]);
          if (to === count - 1) capAt(target, head, nx[count - 1], ny[count - 1]);
          target.fill();
        }
        target.globalAlpha = 1;
      }
      start = end + 1;
    }
  };

  function capAt(ctx, point, nx, ny) {
    var radius = Math.max(Math.hypot(nx, ny), 0.2);
    ctx.moveTo(point.x + radius, point.y);
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  }

  GrokSpotEffects.prototype.drawConfetti = function (piece) {
    var ctx = this.frontCtx;
    var u = piece.life / piece.max;
    ctx.globalAlpha = u < 0.1 ? u / 0.1 : Math.pow(1 - (u - 0.1) / 0.9, 1.7);
    ctx.fillStyle = piece.color;
    var size = Math.max(piece.size * (1 - 0.4 * u), 0.5);
    ctx.beginPath();
    if (piece.kind === 'dot') {
      ctx.arc(piece.x, piece.y, size, 0, Math.PI * 2);
    } else if (piece.kind === 'star') {
      for (var p = 0; p < 10; p += 1) {
        var r = p % 2 === 0 ? size : size * 0.45;
        var t = piece.rot * Math.PI / 180 + p * Math.PI / 5 - Math.PI / 2;
        if (p === 0) ctx.moveTo(piece.x + r * Math.cos(t), piece.y + r * Math.sin(t));
        else ctx.lineTo(piece.x + r * Math.cos(t), piece.y + r * Math.sin(t));
      }
      ctx.closePath();
    } else {
      // A streak stretched along its direction of travel.
      var length = Math.max(2 * size, Math.min(0.05 * Math.hypot(piece.vx, piece.vy), 30));
      var thick = 1.5 * size;
      var heading = Math.atan2(piece.vy, piece.vx);
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(heading);
      roundRect(ctx, -length / 2, -thick / 2, length, thick, thick / 2);
      ctx.restore();
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
  }

  window.GrokSpotEffects = GrokSpotEffects;
})();

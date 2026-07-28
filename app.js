(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width;
  var H = canvas.height;

  var HIGH_SCORE_KEY = 'tah-game-asteroids-highscore';

  var SHIP_RADIUS = 4;
  var SHIP_ROT_SPEED = 3.4;
  var SHIP_THRUST = 55;
  var SHIP_REVERSE_THRUST = 28;
  var SHIP_MAX_SPEED = 85;
  var SHIP_DAMPING_PER_SEC = 0.999;
  var INVULN_TIME = 2.0;

  var BULLET_SPEED = 145;
  var BULLET_LIFESPAN = 1.0;
  var FIRE_COOLDOWN = 0.22;

  var WAVE_START_ASTEROIDS = 4;
  var WAVE_DELAY = 1.2;

  var SIZES = {
    large: { radius: 15, minSpeed: 8, maxSpeed: 22, score: 20, child: 'medium' },
    medium: { radius: 9, minSpeed: 18, maxSpeed: 36, score: 50, child: 'small' },
    small: { radius: 5, minSpeed: 32, maxSpeed: 55, score: 100, child: null }
  };

  var COLOR = {
    ship: '#f4f6f8',
    flame: '#ff8a3d',
    asteroid: '#8a929c',
    bullet: '#ffe08a',
    hud: '#c9cdd2',
    dim: '#5c6470',
    bad: '#ff6a5a'
  };

  var keys = {};
  var TRACKED = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'];

  window.addEventListener('keydown', function (e) {
    if (TRACKED.indexOf(e.code) !== -1) e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;
    if (state === 'start' || state === 'gameover') startGame();
  });
  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });
  window.addEventListener('blur', function () {
    keys = {};
  });

  function wrap(v, size) {
    v = v % size;
    if (v < 0) v += size;
    return v;
  }

  function wrappedDelta(a, b, size) {
    var d = a - b;
    if (d > size / 2) d -= size;
    else if (d < -size / 2) d += size;
    return d;
  }

  function wrapOffsets(x, y, r) {
    var xs = [0];
    if (x < r) xs.push(W);
    if (x > W - r) xs.push(-W);
    var ys = [0];
    if (y < r) ys.push(H);
    if (y > H - r) ys.push(-H);
    var out = [];
    for (var i = 0; i < xs.length; i++) {
      for (var j = 0; j < ys.length; j++) out.push([x + xs[i], y + ys[j]]);
    }
    return out;
  }

  function rotated(px, py, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    return [px * c - py * s, px * s + py * c];
  }

  var state = 'start';
  var time = 0;
  var score = 0;
  var lives = 3;
  var wave = 1;
  var waveClearAt = null;
  var isNewHigh = false;
  var highScore = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0;

  var ship = null;
  var bullets = [];
  var asteroids = [];
  var fireCooldown = 0;

  function makeShip() {
    return { x: W / 2, y: H / 2, vx: 0, vy: 0, angle: -Math.PI / 2, invuln: INVULN_TIME };
  }

  function makeAsteroidShape(radius) {
    var n = 8 + Math.floor(Math.random() * 5);
    var points = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var r = radius * (0.7 + Math.random() * 0.5);
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return points;
  }

  function spawnAsteroid(size, x, y) {
    var def = SIZES[size];
    var speed = def.minSpeed + Math.random() * (def.maxSpeed - def.minSpeed);
    var dir = Math.random() * Math.PI * 2;
    asteroids.push({
      size: size,
      x: x, y: y,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2,
      radius: def.radius,
      shape: makeAsteroidShape(def.radius)
    });
  }

  function spawnWave(count) {
    for (var i = 0; i < count; i++) {
      var x, y;
      do {
        x = Math.random() * W;
        y = Math.random() * H;
      } while (Math.hypot(wrappedDelta(x, W / 2, W), wrappedDelta(y, H / 2, H)) < 40);
      spawnAsteroid('large', x, y);
    }
  }

  function splitAsteroid(a) {
    var def = SIZES[a.size];
    score += def.score;
    if (def.child) {
      spawnAsteroid(def.child, a.x, a.y);
      spawnAsteroid(def.child, a.x, a.y);
    }
    if (score > highScore) {
      highScore = score;
      isNewHigh = true;
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
    }
  }

  function startGame() {
    score = 0;
    lives = 3;
    wave = 1;
    waveClearAt = null;
    isNewHigh = false;
    ship = makeShip();
    bullets = [];
    asteroids = [];
    fireCooldown = 0;
    spawnWave(WAVE_START_ASTEROIDS);
    state = 'playing';
  }

  function resetShip() {
    ship.x = W / 2;
    ship.y = H / 2;
    ship.vx = 0;
    ship.vy = 0;
    ship.angle = -Math.PI / 2;
    ship.invuln = INVULN_TIME;
  }

  function fire() {
    bullets.push({
      x: ship.x + Math.cos(ship.angle) * SHIP_RADIUS,
      y: ship.y + Math.sin(ship.angle) * SHIP_RADIUS,
      vx: Math.cos(ship.angle) * BULLET_SPEED,
      vy: Math.sin(ship.angle) * BULLET_SPEED,
      life: BULLET_LIFESPAN
    });
  }

  function updateShip(dt) {
    if (keys.KeyA) ship.angle -= SHIP_ROT_SPEED * dt;
    if (keys.KeyD) ship.angle += SHIP_ROT_SPEED * dt;
    if (keys.KeyW) {
      ship.vx += Math.cos(ship.angle) * SHIP_THRUST * dt;
      ship.vy += Math.sin(ship.angle) * SHIP_THRUST * dt;
    }
    if (keys.KeyS) {
      ship.vx -= Math.cos(ship.angle) * SHIP_REVERSE_THRUST * dt;
      ship.vy -= Math.sin(ship.angle) * SHIP_REVERSE_THRUST * dt;
    }

    var speed = Math.hypot(ship.vx, ship.vy);
    if (speed > SHIP_MAX_SPEED) {
      var k = SHIP_MAX_SPEED / speed;
      ship.vx *= k;
      ship.vy *= k;
    }

    var damping = Math.pow(SHIP_DAMPING_PER_SEC, dt);
    ship.vx *= damping;
    ship.vy *= damping;

    ship.x = wrap(ship.x + ship.vx * dt, W);
    ship.y = wrap(ship.y + ship.vy * dt, H);

    if (ship.invuln > 0) ship.invuln -= dt;

    fireCooldown -= dt;
    if (keys.Space && fireCooldown <= 0) {
      fire();
      fireCooldown = FIRE_COOLDOWN;
    }
  }

  function updateBullets(dt) {
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      b.x = wrap(b.x + b.vx * dt, W);
      b.y = wrap(b.y + b.vy * dt, H);
      b.life -= dt;
      if (b.life <= 0) bullets.splice(i, 1);
    }
  }

  function updateAsteroids(dt) {
    for (var i = 0; i < asteroids.length; i++) {
      var a = asteroids[i];
      a.x = wrap(a.x + a.vx * dt, W);
      a.y = wrap(a.y + a.vy * dt, H);
      a.angle += a.spin * dt;
    }
  }

  function checkCollisions() {
    for (var bi = bullets.length - 1; bi >= 0; bi--) {
      var b = bullets[bi];
      for (var ai = asteroids.length - 1; ai >= 0; ai--) {
        var a = asteroids[ai];
        var dx = wrappedDelta(b.x, a.x, W);
        var dy = wrappedDelta(b.y, a.y, H);
        if (dx * dx + dy * dy < a.radius * a.radius) {
          bullets.splice(bi, 1);
          asteroids.splice(ai, 1);
          splitAsteroid(a);
          break;
        }
      }
    }

    if (ship.invuln > 0) return;
    for (var j = 0; j < asteroids.length; j++) {
      var ast = asteroids[j];
      var sdx = wrappedDelta(ship.x, ast.x, W);
      var sdy = wrappedDelta(ship.y, ast.y, H);
      if (sdx * sdx + sdy * sdy < (ast.radius + SHIP_RADIUS) * (ast.radius + SHIP_RADIUS)) {
        lives -= 1;
        if (lives < 0) {
          state = 'gameover';
        } else {
          resetShip();
        }
        return;
      }
    }
  }

  function update(dt) {
    time += dt;
    updateAsteroids(dt);

    if (state !== 'playing') return;

    updateShip(dt);
    updateBullets(dt);
    checkCollisions();

    if (state === 'playing' && asteroids.length === 0) {
      if (waveClearAt === null) waveClearAt = time + WAVE_DELAY;
      else if (time >= waveClearAt) {
        wave += 1;
        waveClearAt = null;
        spawnWave(WAVE_START_ASTEROIDS);
      }
    }
  }

  function drawShip() {
    if (ship.invuln > 0 && Math.floor(time * 8) % 2 === 0) return;

    var nose = rotated(6, 0, ship.angle);
    var left = rotated(-4, 4, ship.angle);
    var right = rotated(-4, -4, ship.angle);

    var offsets = wrapOffsets(ship.x, ship.y, SHIP_RADIUS + 6);
    for (var i = 0; i < offsets.length; i++) {
      var ox = offsets[i][0], oy = offsets[i][1];

      if (keys.KeyW) {
        var flameLen = 3 + Math.random() * 3;
        var flameTip = rotated(-4 - flameLen, 0, ship.angle);
        var flameL = rotated(-3, 1.5, ship.angle);
        var flameR = rotated(-3, -1.5, ship.angle);
        ctx.fillStyle = COLOR.flame;
        ctx.beginPath();
        ctx.moveTo(ox + flameL[0], oy + flameL[1]);
        ctx.lineTo(ox + flameTip[0], oy + flameTip[1]);
        ctx.lineTo(ox + flameR[0], oy + flameR[1]);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = COLOR.ship;
      ctx.beginPath();
      ctx.moveTo(ox + nose[0], oy + nose[1]);
      ctx.lineTo(ox + left[0], oy + left[1]);
      ctx.lineTo(ox + right[0], oy + right[1]);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawAsteroids() {
    ctx.fillStyle = COLOR.asteroid;
    for (var i = 0; i < asteroids.length; i++) {
      var a = asteroids[i];
      var pts = a.shape.map(function (p) { return rotated(p[0], p[1], a.angle); });
      var offsets = wrapOffsets(a.x, a.y, a.radius);
      for (var k = 0; k < offsets.length; k++) {
        var ox = offsets[k][0], oy = offsets[k][1];
        ctx.beginPath();
        ctx.moveTo(ox + pts[0][0], oy + pts[0][1]);
        for (var p = 1; p < pts.length; p++) ctx.lineTo(ox + pts[p][0], oy + pts[p][1]);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawBullets() {
    ctx.fillStyle = COLOR.bullet;
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
    }
  }

  function pad(n) {
    return String(Math.max(0, Math.floor(n))).padStart(4, '0');
  }

  function drawHud() {
    ctx.font = '8px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.hud;

    ctx.textAlign = 'left';
    ctx.fillText('SCORE ' + pad(score), 4, 10);

    ctx.textAlign = 'right';
    ctx.fillText('HIGH ' + pad(highScore), W - 4, 10);

    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.dim;
    ctx.fillText('WAVE ' + wave, W / 2, 10);

    for (var i = 0; i < lives; i++) {
      var lx = 8 + i * 10, ly = H - 10;
      ctx.fillStyle = COLOR.ship;
      ctx.beginPath();
      ctx.moveTo(lx, ly - 4);
      ctx.lineTo(lx - 3, ly + 3);
      ctx.lineTo(lx + 3, ly + 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawOverlayText(lines) {
    ctx.textAlign = 'center';
    var startY = H / 2 - ((lines.length - 1) * 9) / 2;
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].text) continue;
      ctx.font = lines[i].size + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = lines[i].color || COLOR.hud;
      ctx.fillText(lines[i].text, W / 2, startY + i * 14);
    }
  }

  function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    drawAsteroids();

    if (state === 'playing') {
      drawShip();
      drawBullets();
      drawHud();
    } else if (state === 'start') {
      var blink = Math.floor(time * 2) % 2 === 0;
      drawOverlayText([
        { text: 'ASTEROIDS', size: 16, color: COLOR.ship },
        { text: '', size: 6 },
        { text: 'W THRUST   A/D ROTATE   S REVERSE   SPACE FIRE', size: 6, color: COLOR.dim },
        { text: '', size: 6 },
        { text: 'HIGH ' + pad(highScore), size: 7, color: COLOR.dim },
        { text: blink ? 'PRESS ANY KEY TO START' : '', size: 7 }
      ]);
    } else if (state === 'gameover') {
      var blink2 = Math.floor(time * 2) % 2 === 0;
      drawOverlayText([
        { text: 'GAME OVER', size: 16, color: COLOR.bad },
        { text: '', size: 6 },
        { text: 'SCORE ' + pad(score), size: 8 },
        { text: isNewHigh ? 'NEW HIGH SCORE' : 'HIGH ' + pad(highScore), size: 7, color: COLOR.dim },
        { text: '', size: 6 },
        { text: blink2 ? 'PRESS ANY KEY TO RESTART' : '', size: 7 }
      ]);
    }
  }

  var last = null;
  function frame(ts) {
    if (last === null) last = ts;
    var dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.05) dt = 0.05;

    update(dt);
    render();

    requestAnimationFrame(frame);
  }

  spawnWave(6);
  requestAnimationFrame(frame);
})();

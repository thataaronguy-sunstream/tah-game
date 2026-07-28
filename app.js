(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width;
  var H = canvas.height;

  // All audio is synthesized with Web Audio oscillators/noise - no asset
  // files, consistent with the rest of the game. AudioContext can't start
  // until a user gesture, so it's created lazily on the first keydown.
  var audio = (function () {
    var ac = null;
    var musicOn = false;
    var musicNextStepTime = 0;
    var musicStepIndex = 0;
    var MUSIC_STEP = 60 / 132 / 2;
    var MUSIC_PATTERN = [196, 0, 233, 0, 196, 0, 175, 0, 196, 0, 233, 0, 262, 0, 233, 0];

    function ensure() {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }

    function beep(freq, duration, type, volume, delay) {
      var a = ensure();
      var t0 = a.currentTime + (delay || 0);
      var osc = a.createOscillator();
      var gain = a.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume || 0.12, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(a.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    }

    function sweep(freqStart, freqEnd, duration, type, volume) {
      var a = ensure();
      var t0 = a.currentTime;
      var osc = a.createOscillator();
      var gain = a.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freqStart, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
      gain.gain.setValueAtTime(volume || 0.12, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(a.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    }

    function noiseBurst(duration, volume) {
      var a = ensure();
      var size = Math.floor(a.sampleRate * duration);
      var buffer = a.createBuffer(1, size, a.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
      var src = a.createBufferSource();
      src.buffer = buffer;
      var gain = a.createGain();
      gain.gain.setValueAtTime(volume || 0.15, a.currentTime);
      src.connect(gain);
      gain.connect(a.destination);
      src.start();
    }

    function startMusic() {
      if (musicOn) return;
      musicOn = true;
      musicNextStepTime = ensure().currentTime + 0.1;
      musicStepIndex = 0;
    }

    function tickMusic() {
      if (!musicOn) return;
      var a = ensure();
      while (musicNextStepTime < a.currentTime + 0.2) {
        var freq = MUSIC_PATTERN[musicStepIndex % MUSIC_PATTERN.length];
        if (freq > 0) {
          var osc = a.createOscillator();
          var gain = a.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, musicNextStepTime);
          gain.gain.setValueAtTime(0.04, musicNextStepTime);
          gain.gain.exponentialRampToValueAtTime(0.001, musicNextStepTime + MUSIC_STEP * 0.9);
          osc.connect(gain);
          gain.connect(a.destination);
          osc.start(musicNextStepTime);
          osc.stop(musicNextStepTime + MUSIC_STEP);
        }
        musicNextStepTime += MUSIC_STEP;
        musicStepIndex++;
      }
    }

    return {
      unlock: function () { ensure(); startMusic(); },
      tick: tickMusic,
      jump: function () { sweep(220, 440, 0.12, 'square', 0.07); },
      doubleJump: function () { sweep(330, 660, 0.12, 'square', 0.07); },
      attack: function () { beep(180, 0.07, 'square', 0.06); },
      hitEnemy: function () { beep(120, 0.06, 'square', 0.08); },
      hitPlayer: function () { sweep(200, 80, 0.15, 'sawtooth', 0.11); },
      corn: function () { beep(660, 0.07, 'square', 0.07); beep(880, 0.08, 'square', 0.06, 0.06); },
      roll: function () { noiseBurst(0.1, 0.05); },
      combineUnlock: function () {
        [440, 554, 659, 880].forEach(function (f, i) { beep(f, 0.15, 'square', 0.09, i * 0.09); });
      },
      death: function (kind) {
        if (kind === 'feather') noiseBurst(0.15, 0.09);
        else if (kind === 'straw') { noiseBurst(0.3, 0.13); sweep(300, 100, 0.3, 'sawtooth', 0.07); }
        else { beep(140, 0.08, 'square', 0.09); noiseBurst(0.08, 0.05); }
      },
      playerDeath: function () { sweep(300, 60, 0.6, 'sawtooth', 0.11); },
      levelClear: function () {
        [523, 659, 784, 1047].forEach(function (f, i) { beep(f, 0.2, 'square', 0.09, i * 0.12); });
      }
    };
  })();

  var GRAVITY = 420;
  var MAX_FALL_SPEED = 260;
  var MOVE_SPEED = 55;
  var JUMP_VELOCITY = -165;
  var DODGE_SPEED = 160;
  var DODGE_DURATION = 0.22;
  var DODGE_COOLDOWN = 0.5;
  var ATTACK_DURATION = 0.16;
  var ATTACK_COOLDOWN = 0.26;
  var COMBO_WINDOW = 0.45;
  var ATTACK_RANGE = 14;

  var PLAYER_W = 8, PLAYER_H = 14;
  var PLAYER_MAX_HP = 5;
  var PLAYER_HIT_INVULN = 0.8;

  var LEVEL_WIDTH = 900;
  var GROUND_Y = 164;

  var COLOR = {
    skyTop: '#6ec6f1',
    skyBottom: '#cdeeff',
    sun: '#ffe066',
    cloud: '#ffffff',
    hill: '#6fae52',
    outline: '#2a1f18',
    soil: '#8a5a3a',
    soilSeam: 'rgba(42,31,24,0.18)',
    grass: '#5fbf3f',
    crate: '#c68a45',
    crateDark: '#8a5a2c',
    player: '#3d6fd1',
    skin: '#f2c294',
    fork: '#d8dbe0',
    forkHandle: '#6a4526',
    crow: '#1e1e1e',
    crowBeak: '#f2a63d',
    boar: '#a8703f',
    boarDark: '#6a4526',
    boarLight: '#f5f1e6',
    barnWall: '#c1432f',
    barnRoof: '#7a2e1f',
    barnDoor: '#4a2c18',
    barnTrim: '#f5f1e6',
    hud: '#2a1f18',
    hpEmpty: '#d8cdb8',
    title: '#e88a2a',
    dim: '#4a3f38',
    bad: '#e0392a',
    good: '#4fc95f',
    flash: '#ffffff',
    panelBg: 'rgba(30,26,20,0.16)',
    waterTop: '#5ec8e8',
    waterDeep: '#1f6f9e',
    waterSurface: '#d6f6ff',
    corn: '#f2c14e',
    cornHusk: '#4a8f3f',
    combineBody: '#c1432f',
    combineDark: '#7a2e1f',
    combineHeader: '#e0b93a',
    wheel: '#2a1f18',
    feather: '#f2f0e6',
    bacon: '#e8836f',
    baconStripe: '#8a2e22',
    straw: '#e0c15a',
    scarecrowSack: '#d8b978',
    scarecrowBody: '#8a6a3a',
    scarecrowDark: '#5c4526',
    hat: '#4a3f38'
  };

  var SCORE_KEY = 'tah-game-deadfields-highscore';
  var CORN_SCORE = 25;
  var CROW_SCORE = 50;
  var BOAR_SCORE = 75;
  var BOSS_SCORE = 500;
  var COMBINE_THRESHOLD = 5;
  var COMBINE_W = 18, COMBINE_H = 11;

  var ENEMY_DEFS = {
    boar: { w: 14, h: 10, hp: 2, speed: 26, chargeSpeed: 72, detect: 55, contactDmg: 1 },
    crow: { w: 10, h: 8, hp: 1, speed: 20, detect: 50, contactDmg: 1 },
    scarecrow: { w: 16, h: 22, hp: 12, speed: 0, chargeSpeed: 0, detect: 0, contactDmg: 1 }
  };
  var BOSS_CROW_CAP = 20;
  var BOSS_CROW_CONCURRENT_CAP = 5;
  var BOSS_AGGRO_RANGE = 100;
  var BOSS_SPAWN_INTERVAL = 1.8;

  var keys = {};
  var TRACKED = ['KeyA', 'KeyD', 'KeyW', 'Space', 'ShiftLeft', 'ShiftRight'];
  var jumpQueued = false, attackQueued = false, rollQueued = false;

  window.addEventListener('keydown', function (e) {
    audio.unlock();
    if (TRACKED.indexOf(e.code) !== -1) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'KeyW' && !e.repeat) jumpQueued = true;
    if (e.code === 'Space' && !e.repeat) attackQueued = true;
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) rollQueued = true;
    if (e.repeat) return;
    if (state === 'start' || state === 'dead' || state === 'complete') startGame();
  });
  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });
  window.addEventListener('blur', function () {
    keys = {};
  });

  function aabbOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  var platforms = [];
  var barnX = 0;
  var water = { x: 0, w: 0 };
  var corns = [];
  var bridges = [];
  var GAPS = [
    { x: 160, w: 32, isWater: true },
    { x: 332, w: 32 },
    { x: 454, w: 32 },
    { x: 666, w: 32 }
  ];

  function makeCorn(x, y) {
    return { x: x, y: y, w: 5, h: 6, collected: false };
  }

  function buildLevel() {
    platforms = [
      { x: 0, y: GROUND_Y, w: 160, h: H - GROUND_Y },
      { x: 192, y: GROUND_Y, w: 140, h: H - GROUND_Y },
      { x: 364, y: GROUND_Y, w: 90, h: H - GROUND_Y },
      { x: 486, y: GROUND_Y, w: 180, h: H - GROUND_Y },
      { x: 698, y: GROUND_Y, w: LEVEL_WIDTH - 698, h: H - GROUND_Y },
      { x: 110, y: GROUND_Y - 26, w: 32, h: 6 },
      { x: 300, y: GROUND_Y - 32, w: 28, h: 6 },
      { x: 420, y: GROUND_Y - 24, w: 28, h: 6 },
      { x: 600, y: GROUND_Y - 30, w: 32, h: 6 }
    ];
    water = { x: 160, w: 32 };
    barnX = LEVEL_WIDTH - 80;

    // First 4 corn sit before the last gap (x=698); the last 2 sit in the
    // final segment. The combine unlocks at COMBINE_THRESHOLD=5, so by the
    // time it can trigger the player has already crossed every gap that
    // requires a jump - losing jump access afterward can never softlock a run.
    corns = [
      makeCorn(60, GROUND_Y - 6),
      makeCorn(230, GROUND_Y - 6),
      makeCorn(400, GROUND_Y - 6),
      makeCorn(550, GROUND_Y - 6),
      makeCorn(760, GROUND_Y - 6),
      makeCorn(790, GROUND_Y - 6)
    ];
  }

  var enemyIdCounter = 0;
  function makeEnemy(type, x, y) {
    var def = ENEMY_DEFS[type];
    enemyIdCounter++;
    return {
      id: enemyIdCounter, type: type, x: x, y: y, w: def.w, h: def.h,
      vx: 0, vy: 0, facing: -1, hp: def.hp, hitFlash: 0,
      spawnX: x, spawnY: y, patrolDir: 0, pauseTimer: 0,
      phase: Math.random() * 10, onGround: false, fellOut: false, dead: false
    };
  }

  function makeBoss(x, y) {
    var def = ENEMY_DEFS.scarecrow;
    enemyIdCounter++;
    return {
      id: enemyIdCounter, type: 'scarecrow', x: x, y: y, w: def.w, h: def.h,
      vx: 0, vy: 0, facing: -1, hp: def.hp, hitFlash: 0,
      spawnX: x, spawnY: y, patrolDir: 0, pauseTimer: 0,
      phase: 0, onGround: false, fellOut: false, dead: false,
      crowSpawnCount: 0, spawnTimer: BOSS_SPAWN_INTERVAL
    };
  }

  function buildEnemies() {
    return [
      makeEnemy('boar', 260, GROUND_Y - ENEMY_DEFS.boar.h),
      makeEnemy('crow', 140, GROUND_Y - 60),
      makeEnemy('boar', 410, GROUND_Y - ENEMY_DEFS.boar.h),
      makeEnemy('crow', 520, GROUND_Y - 55),
      makeEnemy('boar', 590, GROUND_Y - ENEMY_DEFS.boar.h),
      makeEnemy('crow', 760, GROUND_Y - 65),
      makeBoss(barnX - 24, GROUND_Y - ENEMY_DEFS.scarecrow.h)
    ];
  }

  function isBossAlive() {
    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].type === 'scarecrow' && !enemies[i].dead) return true;
    }
    return false;
  }

  function makePlayer() {
    return {
      x: 20, y: GROUND_Y - PLAYER_H, w: PLAYER_W, h: PLAYER_H,
      vx: 0, vy: 0, facing: 1, onGround: false,
      hp: PLAYER_MAX_HP, hitInvuln: 0,
      attackTimer: 0, attackCooldown: 0, comboStep: 0, comboResetTimer: 0, hitThisSwing: {},
      rolling: 0, rollCooldown: 0, fellOut: false, doubleJumpAvailable: true
    };
  }

  function pad(n) {
    return String(Math.max(0, Math.floor(n))).padStart(4, '0');
  }

  var state = 'start';
  var time = 0;
  var player = null;
  var enemies = [];
  var cameraX = 0;
  var score = 0;
  var highScore = parseInt(localStorage.getItem(SCORE_KEY), 10) || 0;
  var isNewHigh = false;
  var cornCollected = 0;
  var hasCombine = false;
  var upgradeMsgTimer = 0;
  var barnBlockedMsgTimer = 0;

  function transformToCombine() {
    hasCombine = true;
    var oldH = player.h;
    player.w = COMBINE_W;
    player.h = COMBINE_H;
    player.y += oldH - COMBINE_H;
    upgradeMsgTimer = 2.2;
    audio.combineUnlock();

    bridges = GAPS.map(function (g) {
      return { x: g.x, y: GROUND_Y, w: g.w, h: H - GROUND_Y, bridge: !g.isWater, noRender: !!g.isWater };
    });
    platforms = platforms.concat(bridges);
  }

  var particles = [];
  var PARTICLE_LIFE = { feather: 1.1, bacon: 0.9, straw: 1.3 };

  function spawnDeathEffect(e) {
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    var kind = e.type === 'crow' ? 'feather' : e.type === 'scarecrow' ? 'straw' : 'bacon';
    var count = kind === 'feather' ? 6 : kind === 'straw' ? 14 : 5;
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2;
      var speed = kind === 'feather' ? 10 + Math.random() * 20 : kind === 'straw' ? 30 + Math.random() * 60 : 20 + Math.random() * 40;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - (kind === 'feather' ? 10 : 20),
        life: PARTICLE_LIFE[kind], maxLife: PARTICLE_LIFE[kind],
        kind: kind, angle: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 6
      });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      var gravity = p.kind === 'feather' ? 30 : p.kind === 'straw' ? 150 : 240;
      p.vy += gravity * dt;
      if (p.kind === 'feather') {
        p.vx *= 1 - 1.5 * dt;
        if (p.vy > 25) p.vy = 25;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var alpha = Math.min(1, p.life / (p.maxLife * 0.4));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      if (p.kind === 'feather') {
        ctx.fillStyle = COLOR.feather;
        ctx.beginPath();
        ctx.ellipse(0, 0, 1.4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLOR.outline;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      } else if (p.kind === 'straw') {
        ctx.strokeStyle = COLOR.straw;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-3, 0);
        ctx.lineTo(3, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = COLOR.bacon;
        ctx.fillRect(-2.5, -1.5, 5, 3);
        ctx.strokeStyle = COLOR.baconStripe;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(-2, -1);
        ctx.lineTo(2, 1);
        ctx.stroke();
        ctx.strokeStyle = COLOR.outline;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(-2.5, -1.5, 5, 3);
      }
      ctx.restore();
    }
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    var pts = e.type === 'crow' ? CROW_SCORE : e.type === 'scarecrow' ? BOSS_SCORE : BOAR_SCORE;
    score += pts;
    if (score > highScore) {
      highScore = score;
      isNewHigh = true;
      localStorage.setItem(SCORE_KEY, String(highScore));
    }
    spawnDeathEffect(e);
    audio.death(e.type === 'crow' ? 'feather' : e.type === 'scarecrow' ? 'straw' : 'bacon');
  }

  function checkCorn() {
    for (var i = 0; i < corns.length; i++) {
      var c = corns[i];
      if (c.collected) continue;
      if (aabbOverlap(player.x, player.y, player.w, player.h, c.x, c.y, c.w, c.h)) {
        c.collected = true;
        cornCollected += 1;
        score += CORN_SCORE;
        audio.corn();
        if (score > highScore) {
          highScore = score;
          isNewHigh = true;
          localStorage.setItem(SCORE_KEY, String(highScore));
        }
        if (cornCollected === COMBINE_THRESHOLD && !hasCombine) transformToCombine();
      }
    }
  }

  function updateGrounded(e, dt) {
    var prevBottom = e.y + e.h;
    e.x += e.vx * dt;
    e.x = Math.max(0, Math.min(LEVEL_WIDTH - e.w, e.x));

    e.vy += GRAVITY * dt;
    if (e.vy > MAX_FALL_SPEED) e.vy = MAX_FALL_SPEED;
    e.y += e.vy * dt;

    e.onGround = false;
    if (e.vy >= 0) {
      for (var i = 0; i < platforms.length; i++) {
        var p = platforms[i];
        var newBottom = e.y + e.h;
        var horizOverlap = e.x + e.w > p.x && e.x < p.x + p.w;
        if (horizOverlap && prevBottom <= p.y + 0.5 && newBottom >= p.y) {
          e.y = p.y - e.h;
          e.vy = 0;
          e.onGround = true;
        }
      }
    }
    e.fellOut = e.y + e.h > H + 20;
  }

  function updatePlayer(dt) {
    if (player.hitInvuln > 0) player.hitInvuln -= dt;
    if (player.attackCooldown > 0) player.attackCooldown -= dt;
    if (player.comboResetTimer > 0) {
      player.comboResetTimer -= dt;
      if (player.comboResetTimer <= 0) player.comboStep = 0;
    }
    if (player.rollCooldown > 0) player.rollCooldown -= dt;

    if (rollQueued && player.rolling <= 0 && player.rollCooldown <= 0) {
      player.rolling = DODGE_DURATION;
      player.rollCooldown = DODGE_COOLDOWN;
      audio.roll();
    }
    rollQueued = false;

    if (player.rolling > 0) {
      player.rolling -= dt;
      player.vx = player.facing * DODGE_SPEED;
    } else {
      var move = 0;
      if (keys.KeyA) { move -= 1; player.facing = -1; }
      if (keys.KeyD) { move += 1; player.facing = 1; }
      player.vx = move * MOVE_SPEED;
    }

    if (player.onGround) player.doubleJumpAvailable = true;

    if (jumpQueued && player.rolling <= 0 && !hasCombine) {
      if (player.onGround) {
        player.vy = JUMP_VELOCITY;
        player.onGround = false;
        audio.jump();
      } else if (player.doubleJumpAvailable) {
        player.vy = JUMP_VELOCITY * 0.85;
        player.doubleJumpAvailable = false;
        audio.doubleJump();
      }
    }
    jumpQueued = false;

    if (attackQueued && player.attackCooldown <= 0 && player.rolling <= 0) {
      player.attackTimer = ATTACK_DURATION;
      player.attackCooldown = ATTACK_COOLDOWN;
      player.hitThisSwing = {};
      player.comboStep = player.comboResetTimer > 0 ? 1 - player.comboStep : 0;
      player.comboResetTimer = COMBO_WINDOW;
      audio.attack();
    }
    attackQueued = false;

    if (player.attackTimer > 0) player.attackTimer -= dt;

    updateGrounded(player, dt);
    if (player.fellOut) player.hp = 0;

    if (player.x + player.w / 2 > barnX) {
      if (!isBossAlive()) {
        if (state !== 'complete') audio.levelClear();
        state = 'complete';
      } else if (barnBlockedMsgTimer <= 0) {
        barnBlockedMsgTimer = 1.5;
      }
    }
    if (player.hp <= 0) {
      if (state !== 'dead') audio.playerDeath();
      state = 'dead';
    }
  }

  function resolveAttack() {
    if (player.attackTimer <= 0) return;
    var boxX = player.facing > 0 ? player.x + player.w : player.x - ATTACK_RANGE;
    var boxY = player.y - 2, boxW = ATTACK_RANGE, boxH = player.h + 4;
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      if (player.hitThisSwing[e.id]) continue;
      if (aabbOverlap(boxX, boxY, boxW, boxH, e.x, e.y, e.w, e.h)) {
        player.hitThisSwing[e.id] = true;
        e.hp -= 1;
        e.vx = player.facing * 60;
        e.vy = -40;
        e.hitFlash = 0.12;
        audio.hitEnemy();
        if (e.hp <= 0) killEnemy(e);
      }
    }
  }

  function checkEnemyContact() {
    if (hasCombine) {
      for (var c = 0; c < enemies.length; c++) {
        var ce = enemies[c];
        if (ce.dead) continue;
        if (!aabbOverlap(player.x, player.y, player.w, player.h, ce.x, ce.y, ce.w, ce.h)) continue;
        if (ce.type === 'scarecrow') {
          // Even the combine can't just roll through the boss - it's the one
          // thing in the level that can still hurt you once you've upgraded.
          if (player.hitInvuln <= 0 && player.rolling <= 0) {
            player.hp -= 1;
            player.hitInvuln = PLAYER_HIT_INVULN;
            audio.hitPlayer();
          }
        } else {
          killEnemy(ce);
        }
      }
      return;
    }
    if (player.hitInvuln > 0 || player.rolling > 0) return;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (aabbOverlap(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
        player.hp -= 1;
        player.hitInvuln = PLAYER_HIT_INVULN;
        player.vx = (player.x < e.x ? -1 : 1) * 70;
        player.vy = -60;
        audio.hitPlayer();
        if (e.type === 'boar') e.pauseTimer = 0.5;
        break;
      }
    }
  }

  function updateEnemy(e, dt) {
    var def = ENEMY_DEFS[e.type];
    if (e.hitFlash > 0) e.hitFlash -= dt;

    if (e.type === 'boar') {
      if (e.hitFlash > 0) {
        e.vx *= Math.max(0, 1 - 4 * dt);
      } else if (e.pauseTimer > 0) {
        e.pauseTimer -= dt;
        e.vx = 0;
      } else {
        var dx = player.x - e.x, dist = Math.abs(dx);
        if (dist < def.detect && Math.abs((player.y + player.h) - (e.y + e.h)) < 24) {
          e.facing = dx > 0 ? 1 : -1;
          e.vx = e.facing * def.chargeSpeed;
        } else {
          if (!e.patrolDir) e.patrolDir = 1;
          if (Math.abs(e.x - e.spawnX) > 25) e.patrolDir = e.x > e.spawnX ? -1 : 1;
          e.facing = e.patrolDir;
          e.vx = e.patrolDir * def.speed;
        }
      }
      updateGrounded(e, dt);
      if (e.fellOut) e.dead = true;
    } else if (e.type === 'crow') {
      e.phase += dt * 3;
      if (e.hitFlash > 0) {
        e.vy += 200 * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vx *= Math.max(0, 1 - 4 * dt);
      } else {
        e.vy = 0;
        var edx = player.x - e.x, edy = player.y - e.y;
        var edist = Math.hypot(edx, edy);
        if (edist < def.detect) {
          e.facing = edx > 0 ? 1 : -1;
          e.x += (edx / edist) * def.speed * 1.6 * dt;
          e.y += (edy / edist) * def.speed * 1.6 * dt;
        } else {
          if (!e.patrolDir) e.patrolDir = 1;
          if (Math.abs(e.x - e.spawnX) > 30) e.patrolDir = e.x > e.spawnX ? -1 : 1;
          e.facing = e.patrolDir;
          e.x += e.patrolDir * def.speed * dt;
          e.y = e.spawnY + Math.sin(e.phase) * 6;
        }
      }
      e.x = Math.max(0, Math.min(LEVEL_WIDTH - e.w, e.x));
    } else if (e.type === 'scarecrow') {
      if (Math.abs(player.x - e.x) < BOSS_AGGRO_RANGE) {
        e.spawnTimer -= dt;
        if (e.spawnTimer <= 0 && e.crowSpawnCount < BOSS_CROW_CAP) {
          var aliveBossCrows = 0;
          for (var k = 0; k < enemies.length; k++) {
            if (enemies[k].bossSpawned && !enemies[k].dead) aliveBossCrows++;
          }
          if (aliveBossCrows < BOSS_CROW_CONCURRENT_CAP) {
            var nc = makeEnemy('crow', e.x + (Math.random() - 0.5) * 24, e.y - 20 - Math.random() * 20);
            nc.bossSpawned = true;
            enemies.push(nc);
            e.crowSpawnCount++;
          }
          e.spawnTimer = BOSS_SPAWN_INTERVAL;
        }
      }
    }
  }

  function startGame() {
    buildLevel();
    player = makePlayer();
    enemies = buildEnemies();
    cameraX = 0;
    score = 0;
    isNewHigh = false;
    cornCollected = 0;
    hasCombine = false;
    upgradeMsgTimer = 0;
    barnBlockedMsgTimer = 0;
    bridges = [];
    particles = [];
    state = 'playing';
  }

  function update(dt) {
    time += dt;
    updateParticles(dt);
    audio.tick();

    if (state !== 'playing') {
      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.type === 'crow') {
          e.phase += dt * 3;
          e.y = e.spawnY + Math.sin(e.phase) * 6;
        }
      }
      return;
    }

    updatePlayer(dt);
    resolveAttack();
    checkCorn();
    if (upgradeMsgTimer > 0) upgradeMsgTimer -= dt;
    if (barnBlockedMsgTimer > 0) barnBlockedMsgTimer -= dt;
    for (var j = 0; j < enemies.length; j++) updateEnemy(enemies[j], dt);
    enemies = enemies.filter(function (e) { return !e.dead; });
    checkEnemyContact();

    cameraX = Math.max(0, Math.min(LEVEL_WIDTH - W, player.x + player.w / 2 - W / 2));
  }

  function drawSky() {
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, COLOR.skyTop);
    grad.addColorStop(1, COLOR.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = COLOR.sun;
    ctx.beginPath();
    ctx.arc(W - 46, 34, 14, 0, Math.PI * 2);
    ctx.fill();

    var cloudOffset = (cameraX * 0.15) % (W + 80);
    ctx.fillStyle = COLOR.cloud;
    for (var c = 0; c < 3; c++) {
      var cx = ((c * 140) - cloudOffset + W + 80) % (W + 80) - 40;
      var cy = 24 + (c % 2) * 20;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 16, 6, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 10, cy - 3, 10, 5, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 10, cy - 2, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHill() {
    ctx.fillStyle = COLOR.hill;
    var offset = cameraX * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, H - 30);
    for (var x = 0; x <= W; x += 8) {
      var wx = x + offset;
      ctx.lineTo(x, H - 30 - 10 * Math.sin(wx * 0.02) - 6 * Math.sin(wx * 0.05 + 1));
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawPlatforms() {
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (p.noRender) continue;
      if (p.bridge) {
        ctx.fillStyle = COLOR.crate;
        ctx.fillRect(p.x, p.y, p.w, 5);
        ctx.strokeStyle = COLOR.crateDark;
        ctx.lineWidth = 1;
        for (var bx = p.x + 6; bx < p.x + p.w; bx += 6) {
          ctx.beginPath();
          ctx.moveTo(bx + 0.5, p.y);
          ctx.lineTo(bx + 0.5, p.y + 5);
          ctx.stroke();
        }
        ctx.strokeStyle = COLOR.outline;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, 4);
        ctx.fillStyle = COLOR.crateDark;
        ctx.fillRect(p.x + 2, p.y + 5, 3, H - (p.y + 5));
        ctx.fillRect(p.x + p.w - 5, p.y + 5, 3, H - (p.y + 5));
      } else if (p.h > 10) {
        ctx.fillStyle = COLOR.soil;
        ctx.fillRect(p.x, p.y, p.w, p.h);

        ctx.strokeStyle = COLOR.soilSeam;
        ctx.lineWidth = 1;
        for (var tx = p.x + 8; tx < p.x + p.w; tx += 8) {
          ctx.beginPath();
          ctx.moveTo(tx + 0.5, p.y);
          ctx.lineTo(tx + 0.5, p.y + p.h);
          ctx.stroke();
        }
        for (var ty = p.y + 8; ty < p.y + p.h; ty += 8) {
          ctx.beginPath();
          ctx.moveTo(p.x, ty + 0.5);
          ctx.lineTo(p.x + p.w, ty + 0.5);
          ctx.stroke();
        }

        ctx.fillStyle = COLOR.grass;
        ctx.fillRect(p.x, p.y, p.w, 4);
        ctx.strokeStyle = COLOR.outline;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      } else {
        ctx.fillStyle = COLOR.crate;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = COLOR.crateDark;
        ctx.lineWidth = 1;
        for (var px2 = p.x + 8; px2 < p.x + p.w; px2 += 8) {
          ctx.beginPath();
          ctx.moveTo(px2 + 0.5, p.y);
          ctx.lineTo(px2 + 0.5, p.y + p.h);
          ctx.stroke();
        }
        ctx.strokeStyle = COLOR.outline;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      }
    }
  }

  function drawWater() {
    var y = GROUND_Y;
    var grad = ctx.createLinearGradient(0, y, 0, H);
    grad.addColorStop(0, COLOR.waterTop);
    grad.addColorStop(1, COLOR.waterDeep);
    ctx.fillStyle = grad;
    ctx.fillRect(water.x, y, water.w, H - y);

    ctx.strokeStyle = COLOR.waterSurface;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = water.x; x <= water.x + water.w; x += 2) {
      var wy = y + Math.sin((x + time * 40) * 0.4) * 1.2;
      if (x === water.x) ctx.moveTo(x, wy);
      else ctx.lineTo(x, wy);
    }
    ctx.stroke();

    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(water.x + 0.5, y + 0.5, water.w - 1, H - y - 1);
  }

  function drawBarn() {
    var x = barnX, w = LEVEL_WIDTH - barnX + 20;
    ctx.fillStyle = COLOR.barnWall;
    ctx.fillRect(x, GROUND_Y - 46, w, 46);
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, GROUND_Y - 45.5, w - 1, 45);

    ctx.strokeStyle = COLOR.barnTrim;
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y - 23);
    ctx.lineTo(x + w, GROUND_Y - 23);
    ctx.stroke();

    ctx.fillStyle = COLOR.barnRoof;
    ctx.beginPath();
    ctx.moveTo(x - 6, GROUND_Y - 46);
    ctx.lineTo(x + w / 2, GROUND_Y - 70);
    ctx.lineTo(x + w + 6, GROUND_Y - 46);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.stroke();

    ctx.fillStyle = COLOR.barnDoor;
    ctx.fillRect(x + w / 2 - 8, GROUND_Y - 26, 16, 26);
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(x + w / 2 - 7.5, GROUND_Y - 25.5, 15, 25);
    ctx.strokeStyle = COLOR.barnTrim;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, GROUND_Y - 26);
    ctx.lineTo(x + w / 2, GROUND_Y);
    ctx.stroke();
  }

  function drawCorn() {
    for (var i = 0; i < corns.length; i++) {
      var c = corns[i];
      if (c.collected) continue;
      var bob = Math.sin(time * 3 + c.x) * 1;
      var cx = c.x + c.w / 2, cy = c.y + c.h / 2 + bob;
      ctx.fillStyle = COLOR.cornHusk;
      ctx.beginPath();
      ctx.moveTo(cx, cy - c.h / 2 - 2);
      ctx.lineTo(cx - 2, cy - c.h / 2 + 1);
      ctx.lineTo(cx + 2, cy - c.h / 2 + 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLOR.corn;
      ctx.beginPath();
      ctx.ellipse(cx, cy, c.w / 2, c.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawCombine() {
    var p = player, x = p.x, y = p.y, w = p.w, h = p.h;
    var faceRight = p.facing > 0;
    var frontX = faceRight ? x + w : x;

    ctx.fillStyle = COLOR.wheel;
    ctx.beginPath();
    ctx.arc(x + w * 0.28, y + h, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w * 0.72, y + h, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLOR.combineBody;
    ctx.fillRect(x, y + 2, w, h - 2);
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 2.5, w - 1, h - 3);

    var cabX = faceRight ? x + 2 : x + w - 7;
    ctx.fillStyle = COLOR.combineDark;
    ctx.fillRect(cabX, y - 3, 5, 6);
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(cabX + 0.5, y - 2.5, 4, 5);

    var headerX = faceRight ? frontX - 2 : frontX;
    ctx.fillStyle = COLOR.combineHeader;
    ctx.fillRect(headerX, y + h - 6, 4, 6);
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(headerX + 0.5, y + h - 5.5, 3, 5);
    ctx.strokeStyle = COLOR.combineDark;
    for (var t = 0; t < 3; t++) {
      var ty = y + h - 5 + t * 2;
      ctx.beginPath();
      ctx.moveTo(headerX, ty);
      ctx.lineTo(headerX + 4, ty);
      ctx.stroke();
    }
  }

  function drawPitchfork(px, py, angle, len) {
    var tipX = px + Math.cos(angle) * len;
    var tipY = py + Math.sin(angle) * len;
    ctx.strokeStyle = COLOR.forkHandle;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.strokeStyle = COLOR.fork;
    ctx.lineWidth = 1;
    for (var s = -1; s <= 1; s++) {
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(angle) * 3, tipY + Math.sin(angle) * 3 + s * 2);
      ctx.stroke();
    }
  }

  function drawPlayer() {
    var p = player;
    var flashing = p.hitInvuln > 0 && Math.floor(time * 10) % 2 === 0;
    if (flashing) return;

    if (p.rolling > 0) {
      ctx.globalAlpha = 0.25;
      for (var g = 1; g <= 2; g++) {
        ctx.fillStyle = COLOR.player;
        ctx.fillRect(p.x - p.facing * g * 4, p.y + 2, p.w, p.h - 2);
      }
      ctx.globalAlpha = 1;
    }

    if (hasCombine) {
      drawCombine();
      return;
    }

    var cx = p.x + p.w / 2, cy = p.y;
    ctx.fillStyle = COLOR.player;
    ctx.fillRect(p.x, p.y + 4, p.w, p.h - 4);
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 4.5, p.w - 1, p.h - 5);

    ctx.fillStyle = COLOR.skin;
    ctx.beginPath();
    ctx.arc(cx, cy + 3, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.stroke();

    var handX = cx + p.facing * 3, handY = cy + 7;
    var angle;
    if (p.attackTimer > 0) {
      var t = 1 - player.attackTimer / ATTACK_DURATION;
      var sweep = (player.comboStep === 0) ? [-0.6, 0.9] : [0.9, -0.6];
      var a = sweep[0] + (sweep[1] - sweep[0]) * t;
      angle = p.facing > 0 ? a : Math.PI - a;
      drawPitchfork(handX, handY, angle, 11);
    } else {
      angle = p.facing > 0 ? 0.15 : Math.PI - 0.15;
      drawPitchfork(handX, handY, angle, 9);
    }
  }

  function drawEnemy(e) {
    var flashing = e.hitFlash > 0;
    ctx.lineWidth = 1;

    if (e.type === 'boar') {
      var bx = e.x, by = e.y, bw = e.w, bh = e.h;
      var cx = bx + bw / 2, cy = by + bh / 2;
      var faceX = e.facing > 0 ? bx + bw : bx;

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.boarDark;
      ctx.fillRect(bx + bw * 0.15, by + bh - 1, 2, 3);
      ctx.fillRect(bx + bw * 0.62, by + bh - 1, 2, 3);

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.boar;
      ctx.beginPath();
      ctx.ellipse(cx, cy, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      var earBaseX = cx + e.facing * bw * 0.2;
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.boarDark;
      ctx.beginPath();
      ctx.moveTo(earBaseX - 2, by + 1);
      ctx.lineTo(earBaseX - 0.5, by - 3);
      ctx.lineTo(earBaseX + 1.5, by + 1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      var snoutX = e.facing > 0 ? faceX - 3 : faceX;
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.boarLight;
      ctx.fillRect(snoutX, cy - 1.5, 3, 3);
      ctx.strokeStyle = COLOR.outline;
      ctx.strokeRect(snoutX + 0.5, cy - 1, 2, 2);

      ctx.fillStyle = COLOR.outline;
      ctx.fillRect(cx + e.facing * 3, cy - 3, 1, 1);
    } else if (e.type === 'crow') {
      var wingFlap = Math.sin(e.phase * 2) * 3;
      var cx2 = e.x + e.w / 2, cy2 = e.y + e.h / 2;
      var headX = cx2 + e.facing * 3, headY = cy2 - 1.5;

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.crow;
      ctx.beginPath();
      ctx.moveTo(cx2 - e.facing * 3, cy2);
      ctx.lineTo(cx2 - e.facing * 6, cy2 - 2);
      ctx.lineTo(cx2 - e.facing * 6, cy2 + 2);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx2 - e.facing * 1, cy2 - 0.5);
      ctx.lineTo(cx2 - e.facing * 4.5, cy2 - 3 - wingFlap);
      ctx.lineTo(cx2 + e.facing * 0.5, cy2 - 1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.crow;
      ctx.beginPath();
      ctx.ellipse(cx2, cy2 + 1, 3.2, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(headX, headY, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.crowBeak;
      ctx.beginPath();
      ctx.moveTo(headX + e.facing * 2, headY);
      ctx.lineTo(headX + e.facing * 4, headY + 0.5);
      ctx.lineTo(headX + e.facing * 2, headY + 1.5);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = COLOR.outline;
      ctx.fillRect(headX - 0.5, headY - 1.5, 1, 1);
    } else if (e.type === 'scarecrow') {
      var sx = e.x, sy = e.y, sw = e.w, sh = e.h;
      var scx = sx + sw / 2;

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.scarecrowDark;
      ctx.fillRect(sx - 4, sy + 9, sw + 8, 3);
      ctx.strokeStyle = COLOR.outline;
      ctx.strokeRect(sx - 3.5, sy + 9.5, sw + 7, 2);

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.scarecrowBody;
      ctx.fillRect(sx + 2, sy + 8, sw - 4, sh - 8);
      ctx.strokeStyle = COLOR.outline;
      ctx.strokeRect(sx + 2.5, sy + 8.5, sw - 5, sh - 9);

      ctx.strokeStyle = COLOR.straw;
      ctx.lineWidth = 1;
      for (var st = 0; st < 3; st++) {
        ctx.beginPath();
        ctx.moveTo(sx + 3 + st * 4, sy + sh);
        ctx.lineTo(sx + 2 + st * 4, sy + sh + 3);
        ctx.stroke();
      }

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.scarecrowSack;
      ctx.beginPath();
      ctx.ellipse(scx, sy + 4, sw / 2 - 1, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.hat;
      ctx.beginPath();
      ctx.moveTo(scx - 6, sy);
      ctx.lineTo(scx + 6, sy);
      ctx.lineTo(scx + 3, sy - 6);
      ctx.lineTo(scx - 3, sy - 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(scx - 4, sy + 3);
      ctx.lineTo(scx - 2, sy + 5);
      ctx.moveTo(scx - 2, sy + 3);
      ctx.lineTo(scx - 4, sy + 5);
      ctx.moveTo(scx + 2, sy + 3);
      ctx.lineTo(scx + 4, sy + 5);
      ctx.moveTo(scx + 4, sy + 3);
      ctx.lineTo(scx + 2, sy + 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(scx - 2, sy + 7);
      ctx.lineTo(scx + 2, sy + 7);
      ctx.stroke();
    }
  }

  function drawBossBar() {
    var boss = null;
    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].type === 'scarecrow') boss = enemies[i];
    }
    if (!boss || boss.dead) return;
    if (Math.abs(player.x - boss.x) > BOSS_AGGRO_RANGE * 1.6) return;

    var maxHp = ENEMY_DEFS.scarecrow.hp;
    var barW = 140, barH = 5, x = W / 2 - barW / 2, y = 20;
    ctx.textAlign = 'center';
    ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.hud;
    ctx.fillText('SCARECROW', W / 2, y - 3);

    ctx.fillStyle = COLOR.hpEmpty;
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = COLOR.bad;
    ctx.fillRect(x, y, barW * Math.max(0, boss.hp / maxHp), barH);
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, barW - 1, barH - 1);
  }

  function drawHud() {
    var pipW = 7, gap = 2, startX = 4, y = 4;
    for (var i = 0; i < PLAYER_MAX_HP; i++) {
      ctx.fillStyle = i < player.hp ? COLOR.bad : COLOR.hpEmpty;
      ctx.fillRect(startX + i * (pipW + gap), y, pipW, 6);
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(startX + i * (pipW + gap) + 0.5, y + 0.5, pipW - 1, 5);
    }

    ctx.font = '8px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.hud;
    ctx.fillText('SCORE ' + pad(score), W / 2, 10);
    ctx.textAlign = 'right';
    ctx.fillText('HIGH ' + pad(highScore), W - 4, 10);

    if (upgradeMsgTimer > 0) {
      ctx.textAlign = 'center';
      ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = COLOR.title;
      ctx.fillText('COMBINE UNLOCKED!', W / 2, 24);
    }

    if (barnBlockedMsgTimer > 0) {
      ctx.textAlign = 'center';
      ctx.font = '8px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = COLOR.bad;
      ctx.fillText('DEFEAT THE SCARECROW FIRST', W / 2, H - 6);
    }

    drawBossBar();
  }

  function drawOverlayText(lines) {
    ctx.textAlign = 'center';
    var startY = H / 2 - ((lines.length - 1) * 9) / 2;

    var panelH = lines.length * 14 + 10;
    ctx.fillStyle = COLOR.panelBg;
    ctx.fillRect(0, startY - 16, W, panelH);

    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].text) continue;
      ctx.font = lines[i].size + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = lines[i].color || COLOR.hud;
      ctx.fillText(lines[i].text, W / 2, startY + i * 14);
    }
  }

  function render() {
    drawSky();
    drawHill();

    ctx.save();
    ctx.translate(-cameraX, 0);
    drawWater();
    drawPlatforms();
    drawBarn();
    drawCorn();
    for (var i = 0; i < enemies.length; i++) drawEnemy(enemies[i]);
    if (player && (state === 'playing' || state === 'dead')) drawPlayer();
    drawParticles();
    ctx.restore();

    if (state === 'playing') {
      drawHud();
    } else if (state === 'start') {
      var blink = Math.floor(time * 2) % 2 === 0;
      drawOverlayText([
        { text: 'DEAD FIELDS', size: 16, color: COLOR.title },
        { text: '', size: 6 },
        { text: 'A/D MOVE   W JUMP   SPACE ATTACK   SHIFT ROLL', size: 6, color: COLOR.dim },
        { text: '', size: 6 },
        { text: blink ? 'PRESS ANY KEY TO START' : '', size: 7 }
      ]);
    } else if (state === 'dead') {
      var blink2 = Math.floor(time * 2) % 2 === 0;
      drawOverlayText([
        { text: 'YOU DIED', size: 16, color: COLOR.bad },
        { text: '', size: 5 },
        { text: 'SCORE ' + pad(score), size: 8 },
        { text: isNewHigh ? 'NEW HIGH SCORE' : 'HIGH ' + pad(highScore), size: 7, color: COLOR.dim },
        { text: '', size: 4 },
        { text: blink2 ? 'PRESS ANY KEY TO RESTART' : '', size: 7 }
      ]);
    } else if (state === 'complete') {
      var blink3 = Math.floor(time * 2) % 2 === 0;
      drawOverlayText([
        { text: 'LEVEL CLEAR', size: 16, color: COLOR.good },
        { text: '', size: 5 },
        { text: 'SCORE ' + pad(score), size: 8 },
        { text: isNewHigh ? 'NEW HIGH SCORE' : 'HIGH ' + pad(highScore), size: 7, color: COLOR.dim },
        { text: '', size: 4 },
        { text: blink3 ? 'PRESS ANY KEY TO PLAY AGAIN' : '', size: 7 }
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

  buildLevel();
  player = makePlayer();
  enemies = buildEnemies();
  requestAnimationFrame(frame);
})();

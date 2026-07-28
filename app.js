(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  // Game logic stays in a 320x180 logical space; the backing buffer is 4x that
  // and every frame scales up. Because the art is drawn with vector primitives
  // rather than pixel sprites, this renders arcs/strokes/text at full 1280x720
  // fidelity instead of snapping them to a chunky 320x180 grid.
  var LOGICAL_W = 320;
  var LOGICAL_H = 180;
  var SCALE = canvas.width / LOGICAL_W;
  var W = LOGICAL_W;
  var H = LOGICAL_H;

  // ---------------------------------------------------------------- audio ---
  // All audio is synthesized with Web Audio oscillators/noise - no asset
  // files. AudioContext can't start until a user gesture, so it's created
  // lazily on the first keydown.
  var audio = (function () {
    var ac = null;
    var musicOn = false;
    var musicNextStepTime = 0;
    var musicStepIndex = 0;
    var musicBus = null;

    // Warm pastoral loop: a G-Em-C-D folk progression across 4 bars of eighth
    // notes, split into bass / melody / offbeat pluck layers and run through a
    // lowpass so it reads as gentle Americana rather than chiptune.
    var MUSIC_BPM = 92;
    var MUSIC_STEP = 60 / MUSIC_BPM / 2;
    var STEPS_PER_BAR = 8;
    var MUSIC_LEN = STEPS_PER_BAR * 4;

    var BASS_ROOTS = [98.00, 82.41, 65.41, 73.42];
    var CHORD_TONES = [
      [196.00, 246.94, 293.66],
      [164.81, 196.00, 246.94],
      [130.81, 164.81, 196.00],
      [146.83, 220.00, 293.66]
    ];
    var MELODY = [
      392.00, 0, 329.63, 0, 293.66, 0, 0, 0,
      329.63, 0, 293.66, 0, 246.94, 0, 0, 0,
      329.63, 0, 261.63, 0, 293.66, 0, 0, 0,
      293.66, 0, 246.94, 0, 220.00, 0, 246.94, 0
    ];

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

    function musicOut() {
      var a = ensure();
      if (!musicBus) {
        var filter = a.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2200;
        var g = a.createGain();
        g.gain.value = 0.9;
        filter.connect(g);
        g.connect(a.destination);
        musicBus = filter;
      }
      return musicBus;
    }

    function musicNote(freq, time, dur, type, vol) {
      var a = ensure();
      var osc = a.createOscillator();
      var gain = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(vol, time + Math.min(0.05, dur * 0.3));
      gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(gain);
      gain.connect(musicOut());
      osc.start(time);
      osc.stop(time + dur + 0.02);
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
      while (musicNextStepTime < a.currentTime + 0.25) {
        var i = musicStepIndex % MUSIC_LEN;
        var bar = Math.floor(i / STEPS_PER_BAR);
        var beat = i % STEPS_PER_BAR;
        var t = musicNextStepTime;

        if (beat === 0) musicNote(BASS_ROOTS[bar], t, MUSIC_STEP * 3.4, 'triangle', 0.075);
        else if (beat === 4) musicNote(BASS_ROOTS[bar] * 1.5, t, MUSIC_STEP * 2.6, 'triangle', 0.048);

        if (MELODY[i] > 0) musicNote(MELODY[i], t, MUSIC_STEP * 1.7, 'sine', 0.058);

        if (beat % 2 === 1) {
          var tones = CHORD_TONES[bar];
          musicNote(tones[Math.floor(beat / 2) % tones.length], t, MUSIC_STEP * 0.85, 'triangle', 0.022);
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
      transform: function () { sweep(120, 300, 0.25, 'sawtooth', 0.08); },
      menuMove: function () { beep(440, 0.04, 'square', 0.05); },
      buy: function () {
        [523, 784].forEach(function (f, i) { beep(f, 0.12, 'square', 0.08, i * 0.08); });
      },
      upgradePick: function () {
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
      },
      bossSwing: function () { sweep(150, 60, 0.2, 'sawtooth', 0.1); }
    };
  })();

  // ------------------------------------------------------------- tuning ----
  var GRAVITY = 420;
  var MAX_FALL_SPEED = 260;
  var MOVE_SPEED = 55;
  var COMBINE_MOVE_SPEED = 46;
  var JUMP_VELOCITY = -165;
  // Releasing the jump key mid-ascent scrubs most of the remaining upward
  // velocity, so a tap is a short hop and a hold gives the full arc.
  var JUMP_CUT_MULT = 0.45;
  var DODGE_SPEED = 160;
  var DODGE_DURATION = 0.22;
  var DODGE_COOLDOWN_BASE = 0.5;
  var ATTACK_DURATION = 0.16;
  var ATTACK_COOLDOWN_BASE = 0.26;
  var COMBO_WINDOW = 0.45;

  var PLAYER_W = 8, PLAYER_H = 14;
  var COMBINE_W = 18, COMBINE_H = 11;
  var PLAYER_HIT_INVULN = 0.8;

  var GROUND_Y = 164;
  var FINAL_DEPTH = 5;
  var CORN_PER_UPGRADE = 5;

  // Single-jump horizontal reach is ~43px (0.79s airtime x 55px/s), so gaps
  // are capped well under that; the air jump is margin, not a requirement.
  var GAP_MIN = 22, GAP_MAX = 30;

  // Kept under the original key so existing skill-tree progress survives the
  // rename rather than silently resetting for anyone who has already played.
  var META_KEY = 'tah-game-deadfields-meta';

  var SCORE_CORN = 25, SCORE_CROW = 50, SCORE_BOAR = 75, SCORE_BOSS = 500;

  var COLOR = {
    skyTop: '#6ec6f1', skyBottom: '#cdeeff', sun: '#ffe066', cloud: '#ffffff',
    hill: '#6fae52', outline: '#2a1f18',
    soil: '#8a5a3a', soilSeam: 'rgba(42,31,24,0.18)', grass: '#5fbf3f', grassLight: '#7ad653',
    crate: '#c68a45', crateDark: '#8a5a2c',
    player: '#3d6fd1', skin: '#f2c294', fork: '#d8dbe0', forkHandle: '#6a4526',
    crow: '#1e1e1e', crowBeak: '#f2a63d',
    boar: '#a8703f', boarDark: '#6a4526', boarLight: '#f5f1e6',
    barnWall: '#c1432f', barnRoof: '#7a2e1f', barnDoor: '#4a2c18', barnTrim: '#f5f1e6',
    siloBody: '#d8cdb8', siloDark: '#a89a80', siloRoof: '#7a8088',
    hud: '#2a1f18', hpEmpty: '#d8cdb8', title: '#e88a2a', dim: '#4a3f38',
    bad: '#e0392a', good: '#15702e', flash: '#ffffff',
    panelBg: 'rgba(30,26,20,0.16)', cardBg: '#f5f1e6', cardSel: '#ffe066',
    waterTop: '#5ec8e8', waterDeep: '#1f6f9e', waterSurface: '#d6f6ff',
    corn: '#f2c14e', cornHusk: '#4a8f3f',
    feather: '#1e1e1e', featherEdge: '#55555f',
    bacon: '#b8492f', baconFat: '#f7dcc4', baconStripe: '#7d2a1c', straw: '#e0c15a',
    roast: '#c9822f', roastLight: '#f0c477', roastDark: '#9c5a1e',
    roastDeep: '#6f3d12', roastSheen: '#fbe3ad', bone: '#f7edd8',
    scarecrowSack: '#d8b978', scarecrowBody: '#8a6a3a', scarecrowDark: '#5c4526', hat: '#4a3f38',
    combineBody: '#c1432f', combineDark: '#7a2e1f', combineHeader: '#e0b93a', wheel: '#2a1f18'
  };

  var ENEMY_DEFS = {
    boar: { w: 14, h: 10, hp: 2, speed: 26, chargeSpeed: 72, detect: 55 },
    crow: { w: 10, h: 8, hp: 1, speed: 20, detect: 50 },
    scarecrow: { w: 16, h: 22, hp: 12, speed: 0, detect: 0 }
  };

  var BOAR_DROWN_TIME = 2.6;
  var BOAR_PADDLE_SPEED = 14;

  var BOSS_CROW_CAP = 20;
  var BOSS_CROW_CONCURRENT_CAP = 5;
  var BOSS_AGGRO_RANGE = 100;
  var BOSS_SPAWN_INTERVAL = 1.8;
  var BOSS_MELEE_RANGE = 30;
  var BOSS_ATTACK_WINDUP = 0.4;
  var BOSS_ATTACK_ACTIVE = 0.15;
  var BOSS_ATTACK_COOLDOWN = 1.1;
  var BOSS_ATTACK_REACH = 14;

  // ------------------------------------------------------- meta progression -
  var TREE = [
    { id: 'vigor', name: 'VIGOR', desc: '+1 STARTING HEART', cost: 60, max: 3 },
    { id: 'richsoil', name: 'RICH SOIL', desc: '+1 CORN PER PICKUP', cost: 80, max: 2 },
    { id: 'toolshed', name: 'TOOLSHED', desc: 'COMBINE JOINS UPGRADE POOL', cost: 120, max: 1 },
    { id: 'headstart', name: 'HEAD START', desc: 'BEGIN EACH RUN WITH AN UPGRADE', cost: 150, max: 1 },
    { id: 'gristmill', name: 'GRISTMILL', desc: '+25% SCORE EARNED', cost: 100, max: 2 },
    { id: 'strawwings', name: 'STRAW WINGS', desc: 'START EVERY RUN WITH AN AIR JUMP', cost: 400, max: 1 }
  ];

  var meta = loadMeta();

  function loadMeta() {
    var base = { bankedCorn: 0, nodes: {}, bestDepth: 0, bestScore: 0, runs: 0 };
    try {
      var raw = localStorage.getItem(META_KEY);
      if (!raw) return base;
      var parsed = JSON.parse(raw);
      base.bankedCorn = parsed.bankedCorn || 0;
      base.nodes = parsed.nodes || {};
      base.bestDepth = parsed.bestDepth || 0;
      base.bestScore = parsed.bestScore || 0;
      base.runs = parsed.runs || 0;
    } catch (e) {
      // Corrupt or unreadable save: fall back to a fresh profile rather than
      // breaking the game on load.
      return base;
    }
    return base;
  }

  function saveMeta() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) { /* storage full or blocked - progression just won't persist */ }
  }

  function nodeLevel(id) { return meta.nodes[id] || 0; }

  // ------------------------------------------------------------- upgrades ---
  var UPGRADES = [
    {
      id: 'maxhp', name: 'FEED SACK', desc: '+1 MAX HEART', max: 3,
      apply: function () { mods.maxHp += 1; player.hp = Math.min(mods.maxHp, player.hp + 1); }
    },
    {
      id: 'atkspeed', name: 'WHETSTONE', desc: 'SWING 20% FASTER', max: 3,
      apply: function () { mods.atkCooldownMul *= 0.8; }
    },
    {
      id: 'range', name: 'LONG HANDLE', desc: '+4 ATTACK REACH', max: 3,
      apply: function () { mods.attackRange += 4; }
    },
    {
      id: 'roll', name: 'GREASED BOOTS', desc: 'ROLL COOLDOWN -30%', max: 2,
      apply: function () { mods.rollCooldownMul *= 0.7; }
    },
    {
      // Deliberately rare: a mid-air jump trivialises platforming, so it
      // shows up far less often than the stat upgrades.
      id: 'airjump', name: 'STRAW WINGS', desc: '+1 AIR JUMP', max: 2, weight: 0.15,
      apply: function () { mods.airJumps += 1; }
    },
    {
      id: 'cornval', name: 'GLEANER', desc: '+1 CORN PER PICKUP', max: 3,
      apply: function () { mods.cornValue += 1; }
    },
    {
      id: 'combine', name: 'COMBINE KEYS', desc: 'PRESS F TO RIDE COMBINE', max: 1,
      requiresNode: 'toolshed',
      apply: function () { mods.hasCombine = true; }
    }
  ];

  function upgradeById(id) {
    for (var i = 0; i < UPGRADES.length; i++) if (UPGRADES[i].id === id) return UPGRADES[i];
    return null;
  }

  function availableUpgrades() {
    return UPGRADES.filter(function (u) {
      if (u.requiresNode && !nodeLevel(u.requiresNode)) return false;
      return (runUpgrades[u.id] || 0) < u.max;
    });
  }

  function grantUpgrade(u) {
    runUpgrades[u.id] = (runUpgrades[u.id] || 0) + 1;
    u.apply();
  }

  // ------------------------------------------------------------ rng / util -
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function aabbOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  function pad(n) { return String(Math.max(0, Math.floor(n))).padStart(4, '0'); }

  // ------------------------------------------------------------ run state --
  var state = 'title';
  var time = 0;

  var runSeed = 0;
  var depth = 1;
  var runScore = 0;
  var runCorn = 0;
  var cornSinceUpgrade = 0;
  var runUpgrades = {};
  var mods = null;

  var player = null;
  var enemies = [];
  var particles = [];
  var drops = [];
  var corns = [];
  var platforms = [];
  var gapBridges = [];
  var waters = [];
  var levelWidth = 900;
  var exitX = 0;
  var hasBoss = false;
  var cameraX = 0;
  var combineActive = false;

  var upgradeChoices = [];
  var treeIndex = 0;
  var barnBlockedMsgTimer = 0;
  var toastText = '';
  var toastTimer = 0;

  function freshMods() {
    return {
      maxHp: 5 + nodeLevel('vigor'),
      atkCooldownMul: 1,
      attackRange: 14,
      rollCooldownMul: 1,
      airJumps: nodeLevel('strawwings'),
      cornValue: 1 + nodeLevel('richsoil'),
      hasCombine: false
    };
  }

  function toast(text) { toastText = text; toastTimer = 2.0; }

  // -------------------------------------------------------- level building --
  function makePlayer() {
    return {
      x: 20, y: GROUND_Y - PLAYER_H, w: PLAYER_W, h: PLAYER_H,
      vx: 0, vy: 0, facing: 1, onGround: false,
      hp: mods.maxHp, hitInvuln: 0,
      attackTimer: 0, attackCooldown: 0, comboStep: 0, comboResetTimer: 0, hitThisSwing: {},
      rolling: 0, rollCooldown: 0, fellOut: false, airJumpsLeft: 0, jumpCut: true
    };
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
    var e = makeEnemy('scarecrow', x, y);
    e.crowSpawnCount = 0;
    e.spawnTimer = BOSS_SPAWN_INTERVAL;
    e.atkState = 'idle';
    e.atkTimer = 0;
    e.atkHit = false;
    return e;
  }

  // Generates a left-to-right chain of ground slabs separated by jumpable
  // gaps, so every level is traversable by construction rather than by
  // post-hoc validation.
  function generateLevel() {
    var rng = makeRng(runSeed + depth * 7919);
    platforms = [];
    gapBridges = [];
    waters = [];
    corns = [];
    enemies = [];
    particles = [];
    drops = [];

    hasBoss = depth >= FINAL_DEPTH;

    var slabCount = 4 + Math.min(6, depth);
    var cursor = 0;
    var slabs = [];

    for (var i = 0; i < slabCount; i++) {
      var slabW = i === 0 ? 96 : Math.round(64 + rng() * 76);
      slabs.push({ x: cursor, w: slabW });
      platforms.push({ x: cursor, y: GROUND_Y, w: slabW, h: H - GROUND_Y });
      cursor += slabW;

      if (i < slabCount - 1) {
        var gapW = Math.round(GAP_MIN + rng() * (GAP_MAX - GAP_MIN));
        var isWater = rng() < 0.4;
        // Every gap gets a deployable bridge, water included - a plank you can
        // see is much clearer than silently fording the stream.
        gapBridges.push({ x: cursor, y: GROUND_Y, w: gapW, h: H - GROUND_Y, overWater: isWater });
        if (isWater) waters.push({ x: cursor, w: gapW });
        cursor += gapW;
      }
    }

    // Tail slab so the exit always sits on solid ground.
    var tailW = hasBoss ? 130 : 96;
    slabs.push({ x: cursor, w: tailW });
    platforms.push({ x: cursor, y: GROUND_Y, w: tailW, h: H - GROUND_Y });
    cursor += tailW;

    levelWidth = cursor;
    exitX = levelWidth - (hasBoss ? 80 : 44);

    // Nothing collectable may sit at or past the exit - touching the exit ends
    // the level, so corn out there would be unreachable by construction.
    var decorLimit = exitX - 10;

    // Floating platforms + corn + enemies over the interior slabs.
    for (var s = 1; s < slabs.length; s++) {
      var slab = slabs[s];
      var isTail = s === slabs.length - 1;
      var usableEnd = Math.min(slab.x + slab.w, decorLimit);
      var usableW = usableEnd - slab.x;
      if (usableW < 24) continue;

      if (usableW > 70 && rng() < 0.65) {
        var pw = 26 + Math.round(rng() * 12);
        var px = slab.x + Math.round(rng() * Math.max(1, usableW - pw));
        // Capped so a single jump (~32px of lift) always reaches the top;
        // the air jump is a rare luxury, never a requirement for corn.
        var ph = 16 + Math.round(rng() * 10);
        platforms.push({ x: px, y: GROUND_Y - ph, w: pw, h: 6 });
        if (rng() < 0.7) corns.push({ x: px + pw / 2 - 2, y: GROUND_Y - ph - 8, w: 5, h: 6, collected: false });
      }

      var cornOnSlab = 1 + (rng() < 0.4 ? 1 : 0);
      for (var c = 0; c < cornOnSlab; c++) {
        corns.push({
          x: slab.x + 12 + Math.round(rng() * Math.max(1, usableW - 24)),
          y: GROUND_Y - 6, w: 5, h: 6, collected: false
        });
      }

      if (isTail && hasBoss) continue;

      var enemyBudget = Math.min(3, 1 + Math.floor(depth / 2));
      var enemyCount = Math.round(rng() * enemyBudget);
      for (var e = 0; e < enemyCount; e++) {
        var ex = slab.x + 14 + rng() * Math.max(1, slab.w - 28);
        if (rng() < 0.55) {
          enemies.push(makeEnemy('boar', ex, GROUND_Y - ENEMY_DEFS.boar.h));
        } else {
          enemies.push(makeEnemy('crow', ex, GROUND_Y - 44 - rng() * 26));
        }
      }
    }

    if (hasBoss) enemies.push(makeBoss(exitX - 26, GROUND_Y - ENEMY_DEFS.scarecrow.h));
  }

  function activePlatforms() {
    return combineActive ? platforms.concat(gapBridges) : platforms;
  }

  function waterSpanAt(x) {
    for (var i = 0; i < waters.length; i++) {
      if (x >= waters[i].x && x <= waters[i].x + waters[i].w) return waters[i];
    }
    return null;
  }

  // ------------------------------------------------------------ run flow ---
  function startRun() {
    runSeed = (Math.random() * 0xffffffff) >>> 0;
    depth = 1;
    runScore = 0;
    runCorn = 0;
    cornSinceUpgrade = 0;
    runUpgrades = {};
    mods = freshMods();
    combineActive = false;
    barnBlockedMsgTimer = 0;
    meta.runs += 1;
    saveMeta();

    generateLevel();
    player = makePlayer();
    cameraX = 0;

    if (nodeLevel('headstart')) {
      var pool = availableUpgrades();
      if (pool.length) {
        var pick = pool[Math.floor(Math.random() * pool.length)];
        grantUpgrade(pick);
        toast('HEAD START: ' + pick.name);
      }
    }

    state = 'playing';
  }

  function nextLevel() {
    depth += 1;
    if (depth > meta.bestDepth) { meta.bestDepth = depth; saveMeta(); }

    // Dismount explicitly rather than via setForm(): clearing combineActive
    // first would make setForm's no-op guard skip the resize, stranding the
    // farmer with the combine's short, wide hitbox.
    combineActive = false;
    player.w = PLAYER_W;
    player.h = PLAYER_H;

    generateLevel();
    player.x = 20;
    player.y = GROUND_Y - player.h;
    player.vx = 0;
    player.vy = 0;
    player.hitInvuln = PLAYER_HIT_INVULN;
    player.jumpCut = true;
    state = 'playing';
  }

  function endRun(victorious) {
    meta.bankedCorn += runCorn;
    if (depth > meta.bestDepth) meta.bestDepth = depth;
    if (runScore > meta.bestScore) meta.bestScore = runScore;
    saveMeta();
    state = victorious ? 'victory' : 'dead';
  }

  function offerUpgrade() {
    var pool = availableUpgrades();
    if (!pool.length) return false;
    // Weighted draw without replacement, so an option can't appear twice in one
    // offer and low-weight entries stay genuinely rare.
    var copy = pool.slice();
    upgradeChoices = [];
    while (copy.length && upgradeChoices.length < 3) {
      var total = 0;
      for (var i = 0; i < copy.length; i++) total += copy[i].weight || 1;
      var r = Math.random() * total;
      var picked = copy.length - 1;
      for (var j = 0; j < copy.length; j++) {
        r -= copy[j].weight || 1;
        if (r <= 0) { picked = j; break; }
      }
      upgradeChoices.push(copy.splice(picked, 1)[0]);
    }
    state = 'upgrade';
    return true;
  }

  // ---------------------------------------------------------------- input --
  var keys = {};
  var TRACKED = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'ShiftLeft', 'ShiftRight',
    'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Enter', 'Escape'];
  var jumpQueued = false, attackQueued = false, rollQueued = false, formQueued = false;

  window.addEventListener('keydown', function (e) {
    audio.unlock();
    if (TRACKED.indexOf(e.code) !== -1) e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;

    if (e.code === 'KeyW') jumpQueued = true;
    if (e.code === 'Space') attackQueued = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') rollQueued = true;
    if (e.code === 'KeyF') formQueued = true;

    if (state === 'title') {
      if (e.code === 'KeyH') { treeIndex = 0; state = 'hub'; }
      else startRun();
      return;
    }
    if (state === 'dead' || state === 'victory') {
      if (e.code === 'KeyH') { treeIndex = 0; state = 'hub'; }
      else startRun();
      return;
    }
    if (state === 'hub') {
      handleHubKey(e.code);
      return;
    }
    if (state === 'upgrade') {
      var idx = -1;
      if (e.code === 'Digit1') idx = 0;
      if (e.code === 'Digit2') idx = 1;
      if (e.code === 'Digit3') idx = 2;
      if (idx >= 0 && idx < upgradeChoices.length) {
        grantUpgrade(upgradeChoices[idx]);
        audio.upgradePick();
        toast(upgradeChoices[idx].name);
        state = 'playing';
      }
      return;
    }
    if (state === 'levelclear') {
      nextLevel();
      return;
    }
  });

  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { keys = {}; });

  function handleHubKey(code) {
    if (code === 'KeyW' || code === 'ArrowUp') {
      treeIndex = (treeIndex + TREE.length - 1) % TREE.length;
      audio.menuMove();
    } else if (code === 'KeyS' || code === 'ArrowDown') {
      treeIndex = (treeIndex + 1) % TREE.length;
      audio.menuMove();
    } else if (code === 'Space' || code === 'Enter') {
      var node = TREE[treeIndex];
      var lvl = nodeLevel(node.id);
      if (lvl < node.max && meta.bankedCorn >= node.cost) {
        meta.bankedCorn -= node.cost;
        meta.nodes[node.id] = lvl + 1;
        saveMeta();
        audio.buy();
      }
    } else if (code === 'Escape' || code === 'KeyH') {
      state = 'title';
    }
  }

  // --------------------------------------------------------------- physics -
  function updateGrounded(e, dt, plats) {
    var prevBottom = e.y + e.h;
    e.x += e.vx * dt;
    e.x = Math.max(0, Math.min(levelWidth - e.w, e.x));

    e.vy += GRAVITY * dt;
    if (e.vy > MAX_FALL_SPEED) e.vy = MAX_FALL_SPEED;
    e.y += e.vy * dt;

    e.onGround = false;
    if (e.vy >= 0) {
      for (var i = 0; i < plats.length; i++) {
        var p = plats[i];
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

  // Only ever called while grounded, so the resize can't shove the player
  // into geometry it wasn't already standing clear of.
  function setForm(toCombine, silent) {
    if (combineActive === toCombine) return;
    var feet = player.y + player.h;
    var centre = player.x + player.w / 2;
    combineActive = toCombine;
    player.w = toCombine ? COMBINE_W : PLAYER_W;
    player.h = toCombine ? COMBINE_H : PLAYER_H;
    player.y = feet - player.h;
    player.x = Math.max(0, Math.min(levelWidth - player.w, centre - player.w / 2));
    if (!silent) audio.transform();
  }

  function updatePlayer(dt) {
    var plats = activePlatforms();

    if (player.hitInvuln > 0) player.hitInvuln -= dt;
    if (player.attackCooldown > 0) player.attackCooldown -= dt;
    if (player.comboResetTimer > 0) {
      player.comboResetTimer -= dt;
      if (player.comboResetTimer <= 0) player.comboStep = 0;
    }
    if (player.rollCooldown > 0) player.rollCooldown -= dt;

    if (formQueued) {
      if (mods.hasCombine && player.onGround) setForm(!combineActive);
      else if (!mods.hasCombine) toast('NO COMBINE KEYS');
      formQueued = false;
    }

    if (rollQueued && !combineActive && player.rolling <= 0 && player.rollCooldown <= 0) {
      player.rolling = DODGE_DURATION;
      player.rollCooldown = DODGE_COOLDOWN_BASE * mods.rollCooldownMul;
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
      player.vx = move * (combineActive ? COMBINE_MOVE_SPEED : MOVE_SPEED);
    }

    if (player.onGround) player.airJumpsLeft = mods.airJumps;

    if (jumpQueued && !combineActive && player.rolling <= 0) {
      if (player.onGround) {
        player.vy = JUMP_VELOCITY;
        player.onGround = false;
        player.jumpCut = false;
        audio.jump();
      } else if (player.airJumpsLeft > 0) {
        player.vy = JUMP_VELOCITY * 0.85;
        player.airJumpsLeft -= 1;
        player.jumpCut = false;
        audio.doubleJump();
      }
    }
    jumpQueued = false;

    // Cut the ascent once per jump, on the frame the key comes up.
    if (!player.jumpCut && player.vy < 0 && !keys.KeyW) {
      player.vy *= JUMP_CUT_MULT;
      player.jumpCut = true;
    }

    if (attackQueued && !combineActive && player.attackCooldown <= 0 && player.rolling <= 0) {
      player.attackTimer = ATTACK_DURATION;
      player.attackCooldown = ATTACK_COOLDOWN_BASE * mods.atkCooldownMul;
      player.hitThisSwing = {};
      player.comboStep = player.comboResetTimer > 0 ? 1 - player.comboStep : 0;
      player.comboResetTimer = COMBO_WINDOW;
      audio.attack();
    }
    attackQueued = false;

    if (player.attackTimer > 0) player.attackTimer -= dt;

    updateGrounded(player, dt, plats);
    if (player.fellOut) player.hp = 0;

    if (player.hp <= 0) {
      audio.playerDeath();
      endRun(false);
      return;
    }

    if (player.x + player.w / 2 > exitX) {
      if (hasBoss && isBossAlive()) {
        if (barnBlockedMsgTimer <= 0) barnBlockedMsgTimer = 1.5;
      } else {
        audio.levelClear();
        if (depth >= FINAL_DEPTH) endRun(true);
        else state = 'levelclear';
      }
    }
  }

  function isBossAlive() {
    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].type === 'scarecrow' && !enemies[i].dead) return true;
    }
    return false;
  }

  // -------------------------------------------------------------- combat ---
  function addScore(points) {
    var mult = 1 + 0.25 * nodeLevel('gristmill');
    runScore += Math.round(points * mult);
  }

  // Feathers and straw are pure visual poof. Meat is not a particle - it drops
  // as collectible loot (see spawnDrop / updateDrops).
  var PARTICLE_KINDS = {
    feather: { life: 1.1, gravity: 30, minSpeed: 10, spread: 20, lift: 10 },
    straw: { life: 1.3, gravity: 150, minSpeed: 30, spread: 60, lift: 20 }
  };

  var DROP_DEFS = {
    bacon: { w: 6, h: 3, corn: 1, score: 15 },
    roast: { w: 7, h: 5, corn: 2, score: 40 }
  };

  function spawnDrop(kind, cx, cy) {
    var def = DROP_DEFS[kind];
    drops.push({
      kind: kind, w: def.w, h: def.h,
      x: cx - def.w / 2, y: cy - def.h / 2,
      vx: (Math.random() - 0.5) * 55,
      vy: -30 - Math.random() * 40,
      landed: false,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 7,
      wave: Math.random() * Math.PI * 2,
      bob: Math.random() * Math.PI * 2
    });
  }

  // Meat never expires and never leaves the map: anything that misses solid
  // ground is rescued onto the nearest slab rather than falling out of play.
  function rescueDrop(d) {
    var best = null, bestDist = Infinity;
    var plats = platforms.concat(gapBridges);
    for (var i = 0; i < plats.length; i++) {
      var p = plats[i];
      if (p.h <= 10) continue;
      var clamped = Math.max(p.x, Math.min(p.x + p.w - d.w, d.x));
      var dist = Math.abs(clamped - d.x);
      if (dist < bestDist) { bestDist = dist; best = { p: p, x: clamped }; }
    }
    if (!best) {
      d.x = Math.max(0, Math.min(levelWidth - d.w, d.x));
      d.y = GROUND_Y - d.h;
    } else {
      d.x = best.x;
      d.y = best.p.y - d.h;
    }
    d.vx = 0; d.vy = 0; d.landed = true; d.angle = 0;
  }

  function updateDrops(dt) {
    var plats = platforms.concat(gapBridges);
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];

      if (!d.landed) {
        var prevBottom = d.y + d.h;
        d.vy += 300 * dt;
        if (d.vy > MAX_FALL_SPEED) d.vy = MAX_FALL_SPEED;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vx *= 1 - 1.6 * dt;
        d.angle += d.spin * dt;
        d.x = Math.max(0, Math.min(levelWidth - d.w, d.x));

        if (d.vy >= 0) {
          for (var j = 0; j < plats.length; j++) {
            var p = plats[j];
            var newBottom = d.y + d.h;
            if (d.x + d.w > p.x && d.x < p.x + p.w &&
              prevBottom <= p.y + 0.5 && newBottom >= p.y) {
              d.y = p.y - d.h;
              d.vy = 0; d.vx = 0;
              d.landed = true;
              d.angle = 0;
              break;
            }
          }
        }
        if (!d.landed && d.y > H + 4) rescueDrop(d);
      }

      if (aabbOverlap(player.x, player.y, player.w, player.h, d.x, d.y, d.w, d.h)) {
        var def = DROP_DEFS[d.kind];
        runCorn += def.corn;
        addScore(def.score);
        audio.corn();
        d.taken = true;
      }
    }
    drops = drops.filter(function (dd) { return !dd.taken; });
  }

  function emitParticles(kind, count, cx, cy) {
    var cfg = PARTICLE_KINDS[kind];
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2;
      var speed = cfg.minSpeed + Math.random() * cfg.spread;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - cfg.lift,
        life: cfg.life, maxLife: cfg.life, kind: kind,
        angle: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 6,
        // Per-piece phase offset so no two strips curl identically.
        wave: Math.random() * Math.PI * 2
      });
    }
  }

  function spawnDeathEffect(e) {
    var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    if (e.type === 'crow') {
      // Poof of black feathers, and the bird itself comes out oven-ready.
      emitParticles('feather', 8, cx, cy);
      spawnDrop('roast', cx, cy);
    } else if (e.type === 'scarecrow') {
      emitParticles('straw', 14, cx, cy);
    } else {
      for (var b = 0; b < 3; b++) spawnDrop('bacon', cx, cy);
    }
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    // Score is the kill reward; corn now comes from collecting the meat it
    // drops, so the two aren't paid out twice. The boss drops straw, not meat,
    // so it still pays its corn directly.
    if (e.type === 'crow') addScore(SCORE_CROW);
    else if (e.type === 'scarecrow') { addScore(SCORE_BOSS); runCorn += 20; }
    else addScore(SCORE_BOAR);
    spawnDeathEffect(e);
    audio.death(e.type === 'crow' ? 'feather' : e.type === 'scarecrow' ? 'straw' : 'bacon');
  }

  function resolveAttack() {
    if (player.attackTimer <= 0) return;
    var reach = mods.attackRange;
    var boxX = player.facing > 0 ? player.x + player.w : player.x - reach;
    var boxY = player.y - 2, boxW = reach, boxH = player.h + 4;
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      if (e.dead || player.hitThisSwing[e.id]) continue;
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

  function checkCorn() {
    for (var i = 0; i < corns.length; i++) {
      var c = corns[i];
      if (c.collected) continue;
      if (!aabbOverlap(player.x, player.y, player.w, player.h, c.x, c.y, c.w, c.h)) continue;
      c.collected = true;
      runCorn += mods.cornValue;
      addScore(SCORE_CORN);
      cornSinceUpgrade += 1;
      audio.corn();
      if (cornSinceUpgrade >= CORN_PER_UPGRADE) {
        cornSinceUpgrade = 0;
        if (offerUpgrade()) return;
      }
    }
  }

  function checkEnemyContact() {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      if (!aabbOverlap(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) continue;

      // The combine flattens ordinary critters, but the boss can still hurt
      // it - otherwise the fight would be riskless once you have the keys.
      if (combineActive && e.type !== 'scarecrow') {
        killEnemy(e);
        continue;
      }
      // Stomp: coming down on an enemy's head deals a hit and bounces you off
      // instead of costing health. One damage per stomp, so with their existing
      // health that's two stomps for a boar and one for a crow. The boss is too
      // big to vault off.
      if (!combineActive && player.vy > 0 && e.type !== 'scarecrow' &&
        (player.y + player.h) < e.y + e.h * 0.6) {
        e.hp -= 1;
        e.hitFlash = 0.12;
        player.vy = JUMP_VELOCITY * 0.62;
        player.jumpCut = true;
        audio.hitEnemy();
        if (e.hp <= 0) killEnemy(e);
        continue;
      }

      if (player.hitInvuln > 0 || player.rolling > 0) continue;
      player.hp -= 1;
      player.hitInvuln = PLAYER_HIT_INVULN;
      if (!combineActive) {
        player.vx = (player.x < e.x ? -1 : 1) * 70;
        player.vy = -60;
      }
      audio.hitPlayer();
      if (e.type === 'boar') e.pauseTimer = 0.5;
      break;
    }
  }

  function updateEnemy(e, dt) {
    var def = ENEMY_DEFS[e.type];
    var plats = activePlatforms();
    if (e.hitFlash > 0) e.hitFlash -= dt;

    if (e.type === 'boar') {
      // A boar that goes in the water stays in: it paddles at the surface,
      // trapped inside the span, until it drowns. Drowning routes through
      // killEnemy so it still yields bacon and points.
      if (e.swimming) {
        var span = waterSpanAt(e.x + e.w / 2) || { x: e.x, w: e.w };
        e.vy = 0;
        e.y = GROUND_Y - e.h + 3 + Math.sin(time * 6) * 0.8;
        if (!e.paddleDir) e.paddleDir = 1;
        if (e.x <= span.x || e.x + e.w >= span.x + span.w) e.paddleDir *= -1;
        e.facing = e.paddleDir;
        e.x += e.paddleDir * BOAR_PADDLE_SPEED * dt;
        e.x = Math.max(span.x, Math.min(span.x + span.w - e.w, e.x));
        e.drownTimer -= dt;
        if (e.drownTimer <= 0) killEnemy(e);
        return;
      }

      if (e.hitFlash > 0) {
        e.vx *= Math.max(0, 1 - 4 * dt);
      } else if (e.pauseTimer > 0) {
        e.pauseTimer -= dt;
        e.vx = 0;
      } else {
        var dx = (player.x + player.w / 2) - (e.x + e.w / 2);
        var adx = Math.abs(dx);
        // Positive means the player's feet are above the boar's.
        var vertGap = (e.y + e.h) - (player.y + player.h);
        var sameLevel = Math.abs(vertGap) < 12;

        if (adx < def.detect && sameLevel) {
          // Deadzone: without it the boar flips facing every frame once it
          // overshoots the player, which reads as vibrating in place.
          if (adx < 3) {
            e.vx = 0;
          } else {
            e.facing = dx > 0 ? 1 : -1;
            e.vx = e.facing * def.chargeSpeed;
          }
        } else if (adx < def.detect * 1.4 && vertGap > 0) {
          // Player is on a platform overhead and can't be reached, so pace
          // along underneath at walking speed instead of stutter-charging.
          e.facing = dx > 0 ? 1 : -1;
          e.vx = adx < 6 ? 0 : e.facing * def.speed;
        } else {
          if (!e.patrolDir) e.patrolDir = 1;
          if (Math.abs(e.x - e.spawnX) > 25) e.patrolDir = e.x > e.spawnX ? -1 : 1;
          e.facing = e.patrolDir;
          e.vx = e.patrolDir * def.speed;
        }
      }
      updateGrounded(e, dt, plats);

      if (!e.onGround && e.y + e.h >= GROUND_Y && waterSpanAt(e.x + e.w / 2)) {
        e.swimming = true;
        e.drownTimer = BOAR_DROWN_TIME;
        e.paddleDir = e.vx >= 0 ? 1 : -1;
      } else if (e.fellOut) {
        // Dry pits are still an instant, unrewarded loss.
        e.dead = true;
      }
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
        var edist = Math.hypot(edx, edy) || 1;
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
      e.x = Math.max(0, Math.min(levelWidth - e.w, e.x));
    } else if (e.type === 'scarecrow') {
      e.facing = player.x > e.x ? 1 : -1;

      if (Math.abs(player.x - e.x) < BOSS_AGGRO_RANGE) {
        e.spawnTimer -= dt;
        if (e.spawnTimer <= 0 && e.crowSpawnCount < BOSS_CROW_CAP) {
          var alive = 0;
          for (var k = 0; k < enemies.length; k++) {
            if (enemies[k].bossSpawned && !enemies[k].dead) alive++;
          }
          if (alive < BOSS_CROW_CONCURRENT_CAP) {
            var nc = makeEnemy('crow', e.x + (Math.random() - 0.5) * 24, e.y - 20 - Math.random() * 20);
            nc.bossSpawned = true;
            enemies.push(nc);
            e.crowSpawnCount++;
          }
          e.spawnTimer = BOSS_SPAWN_INTERVAL;
        }
      }

      var meleeDist = Math.abs(player.x - (e.x + e.w / 2));
      if (e.atkState === 'idle') {
        if (meleeDist < BOSS_MELEE_RANGE) { e.atkState = 'windup'; e.atkTimer = BOSS_ATTACK_WINDUP; }
      } else if (e.atkState === 'windup') {
        e.atkTimer -= dt;
        if (e.atkTimer <= 0) {
          e.atkState = 'strike';
          e.atkTimer = BOSS_ATTACK_ACTIVE;
          e.atkHit = false;
          audio.bossSwing();
        }
      } else if (e.atkState === 'strike') {
        e.atkTimer -= dt;
        if (!e.atkHit) {
          var bx = e.facing > 0 ? e.x : e.x - BOSS_ATTACK_REACH;
          var bw = e.w + BOSS_ATTACK_REACH;
          if (aabbOverlap(bx, e.y, bw, e.h, player.x, player.y, player.w, player.h) &&
            player.hitInvuln <= 0 && player.rolling <= 0) {
            player.hp -= 1;
            player.hitInvuln = PLAYER_HIT_INVULN;
            audio.hitPlayer();
            e.atkHit = true;
          }
        }
        if (e.atkTimer <= 0) { e.atkState = 'cooldown'; e.atkTimer = BOSS_ATTACK_COOLDOWN; }
      } else if (e.atkState === 'cooldown') {
        e.atkTimer -= dt;
        if (e.atkTimer <= 0) e.atkState = 'idle';
      }
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      var gravity = (PARTICLE_KINDS[p.kind] || PARTICLE_KINDS.straw).gravity;
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

  function update(dt) {
    time += dt;
    audio.tick();
    updateParticles(dt);
    if (toastTimer > 0) toastTimer -= dt;

    if (state !== 'playing') {
      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.type === 'crow' && !e.dead) {
          e.phase += dt * 3;
          e.y = e.spawnY + Math.sin(e.phase) * 6;
        }
      }
      return;
    }

    if (barnBlockedMsgTimer > 0) barnBlockedMsgTimer -= dt;

    updatePlayer(dt);
    if (state !== 'playing') return;

    resolveAttack();
    checkCorn();
    if (state !== 'playing') return;

    for (var j = 0; j < enemies.length; j++) updateEnemy(enemies[j], dt);
    enemies = enemies.filter(function (en) { return !en.dead; });
    checkEnemyContact();
    updateDrops(dt);

    cameraX = Math.max(0, Math.min(Math.max(0, levelWidth - W), player.x + player.w / 2 - W / 2));
  }

  // -------------------------------------------------------------- drawing --
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

  function drawWater() {
    for (var i = 0; i < waters.length; i++) {
      var wtr = waters[i];
      var y = GROUND_Y;
      var grad = ctx.createLinearGradient(0, y, 0, H);
      grad.addColorStop(0, COLOR.waterTop);
      grad.addColorStop(1, COLOR.waterDeep);
      ctx.fillStyle = grad;
      ctx.fillRect(wtr.x, y, wtr.w, H - y);

      ctx.strokeStyle = COLOR.waterSurface;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var x = wtr.x; x <= wtr.x + wtr.w; x += 2) {
        var wy = y + Math.sin((x + time * 40) * 0.4) * 1.2;
        if (x === wtr.x) ctx.moveTo(x, wy);
        else ctx.lineTo(x, wy);
      }
      ctx.stroke();

      ctx.strokeStyle = COLOR.outline;
      ctx.strokeRect(wtr.x + 0.5, y + 0.5, wtr.w - 1, H - y - 1);
    }
  }

  function drawSlab(p) {
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

    // Sub-pixel detail that only reads at the higher backing resolution.
    ctx.fillStyle = COLOR.grassLight;
    ctx.fillRect(p.x, p.y, p.w, 1.25);
    ctx.strokeStyle = COLOR.grass;
    ctx.lineWidth = 0.75;
    for (var g = p.x + 2; g < p.x + p.w - 1; g += 5) {
      var tuft = 1.5 + ((g * 7) % 3) * 0.6;
      ctx.beginPath();
      ctx.moveTo(g + 0.5, p.y);
      ctx.lineTo(g + 0.5 + (((g * 13) % 2) ? 0.8 : -0.8), p.y - tuft);
      ctx.stroke();
    }

    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
  }

  function drawLedge(p) {
    ctx.fillStyle = COLOR.crate;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = COLOR.crateDark;
    ctx.lineWidth = 1;
    for (var px = p.x + 8; px < p.x + p.w; px += 8) {
      ctx.beginPath();
      ctx.moveTo(px + 0.5, p.y);
      ctx.lineTo(px + 0.5, p.y + p.h);
      ctx.stroke();
    }
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
  }

  function drawBridge(p) {
    var deck = 6;

    // Support posts first so the deck reads as sitting on top of them.
    ctx.fillStyle = COLOR.crateDark;
    [p.x + 2, p.x + p.w - 5].forEach(function (postX) {
      ctx.fillRect(postX, p.y + deck, 3, H - (p.y + deck));
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(postX + 0.5, p.y + deck + 0.5, 2, H - (p.y + deck) - 1);
    });

    // Diagonal cross-brace between the posts.
    ctx.strokeStyle = COLOR.crateDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 3, p.y + deck + 2);
    ctx.lineTo(p.x + p.w - 3, H - 3);
    ctx.moveTo(p.x + p.w - 3, p.y + deck + 2);
    ctx.lineTo(p.x + 3, H - 3);
    ctx.stroke();

    ctx.fillStyle = COLOR.crate;
    ctx.fillRect(p.x, p.y, p.w, deck);
    ctx.strokeStyle = COLOR.crateDark;
    for (var bx = p.x + 5; bx < p.x + p.w; bx += 5) {
      ctx.beginPath();
      ctx.moveTo(bx + 0.5, p.y);
      ctx.lineTo(bx + 0.5, p.y + deck);
      ctx.stroke();
    }
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, deck - 1);

    // Rails, so a deployed bridge is unmistakable at a glance.
    ctx.strokeStyle = COLOR.crateDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 1, p.y - 4);
    ctx.lineTo(p.x + p.w - 1, p.y - 4);
    ctx.stroke();
    [p.x + 1, p.x + p.w / 2, p.x + p.w - 1].forEach(function (rx) {
      ctx.beginPath();
      ctx.moveTo(rx, p.y - 4);
      ctx.lineTo(rx, p.y);
      ctx.stroke();
    });
  }

  function drawPlatforms() {
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (p.h > 10) drawSlab(p);
      else drawLedge(p);
    }
    if (combineActive) {
      for (var b = 0; b < gapBridges.length; b++) drawBridge(gapBridges[b]);
    }
  }

  function drawExit() {
    if (hasBoss) {
      var x = exitX, w = levelWidth - exitX + 20;
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
      return;
    }

    // Grain silo doubles as the level exit on non-boss depths.
    var sx = exitX, sw = 22;
    ctx.fillStyle = COLOR.siloBody;
    ctx.fillRect(sx, GROUND_Y - 48, sw, 48);
    ctx.strokeStyle = COLOR.siloDark;
    ctx.lineWidth = 1;
    for (var r = GROUND_Y - 40; r < GROUND_Y; r += 8) {
      ctx.beginPath();
      ctx.moveTo(sx, r + 0.5);
      ctx.lineTo(sx + sw, r + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(sx + 0.5, GROUND_Y - 47.5, sw - 1, 47);
    ctx.fillStyle = COLOR.siloRoof;
    ctx.beginPath();
    ctx.moveTo(sx - 3, GROUND_Y - 48);
    ctx.lineTo(sx + sw / 2, GROUND_Y - 60);
    ctx.lineTo(sx + sw + 3, GROUND_Y - 48);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.stroke();

    ctx.fillStyle = COLOR.barnDoor;
    ctx.fillRect(sx + sw / 2 - 5, GROUND_Y - 18, 10, 18);
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(sx + sw / 2 - 4.5, GROUND_Y - 17.5, 9, 17);
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

  function drawCombineSprite() {
    var p = player, x = p.x, w = p.w, h = p.h;
    var faceRight = p.facing > 0;
    var moving = Math.abs(p.vx) > 1;
    var y = p.y + (moving ? Math.sin(time * 40) * 0.5 : 0);
    var frontX = faceRight ? x + w : x;

    ctx.fillStyle = COLOR.wheel;
    ctx.beginPath();
    ctx.arc(x + w * 0.28, p.y + h, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w * 0.72, p.y + h, 3, 0, Math.PI * 2);
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

    // The reel always turns while rolling; the combine kills by driving, so
    // there's no separate swing to animate.
    var spin = time * (moving ? 40 : 8);
    var hcx = headerX + 2, hcy = y + h - 3;
    ctx.strokeStyle = COLOR.combineDark;
    for (var r = 0; r < 3; r++) {
      var ang = spin + r * (Math.PI * 2 / 3);
      ctx.beginPath();
      ctx.moveTo(hcx + Math.cos(ang) * 3, hcy + Math.sin(ang) * 3);
      ctx.lineTo(hcx - Math.cos(ang) * 3, hcy - Math.sin(ang) * 3);
      ctx.stroke();
    }
    if (moving) {
      ctx.strokeStyle = COLOR.crateDark;
      for (var d = 0; d < 3; d++) {
        var fx = headerX + (faceRight ? 4 : -4) + Math.sin(time * 30 + d) * 2;
        var fy = y + h - 2 - d * 2;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + (faceRight ? 2 : -2), fy - 2);
        ctx.stroke();
      }
    }
  }

  function drawPlayer() {
    var p = player;
    if (p.hitInvuln > 0 && Math.floor(time * 10) % 2 === 0) return;

    if (p.rolling > 0) {
      ctx.globalAlpha = 0.25;
      for (var g = 1; g <= 2; g++) {
        ctx.fillStyle = COLOR.player;
        ctx.fillRect(p.x - p.facing * g * 4, p.y + 2, p.w, p.h - 2);
      }
      ctx.globalAlpha = 1;
    }

    if (combineActive) { drawCombineSprite(); return; }

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

    // Straw hat, rotated as one unit so the brim and crown stay attached, and
    // cocked back the way the farmer is facing. Crown behind, brim in front so
    // it reads as worn rather than floating.
    ctx.save();
    ctx.translate(cx, cy + 1);
    ctx.rotate(-0.22 * p.facing);

    ctx.fillStyle = COLOR.straw;
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(-2.2, -4);
    ctx.lineTo(2.2, -4);
    ctx.lineTo(3, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = COLOR.forkHandle;
    ctx.beginPath();
    ctx.moveTo(-2.7, -0.9);
    ctx.lineTo(2.7, -0.9);
    ctx.stroke();

    ctx.fillStyle = COLOR.straw;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.stroke();
    ctx.restore();

    // Scale the drawn fork with actual attack reach, so LONG HANDLE visibly
    // lengthens it and the sprite honestly represents the hitbox.
    var reachScale = mods.attackRange / 14;
    var handX = cx + p.facing * 3, handY = cy + 7;
    if (p.attackTimer > 0) {
      var t = 1 - p.attackTimer / ATTACK_DURATION;
      var sweepArc = (p.comboStep === 0) ? [-0.6, 0.9] : [0.9, -0.6];
      var a = sweepArc[0] + (sweepArc[1] - sweepArc[0]) * t;
      drawPitchfork(handX, handY, p.facing > 0 ? a : Math.PI - a, 11 * reachScale);
    } else {
      drawPitchfork(handX, handY, p.facing > 0 ? 0.15 : Math.PI - 0.15, 9 * reachScale);
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
      var flap = Math.sin(e.phase * 2) * 3;
      var ccx = e.x + e.w / 2, ccy = e.y + e.h / 2;
      var headX = ccx + e.facing * 3, headY = ccy - 1.5;

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.crow;
      ctx.beginPath();
      ctx.moveTo(ccx - e.facing * 3, ccy);
      ctx.lineTo(ccx - e.facing * 6, ccy - 2);
      ctx.lineTo(ccx - e.facing * 6, ccy + 2);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(ccx - e.facing * 1, ccy - 0.5);
      ctx.lineTo(ccx - e.facing * 4.5, ccy - 3 - flap);
      ctx.lineTo(ccx + e.facing * 0.5, ccy - 1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.crow;
      ctx.beginPath();
      ctx.ellipse(ccx, ccy + 1, 3.2, 2.6, 0, 0, Math.PI * 2);
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

      var armAngle = 0;
      if (e.atkState === 'windup') armAngle = -0.7 * (1 - e.atkTimer / BOSS_ATTACK_WINDUP);
      else if (e.atkState === 'strike') armAngle = -0.7 + 1.3 * (1 - e.atkTimer / BOSS_ATTACK_ACTIVE);

      if (e.atkState === 'strike') {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.translate(scx, sy + 10.5);
        ctx.rotate(armAngle - 0.35 * e.facing);
        ctx.fillStyle = COLOR.scarecrowDark;
        ctx.fillRect(-sw / 2 - 4, -1.5, sw + 8, 3);
        ctx.restore();
      }

      ctx.save();
      ctx.translate(scx, sy + 10.5);
      ctx.rotate(armAngle * e.facing);
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.scarecrowDark;
      ctx.fillRect(-sw / 2 - 4, -1.5, sw + 8, 3);
      ctx.strokeStyle = COLOR.outline;
      ctx.strokeRect(-sw / 2 - 3.5, -1, sw + 7, 2);
      ctx.restore();

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.scarecrowBody;
      ctx.fillRect(sx + 2, sy + 8, sw - 4, sh - 8);
      ctx.strokeStyle = COLOR.outline;
      ctx.strokeRect(sx + 2.5, sy + 8.5, sw - 5, sh - 9);

      ctx.strokeStyle = COLOR.straw;
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
      ctx.beginPath();
      ctx.moveTo(scx - 4, sy + 3); ctx.lineTo(scx - 2, sy + 5);
      ctx.moveTo(scx - 2, sy + 3); ctx.lineTo(scx - 4, sy + 5);
      ctx.moveTo(scx + 2, sy + 3); ctx.lineTo(scx + 4, sy + 5);
      ctx.moveTo(scx + 4, sy + 3); ctx.lineTo(scx + 2, sy + 5);
      ctx.moveTo(scx - 2, sy + 7); ctx.lineTo(scx + 2, sy + 7);
      ctx.stroke();
    }
  }

  function drawBaconShape(wave) {
    var L = 7.5, TH = 2.6, AMP = 0.85, SEG = 8;
    function edgeY(t, off) { return Math.sin(t * Math.PI * 2.2 + wave) * AMP + off; }

    ctx.beginPath();
    for (var i = 0; i <= SEG; i++) {
      var t = i / SEG, ex = -L / 2 + t * L;
      if (i === 0) ctx.moveTo(ex, edgeY(t, -TH / 2));
      else ctx.lineTo(ex, edgeY(t, -TH / 2));
    }
    for (var j = SEG; j >= 0; j--) {
      var t2 = j / SEG;
      ctx.lineTo(-L / 2 + t2 * L, edgeY(t2, TH / 2));
    }
    ctx.closePath();
    ctx.fillStyle = COLOR.bacon;
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 0.4;
    ctx.stroke();

    ctx.strokeStyle = COLOR.baconFat;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (var k = 0; k <= SEG; k++) {
      var t3 = k / SEG;
      if (k === 0) ctx.moveTo(-L / 2, edgeY(t3, -0.55));
      else ctx.lineTo(-L / 2 + t3 * L, edgeY(t3, -0.55));
    }
    ctx.stroke();

    ctx.strokeStyle = COLOR.baconStripe;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (var m = 0; m <= SEG; m++) {
      var t4 = m / SEG;
      if (m === 0) ctx.moveTo(-L / 2, edgeY(t4, 0.75));
      else ctx.lineTo(-L / 2 + t4 * L, edgeY(t4, 0.75));
    }
    ctx.stroke();
  }

  function drumstick(bx, by, ang, scale) {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(ang);
    ctx.fillStyle = COLOR.roastDark;
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.9 * scale, 1.15 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 0.35;
    ctx.stroke();
    ctx.strokeStyle = COLOR.bone;
    ctx.lineWidth = 0.9 * scale;
    ctx.beginPath();
    ctx.moveTo(1.2 * scale, 0);
    ctx.lineTo(2.5 * scale, 0);
    ctx.stroke();
    ctx.fillStyle = COLOR.bone;
    ctx.beginPath();
    ctx.arc(2.8 * scale, 0, 0.68 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 0.3;
    ctx.stroke();
    ctx.restore();
  }

  // A trussed bird rather than an oval: bezier breast tapering to the tail,
  // a roasted gradient, crisped sheen, and two drumsticks with exposed bone.
  function drawRoastShape() {
    drumstick(2.0, -1.5, -0.55, 0.95);

    var grad = ctx.createLinearGradient(0, -3.2, 0, 2.4);
    grad.addColorStop(0, COLOR.roastLight);
    grad.addColorStop(0.45, COLOR.roast);
    grad.addColorStop(1, COLOR.roastDeep);

    ctx.beginPath();
    ctx.moveTo(-3.7, 0.3);
    ctx.bezierCurveTo(-4.1, -1.9, -2.3, -3.1, 0.2, -3.0);
    ctx.bezierCurveTo(2.5, -2.9, 3.9, -1.7, 4.1, -0.2);
    ctx.bezierCurveTo(4.2, 1.1, 2.7, 2.1, 0.4, 2.2);
    ctx.bezierCurveTo(-1.9, 2.3, -3.4, 1.6, -3.7, 0.3);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 0.42;
    ctx.stroke();

    ctx.strokeStyle = COLOR.roastSheen;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(-0.7, -0.9, 2.0, 1.25, -0.2, Math.PI * 1.02, Math.PI * 1.85);
    ctx.stroke();

    // Trussing string across the breast.
    ctx.strokeStyle = COLOR.roastDeep;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(-1.4, -2.5);
    ctx.lineTo(-0.7, 2.0);
    ctx.stroke();

    drumstick(2.5, 0.6, 0.42, 0.85);
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.4));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      if (p.kind === 'feather') {
        // Black, to match the crow. Stroked with a lighter edge so the shape
        // still reads when it drifts over dark water or soil.
        ctx.fillStyle = COLOR.feather;
        ctx.beginPath();
        ctx.ellipse(0, 0, 1.4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLOR.featherEdge;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = COLOR.straw;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-3, 0);
        ctx.lineTo(3, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawDrops() {
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      var bobY = d.landed ? Math.sin(time * 3 + d.bob) * 0.6 : 0;
      ctx.save();
      ctx.translate(d.x + d.w / 2, d.y + d.h / 2 + bobY);
      ctx.rotate(d.angle);
      if (d.kind === 'roast') drawRoastShape();
      else drawBaconShape(d.wave);
      ctx.restore();
    }
  }

  function drawBossBar() {
    var boss = null;
    for (var i = 0; i < enemies.length; i++) if (enemies[i].type === 'scarecrow') boss = enemies[i];
    if (!boss || boss.dead) return;
    if (Math.abs(player.x - boss.x) > BOSS_AGGRO_RANGE * 1.6) return;

    var barW = 140, barH = 5, x = W / 2 - barW / 2, y = 30;
    ctx.textAlign = 'center';
    ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.hud;
    ctx.fillText('SCARECROW', W / 2, y - 3);
    ctx.fillStyle = COLOR.hpEmpty;
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = COLOR.bad;
    ctx.fillRect(x, y, barW * Math.max(0, boss.hp / ENEMY_DEFS.scarecrow.hp), barH);
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, barW - 1, barH - 1);
  }

  function drawHud() {
    var pipW = 7, gap = 2, startX = 4, y = 4;
    for (var i = 0; i < mods.maxHp; i++) {
      ctx.fillStyle = i < player.hp ? COLOR.bad : COLOR.hpEmpty;
      ctx.fillRect(startX + i * (pipW + gap), y, pipW, 6);
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(startX + i * (pipW + gap) + 0.5, y + 0.5, pipW - 1, 5);
    }

    ctx.font = '8px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.hud;
    ctx.textAlign = 'center';
    ctx.fillText('DEPTH ' + depth + '/' + FINAL_DEPTH, W / 2, 10);
    ctx.textAlign = 'right';
    ctx.fillText('CORN ' + runCorn + '   ' + pad(runScore), W - 4, 10);

    ctx.textAlign = 'left';
    ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.dim;
    ctx.fillText(mods.hasCombine ? (combineActive ? 'F: DISMOUNT' : 'F: COMBINE') : '', 4, 18);

    if (toastTimer > 0) {
      ctx.textAlign = 'center';
      ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = COLOR.title;
      ctx.fillText(toastText, W / 2, 22);
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
    ctx.fillStyle = COLOR.panelBg;
    ctx.fillRect(0, startY - 16, W, lines.length * 14 + 10);
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].text) continue;
      ctx.font = lines[i].size + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = lines[i].color || COLOR.hud;
      ctx.fillText(lines[i].text, W / 2, startY + i * 14);
    }
  }

  function drawUpgradeScreen() {
    ctx.fillStyle = 'rgba(20,16,12,0.55)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.cardSel;
    ctx.fillText('CHOOSE AN UPGRADE', W / 2, 28);

    var cardW = 92, cardH = 62, gap = 8;
    var total = upgradeChoices.length * cardW + (upgradeChoices.length - 1) * gap;
    var x0 = W / 2 - total / 2;

    for (var i = 0; i < upgradeChoices.length; i++) {
      var u = upgradeChoices[i];
      var x = x0 + i * (cardW + gap), y = 48;
      ctx.fillStyle = COLOR.cardBg;
      ctx.fillRect(x, y, cardW, cardH);
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cardW - 1, cardH - 1);

      ctx.fillStyle = COLOR.title;
      ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(String(i + 1), x + cardW / 2, y + 13);

      ctx.fillStyle = COLOR.hud;
      ctx.font = '7px ui-monospace, Menlo, Consolas, monospace';
      wrapText(u.name, x + cardW / 2, y + 27, cardW - 8, 8);

      ctx.fillStyle = COLOR.dim;
      ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
      wrapText(u.desc, x + cardW / 2, y + 43, cardW - 10, 7);

      var have = runUpgrades[u.id] || 0;
      if (have > 0) {
        ctx.fillStyle = COLOR.good;
        ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText('LV ' + have + '/' + u.max, x + cardW / 2, y + cardH - 4);
      }
    }

    ctx.fillStyle = COLOR.cardBg;
    ctx.font = '7px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('PRESS 1, 2 OR 3', W / 2, H - 12);
  }

  function wrapText(text, cx, y, maxW, lineH) {
    var words = String(text).split(' ');
    var line = '', lines = [];
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], cx, y + j * lineH);
  }

  function drawHub() {
    ctx.fillStyle = 'rgba(20,16,12,0.62)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.cardSel;
    ctx.fillText('THE FARMSTEAD', W / 2, 16);

    ctx.font = '7px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.cardBg;
    ctx.fillText('BANKED CORN ' + meta.bankedCorn + '    BEST DEPTH ' + meta.bestDepth +
      '    BEST ' + pad(meta.bestScore), W / 2, 27);

    var rowH = 20, y0 = 38;
    for (var i = 0; i < TREE.length; i++) {
      var node = TREE[i];
      var lvl = nodeLevel(node.id);
      var maxed = lvl >= node.max;
      var afford = meta.bankedCorn >= node.cost;
      var sel = i === treeIndex;
      var x = 24, y = y0 + i * rowH, w = W - 48, h = rowH - 4;

      ctx.fillStyle = sel ? COLOR.cardSel : COLOR.cardBg;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      ctx.textAlign = 'left';
      ctx.font = '7px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = COLOR.hud;
      ctx.fillText(node.name + '  ' + lvl + '/' + node.max, x + 5, y + 8);

      ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = COLOR.dim;
      ctx.fillText(node.desc, x + 5, y + 15);

      ctx.textAlign = 'right';
      ctx.font = '7px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = maxed ? COLOR.good : (afford ? COLOR.hud : COLOR.bad);
      ctx.fillText(maxed ? 'MAXED' : node.cost + ' CORN', x + w - 5, y + 12);
    }

    ctx.textAlign = 'center';
    ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.cardBg;
    ctx.fillText('W/S SELECT   SPACE BUY   H BACK', W / 2, H - 6);
  }

  function render() {
    // Reset each frame so the logical->buffer scale can't compound.
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    drawSky();
    drawHill();

    if (state !== 'hub') {
      ctx.save();
      ctx.translate(-cameraX, 0);
      drawWater();
      drawPlatforms();
      drawExit();
      drawCorn();
      drawDrops();
      for (var i = 0; i < enemies.length; i++) drawEnemy(enemies[i]);
      if (player && state !== 'victory') drawPlayer();
      drawParticles();
      ctx.restore();
    }

    if (state === 'playing') {
      drawHud();
    } else if (state === 'title') {
      var blink = Math.floor(time * 2) % 2 === 0;
      drawOverlayText([
        { text: 'FARMER BROWN', size: 16, color: COLOR.title },
        { text: '', size: 5 },
        { text: 'A/D MOVE   W JUMP (HOLD = HIGHER)   SPACE ATTACK   SHIFT ROLL', size: 6, color: COLOR.dim },
        { text: 'BEST DEPTH ' + meta.bestDepth + '   BANKED CORN ' + meta.bankedCorn, size: 6, color: COLOR.dim },
        { text: '', size: 4 },
        { text: blink ? 'ANY KEY: RUN     H: FARMSTEAD' : '', size: 7 }
      ]);
    } else if (state === 'hub') {
      drawHub();
    } else if (state === 'upgrade') {
      drawUpgradeScreen();
    } else if (state === 'levelclear') {
      drawOverlayText([
        { text: 'FIELD CLEARED', size: 14, color: COLOR.good },
        { text: '', size: 4 },
        { text: 'DEPTH ' + depth + ' DONE   CORN ' + runCorn, size: 7 },
        { text: '', size: 4 },
        { text: 'ANY KEY: DESCEND', size: 7 }
      ]);
    } else if (state === 'dead') {
      drawOverlayText([
        { text: 'YOU DIED', size: 16, color: COLOR.bad },
        { text: '', size: 4 },
        { text: 'DEPTH ' + depth + '   SCORE ' + pad(runScore), size: 7 },
        { text: 'BANKED ' + runCorn + ' CORN (TOTAL ' + meta.bankedCorn + ')', size: 6, color: COLOR.dim },
        { text: '', size: 4 },
        { text: 'ANY KEY: NEW RUN     H: FARMSTEAD', size: 7 }
      ]);
    } else if (state === 'victory') {
      drawOverlayText([
        { text: 'HARVEST COMPLETE', size: 13, color: COLOR.good },
        { text: '', size: 4 },
        { text: 'SCORE ' + pad(runScore) + '   CORN ' + runCorn, size: 7 },
        { text: 'TOTAL BANKED ' + meta.bankedCorn, size: 6, color: COLOR.dim },
        { text: '', size: 4 },
        { text: 'ANY KEY: NEW RUN     H: FARMSTEAD', size: 7 }
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

  // Title screen shows a generated field behind the panel.
  mods = freshMods();
  runSeed = (Math.random() * 0xffffffff) >>> 0;
  generateLevel();
  player = makePlayer();
  requestAnimationFrame(frame);
})();

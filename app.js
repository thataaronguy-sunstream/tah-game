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
    var pulseCache = {};

    // ---------------------------------------------------------- soundtrack --
    // A full multi-section chiptune arrangement in the NES idiom: two pulse
    // channels (lead + harmony) over a triangle bass and a noise kit. Patterns
    // are written per bar and flattened into one long step table at startup,
    // so the whole thing is one seamless ~5 minute loop rather than a vamp.
    // 160bpm x 3200 sixteenths lands the loop on exactly 300 seconds.
    var MUSIC_BPM = 160;
    var MUSIC_STEP = 60 / MUSIC_BPM / 4;   // sixteenth notes
    var STEPS_PER_BAR = 16;

    var NOTE = (function () {
      var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      var table = {};
      for (var o = 1; o <= 6; o++) {
        for (var i = 0; i < 12; i++) {
          table[names[i] + o] = 440 * Math.pow(2, ((12 * (o + 1) + i) - 69) / 12);
        }
      }
      return table;
    })();

    // Hoedown harmony: G major I-IV-V with a flat-seven F for mixolydian
    // twang, which is what makes it read as country rather than heroic NES.
    var CHORDS = {
      G: { notes: ['G', 'B', 'D'], bass: 'G2' },
      C: { notes: ['C', 'E', 'G'], bass: 'C3' },
      D: { notes: ['D', 'F#', 'A'], bass: 'D3' },
      Em: { notes: ['E', 'G', 'B'], bass: 'E2' },
      Am: { notes: ['A', 'C', 'E'], bass: 'A2' },
      F: { notes: ['F', 'A', 'C'], bass: 'F2' }
    };

    // Boom-chick: root on the downbeat, fifth on beat three, with a walk-up
    // into the next bar. Straight out of a bluegrass bass part.
    function bassBar(chordName) {
      var c = CHORDS[chordName];
      var r = NOTE[c.bass];
      var fifth = r * 1.4983;
      var bar = new Array(16).fill(0);
      bar[0] = r;
      bar[4] = r * 2;
      bar[8] = fifth;
      bar[12] = r * 2;
      bar[14] = fifth;
      return bar;
    }

    // Banjo roll on eighths, not sixteenths. Rolling continuously under the
    // fiddle's own sixteenth runs turned the mix to mush; on eighths it reads
    // as a rhythm player backing the melody instead of competing with it.
    function harmBar(chordName, octave) {
      var c = CHORDS[chordName];
      var o = octave || 4;
      var t = [
        NOTE[c.notes[0] + o], NOTE[c.notes[2] + o], NOTE[c.notes[1] + o],
        NOTE[c.notes[0] + (o + 1)]
      ];
      var bar = new Array(16).fill(0);
      for (var i = 0; i < 8; i++) bar[i * 2] = t[i % t.length];
      return bar;
    }

    function L(str) {
      // "G4 . . . B4 . . ." -> frequency array, '.' is a rest.
      return str.trim().split(/\s+/).map(function (tok) {
        return tok === '.' ? 0 : (NOTE[tok] || 0);
      });
    }

    // Fiddle lines: G major pentatonic runs, sawing double-stop figures and
    // the flat-seven (F5) leaning into the twang.
    var LEADS = {
      rest: L('. . . . . . . . . . . . . . . .'),
      i1: L('G4 . B4 . D5 . B4 . G4 . . . D4 . . .'),
      i2: L('E5 . D5 . B4 . A4 . G4 . . . . . . .'),
      i3: L('D5 . E5 . G5 . E5 . D5 . B4 . . . . .'),
      i4: L('G5 . . . D5 . . . B4 . . . G4 . . .'),
      a1: L('G4 . B4 . D5 . B4 . G5 . . . D5 . . .'),
      a2: L('C5 . E5 . G5 . E5 . C5 . . . G4 . . .'),
      a3: L('D5 . F#5 . A5 . F#5 . D5 . . . A4 . . .'),
      a4: L('G5 . F#5 . E5 . D5 . B4 . . . G4 . . .'),
      a5: L('B4 . D5 . G5 . D5 . E5 . . . B4 . . .'),
      a6: L('G5 . A5 . B5 . G5 . E5 . . . D5 . . .'),
      b1: L('E5 . G5 . B5 . G5 . E5 . D5 . B4 . . .'),
      b2: L('A4 . C5 . E5 . C5 . A4 . G4 . E4 . . .'),
      b3: L('F5 . E5 . D5 . C5 . B4 . A4 . G4 . . .'),
      b4: L('D5 . F#5 . A5 . G5 . F#5 . . . D5 . . .'),
      c1: L('G5 . . B5 . . A5 . . G5 . . E5 . . .'),
      c2: L('D5 . . F#5 . . E5 . . D5 . . B4 . . .'),
      c3: L('B5 . . G5 . . E5 . D5 . . . G5 . . .'),
      c4: L('. . G5 . . . D5 . . . B4 . . . D5 .'),
      d1: L('G4 . B4 . D5 . E5 . D5 . . . B4 . . .'),
      d2: L('C5 . B4 . A4 . G4 . E5 . . . D5 . . .'),
      d3: L('B4 . D5 . G5 . E5 . D5 . . . B4 . . .'),
      d4: L('A4 . C5 . E5 . F#5 . G5 . . . D5 . . .'),
      e1: L('G5 . . E5 . . D5 . B4 . . G4 . . . .'),
      e2: L('D5 . . B4 . . G4 . A4 . . B4 . . . .'),
      e3: L('G5 . B5 . D6 . B5 . G5 . E5 . D5 . . .'),
      e4: L('F5 . E5 . D5 . B4 . G4 . B4 . D5 . . .')
    };

    // 'k' kick/stomp, 's' snare, 'h' hat, 'o' open hat. The busier patterns are
    // a country train beat rather than a rock backbeat.
    // Thinned out: the old train beat put a hat on every other sixteenth,
    // which fought the banjo and the fiddle for the same space.
    var DRUMS = {
      quiet: '............h...',
      basic: 'k.......s.......',
      drive: 'k...h...s...h...',
      train: 'k...h...s...h..h',
      busy: 'k...h.k.s...h...',
      fill: 'k.......s...s.s.',
      none: '................'
    };

    function block(chords, leads, drum) {
      return { chords: chords, leads: leads, drum: drum };
    }

    var SEC = {
      intro: block(['G', 'G', 'C', 'C', 'D', 'D', 'G', 'G'],
        ['i1', 'i2', 'i1', 'i3', 'i4', 'i2', 'i1', 'rest'], 'quiet'),
      main: block(['G', 'C', 'G', 'D', 'G', 'C', 'D', 'G'],
        ['a1', 'a2', 'a1', 'a3', 'a5', 'a2', 'a4', 'a1'], 'train'),
      mainB: block(['G', 'C', 'G', 'D', 'Em', 'C', 'D', 'G'],
        ['a5', 'a2', 'a6', 'a3', 'b1', 'a2', 'a4', 'a5'], 'busy'),
      barnDance: block(['Em', 'D', 'G', 'C', 'Em', 'D', 'C', 'G'],
        ['b1', 'b4', 'a1', 'a2', 'b1', 'b4', 'b3', 'a5'], 'train'),
      hoedown: block(['C', 'D', 'G', 'G', 'C', 'D', 'G', 'G'],
        ['c1', 'c2', 'c3', 'c4', 'c1', 'c2', 'c3', 'rest'], 'busy'),
      porch: block(['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'D'],
        ['d1', 'd2', 'd3', 'd4', 'd1', 'd2', 'd4', 'rest'], 'basic'),
      stomp: block(['G', 'G', 'F', 'F', 'C', 'C', 'D', 'D'],
        ['e1', 'e2', 'e1', 'e2', 'e3', 'e4', 'e3', 'e4'], 'busy'),
      breakdown: block(['G', 'G', 'C', 'C', 'Am', 'Am', 'D', 'D'],
        ['rest', 'i1', 'rest', 'i3', 'rest', 'b2', 'i4', 'rest'], 'quiet'),
      turn: block(['C', 'D', 'G', 'G'], ['c1', 'c2', 'a5', 'rest'], 'fill')
    };

    var ARRANGEMENT = [
      'intro',
      'main', 'main', 'mainB',
      'barnDance', 'turn',
      'main', 'hoedown',
      'porch', 'porch',
      'stomp', 'turn',
      'mainB', 'barnDance',
      'breakdown',
      'main', 'hoedown',
      'stomp', 'mainB',
      'porch', 'turn',
      'main', 'mainB',
      'barnDance', 'hoedown',
      'stomp', 'turn'
    ];


    // Flatten the arrangement into one step table so scheduling is a lookup.
    var SONG = (function () {
      var steps = [];
      for (var s = 0; s < ARRANGEMENT.length; s++) {
        var sec = SEC[ARRANGEMENT[s]];
        for (var b = 0; b < sec.chords.length; b++) {
          var bass = bassBar(sec.chords[b]);
          var harm = harmBar(sec.chords[b], 4);
          var lead = LEADS[sec.leads[b % sec.leads.length]] || LEADS.rest;
          var drum = DRUMS[sec.drum];
          for (var i = 0; i < STEPS_PER_BAR; i++) {
            steps.push({
              bass: bass[i] || 0,
              harm: harm[i] || 0,
              lead: lead[i] || 0,
              drum: drum.charAt(i)
            });
          }
        }
      }
      return steps;
    })();

    var SONG_SECONDS = SONG.length * MUSIC_STEP;


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
        var g = a.createGain();
        g.gain.value = 0.85;
        g.connect(a.destination);
        musicBus = g;
      }
      return musicBus;
    }

    // Real pulse waves via the Fourier series for a given duty cycle, which is
    // what gives the two lead channels their distinct NES character.
    function pulseWave(duty) {
      var a = ensure();
      var key = String(duty);
      if (pulseCache[key]) return pulseCache[key];
      var n = 24;
      var real = new Float32Array(n);
      var imag = new Float32Array(n);
      for (var i = 1; i < n; i++) {
        imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
      }
      var w = a.createPeriodicWave(real, imag, { disableNormalization: false });
      pulseCache[key] = w;
      return w;
    }

    function chipNote(freq, time, dur, vol, duty, type) {
      var a = ensure();
      var osc = a.createOscillator();
      var gain = a.createGain();
      if (type) osc.type = type;
      else osc.setPeriodicWave(pulseWave(duty));
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(vol, time + 0.006);
      gain.gain.setValueAtTime(vol, time + dur * 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(gain);
      gain.connect(musicOut());
      osc.start(time);
      osc.stop(time + dur + 0.02);
    }

    function drumHit(sym, time) {
      var a = ensure();
      if (sym === 'k') {
        var osc = a.createOscillator();
        var g = a.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(45, time + 0.11);
        g.gain.setValueAtTime(0.16, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);
        osc.connect(g); g.connect(musicOut());
        osc.start(time); osc.stop(time + 0.15);
        return;
      }
      if (sym !== 's' && sym !== 'h' && sym !== 'o') return;

      var dur = sym === 's' ? 0.13 : (sym === 'o' ? 0.1 : 0.035);
      var size = Math.max(1, Math.floor(a.sampleRate * dur));
      var buf = a.createBuffer(1, size, a.sampleRate);
      var dat = buf.getChannelData(0);
      for (var i = 0; i < size; i++) dat[i] = (Math.random() * 2 - 1) * (1 - i / size);
      var src = a.createBufferSource();
      src.buffer = buf;
      var filt = a.createBiquadFilter();
      filt.type = sym === 's' ? 'bandpass' : 'highpass';
      filt.frequency.value = sym === 's' ? 1400 : 7000;
      var g2 = a.createGain();
      g2.gain.value = sym === 's' ? 0.11 : 0.045;
      src.connect(filt); filt.connect(g2); g2.connect(musicOut());
      src.start(time);
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
        var st = SONG[musicStepIndex % SONG.length];
        var t = musicNextStepTime;

        if (st.bass) chipNote(st.bass, t, MUSIC_STEP * 1.7, 0.085, 0, 'triangle');
        if (st.lead) chipNote(st.lead, t, MUSIC_STEP * 1.8, 0.05, 0.5);
        if (st.harm) chipNote(st.harm, t, MUSIC_STEP * 0.9, 0.028, 0.25);
        if (st.drum && st.drum !== '.') drumHit(st.drum, t);

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
      heal: function () {
        [523, 698, 880].forEach(function (f, i) { beep(f, 0.16, 'triangle', 0.09, i * 0.07); });
      },
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
      bullSnort: function () {
        sweep(180, 70, 0.3, 'sawtooth', 0.12);
        noiseBurst(0.16, 0.09);
      },
      bossSwing: function () { sweep(150, 60, 0.2, 'sawtooth', 0.1); },
      slam: function () {
        sweep(220, 40, 0.35, 'sawtooth', 0.14);
        noiseBurst(0.22, 0.13);
      },
      // Sad-trombone descent for a drowning.
      skewer: function () {
        beep(180, 0.05, 'square', 0.09);
        sweep(1400, 500, 0.16, 'square', 0.08);
        noiseBurst(0.1, 0.07);
      },
      vultureCry: function () {
        sweep(900, 340, 0.28, 'sawtooth', 0.09);
        beep(420, 0.1, 'square', 0.05, 0.2);
      },
      womp: function () {
        [311.13, 277.18, 233.08].forEach(function (f, i) {
          beep(f, 0.3, 'sawtooth', 0.12, i * 0.26);
        });
        var a = ensure();
        var t0 = a.currentTime + 0.78;
        var osc = a.createOscillator(), g = a.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(196, t0);
        osc.frequency.exponentialRampToValueAtTime(82, t0 + 0.9);
        g.gain.setValueAtTime(0.13, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.95);
        osc.connect(g); g.connect(a.destination);
        osc.start(t0); osc.stop(t0 + 1.0);
      }
    };
  })();

  // ------------------------------------------------------------- tuning ----
  var GRAVITY = 420;
  var MAX_FALL_SPEED = 260;
  var MOVE_SPEED = 55;
  var COMBINE_MOVE_SPEED = 30;
  var SLAM_RADIUS = 36;
  var SLAM_DAMAGE = 2;
  var JUMP_VELOCITY = -165;
  // Releasing the jump key mid-ascent scrubs most of the remaining upward
  // velocity, so a tap is a short hop and a hold gives the full arc.
  var JUMP_CUT_MULT = 0.45;
  var DODGE_SPEED = 160;
  var DODGE_DURATION = 0.22;
  var DODGE_COOLDOWN_BASE = 0.5;
  var ATTACK_DURATION = 0.19;
  var ATTACK_COOLDOWN_BASE = 0.26;
  var COMBO_WINDOW = 0.45;

  var PLAYER_W = 8, PLAYER_H = 14;
  var COMBINE_W = 18, COMBINE_H = 11;
  var PLAYER_HIT_INVULN = 0.8;
  var STOMP_GRACE = 0.3;

  // Knockback needs its own timer on both sides. Setting vx alone did nothing:
  // the player's vx is rewritten from the movement keys every frame, and each
  // enemy's chase logic reassigns vx too, so a hit was erased before it ever
  // drew. While the timer runs, that steering is suspended and the impulse
  // actually carries.
  var KNOCKBACK_TIME = 0.2, KNOCKBACK_DRAG = 5;
  var KNOCKBACK_VX = 120, KNOCKBACK_VY = -58;
  var PLAYER_KNOCKBACK_TIME = 0.22;
  var PLAYER_KNOCKBACK_VX = 95, PLAYER_KNOCKBACK_VY = -70;
  // Heavies barely budge. Being able to shove a boss around the arena with a
  // pitchfork would defuse the fight it took five levels to reach; the oak is
  // a rooted tree and does not move at all.
  var KNOCKBACK_RESIST = {
    scarecrow: 0.5, bull: 0.35, rustbucket: 0.35, queen: 0.45, oak: 0
  };
  // Bosses get the impulse but recover fast. Their knockback has to stay well
  // under the attack cooldown (0.26s) or a fast swinger could hold a boss in
  // permanent flinch and never face an attack.
  var BOSS_KNOCKBACK_TIME = 0.08;

  var GROUND_Y = 164;
  // A boss every five levels rather than a single hard stop. Beating one lets
  // you bank out or push deeper with your upgrades intact.
  var BOSS_INTERVAL = 5;
  var BOSS_ORDER = ['scarecrow', 'bull', 'rustbucket', 'queen', 'oak'];
  var BOSS_NAMES = {
    scarecrow: 'SCARECROW', bull: 'THE BULL', rustbucket: 'RUSTBUCKET',
    queen: 'SWARM QUEEN', oak: 'THE OLD OAK'
  };
  function isBossDepth(d) { return d % BOSS_INTERVAL === 0; }
  function bossTypeFor(d) {
    var idx = Math.floor(d / BOSS_INTERVAL) - 1;
    return BOSS_ORDER[Math.min(idx, BOSS_ORDER.length - 1)];
  }
  function bossTierFor(d) { return Math.floor(d / BOSS_INTERVAL); }
  // Cards used to unlock every 5 cobs, and cobs are everywhere - you drowned
  // in choices. They're gated on points now, escalating so later cards are
  // rarer than the first.
  // A flat step doesn't work: levels yield ~1200 points each by depth 5, so a
  // fixed gap actually hands out MORE cards than the old 5-cob rule. The gap
  // has to accelerate. These land on roughly one card per level.
  var UPGRADE_SCORE_FIRST = 750;
  var UPGRADE_STEP_BASE = 550;
  var UPGRADE_STEP_GROWTH = 200;
  // Value each resource banks for at the Farmstead. Meat is worth more than
  // a cob because you had to fight something for it.
  var RES_BANK_VALUE = { corn: 1, bacon: 2, chicken: 3 };

  // Single-jump horizontal reach is ~43px (0.79s airtime x 55px/s), so gaps
  // are capped well under that; the air jump is margin, not a requirement.
  var GAP_MIN = 22, GAP_MAX = 30;
  // Taller trees, tighter perches: the climb is the skill test. Steps stay
  // under a single jump's ~31px of lift so it's precision, not luck.
  var BRANCH_BASE = 24, BRANCH_STEP = 22;
  var BRANCH_W_MIN = 12, BRANCH_W_MAX = 18;
  var BALE_H = 13;
  var APPLE_CORN = 10, APPLE_SCORE = 200;

  // Kept under the original key so existing skill-tree progress survives the
  // rename rather than silently resetting for anyone who has already played.
  var META_KEY = 'tah-game-deadfields-meta';

  var SCORE_CORN = 25, SCORE_CROW = 50, SCORE_BOAR = 75, SCORE_VULTURE = 220, SCORE_BOSS = 500;

  var COLOR = {
    skyTop: '#6ec6f1', skyBottom: '#cdeeff', sun: '#ffe066', cloud: '#ffffff',
    hill: '#6fae52', outline: '#2a1f18',
    soil: '#8a5a3a', soilSeam: 'rgba(42,31,24,0.18)', grass: '#5fbf3f', grassLight: '#7ad653',
    crate: '#c68a45', crateDark: '#8a5a2c',
    player: '#3d6fd1', skin: '#f2c294', fork: '#d8dbe0', forkHandle: '#6a4526',
    crow: '#1e1e1e', crowBeak: '#4a4a52', crowSheen: '#3d4655', crowEye: '#e8c15a',
    rust: '#a8603a', rustDark: '#6f3a20',
    queen: '#4a5a2a', queenDark: '#2f3a18', queenLit: '#9fc44a', wing: '#dfeaf5',
    larva: '#e8dcc0', larvaHead: '#c9b48a',
    bull: '#3a2f2a', bullDark: '#241c18', bullMuzzle: '#c99a86', bullRing: '#e8c15a',
    vulture: '#4a3f38', vultureDark: '#2f2823', vultureRuff: '#d8cdb8', vultureHead: '#c98d7a',
    boar: '#a8703f', boarDark: '#6a4526', boarLight: '#f5f1e6',
    barnWall: '#c1432f', barnRoof: '#7a2e1f', barnDoor: '#4a2c18', barnTrim: '#f5f1e6',
    soilWet: '#5f3c24', rock: '#9aa0a8', rockLight: '#d3d8de',
    hay: '#d9b465', hayDark: '#a8842f', hayLight: '#f0dc9a',
    trunk: '#6a4526', trunkDark: '#4a2f18', leaf: '#3f8f3a', leafLight: '#6fc257',
    apple: '#d63a2f', appleDark: '#a3241d', appleStem: '#6a4526',
    siloBody: '#d8cdb8', siloDark: '#a89a80', siloRoof: '#7a8088',
    hud: '#2a1f18', hpEmpty: '#d8cdb8', title: '#e88a2a', dim: '#4a3f38',
    bad: '#e0392a', good: '#15702e', flash: '#ffffff',
    panelBg: 'rgba(30,26,20,0.16)', cardBg: '#f5f1e6', cardSel: '#ffe066',
    waterTop: '#5ec8e8', waterDeep: '#1f6f9e', waterSurface: '#d6f6ff',
    corn: '#f5cb56', cornKernel: '#c48b1f', cornSilk: '#efe0a8',
    cornHusk: '#4f9c3a', cornHuskDark: '#40862f', cornHuskLight: '#79c455',
    stalk: '#5c9e35', stalkDark: '#3d7522', stalkLeaf: '#63ad3c', stalkLeafDark: '#4a8c2c',
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
    // Queen spawn: a helpless grub that squirms along the ground, then hatches
    // into a fly with crow stats. Kill it early and it never gets airborne.
    larva: { w: 8, h: 5, hp: 1, speed: 9, detect: 0 },
    fly: { w: 10, h: 8, hp: 1, speed: 20, detect: 50 },
    // 3 pitchfork hits, or a slam plus one. Tanky enough to be a fight,
    // short enough that you're not chasing it round the tree all day.
    vulture: { w: 17, h: 13, hp: 3, speed: 26, diveSpeed: 112, detect: 130 },
    scarecrow: { w: 16, h: 22, hp: 12, speed: 0, detect: 0 },
    // The bull paces, paws the ground, then charges the full arena. If it hits
    // a wall it recoils, shakes it off and lines up another run - that reset
    // is the whole fight.
    bull: { w: 26, h: 16, hp: 16, speed: 22, chargeSpeed: 168, detect: 999 },
    // Driverless combine. Grinds along the ground and can't climb, so the
    // fight is vertical: you work from bales and branches while it patrols.
    rustbucket: { w: 30, h: 18, hp: 20, speed: 30, chargeSpeed: 30, detect: 999 },
    // Hovers out of melee reach dripping crows; only hittable while she
    // descends to lay. Rewards the overhead sweep and the skewer.
    queen: { w: 20, h: 16, hp: 14, speed: 26, chargeSpeed: 26, detect: 999 },
    // Stationary. Sweeps a low limb along the ground, so the only safe route
    // is up its own branches to the crown.
    oak: { w: 34, h: 64, hp: 24, speed: 0, chargeSpeed: 0, detect: 999 }
  };

  var PLAYER_DROWN_TIME = 1.8;
  var SWIM_SPEED_MUL = 0.7;
  var VULTURE_TELEGRAPH = 0.45;
  var VULTURE_DIVE_TIME = 1.1;
  var VULTURE_COOLDOWN = 1.2;
  var CHAFF_INTERVAL = 1.9;
  var QUEEN_HOVER_Y = 52;
  var QUEEN_LAY_INTERVAL = 3.2;
  var LARVA_MATURE_TIME = 3.5;
  var OAK_SWEEP_INTERVAL = 2.6;
  var BULL_PAW_TIME = 0.7;
  var BULL_RECOVER_TIME = 0.85;
  var BULL_CHARGE_MAX = 2.4;
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
    // The combine is the biggest power spike in the game, so the toolshed is
    // far and away the priciest thing on the board.
    { id: 'toolshed', name: 'TOOLSHED', desc: 'COMBINE JOINS UPGRADE POOL', cost: 900, max: 1 },
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

  // The farmstead lists everything at a scandalous markup. Sven, tucked away
  // in the corner, does the same goods at the honest price - but he's not on
  // retainer, so the arrangement lapses the moment you leave the store.
  var PRICE_MARKUP = 12;
  var SVEN_HOTSPOT = { x: 320 - 72, y: 180 - 17, w: 68, h: 11 };
  var svenMode = false;
  function listPrice(node) { return node.cost * PRICE_MARKUP; }
  function nodePrice(node) { return svenMode ? node.cost : listPrice(node); }

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
  var runRes = { corn: 0, bacon: 0, chicken: 0 };
  var nextUpgradeScore = UPGRADE_SCORE_FIRST;
  var upgradeStep = UPGRADE_STEP_BASE;
  var runUpgrades = {};
  var mods = null;

  // Snapshot taken on entering a stage, so a pit fall can roll the stage's
  // takings back when it puts you on the start line again.
  var stageEntryScore = 0;
  var stageEntryRes = { corn: 0, bacon: 0, chicken: 0 };
  var stageEntryUpgradeScore = UPGRADE_SCORE_FIRST;
  var pitFallTimer = 0;

  var player = null;
  var enemies = [];
  var particles = [];
  var drops = [];
  var corns = [];
  var platforms = [];
  var trees = [];
  var stalks = [];
  var waters = [];
  var levelWidth = 900;
  var exitX = 0;
  var hasBoss = false;
  var cameraX = 0;
  var combineActive = false;

  var upgradeChoices = [];
  var treeIndex = 0;
  var barnBlockedMsgTimer = 0;
  var slamFx = 0;
  var lastBanked = 0, lastLost = 0, lastHaul = 0;
  var drownSeq = null;
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
      rolling: 0, rollCooldown: 0, fellOut: false, airJumpsLeft: 0, jumpCut: true,
      stompGrace: 0, knockback: 0,
      dropThrough: 0, swimming: false, drownTimer: PLAYER_DROWN_TIME
    };
  }

  var enemyIdCounter = 0;
  function makeEnemy(type, x, y) {
    var def = ENEMY_DEFS[type];
    enemyIdCounter++;
    return {
      id: enemyIdCounter, type: type, x: x, y: y, w: def.w, h: def.h,
      vx: 0, vy: 0, facing: -1, hp: def.hp, hitFlash: 0, knockback: 0,
      spawnX: x, spawnY: y, patrolDir: 0, pauseTimer: 0,
      phase: Math.random() * 10, onGround: false, fellOut: false, dead: false,
      perchX: x, perchY: y, mode: 'perch', modeTimer: 0
    };
  }

  function makeBoss(x, y, type, tier) {
    var e = makeEnemy(type, x, y);
    // Each tier past the first toughens the boss so a deeper push means more.
    e.hp = Math.round(ENEMY_DEFS[type].hp * (1 + 0.35 * Math.max(0, tier - 1)));
    e.maxHp = e.hp;
    e.crowSpawnCount = 0;
    e.spawnTimer = BOSS_SPAWN_INTERVAL;
    e.atkState = 'idle';
    e.atkTimer = 0;
    e.atkHit = false;
    // Bull-specific: charge state machine and the lane it runs along.
    e.mode = 'paw';
    e.modeTimer = BULL_PAW_TIME;
    e.chargeDir = -1;
    return e;
  }

  function isBoss(e) { return BOSS_ORDER.indexOf(e.type) !== -1; }

  // Generates a left-to-right chain of ground slabs separated by jumpable
  // gaps, so every level is traversable by construction rather than by
  // post-hoc validation.
  // Any two ground slabs that touch exactly become a single rectangle, so no
  // interior edges get outlined. Thin platforms are left untouched.
  // Is a pickup already sitting here? Padded so two cobs never crowd into
  // what looks like one. A slab can spawn two cobs, and without this they can
  // land on top of each other and read as a single doubled-up pickup.
  // Centre-to-centre, not edge padding. A 4px edge gap still let two 5px cobs
  // sit 9px apart, which reads as a cluster at this scale. Cobs on the same
  // level line now need real daylight between them; different heights (a
  // branch above a ground cob) only need to clear vertically.
  var CORN_MIN_SPACING = 22;
  var CORN_ROW_TOLERANCE = 8;
  function overlapsCorn(x, y, w, h) {
    var cx = x + w / 2, cy = y + h / 2;
    for (var i = 0; i < corns.length; i++) {
      var c = corns[i];
      var ox = c.x + c.w / 2, oy = c.y + c.h / 2;
      var sameRow = Math.abs(cy - oy) < CORN_ROW_TOLERANCE;
      if (sameRow) {
        if (Math.abs(cx - ox) < CORN_MIN_SPACING) return true;
      } else if (aabbOverlap(x - 2, y - 2, w + 4, h + 4, c.x, c.y, c.w, c.h)) {
        return true;
      }
    }
    return false;
  }

  function spotFree(x, y, w, h) {
    return !overlapsSolid(x, y, w, h) && !overlapsCorn(x, y, w, h);
  }

  // Does this rect intersect any solid obstacle already placed?
  function overlapsSolid(x, y, w, h) {
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (!p.solid) continue;
      if (aabbOverlap(x, y, w, h, p.x, p.y, p.w, p.h)) return true;
    }
    return false;
  }

  // Plants a stalk at x if there's room, and hangs its cob off it. The cob is
  // the pickup; the stalk is scenery drawn behind it. The cob picks a side, a
  // height and a tilt so no two stalks look stamped from the same die.
  // Heights stay between 10 and 18 above the ground, which keeps every cob
  // inside a standing player's body so it's always a walk-through pickup.
  var STALK_COB_MIN = 10, STALK_COB_MAX = 18;
  function plantStalk(x, rng) {
    if (overlapsSolid(x - 4, GROUND_Y - 28, 14, 28)) return false;

    var side = rng() < 0.5 ? -1 : 1;
    var lift = STALK_COB_MIN + Math.round(rng() * (STALK_COB_MAX - STALK_COB_MIN));
    var cobX = x + side * 3;
    var cobY = GROUND_Y - lift;
    if (overlapsCorn(cobX, cobY, 5, 6)) return false;

    var stemX = x + 2.5;
    stalks.push({
      x: stemX,
      h: 22 + Math.round(rng() * 8),
      lean: (rng() - 0.5) * 0.24,
      // Where the shank leaves the stem to meet the cob.
      shankY: cobY + 3,
      side: side
    });
    corns.push({
      x: cobX, y: cobY, w: 5, h: 6, collected: false, kind: 'corn',
      // Tilted away from the stem, angled more the further it leans out.
      angle: side * (0.3 + rng() * 0.45)
    });
    return true;
  }

  function mergeFlushGround() {
    var ground = [], others = [];
    for (var i = 0; i < platforms.length; i++) {
      (platforms[i].h > 10 && !platforms[i].bale ? ground : others).push(platforms[i]);
    }
    ground.sort(function (a, b) { return a.x - b.x; });

    var merged = [];
    for (var g = 0; g < ground.length; g++) {
      var prev = merged[merged.length - 1];
      var cur = ground[g];
      if (prev && prev.y === cur.y && Math.abs((prev.x + prev.w) - cur.x) < 0.5) {
        prev.w += cur.w;
      } else {
        merged.push({ x: cur.x, y: cur.y, w: cur.w, h: cur.h });
      }
    }
    platforms = merged.concat(others);
  }

  function generateLevel() {
    var rng = makeRng(runSeed + depth * 7919);
    platforms = [];
    trees = [];
    stalks = [];
    waters = [];
    corns = [];
    enemies = [];
    particles = [];
    drops = [];

    hasBoss = isBossDepth(depth);
    // At most a couple of guarded apple trees per level, often none.
    var appleQuota = Math.floor(rng() * 3);

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
        // No bridges: gaps stay gaps for every form. The combine trades
        // mobility for lethality rather than getting both.
        if (isWater) waters.push({ x: cursor, w: gapW });
        cursor += gapW;
      }
    }

    // Tail slab so the exit always sits on solid ground.
    var tailW = hasBoss ? 130 : 96;
    slabs.push({ x: cursor, w: tailW });
    platforms.push({ x: cursor, y: GROUND_Y, w: tailW, h: H - GROUND_Y });
    cursor += tailW;

    // The loop adds no gap after its last slab, so the tail butts straight up
    // against it. Two flush slabs each stroke their own outline, which drew a
    // dark seam through the ground near the exit - merge them into one.
    mergeFlushGround();

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

      // Platforms are branches growing off a trunk, stacked in tiers you can
      // climb. Apple trees run the full 4 tiers and post a vulture at the top.
      if (usableW > 70 && !(isTail && hasBoss) && rng() < 0.34) {
        var bearsApple = appleQuota > 0 && rng() < 0.45;
        if (bearsApple) appleQuota--;
        var tiers = bearsApple ? 4 : (2 + Math.floor(rng() * 2));
        var trunkX = Math.round(slab.x + 18 + rng() * Math.max(1, usableW - 36));
        var topBranchY = GROUND_Y - (BRANCH_BASE + (tiers - 1) * BRANCH_STEP);
        trees.push({ x: trunkX, topY: topBranchY, tiers: tiers, apple: bearsApple });

        for (var ti = 0; ti < tiers; ti++) {
          var by = GROUND_Y - (BRANCH_BASE + ti * BRANCH_STEP);
          var side = (ti % 2 === 0) ? 1 : -1;
          var bw = BRANCH_W_MIN + Math.round(rng() * (BRANCH_W_MAX - BRANCH_W_MIN));
          var bx = side > 0 ? trunkX + 2 : trunkX - 2 - bw;
          bx = Math.max(slab.x, Math.min(decorLimit - bw, bx));
          // Branches carry no cobs: corn grows on stalks, apples grow on trees.
          platforms.push({ x: bx, y: by, w: bw, h: 5, branch: true, side: side, trunkX: trunkX });
        }

        if (bearsApple) {
          if (spotFree(trunkX - 3, topBranchY - 16, 6, 7)) {
            corns.push({ x: trunkX - 3, y: topBranchY - 16, w: 6, h: 7, collected: false, kind: 'apple' });
          }
          enemies.push(makeEnemy('vulture', trunkX - 8, topBranchY - 30));
        }
      }

      // Round bales dotted along the field: a low step up, and something to
      // break up the ground. Never in the boss arena - a solid obstacle there
      // can pin the boss against a wall and stall the fight.
      var baleCount = (isTail && hasBoss) ? 0
        : (rng() < 0.34 ? (rng() < 0.18 ? 2 : 1) : 0);
      for (var hb = 0; hb < baleCount; hb++) {
        var haW = 15;
        var haX = Math.round(slab.x + 8 + rng() * Math.max(1, usableW - haW - 16));
        if (haX + haW > decorLimit) continue;
        // Bales were only ever checked against the level edge, never against
        // each other, so two could stack into one lump. Pad the test so they
        // also can't end up flush.
        if (overlapsSolid(haX - 6, GROUND_Y - BALE_H, haW + 12, BALE_H)) continue;
        platforms.push({ x: haX, y: GROUND_Y - BALE_H, w: haW, h: BALE_H, bale: true, solid: true });
      }

      // Corn grows on stalks. A few per slab, each bearing one cob at about
      // chest height so you collect it by walking through rather than jumping.
      // Tuned to land on the same corn supply as the old loose-cob scatter -
      // stalks replace it rather than adding to it, or the score-gated
      // upgrade cards speed back up.
      var stalkCount = 1 + (rng() < 0.8 ? 1 : 0);
      for (var st = 0; st < stalkCount; st++) {
        var placedStalk = false;
        for (var sa = 0; sa < 10 && !placedStalk; sa++) {
          var sxp = slab.x + 12 + Math.round(rng() * Math.max(1, usableW - 24));
          if (plantStalk(sxp, rng)) placedStalk = true;
        }
        // Deterministic fallback so a crowded slab still gets its stalks.
        for (var scan = slab.x + 12; scan < usableEnd - 10 && !placedStalk; scan += 5) {
          if (plantStalk(scan, rng)) placedStalk = true;
        }
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

    if (hasBoss) {
      var bt = bossTypeFor(depth);
      var by0 = bt === 'queen' ? QUEEN_HOVER_Y : GROUND_Y - ENEMY_DEFS[bt].h;
      var bx0 = exitX - 30;
      enemies.push(makeBoss(bx0, by0, bt, bossTierFor(depth)));

      // The oak's crown is only damageable from above, so give the arena a
      // climbable staircase of its own limbs. Without this the fight is
      // unwinnable rather than hard.
      if (bt === 'oak') {
        for (var ol = 0; ol < 3; ol++) {
          platforms.push({
            x: bx0 - 52 + ol * 20,
            y: GROUND_Y - (BRANCH_BASE + ol * BRANCH_STEP),
            w: 18, h: 5, branch: true
          });
        }
      }
    }
  }


  // Probe just past an enemy's leading foot for something to stand on.
  function groundAhead(e, dir) {
    var probeX = dir > 0 ? e.x + e.w + 1 : e.x - 1;
    var probeY = e.y + e.h + 2;
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (p.bale) continue;   // an obstacle, not footing - see solidAhead
      if (probeX >= p.x && probeX <= p.x + p.w && probeY >= p.y && probeY <= p.y + p.h) return true;
    }
    return false;
  }

  // Is there a solid obstacle immediately in front of this entity?
  function solidAhead(e, dir) {
    var probeX = dir > 0 ? e.x + e.w + 1 : e.x - 1;
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (!p.solid) continue;
      if (probeX < p.x || probeX > p.x + p.w) continue;
      if (e.y + e.h > p.y + 1 && e.y < p.y + p.h) return true;
    }
    return false;
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
    runRes = { corn: 0, bacon: 0, chicken: 0 };
    nextUpgradeScore = UPGRADE_SCORE_FIRST;
    upgradeStep = UPGRADE_STEP_BASE;
    runUpgrades = {};
    mods = freshMods();
    combineActive = false;
    barnBlockedMsgTimer = 0;
    meta.runs += 1;
    saveMeta();

    generateLevel();
    player = makePlayer();
    cameraX = 0;
    pitFallTimer = 0;
    snapshotStageEntry();

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

  function snapshotStageEntry() {
    stageEntryScore = runScore;
    stageEntryRes = { corn: runRes.corn, bacon: runRes.bacon, chicken: runRes.chicken };
    stageEntryUpgradeScore = nextUpgradeScore;
  }

  // Build the level for the current depth and put the farmer on its start line.
  // Shared by advancing a level and by restarting one after a pit fall, so the
  // two can't drift apart on which fields they remember to reset.
  function spawnIntoLevel() {
    // Dismount explicitly rather than via setForm(): clearing combineActive
    // first would make setForm's no-op guard skip the resize, stranding the
    // farmer with the combine's short, wide hitbox.
    snapshotStageEntry();
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
    player.stompGrace = 0;
    player.knockback = 0;
    player.slamArmed = false;
    // Belt and braces. updateGrounded recomputes this from the y position every
    // frame, so respawning on the start line clears it anyway; it is reset here
    // so the pit check can never see a stale true if that ever stops being true.
    player.fellOut = false;
    player.swimming = false;
    player.drownTimer = PLAYER_DROWN_TIME;
    slamFx = 0;
    state = 'playing';
  }

  // Falling into a pit costs a heart and puts you back at the start of the same
  // stage. The layout is seeded on depth, so regenerating rebuilds the field you
  // just fell out of rather than a new one.
  function restartStage() {
    // The stage's pickups and kills come back with it, so its score and
    // resources are rolled back too. Otherwise a deliberate dive would let you
    // harvest the same field twice over for the price of one heart.
    runScore = stageEntryScore;
    runRes = { corn: stageEntryRes.corn, bacon: stageEntryRes.bacon, chicken: stageEntryRes.chicken };
    nextUpgradeScore = stageEntryUpgradeScore;
    pitFallTimer = 1.4;
    spawnIntoLevel();
  }

  function nextLevel() {
    // A cleared field is a day's work: watered crops back home move on a stage.
    advanceCrops();
    depth += 1;
    if (depth > meta.bestDepth) { meta.bestDepth = depth; saveMeta(); }
    spawnIntoLevel();
  }

  function endRun(victorious) {
    // Escape with the harvest and you keep all of it. Die out there and the
    // crows get most of it - only a tenth makes it home.
    var haul = runRes.corn * RES_BANK_VALUE.corn +
      runRes.bacon * RES_BANK_VALUE.bacon +
      runRes.chicken * RES_BANK_VALUE.chicken;
    lastHaul = haul;
    lastBanked = victorious ? haul : Math.floor(haul * DEATH_CORN_KEPT);
    lastLost = haul - lastBanked;
    meta.bankedCorn += lastBanked;
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


  // ------------------------------------------------------------ farmstead --
  // A persistent top-down plot, unlocked by beating the scarecrow. Tiles are
  // worked with one context-sensitive action key; crops advance a stage each
  // time a level is cleared on a run, so the two halves of the game feed each
  // other. Harvested crops are carried, not auto-sold: you take them to the
  // market stall. The farmhouse door opens the skill tree.
  var FARM_KEY = 'tah-game-farm';
  var FARM_VERSION = 2;
  var FARM_COLS = 16, FARM_ROWS = 8, TILE = 16;
  var FARM_X0 = (320 - FARM_COLS * TILE) / 2;
  var FARM_Y0 = 34;
  var CROP_STAGES = 3;              // seedling -> growing -> ripe
  var CROP_VALUE = 14;              // corn per crop, paid at the stall
  var FARM_MOVE = 46;

  // Fixed structures. Their tiles can't be worked, and generation keeps them
  // clear so you can never be walled in by a rock on the doorstep.
  var HOUSE = { c: 1, r: 0, w: 3, h: 2, door: { c: 2, r: 1 } };
  var MARKET = { c: 12, r: 0, w: 3, h: 2, stall: { c: 13, r: 1 } };

  // tile: { t: 'grass'|'rock'|'tree'|'soil'|'built', wet, crop: -1|0..CROP_STAGES }
  var farm = null;
  var farmer = null;
  var farmHeld = 0;
  var farmToast = '', farmToastTimer = 0;

  function makeFarmTile(t) { return { t: t, wet: false, crop: -1 }; }

  function inRect(c, r, box) {
    return c >= box.c && c < box.c + box.w && r >= box.r && r < box.r + box.h;
  }

  function generateFarm() {
    var rng = makeRng(0xF00D);      // fixed layout so the plot feels like a place
    var grid = [];
    for (var r = 0; r < FARM_ROWS; r++) {
      var row = [];
      for (var c = 0; c < FARM_COLS; c++) {
        if (inRect(c, r, HOUSE) || inRect(c, r, MARKET)) {
          row.push(makeFarmTile('built'));
          continue;
        }
        var v = rng();
        row.push(makeFarmTile(v < 0.12 ? 'rock' : (v < 0.22 ? 'tree' : 'grass')));
      }
      grid.push(row);
    }
    // Keep the ground in front of both doorways walkable.
    [[HOUSE.door.c, HOUSE.door.r + 1], [MARKET.stall.c, MARKET.stall.r + 1]]
      .forEach(function (p) {
        if (p[1] < FARM_ROWS) grid[p[1]][p[0]] = makeFarmTile('grass');
      });
    return grid;
  }

  function loadFarm() {
    try {
      var raw = localStorage.getItem(FARM_KEY);
      if (!raw) return generateFarm();
      var parsed = JSON.parse(raw);
      // Older saves predate the buildings; regenerate rather than show a plot
      // with a house sitting on top of a boulder.
      if (!parsed || parsed.v !== FARM_VERSION || !Array.isArray(parsed.grid)) return generateFarm();
      if (parsed.grid.length !== FARM_ROWS) return generateFarm();
      for (var r = 0; r < FARM_ROWS; r++) {
        if (!Array.isArray(parsed.grid[r]) || parsed.grid[r].length !== FARM_COLS) return generateFarm();
      }
      return parsed.grid;
    } catch (err) {
      return generateFarm();
    }
  }

  function saveFarm() {
    try {
      localStorage.setItem(FARM_KEY, JSON.stringify({ v: FARM_VERSION, grid: farm }));
    } catch (err) { /* non-fatal */ }
  }

  // Called when a level is cleared: watered crops advance and dry out.
  function advanceCrops() {
    if (!farm) return;
    var grew = 0;
    for (var r = 0; r < FARM_ROWS; r++) {
      for (var c = 0; c < FARM_COLS; c++) {
        var t = farm[r][c];
        if (t.crop >= 0 && t.crop < CROP_STAGES && t.wet) {
          t.crop++;
          t.wet = false;
          grew++;
        }
      }
    }
    if (grew) saveFarm();
  }

  function enterFarm() {
    if (!farm) farm = loadFarm();
    farmer = {
      x: FARM_X0 + TILE * 5.5,
      y: FARM_Y0 + TILE * 4.5,
      facing: 1, dirX: 0, dirY: 1
    };
    farmToastTimer = 0;
    state = 'farm';
  }

  function farmToastMsg(msg) { farmToast = msg; farmToastTimer = 1.8; }

  function facedTile() {
    var cx = farmer.x + farmer.dirX * TILE * 0.7;
    var cy = farmer.y + farmer.dirY * TILE * 0.7;
    var c = Math.floor((cx - FARM_X0) / TILE);
    var r = Math.floor((cy - FARM_Y0) / TILE);
    if (c < 0 || c >= FARM_COLS || r < 0 || r >= FARM_ROWS) return null;
    return { r: r, c: c, tile: farm[r][c] };
  }

  function sellHeld() {
    if (farmHeld <= 0) {
      farmToastMsg('NOTHING TO SELL');
      return;
    }
    var paid = farmHeld * CROP_VALUE;
    meta.bankedCorn += paid;
    saveMeta();
    farmToastMsg('SOLD ' + farmHeld + ' FOR ' + paid + ' CORN');
    farmHeld = 0;
    audio.buy();
  }

  // One key does the sensible thing for whatever you're facing.
  function farmAction() {
    var f = facedTile();
    if (!f) return;
    var t = f.tile;

    // Buildings first - they're the two places that aren't soil.
    if (t.t === 'built') {
      if (f.c === MARKET.stall.c && f.r === MARKET.stall.r) { sellHeld(); return; }
      if (f.c === HOUSE.door.c && f.r === HOUSE.door.r) {
        treeIndex = 0;
        svenMode = false;
        state = 'hub';
        return;
      }
      farmToastMsg(inRect(f.c, f.r, MARKET) ? 'STALL IS ROUND THE FRONT' : 'DOOR IS ROUND THE FRONT');
      return;
    }

    if (t.t === 'rock') {
      t.t = 'grass';
      meta.bankedCorn += 2; saveMeta();
      farmToastMsg('CLEARED ROCK  +2 CORN');
      audio.hitEnemy();
    } else if (t.t === 'tree') {
      t.t = 'grass';
      meta.bankedCorn += 5; saveMeta();
      farmToastMsg('CHOPPED TREE  +5 CORN');
      audio.hitEnemy();
    } else if (t.t === 'grass') {
      t.t = 'soil';
      farmToastMsg('TILLED');
      audio.roll();
    } else if (t.t === 'soil' && t.crop < 0) {
      t.crop = 0;
      t.wet = false;
      farmToastMsg('PLANTED');
      audio.corn();
    } else if (t.crop >= CROP_STAGES) {
      t.crop = -1;
      t.wet = false;
      farmHeld += 1;
      farmToastMsg('HARVESTED  (' + farmHeld + ' TO SELL)');
      audio.corn();
    } else if (t.crop >= 0 && !t.wet) {
      t.wet = true;
      farmToastMsg('WATERED');
      audio.corn();
    } else {
      farmToastMsg('ALREADY WATERED');
      return;
    }
    saveFarm();
  }

  function updateFarm(dt) {
    if (farmToastTimer > 0) farmToastTimer -= dt;
    var mx = 0, my = 0;
    if (keys.KeyA) mx -= 1;
    if (keys.KeyD) mx += 1;
    if (keys.KeyW) my -= 1;
    if (keys.KeyS) my += 1;
    if (mx || my) {
      var len = Math.hypot(mx, my) || 1;
      farmer.x += (mx / len) * FARM_MOVE * dt;
      farmer.y += (my / len) * FARM_MOVE * dt;
      farmer.dirX = mx === 0 ? 0 : (mx > 0 ? 1 : -1);
      farmer.dirY = my === 0 ? 0 : (my > 0 ? 1 : -1);
      if (mx) farmer.facing = mx > 0 ? 1 : -1;
    }
    farmer.x = Math.max(FARM_X0 + 2, Math.min(FARM_X0 + FARM_COLS * TILE - 2, farmer.x));
    farmer.y = Math.max(FARM_Y0 + 2, Math.min(FARM_Y0 + FARM_ROWS * TILE - 2, farmer.y));
  }

  // --- farm rendering -------------------------------------------------------
  // Reuses the side-scroller's palette and idioms (sky gradient, rolling hills,
  // grass with a lit top edge and tufts, tile-seamed soil, black outlines) so
  // the two halves of the game look like the same farm.

  function drawFarmBackdrop() {
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, COLOR.skyTop);
    grad.addColorStop(1, COLOR.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = COLOR.sun;
    ctx.beginPath();
    ctx.arc(W - 40, 26, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLOR.cloud;
    [[54, 20, 15], [232, 15, 12]].forEach(function (cl) {
      ctx.beginPath();
      ctx.ellipse(cl[0], cl[1], cl[2], 5, 0, 0, Math.PI * 2);
      ctx.ellipse(cl[0] + 9, cl[1] - 3, cl[2] * 0.6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // Hills behind the plot, same silhouette treatment as the run.
    ctx.fillStyle = COLOR.hill;
    ctx.beginPath();
    ctx.moveTo(0, FARM_Y0 + 6);
    for (var x = 0; x <= W; x += 8) {
      ctx.lineTo(x, FARM_Y0 + 6 - 9 * Math.sin(x * 0.021) - 5 * Math.sin(x * 0.052 + 1));
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawFarmGrass(x, y) {
    ctx.fillStyle = COLOR.grass;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = COLOR.grassLight;
    ctx.fillRect(x, y, TILE, 1.25);
    ctx.strokeStyle = COLOR.grass;
    ctx.lineWidth = 0.75;
    for (var g = x + 3; g < x + TILE - 1; g += 5) {
      var tuft = 1.4 + ((g * 7) % 3) * 0.5;
      ctx.beginPath();
      ctx.moveTo(g + 0.5, y + TILE);
      ctx.lineTo(g + 0.5 + (((g * 13) % 2) ? 0.7 : -0.7), y + TILE - tuft);
      ctx.stroke();
    }
  }

  function drawFarmSoil(x, y, wet) {
    ctx.fillStyle = wet ? COLOR.soilWet : COLOR.soil;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = COLOR.soilSeam;
    ctx.lineWidth = 1;
    for (var fr = 1; fr < 4; fr++) {
      ctx.beginPath();
      ctx.moveTo(x + 1, y + fr * 4 + 0.5);
      ctx.lineTo(x + TILE - 1, y + fr * 4 + 0.5);
      ctx.stroke();
    }
  }

  function drawFarmHouse() {
    var x = FARM_X0 + HOUSE.c * TILE, y = FARM_Y0 + HOUSE.r * TILE;
    var w = HOUSE.w * TILE, h = HOUSE.h * TILE;

    ctx.fillStyle = COLOR.barnWall;
    ctx.fillRect(x, y + 10, w, h - 10);
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 10.5, w - 1, h - 11);

    ctx.strokeStyle = COLOR.barnTrim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 13.5);
    ctx.lineTo(x + w - 2, y + 13.5);
    ctx.stroke();

    ctx.fillStyle = COLOR.barnRoof;
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 11);
    ctx.lineTo(x + w / 2, y - 2);
    ctx.lineTo(x + w + 3, y + 11);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.stroke();

    // Door, on the front face, aligned with the interactable tile.
    var dx = FARM_X0 + HOUSE.door.c * TILE + TILE / 2;
    ctx.fillStyle = COLOR.barnDoor;
    ctx.fillRect(dx - 5, y + h - 13, 10, 13);
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(dx - 4.5, y + h - 12.5, 9, 12);
    ctx.fillStyle = COLOR.barnTrim;
    ctx.fillRect(dx + 2, y + h - 7, 1.4, 1.4);

    ctx.fillStyle = COLOR.siloBody;
    ctx.fillRect(x + 3, y + 14, 5, 5);
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(x + 3.5, y + 14.5, 4, 4);
  }

  function drawFarmMarket() {
    var x = FARM_X0 + MARKET.c * TILE, y = FARM_Y0 + MARKET.r * TILE;
    var w = MARKET.w * TILE, h = MARKET.h * TILE;

    ctx.fillStyle = COLOR.crate;
    ctx.fillRect(x + 2, y + 12, w - 4, h - 14);
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2.5, y + 12.5, w - 5, h - 15);
    ctx.strokeStyle = COLOR.crateDark;
    for (var k = x + 7; k < x + w - 4; k += 6) {
      ctx.beginPath();
      ctx.moveTo(k + 0.5, y + 12);
      ctx.lineTo(k + 0.5, y + h - 2);
      ctx.stroke();
    }

    // Striped awning, so it reads as a stall at a glance.
    var stripes = 6, sw = (w - 4) / stripes;
    for (var i2 = 0; i2 < stripes; i2++) {
      ctx.fillStyle = (i2 % 2) ? COLOR.barnWall : COLOR.barnTrim;
      ctx.fillRect(x + 2 + i2 * sw, y + 5, sw, 7);
    }
    ctx.strokeStyle = COLOR.outline;
    ctx.strokeRect(x + 2.5, y + 5.5, w - 5, 6);

    ctx.strokeStyle = COLOR.trunk;
    ctx.lineWidth = 1.4;
    [x + 4, x + w - 4].forEach(function (px) {
      ctx.beginPath();
      ctx.moveTo(px, y + 12);
      ctx.lineTo(px, y + h - 1);
      ctx.stroke();
    });

    // A cob on the counter.
    ctx.save();
    ctx.translate(FARM_X0 + MARKET.stall.c * TILE + TILE / 2, y + 16);
    ctx.scale(0.9, 0.9);
    drawCornEar();
    ctx.restore();
  }

  function drawFarm() {
    drawFarmBackdrop();

    ctx.textAlign = 'center';
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.title;
    ctx.fillText('THE HOMESTEAD', W / 2, 13);
    ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.hud;
    ctx.fillText('BANKED CORN ' + meta.bankedCorn + '     CARRYING ' + farmHeld, W / 2, 23);

    // Plot floor.
    for (var r = 0; r < FARM_ROWS; r++) {
      for (var c = 0; c < FARM_COLS; c++) {
        var t = farm[r][c];
        var x = FARM_X0 + c * TILE, y = FARM_Y0 + r * TILE;

        if (t.t === 'soil') drawFarmSoil(x, y, t.wet);
        else drawFarmGrass(x, y);

        ctx.strokeStyle = 'rgba(42,31,24,0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);

        if (t.t === 'rock') {
          ctx.fillStyle = COLOR.rock;
          ctx.beginPath();
          ctx.ellipse(x + TILE / 2, y + TILE / 2 + 1, 5.5, 4.2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = COLOR.outline;
          ctx.stroke();
          ctx.strokeStyle = COLOR.rockLight;
          ctx.beginPath();
          ctx.moveTo(x + TILE / 2 - 3, y + TILE / 2 - 1);
          ctx.lineTo(x + TILE / 2, y + TILE / 2 - 2.5);
          ctx.stroke();
        } else if (t.t === 'tree') {
          ctx.fillStyle = COLOR.trunk;
          ctx.fillRect(x + TILE / 2 - 1.5, y + TILE / 2 + 1, 3, 5);
          ctx.strokeStyle = COLOR.outline;
          ctx.strokeRect(x + TILE / 2 - 1, y + TILE / 2 + 1.5, 2, 4);
          ctx.fillStyle = COLOR.leaf;
          ctx.beginPath();
          ctx.arc(x + TILE / 2, y + TILE / 2 - 2, 5.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = COLOR.outline;
          ctx.stroke();
          ctx.fillStyle = COLOR.leafLight;
          ctx.beginPath();
          ctx.arc(x + TILE / 2 - 1.6, y + TILE / 2 - 3.4, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }

        if (t.crop >= 0) {
          var ccx = x + TILE / 2, ccy = y + TILE - 3;
          if (t.crop >= CROP_STAGES) {
            ctx.save();
            ctx.translate(ccx, ccy - 5);
            drawCornEar();
            ctx.restore();
          } else {
            var hgt = 3 + t.crop * 3;
            ctx.strokeStyle = COLOR.leaf;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(ccx, ccy);
            ctx.lineTo(ccx, ccy - hgt);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(ccx, ccy - hgt * 0.55);
            ctx.lineTo(ccx - 2.4, ccy - hgt * 0.85);
            ctx.moveTo(ccx, ccy - hgt * 0.55);
            ctx.lineTo(ccx + 2.4, ccy - hgt * 0.85);
            ctx.stroke();
          }
        }
      }
    }

    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(FARM_X0 + 0.5, FARM_Y0 + 0.5, FARM_COLS * TILE - 1, FARM_ROWS * TILE - 1);

    drawFarmHouse();
    drawFarmMarket();

    // Highlight the tile you're about to work.
    var f = facedTile();
    if (f) {
      ctx.strokeStyle = COLOR.cardSel;
      ctx.lineWidth = 1;
      ctx.strokeRect(FARM_X0 + f.c * TILE + 0.5, FARM_Y0 + f.r * TILE + 0.5, TILE - 1, TILE - 1);
    }

    // Top-down farmer, straw hat seen from above.
    ctx.save();
    ctx.translate(farmer.x, farmer.y);
    ctx.fillStyle = COLOR.player;
    ctx.beginPath();
    ctx.ellipse(0, 1, 3.4, 3.0, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = COLOR.straw;
    ctx.beginPath();
    ctx.ellipse(0, -1.4, 4.6, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.stroke();
    ctx.strokeStyle = COLOR.forkHandle;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, -1.4, 2.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLOR.skin;
    ctx.beginPath();
    ctx.arc(farmer.dirX * 1.7, -1.4 + farmer.dirY * 1.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
    if (farmToastTimer > 0) {
      ctx.fillStyle = COLOR.title;
      ctx.fillText(farmToast, W / 2, H - 13);
    }
    ctx.fillStyle = COLOR.dim;
    ctx.fillText('WASD MOVE   SPACE WORK/SELL/ENTER   ENTER LEAVE', W / 2, H - 4);
  }

  // ---------------------------------------------------------------- input --
  var keys = {};
  var TRACKED = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'ShiftLeft', 'ShiftRight',
    'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Enter', 'Escape'];
  var jumpQueued = false, attackQueued = false, rollQueued = false, formQueued = false;
  var dropQueued = false;

  window.addEventListener('keydown', function (e) {
    audio.unlock();
    if (TRACKED.indexOf(e.code) !== -1) e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;

    // Only queue actions while actually playing. Space doubles as the confirm
    // key on menus and in the homestead, so queueing it anywhere else left a
    // jump buffered that fired the instant a run started.
    if (state === 'playing') {
      if (e.code === 'KeyW') jumpQueued = true;
      if (e.code === 'KeyS') dropQueued = true;
      if (e.code === 'Space') attackQueued = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') rollQueued = true;
      if (e.code === 'KeyF') formQueued = true;
    }

    if (state === 'title') {
      if (e.code === 'KeyH') { treeIndex = 0; svenMode = false; state = 'hub'; }
      // Undocumented on purpose: F still jumps straight to the homestead for
      // testing, it's just no longer advertised on the title screen. Keep it.
      else if (e.code === 'KeyF') enterFarm();
      else startRun();
      return;
    }
    if (state === 'bossclear') {
      // Retire and the whole haul banks. Push on and you keep your upgrades
      // but the corn stays at risk.
      if (e.code === 'KeyB') endRun(true);
      else nextLevel();
      return;
    }
    if (state === 'dead' || state === 'victory') {
      if (e.code === 'KeyH') { treeIndex = 0; svenMode = false; state = 'hub'; }
      else if (e.code === 'KeyF' && state === 'victory') enterFarm();
      else startRun();
      return;
    }
    if (state === 'farm') {
      if (e.code === 'Space') farmAction();
      else if (e.code === 'Enter' || e.code === 'Escape') { saveFarm(); state = 'title'; }
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

  // Sven's corner. Deliberately unadvertised - the canvas is scaled, so the
  // click point is mapped back into logical space before hit-testing.
  canvas.addEventListener('click', function (ev) {
    if (state !== 'hub') return;
    var r = canvas.getBoundingClientRect();
    var lx = (ev.clientX - r.left) / r.width * LOGICAL_W;
    var ly = (ev.clientY - r.top) / r.height * LOGICAL_H;
    if (lx >= SVEN_HOTSPOT.x && lx <= SVEN_HOTSPOT.x + SVEN_HOTSPOT.w &&
      ly >= SVEN_HOTSPOT.y && ly <= SVEN_HOTSPOT.y + SVEN_HOTSPOT.h) {
      svenMode = !svenMode;
      audio.buy();
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
      var price = nodePrice(node);
      if (lvl < node.max && meta.bankedCorn >= price) {
        meta.bankedCorn -= price;
        meta.nodes[node.id] = lvl + 1;
        saveMeta();
        audio.buy();
      }
    } else if (code === 'Escape' || code === 'KeyH') {
      // Sven's discount lapses on the way out; you have to find him again.
      svenMode = false;
      state = 'title';
    }
  }

  // --------------------------------------------------------------- physics -
  // Push an entity back out of any solid obstacle it just walked into. Only
  // blocks when its body actually straddles the obstacle - if its feet are at
  // or above the top surface it's standing on it, not colliding with it.
  function resolveSolids(e, plats, prevX) {
    for (var i = 0; i < plats.length; i++) {
      var p = plats[i];
      if (!p.solid) continue;
      if (e.y + e.h <= p.y + 1) continue;
      if (e.y >= p.y + p.h) continue;
      if (e.x + e.w <= p.x || e.x >= p.x + p.w) continue;
      if (prevX + e.w <= p.x + 0.5) e.x = p.x - e.w;
      else if (prevX >= p.x + p.w - 0.5) e.x = p.x + p.w;
    }
  }

  // dir is the direction to send it: +1 right, -1 left.
  function applyKnockback(e, dir, mult) {
    var resist = KNOCKBACK_RESIST[e.type];
    var scale = (resist === undefined ? 1 : resist) * (mult === undefined ? 1 : mult);
    if (scale <= 0) return;
    e.vx = dir * KNOCKBACK_VX * scale;
    e.vy = KNOCKBACK_VY * scale;
    // Only the velocity carries the resist. Scaling the duration by it too meant
    // a heavy enemy was penalised twice and shifted a fraction of a pixel, so
    // the hit landed with no visible flinch at all.
    e.knockback = isBoss(e) ? BOSS_KNOCKBACK_TIME
                            : KNOCKBACK_TIME * (mult === undefined ? 1 : mult);
  }

  function updateGrounded(e, dt, plats, skipThin) {
    var prevBottom = e.y + e.h;
    var prevX = e.x;
    e.x += e.vx * dt;
    e.x = Math.max(0, Math.min(levelWidth - e.w, e.x));
    resolveSolids(e, plats, prevX);

    e.vy += GRAVITY * dt;
    if (e.vy > MAX_FALL_SPEED) e.vy = MAX_FALL_SPEED;
    e.y += e.vy * dt;

    e.onGround = false;
    if (e.vy >= 0) {
      for (var i = 0; i < plats.length; i++) {
        var p = plats[i];
        var newBottom = e.y + e.h;
        var horizOverlap = e.x + e.w > p.x && e.x < p.x + p.w;
        // Thin ledges are pass-through while dropping; solid ground never is,
        // so pressing down can't drop you out of the level.
        if (skipThin && p.h <= 10) continue;
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
    // Dropping into the combine mid-air arms a ground slam for the landing.
    if (toCombine && !player.onGround) player.slamArmed = true;
    if (!silent) audio.transform();
  }

  function doSlam() {
    slamFx = 0.42;
    audio.slam();
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      var dx = (e.x + e.w / 2) - (player.x + player.w / 2);
      var dy = (e.y + e.h / 2) - (player.y + player.h / 2);
      if (Math.hypot(dx, dy) > SLAM_RADIUS) continue;
      e.hp -= SLAM_DAMAGE;
      e.hitFlash = 0.16;
      // The slam is the heaviest hit in the game, so it throws hardest.
      applyKnockback(e, dx >= 0 ? 1 : -1, 1.4);
      if (e.hp <= 0) killEnemy(e);
    }
  }

  function updatePlayer(dt) {
    var plats = platforms;

    if (player.hitInvuln > 0) player.hitInvuln -= dt;
    if (player.attackCooldown > 0) player.attackCooldown -= dt;
    if (player.comboResetTimer > 0) {
      player.comboResetTimer -= dt;
      if (player.comboResetTimer <= 0) player.comboStep = 0;
    }
    if (player.rollCooldown > 0) player.rollCooldown -= dt;
    if (player.stompGrace > 0) player.stompGrace -= dt;

    if (formQueued) {
      if (mods.hasCombine) setForm(!combineActive);
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
    } else if (player.knockback > 0) {
      // Movement input is suspended so the hit actually shifts you. Without
      // this the next frame's vx assignment wiped the impulse and taking a hit
      // read as nothing but a flash.
      player.knockback -= dt;
      player.vx *= Math.max(0, 1 - KNOCKBACK_DRAG * dt);
      if (keys.KeyA) player.facing = -1;
      if (keys.KeyD) player.facing = 1;
    } else {
      var move = 0;
      if (keys.KeyA) { move -= 1; player.facing = -1; }
      if (keys.KeyD) { move += 1; player.facing = 1; }
      var baseSpeed = combineActive ? COMBINE_MOVE_SPEED : MOVE_SPEED;
      player.vx = move * baseSpeed * (player.swimming ? SWIM_SPEED_MUL : 1);
    }

    if (player.onGround) player.airJumpsLeft = mods.airJumps;

    // Tap down to fall through a floating ledge. The window is brief so you
    // clear the current ledge without sailing through the one below.
    if (dropQueued && player.onGround && player.rolling <= 0) player.dropThrough = 0.2;
    dropQueued = false;
    if (player.dropThrough > 0) player.dropThrough -= dt;

    if (jumpQueued && !combineActive && player.rolling <= 0) {
      if (player.onGround) {
        player.vy = JUMP_VELOCITY;
        player.onGround = false;
        player.jumpCut = false;
        audio.jump();
      } else if (player.swimming) {
        // Haul out of the water. Slightly weaker than a standing jump but
        // more than enough to clear the bank.
        player.vy = JUMP_VELOCITY * 0.92;
        player.swimming = false;
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

    updateGrounded(player, dt, plats, player.dropThrough > 0);

    if (player.onGround && player.slamArmed) {
      player.slamArmed = false;
      doSlam();
    }

    // Water is survivable but only briefly: you bob at the surface, can swim
    // sideways and jump out, and drown if you linger.
    var wspan = waterSpanAt(player.x + player.w / 2);
    var submerged = (player.y + player.h) > GROUND_Y;
    if (wspan && submerged) {
      player.swimming = true;
      player.onGround = false;
      player.airJumpsLeft = 0;
      var surfaceY = GROUND_Y - player.h + 4;
      // Only buoy up when not actively rising, so a jump can still carry out.
      if (player.vy >= 0) {
        player.vy = 0;
        player.y += (surfaceY - player.y) * Math.min(1, 9 * dt);
      }
      player.drownTimer -= dt;
      if (player.drownTimer <= 0) { startDrownSequence(); return; }
    } else if (player.swimming && submerged) {
      // Paddled clear of the stream's edge: haul up onto the bank. Without
      // this the farmer is below the slab top and drops through the level.
      player.y = GROUND_Y - player.h;
      player.vy = 0;
      player.onGround = true;
      player.swimming = false;
      player.drownTimer = PLAYER_DROWN_TIME;
    } else {
      player.swimming = false;
      player.drownTimer = PLAYER_DROWN_TIME;
    }

    // A pit costs a heart and sends you back to the stage's start line rather
    // than ending the run outright. Run out of hearts down there and that is
    // the run.
    if (player.fellOut) {
      player.hp -= 1;
      if (player.hp <= 0) {
        audio.playerDeath();
        endRun(false);
        return;
      }
      audio.hitPlayer();
      restartStage();
      return;
    }

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
        state = isBossDepth(depth) ? 'bossclear' : 'levelclear';
      }
    }
  }

  function isBossAlive() {
    for (var i = 0; i < enemies.length; i++) {
      if (isBoss(enemies[i]) && !enemies[i].dead) return true;
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
    roast: { w: 7, h: 5, corn: 2, score: 40 },
    health: { w: 5, h: 5, corn: 0, score: 10, heal: 1 }
  };
  var HEALTH_DROP_CHANCE = 0.22;
  var HEART_FULL_SCORE = 60;
  var DEATH_CORN_KEPT = 0.1;

  function spawnDrop(kind, cx, cy) {
    var def = DROP_DEFS[kind];
    drops.push({
      kind: kind, w: def.w, h: def.h,
      x: cx - def.w / 2, y: cy - def.h / 2,
      vx: (Math.random() - 0.5) * 55,
      vy: -30 - Math.random() * 40,
      landed: false,
      // Hearts stay upright so they read instantly as a pickup; meat tumbles.
      angle: kind === 'health' ? 0 : Math.random() * Math.PI * 2,
      spin: kind === 'health' ? 0 : (Math.random() - 0.5) * 7,
      wave: Math.random() * Math.PI * 2,
      bob: Math.random() * Math.PI * 2
    });
  }

  // Meat never expires and never leaves the map: anything that misses solid
  // ground is rescued onto the nearest slab rather than falling out of play.
  function updateDrops(dt) {
    var plats = platforms;
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];

      // Floating meat washes toward the nearer bank. Without this, an item
      // against the far side of a 30px gap sits 1px beyond an un-upgraded
      // fork's reach and can never be recovered.
      if (d.floating) {
        var wspan = waterSpanAt(d.x + d.w / 2);
        if (wspan) {
          var mid = d.x + d.w / 2;
          var toLeft = mid - wspan.x;
          var toRight = (wspan.x + wspan.w) - mid;
          var dir = toLeft <= toRight ? -1 : 1;
          d.x += dir * 8 * dt;
          d.x = Math.max(wspan.x - d.w * 0.5, Math.min(wspan.x + wspan.w - d.w * 0.5, d.x));
        }
      }

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
              d.floating = false;
              d.hooked = false;
              d.angle = 0;
              break;
            }
          }
        }
        if (!d.landed) {
          // Meat that hits a stream floats on the surface instead of being
          // relocated - it's still retrievable, just only with the pitchfork
          // (or by bridging the gap with the combine).
          var span = waterSpanAt(d.x + d.w / 2);
          if (span && d.y + d.h >= GROUND_Y) {
            d.landed = true;
            d.floating = true;
            d.vx = 0; d.vy = 0; d.angle = 0;
            d.y = GROUND_Y - d.h + 1;
          } else if (d.y > H + 4) {
            // Down a dry hole and gone for good - losing the drop is the
            // cost of killing something over a pit.
            d.taken = true;
          }
        }
      }

      if (aabbOverlap(player.x, player.y, player.w, player.h, d.x, d.y, d.w, d.h)) {
        var def = DROP_DEFS[d.kind];
        if (def.heal) {
          if (player.hp >= mods.maxHp) {
            // Already topped up, so the heart cashes out as points instead of
            // being wasted.
            addScore(HEART_FULL_SCORE);
            runCorn += 1;
            audio.corn();
          } else {
            player.hp = Math.min(mods.maxHp, player.hp + def.heal);
            addScore(def.score);
            audio.heal();
          }
        } else {
          // Bacon and chicken are their own resources, one per pickup.
          if (d.kind === 'bacon') runRes.bacon += 1;
          else if (d.kind === 'roast') runRes.chicken += 1;
          runCorn += def.corn;
          addScore(def.score);
          audio.corn();
        }
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
    if (e.type === 'larva') {
      emitParticles('feather', 4, cx, cy);
      return;
    }
    if (e.type === 'vulture') {
      emitParticles('feather', 14, cx, cy);
      spawnDrop('roast', cx, cy);
      spawnDrop('roast', cx, cy);
    } else if (e.type === 'crow' || e.type === 'fly') {
      // Poof of black feathers, and the bird itself comes out oven-ready.
      emitParticles('feather', 8, cx, cy);
      spawnDrop('roast', cx, cy);
    } else if (isBoss(e)) {
      emitParticles('straw', 14, cx, cy);
    } else {
      for (var b = 0; b < 3; b++) spawnDrop('bacon', cx, cy);
    }

    // Animals occasionally leave something restorative behind.
    if (!isBoss(e) && Math.random() < HEALTH_DROP_CHANCE) {
      spawnDrop('health', cx, cy);
    }
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    // Score is the kill reward; corn now comes from collecting the meat it
    // drops, so the two aren't paid out twice. The boss drops straw, not meat,
    // so it still pays its corn directly.
    if (e.type === 'crow' || e.type === 'fly') addScore(SCORE_CROW);
    else if (e.type === 'larva') addScore(15);
    else if (e.type === 'vulture') addScore(SCORE_VULTURE);
    else if (isBoss(e)) { addScore(SCORE_BOSS); runCorn += 20; }
    else addScore(SCORE_BOAR);
    spawnDeathEffect(e);
    audio.death(e.type === 'crow' || e.type === 'vulture' ? 'feather' : isBoss(e) ? 'straw' : 'bacon');
  }

  function resolveAttack() {
    if (player.attackTimer <= 0) return;
    var reach = mods.attackRange;
    var boxX = player.facing > 0 ? player.x + player.w : player.x - reach;
    // Tall enough to match the overhead arc, so the swing connects with
    // anything it visibly passes through - including birds above your head.
    var boxY = player.y - 11, boxW = reach, boxH = player.h + 15;
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      if (e.dead || player.hitThisSwing[e.id]) continue;
      if (aabbOverlap(boxX, boxY, boxW, boxH, e.x, e.y, e.w, e.h)) {
        player.hitThisSwing[e.id] = true;

        // The queen shrugs off hits while she's up out of reach; the oak only
        // takes damage at the crown, which is why you climb it.
        if (e.type === 'queen' && e.mode !== 'lay') {
          e.hitFlash = 0.1;
          continue;
        }
        if (e.type === 'oak' && (player.y + player.h) > e.y + 22) {
          e.hitFlash = 0.1;
          continue;
        }

        // Catching a bird from directly underneath skewers it outright - the
        // tines go straight up into it and there's nowhere for it to go.
        var isBird = e.type === 'crow' || e.type === 'fly' || e.type === 'vulture';
        if (isBird && (e.y + e.h) <= player.y + 2) {
          e.hitFlash = 0.12;
          audio.skewer();
          killEnemy(e);
          continue;
        }

        e.hp -= 1;
        applyKnockback(e, player.facing);
        e.hitFlash = 0.12;
        audio.hitEnemy();
        if (e.hp <= 0) killEnemy(e);
      }
    }
  }

  // Swinging the fork hooks loose items in range and flings them back at the
  // farmer, which is the only way to land anything floating in a stream.
  function retrieveDrops() {
    if (player.attackTimer <= 0 || combineActive) return;
    var reach = mods.attackRange;
    var boxX = player.facing > 0 ? player.x + player.w : player.x - reach;
    var boxY = player.y - 6, boxW = reach, boxH = player.h + 14;
    var px = player.x + player.w / 2, py = player.y + player.h / 2;

    // Anything edible in the arc comes to you - a cob wedged against a bale
    // is otherwise unreachable now that bales are solid.
    for (var ci = 0; ci < corns.length; ci++) {
      var cc = corns[ci];
      if (cc.collected) continue;
      if (!aabbOverlap(boxX, boxY, boxW, boxH, cc.x, cc.y, cc.w, cc.h)) continue;
      if (collectCorn(cc)) return;
    }

    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      if (d.hooked) continue;
      if (!aabbOverlap(boxX, boxY, boxW, boxH, d.x, d.y, d.w, d.h)) continue;

      var dx = px - (d.x + d.w / 2), dy = py - (d.y + d.h / 2);
      var dist = Math.hypot(dx, dy) || 1;
      d.vx = (dx / dist) * 100;
      d.vy = (dy / dist) * 100 - 30;
      d.landed = false;
      d.floating = false;
      d.hooked = true;
      d.spin = (Math.random() - 0.5) * 8;
    }
  }

  // Returns true if picking this up opened the upgrade screen, so callers can
  // stop iterating.
  function collectCorn(c) {
    c.collected = true;
    var isApple = c.kind === 'apple';
    runRes.corn += 1;
    runCorn += isApple ? APPLE_CORN : mods.cornValue;
    addScore(isApple ? APPLE_SCORE : SCORE_CORN);
    audio.corn();
    return maybeOfferUpgrade();
  }

  // One place decides when a card is earned, so kills and pickups both count
  // toward it and the threshold can't drift between callers.
  function maybeOfferUpgrade() {
    if (runScore < nextUpgradeScore) return false;
    nextUpgradeScore += upgradeStep;
    upgradeStep += UPGRADE_STEP_GROWTH;
    return offerUpgrade();
  }

  function checkCorn() {
    for (var i = 0; i < corns.length; i++) {
      var c = corns[i];
      if (c.collected) continue;
      if (!aabbOverlap(player.x, player.y, player.w, player.h, c.x, c.y, c.w, c.h)) continue;
      if (collectCorn(c)) return;
    }
  }

  function checkEnemyContact() {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      if (!aabbOverlap(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) continue;

      // The oak's body is bark: only its sweeping limb hurts, handled below.
      if (e.type === 'oak') {
        var limbLive = e.sweepState === 'sweep';
        var limbY = GROUND_Y - 10;
        var limbX = e.x - 46;
        if (limbLive && player.hitInvuln <= 0 && player.rolling <= 0 &&
          aabbOverlap(limbX, limbY, 46, 10, player.x, player.y, player.w, player.h)) {
          player.hp -= 1;
          player.hitInvuln = PLAYER_HIT_INVULN;
          audio.hitPlayer();
        }
        continue;
      }

      // The combine flattens ordinary critters, but the boss can still hurt
      // it - otherwise the fight would be riskless once you have the keys.
      if (combineActive && !isBoss(e)) {
        // A crow diving onto the roof is above the header and gets through;
        // anything that meets the front of the machine is flattened.
        var overTheTop = (e.type === 'crow' || e.type === 'fly') && (e.y + e.h) < player.y + player.h * 0.45;
        if (!overTheTop) {
          killEnemy(e);
          continue;
        }
        if (player.hitInvuln <= 0 && player.rolling <= 0) {
          player.hp -= 1;
          player.hitInvuln = PLAYER_HIT_INVULN;
          audio.hitPlayer();
        }
        continue;
      }
      // Stomp: coming down on an enemy's head deals a hit and bounces you off
      // instead of costing health. One damage per stomp, so with their existing
      // health that's two stomps for a boar and one for a crow. The boss is too
      // big to vault off.
      if (!combineActive && player.vy > 0 && !isBoss(e) && e.type !== 'vulture' &&
        (player.y + player.h) < e.y + e.h * 0.85) {
        e.hp -= 1;
        e.hitFlash = 0.12;
        // A stomp shoves it aside as well as down, away from where you land.
        applyKnockback(e, (e.x + e.w / 2) < (player.x + player.w / 2) ? -1 : 1, 0.7);
        player.vy = JUMP_VELOCITY * 0.62;
        player.jumpCut = true;
        // The bounce leaves you still overlapping but now moving upward, which
        // failed the vy>0 test and charged you a heart for a clean stomp. A
        // brief grace covers the frames it takes to clear the body.
        player.stompGrace = STOMP_GRACE;
        audio.hitEnemy();
        if (e.hp <= 0) killEnemy(e);
        continue;
      }

      if (player.hitInvuln > 0 || player.rolling > 0 || player.stompGrace > 0) continue;
      player.hp -= 1;
      player.hitInvuln = PLAYER_HIT_INVULN;
      if (!combineActive) {
        player.vx = (player.x < e.x ? -1 : 1) * PLAYER_KNOCKBACK_VX;
        player.vy = PLAYER_KNOCKBACK_VY;
        player.knockback = PLAYER_KNOCKBACK_TIME;
      }
      audio.hitPlayer();
      if (e.type === 'boar') e.pauseTimer = 0.5;
      break;
    }
  }

  function updateEnemy(e, dt) {
    var def = ENEMY_DEFS[e.type];
    var plats = platforms;
    if (e.hitFlash > 0) e.hitFlash -= dt;

    // Knockback pre-empts the AI entirely. Routing every type through one gate
    // here rather than teaching each chase branch to respect it means a new
    // enemy can't quietly ship without knockback working.
    if (e.knockback > 0) {
      e.knockback -= dt;
      e.vx *= Math.max(0, 1 - KNOCKBACK_DRAG * dt);
      var flier = e.type === 'crow' || e.type === 'fly' ||
                  e.type === 'vulture' || e.type === 'queen';
      if (flier) {
        // Fliers coast instead of falling, so a struck crow is batted back
        // through the air rather than dropping like a stone.
        e.vy *= Math.max(0, 1 - KNOCKBACK_DRAG * dt);
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.x = Math.max(0, Math.min(levelWidth - e.w, e.x));
      } else {
        updateGrounded(e, dt, plats);
      }
      return;
    }

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
        } else {
          // Anything up a tree is out of sight and out of mind - a boar only
          // reacts to a player on its own level.

          if (!e.patrolDir) e.patrolDir = 1;
          if (Math.abs(e.x - e.spawnX) > 25) e.patrolDir = e.x > e.spawnX ? -1 : 1;
          // Turn around at a ledge. Only an active charge commits past the
          // edge, so a boar only drowns itself if you bait it across.
          if (e.onGround && (!groundAhead(e, e.patrolDir) || solidAhead(e, e.patrolDir))) {
            e.patrolDir *= -1;
          }
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
    } else if (e.type === 'crow' || e.type === 'fly') {
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
    } else if (e.type === 'vulture') {
      e.phase += dt * 2.2;
      if (e.hitFlash > 0) {
        // Knocked back, then it recovers to the perch.
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vx *= Math.max(0, 1 - 3 * dt);
        e.vy *= Math.max(0, 1 - 3 * dt);
        e.mode = 'return';
      } else if (e.mode === 'perch') {
        // Hunched over the fruit, shuffling, until something climbs near.
        e.x += Math.sin(e.phase) * 4 * dt;
        e.y = e.perchY + Math.sin(e.phase * 0.8) * 1.5;
        if (e.modeTimer > 0) e.modeTimer -= dt;
        var pdx = (player.x + player.w / 2) - (e.x + e.w / 2);
        var pdy = (player.y + player.h / 2) - (e.y + e.h / 2);
        e.facing = pdx > 0 ? 1 : -1;
        if (e.modeTimer <= 0 && Math.hypot(pdx, pdy) < def.detect) {
          e.mode = 'alert';
          e.modeTimer = VULTURE_TELEGRAPH;
          audio.vultureCry();
        }
      } else if (e.mode === 'alert') {
        // Rears up before committing, so the swoop can be read and dodged.
        e.modeTimer -= dt;
        e.y = e.perchY - 3 + Math.sin(time * 30) * 0.8;
        var adx = (player.x + player.w / 2) - (e.x + e.w / 2);
        e.facing = adx > 0 ? 1 : -1;
        if (e.modeTimer <= 0) {
          // Lock the swoop vector once, at launch. Re-aiming every frame made
          // it impossible to sidestep.
          var lx = (player.x + player.w / 2) - (e.x + e.w / 2);
          var ly = (player.y + player.h / 2) - (e.y + e.h / 2);
          var ld = Math.hypot(lx, ly) || 1;
          e.diveVx = (lx / ld) * def.diveSpeed;
          e.diveVy = (ly / ld) * def.diveSpeed;
          e.mode = 'dive';
          e.modeTimer = VULTURE_DIVE_TIME;
        }
      } else if (e.mode === 'dive') {
        e.modeTimer -= dt;
        e.x += e.diveVx * dt;
        e.y += e.diveVy * dt;
        e.facing = e.diveVx > 0 ? 1 : -1;
        if (e.modeTimer <= 0 || e.y + e.h >= GROUND_Y - 1) e.mode = 'return';
      } else {
        var rdx = e.perchX - e.x, rdy = e.perchY - e.y;
        var rd = Math.hypot(rdx, rdy) || 1;
        e.facing = rdx > 0 ? 1 : -1;
        if (rd < 2) {
          e.mode = 'perch';
          e.modeTimer = VULTURE_COOLDOWN;
        } else {
          e.x += (rdx / rd) * def.speed * 1.8 * dt;
          e.y += (rdy / rd) * def.speed * 1.8 * dt;
        }
      }
      e.x = Math.max(0, Math.min(levelWidth - e.w, e.x));
      e.y = Math.max(4, Math.min(GROUND_Y - e.h, e.y));
    } else if (e.type === 'bull') {
      e.phase += dt * 6;
      if (e.mode === 'paw') {
        // Pawing the ground, facing the player. This is the tell.
        e.vx = 0;
        e.facing = (player.x + player.w / 2) > (e.x + e.w / 2) ? 1 : -1;
        e.modeTimer -= dt;
        if (e.modeTimer <= 0) {
          e.chargeDir = e.facing;
          e.mode = 'charge';
          e.modeTimer = BULL_CHARGE_MAX;
          audio.bullSnort();
        }
      } else if (e.mode === 'charge') {
        e.modeTimer -= dt;
        e.facing = e.chargeDir;
        e.vx = e.chargeDir * def.chargeSpeed;
        // Running out of arena, or out of ground, ends the charge in a recoil.
        var atEdge = (e.chargeDir < 0 && e.x <= 2) ||
          (e.chargeDir > 0 && e.x + e.w >= levelWidth - 2) ||
          !groundAhead(e, e.chargeDir);
        if (atEdge || e.modeTimer <= 0) {
          e.mode = 'recoil';
          e.modeTimer = BULL_RECOVER_TIME;
          e.vx = -e.chargeDir * 40;
          if (atEdge) {
            slamFx = 0.4;
            audio.slam();
          }
        }
      } else {
        // Shaking it off, then straight back to pawing for the next run.
        e.modeTimer -= dt;
        e.vx *= Math.max(0, 1 - 5 * dt);
        if (e.modeTimer <= 0) {
          e.mode = 'paw';
          e.modeTimer = BULL_PAW_TIME;
        }
      }
      updateGrounded(e, dt, plats);
    } else if (e.type === 'larva') {
      // Squirms slowly, turns at edges, and hatches on a timer. Killing it
      // before it matures is the whole point of clearing adds fast.
      e.phase += dt * 7;
      if (!e.patrolDir) e.patrolDir = 1;
      if (e.onGround && (!groundAhead(e, e.patrolDir) || solidAhead(e, e.patrolDir))) {
        e.patrolDir *= -1;
      }
      e.facing = e.patrolDir;
      // Inch along rather than walk - speed pulses with the squirm.
      e.vx = e.patrolDir * def.speed * (0.55 + 0.45 * Math.abs(Math.sin(e.phase)));
      updateGrounded(e, dt, plats);
      if (e.fellOut) e.dead = true;

      e.matureTimer -= dt;
      if (e.matureTimer <= 0 && !e.dead) {
        // Hatch: same slot, now a fly with crow stats.
        var fly = makeEnemy('fly', e.x, e.y - 6);
        fly.bossSpawned = e.bossSpawned;
        fly.spawnX = e.x;
        fly.spawnY = e.y - 6;
        enemies.push(fly);
        emitParticles('feather', 3, e.x + e.w / 2, e.y + e.h / 2);
        e.dead = true;
        audio.hitEnemy();
      }
    } else if (e.type === 'rustbucket') {
      // Grinds back and forth along the ground, reversing at edges. Every so
      // often it belches chaff that lingers as a hazard, so standing on the
      // ground near it is a bad idea.
      e.phase += dt * 8;
      if (!e.patrolDir) e.patrolDir = -1;
      if (!groundAhead(e, e.patrolDir) || e.x <= 2 || e.x + e.w >= levelWidth - 2) {
        e.patrolDir *= -1;
      }
      e.facing = e.patrolDir;
      e.vx = e.patrolDir * def.speed;
      e.chaffTimer = (e.chaffTimer || CHAFF_INTERVAL) - dt;
      if (e.chaffTimer <= 0) {
        e.chaffTimer = CHAFF_INTERVAL;
        var backX = e.x + (e.facing > 0 ? 0 : e.w);
        for (var ch = 0; ch < 7; ch++) {
          particles.push({
            x: backX, y: e.y + 4 + Math.random() * 8,
            vx: -e.facing * (18 + Math.random() * 26), vy: -14 - Math.random() * 18,
            life: 1.2, maxLife: 1.2, kind: 'straw',
            angle: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 8, wave: 0
          });
        }
        audio.slam();
      }
      updateGrounded(e, dt, plats);
    } else if (e.type === 'queen') {
      // Hovers above melee reach spilling crows, then sinks to lay - the only
      // window where she can be hit.
      e.phase += dt * 3;
      if (!e.mode) { e.mode = 'hover'; e.modeTimer = QUEEN_LAY_INTERVAL; }
      var tgtX = player.x + player.w / 2 - e.w / 2;
      e.facing = (player.x + player.w / 2) > (e.x + e.w / 2) ? 1 : -1;

      if (e.mode === 'hover') {
        e.x += Math.max(-1, Math.min(1, (tgtX - e.x) * 0.02)) * def.speed * dt * 2;
        e.y = QUEEN_HOVER_Y + Math.sin(e.phase) * 4;
        e.modeTimer -= dt;
        if (e.modeTimer <= 0) { e.mode = 'lay'; e.modeTimer = 1.6; audio.vultureCry(); }
      } else {
        // Sinking to ground height, vulnerable, dropping a clutch of grubs on
        // the way down, then climbing back out.
        e.modeTimer -= dt;
        var layY = GROUND_Y - e.h - 4;
        e.y += (layY - e.y) * Math.min(1, 4 * dt);
        if (!e.laid && e.y > layY - 12) {
          e.laid = true;
          var alive2 = 0;
          for (var q = 0; q < enemies.length; q++) {
            if (enemies[q].bossSpawned && !enemies[q].dead) alive2++;
          }
          var clutch = Math.min(3, BOSS_CROW_CONCURRENT_CAP - alive2);
          for (var lv = 0; lv < clutch && e.crowSpawnCount < BOSS_CROW_CAP; lv++) {
            var lg = makeEnemy('larva', e.x + e.w / 2 + (lv - 1) * 9, GROUND_Y - ENEMY_DEFS.larva.h);
            lg.bossSpawned = true;
            lg.matureTimer = LARVA_MATURE_TIME;
            lg.patrolDir = lv % 2 ? 1 : -1;
            enemies.push(lg);
            e.crowSpawnCount++;
          }
        }
        if (e.modeTimer <= 0) {
          e.mode = 'hover';
          e.modeTimer = QUEEN_LAY_INTERVAL;
          e.laid = false;
        }
      }
      e.x = Math.max(0, Math.min(levelWidth - e.w, e.x));
    } else if (e.type === 'oak') {
      // Rooted. Sweeps a limb along the ground on a timer; the crown is the
      // only thing worth hitting, so you climb rather than trade blows.
      e.phase += dt * 2;
      e.facing = -1;
      e.sweepTimer = (e.sweepTimer || OAK_SWEEP_INTERVAL) - dt;
      if (e.sweepState === 'sweep') {
        e.sweepTimer -= dt;
        if (e.sweepTimer <= -0.55) { e.sweepState = 'idle'; e.sweepTimer = OAK_SWEEP_INTERVAL; }
      } else if (e.sweepTimer <= 0) {
        e.sweepState = 'sweep';
        e.sweepTimer = 0;
        audio.bossSwing();
      }
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

    if (state === 'farm') { updateFarm(dt); return; }
    if (state === 'drowning') { updateDrownSeq(dt); return; }

    if (state !== 'playing') {
      // Ambient drift belongs to the title screen only. Running it during the
      // upgrade draft and the end panels rewrote a chasing crow's y back to
      // spawnY, so it appeared to teleport away from the player. Everything
      // else freezes while a menu is up.
      if (state === 'title') {
        for (var i = 0; i < enemies.length; i++) {
          var e = enemies[i];
          if ((e.type === 'crow' || e.type === 'fly') && !e.dead) {
            e.phase += dt * 3;
            e.y = e.spawnY + Math.sin(e.phase) * 6;
          }
        }
      }
      return;
    }

    if (barnBlockedMsgTimer > 0) barnBlockedMsgTimer -= dt;
    if (pitFallTimer > 0) pitFallTimer -= dt;
    if (slamFx > 0) slamFx -= dt;

    updatePlayer(dt);
    if (state !== 'playing') return;

    resolveAttack();
    retrieveDrops();
    checkCorn();
    if (state !== 'playing') return;

    for (var j = 0; j < enemies.length; j++) updateEnemy(enemies[j], dt);
    enemies = enemies.filter(function (en) { return !en.dead; });
    // Kills feed the same score gate the pickups do.
    if (maybeOfferUpgrade()) return;
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

  // Ripple entirely below the bank. Centring the sine on GROUND_Y put the
  // crests above the adjacent ground, so the stream looked like it was standing
  // proud of its own banks. Offset by the amplitude plus half the stroke width
  // so even the topmost pixel stays under the surface line.
  var WATER_AMP = 1.1;
  function waterSurfaceY(x) {
    return GROUND_Y + WATER_AMP + 0.6 + Math.sin((x + time * 40) * 0.4) * WATER_AMP;
  }

  function drawWater() {
    for (var i = 0; i < waters.length; i++) {
      var wtr = waters[i];
      var y = GROUND_Y;
      var grad = ctx.createLinearGradient(0, y, 0, H);
      grad.addColorStop(0, COLOR.waterTop);
      grad.addColorStop(1, COLOR.waterDeep);

      // Fill down from the wave itself, not from the bank. Filling the whole
      // rect from GROUND_Y left a blue band standing above the crest, which
      // read as the water sitting on top of its own surface line.
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(wtr.x, waterSurfaceY(wtr.x));
      for (var fx = wtr.x; fx <= wtr.x + wtr.w; fx += 2) {
        ctx.lineTo(fx, waterSurfaceY(fx));
      }
      ctx.lineTo(wtr.x + wtr.w, waterSurfaceY(wtr.x + wtr.w));
      ctx.lineTo(wtr.x + wtr.w, H);
      ctx.lineTo(wtr.x, H);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = COLOR.waterSurface;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var x = wtr.x; x <= wtr.x + wtr.w; x += 2) {
        var wy = waterSurfaceY(x);
        if (x === wtr.x) ctx.moveTo(x, wy);
        else ctx.lineTo(x, wy);
      }
      ctx.stroke();

      // No outline around the water - the hard black box read as a tile
      // rather than a stream. The banks either side already frame it.
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





  function drawBale(p) {
    var cx = p.x + p.w / 2;
    var cy = GROUND_Y - BALE_H / 2 - 0.5;
    var rx = p.w / 2, ry = BALE_H / 2;

    ctx.fillStyle = COLOR.hay;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Concentric banding reads as rolled hay rather than a boulder.
    ctx.strokeStyle = COLOR.hayDark;
    ctx.lineWidth = 0.7;
    for (var b = 1; b <= 2; b++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * (1 - b * 0.28), ry * (1 - b * 0.28), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Loose straw catching the light along the top.
    ctx.strokeStyle = COLOR.hayLight;
    ctx.lineWidth = 0.6;
    for (var t = -2; t <= 2; t++) {
      var a = -Math.PI / 2 + t * 0.36;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rx * 0.72, cy + Math.sin(a) * ry * 0.72);
      ctx.lineTo(cx + Math.cos(a) * rx * 1.02, cy + Math.sin(a) * ry * 1.02);
      ctx.stroke();
    }
  }

  function drawBranch(p) {
    ctx.fillStyle = COLOR.trunk;
    ctx.fillRect(p.x, p.y, p.w, 4);
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, 3);
    ctx.strokeStyle = COLOR.trunkDark;
    ctx.lineWidth = 0.5;
    for (var k = p.x + 3; k < p.x + p.w - 2; k += 5) {
      ctx.beginPath();
      ctx.moveTo(k, p.y + 1.2);
      ctx.lineTo(k + 2, p.y + 2.8);
      ctx.stroke();
    }
    ctx.fillStyle = COLOR.leaf;
    for (var lf = p.x + 2; lf < p.x + p.w; lf += 5) {
      ctx.beginPath();
      ctx.ellipse(lf, p.y - 1.2, 2.3, 1.4, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }


  // Corn stalks: a leaning stem with drooping blade leaves and a tassel on
  // top. Drawn behind the pickups so the cob reads clearly against it.
  function drawStalks() {
    for (var i = 0; i < stalks.length; i++) {
      var st = stalks[i];
      var sway = Math.sin(time * 1.4 + st.x * 0.3) * 0.8;
      var topX = st.x + st.lean * st.h + sway;
      var topY = GROUND_Y - st.h;

      // Stem.
      ctx.strokeStyle = COLOR.stalk;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(st.x, GROUND_Y);
      ctx.quadraticCurveTo(st.x + st.lean * st.h * 0.4, GROUND_Y - st.h * 0.55, topX, topY);
      ctx.stroke();
      ctx.strokeStyle = COLOR.stalkDark;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(st.x + 0.5, GROUND_Y - 2);
      ctx.quadraticCurveTo(st.x + st.lean * st.h * 0.4 + 0.5, GROUND_Y - st.h * 0.55, topX + 0.4, topY + 2);
      ctx.stroke();

      // Shank: the short stub that carries the cob out to whichever side it
      // was planted on. Without it a tilted cob floats beside the stem.
      if (st.side) {
        var kt = Math.max(0, Math.min(1, (GROUND_Y - st.shankY) / st.h));
        var iv = 1 - kt;
        var kx = iv * iv * st.x
               + 2 * iv * kt * (st.x + st.lean * st.h * 0.4)
               + kt * kt * topX;
        ctx.strokeStyle = COLOR.stalkLeaf;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(kx, st.shankY + 1.5);
        ctx.quadraticCurveTo(kx + st.side * 1.6, st.shankY + 0.2,
                             kx + st.side * 3, st.shankY);
        ctx.stroke();
      }

      // Blade leaves arcing off alternating sides.
      for (var lf = 0; lf < 4; lf++) {
        var t = 0.22 + lf * 0.2;
        var ly = GROUND_Y - st.h * t;
        var lx = st.x + st.lean * st.h * t * 0.6;
        var dir = lf % 2 === 0 ? 1 : -1;
        var len = 7 - lf * 0.9;
        ctx.fillStyle = lf % 2 === 0 ? COLOR.stalkLeaf : COLOR.stalkLeafDark;
        ctx.beginPath();
        ctx.moveTo(lx, ly + 1.2);
        ctx.quadraticCurveTo(lx + dir * len * 0.7, ly - 2.4, lx + dir * len, ly + 1.6);
        ctx.quadraticCurveTo(lx + dir * len * 0.6, ly + 0.9, lx, ly + 1.2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = COLOR.outline;
        ctx.lineWidth = 0.3;
        ctx.stroke();
      }

      // Tassel.
      ctx.strokeStyle = COLOR.cornSilk;
      ctx.lineWidth = 0.6;
      for (var ts = -1; ts <= 1; ts++) {
        ctx.beginPath();
        ctx.moveTo(topX, topY + 1);
        ctx.quadraticCurveTo(topX + ts * 1.6, topY - 2, topX + ts * 2.4, topY - 3.6);
        ctx.stroke();
      }
    }
  }

  function drawTrees() {
    for (var i = 0; i < trees.length; i++) {
      var t = trees[i];
      var baseW = 7, topW = 3;
      var span = GROUND_Y - t.topY;

      // Tapered trunk with a root flare, so it reads as a tree not a post.
      ctx.beginPath();
      ctx.moveTo(t.x - baseW / 2 - 2, GROUND_Y);
      ctx.quadraticCurveTo(t.x - baseW / 2, GROUND_Y - span * 0.35, t.x - topW / 2, t.topY - 4);
      ctx.lineTo(t.x + topW / 2, t.topY - 4);
      ctx.quadraticCurveTo(t.x + baseW / 2, GROUND_Y - span * 0.35, t.x + baseW / 2 + 2, GROUND_Y);
      ctx.closePath();
      ctx.fillStyle = COLOR.trunk;
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = COLOR.trunkDark;
      ctx.lineWidth = 0.6;
      for (var g = t.topY + 6; g < GROUND_Y - 4; g += 8) {
        ctx.beginPath();
        ctx.moveTo(t.x - 1.6, g);
        ctx.lineTo(t.x + 0.4, g + 2.5);
        ctx.stroke();
      }

      // Limbs joining trunk to each branch tier.
      ctx.strokeStyle = COLOR.trunk;
      ctx.lineWidth = 2.4;
      for (var ti = 0; ti < t.tiers; ti++) {
        var by = GROUND_Y - (BRANCH_BASE + ti * BRANCH_STEP);
        var side = (ti % 2 === 0) ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(t.x, by + 5);
        ctx.quadraticCurveTo(t.x + side * 4, by + 3, t.x + side * 6, by + 2);
        ctx.stroke();
      }

      // Canopy: overlapping clusters rather than one blob.
      var cy = t.topY - 6;
      [[0, -6, 8], [-7, -1, 5.6], [7, -1, 5.6], [-3, -11, 5], [4, -10, 5.4]]
        .forEach(function (b) {
          ctx.fillStyle = COLOR.leaf;
          ctx.beginPath();
          ctx.arc(t.x + b[0], cy + b[1], b[2], 0, Math.PI * 2);
          ctx.fill();
        });
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(t.x, cy - 6, 8, Math.PI * 0.85, Math.PI * 2.15);
      ctx.stroke();
      [[-3.5, -8.5, 2.4], [3.2, -12, 1.9], [-6, -3, 1.7]].forEach(function (h) {
        ctx.fillStyle = COLOR.leafLight;
        ctx.beginPath();
        ctx.arc(t.x + h[0], cy + h[1], h[2], 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function drawPlatforms() {
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (p.bale) drawBale(p);
      else if (p.h > 10) drawSlab(p);
      else if (p.branch) drawBranch(p);
      else drawLedge(p);
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

      if (c.kind === 'apple') {
        ctx.save();
        ctx.translate(cx, cy);
        drawAppleShape();
        ctx.restore();
        continue;
      }

      ctx.save();
      ctx.translate(cx, cy);
      // Cobs on stalks carry a tilt so the row doesn't read as fenceposts.
      // Loose cobs on the ground have no angle and draw upright.
      if (c.angle) ctx.rotate(c.angle);
      drawCornEar();
      ctx.restore();
    }
  }

  // An ear of corn centred on the origin: tapered cob with staggered rows of
  // kernels and husk leaves peeling back. The kernel rows are what make it
  // read as corn rather than a yellow blob. Shared by the pickups, the
  // homestead's ripe crops and the market stall.

  // An apple rather than a red dot: two lobes with a dimple at the top and a
  // narrower base, a bite of shading down one side, a stem sunk into the
  // dimple and a leaf off it. Centred on the origin.
  function drawAppleShape() {
    // Body. Widest above the middle, tapering to a slightly narrow base, with
    // a dip in the top where the stem sits.
    ctx.beginPath();
    ctx.moveTo(0, -2.4);
    ctx.bezierCurveTo(-0.9, -3.6, -2.9, -3.5, -3.4, -1.6);
    ctx.bezierCurveTo(-3.9, 0.4, -2.6, 2.7, -1.0, 3.3);
    ctx.bezierCurveTo(-0.35, 3.55, 0.35, 3.55, 1.0, 3.3);
    ctx.bezierCurveTo(2.6, 2.7, 3.9, 0.4, 3.4, -1.6);
    ctx.bezierCurveTo(2.9, -3.5, 0.9, -3.6, 0, -2.4);
    ctx.closePath();
    ctx.fillStyle = COLOR.apple;
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 0.55;
    ctx.stroke();

    // Shaded far side, so it reads round rather than flat.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = COLOR.appleDark;
    ctx.beginPath();
    ctx.ellipse(2.5, 0.6, 2.4, 3.4, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Stem in the dimple, leaning with a leaf off it.
    ctx.strokeStyle = COLOR.appleStem;
    ctx.lineWidth = 0.85;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -2.5);
    ctx.quadraticCurveTo(0.5, -4.0, 1.2, -4.7);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.fillStyle = COLOR.leaf;
    ctx.beginPath();
    ctx.ellipse(2.5, -4.2, 1.8, 0.95, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 0.35;
    ctx.stroke();
    ctx.strokeStyle = COLOR.leafLight;
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(1.2, -3.9);
    ctx.lineTo(3.7, -4.6);
    ctx.stroke();

    // Specular highlight on the lit side.
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.ellipse(-1.5, -1.2, 0.65, 1.1, -0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCornEar() {
      // Green shucks: a long leaf either side peeled back past the tip, plus a
      // shorter pair, all behind the cob so the kernels stay readable.
      [-1, 1].forEach(function (sgn) {
        ctx.fillStyle = sgn > 0 ? COLOR.cornHusk : COLOR.cornHuskDark;
        ctx.beginPath();
        ctx.moveTo(sgn * 0.5, 3.4);
        ctx.quadraticCurveTo(sgn * 4.6, 1.2, sgn * 3.4, -4.2);
        ctx.quadraticCurveTo(sgn * 1.9, -0.6, sgn * 0.5, 3.4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = COLOR.outline;
        ctx.lineWidth = 0.4;
        ctx.stroke();

        // Shorter inner leaf, offset so the pair reads as layered.
        ctx.fillStyle = sgn > 0 ? COLOR.cornHuskDark : COLOR.cornHusk;
        ctx.beginPath();
        ctx.moveTo(sgn * 0.4, 3.2);
        ctx.quadraticCurveTo(sgn * 3.0, 1.6, sgn * 2.2, -1.8);
        ctx.quadraticCurveTo(sgn * 1.2, 0.4, sgn * 0.4, 3.2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = COLOR.outline;
        ctx.lineWidth = 0.35;
        ctx.stroke();

        // Rib down the long leaf.
        ctx.strokeStyle = COLOR.cornHuskLight;
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(sgn * 0.8, 2.6);
        ctx.quadraticCurveTo(sgn * 2.9, 0.4, sgn * 3.0, -3.4);
        ctx.stroke();
      });

      ctx.strokeStyle = COLOR.cornSilk;
      ctx.lineWidth = 0.5;
      [-0.8, 0, 0.8].forEach(function (sx) {
        ctx.beginPath();
        ctx.moveTo(sx * 0.6, -3.2);
        ctx.quadraticCurveTo(sx * 1.6, -4.6, sx * 2.2, -5.2);
        ctx.stroke();
      });

      ctx.beginPath();
      ctx.moveTo(0, -3.5);
      ctx.bezierCurveTo(1.8, -2.9, 2.1, 0, 1.6, 2.2);
      ctx.bezierCurveTo(1.0, 3.3, -1.0, 3.3, -1.6, 2.2);
      ctx.bezierCurveTo(-2.1, 0, -1.8, -2.9, 0, -3.5);
      ctx.closePath();
      ctx.fillStyle = COLOR.corn;
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.6;
      ctx.stroke();

      // Collar of husk wrapping the base, in front of the cob.
      ctx.fillStyle = COLOR.cornHusk;
      ctx.beginPath();
      ctx.moveTo(-1.7, 1.6);
      ctx.quadraticCurveTo(0, 3.9, 1.7, 1.6);
      ctx.quadraticCurveTo(0, 2.6, -1.7, 1.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.35;
      ctx.stroke();

      ctx.fillStyle = COLOR.cornKernel;
      for (var kr = 0; kr < 5; kr++) {
        var ky = -2.5 + kr * 1.25;
        var stagger = (kr % 2) * 0.45;
        var cols = Math.abs(ky) > 2 ? 1 : 2;
        for (var kc = -cols; kc <= cols; kc++) {
          var kx = kc * 0.85 + stagger;
          if (Math.abs(kx) > 1.5) continue;
          ctx.beginPath();
          ctx.arc(kx, ky, 0.34, 0, Math.PI * 2);
          ctx.fill();
        }
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
      // A full overhead chop: starts up and behind, passes over the head and
      // finishes pointing down in front. The alternate combo step sweeps back.
      var sweepArc = (p.comboStep === 0) ? [-2.5, 0.7] : [0.7, -2.5];
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
      // Drawn in local space facing +x and mirrored, so the silhouette stays
      // correct both ways: shoulder hump, bristled spine, wedge snout and a
      // pair of upswept tusks.
      var body = flashing ? COLOR.flash : COLOR.boar;
      var dark = flashing ? COLOR.flash : COLOR.boarDark;

      ctx.save();
      ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
      ctx.scale(e.facing, 1);
      ctx.lineWidth = 1;

      // Legs behind the body.
      ctx.fillStyle = dark;
      [-4.2, -2.2, 2.0, 3.9].forEach(function (lx) {
        ctx.fillRect(lx, 2.2, 1.7, 3.4);
        ctx.strokeStyle = COLOR.outline;
        ctx.strokeRect(lx + 0.5, 2.7, 0.8, 2.8);
      });

      // Curly tail.
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-6.2, -0.6);
      ctx.quadraticCurveTo(-8.2, -1.6, -7.0, -2.9);
      ctx.stroke();

      // Humped body tapering into the head.
      ctx.beginPath();
      ctx.moveTo(-6.4, 1.9);
      ctx.bezierCurveTo(-7.6, -0.8, -5.2, -4.4, -1.6, -4.6);
      ctx.bezierCurveTo(1.4, -4.7, 2.8, -3.0, 4.0, -2.0);
      ctx.bezierCurveTo(5.8, -1.0, 6.9, -0.2, 6.9, 0.9);
      ctx.bezierCurveTo(6.9, 2.1, 5.4, 2.7, 3.9, 2.8);
      ctx.bezierCurveTo(0.8, 3.1, -3.2, 3.2, -6.4, 1.9);
      ctx.closePath();
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      // Bristles along the spine.
      ctx.strokeStyle = dark;
      ctx.lineWidth = 0.8;
      for (var br = 0; br < 5; br++) {
        var bxr = -4.4 + br * 1.45;
        var byr = -4.1 - Math.sin(br * 0.7) * 0.5;
        ctx.beginPath();
        ctx.moveTo(bxr, byr + 0.6);
        ctx.lineTo(bxr - 0.5, byr - 1.9);
        ctx.stroke();
      }

      // Ear.
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(1.4, -3.6);
      ctx.lineTo(2.6, -5.6);
      ctx.lineTo(3.5, -3.1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.6;
      ctx.stroke();

      // Snout disc and nostril.
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(6.6, 1.0, 1.2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.fillStyle = COLOR.outline;
      ctx.fillRect(6.5, 0.5, 0.7, 0.7);

      // Tusks: the far one first so the near one reads on top.
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(4.3, 2.3);
      ctx.quadraticCurveTo(6.1, 1.9, 5.9, 0.2);
      ctx.moveTo(5.4, 2.5);
      ctx.quadraticCurveTo(7.6, 2.0, 7.3, -0.9);
      ctx.stroke();
      ctx.strokeStyle = COLOR.boarLight;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(4.3, 2.3);
      ctx.quadraticCurveTo(6.1, 1.9, 5.9, 0.2);
      ctx.moveTo(5.4, 2.5);
      ctx.quadraticCurveTo(7.6, 2.0, 7.3, -0.9);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // Eye.
      ctx.fillStyle = COLOR.outline;
      ctx.fillRect(3.5, -1.9, 1, 1);

      ctx.restore();
    } else if (e.type === 'crow' || e.type === 'fly') {
      // Drawn facing +x and mirrored: a sleek corvid rather than a blob -
      // long wedge tail, thick straight beak, and two wings whose feather
      // tips separate on the downbeat.
      var flap = Math.sin(e.phase * 2);
      var ink = flashing ? COLOR.flash : COLOR.crow;

      ctx.save();
      ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
      ctx.scale(e.facing, 1);
      ctx.lineWidth = 0.6;

      // Far wing sits behind the body and lags the near wing slightly.
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.crowSheen;
      ctx.beginPath();
      ctx.moveTo(0.2, -0.6);
      ctx.quadraticCurveTo(-2.6, -2.4 - flap * 3.0, -5.4, -0.8 - flap * 3.4);
      ctx.quadraticCurveTo(-2.8, 0.4, 0.2, 0.8);
      ctx.closePath();
      ctx.fill();

      // Tail: a long wedge with two feather notches.
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-2.6, -0.4);
      ctx.lineTo(-7.4, -1.9);
      ctx.lineTo(-6.4, -0.5);
      ctx.lineTo(-7.6, 0.1);
      ctx.lineTo(-6.3, 0.7);
      ctx.lineTo(-7.2, 1.8);
      ctx.lineTo(-2.6, 1.0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      // Streamlined body, chest forward.
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-3.0, -1.2);
      ctx.bezierCurveTo(-1.0, -2.6, 1.8, -2.4, 2.9, -1.0);
      ctx.bezierCurveTo(3.8, 0.1, 2.6, 1.9, 0.6, 2.2);
      ctx.bezierCurveTo(-1.4, 2.4, -2.8, 1.4, -3.0, -1.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      // Head on a short neck.
      ctx.beginPath();
      ctx.arc(3.4, -1.9, 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      // Thick straight corvid beak.
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.crowBeak;
      ctx.beginPath();
      ctx.moveTo(4.7, -2.5);
      ctx.lineTo(7.7, -1.5);
      ctx.lineTo(4.7, -0.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(4.7, -1.6);
      ctx.lineTo(7.4, -1.5);
      ctx.stroke();

      // Near wing, over the body, with split primaries.
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(0.8, -1.2);
      ctx.quadraticCurveTo(-1.8, -3.6 - flap * 4.0, -5.0, -2.4 - flap * 4.6);
      ctx.quadraticCurveTo(-2.2, -0.6, 1.0, -0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.strokeStyle = flashing ? COLOR.flash : COLOR.crowSheen;
      ctx.lineWidth = 0.45;
      for (var fq = 0; fq < 3; fq++) {
        ctx.beginPath();
        ctx.moveTo(-1.2 - fq * 0.9, -1.6 - flap * 2.2 - fq * 0.3);
        ctx.lineTo(-3.4 - fq * 0.7, -2.6 - flap * 4.0 - fq * 0.2);
        ctx.stroke();
      }

      // Eye.
      ctx.fillStyle = COLOR.crowEye;
      ctx.beginPath();
      ctx.arc(3.9, -2.3, 0.55, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    } else if (e.type === 'vulture') {
      // Bigger and nastier than a crow: hunched shoulders, ragged wings, bald
      // pink head and a hooked beak. Wings spread wide while diving.
      var diving = e.mode === 'dive';
      var vflap = diving ? 1 : Math.sin(e.phase * 2) * 0.6;
      var vink = flashing ? COLOR.flash : COLOR.vulture;

      ctx.save();
      ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
      ctx.scale(e.facing, 1);
      ctx.lineWidth = 0.7;

      // Far wing.
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.vultureDark;
      ctx.beginPath();
      ctx.moveTo(0, -1);
      ctx.quadraticCurveTo(-5, -4 - vflap * 4, -10, -1 - vflap * 5);
      ctx.quadraticCurveTo(-5, 1.5, 0, 1.5);
      ctx.closePath();
      ctx.fill();

      // Tail.
      ctx.fillStyle = vink;
      ctx.beginPath();
      ctx.moveTo(-3.5, -1);
      ctx.lineTo(-9.5, -2.5);
      ctx.lineTo(-8.5, 0);
      ctx.lineTo(-9.5, 2.5);
      ctx.lineTo(-3.5, 1.8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      // Heavy hunched body.
      ctx.beginPath();
      ctx.moveTo(-4, -2);
      ctx.bezierCurveTo(-1.5, -5.2, 3, -4.6, 4.4, -1.6);
      ctx.bezierCurveTo(5.6, 0.6, 3.6, 3.4, 0.6, 3.6);
      ctx.bezierCurveTo(-2.4, 3.8, -4.2, 1.4, -4, -2);
      ctx.closePath();
      ctx.fillStyle = vink;
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      // Ruff of pale neck feathers.
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.vultureRuff;
      ctx.beginPath();
      ctx.ellipse(3.0, -2.6, 2.6, 1.9, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Bald head and hooked beak.
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.vultureHead;
      ctx.beginPath();
      ctx.arc(5.0, -4.4, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.crowBeak;
      ctx.beginPath();
      ctx.moveTo(6.4, -5.2);
      ctx.lineTo(9.4, -4.2);
      ctx.quadraticCurveTo(8.4, -2.6, 6.4, -3.0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.4;
      ctx.stroke();

      // Near wing, spread on the dive.
      ctx.fillStyle = vink;
      ctx.beginPath();
      ctx.moveTo(0.8, -2);
      ctx.quadraticCurveTo(-4, -6 - vflap * 5, -9.5, -3.5 - vflap * 6);
      ctx.quadraticCurveTo(-4, -0.5, 1.2, -0.8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.strokeStyle = flashing ? COLOR.flash : COLOR.vultureDark;
      ctx.lineWidth = 0.5;
      for (var vf = 0; vf < 4; vf++) {
        ctx.beginPath();
        ctx.moveTo(-1.6 - vf * 1.4, -2.4 - vflap * 2.6 - vf * 0.3);
        ctx.lineTo(-5.2 - vf * 1.2, -3.6 - vflap * 5 - vf * 0.2);
        ctx.stroke();
      }

      // Eye.
      ctx.fillStyle = COLOR.bad;
      ctx.beginPath();
      ctx.arc(5.5, -4.9, 0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    } else if (e.type === 'bull') {
      var bulk = flashing ? COLOR.flash : COLOR.bull;
      var charging = e.mode === 'charge';
      var pawing = e.mode === 'paw';

      ctx.save();
      ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
      ctx.scale(e.facing, 1);
      ctx.lineWidth = 1;

      // Legs - splayed mid-charge, one pawing when winding up.
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.bullDark;
      var legSwing = charging ? Math.sin(e.phase) * 2.5 : 0;
      var pawLift = pawing ? Math.abs(Math.sin(e.phase)) * 2 : 0;
      [[-8, legSwing], [-5.5, -legSwing], [6, -legSwing], [8.5, legSwing - pawLift]]
        .forEach(function (lg) {
          ctx.fillRect(lg[0], 5 + lg[1] * 0.2, 2.4, 5 - lg[1] * 0.2);
          ctx.strokeStyle = COLOR.outline;
          ctx.strokeRect(lg[0] + 0.5, 5.5 + lg[1] * 0.2, 1.4, 4 - lg[1] * 0.2);
        });

      // Tail.
      ctx.strokeStyle = flashing ? COLOR.flash : COLOR.bullDark;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-11, -2);
      ctx.quadraticCurveTo(-14, -1 + (charging ? -3 : 2), -12.5, 3);
      ctx.stroke();

      // Heavy body with a shoulder hump.
      ctx.beginPath();
      ctx.moveTo(-11, 3);
      ctx.bezierCurveTo(-13, -2, -9, -7, -3, -7.4);
      ctx.bezierCurveTo(3, -7.8, 7, -6, 9.5, -3.5);
      ctx.bezierCurveTo(12, -1, 12.5, 3, 10, 5);
      ctx.bezierCurveTo(4, 6.5, -5, 6.5, -11, 3);
      ctx.closePath();
      ctx.fillStyle = bulk;
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Lowered head when charging, raised when pawing.
      var headY = charging ? 1.5 : -1;
      ctx.save();
      ctx.translate(10, headY);
      ctx.fillStyle = bulk;
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.6, 3.8, charging ? 0.35 : 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();

      // Horns.
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-1.5, -2.6);
      ctx.quadraticCurveTo(2.5, -5.2, 5.2, -2.6);
      ctx.moveTo(-2.2, -1.6);
      ctx.quadraticCurveTo(0.5, -4.6, 3.0, -3.4);
      ctx.stroke();
      ctx.strokeStyle = COLOR.boarLight;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-1.5, -2.6);
      ctx.quadraticCurveTo(2.5, -5.2, 5.2, -2.6);
      ctx.moveTo(-2.2, -1.6);
      ctx.quadraticCurveTo(0.5, -4.6, 3.0, -3.4);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // Muzzle, nose ring and a red eye.
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.bullMuzzle;
      ctx.beginPath();
      ctx.ellipse(3.4, 1.6, 2.0, 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.strokeStyle = COLOR.bullRing;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(3.6, 3.2, 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = COLOR.bad;
      ctx.beginPath();
      ctx.arc(0.6, -1.2, 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Snorted dust while pawing, speed lines while charging.
      if (pawing) {
        ctx.fillStyle = 'rgba(245,241,230,0.5)';
        for (var pd = 0; pd < 3; pd++) {
          var px2 = 14 + pd * 3 + Math.sin(e.phase + pd) * 1.5;
          ctx.beginPath();
          ctx.arc(px2, 4 - pd, 1.4 - pd * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (charging) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 0.8;
        for (var sl = 0; sl < 3; sl++) {
          var sy2 = -4 + sl * 4;
          ctx.beginPath();
          ctx.moveTo(-13 - sl * 2, sy2);
          ctx.lineTo(-20 - sl * 3, sy2);
          ctx.stroke();
        }
      }

      ctx.restore();
    } else if (e.type === 'larva') {
      var lw = e.w, lh = e.h;
      ctx.save();
      ctx.translate(e.x + lw / 2, e.y + lh / 2);
      ctx.scale(e.facing, 1);
      ctx.lineWidth = 0.7;

      // Body as overlapping segments, squirming along its length.
      var segs = 4;
      for (var sg = 0; sg < segs; sg++) {
        var t2 = sg / (segs - 1);
        var sxp = -lw / 2 + 1.5 + t2 * (lw - 3);
        var syp = Math.sin(e.phase - sg * 0.9) * 1.1;
        var rad = 2.4 - Math.abs(t2 - 0.35) * 1.2;
        ctx.fillStyle = flashing ? COLOR.flash : (sg === segs - 1 ? COLOR.larvaHead : COLOR.larva);
        ctx.beginPath();
        ctx.arc(sxp, syp, Math.max(1.1, rad), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLOR.outline;
        ctx.stroke();
      }
      // Dark speck of an eye on the head segment.
      ctx.fillStyle = COLOR.outline;
      ctx.fillRect(lw / 2 - 2, Math.sin(e.phase - (segs - 1) * 0.9) * 1.1 - 0.5, 0.9, 0.9);

      // Nearly-hatched grubs twitch faster and flash.
      if (e.matureTimer < 1) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(time * 14));
        ctx.strokeStyle = COLOR.queenLit;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(0, 0, lw / 2 + 1.5, lh / 2 + 1.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    } else if (e.type === 'rustbucket') {
      // A bigger, rustier cousin of the player's combine.
      var rx = e.x, ry = e.y, rw = e.w, rh = e.h;
      ctx.save();
      ctx.translate(rx + rw / 2, ry + rh / 2);
      ctx.scale(e.facing, 1);
      ctx.lineWidth = 1;

      ctx.fillStyle = COLOR.wheel;
      [-9, 0, 9].forEach(function (wx) {
        ctx.beginPath();
        ctx.arc(wx, rh / 2 - 1, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLOR.outline;
        ctx.stroke();
      });

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.rust;
      ctx.fillRect(-rw / 2, -rh / 2 + 3, rw, rh - 6);
      ctx.strokeStyle = COLOR.outline;
      ctx.strokeRect(-rw / 2 + 0.5, -rh / 2 + 3.5, rw - 1, rh - 7);
      ctx.fillStyle = flashing ? COLOR.flash : COLOR.rustDark;
      for (var pt = 0; pt < 5; pt++) {
        ctx.fillRect(-rw / 2 + 3 + pt * 5.5, -rh / 2 + 5 + (pt % 2) * 4, 3, 3);
      }

      ctx.fillStyle = COLOR.rustDark;
      ctx.fillRect(-rw / 2 + 2, -rh / 2 - 4, 7, 8);
      ctx.strokeStyle = COLOR.outline;
      ctx.strokeRect(-rw / 2 + 2.5, -rh / 2 - 3.5, 6, 7);

      // Spinning header at the front.
      var hx = rw / 2 - 3;
      ctx.fillStyle = COLOR.combineHeader;
      ctx.fillRect(hx - 1, rh / 2 - 9, 5, 9);
      ctx.strokeStyle = COLOR.outline;
      ctx.strokeRect(hx - 0.5, rh / 2 - 8.5, 4, 8);
      ctx.strokeStyle = COLOR.rustDark;
      for (var rr = 0; rr < 3; rr++) {
        var ra = e.phase + rr * (Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.moveTo(hx + 1.5 + Math.cos(ra) * 3, rh / 2 - 4 + Math.sin(ra) * 3);
        ctx.lineTo(hx + 1.5 - Math.cos(ra) * 3, rh / 2 - 4 - Math.sin(ra) * 3);
        ctx.stroke();
      }
      ctx.restore();
    } else if (e.type === 'queen') {
      var qw = e.w, qh = e.h;
      var laying = e.mode === 'lay';
      ctx.save();
      ctx.translate(e.x + qw / 2, e.y + qh / 2);
      ctx.scale(e.facing, 1);
      ctx.lineWidth = 1;

      // Blur of wings.
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = COLOR.wing;
      [-1, 1].forEach(function (sg) {
        ctx.beginPath();
        ctx.ellipse(-2, sg * (4 + Math.sin(e.phase * 6) * 1.5), 8, 3.2, sg * 0.4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      ctx.fillStyle = flashing ? COLOR.flash : (laying ? COLOR.queenLit : COLOR.queen);
      ctx.beginPath();
      ctx.ellipse(-3, 0, 8, 5.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();
      ctx.strokeStyle = COLOR.queenDark;
      for (var bd = -1; bd <= 2; bd++) {
        ctx.beginPath();
        ctx.moveTo(-3 + bd * 3, -4.6);
        ctx.lineTo(-3 + bd * 3, 4.6);
        ctx.stroke();
      }

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.queenDark;
      ctx.beginPath();
      ctx.arc(6.5, -1, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.stroke();
      ctx.fillStyle = COLOR.bad;
      [[7.8, -2.4], [7.8, 0.4]].forEach(function (ey) {
        ctx.beginPath();
        ctx.arc(ey[0], ey[1], 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
      if (laying) {
        ctx.strokeStyle = COLOR.queenLit;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-10, 3);
        ctx.lineTo(-13, 7);
        ctx.stroke();
      }
      ctx.restore();
    } else if (e.type === 'oak') {
      var ox = e.x, oy = e.y, ow = e.w, oh = e.h;
      var swinging = e.sweepState === 'sweep';

      ctx.fillStyle = flashing ? COLOR.flash : COLOR.trunk;
      ctx.beginPath();
      ctx.moveTo(ox - 4, oy + oh);
      ctx.quadraticCurveTo(ox + 3, oy + oh * 0.45, ox + 6, oy + 4);
      ctx.lineTo(ox + ow - 6, oy + 4);
      ctx.quadraticCurveTo(ox + ow - 3, oy + oh * 0.45, ox + ow + 4, oy + oh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Sweeping limb - the thing that actually hurts.
      ctx.strokeStyle = flashing ? COLOR.flash : COLOR.trunkDark;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox + 4, oy + oh - 22);
      if (swinging) {
        ctx.quadraticCurveTo(ox - 22, GROUND_Y - 16, ox - 44, GROUND_Y - 7);
      } else {
        ctx.quadraticCurveTo(ox - 12, oy + oh - 34, ox - 20, oy + oh - 44);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';

      // Crown: the weak point, lit when reachable.
      ctx.fillStyle = COLOR.leaf;
      [[ow / 2, -4, 13], [6, 3, 8], [ow - 6, 3, 8]].forEach(function (b) {
        ctx.beginPath();
        ctx.arc(ox + b[0], oy + b[1], b[2], 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ox + ow / 2, oy - 4, 13, Math.PI * 0.85, Math.PI * 2.15);
      ctx.stroke();

      // A face in the bark.
      ctx.fillStyle = COLOR.outline;
      ctx.beginPath();
      ctx.ellipse(ox + ow / 2 - 5, oy + 16, 2.2, 3, 0, 0, Math.PI * 2);
      ctx.ellipse(ox + ow / 2 + 5, oy + 16, 2.2, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(ox + ow / 2 - 5, oy + 24);
      ctx.quadraticCurveTo(ox + ow / 2, oy + 29, ox + ow / 2 + 5, oy + 24);
      ctx.stroke();
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

  // Traces a heart centred on the origin, spanning roughly 5.4 x 4.5. Shared
  // by the pickup and the HUD pips so the two can't drift out of sync.
  function heartPath() {
    ctx.beginPath();
    ctx.moveTo(0, 2.2);
    ctx.bezierCurveTo(-2.7, 0.3, -2.5, -2.3, -0.95, -2.3);
    ctx.bezierCurveTo(-0.3, -2.3, 0, -1.7, 0, -1.25);
    ctx.bezierCurveTo(0, -1.7, 0.3, -2.3, 0.95, -2.3);
    ctx.bezierCurveTo(2.5, -2.3, 2.7, 0.3, 0, 2.2);
    ctx.closePath();
  }

  function drawHeartShape() {
    var pulse = 1 + Math.sin(time * 5) * 0.07;
    ctx.scale(pulse, pulse);
    heartPath();
    ctx.fillStyle = COLOR.bad;
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 0.42;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.ellipse(-1.05, -0.95, 0.45, 0.72, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDrops() {
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      // Floating items ride the stream with a slower, deeper bob.
      var bobY = d.landed
        ? Math.sin(time * (d.floating ? 2.2 : 3) + d.bob) * (d.floating ? 1.1 : 0.6)
        : 0;
      ctx.save();
      ctx.translate(d.x + d.w / 2, d.y + d.h / 2 + bobY);
      ctx.rotate(d.angle);
      if (d.kind === 'roast') drawRoastShape();
      else if (d.kind === 'health') drawHeartShape();
      else drawBaconShape(d.wave);
      ctx.restore();
    }
  }

  function drawBossBar() {
    var boss = null;
    for (var i = 0; i < enemies.length; i++) if (isBoss(enemies[i])) boss = enemies[i];
    if (!boss || boss.dead) return;
    if (Math.abs(player.x - boss.x) > BOSS_AGGRO_RANGE * 1.6) return;

    var barW = 140, barH = 5, x = W / 2 - barW / 2, y = 30;
    ctx.textAlign = 'center';
    ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.hud;
    ctx.fillText(BOSS_NAMES[boss.type] || 'BOSS', W / 2, y - 3);
    ctx.fillStyle = COLOR.hpEmpty;
    ctx.fillRect(x, y, barW, barH);
    // Measure against this boss's own max, not the scarecrow's. Every boss
    // past the first has more health, so dividing by 12 ran the fill straight
    // past the end of the bar. Clamped as well, so a bad max can't overflow.
    var bossMax = boss.maxHp || ENEMY_DEFS[boss.type].hp;
    var frac = Math.max(0, Math.min(1, boss.hp / bossMax));
    ctx.fillStyle = COLOR.bad;
    ctx.fillRect(x, y, barW * frac, barH);
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, barW - 1, barH - 1);
  }


  // A cob, a rasher and a roast with their tallies. Uses the same sprites as
  // the pickups so the icon and the thing you picked up always match.
  function resSummary() {
    return runRes.corn + ' CORN  ' + runRes.bacon + ' BACON  ' + runRes.chicken + ' CHICKEN';
  }

  function drawResourceTray() {
    var items = [
      { n: runRes.corn, draw: function () { ctx.scale(0.85, 0.85); drawCornEar(); } },
      { n: runRes.bacon, draw: function () { ctx.scale(0.8, 0.8); drawBaconShape(0.9); } },
      { n: runRes.chicken, draw: function () { ctx.scale(0.72, 0.72); drawRoastShape(); } }
    ];
    // A vertical column under the score, right-aligned to the same edge so the
    // counts line up with the points above them. The middle of these rows
    // belongs to the boss bar and the toasts, so the right edge is the only
    // clear lane.
    var iconX = W - 14, countX = W - 4, y0 = 22, rowH = 11;
    ctx.textAlign = 'right';
    ctx.font = '7px ui-monospace, Menlo, Consolas, monospace';
    for (var i = 0; i < items.length; i++) {
      var iy = y0 + i * rowH;
      ctx.save();
      ctx.translate(iconX, iy);
      items[i].draw();
      ctx.restore();
      ctx.fillStyle = COLOR.hud;
      ctx.fillText(String(items[i].n), countX, iy + 2.5);
    }
  }

  function drawHud() {
    // Hearts rather than blocks, to match the health pickups.
    var pipW = 8, startX = 8, y = 7;
    for (var i = 0; i < mods.maxHp; i++) {
      var full = i < player.hp;
      ctx.save();
      ctx.translate(startX + i * pipW, y);
      ctx.scale(1.35, 1.35);
      heartPath();
      ctx.fillStyle = full ? COLOR.bad : COLOR.hpEmpty;
      ctx.fill();
      ctx.strokeStyle = COLOR.outline;
      ctx.lineWidth = 0.55;
      ctx.stroke();
      if (full) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.ellipse(-1.05, -0.95, 0.4, 0.62, -0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.font = '8px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.hud;
    ctx.textAlign = 'center';
    ctx.fillText('DEPTH ' + depth, W / 2, 10);
    ctx.textAlign = 'right';
    ctx.fillText(pad(runScore), W - 4, 10);

    // Three resources as icons with counts, rather than one merged number.
    drawResourceTray();

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

    // Without this, being yanked back to the start line reads as a random
    // teleport rather than as the cost of falling down a hole.
    if (pitFallTimer > 0) {
      ctx.textAlign = 'center';
      ctx.font = '8px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = COLOR.bad;
      ctx.fillText('FELL IN A PIT  -1 HEART', W / 2, 60);
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
      var afford = meta.bankedCorn >= nodePrice(node);
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
      if (maxed) {
        ctx.fillStyle = COLOR.good;
        ctx.fillText('MAXED', x + w - 5, y + 12);
      } else if (svenMode) {
        // Honest price on the right, the farmstead's asking price struck out
        // in red beside it.
        var realStr = node.cost + ' CORN';
        ctx.fillStyle = afford ? COLOR.good : COLOR.bad;
        ctx.fillText(realStr, x + w - 5, y + 12);
        var realW = ctx.measureText(realStr).width;

        var listStr = String(listPrice(node));
        var listRight = x + w - 9 - realW;
        ctx.fillStyle = COLOR.dim;
        ctx.fillText(listStr, listRight, y + 12);
        var listW = ctx.measureText(listStr).width;

        ctx.strokeStyle = COLOR.bad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(listRight - listW - 1, y + 9.5);
        ctx.lineTo(listRight + 1, y + 9.5);
        ctx.stroke();
      } else {
        ctx.fillStyle = afford ? COLOR.hud : COLOR.bad;
        ctx.fillText(listPrice(node) + ' CORN', x + w - 5, y + 12);
      }
    }

    // Sven himself: low-contrast, small, bottom-right. Findable, not signposted.
    ctx.textAlign = 'right';
    ctx.font = '5px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = svenMode ? 'rgba(126,217,155,0.55)' : 'rgba(245,241,230,0.16)';
    ctx.fillText(svenMode ? 'buying from sven' : 'buy from sven instead',
      SVEN_HOTSPOT.x + SVEN_HOTSPOT.w, SVEN_HOTSPOT.y + 7);

    ctx.textAlign = 'center';
    ctx.font = '6px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLOR.cardBg;
    ctx.fillText('W/S SELECT   SPACE BUY   H BACK', W / 2, H - 6);
  }

  function render() {
    // Reset each frame so the logical->buffer scale can't compound.
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

    if (state === 'farm') { drawFarm(); return; }

    drawSky();
    drawHill();

    if (state !== 'hub') {
      ctx.save();
      ctx.translate(-cameraX, 0);
      drawWater();
      drawTrees();
      drawStalks();
      drawPlatforms();
      drawExit();
      drawCorn();
      drawDrops();
      for (var i = 0; i < enemies.length; i++) drawEnemy(enemies[i]);
      if (player && state !== 'victory' && state !== 'drowning') drawPlayer();
      if (state === 'drowning') drawDrownSeq();
      drawParticles();
      if (slamFx > 0 && player) {
        var t = 1 - slamFx / 0.42;
        var r = 6 + t * SLAM_RADIUS;
        ctx.globalAlpha = Math.max(0, 1 - t) * 0.8;
        ctx.strokeStyle = COLOR.roastSheen;
        ctx.lineWidth = 2 - t;
        ctx.beginPath();
        ctx.ellipse(player.x + player.w / 2, player.y + player.h, r, r * 0.42, 0, Math.PI, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    if (state === 'playing') {
      drawHud();
    } else if (state === 'title') {
      var blink = Math.floor(time * 2) % 2 === 0;
      drawOverlayText([
        { text: 'FARMER BROWN', size: 16, color: COLOR.title },
        { text: '', size: 5 },
        { text: 'A/D MOVE   W JUMP (HOLD=HIGHER)   S DROP   SPACE ATTACK   SHIFT ROLL', size: 6, color: COLOR.dim },
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
        { text: 'DEPTH ' + depth + ' DONE   ' + resSummary(), size: 7 },
        { text: '', size: 4 },
        { text: 'ANY KEY: DESCEND', size: 7 }
      ]);
    } else if (state === 'bossclear') {
      var nextBoss = bossTypeFor(depth + BOSS_INTERVAL);
      drawOverlayText([
        { text: BOSS_NAMES[bossTypeFor(depth)] + ' DOWN', size: 13, color: COLOR.good },
        { text: '', size: 4 },
        { text: 'DEPTH ' + depth + '   CARRYING ' + resSummary(), size: 7 },
        { text: 'NEXT DOWN THERE: ' + BOSS_NAMES[nextBoss], size: 6, color: COLOR.dim },
        { text: '', size: 4 },
        { text: 'ANY KEY: PUSH DEEPER', size: 7 },
        { text: 'B: BANK OUT AND KEEP IT ALL', size: 6, color: COLOR.title }
      ]);
    } else if (state === 'dead') {
      drawOverlayText([
        { text: 'YOU DIED', size: 16, color: COLOR.bad },
        { text: '', size: 4 },
        { text: 'DEPTH ' + depth + '   SCORE ' + pad(runScore), size: 7 },
        { text: resSummary(), size: 6, color: COLOR.dim },
        { text: 'HAUL ' + lastHaul + '   LOST ' + lastLost + '   KEPT ' + lastBanked, size: 6, color: COLOR.bad },
        { text: 'BANKED CORN ' + meta.bankedCorn, size: 6, color: COLOR.dim },
        { text: '', size: 4 },
        { text: 'ANY KEY: NEW RUN     H: FARMSTEAD', size: 7 }
      ]);
    } else if (state === 'victory') {
      drawOverlayText([
        { text: 'HARVEST COMPLETE', size: 13, color: COLOR.good },
        { text: '', size: 4 },
        { text: 'SCORE ' + pad(runScore) + '   ' + resSummary(), size: 7 },
        { text: 'KEPT ALL ' + lastBanked + '   TOTAL BANKED ' + meta.bankedCorn, size: 6, color: COLOR.dim },
        { text: '', size: 4 },
        { text: 'F: HOMESTEAD   H: FARMSTEAD   ANY KEY: NEW RUN', size: 6 }
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

/*
 * Warrior Legends — game logic on top of the shared arcade shell (js/arcade-shell.js).
 * Plain script, no modules: reads window.Arcade.
 */
(function () {
  'use strict';

  var A = window.Arcade, TH = A.theme;

  // ------------------------------------------------------------ constants
  var TILE = 50, COLS = 16, ROWS = 12;
  var STEP_MS = 120;      // tween to the neighbouring tile
  var UNLOCK_MS = 150;    // door brightening before it turns to ground
  var DIRS = {
    up: { dc: 0, dr: -1 }, down: { dc: 0, dr: 1 },
    left: { dc: -1, dr: 0 }, right: { dc: 1, dr: 0 }
  };
  var KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right'
  };
  var CODES = Object.keys(KEYMAP);
  var DIR_ORDER = ['up', 'down', 'left', 'right'];

  // The original room, in the character format used from Step 2 on.
  var ROOM = [
    '################',
    '#.....#...D.####',
    '#.K.K.#.S.#.#KK#',
    '#.....#...#D#D##',
    '###D###.K.#...##',
    '#.........#.K.##',
    '#.........#...##',
    '#.#########.K.##',
    '#.#.#.#...#...##',
    '#.D.D.D.T.######',
    '#.#.#.#...######',
    '################'
  ];

  // ------------------------------------------------------------ images
  var IMG_FILES = {
    '.': 'world_ground.png', '#': 'world_wall.png', T: 'world_goal.png',
    K: 'world_key.png', D: 'world_door.png', hero: 'warrior.png'
  };
  var img = {};

  function loadImages() {
    return Promise.all(Object.keys(IMG_FILES).map(function (k) {
      var im = new Image();
      im.src = 'images/' + IMG_FILES[k];
      img[k] = im;
      return im.decode();
    }));
  }

  // ------------------------------------------------------------ state
  var st = null;          // everything about the current attempt
  var lastDir = null;     // most recent direction pressed (for hold priority)

  function newAttempt() {
    var grid = ROOM.map(function (row) { return row.split(''); });
    var sc = 0, sr = 0;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      if (grid[r][c] === 'S') { sc = c; sr = r; grid[r][c] = '.'; }
    }
    st = {
      grid: grid,
      p: { c: sc, r: sr, fc: sc, fr: sr, t: 1, moving: false, facing: 'down' },
      keys: 0, moves: 0,
      buffer: null, bumpDir: null,
      unlocking: [],      // [{c, r, t}]
      done: false
    };
  }

  function restartRoom() {
    newAttempt();
    A.ui.hideOverlay();
  }

  // ------------------------------------------------------------ rules
  function tileAt(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return '#';
    return st.grid[r][c];
  }

  // Can the warrior step onto (c, r) right now?
  function enterable(c, r) {
    var t = tileAt(c, r);
    if (t === '#') return false;
    if (t === 'D') return st.keys > 0;
    return true; // ground, key, trophy, door that is mid-unlock
  }

  function tryStep(dir, fresh) {
    var d = DIRS[dir], p = st.p;
    var nc = p.c + d.dc, nr = p.r + d.dr;
    p.facing = dir;
    if (!enterable(nc, nr)) {
      // Bump once per press; a held key against a wall stays quiet after the first bump.
      if (fresh || st.bumpDir !== dir) {
        st.bumpDir = dir;
        A.sfx.play('bounce');
      }
      return false;
    }
    st.bumpDir = null;
    if (tileAt(nc, nr) === 'D') {
      st.keys--;
      st.grid[nr][nc] = 'd';            // unlocking: drawn as a brightening door, walkable
      st.unlocking.push({ c: nc, r: nr, t: 0 });
      A.sfx.play('unlock');
    }
    p.fc = p.c; p.fr = p.r; p.c = nc; p.r = nr; p.t = 0; p.moving = true;
    return true;
  }

  function arrive() {
    var p = st.p;
    p.moving = false; p.t = 1;
    st.moves++;
    var t = tileAt(p.c, p.r);
    var cx = p.c * TILE + TILE / 2, cy = p.r * TILE + TILE / 2;
    if (t === 'K') {
      st.keys++;
      st.grid[p.r][p.c] = '.';
      A.sfx.play('pickup');
      A.fx.burst(cx, cy, { color: TH.brass, count: 10, speed: 140, life: 0.35, gravity: 0 });
    } else if (t === 'T') {
      roomComplete();
    }
  }

  function roomComplete() {
    st.done = true;
    A.sfx.play('win');
    A.fx.flash('rgba(239,208,150,0.45)', 220);
    A.ui.overlay({
      kicker: 'Room cleared',
      title: st.moves + ' moves',
      hint: 'Space to play again',
      action: restartRoom
    });
  }

  // ------------------------------------------------------------ input
  function dirHeld(dir) {
    for (var i = 0; i < CODES.length; i++) {
      if (KEYMAP[CODES[i]] === dir && A.input.isDown(CODES[i])) return true;
    }
    return false;
  }

  function readPresses() {
    for (var i = 0; i < CODES.length; i++) {
      if (A.input.wasPressed(CODES[i])) { st.buffer = KEYMAP[CODES[i]]; lastDir = st.buffer; }
    }
  }

  // Next direction to walk: a buffered press first, then whatever is held.
  function nextDir() {
    if (st.buffer) { var b = st.buffer; st.buffer = null; return { dir: b, fresh: true }; }
    if (lastDir && dirHeld(lastDir)) return { dir: lastDir, fresh: false };
    for (var i = 0; i < DIR_ORDER.length; i++) if (dirHeld(DIR_ORDER[i])) return { dir: DIR_ORDER[i], fresh: false };
    st.bumpDir = null;
    return null;
  }

  function onPointerDown(pt) {
    if (!st || st.done) return;
    var tc = Math.floor(pt.x / TILE), tr = Math.floor(pt.y / TILE);
    var dc = tc - st.p.c, dr = tr - st.p.r;
    if (dc === 0 && dr === 0) return;
    // Step one tile toward the tapped tile along the dominant axis (adjacent tap = step there).
    if (Math.abs(dc) >= Math.abs(dr)) st.buffer = dc > 0 ? 'right' : 'left';
    else st.buffer = dr > 0 ? 'down' : 'up';
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    if (!st || A.ui.overlayVisible()) return;
    var ms = dt * 1000;

    for (var i = st.unlocking.length - 1; i >= 0; i--) {
      var u = st.unlocking[i];
      u.t += ms;
      if (u.t >= UNLOCK_MS) {
        if (st.grid[u.r][u.c] === 'd') st.grid[u.r][u.c] = '.';
        st.unlocking.splice(i, 1);
      }
    }

    if (st.done) return;
    readPresses();

    var p = st.p;
    if (p.moving) {
      p.t += ms / STEP_MS;
      if (p.t < 1) return;
      var carry = (p.t - 1) * STEP_MS;
      arrive();
      if (st.done) return;
      var n = nextDir();
      if (n && tryStep(n.dir, n.fresh)) p.t = Math.min(carry / STEP_MS, 0.5);
      return;
    }
    var nd = nextDir();
    if (nd) tryStep(nd.dir, nd.fresh);
  }

  // ------------------------------------------------------------ draw
  function drawTile(c, r, t, ctx) {
    var x = c * TILE, y = r * TILE;
    if (t === '#') { ctx.drawImage(img['#'], x, y); return; }
    ctx.drawImage(img['.'], x, y);
    if (t === 'K' || t === 'T' || t === 'D') ctx.drawImage(img[t], x, y);
    else if (t === 'd') {
      var u = null;
      for (var i = 0; i < st.unlocking.length; i++) if (st.unlocking[i].c === c && st.unlocking[i].r === r) u = st.unlocking[i];
      var k = u ? Math.min(1, u.t / UNLOCK_MS) : 1;
      ctx.save();
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.drawImage(img.D, x, y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k * 0.8;
      ctx.fillStyle = TH.brassHi;
      ctx.fillRect(x + 6, y + 4, TILE - 12, TILE - 6);
      ctx.restore();
    }
  }

  function heroPos() {
    var p = st.p, k = p.moving ? p.t : 1;
    return {
      x: (p.fc + (p.c - p.fc) * k) * TILE,
      y: (p.fr + (p.r - p.fr) * k) * TILE
    };
  }

  function draw(ctx) {
    ctx.fillStyle = TH.black;
    ctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);
    if (!st) return;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) drawTile(c, r, st.grid[r][c], ctx);
    var hp = heroPos();
    ctx.drawImage(img.hero, hp.x, hp.y);
  }

  // ------------------------------------------------------------ boot
  A.init({ game: 'warrior', title: 'Warrior Legends', onRestart: restartRoom });
  A.input.capture(CODES);
  A.input.onPointerDown(onPointerDown);
  A.touch.dpad({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' });

  newAttempt();
  loadImages().then(function () {
    A.loop(update, draw);
  }, function (err) {
    A.ui.overlay({ title: 'Could not load images', lines: [String(err && err.message || err)] });
  });

  // Read-only snapshot for debugging from the console.
  window.WarriorLegends = {
    debug: function () {
      return st && { c: st.p.c, r: st.p.r, moving: st.p.moving, facing: st.p.facing, keys: st.keys, moves: st.moves, done: st.done };
    }
  };
})();

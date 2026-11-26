/*
 * Warrior Legends — game logic on top of the shared arcade shell (js/arcade-shell.js).
 * Plain script, no modules: reads window.Arcade and the global ROOMS from js/rooms.js.
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
  var NROOMS = ROOMS.length;

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

  // ------------------------------------------------------------ progress (localStorage via Arcade.store)
  // arcade.warrior.progress = { unlocked, bests: { [room]: { ms, moves } }, deadlineBests: { [room]: ms } }
  // arcade.warrior.best     = rooms cleared (0–8)
  function loadProgress() {
    var p = A.store.get('progress', null);
    if (!p || typeof p !== 'object') p = {};
    var unlocked = Math.max(1, Math.min(NROOMS, p.unlocked | 0));
    return {
      unlocked: unlocked,
      bests: p.bests && typeof p.bests === 'object' ? p.bests : {},
      deadlineBests: p.deadlineBests && typeof p.deadlineBests === 'object' ? p.deadlineBests : {}
    };
  }
  var progress = null;   // loaded after Arcade.init, which sets the storage namespace

  function roomsCleared() {
    var n = 0;
    for (var i = 1; i <= NROOMS; i++) if (progress.bests[i] || progress.deadlineBests[i]) n++;
    return n;
  }

  // ------------------------------------------------------------ state
  var roomIx = 0;         // 0-based index into ROOMS
  var st = null;          // everything about the current attempt
  var lastDir = null;     // most recent direction pressed (for hold priority)
  var run = {};           // this session's chain of clears: { [room]: { ms, moves } }

  function newAttempt() {
    var src = ROOMS[roomIx].grid;
    var grid = src.map(function (row) { return row.split(''); });
    var sc = 0, sr = 0;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      if (grid[r][c] === 'S') { sc = c; sr = r; grid[r][c] = '.'; }
    }
    st = {
      grid: grid,
      p: { c: sc, r: sr, fc: sc, fr: sr, t: 1, moving: false, facing: 'down' },
      keys: 0, moves: 0,
      started: false, ms: 0,
      buffer: null, bumpDir: null,
      unlocking: [],      // [{c, r, t}]
      done: false
    };
    lastDir = null;
    updateHud();
  }

  function startRoom(ix) {
    roomIx = Math.max(0, Math.min(NROOMS - 1, ix));
    A.ui.hideOverlay();
    A.fx.clear();
    newAttempt();
  }

  function restartRoom() { startRoom(roomIx); }

  // ------------------------------------------------------------ rules
  function tileAt(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return '#';
    return st.grid[r][c];
  }

  function doorsLeft() {
    var n = 0;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (st.grid[r][c] === 'D') n++;
    return n;
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
    st.started = true;                  // the timer starts on the first move
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

  // ------------------------------------------------------------ completion
  function roomComplete() {
    st.done = true;
    var n = roomIx + 1, ms = Math.round(st.ms), moves = st.moves;
    A.sfx.play('win');
    A.fx.flash('rgba(239,208,150,0.45)', 220);

    // Save bests and unlock the next room.
    var prev = progress.bests[n];
    var newTime = !prev || ms < prev.ms;
    progress.bests[n] = {
      ms: prev ? Math.min(prev.ms, ms) : ms,
      moves: prev ? Math.min(prev.moves, moves) : moves
    };
    progress.unlocked = Math.max(progress.unlocked, Math.min(NROOMS, n + 1));
    A.store.set('progress', progress);
    A.store.best('best', roomsCleared());

    run[n] = { ms: ms, moves: moves };
    updateHud();

    if (n === NROOMS) { dungeonCleared(); return; }

    var best = progress.bests[n];
    A.ui.overlay({
      kicker: 'Room ' + n + ' cleared',
      title: A.fmt.time(ms, 1),
      lines: [
        'Moves ' + moves + ' (par ' + ROOMS[roomIx].par + ')',
        newTime && prev ? 'New best!' : 'Best ' + A.fmt.time(best.ms, 1)
      ],
      buttons: [
        { label: 'Next room', onClick: function () { startRoom(roomIx + 1); } },
        { label: 'Retry', onClick: restartRoom },
        { label: 'Copy', keepOpen: true, onClick: function () { A.share.copy(roomShare(n, ms, moves)); } },
        { label: 'Rooms', onClick: showStart }
      ],
      hint: 'Space for the next room · R to retry',
      action: function () { startRoom(roomIx + 1); }
    });
  }

  function runTotals() {
    var t = { ms: 0, moves: 0, rooms: 0 };
    Object.keys(run).forEach(function (k) { t.ms += run[k].ms; t.moves += run[k].moves; t.rooms++; });
    return t;
  }

  function dungeonCleared() {
    var t = runTotals(), last = run[NROOMS];
    A.ui.overlay({
      kicker: 'Room ' + NROOMS + ' cleared · ' + A.fmt.time(last.ms, 1) + ' · ' + last.moves + ' moves',
      title: 'Dungeon cleared',
      lines: [
        'Total time ' + clock(t.ms),
        'Total moves ' + t.moves,
        t.rooms < NROOMS ? 'This run: ' + t.rooms + '/' + NROOMS + ' rooms — start at room 1 for a full run' : 'All ' + NROOMS + ' rooms in one run'
      ],
      buttons: [
        { label: 'Copy', keepOpen: true, onClick: function () { A.share.copy(runShare()); } },
        { label: 'Retry room ' + NROOMS, onClick: restartRoom },
        { label: 'Rooms', onClick: showStart }
      ],
      hint: 'Space for the room list',
      action: showStart
    });
  }

  // m:ss.t for run totals (3:12.6); plain seconds under a minute.
  function clock(ms) {
    if (ms < 60000) return A.fmt.time(ms, 1);
    var tenths = Math.floor(ms / 100), m = Math.floor(tenths / 600), s = (tenths % 600) / 10;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function roomShare(n, ms, moves) {
    return '🗝️ Warrior Legends · Room ' + n + ' · ' + A.fmt.time(ms, 1) + ' · ' + moves + ' moves (par ' + ROOMS[n - 1].par + ')';
  }
  function runShare() {
    var t = runTotals();
    return '🗝️ Warrior Legends · ' + t.rooms + '/' + NROOMS + ' rooms · ' + clock(t.ms) + ' · ' + t.moves + ' moves';
  }

  // ------------------------------------------------------------ start overlay / room select
  function showStart() {
    var target = Math.min(progress.unlocked, NROOMS) - 1;
    var buttons = [];
    for (var i = 0; i < NROOMS; i++) {
      (function (ix) {
        var locked = ix + 1 > progress.unlocked;
        buttons.push({
          label: String(ix + 1),
          locked: locked,
          onClick: function () { if (!locked) { run = {}; startRoom(ix); } }
        });
      })(i);
    }
    roomIx = target;
    newAttempt();
    st.done = true; // nothing moves behind the start overlay
    A.ui.overlay({
      kicker: 'Rooms cleared ' + roomsCleared() + '/' + NROOMS,
      title: 'Warrior Legends',
      lines: ['Grab the keys. Every door costs one. Not every door is worth it.'],
      buttons: buttons,
      hint: 'Space to play room ' + (target + 1),
      action: function () { run = {}; startRoom(target); }
    });
    decorateRoomButtons(buttons);
  }

  // The shell's overlay has no notion of disabled buttons; grey out locked rooms after it renders.
  function decorateRoomButtons(buttons) {
    var els = document.querySelectorAll('.arcade-overlay .arcade-btn');
    Array.prototype.forEach.call(els, function (btn, i) {
      var b = buttons[i];
      if (!b) return;
      btn.classList.add('wl-room');
      if (b.locked) { btn.disabled = true; btn.title = 'Locked'; btn.setAttribute('aria-label', 'Room ' + b.label + ' (locked)'); }
      else {
        var best = progress.bests[i + 1];
        btn.title = ROOMS[i].name + (best ? ' · best ' + A.fmt.time(best.ms, 1) + ' · ' + best.moves + ' moves' : '');
        if (best) btn.classList.add('wl-cleared');
      }
    });
  }

  // ------------------------------------------------------------ HUD
  function updateHud() {
    if (!st) return;
    var room = ROOMS[roomIx];
    A.ui.hud({
      Room: (roomIx + 1) + '/' + NROOMS + ' · ' + room.name,
      Keys: st.keys,
      'Doors left': doorsLeft(),
      Moves: st.moves + ' (par ' + room.par + ')',
      Time: A.fmt.time(st.ms, 1)
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
    if (st.started) st.ms += ms;
    readPresses();
    step(ms);
    updateHud();
  }

  function step(ms) {
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
  progress = loadProgress();
  A.input.capture(CODES);
  A.input.onPointerDown(onPointerDown);
  A.touch.dpad({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' });

  newAttempt();
  loadImages().then(function () {
    A.loop(update, draw);
    showStart();
  }, function (err) {
    A.ui.overlay({ title: 'Could not load images', lines: [String(err && err.message || err)] });
  });

  // Read-only snapshot for debugging from the console.
  window.WarriorLegends = {
    debug: function () {
      return st && {
        room: roomIx + 1, c: st.p.c, r: st.p.r, moving: st.p.moving, facing: st.p.facing,
        keys: st.keys, moves: st.moves, ms: Math.round(st.ms), started: st.started, done: st.done,
        doorsLeft: doorsLeft()
      };
    }
  };
})();

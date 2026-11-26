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
  var HERO_PX = 32;             // 16×16 sprite drawn at 2× inside a 50 px tile
  var BREATHE_MS = 600;         // idle breathe frame period
  var TORCH_CLEAR = 2.5;        // tiles: fully lit inside this radius
  var TORCH_DARK = 4;           // tiles: torchlight gone at this radius
  var SEEN_R = 3.75;            // tiles: anything this close (centre to centre) is remembered
  var REMEMBERED_DARK = 0.65;   // seen-but-far tiles drawn at 35% brightness
  var DEADLINE_MS = 30000;      // Deadline mode: time per room
  var reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ------------------------------------------------------------ images
  var IMG_FILES = {
    '.': 'world_ground.png', '#': 'world_wall.png', T: 'world_goal.png',
    K: 'world_key.png', D: 'world_door.png'
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
  var seenByRoom = {};    // remembered tiles per room for this session (kept across retries)
  var clockMs = 0;        // animation clock
  var deadline = false;   // Deadline mode (toggled on the start overlay; not persisted)
  var darkCv = null, darkCtx = null;

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
      started: false, ms: 0, lastSec: Math.ceil(DEADLINE_MS / 1000),
      buffer: null, bumpDir: null,
      unlocking: [],      // [{c, r, t}]
      stepCount: 0,       // walk-cycle parity and quiet footstep ticks
      seen: seenByRoom[roomIx] || (seenByRoom[roomIx] = new Array(ROWS * COLS)),
      done: false
    };
    lastDir = null;
    markSeen();
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

  // Remember every tile near the warrior's current (destination) tile.
  function markSeen() {
    var p = st.p, R = Math.ceil(SEEN_R);
    for (var r = p.r - R; r <= p.r + R; r++) for (var c = p.c - R; c <= p.c + R; c++) {
      if (r < 0 || c < 0 || r >= ROWS || c >= COLS) continue;
      var dc = c - p.c, dr = r - p.r;
      if (dc * dc + dr * dr <= SEEN_R * SEEN_R) st.seen[r * COLS + c] = true;
    }
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
        if (!reducedMotion) A.fx.shake(2, 90);
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
    st.stepCount++;
    if (st.stepCount % 2 === 0) A.sfx.tone({ freq: 880, dur: 0.03, type: 'square', vol: 0.05 }); // quiet tick
    markSeen();
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

    // Save bests (Deadline runs keep their own) and unlock the next room.
    var prevMs, bestMs;
    if (deadline) {
      prevMs = progress.deadlineBests[n];
      progress.deadlineBests[n] = prevMs == null ? ms : Math.min(prevMs, ms);
      bestMs = progress.deadlineBests[n];
    } else {
      var prev = progress.bests[n];
      prevMs = prev ? prev.ms : null;
      progress.bests[n] = {
        ms: prev ? Math.min(prev.ms, ms) : ms,
        moves: prev ? Math.min(prev.moves, moves) : moves
      };
      bestMs = progress.bests[n].ms;
    }
    var newBest = prevMs != null && ms < prevMs;
    progress.unlocked = Math.max(progress.unlocked, Math.min(NROOMS, n + 1));
    A.store.set('progress', progress);
    A.store.best('best', roomsCleared());
    A.store.bumpPlays();

    run[n] = { ms: ms, moves: moves };
    updateHud();

    if (n === NROOMS) { dungeonCleared(); return; }

    A.ui.overlay({
      kicker: 'Room ' + n + ' cleared' + (deadline ? ' · Deadline' : ''),
      title: A.fmt.time(ms, 1),
      lines: [
        'Moves ' + moves + ' (par ' + ROOMS[roomIx].par + ')',
        parLine(moves, ROOMS[roomIx].par),
        newBest ? '<span style="color:' + TH.brassHi + '">New best!</span>' : 'Best ' + A.fmt.time(bestMs, 1) + (deadline ? ' (Deadline)' : '')
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

  function parLine(moves, par) {
    if (moves <= par) return '<span style="color:' + TH.brass + '">Par!</span>';
    return '+' + (moves - par) + ' over par';
  }

  // Deadline: the clock ran out. Restart the room.
  function outOfTime() {
    A.sfx.play('lose');
    A.fx.flash('rgba(255,122,89,0.45)', 260);
    A.ui.toast('Out of time');
    newAttempt();
  }

  function runTotals() {
    var t = { ms: 0, moves: 0, rooms: 0 };
    Object.keys(run).forEach(function (k) { t.ms += run[k].ms; t.moves += run[k].moves; t.rooms++; });
    return t;
  }

  function dungeonCleared() {
    var t = runTotals(), last = run[NROOMS];
    A.ui.overlay({
      kicker: 'Room ' + NROOMS + ' cleared · ' + A.fmt.time(last.ms, 1) + ' · ' + last.moves + ' moves' + (deadline ? ' · Deadline' : ''),
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
    buttons.push({
      label: 'Deadline: ' + (deadline ? 'on · 30 s' : 'off'),
      toggle: true,
      keepOpen: true,
      onClick: function () { deadline = !deadline; showStart(); }
    });
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
      if (b.toggle) {
        btn.classList.add('wl-toggle');
        btn.setAttribute('aria-pressed', deadline ? 'true' : 'false');
        btn.title = 'Deadline mode: 30 seconds per room; the room restarts when time runs out';
        return;
      }
      btn.classList.add('wl-room');
      if (b.locked) { btn.disabled = true; btn.title = 'Locked'; btn.setAttribute('aria-label', 'Room ' + b.label + ' (locked)'); }
      else {
        var best = progress.bests[i + 1], dl = progress.deadlineBests[i + 1];
        btn.title = ROOMS[i].name +
          (best ? ' · best ' + A.fmt.time(best.ms, 1) + ' · ' + best.moves + ' moves' : '') +
          (dl != null ? ' · Deadline best ' + A.fmt.time(dl, 1) : '');
        if (best || dl != null) btn.classList.add('wl-cleared');
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
      Time: timeText()
    });
  }

  function timeText() {
    if (!deadline) return A.fmt.time(st.ms, 1);
    var left = Math.max(0, DEADLINE_MS - st.ms), txt = A.fmt.time(left, 1);
    return left < 10000 ? '<span style="color:' + TH.coral + '">' + txt + '</span>' : txt;
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
    clockMs += ms;

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
    if (deadline && st.started) {
      var left = DEADLINE_MS - st.ms, sec = Math.ceil(left / 1000);
      if (left <= 0) { outOfTime(); return; }
      if (sec < st.lastSec) {
        st.lastSec = sec;
        if (sec < 10) A.sfx.play('countdown', sec === 1);
      }
    }
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

  function heroFrame() {
    var p = st.p, f = SPRITES.frames[p.facing] || SPRITES.frames.down;
    if (p.moving) return f[st.stepCount % 2];
    if (reducedMotion) return f[0];
    return f[Math.floor(clockMs / BREATHE_MS) % 2 === 0 ? 0 : 2];
  }

  function drawHero(ctx, hp) {
    var off = (TILE - HERO_PX) / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(heroFrame(), Math.round(hp.x + off), Math.round(hp.y + off), HERO_PX, HERO_PX);
    ctx.restore();
  }

  // Fog of war: unseen tiles black, remembered tiles dim, a torch gradient around the warrior.
  function drawTorch(ctx, hp) {
    var W = COLS * TILE, H = ROWS * TILE;
    if (!darkCv) { darkCv = document.createElement('canvas'); darkCv.width = W; darkCv.height = H; darkCtx = darkCv.getContext('2d'); }
    var d = darkCtx;
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      d.fillStyle = st.seen[r * COLS + c] ? 'rgba(4,9,10,' + REMEMBERED_DARK + ')' : TH.black;
      d.fillRect(c * TILE, r * TILE, TILE, TILE);
    }
    var flick = reducedMotion ? 1 : 1 + 0.03 * Math.sin(clockMs / 110) + 0.02 * Math.sin(clockMs / 47);
    var cx = hp.x + TILE / 2, cy = hp.y + TILE / 2, R = TORCH_DARK * TILE * flick;
    var grad = d.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(TORCH_CLEAR / TORCH_DARK, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    d.globalCompositeOperation = 'destination-out';
    d.fillStyle = grad;
    d.fillRect(0, 0, W, H);
    ctx.drawImage(darkCv, 0, 0);

    // Keys, doors and the trophy stay visible once seen, even out of the torchlight.
    ctx.save();
    ctx.globalAlpha = 0.7;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var t = st.grid[r][c];
      if ((t === 'K' || t === 'D' || t === 'T') && st.seen[r * COLS + c]) ctx.drawImage(img[t], c * TILE, r * TILE);
    }
    ctx.restore();
  }

  function draw(ctx) {
    ctx.fillStyle = TH.black;
    ctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);
    if (!st) return;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) drawTile(c, r, st.grid[r][c], ctx);
    var hp = heroPos();
    drawHero(ctx, hp);
    drawTorch(ctx, hp);
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
        deadline: deadline, doorsLeft: doorsLeft(), seen: st.seen.filter(Boolean).length, reducedMotion: reducedMotion
      };
    }
  };
})();

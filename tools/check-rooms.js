#!/usr/bin/env node
/*
 * check-rooms.js — solvability and key-economy check for js/rooms.js.
 * Not loaded by the page. No dependencies:  node tools/check-rooms.js [--paths] [--json]
 *
 * Exhaustive BFS over (tile, doors opened, keys collected). Picking up a key never hurts,
 * so the only irreversible choice is which doors to spend keys on. For each room it reports:
 *   solvable, minimum moves (and the par that follows), the fewest doors a solution opens,
 *   keys and doors in the room, and whether a wrong choice is possible: a reachable state
 *   from which the trophy can no longer be reached ("trap") — that is a door decision.
 * Warnings: unsolvable; no decision (no trap and every solution spends every key).
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var COLS = 16, ROWS = 12;
var MOVES = [[0, -1, 'U'], [0, 1, 'D'], [-1, 0, 'L'], [1, 0, 'R']];

function loadRooms(file) {
  var src = fs.readFileSync(file, 'utf8');
  var sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: file });
  return sandbox.ROOMS || sandbox.window.ROOMS;
}

function popcount(n) { var c = 0; while (n) { n &= n - 1; c++; } return c; }

function parse(room) {
  var g = room.grid, start = -1, goal = [], doorId = {}, keyId = {}, nd = 0, nk = 0, errs = [];
  if (g.length !== ROWS) errs.push('grid has ' + g.length + ' rows, expected ' + ROWS);
  for (var r = 0; r < g.length; r++) {
    if (g[r].length !== COLS) errs.push('row ' + r + ' has ' + g[r].length + ' chars');
    for (var c = 0; c < g[r].length; c++) {
      var ch = g[r][c], i = r * COLS + c;
      if ('#.STKD'.indexOf(ch) < 0) errs.push('bad char ' + JSON.stringify(ch) + ' at ' + c + ',' + r);
      if ((r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1) && ch !== '#') errs.push('border not wall at ' + c + ',' + r);
      if (ch === 'S') { if (start >= 0) errs.push('two starts'); start = i; }
      if (ch === 'T') goal.push(i);
      if (ch === 'D') doorId[i] = nd++;
      if (ch === 'K') keyId[i] = nk++;
    }
  }
  if (start < 0) errs.push('no start');
  if (!goal.length) errs.push('no trophy');
  // Floor that can't be reached even with unlimited keys is dead space: it should be wall.
  if (!errs.length) {
    var seen = {}, stack = [start];
    seen[start] = 1;
    while (stack.length) {
      var t0 = stack.pop();
      for (var m = 0; m < 4; m++) {
        var cc = t0 % COLS + MOVES[m][0], rr = ((t0 / COLS) | 0) + MOVES[m][1], t1 = rr * COLS + cc;
        if (g[rr][cc] !== '#' && !seen[t1]) { seen[t1] = 1; stack.push(t1); }
      }
    }
    for (var r2 = 0; r2 < ROWS; r2++) for (var c2 = 0; c2 < COLS; c2++) {
      if (g[r2][c2] !== '#' && !seen[r2 * COLS + c2]) { errs.push('unreachable tile at ' + c2 + ',' + r2); r2 = ROWS; break; }
    }
  }
  return { g: g, start: start, doorId: doorId, keyId: keyId, nd: nd, nk: nk, errs: errs };
}

function solve(room) {
  var P = parse(room);
  if (P.errs.length) return { errors: P.errs };
  var nd = P.nd, g = P.g;
  // state id = ((collected << nd) | opened) * 192 + tile
  function enc(tile, opened, coll) { return ((coll * Math.pow(2, nd)) + opened) * 192 + tile; }

  var index = new Map(), states = [], parent = [], via = [], dist = [], succ = [];
  function add(tile, opened, coll, from, mv) {
    var id = enc(tile, opened, coll);
    var ix = index.get(id);
    if (ix !== undefined) return ix;
    ix = states.length;
    index.set(id, ix);
    states.push([tile, opened, coll]);
    parent.push(from); via.push(mv); dist.push(from < 0 ? 0 : dist[from] + 1); succ.push(null);
    return ix;
  }

  add(P.start, 0, 0, -1, '');
  var wins = [];
  for (var q = 0; q < states.length; q++) {
    var s = states[q], tile = s[0], opened = s[1], coll = s[2];
    var c0 = tile % COLS, r0 = (tile / COLS) | 0;
    if (g[r0][c0] === 'T') { wins.push(q); succ[q] = []; continue; } // reaching the trophy ends the room
    var held = popcount(coll) - popcount(opened), out = [];
    for (var m = 0; m < 4; m++) {
      var c = c0 + MOVES[m][0], r = r0 + MOVES[m][1], ch = g[r][c], t = r * COLS + c;
      var no = opened, nc = coll;
      if (ch === '#') continue;
      if (ch === 'D') {
        var bit = 1 << P.doorId[t];
        if (!(opened & bit)) { if (held <= 0) continue; no = opened | bit; }
      }
      if (ch === 'K') nc = coll | (1 << P.keyId[t]);
      out.push(add(t, no, nc, q, MOVES[m][2]));
    }
    succ[q] = out;
  }

  var res = {
    states: states.length, keys: P.nk, doors: P.nd, solvable: wins.length > 0,
    minMoves: null, minDoors: null, par: null, trap: false, trapExample: null, path: ''
  };
  if (!wins.length) return res;

  var best = wins[0];
  wins.forEach(function (w) { if (dist[w] < dist[best]) best = w; });
  res.minMoves = dist[best];
  res.par = Math.round(res.minMoves * 1.1);
  res.minDoors = Math.min.apply(null, wins.map(function (w) { return popcount(states[w][1]); }));
  var everyWinSpendsAll = wins.every(function (w) { return popcount(states[w][1]) >= P.nk; });
  res.spendsAllKeys = everyWinSpendsAll;
  for (var p = best, moves = []; p > 0; p = parent[p]) moves.push(via[p]);
  res.path = moves.reverse().join('');

  // Backward reachability: which states can still reach a win?
  var pred = states.map(function () { return []; });
  succ.forEach(function (out, i) { out.forEach(function (j) { pred[j].push(i); }); });
  var alive = new Uint8Array(states.length), stack = wins.slice();
  wins.forEach(function (w) { alive[w] = 1; });
  while (stack.length) {
    var x = stack.pop();
    pred[x].forEach(function (y) { if (!alive[y]) { alive[y] = 1; stack.push(y); } });
  }
  for (var i = 0; i < states.length; i++) {
    if (!alive[i]) {
      res.trap = true;
      var st = states[i], open = [];
      Object.keys(P.doorId).forEach(function (t) { if (st[1] & (1 << P.doorId[t])) open.push((t % COLS) + ',' + ((t / COLS) | 0)); });
      res.trapExample = 'opened ' + open.join(' ') + ' (c,r)';
      break;
    }
  }
  return res;
}

function main() {
  var args = process.argv.slice(2);
  var file = args.filter(function (a) { return a[0] !== '-'; })[0] || path.join(__dirname, '..', 'js', 'rooms.js');
  var rooms = loadRooms(file);
  if (!rooms || !rooms.length) { console.error('No ROOMS found in ' + file); process.exit(2); }
  var bad = 0, decisions = 0, out = [];
  rooms.forEach(function (room, i) {
    var r = solve(room);
    r.room = i + 1; r.name = room.name; r.declaredPar = room.par;
    out.push(r);
    var warn = [];
    if (r.errors) { warn.push('INVALID: ' + r.errors.join('; ')); bad++; }
    else if (!r.solvable) { warn.push('UNSOLVABLE'); bad++; }
    else {
      if (r.trap) decisions++;
      if (!r.trap && r.spendsAllKeys) warn.push('no decision: every solution spends every key');
      else if (!r.trap) warn.push('no trap: a wrong door never loses the room');
      if (room.par !== r.par) { warn.push('par in rooms.js is ' + room.par + ', checker says ' + r.par); bad++; }
    }
    if (args.indexOf('--json') < 0 && r.errors) console.log(pad(r.room + '. ' + room.name, 24) + 'INVALID    ' + r.errors.join('; '));
    else if (args.indexOf('--json') < 0) {
      console.log(
        pad(r.room + '. ' + room.name, 24) +
        (r.solvable ? 'solvable' : 'UNSOLVABLE').padEnd(11) +
        ('moves ' + (r.minMoves == null ? '-' : r.minMoves)).padEnd(10) +
        ('par ' + (r.par == null ? '-' : r.par)).padEnd(8) +
        ('doors ' + (r.minDoors == null ? '-' : r.minDoors) + '/' + r.doors).padEnd(11) +
        ('keys ' + r.keys).padEnd(8) +
        (r.trap ? 'decision' : '-').padEnd(9) +
        (warn.length ? ' WARN ' + warn.join('; ') : '')
      );
      if (args.indexOf('--paths') >= 0 && r.path) console.log('    path ' + r.path + (r.trapExample ? '\n    trap ' + r.trapExample : ''));
    }
  });
  if (args.indexOf('--json') >= 0) console.log(JSON.stringify(out, null, 1));
  else console.log('\n' + rooms.length + ' rooms, ' + decisions + ' with a door decision (a wrong door can lose the room), ' + bad + ' problem(s).');
  process.exit(bad ? 1 : 0);
}

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

if (require.main === module) main();
module.exports = { solve: solve, loadRooms: loadRooms };

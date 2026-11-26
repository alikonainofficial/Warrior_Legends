/*
 * sprites.js — the warrior, an original 16×16 pixel character: a hooded torch-bearer in a teal
 * cloak over a brass tunic. Drawn as character grids and rendered once to offscreen canvases.
 * Defines the global SPRITES: SPRITES.frames[facing][i] (i = 0, 1 walk; 2 idle breathe) and
 * SPRITES.size (16). Left-facing frames are the right-facing grids mirrored.
 */
var SPRITES = (function () {
  'use strict';
  var T = (window.Arcade && window.Arcade.theme) || {};

  var PALETTE = {
    o: T.black || '#04090a',   // outline
    h: T.cyan || '#5fe0d4',    // hood / cloak highlight (teal)
    c: '#2b8c85',              // cloak (deep teal)
    s: T.rose || '#e7a196',    // skin
    t: T.brass || '#e2bb6e',   // tunic (brass)
    y: '#b48a3e',              // tunic shade
    l: T.surface || '#163a42', // belt
    b: '#5a3a22',              // boots
    w: '#8a5a2b',              // torch handle
    f: T.coral || '#ff7a59',   // flame
    g: T.yellow || '#f2d16b'   // flame core
  };

  // Two walk frames per facing. The torch is drawn into each grid.
  var GRIDS = {
    down: [[
      '................',
      '......oooo......',
      '....oohhhhoo.f..',
      '...ohhhhhhhhofgf',
      '...ohhccccchho f',
      '..ohcsossoscho w',
      '..ohcsssssscho.w',
      '..ohhcsssschho.w',
      '..occcttttccco s',
      '.occcttyyttccco.',
      '.occttllllttcco.',
      '.occttyttyttcco.',
      '..occttttttcco..',
      '....obboobbo....',
      '...obbo..obbo...',
      '...oooo..oooo...'
    ], [
      '................',
      '......oooo......',
      '....oohhhhoo.f..',
      '...ohhhhhhhhofgf',
      '...ohhccccchho f',
      '..ohcsossoscho w',
      '..ohcsssssscho.w',
      '..ohhcsssschho.w',
      '..occcttttccco s',
      '.occcttyyttccco.',
      '.occttllllttcco.',
      '.occttyttyttcco.',
      '..occttttttcco..',
      '....obboobbo....',
      '....obboobbo....',
      '....oooooooo....'
    ]],
    up: [[
      '................',
      '......oooo......',
      '.f..oohhhhoo....',
      'fgf.ohhhhhhhho..',
      '.f.ohhhhhhhhho..',
      '.w.ohhhhhhhhhho.',
      '.w.ohhhhhhhhhho.',
      '.w.ohchhhhhhcho.',
      '.s.occcccccccco.',
      '.occcccccccccco.',
      '.occcccccccccco.',
      '.occcccccccccco.',
      '..occcccccccco..',
      '....obboobbo....',
      '...obbo..obbo...',
      '...oooo..oooo...'
    ], [
      '................',
      '......oooo......',
      '.f..oohhhhoo....',
      'fgf.ohhhhhhhho..',
      '.f.ohhhhhhhhho..',
      '.w.ohhhhhhhhhho.',
      '.w.ohhhhhhhhhho.',
      '.w.ohchhhhhhcho.',
      '.s.occcccccccco.',
      '.occcccccccccco.',
      '.occcccccccccco.',
      '.occcccccccccco.',
      '..occcccccccco..',
      '....obboobbo....',
      '....obboobbo....',
      '....oooooooo....'
    ]],
    right: [[
      '................',
      '.....oooo.......',
      '....ohhhhoo.....',
      '...ohhhhhhho.f..',
      '...ohhhcccco.fgf',
      '...ohhcssoso..f.',
      '...ohhcsssso..w.',
      '...ohhccssoo..w.',
      '...occcttto...w.',
      '..occcttyyocss..',
      '..occcllllo.....',
      '..occcttyto.....',
      '...occtttto.....',
      '....obbbbo......',
      '...obo..obo.....',
      '...ooo..ooo.....'
    ], [
      '................',
      '.....oooo.......',
      '....ohhhhoo.....',
      '...ohhhhhhho.f..',
      '...ohhhcccco.fgf',
      '...ohhcssoso..f.',
      '...ohhcsssso..w.',
      '...ohhccssoo..w.',
      '...occcttto...w.',
      '..occcttyyocss..',
      '..occcllllo.....',
      '..occcttyto.....',
      '...occtttto.....',
      '.....obbo.......',
      '.....obbo.......',
      '.....oooo.......'
    ]]
  };

  function mirror(grid) { return grid.map(function (row) { return row.split('').reverse().join(''); }); }
  GRIDS.left = GRIDS.right.map(mirror);

  // Idle breathe: the upper body sinks one pixel (rows 0–11 move down, row 12 is absorbed).
  function breathe(grid) {
    var out = grid.slice();
    for (var r = 12; r >= 1; r--) out[r] = grid[r - 1];
    out[0] = '................';
    return out;
  }

  function render(grid) {
    var cv = document.createElement('canvas');
    cv.width = 16; cv.height = 16;
    var g = cv.getContext('2d');
    for (var r = 0; r < 16; r++) for (var c = 0; c < 16; c++) {
      var ch = grid[r][c], col = PALETTE[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(c, r, 1, 1);
    }
    return cv;
  }

  var frames = {};
  Object.keys(GRIDS).forEach(function (facing) {
    var walk = GRIDS[facing];
    frames[facing] = [render(walk[0]), render(walk[1]), render(breathe(walk[0]))];
  });

  return { size: 16, frames: frames, grids: GRIDS, palette: PALETTE };
})();

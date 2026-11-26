# Warrior Legends — implementation plan

Repo: `alikonainofficial/Warrior_Legends` · Live: `https://alikonainofficial.github.io/Warrior_Legends/` · Game id for storage: `warrior`

## 0. What the repo is today

`index.html` loads `js/GraphicsCommon.js`, `Warrior.js`, `World.js`, `Input.js`, `ImageLoading.js`, `Main.js`. 800×600 canvas, `setInterval` 30 fps. `World.js` holds one 16×12 grid (`TILE_W/H 50`) with codes `0 ground, 1 wall, 2 player start, 3 goal (trophy), 4 key, 5 door`, PNG tiles in `images/`. The warrior moves 3 px/frame with WASD; a key tile increments `keysHeld`, a door tile consumes one key and becomes ground; the goal → `alert("You Won!")` and reset.

Facts about the current room (verified by search over the grid): 7 keys, 7 doors, and the **only** way to the trophy opens all 7 doors with all 7 keys. There is no decision to make.

Known defects:

- `alert()` on win; key count printed in the `#debugText` paragraph under the canvas; "out of bounds" text written there on every edge touch.
- Movement is an `if / else if` chain (no diagonals; fine) but collision uses the sprite's centre pixel, so it overlaps walls by half a tile.
- Arrow keys are defined in `Input.js` but not mapped; `preventDefault()` on all keys; `isWallAtTileCoord` references undefined `trackTileToIndex` / `WORLD_WALL`.
- `ImageLoading.js`: `imgVar.onload = countLoadedImageAndLaunchIfReady()` calls instead of assigns.
- The warrior sprite is recognisably Link (Nintendo). Must be replaced.
- No restart, timer, levels, sound, touch.

## 1. Target

A series of 8 handcrafted lock-and-key rooms where keys are scarce (planning which doors to open is the puzzle), grid-snapped movement with a walk cycle and four facings, a torch radius (fog of war), door/key/trophy feedback, instant restart, per-room timer and move counter with par, progress saved, an optional 30-second **Deadline** mode, and a copyable result line. Keyboard and touch. Original pixel sprite.

## 2. File layout after

```
index.html
css/arcade-shell.css   (copied, unmodified)
js/arcade-shell.js     (copied, unmodified)
js/rooms.js            ROOMS array (8 grids + par + name)
js/sprites.js          warrior sprite as a character grid, rendered to an offscreen canvas
js/game.js             everything else (replaces the 6 old files)
images/                keep tiles; delete warrior.png
tools/check-rooms.js   node script: solvability + key economy check (not loaded by the page)
```

## 3. Steps

### Step 1 — Shell, loop, grid movement
1. `Arcade.init({ game: 'warrior', title: 'Warrior Legends', onRestart: restartRoom })`; load the tile images with `Promise.all(img.decode())`.
2. Movement becomes **tile-snapped**: the warrior occupies a tile; a held direction (`ArrowUp/Down/Left/Right` or `WASD`) starts a 120 ms tween to the neighbouring tile if it is enterable; while a tween runs, input is buffered (the next direction is read when the tween ends, so holding a key walks continuously). Each completed step → `moves++`. This also fixes the half-tile overlap.
3. Enterable: ground, key, goal, door (only if `keys > 0`). Walking into a door with keys: consume a key, play `unlock`, door → ground (after a 150 ms unlock animation during which the tile draws a brightening door). Key tile: `keys++`, `pickup` sound, small `Arcade.fx.burst` in brass. Goal: `win` sound, flash, room complete.
4. Touch: `Arcade.touch.dpad({up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight'})`. Also tap-to-move: tapping a tile adjacent to the warrior steps there (optional, nice on phones).
5. `Arcade.input.capture([...8 keys...])`. Remove `#debugText`.

Acceptance: the current room plays with snapped movement and no alert; `R` restarts the room.

### Step 2 — Rooms with a key economy
1. `rooms.js`: `ROOMS = [{ name, par, grid }]`, grid as 12 strings of 16 chars: `#` wall, `.` ground, `S` start, `T` trophy, `K` key, `D` door. Convert the current room to this format as room 1 ("The tour") so the old level survives; tweak it so one door is not needed (remove one key and one door) to introduce the idea.
2. Author rooms 2–8 so that **keys < doors** in most, with dead-end doors that waste a key, rooms where the order of pickups matters, and one room where a door guards a key (net zero) as a trap. Difficulty rises with the number of decision points, not the size. Names like "Two locks, one key", "The vault", "Red herring". Par = minimum moves from the checker (Step 2.4) + 10% rounded.
3. HUD: `Arcade.ui.hud({ Room: '3/8 · The vault', Keys, 'Doors left': n, Moves: 'm (par p)', Time })`.
4. **Checker** `tools/check-rooms.js` (node, no deps): BFS over `(tile, consumedSet)` like the analysis that produced the facts above; prints for each room: solvable, minimum moves, minimum doors to open, keys available, and warns if a room is solvable without any decision (every solution uses all keys) or unsolvable. Run it before committing rooms; put the output in the README.
5. Room complete: overlay kicker `Room 3 cleared`, title = time, lines `Moves 31 (par 28)`, `Best 29.4 s`, buttons "Next room", "Retry", "Copy". Progress `arcade.warrior.progress = { unlocked: 4, bests: { 1: { ms, moves }, … } }`. Room select on the start overlay: buttons `1 … 8`, locked ones greyed.
6. After room 8: "Dungeon cleared" overlay with total time and total moves; `arcade.warrior.best` = rooms cleared (8 max) so the portfolio card can show `Rooms 5/8`.

Acceptance: all 8 rooms pass the checker; at least 5 require choosing which doors to open.

### Step 3 — Feel: sprite, animation, torch, sound
1. **Sprite** (`sprites.js`): an original 16×16 (drawn at 32×32 in a 50-px tile) character as an array of strings mapped to a small palette (e.g. `.` transparent, `h` hair, `s` skin, `t` tunic, `b` boots, `o` outline). Four facings × 2 walk frames = 8 grids; render each once to an offscreen canvas at load. Keep it clearly original: different silhouette, colours from `Arcade.theme` (brass tunic, teal cloak), no green cap, no sword/shield shape.
2. Walk cycle: alternate frames every step; facing from the last move direction. Idle: a 2-frame breathe every 600 ms.
3. **Torch:** after drawing the room, draw a radial gradient overlay from transparent at radius 2.5 tiles around the warrior to `rgba(4,9,10,0.92)` at 4 tiles; tiles once seen stay dim (keep a `seen` boolean per tile and draw unseen tiles black, seen-but-far tiles at 35% brightness). Keys and doors already seen remain visible. This turns the first run of a room into exploration and later runs into routing.
4. Sounds via `Arcade.sfx`: step `tick` every other step (quiet), key `pickup`, door `unlock`, trophy `win`, bump into wall `bounce` with a 2-px shake.
5. Reduced motion: no shake, torch edge without animation.

### Step 4 — Timer, par, Deadline mode, share
1. Timer starts on the first move, stops at the trophy; shown as `Arcade.fmt.time(ms, 1)`.
2. Par feedback on the complete overlay: "Par!" in brass when `moves ≤ par`, otherwise `+3 over par`.
3. **Deadline mode** toggle on the start overlay: 30 s per room; the HUD timer counts down in coral under 10 s with `countdown` ticks; at 0 the room restarts (`lose` sound, flash). Deadline bests are stored separately (`deadlineBests`).
4. Share: `🗝️ Warrior Legends · Room 3 · 14.8 s · 31 moves (par 28)`; after the full run `🗝️ Warrior Legends · 8/8 rooms · 3:12.6 · 241 moves`.
5. `Arcade.store.bumpPlays()` per room cleared.

### Step 5 — Polish and ship
- Start overlay: title, "Grab the keys. Every door costs one. Not every door is worth it.", room buttons, Deadline toggle, "Arrows / WASD / d-pad".
- Delete the six old JS files and `warrior.png`. README: rooms, par, modes, checker usage.

## 4. Data formats

- `arcade.warrior.best` → number, rooms cleared (0–8)
- `arcade.warrior.progress` → `{ unlocked, bests: { [room]: { ms, moves } }, deadlineBests: { [room]: ms } }`
- `arcade.warrior.plays` → number
- Share strings as in Step 4.4

## 5. Test checklist

- [ ] `node tools/check-rooms.js` reports all rooms solvable with sensible pars
- [ ] Snapped movement, no wall overlap, continuous walking while a key is held
- [ ] Door refuses with 0 keys (bump sound), opens with ≥ 1 and consumes exactly one
- [ ] Torch reveals tiles; seen tiles stay dim
- [ ] Timer starts on first move; par comparison correct; progress unlocks the next room; reload keeps progress
- [ ] Deadline mode restarts at 0 and keeps separate bests
- [ ] Sprite is original; `R` restarts; touch d-pad works; no console errors

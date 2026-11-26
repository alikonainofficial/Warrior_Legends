# Warrior Legends

Eight handcrafted lock-and-key rooms. Grab the keys. Every door costs one. Not every door is worth it.

Play: https://alikonainofficial.github.io/Warrior_Legends/

Originally built while following Chris DeLeon's *Hands-On Intro to Game Programming*; rebuilt on the shared
arcade cabinet shell used across the portfolio's games.

## How to play

- Move with the arrow keys or WASD (hold to keep walking). On phones, use the on-screen d-pad or tap a tile
  next to the warrior.
- Walking onto a key picks it up. Walking into a door spends one key and opens it. Reach the trophy.
- Keys are scarce: in every room some door, or opening doors in the wrong order, leaves the trophy out of reach.
  Press **R** to restart the room. **P** or **Esc** pauses.
- A torch lights a few tiles around you. Tiles you have seen stay dimly visible (for the rest of the session),
  and keys, doors and the trophy stay marked once seen, so a first attempt is exploration and later ones are routing.

## Rooms and par

| # | Room | Par |
|---|------|-----|
| 1 | The tour | 63 |
| 2 | Two locks, one key | 14 |
| 3 | Red herring | 24 |
| 4 | Fork in the hall | 34 |
| 5 | Long way round | 50 |
| 6 | The vault | 62 |
| 7 | Toll road | 36 |
| 8 | The keeper | 57 |

Par is the minimum number of moves found by the room checker plus 10%, rounded. Clearing a room unlocks the
next; the start screen lets you pick any unlocked room. Clearing room 8 shows the run's total time and moves.

## Modes

- **Normal:** the timer starts on your first move and stops at the trophy. Best time and fewest moves are kept
  per room.
- **Deadline:** toggle it on the start screen. 30 seconds per room; the countdown turns coral under 10 s, and at 0
  the room restarts. Deadline bests are kept separately.

**Copy** on the results screen puts a share line on the clipboard:

```
🗝️ Warrior Legends · Room 3 · 14.8 s · 31 moves (par 28)
🗝️ Warrior Legends · 8/8 rooms · 3:12.6 · 241 moves
```

## Saved data

All in `localStorage`, via the shell's `Arcade.store`:

| Key | Value |
|-----|-------|
| `arcade.warrior.best` | rooms cleared, 0–8 (shown on the portfolio card) |
| `arcade.warrior.progress` | `{ unlocked, bests: { [room]: { ms, moves } }, deadlineBests: { [room]: ms } }` |
| `arcade.warrior.plays` | rooms cleared, counted every time |

In `bests`, `ms` and `moves` are each the room's best (they may come from different attempts).

## Files

```
index.html
css/arcade-shell.css    shared cabinet shell (do not edit here; shared with the other arcade repos)
js/arcade-shell.js      shared cabinet shell (same)
js/rooms.js             ROOMS: 8 grids + name + par
js/sprites.js           the warrior as character grids, rendered to offscreen canvases
js/game.js              everything else
images/                 tiles
tools/check-rooms.js    room checker (Node, not loaded by the page)
```

Plain static site: no build step, no dependencies, no network requests beyond its own files.

## Room checker

`tools/check-rooms.js` is a Node script (no dependencies). It runs an exhaustive breadth-first search over
(tile, doors opened, keys collected) for every room in `js/rooms.js` and reports whether the room is solvable,
its minimum moves and par, the fewest doors a solution opens, the keys in the room, and whether a wrong choice
is possible (a reachable state from which the trophy can no longer be reached). It exits non-zero if a room is
unsolvable, has unreachable floor, or its `par` is out of date. Run it after editing any room.

```
node tools/check-rooms.js            # summary table
node tools/check-rooms.js --paths    # also print a shortest route and an example trap
node tools/check-rooms.js --json     # machine-readable
```

Current output:

```
1. The tour             solvable   moves 57  par 63  doors 5/6  keys 6  decision
2. Two locks, one key   solvable   moves 13  par 14  doors 1/2  keys 1  decision
3. Red herring          solvable   moves 22  par 24  doors 2/5  keys 4  decision
4. Fork in the hall     solvable   moves 31  par 34  doors 2/6  keys 3  decision
5. Long way round       solvable   moves 45  par 50  doors 2/4  keys 2  decision
6. The vault            solvable   moves 56  par 62  doors 5/6  keys 5  decision
7. Toll road            solvable   moves 33  par 36  doors 5/8  keys 6  decision
8. The keeper           solvable   moves 52  par 57  doors 6/8  keys 7  decision

8 rooms, 8 with a door decision (a wrong door can lose the room), 0 problem(s).
```

`doors 2/6` means the best solutions open 2 of the room's 6 doors; `decision` means some door choice (or order)
leaves the trophy unreachable, so the room has to be planned rather than just walked.

# Warrior Legends

Eight handcrafted lock-and-key rooms. Every door costs one key, keys are scarce, and not every door is worth opening.

Play: https://alikonainofficial.github.io/Warrior_Legends/

Originally built while following Chris DeLeon's *Hands-On Intro to Game Programming*.

## Rooms

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

Par is the minimum number of moves found by the room checker plus 10%, rounded.

## Room checker

`tools/check-rooms.js` is a Node script (no dependencies, not loaded by the page). It runs an exhaustive
breadth-first search over (tile, doors opened, keys collected) for every room in `js/rooms.js` and reports
whether the room is solvable, its minimum moves and par, the fewest doors a solution opens, the keys in the
room, and whether a wrong choice is possible (a reachable state from which the trophy can no longer be
reached). It exits non-zero if a room is unsolvable, has unreachable floor, or its `par` is out of date.

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

`doors 2/6` means the best solutions open 2 of the room's 6 doors; `decision` means some door choice
(or order) leaves the trophy unreachable, so the room has to be planned rather than just walked.

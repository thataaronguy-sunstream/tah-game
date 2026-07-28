# tah-game

**Dead Fields** — an agriculture-themed roguelite in the Dead Cells mould. Descend five procedurally generated farm levels, harvesting corn and fighting crows, boars and a scarecrow boss that guards the barn. Corn buys run upgrades (pick 1 of 3) and banks into a permanent skill tree at the Farmstead, so each death makes the next run stronger. Rendered with vector primitives at 1280x720 over a 320x180 logical grid, procedural Web Audio music and SFX, no asset files, no build step.

Play: https://thataaronguy-sunstream.github.io/tah-game/

**Controls:** `A`/`D` move, `W` jump, `Space` attack, `Shift` dodge-roll (i-frames), `F` mount/dismount the combine (once unlocked), `1`/`2`/`3` choose an upgrade, `H` open the Farmstead.

## The loop

- **Runs** are five levels deep. Reaching the silo clears a level; the final level swaps it for a barn you can't enter while the scarecrow lives.
- **Corn** does double duty: every 5 picked up offers a choice of 3 run upgrades, and the total banks on death for the skill tree.
- **Death ends the run.** Upgrades are lost, banked corn is kept — that's what makes the tree matter.
- **The combine** is a toggleable form: it flattens ordinary animals on contact, fords water and bridges pits, but can't jump. The scarecrow can still hurt it.
- **Boars that fall in water** paddle at the surface until they drown, and still drop bacon.
- **A mid-air jump is a luxury,** not an assumption. Every gap and platform is clearable with a single jump; Straw Wings is the priciest tree node and the rarest card in the upgrade pool.

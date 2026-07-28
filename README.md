# tah-game

**Farmer Brown** — an agriculture-themed roguelite in the Dead Cells mould. Descend five procedurally generated farm levels, harvesting corn and fighting crows, boars and a scarecrow boss that guards the barn. Corn buys run upgrades (pick 1 of 3) and banks into a permanent skill tree at the Farmstead, so each death makes the next run stronger. Rendered with vector primitives at 1280x720 over a 320x180 logical grid, procedural Web Audio music and SFX, no asset files, no build step.

Play: https://thataaronguy-sunstream.github.io/tah-game/

**Controls:** `A`/`D` move, `W` jump (tap for a short hop, hold for the full arc), `Space` attack, `Shift` dodge-roll (i-frames), `F` mount/dismount the combine (once unlocked), `1`/`2`/`3` choose an upgrade, `H` open the Farmstead.

## The loop

- **Runs** are five levels deep. Reaching the silo clears a level; the final level swaps it for a barn you can't enter while the scarecrow lives.
- **Corn** does double duty: every 5 picked up offers a choice of 3 run upgrades, and the total banks on death for the skill tree.
- **Death ends the run.** Upgrades are lost, banked corn is kept — that's what makes the tree matter.
- **The combine** is a toggleable form and a straight trade: it flattens ordinary animals on contact, but it can't jump and it can't cross gaps, so you dismount to platform and mount to fight. The scarecrow can still hurt it.
- **The pitchfork doubles as a rake.** Swinging it hooks loose meat in range and flings it back to you, which is the only way to land anything floating in a stream.
- **Kills drop food you have to collect.** Boars leave rashers of bacon, crows leave a roast chicken in a poof of black feathers. Score is paid for the kill, corn for picking the meat up — and dropped meat never falls out of the level; anything landing over a gap is placed on the nearest ground.
- **Stomping works.** Landing on an enemy from above deals a hit and bounces you off: two stomps for a boar, one for a crow. The scarecrow is too big to vault off.
- **Animals sometimes drop a heart.** Roughly one kill in five leaves one. It restores a point of health, or cashes out as a chunk of score plus a corn if you're already at full health.
- **Boars that fall in water** paddle at the surface until they drown, and still drop bacon.
- **Apple trees are a skill climb.** Trees run up to four tiers of narrow branches on alternating sides of the trunk; every step is inside a single jump, but the perches are only 12-18px wide. An apple crowns the tallest ones, worth ten corn, and a vulture is posted on it that dives when you get close.
- **A mid-air jump is a luxury,** not an assumption. Every gap and platform is clearable with a single jump; Straw Wings is the priciest tree node and the rarest card in the upgrade pool.

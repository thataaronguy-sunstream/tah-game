# tah-game

**Farmer Brown** — an agriculture-themed roguelite in the Dead Cells mould. Descend five procedurally generated farm levels, harvesting corn and fighting crows, boars and a scarecrow boss that guards the barn. Corn buys run upgrades (pick 1 of 3) and banks into a permanent skill tree at the Farmstead, so each death makes the next run stronger. Rendered with vector primitives at 1280x720 over a 320x180 logical grid, procedural Web Audio music and SFX, no asset files, no build step.

Play: https://thataaronguy-sunstream.github.io/tah-game/

The homestead has a farmhouse and a market stall. Harvested crops are carried,
not auto-sold - take them to the stall to cash them in. The farmhouse door
opens the Farmstead skill tree, so the whole loop closes on the farm itself.

**Controls:** `A`/`D` move, `W` jump (tap for a short hop, hold for the full arc), `Space` attack, `S` drop through a branch, `Shift` dodge-roll (i-frames), `F` mount/dismount the combine (once unlocked), `1`/`2`/`3` choose an upgrade, `H` open the Farmstead.

## The loop

- **Runs** are five levels deep. Reaching the silo clears a level; the final level swaps it for a barn you can't enter while the scarecrow lives.
- **Corn grows on stalks,** not in trees. Occasional leaning stalks with blade leaves and a tassel, each bearing one cob at chest height so you walk through to take it. Trees carry apples; nothing else does.
- **Three resources, not one.** Corn, bacon and chicken are tracked separately, one per pickup, shown as icons with counts. They bank at different rates (corn 1, bacon 2, chicken 3) because meat costs you a fight.
- **Points unlock upgrade cards,** and points come from kills as well as pickups. The threshold accelerates, so cards get rarer as a run goes on rather than piling up.
- **Death ends the run,** and it costs you. Upgrades are lost and the crows take 90% of the corn you were carrying — only a tenth makes it home. Reach the barn alive and you keep the lot, which is the whole reason to push for the exit rather than farm the field.
- **The combine** is a toggleable form and a straight trade: it flattens ordinary animals on contact, but it can't jump and it can't cross gaps, so you dismount to platform and mount to fight. The scarecrow can still hurt it.
- **The pitchfork doubles as a rake.** Swinging it hooks loose meat in range and flings it back to you, which is the only way to land anything floating in a stream.
- **Kills drop food you have to collect.** Boars leave rashers of bacon, crows leave a roast chicken in a poof of black feathers. Score is paid for the kill, corn for picking the meat up — and dropped meat never falls out of the level; anything landing over a gap is placed on the nearest ground.
- **Catch a bird from underneath** with the fork and it's skewered outright, whatever its health. The overhead swing reaches above your head, so a well-timed upward jab beats trading hits with a diving vulture.
- **Stomping works.** Landing on an enemy from above deals a hit and bounces you off: two stomps for a boar, one for a crow. The scarecrow is too big to vault off.
- **Hits shove.** Every blow carries knockback, both ways. A struck boar is thrown about 16px and a crow is batted back through the air rather than dropping; the slam throws hardest at 26px. Bosses only flinch a few pixels, and briefly enough that swinging can't hold one in permanent stagger. Taking a hit yourself shoves you clear of what hit you, and your own movement keys are suspended for a moment so the shove actually lands.
- **A pit costs a heart, not the run.** Falling out of the level drops you back on the same stage's start line one heart down, and the field comes back with you, so its corn and score are rolled back too. Fall with your last heart and that's the run.
- **Animals sometimes drop a heart.** Roughly one kill in five leaves one. It restores a point of health, or cashes out as a chunk of score plus a corn if you're already at full health.
- **Boars that fall in water** paddle at the surface until they drown, and still drop bacon.
- **Apple trees are a skill climb.** Trees run up to four tiers of narrow branches on alternating sides of the trunk; every step is inside a single jump, but the perches are only 12-18px wide. An apple crowns the tallest ones, worth ten corn, and a vulture is posted on it that dives when you get close.
- **A mid-air jump is a luxury,** not an assumption. Every gap and platform is clearable with a single jump; Straw Wings is the priciest tree node and the rarest card in the upgrade pool.

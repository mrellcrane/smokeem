# Smoke Em': Game Design

Living document. Update it whenever a design decision is made or the roadmap moves.
Items marked **(proposal)** are placeholders that still need sign-off before they get built.

## Pitch

Smoke Em' is an original sci-fi first-person arena shooter that runs in a web browser. It is built
for 3 friends playing couch split-screen on an Xbox Series X in Microsoft Edge with Xbox
controllers, and it also has to be fully playable solo on a MacBook with keyboard and mouse.

Everything is original: no assets, names, characters or maps from existing games.

## Pillars

1. **Couch first.** 1 to 4 local players in one browser tab. 60fps with 3 split-screen views in
   Edge on Xbox is the bar every feature has to clear.
2. **Fast and floaty.** High speed, low gravity, double jump. Moving around is fun on its own.
3. **Tactical meets goofy chaos.** Solid core shooting (shields, headshot-worthy rifle, map control)
   with ridiculous toys layered on top (steerable missiles, getting huge, digging underground).
4. **Readable.** Chaos is only fun if you can tell what just happened to you. Kill feed, clear
   effects, distinct silhouettes.

## Tone and setting (proposal)

A backwater off-world training facility turned combat game show. Contestants run an obstacle
course while shooting each other, and the host grades you like a pitmaster grades meat. Sci-fi
hardware (metal panels, glowing strips, a gas giant in the sky) mixed with obstacle-race junk
(wood walls, cargo nets, ropes, mud, fire).

## Visual target

Roughly early-2000s console shooter era: real-time lighting and shadows, simple textures,
low-to-mid poly geometry, saturated colors, big readable shapes. All textures are generated
procedurally in code (canvas) or come from CC0 sources. No external art pipeline for v1.

## Modes

- **Free-for-all** (v1). Timed matches, 5 minutes by default (3, 5, 10 or no limit on the
  title screen). Most points when time runs out wins.
  - Scoring: a kill is +1; smoking yourself (your own blast, the fire, falling out) is -1.
    Ties on points share a place. Training dummies (no-bot matches) give no points.
  - Each view shows the clock (red in the last 30 seconds, a beep each second for the last
    10), your place and points, and a kill feed. Hold Tab (View on a controller) for the
    scoreboard.
  - When time runs out a horn sounds, play freezes and the results screen shows everyone's
    place, points, kills, deaths and smoked meat rank, with Play again and Quit. The pause
    menu can also end a match early (the only way to see results with no time limit).
- **Bots** (v1) for solo testing and filling out matches. Choose 0 to 7 bots and a skill level
  (Easy / Normal / Hard) on the title screen. With 0 bots, training dummies fill in.
  - Bots are regular players driven by an AI instead of a controller: same movement, same
    weapons, same damage. They run the obstacle course (nets, ropes, walls, monkey bars, mud,
    jumping the fire), grab pickups, and fight: they see within a forward cone with line of
    sight, hear gunfire within 30 m and turn toward whoever hurts them, aim with reaction time
    and wobble that settle as they track you, fire in bursts, strafe, sometimes push along
    their route while shooting, swap to the shotgun up close, throw grenades, melee, and steer
    their own Smoke Signals.
  - Bot names: Gristle, Dry Rub, Rib Tip, Pit Boss, Low n Slow, Charcoal, Flare-Up, Mop Sauce.
- **Later:** team modes, online play between separate houses.

## Characters

Contestants wear chunky armor with a wide amber visor and a smoker canister on the back. Each
local player has a color: blue, red, green, gold. Bodies are procedural boxes on a small
skeleton (one draw call each), so they can run, crouch, jump and climb without imported assets.

## Players and split-screen

- 1 to 4 local players in one tab, rendered with renderer viewports and scissor.
- Layouts: 1 player full screen, 2 players stacked top and bottom, 4 players in quadrants.
- 3 players: three equal quadrants (players 1 and 2 on top, player 3 bottom left). The 4th
  quadrant is a match info panel: clock, live scoreboard, kill feed and an arena map that
  shows only the local players. Equal views are fair, and this renders 25% fewer pixels
  than a wide view on top, which matters on Xbox.
- **Joining** happens on the title screen, which shows four seats. A controller joins by
  pressing A (that press does nothing else) and leaves with B. Keyboard and mouse joins by
  clicking an empty seat, or by hitting Play with nobody joined (solo on a Mac). Seats fill
  in join order and carry over to the next match.
- Each view gets a P1 to P4 tag in its player color, and the name of whoever is under your
  crosshair shows below it.
- Any joined controller pauses for everyone (Menu, or D-pad down). For half a second after
  a pause or the results open, controllers are ignored (the others are still jumping), and
  the results buttons wait a full second. If a controller drops mid-match the game pauses;
  turning it back on, or pressing A on another controller, takes the seat back.
- Keyboard and mouse can share a match with controllers. If a controller resumes the match,
  the mouse isn't captured until the keyboard player clicks.

## Movement

Fast, floaty, generous. Current tuning lives in `src/config.js`. The speeds below are at 100%;
a **Movement speed** setting (40% to 130%, default 70%) scales running, acceleration, air
control and climbing for everyone, bots included. Jump heights never change, so every
obstacle works at any setting.

| Thing | Value (v1 starting point) |
| --- | --- |
| Walk speed | 7 m/s |
| Sprint speed | 10.5 m/s (hold, forward only) |
| Crouch speed | 3.6 m/s |
| Gravity | 16 m/s² (Earth is 9.8, most shooters run 20+) |
| Jump height | ~2.0 m |
| Double jump | ~1.6 m more, redirects your momentum |
| Air control | strong, momentum is kept when you sprint-jump |
| Player height | 1.8 m standing, 1.2 m crouched |

- **Double jump**: one extra jump in the air. Refreshes when you land, mantle, or leap off a
  climbable.
- **Sprint**: hold. Only while moving forward and not crouched. Mud blocks sprint.
- **Crouch**: hold. On the ground it lowers you; in the air it tucks your legs so you clear
  higher ledges (crouch-jump).
- **Mantle / vault**: push forward into a ledge to pull yourself up. On the ground this vaults
  anything from knee to chest height. In the air it grabs ledges up to about hand height.
  This is how the obstacle-course walls work.
- **Climbing**: push into a cargo net or rope to grab it. Forward/back to climb, jump to leap
  off, crouch to let go. Reaching the top pulls you over the edge.
- **Monkey bars**: jump up into them to hang. Move with the stick or WASD, jump or crouch to
  drop.
- Coyote time and jump buffering so jumps feel fair.

## Health

- Regenerating shields over health.
- 100 shield + 100 health. Shields start recharging 4 s after the last hit and refill in
  about 2 s. Health regenerates too, but only once shields are full, refilling in about 4 s.
  No health pickups: on a small, fast map full regen keeps fights flowing.
- Starting values; tune in playtests.
- Environmental damage: the fire jump burns at 45 per second (through shields first), falling
  out of the map kills.
- Death: you get smoked (literally: a puff of smoke), the camera sinks and tips over, and you
  respawn after 3 seconds at the spawn point farthest from other players, with full shields,
  health and ammo.

## Weapons

Two weapon slots. You spawn with the Hickory and an empty slot. Ten weapons eventually.

### v1 weapons (names are proposals)

| Weapon | Role |
| --- | --- |
| **Hickory** rifle | Full-auto mid-range workhorse. Spawn weapon. |
| **Mesquite** shotgun | Pump shotgun. Brutal up close, useless far away. |
| **Smoke Signal** | Signature weapon. Fires a guided missile and switches your view to the missile's camera; you steer it in real time. You are defenseless while flying it. Map pickup only, low ammo. |

**Hickory starting stats** (tune in playtests): 9 shots per second, 13 damage, headshots x1.5,
damage falls off to 60% between 35 m and 80 m, 32-round magazine with 160 in reserve, 1.7 s
reload, right mouse zooms 1.35x and tightens spread. Spread blooms while firing and grows when
moving or airborne. A full-shield, full-health target takes about 1.8 s of body shots.

- Firing cancels sprint. You can shoot while climbing nets, ropes and monkey bars (with extra
  spread), but not mid-mantle.
- Bullets pass through cargo nets.

### Future weapons (ideas, not committed)

- **Cold Smoke**: precision long rifle with zoom.
- **Toothpick**: sidearm pistol.
- **Skewer**: harpoon gun that pins people to walls.
- **Sauce Boss**: lobs sticky goo puddles that slow and make floors slippery.
- **Gust**: leaf-blower cone that shoves players and grenades.
- **Swarm Jar**: throws a jar of angry homing bugs.
- **Wishbone**: boomerang blade that comes back.

**Mesquite starting stats**: pump action, 10 pellets of 12 damage in a 6 degree cone (two
point-blank blasts smoke a full-shield target), damage falls to 15% between 6 m and 18 m,
6 shells plus 18 in reserve, loads one shell at a time and firing interrupts the reload.

**Smoke Signal starting stats**: 1 rocket loaded plus 1 spare, 2.4 s reload. Firing switches
your view to the rocket's nose camera; you steer it with look input (turn rate capped at
2.8 rad/s), and the trigger blows it early. It speeds up from 15 to 25 m/s and blows up on
contact, near a body (0.65 m proximity fuse) or after 7 s. Blast: 5.5 m radius, full 210
damage within 1.6 m (a direct hit always smokes), less further out. While you fly it, your
body stands still, defenseless, and you can see yourself from the rocket. It hurts you too.

**Pickups**
- Pads on the map: the Smoke Signal on top of the Summit (60 s respawn), Mesquites under the
  Summit and in the southwest barrier field (30 s), and four grenade pads with 2 each (20 s):
  the catwalk, the net block, the west monkey-bar platform and the northwest crates.
- Walking over a pickup takes it when it fits: a gun goes into your empty slot, a gun you
  already carry tops up its ammo, grenades fill up to the max. With both slots full you get a
  prompt and press E (hold X on a controller) to swap, dropping your current gun.
- When you get smoked you drop whatever you picked up (not the starting Hickory). Dropped guns
  vanish after 25 s.
- An empty gun swaps itself out for your other one.

### Grenades and melee

- **Briquette** grenade: start with 2, carry up to 4. Thrown hard (17 m/s plus a lift), it
  bounces, settles and blows up 2.4 s after the throw. Blast: 5 m radius, full 130 damage
  within 1 m. Solid cover between you and a blast blocks it. Blasts shove people and other
  grenades, shake nearby cameras, and hurt the thrower.
- **Tenderizer** melee: 65 damage at up to 2.3 m. Anyone up to 3.6 m in front pulls you into a
  quick lunge. Hits from behind smoke instantly. 0.9 s cooldown.

## Vehicle (later)

One motorcycle with a mounted gun. Fast, fragile, fun off ramps. Name proposal: **Sizzler**.

## Abilities (later)

- **Dig**: go under the map for about 10 seconds. You can see enemies but stay hidden, then pop
  up anywhere.
- **Ground Pound**: jump and slam down like a stone, damaging whoever you land on.
- **Coin Bash**: hit trees and objects to knock out coins. Coins make you bigger, tougher and
  stronger.
- **Get Huge**: become giant. More damage, but worse vision and easier to hit.
- **Grapple**: fire at almost any surface and zip to it.
- **The Stall** (proposal name; the idea came in as "Neo mode"): for about 3 seconds, any shot
  that would hit you stops dead in mid-air about a meter in front of you, hanging there as a
  glowing slug. Missiles and grenades freeze too. When it ends, the stalled rounds drop to the
  ground (proposal; a spicier variant flings them back at whoever fired them). Shots are
  hitscan, so this works as a bubble the shot ray checks before it hits you.

How abilities are earned (loadout, pickup, cooldown, charge from kills) is an **open question**.

## Ranks

End-of-match rank based on performance, all smoked meats, worst to best:

1. Hot Dog
2. Smoked Chicken
3. Pulled Pork
4. Smoked Salmon
5. Brisket
6. Wagyu Burnt Ends

Rank comes from a performance score between 0 and 1 that blends finishing place and K/D, so
a last-place player with a good K/D isn't automatically a Hot Dog:

- `place = (N - p) / (N - 1)` where `p` is finishing place (1 = winner) among all `N`
  participants, bots included. 1 for the winner, 0 for last. A solo match counts as 1.
- `kd = min(1, (kills / max(1, deaths)) / 2)`, so a K/D of 2 or better maxes out.
- `score = 0.6 * place + 0.4 * kd`
- The score splits into six equal bands: below 1/6 is Hot Dog, 5/6 and up is Wagyu Burnt Ends.

Examples: winner with K/D 2+ gets Wagyu Burnt Ends; winner with K/D 1 gets Brisket; last place
with K/D 1.5 gets Smoked Chicken.

## Maps

### Map 1: Mudlark Gauntlet (name is a proposal)

A small (60 m x 60 m) obstacle-race course arena inside tall metal walls. Every obstacle doubles
as combat terrain.

- **The Summit** (center): a 6 m tower deck on legs with a solid core underneath for cover.
  A-frame cargo nets on the north and south sides climb to the top. Too high to reach with a
  plain double jump; skilled players can get there from the crate just west of it (jump,
  double jump at the top of the arc, then push forward to grab the edge).
- **Climbing walls** (west lane): three walls of 1.3 m (vault), 2.6 m (jump and mantle) and
  4.4 m (double jump and mantle).
- **Mud pit** (east): a sunken pit. Mud halves your speed, weakens jumps and blocks sprint.
- **Monkey bars** (east): span the mud pit between two platforms. Hang and cross, or fall in.
- **Fire jump** (north): burner troughs with flames to leap over. Burns (once health exists).
- **Rope climb** (south): three ropes up to a high catwalk along the south wall. A ramp at the
  east end is the slow way up.
- **Net block** (northeast): a 5 m block with a vertical cargo net on its face.
- Crates, barriers and low walls scattered for cover.

## Controls

### Keyboard and mouse (any seat)

| Action | Key |
| --- | --- |
| Move | WASD (or arrow keys) |
| Look | Mouse / trackpad (pointer lock) |
| Jump / double jump | Space |
| Sprint | Shift (hold) |
| Crouch | C (hold) |
| Fire | Left mouse |
| Zoom / aim | Right mouse |
| Reload | R |
| Pick up / interact | E |
| Grenade | G |
| Melee | Q or F |
| Switch weapon | Mouse wheel or X, or 1 / 2 for a slot |
| Scoreboard | Tab |
| Pause | Esc |
| Toggle FPS counter | ` (backquote) |

Never bind gameplay to Ctrl or Cmd on Mac (see CLAUDE.md).

### Xbox controller

| Action | Button |
| --- | --- |
| Move / look | Left stick / right stick |
| Jump / double jump | A |
| Crouch | B (hold) |
| Reload | X (tap) |
| Pick up / swap weapon on the ground | X (hold) |
| Switch weapon | Y |
| Fire | RT |
| Grenade | LT |
| Melee | RB |
| Ability (later) | LB |
| Sprint | Left stick click (stays on until you let off forward or crouch) |
| Zoom | Right stick click (toggle) |
| Pause | Menu, or D-pad down |
| Scoreboard (hold) | View |

- Menus: D-pad or left stick moves, A selects, B goes back, left/right changes sliders and
  choices.
- Sticks have a radial deadzone. Look runs on a curve (fine aim near center) with a turn
  boost after a moment at full tilt, so you can still spin around. Full tilt is about
  180 degrees per second before the boost.
- Light aim friction on controllers only: look slows to 60% while the crosshair is on
  someone. No magnetism or auto-aim.
- Rumble when you get hurt, smoked, or shaken by a blast (can be turned off).
- Edge on Xbox treats B as the browser's Back button, so once a controller shows up the game
  keeps a spare history entry and B can never leave the page.

## Settings

- Graphics quality: Low / Medium / High (resolution cap, shadows, anti-aliasing).
- Movement speed for everyone, players and bots (default 70%).
- Mouse sensitivity (saved to `localStorage`).
- Controller look speed and controller vibration.
- Invert Y, field of view, FPS counter toggle.
- These are shared by every local player for now; per-player settings can come later.

## Audio

- Guns, reloads and explosions are real recordings, all CC0 (credits in
  `src/audio/samples/CREDITS.md`). The Hickory is an AK-47 (four takes, picked at random),
  the Mesquite a Benelli Nova 12 gauge with a real pump rack after every shot, explosions
  are cannon and firework bangs over a synthesized sub-bass thump.
- UI and body sounds (hit markers, kill confirm, shields, hurt, melee, grenade bounces) stay
  synthesized with WebAudio.
- Sounds live in the world: other players' guns fade and lose their highs with distance from
  the nearest local player, guns and blasts ring off the arena walls (a generated echo that
  gets relatively louder far away), and with one local player sounds pan left and right.
  Your own sounds always play up close.
- Hit markers, hurt and shield sounds play only for local players, not for bots fighting
  each other.

## Roadmap

### Phase 0: Setup (done)

- GAME_DESIGN.md and CLAUDE.md.
- Vite + Three.js + Rapier scaffold, GitHub Pages deploy via GitHub Actions.

### Phase 1: Version 1 (small playable steps)

1. **Arena + movement (done)**: the obstacle-course arena, one player on keyboard and mouse,
   sprint, crouch, double jump, mantle, nets, ropes, monkey bars, mud. Main menu with quality,
   sensitivity, FOV and FPS settings. Pause menu. Shader warm-up at load.
2. **Shooting (done)**: Hickory rifle with a first-person viewmodel, hitscan with headshots,
   spread, reload and zoom; shields and health with regen; fire jump damage; death and
   respawn; HUD (vitals, ammo, hit markers, kill confirms, death screen); placeholder sounds;
   six training dummies (standing and strafing) as practice targets.
3. **Full arsenal (done)**: Mesquite shotgun, Smoke Signal guided missile (missile camera),
   weapon pickups on the map, grenades, melee, explosions with knockback and camera shake,
   permanent on-screen controls.
4. **Bots (done)**: bots that run the obstacle course and fight, bot count and skill on the
   title screen, a damage-direction arrow on the HUD.
5. **Match flow (done)**: free-for-all rules, match timer, kill feed, respawns, hold-to-view
   scoreboard, end-of-match results with smoked meat ranks.
6. **Split-screen + controllers (done)**: 1 to 4 local players, Gamepad API, press A to
   join, full controller navigation of every menu, the 3-player info panel.
7. **Xbox pass**: performance tuning on Edge on Xbox with 3 views, placeholder sounds, polish.

### Phase 2: More game

- More weapons (up to 10), abilities, the motorcycle, more maps, team modes.

### Phase 3: Online

- Online play between separate houses.

## Open questions

Need answers before the step that uses them gets built.

1. **How abilities are earned.** Needed for phase 2.
2. **Names.** Weapon, map and vehicle names above are proposals.

## Decision log

- 2026-10-28: 3-player split-screen uses equal quadrants with a match info panel in the 4th.
- 2026-10-28: Health regenerates after shields are full; no health pickups.
- 2026-10-28: Ranks come from a 60/40 blend of finishing place and K/D.
- 2026-10-29: Headshots deal 1.5x on every hit (shields up or down). Shooting allowed while
  climbing with extra spread; firing cancels sprint.
- 2026-10-29: Training dummies stay in as practice targets for solo play until bots arrive.
- 2026-10-29: All controls are shown permanently along the bottom of each view (owner's call).
- 2026-10-29: Two weapon slots; auto pick up into an empty slot, E to swap when full; you drop
  picked-up guns when smoked. Grenades: start 2, max 4.
- 2026-10-29: Explosions hurt their owner, and a direct Smoke Signal hit always kills.
- 2026-10-29: Owner found 100% movement way too fast: added a Movement speed setting,
  default 70%.
- 2026-10-29: Bots get three skill levels (not in the original brief; cheap and useful for
  solo testing). Training dummies only appear with 0 bots.
- 2026-10-29: Next up after bots: step 6 (controllers and split-screen) so the Xbox is
  playable, then the owner's picks: art and animation pass, abilities, the motorcycle, more
  maps. Step 5 (match flow) slots in alongside.
- 2026-10-29: Controller layout built as proposed, with sprint and zoom as stick-click
  toggles (holding a stick click while aiming is awkward). Pause is Menu or D-pad down,
  because Edge on Xbox may keep Menu for itself.
- 2026-10-29: Controllers get light aim friction (60% look speed with someone under the
  crosshair) and nothing stronger. Keyboard and mouse get none.
- 2026-10-29: Seats: A joins and B leaves on the title screen; keyboard and mouse joins by
  clicking a seat or playing solo. Settings stay shared across local players for now.
- 2026-10-29: Owner asked for more realistic gun sounds: guns, reloads and explosions are now
  CC0 recordings (The Free Firearm Sound Library and others from OpenGameArt), with distance
  falloff, muffling, panning and an arena echo. Bots' personal sounds (hit markers, hurt) no
  longer play.
- 2026-10-29: Match length is a title-screen choice (3, 5, 10 minutes or no limit, default
  5); Pause has End match. Ties on points share a place.
- 2026-10-29: Owner wants everyone to spawn with two guns and to pick loadouts. Next PR:
  three new guns (Toothpick pistol, Cold Smoke marksman rifle, Kindling SMG), a default
  loadout of Hickory + Toothpick, and loadouts picked per player on the respawn screen.

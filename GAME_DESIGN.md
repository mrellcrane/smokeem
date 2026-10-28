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

- **Free-for-all** (v1). 5-minute matches. Most kills wins.
  - Default scoring (proposal): kill +1, suicide or environment death -1.
- **Bots** (v1) for solo testing and filling out matches. Number of bots chosen in the menu.
- **Later:** team modes, online play between separate houses.

## Players and split-screen

- 1 to 4 local players in one tab, rendered with renderer viewports and scissor.
- Layouts: 1 player full screen, 2 players stacked top and bottom, 4 players in quadrants.
- 3 players: **open question**, see below. The code currently uses one wide view on top and
  two below as a placeholder.
- Each controller joins from the main menu by pressing A. Player 1 can use keyboard and mouse.

## Movement

Fast, floaty, generous. Current tuning lives in `src/config.js`.

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
- v1 values (proposal): 100 shield + 100 health. Shields start recharging 4 s after the last
  hit and refill in about 2 s. Health regenerates slowly only once shields are full.
  **Needs sign-off** (see open questions).
- Environmental damage: fire jump burns, falling out of the map kills.

## Weapons

Two weapons carried at once, swap with a pickup on the map (proposal). Ten eventually.

### v1 weapons (names are proposals)

| Weapon | Role |
| --- | --- |
| **Hickory** rifle | Full-auto mid-range workhorse. Spawn weapon. |
| **Mesquite** shotgun | Pump shotgun. Brutal up close, useless far away. |
| **Smoke Signal** | Signature weapon. Fires a guided missile and switches your view to the missile's camera; you steer it in real time. You are defenseless while flying it. Map pickup only, low ammo. |

### Future weapons (ideas, not committed)

- **Cold Smoke**: precision long rifle with zoom.
- **Toothpick**: sidearm pistol.
- **Skewer**: harpoon gun that pins people to walls.
- **Sauce Boss**: lobs sticky goo puddles that slow and make floors slippery.
- **Gust**: leaf-blower cone that shoves players and grenades.
- **Swarm Jar**: throws a jar of angry homing bugs.
- **Wishbone**: boomerang blade that comes back.

### Grenades and melee

- **Briquette** frag grenade (proposal name). Carry 2, pick up more on the map.
- Melee bash: big damage, short range, quick lunge. Hits from behind are an instant kill
  (proposal).

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

How abilities are earned (loadout, pickup, cooldown, charge from kills) is an **open question**.

## Ranks

End-of-match rank based on performance, all smoked meats, worst to best:

1. Hot Dog
2. Smoked Chicken
3. Pulled Pork
4. Smoked Salmon
5. Brisket
6. Wagyu Burnt Ends

How "performance" is scored is an **open question**.

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

### Keyboard and mouse (player 1)

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
| Switch weapon | Mouse wheel or X |
| Scoreboard | Tab |
| Pause | Esc |
| Toggle FPS counter | ` (backquote) |

Never bind gameplay to Ctrl or Cmd on Mac (see CLAUDE.md).

### Xbox controller (proposal)

| Action | Button |
| --- | --- |
| Move / look | Left stick / right stick |
| Jump | A |
| Crouch | B (hold) |
| Reload / pick up | X (hold to pick up) |
| Switch weapon | Y |
| Fire | RT |
| Grenade | LT |
| Melee | RB |
| Ability (later) | LB |
| Sprint | Left stick click |
| Zoom | Right stick click |
| Pause | Menu |
| Scoreboard | View |

## Settings

- Graphics quality: Low / Medium / High (resolution cap, shadows, anti-aliasing).
- Mouse sensitivity (saved to `localStorage`).
- Invert Y, field of view, FPS counter toggle.

## Audio

Placeholder sound effects are fine for v1 (generated with WebAudio).

## Roadmap

### Phase 0: Setup (done)

- GAME_DESIGN.md and CLAUDE.md.
- Vite + Three.js + Rapier scaffold, GitHub Pages deploy via GitHub Actions.

### Phase 1: Version 1 (small playable steps)

1. **Arena + movement (done)**: the obstacle-course arena, one player on keyboard and mouse,
   sprint, crouch, double jump, mantle, nets, ropes, monkey bars, mud. Main menu with quality,
   sensitivity, FOV and FPS settings. Pause menu. Shader warm-up at load.
2. **Shooting**: Hickory rifle with a first-person viewmodel, hitscan, shields and health with
   regen, fire jump damage, death and respawn, practice targets.
3. **Full arsenal**: Mesquite shotgun, Smoke Signal guided missile (missile camera), weapon
   pickups on the map, grenades, melee.
4. **Bots**: simple AI that roams the arena (including obstacles) and shoots. Bot count in menu.
5. **Match flow**: free-for-all rules, 5-minute timer, kill feed, respawns, end-of-match
   scoreboard with smoked meat ranks.
6. **Split-screen + controllers**: 1 to 4 local players, Gamepad API, press A to join, full
   controller navigation of every menu.
7. **Xbox pass**: performance tuning on Edge on Xbox with 3 views, placeholder sounds, polish.

### Phase 2: More game

- More weapons (up to 10), abilities, the motorcycle, more maps, team modes.

### Phase 3: Online

- Online play between separate houses.

## Open questions

Need answers before the step that uses them gets built.

1. **3-player split-screen layout.** Options: one wide view on top with two below (the classic
   look, but the top player gets a wider field of view), or three equal quadrants with the 4th
   used for a map or scoreboard (fair, but smaller views). Needed for step 6.
2. **Health regen.** Should health regenerate too (proposal above), or only shields, with health
   pickups on the map? Needed for step 2.
3. **Rank scoring.** Proposal: rank comes from a performance score that blends finishing place
   with kill/death ratio, so a last-place player with a good K/D isn't automatically a Hot Dog.
   Alternative: rank is purely finishing place. Needed for step 5.
4. **How abilities are earned.** Needed for phase 2.
5. **Names.** Weapon, map and vehicle names above are proposals.

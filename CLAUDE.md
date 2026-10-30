# smokeem

Smoke Em': an original sci-fi browser FPS for couch split-screen (1 to 4 local players) on Xbox
Series X in Edge, also fully playable solo on a MacBook.

**Start of every session: read [GAME_DESIGN.md](GAME_DESIGN.md).** It holds the vision, the
roadmap step we're on and the open design questions. Ask before making big design decisions it
doesn't cover. Keep GAME_DESIGN.md and this file updated as things change.

## Run locally

```bash
npm install
npm run dev
```

Then open the localhost URL it prints.

- `npm run build` builds to `dist/`, `npm run preview` serves that build.
- Add `?debug` to the URL to expose `window.smokeem` in the console (current game, input,
  menu, pads, seats, and `config`: the live tuning numbers from `src/config.js`). `smokeem.playWithoutLock()` starts play without pointer lock, for
  headless browser tests. Headless Chromium (Playwright) renders the game fine with
  SwiftShader; drive it by pausing the game and calling `game.tick(1 / 60)` with values
  written into the player's `InputState`, since headless frame rates are too low for
  real-time checks.
- Add `?bench` to run a scripted split-screen match that reports frame time, render time,
  draw calls (shadow pass and per view) and load time (`src/render/bench.js`, only loaded
  for that URL). Options: `q=low|medium|high`, `views=1..4` (default 3), `secs`, `set`,
  `map=mudlark|factory`, and `off=name,...` to turn graphics switches in `src/render/gfx.js` off for a before/after.
  Run it on the Xbox from the Pages URL for real numbers; headless only checks draw counts.
- To test controllers headless, override `navigator.getGamepads` in `page.addInitScript`
  with fake pad objects (`connected`, `mapping: 'standard'`, `axes`, `buttons[i].pressed` /
  `.value`) and dispatch `gamepadconnected`. Menu code reads pads once per animation frame,
  so hold a button for a couple of frames.
- With the FPS counter on, each view also shows the player's movement state, speed and position.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) builds on every push and deploys `dist/` to
GitHub Pages when the push is to the repo's default branch. Pages source is set to
"GitHub Actions" in the repo settings. The Pages URL is HTTPS, which the Xbox needs for the
Gamepad API.

Live build: https://mrellcrane.github.io/smokeem/

## Pull request workflow

- One PR per roadmap step (or per fix), into the repo's default branch.
- Claude merges its own PRs once CI is green and nothing on the PR is waiting on a fix (the
  owner asked for this on 2026-10-29, so they don't have to merge by hand). Use a merge
  commit, then confirm the Pages deploy succeeded and share the live URL.
- After a merge, restart the working branch from the default branch before new work.

## Tech

### Stack

- Vite (dev server and build), plain JavaScript ES modules, no framework.
- Three.js for rendering (WebGL2).
- Rapier (`@dimforge/rapier3d-compat`, wasm inlined) for physics. Players use Rapier's kinematic
  character controller.
- UI is plain DOM over the canvas.
- Vite `base` is `./` so the build works from the GitHub Pages subpath.

### Code layout

- `src/main.js`: boot, screen flow (menu, loading, play, pause).
- `src/game.js`: one match. Owns the renderer, scene, physics world, players, fixed-step loop.
- `src/match.js`: free-for-all rules: clock, scoring, kill feed, standings, smoked meat ranks.
  `game.match`; when time runs out `game.endMatch()` sets state `'over'` and `main.js` shows
  the results.
- `src/config.js`: movement and body tuning numbers.
- `src/vehicles/sizzler.js`: the Sizzler motorcycle (`game.vehicles`, built when the map's build
  returns `vehicles` spots; tuning in `SIZZLER`, `config.js`). Each bike is a kinematic body moved
  by its own character controller: a ball floating `BALL_LIFT` over the ground that only meets
  walls, rocks and bodies, while a ball cast down (`groundBelow`) puts the bike on the ground
  (steps up to the float height, snaps down `SNAP`, won't drive up slopes over about 38 degrees,
  and leaves the ground off a lip or a crest with the speed it was climbing at, so terrain's
  creases and the creek's banks never catch it). Plus a box registered as an entity (the one collider
  shots and blasts see; `kind: 'vehicle'`, hull `vitals`, `die()` blows up with the rider). It
  ticks after the players: it reads its rider's `InputState` and `ridePressed`, turns toward the
  rider's `yaw` (or a bot's `driveYaw`), drives, splatters (`runInto`), fires its twin guns at
  `aimPoint` (the chase camera's line for people, the eye's for bots) and carries the rider's
  capsule on the seat (`seat`). The rider is in mode `'ride'` (`Player.startRide` / `endRide`;
  `Vehicles.mount` / `dismount`, `touch` offers a free bike as `vehiclePrompt`), takes
  `riderTakes` of damage, sees through `Vehicles.camera` (tipped `camTilt` below the aim; the HUD
  lifts the reticle by as much, `--aim-lift`), and its body sits on the bike (`riding`, `roll`,
  `tilt` in `Player.pose`; `RIDE` in `character.js`). Frames and wheels are two instanced meshes
  for every bike (Phong with glow parts lit by `aFinish`); the engine is one looping voice per
  bike (`sfx.engine` / `setEngine`); replays record both meshes.
- `src/modes/`: optional match modes on top of free-for-all, picked on the title screen
  (`settings.mode`, `game.mode`). `oysters.js` is Rocky Mountain Oysters: per-player sack size,
  its sway on a short rope from the belt (one instanced mesh), shots that hit it (`castShot`
  checks it first and returns `lowBlow`), the speed and jump burden (`Player.burdenSpeed` /
  `burdenJump`), bounties and SAUCED.
- `src/settings.js`: quality presets and saved settings (`localStorage`).
- `src/input/`: input sources (keyboard/mouse, gamepads; bots write theirs from `src/ai/`)
  all write the same `InputState`, so the player controller doesn't care where input comes
  from. `gamepad.js` has `Gamepads` (reads `navigator.getGamepads()` once per frame) and
  `GamepadInput` (one pad's gameplay mapping, rumble).
- `src/player/`: the player controller (movement, climbing, mantling, camera), the skinned
  character body and the first-person viewmodel. The body's mesh, skin weights and joints are
  `body/bodyMesh.js`, generated by `tools/build_body.mjs` from a CC0 model (credits and the
  rebuild command in `body/CREDITS.md`); don't edit it by hand.
  The grapple everyone has (LB / Q) is `grapple.js` (`player.hook`, tuning in `GRAPPLE`,
  `config.js`): `tickHook` (from `Player.tick`) fires it along a `castShot` ray and flies it out,
  `pull` (from `tickMove`) sets the velocity toward where it stuck (no gravity; under a ledge,
  `findLedge` aims the pull just over the top and the release pushes you onto it), `checkStuck`
  lets go when something stops you, and `releaseHook` starts the cooldown. Riding, climbing,
  mantling, a launch pad, the Gravity Gun and dying all let go. Its line is `fx/ropes.js` (one
  mesh, one ribbon per player, starting low on the left of your own view: `Ropes.setView`).
- `src/combat/`: vitals (shields/health), one module per gun under `guns/` (stats, parts model,
  first-person hands and pose, muzzle and its flash color, third-person grip; registered in
  `guns/index.js`; the first-person glove boxes in `hands` also place the third-person body's
  hands: the first is the trigger hand, the fourth the support hand),
  weapon sets and loadouts (`arsenal.js`: a match builds only its set's guns), weapon state
  (`weapons.js`), the shared shape kit and colors (`weaponModels.js`: a part is
  `[center, size, color, options]` (the registry fattens every gun's cross-section by `CHUNK`
  about its bore line at load, moving hands, muzzle, spin parts and screen with it, and adds an
  ember strip down each side of its main body: write guns at their natural proportions), a
  chamfered box or a round cylinder with taper, turn, bore and
  finish options; `'hi'` detail for first person, pickups and pictures, `'lo'` for the guns baked
  into bodies, which skip parts `showsAtLow` rejects), the per-tick weapon
  controller (`shooting.js`: trigger, spin-up, pellets, missile and launcher shots, grenades,
  melee, switching, reloads, the Brander's beam), projectiles (`projectiles.js`: Smoke Signal
  missiles; grenades, Chimney coals and sticky bombs as Rapier dynamic bodies, one instanced mesh
  per look, with optional contact fuses; stickies switch to fixed bodies where they land), the
  Gravity Gun's grab, hold, throw and punt (`gravity.js`, with the loose props it throws in
  `src/world/props.js`, built only when the match's set has it; in such a match the map build
  gets `loose: true`, so `parts.crate` (up to `LOOSE_CRATE`) and `parts.drum` go into
  `StaticBuilder.loose` instead of the static level and Props makes them physics props drawn
  with the map's materials; `Player.moveBy` collides with props, so people shove them. Each kind
  it can hold is an entry in `KINDS` (find, hold, throw): props and grenades are physics bodies;
  dropped guns, corpses, dummies, live players and bikes are carried by position, pause their own
  movement while `heldBy` is set, and once thrown hurt the first one they fly into (`flying`)),
  controller aim assist
  (`aimAssist.js`: magnetism, slowdown and tracking; each gun's def can set `assist` (cone in
  degrees, reach, range, slowdown, tracking) over the `AIM` defaults (`assistOf`), cones shrink
  by `player.aimZoom`, and `player.aimTarget` (the red reticle) is set exactly where a shot would
  bend), bolts (`bolts.js`: ballistic projectiles with no physics body,
  one ray per tick, like the Swarm Jar's jar and Hot Links' rockets: `straight` flies nose
  first, `trail` leaves smoke and a glow, `explosion` bursts on impact or at the end of its life,
  and `homing` turns toward the `target` it was fired with; `homingTarget` in `shooting.js`
  picks a Sizzler near the aim when zoomed), bug swarms (`swarms.js`: pure-math seekers,
  one instanced mesh), area damage (`explosions.js`), pickups, and `dealDamage`, the single
  path all damage goes through (it also applies the Shrink Wrap's size multipliers). The Shrink
  Wrap (`kind: 'size'`, `fireSize` in `shooting.js`, numbers in `SIZE`, `config.js`) calls
  `Player.setSize`: the collider, its test shapes, the head line, the camera, speed, jumps and
  the drawn body all scale with `player.size` (use `player.radius`, `halfHeight` and
  `eyeOffset()` rather than `BODY` for a player's own size); `Player.stomp` smokes a shrunk
  player someone lands on. The Portal Gun (`kind: 'portal'`, `firePortal` in `shooting.js`) opens portals in
  `portals.js` (`game.portals`, only in a set with it): `place` checks the oval fits on one
  flat surface, `movePlayer` (from `Player.tickMove`) carries players through, `trace` casts a
  hitscan shot leg by leg through portals (its tracers per leg), `carry` moves missiles, bolts and
  bugs, `carryBody` grenades and props; `snapshot` renders the low-frame-rate pictures into an
  atlas after the views (preset's `portalViews`, gfx switch `portalViews`).
- Dual wielding (Halo 2's): guns with `dual` in their def (Kindling, Toothpick) can be held one
  in each hand. `player.left` is the left gun's `WeaponState`; while it fires, `firingLeft` makes
  `player.weapon` return it, so `fire`, spread and reloads work for either hand (`leftHand` in
  `shooting.js`; `pullTrigger` is one gun's trigger; the left uses the `fire2` input: right click,
  LT). `DUAL` in `config.js` (spread, damage, first-person spread). Pickups offer a second
  dual-wield gun (`pickupDual`) and `dropLeft` lets it go (switching, swapping, dying). A set's
  `dual` list gives a loadout two of that primary (`left` on the loadout). First person:
  `Viewmodel.leftGuns`, mirror-image meshes sharing each gun's geometry, posed as the right
  gun's mirror. Bodies: each dual gun also gets a mirrored bone and baked copy (`rig`'s
  `leftBones`, `mirrorX`), shown by `CharacterModel.setLeft`; the left arm takes the mirrored
  grip and the stance stays square.
- `src/fx/`: pooled tracers and particles (sparks, smoke), one draw call per system. Beams get
  their own small tracer pool, built only when the match's set has a beam gun. Grapple lines are
  `ropes.js` (one draw call, hidden while no hook is out).
  - Particles pick a cell of their system's 4 x 4 atlas (`textures.fxAtlas` / `smokeAtlas`) and
    take a minimum on-screen size (`minPx`), an `owner` (hidden in that player's own view)
    and an optional `axis` to stretch along or `flat` normal to lie across (shock rings).
    `ramp` colors fire by age (white-hot to dark) and `ease` grows fast then settles. Smoke
    fades out right at the camera.
  - Marks: the smoke system keeps reserved slots at the front of its pool for bullet marks and
    blast scorches (`fx.mark`, `Particles.decal`: flat, lifted 1.5 cm and pulled a hair toward
    the camera in depth, fading over their last 3 s; a slot half a lap ahead starts its fade
    early, so marks fade out instead of popping up to about 16 a second on Medium). They're
    black with alpha only, so they darken whatever
    they lie on and keep its light. How many is the preset's `decals` (0 on Low), fixed per
    match. Guns leave at most about 5 marks a second (`shooting.js`).
  - Surfaces: `StaticBuilder` records each collider's material surface (`userData.surface` in
    `materials.js`: metal, dirt, wood, concrete, mud, cloth) and `game.castShot` returns it as
    `surface`, so `fx.impactWorld` throws the right debris and marks skip mud, nets and ropes.
    It also records visible boxes and cylinders with no collider (`trims`: hazard bands, glow
    strips, pads, drum rings); `game.trimFace` moves a hit out to a trim covering it (within
    10 cm), so marks sit on what you see. The mud has no collider, so `castShot` stops shots, projectiles and bugs at its
    surface (`zones.mudAlong`); a body under it can still be hit.
  - Explosions (`fx.explosion`, from `explode`): a white frame, fire billows, a shock ring out
    to the real damage radius, embers, smoke and a scorch. `explode` picks the surfaces: the
    scorch goes on what the blast went off against (`game.surfaceNear`, shrunk to fit by
    `game.fitDecal`), the ring lies flat only on a floor with no cover cutting it short and no
    drop under it (otherwise it faces the camera at its true size), blasts in the mud lie on its
    surface, and against a wall (missiles hitting one, grenades resting by one) the fire and
    smoke billow out from it. Explosion configs carry a `tint`. The preset's
    `fxScale` multiplies smoke and ember counts (also the fire troughs' embers and wisps, from
    `arena.update`).
  - Tracers are camera-facing ribbons built in the vertex shader, never thinner than about
    1.6 px. A bullet tracer's head travels from the gun to the hit point. Each starts at the
    shooter's first-person barrel in their own view and at `Player.worldMuzzle` (the
    third-person gun) in everyone else's.
  - Both read per-view uniforms (`viewUniforms.js`: viewer id and view height), set by
    `fx.setView` before each view renders. New effect shaders should use them the same way.
  - Glowing projectiles (`fx.glow`): thrown and launched things with a `glow` color in their
    projectile block (briquettes, Chimney coals, sticky bombs; the missile's motor) get a soft
    glow every tick and, while flying, a shrinking dot left behind (a light trail). An armed
    sticky pulses.
  - Combat cues: third-person muzzle flashes (`fx.muzzleFlash`, at most one per shooter per
    50 ms), the shield-break pop (from `dealDamage`) and the death puff tinted with the
    victim's armor color.
- `src/audio/`: sound effects (unlocked by the drop-in click). Guns, reloads and explosions
  are CC0 recordings in `src/audio/samples/` (`name-N.wav` files are variations of `name`;
  credits in `CREDITS.md`, regenerate with `tools/build_sounds.py`); everything else is
  synthesized at unlock. Sounds heard over and over (`TAKES`: guns, blasts, footsteps) get two
  more takes per recording, made at decode (`variant`: pitch by resampling, a tone tilt, the
  attack's level), `play` never picks the take it played last for that name, and sounds within
  `WIDE_NEAR` also feed a width bus (a short delayed copy on the right). `sfx.play(name, { at, source })` places a sound in the world: it
  fades and muffles with distance from the nearest local player and plays up close when
  `source` is a local player. Personal sounds (hit confirms, hurt, shields, pickups) are only
  played for local players (`!player.isBot`). Footsteps (`step`, `stepMetal`, `stepDirt`,
  `stepWood`, `stepMud`, four takes each: CC0 recordings shaped like a Spartan's boots by
  `tools/build_footsteps.py`, pitched down and low-passed with a sub-thump and an armor jingle;
  your own sit low in the mix) come from everyone: `Player.tickStride`
  runs a stride clock at the body's own stride length (`strideLength`, `character.js`), and each
  whole step plays the sound for the surface under the feet (a short ray down) unless crouched;
  landings play a louder one. The same clock drives the head bob (`CAMERA.bob*`, the eye dips at
  each footfall and sways toward the planted foot) and the first-person gun's bob.
- `src/world/`: procedural textures, materials, sky, fire, trigger zones, training dummies,
  per-map looks (`looks.js`), the maps, the game show (`show.js`: the crowd on the
  arena's grandstands as one instanced mesh moved in its vertex shader by a hype uniform, and
  the big screen's canvas texture; `finale.js`: the end-of-match podium, confetti and orbit
  camera, which `Game.render` draws instead of the views once `endMatch` makes one), the baked
  arena light (`bake.js`) and the
  pickup beacons (`beacons.js`: pad light columns, respawn rings and strip halos in one mesh,
  fed by `Pickups.pads` each frame).
  - Maps: `maps.js` registers each one (name, title-screen blurb, build function, look, bot
    links, default weapon set); `settings.map` picks one ('random' never repeats the last), and
    `Game.create({ map })` sets `game.mapId` / `game.map`. `arena.js` is Mudlark Gauntlet,
    `factory.js` Smokestack Works, `valley.js` Smokehouse Creek; shared pieces (crates, barriers, drums, pickup pads, the
    grandstands) are in `parts.js`; set dressing (Mudlark's sponsor boards, TV cameras, wall-top
    drum smokers and cable runs; Smokestack's hanging sausages, gauges, warning boards and corner
    pallets; on the floors, Mudlark's rocks and pebbles and stains, Smokestack's keep-clear border,
    lane lines, drains and tire scuffs) is in `dressing.js`: looks only except the pallets, built from materials the map
    already draws so it costs no draw calls; it returns smoke vents for the map's `update`. A build function returns the arena object everything else
    reads: `half` (the info panel map's half size), `shadowHalf` / `shadowTop` (the sun's
    shadow box), `stands` and `screen` (show.js: crowd rows, big-screen faces), `podium`
    (finale.js), `spawnPoints`, `pickupSpots`, `dummyPosts`, `zones`, `bake`, `update`, and
    StaticBuilder's `halos`, `surfaces`, `blockers` and `trims`.
  - Smokestack Works is indoors: its roof and trusses are looks only (no colliders, so the bake
    and the nav sampling, which casts down from 14 m, don't see them), with an invisible ceiling
    at 16.2 m. Its conveyor belts are zones (`zones.addBelt`, `beltAt`): `Player.tickMove` adds
    the belt's velocity while grounded on one; the belt texture scrolls in `arena.update` (the
    south line's boxes are turned around so the same scroll runs the other way).
  - Smokehouse Creek is open terrain: `heightAt(x, z)` shapes the ground (plateaus, the creek,
    hills, the rim slopes) and is used to place everything on it; the ground is one 1 m grid mesh
    (vertex colors from slope and wetness, `materials.grass`) with a matching trimesh collider.
    The creek is a mud zone under `materials.water` (`water()`: a grid that knows its depth, so
    it's clear and brown over the shallows, foamy at the banks, deep green-blue mid-stream, with
    ripples running downstream that calm with distance, and the arena's reflection by fresnel).
    The ground blends grass, dirt and rock per pixel (`terrainBlend`, wrapped outside the bake
    and grime; gfx switch `terrainBlend`) by each vertex's `aMix` from `groundMix` (dirt on the
    banks, round the bases and pads, along the tracks to the bridges and at the boulders' feet;
    rock on steep faces, projected from the side, and the rim's top); boulders use
    `materials.rock`. Grass tufts are `foliage.js` (one instanced mesh, swaying in the vertex
    shader and shrunk away past 30 m; placed by `tuftSpot`; the preset's `foliage` count, 0 on
    Low, gfx switch `foliage`). Launch pads are zones
    (`zones.addLaunch`, `launchAt`): `Player.tickMove` sets the velocity once while grounded on
    one and leaves the jump unsteered until landing (`launched`); bots take them as `launch`
    links (`VALLEY_LINKS`). A map bigger than the default 58 m square sets `nav: { halfX, halfZ,
    top }` for the nav sampling.
- `src/ai/`: bots. `navgraph.js` samples a multi-level nav graph from the physics world at load
  (walk / drop / jump / doublejump / firejump edges, plus map links, A* with a heap); `mapLinks.js` adds the
  obstacle moves per map (walls, nets, ropes, bars); `bot.js` is the brain that writes a bot's
  `InputState` each tick. Besides fighting, chasing and roaming it rides Sizzlers (`goalBikeNear`
  claims a free one in reach; `ride`, `drive` and `driveStuck` drive walk and drop edges only, via
  `findPath`'s edge filter), flings props with the Gravity
  Gun at range (`fling`, `FLING_BAND`), walks into anyone's linked portal when it's a big shortcut
  (`takePortal`), crouches for SAUCED in Oysters (`sauce`), and throws grenades by situation (a
  target standing still, a crowd, an empty gun, or a lob where someone ducked out of sight:
  `flush`), and takes the grapple (`grappleUp`: Normal and Hard bots) up to a ledge a few steps
  ahead on its path, or down a long straight stretch, skipping the path ahead to it. A new map
  needs its own links list.
- `src/render/`: renderer setup, split-screen viewports, shader warm-up, and the death replay
  (`replay.js`: records bodies, eyes and tracers every frame; `Game.render` draws replaying views
  last, between `replay.begin` and `replay.end`; tracers with owner `1000 + viewer` show only
  in that view).
- `src/ui/`: menus (with the join lobby), controller menu navigation (`padNav.js`), HUD (laid
  out like Halo 3's visor: grenades top left, shield top center, weapon with round ticks top
  right, motion tracker bottom left, scores bottom right, kill feed above the tracker; colors in
  the `--visor*` CSS variables; the controls strip always shows, and `Hud.layout` measures it
  into `--ctl-lift` so the bottom corners sit above it; with the motion tracker, `radar.js`:
  one small 2D canvas per view), the
  3-player info panel (`infoPanel.js`), FPS counter, and the loadout cards
  (`loadoutCard.js`): gun pictures rendered once per page at match load with the match's
  renderer (`gunIcons.js`) and looping SVG/CSS demos of how each gun works (`gunDemos.js`; a
  new gun adds its demo there, else it gets the generic stream of shots).

### Game loop

- `game.players` is everyone in the match (local people and bots); `game.humans` is just the
  local people with views and HUDs; `game.bots` the bots. Bots think and apply look inside the
  fixed tick; humans apply look per frame.
- Local players come from `seats` in `main.js`: each seat is an input source (`kbm` or a
  `GamepadInput`) with a `kind`. `Game.create({ players: [{ source, name }] })` gives each
  its own Player, view and HUD, sets `source.player`, calls `source.update(dt)` every frame
  and `source.prime()` on resume (so the button that resumed doesn't also act).
- `main.js` runs its own animation-frame loop for controllers outside gameplay: joining,
  menu navigation, Menu to pause and resume, dropped-controller handling.
- Physics and gameplay run at a fixed 60 Hz step. Rendering runs at display rate and
  interpolates positions, so 120 Hz MacBook screens stay smooth.
- Look input is applied every rendered frame for responsiveness; movement is applied per tick.
- Button presses are latched in `InputState` until a tick consumes them, so no press is lost
  between ticks.
- Anything that can be shot registers its collider with `game.registerEntity`; `game.castShot`
  maps ray hits back to entities. Targets implement `alive`, `vitals`, `headLineY()`, `die()`,
  `centerPosition()`, `facing()`, `distanceToBody()`; players also take `knockback()`.
- The Rapier world has gravity (-16), but it only moves dynamic bodies (grenades). Players run
  their own gravity in the character controller. Player movement, shots and line-of-sight
  checks use `EXCLUDE_DYNAMIC`, so grenades bounce off people without blocking them or bullets.

### Target platforms

- Primary dev/test machine is a MacBook. The game must be fully playable solo there.
- Must work in Chrome and Safari on macOS, plus Edge on Xbox. Check input and rendering changes in both Mac browsers.

### Input

- Keyboard + mouse (or trackpad), with pointer lock for aiming.
  - Request pointer lock from a click; browsers require a user gesture.
  - Esc always releases pointer lock and the page can't block it, so open the pause menu when `pointerlockchange` reports the lock was lost, not on an Esc keydown.
  - In Chrome, request `{ unadjustedMovement: true }` for raw mouse input and fall back to a plain `requestPointerLock()` if it rejects (Safari doesn't support it).
  - Don't bind gameplay actions to Ctrl (Ctrl+click is right-click on macOS) or Cmd (Cmd+W / Cmd+Q close the tab or browser).
- Xbox controller over Bluetooth, via the Gamepad API.
  - Poll `navigator.getGamepads()` every frame. A pad only appears after its first button press, so show a "press any button" hint.
  - Use the `standard` mapping layout and apply a deadzone to the sticks.
  - The Gamepad API only works in a secure context: `localhost` is fine, but testing from the Xbox needs an HTTPS URL.
  - A controller press is not a user gesture for pointer lock, so resuming from a pad never requests the lock; the keyboard player clicks to capture the mouse.
  - Edge on Xbox uses B as browser Back (guarded with a spare history entry) and may keep Menu for itself, so D-pad down also pauses. Verify both on the console in step 7.
- On Edge on Xbox the controller is the only input, so every menu and gameplay action must be reachable with it.

### Rendering performance

Performance is the top priority. Target 60fps with 3 split-screen views in Edge on Xbox.

- Cap render resolution on high-DPI screens: use `Math.min(window.devicePixelRatio, cap)` for the renderer pixel ratio. On the medium quality preset the cap is about 1.5. Retina Macs report 2, which is roughly 1.8x the pixels of 1.5.
- Pre-compile all shaders during the loading screen so nothing compiles mid-game. Warm up every material, lighting and shadow combination that can appear, including things spawned later (muzzle flashes, explosions, pickups), by rendering them once before gameplay starts.
- Quality presets (low / medium / high) live in `src/settings.js`: pixel ratio cap, shadow map size, anti-aliasing, anisotropy.
- Dynamic resolution (`render/dynres.js`, `game.dynres`, gfx switch `dynamicResolution`): when
  frames average under about 51 fps for 0.6 s, the render scale (a multiple of the preset's
  pixel ratio, down to 0.55) steps down 15%; after a hold of frames on time (4 s, doubling up to
  32 s when a step up costs frames again) it steps back up 8%. Each change reallocates the
  canvas, so it stays rare. The FPS counter shows the scale when it's under 100%, and the bench
  reports it (`resScale`); turn it off there with `off=dynamicResolution` for fixed numbers.
- The shadow map is rendered once per frame, not once per viewport (`shadowMap.autoUpdate = false`, set `needsUpdate` before the first view). The sun's shadow camera is fitted at load (`fitShadowCamera` in `game.js`: the smallest square around the arena over every roll about the sun's axis) so one map serves every view at the best texel density.
- Static arena geometry is merged into one mesh per material to keep draw calls low. Add new static props through `StaticBuilder` so they get merged too. Glowing strips share one vertex-colored material: pass the `materials.glowCyan` / `glowOrange` / `ember` tints to `StaticBuilder` like materials. Give a strip `halo: [nx, ny, nz]` (its open face) to get a soft halo there (Medium and High only, `preset.halos`).
- Baked arena light (`src/world/bake.js`): `StaticBuilder` records every visible solid and
  glow source; before `build()` the arena bakes floor contact shadows, tone variation, stains
  (`B.stain`) and glow pools (`B.light`, glow strips add themselves) into one RGBA texture the
  ground and mud materials read (`bake.apply(material)`, cache key `arenaBake`). Mark a map's
  walkable ground boxes `floor: true`. The bake is cached per map and `bakeSize` (quality
  preset), so rematches skip it; `game.bake` keeps the arrays (`lightAt`, `floorBelow`).
- Static materials use `vertexColors`: `StaticBuilder.build()` writes each vertex's light
  (darker toward what it stands on, into corners, grime on metal and concrete, undersides).
  Upright boxes, cylinders and steep rods (ropes) get extra side rows for it, and long box
  sides a column every 2 m (`sideBox`: only the sides are split; tops and bottoms share their
  edge vertices so boxes stay watertight, since T-junctions crack into single-pixel holes). Any static geometry needs a `color`
  attribute, so add it through `StaticBuilder`, not as a separate mesh with these materials.
- Lights, fog, sky colors and the color grade come from the map's look (`src/world/looks.js`).
- The sky (`sky.js`): the dome's vertex colors carry the gradient and the sun's glow, a cloud band
  wraps the horizon (its texture drifts in `sky.update`), and outdoor looks with `sky.skyline` get
  the facility around the arena (`skyline.js`, gfx switch `skyline`): every structure in one
  Lambert mesh whose vertex shader blinks the aviation lights and drives the monorail train
  (`aGlow`, `aBlink`, `aTrain`, `uTime`) and whose fragment fades it into the horizon haze, plus
  the stacks' smoke as one billboard mesh moved entirely in its vertex shader. About 3 draw
  calls per view.
- Sun lens flare (`render/flare.js`, outdoor looks with `flare`, Medium and High: `preset.flare`,
  gfx switch `flare`): one additive screen-space mesh (a glare and ghosts along the line from
  the sun through the middle), placed per view by `flare.setView` (it updates the camera's
  matrix first) and faded in and out per player by a level-only ray toward the sun
  (`game._sunRay`: not bodies, not the invisible blockers). God rays (looks with `godRays`, High
  only, gfx switch `godRays`): one quarter-size pass in the bloom chain smears the bright part
  toward each view's sun before the up passes, added in the composite.
- Indoor sunbeams (`shafts.js`, Smokestack): an open slanted prism per skylight bay, from the
  opening down to the floor along the sun, drawn additively and faded toward the floor, at
  grazing angles and right at the camera; dust motes as one points mesh drifting down the beams
  in its vertex shader. Medium and High only (`preset.shafts`, gfx switch `shafts`); map builds
  get the preset as `preset`.
- Pooled systems hide themselves while empty (particles, tracers, beams, grenades, bolts, swarms, pickups): three still issues a draw for a zero-count instanced mesh. Pickups are one instanced mesh per gun type plus one for grenade pairs.
- The sky dome draws last (`renderOrder` 1, depth test on, no depth write), so the arena's depth hides most of its pixels.
- Textures are painted once per page load and size (the preset's `textureSize`: 512 on medium
  and high, 256 on low); later matches reuse the canvases, and the title screen pre-paints
  them while idle (`prepaintTextures`). Surface painters also paint a height canvas, and
  `relief()` shades the color by its slope (walls lit from above, the ground from the sun's
  azimuth), so details look raised at no per-frame cost. `relief()` also writes a normal map from the same
  slopes; on High (`preset.normalMaps`, gfx switch `normalMaps`) `createTextures` returns it as
  `<name>Normal` and `createMaterials` sets it as the material's `normalMap`. Keep distinctive marks (numbers,
  prints) off tiling textures: they show the repeat. Walls and floors are weathered in the
  painters (`stains`, `streaks`, `scratches`), and on top the level materials get world-space
  grime (`applyGrime` in `materials.js`, gfx switch `grime`): the `grime` map (blotches in R,
  downward streaks in G) sampled by world position at two scales, so dirt patches don't repeat
  with the tiles. A material's own `onBeforeCompile` must chain to the one already there (as
  `bake.apply` does), or the grime is lost.
- Prefer `MeshLambertMaterial` / `MeshPhongMaterial` over `MeshStandardMaterial`. No dynamic lights beyond the sun and hemisphere light unless it's measured to be cheap.
- Don't create materials or allocate per frame in hot paths. Reuse vectors, pool spawned objects.
- The FPS counter (backquote key or settings) shows fps, frame time and draw calls, plus the shadow pass's draws and each view's.
- Each view renders the world, then clears depth and renders the viewmodel scene (its own
  camera and lights) so guns never clip into walls. `renderer.autoClear` is off; views clear
  themselves inside their scissor rect.
- Bloom (`render/bloom.js`, High preset only: `preset.bloom`, gfx switch `bloom`): every view
  draws into one offscreen half-float frame (`Bloom.view` sets the target's own viewport and
  scissor, since a render target ignores the renderer's), then `end()` keeps what's over the
  threshold at half size, blurs it down five levels and back up, and draws frame plus glow to the
  canvas: about ten passes a frame. Custom effect shaders that write display-ready colors end
  with `DISPLAY_OUT` (blended) or `DISPLAY_ADD` (additive) from `render/displayOut.js`, so they
  look the same drawn into that linear frame as on the canvas; shaders that build on three's
  chunks or end with `colorspace_fragment` need nothing.
- First-person framing is Halo's: big, close and low on the right with the barrel nearly level.
  `VIEWMODEL` in `config.js` sits on top of every gun's own `view` pose: the viewmodel camera's
  field of view, a size multiplier, `place` (each gun's place and all its motions pulled in by
  the same ratios per axis, so guns keep their sizes relative to each other), a turn and the
  muzzle flash size. Guns with a `display` (Hickory, Kindling, Rotisserie) show the mag count on
  a small screen on the gun (a canvas redrawn only when the count changes, orange when low; one
  plane on the held gun, placed by Euler `rot` or by `normal` and `up`).
- Color grade and adapting exposure (`render/grade.js`, gfx switch `grade`, every preset): the
  map's `look.grade` is baked into three's custom tone mapping hook (`applyGrade` rewrites the
  `CustomToneMapping` chunk before the match compiles), so every built-in material grades itself
  with no extra pass: exposure, saturation, contrast around middle grey, white balance, a blue
  lift in the shadows, and a shoulder above `knee` that rolls bright light off to white. Under
  the grade the sky dome and clouds are drawn `grade.sky` times brighter and the fog and skyline
  haze `grade.haze` times (`skyBoost` / `hazeBoost`), so the horizon blows out. `AutoExposure`
  gives each local player's view its own exposure (`renderer.toneMappingExposure`, set per
  view): every 0.2 s nine rays from the eye (straight up and a ring at 60 degrees, 12 m, level
  geometry only) measure open sky, from `grade.shade` under full cover to `grade.open` in the
  open, adapting over about a second. The viewmodel's own lights are turned down by the same
  factor. Drawing into a render target skips tone mapping, so on High the bloom composite grades
  instead, with each view's exposure (`uRects`, `uExposure`). Effect shaders ending in
  `DISPLAY_OUT` / `DISPLAY_ADD` aren't graded on Low and Medium (only by the composite on High).
- First-person guns (and the loadout pictures) use `viewmodelMaterial()` (`viewmodel.js`): Phong
  whose shine follows each vertex's finish (`aFinish`: matte, wood, paint, metal, glow), a
  sky-and-ground reflection on metal and paint (`viewmodelUniforms`, the world's up set per view
  in `Game.render`), wood grain and grit from the gun-space position, and self-lit glow parts.
  On metal and paint it also draws manufactured detail from the gun-space position (`VM_DETAIL`:
  pixel-wide panel seams with a light lip, a top-lit falloff, worn patches on paint) and nudges
  the normal with noise (`VM_DENT`: a broad sway and fine dents), so the sun's highlight is a
  gradient and a glint instead of a flat face turning white.
  Chamfers are painted lighter, so edges catch the light.
- First-person gloves are built from each gun's `hands` boxes (`player/gloves.js`: a fist on
  the grip with the index on the trigger, a support hand that cradles, grips or holds a handle,
  forearms as rods from the wrist). Parts tagged `group: 'mag' | 'pump'` and the support hand
  (`'support'`) move on their own in the vertex shader (`aGroup`, `uGroupOff`, set per view by
  `Viewmodel.bind()`), so reloads (mag out, hand fetches a new one) and the pump cost no draws.
  The sway is a spring that overshoots a little; strafing leans the gun; standing still it breathes.
- Reflections (`render/reflections.js`, gfx switch `reflections`): at the end of `warmUp` the
  arena is captured once into a 128 px cube map from 3 m above the podium, with every body hidden.
  The body and first-person gun materials sample it (`envUniforms`: `uEnv`, `uEnvOn`, and
  `uCamRot`, the view's rotation for the gun, set per view) at a blurry mip for plates and a
  sharp one for glass; until it's captured they fall back to the sky-and-ground gradient.
- Bodies share one Phong material with a small `onBeforeCompile` addition: per-vertex
  `aGlow` (parts that glow on their own), `aShine` (how glossy: `SHINES` per Spartan region,
  `shine` per cast palette entry, `GUN_SHINES` per gun finish; the highlight's strength and a
  faint sky-and-ground reflection, strongest on the visor) and `aTeam` (the body's color, for a
  distance-scaled rim light), plus `aKind` (what the surface is: `KINDS` per Spartan region,
  cast characters `CAST_KIND`, guns 0), which picks the detail drawn from the rest pose
  (`vRest`, so it rides the armor): on painted plates panel seams (abdomen bands, the chest's
  center line, lines across arms and legs), mottled paint, grit, chips and scratches to bare
  metal, and a dented normal that breaks highlights up; a ribbed weave and grazing sheen on the
  undersuit; grit on boots and bare metal (`KIND_COLOR`, `KIND_NORMAL`). Seams and weave fade
  out past about 14 m. Any geometry drawn with it needs all four attributes. Each body
  has its own instance of it (one program) carrying where it stands: `CharacterModel.sampleLight`
  reads the bake at the feet every frame (`lightAt`, darker under a deck; `glowAt`, the glow
  pools' color) into `uLocal`, which scales the sky's fill and reflections, and `uBounce`, a
  colored fill strongest on the underside (three only re-uploads a built-in material's uniforms
  when the material changes between draws, hence one per body). The first-person gun's lights
  follow too: its fill by the same local light, its sun by a ray from the eye toward the sun. `smokeem.lineup({ distance })`
  (debug) stands every body color in a row for readability checks.
- The Spartan is bulked up at decode (`BONE_BULK` / `REGION_BULK` in `character.js`): armor
  pushed out along the averaged normals by bone and region, most on the chest and pauldrons,
  with the helmet, visor and hands left alone (the head band fit and the grips depend on them).
- The body (`character.js`) is decoded once per page load from `body/bodyMesh.js` (about 2.6k
  vertices and 3.1k triangles, smooth-skinned, up to 4 bones per vertex) and each body only
  paints its own colors by region (armor, trim, undersuit, gloves, visor and its shine, strips,
  ember, metal), times the tool's baked `DATA.shade` per vertex (occlusion at rest, darker plate
  edges, the visor's gradient); guns are appended as boxes on their bones (about 1.1k more
  vertices per set). The shield shell is the same mesh pushed
  1.75 cm along precomputed averaged normals, so it has no cracks; while it flashes
  (`flashShield`) its shader (`SHIELD_*`) draws a golden flare brightest at the silhouette, with
  energy bands running up the body and sparkle, and a break (strength 1) bulges it out and flashes
  it white-gold for `SHIELD_POP` seconds (per-body uniforms on one shared program). The skeleton's joints come
  from the data, so changing the rig means changing `tools/build_body.mjs` and rebuilding.
- A player's own body sits on layer `1 + id`, which that player's camera disables (except while
  flying a missile). The sun's shadow camera enables all layers so you still see your own
  shadow.
- Third-person guns are baked into the skinned body on their own bones; unheld guns are scaled
  to ~0, so switching weapons costs no draw calls.
- Body language lives in `CharacterModel.update`, fed by `Player.pose` (one reused object:
  velocity along the facing and to the right, air and crouch state, event counters for landings,
  double jumps and shots (`fire()` bumps `pose.shots`), time since the last shot and how long the
  aim pose holds after it, plus `sliding`, a `wallKicks` counter and `kickSide` for the body to
  animate later, `reload` progress, and `throws`, `melees` and `hurts` counters with the last hit's
  `hurtFwd` / `hurtSide`). On top of the holds (`RELOAD`, `THROW`, `MELEE_SWING`, `FLINCH`,
  `CLIMB` in `character.js`): a reload rolls the gun over and takes the support hand to the belt,
  a throw winds the free hand up over the shoulder and slings it, a melee swings the gun butt
  across with the torso, a hit jolts the torso and head away from it, and climbing goes hand over
  hand with the knees stepping and the gun slung on the back (`SLING_POS` / `SLING_Q`). The hips turn toward the move direction while the
  spine (Euler order YXZ) turns back and carries part of the aim pitch (the head and the gun
  bone take the rest), so the torso and gun stay on the aim. The hip height comes from the leg
  angles (`legDrop`), so feet stay on the floor; crouching is a deep squat (`CROUCH`) so the
  helmet stays near the crouched capsule. Arms are two-bone IK onto each gun's grips, each
  segment turned from its own rest direction (the model's slight A-pose), with hand bones turned
  to the grip; holds sit a little in from each gun's `carry`, two-handed guns turn the torso into
  a bladed stance (`TWIST`, undone on the gun bone) and the support hand stops short of full
  reach so the elbow stays bent. Every frame `update` fits the helmet into the hitbox's head
  band (its lowest and highest point per head tilt come from the mesh at load): too high sinks
  the hips, too low gives back the hips' own drops first, then lifts the crouch or the neck.
  Keep poses inside the headshot band (lean 8 degrees or less).
  Smoked bodies go ragdoll-ish: `Player.startCorpse` / `updateCorpse` push, drop and tip the
  body (numbers in `CORPSE`, `config.js`) and `CharacterModel.ragdoll()` poses it limp.
  Characters (`body/cast.js`: Crash, Link, Bond; the Spartan is the generated mesh) are built
  from ellipsoids, tapered limbs, boxes and cones, each riding one bone of the same skeleton, in
  the decoded mesh's form plus a palette (null color: the player's); `CharacterModel` takes
  `character`, and each seat's pick (`source.character`) comes from the join screen.
  `CharacterModel.reset()` clears carried state on every respawn (players and dummies), puts
  every body bone back at rest after a ragdoll, and
  `endSprint()` snaps the gun out of the sprint hold the tick a shot fires.
  `smokeem.poseViewer({ distance, time, turn, only })` (debug) runs bodies through every state
  and action (`only`: state names).
- `renderer.compile` skips hidden objects, so warm-up forces every effect, shield shell and
  muzzle flash visible for one compile + render. New spawnable things must hook into
  `Game.warmUp()` the same way.

### Settings menu

- Mouse sensitivity setting: a multiplier applied to pointer lock `movementX` / `movementY`, saved to `localStorage` so it persists between sessions.
- Also saved: quality preset, invert Y, field of view (horizontal, default 78 like Halo; `rev`
  marks saves migrated off the old 95 default), head bob (`headBob`), FPS counter, volume, bot
  count and skill,
  match length (`timeLimit`, minutes, 0 = no limit), movement speed (`settings.moveSpeed`,
  read live by the player controller every tick),
  controller look speed (`stickSensitivity`), vibration (`rumble`) and the weapon set
  (`weaponSet`: `'default'` for the map's set, a set id, or `'mystery'`). Settings are shared
  by all local players.

## Style

- No em-dashes anywhere (docs, code comments, UI text).

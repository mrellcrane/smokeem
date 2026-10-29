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
  menu, pads, seats). `smokeem.playWithoutLock()` starts play without pointer lock, for
  headless browser tests. Headless Chromium (Playwright) renders the game fine with
  SwiftShader; drive it by pausing the game and calling `game.tick(1 / 60)` with values
  written into the player's `InputState`, since headless frame rates are too low for
  real-time checks.
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
- `src/config.js`: movement and body tuning numbers.
- `src/settings.js`: quality presets and saved settings (`localStorage`).
- `src/input/`: input sources (keyboard/mouse, gamepads; bots write theirs from `src/ai/`)
  all write the same `InputState`, so the player controller doesn't care where input comes
  from. `gamepad.js` has `Gamepads` (reads `navigator.getGamepads()` once per frame) and
  `GamepadInput` (one pad's gameplay mapping, rumble).
- `src/player/`: the player controller (movement, climbing, mantling, camera), the skinned
  character body and the first-person viewmodel.
- `src/combat/`: vitals (shields/health), weapon data and state (`weapons.js`), the shared
  box-built gun shapes (`weaponModels.js`), the per-tick weapon controller (`shooting.js`:
  trigger, pellets, missile launch, grenades, melee, switching, reloads), projectiles
  (`projectiles.js`: Smoke Signal missiles, grenades as Rapier dynamic bodies), area damage
  (`explosions.js`), pickups, and `dealDamage`, the single path all damage goes through.
- `src/fx/`: pooled tracers and particles (sparks, smoke), one draw call per system.
- `src/audio/`: sound effects (unlocked by the drop-in click). Guns, reloads and explosions
  are CC0 recordings in `src/audio/samples/` (`name-N.wav` files are variations of `name`;
  credits in `CREDITS.md`, regenerate with `tools/build_sounds.py`); everything else is
  synthesized at unlock. `sfx.play(name, { at, source })` places a sound in the world: it
  fades and muffles with distance from the nearest local player and plays up close when
  `source` is a local player. Personal sounds (hit confirms, hurt, shields, pickups) are only
  played for local players (`!player.isBot`).
- `src/world/`: procedural textures, materials, arena layout, sky, fire, trigger zones,
  training dummies.
- `src/ai/`: bots. `navgraph.js` samples a multi-level nav graph from the physics world at load
  (walk / drop / jump / doublejump / firejump edges, A* with a heap); `mapLinks.js` adds the
  obstacle moves per map (walls, nets, ropes, bars); `bot.js` is the brain that writes a bot's
  `InputState` each tick. A new map needs its own links list.
- `src/render/`: renderer setup, split-screen viewports, shader warm-up.
- `src/ui/`: menus (with the join lobby), controller menu navigation (`padNav.js`), HUD, the
  3-player info panel (`infoPanel.js`), FPS counter.

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
- The shadow map is rendered once per frame, not once per viewport (`shadowMap.autoUpdate = false`, set `needsUpdate` before the first view). The sun's shadow camera covers the whole arena so one map serves every view.
- Static arena geometry is merged into one mesh per material to keep draw calls low. Add new static props through `StaticBuilder` so they get merged too.
- Prefer `MeshLambertMaterial` / `MeshPhongMaterial` over `MeshStandardMaterial`. No dynamic lights beyond the sun and hemisphere light unless it's measured to be cheap.
- Don't create materials or allocate per frame in hot paths. Reuse vectors, pool spawned objects.
- The FPS counter (backquote key or settings) shows fps, frame time and draw calls.
- Each view renders the world, then clears depth and renders the viewmodel scene (its own
  camera and lights) so guns never clip into walls. `renderer.autoClear` is off; views clear
  themselves inside their scissor rect.
- A player's own body sits on layer `1 + id`, which that player's camera disables (except while
  flying a missile). The sun's shadow camera enables all layers so you still see your own
  shadow.
- Third-person guns are baked into the skinned body on their own bones; unheld guns are scaled
  to ~0, so switching weapons costs no draw calls.
- `renderer.compile` skips hidden objects, so warm-up forces every effect, shield shell and
  muzzle flash visible for one compile + render. New spawnable things must hook into
  `Game.warmUp()` the same way.

### Settings menu

- Mouse sensitivity setting: a multiplier applied to pointer lock `movementX` / `movementY`, saved to `localStorage` so it persists between sessions.
- Also saved: quality preset, invert Y, field of view, FPS counter, volume, bot count and skill,
  movement speed (`settings.moveSpeed`, read live by the player controller every tick),
  controller look speed (`stickSensitivity`) and vibration (`rumble`). Settings are shared by
  all local players.

## Style

- No em-dashes anywhere (docs, code comments, UI text).

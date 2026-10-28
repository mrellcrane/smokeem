# smokeem

## Run locally

```bash
npm install
npm run dev
```

Then open the localhost URL it prints.

## Tech

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
- On Edge on Xbox the controller is the only input, so every menu and gameplay action must be reachable with it.

### Rendering performance

- Cap render resolution on high-DPI screens: use `Math.min(window.devicePixelRatio, cap)` for the renderer pixel ratio. On the medium quality preset the cap is about 1.5. Retina Macs report 2, which is roughly 1.8x the pixels of 1.5.
- Pre-compile all shaders during the loading screen so nothing compiles mid-game. Warm up every material, lighting and shadow combination that can appear, including things spawned later (muzzle flashes, explosions, pickups), by rendering them once before gameplay starts.

### Settings menu

- Mouse sensitivity setting: a multiplier applied to pointer lock `movementX` / `movementY`, saved to `localStorage` so it persists between sessions.

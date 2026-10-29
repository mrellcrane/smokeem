import './style.css';
import { Game } from './game.js';
import { Menu, MAX_LOCAL_PLAYERS } from './ui/menu.js';
import { PadNav } from './ui/padNav.js';
import { FpsCounter } from './ui/fps.js';
import { PointerLock } from './input/pointerLock.js';
import { KeyboardMouseInput } from './input/keyboardMouse.js';
import { Gamepads, GamepadInput } from './input/gamepad.js';
import { Sfx } from './audio/sfx.js';
import { settings, updateSettings, onSettingsChange } from './settings.js';
import { loadoutLabel, chooseSet, DEFAULT_SET } from './combat/arsenal.js';
import { WEAPONS } from './combat/weapons.js';
import { gfx } from './render/gfx.js';

const DEBUG = new URLSearchParams(window.location.search).has('debug');
// ?bench runs a scripted split-screen match and reports frame times (src/render/bench.js).
const BENCH = new URLSearchParams(window.location.search).has('bench');

const stage = document.getElementById('stage');
const hudRoot = document.getElementById('hud');
const uiRoot = document.getElementById('ui');

const fps = new FpsCounter(document.getElementById('app'));
fps.setVisible(settings.showFps);

const lock = new PointerLock(stage);
const kbm = new KeyboardMouseInput(lock);
const pads = new Gamepads();
const sfx = new Sfx();
let game = null;
let loading = false;
// The last weapon set played, so Mystery Meat never repeats it.
let lastSet = null;

// Local players in seat order (player 1 first). Each seat is an input source: the keyboard
// and mouse, or a GamepadInput. Seats change only on the title screen and carry over between
// matches.
const seats = [];

const menu = new Menu(uiRoot, {
  onPlay: startMatch,
  onResume: resumeMatch,
  onQuit: quitMatch,
  onEndMatch: () => game?.match.end(),
  onRematch: rematch,
  onJoinKbm: () => join(kbm),
  onLeave: (i) => leave(seats[i]),
  inMatch: () => !!game,
  lobby: () => ({ seats: seats.map(seatInfo), padsSeen: pads.seen }),
  onLoadout: (i, dir) => cycleLoadout(i, dir),
  loadoutRows: () => (game && game.arsenal.loadouts.length > 1 ? game.humans.map((p) => loadoutLabel(game.arsenal.set, p.loadout)) : []),
  matchKinds: () => seats.map((s) => s.kind),
  hasMissile: () => !game || game.arsenal.missile,
  audioLocked: () => sfx.ctx?.state !== 'running',
  setInfo: () => {
    if (!game) return null;
    const { set } = game.arsenal;
    const where = (id) => (id === set.power ? 'power pad' : id === set.field ? 'field pads' : id === set.sidearm ? 'sidearm' : 'primary');
    const ids = [...set.primaries, set.sidearm, set.field, set.power];
    return { name: set.name, heat: set.heat, guns: ids.map((id) => ({ name: WEAPONS[id].name, blurb: WEAPONS[id].blurb, where: where(id) })) };
  },
});
const nav = new PadNav(uiRoot);

function seatInfo(src) {
  return { kind: src.kind, label: src.kind === 'gamepad' ? `Controller ${src.index + 1}` : 'Keyboard + mouse' };
}

function join(src) {
  if (game || loading || seats.includes(src) || seats.length >= MAX_LOCAL_PLAYERS) return;
  seats.push(src);
  menu.renderLobby();
}

function leave(src) {
  const i = seats.indexOf(src);
  if (game || loading || i < 0) return;
  seats.splice(i, 1);
  menu.renderLobby();
}

const padSeat = (index) => seats.find((s) => s.kind === 'gamepad' && s.index === index);
const kbmPlaying = () => seats.includes(kbm);

// ---------------------------------------------------------------- pause and resume

// With the mouse in the match, pause follows the pointer lock state, never Esc keydowns (the
// browser owns Esc). Controllers pause with Menu.
lock.onLock = () => {
  if (!game) return;
  // The match ended (or nothing asked to resume) while the request was pending.
  if (game.state === 'over') {
    lock.exit();
    return;
  }
  menu.hide();
  kbm.setEnabled(true);
  game.resume();
};
lock.onUnlock = () => {
  kbm.setEnabled(false);
  if (!game || game.state !== 'playing') return;
  pauseMatch();
};
lock.onError = () => {
  if (!game || game.state === 'playing' || game.state === 'over') return;
  const msg = "Couldn't capture the mouse. Click again (browsers block it for a moment after Esc).";
  if (game.state === 'ready') menu.showReady(msg);
  else menu.showPause(msg);
};

function pauseMatch(message) {
  if (!game || game.state !== 'playing') return;
  kbm.setEnabled(false);
  lock.exit();
  game.pause();
  menu.showPause(message);
}

function resumeMatch() {
  if (!game) return;
  // Browsers only allow pointer lock and audio from a user gesture.
  sfx.unlock();
  if (kbmPlaying() && menu.lastInput === 'kbm') {
    lock.request();
    return;
  }
  // Started from a controller: go without the mouse. The keyboard player clicks in to aim.
  menu.hide();
  game.resume();
}

stage.addEventListener('mousedown', () => {
  if (game?.state === 'playing' && kbmPlaying() && !lock.isLocked) {
    sfx.unlock();
    lock.request();
  }
});

pads.onDisconnect = (index) => {
  const src = padSeat(index);
  if (!src) return;
  if (!game) {
    // While loading, the new match already has this seat: keep it, like mid-match.
    if (!loading) leave(src);
    return;
  }
  const msg = `Player ${seats.indexOf(src) + 1}'s controller dropped. Turn it back on, or press A on another one.`;
  if (game.state === 'playing') pauseMatch(msg);
  else if (menu.screen === 'pause') menu.showPause(msg);
};

// ---------------------------------------------------------------- matches

onSettingsChange((s, patch) => {
  if ('showFps' in patch) {
    fps.setVisible(s.showFps);
    if (game) game.showDebug = DEBUG || s.showFps;
  }
});

async function startMatch() {
  if (loading || game) return;
  // Nobody joined: whoever hit Play with the mouse or keyboard plays solo.
  if (!seats.length) join(kbm);
  loading = true;
  menu.showLoading('Loading', 0);
  try {
    game = await Game.create({
      stage,
      hudRoot,
      fps,
      sfx,
      players: seats.map((source, i) => ({ source, name: `Player ${i + 1}`, loadout: source.loadout ?? 0 })),
      bots: settings.bots,
      botSkill: settings.botSkill,
      practiceTargets: settings.bots === 0,
      timeLimit: settings.timeLimit,
      weaponSet: (lastSet = chooseSet(settings.weaponSet === 'default' ? DEFAULT_SET : settings.weaponSet, lastSet)),
      onProgress: (text, progress) => menu.showLoading(text, progress),
    });
    game.showDebug = DEBUG || settings.showFps;
    document.body.classList.add('in-match');
    game.onMatchEnd = (results) => {
      kbm.setEnabled(false);
      lock.exit();
      menu.showResults(results, game.humans);
    };
    game.start();
    menu.showReady();
  } catch (err) {
    console.error(err);
    game?.dispose();
    game = null;
    menu.showError(`Something broke while loading: ${err.message}`);
  } finally {
    loading = false;
  }
}

// Before the first drop-in: change a local player's spawn loadout.
function cycleLoadout(i, dir) {
  const p = game?.humans[i];
  if (!p || game.state !== 'ready') return;
  p.loadout += dir;
  p.armLoadout();
  game.needsRender = true;
  menu.renderLoadouts();
}

function endGame() {
  kbm.setEnabled(false);
  lock.exit();
  document.body.classList.remove('in-match');
  if (game) {
    // Remember each player's loadout for the next match.
    game.humans.forEach((p, i) => {
      if (seats[i]) seats[i].loadout = p.loadout;
    });
    game.dispose();
    game = null;
  }
  // Controllers that dropped out mid-match give up their seats.
  for (const s of [...seats]) if (s.kind === 'gamepad' && !s.connected) leave(s);
}

function quitMatch() {
  endGame();
  menu.showTitle();
}

// Same players and settings, fresh match.
function rematch() {
  endGame();
  startMatch();
}

// ---------------------------------------------------------------- controllers

// Edge on Xbox maps B to the browser's Back button. Once a controller shows up, keep a spare
// history entry so B never navigates away from the game.
let backGuard = false;
function guardBack() {
  if (backGuard) return;
  backGuard = true;
  history.pushState({ smokeem: true }, '');
  window.addEventListener('popstate', () => history.pushState({ smokeem: true }, ''));
}

function padMenu(gp, e, seat) {
  const screen = menu.screen;
  // A (or Menu) on a new controller takes the next seat. That press does nothing else.
  if (screen === 'title' && !seat && (e.a || e.menu)) {
    join(new GamepadInput(pads, gp.index));
    return;
  }
  // A dropped controller's seat goes to the next new one that presses A.
  if (game && !seat && e.a) {
    const orphan = seats.find((s) => s.kind === 'gamepad' && !s.connected);
    if (orphan) {
      orphan.index = gp.index;
      if (screen === 'pause') menu.showPause();
      return;
    }
  }
  // On the ready screen, left/right changes that controller's own loadout.
  if (screen === 'ready' && seat && (e.dir === 'left' || e.dir === 'right')) {
    cycleLoadout(seats.indexOf(seat), e.dir === 'right' ? 1 : -1);
  } else if (e.dir) nav.move(e.dir);
  if (e.a) {
    menu.lastInput = 'pad';
    nav.activate();
  }
  if (e.b) {
    if (screen === 'settings') menu.onAction('back');
    else if (screen === 'pause') {
      menu.lastInput = 'pad';
      resumeMatch();
    } else if (screen === 'title' && seat) leave(seat);
  }
  if (e.menu && (screen === 'pause' || screen === 'ready')) {
    menu.lastInput = 'pad';
    resumeMatch();
  }
}

// After pause or results open over a live match, controllers are ignored for a moment: the
// other players are still jumping (A) and crouching (B) and haven't noticed yet.
const MENU_GRACE = 500;
let lastNow = performance.now();
let wasMenuUp = false;
let menuOpenedAt = 0;
function padFrame(now) {
  requestAnimationFrame(padFrame);
  const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  pads.poll();
  if (!pads.seen) return;
  guardBack();
  const menuUp = !!menu.screen && menu.screen !== 'loading';
  if (menuUp && !wasMenuUp) {
    nav.holdAll();
    menuOpenedAt = now;
  }
  wasMenuUp = menuUp;
  const grace = (menu.screen === 'pause' || menu.screen === 'results') && now - menuOpenedAt < MENU_GRACE;
  for (const gp of pads.connected()) {
    const e = nav.read(gp, dt);
    // Chromium counts controller presses as a gesture, so this can start audio there.
    if (e.a || e.menu) sfx.unlock();
    const seat = padSeat(gp.index);
    if (menuUp) {
      if (!grace) padMenu(gp, e, seat);
    } else if (game?.state === 'playing' && seat && (e.menu || e.down)) pauseMatch();
  }
  if (menu.screen === 'title') menu.renderLobby();
}

// Any real click or key press can start audio (Safari only allows it from these, never from a
// controller).
window.addEventListener('pointerdown', () => sfx.unlock(), true);
window.addEventListener('keydown', () => sfx.unlock(), true);
requestAnimationFrame(padFrame);

// Backquote toggles the FPS counter from anywhere.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote' && !e.repeat) updateSettings({ showFps: !settings.showFps });
});

if (BENCH) import('./render/bench.js').then((m) => m.runBench({ stage, hudRoot, uiRoot, fps, sfx }));
else menu.showTitle();

if (DEBUG) {
  window.smokeem = {
    get game() {
      return game;
    },
    kbm,
    lock,
    menu,
    nav,
    pads,
    seats,
    settings,
    sfx,
    gfx,
    // For automated tests in browsers without pointer lock.
    playWithoutLock() {
      if (!game) return;
      menu.hide();
      if (kbmPlaying()) kbm.setEnabled(true);
      game.resume();
    },
  };
}

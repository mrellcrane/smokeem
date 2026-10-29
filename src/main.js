import './style.css';
import { Game } from './game.js';
import { Menu } from './ui/menu.js';
import { FpsCounter } from './ui/fps.js';
import { PointerLock } from './input/pointerLock.js';
import { KeyboardMouseInput } from './input/keyboardMouse.js';
import { Sfx } from './audio/sfx.js';
import { settings, updateSettings, onSettingsChange } from './settings.js';

const DEBUG = new URLSearchParams(window.location.search).has('debug');

const stage = document.getElementById('stage');
const hudRoot = document.getElementById('hud');
const uiRoot = document.getElementById('ui');

const fps = new FpsCounter(document.getElementById('app'));
fps.setVisible(settings.showFps);

const lock = new PointerLock(stage);
const kbm = new KeyboardMouseInput(lock);
const sfx = new Sfx();
let game = null;
let loading = false;

const menu = new Menu(uiRoot, {
  onPlay: startMatch,
  onResume: () => {
    if (!game) return;
    // Both need this click: browsers only allow pointer lock and audio from a user gesture.
    sfx.unlock();
    lock.request();
  },
  onQuit: quitMatch,
  inMatch: () => !!game,
});

// Pause and resume follow the pointer lock state, never Esc keydowns (the browser owns Esc).
lock.onLock = () => {
  if (!game) return;
  menu.hide();
  kbm.setEnabled(true);
  game.resume();
};
lock.onUnlock = () => {
  if (!game || game.state !== 'playing') return;
  kbm.setEnabled(false);
  game.pause();
  menu.showPause();
};
lock.onError = () => {
  if (!game) return;
  const msg = "Couldn't capture the mouse. Click again (browsers block it for a moment after Esc).";
  if (game.state === 'ready') menu.showReady(msg);
  else menu.showPause(msg);
};

onSettingsChange((s, patch) => {
  if ('showFps' in patch) {
    fps.setVisible(s.showFps);
    if (game) game.showDebug = DEBUG || s.showFps;
  }
});

async function startMatch() {
  if (loading || game) return;
  loading = true;
  menu.showLoading('Loading', 0);
  try {
    game = await Game.create({
      stage,
      hudRoot,
      fps,
      sfx,
      players: [{ source: kbm, name: 'Player 1' }],
      onProgress: (text, progress) => menu.showLoading(text, progress),
    });
    game.showDebug = DEBUG || settings.showFps;
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

function quitMatch() {
  kbm.setEnabled(false);
  lock.exit();
  if (game) {
    game.dispose();
    game = null;
  }
  menu.showTitle();
}

// Backquote toggles the FPS counter from anywhere.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote' && !e.repeat) updateSettings({ showFps: !settings.showFps });
});

menu.showTitle();

if (DEBUG) {
  window.smokeem = {
    get game() {
      return game;
    },
    kbm,
    lock,
    menu,
    settings,
    sfx,
    // For automated tests in browsers without pointer lock.
    playWithoutLock() {
      if (!game) return;
      menu.hide();
      kbm.setEnabled(true);
      game.resume();
    },
  };
}

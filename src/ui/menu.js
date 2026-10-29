import {
  settings,
  updateSettings,
  QUALITY_PRESETS,
  SENSITIVITY_RANGE,
  FOV_RANGE,
  VOLUME_RANGE,
  MAX_BOTS,
  BOT_SKILLS,
  MOVE_SPEED_RANGE,
} from '../settings.js';
import { controlsHtml } from './controls.js';

// All full-screen UI: title, settings, loading, ready, pause, error.
// Plain DOM buttons so keyboard (and, later, gamepad) focus navigation works.

const LOGO = `<h1 class="logo">SMOKE <span>EM'</span></h1>`;

const CONTROLS = `<div class="controls-list">${controlsHtml('keyboardMouse')}</div>`;

export class Menu {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.screen = null;
    this.returnTo = null;
    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.onAction(btn.dataset.action, btn, e);
    });
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
  }

  onAction(action, btn) {
    const h = this.handlers;
    switch (action) {
      case 'play':
        h.onPlay?.();
        break;
      case 'settings':
        this.showSettings(this.screen);
        break;
      case 'back':
        this.show(this.returnTo ?? 'title');
        break;
      case 'quality':
        updateSettings({ quality: btn.dataset.value });
        this.renderSettingsValues();
        break;
      case 'bots-':
      case 'bots+':
        updateSettings({ bots: Math.max(0, Math.min(MAX_BOTS, settings.bots + (action === 'bots+' ? 1 : -1))) });
        this.renderMatchValues();
        break;
      case 'botSkill':
        updateSettings({ botSkill: btn.dataset.value });
        this.renderMatchValues();
        break;
      case 'start':
      case 'resume':
        h.onResume?.();
        break;
      case 'quit':
        h.onQuit?.();
        break;
      default:
        break;
    }
  }

  onInput(e) {
    const t = e.target;
    if (!t.dataset.setting) return;
    const key = t.dataset.setting;
    if (t.type === 'checkbox') updateSettings({ [key]: t.checked });
    else updateSettings({ [key]: Number(t.value) });
    this.renderSettingsValues();
  }

  show(screen, opts = {}) {
    switch (screen) {
      case 'title':
        return this.showTitle();
      case 'ready':
        return this.showReady(opts.message);
      case 'pause':
        return this.showPause(opts.message);
      default:
        return this.showTitle();
    }
  }

  set(html, screen, cls = '') {
    this.screen = screen;
    this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    this.root.style.display = 'block';
    const first = this.root.querySelector('button');
    first?.focus({ preventScroll: true });
  }

  hide() {
    this.screen = null;
    this.root.innerHTML = '';
    this.root.style.display = 'none';
  }

  showTitle() {
    this.set(
      `
      <div class="panel title">
        ${LOGO}
        <p class="tagline">Run the course. Smoke your friends.</p>
        <div class="match-setup">
          <div class="row-inline">
            <label>Bots</label>
            <div class="stepper">
              <button data-action="bots-" class="step">-</button>
              <span class="bots-val"></span>
              <button data-action="bots+" class="step">+</button>
            </div>
          </div>
          <div class="row-inline">
            <label>Bot skill</label>
            <div class="segmented">${Object.entries(BOT_SKILLS)
              .map(([k, label]) => `<button data-action="botSkill" data-value="${k}" class="seg">${label}</button>`)
              .join('')}</div>
          </div>
          <p class="hint bots-hint"></p>
        </div>
        <div class="buttons">
          <button data-action="play">Play</button>
          <button data-action="settings" class="secondary">Settings</button>
        </div>
        <p class="note">Step 4 build: free-for-all against bots. Match timer, scoreboard and split-screen come next.</p>
      </div>`,
      'title',
    );
    this.renderMatchValues();
  }

  renderMatchValues() {
    const r = this.root;
    const v = r.querySelector('.bots-val');
    if (v) v.textContent = settings.bots;
    for (const btn of r.querySelectorAll('[data-action="botSkill"]')) {
      btn.classList.toggle('active', btn.dataset.value === settings.botSkill);
    }
    const h = r.querySelector('.bots-hint');
    if (h) h.textContent = settings.bots === 0 ? 'No bots: training dummies take their place.' : '';
  }

  showSettings(returnTo) {
    this.returnTo = returnTo ?? 'title';
    const s = SENSITIVITY_RANGE;
    const f = FOV_RANGE;
    const quality = Object.entries(QUALITY_PRESETS)
      .map(([k, p]) => `<button data-action="quality" data-value="${k}" class="seg">${p.label}</button>`)
      .join('');
    this.set(
      `
      <div class="panel settings">
        <h2>Settings</h2>
        <div class="row">
          <label>Graphics quality</label>
          <div class="segmented">${quality}</div>
        </div>
        <p class="hint quality-hint"></p>
        <div class="row">
          <label for="mspeed">Movement speed (you and bots) <span class="val" data-val="moveSpeed"></span></label>
          <input id="mspeed" type="range" data-setting="moveSpeed" min="${MOVE_SPEED_RANGE.min}" max="${MOVE_SPEED_RANGE.max}" step="${MOVE_SPEED_RANGE.step}" />
        </div>
        <div class="row">
          <label for="sens">Mouse sensitivity <span class="val" data-val="sensitivity"></span></label>
          <input id="sens" type="range" data-setting="sensitivity" min="${s.min}" max="${s.max}" step="${s.step}" />
        </div>
        <div class="row">
          <label for="fov">Field of view <span class="val" data-val="fov"></span></label>
          <input id="fov" type="range" data-setting="fov" min="${f.min}" max="${f.max}" step="${f.step}" />
        </div>
        <div class="row">
          <label for="vol">Volume <span class="val" data-val="volume"></span></label>
          <input id="vol" type="range" data-setting="volume" min="${VOLUME_RANGE.min}" max="${VOLUME_RANGE.max}" step="${VOLUME_RANGE.step}" />
        </div>
        <div class="row check">
          <label><input type="checkbox" data-setting="invertY" /> Invert look up/down</label>
        </div>
        <div class="row check">
          <label><input type="checkbox" data-setting="showFps" /> Show FPS counter</label>
        </div>
        <div class="buttons">
          <button data-action="back">Back</button>
        </div>
      </div>`,
      'settings',
    );
    this.renderSettingsValues();
  }

  renderSettingsValues() {
    const r = this.root;
    for (const btn of r.querySelectorAll('[data-action="quality"]')) {
      btn.classList.toggle('active', btn.dataset.value === settings.quality);
    }
    const qh = r.querySelector('.quality-hint');
    if (qh) {
      const p = QUALITY_PRESETS[settings.quality];
      qh.textContent = `Resolution cap ${p.pixelRatioCap}x, shadows ${p.shadowMapSize}px, anti-aliasing ${
        p.antialias ? 'on' : 'off'
      }.${this.handlers.inMatch?.() ? ' Anti-aliasing changes apply next match.' : ''}`;
    }
    for (const input of r.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = !!settings[key];
      else if (document.activeElement !== input) input.value = settings[key];
    }
    const sv = r.querySelector('[data-val="sensitivity"]');
    if (sv) sv.textContent = `${settings.sensitivity.toFixed(2)}x`;
    const fv = r.querySelector('[data-val="fov"]');
    if (fv) fv.textContent = `${Math.round(settings.fov)}°`;
    const mv = r.querySelector('[data-val="moveSpeed"]');
    if (mv) mv.textContent = `${Math.round(settings.moveSpeed * 100)}%`;
    const vv = r.querySelector('[data-val="volume"]');
    if (vv) vv.textContent = `${Math.round(settings.volume * 100)}%`;
  }

  showLoading(text = 'Loading', progress = 0) {
    if (this.screen !== 'loading') {
      this.set(
        `
        <div class="panel loading">
          ${LOGO}
          <p class="status"></p>
          <div class="bar"><div class="fill"></div></div>
        </div>`,
        'loading',
      );
    }
    this.root.querySelector('.status').textContent = text;
    this.root.querySelector('.fill').style.width = `${Math.round(progress * 100)}%`;
  }

  showReady(message) {
    this.set(
      `
      <div class="panel ready">
        <h2>Mudlark Gauntlet</h2>
        <button data-action="start" class="big">Click to drop in</button>
        ${message ? `<p class="warn">${message}</p>` : ''}
        ${CONTROLS}
      </div>`,
      'ready',
      'dim',
    );
  }

  showPause(message) {
    this.set(
      `
      <div class="panel pause">
        <h2>Paused</h2>
        <div class="buttons">
          <button data-action="resume">Resume</button>
          <button data-action="settings" class="secondary">Settings</button>
          <button data-action="quit" class="secondary">Quit to menu</button>
        </div>
        ${message ? `<p class="warn">${message}</p>` : ''}
        ${CONTROLS}
      </div>`,
      'pause',
      'dim',
    );
  }

  showError(message) {
    this.set(
      `
      <div class="panel">
        ${LOGO}
        <p class="warn">${message}</p>
        <div class="buttons"><button data-action="quit">Back</button></div>
      </div>`,
      'error',
    );
  }
}

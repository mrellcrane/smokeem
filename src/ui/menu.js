import {
  settings,
  updateSettings,
  QUALITY_PRESETS,
  SENSITIVITY_RANGE,
  STICK_SENSITIVITY_RANGE,
  FOV_RANGE,
  VOLUME_RANGE,
  MAX_BOTS,
  BOT_SKILLS,
  TIME_LIMITS, MODES, MAP_CHOICES,
  MOVE_SPEED_RANGE,
} from '../settings.js';
import { controlsHtml } from './controls.js';
import { PLAYER_COLORS } from '../player/player.js';
import { ordinal } from '../match.js';
import { WEAPON_SETS, availableSets, setGuns } from '../combat/arsenal.js';
import { MAPS } from '../world/maps.js';
import { WEAPONS } from '../combat/weapons.js';
import { gunIcon } from './gunIcons.js';
import { loadoutCard } from './loadoutCard.js';
import { gunDemo } from './gunDemos.js';

// The Guns choices on the title screen: the map's default, each set that exists, Mystery Meat.
function setChoices() {
  return ['default', ...availableSets(), 'mystery'];
}

// The map's own set ('default'), for a map choice; null for Random (each map has its own).
function mapSet(mapChoice) {
  return MAPS[mapChoice] ? WEAPON_SETS[MAPS[mapChoice].defaultSet] : null;
}

function setChoiceLabel(choice, mapChoice) {
  if (choice === 'mystery') return 'Mystery Meat';
  if (choice === 'default') {
    const set = mapSet(mapChoice);
    return set ? `Map default: ${set.name} (${set.heat})` : "Each map's own";
  }
  const set = WEAPON_SETS[choice];
  return `${set.name} (${set.heat})`;
}

function setChoiceHint(choice, mapChoice) {
  if (choice === 'mystery') return 'A random set each match (never Extra Hot).';
  const set = choice === 'default' ? mapSet(mapChoice) : WEAPON_SETS[choice];
  if (!set) {
    return Object.values(MAPS)
      .map((m) => `${m.name}: ${WEAPON_SETS[m.defaultSet].name}`)
      .join(' · ');
  }
  return setGuns(set)
    .map((g) => WEAPONS[g].name)
    .join(', ');
}

// All full-screen UI: title (with the join lobby), settings, loading, ready, pause, results,
// error.
// Plain DOM buttons, so keyboard focus and controller navigation (PadNav) both work.

const LOGO = `<h1 class="logo">SMOKE <span>EM'</span></h1>`;
export const MAX_LOCAL_PLAYERS = 4;
const RESULTS_LOCK_MS = 1000;
const SEAT_COLORS = PLAYER_COLORS.map((c) => `#${c.toString(16).padStart(6, '0')}`);
const KIND_TITLES = { keyboardMouse: 'Keyboard + mouse', gamepad: 'Controller' };

function controlsFor(kinds, missile = true) {
  const list = [...new Set(kinds.length ? kinds : ['keyboardMouse'])];
  return list
    .map((k) => `<div class="controls-list">${list.length > 1 ? `<h4>${KIND_TITLES[k]}</h4>` : ''}${controlsHtml(k, { missile })}</div>`)
    .join('');
}

export class Menu {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.screen = null;
    this.returnTo = null;
    // What last drove the menu: 'kbm' (mouse or keyboard) or 'pad'. Set to 'pad' by the
    // controller code right before it activates something.
    this.lastInput = 'kbm';
    window.addEventListener('keydown', () => (this.lastInput = 'kbm'), true);
    this.root.addEventListener('pointerdown', () => (this.lastInput = 'kbm'), true);
    // The loadout arrows re-render their row, so a click mustn't focus them (focus would be
    // lost with the old button and the next A press would only refocus).
    this.root.addEventListener('mousedown', (e) => {
      if (e.target.closest('.loadout-row .step')) e.preventDefault();
    });
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
      case 'join-kbm':
        h.onJoinKbm?.();
        break;
      case 'leave':
        h.onLeave?.(Number(btn.dataset.seat));
        break;
      case 'char-prev':
      case 'char-next':
        h.onCharacter?.(Number(btn.dataset.seat), action === 'char-next' ? 1 : -1);
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
      case 'set-':
      case 'set+': {
        const choices = setChoices();
        const i = Math.max(0, choices.indexOf(settings.weaponSet));
        const next = choices[(i + (action === 'set+' ? 1 : -1) + choices.length) % choices.length];
        updateSettings({ weaponSet: next });
        this.renderMatchValues();
        break;
      }
      case 'mode':
        updateSettings({ mode: btn.dataset.value });
        this.renderMatchValues();
        break;
      case 'map':
        updateSettings({ map: btn.dataset.value });
        this.renderMatchValues();
        break;
      case 'timeLimit':
        updateSettings({ timeLimit: Number(btn.dataset.value) });
        this.renderMatchValues();
        break;
      case 'end-match':
        h.onEndMatch?.();
        break;
      case 'rematch':
        h.onRematch?.();
        break;
      case 'loadout-prev':
      case 'loadout-next':
        h.onLoadout?.(Number(btn.dataset.seat), action === 'loadout-next' ? 1 : -1);
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
    const first = this.root.querySelector('[data-autofocus]') ?? this.root.querySelector('button');
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
            <label>Map</label>
            <div class="segmented">${Object.entries(MAP_CHOICES)
              .map(([k, label]) => `<button data-action="map" data-value="${k}" class="seg">${label}</button>`)
              .join('')}</div>
          </div>
          <p class="hint map-hint"></p>
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
          <div class="row-inline">
            <label>Mode</label>
            <div class="segmented">${Object.entries(MODES)
              .map(([k, label]) => `<button data-action="mode" data-value="${k}" class="seg">${label}</button>`)
              .join('')}</div>
          </div>
          <p class="hint mode-hint"></p>
          <div class="row-inline">
            <label>Time limit</label>
            <div class="segmented">${[3, 5, 10, 0]
              .map((k) => `<button data-action="timeLimit" data-value="${k}" class="seg">${TIME_LIMITS[k]}</button>`)
              .join('')}</div>
          </div>
          ${
            availableSets().length > 1
              ? `<div class="row-inline">
            <label>Guns</label>
            <div class="stepper wide">
              <button data-action="set-" class="step">◀</button>
              <span class="set-val"></span>
              <button data-action="set+" class="step">▶</button>
            </div>
          </div>
          <p class="hint set-hint"></p>`
              : ''
          }
        </div>
        <div class="lobby"></div>
        <p class="hint lobby-hint"></p>
        <div class="buttons">
          <button data-action="play" data-autofocus>Play</button>
          <button data-action="settings" class="secondary">Settings</button>
        </div>
        <p class="note">Free-for-all: most points when time runs out wins. A kill is +1, smoking yourself is -1.</p>
      </div>`,
      'title',
    );
    this.renderMatchValues();
    this.renderLobby();
  }

  // The four seats: who has joined, and how to join.
  renderLobby() {
    const el = this.root.querySelector('.lobby');
    if (!el) return;
    const { seats, padsSeen } = this.handlers.lobby?.() ?? { seats: [], padsSeen: false };
    const kbmIn = seats.some((s) => s.kind === 'keyboardMouse');
    let html = '';
    for (let i = 0; i < MAX_LOCAL_PLAYERS; i++) {
      const s = seats[i];
      const color = `--seat:${SEAT_COLORS[i]}`;
      if (s) {
        const leave = s.kind === 'gamepad' ? 'B to leave' : `<span class="leave" data-action="leave" data-seat="${i}">Leave</span>`;
        const pick =
          s.kind === 'gamepad'
            ? `<em class="char">${s.character} <small>LB / RB</small></em>`
            : `<em class="char"><span class="step" data-action="char-prev" data-seat="${i}">◀</span>${s.character}<span class="step" data-action="char-next" data-seat="${i}">▶</span></em>`;
        html += `<div class="slot joined" style="${color}"><b>P${i + 1}</b><span>${s.label}</span>${pick}<small>${leave}</small></div>`;
      } else {
        const kbm = kbmIn ? '' : ' data-action="join-kbm"';
        html += `<div class="slot empty" style="${color}"${kbm}><b>P${i + 1}</b><span>Press A to join</span><small>${
          kbmIn ? '' : 'or click for keyboard + mouse'
        }</small></div>`;
      }
    }
    this.setHtml(el, html);
    const hint = this.root.querySelector('.lobby-hint');
    if (hint) {
      let text = '';
      if (!seats.length) text = 'Solo on keyboard and mouse? Just hit Play.';
      if (!padsSeen) text += `${text ? ' ' : ''}Controllers show up once you press a button on them.`;
      hint.textContent = text;
    }
  }

  // innerHTML, skipped when nothing changed (the lobby re-renders every frame a pad is around).
  setHtml(el, html) {
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
  }

  renderMatchValues() {
    const r = this.root;
    const v = r.querySelector('.bots-val');
    if (v) v.textContent = settings.bots;
    for (const btn of r.querySelectorAll('[data-action="botSkill"]')) {
      btn.classList.toggle('active', btn.dataset.value === settings.botSkill);
    }
    for (const btn of r.querySelectorAll('[data-action="timeLimit"]')) {
      btn.classList.toggle('active', Number(btn.dataset.value) === settings.timeLimit);
    }
    for (const btn of r.querySelectorAll('[data-action="mode"]')) {
      btn.classList.toggle('active', btn.dataset.value === settings.mode);
    }
    for (const btn of r.querySelectorAll('[data-action="map"]')) {
      btn.classList.toggle('active', btn.dataset.value === settings.map);
    }
    const maph = r.querySelector('.map-hint');
    if (maph) maph.textContent = MAPS[settings.map] ? `${MAPS[settings.map].name}: ${MAPS[settings.map].blurb}` : 'A different map each match (never the same one twice in a row).';
    const mh = r.querySelector('.mode-hint');
    if (mh) {
      mh.textContent =
        settings.mode === 'oysters'
          ? 'Every kill grows your oysters: bigger is slower and easier to hit, smoking someone bigger is a bonus point, and crouch three times over a fresh kill to sauce them.'
          : '';
    }
    const h = r.querySelector('.bots-hint');
    if (h) h.textContent = settings.bots === 0 ? 'No bots: training dummies take their place.' : '';
    const choice = setChoices().includes(settings.weaponSet) ? settings.weaponSet : 'default';
    const sv = r.querySelector('.set-val');
    if (sv) sv.textContent = setChoiceLabel(choice, settings.map);
    const sh = r.querySelector('.set-hint');
    if (sh) sh.textContent = setChoiceHint(choice, settings.map);
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
          <label for="ssens">Controller look speed <span class="val" data-val="stickSensitivity"></span></label>
          <input id="ssens" type="range" data-setting="stickSensitivity" min="${STICK_SENSITIVITY_RANGE.min}" max="${STICK_SENSITIVITY_RANGE.max}" step="${STICK_SENSITIVITY_RANGE.step}" />
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
          <label><input type="checkbox" data-setting="rumble" /> Controller vibration</label>
        </div>
        <div class="row check">
          <label><input type="checkbox" data-setting="headBob" /> Head bob when walking</label>
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
    const ssv = r.querySelector('[data-val="stickSensitivity"]');
    if (ssv) ssv.textContent = `${settings.stickSensitivity.toFixed(2)}x`;
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

  // Input kinds in the current match, for the right prompts and control lists.
  kinds() {
    return this.handlers.matchKinds?.() ?? ['keyboardMouse'];
  }

  showReady(message) {
    const kinds = this.kinds();
    const kbm = kinds.includes('keyboardMouse');
    const pad = kinds.includes('gamepad');
    const label = kbm && pad ? 'Click or press A to drop in' : pad ? 'Press A to drop in' : 'Click to drop in';
    this.set(
      `
      <div class="panel ready${this.crowded()}">
        <h2>${this.handlers.mapName?.() ?? ''}</h2>
        ${this.gunList()}
        <div class="loadouts"></div>
        <button data-action="start" class="big" data-autofocus>${label}</button>
        ${message ? `<p class="warn">${message}</p>` : ''}
        ${this.soundHint()}
        ${controlsFor(kinds, this.handlers.hasMissile?.() ?? true)}
      </div>`,
      'ready',
      'dim',
    );
    this.renderLoadouts();
  }

  // With 3 or 4 local players the ready and pause screens go compact, so every loadout card
  // fits: the gun list becomes one row of pictures and demos and the cards shrink. With 2, only
  // the cards shrink (they share a row). Either way a short window's pause screen leaves the
  // controls to each view's strip.
  crowded() {
    const n = (this.handlers.loadoutRows?.() ?? []).length;
    return n > 2 ? ' many' : n === 2 ? ' pair' : '';
  }

  // The match's weapon set: every gun in it, with a line on what it does.
  gunList() {
    const info = this.handlers.setInfo?.();
    if (!info) return '';
    const rows = info.guns
      .map((g) => {
        const src = gunIcon(g.id);
        return `<li>${src ? `<img src="${src}" alt="">` : ''}${gunDemo(g.id)}<div><b>${g.name}</b> <em>${g.where}</em><span>${g.blurb}</span></div></li>`;
      })
      .join('');
    return `<div class="gun-list"><h4>${info.name} <em>${info.heat}</em></h4><ul>${rows}</ul></div>`;
  }

  // Each local player's loadout as a card, changed with the arrows (or left/right on their pad).
  // Mid-match a change waits for that player's next spawn, unless they've only just spawned.
  renderLoadouts() {
    const el = this.root.querySelector('.loadouts');
    if (!el) return;
    const rows = this.handlers.loadoutRows?.() ?? [];
    this.setHtml(
      el,
      rows
        .map(
          (r, i) =>
            `<div class="loadout-row" style="--seat:${SEAT_COLORS[i]}"><b>P${i + 1}</b><button class="step" data-action="loadout-prev" data-seat="${i}" tabindex="-1">◀</button>${loadoutCard(r.loadout, { note: r.pending ? 'from your next spawn' : '' })}<button class="step" data-action="loadout-next" data-seat="${i}" tabindex="-1">▶</button></div>`,
        )
        .join(''),
    );
  }

  showPause(message) {
    this.set(
      `
      <div class="panel pause${this.crowded()}">
        <h2>Paused</h2>
        <div class="buttons">
          <button data-action="resume">Resume</button>
          <button data-action="settings" class="secondary">Settings</button>
          <button data-action="end-match" class="secondary">End match</button>
          <button data-action="quit" class="secondary">Quit to menu</button>
        </div>
        <div class="loadouts"></div>
        ${message ? `<p class="warn">${message}</p>` : ''}
        ${this.soundHint()}
        ${controlsFor(this.kinds(), this.handlers.hasMissile?.() ?? true)}
      </div>`,
      'pause',
      'dim',
    );
    this.renderLoadouts();
  }

  // End of match: who won, everyone's place, score and smoked meat rank.
  showResults({ standings, winners }, localPlayers = []) {
    const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
    const headline =
      winners.length === 1
        ? `${winners[0].name} wins`
        : `Tie: ${winners.map((w) => w.name).join(' and ')}`;
    const rows = standings
      .map(({ player: p, place, rank }) => {
        const local = localPlayers.includes(p) ? ' class="local"' : '';
        return `<tr${local}><td>${ordinal(place)}</td><td><i style="background:${hex(p.color)}"></i>${p.name}</td><td>${p.stats.score}</td><td>${p.stats.kills}</td><td>${p.stats.deaths}</td><td class="rank">${rank}</td></tr>`;
      })
      .join('');
    this.set(
      `
      <div class="panel results">
        <h2>Match over</h2>
        <p class="winner">${headline}</p>
        <table class="results-table">
          <thead><tr><th></th><th></th><th>Score</th><th>K</th><th>D</th><th>Rank</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="buttons">
          <button data-action="rematch" disabled>Play again</button>
          <button data-action="quit" class="secondary" disabled>Quit to menu</button>
        </div>
      </div>`,
      'results',
      'finale',
    );
    // Players are usually mid-jump when the horn goes: give the results a second before a
    // stray Space or A press can skip them.
    const buttons = [...this.root.querySelectorAll('.results button')];
    setTimeout(() => {
      if (!buttons[0].isConnected) return;
      for (const b of buttons) b.disabled = false;
      buttons[0].focus({ preventScroll: true });
    }, RESULTS_LOCK_MS);
  }

  // Safari only starts audio from a real click or key press, never from a controller.
  soundHint() {
    return this.handlers.audioLocked?.() ? '<p class="hint">Sound is off until someone clicks or presses a key (a browser rule).</p>' : '';
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

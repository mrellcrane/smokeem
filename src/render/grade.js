import * as THREE from 'three';
import { gfx } from './gfx.js';

// Halo 3's look: a color grade and an eye that adapts. The grade runs inside every material's own
// shader through three's custom tone mapping hook (no extra pass): a little less color, a cooler
// white, shadows lifted toward blue, and a shoulder that rolls bright light off toward white so
// the sky and lamps blow out instead of clipping to a hue. Below the knee nothing changes, so
// everything tuned before still reads the same. On High the bloom composite applies it instead
// (render/bloom.js), since drawing into the bloom frame skips tone mapping.
//
// The exposure adapts per view (AutoExposure): a few rays from each player's eye measure how
// much open sky is above them. Under cover the eye opens up; step back out and the world is
// blown out for a moment, then settles.

const BASE = THREE.ShaderChunk.tonemapping_pars_fragment;
const f = (x) => Number(x).toFixed(4);
const v3 = (a) => `vec3( ${a.map(f).join(', ')} )`;

// How much brighter the sky and the distance haze are drawn under the grade, so the horizon
// blows out the way Halo's does (1 without it).
export const skyBoost = (look) => (gfx.grade && look.grade ? look.grade.sky : 1);
export const hazeBoost = (look) => (gfx.grade && look.grade ? look.grade.haze : 1);

// grade: the map's look.grade (looks.js), or null for none. Contrast pivots on middle grey.
export function applyGrade(renderer, grade) {
  if (!grade) {
    THREE.ShaderChunk.tonemapping_pars_fragment = BASE;
    renderer.toneMapping = THREE.NoToneMapping;
    return;
  }
  const knee = f(grade.knee);
  const fn = /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = mix( vec3( l ), color, ${f(grade.sat)} ) * ${v3(grade.tint)};
	color = 0.18 * pow( max( color, 0.0 ) / 0.18, vec3( ${f(grade.contrast)} ) );
	color += ${v3(grade.lift)} * ( 1.0 - smoothstep( 0.0, 0.3, l ) );
	vec3 over = max( color - ${knee}, 0.0 );
	return min( color, ${knee} ) + ( 1.0 - ${knee} ) * ( 1.0 - exp( -over / ( 1.0 - ${knee} ) ) );
}`;
  const chunk = BASE.replace(/vec3 CustomToneMapping\( vec3 color \) \{[^}]*\}/, fn);
  if (chunk === BASE) throw new Error('grade: CustomToneMapping not found in three');
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk;
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = grade.open;
}

// How far up and out the probes look: straight up and a ring at 60 degrees, out to RANGE meters.
// A wall needs to be within about 2 m to block the ring, so standing by one doesn't count as
// cover, but a roof or a catwalk overhead does.
const RANGE = 12;
const RING = 8;
const UP = 60 * (Math.PI / 180);
const PROBE_EVERY = 0.2;
// Seconds for the eye to get most of the way to a new exposure.
const ADAPT = 1.2;

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export class AutoExposure {
  constructor(game, grade) {
    this.game = game;
    this.grade = grade;
    this.state = new Map();
  }

  of(p) {
    let s = this.state.get(p);
    if (!s) {
      s = { value: this.grade.open, target: this.grade.open, t: Math.random() * PROBE_EVERY };
      this.state.set(p, s);
    }
    return s;
  }

  // The exposure for this player's view this frame.
  value(p) {
    return this.of(p).value;
  }

  update(dt) {
    const g = this.grade;
    for (const p of this.game.humans) {
      const s = this.of(p);
      if ((s.t -= dt) <= 0) {
        s.t += PROBE_EVERY;
        if (p.alive) s.target = g.shade + (g.open - g.shade) * smooth(this.openness(p));
      }
      s.value += (s.target - s.value) * (1 - Math.exp((-3 * dt) / ADAPT));
    }
  }

  // 0 under full cover to 1 under open sky.
  openness(p) {
    p.eyePosition(_o);
    let sum = 0;
    for (let i = 0; i <= RING; i++) {
      if (i === RING) _d.set(0, 1, 0);
      else {
        const a = (i / RING) * Math.PI * 2;
        _d.set(Math.cos(a) * Math.cos(UP), Math.sin(UP), Math.sin(a) * Math.cos(UP));
      }
      // (Level geometry only: someone standing over you isn't a roof.)
      const hit = this.game.surfaceNear(_o, _d, RANGE);
      sum += hit ? hit.point.distanceTo(_o) / RANGE : 1;
    }
    return sum / (RING + 1);
  }
}

function smooth(x) {
  const t = Math.min(1, Math.max(0, (x - 0.15) / 0.65));
  return t * t * (3 - 2 * t);
}

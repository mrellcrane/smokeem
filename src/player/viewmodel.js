import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp, clamp } from '../util/math.js';
import { partsGeometry } from '../combat/weaponModels.js';
import { GUNS } from '../combat/guns/index.js';
import { SWITCH_TIME } from '../combat/weapons.js';

// First-person weapon with gloved hands. Lives in its own scene, rendered after the world with a
// cleared depth buffer and its own camera, so it never clips into walls and keeps the same size
// in every split-screen view. One mesh per weapon in the match's set; only the held one is
// visible. Each gun's resting pose, kick and flash size come from its module (`view`).

let sharedMaterial = null;

// The first-person guns' look: Blinn-Phong whose shine depends on each vertex's finish
// (weaponModels.js FINISHES), a sky-and-ground reflection on metal and paint so bare metal
// reads as metal, wood grain and a fine grit in the surface (both from the gun-space position,
// so nothing to texture), and glowing parts lit by themselves. The reflection's up is the
// world's, in camera space (set per view), so it slides as you look up and down.
export const viewmodelUniforms = {
  uUp: { value: new THREE.Vector3(0, 1, 0) },
  uSky: { value: new THREE.Color(0xb8d4f0) },
  uGround: { value: new THREE.Color(0x4a3a2c) },
};
const VM_VERTEX_HEAD = /* glsl */ `
  attribute float aFinish;
  varying float vFinish;
  varying vec3 vGun;
`;
const VM_FRAGMENT_HEAD = /* glsl */ `
  uniform vec3 uUp;
  uniform vec3 uSky;
  uniform vec3 uGround;
  varying float vFinish;
  varying vec3 vGun;
  float vmHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vmNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(vmHash(i), vmHash(i + vec3(1, 0, 0)), f.x), mix(vmHash(i + vec3(0, 1, 0)), vmHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(vmHash(i + vec3(0, 0, 1)), vmHash(i + vec3(1, 0, 1)), f.x), mix(vmHash(i + vec3(0, 1, 1)), vmHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;
// Finishes: 0 matte, 1 wood, 2 paint, 3 metal, 4 glow.
const VM_COLOR = /* glsl */ `
  #include <color_fragment>
  float isWood = 1.0 - step(0.5, abs(vFinish - 1.0));
  float isPaint = 1.0 - step(0.5, abs(vFinish - 2.0));
  float isMetal = 1.0 - step(0.5, abs(vFinish - 3.0));
  float isGlow = step(3.5, vFinish);
  float grit = vmNoise(vGun * 260.0);
  // Grain runs along the gun (z), wavering.
  float grain = sin((vGun.y * 0.8 + vGun.x) * 420.0 + vmNoise(vGun * vec3(40.0, 40.0, 6.0)) * 9.0);
  float tone = 1.0 + (grit - 0.5) * mix(0.1, 0.06, isPaint) + isWood * (grain * 0.09 + (vmNoise(vGun * vec3(30.0, 30.0, 3.0)) - 0.5) * 0.2);
  diffuseColor.rgb *= tone;
`;
const VM_LIGHTS = /* glsl */ `
  BlinnPhongMaterial material;
  material.diffuseColor = diffuseColor.rgb;
  material.specularColor = mix(vec3(0.05), mix(vec3(1.0), diffuseColor.rgb * 2.2 + 0.25, 0.4), isMetal) * (1.0 + isPaint * 4.0 + isWood * 1.5) * (1.0 - isGlow);
  material.specularShininess = mix(mix(12.0, 24.0, isWood), mix(50.0, 70.0, isMetal), isPaint + isMetal);
  material.specularStrength = 0.6 + grit * 0.6;
`;
const VM_ENV = /* glsl */ `
  #include <envmap_fragment>
  {
    vec3 V = normalize(vViewPosition);
    vec3 R = reflect(-V, normal);
    float up = dot(R, uUp);
    // Ground, a bright band at the horizon, the sky above it.
    vec3 env = mix(uGround, uSky, smoothstep(-0.25, 0.25, up)) + uSky * 0.7 * exp(-pow((up - 0.12) * 7.0, 2.0));
    float fres = pow(1.0 - saturate(dot(normal, V)), 3.0);
    vec3 tint = mix(vec3(1.0), diffuseColor.rgb * 1.6 + 0.2, isMetal);
    float k = isMetal * mix(0.15, 0.55, fres) + isPaint * mix(0.02, 0.25, fres) + isWood * 0.08 * fres;
    outgoingLight += env * tint * k;
    outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.6, isGlow);
  }
`;

export function viewmodelMaterial() {
  if (sharedMaterial) return sharedMaterial;
  sharedMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 40 });
  sharedMaterial.name = 'viewmodel';
  sharedMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, viewmodelUniforms);
    shader.vertexShader = VM_VERTEX_HEAD + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vFinish = aFinish;\n  vGun = position;',
    );
    shader.fragmentShader = VM_FRAGMENT_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', VM_COLOR)
      .replace('#include <lights_phong_fragment>', VM_LIGHTS)
      .replace('#include <envmap_fragment>', VM_ENV);
  };
  sharedMaterial.customProgramCacheKey = () => 'viewmodel-v2';
  return sharedMaterial;
}

export class Viewmodel {
  constructor(textures, armorColor, guns) {
    viewmodelMaterial();
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.guns = {};
    this.muzzles = {};
    this.armorColor = armorColor;
    for (const id of guns) this.addGun(id);

    this.flashMaterial = new THREE.MeshBasicMaterial({
      map: textures.flash,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flashMaterial.name = 'muzzleFlash';
    // A front-facing star plus a side-on streak, as one mesh (one draw call).
    const star = new THREE.PlaneGeometry(0.2, 0.2);
    const streak = new THREE.PlaneGeometry(0.2, 0.2).rotateY(Math.PI / 2);
    this.flash = new THREE.Mesh(mergeGeometries([star, streak], false), this.flashMaterial);
    star.dispose();
    streak.dispose();
    this.flash.visible = false;

    this.current = null;
    this.gun = null;
    this.setWeapon(guns[0]);

    this.kick = 0;
    this.flashT = 0;
    this.bashT = 0;
    this.tossT = 0;
    this.pumpT = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.bobPhase = 0;
    this.sprint = 0;
    this.aim = 0;
    this.lower = 0;
    this.slide = 0;
    this.vy = 0;
  }

  addGun(id) {
    const g = GUNS[id];
    const mesh = new THREE.Mesh(partsGeometry([...g.parts, ...g.hands], this.armorColor), sharedMaterial);
    mesh.scale.setScalar(g.view.scale);
    mesh.visible = false;
    if (g.spin) {
      // Parts that spin (the Rotisserie's barrels): their own mesh, turning around `center`.
      const c = g.spin.center;
      const spinner = new THREE.Mesh(partsGeometry(g.spin.parts, this.armorColor, { offset: [-c[0], -c[1], -c[2]] }), sharedMaterial);
      spinner.position.set(c[0], c[1], c[2]);
      mesh.add(spinner);
      mesh.userData.spinner = spinner;
    }
    this.muzzles[id] = new THREE.Vector3(...g.muzzle);
    this.root.add(mesh);
    this.guns[id] = mesh;
  }

  setWeapon(id) {
    if (id === this.current) return;
    if (this.gun) this.gun.visible = false;
    this.current = id;
    // Only the match's set is built up front; anything else (debug, tests) is built on demand.
    if (!this.guns[id]) this.addGun(id);
    this.gun = this.guns[id];
    this.gun.visible = true;
    this.gun.add(this.flash);
    this.flash.position.copy(this.muzzles[id]);
    this.flash.scale.setScalar(GUNS[id].view.flash);
  }

  fired() {
    const g = GUNS[this.current];
    this.kick = g.view.kick;
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    if (g.def.pump) this.pumpT = 0.001;
  }

  bash() {
    this.bashT = 0.001;
  }

  toss() {
    this.tossT = 0.001;
  }

  // lookX / lookY: radians turned this frame.
  update(dt, p, lookX, lookY) {
    this.root.visible = p.showsViewmodel();
    const id = p.weapon.def.id;
    this.setWeapon(id);
    const pose = GUNS[id].view;

    // A slide glides: no running bob, the gun dips and cants a little instead.
    const run = p.grounded && p.mode === 'move' && !p.sliding ? Math.min(1, p.speed() / 7) : 0;
    this.bobPhase += dt * (6 + p.speed() * 1.2) * (run > 0.05 ? 1 : 0);
    const k = damp(10, dt);
    const rate = dt > 0 ? 1 / Math.max(dt, 1 / 240) : 0;
    this.swayX += (clamp(-lookX * rate * 0.004, -0.05, 0.05) - this.swayX) * k;
    this.swayY += (clamp(lookY * rate * 0.004, -0.04, 0.04) - this.swayY) * k;
    this.sprint += ((p.sprinting && run > 0.5 ? 1 : 0) - this.sprint) * damp(9, dt);
    this.aim += ((p.aimZoom > 1.02 ? 1 : 0) - this.aim) * damp(14, dt);
    const lowered = p.mode === 'mantle' ? 1 : p.mode === 'net' || p.mode === 'rope' || p.mode === 'bars' ? 0.35 : 0;
    this.lower += (lowered - this.lower) * damp(10, dt);
    this.slide += ((p.sliding ? 1 : 0) - this.slide) * damp(10, dt);
    this.vy += (clamp(-p.vel.y * 0.004, -0.035, 0.035) - this.vy) * damp(8, dt);
    this.kick = Math.max(0, this.kick - dt * 12);

    const curve = (t) => (t > 0 && t < 1 ? Math.sin(Math.PI * t) : 0);
    const advance = (t, dur) => (t > 0 ? (t + dt / dur >= 1 ? 0 : t + dt / dur) : 0);
    this.bashT = advance(this.bashT, 0.3);
    this.tossT = advance(this.tossT, 0.45);
    this.pumpT = advance(this.pumpT, 0.65);
    const bash = curve(this.bashT);
    const toss = curve(this.tossT);
    const pump = this.pumpT > 0.25 ? curve((this.pumpT - 0.25) / 0.75) : 0;
    const reload = Math.sin(Math.PI * p.weapon.reloadProgress);
    const sw = p.switchT > 0 ? Math.min(1, p.switchT / (p.weapon.def.switchTime ?? SWITCH_TIME)) : 0;

    const bobX = Math.sin(this.bobPhase) * 0.012 * run;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * run;
    const a = this.aim;
    const g = this.gun;
    const [px, py, pz] = pose.pos;
    const [rx, ry, rz] = pose.rot;
    g.position.set(
      px - 0.08 * a + bobX + this.swayX - 0.05 * this.sprint - 0.04 * bash,
      py + 0.035 * a + bobY + this.swayY + this.vy - 0.12 * reload - 0.05 * this.sprint - 0.2 * this.lower -
        p.landDip * 0.25 - 0.3 * sw - 0.16 * toss + 0.03 * bash - 0.025 * this.slide,
      pz + 0.012 * this.kick + 0.05 * a - 0.14 * bash + 0.04 * pump,
    );
    g.rotation.set(
      rx + 0.035 * this.kick - 0.45 * reload - 0.25 * this.sprint - 0.5 * this.lower - 0.9 * sw - 0.35 * toss + 0.12 * pump - 0.25 * bash,
      ry + 0.55 * this.sprint + 0.3 * bash,
      rz + 0.6 * reload + this.swayX * 2 + 0.5 * bash + 0.12 * this.slide,
    );

    // Rotisserie barrels turn with the spin-up.
    const spinner = g.userData.spinner;
    if (spinner) spinner.rotation.z -= p.weapon.spin * 28 * dt;

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
    } else if (this.flash.visible) {
      this.flash.visible = false;
    }
  }

  warmup(on) {
    this.flash.visible = on;
    for (const m of Object.values(this.guns)) m.visible = on || m === this.gun;
  }

  dispose() {
    for (const m of Object.values(this.guns)) m.geometry.dispose();
    this.flash.geometry.dispose();
    this.flashMaterial.dispose();
  }
}

export function disposeViewmodelMaterial() {
  sharedMaterial?.dispose();
  sharedMaterial = null;
}

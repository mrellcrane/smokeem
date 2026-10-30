import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp, clamp } from '../util/math.js';
import { partsGeometry } from '../combat/weaponModels.js';
import { gloveParts } from './gloves.js';
import { envUniforms } from '../render/reflections.js';
import { GUNS } from '../combat/guns/index.js';
import { SWITCH_TIME } from '../combat/weapons.js';
import { VIEWMODEL, DUAL } from '../config.js';

// First-person weapon with gloved hands. Lives in its own scene, rendered after the world with a
// cleared depth buffer and its own camera, so it never clips into walls and keeps the same size
// in every split-screen view. One mesh per weapon in the match's set; only the held one is
// visible. Each gun's resting pose, kick and flash size come from its module (`view`).

let sharedMaterial = null;
const _place = new THREE.Vector3();
const _dx = new THREE.Vector3();
const _dy = new THREE.Vector3();
const _dz = new THREE.Vector3();
const _dm = new THREE.Matrix4();

// The first-person guns' look: Blinn-Phong whose shine depends on each vertex's finish
// (weaponModels.js FINISHES), a sky-and-ground reflection on metal and paint so bare metal
// reads as metal, wood grain and a fine grit in the surface (both from the gun-space position,
// so nothing to texture), and glowing parts lit by themselves. The reflection's up is the
// world's, in camera space (set per view), so it slides as you look up and down.
export const viewmodelUniforms = {
  uUp: { value: new THREE.Vector3(0, 1, 0) },
  uSky: { value: new THREE.Color(0xb8d4f0) },
  uGround: { value: new THREE.Color(0x4a3a2c) },
  // How far each group (none, mag, pump, support hand: weaponModels.js GROUPS) is moved, in gun
  // space; set from the drawn player's viewmodel before each view (Viewmodel.bind).
  uGroupOff: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
};
const VM_VERTEX_HEAD = /* glsl */ `
  attribute float aFinish;
  attribute float aGroup;
  uniform vec3 uGroupOff[4];
  varying float vFinish;
  varying vec3 vGun;
`;
const VM_FRAGMENT_HEAD = /* glsl */ `
  uniform vec3 uUp;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform samplerCube uEnv;
  uniform float uEnvOn;
  uniform mat3 uCamRot;
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
// Manufactured detail, all from the gun-space position (meters): fine panel seams around metal
// and painted parts every few centimeters, a top-lit falloff so each gun reads as a solid, and
// worn patches where the paint thins. And the surface itself is dented a little (the normal is
// nudged by noise) so the sun's highlight breaks up instead of lighting a whole flat face white.
const VM_DETAIL = /* glsl */ `
  float detailed = isMetal + isPaint;
  // Seams: around the gun every 7.5 cm along it, and along its sides every 3.5 cm of height
  // (not on top and bottom faces), each a pixel or so wide at any distance.
  float zs = abs(fract(vGun.z * 13.3 + 0.37) - 0.5) / max(fwidth(vGun.z * 13.3), 1e-4);
  float ys = abs(fract(vGun.y * 28.6 + 0.21) - 0.5) / max(fwidth(vGun.y * 28.6), 1e-4);
  float side = 1.0 - abs(normalize(vNormal).y);
  float seam = (1.0 - smoothstep(0.8, 2.0, zs)) * 0.75 + (1.0 - smoothstep(0.8, 2.0, ys)) * 0.45 * side;
  // A lighter lip just past each seam, so it reads as a recessed panel line.
  float lip = (1.0 - smoothstep(2.0, 3.2, zs)) * smoothstep(1.6, 2.2, zs);
  diffuseColor.rgb *= (1.0 - seam * detailed * 0.65) * (1.0 + lip * detailed * 0.18);
  // Top-lit falloff (the bottom of the gun in its own shade).
  diffuseColor.rgb *= mix(0.8, 1.06, smoothstep(-0.09, 0.07, vGun.y));
  // Worn patches on paint: lighter, toward bare metal.
  float wear = smoothstep(0.62, 0.8, vmNoise(vGun * 34.0) * 0.7 + vmNoise(vGun * 140.0) * 0.3) * isPaint;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.44, 0.47), wear * 0.45);
`;
const VM_DENT = /* glsl */ `
  #include <normal_fragment_maps>
  {
    // A broad sway across each face (so a highlight is a gradient, not a white slab) and a fine
    // dent on top.
    vec3 q = vGun * 9.0;
    vec3 d = vec3(vmNoise(q), vmNoise(q + 17.3), vmNoise(q + 31.7)) - 0.5;
    vec3 q2 = vGun * 120.0;
    vec3 d2 = vec3(vmNoise(q2), vmNoise(q2 + 7.7), vmNoise(q2 + 13.1)) - 0.5;
    normal = normalize(normal + (d * 0.16 + d2 * 0.035) * (isMetal + isPaint * 0.7 + isWood * 0.4));
  }
`;
const VM_LIGHTS = /* glsl */ `
  BlinnPhongMaterial material;
  material.diffuseColor = diffuseColor.rgb;
  material.specularColor = mix(vec3(0.05), mix(vec3(1.0), diffuseColor.rgb * 2.2 + 0.25, 0.4), isMetal) * (1.0 + isPaint * 4.0 + isWood * 1.5) * (1.0 - isGlow);
  material.specularShininess = mix(mix(12.0, 24.0, isWood), mix(50.0, 70.0, isMetal), isPaint + isMetal);
  // (Tighter on metal so the highlight is a glint, and a little less on worn paint.)
  material.specularStrength = (0.45 + grit * 0.5) * (1.0 - wear * 0.5);
`;
const VM_ENV = /* glsl */ `
  #include <envmap_fragment>
  {
    vec3 V = normalize(vViewPosition);
    vec3 R = reflect(-V, normal);
    float up = dot(R, uUp);
    // The arena's reflection (render/reflections.js), turned into the world by the view's
    // rotation; before it's captured (the loadout pictures), ground, a bright band at the
    // horizon and the sky above it.
    vec3 env = mix(uGround, uSky, smoothstep(-0.25, 0.25, up)) + uSky * 0.7 * exp(-pow((up - 0.12) * 7.0, 2.0));
    env = mix(env, textureLod(uEnv, uCamRot * R, mix(3.5, 2.0, isMetal)).rgb * 1.25, uEnvOn);
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
    Object.assign(shader.uniforms, viewmodelUniforms, envUniforms);
    shader.vertexShader = VM_VERTEX_HEAD + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  transformed += uGroupOff[int(aGroup + 0.5)];\n  vFinish = aFinish;\n  vGun = position;',
    );
    shader.fragmentShader = VM_FRAGMENT_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', VM_COLOR + VM_DETAIL)
      .replace('#include <normal_fragment_maps>', VM_DENT)
      .replace('#include <lights_phong_fragment>', VM_LIGHTS)
      .replace('#include <envmap_fragment>', VM_ENV);
  };
  sharedMaterial.customProgramCacheKey = () => 'viewmodel-v5';
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

    // The ammo counter on guns that have one (guns/*.js `display`), Halo's: a small canvas
    // redrawn only when the count changes.
    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = 128;
    this.displayCanvas.height = 128;
    this.displayTexture = new THREE.CanvasTexture(this.displayCanvas);
    this.displayTexture.colorSpace = THREE.SRGBColorSpace;
    this.displayMaterial = new THREE.MeshBasicMaterial({ map: this.displayTexture, transparent: true, depthWrite: false });
    this.displayMaterial.name = 'ammoDisplay';
    this.display = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.displayMaterial);
    this.display.visible = false;
    this.shownAmmo = null;

    this.current = null;
    this.gun = null;
    this.setWeapon(guns[0]);

    // Dual wielding: a mirror image of each dual-wield gun for the left hand (glove and all),
    // sharing its geometry, with its own flash; built when first needed.
    this.leftGuns = {};
    this.leftGun = null;
    this.leftFlash = new THREE.Mesh(this.flash.geometry, this.flashMaterial);
    this.leftFlash.visible = false;
    this.kickL = 0;
    this.flashTL = 0;
    for (const id of guns) if (GUNS[id].def.dual) this.addLeftGun(id);

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
    this.swayVX = 0;
    this.swayVY = 0;
    this.roll = 0;
    this.breath = 0;
    this.cant = 0;
    // Where the mag, the pump and the support hand are, relative to the gun (gun space).
    this.groupOff = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  addGun(id) {
    const g = GUNS[id];
    const mesh = new THREE.Mesh(partsGeometry([...g.parts, ...gloveParts(g.hands)], this.armorColor), sharedMaterial);
    mesh.userData.mag = g.parts.some((part) => part[3]?.group === 'mag');
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

  addLeftGun(id) {
    if (!this.guns[id]) this.addGun(id);
    const mesh = new THREE.Mesh(this.guns[id].geometry, sharedMaterial);
    mesh.userData.mag = this.guns[id].userData.mag;
    mesh.visible = false;
    this.root.add(mesh);
    this.leftGuns[id] = mesh;
  }

  // The left hand's gun (null for none).
  setLeft(id) {
    const want = id ? (this.leftGuns[id] ?? (this.addLeftGun(id), this.leftGuns[id])) : null;
    if (want === this.leftGun) return;
    if (this.leftGun) this.leftGun.visible = false;
    this.leftGun = want;
    if (!want) return;
    want.visible = true;
    want.add(this.leftFlash);
    this.leftFlash.position.copy(this.muzzles[id]);
    this.leftFlash.scale.setScalar(GUNS[id].view.flash * VIEWMODEL.flash);
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
    this.flash.scale.setScalar(GUNS[id].view.flash * VIEWMODEL.flash);
    const d = GUNS[id].display;
    this.display.visible = !!d;
    // (Always on the held gun, so the warm-up compiles it whichever gun that is.)
    this.gun.add(this.display);
    if (d) {
      this.display.position.fromArray(d.at);
      // Turned by Euler angles (rot), or to face `normal` with its top toward `up`.
      if (d.normal) {
        const z = _dz.fromArray(d.normal).normalize();
        const y = _dy.fromArray(d.up);
        _dm.makeBasis(_dx.crossVectors(y, z).normalize(), y.crossVectors(z, _dx), z);
        this.display.quaternion.setFromRotationMatrix(_dm);
      } else this.display.rotation.fromArray(d.rot);
      this.display.scale.set(d.size[0], d.size[1], 1);
      this.shownAmmo = null;
    }
  }

  // Draw the count: big digits in cyan, orange when the mag is low, with a faint grid behind.
  drawAmmo(n, mag) {
    const c = this.displayCanvas;
    const x = c.getContext('2d');
    x.shadowBlur = 0;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(6, 18, 24, 0.92)';
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = 'rgba(80, 220, 255, 0.12)';
    x.lineWidth = 2;
    for (let i = 8; i < c.width; i += 12) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i, c.height);
      x.stroke();
    }
    const low = n <= Math.ceil(mag * 0.25);
    x.fillStyle = low ? '#ff9a3c' : '#7ff4ff';
    x.shadowColor = x.fillStyle;
    x.shadowBlur = 10;
    x.font = 'bold 72px "Arial Narrow", Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(String(n).padStart(2, '0'), c.width / 2, c.height / 2 + 4);
    this.displayTexture.needsUpdate = true;
  }

  // left: the left hand's gun fired.
  fired(left = false) {
    if (left) {
      this.kickL = GUNS[this.current].view.kick;
      this.flashTL = 0.05;
      this.leftFlash.rotation.z = Math.random() * Math.PI;
      return;
    }
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
    this.setLeft(p.left ? p.left.def.id : null);
    const pose = GUNS[id].view;
    if (this.display.visible && this.shownAmmo !== p.weapon.mag) {
      this.shownAmmo = p.weapon.mag;
      this.drawAmmo(p.weapon.mag, p.weapon.def.mag);
    }

    // A slide glides: no running bob, the gun dips and cants a little instead.
    const run = p.grounded && p.mode === 'move' && !p.sliding ? Math.min(1, p.speed() / 7) : 0;
    // The bob rides the player's stride clock, so the gun drops on each footfall with the view.
    this.bobPhase = Math.PI * p.bobStride;
    const k = damp(10, dt);
    const rate = dt > 0 ? 1 / Math.max(dt, 1 / 240) : 0;
    // The gun trails the turn on a spring, overshooting a little as the turn stops.
    const sx = clamp(-lookX * rate * 0.004, -0.05, 0.05);
    const sy = clamp(lookY * rate * 0.004, -0.04, 0.04);
    const step = Math.min(dt, 1 / 30);
    this.swayVX += ((sx - this.swayX) * 170 - this.swayVX * 17) * step;
    this.swayVY += ((sy - this.swayY) * 170 - this.swayVY * 17) * step;
    this.swayX += this.swayVX * step;
    this.swayY += this.swayVY * step;
    // Strafing leans the gun into the move; standing still it breathes.
    this.roll += (clamp(-p.pose.side * 0.012, -0.08, 0.08) - this.roll) * k;
    this.breath += dt;
    this.sprint += ((p.sprinting && run > 0.5 ? 1 : 0) - this.sprint) * damp(9, dt);
    this.aim += ((p.aimZoom > 1.02 ? 1 : 0) - this.aim) * damp(14, dt);
    const lowered = p.mode === 'mantle' ? 1 : p.mode === 'net' || p.mode === 'rope' || p.mode === 'bars' ? 0.35 : 0;
    this.lower += (lowered - this.lower) * damp(10, dt);
    this.slide += ((p.sliding ? 1 : 0) - this.slide) * damp(10, dt);
    this.vy += (clamp(-p.vel.y * 0.004, -0.035, 0.035) - this.vy) * damp(8, dt);
    this.kick = Math.max(0, this.kick - dt * 12);
    this.kickL = Math.max(0, this.kickL - dt * 12);

    const curve = (t) => (t > 0 && t < 1 ? Math.sin(Math.PI * t) : 0);
    const advance = (t, dur) => (t > 0 ? (t + dt / dur >= 1 ? 0 : t + dt / dur) : 0);
    this.bashT = advance(this.bashT, 0.3);
    this.tossT = advance(this.tossT, 0.45);
    this.pumpT = advance(this.pumpT, 0.65);
    const bash = curve(this.bashT);
    const toss = curve(this.tossT);
    const pump = this.pumpT > 0.25 ? curve((this.pumpT - 0.25) / 0.75) : 0;
    // Reloading a mag or loading shells, the gun cants toward you so you see the hands work
    // (the mag slaps home near the end); anything else dips out of the way.
    const w = p.weapon;
    const rt = w.reloadProgress;
    const magReload = rt > 0 && !w.def.reloadPerShell && this.gun.userData.mag;
    const cantTo = magReload ? (rt < 0.86 ? 1 : 0) : w.reloading && w.def.reloadPerShell ? 0.7 : 0;
    this.cant += (cantTo - this.cant) * damp(9, dt);
    const reload = rt > 0 && !magReload && !w.def.reloadPerShell ? Math.sin(Math.PI * rt) : 0;
    const slap = magReload && rt > 0.74 && rt < 0.86 ? Math.sin((Math.PI * (rt - 0.74)) / 0.12) : 0;
    const cant = this.cant;
    const sw = p.switchT > 0 ? Math.min(1, p.switchT / (p.weapon.def.switchTime ?? SWITCH_TIME)) : 0;

    const still = 1 - Math.min(1, run * 4);
    const bobX = Math.sin(this.bobPhase) * 0.012 * run;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * run + Math.sin(this.breath * 1.6) * 0.0025 * still * (1 - this.aim);
    const a = this.aim;
    const g = this.gun;
    const [tx0, ty0, tz0] = VIEWMODEL.turn;
    const [px, py, pz] = pose.pos;
    const rx = pose.rot[0] + tx0;
    const ry = pose.rot[1] + ty0;
    const rz = pose.rot[2] + tz0;
    g.scale.setScalar(pose.scale * VIEWMODEL.scale);
    g.position.set(
      px - 0.05 * a + bobX + this.swayX - 0.05 * this.sprint - 0.04 * bash - 0.03 * cant,
      py + 0.035 * a + bobY + this.swayY + this.vy - 0.12 * reload + 0.012 * cant + 0.012 * slap - 0.05 * this.sprint - 0.2 * this.lower -
        p.landDip * 0.25 - 0.3 * sw - 0.16 * toss + 0.03 * bash - 0.025 * this.slide,
      pz + 0.012 * this.kick - 0.14 * bash + 0.04 * pump + 0.03 * cant,
    );
    // The framing pulls every gun in by the same ratios, motions and all (config.js VIEWMODEL).
    g.position.multiply(_place.fromArray(VIEWMODEL.place));
    g.rotation.set(
      rx + 0.035 * this.kick - 0.45 * reload + 0.12 * cant + 0.05 * slap - 0.25 * this.sprint - 0.5 * this.lower - 0.9 * sw - 0.35 * toss + 0.12 * pump - 0.25 * bash,
      ry + 0.55 * this.sprint + 0.3 * bash + 0.22 * cant,
      rz + 0.6 * reload + 0.5 * cant + this.swayX * 2 + 0.5 * bash + 0.12 * this.slide + this.roll * (1 - 0.6 * a),
    );
    // A gun in each hand: both a little wider and lower, the left one the right's mirror image
    // with its own kick.
    const L = this.leftGun;
    if (L) {
      g.position.x += DUAL.spread * VIEWMODEL.place[0];
      g.position.y -= DUAL.drop * VIEWMODEL.place[1];
      L.scale.set(-g.scale.x, g.scale.y, g.scale.z);
      L.position.set(-g.position.x, g.position.y, g.position.z + 0.012 * (this.kickL - this.kick) * VIEWMODEL.place[2]);
      L.rotation.set(g.rotation.x + 0.035 * (this.kickL - this.kick), -g.rotation.y, -g.rotation.z);
    }
    this.moveGroups(w, pump, g.userData.mag);

    // Rotisserie barrels turn with the spin-up.
    const spinner = g.userData.spinner;
    if (spinner) spinner.rotation.z -= p.weapon.spin * 28 * dt;

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
    } else if (this.flash.visible) {
      this.flash.visible = false;
    }
    if (this.flashTL > 0) {
      this.flashTL -= dt;
      this.leftFlash.visible = true;
    } else if (this.leftFlash.visible) {
      this.leftFlash.visible = false;
    }
  }

  // The mag, the pump and the support hand. A mag reload: the mag drops out, the hand goes down
  // for a fresh one and brings it up into the well. Loading shells one at a time, the hand dips
  // to the port for each. Other reloads take the hand off the gun and back. The pump racks back
  // with the hand on it.
  moveGroups(w, pump, hasMag) {
    const [, mag, slide, hand] = this.groupOff;
    mag.set(0, 0, 0);
    slide.set(0, 0, 0);
    hand.set(0, 0, 0);
    const t = w.reloadProgress;
    if (t > 0) {
      const ease = (a, b) => {
        const x = clamp((t - a) / (b - a), 0, 1);
        return x * x * (3 - 2 * x);
      };
      if (w.def.reloadPerShell) {
        const dip = Math.sin(Math.PI * t);
        hand.set(0.01 * dip, -0.07 * dip, 0.09 * dip);
      } else if (hasMag) {
        const fetch = ease(0.14, 0.42) * (1 - ease(0.5, 0.8));
        hand.set(-0.03 * fetch, -0.24 * fetch, 0.06 * fetch);
        if (t < 0.46) {
          const out = ease(0.06, 0.3);
          mag.set(0, -0.4 * out * out, 0.03 * out);
        } else {
          mag.copy(hand);
        }
      } else {
        const off = ease(0.1, 0.35) * (1 - ease(0.65, 0.9));
        hand.set(-0.02 * off, -0.18 * off, 0.08 * off);
      }
    }
    if (pump > 0) {
      slide.set(0, 0, 0.075 * pump);
      hand.z += 0.075 * pump;
    }
  }

  // Hands this viewmodel's group offsets to the shared material, before its view renders.
  bind() {
    const offs = viewmodelUniforms.uGroupOff.value;
    for (let i = 0; i < 4; i++) offs[i].copy(this.groupOff[i]);
  }

  warmup(on) {
    this.flash.visible = on;
    if (on) this.display.visible = true;
    else this.display.visible = !!GUNS[this.current]?.display;
    for (const m of Object.values(this.guns)) m.visible = on || m === this.gun;
    for (const m of Object.values(this.leftGuns)) m.visible = on || m === this.leftGun;
    this.leftFlash.visible = on;
  }

  dispose() {
    for (const m of Object.values(this.guns)) m.geometry.dispose();
    this.flash.geometry.dispose();
    this.flashMaterial.dispose();
    this.display.geometry.dispose();
    this.displayMaterial.dispose();
    this.displayTexture.dispose();
  }
}

export function disposeViewmodelMaterial() {
  sharedMaterial?.dispose();
  sharedMaterial = null;
}

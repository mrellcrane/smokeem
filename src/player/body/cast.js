import * as THREE from 'three';
import { JOINTS, HANDS, BONES } from './bodyMesh.js';

// The character options besides the Spartan (owner request): Crash Bandicoot, Link and
// GoldenEye's Bond, each built here from simple shapes (ellipsoids, tapered limbs, boxes, cones)
// on the Spartan's skeleton, so they animate, aim, ragdoll and replay exactly like everyone else.
// Each shape rides one bone (early-2000s style: joints are covered by a ball on the child bone).
// Every character carries a glowing touch in the player's color (Crash's and Link's wristbands,
// Bond's pocket square) besides the rim light every body has.
//
// A character comes out in the same form as the decoded Spartan (character.js base()), plus its
// palette: region index -> { color, glow } (color null: the player's color).

export const CHARACTERS = {
  spartan: { name: 'Spartan' },
  crash: { name: 'Crash' },
  link: { name: 'Link' },
  bond: { name: 'Bond' },
};
export const CHARACTER_IDS = Object.keys(CHARACTERS);

const BI = Object.fromEntries(BONES.map((n, i) => [n, i]));
const J = (n) => new THREE.Vector3(...JOINTS[n]);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

class Kit {
  constructor(palette) {
    this.names = Object.keys(palette);
    this.palette = this.names.map((k) => palette[k]);
    this.pos = [];
    this.nor = [];
    this.idx = [];
    this.bone = [];
    this.reg = [];
    this.loose = [];
    // While set, added shapes ride their bone loosely (see add).
    this.looseOn = false;
  }

  // Shapes added inside fn ride their bone at 98.5% (with a touch of the spine): they move with
  // it, but the head's hitbox fit (character.js helmetTable) only counts shapes on the head
  // bone alone, so ears, hair and a jaw hanging below the head band don't shove the body around.
  loosely(fn) {
    this.looseOn = true;
    fn();
    this.looseOn = false;
  }

  // Append a geometry (already placed) on one bone, in one color region.
  add(g, bone, region) {
    const r = this.names.indexOf(region);
    if (r < 0) throw new Error(`cast: no region ${region}`);
    if (!g.index) indexed(g);
    const base = this.pos.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.bone.push(BI[bone]);
      this.reg.push(r);
      this.loose.push(this.looseOn);
    }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]);
    g.dispose();
  }

  // An ellipsoid: center c, radii r ([x, y, z]); rot: Euler [x, y, z].
  ell(c, r, bone, region, rot = null, seg = [14, 10]) {
    const g = new THREE.SphereGeometry(1, seg[0], seg[1]);
    g.deleteAttribute('uv');
    _q.setFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0])));
    g.applyMatrix4(_m.compose(c, _q, _s.set(r[0], r[1], r[2])));
    this.add(g, bone, region);
  }

  // A tapered round limb from a (radius ra) to b (radius rb), squashed to `flat` front to back.
  limb(a, b, ra, rb, bone, region, { seg = 10, flat = 1 } = {}) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, false);
    g.deleteAttribute('uv');
    g.scale(1, 1, flat);
    g.translate(0, len / 2, 0);
    _q.setFromUnitVectors(UP, d.normalize());
    g.applyMatrix4(_m.compose(a, _q, _s.set(1, 1, 1)));
    this.add(g, bone, region);
  }

  box(c, size, bone, region, rot = null) {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    g.deleteAttribute('uv');
    _q.setFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0])));
    g.applyMatrix4(_m.compose(c, _q, _s.set(1, 1, 1)));
    this.add(g, bone, region);
  }

  // A cone from a round base (center c, radius r) to a tip.
  cone(c, tip, r, bone, region, seg = 10) {
    this.limb(c, tip, r, 0.002, bone, region, { seg });
  }

  build() {
    const n = this.pos.length / 3;
    const position = Float32Array.from(this.pos);
    const normal = Float32Array.from(this.nor);
    const shell = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) shell[i] = position[i] + normal[i] * 0.0175;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    const shade = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      skinIndex[i * 4] = this.bone[i];
      skinWeight[i * 4] = 1;
      if (this.loose[i]) {
        skinIndex[i * 4 + 1] = BI.spine;
        skinWeight[i * 4] = 0.985;
        skinWeight[i * 4 + 1] = 0.015;
      }
      // A little darker facing down and low on the body, like the Spartan's baked occlusion.
      const ny = normal[i * 3 + 1];
      const y = position[i * 3 + 1];
      shade[i] = Math.round(255 * Math.min(1, (0.8 + 0.2 * (ny * 0.5 + 0.5)) * (0.88 + 0.12 * Math.min(1, y / 1.2))));
    }
    return {
      count: n,
      position,
      normal,
      shell,
      region: Uint8Array.from(this.reg),
      shade,
      skinIndex,
      skinWeight,
      index: n > 65535 ? Uint32Array.from(this.idx) : Uint16Array.from(this.idx),
      palette: this.palette,
    };
  }
}

function indexed(g) {
  const n = g.attributes.position.count;
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

// The parts every character shares the layout of: neck, limbs, joint balls, fists, feet. s.*
// are the regions for each, r.* the radii.
function frame(k, s, r) {
  k.limb(V(0, 1.36, 0), V(0, 1.5, -0.01), r.neck, r.neck * 0.95, 'spine', s.neck);
  for (const side of ['L', 'R']) {
    const sh = J(`armU${side}`);
    const el = J(`armL${side}`);
    const wr = J(`hand${side}`);
    k.limb(sh, el, r.upper, r.upper * 0.85, `armU${side}`, s.upper);
    k.ell(el, [r.upper * 0.85, r.upper * 0.85, r.upper * 0.85], `armL${side}`, s.upper, null, [10, 8]);
    k.limb(el, wr, r.lower, r.lower * 0.85, `armL${side}`, s.lower);
    // The fist, closed on the grip, along the hand's axis.
    const ax = new THREE.Vector3(...HANDS[side].axis);
    k.ell(wr.clone().addScaledVector(ax, 0.07), [r.fist, r.fist * 1.15, r.fist], `hand${side}`, s.hand, null, [10, 8]);
    // The wristband or cuff, just above the wrist.
    if (s.cuff) k.limb(wr.clone().addScaledVector(ax, -0.05), wr.clone().addScaledVector(ax, 0.005), r.lower * 0.98, r.lower * 0.92, `armL${side}`, s.cuff);
    const hip = J(`legU${side}`);
    const kn = J(`legL${side}`);
    const an = J(`foot${side}`);
    k.limb(hip, kn, r.thigh, r.thigh * 0.8, `legU${side}`, s.thigh);
    k.ell(kn, [r.thigh * 0.8, r.thigh * 0.8, r.thigh * 0.8], `legL${side}`, s.knee ?? s.thigh, null, [10, 8]);
    k.limb(kn, an, r.shin, r.shin * 0.8, `legL${side}`, s.shin);
    // The foot: a rounded shoe from the ankle forward to the toes, on the floor.
    const fx = an.x;
    k.box(V(fx, 0.055, an.z - 0.05), [r.foot, 0.11, 0.25], `foot${side}`, s.foot);
    k.ell(V(fx, 0.06, an.z - 0.17), [r.foot * 0.55, 0.06, 0.07], `foot${side}`, s.toe ?? s.foot, null, [10, 6]);
    if (s.sole) k.box(V(fx, 0.012, an.z - 0.06), [r.foot + 0.012, 0.024, 0.29], `foot${side}`, s.sole);
  }
}

// Crash as in the first games (owner reference: the PS1 model): a long face running straight into
// the chest, the huge white grin with the dark triangle nose in its middle, wide eyes with
// diamond pupils under heavy brows, tall V ears with dark insides and the red tuft spiking up; a
// narrow V-shaped body with an orange stripe down the chest and a belly button; long skinny arms
// with big maroon gloves; baggy three-quarter jeans over skinny shins; chunky maroon sneakers
// with white laces, collars and soles.
function crash() {
  const k = new Kit({
    fur: { color: 0xe4461c },
    chest: { color: 0xf08a12 },
    glove: { color: 0x5a1416 },
    jeans: { color: 0x2442b4 },
    shoe: { color: 0x6a1418 },
    white: { color: 0xf4f2f4, glow: 0.1 },
    lip: { color: 0xc89aa8 },
    nose: { color: 0x1c1c3c },
    pupil: { color: 0x111111 },
    brow: { color: 0x3a1c0e },
    earIn: { color: 0x2a1006 },
    tuft: { color: 0xb2161a },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'fur', upper: 'fur', lower: 'fur', hand: 'glove', cuff: 'team', thigh: 'jeans', knee: 'jeans', shin: 'fur', foot: 'shoe' }, { neck: 0.03, upper: 0.04, lower: 0.036, fist: 0.08, thigh: 0.085, shin: 0.036, foot: 0.13 });
  // Body: a narrow V from sloping shoulders down to a thin waist, the orange stripe and the
  // belly button.
  k.ell(V(0, 1.22, 0), [0.16, 0.19, 0.12], 'spine', 'fur');
  k.ell(V(0, 1.03, 0), [0.115, 0.13, 0.095], 'spine', 'fur');
  k.ell(V(0, 1.13, -0.065), [0.07, 0.22, 0.06], 'spine', 'chest');
  k.ell(V(0, 0.985, -0.1), [0.012, 0.016, 0.006], 'spine', 'earIn', null, [8, 6]);
  for (const sx of [-1, 1]) k.ell(V(sx * 0.165, 1.33, 0), [0.07, 0.055, 0.07], 'spine', 'fur', null, [10, 8]);
  k.limb(V(0, 0.79, 0), V(0, 0.97, 0), 0.145, 0.13, 'hips', 'jeans', { flat: 0.8 });
  for (const side of ['L', 'R']) {
    const kn = J(`legL${side}`);
    const an = J(`foot${side}`);
    // Baggy jeans down to mid-shin.
    const mid = kn.clone().lerp(an, 0.55);
    k.limb(kn, mid, 0.08, 0.09, `legL${side}`, 'jeans');
    // Chunky sneakers: the shoe, a white sole, a white collar round the ankle, white laces.
    k.ell(V(an.x, 0.085, an.z - 0.06), [0.095, 0.085, 0.185], `foot${side}`, 'shoe');
    k.box(V(an.x, 0.02, an.z - 0.06), [0.19, 0.04, 0.37], `foot${side}`, 'white');
    k.limb(V(an.x, 0.12, an.z), V(an.x, 0.18, an.z), 0.06, 0.05, `foot${side}`, 'white');
    k.box(V(an.x, 0.158, an.z - 0.1), [0.07, 0.02, 0.13], `foot${side}`, 'white', [0.4, 0, 0]);
  }
  const head = 'head';
  // The skull and brow, on the head bone (inside the hitbox's head band).
  k.ell(V(0, 1.645, 0.0), [0.15, 0.165, 0.15], head, 'fur');
  for (const sx of [-1, 1]) {
    k.ell(V(sx * 0.068, 1.675, -0.122), [0.062, 0.045, 0.03], head, 'white');
    k.box(V(sx * 0.062, 1.672, -0.15), [0.022, 0.022, 0.008], head, 'pupil', [0, 0, Math.PI / 4]);
    k.box(V(sx * 0.07, 1.735, -0.125), [0.13, 0.04, 0.05], head, 'brow', [0, 0, sx * 0.32]);
  }
  k.loosely(() => {
    // The long lower face and its grin, running down into the chest.
    k.ell(V(0, 1.47, -0.04), [0.155, 0.14, 0.14], head, 'fur');
    // (Bridging the skull and the lower face, so the head is one long shape.)
    k.ell(V(0, 1.56, -0.03), [0.152, 0.11, 0.148], head, 'fur');
    // The grin, cheek to cheek, with the nose sitting in its top middle.
    k.ell(V(0, 1.45, -0.125), [0.16, 0.095, 0.075], head, 'lip');
    k.ell(V(0, 1.445, -0.145), [0.145, 0.08, 0.065], head, 'white');
    k.cone(V(0, 1.505, -0.2), V(0, 1.45, -0.22), 0.052, head, 'nose', 3);
    // Tall V ears with dark insides, and the red tuft spiking up.
    for (const sx of [-1, 1]) {
      k.cone(V(sx * 0.1, 1.73, 0.03), V(sx * 0.28, 1.92, 0.02), 0.075, head, 'fur', 4);
      k.cone(V(sx * 0.11, 1.735, -0.005), V(sx * 0.26, 1.885, -0.02), 0.045, head, 'earIn', 4);
    }
    for (const [x, z, h] of [[0, 0.0, 0.22], [-0.03, 0.03, 0.16], [0.03, 0.02, 0.15]]) {
      k.cone(V(x, 1.78, z), V(x * 1.4, 1.78 + h, z + 0.01), 0.02, head, 'tuft', 4);
    }
  });
  return k.build();
}

function link() {
  const k = new Kit({
    skin: { color: 0xf0c296 },
    hair: { color: 0xe6c254 },
    tunic: { color: 0x2f8d3a },
    tunicDark: { color: 0x226a2a },
    cream: { color: 0xece0c2 },
    leather: { color: 0x7a4a26 },
    boot: { color: 0x5a3a1e },
    buckle: { color: 0xc9a64a },
    shield: { color: 0x2a4fa8 },
    rim: { color: 0xc4c8ce },
    red: { color: 0xb02a2a },
    hilt: { color: 0x4a3fa8 },
    eye: { color: 0x2a5ea8 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'skin', upper: 'cream', lower: 'leather', hand: 'leather', cuff: 'team', thigh: 'cream', knee: 'boot', shin: 'boot', foot: 'boot' }, { neck: 0.045, upper: 0.052, lower: 0.046, fist: 0.055, thigh: 0.072, shin: 0.058, foot: 0.11 });
  // Tunic: chest and shoulders, a leather belt with a gold buckle, and the skirt flaring out.
  k.ell(V(0, 1.21, 0), [0.18, 0.22, 0.125], 'spine', 'tunic');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.17, 1.35, 0), [0.075, 0.065, 0.075], 'spine', 'tunic', null, [10, 8]);
  k.limb(V(0, 0.93, 0), V(0, 1.0, 0), 0.165, 0.16, 'hips', 'leather', { flat: 0.78 });
  k.box(V(0, 0.965, -0.125), [0.07, 0.055, 0.02], 'hips', 'buckle');
  k.limb(V(0, 0.68, 0), V(0, 0.95, 0), 0.215, 0.16, 'hips', 'tunic', { flat: 0.8 });
  // Head: face, blond hair with bangs and side locks, the long green cap falling back, pointed
  // ears, blue eyes.
  const head = 'head';
  k.ell(V(0, 1.6, -0.01), [0.1, 0.122, 0.112], head, 'skin');
  k.ell(V(0, 1.64, 0.008), [0.108, 0.1, 0.116], head, 'hair');
  for (const sx of [-1, 1]) {
    k.ell(V(sx * 0.045, 1.685, -0.092), [0.05, 0.03, 0.03], head, 'hair', [0.2, 0, sx * 0.5]);
    k.ell(V(sx * 0.092, 1.565, -0.055), [0.022, 0.07, 0.028], head, 'hair');
    k.cone(V(sx * 0.095, 1.6, 0.0), V(sx * 0.21, 1.66, 0.04), 0.032, head, 'skin', 8);
    k.box(V(sx * 0.04, 1.605, -0.108), [0.032, 0.02, 0.012], head, 'eye');
    k.box(V(sx * 0.042, 1.632, -0.108), [0.04, 0.01, 0.012], head, 'hair');
  }
  k.ell(V(0, 1.585, -0.118), [0.015, 0.022, 0.02], head, 'skin', null, [8, 6]);
  k.ell(V(0, 1.68, 0.01), [0.112, 0.06, 0.118], head, 'tunic');
  k.cone(V(0, 1.68, 0.03), V(0, 1.42, 0.34), 0.105, head, 'tunic', 12);
  // On the back: the Hylian Shield (blue, silver rim, the red bird and the Triforce) and the
  // Master Sword's scabbard and purple hilt over the left shoulder.
  k.box(V(0, 1.14, 0.165), [0.4, 0.5, 0.03], 'spine', 'rim');
  k.box(V(0, 1.14, 0.183), [0.35, 0.45, 0.012], 'spine', 'shield');
  k.box(V(0, 1.08, 0.19), [0.16, 0.06, 0.006], 'spine', 'red', [0, 0, 0]);
  k.box(V(0, 1.12, 0.19), [0.04, 0.1, 0.006], 'spine', 'red');
  k.box(V(0, 1.27, 0.19), [0.08, 0.06, 0.006], 'spine', 'rim');
  k.limb(V(0.12, 0.92, 0.135), V(-0.1, 1.42, 0.135), 0.028, 0.028, 'spine', 'tunicDark', { seg: 8 });
  k.box(V(-0.115, 1.45, 0.135), [0.12, 0.022, 0.03], 'spine', 'hilt', [0, 0, 0.42]);
  k.limb(V(-0.12, 1.46, 0.135), V(-0.17, 1.58, 0.135), 0.017, 0.017, 'spine', 'hilt', { seg: 6 });
  return k.build();
}

function bond() {
  const k = new Kit({
    skin: { color: 0xeab894 },
    hair: { color: 0x2e2118 },
    jacket: { color: 0x17191d },
    shirt: { color: 0xf2f2ef },
    tie: { color: 0x0a0a0c },
    trousers: { color: 0x1b1d22 },
    shoe: { color: 0x0b0b0c },
    dark: { color: 0x241a14 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'skin', upper: 'jacket', lower: 'jacket', hand: 'skin', cuff: 'shirt', thigh: 'trousers', shin: 'trousers', foot: 'shoe' }, { neck: 0.05, upper: 0.058, lower: 0.05, fist: 0.05, thigh: 0.078, shin: 0.06, foot: 0.105 });
  // Dinner jacket over a white shirt front, the collar and the black bow tie, and a pocket
  // square in the player's color.
  k.ell(V(0, 1.2, 0), [0.2, 0.235, 0.13], 'spine', 'jacket');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.18, 1.35, 0), [0.08, 0.06, 0.08], 'spine', 'jacket', null, [10, 8]);
  k.box(V(0, 1.27, -0.118), [0.085, 0.24, 0.02], 'spine', 'shirt', [-0.12, 0, 0]);
  k.limb(V(0, 1.39, -0.005), V(0, 1.45, -0.01), 0.062, 0.058, 'spine', 'shirt');
  for (const sx of [-1, 1]) k.box(V(sx * 0.028, 1.4, -0.07), [0.048, 0.034, 0.02], 'spine', 'tie', [0, 0, sx * 0.25]);
  k.box(V(0, 1.4, -0.075), [0.018, 0.02, 0.02], 'spine', 'tie');
  k.box(V(-0.105, 1.28, -0.12), [0.05, 0.03, 0.012], 'spine', 'team');
  k.limb(V(0, 0.82, 0), V(0, 1.03, 0), 0.165, 0.17, 'hips', 'jacket', { flat: 0.8 });
  // Head: face, short dark hair with a side part, ears, brows, eyes, a straight mouth.
  const head = 'head';
  k.ell(V(0, 1.6, -0.01), [0.098, 0.124, 0.108], head, 'skin');
  k.ell(V(0, 1.648, 0.012), [0.104, 0.09, 0.112], head, 'hair');
  k.ell(V(0.02, 1.672, -0.06), [0.09, 0.05, 0.07], head, 'hair', [0, 0, -0.15]);
  for (const sx of [-1, 1]) {
    k.ell(V(sx * 0.098, 1.592, 0.0), [0.018, 0.034, 0.026], head, 'skin', null, [8, 6]);
    k.box(V(sx * 0.038, 1.628, -0.1), [0.04, 0.01, 0.012], head, 'hair');
    k.box(V(sx * 0.038, 1.607, -0.103), [0.024, 0.012, 0.008], head, 'dark');
  }
  k.ell(V(0, 1.584, -0.112), [0.014, 0.024, 0.02], head, 'skin', null, [8, 6]);
  k.box(V(0, 1.545, -0.103), [0.04, 0.007, 0.008], head, 'dark');
  return k.build();
}

const BUILDERS = { crash, link, bond };
const cache = new Map();

// A character's body, built once per page load (null for the Spartan: the generated mesh).
export function castBody(id) {
  if (!BUILDERS[id]) return null;
  if (!cache.has(id)) cache.set(id, BUILDERS[id]());
  return cache.get(id);
}

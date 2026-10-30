import * as THREE from 'three';
import { JOINTS, HANDS, BONES } from './bodyMesh.js';

// The character options besides the Spartan (owner requests): Crash Bandicoot, Link and
// GoldenEye's Bond, seven BBQ originals and five more game homages, each built here from simple shapes (ellipsoids, tapered limbs, boxes, cones)
// on the Spartan's skeleton, so they animate, aim, ragdoll and replay exactly like everyone else.
// Each shape rides one bone (early-2000s style: joints are covered by a ball on the child bone).
// Every character carries a glowing touch in the player's color (Crash's and Link's wristbands,
// Bond's pocket square) besides the rim light every body has.
//
// A character comes out in the same form as the decoded Spartan (character.js base()), plus its
// palette: region index -> { color, glow, shine } (color null: the player's color; shine 0 to 1,
// how glossy, default a little).

export const CHARACTERS = {
  spartan: { name: 'Spartan' },
  crash: { name: 'Crash' },
  link: { name: 'Link' },
  bond: { name: 'Bond' },
  // BBQ originals (owner pick, 2026-10-30).
  hotDog: { name: 'Hot Dog' },
  grillBot: { name: 'Grill Bot' },
  hogWild: { name: 'Hog Wild' },
  bruiser: { name: 'Brisket Bruiser' },
  ghostPepper: { name: 'Ghost Pepper' },
  cornDog: { name: 'Corn Dog Commando' },
  pitmaster: { name: 'The Pitmaster' },
  // Game homages (owner: close emulation is fine for characters).
  samus: { name: 'Samus' },
  slayer: { name: 'Doom Slayer' },
  mario: { name: 'Mario' },
  sonic: { name: 'Sonic' },
  banjo: { name: 'Banjo' },
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
    shoe: { color: 0x6a1418, shine: 0.3 },
    white: { color: 0xf4f2f4, glow: 0.1, shine: 0.5 },
    lip: { color: 0xc89aa8 },
    nose: { color: 0x1c1c3c, shine: 0.85 },
    pupil: { color: 0x111111, shine: 0.9 },
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
    leather: { color: 0x7a4a26, shine: 0.25 },
    boot: { color: 0x5a3a1e, shine: 0.25 },
    buckle: { color: 0xc9a64a, shine: 0.85 },
    shield: { color: 0x2a4fa8, shine: 0.5 },
    rim: { color: 0xc4c8ce, shine: 0.85 },
    red: { color: 0xb02a2a },
    hilt: { color: 0x4a3fa8, shine: 0.55 },
    eye: { color: 0x2a5ea8, shine: 0.8 },
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
    hair: { color: 0x2e2118, shine: 0.45 },
    jacket: { color: 0x17191d, shine: 0.18 },
    shirt: { color: 0xf2f2ef },
    tie: { color: 0x0a0a0c, shine: 0.45 },
    trousers: { color: 0x1b1d22 },
    shoe: { color: 0x0b0b0c, shine: 0.85 },
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

// Two cartoon eyes on the face (white, a dark pupil looking ahead), centered at x = +-dx.
function eyes(k, y, z, dx, r, head = 'head', white = 'white', pupil = 'pupil') {
  for (const sx of [-1, 1]) {
    k.ell(V(sx * dx, y, z), [r, r * 1.25, r * 0.6], head, white, null, [10, 8]);
    k.ell(V(sx * dx * 0.95, y - r * 0.15, z - r * 0.5), [r * 0.45, r * 0.6, r * 0.25], head, pupil, null, [8, 6]);
  }
}

// Hot Dog: a sausage standing in its bun, a zigzag of mustard down the front, a cartoon face on
// the sausage's top, skinny arms in white gloves, red sneakers, and a toothpick flag on top in
// the player's color.
function hotDog() {
  const k = new Kit({
    sausage: { color: 0xb8442a, shine: 0.45 },
    bun: { color: 0xe0a45a },
    bunTop: { color: 0xb8742e },
    mustard: { color: 0xf2c418, shine: 0.3 },
    white: { color: 0xf4f2f0, shine: 0.3 },
    pupil: { color: 0x141414, shine: 0.8 },
    mouth: { color: 0x5a1410 },
    shoe: { color: 0xc8241c, shine: 0.35 },
    sole: { color: 0xf0f0f0 },
    stick: { color: 0xd8c08a },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'sausage', upper: 'sausage', lower: 'sausage', hand: 'white', cuff: 'team', thigh: 'sausage', shin: 'sausage', foot: 'shoe', sole: 'sole' }, { neck: 0.06, upper: 0.036, lower: 0.032, fist: 0.06, thigh: 0.06, shin: 0.045, foot: 0.12 });
  // The sausage body, standing up through the bun.
  k.ell(V(0, 1.14, 0), [0.15, 0.36, 0.15], 'spine', 'sausage');
  k.limb(V(0, 0.84, 0), V(0, 1.0, 0), 0.13, 0.15, 'hips', 'sausage');
  // The bun: a half on each side, rounded at the bottom.
  for (const sx of [-1, 1]) {
    k.ell(V(sx * 0.15, 1.08, 0.01), [0.085, 0.3, 0.18], 'spine', 'bun');
    k.ell(V(sx * 0.19, 1.08, 0.01), [0.06, 0.28, 0.16], 'spine', 'bunTop');
  }
  k.ell(V(0, 0.84, 0.01), [0.22, 0.08, 0.17], 'hips', 'bun');
  // Mustard zigzag down the front.
  for (let i = 0; i < 6; i++) {
    const y = 1.36 - i * 0.075;
    k.box(V(0, y, -0.148), [0.15, 0.022, 0.012], 'spine', 'mustard', [0, 0, i % 2 ? 0.45 : -0.45]);
  }
  // The sausage's top is the head: rounded, with the face.
  const head = 'head';
  k.ell(V(0, 1.6, 0), [0.14, 0.17, 0.14], head, 'sausage');
  eyes(k, 1.65, -0.12, 0.05, 0.035);
  k.box(V(0, 1.55, -0.135), [0.08, 0.018, 0.015], head, 'mouth', [0, 0, 0]);
  for (const sx of [-1, 1]) k.box(V(sx * 0.045, 1.558, -0.132), [0.02, 0.014, 0.012], head, 'mouth', [0, 0, sx * 0.6]);
  k.loosely(() => {
    // A toothpick through the top with a little flag in the player's color.
    k.limb(V(0.02, 1.7, 0), V(0.05, 1.95, 0), 0.008, 0.006, head, 'stick', { seg: 6 });
    k.box(V(0.1, 1.9, 0), [0.1, 0.07, 0.01], head, 'team');
  });
  return k.build();
}

// Grill Bot: a kettle-grill robot. A round black enamel belly with glowing coals behind a grate,
// a domed lid for a head with a vent, a little chimney and eyes in the player's color, steel
// arms and legs, tong hands and rubber feet.
function grillBot() {
  const k = new Kit({
    enamel: { color: 0x1c1d20, shine: 0.75 },
    steel: { color: 0x8a9096, shine: 0.85 },
    coals: { color: 0xff5a1a, glow: 1 },
    grate: { color: 0x2a2b2e, shine: 0.6 },
    rubber: { color: 0x202022 },
    team: { color: null, glow: 1 },
  });
  frame(k, { neck: 'steel', upper: 'steel', lower: 'steel', hand: 'steel', cuff: 'enamel', thigh: 'steel', shin: 'steel', foot: 'rubber' }, { neck: 0.04, upper: 0.03, lower: 0.03, fist: 0.05, thigh: 0.035, shin: 0.032, foot: 0.13 });
  // The kettle: a big round enamel body, its rim, the coal window with its grate.
  k.ell(V(0, 1.12, 0), [0.24, 0.25, 0.22], 'spine', 'enamel');
  k.limb(V(0, 1.3, 0), V(0, 1.33, 0), 0.235, 0.235, 'spine', 'steel', { seg: 18 });
  k.ell(V(0, 1.08, -0.175), [0.16, 0.13, 0.06], 'spine', 'coals');
  for (let i = -2; i <= 2; i++) k.box(V(i * 0.05, 1.08, -0.215), [0.012, 0.25, 0.012], 'spine', 'grate');
  k.box(V(0, 1.08, -0.215), [0.3, 0.012, 0.012], 'spine', 'grate');
  // Ash catcher under it and the hip block the legs come out of.
  k.limb(V(0, 0.84, 0), V(0, 0.92, 0), 0.12, 0.17, 'hips', 'steel', { seg: 14 });
  // The lid: a dome with a handle and a vent; two eyes in the player's color.
  const head = 'head';
  k.ell(V(0, 1.58, 0), [0.17, 0.14, 0.17], head, 'enamel');
  k.limb(V(0, 1.5, 0), V(0, 1.52, 0), 0.168, 0.168, head, 'steel', { seg: 18 });
  for (const sx of [-1, 1]) k.box(V(sx * 0.055, 1.6, -0.155), [0.06, 0.025, 0.02], head, 'team', [0.2, 0, 0]);
  k.loosely(() => {
    k.box(V(0, 1.735, 0), [0.11, 0.025, 0.03], head, 'steel');
    for (const sx of [-1, 1]) k.box(V(sx * 0.045, 1.715, 0), [0.012, 0.03, 0.012], head, 'steel');
    k.limb(V(0.09, 1.66, 0.06), V(0.11, 1.84, 0.07), 0.028, 0.026, head, 'steel', { seg: 10 });
    k.limb(V(0.11, 1.84, 0.07), V(0.115, 1.87, 0.07), 0.036, 0.036, head, 'grate', { seg: 10 });
  });
  return k.build();
}

// Hog Wild: a pig in denim overalls with a welding mask flipped up on its head (its glass in the
// player's color): a pink snout with nostrils, floppy ears, hooves for feet.
function hogWild() {
  const k = new Kit({
    pink: { color: 0xeba0a6 },
    pinkDark: { color: 0xd47c86 },
    denim: { color: 0x3a5a8c },
    strap: { color: 0x2a4470 },
    brass: { color: 0xc9a64a, shine: 0.85 },
    hoof: { color: 0x3a2a24, shine: 0.4 },
    mask: { color: 0x2c2e30, shine: 0.4 },
    white: { color: 0xf4f2f0, shine: 0.3 },
    pupil: { color: 0x141414, shine: 0.8 },
    nostril: { color: 0x5a2a30 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'pink', upper: 'pink', lower: 'pink', hand: 'pinkDark', cuff: 'pinkDark', thigh: 'denim', knee: 'denim', shin: 'denim', foot: 'hoof' }, { neck: 0.07, upper: 0.065, lower: 0.058, fist: 0.065, thigh: 0.09, shin: 0.075, foot: 0.12 });
  // A round belly, the overalls' bib and straps with brass buttons.
  k.ell(V(0, 1.15, 0), [0.22, 0.25, 0.17], 'spine', 'pink');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.17, 1.33, 0), [0.08, 0.07, 0.08], 'spine', 'pink', null, [10, 8]);
  k.ell(V(0, 1.02, 0), [0.2, 0.17, 0.165], 'spine', 'denim');
  k.box(V(0, 1.16, -0.16), [0.2, 0.18, 0.02], 'spine', 'denim');
  for (const sx of [-1, 1]) {
    k.box(V(sx * 0.1, 1.3, -0.12), [0.04, 0.18, 0.02], 'spine', 'strap', [0.35, 0, 0]);
    k.ell(V(sx * 0.08, 1.235, -0.172), [0.015, 0.015, 0.008], 'spine', 'brass', null, [8, 6]);
  }
  k.limb(V(0, 0.8, 0), V(0, 0.96, 0), 0.16, 0.19, 'hips', 'denim', { flat: 0.85 });
  // Head: round, the snout, eyes, ears flopping forward.
  const head = 'head';
  k.ell(V(0, 1.6, -0.005), [0.14, 0.135, 0.135], head, 'pink');
  k.limb(V(0, 1.57, -0.12), V(0, 1.57, -0.185), 0.06, 0.058, head, 'pinkDark', { seg: 14, flat: 0.85 });
  for (const sx of [-1, 1]) k.ell(V(sx * 0.022, 1.57, -0.187), [0.012, 0.018, 0.006], head, 'nostril', null, [8, 6]);
  eyes(k, 1.645, -0.115, 0.05, 0.028);
  k.loosely(() => {
    for (const sx of [-1, 1]) k.cone(V(sx * 0.09, 1.7, -0.02), V(sx * 0.17, 1.73, -0.13), 0.05, head, 'pinkDark', 4);
    // The welding mask, flipped up on top.
    k.box(V(0, 1.75, 0.02), [0.22, 0.05, 0.2], head, 'mask', [-0.5, 0, 0]);
    k.box(V(0, 1.775, -0.035), [0.12, 0.012, 0.05], head, 'team', [-0.5, 0, 0]);
  });
  return k.build();
}

// The Brisket Bruiser: a bull luchador. A dark bull head under a wrestling mask with trim in
// the player's color, white horns, a gold nose ring, bare muscled chest and arms, a gold
// championship belt, red tights and white boots.
function bruiser() {
  const k = new Kit({
    hide: { color: 0x5a3422 },
    mask: { color: 0xb81e2a, shine: 0.45 },
    horn: { color: 0xf0e8d4, shine: 0.45 },
    gold: { color: 0xd8a83a, shine: 0.9 },
    tights: { color: 0xb81e2a, shine: 0.5 },
    boot: { color: 0xf2f2f2, shine: 0.4 },
    muzzle: { color: 0x3a2218 },
    white: { color: 0xf4f2f0, shine: 0.3 },
    pupil: { color: 0x141414, shine: 0.8 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'hide', upper: 'hide', lower: 'hide', hand: 'mask', cuff: 'team', thigh: 'tights', knee: 'boot', shin: 'boot', foot: 'boot' }, { neck: 0.085, upper: 0.08, lower: 0.066, fist: 0.075, thigh: 0.095, shin: 0.075, foot: 0.12 });
  // A barrel chest and big shoulders, the belt with its plate, tights.
  k.ell(V(0, 1.2, 0), [0.23, 0.22, 0.15], 'spine', 'hide');
  for (const sx of [-1, 1]) {
    k.ell(V(sx * 0.18, 1.34, 0), [0.1, 0.085, 0.1], 'spine', 'hide', null, [10, 8]);
    k.ell(V(sx * 0.08, 1.25, -0.11), [0.08, 0.06, 0.04], 'spine', 'hide', null, [10, 8]);
  }
  k.limb(V(0, 0.95, 0), V(0, 1.03, 0), 0.19, 0.19, 'spine', 'gold', { flat: 0.8 });
  k.box(V(0, 0.99, -0.155), [0.16, 0.11, 0.02], 'spine', 'gold');
  k.box(V(0, 0.99, -0.167), [0.07, 0.05, 0.01], 'spine', 'team');
  k.limb(V(0, 0.8, 0), V(0, 0.96, 0), 0.16, 0.18, 'hips', 'tights', { flat: 0.82 });
  // Head: the masked bull, its muzzle and ring, eyes in the mask's holes.
  const head = 'head';
  k.ell(V(0, 1.61, 0), [0.14, 0.15, 0.14], head, 'mask');
  k.ell(V(0, 1.55, -0.12), [0.09, 0.07, 0.07], head, 'muzzle');
  for (const sx of [-1, 1]) {
    k.box(V(sx * 0.055, 1.65, -0.12), [0.07, 0.045, 0.03], head, 'team', [0, 0, sx * 0.3]);
  }
  eyes(k, 1.65, -0.13, 0.055, 0.02);
  k.loosely(() => {
    k.limb(V(-0.02, 1.52, -0.18), V(0.02, 1.52, -0.18), 0.022, 0.022, head, 'gold', { seg: 8 });
    for (const sx of [-1, 1]) {
      k.limb(V(sx * 0.11, 1.7, 0), V(sx * 0.22, 1.74, -0.02), 0.035, 0.03, head, 'horn', { seg: 8 });
      k.cone(V(sx * 0.22, 1.74, -0.02), V(sx * 0.27, 1.84, -0.05), 0.03, head, 'horn', 8);
    }
  });
  return k.build();
}

// Ghost Pepper: a lanky figure in a charred suit with glowing ember cracks, its head a wrinkled
// ghost pepper that glows red-orange, a curly green stem, hollow dark eyes, and a scarf in the
// player's color.
function ghostPepper() {
  const k = new Kit({
    char: { color: 0x1a1614 },
    ember: { color: 0xff6a1a, glow: 1 },
    pepper: { color: 0xe8401c, glow: 0.45, shine: 0.7 },
    stem: { color: 0x3a7a2a },
    hollow: { color: 0x120604 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'char', upper: 'char', lower: 'char', hand: 'char', cuff: 'ember', thigh: 'char', shin: 'char', foot: 'char' }, { neck: 0.035, upper: 0.04, lower: 0.034, fist: 0.05, thigh: 0.055, shin: 0.045, foot: 0.1 });
  k.ell(V(0, 1.2, 0), [0.15, 0.24, 0.1], 'spine', 'char');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.15, 1.35, 0), [0.06, 0.05, 0.06], 'spine', 'char', null, [10, 8]);
  k.limb(V(0, 0.82, 0), V(0, 1.0, 0), 0.12, 0.13, 'hips', 'char', { flat: 0.8 });
  // Ember cracks on the chest and back.
  for (const [x, y, rz] of [[-0.05, 1.25, 0.6], [0.04, 1.15, -0.4], [0.07, 1.3, 0.2], [-0.07, 1.08, -0.7]]) {
    k.box(V(x, y, -0.098), [0.1, 0.012, 0.008], 'spine', 'ember', [0, 0, rz]);
    k.box(V(-x, y + 0.02, 0.098), [0.09, 0.012, 0.008], 'spine', 'ember', [0, 0, -rz]);
  }
  k.limb(V(0, 1.36, 0), V(0, 1.42, 0), 0.08, 0.07, 'spine', 'team');
  // The pepper: long and wrinkled (a few lumps), hollow eyes and a jagged mouth.
  const head = 'head';
  k.ell(V(0, 1.6, 0), [0.11, 0.17, 0.11], head, 'pepper');
  for (const [x, y, z] of [[0.07, 1.65, -0.03], [-0.065, 1.56, 0.02], [0.02, 1.52, 0.07]]) k.ell(V(x, y, z), [0.06, 0.07, 0.06], head, 'pepper', null, [10, 8]);
  for (const sx of [-1, 1]) k.ell(V(sx * 0.04, 1.64, -0.095), [0.025, 0.035, 0.015], head, 'hollow', [0, 0, sx * 0.4], [8, 6]);
  for (let i = -2; i <= 2; i++) k.cone(V(i * 0.022, 1.55, -0.1), V(i * 0.022, 1.535 - (i % 2 ? 0 : 0.015), -0.11), 0.012, head, 'hollow', 3);
  k.loosely(() => {
    k.limb(V(0, 1.76, 0), V(0.02, 1.82, 0.01), 0.02, 0.018, head, 'stem', { seg: 6 });
    k.limb(V(0.02, 1.82, 0.01), V(0.07, 1.85, 0.03), 0.018, 0.012, head, 'stem', { seg: 6 });
  });
  return k.build();
}

// Corn Dog Commando: a corn cob soldier. A yellow cob head in rows of kernels with green husk
// leaves peeling back, a beret with a badge in the player's color, camo fatigues with blotches,
// combat boots.
function cornDog() {
  const k = new Kit({
    corn: { color: 0xf2c43a, shine: 0.45 },
    kernel: { color: 0xe0a828, shine: 0.55 },
    husk: { color: 0x7aa84a },
    camo: { color: 0x5a6a3a },
    camoDark: { color: 0x3a4628 },
    camoLight: { color: 0x8a8a5a },
    beret: { color: 0x7a1a1e },
    boot: { color: 0x2a2420, shine: 0.35 },
    white: { color: 0xf4f2f0, shine: 0.3 },
    pupil: { color: 0x141414, shine: 0.8 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'corn', upper: 'camo', lower: 'camo', hand: 'boot', cuff: 'camoDark', thigh: 'camo', shin: 'camo', foot: 'boot' }, { neck: 0.05, upper: 0.058, lower: 0.05, fist: 0.055, thigh: 0.08, shin: 0.062, foot: 0.11 });
  k.ell(V(0, 1.2, 0), [0.19, 0.22, 0.125], 'spine', 'camo');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.17, 1.35, 0), [0.075, 0.065, 0.075], 'spine', 'camo', null, [10, 8]);
  for (const [x, y, z, r] of [[-0.08, 1.25, -0.11, 0.05], [0.09, 1.12, -0.11, 0.045], [0.02, 1.33, 0.11, 0.05], [-0.1, 1.08, 0.1, 0.04]]) {
    k.ell(V(x, y, z), [r, r * 0.7, 0.02], 'spine', 'camoDark', null, [8, 6]);
    k.ell(V(-x * 0.7, y - 0.06, z), [r * 0.7, r * 0.5, 0.02], 'spine', 'camoLight', null, [8, 6]);
  }
  k.limb(V(0, 0.95, 0), V(0, 1.0, 0), 0.175, 0.175, 'spine', 'boot', { flat: 0.78 });
  k.limb(V(0, 0.8, 0), V(0, 0.96, 0), 0.155, 0.17, 'hips', 'camo', { flat: 0.8 });
  // The cob: rows of kernels around it, a face on the front.
  const head = 'head';
  k.ell(V(0, 1.61, 0), [0.11, 0.17, 0.11], head, 'corn');
  for (let row = 0; row < 7; row++) {
    const y = 1.5 + row * 0.035;
    const ry = 0.11 * Math.sqrt(Math.max(0, 1 - ((y - 1.61) / 0.17) ** 2));
    for (let a = 0; a < 10; a++) {
      const t = (a / 10) * Math.PI * 2 + (row % 2) * 0.31;
      if (Math.abs(Math.sin(t)) < 0.6 && Math.cos(t) < 0) continue;
      k.box(V(Math.sin(t) * ry, y, Math.cos(t) * ry), [0.026, 0.022, 0.012], head, 'kernel', [0, t, 0]);
    }
  }
  eyes(k, 1.65, -0.1, 0.042, 0.026);
  k.box(V(0, 1.56, -0.105), [0.06, 0.012, 0.012], head, 'pupil');
  k.loosely(() => {
    for (const [sx, sz] of [[-1, 0.4], [1, 0.4], [0, 1]]) k.cone(V(sx * 0.06, 1.48, sz * 0.05), V(sx * 0.16, 1.66, sz * 0.14), 0.05, head, 'husk', 4);
    // The beret, cocked to one side, its badge in the player's color.
    k.ell(V(0.03, 1.765, 0.0), [0.12, 0.035, 0.12], head, 'beret', [0, 0, -0.2]);
    k.box(V(-0.06, 1.77, -0.09), [0.035, 0.035, 0.008], head, 'team', [0, 0, -0.2]);
  });
  return k.build();
}

// The Pitmaster: a big guy in a leather apron over a work shirt, a tall chef's hat, a thick beard,
// a bandana in the player's color, tongs and a meat thermometer slung on his back.
function pitmaster() {
  const k = new Kit({
    skin: { color: 0xd89a72 },
    shirt: { color: 0xc8c4bc },
    apron: { color: 0x6a3a1e, shine: 0.3 },
    beard: { color: 0x4a2a18 },
    hat: { color: 0xf6f6f4 },
    jeans: { color: 0x2c3a5a },
    boot: { color: 0x3a2418, shine: 0.3 },
    steel: { color: 0xa0a6ac, shine: 0.85 },
    dark: { color: 0x1a1210 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'skin', upper: 'shirt', lower: 'skin', hand: 'skin', cuff: 'shirt', thigh: 'jeans', shin: 'jeans', foot: 'boot' }, { neck: 0.07, upper: 0.072, lower: 0.062, fist: 0.065, thigh: 0.095, shin: 0.072, foot: 0.12 });
  // A big belly and chest, the apron over it with its neck strap and pocket.
  k.ell(V(0, 1.18, 0), [0.23, 0.25, 0.17], 'spine', 'shirt');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.18, 1.34, 0), [0.09, 0.075, 0.09], 'spine', 'shirt', null, [10, 8]);
  k.ell(V(0, 1.08, -0.11), [0.19, 0.27, 0.08], 'spine', 'apron');
  k.box(V(0, 1.0, -0.185), [0.12, 0.08, 0.015], 'spine', 'apron');
  k.limb(V(0, 0.8, 0), V(0, 0.96, 0), 0.17, 0.2, 'hips', 'jeans', { flat: 0.85 });
  k.box(V(0, 0.82, -0.135), [0.3, 0.3, 0.03], 'hips', 'apron');
  // The bandana round the neck.
  k.limb(V(0, 1.38, -0.005), V(0, 1.45, -0.01), 0.085, 0.075, 'spine', 'team');
  // On the back: tongs and a meat thermometer.
  k.limb(V(-0.1, 0.95, 0.17), V(0.12, 1.4, 0.17), 0.012, 0.012, 'spine', 'steel', { seg: 6 });
  k.limb(V(-0.06, 0.95, 0.17), V(0.16, 1.4, 0.17), 0.012, 0.012, 'spine', 'steel', { seg: 6 });
  k.limb(V(0.1, 0.98, 0.17), V(-0.12, 1.36, 0.17), 0.008, 0.008, 'spine', 'steel', { seg: 6 });
  k.limb(V(-0.12, 1.36, 0.17), V(-0.14, 1.4, 0.17), 0.03, 0.03, 'spine', 'dark', { seg: 10 });
  // Head: face, a thick beard, brows, eyes.
  const head = 'head';
  k.ell(V(0, 1.6, -0.01), [0.11, 0.13, 0.115], head, 'skin');
  k.ell(V(0, 1.53, -0.045), [0.105, 0.09, 0.085], head, 'beard');
  for (const sx of [-1, 1]) {
    k.box(V(sx * 0.04, 1.638, -0.105), [0.045, 0.014, 0.014], head, 'beard');
    k.box(V(sx * 0.038, 1.612, -0.108), [0.022, 0.014, 0.008], head, 'dark');
  }
  k.ell(V(0, 1.585, -0.125), [0.022, 0.026, 0.022], head, 'skin', null, [8, 6]);
  k.loosely(() => {
    // The chef's hat: a band and a tall puffed top.
    k.limb(V(0, 1.68, 0), V(0, 1.75, 0), 0.115, 0.115, head, 'hat', { seg: 14 });
    k.ell(V(0, 1.85, 0), [0.15, 0.12, 0.15], head, 'hat');
  });
  return k.build();
}

// Samus (homage): the power suit. Big round shoulder pauldrons, a round helmet with a green
// visor, the arm cannon on the right forearm, yellow and orange plates, a chest light in the
// player's color.
function samus() {
  const k = new Kit({
    orange: { color: 0xd8501c, shine: 0.6 },
    yellow: { color: 0xe8b82a, shine: 0.6 },
    red: { color: 0x9a2418, shine: 0.55 },
    visor: { color: 0x3ad86a, glow: 0.7, shine: 1 },
    grey: { color: 0x4a4e54, shine: 0.6 },
    cannon: { color: 0x8a8e92, shine: 0.8 },
    team: { color: null, glow: 0.95 },
  });
  frame(k, { neck: 'grey', upper: 'red', lower: 'orange', hand: 'red', cuff: 'yellow', thigh: 'orange', knee: 'yellow', shin: 'orange', foot: 'red' }, { neck: 0.06, upper: 0.065, lower: 0.07, fist: 0.06, thigh: 0.09, shin: 0.08, foot: 0.13 });
  k.ell(V(0, 1.2, 0), [0.19, 0.22, 0.135], 'spine', 'orange');
  k.box(V(0, 1.24, -0.12), [0.16, 0.12, 0.03], 'spine', 'yellow', [-0.1, 0, 0]);
  k.ell(V(0, 1.25, -0.14), [0.03, 0.03, 0.012], 'spine', 'team', null, [10, 8]);
  // The big round pauldrons.
  for (const sx of [-1, 1]) k.ell(V(sx * 0.22, 1.35, 0), [0.13, 0.12, 0.13], 'spine', 'yellow');
  k.limb(V(0, 0.82, 0), V(0, 1.0, 0), 0.155, 0.17, 'hips', 'red', { flat: 0.82 });
  k.box(V(0, 0.96, -0.13), [0.12, 0.08, 0.03], 'hips', 'grey');
  // The arm cannon over the right forearm.
  const el = J('armLR');
  const wr = J('handR');
  k.limb(el.clone().lerp(wr, 0.25), wr.clone().lerp(el, -0.12), 0.08, 0.075, 'armLR', 'cannon', { seg: 14 });
  // Helmet: round, with a ridge and the visor.
  const head = 'head';
  k.ell(V(0, 1.61, 0), [0.145, 0.15, 0.15], head, 'red');
  k.ell(V(0, 1.6, -0.06), [0.12, 0.07, 0.1], head, 'visor');
  k.box(V(0, 1.72, -0.02), [0.04, 0.05, 0.22], head, 'yellow');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.14, 1.6, 0), [0.025, 0.05, 0.05], head, 'yellow', null, [10, 8]);
  return k.build();
}

// Doom Slayer (homage): chunky green armor plates over a grey undersuit, the helmet with its
// single wide slit visor (in the player's color), brown leather straps and gloves, a shoulder
// lamp.
function slayer() {
  const k = new Kit({
    green: { color: 0x4a6a32, shine: 0.55 },
    greenDark: { color: 0x34481f, shine: 0.5 },
    suit: { color: 0x4a4c50 },
    leather: { color: 0x5a3a20, shine: 0.3 },
    steel: { color: 0x7a7e84, shine: 0.85 },
    team: { color: null, glow: 1 },
  });
  frame(k, { neck: 'suit', upper: 'suit', lower: 'green', hand: 'leather', cuff: 'leather', thigh: 'suit', knee: 'green', shin: 'green', foot: 'greenDark' }, { neck: 0.065, upper: 0.068, lower: 0.068, fist: 0.065, thigh: 0.095, shin: 0.08, foot: 0.13 });
  k.ell(V(0, 1.2, 0), [0.21, 0.23, 0.14], 'spine', 'suit');
  k.box(V(0, 1.24, -0.115), [0.3, 0.24, 0.06], 'spine', 'green', [-0.1, 0, 0]);
  k.box(V(0, 1.07, -0.12), [0.22, 0.1, 0.05], 'spine', 'greenDark');
  for (const sx of [-1, 1]) {
    k.box(V(sx * 0.22, 1.35, 0), [0.14, 0.11, 0.17], 'spine', 'green', [0, 0, sx * -0.3]);
    k.box(V(sx * 0.11, 1.2, -0.13), [0.03, 0.3, 0.02], 'spine', 'leather', [0, 0, sx * 0.35]);
  }
  k.limb(V(-0.21, 1.4, -0.06), V(-0.21, 1.45, -0.06), 0.03, 0.03, 'spine', 'steel', { seg: 10 });
  k.limb(V(0, 0.95, 0), V(0, 1.0, 0), 0.18, 0.18, 'spine', 'leather', { flat: 0.8 });
  k.limb(V(0, 0.8, 0), V(0, 0.96, 0), 0.16, 0.18, 'hips', 'suit', { flat: 0.82 });
  for (const side of ['L', 'R']) {
    const kn = J(`legL${side}`);
    k.box(V(kn.x, kn.y + 0.12, -0.075), [0.14, 0.18, 0.04], `legU${side}`, 'green');
  }
  // Helmet: boxy, a ridge, the slit visor.
  const head = 'head';
  k.ell(V(0, 1.61, 0), [0.135, 0.145, 0.145], head, 'green');
  k.box(V(0, 1.6, -0.115), [0.2, 0.15, 0.06], head, 'greenDark');
  k.box(V(0, 1.625, -0.148), [0.15, 0.028, 0.012], head, 'team');
  k.box(V(0, 1.7, 0), [0.05, 0.08, 0.27], head, 'greenDark');
  return k.build();
}

// Mario (homage): red cap with an emblem (in the player's color), a big nose and mustache, a red
// shirt under blue overalls with gold buttons, white gloves, brown shoes.
function mario() {
  const k = new Kit({
    red: { color: 0xd8201c },
    blue: { color: 0x2a4ab8 },
    skin: { color: 0xf2c49a },
    stache: { color: 0x2a1a10 },
    hair: { color: 0x3a2414 },
    white: { color: 0xf4f2f0, shine: 0.3 },
    pupil: { color: 0x1a3a8a, shine: 0.8 },
    gold: { color: 0xe8c23a, shine: 0.9 },
    shoe: { color: 0x5a3018, shine: 0.35 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'skin', upper: 'red', lower: 'red', hand: 'white', cuff: 'white', thigh: 'blue', shin: 'blue', foot: 'shoe' }, { neck: 0.06, upper: 0.065, lower: 0.06, fist: 0.07, thigh: 0.095, shin: 0.08, foot: 0.13 });
  k.ell(V(0, 1.18, 0), [0.21, 0.23, 0.16], 'spine', 'red');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.17, 1.34, 0), [0.08, 0.07, 0.08], 'spine', 'red', null, [10, 8]);
  k.ell(V(0, 1.02, 0), [0.21, 0.17, 0.17], 'spine', 'blue');
  k.box(V(0, 1.16, -0.15), [0.2, 0.18, 0.03], 'spine', 'blue');
  for (const sx of [-1, 1]) {
    k.box(V(sx * 0.1, 1.3, -0.12), [0.045, 0.18, 0.02], 'spine', 'blue', [0.35, 0, 0]);
    k.ell(V(sx * 0.08, 1.22, -0.168), [0.02, 0.02, 0.01], 'spine', 'gold', null, [8, 6]);
  }
  k.limb(V(0, 0.8, 0), V(0, 0.96, 0), 0.16, 0.19, 'hips', 'blue', { flat: 0.85 });
  const head = 'head';
  k.ell(V(0, 1.6, -0.005), [0.12, 0.13, 0.12], head, 'skin');
  k.ell(V(0, 1.6, 0.04), [0.122, 0.11, 0.09], head, 'hair');
  k.ell(V(0, 1.585, -0.13), [0.04, 0.035, 0.035], head, 'skin', null, [10, 8]);
  k.ell(V(0, 1.55, -0.115), [0.08, 0.025, 0.03], head, 'stache', null, [10, 8]);
  eyes(k, 1.635, -0.1, 0.035, 0.025);
  // The cap: dome and brim, the emblem on its front.
  k.ell(V(0, 1.685, 0.0), [0.13, 0.08, 0.13], head, 'red');
  k.loosely(() => {
    k.box(V(0, 1.665, -0.15), [0.2, 0.02, 0.1], head, 'red', [-0.15, 0, 0]);
    k.ell(V(0, 1.71, -0.115), [0.035, 0.035, 0.012], head, 'white', [-0.5, 0, 0], [10, 8]);
    k.ell(V(0, 1.712, -0.122), [0.02, 0.02, 0.008], head, 'team', [-0.5, 0, 0], [8, 6]);
  });
  return k.build();
}

// Sonic (homage): a blue hedgehog with spines sweeping back off the head, a peach muzzle and
// belly, big eyes, white gloves and red sneakers with a white strap (glowing in the player's
// color).
function sonic() {
  const k = new Kit({
    blue: { color: 0x1a50d8, shine: 0.35 },
    peach: { color: 0xf0c8a0 },
    white: { color: 0xf4f2f0, shine: 0.3 },
    pupil: { color: 0x1a6a2a, shine: 0.8 },
    shoe: { color: 0xd81c1c, shine: 0.5 },
    nose: { color: 0x141414, shine: 0.9 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'blue', upper: 'peach', lower: 'peach', hand: 'white', cuff: 'white', thigh: 'blue', shin: 'blue', foot: 'shoe', sole: 'white' }, { neck: 0.05, upper: 0.035, lower: 0.033, fist: 0.065, thigh: 0.05, shin: 0.04, foot: 0.13 });
  k.ell(V(0, 1.18, 0), [0.15, 0.21, 0.13], 'spine', 'blue');
  k.ell(V(0, 1.15, -0.07), [0.1, 0.15, 0.07], 'spine', 'peach');
  k.limb(V(0, 0.82, 0), V(0, 0.98, 0), 0.12, 0.14, 'hips', 'blue', { flat: 0.85 });
  for (const side of ['L', 'R']) {
    const an = J(`foot${side}`);
    k.box(V(an.x, 0.12, an.z - 0.08), [0.14, 0.03, 0.06], `foot${side}`, 'team');
  }
  // A short back spike between the shoulders.
  k.cone(V(0, 1.22, 0.1), V(0, 1.15, 0.24), 0.06, 'spine', 'blue', 6);
  const head = 'head';
  k.ell(V(0, 1.61, 0), [0.15, 0.15, 0.15], head, 'blue');
  k.ell(V(0, 1.55, -0.1), [0.09, 0.06, 0.07], head, 'peach');
  k.ell(V(0, 1.585, -0.165), [0.022, 0.018, 0.02], head, 'nose', null, [8, 6]);
  // One wide white eye patch with two pupils, Sonic's way.
  k.ell(V(0, 1.65, -0.11), [0.09, 0.055, 0.05], head, 'white');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.035, 1.645, -0.155), [0.016, 0.026, 0.01], head, 'pupil', null, [8, 6]);
  k.loosely(() => {
    // The spines, swept back and down off the head, and the ears.
    for (const [y, sx, len] of [[1.72, 0, 0.3], [1.62, -0.07, 0.28], [1.62, 0.07, 0.28], [1.52, 0, 0.26], [1.68, -0.1, 0.22], [1.68, 0.1, 0.22]]) {
      k.cone(V(sx, y, 0.06), V(sx * 1.8, y - 0.08, 0.06 + len), 0.06, head, 'blue', 6);
    }
    for (const sx of [-1, 1]) k.cone(V(sx * 0.09, 1.72, 0.0), V(sx * 0.13, 1.83, 0.03), 0.035, head, 'blue', 4);
  });
  return k.build();
}

// Banjo (homage): a brown bear in yellow shorts with a blue backpack, a red bird peeking out of
// it (looks only: the body's hitbox doesn't change), a shark-tooth necklace on a cord in the
// player's color.
function banjo() {
  const k = new Kit({
    fur: { color: 0x7a4a22 },
    muzzle: { color: 0xd8a870 },
    shorts: { color: 0xe8c02a },
    pack: { color: 0x2a5ab8 },
    bird: { color: 0xc8281c },
    beak: { color: 0xe8b82a, shine: 0.4 },
    tooth: { color: 0xf4f0e4, shine: 0.5 },
    white: { color: 0xf4f2f0, shine: 0.3 },
    pupil: { color: 0x141414, shine: 0.8 },
    nose: { color: 0x1a1210, shine: 0.85 },
    team: { color: null, glow: 0.9 },
  });
  frame(k, { neck: 'fur', upper: 'fur', lower: 'fur', hand: 'fur', cuff: 'fur', thigh: 'shorts', knee: 'fur', shin: 'fur', foot: 'fur' }, { neck: 0.08, upper: 0.07, lower: 0.062, fist: 0.07, thigh: 0.1, shin: 0.075, foot: 0.13 });
  k.ell(V(0, 1.17, 0), [0.22, 0.25, 0.17], 'spine', 'fur');
  k.ell(V(0, 1.12, -0.1), [0.14, 0.17, 0.08], 'spine', 'muzzle');
  for (const sx of [-1, 1]) k.ell(V(sx * 0.17, 1.33, 0), [0.085, 0.075, 0.085], 'spine', 'fur', null, [10, 8]);
  k.limb(V(0, 0.8, 0), V(0, 0.98, 0), 0.17, 0.19, 'hips', 'shorts', { flat: 0.85 });
  // The necklace.
  k.limb(V(0, 1.37, -0.01), V(0, 1.4, -0.01), 0.1, 0.095, 'spine', 'team');
  k.cone(V(0, 1.36, -0.13), V(0, 1.31, -0.14), 0.02, 'spine', 'tooth', 6);
  // The backpack, and the bird peeking out.
  k.box(V(0, 1.18, 0.21), [0.3, 0.34, 0.14], 'spine', 'pack');
  k.box(V(0, 1.35, 0.21), [0.3, 0.04, 0.15], 'spine', 'beak');
  k.loosely(() => {
    k.ell(V(0.06, 1.44, 0.23), [0.07, 0.08, 0.07], 'head', 'bird');
    k.cone(V(0.06, 1.44, 0.17), V(0.06, 1.43, 0.08), 0.025, 'head', 'beak', 6);
    for (const sx of [-1, 1]) k.ell(V(0.06 + sx * 0.03, 1.47, 0.17), [0.015, 0.02, 0.01], 'head', 'pupil', null, [8, 6]);
  });
  const head = 'head';
  k.ell(V(0, 1.6, 0), [0.14, 0.14, 0.14], head, 'fur');
  k.ell(V(0, 1.56, -0.11), [0.075, 0.06, 0.07], head, 'muzzle');
  k.ell(V(0, 1.585, -0.18), [0.028, 0.022, 0.02], head, 'nose', null, [8, 6]);
  eyes(k, 1.645, -0.11, 0.05, 0.026);
  k.loosely(() => {
    for (const sx of [-1, 1]) k.ell(V(sx * 0.11, 1.72, 0.0), [0.045, 0.045, 0.02], head, 'fur', null, [10, 8]);
  });
  return k.build();
}

const BUILDERS = { crash, link, bond, hotDog, grillBot, hogWild, bruiser, ghostPepper, cornDog, pitmaster, samus, slayer, mario, sonic, banjo };
const cache = new Map();

// A character's body, built once per page load (null for the Spartan: the generated mesh).
export function castBody(id) {
  if (!BUILDERS[id]) return null;
  if (!cache.has(id)) cache.set(id, BUILDERS[id]());
  return cache.get(id);
}

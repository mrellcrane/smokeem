import * as THREE from 'three';
import { GLOVE } from '../combat/weaponModels.js';

// First-person gloves, built from each gun's `hands` boxes (the trigger hand first, its forearm
// and bracer, then the support hand and its forearm): fingers wrapped round the grip with the
// index on the trigger, a thumb over the top, a knuckle plate in the owner's color. The support
// hand cradles the fore end from below (fingers up the left side, the thumb along the right),
// closes on a vertical grip as a fist, or holds a carry handle from above. Its parts are in the
// 'support' group, so the viewmodel can move it on its own (reloads, the pump).

const _q = new THREE.Quaternion();
const _p = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

// Places parts given in a hand's own frame (turned by rot about c, mirrored in x and/or y).
// at.point(off) is a point in that frame, in gun space.
function placer(c, rot, { mx = 1, my = 1, group } = {}) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  const at = (off, size, color, opts = {}) => {
    _v.set(off[0] * mx, off[1] * my, off[2]).applyQuaternion(q);
    const r = opts.rot ?? [0, 0, 0];
    // A mirror flips the turns about the other axes.
    _p.setFromEuler(_e.set(r[0] * my, r[1] * mx, r[2] * mx * my));
    _q.copy(q).multiply(_p);
    _e.setFromQuaternion(_q);
    return [[c[0] + _v.x, c[1] + _v.y, c[2] + _v.z], size, color, { ...opts, rot: [_e.x, _e.y, _e.z], ...(group ? { group } : {}) }];
  };
  at.point = (off) => {
    _v.set(off[0] * mx, off[1] * my, off[2]).applyQuaternion(q);
    return [c[0] + _v.x, c[1] + _v.y, c[2] + _v.z];
  };
  at.group = group;
  return at;
}

// A round rod from a to b (gun space), `taper` times as thick at a as at b.
const _z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
function rod(a, b, d, color, group, taper = 1) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  _q.setFromUnitVectors(_z, _d.normalize());
  // The cylinder's +z turns onto a to b, so its tapered far end (-z) is at a.
  _e.setFromQuaternion(_q);
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return [c, [d, d, len], color, { shape: 'cyl', taper, rot: [_e.x, _e.y, _e.z], ...(group ? { group } : {}) }];
}

// The forearm from the wrist back past the forearm box (off the bottom of the screen), with a
// bracer in the owner's color partway along.
function arm(wrist, [c, s], group) {
  const end = [c[0], c[1], c[2] + s[2] / 2 + 0.12];
  const d = (s[0] + s[1]) / 2;
  const lerp = (t) => [wrist[0] + (end[0] - wrist[0]) * t, wrist[1] + (end[1] - wrist[1]) * t, wrist[2] + (end[2] - wrist[2]) * t];
  return [
    rod(wrist, end, d * 0.95, GLOVE, group, 0.72),
    rod(lerp(0.0), lerp(0.08), d * 0.78, GLOVE, group),
    rod(lerp(0.32), lerp(0.55), d * 0.98, null, group),
  ];
}

// A hand closed round a grip: the back of the hand on the outside (+x for the right hand), the
// fingers across the front, the thumb up the far side. `trigger`: the index finger reaches
// forward for the trigger instead of wrapping.
function fist(at, trigger) {
  const parts = [
    at([0.03, 0.0, 0.004], [0.022, 0.078, 0.07], GLOVE),
    at([0.042, 0.012, -0.012], [0.005, 0.028, 0.034], null),
    at([-0.024, 0.038, -0.012], [0.019, 0.019, 0.055], GLOVE, { shape: 'cyl', rot: [0.15, 0, 0] }),
  ];
  const ys = trigger ? [0.012, -0.008, -0.028] : [0.032, 0.012, -0.008, -0.028];
  for (const y of ys) {
    parts.push(at([0.004, y, -0.032], [0.058, 0.019, 0.021], GLOVE, { shape: 'cyl', axis: 'x' }));
    parts.push(at([-0.024, y, -0.02], [0.014, 0.018, 0.022], GLOVE));
  }
  if (trigger) parts.push(at([0.012, 0.036, -0.04], [0.018, 0.018, 0.05], GLOVE, { shape: 'cyl', rot: [0.1, 0.25, 0] }));
  return { parts, wrist: at.point([0.02, -0.045, 0.022]) };
}

// A hand cradling the gun from below (or, flipped, holding a handle from above): the palm flat
// against it, four fingers curled up the left side, the thumb along the right.
function cradle(at, s) {
  const py = s[1] / 2 - 0.031;
  const parts = [at([0, py, 0], [0.058, 0.022, 0.085], GLOVE), at([-0.006, py - 0.012, 0.004], [0.04, 0.006, 0.06], null)];
  for (const z of [-0.03, -0.01, 0.01, 0.03]) {
    parts.push(at([-s[0] / 2 - 0.002, py + 0.022, z], [0.018, 0.045, 0.018], GLOVE, { shape: 'cyl', axis: 'y', rot: [0, 0, -0.25] }));
  }
  parts.push(at([s[0] / 2 - 0.004, py + 0.016, -0.01], [0.018, 0.018, 0.05], GLOVE, { shape: 'cyl', rot: [0, 0.2, 0] }));
  return { parts, wrist: at.point([-0.008, py - 0.006, 0.05]) };
}

export function gloveParts(hands) {
  const [palm, forearm, , support, supportArm] = hands;
  const grip = [palm[0][0] - 0.005, palm[0][1], palm[0][2]];
  const right = fist(placer(grip, [-0.28, 0, 0]), true);
  const parts = [...right.parts, ...arm(right.wrist, forearm)];
  if (support) {
    const [c, s] = support;
    const group = 'support';
    let left;
    if (c[1] > 0.05) left = cradle(placer(c, [0, 0, 0], { my: -1, group }), s);
    else if (s[1] >= 0.07) left = fist(placer([c[0] + 0.005, c[1], c[2]], [-0.15, 0, 0], { mx: -1, group }), false);
    else left = cradle(placer(c, [0, 0, 0], { group }), s);
    parts.push(...left.parts);
    if (supportArm) parts.push(...arm(left.wrist, supportArm, group));
  }
  return parts;
}

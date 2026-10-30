import * as THREE from 'three';

// Bloom, Halo's glow: bright things (glow strips, the sky by the sun, muzzle flashes, explosions,
// shield flares) bleed light into what's around them. High preset only (preset.bloom, gfx switch
// `bloom`). Every view draws into one offscreen half-float frame instead of the canvas (begin /
// view); end() keeps what's brighter than THRESHOLD at half size, blurs it down a chain of
// smaller targets and back up (each step adding the coarser glow onto the finer), then draws the
// frame plus the glow to the canvas. About a dozen small passes a frame, whatever the view count.

const THRESHOLD = 1.1;
const KNEE = 0.2;
const STRENGTH = 0.45;
const LEVELS = 5;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
// Four bilinear taps half a texel out: a 4 x 4 box. The first one also keeps only the bright
// part (a soft knee, so the threshold has no hard edge).
const DOWN = /* glsl */ `
  uniform sampler2D uSrc;
  uniform vec2 uTexel;
  uniform float uBright;
  varying vec2 vUv;
  vec3 bright(vec3 c) {
    float l = max(c.r, max(c.g, c.b));
    float soft = clamp(l - ${(THRESHOLD - KNEE).toFixed(3)}, 0.0, ${(2 * KNEE).toFixed(3)});
    soft = soft * soft / ${(4 * KNEE + 1e-4).toFixed(4)};
    float w = max(soft, l - ${THRESHOLD.toFixed(3)}) / max(l, 1e-4);
    return c * w;
  }
  void main() {
    vec3 c = texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
    c += texture2D(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
    c += texture2D(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
    c += texture2D(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    c *= 0.25;
    if (uBright > 0.5) c = bright(c);
    gl_FragColor = vec4(c, 1.0);
  }
`;
// A 3 x 3 tent on the coarser level, added onto the finer one (additive blending).
const UP = /* glsl */ `
  uniform sampler2D uSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(uSrc, vUv).rgb * 4.0;
    c += (texture2D(uSrc, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(uSrc, vUv - vec2(uTexel.x, 0.0)).rgb
      + texture2D(uSrc, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(uSrc, vUv - vec2(0.0, uTexel.y)).rgb) * 2.0;
    c += texture2D(uSrc, vUv + uTexel).rgb + texture2D(uSrc, vUv - uTexel).rgb
      + texture2D(uSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(uSrc, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
    gl_FragColor = vec4(c / 16.0, 1.0);
  }
`;
// God rays (outdoor maps with godRays): the bright part at quarter size smeared toward each
// view's sun, fading as it goes, so the sky's light streams through gaps in what stands in
// front of it. One quarter-size pass.
const RAYS = /* glsl */ `
  uniform sampler2D uSrc;
  uniform vec4 uRects[4];
  uniform vec2 uSunUv[4];
  uniform float uSunOn[4];
  varying vec2 vUv;
  void main() {
    vec4 rr = uRects[0];
    vec2 sun = uSunUv[0];
    float on = uSunOn[0];
    for (int i = 1; i < 4; i++) {
      vec4 r = uRects[i];
      if (vUv.x >= r.x && vUv.x < r.x + r.z && vUv.y >= r.y && vUv.y < r.y + r.w) {
        rr = r;
        sun = uSunUv[i];
        on = uSunOn[i];
      }
    }
    if (on < 0.01) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec2 step = (sun - vUv) * (0.85 / 24.0);
    vec2 uv = vUv;
    float w = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      uv += step;
      sum += texture2D(uSrc, clamp(uv, rr.xy, rr.xy + rr.zw)).rgb * w;
      w *= 0.92;
    }
    // Strongest near the sun, gone a view's height away.
    vec2 off = (vUv - sun) / max(rr.w, 1e-3) * vec2(rr.z / max(rr.w, 1e-3), 1.0);
    float fall = 1.0 - smoothstep(0.1, 0.9, length(off));
    gl_FragColor = vec4(sum * (on * fall * 0.16), 1.0);
  }
`;

// Frame plus glow, then the color grade (render/grade.js) at each view's own exposure: drawing
// into the frame skipped the materials' own tone mapping, so it happens here instead.
const COMPOSITE = /* glsl */ `
  uniform sampler2D uFrame;
  uniform sampler2D uGlow;
  uniform sampler2D uRays;
  uniform float uRaysOn;
  uniform float uStrength;
  uniform vec4 uRects[4];
  uniform float uExposure[4];
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(uFrame, vUv).rgb + texture2D(uGlow, vUv).rgb * uStrength;
    if (uRaysOn > 0.5) c += texture2D(uRays, vUv).rgb;
    float e = uExposure[0];
    for (int i = 1; i < 4; i++) {
      vec4 r = uRects[i];
      if (vUv.x >= r.x && vUv.x < r.x + r.z && vUv.y >= r.y && vUv.y < r.y + r.w) e = uExposure[i];
    }
    gl_FragColor = vec4(c * e, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// A blur level: half float, no depth.
function target() {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
}

function pass(fragmentShader, uniforms, blending = THREE.NoBlending) {
  const m = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending });
  m.name = 'bloom';
  return m;
}

export class Bloom {
  // samples: MSAA samples for the frame (the canvas's own antialiasing doesn't apply to it).
  constructor({ samples = 0 } = {}) {
    this.frame = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.levels = Array.from({ length: LEVELS }, () => target());
    this.down = pass(DOWN, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uBright: { value: 0 } });
    this.up = pass(UP, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, THREE.AdditiveBlending);
    this.composite = pass(COMPOSITE, {
      uFrame: { value: this.frame.texture },
      uGlow: { value: this.levels[0].texture },
      uStrength: { value: STRENGTH },
      // Each view's rectangle (0..1 of the canvas, from the bottom left) and exposure.
      uRects: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uExposure: { value: [1, 1, 1, 1] },
      uRays: { value: null },
      uRaysOn: { value: 0 },
    });
    // God rays (set by the game for maps that want them).
    this.godRays = false;
    this.rays = target();
    this.raysPass = pass(RAYS, {
      uSrc: { value: this.levels[1].texture },
      uRects: this.composite.uniforms.uRects,
      uSunUv: { value: Array.from({ length: 4 }, () => new THREE.Vector2()) },
      uSunOn: { value: [0, 0, 0, 0] },
    });
    this.composite.uniforms.uRays.value = this.rays.texture;
    this.views = 0;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.down);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.size = new THREE.Vector2();
  }

  // Start a frame: sized to the canvas's drawing buffer.
  begin(renderer) {
    renderer.getDrawingBufferSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    if (this.frame.width !== w || this.frame.height !== h) {
      this.frame.setSize(w, h);
      let lw = w;
      let lh = h;
      for (const t of this.levels) {
        lw = Math.max(1, Math.floor(lw / 2));
        lh = Math.max(1, Math.floor(lh / 2));
        t.setSize(lw, lh);
      }
      this.rays.setSize(this.levels[1].width, this.levels[1].height);
    }
    this.pr = renderer.getPixelRatio();
    this.views = 0;
    for (const r of this.composite.uniforms.uRects.value) r.set(0, 0, 0, 0);
    this.raysPass.uniforms.uSunOn.value.fill(0);
  }

  // Point the frame at one view's rectangle (CSS pixels, from the bottom left) and draw into it.
  // (A render target uses its own viewport and scissor, not the renderer's.) exposure: the view's;
  // sun: where its sun is (normalized device coordinates) and sunOn how visible, for god rays.
  view(renderer, rect, exposure = 1, sun = null, sunOn = 0) {
    const pr = this.pr;
    const i = this.views++;
    if (i < 4) {
      const W = this.size.x / pr;
      const H = this.size.y / pr;
      this.composite.uniforms.uRects.value[i].set(rect.x / W, rect.y / H, rect.w / W, rect.h / H);
      this.composite.uniforms.uExposure.value[i] = exposure;
      if (sun) this.raysPass.uniforms.uSunUv.value[i].set((rect.x + (sun.x * 0.5 + 0.5) * rect.w) / W, (rect.y + (sun.y * 0.5 + 0.5) * rect.h) / H);
      this.raysPass.uniforms.uSunOn.value[i] = sun ? sunOn : 0;
    }
    const f = this.frame;
    f.viewport.set(rect.x * pr, rect.y * pr, rect.w * pr, rect.h * pr);
    f.scissor.copy(f.viewport);
    f.scissorTest = true;
    renderer.setRenderTarget(f);
  }

  // Blur the bright part and draw frame + glow to the canvas.
  end(renderer) {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setScissorTest(false);
    this.frame.scissorTest = false;
    // Down: frame -> level 0 (bright part only) -> level 1 -> ...
    let src = this.frame;
    this.quad.material = this.down;
    for (let i = 0; i < LEVELS; i++) {
      const t = this.levels[i];
      this.down.uniforms.uSrc.value = src.texture;
      this.down.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
      this.down.uniforms.uBright.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(t);
      renderer.render(this.scene, this.camera);
      src = t;
    }
    // God rays from the quarter-size bright part, before the up passes add onto it.
    const rays = this.godRays && this.raysPass.uniforms.uSunOn.value.some((v) => v > 0.01);
    this.composite.uniforms.uRaysOn.value = rays ? 1 : 0;
    // (Drawn once on the first frame whatever happens, so its shader compiles during loading.)
    if (rays || (this.godRays && !this.raysWarm)) {
      this.raysWarm = true;
      this.quad.material = this.raysPass;
      renderer.setRenderTarget(this.rays);
      renderer.render(this.scene, this.camera);
    }
    // Up: each coarser level added onto the next finer one.
    this.quad.material = this.up;
    for (let i = LEVELS - 1; i > 0; i--) {
      const s = this.levels[i];
      this.up.uniforms.uSrc.value = s.texture;
      this.up.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      renderer.setRenderTarget(this.levels[i - 1]);
      renderer.render(this.scene, this.camera);
    }
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, this.size.x / this.pr, this.size.y / this.pr);
    this.quad.material = this.composite;
    // (The views' exposures are in the composite; the grade itself adds none.)
    const exposure = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1;
    renderer.render(this.scene, this.camera);
    renderer.toneMappingExposure = exposure;
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.frame.dispose();
    this.rays.dispose();
    for (const t of this.levels) t.dispose();
    for (const m of [this.down, this.up, this.composite, this.raysPass]) m.dispose();
    this.quad.geometry.dispose();
  }
}

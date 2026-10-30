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
// Frame plus glow, then the color grade (render/grade.js) at each view's own exposure: drawing
// into the frame skipped the materials' own tone mapping, so it happens here instead.
const COMPOSITE = /* glsl */ `
  uniform sampler2D uFrame;
  uniform sampler2D uGlow;
  uniform float uStrength;
  uniform vec4 uRects[4];
  uniform float uExposure[4];
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(uFrame, vUv).rgb + texture2D(uGlow, vUv).rgb * uStrength;
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
    });
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
    }
    this.pr = renderer.getPixelRatio();
    this.views = 0;
    for (const r of this.composite.uniforms.uRects.value) r.set(0, 0, 0, 0);
  }

  // Point the frame at one view's rectangle (CSS pixels, from the bottom left) and draw into it.
  // (A render target uses its own viewport and scissor, not the renderer's.) exposure: the view's.
  view(renderer, rect, exposure = 1) {
    const pr = this.pr;
    const i = this.views++;
    if (i < 4) {
      const W = this.size.x / pr;
      const H = this.size.y / pr;
      this.composite.uniforms.uRects.value[i].set(rect.x / W, rect.y / H, rect.w / W, rect.h / H);
      this.composite.uniforms.uExposure.value[i] = exposure;
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
    for (const t of this.levels) t.dispose();
    for (const m of [this.down, this.up, this.composite]) m.dispose();
    this.quad.geometry.dispose();
  }
}

import * as THREE from 'three';

// The arena's reflection, captured once per match at load: a small cube map seen from above the
// middle of the map with nobody in it. The body material (armor, visors) and the first-person gun
// material reflect it instead of a plain sky-and-ground gradient, sampled at a blurrier mip for
// satin surfaces and a sharper one for glass. Costs one texture lookup per pixel; nothing per
// frame. uCamRot turns the first-person view's directions into the world's (set per view).
export const envUniforms = {
  uEnv: { value: null },
  uEnvOn: { value: 0 },
  uCamRot: { value: new THREE.Matrix3() },
};

const SIZE = 128;

// at: where the cube is seen from; hide: objects to leave out of it (bodies).
export function captureReflections(renderer, scene, at, hide = []) {
  // (Stored as sRGB, so the darks keep their precision in 8 bits; sampling decodes it back to
  // linear. Rendering into a target compiles a linear-output copy of each material's program,
  // once, inside the loading screen.)
  const target = new THREE.WebGLCubeRenderTarget(SIZE, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  const camera = new THREE.CubeCamera(0.5, 600, target);
  camera.position.copy(at);
  scene.add(camera);
  const shown = hide.map((o) => o.visible);
  for (const o of hide) o.visible = false;
  renderer.shadowMap.needsUpdate = true;
  camera.update(renderer, scene);
  hide.forEach((o, i) => (o.visible = shown[i]));
  scene.remove(camera);
  envUniforms.uEnv.value = target.texture;
  envUniforms.uEnvOn.value = 1;
  return target;
}

export function releaseReflections(target) {
  target?.dispose();
  envUniforms.uEnv.value = null;
  envUniforms.uEnvOn.value = 0;
}

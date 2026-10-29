import * as THREE from 'three';

export function pixelRatioFor(preset) {
  return Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
}

export function createRenderer(container, preset) {
  const renderer = new THREE.WebGLRenderer({
    antialias: preset.antialias,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(pixelRatioFor(preset));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // We render the shadow map once per frame ourselves, not once per split-screen view.
  renderer.shadowMap.autoUpdate = false;
  // Count draw calls across every view in a frame.
  renderer.info.autoReset = false;
  renderer.domElement.className = 'game-canvas';
  container.appendChild(renderer.domElement);
  return renderer;
}

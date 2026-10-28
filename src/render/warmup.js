// Compile every shader and upload every texture before gameplay starts, so nothing stalls
// mid-match. `extras` are objects that only appear later (effects, pickups): they get added to
// the scene in front of the camera, rendered once with shadows, then removed.
export async function warmUp(renderer, scene, camera, { textures = [], extras = [] } = {}) {
  for (const t of textures) renderer.initTexture(t);

  const added = [];
  for (const obj of extras) {
    if (obj.parent) continue;
    obj.position.copy(camera.position);
    obj.position.z -= 3;
    scene.add(obj);
    added.push(obj);
  }

  await renderer.compileAsync(scene, camera);

  // A real render catches what compile() can't: shadow depth materials, render state.
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);

  for (const obj of added) scene.remove(obj);
}

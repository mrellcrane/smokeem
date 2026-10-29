// Compile every shader and upload every texture before gameplay starts, so nothing stalls
// mid-match. Callers make every effect / pickup / model variant visible first (compile skips
// hidden objects), then `render` draws one real frame to catch shadow depth variants and
// render state that compile() alone misses.
export async function warmUp(renderer, { textures = [], scenes = [], render }) {
  for (const t of textures) renderer.initTexture(t);
  for (const [scene, camera] of scenes) await renderer.compileAsync(scene, camera);
  render();
}

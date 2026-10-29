// Per-view values every effect shader reads, shared by reference. Game.render sets them before
// each split-screen view (three re-uploads shader uniforms for every render call):
// - uViewer: the id of the player whose view this is (-1 while they fly a missile), so their own
//   third-person effects can hide in their own view.
// - uViewportH: the view's height in device pixels, for minimum on-screen sizes.
export const viewUniforms = {
  uViewer: { value: -1 },
  uViewportH: { value: 1080 },
};

export function setView(viewer, viewportH) {
  viewUniforms.uViewer.value = viewer;
  viewUniforms.uViewportH.value = viewportH;
}

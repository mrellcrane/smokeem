// Viewport rectangles for 1 to 4 local players, in CSS pixels with a bottom-left origin
// (what WebGLRenderer.setViewport expects). Index 0 is player 1.
//
// The 3-player layout is provisional (see GAME_DESIGN.md open questions).
export function viewportRects(count, width, height) {
  const W = Math.floor(width);
  const H = Math.floor(height);
  const hw = Math.floor(W / 2);
  const hh = Math.floor(H / 2);
  switch (count) {
    case 2:
      return [
        { x: 0, y: hh, w: W, h: H - hh },
        { x: 0, y: 0, w: W, h: hh },
      ];
    case 3:
      return [
        { x: 0, y: hh, w: W, h: H - hh },
        { x: 0, y: 0, w: hw, h: hh },
        { x: hw, y: 0, w: W - hw, h: hh },
      ];
    case 4:
      return [
        { x: 0, y: hh, w: hw, h: H - hh },
        { x: hw, y: hh, w: W - hw, h: H - hh },
        { x: 0, y: 0, w: hw, h: hh },
        { x: hw, y: 0, w: W - hw, h: hh },
      ];
    default:
      return [{ x: 0, y: 0, w: W, h: H }];
  }
}

// Toggleable FPS counter: frames per second, average frame time, draw calls per frame.
export class FpsCounter {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'fps';
    root.appendChild(this.el);
    this.frames = 0;
    this.time = 0;
    this.worst = 0;
    this.visible = false;
    // Latest readout, also shown in player 1's debug line during a match.
    this.text = '';
    this.setVisible(false);
  }

  setVisible(v) {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  frame(dt, drawCalls) {
    this.frames++;
    this.time += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.time >= 0.5) {
      if (this.visible) {
        const fps = this.frames / this.time;
        const ms = (this.time / this.frames) * 1000;
        this.text = `${fps.toFixed(0)} fps | ${ms.toFixed(1)} ms (worst ${(this.worst * 1000).toFixed(0)}) | ${drawCalls} draws`;
        this.el.textContent = this.text;
      }
      this.frames = 0;
      this.time = 0;
      this.worst = 0;
    }
  }

  dispose() {
    this.el.remove();
  }
}

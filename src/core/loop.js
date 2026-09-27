// Fixed-step simulation loop with variable rendering.
export class Loop {
  constructor(step = 1 / 120) {
    this.step = step;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.onUpdate = () => {};
    this.onRender = () => {};
    this.frame = this.frame.bind(this);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }
  frame(now) {
    if (!this.running) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1; // tab switch / hitch guard
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.step && n < 12) {
      this.onUpdate(this.step);
      this.acc -= this.step;
      n++;
    }
    if (n >= 12) this.acc = 0;
    this.onRender(dt, this.acc / this.step);
    requestAnimationFrame(this.frame);
  }
}

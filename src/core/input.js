// Unified keyboard / mouse / gamepad input, exposed as actions.
const BINDS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown', 'ControlLeft'],
  jump: ['Space', 'KeyW'],
  dash: ['ShiftLeft', 'ShiftRight', 'KeyL'],
  fire: ['Mouse0', 'KeyJ'],
  melee: ['Mouse2', 'KeyK', 'KeyV'],
  grenade: ['KeyQ', 'KeyG'],
  execute: ['KeyE'],
  frenzy: ['KeyF', 'KeyR'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'Space', 'NumpadEnter'],
  back: ['Escape', 'Backspace'],
  debug: ['F3'],
};
// Standard gamepad mapping
const PAD = {
  jump: [0], dash: [1, 6], melee: [2], execute: [3], grenade: [4], fire: [7], frenzy: [5, 10],
  pause: [9], confirm: [0], back: [1], up: [12], down: [13], left: [14], right: [15],
};

export class Input {
  constructor(el) {
    this.el = el;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: 0, y: 0, moved: 0 };
    this.padDown = new Set();
    this.padPrev = new Set();
    this.padAxes = [0, 0, 0, 0];
    this.usingPad = false;
    this.anyPressed = false;
    this.lastAimSource = 'mouse';
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F3'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.press(e.code);
      this.usingPad = false;
      if (e.code.startsWith('Arrow')) this.lastAimSource = 'keys';
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('mousedown', (e) => { this.press('Mouse' + e.button); this.usingPad = false; });
    window.addEventListener('mouseup', (e) => this.release('Mouse' + e.button));
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = performance.now();
      this.usingPad = false; this.lastAimSource = 'mouse';
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => { this.down.clear(); });
  }
  press(code) {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
    this.anyPressed = true;
  }
  release(code) {
    this.down.delete(code);
    this.released.add(code);
  }
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = [...pads].find((g) => g && g.connected);
    this.padPrev = this.padDown;
    this.padDown = new Set();
    if (!p) { this.padAxes = [0, 0, 0, 0]; return; }
    p.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) this.padDown.add(i); });
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    this.padAxes = [dz(p.axes[0] || 0), dz(p.axes[1] || 0), dz(p.axes[2] || 0), dz(p.axes[3] || 0)];
    if (this.padDown.size || this.padAxes.some((a) => a !== 0)) {
      if (!this.usingPad) this.usingPad = true;
      if (Math.abs(this.padAxes[2]) + Math.abs(this.padAxes[3]) > 0.3) this.lastAimSource = 'pad';
    }
    for (const b of this.padDown) if (!this.padPrev.has(b)) this.anyPressed = true;
  }
  held(action) {
    const b = BINDS[action];
    if (b && b.some((c) => this.down.has(c))) return true;
    const pb = PAD[action];
    if (pb && pb.some((i) => this.padDown.has(i))) return true;
    if (action === 'left' && this.padAxes[0] < -0.4) return true;
    if (action === 'right' && this.padAxes[0] > 0.4) return true;
    if (action === 'up' && this.padAxes[1] < -0.5) return true;
    if (action === 'down' && this.padAxes[1] > 0.6) return true;
    return false;
  }
  hit(action) {
    const b = BINDS[action];
    if (b && b.some((c) => this.pressed.has(c))) return true;
    const pb = PAD[action];
    if (pb && pb.some((i) => this.padDown.has(i) && !this.padPrev.has(i))) return true;
    return false;
  }
  // horizontal move axis in [-1,1]
  moveX() {
    if (Math.abs(this.padAxes[0]) > 0.2) return this.padAxes[0];
    return (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
  }
  // Right-stick aim vector (null when idle)
  padAim() {
    const x = this.padAxes[2], y = this.padAxes[3];
    if (x * x + y * y < 0.09) return null;
    return { x, y: -y };
  }
  endStep() {
    this.pressed.clear();
    this.released.clear();
    this.padPrev = new Set(this.padDown);
  }
  consumeAny() {
    const a = this.anyPressed;
    this.anyPressed = false;
    return a;
  }
}

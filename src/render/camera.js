import * as THREE from 'three';
import { damp, clamp } from '../core/math.js';
import { settings } from '../core/settings.js';

// Orthographic follow camera with look-ahead, bounds, trauma shake, kicks and zoom punches.
export class GameCamera {
  constructor(viewH = 9) {
    this.cam = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, -100, 100);
    this.cam.position.z = 10;
    this.baseViewH = viewH;
    this.viewH = viewH;
    this.x = 0; this.y = 3;
    this.tx = 0; this.ty = 3;
    this.zoom = 1; this.zoomTarget = 1;
    this.trauma = 0;
    this.kx = 0; this.ky = 0;
    this.punch = 0;
    this.aspect = 16 / 9;
    this.time = 0;
    this.roll = 0;
  }
  resize(aspect) { this.aspect = aspect; }
  get viewW() { return this.viewH * this.aspect; }
  shake(a) { this.trauma = Math.min(1.2, this.trauma + a * settings.screenShake); }
  kick(dx, dy) { this.kx += dx * settings.screenShake; this.ky += dy * settings.screenShake; }
  zoomPunch(a) { this.punch = Math.max(this.punch, a); }
  snap(x, y) { this.x = this.tx = x; this.y = this.ty = y; }
  follow(x, y, lookX, lookY, dt, bounds) {
    this.tx = x + lookX;
    this.ty = y + lookY;
    this.x = damp(this.x, this.tx, 5, dt);
    this.y = damp(this.y, this.ty, 4, dt);
    this.clampTo(bounds);
  }
  clampTo(b) {
    if (!b) return;
    const hw = this.viewW / 2, hh = this.viewH / 2;
    if (b.x1 - b.x0 < hw * 2) this.x = (b.x0 + b.x1) / 2; else this.x = clamp(this.x, b.x0 + hw, b.x1 - hw);
    if (b.y1 - b.y0 < hh * 2) this.y = b.y0 + hh; else this.y = clamp(this.y, b.y0 + hh, b.y1 - hh);
  }
  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.kx = damp(this.kx, 0, 14, dt); this.ky = damp(this.ky, 0, 14, dt);
    this.punch = damp(this.punch, 0, 7, dt);
    this.zoom = damp(this.zoom, this.zoomTarget, 3, dt);
    this.viewH = this.baseViewH / this.zoom * (1 - this.punch * 0.08);
  }
  apply() {
    const t = this.time, s = this.trauma * this.trauma;
    const n = (f, o) => Math.sin(t * f + o) * 0.6 + Math.sin(t * f * 2.3 + o * 1.7) * 0.4;
    const sx = n(37, 1) * s * 0.35, sy = n(41, 5) * s * 0.3;
    const hw = this.viewW / 2, hh = this.viewH / 2;
    const c = this.cam;
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    c.position.x = this.x + sx + this.kx;
    c.position.y = this.y + sy + this.ky;
    c.rotation.z = n(29, 9) * s * 0.02 + this.roll;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
  get cx() { return this.cam.position.x; }
  get cy() { return this.cam.position.y; }
}

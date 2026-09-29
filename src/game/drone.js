// Legion "Leech" drone: hovers out of reach, telegraphs, then dive-bombs and bursts into blood.
import { loadTexture } from '../core/assets.js';
import { makeSpriteMaterial, SpriteBatch } from '../render/sprites.js';
import { makeProjectedShadowMaterial } from '../render/shadows.js';
import { audio } from '../core/audio.js';
import { clamp, rand, lerp } from '../core/math.js';

let shared = null;
export async function loadDroneAssets(scene) {
  if (shared) { scene.add(shared.batch.shadowMesh, shared.batch.mesh); return shared; }
  const [tex, shadowMask] = await Promise.all([
    loadTexture('assets/chars/drone.webp'),
    loadTexture('assets/chars/drone_shadow.png', { srgb: false }),
  ]);
  const material = makeSpriteMaterial(tex, null);
  const batch = new SpriteBatch(material, 64, makeProjectedShadowMaterial(shadowMask));
  batch.mesh.renderOrder = 53;
  scene.add(batch.shadowMesh, batch.mesh);
  const aspect = tex.image ? tex.image.width / tex.image.height : 2;
  shared = { batch, w: 1.1, h: 1.1 / aspect };
  return shared;
}

export class Drone {
  constructor(game, x, y) {
    this.game = game;
    this.type = 'drone';
    this.cfg = { hp: 30, blood: 2.2, mass: 0.5 };
    this.hp = 30;
    this.blood = 2.2;
    this.bloodMax = 2.2;
    this.body = { x, y, vx: 0, vy: 0, w: 1.0, h: 0.5 };
    this.alive = true;
    this.state = 'hover';
    this.stateT = 0;
    this.t = rand(0, 5);
    this.age = 0;
    this.f = -1;
    this.flash = 0;
    this.executable = false;
    this.rig = null;
    this.hoverOff = rand(-2.5, 2.5);
    this.diveCd = rand(1.5, 3);
  }
  get x() { return this.body.x; }
  get y() { return this.body.y; }
  get cx() { return this.body.x; }
  get cy() { return this.body.y + 0.25; }
  setState(s) { this.state = s; this.stateT = 0; }

  hitTest(x0, y0, x1, y1, pr = 0.05) {
    if (!this.alive) return null;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (Math.abs(x - this.cx) < 0.5 + pr && Math.abs(y - this.cy) < 0.28 + pr) return { t, seg: 'torso', x, y };
    }
    return null;
  }

  damage(hit) {
    if (!this.alive) return null;
    const g = this.game;
    this.hp -= hit.dmg;
    this.flash = 1;
    this.body.vx += (hit.dx || 0) * 3;
    g.fx.spark(hit.x, hit.y, Math.atan2(-hit.dy, -hit.dx), 5, 5, [4, 3, 2]);
    audio.sfx('armor_hit', { vol: 0.4, pan: g.pan(hit.x), minGap: 0.05 });
    // the belly tank leaks when hit
    g.bleed(this, () => g.blood.spurt(this.cx, this.cy - 0.15, -Math.PI / 2 + rand(-0.6, 0.6), 3, 6, 0.7, 0.06));
    this.blood -= 0.06;
    if (this.hp <= 0) this.pop(hit, false);
    return this.alive ? 'hit' : 'killed';
  }

  pop(hit, kamikaze) {
    const g = this.game;
    this.alive = false;
    this.removeMe = true;
    g.fx.explosion(this.cx, this.cy, kamikaze ? 2.2 : 1.4);
    g.bleed(this, () => g.blood.burst(this.cx, this.cy, 1.3, Math.max(0.4, this.blood), 1.4));
    audio.sfx('explosion', { vol: 0.7, rate: 1.3, pan: g.pan(this.cx) });
    audio.sfx('glass_break', { vol: 0.5, rate: 1.4 });
    g.cam.shake(0.25);
    if (kamikaze) {
      const P = g.player;
      if (P.alive && Math.hypot(P.cx - this.cx, P.cy - this.cy) < 1.8) P.takeDamage(18, Math.sign(P.cx - this.cx), this, 8);
    }
    g.onEnemyKilled(this, hit || { kind: 'explosion', dx: 0, dy: 0 });
  }

  update(dt) {
    if (!this.alive) return;
    const g = this.game, P = g.player, b = this.body, kn = g.director.knobs;
    this.t += dt; this.age += dt; this.stateT += dt;
    this.flash = Math.max(0, this.flash - dt * 10);
    const tx = P.x + this.hoverOff, ty = Math.max(P.y, g.world.groundBelow(P.x, P.y + 1)) + 4.2 + Math.sin(this.t * 1.7) * 0.4;
    if (this.state === 'hover') {
      b.vx += clamp((tx - b.x) * 2 - b.vx, -12 * dt * 4, 12 * dt * 4) * dt * 3;
      b.vy += ((ty - b.y) * 3 - b.vy) * dt * 3;
      this.f = P.x > b.x ? 1 : -1;
      this.diveCd -= dt * lerp(0.6, 1.4, kn.aggression);
      if (this.diveCd <= 0 && P.alive && Math.abs(P.x - b.x) < 6) { this.setState('windup'); audio.sfx('enemy_laser_charge', { vol: 0.5, rate: 1.4, pan: g.pan(b.x) }); }
    } else if (this.state === 'windup') {
      // rear up, eye glows: this is the tell
      b.vx *= Math.exp(-dt * 6); b.vy += (1.5 - b.vy) * dt * 4;
      if (this.stateT > kn.telegraph * 0.9) {
        const a = Math.atan2(P.cy - this.cy, P.cx - this.cx);
        const sp = lerp(9, 14, kn.aggression);
        b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
        this.setState('dive');
      }
    } else if (this.state === 'dive') {
      b.vy -= 4 * dt;
      if (P.alive && Math.hypot(P.cx - this.cx, P.cy - this.cy) < 0.9) { this.pop(null, true); return; }
      if (g.world.solidAt(this.cx, this.cy - 0.2) || this.stateT > 1.4) { this.pop(null, true); return; }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y > 12) b.y = 12;
    if (Math.random() < dt * 3) g.fx.smoke(this.cx - this.f * 0.4, this.cy + 0.2, 0, -0.3, 0.06, 0.5, [0.4, 0.38, 0.4], 0.25);
  }

  draw() {
    if (!this.alive || !shared) return;
    const g = this.game, b = shared.batch;
    const tilt = this.state === 'dive' ? Math.atan2(this.body.vy, Math.abs(this.body.vx)) * this.f : this.state === 'windup' ? 0.35 * this.f : clamp(this.body.vx * 0.05, -0.3, 0.3) * -1;
    const bob = Math.sin(this.t * 9) * 0.03;
    b.setShadow(this.shadowGround ?? 0, this.shadowAlpha ?? 0, this.shadowX0 ?? 0, this.shadowX1 ?? 0);
    b.add(this.cx, this.cy + bob, tilt, shared.w * this.f, shared.h, [0, 0, 1, 1], [1, 1, 1, 1], 0, this.flash * 0.6, 0.2, this.state === 'windup' ? 0.25 : 0);
    b.setShadow(0, 0);
    const eyeX = this.cx + this.f * 0.33, eyeY = this.cy + 0.05;
    g.lights.add(eyeX, eyeY, [1, 0.08, 0.05], this.state === 'windup' ? 2.5 : 0.8, 2);
    if (this.state === 'windup' && Math.floor(this.stateT * 14) % 2 === 0) g.fx.once({ x: eyeX, y: eyeY, vx: 0, vy: 0, s0: 0.5, s1: 0, shape: 4, c: [3, 0.4, 0.2], rot: this.t * 4 });
  }
}

// Bullets, saw discs, grenades and enemy bolts.
import { audio } from '../core/audio.js';

export class Projectile {
  constructor(o) {
    Object.assign(this, { r: 0.05, life: 1, t: 0, dead: false, bounces: 0, pierce: false, grav: 0, hits: new Set() }, o);
  }
}

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
  }
  add(o) { const p = new Projectile(o); this.list.push(p); return p; }
  clear() { this.list.length = 0; }

  update(dt) {
    const g = this.game;
    for (const p of this.list) {
      if (p.dead) continue;
      p.t += dt;
      if (p.t > p.life) { p.dead = true; if (p.kind === 'grenade') g.explode(p.x, p.y, 2.8, 95, 'player'); if (p.kind === 'lob') g.explode(p.x, p.y, 2.3, 60, 'enemy'); continue; }
      p.vy -= p.grav * dt;
      const ox = p.x, oy = p.y;
      let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      // world hit
      const hit = g.world.raycast(ox, oy, nx, ny);
      if (p.kind === 'disc') p.spin = (p.spin || 0) + dt * 40;
      // characters
      if (p.owner === 'player') {
        const res = g.hitEnemies(ox, oy, hit ? hit.x : nx, hit ? hit.y : ny, p);
        if (res && !p.pierce) { p.dead = true; continue; }
      } else if (p.owner === 'enemy') {
        if (g.player && g.player.hitByProjectile(p, ox, oy, nx, ny)) continue;
      }
      if (g.hitProps(ox, oy, nx, ny, p)) { if (!p.pierce) { p.dead = true; continue; } }
      if (hit) {
        if (p.kind === 'lob') { p.dead = true; g.explode(hit.x + hit.nx * 0.1, hit.y + hit.ny * 0.1, 2.3, 60, 'enemy'); continue; }
        if (p.kind === 'flame') { p.vx *= 0.3; p.vy = Math.abs(p.vy) * 0.2; p.x = hit.x + hit.nx * 0.05; p.y = hit.y + hit.ny * 0.05; continue; }
        if (p.kind === 'grenade') {
          p.x = hit.x + hit.nx * 0.05; p.y = hit.y + hit.ny * 0.05;
          if (hit.ny) p.vy = -p.vy * 0.4; else p.vx = -p.vx * 0.45;
          p.vx *= 0.75;
          if (Math.abs(p.vy) > 1) audio.sfx('shell', { vol: 0.5, rate: 0.6 });
          continue;
        }
        if (p.bounces > 0) {
          p.bounces--;
          p.x = hit.x + hit.nx * 0.03; p.y = hit.y + hit.ny * 0.03;
          if (hit.nx) p.vx = -p.vx; if (hit.ny) p.vy = -p.vy;
          g.fx.spark(p.x, p.y, Math.atan2(hit.ny, hit.nx), 7, 8, [5, 3.5, 2]);
          audio.sfx('ripper_hit', { vol: 0.35, minGap: 0.05 });
          p.hits.clear();
          continue;
        }
        p.dead = true;
        g.impact(hit.x, hit.y, hit.nx, hit.ny, p);
        continue;
      }
      p.x = nx; p.y = ny;
    }
    this.list = this.list.filter((p) => !p.dead);
  }

  render(fx, lights, heroBatch, heroDef) {
    for (const p of this.list) {
      const ang = Math.atan2(p.vy, p.vx);
      if (p.kind === 'bullet') {
        const sp = Math.hypot(p.vx, p.vy);
        fx.once({ x: p.x - p.vx * 0.012, y: p.y - p.vy * 0.012, vx: 0, vy: 0, s0: p.big ? 0.11 : 0.08, s1: 0, shape: 1, rot: ang, stretch: Math.min(9, sp * 0.14), c: p.color || [4, 2.6, 1.2] });
      } else if (p.kind === 'bolt') {
        const pulse = 1 + Math.sin(p.t * 40) * 0.15;
        fx.once({ x: p.x, y: p.y, vx: 0, vy: 0, s0: 0.5 * pulse * (p.size || 1), s1: 0, shape: 7, c: p.reflected ? [3, 2.5, 1] : [3.2, 0.25, 0.25] });
        fx.once({ x: p.x, y: p.y, vx: 0, vy: 0, s0: 0.16 * (p.size || 1), s1: 0, shape: 0, c: [6, 3, 3] });
        fx.once({ x: p.x - p.vx * 0.02, y: p.y - p.vy * 0.02, vx: 0, vy: 0, s0: 0.14 * (p.size || 1), s1: 0, shape: 1, rot: ang, stretch: p.rail ? 14 : 4, c: [2.5, 0.2, 0.2] });
        lights.add(p.x, p.y, p.reflected ? [1, 0.8, 0.4] : [1, 0.1, 0.1], 1.2, 2.2, 0.4);
      } else if (p.kind === 'lob') {
        fx.once({ x: p.x, y: p.y, vx: 0, vy: 0, s0: 0.45, s1: 0, shape: 7, c: [2.4, 0.1, 0.1] });
        fx.once({ x: p.x, y: p.y, vx: 0, vy: 0, s0: 0.16, s1: 0, shape: 0, c: [4, 1, 0.8] });
        const k = 0.6 + 0.4 * Math.sin(p.t * 20);
        fx.once({ x: p.target[0], y: p.target[1] + 0.05, vx: 0, vy: 0, s0: 1.6 * (1 - p.t / 1.3) + 0.6, s1: 0, shape: 3, c: [2.5 * k, 0.2, 0.15] });
        lights.add(p.x, p.y, [1, 0.1, 0.1], 1, 2);
      } else if (p.kind === 'flame') {
        const u = p.t / p.life;
        fx.once({ x: p.x, y: p.y, vx: 0, vy: 0, s0: 0.25 + u * 0.6, s1: 0, shape: 2, c: [3.2 * (1 - u) + 0.6, 0.6 * (1 - u) + 0.05, 0.1], seed: p.seed ?? (p.seed = Math.random()) });
        if (Math.random() < 0.3) lights.add(p.x, p.y, [1, 0.35, 0.1], 1.4, 2.5);
      } else if (p.kind === 'orb') {
        fx.once({ x: p.x, y: p.y, vx: 0, vy: 0, s0: 0.9 * (p.size || 1), s1: 0, shape: 7, c: [2.4, 0.05, 0.08] });
        fx.once({ x: p.x, y: p.y, vx: 0, vy: 0, s0: 0.35 * (p.size || 1), s1: 0, shape: 2, c: [1.4, 0.02, 0.04], seed: p.t });
        lights.add(p.x, p.y, [1, 0.05, 0.08], 1.6, 3, 0.4);
      } else if (p.kind === 'disc') {
        const d = heroDef.parts.disc;
        // the real saw blade, spinning, with a faint motion-blurred ghost behind it
        const sc = 1.25;
        heroBatch.add(p.x - p.vx * 0.012, p.y - p.vy * 0.012, -(p.spin || 0) + 0.5, d.size[0] * sc, d.size[1] * sc, d.uv, [0.8, 0.8, 0.85, 0.35], p.bloody || 0, 0, 0.3, 0);
        heroBatch.add(p.x, p.y, -(p.spin || 0), d.size[0] * sc, d.size[1] * sc, d.uv, [1, 1, 1, 1], p.bloody || 0, 0, 0.3, 0.1);
      } else if (p.kind === 'grenade') {
        const d = heroDef.parts.grenade;
        heroBatch.add(p.x, p.y, p.t * 12, d.size[0], d.size[1], d.uv, [1, 1, 1, 1], 0, 0, 0.1, 0);
        if (Math.floor(p.t * 8) % 2 === 0) fx.once({ x: p.x, y: p.y + 0.08, vx: 0, vy: 0, s0: 0.12, s1: 0, shape: 0, c: [4, 0.4, 0.2] });
      }
    }
  }
}

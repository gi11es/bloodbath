// Pale Legion enemies: locational damage, wounds that keep bleeding, dismemberment, ragdolls, AI.
import { Rig, Ragdoll, Gib, J, SEGMENTS, SEG_NAMES, segChain } from './rig.js';
import { audio } from '../core/audio.js';
import { clamp, rand, lerp, pick } from '../core/math.js';

export const ENEMY_TYPES = {
  grunt: { def: 'grunt', hp: 60, blood: 5, w: 0.6, h: 1.75, speed: 3.3, mass: 1, score: 100, hold: 'rifle', gun: 'rifle', weapon: 'weapon' },
  shotgunner: { def: 'grunt', hp: 70, blood: 5.2, w: 0.6, h: 1.75, speed: 4.2, mass: 1.1, score: 130, hold: 'rifle', gun: 'shotgun', weapon: 'shotgun', tint: [1.0, 0.86, 0.72, 1] },
  grenadier: { def: 'grunt', hp: 65, blood: 5, w: 0.6, h: 1.75, speed: 2.6, mass: 1, score: 140, hold: 'rifle', gun: 'launcher', weapon: 'launcher', tint: [0.82, 0.95, 0.8, 1] },
  sniper: { def: 'grunt', hp: 50, blood: 4.6, w: 0.6, h: 1.75, speed: 2.8, mass: 0.9, score: 160, hold: 'rifle', gun: 'sniper', weapon: 'sniper', tint: [0.78, 0.84, 1.05, 1] },
  flamer: { def: 'grunt', hp: 95, blood: 6, w: 0.65, h: 1.75, speed: 2.2, mass: 1.3, score: 170, hold: 'rifle', gun: 'flamer', weapon: 'flamer', tint: [1.05, 0.72, 0.62, 1] },
  leaper: { def: 'leaper', hp: 46, blood: 4.2, w: 0.55, h: 1.8, speed: 6.2, mass: 0.8, score: 120, hold: 'blade' },
  butcher: { def: 'butcher', hp: 280, blood: 12, w: 1.0, h: 2.4, speed: 1.6, mass: 3, score: 400, hold: 'cleaver' },
};

// capsule radius per segment, in metres at 1.8 m height
const SEG_R = { head: 0.15, upperarmB: 0.08, forearmB: 0.075, handB: 0.06, upperarmF: 0.09, forearmF: 0.08, handF: 0.065, thighB: 0.1, shinB: 0.085, footB: 0.06, thighF: 0.11, shinF: 0.09, footF: 0.065 };

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-6;
  const u = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  const qx = ax + dx * u, qy = ay + dy * u;
  return [Math.hypot(px - qx, py - qy), u];
}
// closest approach between segment p0->p1 and capsule a->b; returns [dist, tAlongRay, uAlongSeg]
function rayCapsule(x0, y0, x1, y1, ax, ay, bx, by) {
  let best = [1e9, 0, 0];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
    const [d, u] = segDist(px, py, ax, ay, bx, by);
    if (d < best[0]) best = [d, t, u];
  }
  return best;
}

// Legion gun behaviours: range keeping, telegraph length, burst pattern, projectile.
export const GUNS = {
  rifle: {
    range: (kn) => lerp(9, 5, kn.aggression), maxDist: 16, tele: 1, gap: 0.16, cool: 1,
    burst: (kn) => 1 + Math.round(kn.aggression * 2),
    fire(e, g, m, a, kn) {
      g.projectiles.add({ kind: 'bolt', owner: 'enemy', x: m[0], y: m[1], vx: Math.cos(a) * kn.projectileSpeed, vy: Math.sin(a) * kn.projectileSpeed, dmg: 12, r: 0.12, life: 3 });
      g.fx.muzzle(m[0], m[1], a, 0.8);
      g.lights.add(m[0], m[1], [1, 0.2, 0.15], 2.5, 4);
      audio.sfx('enemy_shot', { vol: 0.45, pan: g.pan(e.body.x) });
    },
  },
  shotgun: {
    range: (kn) => lerp(4.5, 2.8, kn.aggression), maxDist: 7.5, tele: 0.75, gap: 0.5, cool: 0.9, errMul: 0.5, laser: false,
    burst: (kn) => (kn.aggression > 0.7 ? 2 : 1),
    fire(e, g, m, a, kn) {
      for (let i = 0; i < 6; i++) {
        const aa = a + (i - 2.5) * 0.09 + rand(-0.03, 0.03), sp = kn.projectileSpeed * rand(0.9, 1.15);
        g.projectiles.add({ kind: 'bolt', owner: 'enemy', x: m[0], y: m[1], vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, dmg: 7, r: 0.09, life: 0.55, size: 0.7 });
      }
      g.fx.muzzle(m[0], m[1], a, 1.6);
      g.lights.add(m[0], m[1], [1, 0.3, 0.15], 5, 5);
      g.cam.shake(0.08);
      audio.sfx('shotgun', { vol: 0.5, rate: 0.85, pan: g.pan(e.body.x) });
      e.body.vx -= Math.cos(a) * 2;
    },
  },
  launcher: {
    range: (kn) => lerp(11, 8, kn.aggression), maxDist: 17, tele: 1.2, gap: 0.55, cool: 1.5, laser: false, relocate: true,
    burst: (kn) => 1 + (kn.aggression > 0.6 ? 1 : 0),
    fire(e, g, m, a, kn, P) {
      // ballistic lob that lands where the player will be
      const tx = P.x + P.body.vx * 0.6 + rand(-0.8, 0.8), ty = P.y;
      const T = 1.1, gr = 18;
      const vx = (tx - m[0]) / T, vy = (ty - m[1]) / T + 0.5 * gr * T;
      g.projectiles.add({ kind: 'lob', owner: 'enemy', x: m[0], y: m[1], vx, vy, grav: gr, dmg: 20, r: 0.14, life: 4, target: [tx, ty] });
      g.fx.muzzle(m[0], m[1], Math.atan2(vy, vx), 1.1);
      audio.sfx('grenade_throw', { vol: 0.6, rate: 0.8, pan: g.pan(e.body.x) });
    },
  },
  sniper: {
    range: (kn) => lerp(13, 10, kn.aggression), maxDist: 22, tele: 2.2, lockAt: 0.8, gap: 0.3, cool: 1.6, errMul: 0.15, relocate: true, chargePitch: 0.7,
    burst: () => 1,
    fire(e, g, m, a, kn) {
      const sp = 42;
      g.projectiles.add({ kind: 'bolt', owner: 'enemy', x: m[0], y: m[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: 26, r: 0.1, life: 1.2, size: 0.8, rail: true });
      g.fx.muzzle(m[0], m[1], a, 1.4);
      g.lights.add(m[0], m[1], [1, 0.2, 0.15], 6, 6);
      g.cam.shake(0.1);
      audio.sfx('enemy_shot', { vol: 0.8, rate: 0.6, pan: g.pan(e.body.x) });
    },
  },
  flamer: {
    range: (kn) => lerp(3.8, 2.6, kn.aggression), maxDist: 5.5, tele: 0.8, gap: 0.05, cool: 1.1, laser: false,
    burst: (kn) => Math.round(lerp(18, 30, kn.aggression)),
    fire(e, g, m, a, kn) {
      // a gout of burning blood: short-lived, gravity-affected, sets pools alight
      const sp = rand(8, 11);
      g.projectiles.add({ kind: 'flame', owner: 'enemy', x: m[0], y: m[1], vx: Math.cos(a) * sp + e.body.vx, vy: Math.sin(a) * sp + 1, grav: 6, dmg: 3, r: 0.2, life: 0.45, pierce: true });
      if (Math.random() < 0.4) audio.sfx('explosion', { vol: 0.08, rate: 2.2, minGap: 0.12, pan: g.pan(e.body.x) });
    },
  },
};

export class Enemy {
  constructor(game, type, x, y, opts = {}) {
    this.game = game;
    this.type = type;
    this.cfg = ENEMY_TYPES[type];
    const def = game.defs[this.cfg.def];
    this.def = def;
    this.rig = new Rig(def);
    this.elite = !!opts.elite;
    this.hpMax = this.cfg.hp * (this.elite ? 1.6 : 1) * (game.director ? game.director.knobs.hpMul : 1);
    this.hp = this.hpMax;
    this.bloodMax = this.cfg.blood * (this.elite ? 1.3 : 1);
    this.blood = this.bloodMax;
    if (this.cfg.weapon) this.rig.weaponPart = this.cfg.weapon;
    if (this.cfg.tint) this.rig.tint = this.cfg.tint;
    if (this.elite) this.rig.tint = [1.0, 0.72, 0.72, 1];
    this.gun = this.cfg.gun;
    this.body = { x, y, vx: 0, vy: 0, w: this.cfg.w, h: this.cfg.h, grounded: false };
    this.f = opts.f || (game.player && game.player.x < x ? -1 : 1);
    this.alive = true;
    this.state = opts.state || 'advance';
    this.stateT = 0;
    this.t = rand(0, 10);
    this.age = 0;
    this.wounds = [];
    this.limbDmg = {};
    this.flash = 0;
    this.hurt = 0;
    this.aim = this.f > 0 ? 0 : Math.PI;
    this.shootTimer = rand(0.8, 1.8);
    this.burst = 0;
    this.panic = false;
    this.deadT = 0;
    this.heartRate = 1.1 + Math.random() * 0.3;
    this.scale = def.height / 1.8;
    this.shieldHp = type === 'butcher' ? 220 : 0;
    this.hasShield = type === 'butcher';
    this.recoil = 0;
    this.melee = -1;
    this.windup = 0;
    this.laser = 0;
    this.id = Math.random();
    this.executable = false;
    this.lastHitBy = null;
    this.dropX = null;
    this.bleedScore = 0;
    this.pose(0);
  }

  get x() { return this.body.x; }
  get y() { return this.body.y; }
  get cx() { return this.body.x; }
  get cy() { return this.body.y + this.body.h * 0.55; }

  // --------------------------------------------------------------------------- damage
  // Returns {t, seg, x, y} for the closest hit on the ray, or null.
  hitTest(x0, y0, x1, y1, pr = 0.05) {
    const j = this.rig.j;
    // broad phase
    const bx = this.alive ? this.body.x : j[0], by = this.alive ? this.body.y + this.body.h / 2 : j[1];
    const R = this.body.h * 0.9 + 0.6;
    const [bd] = segDist(bx, by, x0, y0, x1, y1);
    if (bd > R) return null;
    let best = null;
    const s = this.scale;
    const test = (name, ax, ay, bx2, by2, r) => {
      const [d, t, u] = rayCapsule(x0, y0, x1, y1, ax, ay, bx2, by2);
      if (d < r + pr && (!best || t < best.t)) best = { t, seg: name, u, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
    };
    test('torso', j[0], j[1], j[J.neck * 2], j[J.neck * 2 + 1], 0.2 * s);
    for (const name of SEG_NAMES) {
      if (this.rig.missing.has(name)) continue;
      const S = SEGMENTS[name];
      test(name, j[S.a * 2], j[S.a * 2 + 1], j[S.b * 2], j[S.b * 2 + 1], SEG_R[name] * s);
    }
    return best;
  }

  shieldBlocks(dx) {
    if (!this.alive || !this.hasShield || this.state === 'recover' || this.state === 'stagger') return false;
    return Math.sign(dx) === -this.f; // projectile travelling toward our front
  }

  damage(hit) {
    const g = this.game;
    if (!this.alive) return this.damageCorpse(hit);
    if (hit.kind !== 'explosion' && hit.kind !== 'execution' && hit.kind !== 'blade' && this.shieldBlocks(hit.dx) && hit.seg !== 'head') {
      this.shieldHp -= hit.dmg;
      g.fx.spark(hit.x, hit.y, Math.atan2(-hit.dy, -hit.dx), 6, 6, [4, 3.5, 3]);
      audio.sfx('armor_hit', { vol: 0.5, pan: g.pan(hit.x) });
      if (this.shieldHp <= 0) this.breakShield(hit);
      return 'blocked';
    }
    let dmg = hit.dmg;
    if (hit.seg === 'head' && (hit.kind === 'bullet' || hit.kind === 'pellet')) { dmg *= 2; hit.headshot = true; }
    this.hp -= dmg;
    this.flash = 1;
    this.hurt = Math.min(1, this.hurt + dmg / 40);
    this.lastHitBy = hit.kind;
    // knockback
    const kb = (hit.knock || 1) / this.cfg.mass;
    this.body.vx += hit.dx * kb;
    if (hit.kind === 'explosion') this.body.vy += 4 / this.cfg.mass;
    // blood
    this.addWound(hit);
    const seg = hit.seg || 'torso';
    this.rig.blood[seg] = Math.min(1, (this.rig.blood[seg] || 0) + 0.25 + dmg / 80);
    const vol = Math.min(this.blood, 0.035 + dmg * 0.0025);
    this.blood -= vol;
    g.bleed(this, () => {
      const exitA = Math.atan2(hit.dy, hit.dx);
      g.blood.spurt(hit.x, hit.y, exitA, 5 + dmg * 0.1, 10 + dmg * 0.25, 0.8, vol * 0.75);
      g.blood.spurt(hit.x, hit.y, exitA + Math.PI, 2.5, 5, 1.2, vol * 0.25);
    });
    audio.sfx('squelch', { vol: 0.6, pan: g.pan(hit.x), minGap: 0.04 });
    // dismemberment
    if (seg !== 'torso') {
      this.limbDmg[seg] = (this.limbDmg[seg] || 0) + dmg * (hit.dismember ?? 0.2);
      const thr = seg === 'head' ? 34 : seg.startsWith('upper') || seg.startsWith('thigh') ? 30 : seg.startsWith('hand') || seg.startsWith('foot') ? 14 : 24;
      if (this.limbDmg[seg] * g.goreMul() > thr * this.scale) this.sever(seg, hit);
    }
    if (!this.alive) return 'killed';
    if (this.hp <= 0) { this.die(hit); return 'killed'; }
    // interrupts
    if (dmg > 22 || (hit.kind === 'blade')) {
      if (this.type !== 'butcher' || hit.kind === 'blade' && dmg > 50) this.setState('stagger', 0.35);
    }
    if (this.state === 'aim' && Math.random() < 0.35) this.setState('advance');
    return 'hit';
  }

  damageCorpse(hit) {
    const g = this.game;
    if (this.gibbed) return null;
    const seg = hit.seg || 'torso';
    this.rig.blood[seg] = Math.min(1, (this.rig.blood[seg] || 0) + 0.2);
    if (this.blood > 0.01) {
      const vol = Math.min(this.blood, 0.025 + hit.dmg * 0.0015);
      this.blood -= vol;
      g.bleed(this, () => g.blood.spurt(hit.x, hit.y, Math.atan2(hit.dy, hit.dx), 4, 8, 0.9, vol));
      if (Math.random() < 0.4) this.addWound(hit, 0.5);
    }
    if (this.ragdoll) this.ragdoll.kick(hit.dx * (hit.knock || 1) * 0.6, 1.2);
    audio.sfx('squelch', { vol: 0.45, pan: g.pan(hit.x), minGap: 0.05 });
    if (seg !== 'torso') {
      this.limbDmg[seg] = (this.limbDmg[seg] || 0) + hit.dmg * (hit.dismember ?? 0.2) * 1.4;
      if (this.limbDmg[seg] * g.goreMul() > 22 * this.scale) this.sever(seg, hit);
    }
    this.corpseHp = (this.corpseHp ?? 80) - hit.dmg;
    if (hit.kind === 'explosion' || (this.corpseHp < 0 && (hit.kind === 'pellet' || hit.kind === 'disc'))) this.gibAll(hit);
    return 'corpse';
  }

  addWound(hit, rateMul = 1) {
    const seg = hit.seg || 'torso';
    const S = seg === 'torso' ? { a: J.hip, b: J.neck } : SEGMENTS[seg];
    if (!S) return;
    const j = this.rig.j;
    const ax = j[S.a * 2], ay = j[S.a * 2 + 1], bx = j[S.b * 2], by = j[S.b * 2 + 1];
    const [, u] = segDist(hit.x, hit.y, ax, ay, bx, by);
    const segA = Math.atan2(by - ay, bx - ax);
    const exit = Math.atan2(hit.dy, hit.dx);
    const rate = (hit.bleed ?? 0.05) * rateMul * (this.alive ? 1 : 0.6);
    // merge with a close wound
    for (const w of this.wounds) {
      if (w.seg === seg && Math.abs(w.u - u) < 0.2 && !w.stump) { w.rate = Math.min(0.9, w.rate + rate); return; }
    }
    if (this.wounds.length > 9) this.wounds.shift();
    this.wounds.push({ seg, a: S.a, b: S.b, u, off: exit - segA, rate, acc: 0, stump: false, side: Math.random() < 0.5 ? 1 : -1 });
  }

  sever(seg, hit) {
    const g = this.game, rig = this.rig;
    if (rig.missing.has(seg)) return;
    const S = SEGMENTS[seg];
    const j = rig.j;
    const list = segChain(seg).filter((n) => !rig.missing.has(n));
    for (const name of list) {
      const s2 = SEGMENTS[name];
      const ax = j[s2.a * 2], ay = j[s2.a * 2 + 1], bx = j[s2.b * 2], by = j[s2.b * 2 + 1];
      const part = this.def.parts[s2.part];
      const boneAng = Math.atan2(by - ay, bx - ax);
      const ra = rig.f > 0 ? this.def.rest[s2.part] : Math.PI - this.def.rest[s2.part];
      const rot = boneAng - ra;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const cx = part.center[0] * rig.f, cy = part.center[1];
      // gib origin is the sprite centre
      const gx = ax + cx * c - cy * sn, gy = ay + cx * sn + cy * c;
      const sp = 4 + Math.random() * 5 + (hit.knock || 1) * 0.4;
      const gib = new Gib(this.def, s2.part, gx, gy, rot, 0, rig.f,
        (hit.dx || 0) * sp + rand(-1.5, 1.5), 3 + Math.random() * 5, rand(-14, 14),
        { blood: Math.min(1, (rig.blood[name] || 0) + 0.5), bleed: 0.25, tint: s2.side === 0 ? [0.6, 0.58, 0.62, 1] : rig.tint || undefined });
      g.addGib(gib);
      rig.missing.add(name);
    }
    // stump
    const px = j[S.a * 2], py = j[S.a * 2 + 1];
    const along = Math.atan2(j[S.b * 2 + 1] - py, j[S.b * 2] - px);
    this.wounds = this.wounds.filter((w) => !list.includes(w.seg));
    this.wounds.push({ seg: 'stump', a: S.a, b: S.a, u: 0, off: 0, dirAbs: along, relJoint: S.a, rate: seg === 'head' ? 1.1 : 0.55, acc: 0, stump: true, stumpOf: seg });
    const vol = Math.min(this.blood, 0.35);
    this.blood -= vol;
    g.bleed(this, () => g.blood.spurt(px, py, along, 7, 36, 0.7, vol, 1.3));
    audio.sfx('gore', { vol: 0.9, pan: g.pan(px) });
    g.onDismember(this, seg, hit);
    if (seg === 'head' && this.alive) { this.hp = 0; this.die({ ...hit, decap: true }); }
    else if ((seg === 'upperarmF' || seg === 'forearmF' || seg === 'handF') && this.alive) {
      this.dropWeapon(hit);
      this.panic = true;
      this.setState('panic');
      audio.sfx('enemy_pain', { vol: 0.8, pan: g.pan(px) });
    } else if ((rig.missing.has('thighB') || rig.missing.has('shinB')) && (rig.missing.has('thighF') || rig.missing.has('shinF')) && this.alive) {
      this.die(hit);
    }
  }

  gibAll(hit) {
    const g = this.game;
    for (const s of ['head', 'upperarmF', 'upperarmB', 'thighF', 'thighB']) if (!this.rig.missing.has(s)) this.sever(s, { ...hit, knock: 6 });
    // torso gib
    const rig = this.rig, j = rig.j, part = this.def.parts.torso;
    const ang = Math.atan2(j[J.neck * 2 + 1] - j[1], j[J.neck * 2] - j[0]);
    const ra = rig.f > 0 ? this.def.rest.torso : Math.PI - this.def.rest.torso;
    const rot = ang - ra;
    const c = Math.cos(rot), s = Math.sin(rot);
    const cx = part.center[0] * rig.f, cy = part.center[1];
    const gib = new Gib(this.def, 'torso', j[0] + cx * c - cy * s, j[1] + cx * s + cy * c, rot, 0, rig.f, (hit.dx || 0) * 5, 6, rand(-8, 8), { blood: 1, bleed: 0.8, tint: rig.tint || undefined });
    gib.ang = rot;
    g.addGib(gib);
    const vol = this.blood * 0.8;
    this.blood -= vol;
    g.bleed(this, () => g.blood.burst(j[0], j[1] + 0.3, 1.4, vol, 1.4));
    this.gibbed = true;
    this.removeMe = true;
    audio.sfx('gore', { vol: 1, pan: g.pan(j[0]) });
    g.onGibbed(this);
  }

  breakShield(hit) {
    this.hasShield = false;
    const rig = this.rig;
    const p = this.def.parts.shield;
    if (!rig.shieldPos) return;
    const gib = new Gib(this.def, 'shield', rig.shieldPos[0], rig.shieldPos[1] + 0.3, 0, 0, rig.f, -rig.f * 3, 5, rand(-6, 6), { blood: 0.2, bleed: 0 });
    this.game.addGib(gib);
    rig.missing.add('shield');
    audio.sfx('glass_break', { vol: 0.6, rate: 0.7 });
    this.game.fx.debris(rig.shieldPos[0], rig.shieldPos[1] + 0.5, Math.PI / 2, 6, 14, [0.85, 0.82, 0.78]);
    this.setState('stagger', 0.8);
  }

  dropWeapon(hit) {
    const rig = this.rig;
    if (!rig.weaponVisible) return;
    rig.weaponVisible = false;
    const part = this.def.parts[rig.weaponPart];
    const g = rig.gripPos || [this.x, this.y + 1];
    const rot = rig.weaponAng - (rig.f > 0 ? 0 : Math.PI);
    const c = Math.cos(rot), s = Math.sin(rot);
    const cx = part.center[0] * rig.f, cy = part.center[1];
    const gib = new Gib(this.def, rig.weaponPart, g[0] + cx * c - cy * s, g[1] + cx * s + cy * c, rot, 0, rig.f, (hit?.dx || 0) * 2 + rand(-1, 1), 3, rand(-8, 8), { blood: 0.1, bleed: 0 });
    this.game.addGib(gib);
  }

  die(hit) {
    if (!this.alive) return;
    const g = this.game;
    this.alive = false;
    this.state = 'dead';
    this.deadT = 0;
    this.pose(1 / 120);
    this.dropWeapon(hit);
    const kx = (hit.dx || 0) * (hit.knock || 2) * 1.2 + this.body.vx * 0.5;
    this.ragdoll = new Ragdoll(this.rig, kx, 2 + Math.random() * 2 + (hit.kind === 'explosion' ? 6 : 0), (hit.dx || 0) * -2);
    if (hit.kind === 'explosion') this.gibAll(hit);
    audio.sfx(hit.decap ? 'gore' : 'enemy_death', { vol: 0.8, pan: g.pan(this.x) });
    if (hit.decap) audio.sfx('enemy_death', { vol: 0.5, pan: g.pan(this.x), rate: 1.3 });
    g.onEnemyKilled(this, hit);
  }

  setState(s, dur = 0) { this.state = s; this.stateT = 0; this.stateDur = dur; }

  // --------------------------------------------------------------------------- update
  update(dt) {
    this.t += dt;
    this.age += dt;
    this.flash = Math.max(0, this.flash - dt * 14);
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.rig.flash = this.flash;
    const g = this.game;
    if (!this.alive) {
      this.deadT += dt;
      if (this.ragdoll) this.ragdoll.update(dt, g.world);
      this.updateWounds(dt);
      if (this.deadT > 40) { this.rig.alpha = Math.max(0, 1 - (this.deadT - 40) / 3); if (this.deadT > 43) this.removeMe = true; }
      return;
    }
    this.stateT += dt;
    const kn = g.director.knobs;
    const P = g.player;
    this.think(dt, kn, P);
    // physics
    const b = this.body;
    b.vy -= 30 * dt;
    if (b.vy < -20) b.vy = -20;
    g.world.moveActor(b, dt);
    if (b.fellOut) { this.hp = 0; this.blood = 0; this.removeMe = true; this.alive = false; g.onEnemyKilled(this, { kind: 'fall' }); return; }
    if (b.grounded) b.vx *= Math.exp(-dt * (this.moving ? 2 : 10));
    this.updateWounds(dt);
    // bleeding out
    const bf = this.blood / this.bloodMax;
    this.executable = this.alive && (bf < 0.4 || this.hp < this.hpMax * 0.28 || this.panic);
    if (bf < 0.1) { this.hp = 0; this.die({ kind: 'drained', dx: 0, dy: 0 }); g.onDrained(this); return; }
    this.pose(dt);
  }

  updateWounds(dt) {
    const g = this.game, j = this.rig.j;
    if (this.blood <= 0.001 || !this.wounds.length) return;
    const pressure = this.alive ? (this.panic ? 1.5 : 1) : Math.exp(-this.deadT / 7);
    if (pressure < 0.02) return;
    const hr = this.heartRate * (this.panic ? 1.6 : 1) * (this.alive ? 1 : 0.7);
    const beat = Math.pow(Math.max(0, Math.sin(this.t * Math.PI * 2 * hr)), 4);
    const beatN = Math.floor(this.t * hr + 0.25);
    if (beatN !== this.lastBeatN) {
      this.lastBeatN = beatN;
      if (this.wounds.some((w) => w.stump) && g.onScreen(this.body.x, -1) && pressure > 0.3) audio.sfx('spurt', { vol: 0.35 * pressure, pan: g.pan(this.body.x), minGap: 0.12 });
    }
    const pulse = 0.25 + beat * 1.5;
    g.bleed(this, () => {
      for (const w of this.wounds) {
        const rate = w.rate * pressure * pulse;
        const vol = Math.min(this.blood, rate * dt);
        if (vol <= 0) continue;
        this.blood -= vol;
        w.acc += vol;
        let px, py, dir;
        if (w.stump) {
          px = j[w.relJoint * 2]; py = j[w.relJoint * 2 + 1];
          // stump direction follows the parent bone
          const parentJoint = SEGMENTS[w.stumpOf].p;
          dir = Math.atan2(py - j[parentJoint * 2 + 1], px - j[parentJoint * 2]);
        } else {
          const ax = j[w.a * 2], ay = j[w.a * 2 + 1], bx = j[w.b * 2], by = j[w.b * 2 + 1];
          px = ax + (bx - ax) * w.u; py = ay + (by - ay) * w.u;
          dir = Math.atan2(by - ay, bx - ax) + w.off;
        }
        const speed = (w.stump ? 3.5 : 1.6) + beat * (w.stump ? 6 : 3.2) * Math.min(1.5, w.rate * 4 + 0.4);
        const dropVol = w.stump ? 0.009 : 0.006;
        let n = 0;
        while (w.acc > dropVol && n < 6) {
          w.acc -= dropVol;
          n++;
          const a = dir + rand(-0.25, 0.25);
          const sp = speed * rand(0.7, 1.15);
          g.blood.emit(px, py, Math.cos(a) * sp + this.body.vx * 0.5, Math.sin(a) * sp, rand(0.014, 0.032) * (w.stump ? 1.25 : 1), dropVol, Math.random() < 0.12 ? 1 : 0, true);
        }
        g.blood.count(vol);
        w.rate *= Math.exp(-dt / (w.stump ? 14 : 6));
      }
    });
    this.wounds = this.wounds.filter((w) => w.rate > 0.004);
  }

  face(dx) { if (Math.abs(dx) > 0.2) this.f = dx > 0 ? 1 : -1; }

  moveToward(tx, speed, dt) {
    const b = this.body;
    const dx = tx - b.x;
    const want = Math.abs(dx) < 0.15 ? 0 : Math.sign(dx) * speed;
    const acc = b.grounded ? 25 : 8;
    b.vx += clamp(want - b.vx, -acc * dt, acc * dt);
    this.moving = Math.abs(want) > 0.1;
    // hop over obstacles
    if (b.wallDir && b.grounded && this.moving && Math.sign(dx) === b.wallDir) b.vy = 10.5;
  }

  think(dt, kn, P) {
    const b = this.body;
    const dx = P ? P.x - b.x : 0, dy = P ? P.y - b.y : 0;
    const dist = Math.abs(dx);
    this.moving = false;
    if (this.state === 'enter') {
      this.face(dx);
      this.moveToward(P.x, this.cfg.speed, dt);
      if (this.stateT > 0.6 || b.grounded) this.setState('advance');
      return;
    }
    if (this.state === 'stagger') {
      if (this.stateT > (this.stateDur || 0.35)) this.setState('advance');
      return;
    }
    if (this.state === 'panic') {
      // a disarmed, spraying soldier does not last long
      if (this.stateT > (this.panicLife || (this.panicLife = rand(4, 7)))) { this.hp = 0; this.die({ kind: 'drained', dx: this.f, dy: 0, knock: 1 }); this.game.onDrained(this); return; }
      // run around screaming, spraying blood
      if (!this.panicDir || this.stateT > this.panicSwitch) { this.panicDir = Math.random() < 0.5 ? -1 : 1; this.panicSwitch = this.stateT + rand(0.6, 1.4); if (Math.random() < 0.5) audio.sfx('enemy_pain', { vol: 0.6, pan: this.game.pan(b.x), minGap: 0.4 }); }
      this.face(this.panicDir);
      this.moveToward(b.x + this.panicDir * 5, this.cfg.speed * 1.1, dt);
      return;
    }
    if (!P || !P.alive) { this.moveToward(b.x, 0, dt); return; }
    if (this.cfg.gun) this.thinkGrunt(dt, kn, P, dx, dy, dist);
    else if (this.type === 'leaper') this.thinkLeaper(dt, kn, P, dx, dy, dist);
    else if (this.type === 'butcher') this.thinkButcher(dt, kn, P, dx, dy, dist);
  }

  tryPlatformChase(P, dy, dist) {
    const b = this.body;
    if (!b.grounded) return;
    if (dy > 1.6 && dist < 4.5 && Math.random() < 0.03) b.vy = 12.5;
    if (dy < -1.5 && b.onPlatform && Math.random() < 0.02) { b.dropThrough = true; b.y -= 0.05; setTimeout(() => (b.dropThrough = false), 250); }
  }

  thinkGrunt(dt, kn, P, dx, dy, dist) {
    const b = this.body, g = this.game;
    const G = GUNS[this.gun];
    const range = G.range(kn) + (this.id * 2 - 1);
    const targetAim = Math.atan2(P.cy - (b.y + 1.35), P.x - b.x);
    if (this.state === 'advance') {
      this.face(dx);
      if (dist > range + 1) this.moveToward(P.x - Math.sign(dx) * range, this.cfg.speed, dt);
      else if (dist < range - 2.5) this.moveToward(b.x - Math.sign(dx) * 3, this.cfg.speed * 0.6, dt);
      else this.moveToward(b.x, 0, dt);
      this.aim += Math.atan2(Math.sin(targetAim - this.aim), Math.cos(targetAim - this.aim)) * (1 - Math.exp(-dt * 5));
      this.tryPlatformChase(P, dy, dist);
      this.shootTimer -= dt;
      if (dist < 1.3 && Math.abs(dy) < 1) { this.setState('bash'); return; }
      if (this.shootTimer <= 0 && dist < G.maxDist && g.onScreen(b.x, 1.5)) {
        this.setState('aim');
        this.aimTarget = targetAim;
        audio.sfx('enemy_laser_charge', { vol: 0.35, pan: g.pan(b.x), minGap: 0.2, rate: G.chargePitch || 1 });
      }
    } else if (this.state === 'aim') {
      this.face(dx);
      this.moveToward(b.x, 0, dt);
      // track slower than a human so dashing can dodge
      const err = (1 - kn.accuracy) * 0.28;
      this.aim += Math.atan2(Math.sin(targetAim - this.aim), Math.cos(targetAim - this.aim)) * (1 - Math.exp(-dt * (2.5 + kn.accuracy * 4)));
      const tele = kn.telegraph * G.tele;
      this.laser = this.stateT / tele;
      if (G.lockAt && this.stateT > tele * G.lockAt) this.aim = this.lockedAim ?? (this.lockedAim = this.aim);
      if (this.stateT >= tele) {
        this.burst = G.burst(kn);
        this.burstT = 0;
        this.aimErr = rand(-err, err) * (G.errMul ?? 1);
        this.setState('fire');
        this.laser = 0;
        this.lockedAim = null;
      }
    } else if (this.state === 'fire') {
      this.moveToward(b.x, 0, dt);
      this.burstT -= dt;
      if (this.burstT <= 0 && this.burst > 0) {
        this.burst--;
        this.burstT = G.gap;
        const m = this.rig.muzzle();
        const a = this.aim + this.aimErr + rand(-0.03, 0.03);
        G.fire(this, g, m, a, kn, P);
        this.recoil = 1;
      }
      if (G.stream) G.stream(this, g, dt, kn, P);
      if (this.burst <= 0 && this.burstT <= 0) { this.shootTimer = rand(1.5, 2.8) * G.cool / kn.fireRate; this.setState(G.relocate && Math.random() < 0.6 ? 'relocate' : 'advance'); }
    } else if (this.state === 'relocate') {
      // snipers and grenadiers reposition after firing
      this.face(dx);
      if (!this.relocX) this.relocX = b.x + (Math.random() < 0.5 ? -1 : 1) * rand(2.5, 5);
      this.moveToward(this.relocX, this.cfg.speed * 1.3, dt);
      this.tryPlatformChase(P, 2, 3);
      if (Math.abs(b.x - this.relocX) < 0.3 || this.stateT > 1.6) { this.relocX = null; this.setState('advance'); }
    } else if (this.state === 'bash') {
      this.moveToward(b.x, 0, dt);
      this.melee = clamp(this.stateT / 0.45, 0, 1);
      if (this.stateT > 0.25 && !this.bashed) {
        this.bashed = true;
        if (Math.abs(P.x - b.x) < 1.5 && Math.abs(P.y - b.y) < 1.2) P.takeDamage(9, Math.sign(dx), this);
      }
      if (this.stateT > 0.5) { this.melee = -1; this.bashed = false; this.setState('advance'); }
    }
  }

  thinkLeaper(dt, kn, P, dx, dy, dist) {
    const b = this.body, g = this.game;
    if (this.state === 'advance') {
      this.face(dx);
      this.moveToward(P.x, this.cfg.speed * lerp(0.7, 1.1, kn.aggression), dt);
      this.tryPlatformChase(P, dy, dist);
      if (dist < 5 && dist > 1.5 && b.grounded && this.stateT > 0.5) this.setState('crouch');
      else if (dist < 1.4 && Math.abs(dy) < 1) this.setState('slash');
    } else if (this.state === 'crouch') {
      this.face(dx);
      this.moveToward(b.x, 0, dt);
      this.crouch = 1;
      if (this.stateT > kn.telegraph * 0.7) {
        this.crouch = 0;
        const t = 0.55;
        const tx = P.x + (P.body.vx || 0) * t * 0.5;
        b.vx = clamp((tx - b.x) / t, -11, 11);
        b.vy = 9.5 + Math.max(0, dy) * 1.2;
        this.setState('leap');
        this.hitDone = false;
        audio.sfx('slash', { vol: 0.5, pan: g.pan(b.x), rate: 0.8 });
      }
    } else if (this.state === 'leap') {
      this.melee = clamp(this.stateT / 0.5, 0, 1);
      this.moving = true;
      if (!this.hitDone && Math.abs(P.x - b.x) < 1.1 && Math.abs(P.cy - (b.y + 1)) < 1.2) {
        this.hitDone = true;
        P.takeDamage(15, Math.sign(dx), this);
      }
      if (b.grounded && this.stateT > 0.15) { this.melee = -1; this.setState('recover'); }
    } else if (this.state === 'slash') {
      this.moveToward(b.x, 0, dt);
      this.melee = clamp(this.stateT / 0.35, 0, 1);
      if (this.stateT > kn.telegraph * 0.35 + 0.1 && !this.hitDone) {
        this.hitDone = true;
        if (Math.abs(P.x - b.x) < 1.6 && Math.abs(P.y - b.y) < 1.4) P.takeDamage(13, Math.sign(dx), this);
      }
      if (this.stateT > 0.5) { this.melee = -1; this.hitDone = false; this.setState('recover'); }
    } else if (this.state === 'recover') {
      this.moveToward(b.x, 0, dt);
      if (this.stateT > 0.45) this.setState('retreat');
    } else if (this.state === 'retreat') {
      this.face(dx);
      this.moveToward(b.x - Math.sign(dx) * 4, this.cfg.speed * 0.8, dt);
      if (this.stateT > rand(0.5, 1.1)) this.setState('advance');
    }
  }

  thinkButcher(dt, kn, P, dx, dy, dist) {
    const b = this.body, g = this.game;
    if (this.state === 'advance') {
      this.face(dx);
      this.moveToward(P.x, this.cfg.speed * lerp(0.8, 1.2, kn.aggression), dt);
      if (dist < 2.4 && Math.abs(dy) < 1.5) { this.setState('windup'); audio.sfx('enemy_alert', { vol: 0.6, rate: 0.7, pan: g.pan(b.x) }); }
      else if (dist > 5 && dist < 10 && this.stateT > 2 && Math.random() < 0.01 * kn.aggression) { this.setState('chargeWind'); audio.sfx('enemy_alert', { vol: 0.8, rate: 0.6, pan: g.pan(b.x) }); }
    } else if (this.state === 'windup') {
      this.moveToward(b.x, 0, dt);
      this.windup = clamp(this.stateT / (kn.telegraph * 1.3), 0, 1);
      if (this.stateT > kn.telegraph * 1.3) { this.setState('smash'); this.windup = 0; }
    } else if (this.state === 'smash') {
      this.melee = clamp(this.stateT / 0.3, 0, 1);
      if (this.stateT > 0.12 && !this.hitDone) {
        this.hitDone = true;
        const hx = b.x + this.f * 1.4;
        g.fx.dust(hx, b.y, 10, 0);
        g.fx.debris(hx, b.y, Math.PI / 2, 5, 8);
        g.cam.shake(0.35);
        audio.sfx('explosion', { vol: 0.35, rate: 1.6, pan: g.pan(b.x) });
        if (Math.abs(P.x - hx) < 1.7 && Math.abs(P.y - b.y) < 1.6) P.takeDamage(26, this.f, this, 9);
      }
      if (this.stateT > 0.4) { this.melee = -1; this.hitDone = false; this.setState('recover'); }
    } else if (this.state === 'recover') {
      this.moveToward(b.x, 0, dt);
      if (this.stateT > 0.9) this.setState('advance');
    } else if (this.state === 'chargeWind') {
      this.face(dx);
      this.moveToward(b.x, 0, dt);
      this.windup = 0.5;
      if (this.stateT > kn.telegraph * 1.1) { this.windup = 0; this.setState('charge'); this.chargeDir = this.f; this.hitDone = false; }
    } else if (this.state === 'charge') {
      this.face(this.chargeDir);
      this.body.vx = this.chargeDir * 7.5;
      this.moving = true;
      if (Math.random() < 0.3) g.fx.dust(b.x - this.f * 0.4, b.y, 1, -this.f);
      if (!this.hitDone && Math.abs(P.x - b.x) < 1.2 && Math.abs(P.y - b.y) < 1.6) { this.hitDone = true; P.takeDamage(20, this.f, this, 12); }
      if (this.stateT > 1.2 || b.wallDir) { this.setState('recover'); this.body.vx *= 0.3; }
    }
  }

  pose(dt) {
    const b = this.body;
    const speed = b.vx * this.f;
    const hold = this.cfg.hold;
    this.rig.pose({
      x: b.x, y: b.y, f: this.f, speed: this.rig.missing.size && this.panic ? speed * 1.2 : speed,
      grounded: b.grounded, vy: b.vy, crouch: this.crouch || (this.state === 'stagger' ? 0.3 : 0),
      aim: hold === 'rifle' ? (this.state === 'panic' ? -0.8 : this.aim) : this.f > 0 ? 0 : Math.PI,
      hold: this.rig.weaponVisible ? hold : 'none', melee: this.melee, meleeKind: this.cfg.hold === 'rifle' ? 3 : this.type === 'butcher' ? 0 : (this.state === 'leap' ? 2 : 0),
      recoil: this.recoil, hurt: this.hurt, t: this.t, dt: Math.max(dt, 1e-4), windup: this.windup,
      shield: this.hasShield && this.alive, lean: this.state === 'charge' ? -0.35 : this.state === 'panic' ? 0.2 : 0,
      headTilt: this.state === 'panic' ? 0.5 : 0,
    });
  }

  draw() {
    const rig = this.rig;
    if (this.type === 'grunt') rig.emissive = this.laser > 0 ? this.laser * 0.25 : 0;
    rig.draw();
    const g = this.game;
    if (this.alive) {
      // eyes glow
      const hx = rig.jx(J.head) * 0.6 + rig.jx(J.neck) * 0.4, hy = rig.jy(J.head) * 0.6 + rig.jy(J.neck) * 0.4;
      if (!rig.missing.has('head')) g.lights.add(hx + this.f * 0.08, hy, [1, 0.1, 0.08], 0.5 + this.laser * 1.5, 1.2, 0.3);
      if (this.state === 'aim' && rig.weaponVisible && GUNS[this.gun || 'rifle']?.laser !== false) {
        const m = rig.muzzle();
        const L = 14;
        const a = this.aim;
        const end = g.world.raycast(m[0], m[1], m[0] + Math.cos(a) * L, m[1] + Math.sin(a) * L);
        const len = end ? end.t * L : L;
        const alpha = 0.35 + this.laser * 0.65;
        g.fx.once({ x: m[0] + Math.cos(a) * len / 2, y: m[1] + Math.sin(a) * len / 2, vx: 0, vy: 0, s0: 0.035 + this.laser * 0.03, s1: 0, shape: 1, rot: a, stretch: len / (0.035 + this.laser * 0.03), c: [2.5 * alpha, 0.1, 0.1] });
        g.fx.once({ x: m[0], y: m[1], vx: 0, vy: 0, s0: 0.2 + this.laser * 0.3, s1: 0, shape: 7, c: [3 * this.laser, 0.3, 0.2] });
      }
      if ((this.state === 'crouch' || this.state === 'windup' || this.state === 'chargeWind') && Math.floor(this.stateT * 12) % 2 === 0) {
        g.fx.once({ x: hx, y: hy + 0.5 * this.scale, vx: 0, vy: 0, s0: 0.35, s1: 0, shape: 4, c: [3, 0.6, 0.3], rot: this.t * 3 });
      }
    }
  }
}

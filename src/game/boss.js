// The Hemarch: a giant with a glass blood tank. Two phases, telegraphed attacks, execution finale.
import { Enemy, ENEMY_TYPES } from './enemies.js';
import { J } from './rig.js';
import { audio } from '../core/audio.js';
import { clamp, rand, lerp, pick } from '../core/math.js';

ENEMY_TYPES.boss = { def: 'boss', hp: 3200, blood: 60, w: 1.7, h: 5.0, speed: 1.5, mass: 14, score: 5000, hold: 'cannon' };

export class Boss extends Enemy {
  constructor(game, x, y) {
    super(game, 'boss', x, y, { f: -1, state: 'intro' });
    const s = game.director.skill;
    this.hpMax = this.hp = lerp(2300, 3900, s);
    this.tankHpMax = this.tankHp = lerp(420, 700, s);
    this.tankBroken = false;
    this.phase = 1;
    this.stunned = false;
    this.attackCd = 2.5;
    this.lastAttack = null;
    this.beamAng = 0;
    this.meleeRadius = 1.2;
    this.adds = [];
    this.rig.tankGlow = 0.35;
    this.name = 'THE HEMARCH';
    this.stateT = 0;
    this.orbTimer = 0;
    this.roared = false;
  }

  get executable() { return this.stunned && this.alive; }
  set executable(v) { /* computed */ }

  meleePoints() { return [this.body.x, this.body.y + 2.2]; }

  tankPos() {
    const [x, y] = this.rig.tankAnchor();
    const p = this.def.parts.tank;
    return [x + p.center[0] * this.f * 0.3, y + p.center[1]];
  }

  hitTest(x0, y0, x1, y1, pr) {
    // the tank first: it sticks out behind the back
    if (!this.tankBroken) {
      const [tx, ty] = this.tankPos();
      const r = 0.9;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        if (Math.hypot(x - tx, (y - ty) * 0.6) < r) return { t, seg: 'tank', u: 0.5, x, y };
      }
    }
    return super.hitTest(x0, y0, x1, y1, pr);
  }

  damage(hit) {
    const g = this.game;
    if (!this.alive || this.state === 'intro') return null;
    if (hit.seg === 'tank') {
      this.tankHp -= hit.dmg;
      this.flash = 0.6;
      g.fx.spark(hit.x, hit.y, rand(0, 6.28), 6, 6, [4, 1.2, 1.2]);
      g.bleed(this, () => g.blood.spurt(hit.x, hit.y, Math.atan2(hit.dy, hit.dx) + Math.PI + rand(-0.4, 0.4), 5, 8, 0.6, 0.06));
      audio.sfx('glass_break', { vol: 0.25, rate: 1.6, minGap: 0.08 });
      this.rig.tankGlow = 0.35 + (1 - this.tankHp / this.tankHpMax) * 0.6;
      if (this.tankHp <= 0) this.breakTank();
      return 'hit';
    }
    const dmg = hit.dmg * (this.tankBroken ? 1.15 : 0.8);
    if (!this.stunned) this.hp -= dmg;
    if (this.t - (this.lastFlash || 0) > 0.18) { this.flash = 0.35; this.lastFlash = this.t; }
    this.addWound({ ...hit, bleed: (hit.bleed || 0.05) * 1.5 });
    const vol = Math.min(Math.max(0, this.blood - 2), 0.04 + dmg * 0.003);
    this.blood -= vol;
    g.bleed(this, () => g.blood.spurt(hit.x, hit.y, Math.atan2(hit.dy, hit.dx), 5 + dmg * 0.08, 12, 0.9, vol, 1.3));
    const seg = hit.seg || 'torso';
    this.rig.blood[seg] = Math.min(1, (this.rig.blood[seg] || 0) + 0.05 + dmg / 400);
    audio.sfx('squelch', { vol: 0.5, rate: 0.7, minGap: 0.05 });
    if (this.phase === 1 && this.hp < this.hpMax * 0.55) this.enrage();
    if (this.hp < this.hpMax * 0.1 && !this.stunned) this.stun();
    if (this.hp <= 0) { this.hp = 0; if (!this.stunned) this.stun(); }
    return 'hit';
  }

  breakTank() {
    const g = this.game;
    this.tankBroken = true;
    this.rig.missing.add('tank');
    const [tx, ty] = this.tankPos();
    audio.sfx('glass_break', { vol: 1, rate: 0.7 });
    audio.sfx('explosion', { vol: 0.6, rate: 0.8 });
    g.fx.debris(tx, ty, Math.PI / 2, 8, 30, [0.9, 0.4, 0.4]);
    g.fx.flash(tx, ty, 3, [4, 0.5, 0.4], 0.2);
    g.cam.shake(0.8);
    g.hitstop(0.12);
    this.tankLeak = 22;
    g.hud.announce('TANK BREACHED', 'medium');
    this.enrage();
    this.setState('stagger', 1.4);
  }

  enrage() {
    if (this.phase === 2) return;
    this.phase = 2;
    this.game.hud.announce('HE IS ENRAGED', 'small');
    audio.sfx('enemy_alert', { vol: 1, rate: 0.5 });
    this.attackCd = 1.2;
  }

  stun() {
    this.stunned = true;
    this.setState('stunned');
    this.game.hud.announce('EXECUTE HIM!  [E]', 'medium');
    audio.sfx('enemy_death', { vol: 0.8, rate: 0.5 });
    for (const p of this.game.projectiles.list) if (p.owner === 'enemy') p.dead = true;
  }

  onExecuted(P) {
    const g = this.game;
    const hit = { dmg: 999, x: this.cx, y: this.body.y + 4, dx: P.f, dy: 0.4, seg: 'head', kind: 'execution', dismember: 5, bleed: 2, knock: 3 };
    this.canSever = true;
    this.sever('head', hit);
    this.sever('upperarmF', hit);
    for (const w of this.wounds) if (w.stump) w.rate = 5;
    this.heartRate = 2.4;
    this.alive = false;
    this.state = 'dead';
    this.deadT = 0;
    this.finale = 6;
    g.announce('BLOODBATH!', 'bloodbath', 'big');
    g.slowmo(2.2, 0.35);
    g.cam.shake(1);
    g.onBossDefeated();
    g.hud.bossBar(0);
    g.score.addEvent('execution');
    g.score.points += 50000 * g.score.mult;
  }

  collapse() {
    const g = this.game;
    this.canSever = true;
    this.sever('head', { dmg: 999, x: this.cx, y: this.body.y + 4, dx: -this.f, dy: 0.4, seg: 'head', kind: 'execution', knock: 2 });
    this.alive = false;
    this.state = 'dead';
    this.deadT = 0;
    this.finale = 3;
    g.announce('THE HEMARCH FALLS', null, 'medium');
    g.onBossDefeated();
    g.hud.bossBar(0);
  }

  sever(seg, hit) {
    if (!this.canSever) return;
    super.sever(seg, hit);
  }

  die() { /* only by execution */ }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.rig.flash = this.flash;
    if (!this.alive) {
      this.deadT += dt;
      this.updateWounds(dt);
      if (this.finale > 0) {
        // the whole reservoir comes down
        this.finale -= dt;
        g.bleed(null, () => {
          for (let i = 0; i < 3; i++) g.blood.emit(rand(1, 33), 13, rand(-1, 1), rand(-2, 0), rand(0.04, 0.09), 0.02, 0);
          if (Math.random() < 0.3) g.blood.burst(this.cx + rand(-1, 1), this.body.y + rand(1, 4), 1.5, 0.3, 1.5);
        });
      }
      if (!this.ragdollMade && this.deadT > 0.6) {
        this.ragdollMade = true;
        import('./rig.js').then(({ Ragdoll }) => { this.ragdoll = new Ragdoll(this.rig, -this.f * 2, 1, this.f * 0.4); });
      }
      if (this.ragdoll) this.ragdoll.update(dt, g.world);
      return;
    }
    this.stateT += dt;
    const P = g.player;
    const b = this.body;
    const kn = g.director.knobs;
    const dx = P.x - b.x, dist = Math.abs(dx);
    this.moving = false;
    // tank leak after the breach
    if (this.tankLeak > 0) {
      const v = Math.min(this.tankLeak, dt * 3);
      this.tankLeak -= v;
      const [tx, ty] = this.tankPos();
      g.bleed(this, () => g.blood.spurt(tx, ty - 0.5, -Math.PI / 2 + rand(-0.8, 0.8), rand(1, 4), 5, 0.5, v, 1.6));
    }
    const speedMul = this.phase === 2 ? 1.35 : 1;
    switch (this.state) {
      case 'intro':
        this.face(dx);
        if (!this.roared && this.stateT > 1.2) { this.roared = true; audio.sfx('enemy_alert', { vol: 1, rate: 0.45 }); g.cam.shake(0.9); g.hud.bossBar(1, this.name); }
        if (this.stateT > 3.2) this.setState('walk');
        break;
      case 'walk': {
        this.face(dx);
        const want = dist > 9 ? P.x : dist < 5 ? b.x - Math.sign(dx) * 3 : b.x;
        this.moveToward(want, this.cfg.speed * speedMul, dt);
        this.aim = Math.atan2(P.cy - (b.y + 3.2), dx);
        this.attackCd -= dt;
        if (this.attackCd <= 0) this.chooseAttack(dist, kn);
        break;
      }
      case 'volleyWind':
        this.face(dx);
        this.aim = Math.atan2(P.cy - (b.y + 3.2), dx);
        this.rig.weaponGlow = this.stateT / (kn.telegraph * 1.4);
        if (this.stateT > kn.telegraph * 1.4) { this.rig.weaponGlow = 0; this.setState('volley'); this.shots = this.phase === 2 ? 3 : 2; this.shotT = 0; }
        break;
      case 'volley':
        this.shotT -= dt;
        if (this.shotT <= 0 && this.shots > 0) {
          this.shots--;
          this.shotT = 0.45;
          const m = this.rig.muzzle();
          const n = this.phase === 2 ? 7 : 5;
          const base = Math.atan2(P.cy - m[1], P.x - m[0]);
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.16 + rand(-0.03, 0.03);
            const sp = kn.projectileSpeed * 0.62;
            g.projectiles.add({ kind: 'orb', owner: 'enemy', x: m[0], y: m[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: 14, r: 0.25, life: 4, size: 1 });
          }
          g.fx.muzzle(m[0], m[1], base, 2.5);
          g.cam.shake(0.3);
          audio.sfx('explosion', { vol: 0.4, rate: 1.5 });
        }
        if (this.shots <= 0 && this.shotT <= 0) this.endAttack();
        break;
      case 'stompWind':
        this.windup = clamp(this.stateT / (kn.telegraph * 1.2), 0, 1);
        this.crouch = -0.2;
        if (this.stateT > kn.telegraph * 1.2) { this.windup = 0; this.crouch = 0; this.setState('stomp'); this.stomp(); }
        break;
      case 'stomp':
        if (this.stateT > 0.7) this.endAttack();
        break;
      case 'summon':
        this.windup = 0.6;
        if (this.stateT > 0.8 && !this.summoned) {
          this.summoned = true;
          const n = this.phase === 2 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const x = clamp(P.x + rand(-7, 7), 2, 32);
            setTimeout(() => { if (this.alive) g.spawnEnemy(Math.random() < 0.35 ? 'leaper' : 'grunt', x, 12, { drop: true }); }, i * 350);
          }
          audio.sfx('enemy_alert', { vol: 1, rate: 0.55 });
        }
        if (this.stateT > 1.6) { this.windup = 0; this.summoned = false; this.endAttack(); }
        break;
      case 'beamWind':
        this.face(dx);
        this.beamAng = this.f > 0 ? 0.9 : Math.PI - 0.9;
        this.aim = this.beamAng;
        this.rig.weaponGlow = this.stateT;
        if (this.stateT > kn.telegraph * 2) { this.setState('beam'); this.rig.weaponGlow = 1.5; }
        break;
      case 'beam': {
        const u = this.stateT / 1.8;
        const a = this.f > 0 ? lerp(0.9, -0.55, u) : Math.PI - lerp(0.9, -0.55, u);
        this.aim = a;
        this.beamAng = a;
        this.fireBeam(dt, a);
        if (u >= 1) { this.rig.weaponGlow = 0; this.endAttack(); }
        break;
      }
      case 'leapWind':
        this.crouch = 0.6;
        if (this.stateT > 0.6) {
          this.crouch = 0;
          const tx = P.x > 17 ? 6 : 28;
          b.vx = (tx - b.x) / 1.1;
          b.vy = 16;
          this.setState('leap');
        }
        break;
      case 'leap':
        this.moving = true;
        if (b.grounded && this.stateT > 0.2) { b.vx = 0; this.stomp(); this.setState('stomp'); }
        break;
      case 'stagger':
        if (this.stateT > (this.stateDur || 1)) this.setState('walk');
        break;
      case 'stunned':
        this.crouch = 0.8;
        this.hurt = 0.5 + Math.sin(this.t * 3) * 0.2;
        // nobody executed him: he collapses on his own (no execution bonus)
        if (this.stateT > 14 && !this.executed) { this.executed = true; this.collapse(); }
        break;
    }
    b.vy -= 30 * dt;
    g.world.moveActor(b, dt);
    if (b.grounded && !this.moving) b.vx *= Math.exp(-dt * 8);
    this.updateWounds(dt);
    this.pose(dt);
    g.hud.bossBar(Math.max(0, this.hp / this.hpMax), this.name);
  }

  chooseAttack(dist, kn) {
    const opts = ['volley', 'stomp', 'summon'];
    if (this.phase === 2) opts.push('beam', 'leap', 'beam');
    let pickA = pick(opts.filter((o) => o !== this.lastAttack));
    if (this.game.aliveEnemies() > 3 && pickA === 'summon') pickA = 'volley';
    this.lastAttack = pickA;
    const map = { volley: 'volleyWind', stomp: 'stompWind', summon: 'summon', beam: 'beamWind', leap: 'leapWind' };
    this.setState(map[pickA]);
    if (pickA === 'beam') audio.sfx('enemy_laser_charge', { vol: 0.9, rate: 0.5 });
  }

  endAttack() {
    const kn = this.game.director.knobs;
    this.attackCd = rand(1.4, 2.6) / kn.fireRate * (this.phase === 2 ? 0.7 : 1);
    this.setState('walk');
  }

  stomp() {
    const g = this.game, b = this.body;
    g.cam.shake(0.9);
    g.fx.dust(b.x, b.y, 18);
    g.fx.debris(b.x, b.y, Math.PI / 2, 7, 16);
    g.fx.ring(b.x, b.y + 0.2, 4, [3, 1, 0.5], 0.4);
    audio.sfx('explosion', { vol: 0.8, rate: 0.7 });
    // shockwaves travel along the ground
    for (const dir of [-1, 1]) this.game.shockwaves.push({ x: b.x, y: b.y, dir, speed: 10 + this.phase * 2, life: 2.2, t: 0, hit: false });
    const P = g.player;
    if (P.body.grounded && Math.abs(P.x - b.x) < 2.2) P.takeDamage(22, Math.sign(P.x - b.x), this, 10);
  }

  fireBeam(dt, a) {
    const g = this.game;
    const m = this.rig.muzzle();
    const L = 30;
    const end = g.world.raycast(m[0], m[1], m[0] + Math.cos(a) * L, m[1] + Math.sin(a) * L);
    const len = end ? end.t * L : L;
    const ex = m[0] + Math.cos(a) * len, ey = m[1] + Math.sin(a) * len;
    this.beam = { x0: m[0], y0: m[1], x1: ex, y1: ey, a, len };
    g.lights.add(ex, ey, [1, 0.1, 0.1], 4, 5);
    if (Math.random() < 0.5) g.fx.spark(ex, ey, a + Math.PI, 8, 3, [4, 0.5, 0.4]);
    if (Math.random() < 0.3) { g.blood.livingBonus = false; }
    g.cam.shake(0.05);
    // player hit
    const P = g.player;
    if (P.alive) {
      const px = P.cx, py = P.cy;
      const dx = ex - m[0], dy = ey - m[1];
      const u = clamp(((px - m[0]) * dx + (py - m[1]) * dy) / (dx * dx + dy * dy), 0, 1);
      const d = Math.hypot(px - (m[0] + dx * u), py - (m[1] + dy * u));
      if (d < 0.55) P.takeDamage(18, Math.sign(P.x - this.x), this, 6);
    }
  }

  spawnAdds() {}

  pose(dt) {
    const b = this.body;
    this.rig.pose({
      x: b.x, y: b.y, f: this.f, speed: b.vx * this.f, grounded: b.grounded, vy: b.vy,
      crouch: Math.max(0, this.crouch || 0), aim: this.aim, hold: 'cannon', melee: -1,
      recoil: this.state === 'volley' ? Math.max(0, this.shotT) * 2 : 0, hurt: this.hurt || 0, t: this.t, dt: Math.max(dt, 1e-4),
      lean: this.state === 'summon' ? -0.25 : this.state === 'stompWind' ? 0.15 * this.windup : 0,
      headTilt: this.state === 'summon' ? 0.4 : 0,
    });
  }

  draw() {
    const g = this.game, rig = this.rig;
    rig.emissive = this.phase === 2 ? 0.08 : 0;
    const roaring = ['intro', 'volleyWind', 'summon', 'beamWind', 'beam', 'stompWind', 'leapWind', 'stunned', 'stagger'].includes(this.state) && (this.state !== 'intro' || this.stateT > 1.1);
    rig.headPart = roaring || !this.alive ? 'head_roar' : 'head';
    rig.draw();
    if (!this.alive) return;
    const hx = rig.jx(J.head) * 0.55 + rig.jx(J.neck) * 0.45, hy = rig.jy(J.head) * 0.55 + rig.jy(J.neck) * 0.45;
    g.lights.add(hx + this.f * 0.2, hy, [1, 0.1, 0.08], 1.6, 3.5);
    if (!this.tankBroken) { const [tx, ty] = this.tankPos(); g.lights.add(tx, ty, [1, 0.08, 0.08], 2 + Math.sin(this.t * 3) * 0.4, 5); }
    if (this.state === 'volleyWind' || this.state === 'beamWind') {
      const m = rig.muzzle();
      g.fx.once({ x: m[0], y: m[1], vx: 0, vy: 0, s0: 0.6 + this.stateT * 1.2, s1: 0, shape: 7, c: [3, 0.2, 0.2] });
      g.lights.add(m[0], m[1], [1, 0.1, 0.1], 3 * this.stateT, 5);
    }
    if (this.state === 'beamWind') {
      const m = rig.muzzle(), a = this.beamAng;
      g.fx.once({ x: m[0] + Math.cos(a) * 10, y: m[1] + Math.sin(a) * 10, vx: 0, vy: 0, s0: 0.04, s1: 0, shape: 1, rot: a, stretch: 500, c: [1.5, 0.05, 0.05] });
    }
    if (this.state === 'beam' && this.beam) {
      const B = this.beam;
      const mx = (B.x0 + B.x1) / 2, my = (B.y0 + B.y1) / 2;
      const w = 0.35 + Math.sin(this.t * 50) * 0.05;
      g.fx.once({ x: mx, y: my, vx: 0, vy: 0, s0: w * 2.2, s1: 0, shape: 1, rot: B.a, stretch: B.len / (w * 2.2), c: [3, 0.1, 0.12] });
      g.fx.once({ x: mx, y: my, vx: 0, vy: 0, s0: w * 0.8, s1: 0, shape: 1, rot: B.a, stretch: B.len / (w * 0.8), c: [6, 3, 3] });
    }
    if (this.stunned && Math.floor(this.t * 4) % 2 === 0) g.fx.once({ x: hx, y: hy + 1.2, vx: 0, vy: 0, s0: 0.8, s1: 0, shape: 4, c: [3, 2, 1], rot: this.t });
  }
}

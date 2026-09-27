// The hero: movement (run, double jump, wall jump, dash, slide), shooting, melee, grenades,
// executions, frenzy, and healing by absorbing fresh blood.
import { Rig, Ragdoll, J } from './rig.js';
import { WEAPONS, MELEE } from './weapons.js';
import { audio } from '../core/audio.js';
import { clamp, rand, lerp } from '../core/math.js';

const RUN = 6.8, ACC_G = 70, ACC_A = 38, JUMP = 12.2, DJUMP = 10.8, GRAV = 33, MAXFALL = 19;
const DASH_T = 0.17, DASH_V = 18, DASH_CD = 0.42;

export class Player {
  constructor(game, x, y) {
    this.game = game;
    this.def = game.defs.hero;
    this.rig = new Rig(this.def);
    this.body = { x, y, vx: 0, vy: 0, w: 0.55, h: 1.7, grounded: false };
    this.alive = true;
    this.hpMax = 100;
    this.hp = 100;
    this.weapon = WEAPONS.rifle;
    this.ammo = Infinity;
    this.grenades = 6;
    this.frenzy = 0;
    this.frenzyT = 0;
    this.f = 1;
    this.aim = 0;
    this.t = 0;
    this.cool = 0;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.jumps = 0;
    this.airDash = true;
    this.dashT = 0;
    this.dashCd = 0;
    this.dashDir = 1;
    this.invuln = 0;
    this.slideT = 0;
    this.wallSlide = 0;
    this.wallJumpLock = 0;
    this.meleeT = -1;
    this.meleeIdx = 0;
    this.meleeQueued = false;
    this.meleeHit = new Set();
    this.comboWindow = 0;
    this.throwT = -1;
    this.recoil = 0;
    this.hurt = 0;
    this.flash = 0;
    this.afterimages = [];
    this.lastSafe = { x, y };
    this.execTarget = null;
    this.executing = 0;
    this.stepT = 0;
    this.absorbFx = 0;
    this.crouch = 0;
    this.shotsFired = 0;
    this.rig.pose(this.poseState(1 / 120));
  }

  get x() { return this.body.x; }
  get y() { return this.body.y; }
  get cx() { return this.body.x; }
  get cy() { return this.body.y + (this.slideT > 0 ? 0.45 : 1.0); }
  get frenzyActive() { return this.frenzyT > 0; }

  setWeapon(id) {
    this.weapon = WEAPONS[id];
    this.ammo = this.weapon.ammo;
    this.rig.weaponPart = this.weapon.part;
    if (this.weapon.voice) this.game.announce(this.weapon.name, this.weapon.voice, 'weapon');
  }

  heal(n) {
    if (!this.alive) return;
    this.hp = Math.min(this.hpMax, this.hp + n);
  }

  takeDamage(dmg, dir = 0, source = null, knock = 5, tick = false) {
    const g = this.game;
    if (!this.alive || g.cinematic) return false;
    if (tick) {
      // continuous damage (flames): no i-frames, no knockback, but dashing still avoids it
      if (this.dashT > 0 || this.executing > 0 || (this.invuln > 0 && !this.burning)) return false;
      if (g.godMode) return false;
      this.burning = 0.3;
      dmg *= g.director.knobs.damageMul;
      this.hp -= dmg;
      this.hurt = Math.max(this.hurt, 0.5);
      g.director.onPlayerDamaged(dmg, Math.max(0, this.hp) / this.hpMax);
      if (this.hp <= 0) this.die(dir);
      return true;
    }
    if (this.invuln > 0 || this.dashT > 0 || this.executing > 0) {
      if (this.dashT > 0) { g.director.onDodge(); g.onPerfectDodge(this); }
      return false;
    }
    if (g.godMode) dmg = 0;
    dmg *= g.director.knobs.damageMul;
    this.hp -= dmg;
    this.damageTaken = (this.damageTaken || 0) + dmg;
    this.invuln = 0.55;
    this.hurt = 1;
    this.flash = 1;
    this.body.vx += dir * knock;
    this.body.vy = Math.max(this.body.vy, 4);
    g.director.onPlayerDamaged(dmg, Math.max(0, this.hp) / this.hpMax);
    g.onPlayerHurt(dmg);
    // the hero bleeds too
    g.blood.uncounted(() => g.blood.spurt(this.cx, this.cy + 0.2, Math.atan2(0.4, dir || 1), 4, 14, 1, 0.08));
    audio.sfx('squelch', { vol: 0.7 });
    if (this.hp <= 0) this.die(dir);
    return true;
  }

  die(dir) {
    const g = this.game;
    this.alive = false;
    this.hp = 0;
    this.rig.weaponVisible = false;
    this.ragdoll = new Ragdoll(this.rig, dir * 6, 5, -dir * 3);
    g.blood.uncounted(() => g.blood.burst(this.cx, this.cy, 1, 0.6));
    audio.sfx('gore', { vol: 1 });
    g.onPlayerDeath();
  }

  revive(x, y) {
    this.alive = true;
    this.hp = this.hpMax;
    this.ragdoll = null;
    this.body.x = x; this.body.y = y + 0.5; this.body.vx = 0; this.body.vy = 0;
    this.invuln = 2.5;
    this.rig.weaponVisible = true;
    this.rig.missing.clear();
    this.grenades = Math.max(this.grenades, 4);
    this.frenzy = Math.max(this.frenzy, 0.5);
  }

  // Projectile collision; returns true if the projectile was consumed/redirected.
  hitByProjectile(p, ox, oy, nx, ny) {
    if (!this.alive) return false;
    const b = this.body;
    const h = this.slideT > 0 ? 0.8 : this.crouch > 0.5 ? 1.15 : b.h;
    const x0 = b.x - b.w / 2 - p.r, x1 = b.x + b.w / 2 + p.r, y0 = b.y - p.r, y1 = b.y + h + p.r;
    // melee deflect: bolts inside the swing reach bounce back
    if (this.meleeT >= 0 && p.kind === 'bolt') {
      const d = Math.hypot(nx - this.cx, ny - this.cy);
      if (d < 1.9) { this.game.deflect(p, this); return true; }
    }
    // sample the segment
    for (let i = 0; i <= 4; i++) {
      const t = i / 4, x = ox + (nx - ox) * t, y = oy + (ny - oy) * t;
      if (x > x0 && x < x1 && y > y0 && y < y1) {
        if (p.kind === 'flame') { if (!p.hitPlayer) { p.hitPlayer = true; this.takeDamage(p.dmg, Math.sign(p.vx), p, 0, true); } return false; }
        if (this.takeDamage(p.dmg, Math.sign(p.vx), p, 3)) { p.dead = true; this.game.fx.spark(x, y, Math.atan2(-p.vy, -p.vx), 5, 8, [4, 0.6, 0.4]); }
        else if (this.dashT > 0) return false; // dash through bolts
        else p.dead = true;
        return true;
      }
    }
    return false;
  }

  update(dt, input) {
    const g = this.game;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.invuln = Math.max(0, this.invuln - dt);
    this.burning = Math.max(0, (this.burning || 0) - dt);
    this.recoil = Math.max(0, this.recoil - dt * 8);
    if (!this.alive) {
      if (this.ragdoll) this.ragdoll.update(dt, g.world);
      return;
    }
    const b = this.body;
    if (this.executing > 0) { this.updateExecution(dt); this.pose(dt); return; }
    if (g.cinematic) { b.vx *= Math.exp(-dt * 10); b.vy -= GRAV * dt; g.world.moveActor(b, dt); this.pose(dt); return; }

    // ---- aim
    const sh = [this.rig.jx(J.shoulder), this.rig.jy(J.shoulder)];
    const padAim = input.padAim();
    if (padAim && input.lastAimSource === 'pad') this.aim = Math.atan2(padAim.y, padAim.x);
    else if (input.lastAimSource === 'keys' || (input.usingPad && !padAim)) {
      const up = input.held('up'), down = input.held('down') && !b.grounded;
      const mx = input.moveX();
      if (up) this.aim = mx ? (mx > 0 ? 0.785 : Math.PI - 0.785) : Math.PI / 2;
      else if (down) this.aim = -Math.PI / 2;
      else this.aim = (mx !== 0 ? mx > 0 : this.f > 0) ? 0 : Math.PI;
    } else {
      const w = g.screenToWorld(input.mouse.x, input.mouse.y);
      this.aim = Math.atan2(w.y - sh[1], w.x - sh[0]);
      this.mouseWorld = w;
    }
    const ax = Math.cos(this.aim);

    // ---- movement input
    const mx = input.moveX();
    this.dashCd -= dt;
    this.coyote -= dt;
    this.jumpBuf -= dt;
    this.wallJumpLock -= dt;
    this.comboWindow -= dt;
    if (input.hit('jump')) this.jumpBuf = 0.13;
    const down = input.held('down');

    if (b.grounded) {
      this.coyote = 0.1; this.jumps = 0; this.airDash = true;
      // remember a respawn point only where there is solid footing on both sides
      if (g.world.groundBelow(b.x - 0.6, b.y + 0.1) >= b.y - 0.05 && g.world.groundBelow(b.x + 0.6, b.y + 0.1) >= b.y - 0.05) this.lastSafe = { x: b.x, y: b.y };
    }

    // dash
    if (input.hit('dash') && this.dashCd <= 0 && (b.grounded || this.airDash)) {
      this.dashT = DASH_T;
      this.dashCd = DASH_CD;
      this.dashDir = mx !== 0 ? Math.sign(mx) : this.f;
      if (!b.grounded) this.airDash = false;
      this.slideT = 0;
      audio.sfx('dash', { vol: 0.6 });
      g.fx.dust(b.x, b.y, 4, -this.dashDir * 2);
      g.cam.kick(-this.dashDir * 0.05, 0);
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      b.vx = this.dashDir * DASH_V;
      b.vy = Math.max(b.vy, 0) * 0.2;
      this.f = this.dashDir;
      if (Math.floor(this.t * 60) % 2 === 0) this.afterimages.push({ j: new Float32Array(this.rig.j), f: this.rig.f, wa: this.rig.weaponAng, g: this.rig.gripPos.slice(), t: 0.22, part: this.rig.weaponPart });
      if (this.dashT <= 0) b.vx = this.dashDir * RUN;
    } else {
      // slide
      if (down && b.grounded && Math.abs(b.vx) > RUN * 0.6 && this.slideT <= 0 && input.hit('down')) {
        this.slideT = 0.5; this.slideDir = Math.sign(b.vx);
        audio.sfx('slide', { vol: 0.6 });
      }
      if (this.slideT > 0) {
        this.slideT -= dt;
        b.vx = this.slideDir * lerp(RUN * 0.9, 11, this.slideT / 0.5);
        if (Math.random() < 0.5) g.fx.dust(b.x - this.slideDir * 0.3, b.y, 1, -this.slideDir);
        if (!b.grounded) this.slideT = 0;
      } else {
        const target = mx * RUN * (this.crouch > 0.5 ? 0.35 : 1) * (this.meleeT >= 0 && b.grounded ? 0.35 : 1);
        const acc = b.grounded ? ACC_G : ACC_A;
        if (this.wallJumpLock <= 0) b.vx += clamp(target - b.vx, -acc * dt, acc * dt);
      }
      // crouch
      this.crouch = b.grounded && down && Math.abs(mx) < 0.3 && this.slideT <= 0 ? 1 : 0;
      // wall slide
      this.wallSlide = 0;
      if (!b.grounded && b.wallDir && Math.sign(mx) === b.wallDir && b.vy < 0) {
        this.wallSlide = b.wallDir;
        b.vy = Math.max(b.vy, -2.4);
        if (Math.random() < 0.3) g.fx.dust(b.x + b.wallDir * 0.3, b.y + 1.2, 1, 0);
      }
      // jumps
      if (this.jumpBuf > 0) {
        if (down && b.onPlatform && b.grounded) {
          b.dropThrough = true; b.y -= 0.06; b.grounded = false; this.jumpBuf = 0;
          setTimeout(() => (b.dropThrough = false), 220);
        } else if (b.grounded || this.coyote > 0) {
          b.vy = JUMP; this.jumpBuf = 0; this.coyote = 0; this.jumps = 1;
          this.slideT = 0;
          audio.sfx('jump', { vol: 0.5 });
          g.fx.dust(b.x, b.y, 4);
        } else if (b.wallDir && !b.grounded) {
          b.vy = JUMP * 0.95; b.vx = -b.wallDir * 8.5; this.wallJumpLock = 0.16; this.jumpBuf = 0; this.jumps = 1; this.airDash = true;
          this.f = -b.wallDir;
          audio.sfx('jump', { vol: 0.5, rate: 1.1 });
          g.fx.dust(b.x + b.wallDir * 0.3, b.y + 1, 5, -b.wallDir);
        } else if (this.jumps < 2) {
          b.vy = DJUMP; this.jumps = 2; this.jumpBuf = 0;
          audio.sfx('double_jump', { vol: 0.5 });
          g.fx.ring(b.x, b.y + 0.1, 1.2, [2, 1.2, 1], 0.3);
        }
      }
      if (!input.held('jump') && b.vy > 3 && this.jumps === 1) b.vy -= GRAV * 1.6 * dt; // variable height
    }
    // gravity
    const grav = b.vy < 0 ? GRAV * 1.25 : GRAV;
    if (this.dashT <= 0) b.vy -= grav * dt;
    b.vy = Math.max(b.vy, -MAXFALL);
    const wasGrounded = b.grounded;
    const fallV = b.vy;
    b.clampX = g.arenaClamp;
    g.world.moveActor(b, dt);
    if (b.grounded && !wasGrounded) {
      audio.sfx('land', { vol: clamp(-fallV / 20, 0.15, 0.7) });
      if (fallV < -10) { g.fx.dust(b.x, b.y, 8); g.cam.shake(0.08); }
      this.landT = 0.12;
    }
    // falling below the ground line means a pit: respawn quickly instead of plummeting off-screen
    if (b.fellOut || b.y < -2.2) this.fallOut();
    this.landT = Math.max(0, (this.landT || 0) - dt);
    // pits of blood
    if (g.level.pits) for (const pit of g.level.pits) if (b.x > pit.x0 && b.x < pit.x1 && b.y < pit.y + 0.3) this.fallOut(pit.blood);

    // facing
    if (this.dashT <= 0 && this.slideT <= 0 && this.wallSlide === 0) {
      if (Math.abs(ax) > 0.06) this.f = ax > 0 ? 1 : -1;
    }
    if (this.wallSlide) this.f = -this.wallSlide;

    // footsteps
    if (b.grounded && Math.abs(b.vx) > 1) {
      this.stepT -= dt * Math.abs(b.vx) / RUN;
      if (this.stepT <= 0) { this.stepT = 0.28; audio.sfx('footstep', { vol: 0.25 + (g.blood.poolDepthAt(b.x, b.y) > 0.05 ? 0.3 : 0) }); if (g.blood.poolDepthAt(b.x, b.y) > 0.05) { audio.sfx('splat', { vol: 0.25, rate: 1.4 }); g.blood.livingBonus = false; for (let i = 0; i < 3; i++) g.blood.emit(b.x, b.y + 0.05, rand(-1.5, 1.5), rand(1, 2.5), 0.02, 0, 1, true); } }
    }

    // ---- actions
    this.frenzyT = Math.max(0, this.frenzyT - dt);
    if (input.hit('frenzy') && this.frenzy >= 1 && !this.frenzyActive) g.startFrenzy();
    if (input.hit('execute') || (input.hit('melee') && g.executableNear(this))) {
      const tgt = g.executableNear(this);
      if (tgt) { this.startExecution(tgt); this.pose(dt); return; }
    }
    // melee
    if (input.hit('melee')) {
      if (this.meleeT < 0) this.startMelee(this.comboWindow > 0 ? (this.meleeIdx + 1) % 3 : 0);
      else this.meleeQueued = true;
    }
    if (this.meleeT >= 0) {
      const M = MELEE[this.meleeIdx];
      this.meleeT += dt / M.dur;
      if (this.meleeT > 0.15 && this.meleeT < 0.7) g.meleeSweep(this, M);
      if (this.meleeT >= 1) {
        this.meleeT = -1;
        this.comboWindow = 0.32;
        this.rig.weaponPart = this.weapon.part;
        this.rig.backItem = null;
        if (this.meleeQueued) { this.meleeQueued = false; this.startMelee((this.meleeIdx + 1) % 3); }
      }
    }
    // grenade
    if (input.hit('grenade') && this.grenades > 0 && this.throwT < 0) {
      this.grenades--;
      this.throwT = 0;
      const a = this.aim;
      const sp = 11;
      g.projectiles.add({ kind: 'grenade', owner: 'player', x: this.cx + Math.cos(a) * 0.3, y: this.cy + 0.4, vx: Math.cos(a) * sp + b.vx * 0.3, vy: Math.sin(a) * sp + 4, grav: 22, r: 0.08, life: 1.6, dmg: 0 });
      audio.sfx('grenade_throw', { vol: 0.6 });
    }
    if (this.throwT >= 0) { this.throwT += dt * 3.5; if (this.throwT > 1) this.throwT = -1; }
    // fire
    this.cool -= dt;
    if (input.held('fire') && this.meleeT < 0 && this.cool <= 0) this.fire();

    // blood absorption heals
    if (b.grounded && this.hp < this.hpMax) {
      const got = g.blood.absorb(b.x, b.y, 0.45, 0.06 * dt);
      if (got > 0) {
        this.heal(got * 12);
        this.absorbFx += got * 60;
      }
    }
    this.absorbFx = Math.min(3, this.absorbFx);
    if (this.absorbFx > 0.05) {
      this.absorbFx -= dt * 2;
      if (Math.random() < 0.5) g.fx.glow(b.x + rand(-0.4, 0.4), b.y + 0.05, 0.12, [2.5, 0.1, 0.1], 0.5, 0, rand(1.5, 2.5));
    }
    this.pose(dt);
    for (const a of this.afterimages) a.t -= dt;
    this.afterimages = this.afterimages.filter((a) => a.t > 0);
  }

  fallOut(inBlood) {
    const g = this.game;
    if (inBlood) { for (let i = 0; i < 30; i++) g.blood.emit(this.body.x + rand(-0.3, 0.3), this.body.y + 0.1, rand(-3, 3), rand(3, 8), rand(0.02, 0.05), 0, 0, true); audio.sfx('splat', { vol: 1 }); }
    const s = this.lastSafe;
    this.body.x = s.x; this.body.y = s.y + 0.1; this.body.vx = 0; this.body.vy = 0;
    this.body.fellOut = false;
    this.invuln = 0;
    this.takeDamage(15, 0, null, 0);
    this.invuln = 1.2;
  }

  startMelee(idx) {
    this.meleeIdx = idx;
    this.meleeT = 0;
    this.meleeHit.clear();
    this.rig.weaponPart = 'machete';
    this.rig.backItem = { part: this.weapon.part, ang: this.f > 0 ? -1.25 : Math.PI + 1.25 };
    audio.sfx('slash', { vol: 0.7 });
    const b = this.body;
    if (b.grounded) b.vx += this.f * 3; else b.vy = Math.max(b.vy, 2);
  }

  fire() {
    const g = this.game, W = this.weapon, b = this.body;
    this.cool = 1 / W.rate;
    const m = this.rig.muzzle();
    const frz = this.frenzyActive ? 2 : 1;
    for (let i = 0; i < W.pellets; i++) {
      const a = this.aim + rand(-W.spread, W.spread) * (W.pellets > 1 ? 1 : (b.grounded ? 1 : 1.4));
      const sp = W.speed * (W.pellets > 1 ? rand(0.85, 1.1) : 1);
      if (W.disc) g.projectiles.add({ kind: 'disc', owner: 'player', x: m[0], y: m[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: W.dmg * frz, r: 0.15, life: W.life, bounces: W.bounces, pierce: true, weapon: W });
      else g.projectiles.add({ kind: 'bullet', owner: 'player', x: m[0], y: m[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: W.dmg * frz, r: 0.05, life: W.life, weapon: W, pellet: W.pellets > 1, color: W.tracer, big: W.id === 'hmg' });
    }
    this.shotsFired++;
    g.director.onShot(false);
    this.recoil = 1;
    g.fx.muzzle(m[0], m[1], this.aim, W.id === 'shotgun' ? 1.5 : W.id === 'hmg' ? 1.2 : 1);
    g.lights.add(m[0], m[1], [1, 0.75, 0.4], W.id === 'shotgun' ? 5 : 3.2, 6);
    if (W.shell) g.fx.shell(m[0] - Math.cos(this.aim) * 0.4, m[1] + 0.05, this.f);
    g.cam.kick(-Math.cos(this.aim) * W.shake * 0.5, -Math.sin(this.aim) * W.shake * 0.5);
    g.cam.shake(W.shake * 0.6);
    audio.sfx(W.sfx, { vol: W.id === 'rifle' ? 0.45 : 0.6, minGap: 0.02, detune: 80 });
    if (W.id === 'shotgun') b.vx -= Math.cos(this.aim) * (b.grounded ? 2 : 5);
    if (this.ammo !== Infinity) {
      this.ammo--;
      if (this.ammo <= 0) { this.weapon = WEAPONS.rifle; this.ammo = Infinity; this.rig.weaponPart = 'weapon'; g.hud.flashWeapon(); }
    }
  }

  startExecution(target) {
    const g = this.game;
    this.executing = 1;
    this.execTarget = target;
    this.execT = 0;
    this.execDone = false;
    this.meleeIdx = 2;
    this.meleeT = 0;
    this.rig.weaponPart = 'machete';
    this.rig.backItem = { part: this.weapon.part, ang: this.f > 0 ? -1.25 : Math.PI + 1.25 };
    this.f = target.x > this.x ? 1 : -1;
    g.beginExecution(this, target);
  }

  updateExecution(dt) {
    const g = this.game, b = this.body, tgt = this.execTarget;
    this.execT += dt;
    const dur = 0.75;
    // lunge to the target
    const side = tgt.x > b.x ? 1 : -1;
    const tx = tgt.x - side * 0.9;
    b.vx = (tx - b.x) * 12;
    b.vy -= GRAV * dt;
    g.world.moveActor(b, dt);
    this.meleeT = clamp(this.execT / dur, 0, 0.99);
    this.meleeIdx = this.execT < dur * 0.5 ? 0 : 2;
    if (!this.execDone && this.execT > dur * 0.45) {
      this.execDone = true;
      g.finishExecution(this, tgt);
    }
    if (this.execT > dur) {
      this.executing = 0;
      this.meleeT = -1;
      this.rig.weaponPart = this.weapon.part;
      this.rig.backItem = null;
      this.invuln = 0.6;
    }
  }

  poseState(dt) {
    const b = this.body;
    const M = MELEE[this.meleeIdx];
    return {
      x: b.x, y: b.y, f: this.f, speed: b.vx * this.f, grounded: b.grounded || this.slideT > 0, vy: b.vy,
      crouch: this.crouch ? 1 : (this.landT > 0 ? 0.35 : 0), aim: this.aim, hold: 'rifle',
      melee: this.meleeT, meleeKind: M.kind, meleeUp: this.meleeT >= 0 && Math.sin(this.aim) > 0.6 && this.meleeIdx !== 2,
      slide: this.slideT > 0, dash: this.dashT > 0, wall: this.wallSlide !== 0, recoil: this.recoil, hurt: this.hurt,
      t: this.t, dt: Math.max(dt, 1e-4), throwT: this.throwT,
    };
  }

  pose(dt) { this.rig.pose(this.poseState(dt)); }

  draw(batch) {
    const rig = this.rig;
    // afterimages
    for (const a of this.afterimages) {
      const saveJ = rig.j, saveF = rig.f, saveW = rig.weaponAng, saveG = rig.gripPos, saveP = rig.weaponPart;
      rig.j = a.j; rig.f = a.f; rig.weaponAng = a.wa; rig.gripPos = a.g; rig.weaponPart = a.part;
      rig.tint = [2.2, 0.5, 0.4]; rig.alpha = a.t / 0.22 * 0.45; rig.emissive = 0.8;
      rig.draw(batch);
      rig.j = saveJ; rig.f = saveF; rig.weaponAng = saveW; rig.gripPos = saveG; rig.weaponPart = saveP;
    }
    // facial expression: hurt > shout (melee, execution, frenzy, heavy fire) > blink > neutral
    this.blinkT = (this.blinkT ?? 2) - 1 / 60;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    const shouting = this.meleeT >= 0 || this.executing > 0 || (this.frenzyActive && Math.sin(this.t * 3) > 0.3) || (this.recoil > 0.5 && this.weapon.id !== 'rifle') || (this.shoutT = Math.max(0, (this.shoutT || 0) - 1 / 60)) > 0;
    rig.headPart = !this.alive ? 'head_hurt' : this.hurt > 0.25 ? 'head_hurt' : shouting ? 'head_shout' : this.blinkT < 0 ? 'head_blink' : 'head';
    rig.tint = this.frenzyActive ? [1.25, 0.85, 0.85] : null;
    rig.emissive = this.frenzyActive ? 0.25 + Math.sin(this.t * 20) * 0.1 : 0;
    // i-frames: a quick shimmer, never a see-through ghost; hurt reads as a red pulse, not a white flash
    rig.alpha = this.invuln > 0 && this.alive && Math.floor(this.t * 16) % 2 === 0 ? 0.72 : 1;
    rig.flash = 0;
    if (this.flash > 0) rig.tint = [1 + this.flash * 0.9, 1 - this.flash * 0.55, 1 - this.flash * 0.55];
    rig.draw(batch);
  }
}

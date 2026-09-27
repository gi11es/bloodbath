// Autoplay bot for automated testing (?bot=1). Implements the subset of the Input API the game uses.
export class Bot {
  constructor(app) {
    this.app = app;
    this.h = new Set();
    this.p = new Set();
    this.aimVec = { x: 1, y: 0 };
    this.mouse = { x: 0, y: 0 };
    this.lastAimSource = 'pad';
    this.usingPad = true;
    this.padDown = new Set(); this.padPrev = new Set(); this.pressed = new Set();
    this.t = 0;
    this.stuck = 0;
    this.lastX = 0;
    this.mx = 1;
  }
  held(a) { return this.h.has(a); }
  hit(a) { return this.p.has(a); }
  moveX() { return this.mx; }
  padAim() { return this.aimVec; }
  endStep() { this.p.clear(); }
  press(a) { this.p.add(a); }
  think(dt) {
    const g = this.app.game;
    this.t += dt;
    this.h.clear();
    if (!g || g.state === 'loading') return;
    const P = g.player;
    if (g.state === 'dead') { if (Math.random() < 0.05) this.press('confirm'); return; }
    if (!P.alive) return;
    const cands = g.boss && g.boss.alive ? [...g.enemies.filter((e) => e.alive), g.boss] : g.enemies.filter((e) => e.alive);
    let tgt = null, bd = g.arena ? 40 : 16;
    for (const e of cands) { const d = Math.hypot(e.cx - P.cx, e.cy - P.cy); if (d < bd) { bd = d; tgt = e; } }
    // aim
    if (tgt) {
      const tx = tgt === g.boss && !g.boss.tankBroken && Math.random() < 0.5 ? g.boss.tankPos() : [tgt.cx, tgt.cy + (tgt.body ? tgt.body.h * 0.1 : 0)];
      this.aimVec = { x: tx[0] - P.cx, y: tx[1] - (P.cy + 0.3) };
      const l = Math.hypot(this.aimVec.x, this.aimVec.y) || 1;
      this.aimVec.x /= l; this.aimVec.y /= l;
      this.h.add('fire');
    } else this.aimVec = { x: 1, y: 0 };
    // move
    let mx = 1;
    if (g.arena) {
      if (tgt) {
        const dx = tgt.x - P.x;
        const want = tgt.type === 'butcher' || tgt === g.boss ? 6 : 4;
        mx = Math.abs(dx) > want + 1 ? Math.sign(dx) : Math.abs(dx) < want - 1 ? -Math.sign(dx) : 0;
        if (Math.random() < 0.01) mx = -mx;
      } else mx = 0;
    } else if (tgt && Math.abs(tgt.x - P.x) < 3) mx = 0;
    const ex = g.executableNear(P) || (g.boss && g.boss.executable ? g.boss : null) || cands.find((e) => e.executable);
    if (ex) { mx = Math.abs(ex.x - P.x) > 1.2 ? Math.sign(ex.x - P.x) : 0; if (Math.abs(ex.x - P.x) < 3.2) this.press('execute'); }
    this.mx = mx;
    // stuck -> jump
    if (Math.abs(P.x - this.lastX) < 0.01 && mx !== 0) this.stuck += dt; else this.stuck = 0;
    this.lastX = P.x;
    if (this.stuck > 0.15 && Math.random() < 0.2) { this.press('jump'); this.h.add('jump'); }
    if (P.body.wallDir && !P.body.grounded) { this.mx = P.body.wallDir; if (Math.random() < 0.1) { this.press('jump'); } }
    if (Math.random() < 0.004) this.press('jump');
    // jump over gaps
    if (P.body.grounded && this.mx !== 0) {
      const ahead = P.x + this.mx * 0.7;
      const gy = g.world.groundBelow(ahead, P.y + 0.1);
      if (gy < P.y - 1.2) { this.press('jump'); this.jumpHold = 0.35; }
    }
    if (this.jumpHold > 0) { this.jumpHold -= dt; if (!P.body.grounded && P.body.vy < 1 && P.jumps < 2) this.press('jump'); }
    this.h.add('jump');
    // threats
    // human-like defence: notices a threat only some of the time, with ~250 ms reaction
    this.react = (this.react || 0) - dt;
    for (const pr of g.projectiles.list) {
      if (pr.owner !== 'enemy' || pr.seen) continue;
      const d = Math.hypot(pr.x - P.cx, pr.y - P.cy);
      if (d < 4 && Math.sign(P.cx - pr.x) === Math.sign(pr.vx)) {
        pr.seen = true;
        if (Math.random() < (this.skill ?? 0.45) && this.react <= 0) { this.react = 0.6; this.pending = { t: 0.25, a: Math.random() < 0.6 ? 'dash' : 'melee' }; }
      }
    }
    if (this.pending && (this.pending.t -= dt) <= 0) { this.press(this.pending.a); this.pending = null; }
    if (tgt && bd < 1.8 && Math.random() < 0.08) this.press('melee');
    if (g.executableNear(P) && Math.random() < 0.2) this.press('execute');
    if (P.frenzy >= 1) this.press('frenzy');
    if (tgt && cands.length >= 3 && Math.random() < 0.01) this.press('grenade');
  }
}

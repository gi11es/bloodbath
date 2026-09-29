// Cutout skeletal characters: 16-joint skeleton (separate hands and feet), procedural humanoid pose
// with foot planting, grip-aligned hands and a spring-driven head, drawing, ragdolls and gibs.
import { ik2, clamp, lerp, easeInOutCubic } from '../core/math.js';
import { loadJSON, loadTexture } from '../core/assets.js';
import { makeSpriteMaterial, SpriteBatch } from '../render/sprites.js';
import { makeProjectedShadowMaterial } from '../render/shadows.js';

// Joint indices of the world-space skeleton.
export const J = {
  hip: 0, neck: 1, head: 2, shoulder: 3,
  elbowB: 4, wristB: 5, gripB: 6, elbowF: 7, wristF: 8, gripF: 9,
  kneeB: 10, ankleB: 11, toeB: 12, kneeF: 13, ankleF: 14, toeF: 15,
};
export const NJ = 16;

// Bone segments. a -> b joints, sprite part, side (0 back / 1 front), child segment, p = joint used to aim a stump spurt.
export const SEGMENTS = {
  head: { a: J.neck, b: J.head, part: 'head', p: J.hip },
  upperarmB: { a: J.shoulder, b: J.elbowB, part: 'upperarm', side: 0, child: 'forearmB', p: J.hip },
  forearmB: { a: J.elbowB, b: J.wristB, part: 'forearm', side: 0, child: 'handB', p: J.shoulder },
  handB: { a: J.wristB, b: J.gripB, part: 'hand', side: 0, p: J.elbowB },
  upperarmF: { a: J.shoulder, b: J.elbowF, part: 'upperarm', side: 1, child: 'forearmF', p: J.hip },
  forearmF: { a: J.elbowF, b: J.wristF, part: 'forearm', side: 1, child: 'handF', p: J.shoulder },
  handF: { a: J.wristF, b: J.gripF, part: 'hand', side: 1, p: J.elbowF },
  thighB: { a: J.hip, b: J.kneeB, part: 'thigh', side: 0, child: 'shinB', p: J.neck },
  shinB: { a: J.kneeB, b: J.ankleB, part: 'shin', side: 0, child: 'footB', p: J.hip },
  footB: { a: J.ankleB, b: J.toeB, part: 'foot', side: 0, p: J.kneeB },
  thighF: { a: J.hip, b: J.kneeF, part: 'thigh', side: 1, child: 'shinF', p: J.neck },
  shinF: { a: J.kneeF, b: J.ankleF, part: 'shin', side: 1, child: 'footF', p: J.hip },
  footF: { a: J.ankleF, b: J.toeF, part: 'foot', side: 1, p: J.kneeF },
};
export const SEG_NAMES = Object.keys(SEGMENTS);
// a segment and everything attached below it (for dismemberment)
export function segChain(name) {
  const out = [name];
  let s = SEGMENTS[name];
  while (s && s.child) { out.push(s.child); s = SEGMENTS[s.child]; }
  return out;
}

const BACK_TINT = [0.7, 0.68, 0.72, 1];
const FRONT_TINT = [1, 1, 1, 1];

export class CharacterDef {
  static async load(name, capacity = 256) {
    const json = await loadJSON(`assets/chars/${name}.json`);
    const [map, nmap] = await Promise.all([loadTexture(json.atlas), loadTexture(json.normal, { srgb: false })]);
    const def = new CharacterDef();
    def.name = name;
    def.json = json;
    def.parts = json.parts;
    def.material = makeSpriteMaterial(map, nmap);
    def.shadowMaterial = makeProjectedShadowMaterial(map);
    def.batch = new SpriteBatch(def.material, capacity, def.shadowMaterial);
    const p = def.parts;
    const L = (v) => Math.hypot(v[0], v[1]);
    def.thighLen = L(p.thigh.end);
    def.shinLen = L(p.shin.end);
    def.ankleH = -p.foot.sole[1];
    def.footLen = L(p.foot.end);
    def.upperLen = L(p.upperarm.end);
    def.foreLen = L(p.forearm.end);
    def.handLen = L(p.hand.end);
    def.hipH = (def.thighLen + def.shinLen) * 0.94 + def.ankleH;
    def.rest = {};
    for (const k of ['thigh', 'shin', 'foot', 'upperarm', 'forearm', 'hand']) def.rest[k] = Math.atan2(p[k].end[1], p[k].end[0]);
    def.rest.torso = Math.atan2(p.torso.neck[1], p.torso.neck[0]);
    def.rest.head = Math.atan2(p.head.top[1], p.head.top[0]);
    def.torsoLen = L(p.torso.neck);
    def.headLen = L(p.head.top);
    def.height = json.height;
    def.k = json.height / 1.8;
    return def;
  }
}

// Draw one part so that its bone (pivot -> end) points along angle `ang` from joint (px, py).
// mirror = true reflects the sprite across its own bone (turns a right hand into a left hand).
export function drawPart(batch, part, px, py, ang, restAng, f, tint, blood, flash, seed, emissive = 0, mirror = false, fade = 0) {
  if (mirror) {
    // reflect across the bone: equivalent to flipping the sprite's local y about the pivot->end line
    const ra = f > 0 ? restAng : Math.PI - restAng;
    const r = ang + ra; // rotation that maps the mirrored rest bone onto ang
    const c = Math.cos(r), s = Math.sin(r);
    const cx = part.center[0] * f, cy = -part.center[1];
    batch.add(px + cx * c - cy * s, py + cx * s + cy * c, r, part.size[0] * f, -part.size[1], part.uv, tint, blood, flash, seed, emissive, fade);
    return;
  }
  const ra = f > 0 ? restAng : Math.PI - restAng;
  const r = ang - ra;
  const c = Math.cos(r), s = Math.sin(r);
  const cx = part.center[0] * f, cy = part.center[1];
  batch.add(px + cx * c - cy * s, py + cx * s + cy * c, r, part.size[0] * f, part.size[1], part.uv, tint, blood, flash, seed, emissive, fade);
}

export function partPoint(part, key, px, py, ang, restAng, f) {
  const ra = f > 0 ? restAng : Math.PI - restAng;
  const r = ang - ra;
  const c = Math.cos(r), s = Math.sin(r);
  const v = part[key];
  const x = v[0] * f, y = v[1];
  return [px + x * c - y * s, py + x * s + y * c];
}

export class Rig {
  constructor(def) {
    this.def = def;
    this.j = new Float32Array(NJ * 2);
    this.f = 1;
    this.phase = 0;
    this.torsoAng = Math.PI / 2;
    this.weaponAng = 0;
    this.weaponPart = 'weapon';
    this.weaponVisible = true;
    this.headPart = 'head';
    this.backItem = null;
    this.missing = new Set();
    this.blood = {};
    for (const k of [...SEG_NAMES, 'torso']) this.blood[k] = 0;
    this.flash = 0;
    this.seed = Math.random();
    this.tint = null;
    this.emissive = 0;
    this.alpha = 1;
    this.gripPos = [0, 0];
    this.s = { hipY: def.hipH, lean: 0, aim: 0, crouch: 0, recoil: 0, feet: [[0, 0], [0, 0]], footAng: [0, 0], head: 0, headV: 0, look: 0, lookT: 0 };
  }
  jx(i) { return this.j[i * 2]; }
  jy(i) { return this.j[i * 2 + 1]; }
  setJ(i, x, y) { this.j[i * 2] = x; this.j[i * 2 + 1] = y; }

  muzzle() {
    const p = this.def.parts[this.heldPart || this.weaponPart] || this.def.parts.weapon;
    const key = p.muzzle ? 'muzzle' : 'center';
    return partPoint(p, key, this.gripPos[0], this.gripPos[1], this.weaponAng, 0, this.f);
  }

  // ------------------------------------------------------------------ drawing
  draw(batch = this.def.batch) {
    batch.setShadow?.(this.shadowGround ?? 0, this.shadowAlpha ?? 0, this.shadowX0 ?? 0, this.shadowX1 ?? 0);
    const d = this.def, P = d.parts, f = this.f, j = this.j;
    const fl = this.flash, sd = this.seed, em = this.emissive;
    const baseTint = this.tint || FRONT_TINT;
    const alpha = this.alpha;
    const ft = [baseTint[0], baseTint[1], baseTint[2], alpha];
    const bt = [BACK_TINT[0] * baseTint[0], BACK_TINT[1] * baseTint[1], BACK_TINT[2] * baseTint[2], alpha];
    const ht = bt; // the far hand shares the far arm's shade so it reads as the same limb
    const seg = (name, tint, mirror = false, fade = 0) => {
      if (this.missing.has(name)) return;
      const S = SEGMENTS[name];
      const ax = j[S.a * 2], ay = j[S.a * 2 + 1], bx = j[S.b * 2], by = j[S.b * 2 + 1];
      const ang = Math.atan2(by - ay, bx - ax);
      const part = name === 'head' ? (P[this.headPart] || P.head) : P[S.part];
      drawPart(batch, part, ax, ay, ang, d.rest[S.part], f, tint, this.blood[name], fl, sd + S.a * 0.37, em, mirror, fade);
    };
    // the far forearm reaching forward crosses in front of the chest; its elbow end fades into the body
    const farReach = (j[J.wristB * 2] - j[J.shoulder * 2]) * f > 0.12 * d.k;
    if (P.tank && !this.missing.has('tank')) {
      const [tx, ty] = this.tankAnchor();
      drawPart(batch, P.tank, tx, ty, this.torsoAng, Math.PI / 2, f, ft, this.blood.tank || 0, fl, sd, this.tankGlow || 0.25);
    }
    // a stowed weapon is slung across the back while the machete is out
    if (this.backItem) {
      const sx = j[J.shoulder * 2] - 0.12 * d.k * f, sy = j[J.shoulder * 2 + 1] - 0.22 * d.k;
      const ta = Math.atan2(j[J.neck * 2 + 1] - j[1], j[J.neck * 2] - j[0]);
      drawPart(batch, P[this.backItem.part], sx, sy, ta + (f > 0 ? -0.55 : 0.55) + Math.PI, 0, f, bt, 0, fl, sd, 0);
    }
    seg('upperarmB', bt);
    if (!farReach) seg('forearmB', bt);
    seg('thighB', bt);
    seg('shinB', bt);
    seg('footB', bt);
    seg('thighF', ft); // tucked under the torso: the belt covers the hip joint
    seg('head', ft);   // tucked under the collar
    const hx = j[0], hy = j[1];
    const tang = Math.atan2(j[J.neck * 2 + 1] - hy, j[J.neck * 2] - hx);
    drawPart(batch, P.torso, hx, hy, tang, d.rest.torso, f, ft, this.blood.torso, fl, sd, em);
    seg('shinF', ft);
    seg('footF', ft);
    if (farReach) seg('forearmB', bt, false, 0.3);
    const held = this.heldPart && this.weaponVisible && !this.missing.has('handF') && !this.missing.has('handB') && !this.missing.has('forearmB');
    if (held) {
      drawPart(batch, P[this.heldPart], this.gripPos[0], this.gripPos[1], this.weaponAng, 0, f, ft, Math.max(this.weaponBlood || 0, this.blood.handF * 0.5), fl, sd, this.weaponGlow || 0);
    } else if (this.weaponVisible && !this.missing.has('handF') && P[this.weaponPart]) {
      drawPart(batch, P[this.weaponPart], this.gripPos[0], this.gripPos[1], this.weaponAng, 0, f, ft, this.weaponBlood || 0, fl, sd, this.weaponGlow || 0);
    }
    if (!held) seg('handB', ht, true); // the far hand is the LEFT hand
    seg('upperarmF', ft);
    seg('forearmF', ft);
    if (!held) seg('handF', ft);
    if (P.shield && !this.missing.has('shield') && this.shieldPos) {
      drawPart(batch, P.shield, this.shieldPos[0], this.shieldPos[1], this.shieldAng, Math.PI / 2, f, ft, 0, fl, sd, 0);
    }
    batch.setShadow?.(0, 0);
  }

  tankAnchor() {
    const d = this.def;
    const hx = this.jx(J.hip), hy = this.jy(J.hip);
    const ta = this.torsoAng;
    const lx = -0.42 * d.height / 5.2, ly = d.torsoLen * 0.62;
    const c = Math.cos(ta - Math.PI / 2), s = Math.sin(ta - Math.PI / 2);
    const x = lx * this.f, y = ly;
    return [hx + x * c - y * s, hy + x * s + y * c];
  }

  // ------------------------------------------------------------------ procedural pose
  // st: {x, y (feet), f, speed, grounded, vy, crouch, aim (world angle), hold: 'rifle'|'cannon'|'blade'|'cleaver'|'none',
  //      melee (0..1 or -1), meleeKind, meleeUp, slide, dash, wall, recoil, hurt, t, dt, windup, shield, lean, headTilt, throwT}
  pose(st) {
    const d = this.def, s = this.s, dt = st.dt, K = d.k;
    const f = st.f;
    this.f = f;
    const k = (lambda) => 1 - Math.exp(-lambda * dt);
    const speed = st.speed;
    const aspeed = Math.abs(speed);
    const run = clamp(aspeed / 3, 0, 1);
    const L1 = d.thighLen, L2 = d.shinLen, H = d.hipH, P = d.parts;
    const stride = (0.5 + aspeed * 0.13) * K;
    if (st.grounded) this.phase += (speed * dt) / (stride * 2);
    this.phase -= Math.floor(this.phase);
    const crouch = st.slide ? 1.45 : st.crouch;
    s.crouch += (crouch - s.crouch) * k(st.slide ? 22 : 14);
    let hipT = H * (1 - s.crouch * 0.38);
    // running sinks the hips (bent knees) and bobs twice per cycle, lowest just after each footfall
    if (st.grounded && aspeed > 0.3) hipT -= (0.07 + 0.05 * Math.cos(this.phase * Math.PI * 4 - 0.5)) * run * K;
    if (!st.grounded) hipT = H * 0.98;
    if (st.hipOffset) hipT += st.hipOffset;
    s.hipY += (hipT - s.hipY) * k(st.grounded ? 22 : 10);
    const hipX = st.x, hipY = st.y + s.hipY;
    this.setJ(J.hip, hipX, hipY);

    const aimW = st.aim ?? (f > 0 ? 0 : Math.PI);
    let aimL = f > 0 ? aimW : Math.PI - aimW;
    aimL = clamp(Math.atan2(Math.sin(aimL), Math.cos(aimL)), -1.45, 1.45);
    s.aim = aimL;

    // torso
    let lean = -speed * 0.035 * (st.grounded ? 1 : 0.4) - (st.dash ? 0.35 : 0) + aimL * 0.08;
    if (st.slide) lean = 0.42;
    if (st.hurt) lean += 0.2 * st.hurt;
    if (st.melee >= 0 && st.meleeKind !== undefined) lean += Math.sin(st.melee * Math.PI) * -0.18;
    if (st.lean) lean += st.lean;
    lean += Math.sin(st.t * 2.1 + this.seed * 6) * 0.012;
    // gait: the pelvis rocks with each step and the chest pitches on push-off
    const ph = this.phase * Math.PI * 2;
    if (st.grounded && !st.slide) {
      lean += run * (0.055 * Math.sin(ph) + 0.03 * Math.sin(ph * 2 + 0.6));
      lean += (1 - run) * Math.sin(st.t * 1.3 + this.seed * 4) * 0.015; // idle weight shift
    }
    s.lean += (lean - s.lean) * k(10);
    const toW = (lx, ly) => [hipX + lx * f, hipY + ly];
    const angW = (a) => (f > 0 ? a : Math.PI - a);
    this.torsoAng = angW(Math.PI / 2 + s.lean);
    const tc = Math.cos(s.lean), ts = Math.sin(s.lean);
    const rotT = (v) => [v[0] * tc - v[1] * ts, v[0] * ts + v[1] * tc];
    const nk = rotT(P.torso.neck), sh = rotT(P.torso.shoulder);
    const neck = toW(nk[0], nk[1]);
    this.setJ(J.neck, neck[0], neck[1]);
    this.setJ(J.shoulder, ...toW(sh[0], sh[1]));

    // head: a spring toward look + run bob + recoil nod + hurt jerk (+ idle glances)
    if ((s.lookT -= dt) <= 0) { s.lookT = 1.5 + Math.random() * 3; s.look = (Math.random() - 0.4) * 0.3; }
    const idle = 1 - run;
    const armed = st.hold !== 'none';
    let headT = s.lean * 0.55 + clamp(aimL * 0.45, -0.42, 0.5) * (armed ? 1 : 0.3)
      + Math.sin(this.phase * Math.PI * 4) * 0.045 * run
      - s.recoil * 0.1 + (st.hurt || 0) * 0.3 + (st.headTilt || 0)
      + (armed ? 0 : s.look * idle);
    if (!st.grounded) headT += clamp(-st.vy * 0.012, -0.12, 0.12);
    s.headV += ((headT - s.head) * 140 - s.headV * 16) * dt;
    s.head += s.headV * dt;
    const headL = d.rest.head + s.head;
    this.setJ(J.head, neck[0] + Math.cos(headL) * d.headLen * f, neck[1] + Math.sin(headL) * d.headLen);

    // legs with planted feet
    const ft = [];
    for (let i = 0; i < 2; i++) {
      let fx, fy, fa;
      if (!st.grounded) {
        const tuck = clamp(0.6 - st.vy * 0.06, 0.2, 1);
        fx = i ? 0.2 * tuck * K : -0.16 * tuck * K;
        fy = H * (0.1 + tuck * 0.32) + (i ? 0.08 : 0);
        fa = -0.5 - tuck * 0.2;
        if (st.wall) { fx = i ? 0.25 * K : 0.12 * K; fy = H * 0.35 + i * 0.12; fa = 0.9; }
      } else if (st.slide) {
        fx = i ? 0.78 * K : 0.12 * K;
        fy = i ? 0.02 : 0.0;
        fa = i ? 0.45 : -0.25;
      } else {
        const p = (this.phase + i * 0.5) % 1;
        let rx, ry, ra;
        if (p < 0.5) {
          const u = p / 0.5;
          rx = lerp(stride / 2, -stride / 2, u); ry = 0;
          ra = u < 0.15 ? 0.25 * (1 - u / 0.15) : u > 0.7 ? -0.55 * ((u - 0.7) / 0.3) : 0; // heel strike, toe-off
        } else {
          // swing: the heel kicks up behind first, then the knee drives forward and the foot reaches
          const u = (p - 0.5) / 0.5;
          const fwd = u < 0.25 ? u * 0.4 : 0.1 + easeInOutCubic((u - 0.25) / 0.75) * 0.9;
          rx = lerp(-stride / 2, stride / 2, fwd);
          ry = Math.sin(Math.PI * Math.pow(u, 0.65)) * (0.08 + 0.34 * run) * K;
          ra = -0.9 * (1 - u) + 0.35 * u;
        }
        const idleX = (i ? 0.12 : -0.1) * K * (1 + s.crouch * 0.8);
        fx = lerp(idleX, rx, run);
        fy = ry * run;
        fa = ra * run;
      }
      const F = s.feet[i];
      const kk = k(st.grounded ? 40 : 14);
      F[0] += (fx - F[0]) * kk;
      F[1] += (fy - F[1]) * kk;
      s.footAng[i] += (fa - s.footAng[i]) * k(24);
      ft.push(F);
    }
    const legJ = [[J.kneeB, J.ankleB, J.toeB], [J.kneeF, J.ankleF, J.toeF]];
    for (let i = 0; i < 2; i++) {
      const fa = s.footAng[i];
      // raising the heel lifts the ankle so the toe stays on the ground
      const lift = fa < 0 ? Math.sin(-fa) * d.footLen * 0.75 : 0;
      // each thigh roots on its own side of a rotating pelvis
      const side = i ? 1 : -1;
      const pr = st.grounded && !st.slide ? run * Math.sin(ph) * side : 0;
      const hx0 = pr * 0.045 * K, hy0 = -Math.abs(pr) * 0.012 * K + side * run * Math.cos(ph) * 0.012 * K;
      const ax = ft[i][0] - hx0, ay = ft[i][1] + d.ankleH + lift - s.hipY - hy0;
      const [b1, b2] = ik2(0, 0, ax, ay, L1, L2, 1);
      const a1 = b1, a2 = b2;
      const kx = Math.cos(a1) * L1 + hx0, ky = Math.sin(a1) * L1 + hy0;
      const ex = kx + Math.cos(a2) * L2, ey = ky + Math.sin(a2) * L2;
      // planted feet keep a world angle; lifted feet follow the shin with the toes pointed
      const wAng = d.rest.foot + fa;
      const sAng = a2 - d.rest.shin + d.rest.foot - 0.35;
      const lifted = st.wall ? 0 : !st.grounded ? 1 : clamp(ft[i][1] / (0.07 * K), 0, 1);
      const diff = Math.atan2(Math.sin(sAng - wAng), Math.cos(sAng - wAng));
      const footBone = wAng + diff * lifted;
      const tx = ex + Math.cos(footBone) * d.footLen, ty = ey + Math.sin(footBone) * d.footLen;
      this.setJ(legJ[i][0], ...toW(kx, ky));
      this.setJ(legJ[i][1], ...toW(ex, ey));
      this.setJ(legJ[i][2], ...toW(tx, ty));
    }

    // arms: hands go on the grips first, then the arm solves to the wrist
    const U = d.upperLen, Fo = d.foreLen, Hn = d.handLen;
    s.recoil += ((st.recoil || 0) - s.recoil) * k(30);
    const shL = sh;
    const hold = st.hold || 'rifle';
    const W = P[this.weaponPart] || P.weapon;
    const armReach = (U + Fo + Hn * 0.5) * 0.98;
    const rh = d.rest.hand;
    let gF, gB, hAngF, hAngB, wAng = aimL;
    if (st.melee >= 0 && !(st.meleeKind === 3) && (hold === 'rifle' || hold === 'blade' || hold === 'cleaver')) {
      const m = st.melee;
      const kind = st.meleeKind || 0;
      let a0, a1;
      // anticipation (pull back) -> fast strike -> follow-through, all in front of the body
      if (kind === 0) { a0 = 1.75; a1 = -1.05; }       // downward diagonal
      else if (kind === 1) { a0 = -1.0; a1 = 1.45; }   // rising uppercut
      else { a0 = 2.1; a1 = -1.35; }                   // heavy overhead chop
      if (st.meleeUp) { a0 = -0.3; a1 = 2.0; }
      const pre = 0.12;
      const e = m < pre ? -0.12 * Math.sin((m / pre) * Math.PI) : easeInOutCubic(clamp((m - pre) / 0.38, 0, 1));
      const a = lerp(a0, a1, e);
      const r = armReach * lerp(0.72, 0.92, Math.sin(clamp(e, 0, 1) * Math.PI));
      gF = [shL[0] + Math.cos(a) * r, shL[1] + Math.sin(a) * r];
      hAngF = a - 0.35;
      wAng = a - 0.2;
      this.meleeAng = angW(a);
      // far arm comes up as a guard in front of the chest
      gB = [shL[0] + 0.3 * K, shL[1] - 0.12 * K];
      hAngB = 0.9;
    } else if (hold === 'rifle' || hold === 'cannon') {
      const ca = Math.cos(aimL), sa = Math.sin(aimL);
      const back = hold === 'cannon' ? 0.05 : (W.stock ? -W.stock[0] * 0.55 : 0.2);
      const gx = back + 0.1 * K - s.recoil * 0.1, gy = -0.2 * K;
      gF = [shL[0] + gx * ca - gy * sa, shL[1] + gx * sa + gy * ca];
      const fore = W.fore || [W.size[0] * 0.35, 0];
      // seat the supporting fist under the handguard rather than on top of it
      const fy = fore[1] - 0.045 * K;
      gB = [gF[0] + fore[0] * ca - fy * sa, gF[1] + fore[0] * sa + fy * ca];
      // fists turn with the weapon so they stay wrapped around the grips
      hAngF = rh + aimL * 0.85 - 0.1;
      hAngB = rh + aimL * 0.9 + 0.25;
    } else if (hold === 'blade' || hold === 'cleaver') {
      const sw = Math.sin(this.phase * Math.PI * 2) * 0.25 * run;
      const a = hold === 'cleaver' ? 0.9 + (st.windup || 0) * 1.4 : -0.9 + sw;
      gF = [shL[0] + Math.cos(a) * armReach * 0.8, shL[1] + Math.sin(a) * armReach * 0.8];
      hAngF = a + (hold === 'cleaver' ? 0.5 : -0.2);
      wAng = hold === 'cleaver' ? a + 0.9 : -2.25 + sw * 0.3;
      const b = -1.9 - sw;
      gB = [shL[0] + Math.cos(b) * armReach * 0.75, shL[1] + Math.sin(b) * armReach * 0.75];
      hAngB = b;
      if (st.shield) { gB = [shL[0] + armReach * 0.55, shL[1] - armReach * 0.3]; hAngB = 0.2; }
    } else {
      const sw = Math.sin(this.phase * Math.PI * 2) * 0.5 * run;
      gF = [shL[0] + Math.sin(sw) * armReach * 0.7, shL[1] - Math.cos(sw) * armReach * 0.85];
      gB = [shL[0] - Math.sin(sw) * armReach * 0.7, shL[1] - Math.cos(sw) * armReach * 0.85];
      hAngF = -Math.PI / 2 + sw; hAngB = -Math.PI / 2 - sw;
    }
    if (st.throwT >= 0 && st.throwT !== undefined) {
      const a = lerp(2.4, -0.2, easeInOutCubic(clamp(st.throwT, 0, 1)));
      gB = [shL[0] + Math.cos(a) * armReach * 0.9, shL[1] + Math.sin(a) * armReach * 0.9];
      hAngB = a;
    }
    // solve one arm from shoulder (sx, sy) so the fist lands on target g with fist angle ha.
    // If the wrist cannot reach, the fist turns toward the target so the gap closes.
    const minD = Math.abs(U - Fo) + 0.03 * K, maxD = (U + Fo) * 0.995;
    const solveArm = (sx, sy, g, ha, je, jw, jg) => {
      let wx = g[0] - Math.cos(ha) * Hn, wy = g[1] - Math.sin(ha) * Hn;
      const dx = wx - sx, dy = wy - sy, dd = Math.hypot(dx, dy) || 1e-6;
      if (dd > maxD) {
        // too far: put the wrist at full reach on the line to the grip, fist pointing at it
        const gd = Math.hypot(g[0] - sx, g[1] - sy) || 1e-6;
        const r = Math.min(maxD, gd - Hn * 0.6);
        wx = sx + (g[0] - sx) / gd * r; wy = sy + (g[1] - sy) / gd * r;
        ha = Math.atan2(g[1] - wy, g[0] - wx);
      }
      const [a1, a2] = ik2(sx, sy, wx, wy, U, Fo, -1);
      const ex = sx + Math.cos(a1) * U, ey = sy + Math.sin(a1) * U;
      const rx = ex + Math.cos(a2) * Fo, ry = ey + Math.sin(a2) * Fo;
      const gx = rx + Math.cos(ha) * Hn, gy = ry + Math.sin(ha) * Hn;
      this.setJ(je, ...toW(ex, ey));
      this.setJ(jw, ...toW(rx, ry));
      this.setJ(jg, ...toW(gx, gy));
      return [gx, gy];
    };
    const bash = st.meleeKind === 3 && st.melee >= 0;
    const twoHanded = (hold === 'rifle' || hold === 'cannon') && (!(st.melee >= 0) || bash);
    const HW = twoHanded ? P[this.weaponPart + '_held'] : null;
    this.heldPart = HW ? this.weaponPart + '_held' : null;
    if (HW) {
      // hands are painted on the weapon: place the gun, then run both arms to its wrist stubs
      const ca = Math.cos(aimL), sa = Math.sin(aimL);
      // rear wrist sits down-and-forward of the shoulder at ~80% arm length: elbow relaxed, not folded
      const thrust = bash ? Math.sin(clamp(st.melee, 0, 1) * Math.PI) : 0;
      if (bash) aimL = -0.2 + thrust * 0.5;
      const reach = (U + Fo) * (hold === 'cannon' ? 0.72 : 0.8 + thrust * 0.15) - s.recoil * 0.08;
      const drop = hold === 'cannon' ? -0.75 : -1.0;
      // never let the trigger hand go behind the hip line (that bends the elbow backwards)
      const ga = Math.max(aimL + drop, -1.45);
      let pv = [shL[0] + Math.cos(ga) * reach, shL[1] + Math.sin(ga) * reach];
      const wr = [HW.wristB[0] * ca - HW.wristB[1] * sa, HW.wristB[0] * sa + HW.wristB[1] * ca];
      const shB = [shL[0] + 0.05 * K, shL[1] - 0.01 * K];
      // keep both wrists inside the arms' reach
      for (let it = 0; it < 8; it++) {
        const dF = Math.hypot(pv[0] - shL[0], pv[1] - shL[1]);
        const dB = Math.hypot(pv[0] + wr[0] - shB[0], pv[1] + wr[1] - shB[1]);
        if (dF < minD) { pv = [pv[0] + ca * 0.02, pv[1] + sa * 0.02]; continue; }
        if (dB > maxD * 0.97) { pv = [pv[0] - ca * 0.02, pv[1] - sa * 0.02]; continue; }
        break;
      }
      const solveWrist = (sx, sy, w, je, jw, jg) => {
        const [a1, a2] = ik2(sx, sy, w[0], w[1], U, Fo, -1);
        const ex = sx + Math.cos(a1) * U, ey = sy + Math.sin(a1) * U;
        const rx = ex + Math.cos(a2) * Fo, ry = ey + Math.sin(a2) * Fo;
        this.setJ(je, ...toW(ex, ey)); this.setJ(jw, ...toW(rx, ry)); this.setJ(jg, ...toW(rx + Math.cos(a2) * 0.05, ry + Math.sin(a2) * 0.05));
      };
      solveWrist(shL[0], shL[1], pv, J.elbowF, J.wristF, J.gripF);
      solveWrist(shB[0], shB[1], [pv[0] + wr[0], pv[1] + wr[1]], J.elbowB, J.wristB, J.gripB);
      this.gripPos = toW(pv[0], pv[1]);
      this.weaponAng = angW(aimL);
      return;
    }
    if (twoHanded) {
      // keep the trigger hand far enough from the shoulder that the arm can actually fold to it
      const ca = Math.cos(aimL), sa = Math.sin(aimL);
      for (let it = 0; it < 6; it++) {
        const wx = gF[0] - Math.cos(hAngF) * Hn - shL[0], wy = gF[1] - Math.sin(hAngF) * Hn - shL[1];
        const dd = Math.hypot(wx, wy);
        if (dd >= minD) break;
        gF = [gF[0] + ca * (minD - dd + 0.01), gF[1] + sa * (minD - dd + 0.01)];
      }
    }
    const aF = solveArm(shL[0], shL[1], gF, hAngF, J.elbowF, J.wristF, J.gripF);
    if (twoHanded) {
      // the support hand follows the gun where the trigger hand really put it
      const ca = Math.cos(aimL), sa = Math.sin(aimL);
      const fore = W.fore || [W.size[0] * 0.35, 0];
      const fy = fore[1] - 0.045 * K;
      gB = [aF[0] + fore[0] * ca - fy * sa, aF[1] + fore[0] * sa + fy * ca];
    }
    // the far shoulder sits a little forward in a side view
    solveArm(shL[0] + 0.05 * K, shL[1] - 0.01 * K, gB, hAngB, J.elbowB, J.wristB, J.gripB);
    this.gripPos = [this.jx(J.gripF), this.jy(J.gripF)];
    this.weaponAng = angW(wAng);
    if (st.shield) {
      this.shieldPos = [this.jx(J.gripB), this.jy(J.gripB)];
      this.shieldAng = angW(Math.PI / 2 + s.lean * 0.5);
    }
  }
}

// ---------------------------------------------------------------- ragdoll (verlet)
const STICKS = [
  [J.hip, J.neck, null], [J.neck, J.head, 'head'], [J.neck, J.shoulder, null], [J.hip, J.shoulder, null],
  [J.shoulder, J.elbowB, 'upperarmB'], [J.elbowB, J.wristB, 'forearmB'], [J.wristB, J.gripB, 'handB'],
  [J.shoulder, J.elbowF, 'upperarmF'], [J.elbowF, J.wristF, 'forearmF'], [J.wristF, J.gripF, 'handF'],
  [J.hip, J.kneeB, 'thighB'], [J.kneeB, J.ankleB, 'shinB'], [J.ankleB, J.toeB, 'footB'],
  [J.hip, J.kneeF, 'thighF'], [J.kneeF, J.ankleF, 'shinF'], [J.ankleF, J.toeF, 'footF'],
  // soft braces (only resist compression) keep feet and head from folding flat
  [J.kneeB, J.toeB, 'footB', 0.6], [J.kneeF, J.toeF, 'footF', 0.6], [J.head, J.shoulder, 'head', 0.7],
];

export class Ragdoll {
  constructor(rig, vx, vy, spin = 0) {
    this.rig = rig;
    this.p = new Float32Array(rig.j);
    this.o = new Float32Array(rig.j);
    const dt = 1 / 120;
    const hx = rig.jx(J.hip), hy = rig.jy(J.hip);
    for (let i = 0; i < NJ; i++) {
      const rx = this.p[i * 2] - hx, ry = this.p[i * 2 + 1] - hy;
      const jitter = 0.4 + Math.random() * 0.8;
      this.o[i * 2] = this.p[i * 2] - (vx * jitter + -ry * spin) * dt;
      this.o[i * 2 + 1] = this.p[i * 2 + 1] - (vy * jitter + rx * spin) * dt;
    }
    this.len = STICKS.map(([a, b]) => Math.hypot(this.p[a * 2] - this.p[b * 2], this.p[a * 2 + 1] - this.p[b * 2 + 1]));
    this.sleep = 0;
    this.asleep = false;
    this.contact = false;
  }
  update(dt, world) {
    if (this.asleep) return;
    const p = this.p, o = this.o, g = -22 * dt * dt;
    let motion = 0;
    for (let i = 0; i < NJ; i++) {
      const x = p[i * 2], y = p[i * 2 + 1];
      const vx = (x - o[i * 2]) * 0.995, vy = (y - o[i * 2 + 1]) * 0.995;
      o[i * 2] = x; o[i * 2 + 1] = y;
      p[i * 2] = x + vx; p[i * 2 + 1] = y + vy + g;
      motion += Math.abs(vx) + Math.abs(vy);
    }
    const missing = this.rig.missing;
    for (let it = 0; it < 5; it++) {
      for (let s = 0; s < STICKS.length; s++) {
        const [a, b, seg, soft] = STICKS[s];
        if (seg && missing.has(seg)) continue;
        const dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1];
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-5;
        if (soft && d > this.len[s] * soft) continue;
        const target = soft ? this.len[s] * soft : this.len[s];
        const diff = (d - target) / d * (soft ? 0.25 : 0.5);
        const wa = a === J.hip ? 0.35 : 0.5, wb = 1 - wa;
        p[a * 2] += dx * diff * wa * 2; p[a * 2 + 1] += dy * diff * wa * 2;
        p[b * 2] -= dx * diff * wb * 2; p[b * 2 + 1] -= dy * diff * wb * 2;
      }
      this.contact = false;
      for (let i = 0; i < NJ; i++) {
        const r = world.pushOut(p[i * 2], p[i * 2 + 1], 0.05);
        if (r) {
          p[i * 2] = r[0]; p[i * 2 + 1] = r[1];
          o[i * 2] = lerp(o[i * 2], p[i * 2], 0.25);
          this.contact = true;
        }
      }
    }
    if (motion < 0.004 * NJ && this.contact) {
      this.sleep += dt;
      if (this.sleep > 0.8) this.asleep = true;
    } else this.sleep = 0;
    this.rig.j.set(p);
    this.rig.torsoAng = Math.atan2(p[J.neck * 2 + 1] - p[1], p[J.neck * 2] - p[0]);
    this.rig.gripPos = [p[J.gripF * 2], p[J.gripF * 2 + 1]];
  }
  kick(vx, vy) {
    this.asleep = false; this.sleep = 0;
    const dt = 1 / 120;
    for (let i = 0; i < NJ; i++) { this.o[i * 2] -= vx * dt * (0.5 + Math.random()); this.o[i * 2 + 1] -= vy * dt * (0.5 + Math.random()); }
  }
}

// ---------------------------------------------------------------- gibs (rigid cut-out pieces)
export class Gib {
  // x, y = sprite centre; ang = sprite rotation
  constructor(def, partName, x, y, ang, restAng, f, vx, vy, vr, opts = {}) {
    this.def = def; this.part = def.parts[partName]; this.partName = partName;
    this.x = x; this.y = y; this.ang = ang; this.f = f;
    this.vx = vx; this.vy = vy; this.vr = vr;
    this.blood = opts.blood ?? 0.6;
    this.bleed = opts.bleed ?? 1.2;
    this.tint = opts.tint || FRONT_TINT;
    this.life = 0;
    this.asleep = false;
    this.r = Math.min(this.part.size[0], this.part.size[1]) * 0.35;
    this.seed = Math.random();
    this.alpha = 1;
  }
  update(dt, world, blood) {
    this.life += dt;
    if (this.asleep) return;
    this.vy -= 22 * dt;
    this.vx *= 0.998;
    this.x += this.vx * dt; this.y += this.vy * dt; this.ang += this.vr * dt;
    const hit = world.pushOut(this.x, this.y, this.r);
    if (hit) {
      const nx = hit[0] - this.x, ny = hit[1] - this.y;
      this.x = hit[0]; this.y = hit[1];
      if (Math.abs(ny) >= Math.abs(nx)) {
        if (this.vy < -3 && blood) blood.splat(this.x, this.y - this.r, Math.min(0.08, this.bleed * 0.1));
        this.vy = -this.vy * 0.28; this.vx *= 0.6; this.vr *= 0.5;
      } else { this.vx = -this.vx * 0.4; }
      if (Math.abs(this.vx) + Math.abs(this.vy) < 0.4) { this.vr *= 0.8; if (Math.abs(this.vr) < 0.3) this.asleep = true; }
    }
    if (blood && this.bleed > 0 && Math.random() < 0.5) {
      const v = Math.min(this.bleed, 0.004);
      this.bleed -= v;
      blood.emit(this.x, this.y, -this.vx * 0.1 + (Math.random() - 0.5), -this.vy * 0.1 + Math.random(), 0.015 + Math.random() * 0.015, v, 1);
    }
  }
  draw(batch) {
    batch.add(this.x, this.y, this.ang, this.part.size[0] * this.f, this.part.size[1], this.part.uv,
      [this.tint[0], this.tint[1], this.tint[2], this.alpha], this.blood, 0, this.seed, 0);
  }
}

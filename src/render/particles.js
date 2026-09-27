// CPU-simulated, GPU-instanced particles: sparks, smoke, flashes, fire, embers, debris, shells, slash trails.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec4 iA; // x, y, rot, stretch
attribute vec4 iB; // size, shape, alpha, seed
attribute vec4 iC; // r, g, b, t (0..1 life progress)
varying vec2 vQ;
varying vec4 vB;
varying vec4 vC;
void main() {
  vQ = position.xy * 2.0;
  vB = iB; vC = iC;
  vec2 p = position.xy * vec2(iB.x * iA.w, iB.x);
  float c = cos(iA.z), s = sin(iA.z);
  vec2 w = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + iA.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 0.0, 1.0);
}`;
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vQ;
varying vec4 vB;
varying vec4 vC;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
void main() {
  float shape = vB.y;
  float r = length(vQ);
  float a;
  if (shape < 0.5) { a = smoothstep(1.0, 0.0, r); a *= a; }                         // soft dot
  else if (shape < 1.5) { a = smoothstep(1.0, 0.2, r); a = a * a * a; }              // spark (stretched)
  else if (shape < 2.5) {                                                           // smoke / flame puff
    float n = vn(vQ * 2.2 + vB.w * 31.0 + vC.a * 1.5) * 0.6 + vn(vQ * 5.0 - vB.w * 17.0) * 0.4;
    a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7);
  }
  else if (shape < 3.5) { a = smoothstep(0.12, 0.0, abs(r - 0.82)) ; }               // ring
  else if (shape < 4.5) {                                                           // flash star
    float ang = atan(vQ.y, vQ.x);
    float rays = pow(abs(cos(ang * 3.0 + vB.w * 6.0)), 18.0) * smoothstep(1.0, 0.0, r);
    a = smoothstep(0.55, 0.0, r) + rays * 0.9;
  }
  else if (shape < 5.5) { a = step(max(abs(vQ.x), abs(vQ.y)), 0.75); }              // debris chunk
  else if (shape < 6.5) { a = step(abs(vQ.x), 0.9) * step(abs(vQ.y), 0.4); }          // shell casing
  else { a = smoothstep(1.0, 0.0, r); a = pow(a, 1.6); }                            // slash / glow
  a *= vB.z;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC.rgb * a, a);
}`;

class System {
  constructor(cap, blending, scene, order) {
    this.cap = cap;
    this.p = [];
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.A = mk('iA'); this.B = mk('iB'); this.C = mk('iC');
    this.g = g;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
    });
    // shader outputs premultiplied colour
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = blending === 'add' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
    mat.blendEquation = THREE.AddEquation;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    scene.add(this.mesh);
  }
  add(o) {
    if (this.p.length >= this.cap) this.p.shift();
    o.t = 0;
    this.p.push(o);
    return o;
  }
  update(dt, world) {
    const p = this.p;
    let w = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i];
      q.t += dt;
      if (q.t >= q.life) continue;
      q.vy -= (q.g || 0) * dt;
      const dr = q.drag ?? 0;
      if (dr) { const k = Math.exp(-dr * dt); q.vx *= k; q.vy *= k; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.vr) q.rot += q.vr * dt;
      if (q.collide && world) {
        const hit = world.pushOut(q.x, q.y, 0.02);
        if (hit) { q.x = hit[0]; q.y = hit[1]; q.vy = Math.abs(q.vy) * (q.bounce ?? 0.35); q.vx *= 0.6; q.vr = (q.vr || 0) * 0.6; if (q.onBounce) q.onBounce(q); }
      }
      p[w++] = q;
    }
    p.length = w;
  }
  render() {
    const A = this.A.array, B = this.B.array, C = this.C.array;
    const p = this.p;
    for (let i = 0; i < p.length; i++) {
      const q = p[i], k = i * 4;
      const u = q.t / q.life;
      const size = q.s0 + (q.s1 - q.s0) * (q.ease ? 1 - Math.pow(1 - u, 3) : u);
      let rot = q.rot || 0, stretch = q.stretch || 1;
      if (q.shape === 1 && (q.vx || q.vy)) { rot = Math.atan2(q.vy, q.vx); stretch = q.stretch || 1 + Math.hypot(q.vx, q.vy) * 0.08; }
      A[k] = q.x; A[k + 1] = q.y; A[k + 2] = rot; A[k + 3] = stretch;
      const fadeIn = q.fadeIn ? Math.min(1, u / q.fadeIn) : 1;
      const alpha = (q.a0 ?? 1) * fadeIn * (q.hold ? (u < q.hold ? 1 : 1 - (u - q.hold) / (1 - q.hold)) : 1 - u);
      B[k] = size; B[k + 1] = q.shape; B[k + 2] = Math.max(0, alpha); B[k + 3] = q.seed ?? (q.seed = Math.random());
      let r = q.c[0], g = q.c[1], b = q.c[2];
      if (q.c2) { r += (q.c2[0] - r) * u; g += (q.c2[1] - g) * u; b += (q.c2[2] - b) * u; }
      C[k] = r; C[k + 1] = g; C[k + 2] = b; C[k + 3] = q.t;
    }
    this.g.instanceCount = p.length;
    for (const a of [this.A, this.B, this.C]) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, p.length * 4); }
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(scene) {
    this.back = new System(1200, 'alpha', scene, 35); // smoke behind characters
    this.alpha = new System(2000, 'alpha', scene, 70);
    this.add = new System(3000, 'add', scene, 80);
    this.tr = new System(600, 'add', scene, 82); // transient: rebuilt every frame (bullets, beams)
  }
  update(dt, world) { this.back.update(dt, world); this.alpha.update(dt, world); this.add.update(dt, world); }
  render() { this.back.render(); this.alpha.render(); this.add.render(); this.tr.render(); this.tr.p.length = 0; }
  // draw-once particle (life is irrelevant, t = 0)
  once(o) { o.life = o.life || 1; o.t = 0; this.tr.p.push(o); }

  spark(x, y, ang, speed, n = 6, color = [4, 2.4, 0.9], spread = 0.9) {
    for (let i = 0; i < n; i++) {
      const a = ang + rnd(-spread, spread), sp = speed * rnd(0.4, 1.2);
      this.add.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 9, drag: 2, life: rnd(0.12, 0.4), s0: rnd(0.035, 0.06), s1: 0.01, shape: 1, c: color, c2: [1.5, 0.3, 0.05] });
    }
  }
  flash(x, y, size, color = [5, 3.2, 1.4], life = 0.07) {
    this.add.add({ x, y, vx: 0, vy: 0, life, s0: size, s1: size * 1.25, shape: 4, c: color, rot: rnd(0, 6.28), seed: Math.random() });
  }
  glow(x, y, size, color, life, vx = 0, vy = 0) {
    this.add.add({ x, y, vx, vy, life, s0: size, s1: size * 0.5, shape: 7, c: color, fadeIn: 0.1 });
  }
  muzzle(x, y, ang, scale = 1) {
    this.flash(x, y, 0.5 * scale);
    this.add.add({ x: x + Math.cos(ang) * 0.18 * scale, y: y + Math.sin(ang) * 0.18 * scale, vx: 0, vy: 0, life: 0.05, s0: 0.45 * scale, s1: 0.55 * scale, shape: 1, rot: ang, stretch: 2.6, c: [6, 4, 1.8] });
    for (let i = 0; i < 2; i++) this.smoke(x, y, Math.cos(ang) * 1.2, Math.sin(ang) * 1.2 + 0.4, 0.12 * scale, 0.5, [0.35, 0.33, 0.33], 0.35);
  }
  smoke(x, y, vx, vy, s, life = 1.4, c = [0.25, 0.23, 0.24], a0 = 0.6, back = false) {
    (back ? this.back : this.alpha).add({ x, y, vx, vy, drag: 1.2, g: -0.5, life: life * rnd(0.7, 1.3), s0: s, s1: s * 3.2, ease: true, shape: 2, c, a0, rot: rnd(0, 6.28), vr: rnd(-1, 1), fadeIn: 0.12 });
  }
  fire(x, y, s = 0.3) {
    this.add.add({ x: x + rnd(-s, s) * 0.5, y, vx: rnd(-0.2, 0.2), vy: rnd(1, 2.2), drag: 0.5, life: rnd(0.4, 0.8), s0: s * rnd(0.8, 1.3), s1: s * 0.2, shape: 2, c: [3.5, 1.4, 0.35], c2: [1.2, 0.15, 0.05], rot: rnd(0, 6.28), a0: 0.8 });
    if (Math.random() < 0.15) this.ember(x, y + s);
    if (Math.random() < 0.08) this.smoke(x, y + s * 2, rnd(-0.2, 0.2), 1.2, s * 0.8, 2.5, [0.12, 0.1, 0.1], 0.4, true);
  }
  ember(x, y) {
    this.add.add({ x, y, vx: rnd(-0.6, 0.6), vy: rnd(0.6, 2), drag: 0.3, g: -0.4, life: rnd(1, 2.5), s0: rnd(0.02, 0.04), s1: 0.005, shape: 0, c: [4, 1.6, 0.4], hold: 0.7 });
  }
  debris(x, y, ang, speed, n, color = [0.3, 0.27, 0.25]) {
    for (let i = 0; i < n; i++) {
      const a = ang + rnd(-1.2, 1.2), sp = speed * rnd(0.3, 1.1);
      this.alpha.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 2, g: 20, life: rnd(0.6, 1.4), s0: rnd(0.03, 0.08), s1: 0.02, shape: 5, c: color, rot: rnd(0, 6), vr: rnd(-12, 12), collide: true, hold: 0.8 });
    }
  }
  shell(x, y, f) {
    this.alpha.add({ x, y, vx: -f * rnd(1.5, 3), vy: rnd(2.5, 4), g: 20, life: 1.6, s0: 0.055, s1: 0.05, shape: 6, c: [0.9, 0.65, 0.25], rot: rnd(0, 6), vr: rnd(-25, 25), collide: true, bounce: 0.4, hold: 0.85 });
  }
  dust(x, y, n = 5, dir = 0) {
    for (let i = 0; i < n; i++) this.smoke(x + rnd(-0.2, 0.2), y + 0.05, rnd(-1, 1) + dir, rnd(0.1, 0.6), rnd(0.08, 0.14), 0.7, [0.4, 0.36, 0.34], 0.35);
  }
  ring(x, y, size, color = [3, 1.2, 0.5], life = 0.35) {
    this.add.add({ x, y, vx: 0, vy: 0, life, s0: size * 0.2, s1: size, ease: true, shape: 3, c: color });
  }
  explosion(x, y, r = 2.5) {
    this.flash(x, y, r * 1.4, [8, 4.5, 1.8], 0.12);
    this.ring(x, y, r * 1.6, [3, 1.5, 0.6], 0.3);
    for (let i = 0; i < 18; i++) {
      const a = rnd(0, 6.28), sp = rnd(2, 7) * r / 2.5;
      this.add.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1, drag: 3, g: -1, life: rnd(0.35, 0.8), s0: rnd(0.4, 0.8) * r / 2.5, s1: 0.1, shape: 2, c: [5, 2.2, 0.6], c2: [1.1, 0.2, 0.05], rot: rnd(0, 6) });
    }
    for (let i = 0; i < 14; i++) {
      const a = rnd(0, 6.28), sp = rnd(1, 4) * r / 2.5;
      this.smoke(x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, Math.cos(a) * sp, Math.sin(a) * sp + 1.2, rnd(0.3, 0.6) * r / 2.5, rnd(1.5, 3), [0.14, 0.12, 0.12], 0.75);
    }
    this.spark(x, y, Math.PI / 2, 12, 24, [5, 2.5, 0.8], 3.14);
    this.debris(x, y, Math.PI / 2, 8, 12);
  }
  // A glowing arc for melee swings. from/to = world angles around (cx, cy)
  slashArc(cx, cy, radius, a0, a1, color = [3, 2.6, 2.4], life = 0.16) {
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const a = a0 + (a1 - a0) * u;
      this.add.add({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, vx: 0, vy: 0, life: life * (0.5 + u * 0.5), s0: 0.16 + u * 0.12, s1: 0.03, shape: 1, rot: a + Math.PI / 2, stretch: 2.8, c: color, c2: [2, 0.2, 0.1] });
    }
  }
}

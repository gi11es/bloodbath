// Blood: droplet simulation (rendered as a metaball fluid), persistent stains, and pools on floors.
import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { lightUniforms } from '../render/sprites.js';

const MAX_DROPS = 9000;
const MAX_STAINS = 7000;
const POOL_CELL = 0.1;

const DROP_VERT = /* glsl */ `
attribute vec4 iA; // x, y, rot, stretch
attribute vec4 iB; // size, density, fresh, -
varying vec2 vQ;
varying float vDen;
varying float vFresh;
void main() {
  vQ = position.xy * 2.0;
  vec2 p = position.xy * vec2(iB.x * iA.w, iB.x);
  float c = cos(iA.z), s = sin(iA.z);
  vec2 w = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + iA.xy;
  vDen = iB.y; vFresh = iB.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 0.0, 1.0);
}`;
const DROP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vQ;
varying float vDen;
varying float vFresh;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  float d = (1.0 - r2);
  d = d * d * vDen;
  gl_FragColor = vec4(d, d * vFresh, 0.0, 1.0);
}`;

const STAIN_VERT = /* glsl */ `
attribute vec4 iA; // x, y, rot, age0(birth time)
attribute vec4 iB; // sx, sy, seed, kind (0 floor, 1 wall, 2 splat)
varying vec2 vQ;
varying vec4 vB;
varying float vBirth;
varying vec2 vWorld;
void main() {
  vQ = position.xy * 2.0;
  vB = iB; vBirth = iA.w;
  vec2 p = position.xy * iB.xy;
  float c = cos(iA.z), s = sin(iA.z);
  vec2 w = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + iA.xy;
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 0.0, 1.0);
}`;
const STAIN_FRAG = /* glsl */ `
precision highp float;
uniform float time;
uniform vec3 ambient;
varying vec2 vQ;
varying vec4 vB;
varying float vBirth;
varying vec2 vWorld;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec2 q = vQ;
  float seed = vB.z * 91.7;
  float ang = atan(q.y, q.x);
  float r = length(q);
  // ragged edge
  float edge = 0.62 + 0.22 * vn(vec2(ang * 2.2 + seed, seed)) + 0.12 * vn(vec2(ang * 7.0, seed * 1.3));
  float blob = smoothstep(edge, edge - 0.08, r);
  // satellite droplets
  vec2 g = q * 3.2 + seed;
  vec2 cell = floor(g), f = fract(g) - 0.5;
  float hr = h21(cell + 3.1);
  float sat = smoothstep(0.18 * hr, 0.1 * hr, length(f - (vec2(h21(cell), h21(cell + 1.7)) - 0.5) * 0.5)) * step(0.55, hr) * step(0.5, r);
  float a = max(blob, sat * smoothstep(1.0, 0.6, r));
  if (vB.w > 0.5 && vB.w < 1.5) {
    // wall streak: drips running down
    float lane = vn(vec2(q.x * 6.0 + seed, 0.0));
    float drip = smoothstep(0.35, 0.3, abs(fract(q.x * 2.5 + seed) - 0.5)) * step(0.62, lane) * smoothstep(-1.0, 0.1, q.y) * step(q.y, 0.2);
    a = max(a, drip * 0.9);
  }
  if (a < 0.02) discard;
  float age = clamp((time - vBirth) / 40.0, 0.0, 1.0);
  vec3 wet = vec3(0.42, 0.0, 0.025);
  vec3 dry = vec3(0.13, 0.01, 0.015);
  vec3 col = mix(wet, dry, age);
  float gloss = (1.0 - age) * smoothstep(0.1, 0.9, 1.0 - r) * 0.18;
  col = col * (ambient * 0.9 + 0.35) + gloss;
  gl_FragColor = vec4(col, a * 0.94);
}`;

const POOL_FRAG = /* glsl */ `
precision highp float;
varying float vV;
varying float vFresh;
void main() {
  float d = 1.7 * smoothstep(1.0, 0.55, vV);
  gl_FragColor = vec4(d, d * vFresh, 0.0, 1.0);
}`;
const POOL_VERT = /* glsl */ `
attribute float v;
attribute float fresh;
varying float vV;
varying float vFresh;
void main() { vV = v; vFresh = fresh; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;

function instGeom(capacity, attrs) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('uv', base.getAttribute('uv'));
  const out = {};
  for (const n of attrs) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(n, a);
    out[n] = a;
  }
  g.instanceCount = 0;
  return { g, attrs: out };
}

class Pool {
  constructor(surface) {
    this.s = surface;
    this.n = Math.max(2, Math.ceil((surface.x1 - surface.x0) / POOL_CELL));
    this.vol = new Float32Array(this.n);
    this.fresh = new Float32Array(this.n);
    this.tmp = new Float32Array(this.n);
    this.active = false;
    const pos = new Float32Array(this.n * 2 * 3);
    const v = new Float32Array(this.n * 2);
    const fr = new Float32Array(this.n * 2);
    const idx = [];
    for (let i = 0; i < this.n; i++) {
      v[i * 2] = 0; v[i * 2 + 1] = 1;
      if (i < this.n - 1) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('v', new THREE.BufferAttribute(v, 1));
    g.setAttribute('fresh', new THREE.BufferAttribute(fr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.geom = g;
  }
  heightOf(vol) { return Math.min(0.09, vol * 0.018); }
  update(dt, blood) {
    if (!this.active) return;
    const n = this.n, V = this.vol, T = this.tmp;
    T.set(V);
    let total = 0;
    const k = Math.min(0.45, dt * 6);
    // viscous: a cell only spreads what it holds above a small film
    const film = 0.035;
    for (let i = 0; i < n - 1; i++) {
      const a = Math.max(0, V[i] - film), b = Math.max(0, V[i + 1] - film);
      const flow = (a - b) * k;
      T[i] -= flow; T[i + 1] += flow;
    }
    // edges overflow into drips (only if pool is fairly full there)
    for (const e of [0, n - 1]) {
      if (T[e] > 0.08) {
        const spill = (T[e] - 0.08) * Math.min(1, dt * 3);
        T[e] -= spill;
        if (Math.random() < 0.3 && blood) {
          const x = e === 0 ? this.s.x0 - 0.02 : this.s.x1 + 0.02;
          blood.emit(x, this.s.y - 0.02, (e === 0 ? -1 : 1) * 0.3, -0.5, 0.025 + Math.random() * 0.02, spill * 3, 0, true);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      V[i] = Math.max(0, T[i] * (1 - dt * 0.0015));
      this.fresh[i] = Math.max(0, this.fresh[i] - dt * 0.12); // only fresh blood heals: ~8 s
      total += V[i];
    }
    this.total = total;
    if (total < 0.0005) this.active = false;
  }
  rebuild() {
    const n = this.n, pos = this.geom.attributes.position.array, fr = this.geom.attributes.fresh.array;
    const y = this.s.y;
    for (let i = 0; i < n; i++) {
      const x = Math.min(this.s.x1, this.s.x0 + (i + 0.5) * POOL_CELL);
      const vol = this.vol[i];
      const h = vol > 0.006 ? 0.012 + this.heightOf(vol) : 0;
      pos[i * 6] = x; pos[i * 6 + 1] = y - 0.035; pos[i * 6 + 2] = 0;
      pos[i * 6 + 3] = x; pos[i * 6 + 4] = y + h - 0.02; pos[i * 6 + 5] = 0;
      fr[i * 2] = fr[i * 2 + 1] = 0.3 + this.fresh[i] * 0.7;
    }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.fresh.needsUpdate = true;
  }
}

export class Blood {
  constructor(world, scene, bloodScene) {
    this.world = world;
    this.x = new Float32Array(MAX_DROPS); this.y = new Float32Array(MAX_DROPS);
    this.vx = new Float32Array(MAX_DROPS); this.vy = new Float32Array(MAX_DROPS);
    this.r = new Float32Array(MAX_DROPS); this.vol = new Float32Array(MAX_DROPS);
    this.life = new Float32Array(MAX_DROPS); this.kind = new Uint8Array(MAX_DROPS);
    this.n = 0;
    this.spilled = 0;
    this.time = 0;
    this.onSpill = null;
    // droplet mesh (into blood density RT)
    const d = instGeom(MAX_DROPS, ['iA', 'iB']);
    this.dropG = d.g; this.dropA = d.attrs;
    this.dropMesh = new THREE.Mesh(d.g, new THREE.ShaderMaterial({
      vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }));
    this.dropMesh.frustumCulled = false;
    bloodScene.add(this.dropMesh);
    // stains (main scene)
    const s = instGeom(MAX_STAINS, ['iA', 'iB']);
    this.stainG = s.g; this.stainA = s.attrs; this.stainN = 0; this.stainHead = 0;
    this.stainMat = new THREE.ShaderMaterial({
      vertexShader: STAIN_VERT, fragmentShader: STAIN_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { time: lightUniforms.time, ambient: lightUniforms.ambient },
    });
    this.stainMesh = new THREE.Mesh(s.g, this.stainMat);
    this.stainMesh.frustumCulled = false;
    this.stainMesh.renderOrder = 40;
    scene.add(this.stainMesh);
    // pools
    this.poolMat = new THREE.ShaderMaterial({ vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.pools = world.surfaces.map((sf) => {
      const p = new Pool(sf);
      p.mesh = new THREE.Mesh(p.geom, this.poolMat);
      p.mesh.frustumCulled = false;
      p.mesh.visible = false;
      bloodScene.add(p.mesh);
      sf.pool = p;
      return p;
    });
    this.goreMul = 1;
    this.setGore(settings.gore);
    this.stepToggle = false;
  }

  setGore(g) { this.goreMul = g === 'standard' ? 0.45 : g === 'excessive' ? 0.8 : 1.15; }

  // Emit one droplet. vol in litres. kind 0 = droplet, 1 = mist (no stain). silent = don't count as spilled
  emit(x, y, vx, vy, r, vol, kind = 0, silent = false) {
    if (!silent) this.count(vol);
    let i;
    if (this.n < MAX_DROPS) i = this.n++;
    else i = Math.floor(Math.random() * MAX_DROPS);
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.r[i] = r; this.vol[i] = vol;
    this.life[i] = kind === 1 ? 0.35 + Math.random() * 0.4 : 6; this.kind[i] = kind;
  }

  count(vol) {
    this.spilled += vol;
    if (this.onSpill) this.onSpill(vol);
  }

  // A directional jet. volume = total litres.
  spurt(x, y, ang, speed, count, spread, volume, size = 1) {
    count = Math.max(1, Math.round(count * this.goreMul));
    const v = volume / count;
    this.count(volume);
    for (let k = 0; k < count; k++) {
      const a = ang + (Math.random() - 0.5) * spread;
      const sp = speed * (0.45 + Math.random() * 0.75);
      const r = (0.014 + Math.random() * 0.032) * size;
      this.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, r, v, Math.random() < 0.18 ? 1 : 0, true);
    }
  }

  // Radial explosion of blood.
  burst(x, y, power, volume, size = 1) {
    const count = Math.max(4, Math.round(power * 18 * this.goreMul));
    const v = volume / count;
    this.count(volume);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = power * (1.5 + Math.random() * 5);
      this.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + power * 1.5, (0.018 + Math.random() * 0.045) * size, v, Math.random() < 0.25 ? 1 : 0, true);
    }
  }

  splat(x, y, vol) {
    this.addStain(x, y, 0, 0.25 + vol * 3, 0.1 + vol, 0);
    this.addPool(x, y, vol);
  }

  addStain(x, y, rot, sx, sy, kind) {
    const i = this.stainHead;
    this.stainHead = (this.stainHead + 1) % MAX_STAINS;
    this.stainN = Math.min(MAX_STAINS, this.stainN + 1);
    const A = this.stainA.iA.array, B = this.stainA.iB.array;
    A[i * 4] = x; A[i * 4 + 1] = y; A[i * 4 + 2] = rot; A[i * 4 + 3] = this.time;
    B[i * 4] = sx; B[i * 4 + 1] = sy; B[i * 4 + 2] = Math.random(); B[i * 4 + 3] = kind;
    this.stainDirty = true;
    this.stainRange = this.stainRange ? [Math.min(this.stainRange[0], i), Math.max(this.stainRange[1], i)] : [i, i];
  }

  addPool(x, y, vol) {
    const sf = this.world.surfaceAt(x, y, 0.25);
    if (!sf) return;
    const p = sf.pool;
    const i = Math.max(0, Math.min(p.n - 1, Math.floor((x - sf.x0) / POOL_CELL)));
    p.vol[i] += vol;
    p.fresh[i] = 1;
    p.active = true;
    p.mesh.visible = true;
  }

  // Absorb pool volume around x on the surface under (x, y). Returns litres absorbed.
  absorb(x, y, halfW, maxVol) {
    const sf = this.world.surfaceAt(x, y, 0.15);
    if (!sf) return 0;
    const p = sf.pool;
    let got = 0;
    const i0 = Math.max(0, Math.floor((x - halfW - sf.x0) / POOL_CELL)), i1 = Math.min(p.n - 1, Math.floor((x + halfW - sf.x0) / POOL_CELL));
    for (let i = i0; i <= i1 && got < maxVol; i++) {
      const take = Math.min(p.vol[i] * p.fresh[i], maxVol - got);
      if (take > 0) { p.vol[i] -= take; got += take; }
    }
    return got;
  }

  poolDepthAt(x, y) {
    const sf = this.world.surfaceAt(x, y, 0.15);
    if (!sf) return 0;
    const i = Math.floor((x - sf.x0) / POOL_CELL);
    return i >= 0 && i < sf.pool.n ? sf.pool.vol[i] : 0;
  }

  update(dt) {
    this.time += dt;
    const w = this.world;
    const X = this.x, Y = this.y, VX = this.vx, VY = this.vy, R = this.r, L = this.life, K = this.kind, V = this.vol;
    let n = this.n;
    const g = 21 * dt;
    for (let i = 0; i < n; i++) {
      L[i] -= dt;
      if (K[i] === 2) {
        // sliding down a wall
        Y[i] -= 0.25 * dt * (0.5 + R[i] * 20);
        if (Math.random() < dt * 14) this.addStain(X[i], Y[i], 0, R[i] * 2.4, R[i] * 3, 2);
        R[i] -= dt * 0.012;
        if (R[i] < 0.012 || !w.solidAt(X[i] + (VX[i] > 0 ? 0.03 : -0.03), Y[i])) { L[i] = -1; }
      } else {
        VY[i] -= g;
        const drag = K[i] === 1 ? 0.94 : 0.995;
        VX[i] *= drag; VY[i] *= K[i] === 1 ? 0.97 : 1;
        const nx = X[i] + VX[i] * dt, ny = Y[i] + VY[i] * dt;
        if (K[i] !== 1) {
          const s = w.solidAt(nx, ny);
          let hitPlat = null;
          if (!s && VY[i] < 0) hitPlat = w.platformAt(nx, ny, 0.12, 0.0);
          if (s || hitPlat) {
            // decide surface normal
            let floor = true, hx = nx, hy = ny;
            if (s) {
              const top = s.y + s.h;
              if (Y[i] >= top - 0.02) { hy = top; }
              else if (X[i] < s.x) { floor = false; hx = s.x; }
              else if (X[i] > s.x + s.w) { floor = false; hx = s.x + s.w; }
              else if (Y[i] < s.y) { floor = false; hy = s.y; }
              else hy = top;
            } else hy = hitPlat.y;
            const sp = Math.hypot(VX[i], VY[i]);
            const size = R[i] * (2.2 + Math.min(sp, 12) * 0.12);
            if (floor) {
              const stretch = 1 + Math.min(Math.abs(VX[i]) * 0.25, 2.5);
              this.addStain(hx + VX[i] * 0.01, hy - 0.02, 0, size * 2.3 * stretch, size * 0.55, 0);
              this.addPool(hx, hy, V[i]);
              if (sp > 5 && Math.random() < 0.35) {
                for (let k = 0; k < 2; k++) this.emit(hx, hy + 0.03, VX[i] * 0.3 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, R[i] * 0.45, 0, 1, true);
              }
            } else {
              this.addStain(hx, hy, Math.PI / 2, size * 2.6, size * 1.6, 1);
              if (R[i] > 0.035 && Math.random() < 0.45) {
                // spawn a slider
                if (this.n < MAX_DROPS) {
                  const j = this.n++;
                  X[j] = hx + (VX[i] > 0 ? -0.01 : 0.01); Y[j] = hy; VX[j] = VX[i] > 0 ? 1 : -1; VY[j] = 0;
                  R[j] = R[i] * 0.8; V[j] = 0; L[j] = 8; K[j] = 2;
                }
              }
              this.addPool(hx, w.groundBelow(hx + (VX[i] > 0 ? -0.1 : 0.1), hy), V[i] * 0.5);
            }
            L[i] = -1;
          } else { X[i] = nx; Y[i] = ny; }
        } else { X[i] = nx; Y[i] = ny; }
      }
      if (L[i] < 0 || Y[i] < w.bounds.y0 - 3) {
        n--;
        X[i] = X[n]; Y[i] = Y[n]; VX[i] = VX[n]; VY[i] = VY[n]; R[i] = R[n]; V[i] = V[n]; L[i] = L[n]; K[i] = K[n];
        i--;
      }
    }
    this.n = n;
    this.stepToggle = !this.stepToggle;
    if (this.stepToggle) for (const p of this.pools) p.update(dt * 2, this);
  }

  render(camX, viewW) {
    const A = this.dropA.iA.array, B = this.dropA.iB.array;
    let m = 0;
    const x0 = camX - viewW, x1 = camX + viewW;
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i];
      if (x < x0 || x > x1) continue;
      const vx = this.vx[i], vy = this.vy[i];
      const sp = Math.sqrt(vx * vx + vy * vy);
      const k = m * 4;
      A[k] = x; A[k + 1] = this.y[i]; A[k + 2] = Math.atan2(vy, vx); A[k + 3] = this.kind[i] === 2 ? 1 : 1 + Math.min(sp * 0.13, 3.2);
      const mist = this.kind[i] === 1;
      B[k] = this.r[i] * (mist ? 5 : 3.6); B[k + 1] = mist ? 0.5 * Math.max(0, this.life[i] * 2) : 1.2; B[k + 2] = 1;
      m++;
    }
    this.dropG.instanceCount = m;
    this.dropA.iA.needsUpdate = true; this.dropA.iB.needsUpdate = true;
    this.dropA.iA.clearUpdateRanges(); this.dropA.iA.addUpdateRange(0, m * 4);
    this.dropA.iB.clearUpdateRanges(); this.dropA.iB.addUpdateRange(0, m * 4);
    if (this.stainDirty) {
      this.stainG.instanceCount = this.stainN;
      this.stainA.iA.needsUpdate = true; this.stainA.iB.needsUpdate = true;
      this.stainDirty = false; this.stainRange = null;
    }
    for (const p of this.pools) {
      if (!p.mesh.visible) continue;
      const vis = p.s.x1 > x0 && p.s.x0 < x1;
      if (vis && p.active) p.rebuild();
    }
  }
}

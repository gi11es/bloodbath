import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv; varying vec2 vWorld;
void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xy; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const FOG_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv; varying vec2 vWorld;
uniform float time; uniform vec3 color; uniform float alpha; uniform float speed; uniform float scale;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vn(p); p = p * 2.02 + 3.1; a *= 0.5; } return v; }
void main() {
  vec2 p = vWorld * scale + vec2(time * speed, 0.0);
  float n = fbm(p + fbm(p * 0.7 - time * 0.03));
  float band = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
  float a = smoothstep(0.35, 0.85, n) * band * alpha;
  gl_FragColor = vec4(color * a, a);
}`;
const SHAFT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float time; uniform vec3 color; uniform float alpha; uniform float seed;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float a = pow(1.0 - x, 2.5) * smoothstep(0.0, 0.7, vUv.y) * (0.75 + 0.25 * sin(time * 0.4 + seed * 6.0));
  gl_FragColor = vec4(color * a * alpha, 0.0);
}`;

export class FogBands {
  constructor(scene, theme) {
    this.bands = [];
    const premul = (m) => { m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; return m; };
    for (const [i, b] of (theme.fogBands || []).entries()) {
      for (const layer of [0, 1]) {
        const mat = premul(new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: FOG_FRAG, transparent: true, depthTest: false, depthWrite: false,
          uniforms: { time: { value: 0 }, color: { value: new THREE.Color(...b.color) }, alpha: { value: b.alpha * (layer ? 0.55 : 1) }, speed: { value: b.speed * (layer ? 1.6 : 1) }, scale: { value: layer ? 0.28 : 0.18 } },
        }));
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        m.renderOrder = layer ? 92 : 34;
        m.frustumCulled = false;
        scene.add(m);
        this.bands.push({ m, b, layer });
      }
    }
    this.shafts = [];
    const n = theme.shafts ?? 4;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: SHAFT_FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 }, color: { value: new THREE.Color(...(theme.shaftColor || [1.0, 0.45, 0.25])) }, alpha: { value: 0.09 }, seed: { value: i * 1.7 } },
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      m.renderOrder = 1.5;
      m.frustumCulled = false;
      scene.add(m);
      this.shafts.push({ m, x: i * 9 + 3, w: 2.5 + (i % 3) * 1.4 });
    }
    this.t = 0;
  }
  update(dt, cx, cy, vw, vh) {
    this.t += dt;
    for (const { m, b } of this.bands) {
      m.material.uniforms.time.value = this.t;
      m.scale.set(vw + 4, b.h, 1);
      m.position.set(cx, b.y + b.h / 2, 0);
    }
    const span = 36;
    for (const s of this.shafts) {
      s.m.material.uniforms.time.value = this.t;
      // parallax 0.25, wrap around the camera
      let x = s.x + cx * 0.25;
      x = cx + ((((x - cx) % span) + span * 1.5) % span) - span / 2;
      s.m.scale.set(s.w, vh * 1.6, 1);
      s.m.position.set(x, cy + vh * 0.15, 0);
      s.m.rotation.z = -0.35;
    }
  }
}

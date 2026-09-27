// Title logo rendered in WebGL with procedural, viscous blood dripping from the letters.
import * as THREE from 'three';
import { loadTexture } from '../core/assets.js';

const N = 256; // drip columns

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;

// Quad spans the logo width and EXT times its height (drips hang below). vUv.y = 1 at the top.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tLogo;
uniform sampler2D tEdge;     // r = lowest opaque v (0 top .. 1 bottom), g = redness, b = alive
uniform sampler2D tEdgeCol;  // linear colour of the painted blood at the attachment point
uniform vec2 logoPx;         // logo size in screen px
uniform float ext;
uniform float time;
uniform float intro;

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// signed distance (px) to one drip living in column c; returns vec2(dist, bodyRadiusAtY)
vec3 drip(float c, vec2 p) {
  vec4 e = texture2D(tEdge, vec2((c + 0.5) / ${N}.0, 0.5));
  if (e.b < 0.5) return vec3(1e5, 1.0, 0.0);
  float hA = h1(c * 1.37 + 3.1), hB = h1(c * 2.71 + 7.7), hC = h1(c * 4.13 + 1.3);
  float period = mix(10.0, 22.0, hA);
  float t = fract(time / period + hB);
  float cycle = floor(time / period + hB);
  bool releases = h1(c * 3.3 + cycle * 5.1) < 0.35;
  float cx = (c + 0.5 + (hC - 0.5) * 0.6) / ${N}.0 * logoPx.x;
  float top = e.r * logoPx.y - 3.0;                 // attach just inside the letter edge
  float w = mix(2.6, 5.8, h1(c * 9.1 + cycle)) * (logoPx.x / 900.0) * mix(0.8, 1.1, e.g);
  float maxLen = mix(0.05, 0.26, pow(h1(c * 5.3 + cycle * 1.7), 1.4)) * logoPx.y;
  // thick, viscous blood: a slow sag that eases in, then either lets a bead go or creeps back
  float grow = smoothstep(0.0, 0.85, t);
  grow = grow * grow * (3.0 - 2.0 * grow);
  float recede = releases ? 0.0 : smoothstep(0.88, 1.0, t);
  float len = maxLen * grow * (1.0 - recede);
  vec2 q = p - vec2(cx, top);
  float y = clamp(q.y, 0.0, len);
  float taper = mix(1.0, 0.72, y / max(len, 1.0));
  float r = w * taper + w * 1.4 * exp(-y / (w * 1.8));
  float stem = length(vec2(q.x, q.y - y)) - r;
  float beadR = w * mix(1.15, 1.6, smoothstep(0.55, 0.85, t));
  float bead = length((q - vec2(0.0, len - beadR * 0.35)) * vec2(1.0, 0.9)) - beadR;
  float d = smin(stem, bead, w * 1.4);
  float ft = releases ? max(0.0, t - 0.86) * period : 0.0;
  if (ft > 0.0) {
    float fy = len + 0.5 * 900.0 * ft * ft;
    float drop = length((q - vec2(0.0, fy)) * vec2(1.0, 0.75)) - beadR * 0.85;
    float back = smoothstep(0.0, 0.6, ft);
    d = min(mix(d, stem + back * w * 2.0, back), drop);
  }
  return vec3(d, r, q.x);
}

void main() {
  float v = (1.0 - vUv.y) * ext;          // 0 at logo top, 1 at logo bottom, >1 below
  vec2 p = vec2(vUv.x * logoPx.x, v * logoPx.y);
  vec4 logo = v <= 1.0 ? texture2D(tLogo, vec2(vUv.x, 1.0 - v)) : vec4(0.0);
  // nearest drips (this and neighbouring columns)
  float c0 = floor(vUv.x * ${N}.0);
  float best = 1e5, rad = 1.0, qx = 0.0, bc = c0;
  for (int i = -2; i <= 2; i++) {
    vec3 r = drip(c0 + float(i), p);
    if (r.x < best) { best = r.x; rad = r.y; qx = r.z; bc = c0 + float(i); }
  }
  vec3 base = texture2D(tEdgeCol, vec2((bc + 0.5) / ${N}.0, 0.5)).rgb;
  float edgeV = texture2D(tEdge, vec2((bc + 0.5) / ${N}.0, 0.5)).r;
  float aa = 1.2;
  float dA = smoothstep(aa, -aa, best) * (1.0 - smoothstep(1.35, 1.55, v));
  // blood shading: cylinder normal across the drip, glossy highlight, dark core
  float nx = clamp(qx / max(rad, 1.0), -1.0, 1.0);
  vec3 n = normalize(vec3(nx, -0.15, sqrt(max(0.0, 1.0 - nx * nx))));
  vec3 L = normalize(vec3(-0.5, 0.6, 0.65));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 70.0);
  float sheen = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 8.0);
  float rim = pow(1.0 - n.z, 2.0);
  // same pigment as the painted blood it grows from, shaded as a round viscous strand
  vec3 blood = base * (0.55 + diff * 0.75) * (1.0 - rim * 0.55) + vec3(1.0, 0.72, 0.72) * spec * 0.6 + base * sheen * 0.3;
  // wet sheen that slides over the red parts of the letters
  float redness = clamp((logo.r - max(logo.g, logo.b)) * 3.0, 0.0, 1.0);
  float band = smoothstep(0.08, 0.0, abs(fract(vUv.x * 0.7 - v * 0.35 - time * 0.07) - 0.5) - 0.02);
  vec3 lc = logo.rgb + redness * band * vec3(0.9, 0.35, 0.35) * 0.9;
  // soft drop shadow under everything
  float sh = v <= 1.0 ? texture2D(tLogo, vec2(vUv.x - 0.004, 1.0 - v + 0.02)).a : 0.0;
  // the drip is drawn over the letter and fades out upward inside it, so the root has no seam
  float rootFade = smoothstep(edgeV * logoPx.y - 14.0, edgeV * logoPx.y + 2.0, p.y);
  float over = dA * (logo.a > 0.0 ? rootFade : 1.0);
  vec3 col = mix(lc, blood, over);
  col = mix(blood, col, max(logo.a, over));
  float a = max(logo.a, dA);
  float shadowA = max(sh * step(v, 1.0), smoothstep(6.0, -2.0, best - 4.0) * (1.0 - smoothstep(1.3, 1.5, v))) * 0.5 * (1.0 - a);
  gl_FragColor = vec4(col * a, a + shadowA) * intro;
}`;

export class BloodLogo {
  constructor(scene) {
    this.ext = 1.55;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { tLogo: { value: null }, tEdge: { value: null }, tEdgeCol: { value: null }, logoPx: { value: new THREE.Vector2(900, 300) }, ext: { value: this.ext }, time: { value: 0 }, intro: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    loadTexture('assets/ui/logo_clean.webp', { mipmaps: true }).then((t) => { this.mat.uniforms.tLogo.value = t; this.buildEdges(t.image); });
    this.t = 0;
  }
  buildEdges(img) {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height).data;
    const data = new Uint8Array(N * 4);
    for (let c = 0; c < N; c++) {
      const x0 = Math.floor((c / N) * img.width), x1 = Math.floor(((c + 1) / N) * img.width);
      let lowest = -1, red = 0;
      for (let x = x0; x < x1; x++) {
        for (let y = img.height - 1; y >= 0; y--) {
          const i = (y * img.width + x) * 4;
          if (d[i + 3] > 200) { if (y > lowest) { lowest = y; red = (d[i] - Math.max(d[i + 1], d[i + 2])) / 255; } break; }
        }
      }
      data[c * 4] = lowest < 0 ? 0 : Math.round((lowest / img.height) * 255);
      data[c * 4 + 1] = Math.max(0, Math.min(255, Math.round(red * 255 * 1.5)));
      // drips come from the lowest points of the lettering (and the painted drips) only
      data[c * 4 + 2] = lowest > img.height * 0.55 && Math.random() < 0.3 ? 255 : 0;
    }
    const colData = new Uint8Array(N * 4);
    for (let c = 0; c < N; c++) {
      const x = Math.min(img.width - 1, Math.floor(((c + 0.5) / N) * img.width));
      const ly = Math.round((data[c * 4] / 255) * img.height);
      // the most saturated blood pixel near the attachment point (ignores glossy highlights)
      let best = null, bestSat = -1, n = 0;
      for (let yy = Math.max(0, ly - 16); yy <= Math.max(0, ly - 2); yy++) {
        for (let xx = Math.max(0, x - 3); xx <= Math.min(img.width - 1, x + 3); xx++) {
          const i = (yy * img.width + xx) * 4;
          if (d[i + 3] < 200) continue;
          n++;
          const sat = d[i] - Math.max(d[i + 1], d[i + 2]);
          if (sat > bestSat) { bestSat = sat; best = [d[i], d[i + 1], d[i + 2]]; }
        }
      }
      const lin = (v) => Math.pow(v / 255, 2.2);
      const ref = [0.33, 0.004, 0.018]; // rich arterial red, linear
      const col = best ? best.map(lin) : ref;
      for (let k = 0; k < 3; k++) colData[c * 4 + k] = Math.round((ref[k] * 0.55 + col[k] * 0.45) * 255);
      colData[c * 4 + 3] = 255;
      // only grow drips where the letter bottom is actually painted with blood
      if (!best || bestSat < 70) data[c * 4 + 2] = 0;
    }
    const ctex = new THREE.DataTexture(colData, N, 1, THREE.RGBAFormat);
    ctex.magFilter = THREE.NearestFilter; ctex.minFilter = THREE.NearestFilter; ctex.needsUpdate = true;
    this.mat.uniforms.tEdgeCol.value = ctex;
    const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.mat.uniforms.tEdge.value = tex;
  }
  // place over a DOM element (the invisible layout <img>), in the given ortho camera
  update(dt, el, cam, W, H) {
    this.t += dt;
    const u = this.mat.uniforms;
    u.time.value = this.t;
    if (!el || !u.tEdge.value) { this.mesh.visible = false; return; }
    const r = el.getBoundingClientRect();
    if (r.width < 2) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const target = this.dim ? 0.12 : 1;
    u.intro.value += Math.sign(target - u.intro.value) * Math.min(Math.abs(target - u.intro.value), dt * 3);
    u.logoPx.value.set(r.width, r.height);
    const sx = (cam.right - cam.left) / W, sy = (cam.top - cam.bottom) / H;
    const w = r.width * sx, h = r.height * sy * this.ext;
    const x = cam.left + (r.left + r.width / 2) * sx;
    const yTop = cam.top - r.top * sy;
    this.mesh.scale.set(w, h, 1);
    this.mesh.position.set(x, yTop - h / 2, 0);
  }
}

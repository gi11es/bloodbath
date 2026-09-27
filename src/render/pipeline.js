// Render pipeline: scene -> low-res HDR target (pixel look) -> blood fluid composite -> bloom ->
// full-resolution grade (tonemap, vignette, grain, chromatic aberration, CRT, damage/frenzy tints).
import * as THREE from 'three';
import { settings } from '../core/settings.js';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fsQuad(material) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  m.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(m);
  return { scene, mesh: m };
}

const BLOOD_COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tBlood;
uniform vec2 texel;
uniform float time;
void main() {
  float d = texture2D(tBlood, vUv).r;
  float fresh = texture2D(tBlood, vUv).g / max(d, 1e-3);
  float a = smoothstep(0.42, 0.62, d);
  if (a <= 0.001) discard;
  // gradient of the density field -> fake surface normal
  float dx = texture2D(tBlood, vUv + vec2(texel.x, 0.0)).r - texture2D(tBlood, vUv - vec2(texel.x, 0.0)).r;
  float dy = texture2D(tBlood, vUv + vec2(0.0, texel.y)).r - texture2D(tBlood, vUv - vec2(0.0, texel.y)).r;
  vec3 n = normalize(vec3(-dx * 2.2, -dy * 2.2, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.7, 0.8));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0);
  float body = smoothstep(0.5, 2.4, d);
  vec3 deep = vec3(0.09, 0.0, 0.006);
  vec3 mid = mix(vec3(0.34, 0.0, 0.015), vec3(0.55, 0.01, 0.025), fresh);
  vec3 col = mix(mid, deep, body * 0.75);
  col *= 0.55 + diff * 0.65;
  col += spec * vec3(1.0, 0.7, 0.65) * 1.1;
  // thin edges look brighter/translucent
  col = mix(col, mid * 1.3, (1.0 - smoothstep(0.42, 0.9, d)) * 0.5);
  gl_FragColor = vec4(col, a);
}`;

const BRIGHT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float threshold;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(threshold, threshold + 0.6, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 dir;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const FINAL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform sampler2D tBloom3;
uniform sampler2D tBloodMask;
uniform vec2 resolution;
uniform vec2 sceneRes;
uniform float time;
uniform float bloomStrength;
uniform float exposure;
uniform float vignette;
uniform float grain;
uniform float aberration;
uniform float damage;
uniform float frenzy;
uniform float flash;
uniform float crt;
uniform float saturation;
uniform float fade;
uniform vec3 lift;
uniform vec3 gain;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  if (crt > 0.5) {
    vec2 cc = uv - 0.5;
    float r2 = dot(cc, cc);
    uv = 0.5 + cc * (1.0 + r2 * 0.08);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  vec2 cc = uv - 0.5;
  float ab = aberration * (0.0015 + dot(cc, cc) * 0.02);
  vec3 col;
  col.r = texture2D(tScene, uv + cc * ab * 2.0).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - cc * ab * 2.0).b;
  vec3 bloom = texture2D(tBloom0, uv).rgb * 0.5 + texture2D(tBloom1, uv).rgb * 0.7 +
               texture2D(tBloom2, uv).rgb * 0.9 + texture2D(tBloom3, uv).rgb * 1.1;
  col += bloom * bloomStrength;
  col *= exposure;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2)); // linear -> display
  // grade
  col = col * gain + lift * (1.0 - col);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, saturation);
  // frenzy: crush everything but reds
  if (frenzy > 0.0) {
    // the world drains to cold charcoal; only the blood keeps its colour
    float bm = smoothstep(0.35, 0.7, texture2D(tBloodMask, uv).r);
    vec3 mono = mix(vec3(pow(l, 1.1) * 0.85) * vec3(0.85, 0.88, 1.0), col * vec3(0.7, 0.75, 0.85), 0.3);
    vec3 hot = col * vec3(1.5, 0.7, 0.7);
    col = mix(col, mix(mono, hot, bm), frenzy * 0.8);
  }
  // damage vignette
  float v = smoothstep(0.85, 0.2, length(cc * vec2(1.0, 0.8)));
  col *= mix(1.0, v, vignette);
  float edge = smoothstep(0.25, 0.75, length(cc));
  col = mix(col, vec3(0.28, 0.0, 0.01), edge * damage * 0.75);
  // film grain
  float g = hash(uv * resolution + fract(time * 7.13) * 100.0) - 0.5;
  col += g * grain;
  if (crt > 0.5) {
    float sl = 0.82 + 0.18 * sin(uv.y * sceneRes.y * 3.14159);
    col *= sl;
    float px = mod(gl_FragCoord.x, 3.0);
    col *= vec3(px < 1.0 ? 1.08 : 0.94, px >= 1.0 && px < 2.0 ? 1.08 : 0.94, px >= 2.0 ? 1.08 : 0.94);
  }
  col += flash;
  col *= fade;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Pipeline {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, { ...rtOpts, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.bloodRT = new THREE.WebGLRenderTarget(4, 4, { ...rtOpts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.bloomRTs = [];
    for (let i = 0; i < 4; i++) {
      this.bloomRTs.push([
        new THREE.WebGLRenderTarget(4, 4, { ...rtOpts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }),
        new THREE.WebGLRenderTarget(4, 4, { ...rtOpts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }),
      ]);
    }
    this.bloodMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BLOOD_COMPOSITE_FRAG, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { tBlood: { value: this.bloodRT.texture }, texel: { value: new THREE.Vector2() }, time: { value: 0 } },
    });
    this.bloodQuad = fsQuad(this.bloodMat);
    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false,
      uniforms: { tSrc: { value: null }, threshold: { value: 0.85 } },
    });
    this.brightQuad = fsQuad(this.brightMat);
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, depthTest: false,
      uniforms: { tSrc: { value: null }, dir: { value: new THREE.Vector2() } },
    });
    this.blurQuad = fsQuad(this.blurMat);
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: FINAL_FRAG, depthTest: false,
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tBloom0: { value: this.bloomRTs[0][0].texture },
        tBloom1: { value: this.bloomRTs[1][0].texture },
        tBloom2: { value: this.bloomRTs[2][0].texture },
        tBloom3: { value: this.bloomRTs[3][0].texture },
        tBloodMask: { value: this.bloodRT.texture },
        resolution: { value: new THREE.Vector2() },
        sceneRes: { value: new THREE.Vector2() },
        time: { value: 0 },
        bloomStrength: { value: 0.55 },
        exposure: { value: 1.0 },
        vignette: { value: 0.55 },
        grain: { value: 0.035 },
        aberration: { value: 0.3 },
        damage: { value: 0 },
        frenzy: { value: 0 },
        flash: { value: 0 },
        crt: { value: 0 },
        saturation: { value: 1.08 },
        fade: { value: 1 },
        lift: { value: new THREE.Vector3(0.012, 0.004, 0.018) },
        gain: { value: new THREE.Vector3(1.04, 0.99, 0.97) },
      },
    });
    this.finalQuad = fsQuad(this.finalMat);
    this.fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fx = this.finalMat.uniforms;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w; this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setSize(w, h, true);
    this.renderer.setPixelRatio(dpr);
    const ps = settings.pixelScale;
    let ih = ps === 'retro' ? 360 : ps === 'hibit' ? 540 : Math.min(1440, Math.round(h * dpr));
    ih = Math.min(ih, Math.round(h * dpr));
    const iw = Math.round(ih * (w / h));
    this.iw = iw; this.ih = ih;
    this.sceneRT.setSize(iw, ih);
    const bw = Math.max(2, Math.round(iw / 2)), bh = Math.max(2, Math.round(ih / 2));
    this.bloodRT.setSize(bw, bh);
    this.bloodMat.uniforms.texel.value.set(1 / bw, 1 / bh);
    let sw = Math.max(2, Math.round(Math.min(iw, 960) / 2)), sh = Math.max(2, Math.round(sw * h / w));
    for (const pair of this.bloomRTs) {
      pair[0].setSize(sw, sh); pair[1].setSize(sw, sh);
      sw = Math.max(2, sw >> 1); sh = Math.max(2, sh >> 1);
    }
    const nearest = ps !== 'hd';
    this.sceneRT.texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    this.sceneRT.texture.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    this.sceneRT.texture.needsUpdate = true;
    this.fx.resolution.value.set(w * dpr, h * dpr);
    this.fx.sceneRes.value.set(iw, ih);
    this.onResize && this.onResize(w, h);
  }

  // scene: world scene; bloodScene: droplet blobs scene (optional); camera shared
  render(scene, camera, bloodScene, time) {
    const r = this.renderer;
    this.fx.time.value = time;
    this.fx.crt.value = settings.crt ? 1 : 0;
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, camera);
    if (bloodScene) {
      r.setRenderTarget(this.bloodRT);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(bloodScene, camera);
      r.setRenderTarget(this.sceneRT);
      r.render(this.bloodQuad.scene, this.fsCamera);
    }
    // bloom chain
    this.brightMat.uniforms.tSrc.value = this.sceneRT.texture;
    r.setRenderTarget(this.bloomRTs[0][0]);
    r.render(this.brightQuad.scene, this.fsCamera);
    for (let i = 0; i < this.bloomRTs.length; i++) {
      const [a, b] = this.bloomRTs[i];
      if (i > 0) {
        this.blurMat.uniforms.tSrc.value = this.bloomRTs[i - 1][0].texture;
        this.blurMat.uniforms.dir.value.set(0, 0);
        r.setRenderTarget(a);
        r.render(this.blurQuad.scene, this.fsCamera);
      }
      this.blurMat.uniforms.tSrc.value = a.texture;
      this.blurMat.uniforms.dir.value.set(1 / a.width, 0);
      r.setRenderTarget(b);
      r.render(this.blurQuad.scene, this.fsCamera);
      this.blurMat.uniforms.tSrc.value = b.texture;
      this.blurMat.uniforms.dir.value.set(0, 1 / a.height);
      r.setRenderTarget(a);
      r.render(this.blurQuad.scene, this.fsCamera);
    }
    r.setRenderTarget(null);
    r.render(this.finalQuad.scene, this.fsCamera);
  }
}

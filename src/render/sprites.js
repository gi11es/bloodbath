// Instanced lit sprites (characters, gibs, props), environment material, and the 2D light list.
import * as THREE from 'three';

export const MAX_LIGHTS = 24;

// Shared light uniforms (all materials reference the same arrays).
export const lightUniforms = {
  lightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
  lightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
  lightRad: { value: new Array(MAX_LIGHTS).fill(1) },
  nLights: { value: 0 },
  ambient: { value: new THREE.Vector3(0.5, 0.45, 0.5) },
  rimCol: { value: new THREE.Vector3(1.0, 0.45, 0.25) },
  rimDir: { value: new THREE.Vector2(-0.6, 0.8) },
  time: { value: 0 },
};

// Frame light list. Each light: {x, y, z (height), r, g, b, radius}
export class Lights {
  constructor() { this.list = []; this.persistent = []; }
  add(x, y, color, intensity, radius, z = 1.2) {
    this.list.push({ x, y, z, r: color[0] * intensity, g: color[1] * intensity, b: color[2] * intensity, radius });
  }
  flush(camX, camY, viewW) {
    const all = this.list;
    // keep the lights nearest the camera
    all.sort((a, b) => Math.abs(a.x - camX) - Math.abs(b.x - camX));
    const n = Math.min(all.length, MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const l = all[i];
      lightUniforms.lightPos.value[i].set(l.x, l.y, l.z);
      lightUniforms.lightCol.value[i].set(l.r, l.g, l.b);
      lightUniforms.lightRad.value[i] = l.radius;
    }
    lightUniforms.nLights.value = n;
    this.list = [];
  }
}

const LIGHT_GLSL = /* glsl */ `
uniform vec3 lightPos[${MAX_LIGHTS}];
uniform vec3 lightCol[${MAX_LIGHTS}];
uniform float lightRad[${MAX_LIGHTS}];
uniform int nLights;
uniform vec3 ambient;
vec3 pointLights(vec2 wp, vec3 n) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= nLights) break;
    vec3 d = vec3(lightPos[i].xy - wp, lightPos[i].z);
    float dist = length(d.xy);
    float att = clamp(1.0 - dist / lightRad[i], 0.0, 1.0);
    att *= att;
    vec3 L = normalize(d);
    acc += lightCol[i] * att * (max(dot(n, L), 0.0) * 0.85 + 0.15);
  }
  return acc;
}`;

const NOISE_GLSL = /* glsl */ `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }`;

const SPRITE_VERT = /* glsl */ `
attribute vec4 iA;   // x, y, rot, z
attribute vec4 iB;   // sx, sy, -, -
attribute vec4 iUV;
attribute vec4 iTint;
attribute vec4 iFx;  // blood, flash, seed, emissive
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vWorld;
varying vec4 vTint;
varying vec4 vFx;
varying vec2 vRot;
varying float vFlip;
varying float vFade;
varying float vFlipY;
void main() {
  // mirrored sprites keep their winding: the quad stays positive, the texture is mirrored
  vec2 p = position.xy * abs(iB.xy);
  float c = cos(iA.z), s = sin(iA.z);
  vec2 w = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + iA.xy;
  vWorld = w;
  vec2 luv = vec2(iB.x < 0.0 ? 1.0 - uv.x : uv.x, iB.y < 0.0 ? 1.0 - uv.y : uv.y);
  vFade = iB.z;
  vUv = iUV.xy + luv * iUV.zw;
  vLocal = luv;
  vRot = vec2(c, s);
  vFlip = iB.x < 0.0 ? -1.0 : 1.0;
  vFlipY = iB.y < 0.0 ? -1.0 : 1.0;
  vTint = iTint;
  vFx = iFx;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, iA.w, 1.0);
}`;

const SPRITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform sampler2D nmap;
uniform vec3 rimCol;
uniform vec2 rimDir;
uniform float time;
uniform float useNormals;
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vWorld;
varying vec4 vTint;
varying vec4 vFx;
varying vec2 vRot;
varying float vFlip;
varying float vFade;
varying float vFlipY;
${LIGHT_GLSL}
${NOISE_GLSL}
void main() {
  vec4 tex = texture2D(map, vUv);
  float a = tex.a * vTint.a;
  if (vFade > 0.0) a *= smoothstep(vFade, vFade + 0.18, vLocal.x);
  if (a < 0.02) discard;
  vec3 n = vec3(0.0, 0.0, 1.0);
  if (useNormals > 0.5) {
    n = texture2D(nmap, vUv).xyz * 2.0 - 1.0;
    n.x *= vFlip;
    n.y *= vFlipY;
    n.xy = vec2(n.x * vRot.x - n.y * vRot.y, n.x * vRot.y + n.y * vRot.x);
    n = normalize(n);
  }
  vec3 base = tex.rgb * vTint.rgb;
  float spec = 0.0;
  float bl = vFx.x;
  if (bl > 0.001) {
    float nz = fbm(vLocal * 4.5 + vFx.z * 17.3);
    float m = smoothstep(1.0 - bl, 1.0 - bl + 0.1, nz * 0.85 + (1.0 - vLocal.y) * 0.25);
    vec3 bloodC = mix(vec3(0.42, 0.0, 0.02), vec3(0.22, 0.0, 0.01), nz);
    base = mix(base, bloodC * (0.7 + 0.5 * dot(tex.rgb, vec3(0.33))), m * 0.92);
    spec = m;
  }
  vec3 light = ambient * (0.55 + 0.45 * n.z) + pointLights(vWorld, n);
  float rim = pow(clamp(dot(n.xy, rimDir) * 1.3, 0.0, 1.0), 2.0) * (1.0 - n.z * 0.6);
  vec3 col = base * light + rimCol * rim * 0.9;
  col += spec * pow(clamp(dot(n, normalize(vec3(-0.3, 0.6, 0.75))), 0.0, 1.0), 12.0) * 0.5;
  col += base * vFx.w;
  col = mix(col, vec3(1.6, 1.45, 1.4), vFx.y * 0.75);
  gl_FragColor = vec4(col, a);
}`;

export function makeSpriteMaterial(map, nmap, { blending = THREE.NormalBlending } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending,
    uniforms: {
      ...lightUniforms,
      map: { value: map },
      nmap: { value: nmap || map },
      useNormals: { value: nmap ? 1 : 0 },
    },
  });
}

// Dynamic instanced quads.
export class SpriteBatch {
  constructor(material, capacity = 512) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const mk = (name) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.aA = mk('iA'); this.aB = mk('iB'); this.aUV = mk('iUV'); this.aTint = mk('iTint'); this.aFx = mk('iFx');
    g.instanceCount = 0;
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.n = 0;
  }
  begin() { this.n = 0; }
  // uv = [u, v, w, h]; tint = [r,g,b,a]
  add(x, y, rot, sx, sy, uv, tint, blood = 0, flash = 0, seed = 0, emissive = 0, fade = 0) {
    if (this.n >= this.capacity) return;
    const i = this.n++ * 4;
    const A = this.aA.array, B = this.aB.array, U = this.aUV.array, T = this.aTint.array, F = this.aFx.array;
    A[i] = x; A[i + 1] = y; A[i + 2] = rot; A[i + 3] = 0;
    B[i] = sx; B[i + 1] = sy; B[i + 2] = fade;
    U[i] = uv[0]; U[i + 1] = uv[1]; U[i + 2] = uv[2]; U[i + 3] = uv[3];
    if (tint) { T[i] = tint[0]; T[i + 1] = tint[1]; T[i + 2] = tint[2]; T[i + 3] = tint[3]; }
    else { T[i] = T[i + 1] = T[i + 2] = T[i + 3] = 1; }
    F[i] = blood; F[i + 1] = flash; F[i + 2] = seed; F[i + 3] = emissive;
  }
  end() {
    this.geometry.instanceCount = this.n;
    for (const a of [this.aA, this.aB, this.aUV, this.aTint, this.aFx]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * 4);
      a.needsUpdate = true;
    }
  }
}

// Environment material: parallax layers and terrain. 'world' uv mode tiles by world position.
const ENV_VERT = /* glsl */ `
uniform vec2 repeat;
uniform vec2 offset;
uniform float worldUV;
uniform vec2 tileSize;
uniform vec2 tileOffset;
varying vec2 vUv;
varying vec2 vWorld;
varying vec2 vLocal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xy;
  vLocal = uv;
  vUv = worldUV > 0.5 ? (wp.xy - tileOffset) / tileSize : uv * repeat + offset;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const ENV_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform vec3 tint;
uniform vec3 fogColor;
uniform float fog;
uniform float lightInfluence;
uniform float opacity;
uniform float bottomFade;
uniform float topFade;
uniform float emissiveBoost;
uniform float clampV;
varying vec2 vUv;
varying vec2 vWorld;
varying vec2 vLocal;
${LIGHT_GLSL}
void main() {
  vec2 uv = vUv;
  if (clampV > 0.5 && (uv.y < 0.0 || uv.y > 1.0)) discard;
  vec4 tex = texture2D(map, uv);
  float a = tex.a * opacity;
  a *= smoothstep(0.0, bottomFade + 1e-4, vLocal.y) ;
  a *= 1.0 - smoothstep(1.0 - topFade - 1e-4, 1.0, vLocal.y);
  if (a < 0.01) discard;
  vec3 col = tex.rgb * tint;
  // bright parts of painted layers (windows, fires) glow into the bloom
  float lum = max(tex.r, max(tex.g, tex.b));
  col += tex.rgb * smoothstep(0.75, 1.0, lum) * emissiveBoost;
  col = mix(col, fogColor, fog);
  if (lightInfluence > 0.0) col += tex.rgb * pointLights(vWorld, vec3(0.0, 0.0, 1.0)) * lightInfluence;
  gl_FragColor = vec4(col, a);
}`;

export function makeEnvMaterial(map, opts = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: ENV_VERT,
    fragmentShader: ENV_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      ...lightUniforms,
      map: { value: map },
      tint: { value: new THREE.Color(...(opts.tint || [1, 1, 1])) },
      fogColor: { value: new THREE.Color(...(opts.fogColor || [0, 0, 0])) },
      fog: { value: opts.fog ?? 0 },
      lightInfluence: { value: opts.lightInfluence ?? 0 },
      opacity: { value: opts.opacity ?? 1 },
      repeat: { value: new THREE.Vector2(1, 1) },
      offset: { value: new THREE.Vector2(0, 0) },
      worldUV: { value: opts.worldUV ? 1 : 0 },
      tileSize: { value: new THREE.Vector2(...(opts.tileSize || [4, 4])) },
      tileOffset: { value: new THREE.Vector2(...(opts.tileOffset || [0, 0])) },
      bottomFade: { value: opts.bottomFade ?? 0 },
      topFade: { value: opts.topFade ?? 0 },
      emissiveBoost: { value: opts.emissiveBoost ?? 0 },
      clampV: { value: opts.clampV ? 1 : 0 },
    },
  });
}

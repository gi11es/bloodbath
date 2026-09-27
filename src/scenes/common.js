import * as THREE from 'three';

// Full-screen painted image with Ken Burns motion and an optional noise-dissolve transition to a second image.
export const PANEL_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
export const PANEL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tA; uniform sampler2D tB;
uniform vec2 aspectA; uniform vec2 aspectB; // (imageAspect, screenAspect)
uniform vec3 camA; uniform vec3 camB;      // (scale, panX, panY)
uniform float mixv; uniform float time; uniform float bright; uniform float desat;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vn(p); p *= 2.02; a *= 0.5; } return v; }
vec2 cover(vec2 uv, vec2 asp, vec3 cam) {
  vec2 c = uv - 0.5;
  float r = asp.y / asp.x; // screen / image
  if (r > 1.0) c.y /= r; else c.x *= r;
  c /= cam.x;
  return c + 0.5 + cam.yz;
}
void main() {
  vec3 a = texture2D(tA, cover(vUv, aspectA, camA)).rgb;
  vec3 col = a;
  if (mixv > 0.0) {
    vec3 b = texture2D(tB, cover(vUv, aspectB, camB)).rgb;
    float n = fbm(vUv * vec2(4.0, 2.5) + time * 0.05);
    float edge = mixv * 1.3 - 0.15;
    float m = smoothstep(edge - 0.08, edge, n);
    float rim = smoothstep(0.1, 0.0, abs(n - edge + 0.04)) * step(0.001, mixv) * step(mixv, 0.999);
    col = mix(b, a, m) + vec3(1.6, 0.15, 0.05) * rim * 1.5;
  }
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l), desat);
  gl_FragColor = vec4(col * bright, 1.0);
}`;

export function makePanelMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: PANEL_VERT, fragmentShader: PANEL_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      tA: { value: null }, tB: { value: null }, aspectA: { value: new THREE.Vector2(16 / 9, 16 / 9) }, aspectB: { value: new THREE.Vector2(16 / 9, 16 / 9) },
      camA: { value: new THREE.Vector3(1, 0, 0) }, camB: { value: new THREE.Vector3(1, 0, 0) }, mixv: { value: 0 }, time: { value: 0 }, bright: { value: 1 }, desat: { value: 0 },
    },
  });
}

export function imgAspect(t) { return t && t.image && t.image.width ? t.image.width / t.image.height : 16 / 9; }

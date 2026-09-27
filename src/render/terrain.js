import * as THREE from 'three';
import { loadTexture } from '../core/assets.js';
import { lightUniforms } from './sprites.js';

const VERT = /* glsl */ `
uniform vec2 tileSize;
uniform float yOrigin;
varying vec2 vUv;
varying vec2 vWorld;
varying vec2 vLocal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xy; vLocal = uv;
  vUv = vec2(wp.x / tileSize.x, (wp.y - yOrigin) / tileSize.y);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform vec3 tint;
uniform float top;
uniform float depthDark;
uniform float clampV;
uniform float sideFade;
uniform vec2 xRange;
varying vec2 vUv;
varying vec2 vWorld;
varying vec2 vLocal;
uniform vec3 lightPos[24];
uniform vec3 lightCol[24];
uniform float lightRad[24];
uniform int nLights;
uniform vec3 ambient;
void main() {
  if (clampV > 0.5 && (vUv.y < 0.0 || vUv.y > 1.0)) discard;
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.02) discard;
  vec3 col = t.rgb * tint;
  float depth = clamp((top - vWorld.y) / 3.5, 0.0, 1.0);
  col *= mix(1.0, 0.35, depth * depthDark);
  // darken near the side walls of a block
  float side = min(vWorld.x - xRange.x, xRange.y - vWorld.x);
  col *= mix(0.55, 1.0, clamp(side / 0.6, 0.0, 1.0) * sideFade + (1.0 - sideFade));
  vec3 lit = ambient * 1.25;
  for (int i = 0; i < 24; i++) {
    if (i >= nLights) break;
    vec2 d = lightPos[i].xy - vWorld;
    float att = clamp(1.0 - length(d) / lightRad[i], 0.0, 1.0);
    lit += lightCol[i] * att * att * 0.9;
  }
  gl_FragColor = vec4(col * lit, t.a);
}`;

function mat(tex, opts) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      map: { value: tex }, tint: { value: new THREE.Color(...(opts.tint || [1, 1, 1])) },
      tileSize: { value: new THREE.Vector2(...opts.tileSize) }, yOrigin: { value: opts.yOrigin || 0 },
      top: { value: opts.top ?? 0 }, depthDark: { value: opts.depthDark ?? 1 }, clampV: { value: opts.clampV ? 1 : 0 },
      sideFade: { value: opts.sideFade ?? 0 }, xRange: { value: new THREE.Vector2(...(opts.xRange || [-1e5, 1e5])) },
      lightPos: lightUniforms.lightPos, lightCol: lightUniforms.lightCol, lightRad: lightUniforms.lightRad,
      nLights: lightUniforms.nLights, ambient: lightUniforms.ambient,
    },
  });
}

export async function buildTerrain(scene, world, theme) {
  const [fill, top, plat] = await Promise.all([
    loadTexture(theme.groundFill, { repeat: true }),
    loadTexture(theme.groundTop, { repeat: true }),
    loadTexture(theme.platform, { repeat: true }),
  ]);
  const group = new THREE.Group();
  const T = theme.terrain || {};
  for (const s of world.solids) {
    if (s.invisible) continue;
    const topY = s.y + s.h;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat(fill, { tileSize: [4, 4], top: topY, tint: T.fillTint, sideFade: 1, xRange: [s.x, s.x + s.w] }));
    m.position.set(s.x + s.w / 2, s.y + s.h / 2, 0);
    m.renderOrder = 30;
    group.add(m);
    if (s.noTop) continue;
    const tm = new THREE.Mesh(new THREE.PlaneGeometry(s.w + 0.3, 2), mat(top, { tileSize: [8, 2], yOrigin: topY - 1.4, top: topY + 0.6, depthDark: 0, clampV: true, tint: T.topTint }));
    tm.position.set(s.x + s.w / 2, topY - 0.4, 0);
    tm.renderOrder = 31;
    group.add(tm);
  }
  for (const p of world.platforms) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(p.w, 1), mat(plat, { tileSize: [8, 1], yOrigin: p.y - 0.88, top: p.y + 1, depthDark: 0, clampV: true, tint: T.platTint }));
    pm.position.set(p.x + p.w / 2, p.y - 0.38, 0);
    pm.renderOrder = 32;
    group.add(pm);
  }
  scene.add(group);
  return group;
}

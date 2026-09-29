import * as THREE from 'three';
import { loadTexture } from '../core/assets.js';
import { makeEnvMaterial } from './sprites.js';

// Parallax layers. factor: 0 = fixed to camera (infinitely far), 1 = moves with the world, >1 = foreground.
export class Backdrop {
  constructor(scene, theme) {
    this.layers = [];
    this.scene = scene;
    this.theme = theme;
    this.ready = Promise.all(theme.layers.map((L, i) => this.addLayer(L, i)));
  }
  async addLayer(L, i) {
    const tex = await loadTexture(L.src, { repeat: !L.sky });
    if (L.sky) { tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; }
    else { tex.wrapT = THREE.ClampToEdgeWrapping; }
    tex.needsUpdate = true;
    const img = tex.image;
    const aspect = img && img.width ? img.width / img.height : 3;
    const mat = makeEnvMaterial(tex, {
      tint: L.tint, fogColor: L.fogColor || [0, 0, 0], fog: L.fog || 0, lightInfluence: L.light ?? 0,
      opacity: L.opacity ?? 1, emissiveBoost: L.glow ?? 0, clampV: !L.sky, topFade: L.topFade ?? 0, bottomFade: L.bottomFade ?? 0,
      highlightCompression: L.highlightCompression ?? (L.sky ? 0.55 : L.factor < 1 ? 0.75 : 0),
      backgroundDim: L.backgroundDim ?? (L.sky ? 0.74 : L.factor < 0.25 ? 0.68 : L.factor < 1 ? 0.65 : 0.85),
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = L.order ?? i;
    this.scene.add(mesh);
    this.layers.push({ ...L, mesh, mat, worldH: L.h, worldW: L.h * aspect });
  }
  update(camX, camY, viewW, viewH) {
    for (const L of this.layers) {
      const m = L.mesh;
      if (L.sky) {
        // cover the view; slight parallax drift
        const h = viewH * (L.overscan || 1.15), w = Math.max(viewW * 1.15, h * (L.worldW / L.worldH));
        const hh = Math.max(h, w / (L.worldW / L.worldH));
        m.scale.set(w, hh, 1);
        m.position.set(camX - camX * (L.factor || 0) * 0.0 , camY + (L.yOff || 0), 0);
        const u = L.uniformsSet || (L.uniformsSet = true);
        m.material.uniforms.repeat.value.set(1, 1);
        m.material.uniforms.offset.value.set(0, 0);
        continue;
      }
      const f = L.factor;
      const PW = viewW + 2;
      m.scale.set(PW, L.worldH, 1);
      const yb = L.y + (camY - 3) * (1 - f); // L.y = layer bottom when the camera is at its rest height
      m.position.set(camX, yb + L.worldH / 2, 0);
      m.material.uniforms.repeat.value.set(PW / L.worldW, 1);
      m.material.uniforms.offset.value.set((camX * f - PW / 2) / L.worldW + (L.u0 || 0), 0);
    }
  }
}

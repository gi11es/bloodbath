import * as THREE from 'three';
import { maxTextureDim } from './device.js';

const loader = new THREE.TextureLoader();
const cache = new Map();
const jsonCache = new Map();
let placeholder = null;

function getPlaceholder() {
  if (!placeholder) {
    const d = new Uint8Array([0, 0, 0, 0]);
    placeholder = new THREE.DataTexture(d, 1, 1);
    placeholder.needsUpdate = true;
  }
  return placeholder;
}

// Returns a promise of a texture; missing files resolve to a transparent placeholder.
export function loadTexture(url, { srgb = true, repeat = false, mipmaps = true } = {}) {
  const key = url + (repeat ? '#r' : '');
  if (cache.has(key)) return cache.get(key);
  const p = new Promise((resolve) => {
    loader.load(url, (t) => {
      // phones: downscale huge paintings once at load to keep GPU memory reasonable
      const img = t.image;
      if (img && Math.max(img.width, img.height) > maxTextureDim) {
        const k = maxTextureDim / Math.max(img.width, img.height);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        const cx = cv.getContext('2d');
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        t.image = cv;
      }
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
      t.generateMipmaps = mipmaps;
      t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      resolve(t);
    }, undefined, () => { console.warn('missing texture', url); resolve(getPlaceholder()); });
  });
  cache.set(key, p);
  return p;
}

export async function loadJSON(url) {
  if (jsonCache.has(url)) return jsonCache.get(url);
  const p = fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  jsonCache.set(url, p);
  return p;
}

export function isPlaceholder(t) { return t === placeholder; }

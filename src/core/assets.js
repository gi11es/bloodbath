import * as THREE from 'three';

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

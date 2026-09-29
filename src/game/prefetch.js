import { loadJSON, loadTexture } from '../core/assets.js';
import { THEMES } from './themes.js';
import { themePropTypes } from './levelgen.js';

// Warm the actual texture cache while the title is on screen. Every request is
// reused by Game.load; prefetch stops between batches when the menu is left.
export async function prefetchMenuAssets(active) {
  const names = ['hero', 'grunt', 'leaper', 'butcher'];
  await Promise.all(names.map(async (name) => {
    const d = await loadJSON(`assets/chars/${name}.json`);
    if (!d) return;
    await Promise.all([
      loadTexture(d.atlas), loadTexture(d.normal, { srgb: false }),
      loadTexture(`assets/chars/${name}_shadow.png`, { srgb: false }),
    ]);
  }));
  if (!active()) return;

  await Promise.all(THEMES.stage1.layers.map((layer) => loadTexture(layer.src, { repeat: !layer.sky })));
  if (!active()) return;

  const first = ['sandbags', 'lamp_post', 'legion_banner', 'crate', 'car_wreck'];
  const types = [...new Set([...first, ...themePropTypes('stage1')])];
  for (let i = 0; i < types.length; i += 4) {
    if (!active()) return;
    await Promise.all(types.slice(i, i + 4).map((type) => loadTexture(`assets/props/${type}.webp`)));
  }
  if (active()) await Promise.all(['h', 's', 'r', 'grenade', 'health'].map((k) => loadTexture(`assets/props/pickup_${k}.webp`)));
}

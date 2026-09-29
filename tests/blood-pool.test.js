import { describe, expect, it } from 'vitest';
import { Pool } from '../src/game/blood.js';

describe('blood pool rendering', () => {
  it('draws wet cells only and hides the pool after it drains', () => {
    const pool = new Pool({ x0: 0, x1: 2, y: 0 });
    pool.mesh = { visible: true };
    pool.active = true;
    pool.vol[5] = 0.5;
    pool.fresh[5] = 1;
    pool.rebuild();
    const positions = pool.geom.attributes.position.array;
    const fresh = pool.geom.attributes.fresh.array;
    expect(positions[1]).toBe(positions[4]); // dry cell has no drawable height
    expect(fresh[0]).toBe(0);
    expect(positions[5 * 6 + 4]).toBeGreaterThan(positions[5 * 6 + 1]);
    expect(fresh[5 * 2]).toBeGreaterThan(0);
    pool.vol.fill(0);
    pool.update(1 / 60);
    expect(pool.active).toBe(false);
    expect(pool.mesh.visible).toBe(false);
    pool.geom.dispose();
  });
});

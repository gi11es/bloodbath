import { describe, it, expect } from 'vitest';
import { generateStage, validate } from '../src/game/levelgen.js';

describe('level generator', () => {
  for (const stage of ['stage1', 'stage2']) {
    it(`${stage}: 300 random seeds are all completable`, () => {
      for (let seed = 1; seed <= 300; seed++) {
        const L = generateStage(stage, seed);
        const v = validate(L);
        if (!v.ok) throw new Error(`seed ${seed}: ${JSON.stringify(v)}`);
      }
    });
    it(`${stage}: same seed gives the same level`, () => {
      const a = generateStage(stage, 42), b = generateStage(stage, 42);
      expect(JSON.stringify(a.solids)).toBe(JSON.stringify(b.solids));
      expect(a.props.length).toBe(b.props.length);
    });
    it(`${stage}: has 3 arenas, an end and plenty of decor`, () => {
      const L = generateStage(stage, 7);
      expect(L.events.filter((e) => e.type === 'arena').length).toBe(3);
      expect(L.events.some((e) => e.type === 'end')).toBe(true);
      expect(L.props.length / L.length).toBeGreaterThan(0.25);
    });
    it(`${stage}: raised cover and crates stand fully on their ledges`, () => {
      const aspect = { sandbags: 1154 / 349, s1_fence: 1132 / 356, s2_pews: 1200 / 331, crate: 935 / 599 };
      for (let seed = 1; seed <= 300; seed++) {
        const L = generateStage(stage, seed);
        for (const p of L.props.filter((p) => p.y > 0 && (p.layer === 'front' || p.type === 'crate'))) {
          const halfW = p.h * aspect[p.type] / 2;
          const supported = L.solids.some((s) => Math.abs(s.y + s.h - p.y) < 0.01 &&
            p.x - halfW >= s.x - 0.05 && p.x + halfW <= s.x + s.w + 0.05) ||
            L.platforms.some((s) => Math.abs(s.y - p.y) < 0.01 &&
              p.x - halfW >= s.x - 0.05 && p.x + halfW <= s.x + s.w + 0.05);
          if (!supported) throw new Error(`${stage} seed ${seed}: unsupported ${p.type} at ${p.x}, ${p.y}`);
        }
      }
    });
  }
});

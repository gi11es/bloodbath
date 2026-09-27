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
  }
});

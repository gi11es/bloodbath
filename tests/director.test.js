import { describe, it, expect } from 'vitest';
import { Director } from '../src/game/director.js';

const tick = (d, secs, ctx = {}) => {
  for (let t = 0; t < secs; t += 0.1) d.update(0.1, { threatsNear: 0, playerHpFrac: 1, activeEnemies: 2, ...ctx });
};

describe('Director', () => {
  it('raises skill when the player kills fast and takes no damage', () => {
    const d = new Director();
    const s0 = d.skill;
    for (let i = 0; i < 20; i++) { d.onEnemyKilled(2); for (let j = 0; j < 5; j++) d.onShot(true); tick(d, 3); }
    expect(d.skill).toBeGreaterThan(s0 + 0.15);
  });

  it('lowers skill when the player takes heavy damage', () => {
    const d = new Director();
    const s0 = d.skill;
    for (let i = 0; i < 20; i++) { d.onPlayerDamaged(15, 0.5); for (let j = 0; j < 5; j++) d.onShot(false); tick(d, 3); }
    expect(d.skill).toBeLessThan(s0 - 0.15);
  });

  it('applies an immediate mercy drop on death', () => {
    const d = new Director();
    const s0 = d.skill;
    d.onPlayerDeath();
    expect(d.skill).toBeLessThan(s0 - 0.08);
  });

  it('moves to RELAX after intensity peaks and stops spawning', () => {
    const d = new Director();
    for (let i = 0; i < 12; i++) { d.onPlayerDamaged(12, 0.6); tick(d, 0.5, { threatsNear: 4 }); }
    tick(d, 8, { threatsNear: 4 });
    expect(d.state).toBe('RELAX');
    expect(d.wantSpawn(0)).toBe(false);
  });

  it('returns to BUILD_UP after relaxing', () => {
    const d = new Director();
    for (let i = 0; i < 12; i++) { d.onPlayerDamaged(12, 0.6); tick(d, 0.5, { threatsNear: 4 }); }
    tick(d, 8, { threatsNear: 4 });
    expect(d.state).toBe('RELAX');
    tick(d, 20);
    expect(d.state).toBe('BUILD_UP');
  });

  it('produces harder knobs for higher skill', () => {
    const lo = new Director({ mode: 'easy' }).knobs;
    const hi = new Director({ mode: 'hard' }).knobs;
    expect(hi.maxAlive).toBeGreaterThan(lo.maxAlive);
    expect(hi.spawnInterval).toBeLessThan(lo.spawnInterval);
    expect(hi.accuracy).toBeGreaterThan(lo.accuracy);
    expect(hi.reactionTime).toBeLessThan(lo.reactionTime);
    expect(hi.healthDropChance).toBeLessThan(lo.healthDropChance);
  });

  it('keeps skill fixed in a fixed mode', () => {
    const d = new Director({ mode: 'normal' });
    const s0 = d.skill;
    d.onPlayerDeath();
    for (let i = 0; i < 10; i++) { d.onEnemyKilled(1); tick(d, 2); }
    expect(d.skill).toBe(s0);
  });

  it('respects maxAlive in wantSpawn', () => {
    const d = new Director({ mode: 'normal' });
    tick(d, 10);
    expect(d.wantSpawn(99)).toBe(false);
  });

  it('gives mercy knobs when the player is at low health', () => {
    const d = new Director({ mode: 'normal' });
    tick(d, 1, { playerHpFrac: 1 });
    const a = d.knobs.accuracy;
    tick(d, 1, { playerHpFrac: 0.15 });
    expect(d.knobs.accuracy).toBeLessThan(a);
  });

  it('only unlocks butchers at higher skill', () => {
    expect(new Director({ mode: 'easy' }).knobs.mix.butcher).toBe(0);
    expect(new Director({ mode: 'hard' }).knobs.mix.butcher).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import { Score, rankFor } from '../src/game/score.js';

describe('Score', () => {
  it('counts litres and awards points', () => {
    const s = new Score();
    s.addBlood(1, false);
    expect(s.litres).toBeCloseTo(1);
    expect(s.points).toBeGreaterThan(0);
  });
  it('gives a bonus for blood spilled by living enemies', () => {
    const a = new Score(), b = new Score();
    a.addBlood(0.5, false); b.addBlood(0.5, true);
    expect(b.points).toBeGreaterThan(a.points);
    expect(b.livingLitres).toBeCloseTo(0.5);
  });
  it('raises the multiplier with a fast spill rate and decays it over time', () => {
    const s = new Score();
    for (let i = 0; i < 20; i++) s.addBlood(0.3, false);
    expect(s.mult).toBeGreaterThan(3);
    for (let i = 0; i < 200; i++) s.update(0.1);
    expect(s.mult).toBeLessThan(1.2);
  });
  it('caps the multiplier at 8', () => {
    const s = new Score();
    for (let i = 0; i < 200; i++) s.addBlood(1, false);
    expect(s.mult).toBeLessThanOrEqual(8);
    expect(s.maxMult).toBeLessThanOrEqual(8);
  });
  it('tracks events', () => {
    const s = new Score();
    s.addEvent('kill'); s.addEvent('dismember'); s.addEvent('execution');
    expect(s.kills).toBe(1); expect(s.dismembers).toBe(1); expect(s.executions).toBe(1);
  });
  it('ranks by litres per kill and points', () => {
    expect(rankFor({ points: 10, litres: 0.1, kills: 10 })).toBe('C');
    expect(rankFor({ points: 999999, litres: 200, kills: 30 })).toBe('S');
  });
});

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = invLerp(a, b, v); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const sign = (v) => (v < 0 ? -1 : 1);
export const TAU = Math.PI * 2;
export const angleWrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
export const dampAngle = (a, b, lambda, dt) => a + angleWrap(b - a) * (1 - Math.exp(-lambda * dt));
export const len = (x, y) => Math.sqrt(x * x + y * y);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// Two-bone IK in 2D. Returns [angle1, angle2] (absolute angles) for bones of length l1, l2 from
// origin (ox, oy) to target (tx, ty). bend = +1 or -1 selects the elbow side.
export function ik2(ox, oy, tx, ty, l1, l2, bend) {
  let dx = tx - ox, dy = ty - oy;
  let d = Math.sqrt(dx * dx + dy * dy);
  const maxD = (l1 + l2) * 0.9995;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-4);
  const base = Math.atan2(dy, dx);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const a1 = base + bend * Math.acos(cosA);
  const ex = ox + Math.cos(a1) * l1, ey = oy + Math.sin(a1) * l1;
  const a2 = Math.atan2(oy + dy - ey, ox + dx - ex);
  return [a1, a2];
}

// Seeded RNG (mulberry32)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

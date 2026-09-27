// Roguelike stage generator. A stage is a chain of hand-designed chunk templates with random
// parameters. Every chunk starts and ends on flat ground at y = 0, and every rise is within the
// hero's jump envelope (single jump ~2.2 m, double jump ~4 m, gaps <= 4 m with a landing platform),
// so any generated stage can be completed.
import { rng as mulberry } from '../core/math.js';

const GROUND_BOTTOM = -8;

// prop pools per theme: [type, height m, weight, opts]
const POOLS = {
  stage1: {
    back: [
      ['lamp_post', 4.6, 3, { light: [0.6, 4.1, [1.0, 0.65, 0.3], 2.2, 7, 0.15] }],
      ['legion_banner', 5.0, 3], ['dead_tree', 5.5, 2], ['car_wreck', 1.8, 2, { fire: true }], ['ruined_wall', 4.2, 2],
      ['crate', 1.1, 3], ['harvester', 3.4, 1, { blood: 4, hp: 80, light: [0, 2, [1.0, 0.1, 0.1], 1.6, 5, 0.1] }],
      ['s1_well', 2.6, 2], ['s1_cart', 1.3, 2], ['s1_tank_wreck', 2.4, 1, { fire: true }], ['s1_fence', 1.1, 3], ['s1_barricade', 1.4, 2],
      ['s1_signpost', 2.6, 2], ['s1_hay', 1.5, 2], ['s1_corpse_pile', 1.0, 2], ['s1_cage', 2.2, 1, { blood: 1.5, hp: 40 }],
      ['s1_street_shrine', 2.2, 2, { light: [0, 0.8, [1.0, 0.6, 0.3], 1.2, 3, 0.25] }], ['s1_radio_mast', 9.0, 1], ['s1_tree_burnt', 6.0, 2],
    ],
    front: [['sandbags', 0.9, 3], ['s1_fence', 1.1, 1]],
    explosive: ['barrel_red', 1.2],
  },
  stage2: {
    back: [
      ['pillar', 9, 3], ['chain_hook', 5.5, 2, { hang: true }], ['blood_vat', 4.5, 2, { blood: 8, hp: 60, glass: true, light: [0, 2.2, [1.0, 0.1, 0.12], 2.2, 6, 0.1] }],
      ['organ_pipes', 7, 1], ['candelabra', 2.2, 3, { light: [0, 2.1, [1.0, 0.6, 0.3], 1.8, 5, 0.2] }], ['altar', 1.6, 1],
      ['s2_statue', 4.2, 2], ['s2_pews', 1.1, 3], ['s2_brazier', 1.6, 2, { fire: 0.9, light: [0, 1.4, [1.0, 0.5, 0.2], 2.2, 6, 0.3] }],
      ['s2_pipes', 3.2, 2], ['s2_reliquary', 1.7, 1], ['s2_font', 1.3, 2, { blood: 2, hp: 50 }], ['s2_gear', 3.0, 1], ['s2_coffin', 2.3, 2],
      ['s2_banner_stand', 4.5, 2], ['s2_skull_pile', 1.1, 2, { light: [0, 0.6, [1.0, 0.6, 0.3], 1.0, 3, 0.25] }],
      ['s2_pump', 2.8, 1, { blood: 3, hp: 60, light: [0, 1.4, [1.0, 0.1, 0.1], 1.4, 4, 0.1] }], ['s2_lectern', 1.5, 2],
    ],
    front: [['s2_pews', 1.1, 1]],
    explosive: ['barrel_red', 1.2],
  },
};

function makeBuilder(theme, seed) {
  const R = mulberry(seed);
  const L = { theme, seed, solids: [], platforms: [], props: [], events: [], lights: [], fires: [], hints: [], pits: [] };
  L.R = R;
  L.rand = (a, b) => a + R() * (b - a);
  L.randi = (a, b) => Math.floor(L.rand(a, b + 1));
  L.chance = (p) => R() < p;
  L.pick = (arr) => arr[Math.floor(R() * arr.length)];
  L.ground = (x0, x1, top = 0) => L.solids.push({ x: x0, y: GROUND_BOTTOM, w: x1 - x0, h: top - GROUND_BOTTOM });
  L.block = (x, y, w, h, o = {}) => L.solids.push({ x, y, w, h, ...o });
  L.plat = (x, y, w) => L.platforms.push({ x, y, w });
  L.ev = (type, x, o = {}) => L.events.push({ type, x, ...o });
  L.light = (x, y, color, intensity, radius, flicker = 0) => L.lights.push({ x, y, color, intensity, radius, flicker });
  L.fire = (x, y, s = 0.3) => L.fires.push({ x, y, s });
  L.hint = (x, text) => L.hints.push({ x, text });
  const pool = POOLS[theme];
  const weighted = (list) => {
    const tot = list.reduce((a, p) => a + p[2], 0);
    let r = R() * tot;
    for (const p of list) if ((r -= p[2]) < 0) return p;
    return list[0];
  };
  // place a prop standing on the surface y; registers its light/fire/destructible data
  L.prop = (type, x, y, h, layer = 'back', o = {}) => {
    L.props.push({ type, x, y, h, layer, flip: L.chance(0.5), ...o });
    if (o.light) { const [dx, dy, c, i, r, fl] = o.light; L.light(x + dx, y + dy, c, i, r, fl); }
    if (o.fire) { const s = typeof o.fire === 'number' ? o.fire : 1; L.fire(x - 0.5 * s, y + 1.0 * s, 0.3 * s); L.fire(x + 0.4 * s, y + 0.9 * s, 0.25 * s); L.light(x, y + 1.5 * s, [1.0, 0.45, 0.15], 2.6, 7, 0.35); }
  };
  L.decorate = (x0, x1, y = 0, density = 1) => {
    // twice the old density: a background prop every ~2.5-4.5 m
    let x = x0 + L.rand(0.6, 2);
    while (x < x1 - 0.6) {
      const [type, h, , o] = weighted(pool.back);
      const hh = h * L.rand(0.9, 1.1);
      L.prop(type, x, o?.hang ? y + L.rand(3, 4) : y, hh, 'back', { ...(o || {}) });
      x += L.rand(2.3, 4.2) / density;
    }
    if (L.chance(0.35)) { const [type, h] = weighted(pool.front); L.prop(type, L.rand(x0 + 1, x1 - 1), y, h, 'front'); }
  };
  L.barrel = (x, y = 0) => L.prop(pool.explosive[0], x, y, pool.explosive[1], 'back', { explosive: true, hp: 20 });
  return L;
}

// ---------------------------------------------------------------- chunks (return the chunk width)
const CHUNKS = {
  street(L, x) {
    const w = L.randi(10, 16);
    L.ground(x, x + w);
    L.decorate(x, x + w);
    if (L.chance(0.3)) L.barrel(x + L.rand(2, w - 2));
    return w;
  },
  steps(L, x) {
    // rubble staircase up to a ledge and back down
    const w = L.randi(14, 18);
    L.ground(x, x + w);
    const h1 = L.rand(0.8, 1.2), h2 = h1 + L.rand(0.8, 1.3);
    const a = x + L.rand(2, 3);
    L.block(a, 0, 3, h1);
    L.block(a + 3, 0, L.rand(3.5, 5), h2);
    const top = a + 3;
    L.decorate(top, top + 3.5, h2, 0.8);
    L.decorate(x, a, 0, 1);
    if (L.chance(0.5)) L.prop('sandbags', a + 1.5, h1, 0.9, 'front');
    return w;
  },
  platforms(L, x) {
    const w = L.randi(14, 20);
    L.ground(x, x + w);
    const n = L.randi(1, 3);
    for (let i = 0; i < n; i++) {
      const px = x + 2 + (i * (w - 6)) / Math.max(1, n - 1 || 1) + L.rand(-0.5, 0.5);
      const py = L.pick([2.4, 2.8, 3.2]);
      L.plat(Math.min(px, x + w - 5.5), py, L.rand(3.5, 5));
      if (L.chance(0.5)) L.prop('crate', px + 1.5, py, 1.0, 'back');
    }
    if (n >= 2 && L.chance(0.5)) L.plat(x + w / 2 - 2, 5.2, 4);
    L.decorate(x, x + w);
    return w;
  },
  pit(L, x, theme) {
    // a gap with a platform in the middle; stage 2 fills it with blood
    const w = L.randi(13, 16);
    const g0 = x + L.rand(3.5, 5), gap = L.rand(3.5, 5.5);
    L.ground(x, g0);
    L.ground(g0 + gap, x + w);
    L.block(g0 - 2.5, 0, 2.5, L.rand(0.9, 1.4));
    L.plat(g0 + gap / 2 - 1.5, L.rand(2.2, 2.8), 3);
    if (theme === 'stage2') L.pits.push({ x0: g0, x1: g0 + gap, y: -1.5, blood: true });
    L.decorate(g0 + gap, x + w);
    L.hint(g0 - 4, theme === 'stage2' ? 'THE PIT IS FULL OF BLOOD. DO NOT FALL IN.' : 'DOUBLE JUMP ACROSS');
    return w;
  },
  climb(L, x) {
    // a tall wall with a step and a platform: wall-jump is a shortcut, not a requirement
    const w = L.randi(14, 17);
    L.ground(x, x + w);
    const a = x + L.rand(3, 4);
    const hWall = L.rand(3.6, 4.4);
    L.block(a, 0, 1.8, 1.8);
    L.block(a + 1.8, 0, 1.4, hWall);
    L.plat(a - 2.5, 3.0, 2.2);
    L.block(a + 3.2, 0, L.rand(3, 4), hWall - L.rand(1.5, 2));
    L.decorate(x, a - 0.5);
    L.decorate(a + 7, x + w);
    L.hint(a - 3, 'JUMP INTO A WALL TO WALL-SLIDE, JUMP AGAIN TO WALL-JUMP');
    return w;
  },
  bunker(L, x) {
    const w = L.randi(12, 15);
    L.ground(x, x + w);
    const a = x + L.rand(3, 5);
    L.block(a, 0, L.rand(4, 6), L.rand(1.0, 1.4));
    L.prop('sandbags', a + 0.8, 1.2, 0.9, 'front');
    L.barrel(a - 1.2);
    L.decorate(x, x + w);
    L.ev('ambush', a - 3, { spawns: [{ type: L.pick(['grunt', 'shotgunner', 'grenadier']), dx: 9 }, { type: 'grunt', dx: 11, delay: 0.6 }, { type: L.pick(['leaper', 'grunt', 'sniper']), dx: -8, delay: 1.3 }] });
    return w;
  },
  arena(L, x, theme, idx, cfg) {
    const w = L.randi(32, 38);
    L.ground(x, x + w);
    const m = x + w / 2;
    const off = L.rand(6, 9);
    const py = L.pick([2.6, 2.8, 3.0]);
    L.plat(m - off - 2.5, py, L.rand(4, 5));
    L.plat(m + off - 2, py, L.rand(4, 5));
    if (L.chance(0.7)) L.plat(m - 2, py + 2.4, 4);
    if (L.chance(0.5)) L.block(m - 1.5, 0, 3, L.rand(0.8, 1.2));
    L.barrel(m - L.rand(3, 5)); L.barrel(m + L.rand(3, 5));
    L.decorate(x, x + w, 0, 1.1);
    L.ev('checkpoint', x + 1.5);
    const labels = theme === 'stage1' ? ['VILLAGE SQUARE', 'HARVEST YARD', 'THE GATE', 'THE MARKET', 'THE DEPOT'] : ['THE NAVE', 'THE CHOIR', 'THE CRYPT', 'THE FOUNDRY', 'THE ORGAN LOFT'];
    L.ev('arena', m, { x0: x + 1, x1: x + w - 1, kills: cfg.kills[idx], label: L.pick(labels), butcher: idx > 0 || theme !== 'stage1' });
    L.ev('pickup', x + w - 1.5, { kind: L.pick(['H', 'S', 'R', 'G']), y: 0.5 });
    return w;
  },
};

const STAGE_CFG = {
  stage1: { name: 'MISSION 1', subtitle: 'ASHEN OUTSKIRTS', arenas: 3, between: [2, 3], kills: [9, 13, 17], chunks: ['street', 'steps', 'platforms', 'pit', 'climb', 'bunker'] },
  stage2: { name: 'MISSION 2', subtitle: 'RUST CATHEDRAL', arenas: 3, between: [2, 3], kills: [12, 15, 19], chunks: ['street', 'steps', 'platforms', 'pit', 'pit', 'climb', 'bunker'] },
};

export function generateStage(stageId, seed = (Math.random() * 2 ** 31) | 0) {
  const cfg = STAGE_CFG[stageId];
  const L = makeBuilder(stageId, seed);
  L.name = cfg.name;
  L.subtitle = cfg.subtitle;
  L.spawn = { x: 3, y: 0 };
  let x = -10;
  // opening: a calm street with the tutorial
  L.ground(x, 18);
  L.decorate(2, 18);
  if (stageId === 'stage1') {
    L.hint(2, 'A / D  MOVE     SPACE  JUMP (x2)     MOUSE  AIM     LMB  SHOOT');
    L.hint(9, 'SHIFT  DASH (invulnerable)     RMB  MACHETE (deflects bolts)');
    L.hint(15, 'Q  GRENADE     S + SPACE  DROP     E  EXECUTE bleeding enemies');
  }
  x = 18;
  let last = null;
  for (let a = 0; a < cfg.arenas; a++) {
    const n = L.randi(cfg.between[0], cfg.between[1]);
    for (let i = 0; i < n; i++) {
      let c;
      do { c = L.pick(cfg.chunks); } while (c === last && cfg.chunks.length > 1);
      last = c;
      x += CHUNKS[c](L, x, stageId);
    }
    if (a > 0 || L.chance(0.5)) L.ev('checkpoint', x - 2);
    x += CHUNKS.arena(L, x, stageId, a, cfg);
  }
  // finish line
  L.ground(x, x + 16);
  L.decorate(x, x + 12);
  L.ev('end', x + 8);
  x += 16;
  L.length = x;
  L.bounds = { x0: -2, x1: x, y0: -8, y1: 14 };
  return L;
}

// Reachability check used by tests: every walkable surface must be reachable from the spawn
// with the hero's movement envelope.
export function validate(L, { jumpH = 3.8, gapX = 6.5 } = {}) {
  const surfaces = [];
  for (const s of L.solids) surfaces.push({ x0: s.x, x1: s.x + s.w, y: s.y + s.h });
  for (const p of L.platforms) surfaces.push({ x0: p.x, x1: p.x + p.w, y: p.y });
  // the ground line must be continuous except for pits that have a stepping platform
  const reach = new Set([0]);
  const start = surfaces.findIndex((s) => L.spawn.x >= s.x0 && L.spawn.x <= s.x1 && Math.abs(s.y - L.spawn.y) < 0.05);
  reach.clear(); reach.add(start);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < surfaces.length; i++) {
      if (reach.has(i)) continue;
      for (const j of reach) {
        const a = surfaces[j], b = surfaces[i];
        const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
        const dy = b.y - a.y;
        if (dx <= gapX && dy <= jumpH) { reach.add(i); changed = true; break; }
      }
    }
  }
  const endEv = L.events.find((e) => e.type === 'end');
  const endOk = [...reach].some((i) => endEv.x >= surfaces[i].x0 && endEv.x <= surfaces[i].x1);
  return { ok: endOk && reach.size === surfaces.length, reachable: reach.size, total: surfaces.length, endOk };
}

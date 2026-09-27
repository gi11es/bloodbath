// Level collision: solid AABBs + one-way platforms, spatial grid, actor movement, raycasts.
const CELL = 2;

export class World {
  constructor(solids, platforms, bounds) {
    this.solids = solids; // {x, y, w, h}  (x,y = min corner)
    this.platforms = platforms; // {x, y, w}  (y = walkable top)
    this.bounds = bounds; // {x0, x1, y0, y1}
    this.buildGrid();
    this.surfaces = this.computeSurfaces();
  }

  buildGrid() {
    const b = this.bounds;
    this.gx0 = Math.floor(b.x0 / CELL) - 1;
    this.gy0 = Math.floor(b.y0 / CELL) - 1;
    this.gw = Math.ceil((b.x1 - b.x0) / CELL) + 3;
    this.gh = Math.ceil((b.y1 - b.y0) / CELL) + 3;
    this.grid = new Array(this.gw * this.gh);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = [];
    const put = (list, idx, item) => { if (idx >= 0 && idx < list.length) list[idx].push(item); };
    this.solids.forEach((s) => {
      const cx0 = Math.floor(s.x / CELL) - this.gx0, cx1 = Math.floor((s.x + s.w) / CELL) - this.gx0;
      const cy0 = Math.floor(s.y / CELL) - this.gy0, cy1 = Math.floor((s.y + s.h) / CELL) - this.gy0;
      for (let cy = Math.max(0, cy0); cy <= Math.min(this.gh - 1, cy1); cy++)
        for (let cx = Math.max(0, cx0); cx <= Math.min(this.gw - 1, cx1); cx++) put(this.grid, cy * this.gw + cx, s);
    });
  }

  cell(x, y) {
    const cx = Math.floor(x / CELL) - this.gx0, cy = Math.floor(y / CELL) - this.gy0;
    if (cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh) return null;
    return this.grid[cy * this.gw + cx];
  }

  solidAt(x, y) {
    const c = this.cell(x, y);
    if (!c) return y < this.bounds.y0 ? { x: -1e5, y: -1e5, w: 2e5, h: 1e5 + this.bounds.y0 } : null;
    for (let i = 0; i < c.length; i++) {
      const s = c[i];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s;
    }
    return null;
  }

  // platform whose top is within [y - tol, y + up] at x
  platformAt(x, y, tol = 0.12, up = 0.02) {
    for (const p of this.platforms) if (x >= p.x && x <= p.x + p.w && y <= p.y + up && y >= p.y - tol) return p;
    return null;
  }

  // Push a point with radius r out of solids (and platform tops). Returns corrected [x,y] or null.
  pushOut(x, y, r) {
    const s = this.solidAt(x, y - r);
    if (s) {
      // choose the smallest penetration axis
      const top = s.y + s.h + r - y, left = x - (s.x - r), right = s.x + s.w + r - x, bottom = y - (s.y - r);
      const m = Math.min(top, left, right, bottom);
      if (m === top) return [x, s.y + s.h + r];
      if (m === left) return [s.x - r, y];
      if (m === right) return [s.x + s.w + r, y];
      return [x, s.y - r];
    }
    const p = this.platformAt(x, y - r, 0.1, 0);
    if (p) return [x, p.y + r];
    return null;
  }

  // Ground height under x (highest top surface at or below y). Returns -Infinity when none.
  groundBelow(x, y, includePlatforms = true) {
    let best = -Infinity;
    for (const s of this.solids) {
      if (x >= s.x && x <= s.x + s.w) {
        const t = s.y + s.h;
        if (t <= y + 0.05 && t > best) best = t;
      }
    }
    if (includePlatforms) for (const p of this.platforms) if (x >= p.x && x <= p.x + p.w && p.y <= y + 0.05 && p.y > best) best = p.y;
    return best;
  }

  overlapSolid(x0, y0, x1, y1) {
    const cx0 = Math.floor(x0 / CELL) - this.gx0, cx1 = Math.floor(x1 / CELL) - this.gx0;
    const cy0 = Math.floor(y0 / CELL) - this.gy0, cy1 = Math.floor(y1 / CELL) - this.gy0;
    let hit = null;
    for (let cy = Math.max(0, cy0); cy <= Math.min(this.gh - 1, cy1); cy++)
      for (let cx = Math.max(0, cx0); cx <= Math.min(this.gw - 1, cx1); cx++) {
        const c = this.grid[cy * this.gw + cx];
        for (const s of c) if (x1 > s.x && x0 < s.x + s.w && y1 > s.y && y0 < s.y + s.h) { hit = s; return hit; }
      }
    return hit;
  }

  // Move an actor {x, y(bottom), w, h, vx, vy}. Sets grounded, wallDir, ceiling. Handles one-way platforms.
  moveActor(a, dt) {
    const hw = a.w / 2;
    a.wallDir = 0;
    a.hitCeiling = false;
    // X
    let nx = a.x + a.vx * dt;
    const steps = Math.ceil(Math.abs(a.vx * dt) / 0.2) || 1;
    const sx = (nx - a.x) / steps;
    for (let i = 0; i < steps; i++) {
      const tx = a.x + sx;
      const s = this.overlapSolid(tx - hw, a.y + 0.02, tx + hw, a.y + a.h);
      if (s) {
        // step up small ledges
        const stepH = s.y + s.h - a.y;
        if (a.grounded && stepH > 0 && stepH < 0.32 && !this.overlapSolid(tx - hw, s.y + s.h + 0.01, tx + hw, s.y + s.h + a.h)) {
          a.y = s.y + s.h; a.x = tx; continue;
        }
        if (sx > 0) { a.x = s.x - hw - 0.001; a.wallDir = 1; } else { a.x = s.x + s.w + hw + 0.001; a.wallDir = -1; }
        a.vx = 0;
        break;
      }
      a.x = tx;
    }
    if (a.x - hw < this.bounds.x0) { a.x = this.bounds.x0 + hw; a.vx = Math.max(0, a.vx); a.wallDir = -1; }
    if (a.x + hw > this.bounds.x1) { a.x = this.bounds.x1 - hw; a.vx = Math.min(0, a.vx); a.wallDir = 1; }
    if (a.clampX) {
      if (a.x - hw < a.clampX[0]) { a.x = a.clampX[0] + hw; a.vx = Math.max(0, a.vx); }
      if (a.x + hw > a.clampX[1]) { a.x = a.clampX[1] - hw; a.vx = Math.min(0, a.vx); }
    }
    // Y
    const wasGrounded = a.grounded;
    a.grounded = false;
    a.onPlatform = null;
    const oy = a.y;
    let ny = a.y + a.vy * dt;
    const s = this.overlapSolid(a.x - hw + 0.01, Math.min(ny, oy), a.x + hw - 0.01, Math.max(ny, oy) + a.h);
    if (s) {
      if (a.vy <= 0 && oy >= s.y + s.h - 0.05) { ny = s.y + s.h; a.vy = 0; a.grounded = true; }
      else if (a.vy > 0 && oy + a.h <= s.y + 0.05) { ny = s.y - a.h; a.vy = 0; a.hitCeiling = true; }
      else if (a.vy <= 0) {
        // resolve by pushing up if mostly inside from the top
        ny = s.y + s.h; a.vy = 0; a.grounded = true;
      }
    }
    if (!a.grounded && a.vy <= 0 && !a.dropThrough) {
      for (const p of this.platforms) {
        if (a.x + hw * 0.6 < p.x || a.x - hw * 0.6 > p.x + p.w) continue;
        if (oy >= p.y - 0.02 && ny <= p.y) { ny = p.y; a.vy = 0; a.grounded = true; a.onPlatform = p; break; }
      }
    }
    // snap down slopes/steps when walking off tiny drops
    if (!a.grounded && wasGrounded && a.vy <= 0 && !a.dropThrough) {
      const g = this.groundBelow(a.x, ny);
      if (g > ny - 0.3 && g <= ny + 0.001) { ny = g; a.grounded = true; a.vy = 0; }
    }
    a.y = ny;
    if (a.y < this.bounds.y0 - 5) a.fellOut = true;
  }

  // Segment vs solids. Returns {t, x, y, nx, ny} of the first hit, or null.
  raycast(x0, y0, x1, y1) {
    let best = null;
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    const dx = x1 - x0, dy = y1 - y0;
    const seen = new Set();
    const cx0 = Math.floor(minx / CELL) - this.gx0, cx1 = Math.floor(maxx / CELL) - this.gx0;
    const cy0 = Math.floor(miny / CELL) - this.gy0, cy1 = Math.floor(maxy / CELL) - this.gy0;
    for (let cy = Math.max(0, cy0); cy <= Math.min(this.gh - 1, cy1); cy++)
      for (let cx = Math.max(0, cx0); cx <= Math.min(this.gw - 1, cx1); cx++) {
        for (const s of this.grid[cy * this.gw + cx]) {
          if (seen.has(s)) continue;
          seen.add(s);
          const r = segAabb(x0, y0, dx, dy, s);
          if (r && (!best || r.t < best.t)) best = r;
        }
      }
    return best;
  }

  computeSurfaces() {
    const out = [];
    for (const s of this.solids) {
      const top = s.y + s.h;
      // subtract parts covered by solids sitting on top
      let spans = [[s.x, s.x + s.w]];
      for (const o of this.solids) {
        if (o === s) continue;
        if (o.y <= top + 0.01 && o.y + o.h > top + 0.01) {
          spans = spans.flatMap(([a, b]) => {
            if (o.x >= b || o.x + o.w <= a) return [[a, b]];
            const r = [];
            if (o.x > a) r.push([a, o.x]);
            if (o.x + o.w < b) r.push([o.x + o.w, b]);
            return r;
          });
        }
      }
      for (const [a, b] of spans) if (b - a > 0.3) out.push({ x0: a, x1: b, y: top, platform: false });
    }
    for (const p of this.platforms) out.push({ x0: p.x, x1: p.x + p.w, y: p.y, platform: true });
    return out;
  }

  surfaceAt(x, y, tol = 0.2) {
    for (const s of this.surfaces) if (x >= s.x0 && x <= s.x1 && Math.abs(y - s.y) < tol) return s;
    return null;
  }
}

function segAabb(x0, y0, dx, dy, s) {
  let tmin = 0, tmax = 1, nx = 0, ny = 0;
  if (Math.abs(dx) < 1e-9) { if (x0 < s.x || x0 > s.x + s.w) return null; }
  else {
    let t1 = (s.x - x0) / dx, t2 = (s.x + s.w - x0) / dx, n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (y0 < s.y || y0 > s.y + s.h) return null; }
  else {
    let t1 = (s.y - y0) / dy, t2 = (s.y + s.h - y0) / dy, n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin <= 0 && (x0 >= s.x && x0 <= s.x + s.w && y0 >= s.y && y0 <= s.y + s.h)) return { t: 0, x: x0, y: y0, nx: 0, ny: 1, s };
  return { t: tmin, x: x0 + dx * tmin, y: y0 + dy * tmin, nx, ny, s };
}

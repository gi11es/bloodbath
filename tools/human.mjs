// Drives the game through REAL keyboard/mouse events (tests the Input path), like a mediocre human.
import { chromium } from 'playwright';
const [,, query = '?stage=stage1', secs = '90', prefix = '/tmp/hu'] = process.argv;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
await page.goto('http://localhost:5173/' + query);
await page.waitForSelector('#game canvas');
await page.waitForTimeout(5000);
await page.evaluate(() => {
  window.__stalls = [];
  setInterval(() => {
    const g = window.__app.game; if (!g || !g.arena || g.arena.boss) return;
    const A = g.arena;
    const inArena = g.enemies.filter((e) => e.alive && e.x > A.x0 - 2 && e.x < A.x1 + 2).length;
    if (inArena === 0 && A.count < A.kills) window.__stalls.push({ t: +g.time.toFixed(1), count: A.count, kills: A.kills, alive: g.aliveEnemies(), outside: g.enemies.filter((e) => e.alive).map((e) => [e.type, +e.x.toFixed(1), +e.y.toFixed(1), e.state]), pending: g.pending.map((p) => [p.type, +p.x.toFixed(1), +(p.y ?? 0).toFixed(1), +p.delay.toFixed(1)]), wave: A.wave, dstate: g.director.state, px: +g.player.x.toFixed(1), A: [A.x0, A.x1] });
  }, 1000);
});
const held = new Set();
const hold = async (k, on) => { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } else if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } };
let mouseDown = false, i = 0;
const t0 = Date.now();
let lastLog = 0;
while ((Date.now() - t0) / 1000 < Number(secs)) {
  const s = await page.evaluate(() => {
    const g = window.__app.game;
    if (!g) return { none: true, res: !!document.querySelector('.results') };
    const P = g.player;
    const c = [...g.enemies.filter((e) => e.alive), ...(g.boss && g.boss.alive ? [g.boss] : [])];
    let t = null, bd = 14;
    for (const e of c) { const d = Math.hypot(e.cx - P.cx, e.cy - P.cy); if (d < bd) { bd = d; t = e; } }
    const aim = t ? g.worldToScreen(t.cx, t.cy + 0.2) : g.worldToScreen(P.cx + 5 * P.f, P.cy + 0.5);
    const bolt = g.projectiles.list.find((p) => p.owner === 'enemy' && Math.hypot(p.x - P.cx, p.y - P.cy) < 2.5 && Math.sign(P.cx - p.x) === Math.sign(p.vx));
    const ps = g.worldToScreen(P.cx, P.cy);
    return { seed: g.seed, pscr: [Math.round(ps.x), Math.round(ps.y)], py: +P.y.toFixed(2), alpha: P.rig.alpha, state: g.state, px: P.x, alive: P.alive, wall: P.body.wallDir, grounded: P.body.grounded, arena: !!g.arena, tx: t ? t.x : null, td: bd, aim, bolt: !!bolt, exec: !!g.executableNear(P), frz: P.frenzy >= 1, hp: Math.round(P.hp), kills: g.score.kills, litres: +g.score.litres.toFixed(1), aimAng: +P.aim.toFixed(2) };
  });
  if (s.none) { if (s.res) { await page.keyboard.press('Enter'); } await page.waitForTimeout(500); continue; }
  if (s.state === 'dead') { await page.keyboard.press('Enter'); await page.waitForTimeout(300); continue; }
  await page.mouse.move(s.aim.x + (Math.random() - 0.5) * 30, s.aim.y + (Math.random() - 0.5) * 30);
  const wantFire = s.tx !== null;
  if (wantFire !== mouseDown) { mouseDown = wantFire; if (wantFire) await page.mouse.down(); else await page.mouse.up(); }
  let right = true, left = false;
  if (s.tx !== null && (s.arena || s.td < 5)) { const dx = s.tx - s.px; right = dx > 4; left = dx < -4; }
  await hold('KeyD', right); await hold('KeyA', left);
  if (s.wall && (right || left)) await page.keyboard.press('Space');
  else if (Math.random() < 0.06) await page.keyboard.press('Space');
  if (s.bolt && Math.random() < 0.5) await page.keyboard.press(Math.random() < 0.5 ? 'ShiftLeft' : 'KeyK');
  if (s.exec) await page.keyboard.press('KeyE');
  if (s.frz) await page.keyboard.press('KeyF');
  if (Math.random() < 0.01) await page.keyboard.press('KeyQ');
  if (Date.now() - lastLog > 10000) { lastLog = Date.now(); console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, JSON.stringify({ seed: s.seed, pscr: s.pscr, py: s.py, alpha: s.alpha, x: +s.px.toFixed(1), hp: s.hp, kills: s.kills, L: s.litres, arena: s.arena, aimAng: s.aimAng, state: s.state })); await page.screenshot({ path: `${prefix}_${i++}.png` }); }
  await page.waitForTimeout(60);
}
const st = await page.evaluate(() => window.__stalls).catch(() => []);
console.log('stall samples:', st.length);
for (const x of st.slice(0, 10)) console.log(JSON.stringify(x));
console.log(errs.length ? 'ERRORS:\n' + [...new Set(errs)].join('\n') : 'no page errors');
await browser.close();

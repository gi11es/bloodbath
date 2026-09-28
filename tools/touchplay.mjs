// Real multi-touch (CDP Input.dispatchTouchEvent) on Chromium with iPhone 15 Pro emulation.
// Strategy: hold the stick toward progress, auto-fire does the shooting, tap jump/dash/blade when needed.
import { chromium, devices } from 'playwright';
const [,, query = '?stage=stage1', secs = '120', vid] = process.argv;
const dev = devices['iPhone 15 Pro landscape'];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ...dev, recordVideo: vid ? { dir: vid, size: { width: dev.viewport.width, height: dev.viewport.height } } : undefined });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
const cdp = await ctx.newCDPSession(page);
await page.goto('http://localhost:5173/' + query);
await page.waitForTimeout(6000);
const touches = new Map(); // id -> {x,y}
const send = async (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...touches.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1 })) });
const down = async (id, x, y) => { touches.set(id, { x, y }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id, x, y, radiusX: 8, radiusY: 8, force: 1 }] }); };
const move = async (id, x, y) => { touches.set(id, { x, y }); await send('touchMove'); };
// CDP: releasing one finger = touchMove listing only the fingers still down; touchEnd only when none remain
const up = async (id) => { const p = touches.get(id); touches.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, x: p.x, y: p.y }] }); };
const tapBtn = async (id, sel, hold = 70) => { const c = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel); await down(id, c[0], c[1]); await page.waitForTimeout(hold); await up(id); };
const W = dev.viewport.width, H = dev.viewport.height;
const sx = W * 0.2, sy = H * 0.72;
await down(1, sx, sy);
let dir = 1, lastX = 0, stuck = 0, t0 = Date.now(), lastLog = 0, i = 0;
while ((Date.now() - t0) / 1000 < Number(secs)) {
  const s = await page.evaluate(() => {
    const g = window.__app.game; if (!g) return { none: true };
    const P = g.player;
    const bolt = g.projectiles.list.some((p) => p.owner === 'enemy' && Math.hypot(p.x - P.cx, p.y - P.cy) < 2.6 && Math.sign(P.cx - p.x) === Math.sign(p.vx));
    const near = g.enemies.some((e) => e.alive && Math.abs(e.x - P.x) < 1.6 && Math.abs(e.y - P.y) < 1.2);
    let tx = null; if (g.arena) { const e = g.enemies.filter((e) => e.alive).sort((a, b) => Math.abs(a.x - P.x) - Math.abs(b.x - P.x))[0]; if (e) tx = e.x; }
    return { state: g.state, x: P.x, y: P.y, hp: Math.round(P.hp), grounded: P.body.grounded, wall: P.body.wallDir, arena: !!g.arena, ax: g.arena ? [g.arena.x0, g.arena.x1] : null, tx, bolt, near, exec: !!g.executableNear(P), frz: P.frenzy >= 1 && !P.frenzyActive, kills: g.score.kills, L: +g.score.litres.toFixed(1), lock: !!P.autoTarget, paused: window.__app.paused, touchVis: window.__app.input.touch.visible, stick: window.__app.touch.stick && [Math.round(window.__app.touch.stick.x0), Math.round(window.__app.touch.stick.x), window.__app.touch.stick.id], move: +window.__app.input.touch.move.toFixed(2), held: [...window.__app.input.touch.held].join('+'), btns: [...window.__app.touch.buttons.entries()].join(';') };
  });
  if (s.none) { await page.waitForTimeout(500); const btn = await page.evaluate(() => { const el = [...document.querySelectorAll('.res-menu .item, .title-menu .item')].find((e) => e.offsetParent); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); if (btn) { await down(9, ...btn); await up(9); } continue; }
  if (s.state === 'dead') { await down(5, W / 2, H / 3); await up(5); await page.waitForTimeout(300); continue; }
  // stick direction: forward, or toward the nearest enemy inside an arena (keep 3-5 m away)
  if (s.arena && s.tx !== null) { const dx = s.tx - s.x; dir = Math.abs(dx) > 5 ? Math.sign(dx) : Math.abs(dx) < 3 ? -Math.sign(dx) : 0; } else dir = 1;
  await move(1, sx + dir * 45, sy);
  if (Math.abs(s.x - lastX) < 0.05 && dir !== 0 && s.grounded) stuck++; else stuck = 0;
  lastX = s.x;
  if (stuck > 2 || (s.wall && !s.grounded)) { await tapBtn(2, '.t-jump', stuck > 6 ? 260 : 120); if (stuck > 2) { await page.waitForTimeout(220); await tapBtn(2, '.t-jump', 150); } }
  if (s.bolt && Math.random() < 0.5) await tapBtn(3, Math.random() < 0.5 ? '.t-dash' : '.t-melee', 50);
  if (s.exec || (s.near && Math.random() < 0.3)) await tapBtn(3, '.t-melee', 50);
  if (s.frz) await tapBtn(3, '.t-frenzy', 50);
  if (Math.random() < 0.01) await tapBtn(3, '.t-gren', 50);
  if (Date.now() - lastLog > 10000) { lastLog = Date.now(); console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, JSON.stringify({ x: +s.x.toFixed(1), hp: s.hp, kills: s.kills, L: s.L, arena: s.arena, lock: s.lock, state: s.state, vis: s.touchVis, stick: s.stick, move: s.move, held: s.held, btns: s.btns, wall: s.wall, gr: s.grounded })); await page.screenshot({ path: `/tmp/tp_${i++}.png` }); }
  await page.waitForTimeout(70);
}
console.log(errs.length ? 'ERRORS\n' + [...new Set(errs)].join('\n') : 'no page errors');
await ctx.close(); await browser.close();

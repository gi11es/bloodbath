// node tools/playtest.mjs "<query>" <seconds> <shotEvery> <prefix>
// Plays with the bot and reports anomalies: page errors, NaN positions, stuck progress, low fps, entity leaks.
import { chromium } from 'playwright';
const [,, query, secs = '90', every = '15', prefix = '/tmp/pt'] = process.argv;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message + ' | ' + (e.stack || '').split('\n').slice(1, 4).join(' ')));
await page.goto('http://localhost:5173/' + query);
await page.waitForSelector('#game canvas', { timeout: 20000 });
await page.mouse.click(800, 450);
await page.evaluate(() => {
  const a = window.__app;
  a.__pt = { frames: 0, slow: 0, last: performance.now(), worst: 0, anomalies: [] };
  const tick = () => {
    const pt = a.__pt, now = performance.now(), dt = now - pt.last; pt.last = now; pt.frames++;
    if (dt > 40) pt.slow++;
    pt.worst = Math.max(pt.worst, dt);
    const g = a.game;
    if (g && g.player) {
      const P = g.player;
      if (!Number.isFinite(P.body.x) || !Number.isFinite(P.body.y)) pt.anomalies.push('player NaN');
      for (const e of g.enemies) if (!Number.isFinite(e.body.x) || !Number.isFinite(e.body.y) || (e.rig && e.rig.j.some((v) => !Number.isFinite(v)))) { pt.anomalies.push('enemy NaN ' + e.type); e.removeMe = true; }
      if (P.alive && P.body.y < -5) pt.anomalies.push('player below world y=' + P.body.y.toFixed(1));
    }
    if (pt.anomalies.length > 50) pt.anomalies.length = 50;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const t0 = Date.now();
let i = 0, lastX = null, stuckFor = 0;
while ((Date.now() - t0) / 1000 < Number(secs)) {
  await page.waitForTimeout(Number(every) * 1000);
  const st = await page.evaluate(() => {
    const a = window.__app, g = a.game, pt = a.__pt;
    const perf = { fps: Math.round(pt.frames / ((performance.now() - (pt.start || (pt.start = performance.now() - 1000))) / 1000)), slow: pt.slow, worstMs: Math.round(pt.worst) };
    pt.frames = 0; pt.start = performance.now(); pt.slow = 0; pt.worst = 0;
    const an = pt.anomalies.splice(0);
    if (!g) return { screen: [...document.querySelectorAll('.screen:not(.out)')].map((e) => e.className).join('|'), title: document.querySelector('.res-title')?.textContent, perf, an };
    return { stage: g.stageId, seed: g.seed, state: g.state, x: +g.player.x.toFixed(1), y: +g.player.y.toFixed(1), hp: Math.round(g.player.hp), deaths: g.score.deaths, alive: g.aliveEnemies(), ents: g.enemies.length, proj: g.projectiles.list.length, drops: g.blood.n, fx: g.fx.alpha.p.length + g.fx.add.p.length + g.fx.back.p.length, litres: +g.score.litres.toFixed(1), kills: g.score.kills, arena: g.arena ? `${g.arena.count}/${g.arena.kills}` : null, skill: +g.director.skill.toFixed(2), dstate: g.director.state, boss: g.boss ? Math.round(g.boss.hp) + (g.boss.stunned ? 'S' : '') : null, len: g.level.length, perf, an };
  }).catch((e) => ({ err: e.message }));
  if (st.x !== undefined) {
    if (lastX !== null && Math.abs(st.x - lastX) < 1 && !st.arena && st.state === 'play' && !st.boss) stuckFor += Number(every); else stuckFor = 0;
    lastX = st.x;
    if (stuckFor >= 30) st.STUCK = stuckFor;
  }
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, JSON.stringify(st));
  await page.screenshot({ path: `${prefix}_${i++}.png` });
}
console.log(errs.length ? 'ERRORS:\n' + [...new Set(errs)].slice(0, 30).join('\n') : 'no page errors');
await browser.close();

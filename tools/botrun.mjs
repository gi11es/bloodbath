// node tools/botrun.mjs "<query>" <seconds> <every> <prefix>
import { chromium } from 'playwright';
const [,, query, secs = '60', every = '10', prefix = '/tmp/bot'] = process.argv;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
await page.goto('http://localhost:5173/' + query);
await page.waitForSelector('#game canvas', { timeout: 20000 });
await page.waitForTimeout(300);
await page.mouse.click(800, 450);
const t0 = Date.now();
let i = 0;
while ((Date.now() - t0) / 1000 < Number(secs)) {
  await page.waitForTimeout(Number(every) * 1000);
  const st = await page.evaluate(() => {
    const a = window.__app, g = a.game;
    if (!g) return { screen: document.querySelector('.screen:not(.out)')?.className || 'none', ui: document.querySelector('.res-title')?.textContent };
    return { stage: g.stageId, state: g.state, x: +g.player.x.toFixed(1), hp: Math.round(g.player.hp), alive: g.aliveEnemies(), ents: g.enemies.length, gibs: g.gibs.length, drops: g.blood.n, stains: g.blood.stainN, litres: +g.score.litres.toFixed(2), pts: Math.round(g.score.points), kills: g.score.kills, arena: g.arena ? `${g.arena.count}/${g.arena.kills}` : null, skill: +g.director.skill.toFixed(2), dstate: g.director.state, boss: g.boss ? Math.round(g.boss.hp) : null, weapon: g.player.weapon.id, fps: a.__fps };
  }).catch((e) => ({ err: e.message }));
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, JSON.stringify(st));
  await page.screenshot({ path: `${prefix}_${i++}.png` });
}
console.log(logs.slice(0, 40).join('\n'));
await browser.close();

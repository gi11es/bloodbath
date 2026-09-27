import { chromium } from 'playwright';
const [,, stage, seed, out = '/tmp/fly'] = process.argv;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:5173/?stage=${stage}&seed=${seed}&god=1`);
await page.waitForSelector('#game canvas');
await page.waitForTimeout(4000);
const len = await page.evaluate(() => { const g = window.__app.game; g.spawnEnemy = () => null; g.director.wantSpawn = () => false; g.events.forEach((e) => { if (e.type !== 'pickup') e.done = true; }); return g.level.length; });
let i = 0;
for (let x = 8; x < len - 4; x += 15) {
  await page.evaluate((x) => { const g = window.__app.game; const P = g.player; P.body.x = x; P.body.y = g.world.groundBelow(x, 14) + 0.05; P.body.vx = 0; g.cam.snap(x, 4); g.arena = null; g.arenaClamp = null; }, x);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}_${String(i++).padStart(2, '0')}.png` });
}
console.log('shots', i, 'len', len);
await browser.close();

import { chromium } from 'playwright';
const [,, query, secs = '90'] = process.argv;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5173/' + query);
await page.waitForSelector('#game canvas');
await page.evaluate(() => {
  window.__stalls = [];
  setInterval(() => {
    const g = window.__app.game; if (!g || !g.arena || g.arena.boss) return;
    const A = g.arena;
    const inArena = g.enemies.filter((e) => e.alive && e.x > A.x0 - 2 && e.x < A.x1 + 2).length;
    if (inArena === 0 && A.count < A.kills) {
      window.__stalls.push({ t: +g.time.toFixed(1), count: A.count, kills: A.kills, alive: g.aliveEnemies(), outside: g.enemies.filter((e) => e.alive).map((e) => [e.type, +e.x.toFixed(1), +e.y.toFixed(1), e.state]), pending: g.pending.length, wave: A.wave, dstate: g.director.state, px: +g.player.x.toFixed(1), A: [A.x0, A.x1] });
    }
  }, 1000);
});
await page.waitForTimeout(Number(secs) * 1000);
const st = await page.evaluate(() => window.__stalls);
console.log('stall samples:', st.length);
for (const s of st.slice(0, 12)) console.log(JSON.stringify(s));
await browser.close();

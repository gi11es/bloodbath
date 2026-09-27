import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/?stage=boss&bot=1&god=1');
await page.waitForSelector('#game canvas');
await page.waitForTimeout(5000);
const r = await page.evaluate(() => new Promise((res) => {
  const out = []; let n = 0;
  const f = () => {
    const g = window.__app.game, b = g && g.boss;
    if (b) {
      const B = g.defs.boss.batch; const F = B.aFx.array, T = B.aTint.array;
      let maxFlash = 0, maxEm = 0, maxT = 0, minA = 9;
      for (let i = 0; i < B.n; i++) { maxFlash = Math.max(maxFlash, F[i * 4 + 1]); maxEm = Math.max(maxEm, F[i * 4 + 3]); maxT = Math.max(maxT, T[i * 4], T[i * 4 + 1], T[i * 4 + 2]); minA = Math.min(minA, T[i * 4 + 3]); }
      out.push({ n, flash: +b.flash.toFixed(2), rf: +maxFlash.toFixed(2), em: +maxEm.toFixed(2), tint: +maxT.toFixed(2), alpha: +minA.toFixed(2), st: b.state, frz: g.player.frenzyActive, nl: window.__lightsN });
    }
    if (++n < 1500) requestAnimationFrame(f); else res(out);
  };
  requestAnimationFrame(f);
}));
const hi = r.filter((x) => x.rf > 0.35 || x.tint > 1.05 || x.alpha < 1 || x.em > 0.6);
console.log('max rf', Math.max(...r.map((x) => x.rf)), 'states', [...new Set(r.map((x) => x.st))].join(','));
console.log('frames', r.length, 'suspicious', hi.length);
console.log(JSON.stringify(hi.slice(0, 15)));
console.log('frenzy frames', r.filter((x) => x.frz).length);
await browser.close();

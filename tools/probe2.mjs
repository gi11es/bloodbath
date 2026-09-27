import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/?stage=stage1&god=1&zoom=2.2');
await page.waitForSelector('#game canvas');
await page.waitForTimeout(3500);
await page.evaluate(() => {
  const g = window.__app.game, P = g.player;
  g.director.wantSpawn = () => false;
  window.__neg = [];
  const oc = g.blood.count.bind(g.blood);
  g.blood.count = (v) => { if (v < 0) window.__neg.push(new Error().stack.split('\n').slice(2, 6).join(' <- ')); oc(v); };
  const oe = g.blood.emit.bind(g.blood);
  g.blood.emit = (...a) => { if (a[5] < 0) window.__neg.push('emit ' + new Error().stack.split('\n').slice(2, 5).join(' <- ')); return oe(...a); };
  const L = g.spawnEnemy('butcher', P.x + 4, 0); g.spawnEnemy('flamer', P.x + 5, 0); g.spawnEnemy('leaper', P.x + 6, 0);
  window.__L = L; window.__ls = [];
  const f = () => { const r = L.rig; const B = g.defs.butcher.batch; let mf = 0, mt = 0, ma = 9; for (let i = 0; i < B.n; i++) { mf = Math.max(mf, B.aFx.array[i * 4 + 1]); ma = Math.min(ma, B.aTint.array[i * 4 + 3]); mt = Math.max(mt, B.aTint.array[i * 4]); }
    window.__ls.push([L.state, L.lastHitBy, +L.hp.toFixed(0), +L.flash.toFixed(2), +mf.toFixed(2), +ma.toFixed(2), +mt.toFixed(2), +L.blood.toFixed(2), L.alive]); requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await page.waitForTimeout(7000);
const r = await page.evaluate(() => ({ neg: [...new Set(window.__neg)].slice(0, 5), ls: window.__ls.filter((x, i) => x[4] > 0.2 || x[5] < 1 || x[6] > 1.05 || i % 60 === 0).slice(0, 25) }));
console.log('negative spills:', r.neg);
console.log(r.ls.map((x) => x.join(',')).join('\n'));
await browser.close();

import { chromium } from 'playwright';
const rate = Number(process.argv[2] || 4);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5173/?stage=arena&bot=1&god=1');
await page.waitForSelector('#game canvas');
await page.waitForTimeout(5000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
await page.evaluate(() => { const g = window.__app.game; for (let i = 0; i < 14; i++) g.spawnEnemy(['grunt', 'butcher', 'flamer', 'drone', 'leaper', 'shotgunner'][i % 6], 4 + i * 2, 0); });
const sample = async (label) => {
  const r = await page.evaluate(() => new Promise((res) => {
    const ts = []; let last = performance.now(); const t0 = last;
    const f = () => { const n = performance.now(); ts.push(n - last); last = n; if (n - t0 < 4000) requestAnimationFrame(f); else res(ts); };
    requestAnimationFrame(f);
  }));
  r.sort((a, b) => a - b);
  const g = await page.evaluate(() => { const g = window.__app.game; return { ents: g.enemies.length, drops: g.blood.n, stains: g.blood.stainN, fx: g.fx.alpha.p.length + g.fx.add.p.length, gibs: g.gibs.length }; });
  console.log(label, 'fps', Math.round(1000 / (r.reduce((a, b) => a + b, 0) / r.length)), 'p95 ms', r[Math.floor(r.length * 0.95)].toFixed(1), JSON.stringify(g));
};
await sample('t+0 ');
await page.waitForTimeout(8000);
await sample('t+12');
// profile where main-thread time goes
await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
await page.waitForTimeout(3000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas; const idx = new Map(profile.nodes.map((n, i) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) { const n = idx.get(profile.samples[i]); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); }
const tot = [...self.values()].reduce((a, b) => a + b, 0);
console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${(100 * v / tot).toFixed(1)}% ${k}`).join('\n'));
await browser.close();

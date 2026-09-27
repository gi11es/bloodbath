import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForTimeout(2000);
for (const st of ['stage1', 'stage2', 'boss', 'arena', 'stage1', 'stage2']) {
  await page.evaluate((s) => window.__app.startStage(s, null), st);
  await page.waitForTimeout(6000);
  const m = await page.evaluate(() => { window.gc && window.gc(); const r = window.__app.pipeline.renderer.info; return { heapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1), geo: r.memory.geometries, tex: r.memory.textures, progs: r.programs.length, huds: document.querySelectorAll('.hud').length, overlays: document.querySelectorAll('.screen').length }; });
  console.log(st.padEnd(7), JSON.stringify(m));
}
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();

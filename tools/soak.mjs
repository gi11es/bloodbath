import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/?stage=arena&bot=1&god=1&speed=2');
await page.waitForSelector('#game canvas');
for (let i = 0; i < 7; i++) {
  await page.waitForTimeout(i ? 30000 : 8000);
  const m = await page.evaluate(() => { if (window.gc) window.gc(); const g = window.__app.game, r = window.__app.pipeline.renderer.info;
    return { heapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1), geo: r.memory.geometries, tex: r.memory.textures, progs: r.programs.length, sceneObjs: g.scene.children.length, bloodObjs: g.bloodScene.children.length, ents: g.enemies.length, gibs: g.gibs.length, pickups: g.pickups.length, pmesh: g.pickupMeshes ? g.pickupMeshes.size : 0, proj: g.projectiles.list.length, pend: g.pending.length, kills: g.score.kills, shock: g.shockwaves.length, flash: g.flashLights.length, lights: g.lights.list.length }; });
  console.log(`[${i ? 8 + i * 30 : 8}s]`, JSON.stringify(m));
}
await browser.close();

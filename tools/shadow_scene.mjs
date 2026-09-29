// Deterministic visual regression scene for a raised bunker and its sandbags.
// Usage: node tools/shadow_scene.mjs /tmp/shadow-scene.png
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?stage=stage1&seed=3&god=1' + (process.argv.includes('--pool') ? '#pool' : '') + (process.argv.includes('--aim') ? '#aim' : ''));
await page.waitForSelector('#game canvas');
await page.mouse.click(800, 450);
await page.waitForTimeout(3000);
const scene = await page.evaluate(() => {
  const app = window.__app, g = app.game;
  app.loop.running = false;
  document.querySelector('#ui').style.visibility = 'hidden';
  g.enemies = [];
  const bag = g.props.find((p) => p.type === 'sandbags' && p.y > 0);
  const hero = g.player;
  hero.body.x = bag.x - 0.7;
  hero.body.y = bag.y;
  hero.body.grounded = true;
  hero.pose(1 / 60);
  const grunt = g.spawnEnemy('grunt', bag.x + 2.6, bag.y);
  grunt.body.grounded = true; grunt.body.vx = 0; grunt.body.vy = 0;
  grunt.think = () => {};
  if (location.hash.includes('aim')) { grunt.state = 'aim'; grunt.laser = 0.9; grunt.aim = Math.PI; }
  if (location.hash === '#pool') g.blood.addPool(bag.x + 0.25, bag.y, 0.5);
  g.cam.snap(bag.x + 1.2, 3);
  g.render(0);
  return { bag: { x: bag.x, y: bag.y, h: bag.h, w: bag.w, order: bag.mesh.renderOrder },
    surface: (() => { const s = g.world.surfaceAt(bag.x, bag.y, 0.05); return s && [s.x0, s.x1, s.y]; })(),
    hero: [hero.body.x, hero.body.y], grunt: [grunt.body.x, grunt.body.y] };
});
await page.screenshot({ path: process.argv[2] || '/tmp/shadow-scene.png' });
if (process.argv[3]?.endsWith('.png')) {
  await page.evaluate(() => {
    const g = window.__app.game;
    for (const d of Object.values(g.defs)) d.batch.shadowMesh.visible = false;
    g.droneAssets.batch.shadowMesh.visible = false;
    g.render(0);
  });
  await page.screenshot({ path: process.argv[3] });
}
console.log(JSON.stringify({ scene, errors }));
await browser.close();

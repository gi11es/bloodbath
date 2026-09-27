// node tools/record.mjs "<query>" <out-dir> '<actions json>'  -> out-dir/video.webm
import { chromium } from 'playwright';
import fs from 'fs';
const [,, query, dir, actions = '[]'] = process.argv;
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/' + query);
await page.waitForSelector('#game canvas');
await page.waitForTimeout(3500);
for (const a of JSON.parse(actions)) {
  if (a.key) { await page.keyboard.down(a.key); await page.waitForTimeout(a.hold || 100); await page.keyboard.up(a.key); }
  if (a.down) await page.keyboard.down(a.down);
  if (a.up) await page.keyboard.up(a.up);
  if (a.mouse) await page.mouse.move(a.mouse[0], a.mouse[1], { steps: a.steps || 1 });
  if (a.mdown) await page.mouse.down({ button: a.mdown });
  if (a.mup) await page.mouse.up({ button: a.mup });
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.eval) await page.evaluate(a.eval);
}
await page.waitForTimeout(300);
const v = page.video();
await ctx.close();
fs.renameSync(await v.path(), dir + '/video.webm');
console.log(logs.join('\n') || 'ok');
await browser.close();

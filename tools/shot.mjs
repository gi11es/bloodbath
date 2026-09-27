// Usage: node tools/shot.mjs <url-query> <out.png> [waitMs] [actions-json]
import { chromium } from 'playwright';
const [,, query = '', out = '/tmp/shot.png', wait = '4000', actions = '[]'] = process.argv;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.goto('http://localhost:5173/' + query);
await page.waitForSelector('#game canvas', { timeout: 20000 });
await page.waitForTimeout(300);
if (!query.includes('noclick')) await page.mouse.click(800, 450);
await page.waitForTimeout(Number(wait));
for (const a of JSON.parse(actions)) {
  if (a.key) { await page.keyboard.down(a.key); await page.waitForTimeout(a.hold || 100); await page.keyboard.up(a.key); }
  if (a.down) await page.keyboard.down(a.down);
  if (a.up) await page.keyboard.up(a.up);
  if (a.mouse) await page.mouse.move(a.mouse[0], a.mouse[1]);
  if (a.mdown) await page.mouse.down({ button: a.mdown });
  if (a.mup) await page.mouse.up({ button: a.mup });
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.eval) { try { logs.push('eval: ' + JSON.stringify(await page.evaluate(a.eval))); } catch (e) { logs.push('evalerr: ' + e.message.split('\n')[0]); } }
  if (a.shot) await page.screenshot({ path: a.shot });
}
await page.screenshot({ path: out });
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }));
console.log('fps~', fps);
console.log(logs.slice(0, 30).join('\n'));
await browser.close();

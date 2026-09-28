import { webkit, devices } from 'playwright';
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => errs.push(m.type() + ' ' + m.text().slice(0, 150)));
await page.goto('http://localhost:5173/');
await page.waitForTimeout(4000);
console.log(JSON.stringify(await page.evaluate(() => {
  const r = document.querySelector('.rotate-hint');
  const cs = r && getComputedStyle(r);
  const c = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return { body: document.body.className, rot: r ? [cs.display, cs.zIndex, JSON.stringify(r.getBoundingClientRect())] : null, center: c && (c.className || c.tagName), html: document.body.children.length, kids: [...document.body.children].map((e) => e.tagName + '.' + e.className) };
})));
await page.screenshot({ path: '/tmp/d_a.png' });
for (const [k, css] of [['noanim', '.rotate-hint .phone{animation:none!important}'], ['nophone', '.rotate-hint .phone{display:none!important}'], ['notext', '.rotate-hint b,.rotate-hint small{display:none!important}']]) {
  await page.addStyleTag({ content: css }); await page.waitForTimeout(300);
  const sh = await page.screenshot(); const { default: z } = await import('zlib');
  console.log(k, sh.length);
  await page.screenshot({ path: `/tmp/d_${k}.png` });
}
await page.evaluate(() => { document.querySelector('.rotate-hint').style.background = 'rgba(0,80,0,.5)'; });
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/d_b.png' });
await page.evaluate(() => document.body.classList.remove('portrait'));
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/d_c.png' });
console.log(errs.slice(0, 10).join('\n'));
await browser.close();

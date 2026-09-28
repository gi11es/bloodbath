// node tools/iphone.mjs "<query>" out.png [waitMs] [portrait]
import { webkit, devices } from 'playwright';
const [,, query = '', out = '/tmp/iph.png', wait = '5000', portrait] = process.argv;
const dev = devices[portrait ? 'iPhone 15 Pro' : 'iPhone 15 Pro landscape'];
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...dev });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/' + query);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
const info = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, touch: 'ontouchstart' in window, coarse: matchMedia('(pointer: coarse)').matches, gl: (() => { const c = document.createElement('canvas').getContext('webgl2'); return c ? c.getParameter(c.MAX_TEXTURE_SIZE) + ' ' + (c.getExtension('EXT_color_buffer_float') ? 'cbf' : 'no-cbf') + ' ' + (c.getExtension('EXT_color_buffer_half_float') ? 'cbhf' : 'no-cbhf') : 'no webgl2'; })() }));
console.log(JSON.stringify(info));
console.log(logs.slice(0, 20).join('\n') || 'no errors');
await browser.close();

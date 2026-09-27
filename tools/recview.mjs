// node tools/recview.mjs "<query>" out.webm seconds
import { chromium } from 'playwright';
import fs from 'fs';
const [,, query, out, secs = '3'] = process.argv;
const dir = '/tmp/recview_' + Date.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.goto('http://localhost:5173/' + query);
await page.waitForTimeout(Number(secs) * 1000 + 1500);
const v = page.video(); await ctx.close();
fs.renameSync(await v.path(), out);
await browser.close();

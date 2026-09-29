// Measure a cold menu visit followed by Campaign on a throttled phone.
// node tools/load_campaign_bench.mjs [menuDwellMs] [mbps]
import { chromium, devices } from 'playwright';

const [,, dwell = '5000', mbps = '4'] = process.argv;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro landscape'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: Number(mbps) * 131072, uploadThroughput: Number(mbps) * 131072 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const t0 = Date.now();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__app?.scene?.tex?.image && window.__app?.scene?.logo?.mat?.uniforms?.tLogo?.value), null, { timeout: 120000 });
const titleMs = Date.now() - t0;
await page.waitForTimeout(Number(dwell));
const beforeClick = await page.evaluate(() => ({ cachedTextures: performance.getEntriesByType('resource').length, titleMusic: !!window.__audio.music }));
const clickStart = Date.now();
await page.locator('.title-menu .item').filter({ hasText: 'CAMPAIGN' }).click();
await page.waitForFunction(() => window.__app?.game?.state === 'intro', null, { timeout: 120000 });
console.log(JSON.stringify({ dwellMs: Number(dwell), titleMs, clickToPlayMs: Date.now() - clickStart, beforeClick, errors }, null, 2));
await browser.close();

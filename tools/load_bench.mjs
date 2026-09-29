// Benchmark a cold title or stage load against a production build.
// node tools/load_bench.mjs [url] [title|stage] [mbps] [rttMs]
import { chromium, devices } from 'playwright';

const [,, url = 'http://127.0.0.1:4173/', mode = 'title', mbps = '4', rtt = '80'] = process.argv;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro landscape'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: Number(rtt),
  downloadThroughput: Number(mbps) * 1024 * 1024 / 8,
  uploadThroughput: Number(mbps) * 1024 * 1024 / 8,
});
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const started = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const htmlMs = Date.now() - started;
await page.waitForFunction((kind) => {
  const app = window.__app;
  return kind === 'stage' ? app?.game?.state === 'intro' : !!(app?.scene?.tex?.image && app?.scene?.logo?.mat?.uniforms?.tLogo?.value);
}, mode, { timeout: 120000 });
const readyMs = Date.now() - started;
const info = await page.evaluate(() => {
  const resources = performance.getEntriesByType('resource');
  const byType = {};
  for (const r of resources) {
    const p = new URL(r.name).pathname;
    const type = p.includes('/audio/') ? 'audio' : p.includes('/props/') ? 'props' : p.includes('/bg/') ? 'backgrounds' : p.includes('/chars/') ? 'characters' : p.includes('/ui/') ? 'ui' : p.includes('/intro/') ? 'intro' : /\.js$/.test(p) ? 'js' : 'other';
    const t = byType[type] ||= { n: 0, kb: 0, lastMs: 0 };
    t.n++; t.kb += (r.encodedBodySize || r.transferSize || 0) / 1024; t.lastMs = Math.max(t.lastMs, r.responseEnd);
  }
  return { byType, resources: resources.map((r) => ({ path: new URL(r.name).pathname, kb: Math.round((r.encodedBodySize || r.transferSize || 0) / 1024), endMs: Math.round(r.responseEnd) })).sort((a, b) => b.kb - a.kb).slice(0, 15) };
});
console.log(JSON.stringify({ url, mode, mbps: Number(mbps), rttMs: Number(rtt), htmlMs, readyMs, ...info, errors }, null, 2));
await browser.close();

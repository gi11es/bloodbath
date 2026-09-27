import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
const ev = (f, a) => page.evaluate(f, a);
await page.goto('http://localhost:5173/');
await page.waitForTimeout(2500);
await page.mouse.click(10, 10);
await page.waitForTimeout(800);
const music = () => page.evaluate(() => window.__audio.music?.id || null);
console.log('title music id:', await music());
await page.keyboard.press('Enter'); await page.waitForTimeout(6000);
console.log('stage1 music id:', await music());
// arrow-key aiming
await page.keyboard.down('ArrowUp'); await page.waitForTimeout(300);
console.log('aim up (keys):', await ev(() => +window.__app.game.player.aim.toFixed(2)));
await page.keyboard.up('ArrowUp');
await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(300);
console.log('aim left (keys):', await ev(() => [+window.__app.game.player.aim.toFixed(2), window.__app.game.player.f]));
await page.keyboard.up('ArrowLeft');
// resize mid game
await page.setViewportSize({ width: 1000, height: 800 }); await page.waitForTimeout(600);
console.log('after resize cam aspect/view:', await ev(() => [+window.__app.game.cam.aspect.toFixed(2), +window.__app.game.cam.viewW.toFixed(2), window.__app.pipeline.iw, window.__app.pipeline.ih]));
await page.screenshot({ path: '/tmp/misc_resize.png' });
await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForTimeout(400);
// options during play
for (const [k, v] of [['pixelScale', 'retro'], ['crt', true], ['gore', 'standard'], ['pixelScale', 'hibit']]) {
  await ev(([k, v]) => { const st = window.__settings; st[k] = v; window.__app.pipeline.resize(); window.__app.game.blood.setGore(st.gore); }, [k, v]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/misc_${k}_${v}.png` });
}
await ev(() => { const st = window.__settings; st.pixelScale = 'hd'; st.crt = false; st.gore = 'bloodbath'; window.__app.pipeline.resize(); });
// boss music
await ev(() => window.__app.startStage('boss', null)); await page.waitForTimeout(6000);
console.log('boss stage music id:', await music());
await page.keyboard.down('KeyD'); await page.waitForTimeout(1500); await page.keyboard.up('KeyD');
await page.waitForTimeout(5000);
console.log('boss spawned:', await ev(() => !!window.__app.game.boss));
await ev(() => { const g = window.__app.game; const b = g.boss; g.godMode = true; for (let i = 0; i < 400 && !b.stunned; i++) b.damage({ dmg: 60, x: b.cx, y: b.cy, dx: -1, dy: 0, seg: 'torso', kind: 'bullet' }); });
await page.waitForTimeout(1000);
console.log('boss stunned:', await ev(() => [window.__app.game.boss?.stunned, window.__app.game.boss?.state]));
await ev(() => { const g = window.__app.game; g.player.body.x = g.boss.x - 2; });
await page.keyboard.press('KeyE'); await page.waitForTimeout(1500);
console.log('boss after E:', await ev(() => [window.__app.game.boss?.alive, window.__app.game.boss?.state]));
await page.waitForTimeout(6000);
console.log('victory music id:', await music(), await ev(() => window.__app.game?.state));
console.log(errs.length ? 'ERRORS:\n' + [...new Set(errs)].join('\n') : 'no page errors');
await browser.close();

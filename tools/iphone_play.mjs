// Plays on a simulated iPhone 15 Pro (WebKit) with multi-touch PointerEvents (+ real tap for menus).
import { webkit, devices } from 'playwright';
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro landscape'], recordVideo: process.argv[2] ? { dir: process.argv[2], size: { width: 734, height: 343 } } : undefined });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto('http://localhost:5173/');
await page.waitForTimeout(3500);
const tapText = async (txt) => { const box = await page.evaluate((t) => { const el = [...document.querySelectorAll('.item')].reverse().find((e) => e.offsetParent && e.querySelector('.lbl').textContent.trim() === t); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, txt); if (!box) { console.log('!! no item', txt, await page.evaluate(() => [...document.querySelectorAll('.item')].map((e) => e.querySelector('.lbl').textContent + ':' + !!e.offsetParent).join(','))); return; } await page.touchscreen.tap(box[0], box[1]); await page.waitForTimeout(400); };
const T = (type, id, x, y) => page.evaluate(([type, id, x, y]) => { const el = document.elementFromPoint(x, y) || document.body; el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true })); }, [type, id, x, y]);
const center = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
const st = () => page.evaluate(() => { const a = window.__app, g = a.game; if (!g) return { nogame: true, screens: [...document.querySelectorAll('.screen:not(.out)')].map((e) => e.className) }; const P = g.player; return { state: g.state, paused: a.paused, x: +P.x.toFixed(2), y: +P.y.toFixed(2), vx: +P.body.vx.toFixed(1), aim: +P.aim.toFixed(2), shots: P.shotsFired, dash: +P.dashT.toFixed(2), melee: +P.meleeT.toFixed(2), gren: P.grenades, crouch: P.crouch, slide: +P.slideT.toFixed(2), kills: g.score.kills, L: +g.score.litres.toFixed(2), hp: Math.round(P.hp), touchVis: a.input.touch?.visible, lock: !!P.autoTarget }; });
console.log('title', JSON.stringify(await st()));
await tapText('OPTIONS');
console.log('options items:', await page.evaluate(() => [...document.querySelectorAll('.overlay .item .lbl')].map((e) => e.textContent).join(' | ')));
await page.screenshot({ path: '/tmp/ip_options.png' });
await tapText('BACK');
await tapText('CONTROLS'); await page.screenshot({ path: '/tmp/ip_controls.png' }); { const c = await center('.overlay .menu-close'); await page.touchscreen.tap(...c); await page.waitForTimeout(500); }
await tapText('CREDITS'); await page.screenshot({ path: '/tmp/ip_credits.png' }); await page.touchscreen.tap(10, 10); await page.waitForTimeout(500);
await tapText('CAMPAIGN');
await page.waitForTimeout(6500);
console.log('in game', JSON.stringify(await st()));
await page.evaluate(() => { const g = window.__app.game; g.godMode = true; });
// left thumb: hold stick right
await T('pointerdown', 1, 150, 250); await T('pointermove', 1, 200, 250);
await page.waitForTimeout(1200);
console.log('stick right 1.2s', JSON.stringify(await st()));
// right thumb: jump while running
const jump = await center('.t-jump');
await T('pointerdown', 2, ...jump); await page.waitForTimeout(150); await T('pointerup', 2, ...jump);
await page.waitForTimeout(120);
console.log('jump while running', JSON.stringify(await st()));
await T('pointerdown', 2, ...jump); await page.waitForTimeout(80); await T('pointerup', 2, ...jump);
await page.waitForTimeout(600);
// fire pad: hold and drag up to aim up
const fire = await center('.t-fire');
await T('pointerdown', 3, ...fire); await T('pointermove', 3, fire[0], fire[1] - 50);
await page.waitForTimeout(700);
console.log('fire drag up (manual aim)', JSON.stringify(await st()));
await T('pointerup', 3, fire[0], fire[1] - 50);
const dash = await center('.t-dash');
await T('pointerdown', 4, ...dash); await page.waitForTimeout(40);
console.log('dash', JSON.stringify(await st()));
await T('pointerup', 4, ...dash);
await page.waitForTimeout(500);
const blade = await center('.t-melee');
await T('pointerdown', 4, ...blade); await page.waitForTimeout(60);
console.log('blade', JSON.stringify(await st()));
await T('pointerup', 4, ...blade);
const gren = await center('.t-gren');
await T('pointerdown', 4, ...gren); await page.waitForTimeout(60); await T('pointerup', 4, ...gren);
console.log('grenade', JSON.stringify(await st()));
// stick down while running = slide
await T('pointermove', 1, 200, 250); await page.waitForTimeout(300); await T('pointermove', 1, 170, 320);
await page.waitForTimeout(60);
console.log('slide', JSON.stringify(await st()));
await T('pointerup', 1, 170, 320);
// release: stops
await page.waitForTimeout(600);
console.log('released', JSON.stringify(await st()));
// spawn enemies and let auto-fire work for 4 s while running
await page.evaluate(() => { const g = window.__app.game, P = g.player; g.spawnEnemy('grunt', P.x + 6, 0); g.spawnEnemy('leaper', P.x + 8, 0); });
await T('pointerdown', 1, 150, 250); await T('pointermove', 1, 185, 250);
await page.waitForTimeout(4000);
console.log('auto-fire 4s', JSON.stringify(await st()));
await page.screenshot({ path: '/tmp/ip_combat.png' });
await T('pointerup', 1, 185, 250);
// pause via II button, resume via tap
const pz = await center('.t-pause');
await page.touchscreen.tap(...pz); await page.waitForTimeout(500);
console.log('paused', JSON.stringify(await st()));
await page.screenshot({ path: '/tmp/ip_pause.png' });
await tapText('RESUME'); await page.waitForTimeout(400);
console.log('resumed', JSON.stringify(await st()));
// die -> tap to continue
await page.evaluate(() => { const g = window.__app.game; g.godMode = false; g.player.invuln = 0; g.player.takeDamage(999, 1); });
await page.waitForTimeout(3200);
await page.screenshot({ path: '/tmp/ip_dead.png' });
await page.touchscreen.tap(400, 150); await page.waitForTimeout(800);
console.log('tap to continue', JSON.stringify(await st()));
// rotate to portrait
await page.setViewportSize({ width: 343, height: 734 }); await page.waitForTimeout(600);
console.log('portrait', JSON.stringify(await st()), await page.evaluate(() => getComputedStyle(document.querySelector('.rotate-hint')).display));
await page.screenshot({ path: '/tmp/ip_portrait.png' });
await page.setViewportSize({ width: 734, height: 343 }); await page.waitForTimeout(600);
console.log('back to landscape', JSON.stringify(await st()));
console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'no page errors');
await ctx.close(); await browser.close();

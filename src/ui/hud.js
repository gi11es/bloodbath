// In-game HUD (DOM): vitals, weapon, score, announcements, prompts, boss bar, continue, screen blood.
import { settings } from '../core/settings.js';

const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };

export class Hud {
  constructor(root, game) {
    this.game = game;
    this.root = el('div', 'hud');
    root.appendChild(this.root);
    this.root.innerHTML = `
      <div class="hud-left">
        <div class="portrait"><img src="assets/ui/portrait_red.webp" alt=""></div>
        <div class="vitals">
          <div class="hp"><div class="hp-fill"></div><div class="hp-shine"></div><span class="hp-num">100</span></div>
          <div class="frenzy"><div class="fr-fill"></div><span class="fr-label">FRENZY</span></div>
          <div class="weapon"><span class="wname">ASSAULT RIFLE</span><span class="ammo">&infin;</span><span class="gren"><i></i><b>6</b></span></div>
        </div>
      </div>
      <div class="hud-right">
        <div class="score">0</div>
        <div class="litres"><b>0.00</b> L SPILLED</div>
        <div class="mult"><span>x1.0</span><em>BLOODLUST</em></div>
      </div>
      <div class="announce-wrap"></div>
      <div class="hint"></div>
      <div class="prompt">[E] EXECUTE</div>
      <div class="go">GO <span>&#10148;</span></div>
      <div class="arena-bar"><label></label><div class="ab"><div class="ab-fill"></div></div><small></small></div>
      <div class="edge-arrow left">&#9664;</div><div class="edge-arrow right">&#9654;</div>
      <div class="bossbar"><label></label><div class="bb"><div class="bb-fill"></div><div class="bb-lag"></div></div></div>
      <div class="continue"><div>CONTINUE?</div><b>9</b><small>PRESS FIRE</small></div>
      <div class="mission-card"><div class="mc-name"></div><div class="mc-sub"></div></div>
      <div class="warning"><div class="w-stripe"></div><div class="w-text">WARNING</div><div class="w-sub">A HUGE ENEMY IS APPROACHING</div><div class="w-stripe"></div></div>
      <div class="director-overlay"></div>
      <div class="reticle"><i></i><i></i><i></i><i></i></div>
    `;
    this.q = (s) => this.root.querySelector(s);
    this.hpFill = this.q('.hp-fill'); this.hpNum = this.q('.hp-num');
    this.frFill = this.q('.fr-fill'); this.frenzyEl = this.q('.frenzy');
    this.wname = this.q('.wname'); this.ammo = this.q('.ammo'); this.gren = this.q('.gren b');
    this.scoreEl = this.q('.score'); this.litresEl = this.q('.litres b'); this.multEl = this.q('.mult span'); this.multWrap = this.q('.mult');
    this.announceWrap = this.q('.announce-wrap');
    this.hintEl = this.q('.hint'); this.promptEl = this.q('.prompt'); this.goEl = this.q('.go');
    this.bossEl = this.q('.bossbar'); this.bossFill = this.q('.bb-fill'); this.bossLag = this.q('.bb-lag');
    this.contEl = this.q('.continue'); this.contNum = this.q('.continue b');
    this.dirEl = this.q('.director-overlay');
    this.arenaEl = this.q('.arena-bar'); this.arenaFill = this.q('.ab-fill');
    this.arrowL = this.q('.edge-arrow.left'); this.arrowR = this.q('.edge-arrow.right');
    this.reticle = this.q('.reticle');
    this.canvas = el('canvas', 'splatter');
    this.root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.splats = [];
    this.shown = { score: 0 };
    this.bossLagV = 1;
    this.hintIdx = -1;
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    document.body.classList.add('in-game');
  }

  resize() {
    const d = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = window.innerWidth * d * 0.5;
    this.canvas.height = window.innerHeight * d * 0.5;
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
    document.body.classList.remove('in-game');
  }

  announce(text, style = 'big') {
    const now = performance.now();
    this.lastAnn = this.lastAnn || {};
    if (this.lastAnn[text] && now - this.lastAnn[text] < (style === 'small' ? 2500 : 900)) return;
    this.lastAnn[text] = now;
    if (style === 'small') { for (const old of this.announceWrap.querySelectorAll('.announce.small')) old.remove(); }
    // one headline at a time: a new big/medium call replaces the current ones instead of stacking
    if (style === 'big' || style === 'medium') for (const old of this.announceWrap.querySelectorAll('.announce.big, .announce.medium')) old.remove();
    if (this.announceWrap.children.length >= 3) this.announceWrap.firstChild.remove();
    const a = el('div', 'announce ' + style, `<span>${text}</span>`);
    if (style === 'weapon' || style === 'big' || style === 'mission' || style === 'arena') {
      for (const old of this.announceWrap.querySelectorAll('.announce.' + style)) old.remove();
    }
    this.announceWrap.appendChild(a);
    const life = style === 'small' ? 1200 : style === 'mission' ? 4500 : 1900;
    setTimeout(() => a.classList.add('out'), life);
    setTimeout(() => a.remove(), life + 500);
    while (this.announceWrap.children.length > 5) this.announceWrap.firstChild.remove();
  }

  missionCard(name, sub) {
    const mc = this.q('.mission-card');
    mc.querySelector('.mc-name').textContent = name;
    mc.querySelector('.mc-sub').textContent = sub;
    mc.classList.add('show');
    setTimeout(() => { this.announce('START!', 'mission'); }, 900);
    setTimeout(() => mc.classList.remove('show'), 2600);
  }

  bossWarning() {
    const w = this.q('.warning');
    w.classList.add('show');
    setTimeout(() => w.classList.remove('show'), 3000);
  }

  bossBar(frac, name) {
    if (name) this.bossEl.querySelector('label').textContent = name;
    this.bossEl.classList.toggle('show', frac > 0);
    this.bossFrac = frac;
  }

  go() {
    this.goEl.classList.remove('show');
    void this.goEl.offsetWidth;
    this.goEl.classList.add('show');
    setTimeout(() => this.goEl.classList.remove('show'), 3500);
  }

  hurt() { this.root.classList.remove('hurt'); void this.root.offsetWidth; this.root.classList.add('hurt'); }
  flashWeapon() { this.wname.classList.remove('flash'); void this.wname.offsetWidth; this.wname.classList.add('flash'); }
  showContinue(n) { this.contEl.classList.add('show'); this.contNum.textContent = n; }
  hideContinue() { this.contEl.classList.remove('show'); }

  screenSplatter(amount) {
    if (settings.gore === 'standard') return;
    if (settings.gore !== 'bloodbath') amount *= 0.5;
    const W = this.canvas.width, H = this.canvas.height;
    const n = Math.round(1 + amount * 3);
    for (let i = 0; i < n; i++) {
      const left = Math.random() < 0.5;
      const x = left ? Math.random() * W * 0.22 : W - Math.random() * W * 0.22;
      const y = Math.random() * H * 0.9;
      const r = (10 + Math.random() * 26) * (W / 900) * (0.6 + amount * 0.5);
      const blobs = [];
      const nb = 5 + Math.floor(Math.random() * 7);
      for (let k = 0; k < nb; k++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * r * 1.1;
        blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.8, r: r * (0.15 + Math.random() * 0.45) * (1 - d / (r * 1.6)) });
      }
      const streaks = [];
      for (let k = 0; k < 6; k++) { const a = Math.random() * Math.PI * 2; streaks.push({ a, l: r * (1.2 + Math.random() * 1.6), w: r * (0.05 + Math.random() * 0.07) }); }
      this.splats.push({ x, y, r, blobs, streaks, life: 2 + Math.random() * 1.5, t: 0, run: Math.random() * 0.6 + 0.2 });
    }
    if (this.splats.length > 24) this.splats.splice(0, this.splats.length - 24);
  }

  // write to the DOM only when the value actually changes
  setText(el, v) { if (el.__v !== v) { el.__v = v; el.textContent = v; } }
  setHTML(el, v) { if (el.__h !== v) { el.__h = v; el.innerHTML = v; } }
  setStyle(el, k, v) { const key = '__s' + k; if (el[key] !== v) { el[key] = v; el.style[k] = v; } }

  update(dt) {
    const g = this.game, P = g.player, S = g.score;
    const hpF = Math.max(0, P.hp / P.hpMax);
    this.setStyle(this.hpFill, 'transform', `scaleX(${hpF.toFixed(3)})`);
    this.setText(this.hpNum, String(Math.ceil(Math.max(0, P.hp))));
    this.root.classList.toggle('low-hp', hpF < 0.3 && P.alive);
    this.setStyle(this.frFill, 'transform', `scaleX(${(P.frenzyActive ? P.frenzyT / 7 : P.frenzy).toFixed(3)})`);
    this.frenzyEl.classList.toggle('ready', P.frenzy >= 1 && !P.frenzyActive);
    this.frenzyEl.classList.toggle('active', P.frenzyActive);
    this.setText(this.wname, P.weapon.name);
    this.setHTML(this.ammo, P.ammo === Infinity ? '&infin;' : String(P.ammo));
    this.setText(this.gren, String(P.grenades));
    this.shown.score += (S.points - this.shown.score) * Math.min(1, dt * 10);
    this.setText(this.scoreEl, Math.round(this.shown.score).toLocaleString('en-US'));
    this.setText(this.litresEl, S.litres.toFixed(2));
    this.setText(this.multEl, 'x' + S.mult.toFixed(1));
    if (this.multWrap.__m !== S.mult.toFixed(2)) { this.multWrap.__m = S.mult.toFixed(2); this.multWrap.style.setProperty('--m', ((S.mult - 1) / 7).toFixed(3)); }
    this.multWrap.classList.toggle('hot', S.mult > 3);
    // arena progress: what is left to kill before the path opens
    const A = g.arena;
    if (A && !A.boss) {
      const left = Math.max(0, A.kills - A.count);
      this.arenaEl.classList.add('show');
      this.arenaEl.querySelector('label').textContent = A.label;
      this.arenaEl.querySelector('small').textContent = left > 0 ? `KILL ${left} MORE TO ADVANCE` : 'FINISH THEM';
      this.arenaFill.style.transform = `scaleX(${Math.min(1, A.count / A.kills)})`;
    } else this.arenaEl.classList.remove('show');
    // arrows toward enemies that are off screen
    let offL = false, offR = false;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const dx = e.x - g.cam.cx, dy = e.cy - g.cam.cy;
      if (dx < -g.cam.viewW / 2) offL = true; else if (dx > g.cam.viewW / 2) offR = true;
      else if (Math.abs(dy) > g.cam.viewH / 2) { if (dx < 0) offL = true; else offR = true; }
    }
    this.arrowL.classList.toggle('show', offL && g.state === 'play');
    this.arrowR.classList.toggle('show', offR && g.state === 'play');
    // execution prompt near a bleeding enemy
    const tgt = g.state === 'play' && P.alive && !P.executing ? g.executableNear(P) : null;
    if (tgt) {
      const s = g.worldToScreen(tgt.cx, tgt.body.y + tgt.body.h + 0.5);
      this.promptEl.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      this.promptEl.classList.add('show');
    } else this.promptEl.classList.remove('show');
    // tutorial hints
    const hints = g.level.hints || [];
    let hi = -1;
    for (let i = 0; i < hints.length; i++) if (P.x > hints[i].x - 1 && P.x < hints[i].x + 11) hi = i;
    if (hi !== this.hintIdx) {
      this.hintIdx = hi;
      this.hintEl.classList.remove('show');
      if (hi >= 0) { this.hintEl.textContent = hints[hi].text; void this.hintEl.offsetWidth; this.hintEl.classList.add('show'); }
    }
    // boss bar lag
    if (this.bossFrac !== undefined) {
      this.bossLagV += (this.bossFrac - this.bossLagV) * Math.min(1, dt * 2);
      this.bossFill.style.transform = `scaleX(${this.bossFrac})`;
      this.bossLag.style.transform = `scaleX(${this.bossLagV})`;
    }
    // reticle
    const inp = g.app.input;
    const show = !inp.usingPad && inp.lastAimSource === 'mouse' && P.alive;
    this.reticle.style.display = show ? 'block' : 'none';
    if (show) {
      const spread = 8 + P.recoil * 10 + (P.weapon.spread * 120);
      this.reticle.style.transform = `translate(${inp.mouse.x}px, ${inp.mouse.y}px)`;
      this.reticle.style.setProperty('--s', spread + 'px');
    }
    // director overlay
    this.dirEl.style.display = settings.directorOverlay ? 'block' : 'none';
    if (settings.directorOverlay) this.renderDirector();
    // splatter physics
    for (const s of this.splats) { s.t += dt; s.y += s.vy * dt; s.vy += dt * 6; }
    this.splats = this.splats.filter((s) => s.t < s.life);
  }

  renderDirector() {
    const d = this.game.director, k = d.knobs;
    if (!this.dirCanvas) {
      this.dirEl.innerHTML = '<div class="dtxt"></div><canvas width="260" height="70"></canvas>';
      this.dirCanvas = this.dirEl.querySelector('canvas');
      this.dirTxt = this.dirEl.querySelector('.dtxt');
    }
    this.dirTxt.innerHTML = `AI DIRECTOR <b>${d.mode.toUpperCase()}</b><br>state <b>${d.state}</b> ${d.stateTime.toFixed(1)}s<br>skill <b>${d.skill.toFixed(2)}</b> perf ${d.lastPerf.toFixed(2)} stress <b>${d.intensity.toFixed(2)}</b><br>maxAlive ${k.maxAlive} spawn ${isFinite(k.spawnInterval) ? k.spawnInterval.toFixed(2) : '-'}s acc ${k.accuracy.toFixed(2)}<br>react ${k.reactionTime.toFixed(2)} tele ${k.telegraph.toFixed(2)} bolt ${k.projectileSpeed.toFixed(1)}<br>mix g${k.mix.grunt.toFixed(1)} l${k.mix.leaper.toFixed(2)} b${k.mix.butcher.toFixed(2)} hp% ${(k.healthDropChance * 100).toFixed(0)}`;
    const c = this.dirCanvas.getContext('2d');
    c.clearRect(0, 0, 260, 70);
    const h = d.history;
    const col = { BUILD_UP: '#553', PEAK: '#733', RELAX: '#335' };
    h.forEach((s, i) => { c.fillStyle = col[s.state]; c.fillRect(i * (260 / 240), 0, 260 / 240 + 1, 70); });
    c.lineWidth = 2;
    c.strokeStyle = '#ff3b3b'; c.beginPath(); h.forEach((s, i) => { const x = i * (260 / 240), y = 68 - s.skill * 66; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    c.strokeStyle = '#ffd24a'; c.beginPath(); h.forEach((s, i) => { const x = i * (260 / 240), y = 68 - s.intensity * 66; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
  }

  render() {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    for (const s of this.splats) {
      const a = Math.min(1, (s.life - s.t) / 1.0) * 0.8;
      c.globalAlpha = a;
      c.fillStyle = '#5e0008';
      c.strokeStyle = '#5e0008';
      c.lineCap = 'round';
      for (const k of s.streaks) {
        c.lineWidth = k.w;
        c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + Math.cos(k.a) * k.l, s.y + Math.sin(k.a) * k.l); c.stroke();
        c.beginPath(); c.arc(s.x + Math.cos(k.a) * k.l, s.y + Math.sin(k.a) * k.l, k.w * 0.9, 0, Math.PI * 2); c.fill();
      }
      for (const b of s.blobs) { c.beginPath(); c.arc(s.x + b.dx, s.y + b.dy, Math.max(1, b.r), 0, Math.PI * 2); c.fill(); }
      // running drips
      const run = s.t * 22 * s.run;
      c.lineWidth = s.r * 0.12;
      c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x, s.y + s.r * 0.6 + run); c.stroke();
      c.beginPath(); c.arc(s.x, s.y + s.r * 0.6 + run, s.r * 0.1, 0, Math.PI * 2); c.fill();
      // wet highlight
      c.fillStyle = 'rgba(255,120,120,0.18)';
      c.beginPath(); c.arc(s.x - s.r * 0.25, s.y - s.r * 0.25, s.r * 0.22, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
  }
}

// DOM menus: boot, studio logo, loading, title, options, controls, credits, mission select, pause, results.
import { audio } from '../core/audio.js';
import { settings, saveSettings, records } from '../core/settings.js';
import { rankFor } from '../game/score.js';
import { STAGE_ORDER } from '../game/levels.js';

const STAGE_NAMES = { stage1: 'MISSION 1 — ASHEN OUTSKIRTS', stage2: 'MISSION 2 — RUST CATHEDRAL', boss: 'FINAL — THE RESERVOIR' };

function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export class Menus {
  constructor(app) {
    this.app = app;
    this.ui = app.ui;
    this.stack = [];
    this.layer = null;
    this.pauseLayer = null;
  }

  blocking() { return this.stack.length > 0 && this.stack[this.stack.length - 1].modal; }

  clear() {
    for (const m of this.stack) { m.el.remove(); if (m.overlay) m.overlay.remove(); }
    this.stack = [];
    if (this.layer) { this.layer.remove(); this.layer = null; }
  }

  // --------------------------------------------------------------- boot / studio / loading
  boot(onStart) {
    const el = h(`<div class="screen boot">
      <div class="boot-drop"></div>
      <div class="boot-press">PRESS ANY KEY</div>
      <div class="boot-note">HEADPHONES RECOMMENDED &middot; CONTAINS EXTREME CARTOON GORE</div>
    </div>`);
    this.ui.appendChild(el);
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', go); window.removeEventListener('mousedown', go); window.removeEventListener('touchstart', go);
      clearInterval(padPoll);
      el.classList.add('out');
      setTimeout(() => el.remove(), 600);
      onStart().then(() => audio.sfx('ui_start', { vol: 0.8 }));
    };
    window.addEventListener('keydown', go); window.addEventListener('mousedown', go); window.addEventListener('touchstart', go);
    const padPoll = setInterval(() => { const p = [...(navigator.getGamepads?.() || [])].find((g) => g && g.buttons.some((b) => b.pressed)); if (p) go(); }, 100);
  }

  studio(next) {
    const el = h(`<div class="screen studio"><img src="assets/ui/studio_logo.webp" alt="Sanguine Softworks"><div class="studio-sub">PRESENTS</div></div>`);
    this.ui.appendChild(el);
    audio.sfx('boom_hit', { vol: 0.7 });
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      el.classList.add('out');
      window.removeEventListener('keydown', end);
      window.removeEventListener('mousedown', end);
      setTimeout(() => { el.remove(); next(); }, 700);
    };
    setTimeout(() => el.classList.add('in'), 50);
    setTimeout(end, 3600);
    setTimeout(() => { window.addEventListener('keydown', end); window.addEventListener('mousedown', end); }, 600);
  }

  loading(on, p = 0) {
    let el = this.ui.querySelector('.loading');
    if (!on) { if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 400); } return; }
    if (!el) {
      el = h(`<div class="screen loading"><div class="ld-text">LOADING</div><div class="ld-bar"><div class="ld-fill"></div></div><div class="ld-tip"></div></div>`);
      const tips = [
        'Wounds keep bleeding. A living enemy that bleeds scores 1.5x.',
        'Standing in fresh blood heals you. Stay close. Stay aggressive.',
        'The machete deflects plasma bolts back at their owner.',
        'Dash through attacks: you are invulnerable while dashing.',
        'Bleeding enemies can be EXECUTED with E for a fountain of blood and health.',
        'Frenzy (F) slows time and doubles your damage. Fill it by spilling blood.',
        'Shoot the glass blood tanks. The Legion stole that blood. Give it back.',
        'The AI Director watches how you play and adapts the pressure. Press F3 to see it.',
      ];
      el.querySelector('.ld-tip').textContent = tips[Math.floor(Math.random() * tips.length)];
      this.ui.appendChild(el);
    }
    el.querySelector('.ld-fill').style.transform = `scaleX(${p})`;
  }

  // --------------------------------------------------------------- generic menu
  // items: {label, action} | {label, type:'slider', get, set, step} | {label, type:'choice', options:[[v,label]], get, set} | {sep}
  menu(opts) {
    const el = h(`<div class="menu ${opts.cls || ''}">${opts.title ? `<h2>${opts.title}</h2>` : ''}<div class="items"></div>${opts.footer ? `<div class="menu-footer">${opts.footer}</div>` : ''}</div>`);
    const list = el.querySelector('.items');
    const entries = [];
    for (const it of opts.items) {
      if (it.sep) { list.appendChild(h(`<div class="sep"></div>`)); continue; }
      const row = h(`<button class="item ${it.type || 'button'} ${it.disabled ? 'disabled' : ''}"><span class="lbl">${it.label}</span><span class="val"></span></button>`);
      const val = row.querySelector('.val');
      const refresh = () => {
        if (it.type === 'slider') { const v = it.get(); val.innerHTML = `<i style="--v:${v}"></i><b>${Math.round(v * 100)}%</b>`; }
        else if (it.type === 'choice') { const v = it.get(); const o = it.options.find((x) => x[0] === v) || it.options[0]; val.innerHTML = `<em>&lsaquo;</em> ${o[1]} <em>&rsaquo;</em>`; }
        else if (it.hint) val.textContent = it.hint;
      };
      refresh();
      const e = { it, row, refresh };
      row.addEventListener('mouseenter', () => this.focus(m, entries.indexOf(e)));
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.focus(m, entries.indexOf(e));
        // sliders: tap/click on the bar sets the value directly; choices: tap the left third to go back
        if (it.type === 'slider') {
          const bar = row.querySelector('.val i');
          const r = bar && bar.getBoundingClientRect();
          if (r && r.width) {
            const v = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (it.max ?? 1);
            it.set(Math.round(v * 20) / 20); e.refresh(); audio.sfx('ui_move', { vol: 0.5 });
            return;
          }
        }
        if (it.type === 'choice') {
          const r = row.getBoundingClientRect();
          this.activate(m, ev.clientX < r.left + r.width * 0.55 && ev.clientX > r.left + r.width * 0.3 ? -1 : 1);
          return;
        }
        this.activate(m, 1);
      });
      list.appendChild(row);
      entries.push(e);
    }
    const m = { el, entries, idx: 0, opts, modal: !!opts.modal };
    (opts.parent || this.ui).appendChild(el);
    this.stack.push(m);
    this.focus(m, opts.start || 0, true);
    requestAnimationFrame(() => el.classList.add('in'));
    return m;
  }

  focus(m, i, silent) {
    if (i < 0 || i >= m.entries.length) return;
    if (m.idx !== i && !silent) audio.sfx('ui_move', { vol: 0.5 });
    m.idx = i;
    m.entries.forEach((e, k) => e.row.classList.toggle('focus', k === i));
  }

  activate(m, dir) {
    const e = m.entries[m.idx];
    if (!e || e.it.disabled) return;
    const it = e.it;
    if (it.type === 'slider') {
      const v = Math.max(0, Math.min(it.max ?? 1, it.get() + (it.step || 0.1) * (dir || 1)));
      it.set(Math.round(v * 100) / 100); e.refresh(); audio.sfx('ui_move', { vol: 0.5 });
    } else if (it.type === 'choice') {
      const i = it.options.findIndex((o) => o[0] === it.get());
      const n = it.options[(i + (dir || 1) + it.options.length) % it.options.length];
      it.set(n[0]); e.refresh(); audio.sfx('ui_move', { vol: 0.5 });
    } else if (it.action) {
      audio.sfx('ui_select', { vol: 0.7 });
      it.action();
    }
  }

  pop() {
    const m = this.stack.pop();
    if (!m) return;
    m.el.classList.remove('in');
    m.el.classList.add('out');
    const ov = m.overlay;
    setTimeout(() => { m.el.remove(); if (ov) ov.remove(); }, 300);
    const top = this.stack[this.stack.length - 1];
    if (top) top.el.classList.remove('hidden');
  }

  push(opts) {
    const top = this.stack[this.stack.length - 1];
    if (top) top.el.classList.add('hidden');
    // sub-menus live on their own centred overlay so they never collide with the logo or HUD
    const overlay = h(`<div class="screen overlay"></div>`);
    this.ui.appendChild(overlay);
    const m = this.menu({ ...opts, parent: overlay });
    m.overlay = overlay;
    // touch-friendly ways out: a close button, and a tap on the backdrop
    if (opts.onBack) {
      const x = h(`<button class="menu-close" aria-label="Close">&times;</button>`);
      x.addEventListener('click', (ev) => { ev.stopPropagation(); audio.sfx('ui_back', { vol: 0.6 }); opts.onBack(); });
      m.el.appendChild(x);
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) { audio.sfx('ui_back', { vol: 0.6 }); opts.onBack(); } });
    }
    return m;
  }

  update(dt, inp) {
    if (this.skipFrame) { this.skipFrame = false; return; }
    const m = this.stack[this.stack.length - 1];
    if (!m) return;
    if (this.app.game && !this.app.paused) return;
    if (inp.hit('up')) this.focus(m, (m.idx - 1 + m.entries.length) % m.entries.length);
    if (inp.hit('down')) this.focus(m, (m.idx + 1) % m.entries.length);
    const it = m.entries[m.idx]?.it;
    if (it && (it.type === 'slider' || it.type === 'choice')) {
      if (inp.hit('left')) this.activate(m, -1);
      if (inp.hit('right')) this.activate(m, 1);
    }
    if (inp.pressed.has('Enter') || inp.pressed.has('Space') || inp.pressed.has('NumpadEnter') || (inp.padDown.has(0) && !inp.padPrev.has(0))) this.activate(m, 1);
    if ((inp.pressed.has('Escape') || inp.pressed.has('Backspace') || (inp.padDown.has(1) && !inp.padPrev.has(1))) && m.opts.onBack) { audio.sfx('ui_back', { vol: 0.6 }); m.opts.onBack(); }
  }

  // --------------------------------------------------------------- title
  title() {
    this.clear();
    const layer = h(`<div class="screen title-screen">
      <div class="title-logo"><img src="assets/ui/logo.webp" alt="BLOODBATH"><div class="logo-glow"></div></div>
      <div class="title-menu"></div>
      <div class="title-foot"><span>&copy; 2026 SANGUINE SOFTWORKS</span><span class="rec"></span><span>v1.0</span></div>
    </div>`);
    this.ui.appendChild(layer);
    this.layer = layer;
    const best = Math.max(0, ...Object.entries(records).filter(([k]) => k !== 'unlocked').map(([, v]) => v.points || 0));
    layer.querySelector('.rec').textContent = best ? `BEST SCORE ${best.toLocaleString('en-US')}` : 'MAKE THEM BLEED';
    const unlocked = records.unlocked || 0;
    this.menu({
      parent: layer.querySelector('.title-menu'),
      cls: 'main',
      items: [
        { label: 'CAMPAIGN', action: () => this.app.startStage('stage1', null) },
        { label: 'MISSION SELECT', action: () => this.missionSelect(), disabled: unlocked < 1, hint: unlocked < 1 ? 'LOCKED' : '' },
        { label: 'BLOOD TIDE', hint: 'ENDLESS', action: () => this.app.startStage('arena', null) },
        { label: 'OPTIONS', action: () => this.options() },
        { label: 'CONTROLS', action: () => this.controls() },
        { label: 'CREDITS', action: () => this.credits() },
        { label: 'WATCH INTRO', action: () => this.app.toIntro() },
      ],
    });
  }

  missionSelect() {
    const unlocked = records.unlocked || 0;
    this.push({
      title: 'MISSION SELECT', cls: 'sub',
      items: [
        ...STAGE_ORDER.map((s, i) => ({ label: STAGE_NAMES[s], hint: records[s] ? records[s].points.toLocaleString('en-US') : '', disabled: i > unlocked, action: () => this.app.startStage(s, null) })),
        { sep: true },
        { label: 'BACK', action: () => this.pop() },
      ],
      onBack: () => this.pop(),
    });
  }

  optionItems() {
    const vol = (key) => ({ get: () => settings[key], set: (v) => { settings[key] = v; saveSettings(); audio.applyVolumes(); } });
    const choice = (key, options, after) => ({ type: 'choice', options, get: () => settings[key], set: (v) => { settings[key] = v; saveSettings(); after && after(v); } });
    return [
      { label: 'MASTER VOLUME', type: 'slider', ...vol('masterVolume') },
      { label: 'MUSIC', type: 'slider', ...vol('musicVolume') },
      { label: 'EFFECTS', type: 'slider', ...vol('sfxVolume') },
      { label: 'ANNOUNCER', type: 'slider', ...vol('voiceVolume') },
      { label: 'SCREEN SHAKE', type: 'slider', max: 1.5, get: () => settings.screenShake, set: (v) => { settings.screenShake = v; saveSettings(); } },
      { sep: true },
      { label: 'DIFFICULTY', ...choice('difficulty', [['adaptive', 'ADAPTIVE (AI DIRECTOR)'], ['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']]) },
      { label: 'GORE', ...choice('gore', [['standard', 'STANDARD'], ['excessive', 'EXCESSIVE'], ['bloodbath', 'BLOODBATH']], (v) => this.app.game?.blood.setGore(v)) },
      { label: 'PIXEL LOOK', ...choice('pixelScale', [['hd', 'HD (SMOOTH)'], ['hibit', 'HI-BIT'], ['retro', 'RETRO']], () => this.app.pipeline.resize()) },
      { label: 'CRT FILTER', ...choice('crt', [[false, 'OFF'], [true, 'ON']]) },
      { label: 'DIRECTOR OVERLAY', ...choice('directorOverlay', [[false, 'OFF'], [true, 'ON']]) },
      ...(document.body.classList.contains('touch') ? [
        { label: 'TOUCH AUTO-FIRE', ...choice('touchAutoFire', [[true, 'ON'], [false, 'OFF']]) },
        { label: 'TOUCH BUTTON SIZE', ...choice('touchScale', [[0.85, 'SMALL'], [1, 'MEDIUM'], [1.18, 'LARGE']], (v) => document.documentElement.style.setProperty('--tscale', v)) },
      ] : []),
      document.documentElement.requestFullscreen ? { label: 'FULLSCREEN', action: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); } } : { label: 'FULLSCREEN', hint: 'ADD TO HOME SCREEN', disabled: true },
      { sep: true },
      { label: 'BACK', action: () => this.pop() },
    ];
  }

  options() { this.push({ title: 'OPTIONS', cls: 'sub options', items: this.optionItems(), onBack: () => this.pop() }); }

  controls() {
    const m = this.push({ title: 'CONTROLS', cls: 'sub controls', items: [{ label: 'BACK', action: () => this.pop() }], onBack: () => this.pop() });
    const rows = [
      ['MOVE', 'A / D', 'LEFT STICK'], ['JUMP / DOUBLE JUMP / WALL JUMP', 'SPACE / W', 'A'], ['AIM', 'MOUSE (OR ARROWS)', 'RIGHT STICK'],
      ['SHOOT', 'LEFT MOUSE / J', 'RT'], ['MACHETE (DEFLECTS BOLTS)', 'RIGHT MOUSE / K', 'X'], ['DASH (INVULNERABLE)', 'SHIFT / L', 'B / LT'],
      ['SLIDE', 'S WHILE RUNNING', 'DOWN WHILE RUNNING'], ['DROP THROUGH', 'S + SPACE', 'DOWN + A'], ['GRENADE', 'Q / G', 'LB'],
      ['EXECUTE (BLEEDING ENEMY)', 'E', 'Y'], ['FRENZY', 'F / R', 'RB'], ['PAUSE', 'ESC / P', 'START'], ['DIRECTOR OVERLAY', 'F3', '—'],
    ];
    const touchRows = [
      ['MOVE', 'LEFT THUMB ANYWHERE ON THE LEFT HALF'], ['CROUCH / SLIDE / DROP', 'PULL THE STICK DOWN (+ JUMP TO DROP)'], ['AIM', 'AUTOMATIC LOCK-ON  ·  DRAG ON FIRE TO AIM BY HAND'],
      ['SHOOT', 'AUTO-FIRE AT THE LOCKED TARGET, OR HOLD FIRE'], ['JUMP', 'JUMP (TAP AGAIN IN THE AIR = DOUBLE JUMP)'], ['DASH', 'DASH (INVULNERABLE)'],
      ['MACHETE', 'BLADE (DEFLECTS BOLTS)'], ['EXECUTE', 'BLADE TURNS INTO EXECUTE NEXT TO A BLEEDING ENEMY'], ['GRENADE', 'NADE'], ['FRENZY', 'FRENZY APPEARS WHEN THE BAR IS FULL'], ['PAUSE', 'II BUTTON AT THE TOP'],
    ];
    const tbl = document.body.classList.contains('touch')
      ? h(`<div class="ctl-table touch-table"><div class="ctl-head"><span>ACTION</span><span>TOUCH SCREEN</span></div>${touchRows.map((r) => `<div class="ctl-row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}</div>`)
      : h(`<div class="ctl-table"><div class="ctl-head"><span>ACTION</span><span>KEYBOARD + MOUSE</span><span>GAMEPAD</span></div>${rows.map((r) => `<div class="ctl-row"><span>${r[0]}</span><span>${r[1]}</span><span>${r[2]}</span></div>`).join('')}</div>`);
    m.el.insertBefore(tbl, m.el.querySelector('.items'));
  }

  credits() {
    const m = this.push({ title: 'CREDITS', cls: 'sub credits', items: [{ label: 'BACK', action: () => this.pop() }], onBack: () => this.pop() });
    const c = h(`<div class="credits-body">
      <p><b>BLOODBATH</b><br>A Sanguine Softworks production</p>
      <p><i>DESIGN, CODE, RIGGING &amp; VFX</i><br>Claude (Anthropic) for gerald</p>
      <p><i>ENGINE</i><br>three.js &middot; WebGL2 &middot; WebAudio</p>
      <p><i>ART</i><br>Painted with OpenAI gpt-5.4-image-2 and Google Gemini 3 Pro Image</p>
      <p><i>MUSIC</i><br>Composed with Google Lyria 3</p>
      <p><i>ANNOUNCER, NARRATOR &amp; LEGION VOICES</i><br>OpenAI gpt-audio</p>
      <p><i>FONTS</i><br>Teko, Chakra Petch, Press Start 2P, Pirata One (SIL OFL)</p>
      <p class="thanks">Inspired by Metal Slug, and by every game that made pixels bleed.</p>
    </div>`);
    m.el.insertBefore(c, m.el.querySelector('.items'));
  }

  // --------------------------------------------------------------- pause
  pause() {
    const layer = h(`<div class="screen pause-screen"><div class="pause-title">PAUSED</div><div class="pause-menu"></div></div>`);
    this.ui.appendChild(layer);
    this.pauseLayer = layer;
    this.menu({
      parent: layer.querySelector('.pause-menu'), modal: false,
      items: [
        { label: 'RESUME', action: () => this.app.pause(false) },
        { label: 'RESTART MISSION', action: () => { this.app.pause(false); this.app.startStage(this.app.currentStage, this.app.currentCarry); } },
        { label: 'OPTIONS', action: () => this.push({ title: 'OPTIONS', cls: 'sub options', items: this.optionItems(), onBack: () => this.pop(), modal: true }) },
        { label: 'QUIT TO TITLE', action: () => this.confirmQuit() },
      ],
      // Esc while paused asks to quit; Esc again (or Enter) confirms
      onBack: () => this.confirmQuit(),
    });
  }

  confirmQuit() {
    if (this.stack.some((m) => m.opts.cls === 'sub confirm')) return;
    this.push({
      title: 'QUIT TO TITLE?', cls: 'sub confirm', modal: true,
      footer: document.body.classList.contains('touch') ? 'PROGRESS IN THIS MISSION IS LOST' : 'ESC OR ENTER TO QUIT &middot; PROGRESS IN THIS MISSION IS LOST',
      items: [
        { label: 'YES, QUIT', action: () => { this.clearPause(); this.app.toTitle(); } },
        { label: 'NO, KEEP BLEEDING THEM', action: () => this.pop() },
      ],
      onBack: () => { this.clearPause(); this.app.toTitle(); },
    });
  }

  clearPause() {
    while (this.stack.length) this.pop();
    if (this.pauseLayer) { const l = this.pauseLayer; l.classList.add('out'); setTimeout(() => l.remove(), 300); this.pauseLayer = null; }
  }

  // --------------------------------------------------------------- results
  results(r) {
    this.clear();
    const s = r.score;
    const rank = r.cleared || r.endless ? rankFor(s) : 'C';
    const title = r.endless ? 'BLOOD TIDE' : r.cleared ? 'MISSION COMPLETE' : 'GAME OVER';
    const mins = Math.floor(s.time / 60), secs = Math.floor(s.time % 60);
    const rows = [
      ['BLOOD SPILLED', `${s.litres.toFixed(2)} L`, s.litres],
      ['FROM THE LIVING', `${s.livingLitres.toFixed(2)} L`, s.livingLitres],
      ['KILLS', s.kills, s.kills],
      ['DISMEMBERMENTS', s.dismembers, s.dismembers],
      ['EXECUTIONS', s.executions, s.executions],
      ['DRAINED DRY', s.drained, s.drained],
      ['PARRIES', s.parries, s.parries],
      ['MAX BLOODLUST', `x${s.maxMult.toFixed(1)}`, s.maxMult],
      ['TIME', `${mins}:${String(secs).padStart(2, '0')}`, 0],
      ['DEATHS', s.deaths, s.deaths],
    ];
    const layer = h(`<div class="screen results ${r.cleared ? 'win' : 'lose'}">
      <div class="res-title">${title}</div>
      <div class="res-body">
        <div class="res-stats">${rows.map((x, i) => `<div class="res-row" style="--d:${i * 0.12 + 0.4}s"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div>
        <div class="res-side">
          <div class="res-score-l">SCORE</div>
          <div class="res-score">0</div>
          ${r.isRecord ? '<div class="res-record">NEW RECORD</div>' : ''}
          <div class="res-rank-l">RANK</div>
          <div class="res-rank rank-${rank}">${rank}</div>
        </div>
      </div>
      <div class="res-menu"></div>
    </div>`);
    this.ui.appendChild(layer);
    this.layer = layer;
    const scoreEl = layer.querySelector('.res-score');
    const t0 = performance.now();
    const target = Math.round(s.points);
    const tick = () => {
      const u = Math.min(1, (performance.now() - t0 - 1600) / 1800);
      if (u > 0) { scoreEl.textContent = Math.round(target * (1 - Math.pow(1 - u, 3))).toLocaleString('en-US'); if (Math.random() < 0.5) audio.sfx('shell', { vol: 0.2, minGap: 0.05 }); }
      if (u < 1) requestAnimationFrame(tick);
      else { scoreEl.textContent = target.toLocaleString('en-US'); }
    };
    requestAnimationFrame(tick);
    setTimeout(() => {
      layer.querySelector('.res-rank').classList.add('stamp');
      audio.sfx('boom_hit', { vol: 0.6 });
      audio.voice('rank_' + rank.toLowerCase());
      if (r.isRecord) setTimeout(() => audio.voice('new_record'), 1200);
    }, 3700);
    if (r.cleared) audio.playMusic('title', { fade: 3 });
    else audio.playMusic('gameover', { fade: 0.3 });
    const items = [];
    if (r.next) items.push({ label: 'NEXT MISSION', action: () => r.onNext() });
    if (r.cleared && !r.next && !r.endless) items.push({ label: 'THE END — WATCH CREDITS', action: () => { this.clear(); this.app.toTitle(); setTimeout(() => this.credits(), 300); } });
    items.push({ label: r.cleared ? 'REPLAY MISSION' : 'RETRY', action: () => r.onRetry() });
    items.push({ label: 'TITLE SCREEN', action: () => r.onTitle() });
    setTimeout(() => this.menu({ parent: layer.querySelector('.res-menu'), items, cls: 'res' }), 2400);
  }
}

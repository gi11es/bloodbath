// On-screen touch controls.
// Left thumb: a floating move stick anywhere on the left half (down = crouch / slide / drop).
// Right thumb: JUMP (big), FIRE pad (hold to fire; drag to aim 360°, otherwise auto-aim),
// DASH, MACHETE (becomes EXECUTE near a bleeding enemy), GRENADE, and FRENZY when it is ready.
// Every control is multi-touch: each pointer id is tracked on its own.
import { settings } from '../core/settings.js';

const STICK_R = 56;     // px travel of the move stick
const AIM_DEAD = 16;    // px before a fire-pad drag counts as manual aim

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export class TouchControls {
  constructor(app) {
    this.app = app;
    this.input = app.input;
    this.el = h(`<div class="touch-ui">
      <div class="t-stick"><div class="t-base"></div><div class="t-knob"></div></div>
      <div class="t-cluster">
        <button class="t-btn t-fire" data-a="fire"><span>FIRE</span><i class="t-aimdot"></i></button>
        <button class="t-btn t-jump" data-a="jump"><span>JUMP</span></button>
        <button class="t-btn t-dash" data-a="dash"><span>DASH</span></button>
        <button class="t-btn t-melee" data-a="melee"><span>BLADE</span></button>
        <button class="t-btn t-gren" data-a="grenade"><span>NADE</span><b></b></button>
        <button class="t-btn t-frenzy" data-a="frenzy"><span>FRENZY</span></button>
      </div>
      <button class="t-pause" data-a="pause" aria-label="Pause"><i></i><i></i></button>
    </div>`);
    document.body.appendChild(this.el);
    this.stickEl = this.el.querySelector('.t-stick');
    this.knob = this.el.querySelector('.t-knob');
    this.fireEl = this.el.querySelector('.t-fire');
    this.aimDot = this.el.querySelector('.t-aimdot');
    this.meleeLabel = this.el.querySelector('.t-melee span');
    this.grenCount = this.el.querySelector('.t-gren b');
    this.frenzyEl = this.el.querySelector('.t-frenzy');
    this.stick = null;   // {id, x0, y0, x, y}
    this.fire = null;    // {id, x0, y0, x, y}
    this.buttons = new Map(); // pointerId -> action
    const inp = this.input;
    inp.touch = { active: true, held: new Set(), pressed: new Set(), move: 0, stickY: 0, aim: null, visible: false };
    // Touch Events (not Pointer Events): every event carries the full list of active fingers,
    // so a lost release can be reconciled instead of leaving a button stuck down.
    const each = (e, fn) => { for (const t of e.changedTouches) fn({ pointerId: t.identifier, clientX: t.clientX, clientY: t.clientY, target: t.target, preventDefault: () => {} }); };
    // any finger we track that is no longer on the glass is released (covers lost touchend events)
    const reconcile = (e, starting = false) => {
      const live = new Set([...e.touches].map((t) => t.identifier));
      if (starting) for (const t of e.changedTouches) live.delete(t.identifier); // a reused id is a new finger
      const gone = (id) => !live.has(id);
      if (this.stick && gone(this.stick.id)) this.up({ pointerId: this.stick.id });
      if (this.fire && gone(this.fire.id)) this.up({ pointerId: this.fire.id });
      for (const id of [...this.buttons.keys()]) if (gone(id)) this.up({ pointerId: id });
    };
    window.addEventListener('touchstart', (e) => { const play = this.playing(); reconcile(e, true); each(e, (p) => this.down(p)); if (play) e.preventDefault(); }, { passive: false });
    window.addEventListener('touchmove', (e) => { reconcile(e); each(e, (p) => this.move(p)); if (this.playing()) e.preventDefault(); }, { passive: false });
    const end = (e) => { each(e, (p) => this.up(p)); reconcile(e); if (this.playing()) e.preventDefault(); };
    window.addEventListener('touchend', end, { passive: false });
    window.addEventListener('touchcancel', end, { passive: false });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.releaseAll(); if (this.app.game && !this.app.paused) this.app.pause(true); } });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.body.classList.add('touch');
    this.setVisible(false);
  }

  playing() {
    const g = this.app.game;
    return !!(g && g.state !== 'loading' && !this.app.paused && !document.querySelector('.screen.overlay'));
  }

  setVisible(v) {
    if (this.input.touch.visible === v) return;
    this.input.touch.visible = v;
    this.el.classList.toggle('show', v);
    if (!v) this.releaseAll();
  }

  releaseAll() {
    const t = this.input.touch;
    t.held.clear(); t.move = 0; t.stickY = 0; t.aim = null;
    this.stick = null; this.fire = null; this.buttons.clear();
    this.stickEl.classList.remove('on');
    this.el.querySelectorAll('.t-btn.on').forEach((b) => b.classList.remove('on'));
  }

  press(a) { this.input.touch.pressed.add(a); this.input.touch.held.add(a); }

  down(e) {
    const t = this.input.touch;
    this.input.pressed.add('Tap');
    this.input.anyPressed = true;
    if (!this.playing()) return;
    const g = this.app.game;
    if (g.state === 'dead' || g.state === 'clear') { t.pressed.add('confirm'); e.preventDefault(); return; }
    const hitEl = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    const btn = hitEl && hitEl.closest && hitEl.closest('[data-a]');
    if (btn && this.el.contains(btn)) {
      e.preventDefault();
      const a = btn.dataset.a;
      if (a === 'pause') { this.app.pause(true); return; }
      btn.classList.add('on');
      if (navigator.vibrate) navigator.vibrate(8);
      if (a === 'fire') {
        const r = btn.getBoundingClientRect();
        this.fire = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: e.clientX, y: e.clientY, r: r.width / 2 };
        this.updateFire();
        this.press('fire');
      } else { this.buttons.set(e.pointerId, a); this.press(a); }
      return;
    }
    // anywhere on the left 55% of the screen starts the floating move stick
    if (e.clientX < innerWidth * 0.55 && !this.stick) {
      e.preventDefault();
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      this.stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.stickEl.classList.add('on');
      this.updateStick();
    }
  }

  move(e) {
    if (this.stick && e.pointerId === this.stick.id) { e.preventDefault(); this.stick.x = e.clientX; this.stick.y = e.clientY; this.updateStick(); }
    else if (this.fire && e.pointerId === this.fire.id) { e.preventDefault(); this.fire.x = e.clientX; this.fire.y = e.clientY; this.updateFire(); }
  }

  up(e) {
    const t = this.input.touch;
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick = null; t.move = 0; t.stickY = 0;
      t.held.delete('down'); t.held.delete('up');
      this.stickEl.classList.remove('on');
    }
    if (this.fire && e.pointerId === this.fire.id) {
      this.fire = null; t.aim = null; t.held.delete('fire');
      this.fireEl.classList.remove('on');
      this.aimDot.style.transform = '';
    }
    const a = this.buttons.get(e.pointerId);
    if (a) {
      this.buttons.delete(e.pointerId);
      if (![...this.buttons.values()].includes(a)) t.held.delete(a);
      this.el.querySelector(`.t-btn[data-a="${a}"]`)?.classList.remove('on');
    }
  }

  updateStick() {
    const s = this.stick, t = this.input.touch;
    let dx = s.x - s.x0, dy = s.y - s.y0;
    const d = Math.hypot(dx, dy);
    // the base follows the thumb if it drifts too far, so the stick never "runs out"
    if (d > STICK_R * 1.5) { const k = (d - STICK_R * 1.5) / d; s.x0 += dx * k; s.y0 += dy * k; dx = s.x - s.x0; dy = s.y - s.y0; this.stickEl.style.transform = `translate(${s.x0}px, ${s.y0}px)`; }
    const cl = Math.min(1, Math.hypot(dx, dy) / STICK_R);
    const ang = Math.atan2(dy, dx);
    const kx = Math.cos(ang) * cl, ky = Math.sin(ang) * cl;
    this.knob.style.transform = `translate(${kx * STICK_R}px, ${ky * STICK_R}px)`;
    const x = Math.abs(kx) < 0.18 ? 0 : kx;
    t.move = Math.max(-1, Math.min(1, x * 1.25));
    t.stickY = ky;
    const wasDown = t.held.has('down');
    if (ky > 0.62 && Math.abs(kx) < 0.85) { if (!wasDown) t.pressed.add('down'); t.held.add('down'); } else t.held.delete('down');
    if (ky < -0.62) t.held.add('up'); else t.held.delete('up');
  }

  updateFire() {
    const f = this.fire, t = this.input.touch;
    const dx = f.x - f.cx, dy = f.y - f.cy, d = Math.hypot(dx, dy);
    if (d > AIM_DEAD) {
      t.aim = { x: dx / d, y: -dy / d };
      const k = Math.min(d, f.r * 0.9) / d;
      this.aimDot.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    } else { t.aim = null; this.aimDot.style.transform = ''; }
  }

  // per displayed frame: contextual labels and visibility
  update() {
    const g = this.app.game;
    const show = !!(g && (g.state === 'play' || g.state === 'intro') && !this.app.paused && g.player && innerWidth > innerHeight && !document.querySelector('.loading'));
    this.setVisible(show);
    if (!show) return;
    const P = g.player;
    const exec = P.alive && g.executableNear(P);
    if (this.execOn !== !!exec) { this.execOn = !!exec; this.meleeLabel.textContent = exec ? 'EXECUTE' : 'BLADE'; this.el.classList.toggle('exec', !!exec); }
    const fr = P.frenzy >= 1 && !P.frenzyActive;
    if (this.frOn !== fr) { this.frOn = fr; this.frenzyEl.classList.toggle('ready', fr); }
    const gn = String(P.grenades);
    if (this.gn !== gn) { this.gn = gn; this.grenCount.textContent = gn; }
    this.el.classList.toggle('autofire', settings.touchAutoFire);
  }

  endStep() { this.input.touch.pressed.clear(); }
}

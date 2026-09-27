import * as THREE from 'three';
import { loadTexture } from '../core/assets.js';
import { Particles } from '../render/particles.js';
import { audio } from '../core/audio.js';
import { makePanelMaterial, imgAspect } from './common.js';
import { rand, clamp, easeInOutCubic } from '../core/math.js';

const PANELS = [
  { src: 'assets/intro/panel_1.webp', voice: 'narr_1', text: 'They came from the pale north. They called themselves the Legion.', pan: [0.03, 0.0, -0.03, 0.01], zoom: [1.05, 1.16], fx: 'snow' },
  { src: 'assets/intro/panel_2.webp', voice: 'narr_2', text: 'They took the blood of the living, and sealed it in their cathedrals.', pan: [0.0, -0.03, 0.0, 0.02], zoom: [1.18, 1.06], fx: 'embers' },
  { src: 'assets/intro/panel_3.webp', voice: 'narr_3', text: 'The world went grey. The rivers ran dry.', pan: [-0.03, 0.0, 0.03, 0.0], zoom: [1.06, 1.14], fx: 'rain', desat: 0.35 },
  { src: 'assets/intro/panel_4.webp', voice: 'narr_4', text: 'But one soldier still bleeds red.', pan: [0.0, 0.02, 0.0, -0.02], zoom: [1.2, 1.08], fx: 'rainEmbers' },
  { src: 'assets/intro/panel_5.webp', voice: 'narr_5', text: 'It is time to give it all back.', pan: [0.02, 0.0, -0.01, 0.0], zoom: [1.04, 1.16], fx: 'embers' },
];
const PANEL_T = 13.17; // 5 panels end on the music's big hit at 65.46 s
const LOGO_AT = PANELS.length * PANEL_T - 0.9; // scene time starts 0.5 s after the music
const END_AT = LOGO_AT + 5;

export class IntroScene {
  constructor(app, onDone) {
    this.app = app;
    this.onDone = onDone;
    this.t = -0.5;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, -10, 10);
    this.mat = makePanelMaterial();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.scene.add(q);
    this.fx = new Particles(this.scene);
    this.tex = [];
    this.ready = Promise.all(PANELS.map((p, i) => loadTexture(p.src).then((t) => (this.tex[i] = t))));
    this.idx = -1;
    this.done = false;
  }
  enter() {
    this.el = document.createElement('div');
    this.el.className = 'screen intro';
    this.el.innerHTML = `<div class="bars top"></div><div class="bars bottom"></div><div class="subtitle"></div><div class="skip">PRESS ESC TO SKIP</div><div class="intro-logo"><img src="assets/ui/logo.webp" alt="BLOODBATH"></div>`;
    this.app.ui.appendChild(this.el);
    this.sub = this.el.querySelector('.subtitle');
    const fx = this.app.pipeline.fx;
    fx.lift.value.set(0.015, 0.0, 0.01); fx.gain.value.set(1.03, 0.98, 0.96); fx.saturation.value = 1.0; fx.exposure.value = 1.0;
    fx.bloomStrength.value = 0.5; fx.vignette.value = 0.85; fx.grain.value = 0.06; fx.frenzy.value = 0; fx.damage.value = 0;
    this.ready.then(() => { this.started = true; audio.playMusic('intro', { fade: 0.5, restart: true }); });
    setTimeout(() => this.el.classList.add('in'), 30);
  }
  exit() {
    this.el.remove();
    this.app.pipeline.fx.grain.value = 0.035;
    this.app.pipeline.fx.fade.value = 1;
  }
  finish() {
    if (this.done) return;
    this.done = true;
    this.el.classList.add('out');
    audio.stopMusic(1.2);
    setTimeout(() => this.onDone(), 900);
  }
  update(dt, inp) {
    if (!this.started) return;
    this.t += dt;
    if (this.t > 1 && (inp.pressed.has('Escape') || inp.pressed.has('Enter') || inp.pressed.has('Space') || inp.hit('pause'))) this.finish();
    if (this.t > END_AT) this.finish();
    const i = Math.floor(this.t / PANEL_T);
    if (i !== this.idx && i < PANELS.length && this.t >= 0) {
      this.idx = i;
      const p = PANELS[i];
      setTimeout(() => { if (!this.done) audio.voice(p.voice, { duck: 0.6 }); }, 1400);
      this.showSub(p.text);
      if (i > 0) audio.sfx('whoosh', { vol: 0.5 });
    }
    if (this.t > LOGO_AT && !this.logoShown) {
      this.logoShown = true;
      this.el.classList.add('logo');
      this.app.pipeline.fx.flash.value = 1.5;
      audio.sfx('boom_hit', { vol: 0.8 });
      this.sub.classList.remove('show');
    }
    const fx = this.app.pipeline.fx;
    fx.flash.value = Math.max(0, fx.flash.value - dt * 2.5);
    // particles
    const p = PANELS[clamp(this.idx, 0, PANELS.length - 1)];
    const hw = 8 * (this.app.pipeline.width / this.app.pipeline.height) / (16 / 9), hh = 4.5;
    this.cam.left = -hw; this.cam.right = hw; this.cam.updateProjectionMatrix();
    if (this.t < LOGO_AT) {
      if (p.fx === 'snow' && Math.random() < dt * 40) this.fx.alpha.add({ x: rand(-hw, hw + 3), y: hh + 0.2, vx: rand(-1.2, -0.4), vy: rand(-1.2, -0.6), life: 8, s0: rand(0.02, 0.06), s1: 0.02, shape: 0, c: [0.8, 0.78, 0.8], a0: 0.8, hold: 0.9 });
      if ((p.fx === 'embers' || p.fx === 'rainEmbers') && Math.random() < dt * 25) this.fx.ember(rand(-hw, hw), -hh - 0.2);
      if ((p.fx === 'rain' || p.fx === 'rainEmbers') && Math.random() < dt * 90) this.fx.alpha.add({ x: rand(-hw, hw + 3), y: hh + 0.3, vx: -2, vy: -16, life: 0.9, s0: 0.03, s1: 0.03, shape: 1, stretch: 7, c: [0.55, 0.58, 0.62], a0: 0.35, hold: 0.9 });
    }
    this.fx.update(dt, null);
  }
  showSub(text) {
    this.sub.classList.remove('show');
    setTimeout(() => {
      this.sub.innerHTML = text.split(' ').map((w, k) => `<span style="--d:${k * 0.07}s">${w}</span>`).join(' ');
      void this.sub.offsetWidth;
      this.sub.classList.add('show');
    }, 900);
    setTimeout(() => { if (this.sub.textContent === text.replace(/\s+/g, ' ')) this.sub.classList.remove('show'); }, 10800);
  }
  render(dt) {
    const u = this.mat.uniforms;
    const w = this.app.pipeline.width, h = this.app.pipeline.height;
    const t = Math.max(0, this.t);
    const i = Math.min(PANELS.length - 1, Math.floor(t / PANEL_T));
    const local = (t - i * PANEL_T) / PANEL_T;
    const cam = (k, lt) => {
      const P = PANELS[k];
      const e = easeInOutCubic(clamp(lt, 0, 1));
      return [P.zoom[0] + (P.zoom[1] - P.zoom[0]) * e, P.pan[0] + (P.pan[2] - P.pan[0]) * e, P.pan[1] + (P.pan[3] - P.pan[1]) * e];
    };
    u.tA.value = this.tex[i] || null;
    u.aspectA.value.set(imgAspect(this.tex[i]), w / h);
    u.camA.value.set(...cam(i, local));
    // dissolve into the next panel over the last 1.4 s
    const tr = (local * PANEL_T - (PANEL_T - 1.4)) / 1.4;
    if (tr > 0 && i + 1 < PANELS.length) {
      u.tB.value = this.tex[i + 1];
      u.aspectB.value.set(imgAspect(this.tex[i + 1]), w / h);
      u.camB.value.set(...cam(i + 1, 0));
      u.mixv.value = clamp(tr, 0, 1);
    } else u.mixv.value = 0;
    const endFade = clamp((t - (PANELS.length * PANEL_T - 1.5)) / 1.5, 0, 1);
    u.bright.value = clamp(this.t * 0.8, 0, 1) * (1 - endFade);
    u.desat.value = PANELS[i].desat || 0;
    u.time.value = t;
    this.fx.render();
    this.app.pipeline.render(this.scene, this.cam, null, t);
  }
}

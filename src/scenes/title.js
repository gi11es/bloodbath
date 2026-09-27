import * as THREE from 'three';
import { loadTexture } from '../core/assets.js';
import { Particles } from '../render/particles.js';
import { makePanelMaterial, imgAspect } from './common.js';
import { rand } from '../core/math.js';
import { BloodLogo } from './logo.js';

// Title background: painted key art with slow drift, mouse parallax, embers and blood rain.
export class TitleScene {
  constructor(app, opts = {}) {
    this.app = app;
    this.opts = opts;
    this.t = 0;
    this.scene = new THREE.Scene();
    this.fxScene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, -10, 10);
    this.mat = makePanelMaterial();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    q.renderOrder = 0;
    this.scene.add(q);
    this.fx = new Particles(this.scene);
    this.logo = new BloodLogo(this.scene);
    this.mx = 0; this.my = 0;
    loadTexture('assets/ui/title_bg.webp', { mipmaps: true }).then((t) => { this.tex = t; this.mat.uniforms.tA.value = t; });
  }
  enter() {
    const fx = this.app.pipeline.fx;
    fx.lift.value.set(0.02, 0.0, 0.01); fx.gain.value.set(1.05, 0.98, 0.95);
    fx.saturation.value = 1.05; fx.exposure.value = 1.0; fx.bloomStrength.value = 0.45; fx.vignette.value = 0.7;
    fx.frenzy.value = 0; fx.damage.value = 0; fx.aberration.value = 0.25; fx.fade.value = 1;
  }
  update(dt, inp) {
    this.t += dt;
    const w = this.app.pipeline.width, h = this.app.pipeline.height;
    const tx = (inp.mouse.x / w - 0.5), ty = (inp.mouse.y / h - 0.5);
    this.mx += (tx - this.mx) * Math.min(1, dt * 2);
    this.my += (ty - this.my) * Math.min(1, dt * 2);
    const hw = 8 * (w / h) / (16 / 9), hh = 4.5;
    this.cam.left = -hw; this.cam.right = hw; this.cam.updateProjectionMatrix();
    // embers from the bottom, blood rain from the top
    if (Math.random() < dt * 30) this.fx.ember(rand(-hw, hw), -hh - 0.2);
    if (Math.random() < dt * 40) {
      const x = rand(-hw, hw + 2);
      this.fx.alpha.add({ x, y: hh + 0.3, vx: -1.2, vy: -rand(9, 13), life: 1.2, s0: 0.035, s1: 0.03, shape: 1, stretch: 5, c: [0.45, 0.02, 0.03], a0: 0.55, hold: 0.9 });
    }
    if (Math.random() < dt * 3) this.fx.smoke(rand(-hw, hw), -hh + rand(0, 1), rand(-0.2, 0.2), 0.3, rand(0.8, 1.5), 6, [0.3, 0.06, 0.05], 0.25);
    this.fx.update(dt, null);
    this.logo.update(dt, document.querySelector('.title-logo img'), this.cam, w, h);
  }
  render(dt) {
    const u = this.mat.uniforms;
    const w = this.app.pipeline.width, h = this.app.pipeline.height;
    u.aspectA.value.set(imgAspect(this.tex), w / h);
    const s = 1.06 + Math.sin(this.t * 0.05) * 0.02;
    u.camA.value.set(s, -this.mx * 0.012, this.my * 0.01);
    u.time.value = this.t;
    u.bright.value = this.opts.dim ? 0.35 : Math.min(1, this.t * 0.8);
    u.desat.value = this.opts.dim ? 0.4 : 0;
    this.fx.render();
    this.app.pipeline.render(this.scene, this.cam, null, this.t);
  }
}

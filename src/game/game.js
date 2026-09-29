// Gameplay session: owns the scene, world, actors, blood, FX, director, score, HUD and stage flow.
import * as THREE from 'three';
import { CharacterDef, J } from './rig.js';
import { World } from './world.js';
import { Blood } from './blood.js';
import { Director } from './director.js';
import { Score } from './score.js';
import { Player } from './player.js';
import { Enemy } from './enemies.js';
import { Boss } from './boss.js';
import { Drone, loadDroneAssets } from './drone.js';
import { Projectiles } from './projectiles.js';
import { STAGES } from './levels.js';
import { THEMES } from './themes.js';
import { PICKUP_WEAPON } from './weapons.js';
import { GameCamera } from '../render/camera.js';
import { Backdrop } from '../render/backdrop.js';
import { ContactShadows } from '../render/shadows.js';
import { buildTerrain } from '../render/terrain.js';
import { Particles } from '../render/particles.js';
import { Lights, lightUniforms, makeEnvMaterial } from '../render/sprites.js';
import { FogBands } from '../render/fog.js';
import { loadTexture } from '../core/assets.js';
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { clamp, rand, pick, lerp } from '../core/math.js';
import { Hud } from '../ui/hud.js';

const PROP_TEX = (t) => `assets/props/${t}.webp`;

export class Game {
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    this.stageId = opts.stage;
    this.settings = settings;
    this.scene = new THREE.Scene();
    this.bloodScene = new THREE.Scene();
    this.cam = new GameCamera(9);
    this.lights = new Lights();
    this.time = 0;
    this.timeScale = 1;
    this.hitstopT = 0;
    this.slow = { t: 0, scale: 1 };
    this.enemies = [];
    this.gibs = [];
    this.pickups = [];
    this.props = [];
    this.pending = [];
    this.state = 'loading';
    this.stateT = 0;
    this.killStreak = { n: 0, t: 0 };
    this.milestones = new Set();
    this.arena = null;
    this.arenaClamp = null;
    this.cinematic = false;
    this.boss = null;
    this.flashLights = [];
    this.shockwaves = [];
  }

  async load(onProgress = () => {}) {
    const names = ['hero', 'grunt', 'leaper', 'butcher', 'boss'];
    const defs = await Promise.all(names.map((n) => CharacterDef.load(n, n === 'hero' ? 256 : 640)));
    this.defs = Object.fromEntries(names.map((n, i) => [n, defs[i]]));
    const order = { boss: 48, butcher: 50, grunt: 51, leaper: 52, hero: 60 };
    for (const n of names) { this.defs[n].batch.mesh.renderOrder = order[n]; this.scene.add(this.defs[n].batch.mesh); }
    this.droneAssets = await loadDroneAssets(this.scene);
    this.droneAssets.batch.mesh.renderOrder = 53;
    onProgress(0.3);
    const qs = new URLSearchParams(location.search).get('seed');
    this.seed = this.opts.seed ?? (qs ? Number(qs) : (Math.random() * 2 ** 31) | 0);
    this.level = STAGES[this.stageId](this.seed);
    this.theme = THEMES[this.level.theme];
    const L = this.level;
    this.world = new World(L.solids, L.platforms, L.bounds);
    this.backdrop = new Backdrop(this.scene, this.theme);
    await this.backdrop.ready;
    onProgress(0.55);
    await buildTerrain(this.scene, this.world, this.theme);
    this.shadows = new ContactShadows(this.scene);
    await this.buildProps();
    onProgress(0.8);
    this.blood = new Blood(this.world, this.scene, this.bloodScene);
    this.blood.livingBonus = false;
    this.blood.onSpill = (v) => this.onSpill(v);
    this.fx = new Particles(this.scene);
    this.fog = new FogBands(this.scene, this.theme);
    this.projectiles = new Projectiles(this);
    const carry = this.opts.carry || {};
    this.director = new Director({ mode: settings.difficulty, skill: carry.skill });
    this.score = new Score(carry.score);
    this.player = new Player(this, L.spawn.x, L.spawn.y);
    if (carry.weapon && carry.weapon !== 'rifle') { this.player.setWeapon(carry.weapon, false); this.player.ammo = carry.ammo; }
    if (carry.grenades !== undefined) this.player.grenades = carry.grenades;
    if (carry.frenzy !== undefined) this.player.frenzy = carry.frenzy;
    this.checkpoint = { ...L.spawn };
    this.events = L.events.map((e) => ({ ...e, done: false })).sort((a, b) => a.x - b.x);
    for (const e of this.events) if (e.type === 'pickup') { this.spawnPickup(e.x, e.y ?? 0.5, e.kind, true); e.done = true; }
    this.pickupTex = {};
    for (const k of ['h', 's', 'r', 'grenade', 'health']) this.pickupTex[k] = await loadTexture(PROP_TEX('pickup_' + k));
    this.buildPits();
    // theme lighting
    lightUniforms.ambient.value.set(...this.theme.ambient);
    lightUniforms.rimCol.value.set(...this.theme.rim);
    lightUniforms.rimDir.value.set(...this.theme.rimDir);
    this.cam.snap(L.spawn.x + 4, 3);
    const zp = new URLSearchParams(location.search).get('zoom');
    this.tightCam = !!new URLSearchParams(location.search).get('tight');
    if (zp) { this.cam.zoomMul = Number(zp); this.cam.baseViewH = 9 / Number(zp); }
    this.godMode = !!new URLSearchParams(location.search).get('god');
    delete settings.godMode;
    this.hud = new Hud(this.app.ui, this);
    this.state = 'intro';
    this.stateT = 0;
    this.cinematic = true;
    this.prewarm();
    onProgress(1);
  }

  // compile every shader and upload every texture now, behind the loading screen, not mid-fight
  prewarm() {
    const r = this.app.pipeline.renderer;
    this.cam.resize(this.app.pipeline.width / this.app.pipeline.height);
    this.cam.apply();
    r.compile(this.scene, this.cam.cam);
    r.compile(this.bloodScene, this.cam.cam);
    const seen = new Set();
    const up = (o) => {
      const m = o.material;
      if (!m || !m.uniforms) return;
      for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture && !seen.has(u.value)) { seen.add(u.value); r.initTexture(u.value); }
    };
    this.scene.traverse(up);
    for (const t of Object.values(this.pickupTex || {})) r.initTexture(t);
    // one full offscreen frame warms up the render targets and post chain
    this.render(0);
  }

  applyGrade() {
    const fx = this.app.pipeline.fx, gr = this.theme.grade;
    fx.lift.value.set(...gr.lift); fx.gain.value.set(...gr.gain);
    fx.saturation.value = gr.saturation; fx.exposure.value = gr.exposure; fx.bloomStrength.value = gr.bloom;
    fx.vignette.value = 0.55; fx.grain.value = 0.035;
  }

  start() {
    this.applyGrade();
    audio.playMusic(this.theme.music, { fade: 1.5 });
    this.hud.missionCard(this.level.name, this.level.subtitle);
    setTimeout(() => audio.voice('mission_start'), 900);
  }

  async buildProps() {
    const L = this.level;
    const texs = {};
    await Promise.all([...new Set(L.props.map((p) => p.type))].map(async (t) => { texs[t] = await loadTexture(PROP_TEX(t)); }));
    const amb = this.theme.ambient;
    for (const p of L.props) {
      const tex = texs[p.type];
      const img = tex.image;
      const aspect = img && img.width ? img.width / img.height : 1;
      const h = p.h, w = h * aspect;
      const back = p.layer === 'back';
      const k = (back ? 1.05 : 0.9) * (p.tint ?? 1);
      const scenery = back && !p.hp && !p.explosive;
      const mat = makeEnvMaterial(tex, { tint: [amb[0] * k, amb[1] * k, amb[2] * k], lightInfluence: 0.55, emissiveBoost: 0.3, highlightCompression: scenery ? 0.7 : 0, backgroundDim: scenery ? 0.68 : 1 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      const sink = p.hang ? 0 : back ? 0.18 : 0.08;
      mesh.position.set(p.x, p.y + h / 2 - sink, 0);
      if (p.flip) mesh.scale.x = -1;
      // back props render before the ground's top lip so the lip overlaps and grounds their base
      mesh.renderOrder = back ? (p.y > 0.05 ? 33 : 29.5) : 90;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.props.push({ ...p, w, mesh, mat, hpLeft: p.hp ?? 0, broken: false, shake: 0, leak: 0 });
    }
  }

  buildPits() {
    for (const pit of this.level.pits || []) {
      if (!pit.blood) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pit.x1 - pit.x0, pit.y + 8), new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }',
        fragmentShader: 'precision highp float; varying vec2 vUv; uniform float time; void main(){ float top = 1.0 - vUv.y; float w = sin(vUv.x * 60.0 + time * 2.0) * 0.004 + sin(vUv.x * 23.0 - time * 1.3) * 0.006; float d = 2.2 * smoothstep(0.0, 0.03, top + w); gl_FragColor = vec4(d, d * 0.6, 0.0, 1.0); }',
        uniforms: { time: lightUniforms.time }, transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
      }));
      m.position.set((pit.x0 + pit.x1) / 2, (pit.y - 8) / 2, 0);
      m.frustumCulled = false;
      this.bloodScene.add(m);
      this.lights.persistent.push({ x: (pit.x0 + pit.x1) / 2, y: pit.y + 0.5, color: [1, 0.08, 0.06], intensity: 1.4, radius: 9 });
    }
  }

  // ------------------------------------------------------------------ helpers
  screenToWorld(mx, my) {
    const p = this.app.pipeline;
    return { x: this.cam.cx + (mx / p.width - 0.5) * this.cam.viewW, y: this.cam.cy - (my / p.height - 0.5) * this.cam.viewH };
  }
  worldToScreen(x, y) {
    const p = this.app.pipeline;
    return { x: ((x - this.cam.cx) / this.cam.viewW + 0.5) * p.width, y: (0.5 - (y - this.cam.cy) / this.cam.viewH) * p.height };
  }
  pan(x) { return clamp((x - this.cam.x) / (this.cam.viewW / 2), -1, 1) * 0.7; }
  onScreen(x, margin = 0) { return Math.abs(x - this.cam.x) < this.cam.viewW / 2 - margin; }
  goreMul() { return settings.gore === 'standard' ? 0.7 : settings.gore === 'excessive' ? 1 : 1.25; }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  slowmo(t, scale) { this.slow = { t, scale }; }
  // run blood emission with the living-bonus flag of an enemy
  bleed(enemy, fn) { const prev = this.blood.livingBonus; this.blood.livingBonus = !!(enemy && enemy.alive); fn(); this.blood.livingBonus = prev; }

  onSpill(v) {
    this.score.addBlood(v, this.blood.livingBonus);
    if (!this.player.frenzyActive) this.player.frenzy = Math.min(1, this.player.frenzy + v * 0.022);
    const L = this.score.litres;
    const marks = [[10, 'EXCESSIVE!', 'excessive'], [30, 'MASSACRE!', 'massacre'], [60, 'BLOODBATH!', 'bloodbath'], [100, 'SANGUINE!', 'sanguine']];
    for (const [th, text, voice] of marks) if (L >= th + (this.opts.carry?.score?.litres || 0) && !this.milestones.has(th)) { this.milestones.add(th); this.announce(text, voice, 'big'); }
  }

  announce(text, voice, style = 'big') {
    this.hud.announce(text, style);
    if (voice) audio.voice(voice);
  }

  addGib(g) {
    this.gibs.push(g);
    if (this.gibs.length > 90) this.gibs.shift();
  }

  spawnPickup(x, y, kind, fixed = false) {
    this.pickups.push({ x, y, kind, vy: fixed ? 0 : 5, vx: fixed ? 0 : rand(-1.5, 1.5), t: 0, fixed, grounded: fixed });
  }

  spawnEnemy(type, x, y, opts = {}) {
    const kn = this.director.knobs;
    if (type === 'drone') {
      const d = new Drone(this, x, Math.max(y, this.cam.cy + this.cam.viewH / 2 + 0.5));
      this.enemies.push(d);
      audio.sfx('enemy_laser_charge', { vol: 0.3, rate: 1.8, pan: this.pan(x) });
      return d;
    }
    const elite = opts.elite ?? Math.random() < kn.eliteChance;
    const e = new Enemy(this, type, x, y, { ...opts, elite });
    if (opts.drop) { e.body.vy = -2; e.state = 'enter'; }
    this.enemies.push(e);
    if (Math.random() < 0.4) audio.sfx('enemy_alert', { vol: 0.5, pan: this.pan(x), minGap: 0.8 });
    return e;
  }

  aliveEnemies() { let n = 0; for (const e of this.enemies) if (e.alive) n++; return n; }

  pickSpawnPoint(drop = false) {
    const P = this.player;
    const hw = this.cam.viewW / 2;
    const ahead = Math.random() < 0.7 ? P.f : -P.f;
    let x0 = this.arena ? this.arena.x0 + 0.8 : this.level.bounds.x0 + 1;
    let x1 = this.arena ? this.arena.x1 - 0.8 : this.level.bounds.x1 - 1;
    for (let tries = 0; tries < 8; tries++) {
      const side = tries < 4 ? ahead : -ahead;
      let x = drop ? P.x + rand(-hw * 0.7, hw * 0.7) : this.cam.x + side * (hw + rand(0.8, 2));
      x = clamp(x, x0, x1);
      if (Math.abs(x - P.x) < 3.5) continue;
      const topY = drop ? this.cam.cy + this.cam.viewH / 2 + 1 : 12;
      const gy = this.world.groundBelow(x, topY);
      if (gy === -Infinity) continue;
      if (this.world.solidAt(x, gy + 0.5)) continue;
      return { x, y: drop ? topY : gy };
    }
    // fallback: any ground in the arena at least 4 m from the hero, else drop in from the sky
    for (let tries = 0; tries < 20; tries++) {
      const x = rand(x0, x1);
      if (Math.abs(x - P.x) < 4) continue;
      const gy = this.world.groundBelow(x, 12);
      if (gy === -Infinity || this.world.solidAt(x, gy + 0.5)) continue;
      return { x, y: gy };
    }
    const x = clamp(P.x + (Math.random() < 0.5 ? -6 : 6), x0, x1);
    return { x, y: this.cam.cy + this.cam.viewH / 2 + 1 };
  }

  // ------------------------------------------------------------------ combat queries
  hitEnemies(x0, y0, x1, y1, p) {
    let best = null, bestE = null;
    const cands = this.boss ? [...this.enemies, this.boss] : this.enemies;
    for (const e of cands) {
      if (e.removeMe || p.hits.has(e)) continue;
      const h = e.hitTest(x0, y0, x1, y1, p.r);
      if (h && (!best || h.t < best.t)) { best = h; bestE = e; }
    }
    if (!best) return false;
    const W = p.weapon || {};
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
    const kind = p.kind === 'disc' ? 'disc' : p.pellet ? 'pellet' : p.reflected ? 'bolt' : 'bullet';
    const res = bestE.damage({ dmg: p.dmg, x: best.x, y: best.y, dx: dx / l, dy: dy / l, seg: best.seg, kind,
      dismember: p.reflected ? 1.5 : W.dismember ?? 0.3, bleed: p.reflected ? 0.2 : W.bleed ?? 0.05, knock: W.knock ?? 2 });
    if (bestE.alive !== undefined && res && res !== 'corpse') this.director.win.hits += 1;
    if (res === 'blocked') {
      if (p.kind === 'disc') { p.vx = -p.vx; p.hits.add(bestE); return false; }
      return true;
    }
    if (p.kind === 'disc') { p.hits.add(bestE); p.bloody = 1; this.hitstop(0.02); audio.sfx('ripper_hit', { vol: 0.6, minGap: 0.05 }); }
    else if (p.pellet && res === 'hit') this.hitstop(0.015);
    return true;
  }

  hitProps(x0, y0, x1, y1, p) {
    for (const pr of this.props) {
      if (!pr.hp || pr.broken) continue;
      const bx0 = pr.x - pr.w * 0.35, bx1 = pr.x + pr.w * 0.35, by0 = pr.y, by1 = pr.y + pr.h * 0.9;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      if ((x1 > bx0 && x1 < bx1 && y1 > by0 && y1 < by1) || (mx > bx0 && mx < bx1 && my > by0 && my < by1)) {
        if (p.owner === 'enemy') return false;
        this.damageProp(pr, p.dmg, x1, y1);
        return true;
      }
    }
    return false;
  }

  damageProp(pr, dmg, x, y) {
    pr.hpLeft -= dmg;
    pr.shake = 0.15;
    this.fx.spark(x, y, rand(0, 6.28), 5, 5, [4, 3, 2]);
    if (pr.blood) {
      // a leak spurts from the hole even before the tank breaks
      this.blood.livingBonus = false;
      this.blood.spurt(x, y, rand(-0.3, 0.3) + (x < pr.x ? Math.PI : 0), 5, 6, 0.4, Math.min(0.05, pr.blood * 0.02));
      audio.sfx('glass_break', { vol: 0.2, rate: 1.8, minGap: 0.1 });
    } else audio.sfx('armor_hit', { vol: 0.3, minGap: 0.05 });
    if (pr.hpLeft <= 0 && !pr.broken) this.breakProp(pr);
  }

  breakProp(pr) {
    pr.broken = true;
    if (pr.explosive) {
      pr.mesh.visible = false;
      this.explode(pr.x, pr.y + 0.6, 3.2, 120, 'barrel');
      return;
    }
    if (pr.blood) {
      pr.leak = pr.blood;
      pr.mat.uniforms.tint.value.multiplyScalar(0.6);
      audio.sfx('glass_break', { vol: 0.9, pan: this.pan(pr.x) });
      this.fx.debris(pr.x, pr.y + pr.h * 0.5, Math.PI / 2, 6, 20, [0.9, 0.5, 0.5]);
      this.cam.shake(0.3);
      this.score.addEvent('prop');
      this.hud.announce('BLOOD RELEASED', 'small');
    }
  }

  impact(x, y, nx, ny, p) {
    const a = Math.atan2(ny, nx);
    if (p.owner === 'enemy') { this.fx.spark(x, y, a, 4, 6, [4, 0.4, 0.3]); this.fx.glow(x, y, 0.5, [2, 0.1, 0.1], 0.15); return; }
    this.fx.spark(x, y, a, 6, p.pellet ? 2 : 4);
    if (Math.random() < 0.4) this.fx.dust(x, y, 1, nx);
    this.fx.flash(x, y, 0.2, [3, 2, 1], 0.04);
  }

  explode(x, y, r, dmg, owner) {
    this.fx.explosion(x, y, r);
    this.lights.add(x, y, [1, 0.6, 0.3], 9, r * 4);
    this.flashLights.push({ x, y, t: 0.35, r: r * 4 });
    this.cam.shake(0.7);
    this.cam.zoomPunch(0.6);
    this.hitstop(0.05);
    audio.sfx('explosion', { vol: 1, pan: this.pan(x) });
    const cands = this.boss ? [...this.enemies, this.boss] : this.enemies;
    for (const e of cands) {
      if (e.removeMe) continue;
      const d = Math.hypot(e.cx - x, e.cy - y);
      if (d < r) {
        const k = 1 - d / r;
        e.damage({ dmg: dmg * (0.4 + 0.6 * k), x: e.cx, y: e.cy, dx: Math.sign(e.cx - x) || 1, dy: 0.5, seg: 'torso', kind: 'explosion', dismember: 2, bleed: 0.25, knock: 10 * k });
      }
    }
    for (const pr of this.props) if (pr.hp && !pr.broken && Math.abs(pr.x - x) < r) this.damageProp(pr, dmg * 0.5, pr.x, pr.y + 0.5);
    const P = this.player;
    if (owner !== 'player' && P.alive && Math.hypot(P.cx - x, P.cy - y) < r * 0.8) P.takeDamage(owner === 'barrel' ? 18 : 25, Math.sign(P.cx - x), null, 10);
    for (const g of this.gibs) if (Math.hypot(g.x - x, g.y - y) < r * 1.5) { g.asleep = false; g.vx += Math.sign(g.x - x) * 6; g.vy += 7; g.vr += rand(-20, 20); }
  }

  meleeSweep(P, M) {
    const sx = P.rig.jx(J.shoulder), sy = P.rig.jy(J.shoulder);
    const cands = this.boss ? [...this.enemies, this.boss] : this.enemies;
    let hitAny = false;
    for (const e of cands) {
      if (e.removeMe || P.meleeHit.has(e)) continue;
      const pts = e.meleePoints ? e.meleePoints() : null;
      const ex = pts ? pts[0] : e.alive ? e.cx : e.rig.jx(J.hip), ey = pts ? pts[1] : e.alive ? e.cy : e.rig.jy(J.hip);
      const dx = ex - sx, dy = ey - sy;
      const d = Math.hypot(dx, dy);
      const reach = M.reach + (e.meleeRadius || 0.35);
      if (d > reach) continue;
      if (M.kind !== 2 && dx * P.f < -0.25) continue;
      P.meleeHit.add(e);
      hitAny = true;
      // choose a segment by height relative to the enemy
      let seg = 'torso';
      if (e.alive && e.rig) {
        const hy = (sy + Math.sin(P.aim) * 0.6 - e.body.y) / e.body.h;
        const r = Math.random();
        seg = hy > 0.8 ? (r < 0.6 ? 'head' : 'upperarmF') : hy > 0.45 ? (r < 0.5 ? 'torso' : r < 0.75 ? 'upperarmF' : 'forearmB') : (r < 0.5 ? 'thighF' : 'shinB');
        if (e.rig.missing.has(seg)) seg = 'torso';
      } else if (e.rig) seg = pick(['head', 'upperarmF', 'thighF', 'torso', 'shinB']);
      const frz = P.frenzyActive ? 2 : 1;
      e.damage({ dmg: M.dmg * frz, x: ex, y: ey, dx: P.f, dy: 0.1, seg, kind: 'blade', dismember: M.dismember, bleed: M.bleed, knock: M.kind === 2 ? 7 : 4 });
      this.fx.slashArc(ex, ey, 0.25, P.aim - 1, P.aim + 1, [3, 0.4, 0.3], 0.12);
      audio.sfx('slash_hit', { vol: 0.8, pan: this.pan(ex) });
    }
    if (hitAny) { this.hitstop(0.055); this.cam.shake(0.18); this.cam.kick(P.f * 0.08, 0); }
    // visual arc (once per swing)
    if (!P.meleeFxDone || P.meleeFxDone !== P.meleeIdx + ':' + Math.floor(P.t * 4)) {
      if (!P.meleeArcShown) {
        P.meleeArcShown = true;
        const a0 = P.rig.meleeAng ?? 0;
        const span = M.kind === 2 ? 5.5 : 2.4;
        const dir = M.kind === 1 ? 1 : -1;
        this.fx.slashArc(sx, sy, M.reach * 0.85, a0 - dir * span * 0.3 * P.f, a0 + dir * span * 0.7 * P.f, [3.2, 2.9, 2.6], 0.16);
        setTimeout(() => (P.meleeArcShown = false), M.dur * 800);
      }
    }
  }

  deflect(p, P) {
    let target = null, bd = 1e9;
    for (const e of this.enemies) { if (!e.alive) continue; const d = Math.hypot(e.cx - p.x, e.cy - p.y); if (d < bd && d < 18) { bd = d; target = e; } }
    if (this.boss && this.boss.alive) { const d = Math.hypot(this.boss.cx - p.x, this.boss.cy - p.y); if (d < bd) target = this.boss; }
    const sp = Math.hypot(p.vx, p.vy) * 1.8;
    const a = target ? Math.atan2(target.cy - p.y, target.cx - p.x) : Math.atan2(-p.vy, -p.vx);
    p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
    p.owner = 'player'; p.reflected = true; p.dmg = 45; p.t = 0; p.hits = new Set();
    this.fx.flash(p.x, p.y, 0.8, [4, 3.5, 2.5], 0.1);
    this.fx.spark(p.x, p.y, a, 8, 10, [4, 3.5, 2.5]);
    this.hitstop(0.08);
    this.cam.shake(0.15);
    audio.sfx('armor_hit', { vol: 0.9, rate: 1.3 });
    this.score.addEvent('parry');
    this.director.onDodge();
    this.hud.announce('PARRY', 'small');
    P.frenzy = Math.min(1, P.frenzy + 0.04);
  }

  // Aim assist for touch screens: the most threatening visible target, favouring the way the
  // hero is moving and facing. Returns an aim point {x, y} or null.
  autoAimTarget(P) {
    const c = this.cam;
    let best = null, bs = Infinity;
    const mx = Math.sign(this.app.input.moveX() || P.f);
    const mz = [P.rig.jx(J.shoulder), P.rig.jy(J.shoulder) - 0.25];
    const consider = (x, y, bonus, e) => {
      if (Math.abs(x - c.cx) > c.viewW / 2 + 0.3 || Math.abs(y - c.cy) > c.viewH / 2 + 0.3) return;
      const dx = x - P.cx, dy = y - P.cy;
      const d = Math.hypot(dx, dy);
      if (d > 14) return;
      // line of sight from the gun: skip targets behind walls and cover
      if (this.world.raycast(mz[0], mz[1], x, y)) return;
      let score = d + (Math.sign(dx) !== mx ? 3.5 : 0) - bonus;
      if (e === P.lastAuto) score -= 1.2; // stickiness: do not flick between targets
      if (score < bs) { bs = score; best = { x, y, e }; }
    };
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const threat = e.state === 'aim' || e.state === 'windup' || e.state === 'crouch' ? 2 : 0;
      consider(e.cx, e.cy + (e.body ? e.body.h * 0.12 : 0), threat, e);
    }
    if (this.boss && this.boss.alive) {
      const b = this.boss;
      if (!b.tankBroken) { const [tx, ty] = b.tankPos(); consider(tx, ty, 1, b); }
      else consider(b.cx, b.cy + 0.8, 1, b);
    }
    for (const pr of this.props) if (pr.hp && !pr.broken && pr.explosive) consider(pr.x, pr.y + 0.6, -1.5, pr);
    P.lastAuto = best ? best.e : null;
    return best;
  }

  executableNear(P) {
    let best = null, bd = 2.0;
    for (const e of this.enemies) {
      if (!e.alive || !e.executable) continue;
      const d = Math.abs(e.x - P.x);
      if (d < bd && Math.abs(e.y - P.y) < 1.3) { bd = d; best = e; }
    }
    if (this.boss && this.boss.executable && Math.abs(this.boss.x - P.x) < 3.5) best = this.boss;
    return best;
  }

  beginExecution(P, target) {
    this.slowmo(0.7, 0.3);
    this.cam.zoomPunch(1.2);
    this.cam.zoomTarget = 1.25;
    target.executed = true;
    if (target.setState && !target.stunned) target.setState('stagger', 2);
    audio.sfx('whoosh', { vol: 0.6 });
  }

  finishExecution(P, target) {
    this.cam.zoomTarget = 1;
    if (target.onExecuted) { target.onExecuted(P); }
    else {
      const hit = { dmg: 999, x: target.cx, y: target.cy + 0.5, dx: P.f, dy: 0.3, seg: 'head', kind: 'execution', dismember: 3, bleed: 1, knock: 5 };
      if (target.type === 'butcher' || Math.random() < 0.35) {
        target.sever('upperarmF', hit);
        target.sever('head', hit);
      } else target.sever('head', hit);
      if (target.alive) target.die(hit);
      // massive fountain from the neck
      for (const w of target.wounds) if (w.stump) w.rate = 1.6;
      target.heartRate = 2.2;
    }
    P.heal(12);
    P.shoutT = 1.2;
    P.frenzy = Math.min(1, P.frenzy + 0.3);
    this.score.addEvent('execution');
    this.hitstop(0.12);
    this.cam.shake(0.55);
    audio.sfx('execution', { vol: 1 });
    this.announce('EXECUTION!', 'execution', 'big');
    this.hud.screenSplatter(1);
  }

  startFrenzy() {
    const P = this.player;
    P.frenzyT = 7;
    P.frenzy = 0;
    this.announce('FRENZY!', 'frenzy', 'big');
    audio.sfx('frenzy_start', { vol: 1 });
    this.cam.zoomPunch(1);
    this.fx.ring(P.cx, P.cy, 6, [4, 0.3, 0.2], 0.5);
  }

  // ------------------------------------------------------------------ callbacks
  onEnemyKilled(e, hit) {
    if (hit.kind === 'fall') { this.arenaKill(); return; }
    this.score.addEvent('kill');
    if (hit.headshot) this.score.addEvent('headshot');
    this.director.onEnemyKilled(e.age);
    this.player.frenzy = Math.min(1, this.player.frenzy + 0.03);
    // kill streaks
    const ks = this.killStreak;
    ks.n = ks.t > 0 ? ks.n + 1 : 1;
    ks.t = 1.6;
    if (ks.n === 2) this.announce('DOUBLE KILL', 'double_kill', 'medium');
    else if (ks.n === 3) this.announce('MULTI KILL', 'multi_kill', 'medium');
    else if (ks.n === 5) this.announce('MASSACRE!', 'massacre', 'big');
    this.arenaKill();
    // drops
    const kn = this.director.knobs;
    const P = this.player;
    const r = Math.random();
    const hpNeed = P.hp < P.hpMax * 0.6 ? 1.4 : 0.4;
    if (r < kn.healthDropChance * hpNeed * 0.5) this.spawnPickup(e.cx, e.cy, 'health');
    else if (r < kn.healthDropChance * hpNeed * 0.5 + 0.06) this.spawnPickup(e.cx, e.cy, 'G');
    else if (r < kn.healthDropChance * hpNeed * 0.5 + 0.06 + (P.weapon.id === 'rifle' ? 0.07 : 0.02)) this.spawnPickup(e.cx, e.cy, pick(['H', 'S', 'R']));
    // close kills spray the hero with healing mist
    if (Math.abs(e.x - P.x) < 2.2) P.heal(1.5);
  }
  arenaKill() { if (this.arena) { this.arena.count++; this.arena.lastKill = this.time; } }
  onDismember(e, seg) {
    this.score.addEvent('dismember');
    this.cam.shake(0.12);
    if (Math.random() < 0.08) this.hud.announce(seg === 'head' ? 'DECAPITATED' : 'DISMEMBERED', 'small');
  }
  onGibbed() { this.score.addEvent('gib'); this.cam.shake(0.25); this.hud.screenSplatter(0.5); }
  onDrained(e) { this.score.addEvent('drained'); this.hud.announce('DRAINED', 'small'); }
  onPlayerHurt(dmg) { this.cam.shake(0.3); this.hitstop(0.04); this.hud.hurt(dmg); }
  onPerfectDodge() { if (!this.dodgeCd || this.time > this.dodgeCd) { this.dodgeCd = this.time + 1; this.slowmo(0.25, 0.5); this.player.frenzy = Math.min(1, this.player.frenzy + 0.05); } }
  onPlayerDeath() {
    this.state = 'dead';
    this.stateT = 0;
    this.score.deaths++;
    this.director.onPlayerDeath();
    this.slowmo(1.2, 0.3);
    audio.setMusicMuffle(0.8);
    this.cam.zoomTarget = 1.15;
  }

  continueGame() {
    const P = this.player;
    const x = this.arena ? clamp(P.body.x, this.arena.x0 + 1, this.arena.x1 - 1) : P.body.x;
    const gy = this.world.groundBelow(x, 12);
    P.revive(x, gy === -Infinity ? this.checkpoint.y : gy);
    // clear bolts, shock nearby enemies
    for (const p of this.projectiles.list) if (p.owner === 'enemy') p.dead = true;
    for (const e of this.enemies) if (e.alive && Math.abs(e.x - x) < 5) { e.body.vx += Math.sign(e.x - x) * 8; e.setState('stagger', 1); }
    this.fx.ring(P.cx, P.cy, 7, [3, 1.5, 0.8], 0.5);
    this.state = 'play';
    audio.setMusicMuffle(0);
    this.cam.zoomTarget = 1;
    this.hud.hideContinue();
  }

  // ------------------------------------------------------------------ update
  update(dt, input) {
    if (this.state === 'loading') return;
    this.time += dt;
    this.stateT += dt;
    lightUniforms.time.value = this.time;
    // time scales
    let scale = 1;
    if (this.slow.t > 0) { this.slow.t -= dt; scale = this.slow.scale; }
    if (this.hitstopT > 0) { this.hitstopT -= dt; scale = 0; }
    const P = this.player;
    const frz = P.frenzyActive ? 0.6 : 1;
    const wdt = dt * scale * frz;
    const pdt = dt * scale;

    if (this.state === 'intro') {
      if (this.stateT > 2.2) { this.state = 'play'; this.cinematic = false; }
    }
    if (this.state === 'dead') {
      if (this.stateT > 1.6) {
        if (this.level.endless) { if (this.stateT > 3) this.finish(false); }
        else {
          const left = Math.max(0, 10 - (this.stateT - 1.6));
          this.hud.showContinue(Math.ceil(left));
          if (!this.continueVoiced) { this.continueVoiced = true; audio.voice('continue'); }
          if (input.hit('fire') || input.hit('confirm') || input.hit('jump')) { this.continueVoiced = false; this.continueGame(); }
          else if (left <= 0) { this.hud.hideContinue(); audio.voice('game_over'); this.finish(false); }
        }
      }
    }
    if (this.state === 'clear') {
      if (this.stateT > 5 && !this.finished) this.finish(true);
    }
    P.update(pdt, input);
    if (this.state === 'play') { this.updateEvents(); this.updateSpawning(wdt); }
    for (const e of this.enemies) e.update(wdt);
    if (this.boss) this.boss.update(wdt);
    this.enemies = this.enemies.filter((e) => !e.removeMe);
    // corpse limit
    const corpses = this.enemies.filter((e) => !e.alive);
    if (corpses.length > 22) corpses[0].deadT = Math.max(corpses[0].deadT, 40);
    for (const g of this.gibs) g.update(wdt, this.world, this.blood);
    this.projectiles.update(wdt);
    this.blood.update(wdt);
    this.fx.update(wdt, this.world);
    this.score.update(wdt);
    this.director.update(wdt, { threatsNear: this.threatsNear(), playerHpFrac: P.hp / P.hpMax, activeEnemies: this.aliveEnemies() });
    this.killStreak.t -= wdt;
    this.updatePickups(wdt);
    this.updateShockwaves(wdt);
    this.updateProps(wdt);
    this.updateAmbient(wdt);
    // camera
    const lookX = Math.cos(P.aim) * 2.0 + P.body.vx * 0.15;
    const lookY = Math.sin(P.aim) * 0.9;
    // touch screens: frame the ground higher so the fight stays above the thumb buttons
    const touchCam = !!(this.app.input.touch && this.app.input.touch.visible);
    const floorView = touchCam ? 2.3 : 1.6;
    const camB = this.arena ? { x0: this.arena.x0, x1: this.arena.x1, y0: -floorView, y1: 13 } : { x0: this.level.bounds.x0, x1: this.level.bounds.x1, y0: -floorView, y1: 13 };
    const ty = Math.max(this.cam.viewH / 2 - floorView + 0.1, P.body.y + (touchCam ? 1.6 : 2.3) * this.cam.viewH / 9);
    if (this.tightCam) { this.cam.snap(P.body.x, P.body.y + 1.0); }
    else {
      this.cam.follow(P.body.x, ty, lookX, lookY, pdt || dt * 0.2, camB);
      // whatever the clamps and look-ahead say, the hero never leaves the safe middle of the frame
      const mx = this.cam.viewW / 2 - Math.min(3, this.cam.viewW * 0.2);
      if (P.body.x - this.cam.x > mx) this.cam.x = P.body.x - mx;
      if (this.cam.x - P.body.x > mx) this.cam.x = P.body.x + mx;
    }
    this.cam.update(dt);
    // post fx
    const fx = this.app.pipeline.fx;
    fx.frenzy.value = lerp(fx.frenzy.value, P.frenzyActive ? 1 : 0, 1 - Math.exp(-dt * 6));
    fx.bloomStrength.value = this.theme.grade.bloom * (1 - fx.frenzy.value * 0.5);
    fx.damage.value = Math.max(fx.damage.value - dt * 1.5, P.alive ? clamp(1 - P.hp / 35, 0, 1) * (0.6 + Math.sin(this.time * 6) * 0.2) : 1);
    fx.aberration.value = 0.3 + (this.hitstopT > 0 ? 1.5 : 0) + fx.frenzy.value * 0.8;
    audio.setMusicMuffle(P.frenzyActive ? 0.5 : this.state === 'dead' ? 0.8 : 0);
    if (P.frenzyActive && Math.floor(this.time * 1.4) !== this.lastBeat) { this.lastBeat = Math.floor(this.time * 1.4); audio.sfx('heartbeat', { vol: 0.8 }); }
    if (P.alive && P.hp < 30 && Math.floor(this.time * 1.1) !== this.lastAlarm) { this.lastAlarm = Math.floor(this.time * 1.1); audio.sfx('heartbeat', { vol: 0.6 }); if (this.lastAlarm % 3 === 0) audio.sfx('low_health_alarm', { vol: 0.3 }); }
    this.hudDt = (this.hudDt || 0) + dt;
  }

  threatsNear() {
    let n = 0;
    const P = this.player;
    for (const e of this.enemies) if (e.alive && Math.abs(e.x - P.x) < 6) n++;
    for (const p of this.projectiles.list) if (p.owner === 'enemy' && Math.abs(p.x - P.x) < 4) n += 0.5;
    return n;
  }

  updateEvents() {
    const P = this.player;
    for (const e of this.events) {
      if (e.done) continue;
      if (e.type === 'arena' && P.x < e.x) continue;
      if (e.type !== 'arena' && P.x < e.x) continue;
      e.done = true;
      if (e.type === 'checkpoint') {
        this.checkpoint = { x: e.x, y: this.world.groundBelow(e.x, 12) };
        this.hud.announce('CHECKPOINT', 'small');
        audio.voice('checkpoint');
      } else if (e.type === 'ambush') {
        for (const s of e.spawns) this.pending.push({ type: s.type, x: P.x + s.dx, delay: s.delay || 0 });
      } else if (e.type === 'arena') {
        this.arena = { ...e, count: 0, spawned: 0, t: 0, lastKill: this.time };
        this.arenaClamp = [e.x0, e.x1];
        this.hud.announce(e.label, 'arena');
        audio.sfx('boom_hit', { vol: 0.5 });
      } else if (e.type === 'boss') {
        this.startBoss();
      } else if (e.type === 'end') {
        this.stageClear();
      }
    }
    // arena stall recovery: stragglers that cannot reach the hero are brought back into view
    const seen = (e) => this.onScreen(e.x, 1) && Math.abs(e.cy - this.cam.cy) < this.cam.viewH / 2 - 0.3;
    if (this.arena && !this.arena.boss && this.time - (this.arena.lastKill ?? this.time) > 8 && !this.enemies.some((e) => e.alive && seen(e))) {
      this.arena.lastKill = this.time;
      for (const e of this.enemies) {
        if (!e.alive || seen(e)) continue;
        const sp = this.pickSpawnPoint(false);
        if (sp) { e.body.x = sp.x; e.body.y = sp.y; e.body.vx = 0; e.body.vy = 0; e.setState('advance'); }
      }
    }
    // arena completion
    const inArena = this.arena ? this.enemies.filter((e) => e.alive && e.x > this.arena.x0 - 2 && e.x < this.arena.x1 + 2).length : 0;
    if (this.arena && !this.arena.boss && this.arena.count >= this.arena.kills && inArena === 0) {
      this.arena = null;
      this.arenaClamp = null;
      this.hud.go();
      audio.voice('okay');
    }
  }

  updateSpawning(dt) {
    // scripted
    for (const s of this.pending) {
      s.delay -= dt;
      if (s.delay <= 0 && !s.done) {
        s.done = true;
        const x = clamp(s.x, this.level.bounds.x0 + 1, this.level.bounds.x1 - 1);
        if (s.drop) this.spawnEnemy(s.type, x, s.y, { drop: true });
        else {
          const gy = this.world.groundBelow(x, 12);
          if (gy > -Infinity) this.spawnEnemy(s.type, x, gy);
        }
      }
    }
    this.pending = this.pending.filter((s) => !s.done);
    if (this.boss) { this.boss.spawnAdds && this.boss.spawnAdds(dt); return; }
    const alive = this.aliveEnemies();
    let allow = false;
    if (this.arena && !this.arena.boss) {
      // arenas never make the player wait: an empty arena immediately calls the next wave
      const A = this.arena;
      const toSpawn = A.kills - A.count - alive - this.pending.length;
      if (toSpawn <= 0) return;
      const kn = this.director.knobs;
      if (alive === 0 && this.pending.length === 0) {
        A.wave = (A.wave || 0) + 1;
        const n = Math.min(toSpawn, Math.max(2, kn.maxAlive - (this.director.state === 'RELAX' ? 2 : 0)));
        const gap = A.wave === 1 ? 0.25 : 0.9;
        for (let i = 0; i < n; i++) {
          let type = this.director.pickType();
          if (type === 'butcher' && !A.butcher && this.stageId === 'stage1') type = 'grunt';
          const sp = this.pickSpawnPoint(Math.random() < 0.3);
          if (sp) this.pending.push({ type, x: sp.x, y: sp.y, delay: gap + i * 0.35, drop: sp.y > this.world.groundBelow(sp.x, sp.y) + 1 });
        }
        if (A.wave > 1) this.hud.announce(`WAVE ${A.wave}`, 'small');
        return;
      }
      allow = alive < kn.maxAlive;
    } else if (this.level.endless) allow = true;
    else {
      // light roaming pressure between arenas, only ahead of the player
      const next = this.events.find((e) => !e.done && e.type === 'arena');
      allow = alive < 2 && (!next || next.x - this.player.x > 14) && this.stateT > 6;
      if (allow && Math.random() > 0.004) allow = false;
    }
    if (!allow) return;
    if (!this.director.wantSpawn(alive)) return;
    let type = this.director.pickType();
    if (type === 'butcher' && !(this.arena?.butcher || this.level.endless || this.stageId !== 'stage1')) type = 'grunt';
    if (type === 'drone' && !this.arena && !this.level.endless) type = 'grunt';
    const drop = this.arena && Math.random() < 0.3;
    const sp = this.pickSpawnPoint(drop);
    if (!sp) return;
    this.spawnEnemy(type, sp.x, sp.y, { drop });
    if (this.arena) this.arena.spawned++;
  }

  startBoss() {
    this.boss = new Boss(this, 26, 0);
    this.arena = { x0: 0, x1: 34, kills: Infinity, count: 0, boss: true };
    this.arenaClamp = [0.3, 33.7];
    this.cinematic = true;
    this.hud.bossWarning();
    audio.voice('boss_warning');
    setTimeout(() => { this.cinematic = false; }, 3200);
  }

  onBossDefeated() {
    this.arena = null;
    this.arenaClamp = null;
    setTimeout(() => this.stageClear(), 3500);
  }

  stageClear() {
    if (this.state === 'clear') return;
    this.state = 'clear';
    this.stateT = 0;
    this.cinematic = true;
    audio.playMusic('victory', { fade: 0.4 });
    audio.voice('mission_complete');
    this.hud.announce('MISSION COMPLETE!', 'mission');
  }

  finish(cleared) {
    this.finished = true;
    const P = this.player;
    this.app.onStageEnd({
      stage: this.stageId, cleared, endless: !!this.level.endless,
      score: this.score.snapshot(),
      carry: { skill: this.director.skill, score: this.score.snapshot(), weapon: P.weapon.id, ammo: P.ammo, grenades: P.grenades, frenzy: P.frenzy },
    });
  }

  updateShockwaves(dt) {
    const P = this.player;
    for (const w of this.shockwaves) {
      w.t += dt;
      w.x += w.dir * w.speed * dt;
      const gy = this.world.groundBelow(w.x, w.y + 1);
      if (gy < w.y - 0.5 || this.world.solidAt(w.x, w.y + 0.3)) { w.t = w.life; continue; }
      if (Math.random() < 0.7) this.fx.dust(w.x, gy, 1, w.dir * 2);
      if (Math.random() < 0.3) this.fx.debris(w.x, gy, Math.PI / 2, 4, 1);
      if (!w.hit && P.alive && P.body.grounded && Math.abs(P.x - w.x) < 0.55 && Math.abs(P.y - gy) < 0.5) {
        w.hit = true;
        P.takeDamage(16, w.dir, null, 8);
      }
    }
    this.shockwaves = this.shockwaves.filter((w) => w.t < w.life);
  }

  updatePickups(dt) {
    const P = this.player;
    for (const p of this.pickups) {
      p.t += dt;
      if (!p.grounded) {
        p.vy -= 22 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const gy = this.world.groundBelow(p.x, p.y + 0.5);
        if (p.y <= gy + 0.35 && p.vy < 0) { p.y = gy + 0.35; p.grounded = true; }
        if (p.y < -8) p.taken = true;
      }
      if (!P.alive || p.taken) continue;
      if (Math.abs(P.cx - p.x) < 0.7 && Math.abs(P.cy - p.y) < 1.2) {
        p.taken = true;
        if (p.kind === 'health') { P.heal(35); audio.sfx('health', { vol: 0.8 }); this.hud.announce('+35 HP', 'small'); }
        else if (p.kind === 'G') { P.grenades = Math.min(15, P.grenades + 5); audio.sfx('pickup', { vol: 0.8 }); this.announce('GRENADES', 'grenade', 'weapon'); }
        else { P.setWeapon(PICKUP_WEAPON[p.kind]); audio.sfx('pickup', { vol: 0.8 }); }
        this.fx.ring(p.x, p.y, 1.5, [3, 2.5, 1.5], 0.3);
      }
      if (!p.fixed && p.t > 18) p.taken = true;
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  updateProps(dt) {
    for (const pr of this.props) {
      if (pr.shake > 0) { pr.shake -= dt; pr.mesh.position.x = pr.x + Math.sin(this.time * 80) * 0.03 * (pr.shake / 0.15); }
      if (pr.leak > 0) {
        const v = Math.min(pr.leak, dt * 1.6);
        pr.leak -= v;
        this.blood.livingBonus = false;
        const hx = pr.x + rand(-pr.w * 0.2, pr.w * 0.2), hy = pr.y + pr.h * rand(0.25, 0.55);
        this.blood.spurt(hx, hy, rand(-0.4, 0.4) + (Math.random() < 0.5 ? Math.PI : 0), rand(2, 6), 6, 0.6, v, 1.4);
      }
    }
  }

  updateAmbient(dt) {
    const th = this.theme.fx, c = this.cam, fx = this.fx;
    const hw = c.viewW / 2, hh = c.viewH / 2;
    if (th.embers && Math.random() < dt * 14 * th.embers) fx.ember(c.x + rand(-hw, hw), c.cy - hh - 0.2);
    if (th.ash && Math.random() < dt * 10 * th.ash) fx.alpha.add({ x: c.x + rand(-hw, hw + 3), y: c.cy + hh + 0.3, vx: rand(-0.8, -0.2), vy: rand(-0.6, -0.3), life: 12, s0: rand(0.02, 0.04), s1: 0.02, shape: 5, c: [0.55, 0.5, 0.5], rot: rand(0, 6), vr: rand(-2, 2), a0: 0.6, hold: 0.9 });
    if (th.dust && Math.random() < dt * 6 * th.dust) fx.add.add({ x: c.x + rand(-hw, hw), y: c.cy + rand(-hh, hh), vx: rand(-0.1, 0.1), vy: rand(0.02, 0.15), life: rand(4, 8), s0: rand(0.03, 0.07), s1: 0.02, shape: 0, c: [1.2, 0.5, 0.35], a0: 0.35, fadeIn: 0.3, hold: 0.6 });
    // level fires
    for (const f of this.level.fires) if (Math.abs(f.x - c.x) < hw + 3 && Math.random() < dt * 30) fx.fire(f.x, f.y, f.s);
    this.fog.update(dt, c.x, c.cy, c.viewW, c.viewH);
  }

  // ------------------------------------------------------------------ render
  render(dt) {
    if (this.state === 'loading') return;
    const c = this.cam;
    c.apply();
    // static lights with flicker
    for (const l of this.level.lights) {
      if (Math.abs(l.x - c.x) > c.viewW) continue;
      const fl = l.flicker ? 1 - l.flicker * (0.5 + 0.5 * Math.sin(this.time * 17 + l.x) * Math.sin(this.time * 7.3 + l.y)) : 1;
      this.lights.add(l.x, l.y, l.color, l.intensity * fl, l.radius, 1.5);
    }
    for (const l of this.lights.persistent) this.lights.add(l.x, l.y, l.color, l.intensity, l.radius, 1.5);
    this.flashLights = (this.flashLights || []).filter((f) => (f.t -= dt) > 0);
    for (const f of this.flashLights) this.lights.add(f.x, f.y, [1, 0.55, 0.25], 10 * f.t, f.r);
    if (this.player.frenzyActive) this.lights.add(this.player.cx, this.player.cy, [1, 0.1, 0.1], 1.2, 4);
    // a soft fill light keeps the hero readable in the chaos
    if (this.player.alive) this.lights.add(this.player.cx + this.player.f * 0.4, this.player.cy + 0.6, [1, 0.85, 0.7], 0.55, 3.2, 1.6);
    this.backdrop.update(c.cx, c.cy, c.viewW, c.viewH);
    for (const d of Object.values(this.defs)) d.batch.begin();
    this.droneAssets.batch.begin();
    const x0 = c.cx - c.viewW / 2 - 3, x1 = c.cx + c.viewW / 2 + 3;
    this.shadows.begin();
    for (const e of this.enemies) this.shadows.add(e, this.world, x0, x1);
    this.shadows.add(this.boss, this.world, x0, x1);
    this.shadows.add(this.player, this.world, x0, x1, true);
    this.shadows.end();
    // corpses first, then living
    for (const e of this.enemies) if (!e.alive && e.rig && e.x > x0 - 5 && e.x < x1 + 5) e.draw();
    for (const g of this.gibs) if (g.x > x0 && g.x < x1) g.draw(g.def.batch);
    if (this.boss) this.boss.draw();
    for (const e of this.enemies) if (e.alive) e.draw();
    this.player.draw(this.defs.hero.batch);
    this.projectiles.render(this.fx, this.lights, this.defs.hero.batch, this.defs.hero);
    this.renderPickups();
    for (const w of this.shockwaves) {
      const k = 1 - w.t / w.life;
      this.fx.once({ x: w.x, y: w.y + 0.25, vx: 0, vy: 0, s0: 0.9, s1: 0, shape: 1, rot: Math.PI / 2, stretch: 0.9, c: [3 * k, 1.2 * k, 0.5 * k] });
      this.lights.add(w.x, w.y + 0.3, [1, 0.5, 0.2], 1.5 * k, 2.5);
    }
    for (const d of Object.values(this.defs)) d.batch.end();
    this.droneAssets.batch.end();
    this.fx.render();
    this.blood.render(c.cx, c.viewW);
    this.lights.flush(c.cx, c.cy, c.viewW);
    this.app.pipeline.render(this.scene, c.cam, this.bloodScene, this.time);
    // HUD DOM work happens once per displayed frame, not per 120 Hz simulation step
    this.hud.update(this.hudDt || 0);
    this.hudDt = 0;
    this.hud.render();
  }

  renderPickups() {
    if (!this.pickupMeshes) this.pickupMeshes = new Map();
    const seen = new Set();
    for (const p of this.pickups) {
      let m = this.pickupMeshes.get(p);
      if (!m) {
        const key = { H: 'h', S: 's', R: 'r', G: 'grenade', health: 'health' }[p.kind];
        m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), makeEnvMaterial(this.pickupTex[key], { tint: [1.1, 1.05, 1.05], emissiveBoost: 0.6, lightInfluence: 0.5 }));
        m.renderOrder = 65;
        m.frustumCulled = false;
        this.scene.add(m);
        this.pickupMeshes.set(p, m);
      }
      seen.add(p);
      m.position.set(p.x, p.y + Math.sin(p.t * 3) * 0.08, 0);
      m.rotation.z = Math.sin(p.t * 2) * 0.08;
      const blink = !p.fixed && p.t > 14 && Math.floor(p.t * 8) % 2 === 0;
      m.visible = !blink;
      this.lights.add(p.x, p.y, p.kind === 'health' ? [1, 0.15, 0.15] : [1, 0.8, 0.4], 1.2, 2.5);
      if (Math.random() < 0.08) this.fx.glow(p.x + rand(-0.3, 0.3), p.y + rand(-0.3, 0.3), 0.1, [2, 1.6, 1], 0.6, 0, 0.5);
    }
    for (const [p, m] of this.pickupMeshes) if (!seen.has(p)) { this.scene.remove(m); m.geometry.dispose(); this.pickupMeshes.delete(p); }
  }

  destroy() {
    this.hud.destroy();
    this.shadows.mesh.material.dispose();
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.bloodScene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

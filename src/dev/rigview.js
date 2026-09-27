// Dev page: /?rigview=1  — shows every character in several procedural poses.
import * as THREE from 'three';
import { Pipeline } from '../render/pipeline.js';
import { CharacterDef, Rig } from '../game/rig.js';
import { lightUniforms } from '../render/sprites.js';

const pipe = new Pipeline(document.getElementById('game'));
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, -10, 10);
cam.position.z = 5;
const bg = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ color: 0x2a2226 }));
bg.renderOrder = -1;
scene.add(bg);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 0.04), new THREE.MeshBasicMaterial({ color: 0x777777 }));
scene.add(floor);
lightUniforms.ambient.value.set(0.9, 0.85, 0.85);
const params = new URLSearchParams(location.search);
const names = (params.get('chars') || 'hero,grunt,leaper,butcher').split(',');
const poses = (params.get('poses') || 'idle,run,aimUp,aimDown,jump,melee,slide').split(',');
const t0 = Number(params.get('t') || 0.35);
const slow = Number(params.get('slow') || 1);
const defs = await Promise.all(names.map((n) => CharacterDef.load(n, 400)));
defs.forEach((d, i) => { d.batch.mesh.renderOrder = 10 + i; scene.add(d.batch.mesh); });
const rows = defs.map((d) => poses.map(() => new Rig(d)));
const SC = Number(params.get('scale') || 1);
const W = poses.length * 2.4 * SC, H = defs.length * 2.9 * SC;
cam.left = -0.8; cam.right = W; cam.top = H; cam.bottom = -0.5;
if (params.get('focus')) {
  // frame one pose cell at the true aspect ratio: focus=row,col
  const [r, c] = params.get('focus').split(',').map(Number);
  const h = 2.6 * SC * (defs[r].height > 3 ? defs[r].height / 1.9 : 1), w = h * innerWidth / innerHeight;
  const cx = (c * 2.4 + 0.9) * SC + 0.25, y0 = (defs.length - 1 - r) * 2.9 * SC - 0.2;
  cam.left = cx - w / 2; cam.right = cx + w / 2; cam.bottom = y0; cam.top = y0 + h;
}
if (params.get('crop')) { const [x0, y0, x1, y1] = params.get('crop').split(',').map(Number); cam.left = x0; cam.bottom = y0; cam.right = x1; cam.top = y1; }
cam.updateProjectionMatrix();
let t = 0;
const ov = document.createElement('canvas');
ov.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
document.body.appendChild(ov);
function drawJoints() {
  if (!params.get('joints')) return;
  ov.width = innerWidth; ov.height = innerHeight;
  const c = ov.getContext('2d');
  const tx = (x, y) => [(x - cam.left) / (cam.right - cam.left) * ov.width, (cam.top - y) / (cam.top - cam.bottom) * ov.height];
  const cols = ['#0f0', '#ff0', '#f0f', '#0ff', '#f80', '#f00', '#fff', '#f80', '#f00', '#fff', '#08f', '#00f', '#88f', '#08f', '#00f', '#88f'];
  for (const row of rows) for (const rig of row) {
    for (let i = 0; i < 16; i++) { const [x, y] = tx(rig.jx(i), rig.jy(i)); c.fillStyle = cols[i]; c.fillRect(x - 3, y - 3, 6, 6); }
    const W = rig.def.parts[rig.weaponPart];
    if (W && W.fore) { const [x, y] = tx(...rig.muzzle()); c.strokeStyle = '#f0f'; c.strokeRect(x - 5, y - 5, 10, 10); }
  }
}
function frame() {
  const dt = 1 / 60 / slow;
  t += dt;
  defs.forEach((d, r) => {
    d.batch.begin();
    const y = (defs.length - 1 - r) * 2.9 * SC;
    poses.forEach((p, c) => {
      const rig = rows[r][c];
      const x = (c * 2.4 + 0.9) * SC;
      const s = { x, y, f: params.get('left') ? -1 : 1, speed: 0, grounded: true, vy: 0, crouch: 0, aim: 0, hold: d.name === 'leaper' ? 'blade' : d.name === 'butcher' ? 'cleaver' : d.name === 'boss' ? 'cannon' : 'rifle', melee: -1, t, dt, shield: d.name === 'butcher' };
      if (p === 'run') s.speed = 6.5;
      if (p === 'walk') s.speed = 2;
      if (p === 'aimUp') s.aim = 1.1;
      if (p === 'aimDown') s.aim = -0.9;
      if (p === 'jump') { s.grounded = false; s.vy = 3; }
      if (p === 'melee') { s.melee = (t * 1.5) % 1; s.meleeKind = Math.floor(t * 1.5) % 3; }
      if (p === 'aimSweep') s.aim = Math.sin(t * 1.2) * 1.3;
      if (p === 'runShoot') { s.speed = 6.5; s.recoil = (t * 9) % 1 < 0.3 ? 1 : 0; }
      if (p === 'slide') s.slide = true;
      if (p === 'crouch') s.crouch = 1;
      if (s.f < 0) s.aim = Math.PI - s.aim;
      if (params.get('freeze')) s.t = t0;
      if (params.get('weapon') && d.name === 'hero') rig.weaponPart = params.get('weapon');
      if (p === 'melee' && d.name === 'hero') { rig.weaponPart = 'machete'; rig.backItem = { part: 'weapon', ang: -1.25 }; }
      rig.pose(s);
      rig.draw(d.batch);
    });
    d.batch.end();
  });
  pipe.render(scene, cam, null, t);
  drawJoints();
  requestAnimationFrame(frame);
}
frame();

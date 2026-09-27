import { generateStage } from './levelgen.js';
// Level layouts. Units are metres; y = 0 is the main ground surface.
// solids: {x, y, w, h}; platforms: {x, y, w}; props: {type, x, y, h, layer, flip, blood}; events along x.

const GROUND_BOTTOM = -8;

function builder() {
  const L = { solids: [], platforms: [], props: [], events: [], lights: [], fires: [], hints: [] };
  L.ground = (x0, x1, top = 0) => { L.solids.push({ x: x0, y: GROUND_BOTTOM, w: x1 - x0, h: top - GROUND_BOTTOM }); };
  L.block = (x, y, w, h, opts = {}) => { L.solids.push({ x, y, w, h, ...opts }); };
  L.plat = (x, y, w) => { L.platforms.push({ x, y, w }); };
  L.prop = (type, x, y, h, layer = 'back', opts = {}) => { L.props.push({ type, x, y, h, layer, ...opts }); };
  L.ev = (type, x, opts = {}) => { L.events.push({ type, x, ...opts }); };
  L.light = (x, y, color, intensity, radius, flicker = 0) => { L.lights.push({ x, y, color, intensity, radius, flicker }); };
  L.fire = (x, y, s = 0.3) => { L.fires.push({ x, y, s }); };
  L.hint = (x, text) => { L.hints.push({ x, text }); };
  return L;
}

export function buildStage1() {
  const L = builder();
  L.theme = 'stage1';
  L.name = 'MISSION 1';
  L.subtitle = 'ASHEN OUTSKIRTS';
  L.spawn = { x: 3, y: 0 };
  // --- opening street
  L.ground(-10, 44);
  L.prop('lamp_post', 6, 0, 4.6, 'back');
  L.light(6.6, 4.1, [1.0, 0.65, 0.3], 2.2, 7, 0.15);
  L.prop('crate', 10, 0, 1.1, 'back');
  L.prop('legion_banner', 14, 0, 5.0, 'back');
  L.prop('car_wreck', 20, 0, 1.8, 'back', { fire: true });
  L.fire(19.4, 1.1, 0.35); L.fire(20.6, 1.0, 0.3);
  L.light(20, 1.6, [1.0, 0.45, 0.15], 3.0, 8, 0.35);
  L.hint(2, 'A / D  MOVE     SPACE  JUMP (x2)     MOUSE  AIM     LMB  SHOOT');
  L.hint(13, 'SHIFT  DASH (invulnerable)     RMB  MACHETE (deflects bolts)');
  L.hint(24, 'Q  GRENADE     S + SPACE  DROP     E  EXECUTE bleeding enemies');
  L.block(26, 0, 3, 1.2);
  L.prop('sandbags', 27.5, 1.2, 0.9, 'front');
  L.plat(31, 2.6, 5);
  L.prop('crate', 33, 2.6, 1.0, 'back');
  L.ev('ambush', 30, { spawns: [{ type: 'grunt', dx: 10 }, { type: 'grunt', dx: 12, delay: 0.6 }, { type: 'grunt', dx: 14, delay: 1.4 }] });
  L.prop('dead_tree', 38, 0, 5.5, 'back');
  L.prop('harvester', 42, 0, 3.4, 'back', { blood: 4, hp: 80 });
  L.light(42, 2, [1.0, 0.1, 0.1], 1.6, 5, 0.1);
  // --- arena 1: village square
  L.ground(44, 80);
  L.plat(50, 2.8, 4.5);
  L.plat(62, 2.8, 4.5);
  L.prop('ruined_wall', 56.5, 0, 4.2, 'back');
  L.prop('legion_banner', 48, 0, 5.2, 'back');
  L.prop('legion_banner', 70, 0, 5.2, 'back', { flip: true });
  L.prop('barrel_red', 58, 0, 1.2, 'back', { explosive: true, hp: 20 });
  L.prop('crate', 66.5, 0, 1.1, 'back');
  L.prop('lamp_post', 74, 0, 4.6, 'back');
  L.light(74.6, 4.1, [1.0, 0.65, 0.3], 2.2, 7, 0.15);
  L.fire(53, 0, 0.25);
  L.light(53, 0.8, [1.0, 0.45, 0.15], 2.2, 6, 0.35);
  L.ev('checkpoint', 46);
  L.ev('arena', 57, { x0: 46, x1: 78, kills: 8, label: 'SQUARE' });
  L.ev('pickup', 79, { kind: 'H', y: 0.5 });
  // --- climb: stairs of rubble, a pit, platforms
  L.block(80, 0, 4, 1.0);
  L.block(84, 0, 4, 2.0);
  L.ground(80, 96, 0);
  L.block(88, 0, 8, 2.8);
  L.prop('sandbags', 90, 2.8, 0.9, 'front');
  L.prop('crate', 94, 2.8, 1.1, 'back');
  // pit 96 -> 101 (fall = damage)
  L.plat(97, 2.4, 3);
  L.ground(101, 150);
  L.block(101, 0, 5, 2.0);
  L.prop('car_wreck', 110, 0, 1.8, 'back', { fire: true });
  L.fire(109.6, 1.1, 0.35);
  L.light(110, 1.6, [1.0, 0.45, 0.15], 3.0, 8, 0.35);
  L.ev('checkpoint', 106);
  L.ev('ambush', 108, { spawns: [{ type: 'leaper', dx: 11 }, { type: 'grunt', dx: 13, delay: 0.5 }, { type: 'leaper', dx: -9, delay: 1.2 }] });
  L.prop('legion_banner', 118, 0, 5.2, 'back');
  L.plat(122, 3, 5);
  L.plat(136, 3, 5);
  L.plat(129, 5.2, 4);
  L.prop('harvester', 131, 0, 3.4, 'back', { blood: 4, hp: 80 });
  L.light(131, 2, [1.0, 0.1, 0.1], 1.6, 5, 0.1);
  L.prop('lamp_post', 144, 0, 4.6, 'back');
  L.light(144.6, 4.1, [1.0, 0.65, 0.3], 2.2, 7, 0.15);
  L.prop('barrel_red', 125, 0, 1.2, 'back', { explosive: true, hp: 20 });
  L.prop('barrel_red', 140, 0, 1.2, 'back', { explosive: true, hp: 20 });
  L.ev('arena', 130, { x0: 116, x1: 148, kills: 12, label: 'HARVEST YARD' });
  L.ev('pickup', 149, { kind: 'S', y: 0.5 });
  // --- wall-jump gate
  L.ground(150, 240);
  L.block(156, 0, 1.2, 4.5);
  L.block(161, 0, 1.2, 6.5);
  L.block(157.2, 0, 3.8, 1.0);
  L.plat(162.2, 6.5, 3);
  L.hint(152, 'JUMP INTO A WALL TO WALL-SLIDE, JUMP AGAIN TO WALL-JUMP');
  L.block(165, 0, 3, 3.5);
  L.ev('checkpoint', 170);
  L.prop('dead_tree', 172, 0, 5.5, 'back', { flip: true });
  L.prop('crate', 176, 0, 1.1, 'back');
  L.prop('crate', 177.1, 0, 1.1, 'back');
  L.prop('crate', 176.5, 1.05, 1.0, 'back');
  L.ev('pickup', 178, { kind: 'G', y: 0.5 });
  // --- arena 3: the harvest gate
  L.plat(188, 2.8, 5);
  L.plat(204, 2.8, 5);
  L.plat(196, 5, 4);
  L.prop('harvester', 184, 0, 3.4, 'back', { blood: 4, hp: 80 });
  L.prop('harvester', 212, 0, 3.4, 'back', { blood: 4, hp: 80, flip: true });
  L.light(184, 2, [1.0, 0.1, 0.1], 1.6, 5, 0.1);
  L.light(212, 2, [1.0, 0.1, 0.1], 1.6, 5, 0.1);
  L.prop('legion_banner', 198, 5, 4.4, 'back');
  L.prop('barrel_red', 194, 0, 1.2, 'back', { explosive: true, hp: 20 });
  L.prop('barrel_red', 206, 0, 1.2, 'back', { explosive: true, hp: 20 });
  L.fire(200, 0, 0.3);
  L.light(200, 0.8, [1.0, 0.45, 0.15], 2.5, 6, 0.35);
  L.ev('arena', 198, { x0: 181, x1: 216, kills: 16, label: 'THE GATE', butcher: true });
  L.ev('end', 226);
  L.prop('ruined_wall', 230, 0, 4.2, 'back');
  L.length = 236;
  L.bounds = { x0: -2, x1: 236, y0: -8, y1: 14 };
  return L;
}

export function buildStage2() {
  const L = builder();
  L.theme = 'stage2';
  L.name = 'MISSION 2';
  L.subtitle = 'RUST CATHEDRAL';
  L.spawn = { x: 3, y: 0 };
  L.ground(-10, 60);
  L.prop('candelabra', 5, 0, 2.2, 'back');
  L.light(5, 2.1, [1.0, 0.6, 0.3], 1.8, 5, 0.2);
  L.prop('pillar', 10, 0, 9, 'back');
  L.prop('chain_hook', 15, 3.5, 5.5, 'back', { hang: true });
  L.prop('blood_vat', 20, 0, 4.5, 'back', { blood: 8, hp: 60, glass: true });
  L.light(20, 2.2, [1.0, 0.1, 0.12], 2.2, 6, 0.1);
  L.prop('pillar', 26, 0, 9, 'back');
  L.plat(28, 2.6, 6);
  L.prop('candelabra', 31, 2.6, 2.0, 'back');
  L.light(31, 4.5, [1.0, 0.6, 0.3], 1.8, 5, 0.2);
  L.ev('ambush', 25, { spawns: [{ type: 'grunt', dx: 10 }, { type: 'leaper', dx: 12, delay: 0.5 }, { type: 'grunt', dx: -8, delay: 1.0 }, { type: 'grunt', dx: 14, delay: 1.6 }] });
  L.prop('organ_pipes', 40, 0, 7, 'back');
  L.block(44, 0, 4, 1.4);
  L.plat(49, 3.2, 5);
  L.prop('blood_vat', 52, 0, 4.5, 'back', { blood: 8, hp: 60, glass: true });
  L.light(52, 2.2, [1.0, 0.1, 0.12], 2.2, 6, 0.1);
  L.ev('checkpoint', 42);
  // nave arena
  L.ground(60, 110);
  L.plat(66, 2.8, 5);
  L.plat(84, 2.8, 5);
  L.plat(75, 5.2, 5);
  L.prop('pillar', 63, 0, 9, 'back');
  L.prop('pillar', 93, 0, 9, 'back');
  L.prop('altar', 78, 0, 1.6, 'back');
  L.prop('candelabra', 74, 0, 2.2, 'back');
  L.prop('candelabra', 83, 0, 2.2, 'back');
  L.light(74, 2.1, [1.0, 0.6, 0.3], 1.8, 5, 0.2);
  L.light(83, 2.1, [1.0, 0.6, 0.3], 1.8, 5, 0.2);
  L.prop('chain_hook', 70, 4, 5.5, 'back', { hang: true });
  L.prop('chain_hook', 88, 4, 5.5, 'back', { hang: true });
  L.prop('blood_vat', 97, 0, 4.5, 'back', { blood: 8, hp: 60, glass: true });
  L.light(97, 2.2, [1.0, 0.1, 0.12], 2.2, 6, 0.1);
  L.ev('arena', 78, { x0: 61, x1: 98, kills: 14, label: 'THE NAVE', butcher: true });
  L.ev('pickup', 100, { kind: 'R', y: 0.5 });
  // catwalk section over a blood pit
  L.block(110, 0, 3, 2.5);
  L.plat(114, 3.2, 4);
  L.plat(120, 4.0, 4);
  L.plat(126, 3.2, 4);
  L.ground(131, 200);
  L.block(131, 0, 3, 2.5);
  L.hint(112, 'THE PIT IS FULL OF BLOOD. DO NOT FALL IN.');
  L.ev('checkpoint', 136);
  L.prop('organ_pipes', 142, 0, 7, 'back', { flip: true });
  L.block(148, 0, 1.2, 5);
  L.block(153, 0, 1.2, 7);
  L.plat(154.2, 7, 3);
  L.block(157.5, 0, 4, 3);
  L.ev('pickup', 146, { kind: 'G', y: 0.5 });
  // choir arena
  L.plat(168, 2.8, 5);
  L.plat(184, 2.8, 5);
  L.plat(176, 5.2, 4);
  L.prop('blood_vat', 165, 0, 4.5, 'back', { blood: 8, hp: 60, glass: true });
  L.prop('blood_vat', 192, 0, 4.5, 'back', { blood: 8, hp: 60, glass: true });
  L.light(165, 2.2, [1.0, 0.1, 0.12], 2.2, 6, 0.1);
  L.light(192, 2.2, [1.0, 0.1, 0.12], 2.2, 6, 0.1);
  L.prop('pillar', 172, 0, 9, 'back');
  L.prop('pillar', 190, 0, 9, 'back');
  L.ev('arena', 178, { x0: 162, x1: 197, kills: 18, label: 'THE CHOIR', butcher: true });
  L.ev('end', 204);
  L.ground(200, 214);
  L.length = 214;
  L.bounds = { x0: -2, x1: 214, y0: -8, y1: 14 };
  // blood pit: a kill zone
  L.pits = [{ x0: 113, x1: 131, y: -1.5, blood: true }];
  return L;
}

export function buildBoss() {
  const L = builder();
  L.theme = 'boss';
  L.name = 'FINAL MISSION';
  L.subtitle = 'THE RESERVOIR';
  L.spawn = { x: 3, y: 0 };
  L.ground(-10, 44);
  L.block(-10, 0, 10, 14, { noTop: true });
  L.block(34, 0, 10, 14, { noTop: true });
  L.plat(4, 2.8, 5);
  L.plat(25, 2.8, 5);
  L.prop('pillar', 1.2, 0, 9, 'back');
  L.prop('pillar', 32.8, 0, 9, 'back', { flip: true });
  L.prop('boss_pylon', 6.5, 0, 9, 'back');
  L.prop('boss_pylon', 28, 0, 9, 'back', { flip: true });
  L.light(6.5, 5, [1, 0.1, 0.1], 1.6, 6, 0.1);
  L.light(28, 5, [1, 0.1, 0.1], 1.6, 6, 0.1);
  L.prop('boss_idol', 17, 0, 8, 'back');
  L.prop('boss_cauldron', 12, 0, 2.6, 'back', { blood: 6, hp: 80 });
  L.prop('boss_cauldron', 22.5, 0, 2.6, 'back', { blood: 6, hp: 80, flip: true });
  L.prop('boss_bones', 3.5, 0, 1.4, 'back');
  L.prop('boss_bones', 30.5, 0, 1.4, 'back', { flip: true });
  L.prop('candelabra', 8, 0, 2.2, 'back');
  L.prop('candelabra', 26, 0, 2.2, 'back');
  L.light(8, 2.1, [1.0, 0.6, 0.3], 1.8, 5, 0.2);
  L.light(26, 2.1, [1.0, 0.6, 0.3], 1.8, 5, 0.2);
  L.light(17, 7, [1.0, 0.12, 0.12], 2.5, 14, 0.05);
  L.ev('boss', 10);
  L.length = 34;
  L.bounds = { x0: 0, x1: 34, y0: -8, y1: 14 };
  return L;
}

export function buildArena() {
  const L = buildBoss();
  L.events = [];
  L.name = 'BLOOD TIDE';
  L.subtitle = 'ENDLESS';
  L.theme = 'boss';
  L.endless = true;
  L.ev('pickup', 17, { kind: 'H', y: 0.5 });
  return L;
}

export const STAGES = { stage1: (seed) => generateStage('stage1', seed), stage2: (seed) => generateStage('stage2', seed), boss: buildBoss, arena: buildArena };
export const HANDMADE = { stage1: buildStage1, stage2: buildStage2 };
export const STAGE_ORDER = ['stage1', 'stage2', 'boss'];

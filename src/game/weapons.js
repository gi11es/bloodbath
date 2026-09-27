// Player weapon table. rate = shots/s, dmg per projectile, spread (rad), speed (m/s).
export const WEAPONS = {
  rifle: { id: 'rifle', name: 'ASSAULT RIFLE', part: 'weapon', rate: 9, dmg: 11, spread: 0.035, speed: 55, pellets: 1, ammo: Infinity,
    recoil: 0.5, shake: 0.05, sfx: 'rifle', dismember: 0.15, bleed: 0.045, knock: 1.2, shell: true, tracer: [4, 2.6, 1.2], life: 0.6 },
  hmg: { id: 'hmg', name: 'HEAVY MACHINE GUN', part: 'hmg', rate: 16, dmg: 12, spread: 0.075, speed: 60, pellets: 1, ammo: 220,
    recoil: 0.75, shake: 0.08, sfx: 'hmg', dismember: 0.35, bleed: 0.06, knock: 2.2, shell: true, tracer: [5, 3, 1.2], life: 0.6, voice: 'heavy_machine_gun' },
  shotgun: { id: 'shotgun', name: 'SHOTGUN', part: 'shotgun', rate: 1.7, dmg: 11, spread: 0.2, speed: 42, pellets: 9, ammo: 32,
    recoil: 1.7, shake: 0.32, sfx: 'shotgun', dismember: 1.2, bleed: 0.09, knock: 8, shell: true, tracer: [5, 2.2, 0.8], life: 0.22, voice: 'shotgun' },
  ripper: { id: 'ripper', name: 'RIPPER', part: 'ripper', rate: 3.2, dmg: 26, spread: 0.02, speed: 21, pellets: 1, ammo: 45,
    recoil: 0.9, shake: 0.12, sfx: 'ripper_fire', dismember: 1.5, bleed: 0.22, knock: 3, disc: true, bounces: 5, pierce: true, life: 3, voice: 'ripper' },
};

export const PICKUP_WEAPON = { H: 'hmg', S: 'shotgun', R: 'ripper' };

export const MELEE = [
  { dmg: 34, reach: 1.55, arc: 2.6, dur: 0.26, bleed: 0.3, dismember: 1.0, kind: 0 },
  { dmg: 34, reach: 1.55, arc: 2.6, dur: 0.26, bleed: 0.3, dismember: 1.0, kind: 1 },
  { dmg: 60, reach: 1.8, arc: 5.5, dur: 0.38, bleed: 0.45, dismember: 1.6, kind: 2 },
];

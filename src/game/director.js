// AI Director: estimates player skill and stress, then shapes pacing and enemy behaviour.
// Pure logic (no rendering), so it is unit-tested in tests/director.test.js.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

export const FIXED_SKILL = { easy: 0.2, normal: 0.55, hard: 0.85 };

export class Director {
  constructor({ mode = 'adaptive', skill = 0.55 } = {}) {
    this.mode = mode;
    this.skill = mode in FIXED_SKILL ? FIXED_SKILL[mode] : skill;
    this.intensity = 0;
    this.state = 'BUILD_UP';
    this.stateTime = 0;
    this.spawnTimer = 1.5;
    this.hpFrac = 1;
    this.time = 0;
    this.lastDamageTime = -99;
    // rolling performance window (exponentially decayed counters)
    this.win = { dmg: 0, kills: 0, shots: 0, hits: 0, dodges: 0, ttk: 0, ttkN: 0 };
    this.history = []; // sampled skill for the debug graph
    this.sampleTimer = 0;
    this.lastPerf = 0.5;
  }

  get adaptive() { return !(this.mode in FIXED_SKILL); }

  // ---- events ---------------------------------------------------------------
  onPlayerDamaged(amount, hpFrac) {
    this.win.dmg += amount;
    this.hpFrac = hpFrac;
    this.intensity = clamp(this.intensity + amount * 0.014, 0, 1);
    this.lastDamageTime = this.time;
  }
  onPlayerDeath() {
    if (this.adaptive) this.skill = clamp(this.skill - 0.12, 0.05, 1.25);
    this.intensity = 0;
    this.setState('RELAX');
  }
  onEnemyKilled(timeAlive = 4) {
    this.win.kills += 1;
    this.win.ttk += timeAlive;
    this.win.ttkN += 1;
    this.intensity = clamp(this.intensity + 0.03, 0, 1);
  }
  onShot(hit) {
    this.win.shots += 1;
    if (hit) this.win.hits += 1;
  }
  onDodge() {
    this.win.dodges += 1;
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  // Performance in [0,1] over the recent window: 0.5 = on par.
  performance() {
    const w = this.win;
    const dmgScore = 1 - clamp(w.dmg / 70, 0, 1); // ~70 damage in the window = struggling
    const killScore = clamp(w.kills / 6, 0, 1);
    const acc = w.shots > 4 ? w.hits / w.shots : 0.5;
    const ttk = w.ttkN > 0 ? w.ttk / w.ttkN : 4;
    const ttkScore = 1 - clamp((ttk - 1.5) / 8, 0, 1);
    const dodgeScore = clamp(w.dodges / 4, 0, 1);
    return clamp(dmgScore * 0.4 + killScore * 0.2 + acc * 0.15 + ttkScore * 0.15 + dodgeScore * 0.1, 0, 1);
  }

  update(dt, { threatsNear = 0, playerHpFrac = 1 } = {}) {
    this.time += dt;
    this.stateTime += dt;
    this.hpFrac = playerHpFrac;

    // decay the rolling window (half-life ~ 20 s)
    const k = Math.exp(-dt / 29);
    for (const key in this.win) this.win[key] *= k;

    if (this.adaptive) {
      const perf = this.performance();
      this.lastPerf = perf;
      // move skill toward a target implied by performance; slow so that it is not jittery
      // the adaptive ceiling goes past 'hard' (1.0) so strong players keep being pushed
      const target = clamp(this.skill + (perf - 0.42) * 0.9, 0.05, 1.25);
      this.skill += (target - this.skill) * (1 - Math.exp(-dt / 9));
    }

    // intensity: threats nearby raise it, calm time lowers it
    this.intensity = clamp(this.intensity + threatsNear * 0.012 * dt, 0, 1);
    if (this.time - this.lastDamageTime > 2.5) this.intensity = clamp(this.intensity - 0.07 * dt, 0, 1);

    const s = this.skill;
    if (this.state === 'BUILD_UP') {
      if (this.intensity > lerp(0.6, 0.85, s)) this.setState('PEAK');
    } else if (this.state === 'PEAK') {
      if (this.stateTime > lerp(3, 7, s)) this.setState('RELAX');
    } else if (this.state === 'RELAX') {
      if (this.stateTime > lerp(9, 4, s) && this.intensity < 0.3) this.setState('BUILD_UP');
      else this.intensity = clamp(this.intensity - 0.05 * dt, 0, 1);
    }

    this.spawnTimer -= dt;
    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = 0.5;
      this.history.push({ skill: this.skill, intensity: this.intensity, state: this.state });
      if (this.history.length > 240) this.history.shift();
    }
  }

  get knobs() {
    const s = this.skill;
    const mercy = this.hpFrac < 0.3 ? 1 - (0.3 - this.hpFrac) * 1.5 : 1;
    const relax = this.state === 'RELAX';
    const peak = this.state === 'PEAK';
    return {
      maxAlive: relax ? Math.max(2, Math.round(lerp(1, 4, s))) : Math.round(lerp(3, 11, s)) + (peak ? 2 : 0),
      spawnInterval: relax ? 4 : Math.max(0.35, lerp(3.0, 0.6, s)) * (peak ? 0.75 : 1),
      accuracy: Math.min(0.97, lerp(0.35, 0.93, s)) * mercy,
      reactionTime: Math.max(0.2, lerp(1.1, 0.28, s)) / mercy,
      telegraph: Math.max(0.3, lerp(0.95, 0.38, s)),
      projectileSpeed: lerp(8, 17, s),
      aggression: lerp(0.3, 1, s) * (relax ? 0.6 : 1),
      fireRate: lerp(0.6, 1.6, s) * mercy,
      healthDropChance: clamp(lerp(0.3, 0.02, s) + (this.hpFrac < 0.3 ? 0.25 : 0), 0, 1),
      eliteChance: clamp((s - 0.45) * 0.9, 0, 0.45),
      damageMul: lerp(0.75, 1.7, s),
      hpMul: lerp(0.85, 1.6, s),
      mix: {
        grunt: 1,
        leaper: s < 0.2 ? 0.15 : lerp(0.2, 0.7, s),
        butcher: s < 0.35 ? 0 : lerp(0.05, 0.45, (s - 0.35) / 0.65),
        shotgunner: s < 0.22 ? 0.1 : lerp(0.2, 0.55, s),
        grenadier: s < 0.32 ? 0 : lerp(0.15, 0.45, s),
        sniper: s < 0.42 ? 0 : lerp(0.1, 0.35, s),
        flamer: s < 0.48 ? 0 : lerp(0.1, 0.4, s),
        drone: s < 0.3 ? 0 : lerp(0.1, 0.45, s),
      },
    };
  }

  // Returns true when the director wants one more enemy now.
  wantSpawn(activeEnemies) {
    const kn = this.knobs;
    if (this.state === 'RELAX') return false;
    if (activeEnemies >= kn.maxAlive) return false;
    if (this.spawnTimer > 0) return false;
    this.spawnTimer = kn.spawnInterval * (activeEnemies === 0 ? 0.35 : 1);
    return true;
  }

  pickType(rng = Math.random) {
    const m = this.knobs.mix;
    let total = 0;
    for (const k in m) total += m[k];
    let r = rng() * total;
    for (const k in m) if ((r -= m[k]) < 0) return k;
    return 'grunt';
  }
}

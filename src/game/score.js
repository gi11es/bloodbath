// Blood score: litres spilled, a "bloodlust" multiplier driven by the recent spill rate, event tallies.
export class Score {
  constructor(carry = null) {
    this.points = 0; this.litres = 0; this.livingLitres = 0;
    this.kills = 0; this.dismembers = 0; this.executions = 0; this.headshots = 0; this.drained = 0; this.gibs = 0; this.parries = 0;
    this.recent = 0; this.mult = 1; this.maxMult = 1;
    this.time = 0;
    this.deaths = 0;
    if (carry) Object.assign(this, carry, { recent: 0, mult: 1 });
  }
  computeMult() {
    this.mult = Math.min(8, 1 + this.recent / 2.6);
    if (this.mult > this.maxMult) this.maxMult = this.mult;
  }
  addBlood(vol, living) {
    this.litres += vol;
    if (living) this.livingLitres += vol;
    this.recent += vol;
    this.computeMult();
    this.points += vol * 1000 * this.mult * (living ? 1.5 : 1);
  }
  addEvent(kind) {
    const table = { kill: 100, dismember: 150, execution: 600, headshot: 60, drained: 400, gib: 250, parry: 120, prop: 200 };
    const k = { kill: 'kills', dismember: 'dismembers', execution: 'executions', headshot: 'headshots', drained: 'drained', gib: 'gibs', parry: 'parries' }[kind];
    if (k) this[k]++;
    this.points += (table[kind] || 0) * this.mult;
  }
  update(dt) {
    this.time += dt;
    this.recent *= Math.exp(-dt / 2.2);
    this.computeMult();
  }
  snapshot() {
    const { points, litres, livingLitres, kills, dismembers, executions, headshots, drained, gibs, parries, maxMult, time, deaths } = this;
    return { points, litres, livingLitres, kills, dismembers, executions, headshots, drained, gibs, parries, maxMult, time, deaths };
  }
}

// Rank from efficiency (litres per kill) and volume.
export function rankFor(s) {
  const perKill = s.kills ? s.litres / s.kills : 0;
  const score = perKill * 10 + s.litres * 0.4 + (s.points / 10000);
  if (score > 90) return 'S';
  if (score > 55) return 'A';
  if (score > 28) return 'B';
  return 'C';
}

// WebAudio manager: buses, sample playback with variations, music crossfade, voice ducking.
// Missing samples fall back to small procedural sounds so the game never goes silent.
import { settings } from './settings.js';

class AudioManager {
  constructor() {
    this.ctx = null;
    this.manifest = { music: {}, voice: {}, sfx: {} };
    this.buffers = new Map();
    this.loading = new Map();
    this.music = null; // {id, src, gain}
    this.lastPlay = new Map();
    this.duckLevel = 1;
  }

  init() {
    return this.initPromise ||= this.setup();
  }

  async setup() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.knee.value = 8; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.master.connect(this.comp).connect(c.destination);
    this.musicBus = c.createGain();
    this.musicFilter = c.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 22000;
    this.musicDuck = c.createGain();
    this.musicBus.connect(this.musicFilter).connect(this.musicDuck).connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.voiceBus = c.createGain();
    this.voiceBus.connect(this.master);
    this.applyVolumes();
    try {
      const r = await fetch('assets/audio/manifest.json');
      if (r.ok) this.manifest = await r.json();
    } catch { /* no manifest: procedural fallback only */ }
    this.noise = this.makeNoise();
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.masterVolume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(settings.musicVolume * 0.8, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.sfxVolume * 0.75, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(settings.voiceVolume, t, 0.05);
  }

  async load(src) {
    if (this.buffers.has(src)) return this.buffers.get(src);
    if (this.loading.has(src)) return this.loading.get(src);
    const p = fetch(src)
      .then((r) => { if (!r.ok) throw new Error(src); return r.arrayBuffer(); })
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((b) => { this.buffers.set(src, b); return b; })
      .catch(() => { this.buffers.set(src, null); return null; });
    this.loading.set(src, p);
    return p;
  }

  async preloadSfx(onProgress) {
    const all = [];
    for (const list of Object.values(this.manifest.sfx || {})) all.push(...list);
    for (const v of Object.values(this.manifest.voice || {})) all.push(v.src);
    let done = 0;
    await Promise.all(all.map((s) => this.load(s).then(() => onProgress && onProgress(++done / all.length))));
  }

  async preload(sfxIds = [], voiceIds = []) {
    await this.init();
    const sources = new Set();
    for (const id of sfxIds) for (const src of this.manifest.sfx?.[id] || []) sources.add(src);
    for (const id of voiceIds) {
      const src = this.manifest.voice?.[id]?.src;
      if (src) sources.add(src);
    }
    await Promise.all([...sources].map((src) => this.load(src)));
  }

  // Play a sound effect by id. opts: vol, rate, pan (-1..1), detune (cents random range), minGap (s)
  sfx(id, opts = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const gap = opts.minGap ?? 0.025;
    const last = this.lastPlay.get(id) || 0;
    if (now - last < gap) return;
    this.lastPlay.set(id, now);
    const list = this.manifest.sfx?.[id];
    const src = list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
    const buf = src ? this.buffers.get(src) : null;
    if (!buf) {
      if (src && !this.buffers.has(src)) this.load(src);
      return this.synth(id, opts);
    }
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const rate = (opts.rate ?? 1) * Math.pow(2, ((Math.random() * 2 - 1) * (opts.detune ?? 60)) / 1200);
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = opts.vol ?? 1;
    let node = s.connect(g);
    if (opts.pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      node = node.connect(p);
    }
    node.connect(opts.bus === 'voice' ? this.voiceBus : this.sfxBus);
    s.start();
    return s;
  }

  // One announcer at a time: a line of equal or lower priority is dropped while another plays,
  // a more important line cuts the current one.
  voice(id, opts = {}) {
    if (!this.ctx) return 0;
    const v = this.manifest.voice?.[id];
    if (!v) return 0;
    const buf = this.buffers.get(v.src);
    if (!buf) { this.load(v.src); return 0; }
    const PRI = { mission_start: 5, mission_complete: 5, boss_warning: 5, game_over: 5, continue: 5, bloodbath: 4, execution: 4, frenzy: 4, new_record: 4 };
    const pri = opts.priority ?? (id.startsWith('narr') ? 9 : id.startsWith('rank') ? 6 : PRI[id] ?? 2);
    const now = this.ctx.currentTime;
    if (this.voiceSrc && now < this.voiceEnd - 0.05) {
      if (pri <= this.voicePri) return 0;
      try { this.voiceSrc.stop(); } catch { /* already stopped */ }
    }
    const s = this.ctx.createBufferSource();
    this.voiceSrc = s; this.voiceEnd = now + buf.duration; this.voicePri = pri;
    s.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = opts.vol ?? 1;
    s.connect(g).connect(this.voiceBus);
    s.start();
    // duck the music under the voice
    const t = this.ctx.currentTime;
    const d = this.musicDuck.gain;
    d.cancelScheduledValues(t);
    d.setTargetAtTime(opts.duck ?? 0.45, t, 0.05);
    d.setTargetAtTime(1, t + buf.duration, 0.3);
    return buf.duration;
  }

  async playMusic(id, { fade = 1.2, restart = false } = {}) {
    if (!this.ctx) return;
    if (this.music && this.music.id === id && !restart) return;
    const m = this.manifest.music?.[id];
    this.stopMusic(fade);
    if (!m) return;
    const token = {};
    this.musicToken = token;
    const buf = await this.load(m.src);
    if (!buf || this.musicToken !== token) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = !!m.loop;
    if (m.loop) {
      s.loopStart = m.loopStart || 0;
      s.loopEnd = m.loopEnd || buf.duration;
    }
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade);
    s.connect(g).connect(this.musicBus);
    s.start();
    this.music = { id, src: s, gain: g };
  }

  stopMusic(fade = 1) {
    // A track may still be downloading; an old title track must never start
    // after a stage transition has already requested different music.
    this.musicToken = null;
    if (!this.music || !this.ctx) return;
    const { src, gain } = this.music;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + fade);
    src.stop(t + fade + 0.05);
    this.music = null;
  }

  setMusicMuffle(amount) {
    if (!this.ctx) return;
    const f = 22000 * Math.pow(1 - amount * 0.97, 2.2) + 300 * amount;
    this.musicFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.12);
  }

  makeNoise() {
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // Procedural fallback: filtered noise burst + pitch-swept tone, shaped per sound family.
  synth(id, opts = {}) {
    const c = this.ctx;
    const t = c.currentTime;
    const fam = /rifle|hmg|shot|enemy_shot/.test(id) ? 'gun'
      : /explo|boom/.test(id) ? 'boom'
      : /splat|squelch|gore|spurt|drip|execution/.test(id) ? 'wet'
      : /ui_/.test(id) ? 'ui' : 'soft';
    const g = c.createGain();
    g.connect(this.sfxBus);
    const vol = (opts.vol ?? 1) * 0.5;
    if (fam === 'ui') {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(id === 'ui_back' ? 330 : 660, t);
      o.frequency.exponentialRampToValueAtTime(id === 'ui_back' ? 220 : 990, t + 0.06);
      g.gain.setValueAtTime(vol * 0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g); o.start(t); o.stop(t + 0.1);
      return;
    }
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const f = c.createBiquadFilter();
    const dur = fam === 'boom' ? 1.2 : fam === 'gun' ? 0.16 : fam === 'wet' ? 0.25 : 0.12;
    f.type = fam === 'wet' ? 'bandpass' : 'lowpass';
    f.frequency.setValueAtTime(fam === 'boom' ? 900 : fam === 'gun' ? 5000 : 700, t);
    f.frequency.exponentialRampToValueAtTime(fam === 'boom' ? 60 : 300, t + dur);
    f.Q.value = fam === 'wet' ? 3 : 0.7;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g);
    n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }
}

export const audio = new AudioManager();

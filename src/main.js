// App shell: title/menus -> game -> results (the intro cinematic plays from the menu).
import { Pipeline } from './render/pipeline.js';
import { Input } from './core/input.js';
import { Loop } from './core/loop.js';
import { audio } from './core/audio.js';
import { settings, saveSettings, records, saveRecords } from './core/settings.js';
import { STAGE_ORDER } from './game/levels.js';
import { Menus } from './ui/menus.js';
import { TitleScene } from './scenes/title.js';
import { Bot } from './dev/bot.js';
import { TouchControls } from './ui/touch.js';
import { isTouchDevice } from './core/device.js';

class App {
  constructor() {
    this.container = document.getElementById('game');
    this.ui = document.getElementById('ui');
    this.pipeline = new Pipeline(this.container);
    this.input = new Input(this.container);
    this.loop = new Loop(1 / 120);
    this.scene = null;
    this.game = null;
    this.paused = false;
    this.menus = new Menus(this);
    this.params = new URLSearchParams(location.search);
    this.loop.onUpdate = (dt) => this.update(dt);
    this.loop.onRender = (dt) => this.render(dt);
    this.pipeline.onResize = () => { if (this.game) this.game.cam.resize(this.pipeline.width / this.pipeline.height); };
    if (isTouchDevice) this.touch = new TouchControls(this);
    this.rotateEl = document.createElement('div');
    this.rotateEl.className = 'rotate-hint';
    this.rotateEl.innerHTML = '<div class="phone"></div><b>ROTATE YOUR DEVICE</b><small>BLOODBATH IS PLAYED IN LANDSCAPE</small>';
    document.body.appendChild(this.rotateEl);
    window.addEventListener('resize', () => this.checkOrientation());
    window.__app = this;
    window.__audio = audio;
    window.__settings = settings;
    if (this.params.get('bot')) this.bot = new Bot(this);
    this.speed = Number(this.params.get('speed') || 1);
  }

  start() {
    this.loop.start();
    // straight to the menu: audio unlocks on the first input (browser autoplay rules)
    audio.init().then(() => {
      const title = this.scene;
      if (title instanceof TitleScene) title.ready.then(() => {
        if (this.scene === title && audio.ctx?.state === 'running') audio.playMusic('title', { fade: 1.5 });
      });
    });
    const unlock = () => {
      audio.resume();
      // A tap on CAMPAIGN is also an audio-unlock gesture. Let its action run
      // before deciding whether title music should use the connection.
      setTimeout(() => {
        if (!this.game && this.scene instanceof TitleScene && !audio.music) audio.playMusic('title', { fade: 1.5 });
      }, 350);
      window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    // iOS only starts WebAudio from a completed gesture (touchend / pointerup)
    const iosUnlock = () => { audio.resume(); if (audio.ctx && audio.ctx.state === 'running') { window.removeEventListener('touchend', iosUnlock); window.removeEventListener('pointerup', iosUnlock); } };
    window.addEventListener('touchend', iosUnlock); window.addEventListener('pointerup', iosUnlock);
    this.checkOrientation();
    const stage = this.params.get('stage');
    const screen = this.params.get('screen');
    if (stage) return this.startStage(stage, null);
    if (screen === 'intro') return this.toIntro();
    this.toTitle();
  }

  setScene(s) {
    if (this.scene && this.scene.exit) this.scene.exit();
    this.scene = s;
    if (s && s.enter) s.enter();
  }

  async toIntro() {
    this.menus.clear();
    const { IntroScene } = await import('./scenes/intro.js');
    this.setScene(new IntroScene(this, () => { settings.seenIntro = true; saveSettings(); this.toTitle(); }));
  }

  toTitle() {
    this.endGame();
    this.menus.clear();
    this.setScene(new TitleScene(this));
    this.menus.title();
    audio.playMusic('title', { fade: 2 });
    this.warmTitleAssets(this.scene);
  }

  async warmTitleAssets(title) {
    await title.ready;
    await new Promise(requestAnimationFrame); // let the finished title paint first
    const active = () => this.scene === title && !this.game;
    if (!active()) return;
    // Parse game code and fill the texture cache while the player uses the menu.
    void import('./game/game.js');
    const { prefetchMenuAssets } = await import('./game/prefetch.js');
    if (!active()) return;
    void prefetchMenuAssets(active);
    void audio.preload(
      ['rifle', 'enemy_shot', 'enemy_death', 'enemy_pain', 'jump', 'dash', 'slash', 'splat', 'ui_select'],
      ['mission_start', 'mission_complete', 'checkpoint'],
    );
  }

  endGame() {
    this.stageLoadToken = null;
    if (this.game) { this.game.destroy(); this.game = null; }
    this.paused = false;
    document.body.classList.remove('paused');
  }

  async startStage(stage, carry) {
    this.endGame();
    const token = this.stageLoadToken = {};
    this.menus.clear();
    this.menus.loading(true);
    this.setScene(null);
    audio.stopMusic(0.8);
    const { Game } = await import('./game/game.js');
    if (this.stageLoadToken !== token) return;
    const g = new Game(this, { stage, carry });
    this.game = g;
    const essentialAudio = audio.preload(
      ['rifle', 'enemy_shot', 'enemy_death', 'enemy_pain', 'jump', 'dash', 'slash', 'splat'],
      ['mission_start'],
    );
    await Promise.all([g.load((p) => this.menus.loading(true, p)), essentialAudio]);
    if (this.game !== g) return;
    g.cam.resize(this.pipeline.width / this.pipeline.height);
    // let the first real frames (GPU uploads, first HUD layout) happen behind the loading screen
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    if (this.game !== g) return;
    this.menus.loading(false);
    g.start();
    this.currentStage = stage;
    this.currentCarry = carry;
  }

  onStageEnd(result) {
    const { stage, cleared, endless, score } = result;
    const key = endless ? 'arena' : stage;
    const prev = records[key]?.points || 0;
    const isRecord = score.points > prev;
    if (isRecord) records[key] = { points: Math.round(score.points), litres: score.litres };
    if (cleared && !endless) {
      const idx = STAGE_ORDER.indexOf(stage);
      records.unlocked = Math.max(records.unlocked || 0, idx + 1);
    }
    saveRecords();
    const next = cleared && !endless ? STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1] : null;
    this.endGame();
    this.setScene(new TitleScene(this, { dim: true }));
    this.menus.results({ ...result, isRecord, next, onNext: () => this.startStage(next, result.carry), onRetry: () => this.startStage(stage, this.currentCarry), onTitle: () => this.toTitle() });
  }

  checkOrientation() {
    const portrait = isTouchDevice && innerHeight > innerWidth;
    document.body.classList.toggle('is-portrait', portrait);
    if (portrait && this.game && !this.paused && this.game.state !== 'loading') this.pause(true);
  }

  pause(on) {
    if (!this.game) return;
    this.paused = on;
    document.body.classList.toggle('paused', on);
    audio.setMusicMuffle(on ? 0.85 : 0);
    this.menus.skipFrame = true; // the key that opened the pause must not also drive the menu
    if (on) this.menus.pause(); else this.menus.clearPause();
  }

  update(dt) {
    const inp = this.input;
    if (this.game && this.game.state !== 'loading') {
      // Esc opens the pause menu; inside it, Esc is handled by the menu (quit confirmation)
      if (inp.hit('pause') && !this.paused) this.pause(true);
      else if (this.paused && inp.pressed.has('KeyP')) this.pause(false);
      if (inp.hit('debug')) { settings.directorOverlay = !settings.directorOverlay; saveSettings(); }
      if (!this.paused) {
        if (this.bot) { for (let i = 0; i < this.speed && this.game; i++) { this.bot.think(dt); this.game.update(dt, this.bot); this.bot.endStep(); } }
        else this.game.update(dt, inp);
      }
    } else if (this.scene && this.scene.update) this.scene.update(dt, inp);
    this.menus.update(dt, inp);
    inp.endStep();
  }

  render(dt) {
    this.input.pollPad();
    if (this.touch) this.touch.update();
    if (this.game && this.game.state !== 'loading') this.game.render(this.paused ? 0 : dt);
    else if (this.scene && this.scene.render) this.scene.render(dt);
    else { this.pipeline.renderer.setRenderTarget(null); this.pipeline.renderer.setClearColor(0x000000, 1); this.pipeline.renderer.clear(); }
  }
}

if (new URLSearchParams(location.search).get('rigview')) import('./dev/rigview.js');
else new App().start();

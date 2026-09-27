// App shell: title/menus -> game -> results (the intro cinematic plays from the menu).
import { Pipeline } from './render/pipeline.js';
import { Input } from './core/input.js';
import { Loop } from './core/loop.js';
import { audio } from './core/audio.js';
import { settings, saveSettings, records, saveRecords } from './core/settings.js';
import { Game } from './game/game.js';
import { STAGE_ORDER } from './game/levels.js';
import { Menus } from './ui/menus.js';
import { IntroScene } from './scenes/intro.js';
import { TitleScene } from './scenes/title.js';
import { Bot } from './dev/bot.js';

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
      audio.preloadSfx();
      if (!this.game && this.scene instanceof TitleScene) audio.playMusic('title', { fade: 1.5 });
    });
    const unlock = () => {
      audio.resume();
      if (!this.game && this.scene instanceof TitleScene && !audio.music) audio.playMusic('title', { fade: 1.5 });
      window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
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

  toIntro() {
    this.menus.clear();
    this.setScene(new IntroScene(this, () => { settings.seenIntro = true; saveSettings(); this.toTitle(); }));
  }

  toTitle() {
    this.endGame();
    this.menus.clear();
    this.setScene(new TitleScene(this));
    this.menus.title();
    audio.playMusic('title', { fade: 2 });
  }

  endGame() {
    if (this.game) { this.game.destroy(); this.game = null; }
    this.paused = false;
    document.body.classList.remove('paused');
  }

  async startStage(stage, carry) {
    this.endGame();
    this.menus.clear();
    this.menus.loading(true);
    this.setScene(null);
    audio.stopMusic(0.8);
    const g = new Game(this, { stage, carry });
    this.game = g;
    await g.load((p) => this.menus.loading(true, p));
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
    if (this.game && this.game.state !== 'loading') this.game.render(this.paused ? 0 : dt);
    else if (this.scene && this.scene.render) this.scene.render(dt);
    else { this.pipeline.renderer.setRenderTarget(null); this.pipeline.renderer.setClearColor(0x000000, 1); this.pipeline.renderer.clear(); }
  }
}

if (new URLSearchParams(location.search).get('rigview')) import('./dev/rigview.js');
else new App().start();

const KEY = 'bloodbath.settings.v2';
const DEFAULTS = {
  masterVolume: 0.9,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  voiceVolume: 1.0,
  screenShake: 1.0,
  pixelScale: 'hd', // 'hd' | 'hibit' | 'retro'
  gore: 'bloodbath', // 'standard' | 'excessive' | 'bloodbath'
  difficulty: 'adaptive', // 'adaptive' | 'easy' | 'normal' | 'hard'
  crt: false,
  directorOverlay: false,
  seenIntro: false,
  touchAutoFire: true, // touch screens: shoot automatically at the auto-aim target
  touchScale: 1,
};
export const settings = { ...DEFAULTS, ...safeLoad() };
function safeLoad() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
export function saveSettings() {
  const { godMode, ...persist } = settings;
  try { localStorage.setItem(KEY, JSON.stringify(persist)); } catch { /* storage unavailable */ }
}
const RKEY = 'bloodbath.records.v1';
export const records = (() => { try { return JSON.parse(localStorage.getItem(RKEY)) || {}; } catch { return {}; } })();
export function saveRecords() { try { localStorage.setItem(RKEY, JSON.stringify(records)); } catch { /* ignore */ } }

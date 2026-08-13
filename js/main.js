/* =========================================================
   BOOT — estado da sessão, fiação da UI e service worker.
   ========================================================= */
import { initUI, refreshPads } from './ui.js';
import * as audio from './audio.js';
import * as sampler from './sampler.js';
import * as seq from './seq.js';

const APP_ID = 'cabacitos-mpc';
const K_SESSION = APP_ID + ':session';

const session = JSON.parse(localStorage.getItem(K_SESSION) || '{}');

const state = {
  mode:   session.mode || 'sample',
  bank:   session.bank || 0,
  bpm:    session.bpm  || 90,
  vol:    session.vol != null ? session.vol : 0.7,
  selPad: session.selPad || 0,

  shift: false,
  trim: false,
  levels16: false,
  fullLevel: false,

  recArmed: false,
  recState: 'wait',
  recPeak: 0,
  rec: { threshold: 0.03, maxSec: 8 },

  knobs: { k1: 0, k2: 1, k3: 0.5, k4: 0.7 },
};
state.knobs.k4 = state.vol;
if (session.bpm) seq.setBpm(session.bpm);

function saveSession() {
  localStorage.setItem(K_SESSION, JSON.stringify({
    mode: state.mode, bank: state.bank, bpm: seq.getBpm(),
    vol: state.vol, selPad: state.selPad,
  }));
}

sampler.setProjectExtras(() => seq.projectSlice());
initUI(state, saveSession);

sampler.loadFromDisk().then(({ proj }) => {
  seq.loadProject(proj);
  state.bpm = seq.getBpm();
  refreshPads();
});

document.getElementById('app').addEventListener('pointerdown', () => {
  audio.startAudio();
  audio.setMasterVolume(state.vol);
  audio.ensureAudioRunning();
}, true);

['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
});
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  let refreshing = false;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.update();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}

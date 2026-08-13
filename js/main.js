/* =========================================================
   BOOT — estado da sessão, fiação da UI e service worker.
   ========================================================= */
import { initUI, refreshPads } from './ui.js';
import * as audio from './audio.js';
import * as sampler from './sampler.js';

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

function saveSession() {
  localStorage.setItem(K_SESSION, JSON.stringify({
    mode: state.mode, bank: state.bank, bpm: state.bpm,
    vol: state.vol, selPad: state.selPad,
  }));
}

initUI(state, saveSession);

sampler.loadFromDisk().then(() => refreshPads());

/* O AudioContext só pode nascer dentro de um gesto: qualquer toque serve. */
document.getElementById('app').addEventListener('pointerdown', () => {
  audio.startAudio();
  audio.setMasterVolume(state.vol);
  audio.ensureAudioRunning();
}, true);

/* O Safari do iPad ignora touch-action para zoom de dois toques e pinça.
   Só preventDefault nos gestos nativos segura a tela. */
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

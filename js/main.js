/* =========================================================
   BOOT — estado da sessão, fiação da UI e service worker.
   O áudio entra na fase seguinte; aqui ainda não há AudioContext.
   ========================================================= */
import { initUI } from './ui.js';

const APP_ID = 'cabacitos-mpc';
const K_SESSION = APP_ID + ':session';

const session = JSON.parse(localStorage.getItem(K_SESSION) || '{}');

const state = {
  mode:  session.mode || 'sample',
  bank:  session.bank || 0,
  bpm:   session.bpm  || 90,
  shift: false,
  armed: false,
  knobs: { k1: 0.0, k2: 1.0, k3: 0.5, k4: 0.7 },
};

function saveSession() {
  localStorage.setItem(K_SESSION, JSON.stringify({
    mode: state.mode, bank: state.bank, bpm: state.bpm,
  }));
}

initUI(state, saveSession);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}

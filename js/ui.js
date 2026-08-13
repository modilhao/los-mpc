/* =========================================================
   UI — painel: display, modos, SHIFT, encoders, pads, SEQ e TRIM.
   ========================================================= */
import * as audio from './audio.js';
import * as sampler from './sampler.js';
import * as seq from './seq.js';

const COLORS = { blue:'#3d9bf2', green:'#2fbf7b', white:'#fafaf8', orange:'#ff7a1a' };
const BANKS = 'ABCDEFGH';
const SCREEN_INK = '#d8ffe8';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const MODE_NAME = { sample:'SAMPLE', seq:'SEQ', padfx:'PAD FX', knobfx:'KNOB FX' };

const KNOB_LABELS = {
  sample: { k1:['START','início'],   k2:['END','fim'],        k3:['PITCH','afinação'],  k4:['VOL','volume'] },
  seq:    { k1:['TEMPO','bpm'],      k2:['SWING','balanço'],  k3:['TIME C.','quantize'], k4:['VOL','volume'] },
  padfx:  { k1:['FLEX','repetição'], k2:['RATE','divisão'],   k3:['MIX','mistura'],     k4:['VOL','volume'] },
  knobfx: { k1:['FILTRO','corte'],   k2:['DELAY','fita'],     k3:['CRUSH','12 bits'],   k4:['REVERB','cauda'] },
};
const REC_LABELS = { k1:['LIMIAR','disparo'], k2:['DURAÇÃO','máxima'], k3:['—',''], k4:['VOL','volume'] };

const PAD_SHIFT = [
  'FULL LEVEL', 'HALF SEQ',     'DOUBLE SEQ',   'COUNT-IN',
  'COMPRESSOR', 'HALF SPEED',   'DOUBLE SPEED', 'REVERSE',
  'RECALL',     'REC QUANTIZE', 'RESAMPLE',     'SONG',
  'TRIM',       'TIME CORRECT', 'CHOP',         'IMPORTAR',
];

let state, onSession;
let stepEdit = false;
let playhead = -1;
let taps = [];

export function initUI(appState, saveSession) {
  state = appState;
  onSession = saveSession;
  buildPads();
  buildKnobs();
  bindModes();
  bindTransport();
  bindTrim();
  bindImport();
  setMode(state.mode);
  syncSeqKnobs();
  refreshPads();
  seq.setOnStep((s) => { playhead = s; });
  seq.setOnChange(() => sampler.saveProject());
  loop();
}

/* ---------- pads ---------- */
function buildPads() {
  const el = $('#pads');
  el.innerHTML = '';
  for (let row = 3; row >= 0; row--) {
    for (let col = 0; col < 4; col++) {
      const i = row * 4 + col;
      const pad = document.createElement('div');
      pad.className = 'pad';
      pad.dataset.pad = i;
      pad.innerHTML = `<span class="pnum">${i + 1}</span><span class="pshift">${PAD_SHIFT[i]}</span>`;
      el.appendChild(pad);
    }
  }

  const held = new Map();
  el.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad) return;
    el.setPointerCapture(e.pointerId);
    held.set(e.pointerId, pad);
    pad.classList.add('down');
    padDown(+pad.dataset.pad, velocityAt(pad, e));
  });
  const up = (e) => {
    const pad = held.get(e.pointerId);
    if (!pad) return;
    pad.classList.remove('down');
    held.delete(e.pointerId);
    seq.releasePad(+pad.dataset.pad);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function velocityAt(pad, e) {
  if (state.fullLevel) return 1;
  const r = pad.getBoundingClientRect();
  const y = clamp((e.clientY - r.top) / r.height, 0, 1);
  return 1 - y * 0.45;
}

function padDown(i, vel) {
  if (state.shift) return shiftAction(i);

  if (state.recArmed) return selectPad(i);

  /* STEP EDIT: cada pad é uma semicolcheia do pad selecionado */
  if (stepEdit && state.mode === 'seq') {
    seq.toggleStep(state.bank, state.selPad, i, vel);
    refreshPads();
    flash('STEP ' + (i + 1));
    return;
  }

  if (seq.isErase() && seq.isPlaying()) {
    seq.recordHit(state.bank, i, vel, seq.currentBeat());
    flash('ERASE PAD ' + (i + 1));
    return;
  }

  if (seq.isNoteRepeat()) {
    selectPad(i);
    if (seq.holdPad(state.bank, i, vel)) {
      if (seq.isRecording() && seq.isPlaying()) seq.recordHit(state.bank, i, vel, seq.currentBeat());
      return;
    }
  }

  if (state.levels16) {
    sampler.trigger(state.bank, state.selPad, (i + 1) / 16);
    if (seq.isRecording() && seq.isPlaying()) {
      seq.recordHit(state.bank, state.selPad, (i + 1) / 16, seq.currentBeat());
    }
    return;
  }

  selectPad(i);
  sampler.trigger(state.bank, i, vel);
  if (seq.isRecording() && seq.isPlaying()) {
    seq.recordHit(state.bank, i, vel, seq.currentBeat());
  }
}

function selectPad(i) {
  state.selPad = i;
  const pd = sampler.padDef(state.bank, i);
  if (pd && state.mode === 'sample') {
    state.knobs.k1 = pd.start;
    state.knobs.k2 = pd.end;
    state.knobs.k3 = (pd.pitch + 12) / 24;
    drawAllKnobs();
  }
  refreshPads();
}

export function refreshPads() {
  const steps = stepEdit && state.mode === 'seq'
    ? seq.stepsForPad(state.bank, state.selPad)
    : null;
  document.querySelectorAll('.pad').forEach((el) => {
    const i = +el.dataset.pad;
    el.classList.toggle('filled', steps ? steps[i] : !!sampler.padDef(state.bank, i));
    el.classList.toggle('sel', i === state.selPad);
    el.classList.toggle('playhead', seq.isPlaying() && i === playhead);
  });
}

/* ---------- SHIFT ---------- */
function shiftAction(i) {
  const label = PAD_SHIFT[i];
  if (label === 'TRIM') return setTrim(!state.trim);
  if (label === 'IMPORTAR') return $('#fileIn').click();
  if (label === 'FULL LEVEL') {
    state.fullLevel = !state.fullLevel;
    return flash(state.fullLevel ? 'FULL LEVEL LIGADO' : 'FULL LEVEL DESLIGADO');
  }
  if (label === 'TIME CORRECT') {
    seq.setQuantizeOn(!seq.getQuantizeOn());
    state.knobs.k3 = seq.getQuantizeOn() ? 1 : 0;
    drawAllKnobs();
    return flash(seq.getQuantizeOn() ? 'TIME CORRECT ON' : 'TIME CORRECT OFF');
  }
  if (label === 'CHOP') return doChop();
  if (label === 'HALF SEQ' || label === 'DOUBLE SEQ') {
    const s = seq.currentSeq();
    if (label === 'HALF SEQ') s.bars = Math.max(1, Math.floor(s.bars / 2) || 1);
    else s.bars = Math.min(4, s.bars * 2);
    sampler.saveProject();
    return flash(s.bars + ' COMPASSO' + (s.bars > 1 ? 'S' : ''));
  }
  flash(label + ' — ainda não');
}

function doChop() {
  audio.startAudio();
  const n = sampler.chopPad(state.bank, state.selPad);
  refreshPads();
  flash(n ? ('CHOP · ' + n + ' FATIAS') : 'CHOP · nada pra fatiar');
}

/* ---------- encoders ---------- */
const A0 = 135;

function knobArc(cx, cy, r, a0deg, a1deg) {
  const a0 = a0deg * Math.PI / 180, a1 = a1deg * Math.PI / 180;
  const large = (a1deg - a0deg) > 180 ? 1 : 0;
  return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
}

function drawKnob(el) {
  const v = state.knobs[el.dataset.k];
  const color = COLORS[el.dataset.color];
  const aV = A0 + 270 * v, aDot = aV * Math.PI / 180;
  const svg = el.querySelector('svg');
  svg.setAttribute('viewBox', '0 0 76 76');
  svg.innerHTML =
    `<circle class="kbody" cx="38" cy="38" r="25" fill="${color}"/>` +
    `<path class="karc" d="${knobArc(38, 38, 33, A0, 405)}"/>` +
    (v > 0.005 ? `<path class="kval" stroke="${el.dataset.color === 'white' ? '#8a8a84' : color}" d="${knobArc(38, 38, 33, A0, aV)}"/>` : '') +
    `<circle class="kdot" cx="${38 + 17 * Math.cos(aDot)}" cy="${38 + 17 * Math.sin(aDot)}" r="3.4"/>`;
}

const drawAllKnobs = () => document.querySelectorAll('.knob').forEach(drawKnob);

function buildKnobs() {
  document.querySelectorAll('.knob').forEach((el) => {
    const k = el.dataset.k;
    let startY = 0, startV = 0, dragging = false;
    el.addEventListener('pointerdown', (e) => {
      dragging = true; startY = e.clientY; startV = state.knobs[k];
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      state.knobs[k] = clamp(startV + (startY - e.clientY) / 140, 0, 1);
      drawKnob(el);
      applyKnob(k);
    });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointercancel', () => { dragging = false; });
  });
  drawAllKnobs();
}

function syncSeqKnobs() {
  state.bpm = seq.getBpm();
  state.knobs.k1 = (seq.getBpm() - 40) / 200;
  state.knobs.k2 = seq.getSwing();
  state.knobs.k3 = seq.getQuantizeOn() ? 1 : 0;
}

function applyKnob(k) {
  const v = state.knobs[k];

  if (state.mode === 'knobfx') {
    audio.startAudio();
    audio.setKnobFx(state.knobs.k1, state.knobs.k2, state.knobs.k3, state.knobs.k4);
    return;
  }

  if (k === 'k4' && state.mode !== 'knobfx') {
    audio.setMasterVolume(v);
    state.vol = v;
    onSession();
    return;
  }

  if (state.recArmed) {
    if (k === 'k1') state.rec.threshold = 0.005 + v * 0.35;
    if (k === 'k2') state.rec.maxSec = Math.round(1 + v * 19);
    return;
  }

  if (state.mode === 'seq') {
    if (k === 'k1') {
      seq.setBpm(40 + v * 200);
      state.bpm = seq.getBpm();
      onSession();
    }
    if (k === 'k2') seq.setSwing(v);
    if (k === 'k3') seq.setQuantizeOn(v > 0.5);
    sampler.saveProject();
    return;
  }

  const pd = sampler.padDef(state.bank, state.selPad);
  if (!pd) return;
  if (k === 'k1') pd.start = Math.min(v, pd.end - 0.002);
  if (k === 'k2') pd.end = Math.max(v, pd.start + 0.002);
  if (k === 'k3') pd.pitch = Math.round((v * 24 - 12) * 2) / 2;
  sampler.saveProject();
}

function updateKnobLabels() {
  const labels = state.recArmed ? REC_LABELS : KNOB_LABELS[state.mode];
  document.querySelectorAll('.knob').forEach((el) => {
    const [name, sub] = labels[el.dataset.k];
    el.querySelector('.kname').textContent = name;
    el.querySelector('.ksub').textContent = sub;
  });
}

/* ---------- modos ---------- */
function bindModes() {
  document.querySelectorAll('#modes .btn[data-mode]').forEach((el) => {
    el.addEventListener('pointerdown', () => setMode(el.dataset.mode));
  });
  $('#btnShift').addEventListener('pointerdown', () => {
    state.shift = !state.shift;
    $('#btnShift').classList.toggle('active', state.shift);
    document.body.classList.toggle('shift', state.shift);
  });
  document.querySelectorAll('#padPlay .btn').forEach((el) => {
    el.addEventListener('pointerdown', () => {
      const key = el.dataset.play;
      if (key === 'levels') {
        const on = !el.classList.contains('active');
        el.classList.toggle('active', on);
        state.levels16 = on;
        return;
      }
      if (key === 'chop') {
        if (state.mode === 'seq') {
          stepEdit = !stepEdit;
          el.classList.toggle('active', stepEdit);
          refreshPads();
          return flash(stepEdit ? 'STEP EDIT' : 'STEP EDIT OFF');
        }
        return doChop();
      }
      if (key === 'mute') {
        const on = !el.classList.contains('active');
        el.classList.toggle('active', on);
        seq.setErase(on);
        return flash(on ? 'ERASE ON · toque o pad' : 'ERASE OFF');
      }
      if (key === 'loop') {
        seq.clearSeq();
        refreshPads();
        return flash('SEQ ' + BANKS[seq.getSeqIndex()] + ' LIMPA');
      }
      flash(el.firstChild.textContent + ' — ainda não');
    });
  });
}

function setMode(mode) {
  state.mode = mode;
  if (state.trim && mode !== 'sample') setTrim(false);
  if (mode !== 'seq') {
    stepEdit = false;
    $('#padPlay .btn[data-play="chop"]').classList.remove('active');
  }
  document.querySelectorAll('#modes .btn[data-mode]').forEach((el) =>
    el.classList.toggle('active', el.dataset.mode === mode));
  if (mode === 'seq') syncSeqKnobs();
  if (mode === 'knobfx') {
    state.knobs.k1 = 0;
    state.knobs.k2 = 0;
    state.knobs.k3 = 0;
    state.knobs.k4 = 0;
    audio.startAudio();
    audio.setKnobFx(0, 0, 0, 0);
  }
  if (mode === 'sample') {
    const pd = sampler.padDef(state.bank, state.selPad);
    if (pd) {
      state.knobs.k1 = pd.start;
      state.knobs.k2 = pd.end;
      state.knobs.k3 = (pd.pitch + 12) / 24;
    }
    state.knobs.k4 = state.vol;
  }
  updateKnobLabels();
  updateBankButton();
  drawAllKnobs();
  refreshPads();
  onSession();
}

function updateBankButton() {
  if (state.mode === 'seq') {
    $('#btnBank').innerHTML = 'SEQ ' + BANKS[seq.getSeqIndex()] + '<small>SEQUENCE</small>';
  } else {
    $('#btnBank').innerHTML = 'BANCO ' + BANKS[state.bank] + '<small>BANK</small>';
  }
}

/* ---------- transporte ---------- */
function bindTransport() {
  $('#btnRec').addEventListener('pointerdown', onRec);
  $('#btnStop').addEventListener('pointerdown', onStop);
  $('#btnPlay').addEventListener('pointerdown', onPlay);
  $('#btnBank').addEventListener('pointerdown', () => {
    if (state.mode === 'seq') {
      seq.setSeqIndex(seq.getSeqIndex() + 1);
      updateBankButton();
      refreshPads();
      flash('SEQ ' + BANKS[seq.getSeqIndex()]);
    } else {
      state.bank = (state.bank + 1) % BANKS.length;
      updateBankButton();
      refreshPads();
      onSession();
    }
  });
  $('#btnRepeat').addEventListener('pointerdown', (e) => {
    if (state.shift) {
      seq.setTriplet(!seq.isTriplet());
      flash(seq.isTriplet() ? 'NOTE REPEAT · TERCINA' : 'NOTE REPEAT · 1/16');
      return;
    }
    seq.setNoteRepeat(!seq.isNoteRepeat());
    $('#btnRepeat').classList.toggle('active', seq.isNoteRepeat());
    flash(seq.isNoteRepeat() ? 'NOTE REPEAT ON' : 'NOTE REPEAT OFF');
  });
  $('#btnTap').addEventListener('pointerdown', onTapTempo);
  updateBankButton();
}

function onPlay() {
  audio.startAudio();
  audio.ensureAudioRunning();
  if (seq.isPlaying()) return;
  seq.play();
  $('#btnPlay').classList.add('active');
  flash('PLAY');
}

function onStop() {
  if (state.recArmed) {
    audio.stopCapture();
    return;
  }
  seq.stop();
  seq.setRecording(false);
  $('#btnPlay').classList.remove('active');
  $('#btnRec').classList.remove('armed');
  playhead = -1;
  refreshPads();
}

async function onRec() {
  /* SAMPLE: grava microfone. SEQ: overdub no sequenciador. */
  if (state.mode === 'seq') {
    audio.startAudio();
    if (!seq.isPlaying()) seq.play();
    seq.setRecording(!seq.isRecording());
    $('#btnRec').classList.toggle('armed', seq.isRecording());
    $('#btnPlay').classList.add('active');
    flash(seq.isRecording() ? 'SEQ REC · overdub' : 'SEQ REC OFF');
    return;
  }

  if (state.recArmed) return audio.stopCapture();
  const st = await audio.openMic().catch(() => 'erro');
  if (st === 'nomic' || st === 'erro') return flash('SEM MICROFONE — precisa de https');
  if (st === 'suspenso') return flash('TOQUE REC DE NOVO');

  state.recArmed = true;
  state.recState = 'rec';
  $('#btnRec').classList.add('armed');
  updateKnobLabels();
  flash('GRAVANDO · REC p/ salvar');

  audio.armCapture({
    maxSec: state.rec.maxSec,
    onState: (s, peak) => { state.recState = s; state.recPeak = peak; },
    onDone: (res, err) => {
      state.recArmed = false;
      state.recPeak = 0;
      $('#btnRec').classList.remove('armed');
      updateKnobLabels();
      if (!res) return flash(err || 'NADA GRAVADO');
      const pad = state.selPad;
      const tinha = !!sampler.padDef(state.bank, pad);
      const id = sampler.addSample('REC ' + (pad + 1), res.data, res.sr);
      sampler.assign(state.bank, pad, id);
      selectPad(pad);
      flash('PAD ' + (pad + 1) + (tinha ? ' REGRAVADO' : ' GRAVADO'));
    },
  });
}

function onTapTempo() {
  const now = performance.now();
  taps.push(now);
  taps = taps.filter((t) => now - t < 2000);
  if (taps.length >= 2) {
    let sum = 0;
    for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
    const ms = sum / (taps.length - 1);
    seq.setBpm(clamp(60000 / ms, 40, 240));
    state.bpm = seq.getBpm();
    if (state.mode === 'seq') {
      state.knobs.k1 = (state.bpm - 40) / 200;
      drawAllKnobs();
    }
    onSession();
    sampler.saveProject();
    flash(state.bpm.toFixed(1) + ' BPM');
  } else {
    flash('TAP TEMPO');
  }
}

/* ---------- importar ---------- */
function bindImport() {
  $('#fileIn').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    flash('DECODIFICANDO...');
    try {
      const { data, sr } = await audio.decodeFile(file);
      const pad = state.selPad;
      const id = sampler.addSample(file.name.replace(/\.[^.]+$/, '').slice(0, 18).toUpperCase(), data, sr);
      sampler.assign(state.bank, pad, id);
      selectPad(pad);
      flash('PAD ' + (pad + 1) + ' CARREGADO');
    } catch (err) {
      flash('ARQUIVO NÃO LIDO');
    }
  });
}

/* ---------- TRIM ---------- */
function setTrim(on) {
  state.trim = on;
  document.body.classList.toggle('trim', on);
}

function bindTrim() {
  $('#trimCv').addEventListener('pointerdown', () => sampler.trigger(state.bank, state.selPad, 1));
  $('#trimExit').addEventListener('pointerdown', () => setTrim(false));
}

/* ---------- display ---------- */
let flashText = '', flashUntil = 0;
function flash(t) { flashText = t; flashUntil = performance.now() + 1600; }

function drawWave(cv, ctx2d, s, pd, big) {
  const w = cv.width, h = cv.height, mid = h / 2;
  const pk = sampler.peaks(s);
  const n = pk.length / 2;
  const stroke = (from, to, alpha) => {
    ctx2d.globalAlpha = alpha;
    ctx2d.strokeStyle = SCREEN_INK;
    ctx2d.lineWidth = big ? 2 : 1.5;
    ctx2d.beginPath();
    for (let c = from; c < to; c++) {
      const x = c / (n - 1) * w;
      ctx2d.moveTo(x, mid - pk[c * 2 + 1] * mid * 0.92);
      ctx2d.lineTo(x, mid - pk[c * 2] * mid * 0.92);
    }
    ctx2d.stroke();
  };
  stroke(0, n, 0.16);
  stroke(Math.floor(pd.start * n), Math.ceil(pd.end * n), big ? 0.9 : 0.6);
  ctx2d.globalAlpha = 1;
  ctx2d.strokeStyle = '#ff7a1a';
  ctx2d.lineWidth = 2;
  for (const m of [pd.start, pd.end]) {
    ctx2d.beginPath();
    ctx2d.moveTo(m * w, 0);
    ctx2d.lineTo(m * w, h);
    ctx2d.stroke();
  }
}

function drawMeter(cv, ctx2d, peak) {
  const w = cv.width, h = cv.height;
  const thr = state.rec.threshold;
  ctx2d.fillStyle = state.recState === 'rec' ? '#d94c4c' : SCREEN_INK;
  ctx2d.globalAlpha = 0.8;
  ctx2d.fillRect(0, h * 0.62, Math.min(1, peak / 0.5) * w, h * 0.16);
  ctx2d.globalAlpha = 1;
  ctx2d.fillStyle = '#ff7a1a';
  ctx2d.fillRect((thr / 0.5) * w, h * 0.56, 3, h * 0.28);
}

function drawSeqGrid(cv, ctx2d) {
  const w = cv.width, h = cv.height;
  const steps = seq.stepsForPad(state.bank, state.selPad);
  const n = steps.length;
  const gap = 2;
  const bw = (w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const x = i * (bw + gap);
    ctx2d.globalAlpha = steps[i] ? 0.9 : 0.18;
    ctx2d.fillStyle = i === playhead ? '#ff7a1a' : SCREEN_INK;
    ctx2d.fillRect(x, h * 0.35, bw, h * 0.4);
  }
  ctx2d.globalAlpha = 1;
}

function fit(cv) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * 2) { cv.width = w * 2; cv.height = h * 2; }
}

function loop() {
  requestAnimationFrame(loop);

  const scope = $('#scope'), sctx = scope.getContext('2d');
  fit(scope);
  sctx.clearRect(0, 0, scope.width, scope.height);

  const pd = sampler.padDef(state.bank, state.selPad);
  const s = pd ? sampler.samples.get(pd.sampleId) : null;
  const mic = state.recArmed ? audio.getMicStats() : null;

  if (mic) drawMeter(scope, sctx, Math.max(state.recPeak, mic.an));
  else if (state.mode === 'seq') drawSeqGrid(scope, sctx);
  else if (s) drawWave(scope, sctx, s, pd, false);

  if (state.trim && s) {
    const cv = $('#trimCv'), c2 = cv.getContext('2d');
    fit(cv);
    c2.clearRect(0, 0, cv.width, cv.height);
    drawWave(cv, c2, s, pd, true);
  }

  if (seq.isPlaying()) refreshPads();

  $('#scrMode').textContent = state.recArmed
    ? 'GRAVANDO'
    : (seq.isRecording() ? 'SEQ REC' : (state.trim ? 'TRIM' : (stepEdit ? 'STEP' : MODE_NAME[state.mode])));
  $('#scrName').textContent = mic
    ? (mic.sr / 1000).toFixed(1) + 'k · ' + mic.state
    : (state.mode === 'seq'
      ? (seq.currentSeq().events.length + ' NOTAS · PAD ' + (state.selPad + 1))
      : (s ? s.name : 'PAD ' + (state.selPad + 1) + ' vazio'));
  $('#scrBank').textContent = state.mode === 'seq'
    ? 'SEQ ' + BANKS[seq.getSeqIndex()]
    : 'BANCO ' + BANKS[state.bank];
  $('#scrBpm').textContent = state.recArmed
    ? state.rec.maxSec + 'S MÁX'
    : (seq.getBpm().toFixed(1) + ' BPM');
  $('#scrHint').textContent = performance.now() < flashUntil
    ? flashText
    : (mic ? 'GRAVANDO · REC ou STOP salva'
      : seq.isNoteRepeat() ? 'NOTE REPEAT'
      : seq.isErase() ? 'ERASE · toque o pad'
      : stepEdit ? 'STEP EDIT · pad = step'
      : state.levels16 ? '16 LEVELS · PAD ' + (state.selPad + 1)
      : state.shift ? 'segunda camada'
      : state.mode === 'seq' ? 'REC overdub · PLAY loop'
      : s ? 'PAD ' + (state.selPad + 1) : 'REC grava · SHIFT+16 importa');
}

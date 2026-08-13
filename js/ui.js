/* =========================================================
   UI — painel: display, modos, SHIFT, encoders e os 16 pads.
   Nesta fase não há áudio: o arquivo cuida só da superfície.
   ========================================================= */

const COLORS = { blue:'#3d9bf2', green:'#2fbf7b', white:'#fafaf8', orange:'#ff7a1a' };

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Nome e sublinha de cada encoder por modo. Quatro encoders bastam:
   o modo troca o significado, nunca acrescenta uma quinta fileira. */
const KNOB_LABELS = {
  sample: { k1:['START','início'],   k2:['END','fim'],        k3:['PITCH','afinação'],  k4:['VOL','volume'] },
  seq:    { k1:['TEMPO','bpm'],      k2:['SWING','balanço'],  k3:['TIME C.','quantize'], k4:['VOL','volume'] },
  padfx:  { k1:['FLEX','repetição'], k2:['RATE','divisão'],   k3:['MIX','mistura'],     k4:['VOL','volume'] },
  knobfx: { k1:['FILTRO','corte'],   k2:['DELAY','fita'],     k3:['CRUSH','12 bits'],   k4:['REVERB','cauda'] },
};

const MODE_NAME = { sample:'SAMPLE', seq:'SEQ', padfx:'PAD FX', knobfx:'KNOB FX' };

/* A serigrafia dos pads: a segunda camada do aparelho, revelada pelo SHIFT.
   Índice 0 = pad 1 (canto inferior esquerdo, como no hardware). */
const PAD_SHIFT = [
  'FULL LEVEL', 'HALF SEQ',     'DOUBLE SEQ',   'COUNT-IN',
  'COMPRESSOR', 'HALF SPEED',   'DOUBLE SPEED', 'REVERSE',
  'RECALL',     'REC QUANTIZE', 'RESAMPLE',     'SONG',
  'TRIM',       'TIME CORRECT', 'CHOP',         'PROJECT',
];

const BANKS = 'ABCDEFGH';

let state, onSession;

export function initUI(appState, saveSession) {
  state = appState;
  onSession = saveSession;
  buildPads();
  buildKnobs();
  bindModes();
  bindTransport();
  setMode(state.mode);
  drawDisplay();
}

/* ---------- pads ----------
   Numeração do hardware: o pad 1 é o canto inferior esquerdo,
   então a primeira linha da tela são os pads 13 a 16. */
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
    padDown(+pad.dataset.pad);
  });
  const up = (e) => {
    const pad = held.get(e.pointerId);
    if (!pad) return;
    pad.classList.remove('down');
    held.delete(e.pointerId);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function padDown(i) {
  if (state.shift) {
    $('#scrHint').textContent = PAD_SHIFT[i];
    return;
  }
  $('#scrName').textContent = 'PAD ' + (i + 1);
}

/* ---------- encoders ----------
   Arco de 270° começando em 135°, arrastar na vertical, 140px = curso completo. */
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
  el.querySelector('svg').setAttribute('viewBox', '0 0 76 76');
  el.querySelector('svg').innerHTML =
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
    });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointercancel', () => { dragging = false; });
  });
  drawAllKnobs();
}

function updateKnobLabels() {
  const labels = KNOB_LABELS[state.mode];
  document.querySelectorAll('.knob').forEach((el) => {
    const [name, sub] = labels[el.dataset.k];
    el.querySelector('.kname').textContent = name;
    el.querySelector('.ksub').textContent = sub;
  });
}

/* ---------- modos e SHIFT ----------
   SHIFT trava no toque em vez de exigir dedo preso: numa tela,
   segurar o modificador com uma mão e tocar com a outra é pior. */
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
    el.addEventListener('pointerdown', () => el.classList.toggle('active'));
  });
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#modes .btn[data-mode]').forEach((el) =>
    el.classList.toggle('active', el.dataset.mode === mode));
  $('#scrMode').textContent = MODE_NAME[mode];
  updateKnobLabels();
  drawAllKnobs();
  onSession();
}

/* ---------- transporte ---------- */
function bindTransport() {
  $('#btnRec').addEventListener('pointerdown', () => {
    state.armed = !state.armed;
    $('#btnRec').classList.toggle('armed', state.armed);
  });
  $('#btnPlay').addEventListener('pointerdown', () => $('#btnPlay').classList.add('active'));
  $('#btnStop').addEventListener('pointerdown', () => $('#btnPlay').classList.remove('active'));
  $('#btnBank').addEventListener('pointerdown', () => {
    state.bank = (state.bank + 1) % BANKS.length;
    $('#btnBank').textContent = 'BANCO ' + BANKS[state.bank];
    $('#scrBank').textContent = 'BANCO ' + BANKS[state.bank];
    onSession();
  });
  $('#btnBank').textContent = 'BANCO ' + BANKS[state.bank];
  $('#scrBank').textContent = 'BANCO ' + BANKS[state.bank];
  $('#scrBpm').textContent = state.bpm.toFixed(1) + ' BPM';
}

/* ---------- display ----------
   Sem áudio ainda: por enquanto o canvas só marca a linha de silêncio. */
function drawDisplay() {
  const cv = $('#scope'), ctx = cv.getContext('2d');
  const paint = () => {
    requestAnimationFrame(paint);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * 2) { cv.width = w * 2; cv.height = h * 2; }
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#d8ffe8';
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, cv.height / 2);
    ctx.lineTo(cv.width, cv.height / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  paint();
}

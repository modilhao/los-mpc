/* =========================================================
   ÁUDIO — contexto, saída master, microfone e ciclo de vida no iOS.
   Regras de ouro em STACK.md: nada de atribuir .value durante o som,
   compressor no fim da cadeia, contexto só nasce em gesto do usuário.

   Captura de microfone: MediaRecorder (o caminho que já funciona no
   iPad da banda). AudioWorklet + getUserMedia no Safari costuma mostrar
   nível no analisador e entregar bloco vazio — exatamente o sintoma
   "aparece a captação e não grava no pad".
   ========================================================= */

const volGain = (v) => Math.pow(v, 2) * 0.9;

let ctx = null;
let busIn, master, comp, analyser;
let wakeSentinel = null;

let micStream = null;
let micSource = null;
let micAnalyser = null;
let micSilent = null;
let cap = null;
const micWave = new Float32Array(1024);

export const getCtx = () => ctx;
export const getBusIn = () => busIn;
export const getAnalyser = () => analyser;

export function startAudio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;

  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 5;
  comp.attack.value = 0.002; comp.release.value = 0.12;

  master = ctx.createGain();
  busIn = ctx.createGain();
  busIn.connect(master).connect(comp).connect(analyser).connect(ctx.destination);

  if (navigator.audioSession) {
    try { navigator.audioSession.type = 'play-and-record'; } catch (e) { /* iOS < 17 */ }
  }

  ctx.addEventListener('statechange', () => {
    if (ctx.state !== 'running' && document.visibilityState === 'visible') ensureAudioRunning();
  });
  requestWake();
  return ctx;
}

export function setMasterVolume(v) {
  if (master) master.gain.setTargetAtTime(volGain(v), ctx.currentTime, 0.02);
}

/* ---------- ciclo de vida (iOS) ---------- */
function requestWake() {
  try {
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then((l) => { wakeSentinel = l; }).catch(() => {});
  } catch (e) { /* sem wake lock: o show continua */ }
}

export async function ensureAudioRunning() {
  if (!ctx) return false;
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
    try { await ctx.resume(); } catch (e) { /* volta na próxima interação */ }
  }
  return ctx.state === 'running';
}

async function onAppForeground() {
  if (!ctx) return;
  if (!await ensureAudioRunning()) return;
  requestWake();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') onAppForeground();
});
window.addEventListener('pageshow', onAppForeground);
window.addEventListener('focus', onAppForeground);

/* ---------- microfone ---------- */
function analyserPeak() {
  if (!micAnalyser) return 0;
  micAnalyser.getFloatTimeDomainData(micWave);
  let p = 0;
  for (let i = 0; i < micWave.length; i++) {
    const a = Math.abs(micWave[i]);
    if (a > p) p = a;
  }
  return p;
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export const getMicStats = () => ({
  blocks: cap && cap.chunks ? cap.chunks.length : 0,
  an: analyserPeak(),
  state: ctx ? ctx.state : 'sem contexto',
  sr: ctx ? ctx.sampleRate : 0,
});

export async function openMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'nomic';
  if (typeof MediaRecorder === 'undefined') return 'nomic';
  startAudio();

  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const el = document.getElementById('micKeep');
    if (el) {
      el.srcObject = micStream;
      el.muted = true;
      try { await el.play(); } catch (e) { /* o stream precisa ficar preso ao elemento */ }
    }
    micSource = ctx.createMediaStreamSource(micStream);
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 1024;
    micSilent = ctx.createGain();
    micSilent.gain.value = 0;
    micSource.connect(micAnalyser);
    micSource.connect(micSilent).connect(ctx.destination);
  }

  await ensureAudioRunning();
  return ctx.state === 'running' ? 'ok' : 'suspenso';
}

/* Espera o som passar do limiar e só então liga o MediaRecorder.
   Sem pré-roll de worklet: no iPad a confiabilidade vale mais. */
export function armCapture({ threshold, maxSec, onState, onDone }) {
  cancelCapture();
  cap = {
    threshold, maxSec, onState, onDone,
    rec: false, recorder: null, chunks: [],
    raf: 0, timer: 0,
  };
  onState('wait', 0);
  watchPeak(cap);
}

function watchPeak(c) {
  const tick = () => {
    if (cap !== c) return;
    const peak = analyserPeak();
    if (!c.rec) {
      c.onState('wait', peak);
      if (peak >= c.threshold) beginRecorder(c);
    } else {
      c.onState('rec', peak);
    }
    c.raf = requestAnimationFrame(tick);
  };
  c.raf = requestAnimationFrame(tick);
}

function beginRecorder(c) {
  if (c.rec || !micStream) return;
  c.rec = true;
  c.chunks = [];
  const mime = pickMime();
  try {
    c.recorder = mime ? new MediaRecorder(micStream, { mimeType: mime }) : new MediaRecorder(micStream);
  } catch (e) {
    c.recorder = new MediaRecorder(micStream);
  }
  c.recorder.ondataavailable = (e) => {
    if (cap === c && e.data && e.data.size) c.chunks.push(e.data);
  };
  c.recorder.start();
  c.timer = setTimeout(() => { if (cap === c) finishCapture(); }, c.maxSec * 1000);
  c.onState('rec', analyserPeak());
}

export function cancelCapture() {
  const c = cap;
  cap = null;
  if (!c) return;
  if (c.raf) cancelAnimationFrame(c.raf);
  if (c.timer) clearTimeout(c.timer);
  if (c.recorder && c.recorder.state !== 'inactive') {
    c.recorder.ondataavailable = null;
    c.recorder.onstop = null;
    try { c.recorder.stop(); } catch (e) { /* já parado */ }
  }
}

export function stopCapture() { if (cap) finishCapture(); }

export const isCapturing = () => !!cap;

function finishCapture() {
  const c = cap;
  if (!c) return;
  cap = null;
  if (c.raf) cancelAnimationFrame(c.raf);
  if (c.timer) clearTimeout(c.timer);

  const fail = () => c.onDone(null);

  if (!c.rec || !c.recorder) return fail();

  c.recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) c.chunks.push(e.data);
  };
  c.recorder.onstop = async () => {
    try {
      if (!c.chunks.length) return fail();
      const blob = new Blob(c.chunks, { type: c.chunks[0].type || 'audio/mp4' });
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      c.onDone({ data: buf.getChannelData(0).slice(0), sr: buf.sampleRate });
    } catch (e) {
      fail();
    }
  };

  if (c.recorder.state === 'recording') {
    try { c.recorder.stop(); } catch (e) { fail(); }
  } else if (c.chunks.length) {
    c.recorder.onstop();
  } else {
    fail();
  }
}

/* ---------- importar arquivo ---------- */
export async function decodeFile(file) {
  startAudio();
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  return { data: buf.getChannelData(0).slice(0), sr: buf.sampleRate };
}

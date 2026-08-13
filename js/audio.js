/* =========================================================
   ÁUDIO — contexto, saída master, microfone e ciclo de vida no iOS.
   Regras de ouro em STACK.md: nada de atribuir .value durante o som,
   compressor no fim da cadeia, contexto só nasce em gesto do usuário.

   Captura: MediaRecorder, igual ao instrumento da banda no iPad.
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
  mr: cap && cap.recorder ? cap.recorder.state : 'off',
});

async function getMicStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

export async function openMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'nomic';
  if (typeof MediaRecorder === 'undefined') return 'nomic';
  startAudio();

  if (!micStream) {
    micStream = await getMicStream();
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

/* Liga o MediaRecorder na hora — no iOS o analisador Web Audio pode
   ficar mudo com o mesmo stream que o MediaRecorder grava bem.
   O limiar fica só como referência visual; não trava o início. */
export function armCapture({ maxSec, onState, onDone }) {
  cancelCapture();
  if (!micStream) {
    onDone(null, 'sem microfone');
    return;
  }

  const mime = pickMime();
  let recorder;
  try {
    recorder = mime ? new MediaRecorder(micStream, { mimeType: mime }) : new MediaRecorder(micStream);
  } catch (e) {
    try { recorder = new MediaRecorder(micStream); }
    catch (e2) { onDone(null, 'MediaRecorder indisponível'); return; }
  }

  const c = {
    maxSec, onState, onDone,
    recorder, chunks: [],
    raf: 0, timer: 0,
  };
  cap = c;

  /* NUNCA filtre chunks com `cap === c`: no iOS o único blob útil chega
     no ondataavailable disparado pelo stop(), depois de cap já ter
     mudado. No Mac os pedaços vêm durante a gravação — por isso só o
     iPad “não gravava”. */
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) c.chunks.push(e.data);
  };
  recorder.onerror = () => finishCapture('erro do gravador');

  try {
    recorder.start(250);
  } catch (e) {
    try { recorder.start(); }
    catch (e2) {
      cap = null;
      onDone(null, 'não iniciou a gravação');
      return;
    }
  }

  c.timer = setTimeout(() => { if (cap === c) finishCapture(); }, maxSec * 1000);
  onState('rec', analyserPeak());

  const tick = () => {
    if (cap !== c) return;
    c.onState('rec', analyserPeak());
    c.raf = requestAnimationFrame(tick);
  };
  c.raf = requestAnimationFrame(tick);
}

export function cancelCapture() {
  const c = cap;
  cap = null;
  if (!c) return;
  if (c.raf) cancelAnimationFrame(c.raf);
  if (c.timer) clearTimeout(c.timer);
  if (c.recorder && c.recorder.state !== 'inactive') {
    c.recorder.ondataavailable = null;
    c.recorder.onerror = null;
    c.recorder.onstop = null;
    try { c.recorder.stop(); } catch (e) { /* já parado */ }
  }
}

export function stopCapture() { if (cap) finishCapture(); }

export const isCapturing = () => !!cap;

function finishCapture(errMsg) {
  const c = cap;
  if (!c) return;
  cap = null;
  if (c.raf) cancelAnimationFrame(c.raf);
  if (c.timer) clearTimeout(c.timer);

  const fail = (msg) => c.onDone(null, msg || errMsg || 'NADA GRAVADO');

  if (!c.recorder) return fail();

  const decode = async () => {
    try {
      if (!c.chunks.length) return fail('sem áudio no blob');
      const type = c.chunks[0].type || c.recorder.mimeType || 'audio/mp4';
      const blob = new Blob(c.chunks, { type });
      const raw = await blob.arrayBuffer();
      /* iOS consome/detacha o ArrayBuffer — precisa de cópia. */
      const copy = raw.slice(0);
      const buf = await new Promise((ok, err) => {
        const p = ctx.decodeAudioData(copy, ok, err);
        if (p && typeof p.then === 'function') p.then(ok, err);
      });
      const ch = buf.numberOfChannels > 0 ? buf.getChannelData(0) : null;
      if (!ch || !ch.length) return fail('áudio vazio');
      c.onDone({ data: ch.slice(0), sr: buf.sampleRate });
    } catch (e) {
      fail('falha ao decodificar');
    }
  };

  c.recorder.onstop = () => { decode(); };

  if (c.recorder.state === 'recording' || c.recorder.state === 'paused') {
    try {
      if (typeof c.recorder.requestData === 'function') {
        try { c.recorder.requestData(); } catch (e) { /* iOS antigo */ }
      }
      c.recorder.stop();
    } catch (e) {
      fail('não parou o gravador');
    }
  } else if (c.chunks.length) {
    decode();
  } else {
    fail();
  }
}

/* ---------- importar arquivo ---------- */
export async function decodeFile(file) {
  startAudio();
  const raw = await file.arrayBuffer();
  const buf = await ctx.decodeAudioData(raw.slice(0));
  return { data: buf.getChannelData(0).slice(0), sr: buf.sampleRate };
}

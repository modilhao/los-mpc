/* =========================================================
   ÁUDIO — contexto, saída master, microfone e ciclo de vida no iOS.
   Regras de ouro em STACK.md: nada de atribuir .value durante o som,
   compressor no fim da cadeia, contexto só nasce em gesto do usuário.
   ========================================================= */

/* volume perceptual: knob linear soa errado */
const volGain = (v) => Math.pow(v, 2) * 0.9;

let ctx = null;
let busIn, master, comp, analyser;
let wakeSentinel = null;

let micSource = null, tapNode = null, micSilent = null;
let cap = null;

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

/* ---------- microfone ----------
   O tap vai para um ganho zerado: sem isso o nó não é processado, e com
   monitoração aberta o alto-falante do iPad realimenta o microfone. */
export async function openMic() {
  if (micSource) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  startAudio();
  await ensureAudioRunning();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  await ctx.audioWorklet.addModule('js/tap-worklet.js');
  micSource = ctx.createMediaStreamSource(stream);
  tapNode = new AudioWorkletNode(ctx, 'tap');
  micSilent = ctx.createGain();
  micSilent.gain.value = 0;
  micSource.connect(tapNode).connect(micSilent).connect(ctx.destination);
  tapNode.port.onmessage = (e) => onBlock(e.data);
  return true;
}

/* ---------- captura com threshold ----------
   Espera o som passar do limiar e só então grava, guardando os dois blocos
   anteriores como pré-roll: sem isso o ataque da batida fica de fora. */
export function armCapture({ threshold, maxSec, onState, onDone }) {
  cap = { threshold, maxSec, onState, onDone, rec: false, chunks: [], pre: [], frames: 0 };
  onState('wait', 0);
}

export function cancelCapture() { cap = null; }

export function stopCapture() { if (cap) finishCapture(); }

export const isCapturing = () => !!cap;

function onBlock(block) {
  if (!cap) return;
  let peak = 0;
  for (let i = 0; i < block.length; i++) {
    const a = Math.abs(block[i]);
    if (a > peak) peak = a;
  }

  if (!cap.rec) {
    cap.pre.push(block);
    if (cap.pre.length > 2) cap.pre.shift();
    if (peak < cap.threshold) { cap.onState('wait', peak); return; }
    cap.rec = true;
    cap.chunks = cap.pre.slice();
    cap.frames = cap.chunks.reduce((a, b) => a + b.length, 0);
  } else {
    cap.chunks.push(block);
    cap.frames += block.length;
  }

  if (cap.frames >= cap.maxSec * ctx.sampleRate) finishCapture();
  else cap.onState('rec', peak);
}

function finishCapture() {
  const c = cap;
  cap = null;
  if (!c.rec || !c.frames) { c.onDone(null); return; }
  const data = new Float32Array(c.frames);
  let o = 0;
  for (const b of c.chunks) { data.set(b, o); o += b.length; }
  c.onDone({ data, sr: ctx.sampleRate });
}

/* ---------- importar arquivo ---------- */
export async function decodeFile(file) {
  startAudio();
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  return { data: buf.getChannelData(0).slice(0), sr: buf.sampleRate };
}

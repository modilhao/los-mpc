/* =========================================================
   SAMPLER — 16 pads × 8 bancos, disparo, região, pitch e choke.
   Diferente dos osciladores do kit, AudioBufferSource é descartável
   por natureza: nasce e morre a cada batida. O que se controla é
   quantas podem viver ao mesmo tempo.
   ========================================================= */
import { getCtx, getBusIn } from './audio.js';
import * as store from './store.js';

export const NBANKS = 8;
export const NPADS = 16;
export const MAX_VOICES = 32;
const PEAK_COLS = 512;

export const samples = new Map();   // id -> {id, name, sr, data, buf, peaks}
export const banks = [];            // [banco][pad] = padDef | null

for (let b = 0; b < NBANKS; b++) banks.push(new Array(NPADS).fill(null));

const active = [];                  // vozes soando, mais antiga primeiro
let seq = 0;

const newPad = (sampleId) => ({ sampleId, start: 0, end: 1, pitch: 0, level: 1 });

/* ---------- samples ---------- */
export function addSample(name, data, sr, persist = true) {
  const id = 's' + (Date.now().toString(36)) + (seq++).toString(36);
  samples.set(id, { id, name, sr, data, buf: null, peaks: null });
  if (persist) store.putSample(id, name, sr, data);
  return id;
}

/* O AudioBuffer só pode ser criado depois que existe contexto, e o contexto
   só nasce em gesto do usuário — por isso é construído sob demanda. */
function ensureBuffer(s) {
  if (s.buf) return s.buf;
  const ctx = getCtx();
  if (!ctx) return null;
  const buf = ctx.createBuffer(1, s.data.length, s.sr);
  buf.copyToChannel(s.data, 0);
  s.buf = buf;
  return buf;
}

export function peaks(s) {
  if (s.peaks) return s.peaks;
  const out = new Float32Array(PEAK_COLS * 2);
  const step = s.data.length / PEAK_COLS;
  for (let c = 0; c < PEAK_COLS; c++) {
    let lo = 1, hi = -1;
    const a = Math.floor(c * step), b = Math.min(s.data.length, Math.floor((c + 1) * step));
    for (let i = a; i < b; i++) {
      const v = s.data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[c * 2] = lo === 1 ? 0 : lo;
    out[c * 2 + 1] = hi === -1 ? 0 : hi;
  }
  s.peaks = out;
  return out;
}

/* ---------- pads ---------- */
export const padDef = (b, p) => banks[b][p];

export function assign(b, p, sampleId) {
  banks[b][p] = newPad(sampleId);
  saveProject();
}

export function clearPad(b, p) {
  banks[b][p] = null;
  saveProject();
}

/* ---------- disparo ---------- */
export function trigger(b, p, vel = 1, when = null) {
  const pd = banks[b][p];
  if (!pd) return false;
  const s = samples.get(pd.sampleId);
  const ctx = getCtx();
  if (!s || !ctx) return false;
  const buf = ensureBuffer(s);
  if (!buf) return false;

  chokePad(b, p);
  if (active.length >= MAX_VOICES) stopVoice(active[0], 0.005);

  const t = when != null ? when : ctx.currentTime;
  const dur = buf.duration;
  const a = pd.start * dur;
  const len = Math.max(0.005, (pd.end - pd.start) * dur);

  const g = ctx.createGain();
  g.gain.value = pd.level * vel;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.pow(2, pd.pitch / 12);
  src.connect(g).connect(getBusIn());
  src.start(t, a, len);

  const v = { src, g, b, p, t };
  active.push(v);
  src.onended = () => {
    const i = active.indexOf(v);
    if (i >= 0) active.splice(i, 1);
  };
  return true;
}

/* Choke: bater de novo no mesmo pad corta o que estava soando.
   Sem isso, um loop de bateria vira um acúmulo de caudas. */
function chokePad(b, p) {
  for (const v of active.slice()) {
    if (v.b === b && v.p === p) stopVoice(v, 0.004);
  }
}

function stopVoice(v, fade) {
  const ctx = getCtx();
  const t = ctx.currentTime;
  v.g.gain.cancelScheduledValues(t);
  v.g.gain.setTargetAtTime(0, t, fade);
  try { v.src.stop(t + fade * 6); } catch (e) { /* já parou */ }
  const i = active.indexOf(v);
  if (i >= 0) active.splice(i, 1);
}

export function stopAll() {
  for (const v of active.slice()) stopVoice(v, 0.01);
}

/* CHOP: fatia o sample do pad pelos transientes e espalha nos 16 pads. */
export function chopPad(b, p) {
  const pd = banks[b][p];
  if (!pd) return 0;
  const s = samples.get(pd.sampleId);
  if (!s) return 0;
  const a0 = Math.floor(pd.start * s.data.length);
  const a1 = Math.floor(pd.end * s.data.length);
  if (a1 - a0 < s.sr * 0.05) return 0;
  const slice = s.data.subarray(a0, a1);
  const cuts = findTransients(slice, s.sr);
  /* no máximo 16 fatias; se achou pouco, divide em partes iguais */
  let points = cuts;
  if (points.length < 2) {
    points = [];
    const n = 8;
    for (let i = 0; i < n; i++) points.push(Math.floor((i / n) * slice.length));
  }
  points = points.slice(0, 16);
  if (points[points.length - 1] < slice.length) points.push(slice.length);

  let n = 0;
  for (let i = 0; i < points.length - 1 && i < 16; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (to - from < s.sr * 0.02) continue;
    const data = slice.slice(from, to);
    const id = addSample('CHOP ' + (i + 1), data, s.sr);
    assign(b, i, id);
    n++;
  }
  return n;
}

function findTransients(data, sr) {
  const hop = Math.max(32, Math.floor(sr * 0.004));
  const minGap = Math.floor(sr * 0.06);
  const cuts = [0];
  let prev = 0;
  let run = 0;
  for (let i = 0; i < data.length; i += hop) {
    let e = 0;
    const end = Math.min(data.length, i + hop);
    for (let j = i; j < end; j++) e += data[j] * data[j];
    e = Math.sqrt(e / (end - i));
    run = run * 0.85 + e * 0.15;
    if (e > 0.08 && e > prev * 2.2 && (i - cuts[cuts.length - 1]) > minGap) {
      cuts.push(i);
      if (cuts.length >= 16) break;
    }
    prev = run;
  }
  return cuts;
}

/* ---------- projeto ---------- */
export function serialize() {
  return { banks: banks.map((bk) => bk.map((p) => (p ? { ...p } : null))) };
}

let extras = () => ({});
export function setProjectExtras(fn) { extras = fn; }

let saveTimer = null;
export function saveProject() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.putProject({ ...serialize(), ...extras() }), 300);
}

export async function loadFromDisk() {
  const [list, proj] = await Promise.all([store.allSamples(), store.getProject()]);
  for (const s of list) samples.set(s.id, { ...s, buf: null, peaks: null });
  if (proj && proj.banks) {
    proj.banks.forEach((bk, b) => bk.forEach((p, i) => {
      banks[b][i] = p && samples.has(p.sampleId) ? p : null;
    }));
  }
  return { count: list.length, proj };
}

/* =========================================================
   SEQ — sequenciador estilo MPC: loop, overdub, TIME CORRECT,
   swing, note repeat e erase ao vivo.

   Tempo dos eventos em beats (float). Quantize e swing só na
   reprodução — desligar o TC devolve o groove original.
   ========================================================= */
import { getCtx } from './audio.js';
import * as sampler from './sampler.js';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const NSEQ = 8;
const STEPS_PER_BAR = 16; /* semicolcheias */
const BEATS_PER_BAR = 4;

export function emptySeq() {
  return { bars: 1, events: [] };
}

const seqs = Array.from({ length: NSEQ }, emptySeq);

let seqIndex = 0;
let bpm = 90;
let swing = 0;          /* 0..1 — atrasa as semicolcheias ímpares */
let quantize = 1;       /* 0 = off, 1 = 1/16, 0.5 = 1/8, 0.25 = 1/4 (em fração de beat: 0.25 = 1/16) */
let quantizeOn = true;

let playing = false;
let recording = false;
let erase = false;
let noteRepeat = false;
let noteRepeatDiv = 0.25; /* beats entre disparos: 0.25 = 1/16 */
let triplet = false;

let timer = null;
let nextTime = 0;
let originTime = 0;     /* ctx time when beat 0 of current loop started */
let originBeat = 0;
let stepIndex = 0;
let onStep = null;
let onChange = null;

const heldRepeat = new Map(); /* pad -> { bank, vel, nextT } */

export const isPlaying = () => playing;
export const isRecording = () => recording;
export const isNoteRepeat = () => noteRepeat;
export const isErase = () => erase;
export const isTriplet = () => triplet;
export const getSeqIndex = () => seqIndex;
export const getBpm = () => bpm;
export const getSwing = () => swing;
export const getQuantizeOn = () => quantizeOn;
export const getCurrentStep = () => stepIndex;
export const currentSeq = () => seqs[seqIndex];

export function setOnStep(fn) { onStep = fn; }
export function setOnChange(fn) { onChange = fn; }

function notify() { if (onChange) onChange(); }

export function setBpm(v) {
  bpm = Math.max(40, Math.min(240, v));
  notify();
}

export function setSwing(v) {
  swing = Math.max(0, Math.min(1, v));
  notify();
}

export function setQuantizeOn(on) {
  quantizeOn = !!on;
  notify();
}

export function setSeqIndex(i) {
  seqIndex = ((i % NSEQ) + NSEQ) % NSEQ;
  notify();
}

export function setNoteRepeat(on) {
  noteRepeat = !!on;
  if (!noteRepeat) heldRepeat.clear();
  notify();
}

export function setTriplet(on) {
  triplet = !!on;
  noteRepeatDiv = triplet ? (1 / 6) : 0.25; /* tresillo de colcheia vs 1/16 */
  notify();
}

export function setErase(on) {
  erase = !!on;
  notify();
}

export function setRecording(on) {
  recording = !!on;
  notify();
}

function beatDur() { return 60 / bpm; }

function loopBeats() {
  return seqs[seqIndex].bars * BEATS_PER_BAR;
}

function loopSteps() {
  return seqs[seqIndex].bars * STEPS_PER_BAR;
}

/* Quantize não destrutivo: o evento guarda o beat cru; na hora de
   tocar (e ao gravar, se TC ligado) aplicamos a grade + swing. */
export function applyTiming(beat) {
  let b = beat;
  if (quantizeOn && quantize > 0) {
    b = Math.round(beat / quantize) * quantize;
  }
  if (swing > 0) {
    const step = b / 0.25;
    const idx = Math.round(step);
    if (idx % 2 === 1) b += 0.25 * swing * 0.5;
  }
  return b;
}

export function projectSlice() {
  return {
    seqs: seqs.map((s) => ({ bars: s.bars, events: s.events.map((e) => ({ ...e })) })),
    seqIndex, bpm, swing, quantizeOn,
  };
}

export function loadProject(proj) {
  if (!proj) return;
  if (proj.seqs) {
    for (let i = 0; i < NSEQ; i++) {
      const s = proj.seqs[i];
      seqs[i] = s
        ? { bars: s.bars || 1, events: (s.events || []).map((e) => ({ ...e })) }
        : emptySeq();
    }
  }
  if (proj.seqIndex != null) seqIndex = proj.seqIndex;
  if (proj.bpm != null) bpm = proj.bpm;
  if (proj.swing != null) swing = proj.swing;
  if (proj.quantizeOn != null) quantizeOn = proj.quantizeOn;
}

/* ---------- gravação de eventos ---------- */
export function recordHit(bank, pad, vel, atBeat) {
  if (erase) {
    eraseNear(bank, pad, atBeat);
    return;
  }
  if (!recording) return;
  /* Guarda o beat cru: TC e swing só entram na reprodução. */
  const len = loopBeats();
  const b = ((atBeat % len) + len) % len;
  seqs[seqIndex].events.push({ beat: b, pad, bank, vel });
  notify();
}

function eraseNear(bank, pad, atBeat) {
  const len = loopBeats();
  const b = ((atBeat % len) + len) % len;
  const window = 0.2;
  seqs[seqIndex].events = seqs[seqIndex].events.filter((e) => {
    if (e.pad !== pad || e.bank !== bank) return true;
    let d = Math.abs(e.beat - b);
    d = Math.min(d, len - d);
    return d > window;
  });
  notify();
}

export function clearPadInSeq(bank, pad) {
  seqs[seqIndex].events = seqs[seqIndex].events.filter(
    (e) => !(e.pad === pad && e.bank === bank)
  );
  notify();
}

export function clearSeq() {
  seqs[seqIndex] = emptySeq();
  notify();
}

/* Step edit: liga/desliga evento na semicolcheia `step` para o pad. */
export function toggleStep(bank, pad, step, vel = 1) {
  const beat = step * 0.25;
  const list = seqs[seqIndex].events;
  const hit = list.findIndex(
    (e) => e.pad === pad && e.bank === bank && Math.abs(e.beat - beat) < 0.02
  );
  if (hit >= 0) list.splice(hit, 1);
  else list.push({ beat, pad, bank, vel });
  notify();
}

export function stepsForPad(bank, pad) {
  const out = new Array(loopSteps()).fill(false);
  for (const e of seqs[seqIndex].events) {
    if (e.pad !== pad || e.bank !== bank) continue;
    const s = Math.round(e.beat / 0.25) % out.length;
    out[s] = true;
  }
  return out;
}

/* Beat atual dentro do loop, derivado do AudioContext. */
export function currentBeat() {
  const ctx = getCtx();
  if (!ctx || !playing) return 0;
  const elapsed = ctx.currentTime - originTime;
  const beats = originBeat + elapsed / beatDur();
  const len = loopBeats();
  return ((beats % len) + len) % len;
}

/* ---------- clock ---------- */
function schedule() {
  const ctx = getCtx();
  if (!playing || !ctx) return;
  const len = loopBeats();
  const steps = loopSteps();
  const bd = beatDur();

  while (nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
    const rawBeat = originBeat + (nextTime - originTime) / bd;
    const beatInLoop = ((rawBeat % len) + len) % len;
    const step = Math.floor(beatInLoop / 0.25 + 1e-9) % steps;
    stepIndex = step;
    if (onStep) onStep(step);

    for (const e of seqs[seqIndex].events) {
      const tb = ((applyTiming(e.beat) % len) + len) % len;
      const eStep = Math.floor(tb / 0.25 + 1e-9) % steps;
      if (eStep === step) sampler.trigger(e.bank, e.pad, e.vel, nextTime);
    }

    for (const [pad, h] of heldRepeat) {
      if (h.local) continue;
      while (h.nextT <= nextTime + 1e-4) {
        sampler.trigger(h.bank, pad, h.vel, h.nextT);
        if (recording) {
          const b = originBeat + (h.nextT - originTime) / bd;
          recordHit(h.bank, pad, h.vel, ((b % len) + len) % len);
        }
        h.nextT += noteRepeatDiv * bd;
      }
    }

    nextTime += 0.25 * bd;
  }
}

export function play() {
  const ctx = getCtx();
  if (!ctx || playing) return;
  playing = true;
  stepIndex = 0;
  originTime = ctx.currentTime + 0.05;
  originBeat = 0;
  nextTime = originTime;
  timer = setInterval(schedule, LOOKAHEAD_MS);
  schedule();
  notify();
}

export function stop() {
  playing = false;
  recording = false;
  if (timer != null) clearInterval(timer);
  timer = null;
  heldRepeat.clear();
  stepIndex = 0;
  sampler.stopAll();
  notify();
}

export function realign() {
  if (!playing) return;
  const ctx = getCtx();
  if (!ctx) return;
  if (timer != null) clearInterval(timer);
  const beat = currentBeat();
  originTime = ctx.currentTime + 0.05;
  originBeat = beat;
  nextTime = originTime;
  timer = setInterval(schedule, LOOKAHEAD_MS);
}

/* Note repeat: começa a repetir este pad no clock. */
export function holdPad(bank, pad, vel) {
  if (!noteRepeat) return false;
  const ctx = getCtx();
  if (!ctx) return false;
  if (!playing) {
    /* Fora do play: dispara no rate com setInterval local */
    const bd = beatDur();
    sampler.trigger(bank, pad, vel);
    const id = setInterval(() => sampler.trigger(bank, pad, vel), noteRepeatDiv * bd * 1000);
    heldRepeat.set(pad, { bank, vel, nextT: Infinity, local: id });
    return true;
  }
  heldRepeat.set(pad, { bank, vel, nextT: ctx.currentTime });
  return true;
}

export function releasePad(pad) {
  const h = heldRepeat.get(pad);
  if (!h) return;
  if (h.local) clearInterval(h.local);
  heldRepeat.delete(pad);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') realign();
  });
}

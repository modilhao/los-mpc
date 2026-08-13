/* Tap: escuta a entrada, deixa o áudio passar e envia cópias em blocos.
   Serve ao microfone agora e à captura da master (resample, recall) depois.
   1024 quadros por bloco ≈ 23 ms: rápido o bastante para o threshold pegar
   o ataque de uma batida sem inundar a thread principal de mensagens. */
const BLOCK = 1024;

class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BLOCK);
    this.n = 0;
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    if (!inp || !inp[0]) return true;
    const ch = inp[0];
    const out = outputs[0];
    if (out && out[0]) out[0].set(ch);
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === BLOCK) {
        this.port.postMessage(this.buf.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('tap', Tap);

# Los Cabacitos MPC

Sampler / groovebox pra iPad: 16 pads, microfone, chop, sequenciador com note repeat e KNOB FX. Sem build, sem login.

**App:** [los-mpc.vercel.app](https://los-mpc.vercel.app)  
**Manual + tutoriais do repertório:** [docs/MANUAL.md](docs/MANUAL.md)

## Rodar local

```bash
python3 -m http.server 8765
```

Abrir <http://localhost:8765>. No iPad: Vercel + **Adicionar à Tela de Início** (HTTPS é obrigatório pro microfone).

## O que tem na v3.0.0

| | |
|---|---|
| SAMPLE | Gravação (MediaRecorder), importar, TRIM, 16 LEVELS, FULL LEVEL |
| Pads | 8 bancos × 16, choke, pitch, região start/end, velocidade por posição do dedo |
| SEQ | Overdub, TIME CORRECT, swing, note repeat, erase, step edit, 8 sequências |
| CHOP | Fatia por transiente e espalha nos pads |
| KNOB FX | Filtro, delay, crush, reverb |
| Persistência | IndexedDB (samples + projeto) · localStorage (sessão) |
| PWA | Service worker rede-primeiro, wake lock, safe-area |

## Arquivos

```
index.html      casca
css/app.css     tokens e layout
js/main.js      boot
js/audio.js     contexto, mic, FX, ciclo iOS
js/sampler.js   pads, vozes, chop
js/seq.js       sequenciador
js/store.js     IndexedDB
js/ui.js        painel
docs/MANUAL.md  manual de palco + ensaios
STACK.md        regras de ouro da família
```

## Família

- [Synth](https://github.com/modilhao/los-cabacitos-synth) — [prod](https://los-cabacitos-synth.vercel.app)
- [App de repertório](https://los-cabacitos-app.vercel.app)
- [MPC](https://github.com/modilhao/los-mpc) — [prod](https://los-mpc.vercel.app)

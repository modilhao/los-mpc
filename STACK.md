# Stack Los Cabacitos — instrumentos para iPad

Padrão reaproveitável dos apps da banda. Quem clona este kit já começa com o stack,
a paleta, o layout e as regras de áudio resolvidas.

Referência viva: [Los Cabacitos Synth](https://github.com/modilhao/los-cabacitos-synth)
(`Apps/Synth Los Cabacitos/pedaleira-app/`).

## Stack

| Camada | Escolha |
|---|---|
| UI + lógica | HTML / CSS / JS puro — um `index.html`, sem build |
| Áudio | Web Audio API; AudioWorklet quando precisar de amostra a amostra |
| Offline / palco | PWA: `sw.js` + `manifest.json` + `icon.svg` |
| Persistência | `localStorage` (knobs, presets, meta) + IndexedDB (samples, fita) |
| Deploy | Vercel estático (HTTPS é requisito de mic, SW e share) |
| Deps | Zero npm. Lib pequena, se inevitável, embutida em `lib/` |

O motivo do "sem build": no palco, o que quebra é a cadeia de ferramentas.
Um arquivo que abre no Safari não tem cadeia de ferramentas.

---

## Arquitetura de áudio

```
vozes (8, pré-alocadas)
  osc1 ──g1──┐
             ├── lowpass (envelope) ── amp ──┐
  osc2 ──g2──┘                               │
  modOsc ── modGain ── osc1.frequency        │  (FM)
                                             ▼
                                          busIn ── master
                                                     │
     DRIVE (waveshaper tanh) ── PHASER (4 allpass + LFO)
                                                     │
     ── DELAY de fita (lowpass no feedback) ── REVERB (convolução)
                                                     │
                                          compressor ── saída
```

FX é **global e pós-mixagem**: trocar de engine no meio da música não faz o clima do
efeito sumir. Bateria e sampler, quando existirem, entram na mesma cadeia.

---

## Regras de ouro do áudio

Estas não são preferências. Cada uma corresponde a um defeito audível que já apareceu.

### 1. Nunca atribua `.value` durante o som

`gain.value = x` é um degrau: produz *zipper noise* (clique / degrau audível).
Use sempre a agenda do AudioParam:

```js
node.gain.setTargetAtTime(alvo, ctx.currentTime, tau);   // suave, exponencial
node.gain.linearRampToValueAtTime(alvo, t + 0.02);       // rampa determinística
```

`.value` só é aceitável na construção do grafo, antes de qualquer nota.

### 2. Envelope sem degrau

Ataque e release nunca são instantâneos. Piso prático: **~4 ms** (`atk: 0.004`).
Abaixo disso o transiente vira clique, não percussão.
Para release, `setTargetAtTime(0, t, rel)` — o valor tende a zero exponencialmente
e nunca chega, o que é exatamente o que uma cauda natural faz.

### 3. Vozes pré-alocadas, grafo estável

Criar `OscillatorNode` por nota funciona no desktop e engasga no iPad.
Aloque `NVOICES` vozes no start, com osciladores rodando para sempre, e module
apenas ganho e frequência. *Voice stealing*: rouba a voz mais antiga (`stamp`),
com release rápido (4 ms) antes de reusar.

### 4. Timing é do relógio de áudio, nunca do relógio da UI

Sequencer, arpejador, clock: use **agendamento lookahead**.
`setInterval(25ms)` só decide o que agendar; quem toca é `ctx.currentTime + offset`.

```js
while (nextT < ctx.currentTime + 0.12) { agendar(nextT); nextT += passo; }
```

Assim o groove não treme quando a UI está ocupada desenhando.

### 5. `latencyHint: 'interactive'`

```js
new AudioContext({ latencyHint: 'interactive' })
```
Sem isso o navegador escolhe buffer grande e o instrumento fica "atrasado no dedo".

### 6. Headroom e limitador no fim da cadeia

Delay + reverb + polifonia somam rápido. Um `DynamicsCompressor` no fim
(`threshold -10, ratio 5, attack 2ms, release 120ms`) impede o clip digital,
que no iPad é feio e não avisa.

### 7. Volume é perceptual, não linear

Knob linear soa errado. Use curva quadrática ou dB:

```js
const volGain = (v) => Math.pow(v, 2) * 0.9;
```

### 8. AudioWorklet, nunca ScriptProcessor

`ScriptProcessor` roda na thread principal e é deprecado. Para captura de master,
pitch tracking ou DSP customizado: AudioWorklet em arquivo separado (`*-worklet.js`)
e lembre de listá-lo no `FILES` do service worker.

### 9. O AudioContext só nasce em gesto do usuário

E precisa ser retomado toda vez que o app volta do background — ver abaixo.

---

## Ciclo de vida no iOS (o bug que mata o show)

Safari suspende o `AudioContext` quando o app sai de foco. Sem tratamento, o som
simplesmente não volta.

```js
async function ensureAudioRunning(){
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') await ctx.resume();
  return ctx.state === 'running';
}
```

Chame em: `visibilitychange` (quando `visible`), `pageshow`, `focus`, e no
`statechange` do próprio contexto.

Ao voltar, além do resume:

- **BufferSources morrem no suspend** (tape, samples, loops) → reconstruir na posição atual
- **Sequencer com `setInterval`** → realinhar `nextT = ctx.currentTime + 0.06`,
  sem *catch-up* dos steps perdidos (senão vem uma rajada de notas)
- Repedir o **Wake Lock** de tela

---

## Persistência

| O quê | Onde | Quando salva |
|---|---|---|
| Knobs, presets, FX, sessão | `localStorage` (JSON) | na hora da mudança |
| Samples, fita, áudio longo | IndexedDB (`Float32` em RAM, `Int16` no disco) | punch-out e `pagehide` / `visibilitychange` hidden |

Slots **A–D** no estilo OP-1 / Volca. Sem nomes livres no MVP: no palco ninguém digita.

---

## Design system

### Tokens

Estão no `:root` do `index.html`. Não invente cor nova fora dali.

| Token | Valor | Uso |
|---|---|---|
| `--body` | `#e6e5e1` | fundo do aparelho (papel) |
| `--panel` | `#efeeea` | botões, pads, lanes |
| `--line` | `#c9c8c3` | borda padrão de 1.5px |
| `--ink` | `#2b2b28` | texto e estado ativo |
| `--dim` | `#8a8a84` | texto secundário |
| `--blue` | `#3d9bf2` | encoder 1 (CTRL) |
| `--green` | `#2fbf7b` | encoder 2 (PARAM) |
| `--white` | `#fafaf8` | encoder 3 (GLIDE) |
| `--orange` | `#ff7a1a` | encoder 4 (VOL); também tocando / gravado / playhead |
| `--screen` | `#1b1d1b` | display |
| `--screen-ink` | `#d8ffe8` | texto do display (fosforescente) |
| `--keyw` / `--keyb` | `#f7f6f3` / `#3a3a37` | teclas branca / preta |
| `--rec` | `#d94c4c` | gravação e ação destrutiva |

A ordem **azul · verde · branco · laranja** é a identidade do aparelho. Ela é a mesma
em todo app da banda — a memória muscular atravessa os instrumentos.

Cada engine tem cor própria (usada no número, no nome do display e no traço do
osciloscópio). Ao adicionar engines, puxe cores da mesma família:
`#7f8cf2` `#f2c94c` `#b48cf2` `#f28c9b` `#4cd9d9` `#e2589b`.

### Tipografia

Fonte do sistema (`-apple-system`). Rótulos sempre **maiúsculos, 800, `letter-spacing` alto**
(`.12em`–`.2em`), 9–12px. É a tipografia serigrafada de painel de equipamento.
Números que mudam ao vivo: `font-variant-numeric: tabular-nums`, senão o texto pula.

### Componentes

| Componente | Regra |
|---|---|
| `.btn` | 9px de raio, borda 1.5px, texto 10px/800; `.active` inverte para fundo `--ink` |
| `.engine` | bolinha colorida + sigla; `.sel` = borda `--ink` e fundo branco; `.pdot` laranja = preset salvo |
| `.knob` | SVG de 76px, arco de 270° começando em 135°; arrastar na **vertical**, 140px = curso completo |
| display | fundo `--screen`, canto arredondado, `box-shadow` interno; canvas do osciloscópio ao fundo, textos em camadas absolutas |
| teclas | posicionadas em `%` absoluto; pretas com `z-index:2` e 30% da altura |

### Layout

Coluna vertical: **marca + display → seletor de engine → encoders → superfície tocável**.
A superfície ocupa `flex:1` e é o único elemento elástico. `env(safe-area-inset-*)` no
padding para o notch. `overflow:hidden` no `body` e `touch-action:none` — nada de scroll
ou bounce debaixo do dedo.

---

## UX — o jeito Teenage Engineering / Volca

- **Uma caixa, uma ideia.** Se precisa de manual pra ligar, está errado.
- **Poucos knobs, modos contextuais.** Quatro encoders bastam: o botão FX remapeia os
  mesmos quatro. Não crie a quinta fileira de controles; crie um modo.
- **Superfícies exclusivas.** Sampler, bateria e fita disputam a mesma área e nunca
  aparecem juntas. FX não rouba o palco — só troca o significado dos knobs.
- **Tátil e imediato.** Sem login, sem splash, sem confirmação. Abriu, tocou.
- **Multitouch de verdade.** Pointer Events + `elementFromPoint` dão glissando ao arrastar,
  que é a diferença entre um teclado e um instrumento.
- **Estado sempre visível.** O display diz o que está soando, em que oitava, com que efeito.

---

## Limites conhecidos (iPad)

- Web Audio tem mais latência que app nativo — usável em ensaio e show, não em gravação crítica
- Memória do Safari: fita de 8×60s em float já são dezenas de MB; buffer reverso deve ser *lazy*
- **Web MIDI não existe no Safari do iPad** — só Chrome desktop ou o app "Web MIDI Browser"
- App web não toca com a tela bloqueada
- Loop de feedback do Web Audio tem mínimo de 128 samples: Karplus-Strong satura acima de ~F4
- Saída: cabo / interface USB (o Cube Baby serve). Evitar Bluetooth e AirPlay — latência

---

## Deploy

1. Repo próprio no GitHub por app
2. Vercel: Add New Project → framework **Other** → estático, sem build
3. `vercel.json` já impede o CDN de cachear o `sw.js` (senão o update nunca chega)
4. **Sempre bumpar `VERSION` no `sw.js`** a cada release; no iPad, recarregar 1×
5. Listar todo arquivo novo (worklets, manual) no `FILES` do `sw.js`

---

## Checklist — novo instrumento

1. `cp -R los-cabacitos-kit "Apps/Los Cabacitos — Nome"` e abrir como workspace próprio
2. Trocar `APP_ID`, `<title>`, `manifest.json`, nome do cache no `sw.js`
3. Reescrever a tabela `ENGINES` — é ali que o instrumento nasce
4. Ajustar a superfície tocável (teclado, pads, grade) mantendo os encoders
5. Repo GitHub + `vercel --prod`
6. Testar no iPad: tocar, sair e voltar do app, modo avião, Adicionar à Tela de Início
7. README com o que é, URLs (GitHub + prod) e o lembrete de bump do SW

## Referências

- [Guia do OP-1 — Teenage Engineering](https://teenage.engineering/guides/op-1)
- [Korg Volca](https://www.korg.com.br/busca/volca)
- [Web Audio API — MDN](https://developer.mozilla.org/pt-BR/docs/Web/API/Web_Audio_API)
- [A Tale of Two Clocks](https://web.dev/articles/audio-scheduling) — a fonte do agendamento lookahead

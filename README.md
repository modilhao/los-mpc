# Los Cabacitos Kit

Ponto de partida dos instrumentos da banda para iPad. Clonou, já tem um sintetizador
tocável: teclado polifônico multitouch, três engines de exemplo, quatro encoders
contextuais, display com osciloscópio, cadeia de efeitos e PWA offline.

A ideia não é usar este app — é apagar o que não serve e ficar com o esqueleto certo.

## Rodar

```bash
python3 -m http.server 8000
```

E abrir <http://localhost:8000>. Não há build, não há `npm install`.

No iPad: publicar na Vercel (HTTPS é requisito de service worker) e usar
**Compartilhar → Adicionar à Tela de Início**.

## O que já vem pronto

| | |
|---|---|
| Teclado | 2 oitavas cromáticas, 8 vozes, glide por dedo, glissando ao arrastar |
| Engines | `SUB` (sub-oitava), `DRONE` (saws desafinados), `FM` — exemplos dos dois modos de voz |
| Encoders | CTRL · PARAM · GLIDE · VOL; o botão **FX** remapeia os mesmos quatro para DELAY · PHASER · REVERB · DRIVE |
| FX | drive (tanh) → phaser (4 allpass) → delay de fita → reverb por convolução → compressor |
| Display | osciloscópio na cor do engine, notas soando, oitava, indicador de FX |
| Presets | um por engine (**SALVAR**; ponto laranja = salvo) |
| Persistência | knobs, presets, FX e sessão em `localStorage` |
| PWA | `sw.js` cache-first, manifest, ícone, safe-area, wake lock |
| iOS | resume do `AudioContext` ao voltar do background — sem isso o som some |

## Arquivos

```
index.html    o app inteiro: tokens de design + UI + motor de áudio
sw.js         service worker (bumpar VERSION a cada release)
manifest.json PWA
icon.svg      ícone
vercel.json   impede o CDN de cachear o sw.js
STACK.md      os padrões: regras de áudio, design system, UX, deploy
```

## Começando um projeto novo

```bash
cp -R ~/Apps/los-cabacitos-kit ~/Apps/"Los Cabacitos — Nome"
```

Depois, na ordem:

1. **Identidade** — `APP_ID` no `index.html`, `<title>`, `manifest.json`, nome do cache no `sw.js`
2. **Timbre** — reescrever a tabela `ENGINES` (seção 1 do script). É onde o instrumento nasce:
   cada entrada diz o timbre e o que os knobs CTRL e PARAM fazem
3. **Superfície** — o teclado é só uma das opções; pode virar pads, grade de steps, o que for
4. **Publicar** — repo no GitHub + Vercel (framework *Other*, estático)

Antes de mexer no áudio, ler as **regras de ouro** do [`STACK.md`](STACK.md).
São curtas e cada uma corresponde a um defeito audível que já apareceu em produção.

## Onde mexer no `index.html`

O script é dividido em nove seções numeradas:

| | |
|---|---|
| 1 | `ENGINES` — a tabela de timbres |
| 2 | estado e persistência |
| 3 | grafo de áudio (master + FX) |
| 4 | vozes: alocação, nota, glide, release |
| 5 | ciclo de vida no iOS |
| 6 | aplicar parâmetros |
| 7 | UI: engines, encoders, teclado |
| 8 | display |
| 9 | boot |

Na prática, um instrumento novo mexe em 1, 7 e um pouco de 3.

## Família

- [Los Cabacitos Synth](https://github.com/modilhao/los-cabacitos-synth) — [prod](https://los-cabacitos-synth.vercel.app)
- Los Cabacitos App (instrumento de repertório) — [prod](https://los-cabacitos-app.vercel.app)

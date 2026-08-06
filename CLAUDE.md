# Training Design — Design System

Stack standard: HTML5 (lang="it"), Tailwind CSS (CDN), p5.js (CDN), Lucide icons (CDN).

---

## Struttura file

```
project-name-main/
├── index.html
├── style.css          ← sempre style.css (non styles.css)
├── sketch.js          ← se usa p5.js
├── script.js          ← se non usa p5.js
└── worker.js          ← solo se serve Web Worker
```

---

## Design tokens

### Colori (usa classi Tailwind + valori hardcoded per CSS)
```
bg-neutral-950   #0a0a0a   ← sfondo body
bg-[#171717]     #171717   ← sfondo sidebar
neutral-800      #262626   ← bordi principali  
neutral-700      #404040   ← slider track, bordi input
neutral-600      #525252   ← hover scrollbar
neutral-500      #737373   ← testo muted
neutral-400      #a3a3a3   ← testo secondario, focus ring
neutral-200      #e5e5e5   ← testo principale
white            #ffffff   ← slider thumb, bottoni primari
```
Extend Tailwind sempre con: `neutral: { 850: '#1f1f1f', 950: '#0a0a0a' }`

### Tipografia
```
text-[10px]   valore slider / label parametro
text-xs       12px ← label sezione, tooltip
text-sm       14px ← testo UI base
text-base     16px ← titolo sidebar
font-mono tabular-nums ← valori numerici slider
```

### Easing / Animazioni
```css
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
transition: 0.2s ease    ← hover, color, opacity
transition: 0.3s var(--ease-out)  ← sidebar apri/chiudi
```

### Spacing
```
px-5 py-3.5   sezione sidebar header
px-5 pb-4     sezione sidebar body
gap-2         griglia controlli 2col
space-y-4     spacing tra gruppi controlli
p-4 / p-5     padding generici
```

---

## Componenti CSS (sempre in style.css)

### Base obbligatoria (copia da _design-system/base.css)
Includi sempre: reset box-sizing, scrollbar, slider, color-input, focus ring, select appearance, sidebar mobile, toast.

### Tailwind config (sempre nell'head)
```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: { neutral: { 850: '#1f1f1f', 950: '#0a0a0a' } }
      }
    }
  }
</script>
<script src="https://unpkg.com/lucide@latest"></script>
```

---

## Layout HTML

### Body
```html
<body class="bg-neutral-950 text-neutral-200 overflow-hidden text-sm font-sans flex flex-col md:flex-row h-screen antialiased selection:bg-neutral-700">
```

### Sidebar
```html
<div id="sidebarOverlay" class="sidebar-overlay md:hidden"></div>
<aside id="sidebar" class="w-80 flex-shrink-0 bg-[#171717] border-r border-neutral-800 flex flex-col h-full z-50 custom-scrollbar overflow-y-auto">
  <!-- header mobile -->
  <div class="md:hidden flex items-center justify-between p-4 border-b border-neutral-800">
    <h1 class="font-semibold">Impostazioni</h1>
    <button id="menuToggle" class="p-2 hover:bg-neutral-800 rounded-md"><i data-lucide="x" class="w-5 h-5"></i></button>
  </div>
  <!-- header desktop -->
  <div class="hidden md:block p-5 border-b border-neutral-800">
    <h1 class="font-bold text-base">NOME PROGETTO</h1>
  </div>
  <!-- sezioni -->
  <div class="flex-1 pb-10">
    <!-- usa <details> per sezioni collassabili -->
  </div>
</aside>
```

### Sezione collassabile (pattern preferito)
```html
<details class="group border-b border-neutral-800" open>
  <summary class="flex justify-between items-center px-5 py-3.5 cursor-pointer select-none font-medium hover:bg-neutral-800/50 transition-colors">
    <span>Titolo Sezione</span>
    <i data-lucide="chevron-down" class="w-4 h-4 text-neutral-500 transition-transform group-open:-rotate-180"></i>
  </summary>
  <div class="px-5 pb-4 space-y-4">
    <!-- controlli -->
  </div>
</details>
```

### Slider con label + valore
```html
<div class="space-y-1">
  <div class="flex justify-between items-center">
    <label class="text-[10px] text-neutral-500" for="sliderX">Label</label>
    <span id="valX" class="text-[10px] font-mono tabular-nums text-neutral-400">50</span>
  </div>
  <input id="sliderX" type="range" min="0" max="100" value="50" class="w-full">
</div>
```

### Bottone primario / secondario
```html
<!-- Primario -->
<button class="flex items-center justify-center gap-2 bg-neutral-200 text-black py-2 rounded-md font-medium hover:bg-white transition-colors">
  <i data-lucide="download" class="w-4 h-4"></i> Esporta
</button>
<!-- Secondario -->
<button class="flex items-center justify-center gap-2 border border-neutral-700 py-2 rounded-md hover:bg-neutral-800 transition-colors">
  Azione
</button>
```

### Canvas container
```html
<main class="flex-1 flex items-center justify-center bg-neutral-950 overflow-hidden relative">
  <div id="canvasWrap" class="relative shadow-2xl" style="outline: 1px solid #262626;">
    <!-- canvas p5 o 2d qui -->
  </div>
</main>
```

### Toast notification
```html
<div id="toast" class="fixed bottom-3.5 right-3.5 bg-neutral-800 border border-neutral-700 text-xs px-3 py-2 rounded-md z-50 pointer-events-none">
</div>
```

### Menu toggle (navbar mobile)
```html
<nav class="md:hidden flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-[#171717]">
  <span class="font-semibold text-sm">NOME PROGETTO</span>
  <button id="menuToggle" class="p-1.5 hover:bg-neutral-800 rounded-md"><i data-lucide="menu" class="w-5 h-5"></i></button>
</nav>
```

---

## Pattern JS

### Helper DOM
```js
const $ = id => document.getElementById(id);
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
```

### Params object (flat, non nested)
```js
const params = {
  mode: 'default',
  scale: 1,
  opacity: 100,
  color: '#ffffff',
  seed: 0
};
```

### Slider bind + value display
```js
on('sliderX', 'input', e => {
  params.x = +e.target.value;
  $('valX').textContent = params.x;
  redraw();
});
```

### Color picker sync
```js
function syncColor(pickerId, textId, paramKey) {
  const picker = $(pickerId), text = $(textId);
  picker.addEventListener('input', () => {
    text.value = picker.value;
    params[paramKey] = picker.value;
    redraw();
  });
  text.addEventListener('change', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(text.value)) {
      picker.value = text.value;
      params[paramKey] = text.value;
      redraw();
    }
  });
}
```

### Toast
```js
let _toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
```

### Sidebar toggle (in DOMContentLoaded)
```js
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = $('sidebar');
  const overlay = $('sidebarOverlay');
  function toggleMenu() {
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('active');
    document.body.classList.toggle('overflow-hidden');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
  }
  on('menuToggle', 'click', toggleMenu);
  overlay?.addEventListener('click', toggleMenu);
});
```

### Canvas fit (p5.js)
```js
function fitCanvas() {
  const wrap = document.getElementById('canvasWrap');
  const avW = wrap.parentElement.clientWidth - 48;
  const avH = wrap.parentElement.clientHeight - 48;
  const aspect = cw / ch;
  let dw = avW, dh = avW / aspect;
  if (dh > avH) { dh = avH; dw = avH * aspect; }
  resizeCanvas(dw | 0, dh | 0);
}
// In setup():
cnv = createCanvas(cw, ch);
cnv.parent('canvasWrap');
pixelDensity(1);
new ResizeObserver(() => fitCanvas()).observe(document.getElementById('canvasWrap').parentElement);
```

### Export PNG (p5.js)
```js
on('btnSave', 'click', () => {
  saveCanvas('export', 'png');
  toast('Immagine salvata');
});
```

### Random seed
```js
let seed = Math.floor(Math.random() * 99999);
// In draw/setup:
randomSeed(seed);
noiseSeed(seed);
// Button randomize:
on('btnRandom', 'click', () => { seed = Math.floor(Math.random() * 99999); redraw(); });
```

---

## Checklist fine progetto

Usa il prompt nella sezione **END-OF-PROJECT REVIEW** qui sotto.

---

## CDN versions

```
p5.js:   https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.2/p5.min.js
Tailwind: https://cdn.tailwindcss.com
Lucide:   https://unpkg.com/lucide@latest
Matter.js: https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js
JSZip:    https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
OpenCV:   https://docs.opencv.org/4.5.0/opencv.js
```

---

## END-OF-PROJECT REVIEW

Copia e incolla questo prompt a fine progetto per fare review completa:

```
Leggi il CLAUDE.md nella root di training-design per il design system di riferimento.
Poi esamina tutti i file di questo progetto (index.html, style.css, sketch.js/script.js).

Fai una review in 3 fasi:

## FASE 1 — Style audit
Controlla che il progetto rispetti il design system:
- Colori coerenti con i token (bg-neutral-950, #171717, ecc.)
- Tipografia corretta (text-[10px] per label slider, font-mono tabular-nums per valori)
- Struttura HTML sidebar corretta (details/summary, pattern slider)
- CSS in style.css include tutti i componenti base (slider, scrollbar, toast, sidebar mobile)
- Nomi file corretti: style.css, sketch.js o script.js
- Nessun inline style spurio che rompe la coerenza
Elenca ogni difformità trovata con file:riga e fix suggerito.

## FASE 2 — Bug check
Cerca:
- Event listener aggiunti senza null-check (element potrebbe non esistere)
- Memory leak: canvas/offscreen non distrutti, ResizeObserver non disconnessi
- Race condition: p5 draw() che usa variabili non ancora inizializzate
- DOM ID usati in JS ma non presenti in HTML (o viceversa)
- Slider i cui valori non vengono sincronizzati col display span
- Export functions che possono fallire silenziosamente
- Input file senza validazione tipo MIME
- Errori console (se puoi simulare il flusso)
Elenca ogni bug con file:riga, causa, fix.

## FASE 3 — Feature suggestions
Basandoti su cosa fa il progetto, suggerisci 3-5 funzionalità aggiuntive coerenti con lo scopo. 
Per ognuna: nome, cosa fa, perché è rilevante, complessità (bassa/media/alta).
Non aggiungere nulla di non richiesto — solo suggerisce, non implementa.

Dopo la review chiedi conferma prima di applicare qualsiasi modifica.
```

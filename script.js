/* ============================================================================
   RIPPLE STUDIO — contorni concentrici attorno a un testo o a un artwork.

   Come funziona, in breve:
     1. la sorgente viene rasterizzata in una maschera binaria
     2. dalla maschera si ricava un campo di distanza con segno (SDF)
     3. l'SDF viene sfocato: è questo che arrotonda gli angoli
     4. il fragment shader somma rumore all'SDF e lo taglia a fasce

   L'SDF si calcola una volta sola sulla CPU. Tutto ciò che si muove vive
   nello shader, così l'anteprima resta a 60 fps a piena risoluzione.

   Per modificarlo: quasi tutto quello che vorrai cambiare sta nel blocco
   CONFIG qui sotto. Il resto è diviso in sezioni numerate.
   ========================================================================= */

const CONFIG = {
  /* Font caricati da Google Fonts. Aggiungerne uno qui basta: il <link>
     e il menu a tendina si costruiscono da questa lista. */
  fonts: ['Bowlby One SC','Archivo Black','Anton','Bungee'],
  systemFonts: ['Impact'],

  formats: [[1080,1440,'3:4'],[1080,1080,'1:1'],[1080,1350,'4:5'],
            [1080,1920,'9:16'],[1920,1080,'16:9']],

  /* Oltre questo lato i buffer del campo di distanza superano il mezzo giga
     e la scheda si pianta: a 2048² siamo già a ~100 MB per Float64Array. */
  maxSide: 2048,

  /* Ritardi in ms: il campo di distanza costa qualche centinaio di
     millisecondi, quindi non va ricalcolato a ogni evento dello slider. */
  delays: { rebuild:90, text:220, blur:40 },

  presets: {
    'Onde morbide':{periodA:26,periodB:26,offset:26,clear:0,growth:0,smooth:16,
                    amp:26,warpAmp:26,scale:2.6,oct:3,pers:.5,mode:1,rings:1,drift:.35,loop:4},
    'Serigrafia'  :{periodA:9,periodB:22,offset:9,clear:8,growth:0,smooth:5,
                    amp:9,warpAmp:0,scale:5.5,oct:2,pers:.45,mode:1,rings:1,drift:.15,loop:3},
    'Ipnotico'    :{periodA:18,periodB:18,offset:18,clear:0,growth:-14,smooth:34,
                    amp:44,warpAmp:70,scale:1.6,oct:4,pers:.55,mode:3,rings:3,drift:.6,loop:5},
    'Topografico' :{periodA:5,periodB:34,offset:5,clear:24,growth:26,smooth:26,
                    amp:60,warpAmp:40,scale:1.1,oct:5,pers:.6,mode:3,rings:0,drift:.9,loop:8}
  }
};

/* i font del testo arrivano da Google Fonts, quelli dell'interfaccia da Tailwind */
(function loadFonts(){
  const link=document.createElement('link');
  link.rel='stylesheet';
  link.href='https://fonts.googleapis.com/css2?'+
    [...new Set(CONFIG.fonts)].map(f=>'family='+f.replace(/ /g,'+')).join('&')+'&display=swap';
  document.head.appendChild(link);
})();

/* ---------------------------------------------------------------- stato -- */
const P = {
  srcMode:'text', srcAlpha:'alpha', overlay:true,
  text:'CHI MI\nPRESENTI\n???', font:'Bowlby One SC', fontCustom:'',
  size:100, tracking:0, leading:88, rotate:0, padding:14,
  periodA:26, periodB:26, linked:true, offset:26, clear:0, growth:0, smooth:16,
  solid:true, invert:false,
  haloMode:'A', haloCol:'#ffffff', artMode:'orig', artCol:'#111111',
  amp:26, warpAmp:26, scale:2.6, oct:3, pers:.5, mode:1, seed:1234,
  colA:'#efc46b', colB:'#7089e0',
  W:1080, H:1440,
  loop:4, rings:1, drift:.35, dir:1,
  fps:30, vidFmt:'mp4', tol:1.2, smoothCurves:true
};

let ready=false, linkGuard=false, dirty=true;
const HEAVY=new Set(['size','tracking','leading','rotate','padding']);
const $=id=>document.getElementById(id);
const on=(id,ev,fn)=>{ const el=$(id); if(el) el.addEventListener(ev,fn); };
const touch=()=>{dirty=true;};
const clampSide=v=>Math.min(CONFIG.maxSide,Math.max(64,parseInt(v)||512));

/* ============================================================================
   0. COMPONENTI DI INTERFACCIA CONDIVISI
   ========================================================================= */
let _toastTimer;
function toast(msg){
  const t=$('toast');
  if(!t) return;
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}

/* la barra in basso porta lo stato tecnico, il toast le conferme */
const status=html=>{ const s=$('stat'); if(s) s.innerHTML=html; };
const busy=onOff=>{ const b=$('busyTag'); if(b) b.classList.toggle('hidden',!onOff); };
const icons=()=>{ if(window.lucide) lucide.createIcons(); };

/* ============================================================================
   1. INTERFACCIA
   ========================================================================= */
const S={};                       // slider registrati per chiave
const SEGS=[];                    // controlli segmentati registrati

function slider(host,key,label,min,max,step,fmt){
  if(!host) return null;
  const row=document.createElement('div');
  row.className='space-y-1';
  row.innerHTML=
    `<div class="flex justify-between items-center">`+
      `<label class="text-[10px] text-neutral-500">${label}</label>`+
      `<input class="val text-[10px] font-mono tabular-nums text-neutral-400" type="text" spellcheck="false">`+
    `</div>`+
    `<input type="range" min="${min}" max="${max}" step="${step}" class="w-full">`;
  const r=row.querySelector('input[type=range]'), n=row.querySelector('.val');
  const set=(v,from,silent)=>{
    v=Math.min(max,Math.max(min,+v)); P[key]=v;
    if(from!=='r') r.value=v;
    // il valore digitato viene sempre riscritto: se era fuori scala
    // la casella deve mostrare il valore realmente applicato
    n.value=fmt?fmt(v):v;
    if(!silent) onChange(key);
  };
  r.addEventListener('input',()=>set(r.value,'r'));
  n.addEventListener('change',()=>set(parseFloat(n.value)||0,'n'));
  n.addEventListener('blur',()=>{ n.value=fmt?fmt(P[key]):P[key]; });
  set(P[key],null,true); host.appendChild(row);
  S[key]={set:v=>set(v), sync:()=>set(P[key],null,true)};
  return S[key];
}

function segment(id,key,after){
  const el=$(id);
  if(!el) return null;
  SEGS.push({el,key});
  el.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b)return;
    const v=b.dataset.v;
    P[key]=(v!==''&&!isNaN(+v))?+v:v;
    syncSeg(el,key); touch();
    if(after)after();
  });
  return el;
}
function syncSeg(el,key){
  if(!el) return;
  el.querySelectorAll('button').forEach(b=>{
    const v=(b.dataset.v!==''&&!isNaN(+b.dataset.v))?+b.dataset.v:b.dataset.v;
    b.classList.toggle('on',v===P[key]);
  });
}

function onChange(key){
  touch();
  if(!ready) return;
  if(P.linked&&!linkGuard&&(key==='periodA'||key==='periodB')){
    linkGuard=true;
    (key==='periodA'?S.periodB:S.periodA).set(P[key]);
    linkGuard=false;
  }
  if(HEAVY.has(key)) scheduleRebuild();
  else if(key==='smooth') scheduleBlur();
}

/* --- menu costruiti da CONFIG --- */
(function buildMenus(){
  const f=$('font');
  for(const n of CONFIG.fonts) f.add(new Option(n,n));
  for(const n of CONFIG.systemFonts) f.add(new Option(n+' (sistema)',n));
  f.add(new Option('Carica un font dal computer…','__file'));
  f.add(new Option('Font installato sul sistema…','__custom'));
  f.value=P.font;

  const p=$('preset');
  for(const [w,h,r] of CONFIG.formats) p.add(new Option(`${w} × ${h} — ${r}`,w+','+h));
  p.add(new Option('Personalizzato…','custom'));

  const pb=$('presetBtns');
  for(const n of Object.keys(CONFIG.presets)){
    const b=document.createElement('button');
    b.className='border border-neutral-700 py-2 rounded-md hover:bg-neutral-800 transition-colors text-xs';
    b.textContent=n;
    b.addEventListener('click',()=>{ applyState(CONFIG.presets[n]); toast('Preset «'+n+'» applicato'); });
    pb.appendChild(b);
  }
})();

/* --- slider --- */
const shapeBody=$('shapeBody');
slider(shapeBody,'size','Dimensione %',10,200,1);
slider(shapeBody,'tracking','Spaziatura',-20,60,1);
slider(shapeBody,'leading','Interlinea %',50,180,1);
slider(shapeBody,'rotate','Rotazione °',-180,180,1);
slider(shapeBody,'padding','Margine %',0,45,1);

const bandsSliders=$('bandsSliders');
slider(bandsSliders,'periodA','Spessore A',2,220,1);
slider(bandsSliders,'periodB','Spessore B',2,220,1);
const linkRow=document.createElement('label');
linkRow.className='flex items-center gap-2 text-[10px] text-neutral-500 cursor-pointer hover:text-neutral-200 transition-colors';
linkRow.innerHTML='<input type="checkbox" id="linked" checked class="w-3.5 h-3.5 accent-neutral-200"><span>Collega spessori</span>';
bandsSliders.appendChild(linkRow);
slider(bandsSliders,'offset','Fase fasce',-200,300,1);
slider(bandsSliders,'clear','Distacco sagoma',0,240,1);
slider(bandsSliders,'growth','Crescita %',-40,120,1);
slider(bandsSliders,'smooth','Smussatura',0,90,1);

const wobBody=$('wobBody');
slider(wobBody,'amp','Ampiezza',0,220,1);
slider(wobBody,'warpAmp','Ampiezza warp',0,300,1);
slider(wobBody,'scale','Frequenza',.2,14,.05,v=>(+v).toFixed(2));
slider(wobBody,'oct','Ottave',1,6,1);
slider(wobBody,'pers','Persistenza',.1,.9,.01,v=>(+v).toFixed(2));
slider(wobBody,'seed','Seed',0,9999,1);

slider($('animBody'),'loop','Durata ciclo s',1,20,.5,v=>(+v).toFixed(1));
slider($('animBody'),'rings','Anelli per ciclo',0,8,1);
slider($('animBody'),'drift','Deriva rumore',0,3,.01,v=>(+v).toFixed(2));
slider($('vecBody'),'tol','Tolleranza px',.2,6,.1,v=>(+v).toFixed(1));
slider($('fpsBody'),'fps','Fotogrammi/s',12,60,1);

/* --- segmenti --- */
segment('segSrcMode','srcMode',()=>{
  $('textCtl').classList.toggle('hidden',P.srcMode!=='text');
  $('fileCtl').classList.toggle('hidden',P.srcMode!=='file');
  scheduleRebuild(0);
});
segment('segSrcAlpha','srcAlpha',()=>scheduleRebuild(0));
segment('segMode','mode');
segment('segVidFmt','vidFmt');
segment('segDir','dir');
segment('segHaloMode','haloMode',()=>{
  $('haloRow').classList.toggle('hidden',P.haloMode!=='custom');
  $('expHint').textContent = P.haloMode==='none'
    ? 'Il distacco trasparente resta nel PNG e nell\'SVG; MP4 e WebM non trasportano il canale alpha.'
    : 'Registra esattamente un ciclo, fotogramma per fotogramma.';
});
segment('segArtMode','artMode',()=>{
  $('artRow').classList.toggle('hidden',P.artMode!=='custom');
  tintKey='';
});

/* --- controlli semplici --- */
const bindCheck=(id,key,after)=>on(id,'change',e=>{
  P[key]=e.target.checked; touch(); if(after)after();
});
bindCheck('solid','solid');
bindCheck('invert','invert',()=>scheduleRebuild(0));
bindCheck('overlay','overlay');
bindCheck('smoothCurves','smoothCurves');
bindCheck('linked','linked');

const bindColor=(id,key,after)=>on(id,'input',e=>{
  P[key]=e.target.value; touch(); if(after)after();
});
bindColor('colA','colA',()=>tintKey='');
bindColor('colB','colB',()=>tintKey='');
bindColor('haloCol','haloCol');
bindColor('artCol','artCol',()=>tintKey='');

on('swap','click',()=>{
  [P.colA,P.colB]=[P.colB,P.colA];
  $('colA').value=P.colA; $('colB').value=P.colB; tintKey=''; touch();
});
on('text','input',e=>{P.text=e.target.value;scheduleRebuild(CONFIG.delays.text);});
on('fontCustom','input',e=>{P.fontCustom=e.target.value;scheduleRebuild(CONFIG.delays.text);});
on('preset','change',e=>{
  if(e.target.value==='custom')return;
  const [w,h]=e.target.value.split(',').map(Number);
  P.W=w;P.H=h;$('W').value=w;$('H').value=h;resize();
});
['W','H'].forEach(k=>on(k,'change',e=>{
  P[k]=clampSide(e.target.value);
  e.target.value=P[k]; syncPresetSelect(); resize();
}));
on('expSeed','click',()=>S.seed.set(Math.floor(Math.random()*9999)));

function syncPresetSelect(){
  const match=CONFIG.formats.find(([w,h])=>w===P.W&&h===P.H);
  $('preset').value=match?match[0]+','+match[1]:'custom';
}

/* tinte risolte */
const haloColor=()=>P.haloMode==='A'?P.colA:P.haloMode==='B'?P.colB:P.haloCol;
const artColor =()=>P.artMode==='A'?P.colA:P.artMode==='B'?P.colB:
                    P.artMode==='custom'?P.artCol:null;

/* --- stato serializzabile: preset, salvataggio, caricamento --- */
function applyState(obj){
  if(!obj||typeof obj!=='object') return;
  const W0=P.W, H0=P.H;
  linkGuard=true;
  for(const k in obj){
    if(!(k in P))continue;
    P[k]=(k==='W'||k==='H') ? clampSide(obj[k]) : obj[k];
  }
  linkGuard=false;
  syncUI();
  // il canvas va ridimensionato prima del rebuild, altrimenti il campo
  // viene calcolato al nuovo formato e disegnato su un canvas vecchio
  if(P.W!==W0||P.H!==H0) resize();
  else scheduleRebuild(0);
}
function syncUI(){
  for(const k in S) S[k].sync();
  for(const {el,key} of SEGS) syncSeg(el,key);
  for(const [id,k] of [['colA','colA'],['colB','colB'],['haloCol','haloCol'],['artCol','artCol']]) $(id).value=P[k];
  for(const [id,k] of [['solid','solid'],['invert','invert'],['overlay','overlay'],
                       ['smoothCurves','smoothCurves'],['linked','linked']]) $(id).checked=P[k];
  $('text').value=P.text; $('W').value=P.W; $('H').value=P.H;
  syncPresetSelect();
  if([...$('font').options].some(o=>o.value===P.font)) $('font').value=P.font;
  $('fontCustom').classList.toggle('hidden',P.font!=='__custom');
  $('haloRow').classList.toggle('hidden',P.haloMode!=='custom');
  $('artRow').classList.toggle('hidden',P.artMode!=='custom');
  $('textCtl').classList.toggle('hidden',P.srcMode!=='text');
  $('fileCtl').classList.toggle('hidden',P.srcMode!=='file');
  tintKey=''; touch();
}
on('cfgSave','click',()=>{
  save(new Blob([JSON.stringify(P,null,2)],{type:'application/json'}),`ripple_${Date.now()}.json`);
  toast('Impostazioni salvate');
});
on('cfgLoad','click',()=>$('cfgFile').click());
on('cfgFile','change',async e=>{
  const f=e.target.files[0];
  e.target.value='';                       // così ricaricare lo stesso file rifà partire l'evento
  if(!f)return;
  if(f.type&&f.type!=='application/json'&&!/\.json$/i.test(f.name)){
    status('<b class="text-neutral-200">non è un file JSON</b>'); return;
  }
  try{
    const obj=JSON.parse(await f.text());
    if(!obj||typeof obj!=='object'||Array.isArray(obj)) throw new Error('struttura inattesa');
    applyState(obj);
    toast('Impostazioni caricate');
  }
  catch(err){ status('<b class="text-neutral-200">JSON non valido</b> — '+err.message); }
});

/* ============================================================================
   2. SORGENTE — font, SVG, PNG
   ========================================================================= */
let userImg=null, userSVG=null, lastMask={cov:0,mode:'alpha'};
let localFonts=0;

/* Senza attendere il caricamento, il primo disegno userebbe il fallback e
   la sagoma verrebbe costruita sul font sbagliato. */
async function ensureFont(fam){
  if(!fam||!document.fonts||!document.fonts.load) return;
  try{ await document.fonts.load(`100px "${fam}"`); }catch(e){}
}
function activeFont(){
  return P.font==='__custom' ? (P.fontCustom||'sans-serif') : P.font;
}

/* Il CSS di Google Fonts può arrivare dopo il primo disegno: quando entra
   un font nuovo la sagoma va ricostruita, altrimenti resta sul fallback.
   Il confronto su size evita il rimbalzo infinito con ensureFont(). */
let fontsSeen=0;
if(document.fonts&&document.fonts.addEventListener){
  document.fonts.addEventListener('loadingdone',()=>{
    if(!ready||document.fonts.size===fontsSeen) return;
    fontsSeen=document.fonts.size;
    if(P.srcMode==='text') scheduleRebuild(0);
  });
}

on('font','change',async e=>{
  if(e.target.value==='__file'){ e.target.value=P.font; $('fontFile').click(); return; }
  P.font=e.target.value;
  $('fontCustom').classList.toggle('hidden',P.font!=='__custom');
  await ensureFont(activeFont());
  scheduleRebuild(0);
});

/* i font locali entrano via FontFace: nessuna rete, funziona anche offline */
on('fontFile','change',async e=>{
  const f=e.target.files[0];
  e.target.value='';
  if(!f)return;
  if(!/\.(ttf|otf|woff2?)$/i.test(f.name)&&!/^font\//.test(f.type||'')){
    status('<b class="text-neutral-200">formato font non supportato</b> — servono ttf, otf, woff o woff2'); return;
  }
  try{
    const name=(f.name.replace(/\.[^.]+$/,'')||'Locale')+' ·'+(++localFonts);
    const ff=new FontFace(name,await f.arrayBuffer());
    await ff.load();
    document.fonts.add(ff);
    fontsSeen=document.fonts.size;
    const sel=$('font');
    sel.add(new Option(name,name),sel.options[CONFIG.fonts.length+CONFIG.systemFonts.length]);
    sel.value=name; P.font=name;
    $('fontCustom').classList.add('hidden');
    scheduleRebuild(0);
    toast('Font caricato');
  }catch(err){ status('<b class="text-neutral-200">font non caricato</b> — '+err.message); }
});

on('pick','click',()=>$('file').click());

/* base64 a blocchi: String.fromCharCode(...array) esplode sui file grandi */
function b64(str){
  const bytes=new TextEncoder().encode(str);
  let out='';
  for(let i=0;i<bytes.length;i+=0x8000) out+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
  return btoa(out);
}
const readDataURL=f=>new Promise((res,rej)=>{
  const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f);
});

/* Molti SVG esportati non hanno width/height, o li hanno in percentuale:
   senza dimensioni intrinseche il browser li disegna a 300×150. */
function normalizeSVG(src){
  const doc=new DOMParser().parseFromString(src,'image/svg+xml');
  const svg=doc.documentElement;
  if(svg.nodeName!=='svg') return null;
  const num=a=>{const v=svg.getAttribute(a); if(!v||v.includes('%'))return null;
                const n=parseFloat(v); return isFinite(n)&&n>0?n:null;};
  let w=num('width'), h=num('height'), vb=svg.getAttribute('viewBox');
  if(vb){
    const p=vb.trim().split(/[\s,]+/).map(Number);
    if(p.length===4&&p[2]>0&&p[3]>0){ if(!w||!h){w=p[2];h=p[3];} } else vb=null;
  }
  if(!w||!h){w=1000;h=1000;}
  if(!vb){ vb=`0 0 ${w} ${h}`; svg.setAttribute('viewBox',vb); }
  svg.setAttribute('width',w); svg.setAttribute('height',h);
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  return {text:new XMLSerializer().serializeToString(svg),w,h,viewBox:vb};
}

const OK_IMG=/^image\/(svg\+xml|png|jpeg|webp)$/;

on('file','change',async e=>{
  const f=e.target.files[0];
  e.target.value='';                       // ricaricare lo stesso file deve rifunzionare
  if(!f)return;
  /* accept guida il dialogo ma non impedisce il drag o la scelta "tutti i
     file": il tipo va ricontrollato qui prima di darlo in pasto a Image */
  if(!OK_IMG.test(f.type||'')&&!/\.(svg|png|jpe?g|webp)$/i.test(f.name)){
    $('fileName').textContent='Formato non supportato: servono SVG, PNG, JPEG o WebP.'; return;
  }
  userSVG=null; userImg=null; tintKey='';
  $('fileName').textContent='Lettura…';
  let url;
  try{
    if(f.type==='image/svg+xml'||/\.svg$/i.test(f.name)){
      const raw=await f.text();
      userSVG=normalizeSVG(raw);
      if(!userSVG){ $('fileName').textContent='Non è un SVG valido: manca il tag <svg>.'; return; }
      /* data URL e non blob URL: aprendo il tool da file:// un blob
         "sporca" il canvas e getImageData verrebbe bloccato */
      url='data:image/svg+xml;base64,'+b64(userSVG.text);
    }else url=await readDataURL(f);
  }catch(err){ $('fileName').textContent='Lettura fallita: '+err.message; return; }

  const img=new Image();
  img.onload=()=>{
    userImg=img;
    const w=userSVG?userSVG.w:img.naturalWidth, h=userSVG?userSVG.h:img.naturalHeight;
    $('fileName').textContent=`${f.name} — ${Math.round(w)}×${Math.round(h)}`;
    scheduleRebuild(0);
  };
  img.onerror=()=>{
    $('fileName').textContent = userSVG
      ? 'SVG non renderizzabile: di solito dipende da font o immagini collegate dall\'esterno. Converti i testi in tracciati.'
      : 'Immagine non leggibile.';
  };
  img.src=url;
});

/* posizione dell'artwork — condivisa da maschera, anteprima ed export SVG */
function placement(){
  if(!userImg) return null;
  const iw=userSVG?userSVG.w:userImg.naturalWidth;
  const ih=userSVG?userSVG.h:userImg.naturalHeight;
  const pad=Math.min(P.W,P.H)*P.padding/100;
  const s=Math.min((P.W-pad*2)/iw,(P.H-pad*2)/ih)*(P.size/100);
  return {w:iw*s,h:ih*s,rot:P.rotate*Math.PI/180};
}

const maskCv=document.createElement('canvas');
const mctx=maskCv.getContext('2d',{willReadFrequently:true});

function buildMask(){
  const W=P.W,H=P.H;
  maskCv.width=W;maskCv.height=H;
  mctx.setTransform(1,0,0,1,0,0);
  mctx.clearRect(0,0,W,H);
  mctx.save();
  mctx.translate(W/2,H/2);
  mctx.rotate(P.rotate*Math.PI/180);
  mctx.fillStyle='#fff';

  let useLuma=false;
  if(P.srcMode==='file'&&userImg){
    const pl=placement();
    mctx.drawImage(userImg,-pl.w/2,-pl.h/2,pl.w,pl.h);
    useLuma=P.srcAlpha!=='alpha';
  }else if(P.srcMode==='text'){
    const fam=activeFont();
    const lines=P.text.split('\n').filter(l=>l.length);
    if(lines.length){
      const base=200, pad=Math.min(W,H)*P.padding/100;
      mctx.font=`${base}px "${fam}", sans-serif`;
      if('letterSpacing' in mctx) mctx.letterSpacing=`${P.tracking/100*base}px`;
      let widest=1;
      for(const l of lines) widest=Math.max(widest,mctx.measureText(l).width);
      const lh=P.leading/100;
      const fit=Math.min((W-pad*2)/widest*base,(H-pad*2)/(lines.length*lh)*0.78)*(P.size/100);
      mctx.font=`${fit}px "${fam}", sans-serif`;
      if('letterSpacing' in mctx) mctx.letterSpacing=`${P.tracking/100*fit}px`;
      mctx.textAlign='center'; mctx.textBaseline='middle';
      const step=fit*lh, total=step*(lines.length-1);
      lines.forEach((l,i)=>mctx.fillText(l,0,-total/2+i*step));
    }
  }
  mctx.restore();

  let d;
  try{ d=mctx.getImageData(0,0,W,H).data; }
  catch(err){ throw new Error('il browser ha bloccato la lettura del canvas. Ricarica la pagina e riprova.'); }

  const N=W*H;
  const extract=mode=>{
    const m=new Uint8Array(N); let cov=0;
    for(let i=0,p=0;i<N;i++,p+=4){
      let on;
      if(mode==='alpha') on=d[p+3]>127;
      else{
        const a=d[p+3]/255;
        const l=(d[p]*.299+d[p+1]*.587+d[p+2]*.114)*a+255*(1-a);   // composto su bianco
        on = mode==='dark' ? (l<128) : (l>=128&&d[p+3]>8);
      }
      if(on)cov++;
      m[i]=on?1:0;
    }
    return {m,cov:cov/N};
  };

  /* Un SVG con sfondo pieno dà copertura totale in modalità alpha, uno senza
     riempimenti dà copertura zero: in entrambi i casi esce una tinta piatta.
     Qui si prova l'alternativa e la barra di stato dice quale è stata usata. */
  let mode=useLuma?P.srcAlpha:'alpha';
  let r=extract(mode);
  if(P.srcMode==='file'&&userImg&&(r.cov<.0008||r.cov>.985)){
    for(const alt of ['dark','light','alpha']){
      if(alt===mode)continue;
      const t=extract(alt);
      if(t.cov>=.0008&&t.cov<=.985){ r=t; mode=alt; break; }
    }
  }
  lastMask={cov:r.cov,mode};
  if(P.invert) for(let i=0;i<N;i++) r.m[i]^=1;
  return r.m;
}

/* ============================================================================
   3. CAMPO DI DISTANZA — Felzenszwalb & Huttenlocher, O(n)
   I buffer sono riusati: a 1080×1440 ogni Float64Array pesa 12 MB e
   riallocarli a ogni ricalcolo faceva lavorare il garbage collector.
   ========================================================================= */
const INF=1e20;
const BUF={key:'',g:null,g2:null,f:null,d:null,v:null,z:null,a:null,b:null,tmp:null,rgba:null};

function buffers(W,H){
  const key=W+'x'+H;
  if(BUF.key===key) return BUF;
  const n=Math.max(W,H), N=W*H;
  Object.assign(BUF,{key,
    g:new Float64Array(N), g2:new Float64Array(N),
    f:new Float64Array(n), d:new Float64Array(n),
    v:new Int32Array(n),   z:new Float64Array(n+1),
    a:new Float32Array(N), b:new Float32Array(N),
    tmp:new Float32Array(N), rgba:new Float32Array(N*2)});
  return BUF;
}
function edt1d(f,d,v,z,n){
  let k=0; v[0]=0; z[0]=-INF; z[1]=INF;
  for(let q=1;q<n;q++){
    let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);
    while(s<=z[k]){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);}
    k++;v[k]=q;z[k]=s;z[k+1]=INF;
  }
  k=0;
  for(let q=0;q<n;q++){ while(z[k+1]<q)k++; const dq=q-v[k]; d[q]=dq*dq+f[v[k]]; }
}
function edt2d(bin,W,H,target,g,B){
  for(let i=0;i<g.length;i++) g[i]=(bin[i]===target)?0:INF;
  const {f,d,v,z}=B;
  for(let y=0;y<H;y++){
    const o=y*W;
    for(let x=0;x<W;x++)f[x]=g[o+x];
    edt1d(f,d,v,z,W);
    for(let x=0;x<W;x++)g[o+x]=d[x];
  }
  for(let x=0;x<W;x++){
    for(let y=0;y<H;y++)f[y]=g[y*W+x];
    edt1d(f,d,v,z,H);
    for(let y=0;y<H;y++)g[y*W+x]=d[y];
  }
  return g;
}
function buildSDF(mask,W,H){
  const B=buffers(W,H);
  const out=edt2d(mask,W,H,1,B.g,B);
  const ins=edt2d(mask,W,H,0,B.g2,B);
  const CAP=4096;   // maschera vuota o piena: senza tetto diventerebbe Infinity
  const s=B.a;
  for(let i=0;i<s.length;i++)
    s[i]=Math.max(-CAP,Math.min(CAP,Math.sqrt(out[i])-Math.sqrt(ins[i])));
  return s;
}
function boxBlur(src,dst,W,H,r,tmp){
  const inv=1/(r*2+1);
  for(let y=0;y<H;y++){
    const o=y*W; let acc=0;
    for(let i=-r;i<=r;i++) acc+=src[o+Math.min(W-1,Math.max(0,i))];
    for(let x=0;x<W;x++){ tmp[o+x]=acc*inv; acc+=src[o+Math.min(W-1,x+r+1)]-src[o+Math.max(0,x-r)]; }
  }
  for(let x=0;x<W;x++){
    let acc=0;
    for(let i=-r;i<=r;i++) acc+=tmp[Math.min(H-1,Math.max(0,i))*W+x];
    for(let y=0;y<H;y++){ dst[y*W+x]=acc*inv; acc+=tmp[Math.min(H-1,y+r+1)*W+x]-tmp[Math.max(0,y-r)*W+x]; }
  }
}
/* tre box blur ≈ una gaussiana, a costo lineare sul raggio */
function smoothSDF(src,W,H,radius){
  const B=buffers(W,H);
  if(radius<1){ B.b.set(src); return B.b; }
  const r=Math.max(1,Math.round(radius/3));
  let a=B.b, b=B.tmp;
  a.set(src);
  for(let i=0;i<3;i++){ boxBlur(a,b,W,H,r,B.g); const t=a;a=b;b=t; }
  return a;
}

/* ============================================================================
   4. WEBGL — tutto ciò che si muove
   ========================================================================= */
const cv=$('cv'), ctx=cv.getContext('2d');
const glcv=document.createElement('canvas');
const gl=glcv.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,
                                   alpha:true,premultipliedAlpha:false});
if(!gl) $('viewport').innerHTML='<p class="text-neutral-500 text-xs max-w-xs text-center leading-relaxed">Questo browser non espone WebGL2. Apri il file in Chrome, Edge, Firefox o Safari 15+.</p>';

const VS=`#version 300 es
in vec2 pos;
void main(){ gl_Position=vec4(pos,0.,1.); }`;

const FS=`#version 300 es
precision highp float;
uniform sampler2D uSDF;
uniform vec2  uRes;
uniform float uPA,uPB,uOffset,uClear,uGrowth,uPhase;
uniform float uAmp,uWarp,uScale,uOct,uPers,uSolid,uVec,uHaloA;
uniform int   uMode;
uniform vec2  uSeed,uNoise;
uniform vec3  uColA,uColB,uHalo;
out vec4 frag;

vec2 hash2(vec2 p){
  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));
  return -1.+2.*fract(sin(p)*43758.5453123);
}
float gnoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(dot(hash2(i),f),
                 dot(hash2(i+vec2(1.,0.)),f-vec2(1.,0.)),u.x),
             mix(dot(hash2(i+vec2(0.,1.)),f-vec2(0.,1.)),
                 dot(hash2(i+vec2(1.,1.)),f-vec2(1.,1.)),u.x),u.y);
}
float fbm(vec2 p){
  float a=1.,s=0.,n=0.;
  for(int i=0;i<6;i++){
    if(float(i)>=uOct) break;
    s+=a*gnoise(p); n+=a; a*=uPers; p*=2.02;
  }
  return s/max(n,1e-5);
}

void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 tuv=vec2(uv.x,1.-uv.y);                  // il campo arriva top-down
  vec2 np=vec2(uv.x*uRes.x/uRes.y,uv.y)*uScale+uSeed+uNoise;

  vec2 samp=tuv;
  if(uMode>=2){                                 // domain warp
    vec2 w=vec2(fbm(np),fbm(np+vec2(37.4,11.9)));
    samp+=w*uWarp/uRes;
  }
  float d=texture(uSDF,clamp(samp,0.,1.)).r;
  if(uMode==1||uMode==3) d+=fbm(np+vec2(5.3,9.1))*uAmp;
  float raw=texture(uSDF,tuv).g;                // sagoma non deformata

  // il distacco spinge fuori tutto il pattern: nessuna fascia
  // può entrare nella zona franca attorno all'artwork
  float dd=d-uClear-uOffset;

  float per=max(uPA+uPB,.5);
  float duty=uPA/per;
  float g=1.+uGrowth*.01;
  float k;
  if(abs(g-1.)<.002) k=dd/per;
  else{
    float x=1.+dd*(g-1.)/per;
    k = x>1e-4 ? log(x)/log(g) : dd/per;        // spessore progressivo, invertito
  }
  k-=uPhase;

  float f=fract(k);
  float aa=clamp(fwidth(k),1e-4,.5);            // antialias continuo
  float v=clamp(smoothstep(duty-aa,duty+aa,f)-smoothstep(1.-aa,1.,f),0.,1.);

  float ins=0.;
  if(uSolid>.5 || uClear>.5) ins=1.-smoothstep(-.7,.7,raw-uClear);
  v*=(1.-ins);

  // R = fasce, G = zona di distacco: due campi per la vettorializzazione
  if(uVec>.5){ frag=vec4(v,ins,0.,1.); return; }

  // se il distacco è trasparente non si ricolora, così il bordo sfuma
  // verso il vuoto invece di lasciare un alone della tinta
  vec3 col=mix(mix(uColA,uColB,v),uHalo,ins*uHaloA);
  frag=vec4(col,mix(1.,uHaloA,ins));
}`;

let prog,U={},tex,sdfRaw=null,internalFmt=null;

function compile(type,src){
  const s=gl.createShader(type);
  gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function initGL(){
  prog=gl.createProgram();
  gl.attachShader(prog,compile(gl.VERTEX_SHADER,VS));
  gl.attachShader(prog,compile(gl.FRAGMENT_SHADER,FS));
  gl.bindAttribLocation(prog,0,'pos');
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  ['uSDF','uRes','uPA','uPB','uOffset','uClear','uGrowth','uPhase','uAmp','uWarp',
   'uScale','uOct','uPers','uSolid','uVec','uHaloA','uMode','uSeed','uNoise',
   'uColA','uColB','uHalo'].forEach(n=>U[n]=gl.getUniformLocation(prog,n));
  tex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.uniform1i(U.uSDF,0);
}
/* R = distanza smussata (fasce), G = distanza netta (sagoma) */
function upload(sm,raw){
  if(internalFmt===null)
    internalFmt = gl.getExtension('OES_texture_float_linear') ? gl.RG32F : gl.RG16F;
  const B=buffers(P.W,P.H), n=P.W*P.H, buf=B.rgba;
  for(let i=0;i<n;i++){ buf[i*2]=sm[i]; buf[i*2+1]=raw[i]; }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,internalFmt,P.W,P.H,0,gl.RG,gl.FLOAT,buf);
  touch();
}

const hex=h=>[1,3,5].map(i=>parseInt(h.substr(i,2),16)/255);

function drawGL(t,vecPass){
  if(!prog)return;
  gl.viewport(0,0,P.W,P.H);
  gl.uniform2f(U.uRes,P.W,P.H);
  gl.uniform1f(U.uPA,P.periodA);      gl.uniform1f(U.uPB,P.periodB);
  gl.uniform1f(U.uOffset,P.offset);   gl.uniform1f(U.uClear,P.clear);
  gl.uniform1f(U.uGrowth,P.growth);   gl.uniform1f(U.uPhase,t*P.rings*P.dir);
  gl.uniform1f(U.uAmp,P.amp);         gl.uniform1f(U.uWarp,P.warpAmp);
  gl.uniform1f(U.uScale,P.scale);     gl.uniform1f(U.uOct,P.oct);
  gl.uniform1f(U.uPers,P.pers);       gl.uniform1f(U.uSolid,P.solid?1:0);
  gl.uniform1f(U.uVec,vecPass?1:0);   gl.uniform1f(U.uHaloA,P.haloMode==='none'?0:1);
  gl.uniform1i(U.uMode,P.mode);
  gl.uniform2f(U.uSeed,(P.seed%97)*3.7,(P.seed%53)*5.1);
  // il rumore percorre un cerchio: il ciclo si richiude esattamente
  gl.uniform2f(U.uNoise,Math.cos(t*6.28318)*P.drift,Math.sin(t*6.28318)*P.drift);
  gl.uniform3fv(U.uColA,hex(P.colA));
  gl.uniform3fv(U.uColB,hex(P.colB));
  gl.uniform3fv(U.uHalo,hex(haloColor()));
  gl.drawArrays(gl.TRIANGLES,0,3);
}

/* l'artwork ricolorato viene messo in cache: source-in riempie di tinta
   piatta tutto ciò che è opaco, conservando l'alpha originale */
let tintCv=null,tintKey='';
function tintedArt(pl){
  const col=artColor();
  if(!col) return userImg;
  const w=Math.max(1,Math.round(pl.w)), h=Math.max(1,Math.round(pl.h));
  const key=col+'|'+w+'x'+h;
  if(tintKey===key&&tintCv) return tintCv;
  if(!tintCv) tintCv=document.createElement('canvas');   // riusato: uno nuovo per frame satura la memoria video
  tintCv.width=w; tintCv.height=h;
  const c=tintCv.getContext('2d');
  c.clearRect(0,0,w,h);
  c.globalCompositeOperation='source-over';
  c.drawImage(userImg,0,0,w,h);
  c.globalCompositeOperation='source-in';
  c.fillStyle=col; c.fillRect(0,0,w,h);
  tintKey=key;
  return tintCv;
}
function render(t){
  drawGL(t,false);
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,P.W,P.H);          // il distacco può essere trasparente
  ctx.drawImage(glcv,0,0);
  if(P.srcMode==='file'&&P.overlay&&userImg){
    const pl=placement();
    ctx.save();
    ctx.translate(P.W/2,P.H/2); ctx.rotate(pl.rot);
    ctx.drawImage(tintedArt(pl),-pl.w/2,-pl.h/2,pl.w,pl.h);
    ctx.restore();
  }
}

/* ============================================================================
   5. PIPELINE E TIMELINE
   ========================================================================= */
let rebuildTimer=null, blurTimer=null, rebuilding=false, rebuildAgain=false;

function scheduleRebuild(ms){
  clearTimeout(rebuildTimer);
  rebuildTimer=setTimeout(rebuild, ms===undefined?CONFIG.delays.rebuild:ms);
}
function scheduleBlur(){
  clearTimeout(blurTimer);
  blurTimer=setTimeout(()=>{
    if(!sdfRaw||sdfRaw.length!==P.W*P.H)return;   // formato cambiato: aspetta il rebuild
    upload(smoothSDF(sdfRaw,P.W,P.H,P.smooth),sdfRaw);
  },CONFIG.delays.blur);
}
async function rebuild(){
  if(!ready)return;
  if(rebuilding){ rebuildAgain=true; return; }
  rebuilding=true;
  if(P.srcMode==='text') await ensureFont(activeFont());
  const t0=performance.now();
  try{
    sdfRaw=buildSDF(buildMask(),P.W,P.H);
    upload(smoothSDF(sdfRaw,P.W,P.H,P.smooth),sdfRaw);
    const ms=Math.round(performance.now()-t0);
    if(P.srcMode==='file'&&!userImg){
      // senza sorgente il campo è vuoto e l'anteprima resta una tinta piatta:
      // senza questo messaggio sembra che il tool si sia rotto
      status('nessun file caricato — usa <b class="text-neutral-200">Carica SVG o PNG</b>');
    }else if(P.srcMode==='file'){
      const label={alpha:'alpha',dark:'zone scure',light:'zone chiare'}[lastMask.mode];
      let warn='';
      if(lastMask.cov<.0008) warn=' — <b class="text-neutral-200">sagoma vuota</b>';
      else if(lastMask.cov>.985) warn=' — <b class="text-neutral-200">sagoma piena</b>: l\'SVG ha uno sfondo opaco';
      status(`sagoma <b class="text-neutral-200">${(lastMask.cov*100).toFixed(1)}%</b> · ${label} · ${ms} ms${warn}`);
      P.srcAlpha=lastMask.mode; syncSeg($('segSrcAlpha'),'srcAlpha');
    }else status(`campo ricalcolato in <b class="text-neutral-200">${ms} ms</b>`);
  }catch(e){ status('<b class="text-neutral-200">errore</b> — '+e.message); }
  rebuilding=false;
  if(rebuildAgain){ rebuildAgain=false; rebuild(); }
}
function resize(){
  cv.width=P.W; cv.height=P.H;
  glcv.width=P.W; glcv.height=P.H;
  // il wrapper porta il rapporto: così il canvas sta nella viewport
  // senza deformarsi e senza percentuali che non si risolvono
  const wrap=$('canvasWrap');
  if(wrap) wrap.style.aspectRatio=P.W+' / '+P.H;
  tintKey=''; touch();
  scheduleRebuild(0);
}

let playing=true,t0=performance.now(),tNorm=0,recording=false;
function setPlayIcon(){
  // il bottone mostra l'azione, non lo stato: mentre scorre si vede "pausa"
  $('play').innerHTML=`<i data-lucide="${playing?'pause':'play'}" class="w-3.5 h-3.5"></i>`;
  icons();
}
on('play','click',()=>{
  playing=!playing;
  setPlayIcon();
  if(playing) t0=performance.now()-tNorm*P.loop*1000;
  touch();
});
on('scrub','input',e=>{
  // l'icona si ridisegna solo alla transizione: rifarla a ogni evento
  // dello scrub rigenererebbe un SVG per fotogramma di trascinamento
  if(playing){ playing=false; setPlayIcon(); }
  tNorm=e.target.value/1000; touch();
});

const elScrub=$('scrub'), elTStat=$('tStat');

/* Se nulla si muove e nulla è cambiato non si ridisegna: a schermo fermo
   il tool non tiene occupata la GPU. */
function frame(){
  requestAnimationFrame(frame);
  if(recording) return;
  const moving = playing && (P.rings>0 || P.drift>0);
  if(!moving && !dirty) return;
  if(playing){ tNorm=((performance.now()-t0)/1000/P.loop)%1; elScrub.value=tNorm*1000; }
  elTStat.textContent=(tNorm*P.loop).toFixed(2)+' s';
  render(tNorm);
  dirty=false;
}

/* ============================================================================
   6. VETTORIALIZZAZIONE — marching squares + Douglas–Peucker
   ========================================================================= */

/* Il campo viene circondato da un bordo a zero: così ogni contorno si chiude
   dentro la griglia invece di restare una spezzata aperta, che verrebbe poi
   richiusa da una diagonale in mezzo all'immagine. Il bordo cade appena
   fuori dalla viewBox e resta invisibile. */
function scalarField(){
  drawGL(tNorm,true);
  const W=P.W,H=P.H,GW=W+2,GH=H+2;
  const px=new Uint8Array(W*H*4);
  gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
  const fv=new Float32Array(GW*GH), fi=new Float32Array(GW*GH);
  for(let y=0;y<H;y++){                       // readPixels è bottom-up
    const src=(H-1-y)*W*4, dst=(y+1)*GW+1;
    for(let x=0;x<W;x++){
      fv[dst+x]=px[src+x*4]/255;              // fasce
      fi[dst+x]=px[src+x*4+1]/255;            // distacco
    }
  }
  return {fv,fi,GW,GH};
}

/* chiavi numeriche invece che stringhe: sui campi fitti i segmenti sono
   centinaia di migliaia e l'hashing di stringhe dominava il tempo */
const KOFF=16, KQ=8;
const ptKey=p=>Math.round((p[0]+KOFF)*KQ)*1000000+Math.round((p[1]+KOFF)*KQ);

function marchingSquares(f,W,H,level){
  const segs=[];
  const at=(x,y)=>f[y*W+x];
  const mid=(a,b)=>{const t=(level-a)/(b-a); return (t>=0&&t<=1)?t:.5;};
  const ox=-1, oy=-1;                          // compensa il bordo di padding
  for(let y=0;y<H-1;y++){
    for(let x=0;x<W-1;x++){
      const tl=at(x,y),tr=at(x+1,y),br=at(x+1,y+1),bl=at(x,y+1);
      let c=0;
      if(tl>level)c|=8; if(tr>level)c|=4; if(br>level)c|=2; if(bl>level)c|=1;
      if(c===0||c===15)continue;
      const T=[x+mid(tl,tr)+ox,y+oy],   R=[x+1+ox,y+mid(tr,br)+oy],
            B=[x+mid(bl,br)+ox,y+1+oy], L=[x+ox,y+mid(tl,bl)+oy];
      switch(c){
        case 1: case 14: segs.push([L,B]); break;
        case 2: case 13: segs.push([B,R]); break;
        case 3: case 12: segs.push([L,R]); break;
        case 4: case 11: segs.push([T,R]); break;
        case 6: case  9: segs.push([T,B]); break;
        case 7: case  8: segs.push([T,L]); break;
        case 5:  segs.push([T,L],[B,R]); break;   // sella
        case 10: segs.push([T,R],[L,B]); break;
      }
    }
  }
  const ends=new Map();
  for(let i=0;i<segs.length;i++){
    for(const p of segs[i]){
      const k=ptKey(p);
      const e=ends.get(k);
      if(e) e.push(i); else ends.set(k,[i]);
    }
  }
  const used=new Uint8Array(segs.length), loops=[];
  for(let i=0;i<segs.length;i++){
    if(used[i])continue;
    used[i]=1;
    const pts=[segs[i][0],segs[i][1]];
    const extend=()=>{
      for(;;){
        const tail=pts[pts.length-1];
        const cand=ends.get(ptKey(tail));
        let moved=false;
        if(cand) for(const j of cand){
          if(used[j])continue;
          const sg=segs[j];
          pts.push(ptKey(sg[0])===ptKey(tail)?sg[1]:sg[0]);
          used[j]=1; moved=true; break;
        }
        if(!moved)return;
      }
    };
    extend();                 // avanti
    pts.reverse();
    extend();                 // e all'indietro, per le spezzate iniziate a metà
    if(pts.length>3) loops.push(pts);
  }
  return loops;
}

function dp(pts,tol){
  if(pts.length<3)return pts;
  const keep=new Uint8Array(pts.length);
  keep[0]=keep[pts.length-1]=1;
  const stack=[[0,pts.length-1]];
  while(stack.length){
    const [a,b]=stack.pop();
    if(b<=a+1)continue;
    const ax=pts[a][0],ay=pts[a][1],bx=pts[b][0],by=pts[b][1];
    const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
    // su un anello chiuso primo e ultimo punto coincidono: la distanza
    // dalla retta è degenere, si usa quella radiale
    const deg=len<1e-6;
    let best=-1,bd=tol;
    for(let i=a+1;i<b;i++){
      const d=deg ? Math.hypot(pts[i][0]-ax,pts[i][1]-ay)
                  : Math.abs(dy*pts[i][0]-dx*pts[i][1]+bx*ay-by*ax)/len;
      if(d>bd){bd=d;best=i;}
    }
    if(best>0){ keep[best]=1; stack.push([a,best],[best,b]); }
  }
  const out=[];
  for(let i=0;i<pts.length;i++) if(keep[i]) out.push(pts[i]);
  return out;
}

const n1=v=>Math.round(v*10)/10;
function pathFromLoop(pts,smooth){
  const closed=Math.hypot(pts[0][0]-pts[pts.length-1][0],pts[0][1]-pts[pts.length-1][1])<1.5;
  if(closed) pts=pts.slice(0,-1);
  if(pts.length<3)return '';
  if(!smooth){
    let d='M'+n1(pts[0][0])+' '+n1(pts[0][1]);
    for(let i=1;i<pts.length;i++) d+='L'+n1(pts[i][0])+' '+n1(pts[i][1]);
    return d+'Z';
  }
  const n=pts.length, g=i=>pts[(i%n+n)%n];     // Catmull-Rom → bezier cubiche
  let d='M'+n1(g(0)[0])+' '+n1(g(0)[1]);
  for(let i=0;i<n;i++){
    const p0=g(i-1),p1=g(i),p2=g(i+1),p3=g(i+2);
    const c1=[p1[0]+(p2[0]-p0[0])/6, p1[1]+(p2[1]-p0[1])/6];
    const c2=[p2[0]-(p3[0]-p1[0])/6, p2[1]-(p3[1]-p1[1])/6];
    d+='C'+n1(c1[0])+' '+n1(c1[1])+','+n1(c2[0])+' '+n1(c2[1])+','+n1(p2[0])+' '+n1(p2[1]);
  }
  return d+'Z';
}
function traceToPath(f,GW,GH){
  let d='';
  for(const l of marchingSquares(f,GW,GH,.5)){
    const sm=dp(l,P.tol);
    if(sm.length>2) d+=pathFromLoop(sm,P.smoothCurves);
  }
  return d;
}

/* ricolora un SVG annidato: le tinte esplicite vengono riscritte, i "none"
   restano tali per non chiudere le controforme */
function tintSVGNode(el,col){
  const fix=n=>{
    for(const a of ['fill','stroke']){
      const v=n.getAttribute&&n.getAttribute(a);
      if(v&&v.trim().toLowerCase()!=='none') n.setAttribute(a,col);
    }
    const st=n.getAttribute&&n.getAttribute('style');
    if(st) n.setAttribute('style',st.replace(/(fill|stroke)\s*:\s*([^;]+)/gi,
      (m,prop,val)=>/none/i.test(val)?m:prop+':'+col));
  };
  el.querySelectorAll('*').forEach(fix);
  if((el.getAttribute('fill')||'').trim().toLowerCase()==='none') el.removeAttribute('fill');
}

function buildSVG(){
  const {fv,fi,GW,GH}=scalarField();
  const bands=traceToPath(fv,GW,GH);
  const halo=(P.solid||P.clear>.5) ? traceToPath(fi,GW,GH) : '';

  let over='';
  if(P.srcMode==='file'&&P.overlay&&userSVG){
    const pl=placement();
    // l'SVG originale resta annidato e vettoriale, quindi editabile
    const doc=new DOMParser().parseFromString(userSVG.text,'image/svg+xml');
    const el=doc.documentElement;
    el.setAttribute('x',n1(-pl.w/2)); el.setAttribute('y',n1(-pl.h/2));
    el.setAttribute('width',n1(pl.w)); el.setAttribute('height',n1(pl.h));
    el.setAttribute('viewBox',userSVG.viewBox);
    const col=artColor();
    if(col) tintSVGNode(el,col);
    over=`\n  <g transform="translate(${P.W/2} ${P.H/2}) rotate(${n1(P.rotate)})">`+
         new XMLSerializer().serializeToString(el)+`</g>`;
  }

  const bg=`<rect width="${P.W}" height="${P.H}" fill="${P.colA}"/>`;
  const bandPath=`<path fill="${P.colB}" fill-rule="evenodd" d="${bands}"/>`;
  let core;
  if(P.haloMode==='none'&&halo){
    // distacco trasparente: la zona franca va bucata, non ridipinta
    core=`<mask id="ripple-halo" maskUnits="userSpaceOnUse" x="0" y="0" width="${P.W}" height="${P.H}">
    <rect width="${P.W}" height="${P.H}" fill="#fff"/>
    <path fill="#000" fill-rule="evenodd" d="${halo}"/>
  </mask>
  <g mask="url(#ripple-halo)">
    ${bg}
    ${bandPath}
  </g>`;
  }else{
    // se il distacco è già del colore di fondo il tracciato è superfluo
    const haloPath=(halo&&P.haloMode!=='A')
      ? `\n  <path fill="${haloColor()}" fill-rule="evenodd" d="${halo}"/>` : '';
    core=`${bg}\n  ${bandPath}${haloPath}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${P.W}" height="${P.H}" viewBox="0 0 ${P.W} ${P.H}">
  ${core}${over}
</svg>`;
}

/* ============================================================================
   7. EXPORT
   ========================================================================= */
function save(blob,name){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
on('expPng','click',()=>{
  render(tNorm);
  cv.toBlob(b=>{
    // toBlob passa null se il browser non ce la fa: senza questo controllo
    // il fallimento sarebbe muto
    if(!b){ status('<b class="text-neutral-200">export PNG fallito</b> — prova un formato più piccolo'); return; }
    save(b,`ripple_${Date.now()}.png`);
    toast('PNG esportato');
  },'image/png');
});
on('expSvg','click',()=>{
  busy(true); $('expSvg').disabled=true;
  setTimeout(()=>{                                  // lascia ridisegnare la UI
    const t=performance.now();
    try{
      const svg=buildSVG();
      save(new Blob([svg],{type:'image/svg+xml'}),`ripple_${Date.now()}.svg`);
      status(`SVG tracciato in <b class="text-neutral-200">${Math.round(performance.now()-t)} ms</b> · ${Math.round(svg.length/1024)} KB`);
      toast('SVG esportato');
    }catch(e){ status('<b class="text-neutral-200">errore SVG</b> — '+e.message); }
    busy(false); $('expSvg').disabled=false;
    touch();
  },30);
});

const MIME={
  mp4:['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1','video/mp4'],
  webm:['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

on('expVid','click',async()=>{
  if(!window.MediaRecorder||!cv.captureStream){
    $('expHint').textContent='Questo browser non espone MediaRecorder: usa Chrome, Edge o Safari aggiornati.'; return;
  }
  let type=MIME[P.vidFmt].find(m=>MediaRecorder.isTypeSupported(m)), fellBack=false;
  if(!type&&P.vidFmt==='mp4'){ type=MIME.webm.find(m=>MediaRecorder.isTypeSupported(m)); fellBack=true; }
  if(!type){ $('expHint').textContent='Nessun codec video disponibile in questo browser.'; return; }

  const ext=type.startsWith('video/mp4')?'mp4':'webm';
  const fps=Math.round(P.fps), total=Math.max(2,Math.round(P.loop*fps));
  let stream=cv.captureStream(0);                   // solo frame richiesti a mano
  let track=stream.getVideoTracks()[0];
  /* requestFrame non c'è ovunque: senza, si torna alla cattura automatica,
     che rende un ciclo meno preciso ma non lascia il file vuoto */
  let grab;
  if(track&&typeof track.requestFrame==='function') grab=()=>track.requestFrame();
  else if(typeof stream.requestFrame==='function')  grab=()=>stream.requestFrame();
  else{
    stream.getTracks().forEach(t=>t.stop());
    stream=cv.captureStream(fps);
    grab=()=>{};
  }

  const chunks=[];
  const rec=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:24e6});
  rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);

  recording=true; playing=false;
  setPlayIcon(); $('expVid').disabled=true; busy(true);

  /* Tutto in try/finally: se un frame o il recorder saltano, la UI deve
     comunque tornare utilizzabile invece di restare bloccata in "lavoro". */
  try{
    rec.start();
    const start=performance.now();
    for(let i=0;i<total;i++){
      render(i/total);
      grab();                                        // un frame reso = un frame scritto
      $('scrub').value=i/total*1000;
      status(`registrazione <b class="text-neutral-200">${i+1}/${total}</b>`);
      await wait(Math.max(0,start+(i+1)*1000/fps-performance.now()));
    }
    await wait(120);
    if(rec.state!=='inactive'){
      const stopped=new Promise(r=>{ rec.onstop=r; });
      rec.stop();
      await stopped;
    }
    if(!chunks.length) throw new Error('nessun dato registrato');
    save(new Blob(chunks,{type}),`ripple_${Date.now()}.${ext}`);
    status(`${total} fotogrammi · <b class="text-neutral-200">${ext.toUpperCase()}</b>`);
    toast('Video esportato');
    if(fellBack) $('expHint').textContent='MP4 non disponibile qui: salvato in WebM. Prova con Chrome o Safari aggiornati.';
  }catch(err){
    try{ if(rec.state!=='inactive') rec.stop(); }catch(e){}
    status('<b class="text-neutral-200">registrazione fallita</b> — '+err.message);
  }finally{
    stream.getTracks().forEach(t=>t.stop());
    recording=false; playing=true; t0=performance.now(); touch();
    setPlayIcon(); $('expVid').disabled=false; busy(false);
  }
});

/* ============================================================================
   8. SIDEBAR MOBILE E AVVIO
   ========================================================================= */
document.addEventListener('DOMContentLoaded',()=>{
  const sidebar=$('sidebar');
  const overlay=$('sidebarOverlay');
  function toggleMenu(){
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('active');
    document.body.classList.toggle('overflow-hidden');
    setTimeout(()=>window.dispatchEvent(new Event('resize')),300);
  }
  on('menuToggle','click',toggleMenu);
  on('menuClose','click',toggleMenu);
  overlay?.addEventListener('click',toggleMenu);
});

if(gl){
  initGL();
  cv.width=P.W; cv.height=P.H;
  glcv.width=P.W; glcv.height=P.H;
  $('canvasWrap').style.aspectRatio=P.W+' / '+P.H;
  setPlayIcon();
  icons();
  const go=async()=>{
    ready=true;
    fontsSeen=document.fonts?document.fonts.size:0;
    await ensureFont(activeFont());
    rebuild(); frame();
  };
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(go).catch(go); else go();
}else{
  icons();
}

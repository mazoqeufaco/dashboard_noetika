// entrada.js
// ES module com: initEntrada(opts) e computeZFromCSV(csvText, {r,g,b}, headerMap?)

const DEFAULTS = {
  canvasId: 'tri',
  imgSrc: 'public/triangulo.png',     // troque para seu arquivo
  labels: { R: 'Custo', G: 'Qualidade', B: 'Prazo' },
  stepPercent: 0.5,                   // passo inputs
  vertexToChannel: ['B','R','G'],     // [top,left,right] -> canais
  ui: {
    titleSelector: 'h1',
    rSel: '#r', gSel: '#g', bSel: '#b',
    confirmBtnSel: '#confirm',
    confirmDlgSel: '#confirmDlg',
    confirmDlgTextSel: '#dlgText',
    confirmOkSel: '#dlgOk',
    confirmResetSel: '#dlgReset'
  }
};

/** Utils geom */
function area(ax,ay,bx,by,cx,cy){ return (bx-ax)*(cy-ay) - (cx-ax)*(by-ay); }
function barycentric(px, py, A,B,C){
  const denom = area(A.x,A.y, B.x,B.y, C.x,C.y);
  const w1 = area(px,py, B.x,B.y, C.x,C.y) / denom; // top
  const w2 = area(px,py, C.x,C.y, A.x,A.y) / denom; // left
  const w3 = 1 - w1 - w2;                           // right
  return [w1,w2,w3];
}
function inside([w1,w2,w3], tol=1e-4){ return w1>=-tol && w2>=-tol && w3>=-tol; }

function baryToRGB([wt, wl, wr], vertexToChannel){
  const map = {'R':0,'G':1,'B':2};
  const out = [0,0,0]; const w = [wt, wl, wr];
  vertexToChannel.forEach((label,i)=>{ out[map[label]] = w[i]; });
  const s = Math.max(out[0]+out[1]+out[2], 1e-12);
  return [out[0]/s, out[1]/s, out[2]/s];
}
function rgbToBary([r,g,b], vertexToChannel){
  const labelVal = {'R':r,'G':g,'B':b};
  return [
    labelVal[vertexToChannel[0]], // top
    labelVal[vertexToChannel[1]], // left
    labelVal[vertexToChannel[2]]  // right
  ];
}

function norm3p(r,g,b){ const s = Math.max(r+g+b, 1e-12); return [r/s*100, g/s*100, b/s*100]; }
function clamp01p(v){ return Math.max(0, Math.min(100, v)); }

/** Detecta vértices por alpha (robusto a antialias) em uma imagem já desenhada no offscreen */
function detectVerticesByAlpha(img, fitW, fitH){
  const off = document.createElement('canvas');
  off.width = fitW; off.height = fitH;
  const octx = off.getContext('2d');
  octx.drawImage(img, 0, 0, fitW, fitH);
  const {data} = octx.getImageData(0,0,fitW,fitH);

  const pts = [];
  const TH = 8; // alpha threshold
  for(let y=0;y<fitH;y++){
    for(let x=0;x<fitW;x++){
      const a = data[(y*fitW + x)*4 + 3];
      if(a >= TH) pts.push({x,y});
    }
  }
  if(!pts.length){
    return { top:{x:fitW/2,y:0}, left:{x:0,y:fitH-1}, right:{x:fitW-1,y:fitH-1} };
  }
  const extremeWithBand = (points, key, chooseMin=true, band=2)=>{
    const vals = points.map(p=>p[key]);
    const extreme = chooseMin ? Math.min(...vals) : Math.max(...vals);
    const bandPts = points.filter(p=>Math.abs(p[key]-extreme)<=band);
    if(key==='y'){ // topo: menor y → x mais central
      const cx = bandPts.reduce((s,p)=>s+p.x,0)/bandPts.length;
      return bandPts.reduce((best,p)=>Math.abs(p.x-cx)<Math.abs(best.x-cx)?p:best, bandPts[0]);
    }
    // esquerda/direita: preferir maior y (base)
    return bandPts.reduce((best,p)=>p.y>best.y?p:best, bandPts[0]);
  };
  const top  = extremeWithBand(pts, 'y', true,  2);
  const left = extremeWithBand(pts, 'x', true,  2);
  const right= extremeWithBand(pts, 'x', false, 2);
  return { top, left, right };
}

/** Desenha a cena (fundo, imagem e ponto) */
function drawScene(ctx, canvas, img, imgRect, pointXY){
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img, imgRect.x, imgRect.y, imgRect.w, imgRect.h);
  if(pointXY){
    const [x,y] = pointXY;
    ctx.fillStyle = '#fff'; ctx.strokeStyle='#000'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(x,y,7,0,Math.PI*2); ctx.fill(); ctx.stroke();
  }
}

/** initEntrada: monta tudo e retorna API */
export async function initEntrada(options = {}) {
  const cfg = { ...DEFAULTS, ...options, ui: { ...DEFAULTS.ui, ...(options.ui||{}) } };
  const canvas = document.getElementById(cfg.canvasId);
  const ctx = canvas.getContext('2d');
  const rEl = document.querySelector(cfg.ui.rSel);
  const gEl = document.querySelector(cfg.ui.gSel);
  const bEl = document.querySelector(cfg.ui.bSel);
  const confirmBtn = document.querySelector(cfg.ui.confirmBtnSel);
  const dlg = document.querySelector(cfg.ui.confirmDlgSel);
  const dlgText = document.querySelector(cfg.ui.confirmDlgTextSel);
  const dlgOk = document.querySelector(cfg.ui.confirmOkSel);
  const dlgReset = document.querySelector(cfg.ui.confirmResetSel);

  // Estado
  let rgb = [1/3,1/3,1/3];
  let Vtop, Vleft, Vright, imgRect;
  const img = new Image();
  await new Promise((res, rej)=>{ img.onload=res; img.onerror=rej; img.src = cfg.imgSrc; });

  // Fit imagem no canvas
  const padTop = 10, padBottom = 10;
  const maxW = canvas.width - 40;
  const maxH = canvas.height - padTop - padBottom;
  const scale = Math.min(maxW/img.width, maxH/img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const x = Math.floor((canvas.width - w)/2);
  const y = padTop;
  imgRect = {x,y,w,h};

  // Detecta vértices por alpha
  const verts = detectVerticesByAlpha(img, w, h);
  Vtop   = { x: x + verts.top.x,  y: y + verts.top.y };
  Vleft  = { x: x + verts.left.x, y: y + verts.left.y };
  Vright = { x: x + verts.right.x,y: y + verts.right.y };

  // Helpers de desenho
  const drawFromRGB = (arr)=>{
    const [wt,wl,wr] = rgbToBary(arr, cfg.vertexToChannel);
    const px = wt*Vtop.x + wl*Vleft.x + wr*Vright.x;
    const py = wt*Vtop.y + wl*Vleft.y + wr*Vright.y;
    drawScene(ctx, canvas, img, imgRect, [px,py]);
  };
  const setPerc = (r,g,b, draw=true)=>{
    rEl.value = r.toFixed(2); gEl.value = g.toFixed(2); bEl.value = b.toFixed(2);
    rgb = [r/100, g/100, b/100];
    if(draw) drawFromRGB(rgb);
  };
  // inicial
  setPerc(33.3333,33.3333,33.3333);

  // Auto-balance proporcional
  function rebalance(focus, newVal){
    let r = parseFloat(rEl.value)||0, g = parseFloat(gEl.value)||0, b = parseFloat(bEl.value)||0;
    [r,g,b] = norm3p(r,g,b);
    newVal = clamp01p(newVal);
    if(focus==='R'){ const rem=g+b, k=rem? (100-newVal)/rem : 0.5; g*=k; b*=k; r=newVal; }
    else if(focus==='G'){ const rem=r+b, k=rem? (100-newVal)/rem : 0.5; r*=k; b*=k; g=newVal; }
    else { const rem=r+g, k=rem? (100-newVal)/rem : 0.5; r*=k; g*=k; b=newVal; }
    const total = r+g+b;
    if(Math.abs(total-100)>0.001){
      if(focus!=='R') r*=100/total;
      if(focus!=='G') g*=100/total;
      if(focus!=='B') b*=100/total;
    }
    setPerc(r,g,b);
  }

  // Eventos inputs
  ['input','change'].forEach(evt=>{
    rEl.addEventListener(evt, ()=>rebalance('R', parseFloat(rEl.value)||0));
    gEl.addEventListener(evt, ()=>rebalance('G', parseFloat(gEl.value)||0));
    bEl.addEventListener(evt, ()=>rebalance('B', parseFloat(bEl.value)||0));
  });

  // Clique no triângulo
  canvas.addEventListener('click', (ev)=>{
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const wts = barycentric(mx,my, Vtop,Vleft,Vright);
    if(!inside(wts)){ setPerc(0,0,0); return; }
    const [r,g,b] = baryToRGB(wts, cfg.vertexToChannel);
    setPerc(r*100, g*100, b*100);
  });

  // Modal Ok/Redefinir e callback externo (onConfirm)
  let onConfirm = null; // (r,g,b) => Promise|void
  confirmBtn.addEventListener('click', ()=>{
    const [r,g,b] = rgb;
    dlgText.textContent =
      `Suas prioridades de seleção da solução:\n\n`+
      `${(r*100).toFixed(2)}% de peso para custo anual,\n`+
      `${(g*100).toFixed(2)}% de qualidade (aderência a seus requisitos) e\n`+
      `${(b*100).toFixed(2)}% para prazo.`;
    dlg.showModal();
    const ok = ()=>{ dlg.close(); onConfirm && onConfirm({r,g,b}); cleanup(); };
    const re = ()=>{ dlg.close(); cleanup(); };
    function cleanup(){ dlgOk.removeEventListener('click', ok); dlgReset.removeEventListener('click', re); }
    dlgOk.addEventListener('click', ok);
    dlgReset.addEventListener('click', re);
  });

  // Primeira render
  drawFromRGB(rgb);

  return {
    /** lê o estado atual (0..1) */
    getRGB: ()=>({ r: rgb[0], g: rgb[1], b: rgb[2] }),
    /** seta um callback para o Ok (recebe {r,g,b}) */
    onConfirm: (fn)=>{ onConfirm = fn; },
    /** atualiza a imagem (se precisar trocar PNG depois) */
    _replaceImage: async (src)=>{ /* opcional */ }
  };
}

/* -------------------- CSV & Zranking -------------------- */

/** Parser CSV simples (header obrigatório). Retorna {header:[...], rows:[{col:value}...]} */
export function parseCSV(text, sep=','){
  // detecta separador ; ou , de forma best-effort
  if(text.indexOf(';')>-1 && text.indexOf(',')===-1) sep=';';
  const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim().length>0);
  if(lines.length===0) return { header:[], rows:[] };
  const header = lines[0].split(sep).map(h=>h.trim());
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split(sep);
    const obj = {};
    for(let j=0;j<header.length;j++){
      obj[header[j]] = (cols[j]??'').trim();
    }
    rows.push(obj);
  }
  return { header, rows };
}

/**
 * computeZFromCSV:
 * - csvText: conteúdo bruto do CSV
 * - weights: {r,g,b} em 0..1
 * - headerMap (opcional): mapeia seus nomes para os esperados
 *   { ZCusto, ZQualidade, ZPrazo, s_Zcusto, s_ZQual, s_ZPrazo, id? }
 * Retorna: [{ id?, Zranking, s_Zrank }, ...]
 */
export function computeZFromCSV(csvText, {r,g,b}, headerMap){
  const { header, rows } = parseCSV(csvText);
  const norm = s => s.toLowerCase().replace(/\s+/g,'');
  // nomes padrão
  const defaults = {
    ZCusto: 'ZCusto',
    ZQualidade: 'ZQualidade',
    ZPrazo: 'ZPrazo',
    s_Zcusto: 's_Zcusto',
    s_ZQual: 's_ZQual',
    s_ZPrazo: 's_ZPrazo',
    id: null
  };
  const map = Object.assign({}, defaults, headerMap||{});

  // tenta resolver nomes por aproximação simples se não vierem no headerMap
  const resolve = (want) => {
    if(map[want] && header.includes(map[want])) return map[want];
    // busca heurística
    const aliases = {
      ZCusto:    ['zcusto','zcost'],
      ZQualidade:['zqualidade','zqual','zquality'],
      ZPrazo:    ['zprazo','zdeadline','ztime'],
      s_Zcusto:  ['s_zcusto','szcusto','s_zcost'],
      s_ZQual:   ['s_zqual','s_zqualidade','szqual'],
      s_ZPrazo:  ['s_zprazo','szprazo','s_ztime'],
      id:        ['id','nome','alternativa','opcao','item']
    }[want] || [];
    for(const h of header){
      const k = norm(h);
      if(aliases.some(a=>k.includes(a))) return h;
    }
    return map[want]; // pode ficar null (id)
  };

  const H = {
    ZC: resolve('ZCusto'),
    ZQ: resolve('ZQualidade'),
    ZP: resolve('ZPrazo'),
    sC: resolve('s_Zcusto'),
    sQ: resolve('s_ZQual'),
    sP: resolve('s_ZPrazo'),
    ID: resolve('id')
  };

  // valida mínimos
  const needed = [H.ZC,H.ZQ,H.ZP,H.sC,H.sQ,H.sP];
  if(needed.some(x=>!x || !header.includes(x))){
    throw new Error('CSV não contém todas as colunas necessárias (ZCusto, ZQualidade, ZPrazo, s_Zcusto, s_ZQual, s_ZPrazo). Use headerMap se os nomes diferirem.');
  }

  // computa
  const out = rows.map((row, idx)=>{
    const zc = parseFloat(row[H.ZC].replace(',', '.')) || 0;
    const zq = parseFloat(row[H.ZQ].replace(',', '.')) || 0;
    const zp = parseFloat(row[H.ZP].replace(',', '.')) || 0;
    const sc = parseFloat(row[H.sC].replace(',', '.')) || 0;
    const sq = parseFloat(row[H.sQ].replace(',', '.')) || 0;
    const sp = parseFloat(row[H.sP].replace(',', '.')) || 0;

    // Zranking = ( -r*ZCusto + g*ZQualidade - b*ZPrazo )
    const Zranking = (-r*zc) + (g*zq) + (-b*zp);

    // s_Zrank = sqrt( (r*sZc)^2 + (g*sZq)^2 + (b*sZp)^2 )
    const s_Zrank = Math.sqrt( (r*sc)**2 + (g*sq)**2 + (b*sp)**2 );

    const id = H.ID ? row[H.ID] : (idx+1);
    return { id, Zranking, s_Zrank };
  });
  return out;
}

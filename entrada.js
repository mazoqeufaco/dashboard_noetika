// entrada.js — triângulo PNG com clique/arraste + auto-balance + modal Ok/Redefinir
export const DEFAULTS = {
  canvasId: 'tri',
  imgSrc: 'public/triangulo2.png',
  vertexToChannel: ['B','R','G'], // [top,left,right] -> B,R,G (Prazo, Custo, Qualidade)
  ui: {
    rSel: '#r', gSel: '#g', bSel: '#b',
    confirmBtnSel: '#confirm',
    confirmDlgSel: '#confirmDlg', confirmDlgTextSel: '#dlgText',
    confirmOkSel: '#dlgOk', confirmResetSel: '#dlgReset'
  }
};

const area=(ax,ay,bx,by,cx,cy)=>(bx-ax)*(cy-ay)-(cx-ax)*(by-ay);
function barycentric(px,py,A,B,C){ const d=area(A.x,A.y,B.x,B.y,C.x,C.y);
  const w1=area(px,py,B.x,B.y,C.x,C.y)/d, w2=area(px,py,C.x,C.y,A.x,A.y)/d, w3=1-w1-w2; return [w1,w2,w3]; }
const inside=(w,t=1e-6)=>w[0]>=t&&w[1]>=t&&w[2]>=t;
const norm3p=(r,g,b)=>{const s=Math.max(r+g+b,1e-12);return [r/s*100,g/s*100,b/s*100];};
const clamp01p=v=>Math.max(0,Math.min(100,v));
function baryToRGB([wt,wl,wr], map){ const idx={'R':0,'G':1,'B':2}, out=[0,0,0], w=[wt,wl,wr];
  map.forEach((lab,i)=>out[idx[lab]]=w[i]); const s=Math.max(out[0]+out[1]+out[2],1e-12);
  return [out[0]/s,out[1]/s,out[2]/s]; }
function rgbToBary([r,g,b], map){ const val={'R':r,'G':g,'B':b}; return [val[map[0]],val[map[1]],val[map[2]]]; }

function detectVerticesByAlpha(img,w,h){
  const off=document.createElement('canvas'); off.width=w; off.height=h;
  const octx=off.getContext('2d'); octx.drawImage(img,0,0,w,h);
  const {data}=octx.getImageData(0,0,w,h);
  const pts=[]; const TH=30; // Threshold menor para capturar mais pixels
  
  // Procura em toda a área da imagem
  for(let y=0;y<h;y++) {
    for(let x=0;x<w;x++){
      const alpha = data[(y*w+x)*4+3];
      if(alpha>=TH) pts.push({x,y});
    }
  }
  
  if(!pts.length) return {top:{x:w/2,y:0},left:{x:0,y:h-1},right:{x:w-1,y:h-1}};
  
  const extreme=(key,min=true,band=3)=>{
    const vs=pts.map(p=>p[key]); const ex=min?Math.min(...vs):Math.max(...vs);
    const sel=pts.filter(p=>Math.abs(p[key]-ex)<=band);
    if(key==='y'){ const cx=sel.reduce((s,p)=>s+p.x,0)/sel.length;
      return sel.reduce((b,p)=>Math.abs(p.x-cx)<Math.abs(b.x-cx)?p:b,sel[0]); }
    return sel.reduce((b,p)=>p.y>b.y?p:b,sel[0]);
  };
  return { top:extreme('y',true), left:extreme('x',true), right:extreme('x',false) };
}

function drawScene(ctx, canvas, img, rect, point){
  ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,rect.x,rect.y,rect.w,rect.h);
  if(point){
    ctx.fillStyle='#fff'; ctx.strokeStyle='#000'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(point[0],point[1],8,0,Math.PI*2); ctx.fill(); ctx.stroke();
  }
}

export async function initEntrada(opts={}){
  const cfg={...DEFAULTS,...opts, ui:{...DEFAULTS.ui, ...(opts.ui||{})}};
  const canvas=document.getElementById(cfg.canvasId);
  const ctx=canvas.getContext('2d');
  const rEl=document.querySelector(cfg.ui.rSel);
  const gEl=document.querySelector(cfg.ui.gSel);
  const bEl=document.querySelector(cfg.ui.bSel);
  const btn=document.querySelector(cfg.ui.confirmBtnSel);
  const dlg=document.querySelector(cfg.ui.confirmDlgSel);
  const dlgText=document.querySelector(cfg.ui.confirmDlgTextSel);
  const dlgOk=document.querySelector(cfg.ui.confirmOkSel);
  const dlgReset=document.querySelector(cfg.ui.confirmResetSel);

  const img=new Image();
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=cfg.imgSrc; });

  const padTop=30,padBottom=30; // Padding equilibrado
  const maxW=canvas.width-40, maxH=canvas.height-padTop-padBottom;
  const scale=Math.min(maxW/img.width, maxH/img.height) * 0.7; // 70% do box inteiro
  const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
  const x=Math.floor((canvas.width-w)/2);
  // Posiciona o triângulo um pouco mais para baixo para equilibrar espaçamentos
  const y=padTop + Math.floor((canvas.height - padTop - padBottom - h) * 0.5);
  const rect={x,y,w,h};

  const v=detectVerticesByAlpha(img,w,h);
  const Vtop={x:x+v.top.x,y:y+v.top.y};
  const Vleft={x:x+v.left.x,y:y+v.left.y};
  const Vright={x:x+v.right.x,y:y+v.right.y};

  let rgb=[1/3,1/3,1/3]; let dragging=false;

  const drawFromRGB=()=>{ const [wt,wl,wr]=rgbToBary(rgb,cfg.vertexToChannel);
    const px=wt*Vtop.x+wl*Vleft.x+wr*Vright.x, py=wt*Vtop.y+wl*Vleft.y+wr*Vright.y;
    drawScene(ctx,canvas,img,rect,[px,py]); };

  function setPerc(r,g,b,draw=true){
    rEl.value=r.toFixed(2); gEl.value=g.toFixed(2); bEl.value=b.toFixed(2);
    rgb=[r/100,g/100,b/100]; if(draw) drawFromRGB();
  }
  function rebalance(focus,newVal){
    let r=parseFloat(rEl.value)||0, g=parseFloat(gEl.value)||0, b=parseFloat(bEl.value)||0;
    [r,g,b]=norm3p(r,g,b); newVal=clamp01p(newVal);
    if(focus==='R'){ const rem=g+b, k=rem?(100-newVal)/rem:0.5; g*=k; b*=k; r=newVal; }
    else if(focus==='G'){ const rem=r+b, k=rem?(100-newVal)/rem:0.5; r*=k; b*=k; g=newVal; }
    else { const rem=r+g, k=rem?(100-newVal)/rem:0.5; r*=k; g*=k; b=newVal; }
    const tot=r+g+b; if(Math.abs(tot-100)>0.001){
      if(focus!=='R') r*=100/tot; if(focus!=='G') g*=100/tot; if(focus!=='B') b*=100/tot;
    }
    setPerc(r,g,b);
  }

  ['input','change'].forEach(evt=>{
    rEl.addEventListener(evt,()=>rebalance('R',parseFloat(rEl.value)||0));
    gEl.addEventListener(evt,()=>rebalance('G',parseFloat(gEl.value)||0));
    bEl.addEventListener(evt,()=>rebalance('B',parseFloat(bEl.value)||0));
  });

  const handlePoint=(mx,my)=>{
    const wts=barycentric(mx,my,Vtop,Vleft,Vright);
    if(!inside(wts)) return false;
    const [r,g,b]=baryToRGB(wts,cfg.vertexToChannel);
    setPerc(r*100,g*100,b*100);
    return true;
  };
  canvas.addEventListener('mousedown',e=>{
    const r=canvas.getBoundingClientRect();
    dragging=handlePoint(e.clientX-r.left,e.clientY-r.top);
  });
  canvas.addEventListener('mousemove',e=>{
    if(!dragging) return;
    const r=canvas.getBoundingClientRect();
    handlePoint(e.clientX-r.left,e.clientY-r.top);
  });
  window.addEventListener('mouseup',()=>{ dragging=false; });
  canvas.addEventListener('click',e=>{
    const r=canvas.getBoundingClientRect();
    handlePoint(e.clientX-r.left,e.clientY-r.top);
  });

  let onConfirm=null;
  btn.addEventListener('click',()=>{
    const [r,g,b]=rgb;
    dlgText.textContent =
`Suas prioridades de seleção da solução:

${(r*100).toFixed(2)}% de peso para custo anual,
${(g*100).toFixed(2)}% de qualidade (aderência a seus requisitos) e
${(b*100).toFixed(2)}% para prazo.`;
    dlg.showModal();
    const ok=()=>{ dlg.close(); onConfirm&&onConfirm({r,g,b}); cleanup(); };
    const re=()=>{ dlg.close(); cleanup(); };
    const cleanup=()=>{ dlgOk.removeEventListener('click',ok); dlgReset.removeEventListener('click',re); };
    dlgOk.addEventListener('click',ok); dlgReset.addEventListener('click',re);
  });

  setPerc(33.3333,33.3333,33.3333); drawFromRGB();
  return { getRGB:()=>({r:rgb[0],g:rgb[1],b:rgb[2]}), onConfirm:(fn)=>{onConfirm=fn;} };
}

import { initEntrada } from './entrada.js';

const IMG_SRC = 'public/triangulo2.png';
const CSV_ZSCORES = 'data/Matriz de Decisão - Zscores para dash.csv';
const CSV_NOMES   = 'data/Matriz de Decisão - só nomes e coordenadas.csv';

// -------- CSV util --------
function parseCSV(text){
  let sep = (text.indexOf(';')>-1 && text.indexOf(',')===-1) ? ';' : ',';
  const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim().length>0);
  if(!lines.length) return {header:[], rows:[]};
  const header = lines[0].split(sep).map(h=>h.trim());
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split(sep);
    const o = {}; header.forEach((h,j)=>o[h]=(cols[j]??'').trim());
    rows.push(o);
  }
  return {header, rows};
}
const coerceNum = s => {
  if (s === null || s === undefined || s === '') return 0;
  const cleaned = String(s).replace(/"/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

async function loadCSVs(){
  const [zs, nm] = await Promise.allSettled([
    fetch(CSV_ZSCORES, {cache:'no-store'}).then(r=>r.text()),
    fetch(CSV_NOMES,   {cache:'no-store'}).then(r=>r.text())
  ]);
  const zText = zs.status==='fulfilled' ? zs.value : '';
  const nText = nm.status==='fulfilled' ? nm.value : '';
  return { z: parseCSV(zText), n: parseCSV(nText) };
}

// -------- helpers de header/coord --------
function headerLike(header, key){
  const norm = s => s.toLowerCase().replace(/\s+/g,'');
  const K = norm(key);
  return header.find(h => norm(h).includes(K));
}

function parseCoord(s){
  if(!s) return null;
  const m = String(s).trim().match(/^([IVXLCDM]+)\s*[\.\-]\s*(\d+)\s*[\.\-]\s*([a-z])$/i);
  if(!m) return null;
  return { pri:m[1].toUpperCase(), sec:parseInt(m[2],10), ter:m[3].toLowerCase() };
}
function romanToInt(r){
  const map={I:1,V:5,X:10,L:50,C:100,D:500,M:1000}; let n=0, prev=0;
  for(const ch of r.split('').reverse()){ const v=map[ch]||0; if(v<prev) n-=v; else n+=v, prev=v; }
  return n;
}

// -------- ranking bruto --------
function computeRanking(zData, {r,g,b}){
  const {header, rows} = zData;
  const ZC = headerLike(header,'zcusto');
  const ZQ = headerLike(header,'zqual');
  const ZP = headerLike(header,'zprazo');
  const sC = headerLike(header,'s_zcusto') || headerLike(header,'szcusto');
  const sQ = headerLike(header,'s_zqual')  || headerLike(header,'szqual');
  const sP = headerLike(header,'s_zprazo') || headerLike(header,'szprazo');
  if(!ZC||!ZQ||!ZP||!sC||!sQ||!sP) throw new Error('CSV de Zscores não possui as 6 colunas necessárias.');

  const results = rows.map((row, i)=>{
    const zc=coerceNum(row[ZC]), zq=coerceNum(row[ZQ]), zp=coerceNum(row[ZP]);
    const sc=coerceNum(row[sC]), sq=coerceNum(row[sQ]), sp=coerceNum(row[sP]);
    
    // Converte (r,g,b) de percentual (0-100) para decimal (0-1)
    const rNorm = r / 100, gNorm = g / 100, bNorm = b / 100;
    
    // Fórmula correta: Zranking = (-r*zc) + (g*zq) + (-b*zp)
    const Zranking = (-rNorm*zc) + (gNorm*zq) + (-bNorm*zp);
    // Propagação de incerteza: s_Zrank = sqrt((r*sc)² + (g*sq)² + (b*sp)²)
    const s_Zrank  = Math.sqrt((rNorm*sc)**2 + (gNorm*sq)**2 + (bNorm*sp)**2);
    
    return { idx:i, id:(i+1), Zranking, s_Zrank };
  });

  // Reescalonamento para nota 0-10
  const zValues = results.map(r => r.Zranking);
  const minZ = Math.min(...zValues);
  const maxZ = Math.max(...zValues);
  const range = maxZ - minZ;
  
  return results.map(r => {
    const nota = range > 0 ? ((r.Zranking - minZ) / range) * 10 : 5;
    // Margem de erro sem reescalonamento - mantém valores originais
    return { 
      ...r, 
      nota: Math.round(nota * 100) / 100, // 2 casas decimais
      margemErro: Math.round(r.s_Zrank * 100) / 100 // 2 casas decimais, sem reescalonamento
    };
  });
}

// -------- enriquece com nomes/coords --------
function enrichWithNames(rows, namesParsed){
  const nameCol  = headerLike(namesParsed.header, 'nome') || namesParsed.header[0];
  const coordCol = headerLike(namesParsed.header, 'coordenadas') || headerLike(namesParsed.header,'coord');
  return rows.map(r=>{
    const nome = namesParsed.rows[r.idx]?.[nameCol] ?? `Sol ${r.id}`;
    const coordStr = namesParsed.rows[r.idx]?.[coordCol] ?? '';
    const coord = parseCoord(coordStr);
    return { ...r, nome, coordStr, coord };
  });
}

// -------- Clustering inteligente baseado em DBSCAN --------
function smartCluster(items){
  if(items.length <= 3) return items.map((item, i) => ({...item, cluster: i+1}));
  
  // Ordena por nota (maior nota = melhor)
  const sorted = [...items].sort((a,b) => b.nota - a.nota);
  const zValues = sorted.map(item => item.nota);
  
  // Calcula distâncias entre notas consecutivas
  const distances = [];
  for(let i = 0; i < zValues.length - 1; i++){
    distances.push(Math.abs(zValues[i] - zValues[i+1]));
  }
  
  // Encontra gaps significativos (método do joelho)
  const avgDist = distances.reduce((a,b) => a+b, 0) / distances.length;
  const threshold = avgDist * 2; // Ajuste empírico
  
  const clusters = [];
  let currentCluster = 1;
  let clusterStart = 0;
  
  for(let i = 0; i < distances.length; i++){
    if(distances[i] > threshold){
      // Fim do cluster atual
      for(let j = clusterStart; j <= i; j++){
        clusters.push({...sorted[j], cluster: currentCluster});
      }
      currentCluster++;
      clusterStart = i + 1;
    }
  }
  
  // Adiciona último cluster
  for(let j = clusterStart; j < sorted.length; j++){
    clusters.push({...sorted[j], cluster: currentCluster});
  }
  
  return clusters;
}

// -------- Nomes dos clusters --------
function getClusterName(clusterId, totalClusters){
  const names = ['Ouro', 'Prata', 'Bronze', 'Ferro', 'Barro', 'Lama', 'Cascalho', 'Poeira'];
  if(clusterId <= 3) return names[clusterId - 1];
  if(clusterId <= names.length) return names[clusterId - 1];
  return `Cluster ${clusterId}`;
}

// -------- PÓDIO por cluster --------
function renderPodiumClusters(items){
  const host = document.getElementById('podium');
  if(!host) return;

  // Aplica clustering inteligente
  const clustered = smartCluster(items);
  
  // Agrupa por cluster
  const clusters = new Map();
  for(const item of clustered){
    const cid = item.cluster;
    if(!clusters.has(cid)) clusters.set(cid, { maxNota: -Infinity, items: [] });
    const c = clusters.get(cid);
    c.items.push(item);
    if(item.nota > c.maxNota) c.maxNota = item.nota;
  }
  
  // Ordena clusters pela melhor nota
  const ordered = [...clusters.entries()].sort((a,b)=> b[1].maxNota - a[1].maxNota);
  const totalClusters = ordered.length;
  const top3 = ordered.slice(0,3);

  const medals = ['🥇','🥈','🥉'];
  const classes = ['medal-1','medal-2','medal-3'];

  const cards = top3.map(([cid, group], i)=>{
    // ordena soluções internas por nota desc (maiores em cima)
    group.items.sort((a,b)=> b.nota - a.nota);
    // lista de links (nome + coord) - mostra apenas top 4 de cada cluster
    const topItems = group.items.slice(0, 4);
    const links = topItems.map(it=>{
      const label = `${it.nome} (${it.coordStr || ''})`;
      const href  = `detalhe.html?sol=${encodeURIComponent(it.nome)}`;
      return `<a class="podium-link" href="${href}" target="_blank" rel="noopener">${label}</a>`;
    }).join('');
    const best = group.items[0];
    const scoreLine = best ? `<div class="podium-score">melhor nota relativa: ${best.nota.toFixed(2)} • margem de erro: ${best.margemErro.toFixed(2)}</div>` : '';
    const clusterName = getClusterName(cid, totalClusters);
    return `
      <div class="podium-card">
        <div class="podium-medal ${classes[i]}">${medals[i]} ${clusterName}</div>
        ${links}
        ${scoreLine}
      </div>`;
  }).join('');

  host.innerHTML = cards || '<em>Sem dados.</em>';
}

// -------- Tabela (ranking completo) --------
function renderTable(items){
  const host = document.getElementById('table');
  if(!items?.length){ host.innerHTML = '<em>Nenhum resultado.</em>'; return; }
  
  // Aplica clustering e ordena por nota
  const clustered = smartCluster(items);
  const sorted = clustered.sort((a,b) => b.nota - a.nota);
  
  const head = `<thead><tr><th>#</th><th>Cluster</th><th>Nome</th><th class="num">Nota Relativa</th><th class="num">Margem de Erro</th></tr></thead>`;
  const body = sorted.map((r,i)=>{
    const href = `detalhe.html?sol=${encodeURIComponent(r.nome)}`;
    const clusterName = getClusterName(r.cluster, Math.max(...clustered.map(x => x.cluster)));
    return `<tr>
      <td>${i+1}</td>
      <td><span class="cluster-badge cluster-${r.cluster}">${clusterName}</span></td>
      <td><a href="${href}" target="_blank" rel="noopener">${r.nome} ${r.coordStr?`(${r.coordStr})`:''}</a></td>
      <td class="num">${r.nota.toFixed(2)}</td>
      <td class="num">${r.margemErro.toFixed(2)}</td>
    </tr>`;
  }).join('');
  host.innerHTML = `<table class="table">${head}<tbody>${body}</tbody></table>`;
}

// -------- Árvore --------
function compareCoords(a,b){
  if(a.pri!==b.pri) return romanToInt(a.pri)-romanToInt(b.pri);
  if(a.sec!==b.sec) return a.sec-b.sec;
  return a.ter.localeCompare(b.ter);
}
function buildTree(items){
  // items já possuem coord
  const tree = new Map(); // pri -> Map(sec -> [leaves])
  for(const it of items){
    if(!it.coord) continue;
    const p = it.coord.pri, s = it.coord.sec;
    if(!tree.has(p)) tree.set(p, new Map());
    const sec = tree.get(p);
    if(!sec.has(s)) sec.set(s, []);
    sec.get(s).push(it);
  }
  // ordena internamente
  for(const [,sec] of tree){
    for(const [s,arr] of sec){
      arr.sort((a,b)=> compareCoords(a.coord,b.coord) || (b.Zranking - a.Zranking));
      sec.set(s, arr);
    }
  }
  return tree;
}
function renderTree(tree){
  const host = document.getElementById('tree');
  if(!host){ return; }
  if(!tree || tree.size===0){ host.innerHTML='<em>Nenhuma solução mapeada.</em>'; return; }

  const primKeys = [...tree.keys()].sort((a,b)=> romanToInt(a)-romanToInt(b));
  const html = primKeys.map(pri => {
    const secs = tree.get(pri);
    const secKeys = [...secs.keys()].sort((a,b)=> a-b);
    const secHtml = secKeys.map(sec => {
      const leaves = secs.get(sec);
      const leafHtml = leaves.map(l => {
        const href = `detalhe.html?sol=${encodeURIComponent(l.nome)}`;
        return `<li><span class="leaf"><a href="${href}" target="_blank" rel="noopener">${l.nome}</a> ${l.coordStr?`(${l.coordStr})`:''}</span> <span class="score">(Z=${l.Zranking.toFixed(5)}, s=${l.s_Zrank.toFixed(5)})</span></li>`;
      }).join('');
      return `<li><span class="branch">${pri}.${sec}</span><ul>${leafHtml}</ul></li>`;
    }).join('');
    return `<li><span class="branch">${pri}</span><ul>${secHtml}</ul></li>`;
  }).join('');

  host.innerHTML = `<ul>${html}</ul>`;
}

// -------- toggle helpers --------
function show(el){ el.style.display='block'; }
function hide(el){ el.style.display='none'; }
function toggle(el){ el.style.display = (el.style.display==='none' || !el.style.display) ? 'block' : 'none'; }

// -------- Bootstrap --------
(async () => {
  const entrada = await initEntrada({ imgSrc: IMG_SRC, vertexToChannel: ['B','R','G'] });
  const CSVS = await loadCSVs();

  // Botões de navegação
  const btnRanking = document.getElementById('btnRanking');
  const btnTree = document.getElementById('btnTree');
  const rankingSection = document.getElementById('rankingSection');
  const treeSection = document.getElementById('treeSection');

  entrada.onConfirm(({r,g,b})=>{
    try{
      // ranking
      let rows = computeRanking(CSVS.z, {r,g,b});
      rows.sort((a,b)=> b.Zranking - a.Zranking);

      // enriquece com nomes/coords
      const items = enrichWithNames(rows, CSVS.n);

      // PÓDIO por cluster (tronco primário)
      renderPodiumClusters(items);

      // Ranking completo (mantém oculto até clicar)
      renderTable(items);

      // Árvore (mantém oculta até clicar)
      const tree = buildTree(items);
      renderTree(tree);

      // listeners (uma vez só)
      if(!btnRanking.dataset.bound){
        btnRanking.addEventListener('click', ()=> toggle(rankingSection));
        btnRanking.dataset.bound = '1';
      }
      if(!btnTree.dataset.bound){
        btnTree.addEventListener('click', ()=> toggle(treeSection));
        btnTree.dataset.bound = '1';
      }

      console.log('(r,g,b) puros ->', r.toFixed(6), g.toFixed(6), b.toFixed(6));
    }catch(err){
      console.error(err); alert(err.message || 'Erro ao processar CSV.');
    }
  });
})();

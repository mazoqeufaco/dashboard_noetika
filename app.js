import { initEntrada, computeZFromCSV, mapToScore } from './entrada.js';

// Caminhos padrão
const IMG_SRC = 'public/triangulo.png'; // seu arquivo com espaços no nome
const CSV_DEFAULT = 'Matriz de Decisão - Zscores para dash.csv'; // opcional (estático)
const NAMES_CSV = 'Matriz de Decisão - só nomes e coordenadas.csv';

// Estado global
let currentData = null;
let namesData = null;

// Carrega dados de nomes e coordenadas
async function loadNamesData() {
  try {
    const response = await fetch(NAMES_CSV);
    if (response.ok) {
      const csvText = await response.text();
      const { rows } = parseCSV(csvText);
      namesData = rows;
    }
  } catch (error) {
    console.warn('Não foi possível carregar dados de nomes:', error);
  }
}

// Parser CSV simples
function parseCSV(text, sep=',') {
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

// Busca nome e coordenadas por ID
function findNameAndCoords(id) {
  if (!namesData) return { name: `Solução ${id}`, coords: 'N/A' };
  // Usa o índice (ID é baseado na posição no CSV)
  const index = parseInt(id) - 1;
  if (index >= 0 && index < namesData.length) {
    const item = namesData[index];
    return { 
      name: item['nome'], 
      coords: item['coordenadas na árvore'] 
    };
  }
  return { name: `Solução ${id}`, coords: id };
}

// Renderiza pódio
function renderPodium(data) {
  const host = document.getElementById('podium');
  if (!data || !data.length) {
    host.innerHTML = '<em>Nenhum resultado.</em>';
    return;
  }

  // Pega os top 3 + outros
  const top3 = data.slice(0, 3);
  const others = data.slice(3);

  let html = '';
  
  // Top 3 no pódio
  top3.forEach((item, index) => {
    const { name, coords } = findNameAndCoords(item.id);
    const position = index === 0 ? 'first' : index === 1 ? 'second' : 'third';
    const categoryClass = item.category.toLowerCase().replace(/\s+/g, '');
    
    html += `
      <div class="podium-step ${position}">
        <div class="podium-place ${categoryClass}">${item.category}</div>
        <div class="solution-info">
          <div class="solution-name">${name}</div>
          <div class="solution-coords">${coords}</div>
          <div class="solution-zrank">${item.Zranking.toFixed(3)}</div>
        </div>
      </div>
    `;
  });

  // Outras soluções (se houver)
  if (others.length > 0) {
    html += `
      <div class="podium-step other">
        <div class="podium-place ${others[0].category.toLowerCase().replace(/\s+/g, '')}">+${others.length} mais</div>
        <div class="solution-info">
          <div class="solution-name">Outras soluções</div>
          <div class="solution-coords">Ver ranking completo</div>
        </div>
      </div>
    `;
  }

  host.innerHTML = html;
}

// Renderiza ranking comparativo
function renderRankingTable(data) {
  const host = document.getElementById('rankingTable');
  if (!data || !data.length) {
    host.innerHTML = '<em>Nenhum resultado.</em>';
    return;
  }

  const zScores = data.map(d => d.Zranking);
  const minZ = Math.min(...zScores);
  const maxZ = Math.max(...zScores);

  const th = `<thead><tr><th>Posição</th><th>Nome</th><th>Coordenadas</th><th>Nota</th><th>Zranking</th><th>Categoria</th></tr></thead>`;
  const tb = data.map((item, index) => {
    const { name, coords } = findNameAndCoords(item.id);
    const score = mapToScore(item.Zranking, minZ, maxZ);
    return `
      <tr>
        <td class="num">${index + 1}º</td>
        <td>${name}</td>
        <td>${coords}</td>
        <td class="num">${score.toFixed(1)}</td>
        <td class="num">${item.Zranking.toFixed(3)}</td>
        <td>${item.category}</td>
      </tr>
    `;
  }).join('');

  host.innerHTML = `<table class="table">${th}<tbody>${tb}</tbody></table>`;
}

// Renderiza árvore interativa
function renderTreeView(data) {
  const host = document.getElementById('treeView');
  if (!data || !data.length) {
    host.innerHTML = '<em>Nenhum resultado.</em>';
    return;
  }

  let html = '';
  data.forEach((item, index) => {
    const { name, coords } = findNameAndCoords(item.id);
    const categoryClass = item.category.toLowerCase().replace(/\s+/g, '');
    
    html += `
      <div class="tree-node" data-index="${index}">
        <div class="tree-coords">${coords}</div>
        <div class="tree-name">${name}</div>
        <div class="tree-details">
          <strong>Zranking:</strong> ${item.Zranking.toFixed(3)} | 
          <strong>Categoria:</strong> ${item.category} | 
          <strong>Incerteza:</strong> ${item.s_Zrank.toFixed(3)}
        </div>
      </div>
    `;
  });

  host.innerHTML = html;

  // Adiciona interatividade
  host.querySelectorAll('.tree-node').forEach(node => {
    node.addEventListener('click', () => {
      // Remove seleção anterior
      host.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
      // Seleciona atual
      node.classList.add('selected');
    });
  });
}

// Inicializa modais
function initModals() {
  // Modal de ranking
  const rankingModal = document.getElementById('rankingModal');
  const rankingBtn = document.getElementById('rankingBtn');
  const rankingClose = rankingModal.querySelector('.close');

  rankingBtn.addEventListener('click', () => {
    if (currentData) {
      renderRankingTable(currentData);
      rankingModal.style.display = 'block';
    }
  });

  rankingClose.addEventListener('click', () => {
    rankingModal.style.display = 'none';
  });

  // Modal de possibilidades
  const possibilitiesModal = document.getElementById('possibilitiesModal');
  const possibilitiesBtn = document.getElementById('possibilitiesBtn');
  const possibilitiesClose = possibilitiesModal.querySelector('.close');

  possibilitiesBtn.addEventListener('click', () => {
    if (currentData) {
      renderTreeView(currentData);
      possibilitiesModal.style.display = 'block';
    }
  });

  possibilitiesClose.addEventListener('click', () => {
    possibilitiesModal.style.display = 'none';
  });

  // Fecha modais clicando fora
  window.addEventListener('click', (event) => {
    if (event.target === rankingModal) {
      rankingModal.style.display = 'none';
    }
    if (event.target === possibilitiesModal) {
      possibilitiesModal.style.display = 'none';
    }
  });
}

(async () => {
  // Carrega dados de nomes
  await loadNamesData();

  // inicializa UI de entrada
  const entrada = await initEntrada({ imgSrc: IMG_SRC, vertexToChannel: ['B','R','G'] });

  // Inicializa modais
  initModals();

  // Carrega CSV por upload (opção recomendada para manter privado)
  let csvText = null;
  document.getElementById('csvFile').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return; csvText = await f.text();
  });

  // Opcional: tenta carregar CSV estático se existir
  try {
    const resp = await fetch(CSV_DEFAULT, { cache: 'no-store' });
    if(resp.ok){ csvText = await resp.text(); }
  } catch (_) { /* ignorar se não existir */ }

  // Callback quando o usuário confirmar (Ok)
  entrada.onConfirm(({r,g,b}) => {
    if(!csvText){ alert('Selecione o CSV antes de confirmar.'); return; }
    try{
      const table = computeZFromCSV(csvText, {r,g,b});
      // Ordena por Zranking desc antes de exibir
      table.sort((a,b)=> b.Zranking - a.Zranking);
      
      // Armazena dados globalmente
      currentData = table;
      
      // Renderiza pódio
      renderPodium(table);

      // Aqui você pode enviar (r,g,b) e/ou a tabela para outro backend:
      // fetch('/proximo-applet', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ weights:{r,g,b}, ranking: table }) });
    }catch(err){
      console.error(err); alert(err.message || 'Erro ao processar CSV.');
    }
  });
})();

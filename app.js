import { initEntrada, computeZFromCSV } from './entrada.js';

// Caminhos padrão
const IMG_SRC = 'public/triangulo rgb soma 1.png'; // seu arquivo com espaços no nome
const CSV_DEFAULT = 'data/Matriz de Decisão - Zscores para dash.csv'; // opcional (estático)

// Renderiza tabela simples com sort por Zranking desc
function renderTable(rows){
  const host = document.getElementById('table');
  if(!rows || !rows.length){ host.innerHTML = '<em>Nenhum resultado.</em>'; return; }
  const th = `<thead><tr><th>ID</th><th class="num">Zranking</th><th class="num">s_Zrank</th></tr></thead>`;
  const tb = rows.map(r=>`<tr><td>${String(r.id)}</td><td class="num">${r.Zranking.toFixed(5)}</td><td class="num">${r.s_Zrank.toFixed(5)}</td></tr>`).join('');
  host.innerHTML = `<table class="table">${th}<tbody>${tb}</tbody></table>`;
}

(async () => {
  // inicializa UI de entrada
  const entrada = await initEntrada({ imgSrc: IMG_SRC, vertexToChannel: ['B','R','G'] });

  // Carrega CSV por upload (opção recomendada para manter privado)
  let csvText = null;
  document.getElementById('csvFile').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return; csvText = await f.text();
  });

  // Opcional: tenta carregar CSV estático se existir em /data
  try {
    const resp = await fetch(CSV_DEFAULT, { cache: 'no-store' });
    if(resp.ok){ csvText = await resp.text(); }
  } catch (_) { /* ignorar se não existir */ }

  // Callback quando o usuário confirmar (Ok)
  entrada.onConfirm(({r,g,b}) => {
    if(!csvText){ alert('Selecione o CSV (ou coloque em /data) antes de confirmar.'); return; }
    try{
      const table = computeZFromCSV(csvText, {r,g,b});
      // Ordena por Zranking desc antes de exibir
      table.sort((a,b)=> b.Zranking - a.Zranking);
      renderTable(table);

      // Aqui você pode enviar (r,g,b) e/ou a tabela para outro backend:
      // fetch('/proximo-applet', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ weights:{r,g,b}, ranking: table }) });
    }catch(err){
      console.error(err); alert(err.message || 'Erro ao processar CSV.');
    }
  });
})();

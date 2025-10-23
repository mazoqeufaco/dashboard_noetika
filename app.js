// app.js
import { initEntrada, computeZFromCSV } from './entrada.js';

(async () => {
  // inicializa o triângulo
  const entrada = await initEntrada({
    imgSrc: 'public/triangulo.png', // ou "triangulo rgb soma 1.png"
    vertexToChannel: ['B','R','G']
  });

  // captura CSV do input e processa quando usuário clicar Ok
  let csvText = null;
  document.getElementById('csvFile').addEventListener('change', async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    csvText = await file.text();
  });

  // callback ao confirmar prioridades
  entrada.onConfirm(async ({r,g,b}) => {
    if(!csvText){
      alert('Selecione o CSV primeiro.');
      return;
    }
    try {
      // se seus cabeçalhos tiverem nomes diferentes, ajuste o headerMap
      const headerMap = {
        // ZCusto: 'Z Custo',  // exemplo
        // ZQualidade: 'Z Qual',
        // ZPrazo: 'Z Prazo',
        // s_Zcusto: 's_Custo',
        // s_ZQual: 's_Qual',
        // s_ZPrazo: 's_Prazo',
        // id: 'Alternativa'
      };
      const tabela = computeZFromCSV(csvText, {r,g,b}, headerMap);
      // TODO: passar 'tabela' para o próximo estágio do seu pipeline
      console.log('Zranking (amostra):', tabela.slice(0,3));

      // demo: imprime na página
      const lines = tabela.map(o => `${o.id}\t${o.Zranking.toFixed(5)}\t${o.s_Zrank.toFixed(5)}`);
      document.getElementById('result').textContent =
        'id\tZranking\ts_Zrank\n' + lines.join('\n');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Erro ao processar CSV.');
    }
  });
})();

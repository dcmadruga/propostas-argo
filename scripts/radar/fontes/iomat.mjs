// Coletor do Diário Oficial de MT (IOMAT). Usa a mesma busca pública do site (Busca por Palavra), que devolve
// JSON com o texto de cada página do diário. Não usa login nem CAPTCHA (o site não tem nenhum dos dois).
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; shotgun-radar/1.0; +https://github.com/dcmadruga/crm-shotgun)' };
const espera = ms => new Promise(r => setTimeout(r, ms));

// Expressões pesquisadas (entre aspas = expressão exata). O classificador decide depois o que é posto.
export const TERMOS = [
  '"comércio varejista de combustíveis"', '"comercio varejista de combustiveis"', '"comércio a varejo de combustíveis"',
  '"posto de combustível"', '"posto de combustíveis"', '"posto revendedor"', '"posto de abastecimento"', '"ponto de abastecimento"',
  '"revenda de combustíveis"', '"revendedor de combustíveis"', '"tanques subterrâneos"', '"armazenamento de combustíveis"', '"auto posto"'
];

export const info = { id: 'iomat', nome: 'Diário Oficial de MT (IOMAT)', url: 'https://iomat.mt.gov.br/', tipo: 'diario_oficial' };
export const linkPagina = (diario, pagina) => `https://iomat.mt.gov.br/portal/visualizacoes/pdf/${diario}/#/e:${diario}/p:${pagina}`;
export const linkPdfPagina = (diario, pagina) => `https://iomat.mt.gov.br/portal/edicoes/download/${diario}/${pagina}`;

async function busca(termo, pagina, de, ate) {
  const u = `https://www.iomat.mt.gov.br/busca/busca/buscar/query/${pagina}/di:${de}/df:${ate}/?1=1&q=${encodeURIComponent(termo)}`;
  let erro;
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.hits) throw new Error('resposta sem resultados');
      return j.hits;
    } catch (e) { erro = e; await espera(t * 5000); }
  }
  throw new Error(`IOMAT (${termo}, pág. ${pagina}): ${erro.message}`);
}

// Devolve as páginas do diário (texto completo) que têm alguma das expressões no período
export async function coletar(de, ate, log = console.log) {
  const paginas = new Map();
  if (process.env.RADAR_AMOSTRAS) { // teste local com respostas salvas da busca
    const { readdirSync, readFileSync } = await import('node:fs');
    for (const f of readdirSync(process.env.RADAR_AMOSTRAS).filter(f => f.startsWith('iomat'))) for (const h of JSON.parse(readFileSync(process.env.RADAR_AMOSTRAS + '/' + f)).hits) { const s = h._source; paginas.set(`${s.diario_id}-${s.pagina}`, { id: `${s.diario_id}-${s.pagina}`, diario: s.diario_id, pagina: s.pagina, data: s.data, texto: s.conteudo, url: linkPagina(s.diario_id, s.pagina), pdf: linkPdfPagina(s.diario_id, s.pagina) }); }
    return { paginas: [...paginas.values()], consultas: 0 };
  }
  let consultas = 0;
  for (const termo of TERMOS) {
    let total = 0;
    for (let p = 0; p < 80; p++) {
      const hits = await busca(termo, p, de, ate); consultas++;
      total = hits.total;
      for (const h of hits.hits || []) {
        const s = h._source || {}; const id = `${s.diario_id}-${s.pagina}`;
        if (!paginas.has(id)) paginas.set(id, { id, diario: s.diario_id, pagina: s.pagina, data: s.data, texto: s.conteudo || '', url: linkPagina(s.diario_id, s.pagina), pdf: linkPdfPagina(s.diario_id, s.pagina) });
      }
      if ((hits.hits || []).length < 10) break;
      await espera(1200);
    }
    log(`IOMAT ${termo}: ${total} página(s) no período`);
    await espera(1200);
  }
  return { paginas: [...paginas.values()], consultas };
}

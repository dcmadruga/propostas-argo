// Os 142 municípios de MT (IBGE) com o centro aproximado de cada um, para reconhecer a cidade no texto e
// pôr no mapa quem não tem coordenada exata.
const UA = { 'user-agent': 'shotgun-radar/1.0' };
export const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chaveMun = s => semAcento(s).replace(/[’'`´]/g, '').replace(/\bnossa\s+s(ra)?\.?\s/g, 'nossa senhora ').replace(/\bsto\.?\s/g, 'santo ').replace(/\bsta\.?\s/g, 'santa ').replace(/\bs\.\s?(?=jose|felix|pedro)/g, 'sao ').replace(/\bd\s?oeste\b/g, 'doeste').replace(/[^a-z0-9]+/g, ' ').trim();

export async function municipiosMT(listaPronta) {
  let lista = listaPronta;
  if (!lista) {
    try { lista = await (await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados/51/municipios', { headers: UA, signal: AbortSignal.timeout(30000) })).json(); }
    catch (e) { // sem o IBGE: usa os nomes do próprio app (sem código IBGE nem centro)
      console.warn('IBGE indisponível, usando lib/municipios.js:', e.message);
      const { readFileSync } = await import('node:fs'); const w = {};
      new Function('window', readFileSync(new URL('../../lib/municipios.js', import.meta.url), 'utf8'))(w);
      lista = w.MUNICIPIOS.MT.split('|').map(nome => ({ id: 'x-' + chaveMun(nome).replace(/ /g, '-'), nome }));
      listaPronta = lista;
    }
  }
  const centro = {};
  if (!listaPronta) try {
    const geo = await (await fetch('https://servicodados.ibge.gov.br/api/v3/malhas/estados/51?intrarregiao=municipio&formato=application/vnd.geo%2Bjson&qualidade=minima', { headers: UA })).json();
    for (const f of geo.features || []) {
      const pts = []; const junta = c => typeof c[0] === 'number' ? pts.push(c) : c.forEach(junta); junta(f.geometry.coordinates);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      centro[String(f.properties.codarea)] = [+((Math.min(...ys) + Math.max(...ys)) / 2).toFixed(4), +((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(4)];
    }
  } catch (e) { console.warn('IBGE: malha indisponível, mapa sem centro dos municípios:', e.message); }
  const mun = lista.map(m => ({ ibge: String(m.id), nome: m.nome, chave: chaveMun(m.nome), centro: centro[String(m.id)] || null }));
  if (mun.length < 140) throw new Error('IBGE devolveu só ' + mun.length + ' municípios de MT');
  // nomes mais longos primeiro: "Nova Mutum" antes de "Mutum", "São José do Rio Claro" antes de "Rio Claro"
  const ordenados = [...mun].sort((a, b) => b.chave.length - a.chave.length);
  return {
    lista: mun,
    porChave: Object.fromEntries(mun.map(m => [m.chave, m])),
    // acha o município num trecho; prefere o que vem colado em "/MT", "- MT", "município de"
    achar(texto) {
      const t = ' ' + chaveMun(texto) + ' ';
      const fortes = [...t.matchAll(/(?:municipio de|municipio|cidade de|em) ([a-z ]{3,40}?) (?:mt|estado de mato grosso)\b/g)].map(x => x[1]);
      for (const f of fortes) for (const m of ordenados) if ((' ' + f + ' ').includes(' ' + m.chave + ' ')) return m;
      const barras = [...t.matchAll(/([a-z ]{3,40}?) mt\b/g)].map(x => x[1]);
      for (const f of barras) for (const m of ordenados) if ((' ' + f + ' ').endsWith(' ' + m.chave + ' ')) return m;
      for (const m of ordenados) if (m.chave.length > 4 && t.includes(' ' + m.chave + ' ')) return m;
      return null;
    }
  };
}

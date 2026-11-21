// Cruzamento com a base de postos da ANP que o Shotgun já baixa todo dia (anp/postos/*.json).
// Diz se o CNPJ já é posto autorizado (com bandeira, autorização e coordenadas) e acha o CNPJ pelo nome
// quando o documento não traz CNPJ (nesse caso o CNPJ fica marcado como "não confirmado").
import { readdir, readFile } from 'node:fs/promises';
import { slug } from '../classificar.mjs';

export const info = { id: 'anp', nome: 'Base de postos da ANP (cruzamento)', url: 'https://revendedoresapi.anp.gov.br/v1/combustivel', tipo: 'base_cruzamento' };

export async function carregarANP() {
  const dir = new URL('../../../anp/postos/', import.meta.url);
  const porCnpj = new Map(), porNome = new Map();
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.json'))) {
    const j = JSON.parse(await readFile(new URL(f, dir), 'utf8'));
    for (const [cnpj, o] of Object.entries(j)) {
      if (o.uf !== 'MT') continue;
      porCnpj.set(cnpj, o);
      const k = slug(o.r) + '|' + slug(o.m);
      porNome.set(k, porNome.has(k) ? null : cnpj); // nome repetido na mesma cidade = ambíguo
    }
  }
  return {
    total: porCnpj.size,
    cnpj: c => porCnpj.get(c) || null,
    nome: (razao, municipio) => { const c = porNome.get(slug(razao) + '|' + slug(municipio)); return c ? { cnpj: c, ...porCnpj.get(c) } : null; }
  };
}

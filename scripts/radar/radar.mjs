// Robô do Radar de Novos Postos – MT. Roda no GitHub Actions (.github/workflows/radar-postos.yml).
// 1) decide se é hora de pesquisar (frequência e "Pesquisar agora" ficam em radar_config/geral);
// 2) coleta as fontes integradas; 3) separa e classifica os avisos; 4) cruza com a ANP;
// 5) deduplica e grava empreendimentos, processos, documentos, histórico, alertas e a execução.
// Sem o segredo FIREBASE_SERVICE_ACCOUNT (ou com RADAR_TESTE=true) roda em modo de teste: coleta e classifica
// de verdade, mas não grava nada no Firestore; o resultado vai para radar-saida/ (artefato da execução).
import { mkdir, writeFile } from 'node:fs/promises';
import { firestore } from './firestore.mjs';
import { municipiosMT } from './municipios.mjs';
import { avisosDaPagina, analisarAviso, analisarEmitidas, hash, slug } from './classificar.mjs';
import * as iomat from './fontes/iomat.mjs';
import * as anpFonte from './fontes/anp.mjs';

const inicio = new Date();
const dia = d => new Date(d).toISOString().slice(0, 10);
const somaDias = (d, n) => dia(new Date(d).getTime() + n * 864e5);
const log = (...a) => console.log(...a);
const teste = process.env.RADAR_TESTE === 'true';
const db = teste ? null : firestore();
const gatilhoBase = process.env.RADAR_GATILHO || 'agendado';

const PRIOR_CAT = ['novo', 'tanques', 'ampliacao', 'reforma', 'renovacao', 'titularidade', 'ponto_proprio', 'outro'];
const PRIOR_CONF = ['confirmado', 'possivel', 'analise', 'nao_confirmado'];
const RELEVANTES = /^(req_lp|req_li|req_lp_li|req_lp_li_lo|emitida_lp|emitida_li)$/;
const NOMES_EVENTO = { req_lp: 'Solicitação de Licença Prévia', req_li: 'Solicitação de Licença de Instalação', req_lo: 'Solicitação de Licença de Operação', req_lp_li: 'Solicitação de LP e LI', req_lp_li_lo: 'Solicitação de LP, LI e LO', req_renov: 'Solicitação de renovação', req_titular: 'Mudança de titularidade ou razão social', req_outro: 'Requerimento ao órgão ambiental', emitida_lp: 'Licença Prévia emitida', emitida_li: 'Licença de Instalação emitida', emitida_lo: 'Licença de Operação emitida', emitida: 'Licença emitida', indeferido: 'Indeferido ou arquivado' };
const NOMES_CAT = { novo: 'Novo posto de combustível', ampliacao: 'Ampliação de posto existente', reforma: 'Reforma de posto existente', tanques: 'Instalação de tanques', renovacao: 'Renovação de licença', titularidade: 'Mudança de titularidade', ponto_proprio: 'Ponto de abastecimento próprio (fazenda ou frota)', outro: 'Outro evento de posto' };

// ---------- 1) é hora de pesquisar? ----------
let config = {}, fontesDb = {}, gatilho = gatilhoBase, pedidoPor = '';
if (db) {
  config = (await db.get('radar_config/geral')) || {};
  for (const f of await db.lista('radar_fontes')) fontesDb[f.id] = f;
  const ped = config.pedido && !config.pedido.atendido;
  const freqH = Number(config.frequenciaHoras) || 24;
  const ultimaOk = fontesDb.iomat?.ultimaOk ? new Date(fontesDb.iomat.ultimaOk).getTime() : 0;
  if (ped) { gatilho = 'manual'; pedidoPor = config.pedido.por || ''; }
  else if (gatilhoBase === 'agendado' && Date.now() - ultimaOk < freqH * 36e5 - 10 * 6e4) { log(`Última pesquisa completa há ${((Date.now() - ultimaOk) / 36e5).toFixed(1)} h (frequência: ${freqH} h). Nada a fazer agora.`); process.exit(0); }
} else {
  if (!teste && gatilhoBase === 'agendado') { log('Sem o segredo FIREBASE_SERVICE_ACCOUNT o Radar não roda pelo agendamento. Configure a chave (docs/radar.md) ou rode manualmente em modo de teste.'); process.exit(0); }
  log(teste ? 'Modo de teste (RADAR_TESTE=true): nada será gravado.' : 'Sem FIREBASE_SERVICE_ACCOUNT: modo de teste, nada será gravado.');
}

// ---------- 2) coleta ----------
const ate = dia(inicio);
const cursor = fontesDb.iomat?.cursor;
const de = process.env.RADAR_DESDE || (cursor ? somaDias(cursor, -5) : somaDias(ate, -(Number(process.env.RADAR_DIAS) || 365)));
log(`Período pesquisado: ${de} a ${ate} · gatilho: ${gatilho}`);

const [mun, anp] = await Promise.all([municipiosMT(), anpFonte.carregarANP()]);
log(`Municípios de MT: ${mun.lista.length} · postos de MT na base da ANP: ${anp.total}`);

const porFonte = {}, avisos = [];
try {
  const { paginas, consultas } = await iomat.coletar(de, ate, log);
  let n = 0;
  for (const pg of paginas) for (const a of avisosDaPagina(pg.texto)) {
    const rs = a.tipo === 'emitidas' ? analisarEmitidas(a.texto, mun) : [analisarAviso(a.texto, mun)].filter(Boolean);
    for (const r of rs) { avisos.push({ ...r, fonte: 'iomat', fonteNome: iomat.info.nome, dataPublicacao: pg.data, url: pg.url, pdf: pg.pdf, local: `Edição ${pg.diario}, página ${pg.pagina}`, docId: `iomat-${pg.diario}-${pg.pagina}-${hash(r.trecho)}` }); n++; }
  }
  porFonte.iomat = { ok: true, consultas, paginas: paginas.length, docs: n };
  log(`IOMAT: ${consultas} consultas, ${paginas.length} páginas, ${n} avisos de posto`);
} catch (e) { porFonte.iomat = { ok: false, erro: e.message }; console.error(e); }
porFonte.anp = { ok: true, docs: 0, postosMT: anp.total };

// ---------- 3) deduplicação dos avisos (a mesma página aparece em várias buscas) ----------
const unicos = [...new Map(avisos.map(a => [a.docId, a])).values()];

// ---------- 4) empreendimentos ----------
const existentes = db ? await db.lista('radar_empreendimentos') : [];
const docsExist = new Set(db ? (await db.lista('radar_documentos')).map(d => d.id) : []);
const emps = new Map(existentes.map(e => [e.id, e]));
const porNomeMun = new Map(existentes.filter(e => e.razao).map(e => [slug(e.razao) + '|' + (e.ibge || ''), e.id]));
const novosDocs = [], historico = [], alertas = [], processos = new Map();
const recente = somaDias(ate, -10);

for (const a of unicos.sort((x, y) => String(x.dataPublicacao).localeCompare(String(y.dataPublicacao)))) {
  const campoFonte = {};
  // ANP: confirma o CNPJ, ou acha pelo nome + município (marcado como não confirmado)
  let ap = a.cnpj ? anp.cnpj(a.cnpj) : null;
  if (!a.cnpj && a.razao && a.municipio) { const m = anp.nome(a.razao, a.municipio); if (m) { a.cnpj = m.cnpj; campoFonte.cnpj = 'anp_nome'; ap = m; } }
  let eid = a.cnpj || porNomeMun.get(slug(a.razao) + '|' + (a.ibge || ''));
  if (!eid) eid = a.razao ? `n-${slug(a.razao)}-${a.ibge || 'mt'}` : `d-${a.docId}`;
  if (a.razao) porNomeMun.set(slug(a.razao) + '|' + (a.ibge || ''), eid);
  const novoEmp = !emps.has(eid);
  const e = emps.get(eid) || { id: eid, identificado: inicio, eventos: [], docs: [], processos: [] };
  const docNovo = !docsExist.has(a.docId);

  // campos: o que já existe só é trocado por um valor vindo de documento (nunca apagado)
  for (const k of ['razao', 'fantasia', 'municipio', 'ibge', 'endereco']) if (a[k] && !e[k]) e[k] = a[k];
  if (a.cnpj && !e.cnpj) { e.cnpj = a.cnpj; if (campoFonte.cnpj) e.campoFonte = { ...(e.campoFonte || {}), cnpj: campoFonte.cnpj }; }
  if (ap) { e.anp = { bandeira: ap.b || '', autorizacao: ap.a || '', vinculada: ap.dv || '' }; if (!e.razao) { e.razao = ap.r; e.campoFonte = { ...(e.campoFonte || {}), razao: 'anp' }; } }
  if (a.coord && (!e.lat || e.coordFonte === 'municipio')) { [e.lat, e.lng] = a.coord; e.coordFonte = 'documento'; }
  if (ap?.la && ap?.lo && (!e.lat || e.coordFonte === 'municipio')) { e.lat = ap.la; e.lng = ap.lo; e.coordFonte = 'anp'; }
  if (!e.lat && a.ibge) { const m = mun.lista.find(x => x.ibge === a.ibge); if (m?.centro) { [e.lat, e.lng] = m.centro; e.coordFonte = 'municipio'; } }

  const antes = { situacao: e.situacao, categoria: e.categoria };
  if (!e.eventos.includes(a.evento)) e.eventos.push(a.evento);
  if (!e.docs.some(d => d.id === a.docId)) e.docs.push({ id: a.docId, fonte: a.fonte, url: a.url, data: a.dataPublicacao, evento: a.evento });
  e.docs = e.docs.sort((x, y) => String(y.data).localeCompare(String(x.data))).slice(0, 30);
  if (!e.ultimaData || a.dataPublicacao >= e.ultimaData) { e.ultimaData = a.dataPublicacao; e.ultimoEvento = a.evento; e.situacao = a.situacao; }
  if (!e.primeiraData || a.dataPublicacao < e.primeiraData) e.primeiraData = a.dataPublicacao;
  let cat = a.categoria;
  if (cat === 'novo' && e.anp && a.tipoDoc === 'requerimento') {
    if (a.evento === 'req_lo') cat = 'outro';
    else { cat = 'ampliacao'; e.categoriaMotivo = 'O CNPJ já é posto autorizado na ANP: pedido de LP/LI tratado como ampliação ou reforma.'; }
  }
  if (!e.categoria || PRIOR_CAT.indexOf(cat) < PRIOR_CAT.indexOf(e.categoria)) e.categoria = cat;
  if (!e.confianca || PRIOR_CONF.indexOf(a.confianca) < PRIOR_CONF.indexOf(e.confianca)) e.confianca = a.confianca;
  if (campoFonte.cnpj && e.confianca === 'confirmado' && !a.processo) e.confianca = 'possivel';
  e.pendentes = ['razao', 'cnpj', 'municipio', 'endereco'].filter(k => !e[k]);

  // processo: pelo número (órgão + número) ou, sem número, pelo evento na data
  const pid = a.processo ? `${a.esfera === 'municipal' ? 'mun-' + (a.ibge || 'mt') : 'sema'}-${a.processo.replace(/\D+/g, '-')}` : `${eid}-${a.evento}-${a.dataPublicacao}`;
  const p = processos.get(pid) || { id: pid, eid, numero: a.processo || '', orgao: a.orgao || '', esfera: a.esfera || '', eventos: [], docs: [], licencas: [], dataAbertura: '' };
  if (!p.eventos.some(x => x.evento === a.evento && x.data === a.dataPublicacao)) p.eventos.push({ evento: a.evento, data: a.dataPublicacao, doc: a.docId });
  if (!p.docs.includes(a.docId)) p.docs.push(a.docId);
  (a.licencas || []).forEach(l => { if (!p.licencas.some(x => x.numero === l.numero)) p.licencas.push(l); });
  p.evento = a.evento; p.situacao = a.situacao; p.dataPublicacao = p.dataPublicacao && p.dataPublicacao < a.dataPublicacao ? p.dataPublicacao : a.dataPublicacao; p.ultimaData = a.dataPublicacao;
  processos.set(pid, p);
  const resumo = { numero: p.numero, orgao: p.orgao, evento: a.evento, data: a.dataPublicacao, id: pid };
  e.processos = [resumo, ...e.processos.filter(x => x.id !== pid)].slice(0, 15);

  e.atualizado = inicio;
  emps.set(eid, e);

  if (docNovo) {
    docsExist.add(a.docId);
    novosDocs.push({ id: a.docId, eid, pid, fonte: a.fonte, fonteNome: a.fonteNome, url: a.url, pdf: a.pdf, local: a.local, titulo: `${NOMES_EVENTO[a.evento] || 'Aviso'} · ${a.razao || 'empresa não identificada'}`, dataPublicacao: a.dataPublicacao, coletado: inicio, tipoDoc: a.tipoDoc, evento: a.evento, categoria: a.categoria, confianca: a.confianca, municipio: a.municipio || '', razao: a.razao || '', cnpj: a.cnpj || '', processo: a.processo || '', orgao: a.orgao || '', atividade: a.atividade || '', trecho: a.trecho });
    historico.push({ eid, pid, tipo: novoEmp ? 'identificado' : 'novo_documento', descricao: `${novoEmp ? 'Identificado' : 'Novo documento'}: ${NOMES_EVENTO[a.evento] || a.evento} (${a.fonteNome}, ${a.dataPublicacao.split('-').reverse().join('/')})`, de: antes.situacao || '', para: e.situacao || '', doc: a.docId, por: 'robô', em: inicio });
    const relevante = (novoEmp && ['novo', 'ampliacao', 'tanques', 'reforma'].includes(e.categoria)) || (!novoEmp && RELEVANTES.test(a.evento));
    if (relevante && a.dataPublicacao >= recente) {
      const tit = novoEmp && e.categoria === 'novo' ? 'NOVO POSTO IDENTIFICADO EM MATO GROSSO' : 'MOVIMENTAÇÃO DE POSTO EM MATO GROSSO';
      alertas.push({ eid, doc: a.docId, titulo: tit, criado: inicio, lidoPor: [], canal: 'app',
        texto: [`Empresa: ${e.razao || 'pendente de confirmação'}`, `CNPJ: ${e.cnpj ? e.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') + (e.campoFonte?.cnpj ? ' (pela base da ANP, não confirmado)' : '') : 'pendente de confirmação'}`, `Município: ${e.municipio ? e.municipio + ' – MT' : 'pendente de confirmação'}`, `Processo: ${a.processo || 'pendente de confirmação'}`, `Atividade: ${NOMES_CAT[e.categoria] || ''}`, `Licença: ${NOMES_EVENTO[a.evento] || ''}`, `Fonte: ${a.fonteNome}, ${a.local}`, `Data da identificação: ${inicio.toLocaleString('pt-BR', { timeZone: 'America/Cuiaba' })}`, `Documento: ${a.url}`].join('\n') });
    }
  }
}

const tocados = [...new Set(novosDocs.map(d => d.eid))];
const okGeral = Object.values(porFonte).every(f => f.ok);
const exec = { inicio, fim: new Date(), status: okGeral ? 'ok' : 'erro', gatilho, pedidoPor, periodo: { de, ate }, porFonte, documentos: unicos.length, novos: tocados.filter(id => !existentes.some(e => e.id === id)).length, atualizados: tocados.filter(id => existentes.some(e => e.id === id)).length, novosDocumentos: novosDocs.length, alertas: alertas.length, teste: !db };
exec.duracaoSeg = Math.round((exec.fim - inicio) / 1000);
porFonte.iomat && (porFonte.iomat.novos = novosDocs.length);
log(`Resultado: ${unicos.length} avisos únicos · ${emps.size} empreendimentos · ${exec.novos} novos · ${exec.atualizados} atualizados · ${novosDocs.length} documentos novos · ${alertas.length} alertas`);

// ---------- 5) gravação ----------
if (db) {
  const itens = [];
  const campos = e => { const { revisao, leadId, id, ...resto } = e; return resto; }; // revisão e lead são do app: o robô não mexe
  for (const id of tocados) itens.push({ caminho: `radar_empreendimentos/${id}`, dados: campos(emps.get(id)), mesclar: true });
  for (const p of processos.values()) if (p.docs.some(d => novosDocs.some(n => n.id === d))) itens.push({ caminho: `radar_processos/${p.id}`, dados: p, mesclar: true });
  for (const d of novosDocs) itens.push({ caminho: `radar_documentos/${d.id}`, dados: d });
  const auto = () => inicio.getTime().toString(36) + Math.random().toString(36).slice(2, 8);
  for (const h of historico) itens.push({ caminho: `radar_historico/${auto()}`, dados: h });
  for (const a of alertas) itens.push({ caminho: `radar_alertas/${auto()}`, dados: a });
  const iom = porFonte.iomat;
  itens.push({ caminho: 'radar_fontes/iomat', mesclar: true, dados: { ...iomat.info, situacao: iom.ok ? 'integrada' : (fontesDb.iomat?.situacao || 'nao_integrada'), ultimaColeta: inicio, ...(iom.ok ? { ultimaOk: inicio, cursor: ate, ultimoErro: '' } : { ultimoErro: iom.erro }) } });
  itens.push({ caminho: 'radar_fontes/anp', mesclar: true, dados: { ...anpFonte.info, situacao: 'integrada', ultimaColeta: inicio, ultimaOk: inicio, ultimoErro: '' } });
  itens.push({ caminho: `radar_execucoes/${auto()}`, dados: exec });
  if (gatilho === 'manual') itens.push({ caminho: 'radar_config/geral', mesclar: true, dados: { pedido: { ...config.pedido, atendido: true, atendidoEm: inicio } } });
  await db.gravar(itens);
  log(`Gravados ${itens.length} registros no Firestore.`);
} else {
  const saida = new URL('../../radar-saida/', import.meta.url);
  await mkdir(saida, { recursive: true });
  await writeFile(new URL('execucao.json', saida), JSON.stringify(exec, null, 1));
  await writeFile(new URL('empreendimentos.json', saida), JSON.stringify([...emps.values()], null, 1));
  await writeFile(new URL('documentos.json', saida), JSON.stringify(novosDocs, null, 1));
  await writeFile(new URL('alertas.json', saida), JSON.stringify(alertas, null, 1));
  const linhas = [...emps.values()].filter(e => ['novo', 'ampliacao', 'tanques'].includes(e.categoria)).sort((a, b) => b.ultimaData.localeCompare(a.ultimaData));
  log(`\nNovos/ampliações/tanques (${linhas.length}):`);
  for (const e of linhas) log(`  ${e.ultimaData} · ${NOMES_CAT[e.categoria]} · ${NOMES_EVENTO[e.ultimoEvento]} · ${e.razao || '?'} · ${e.cnpj || 'sem CNPJ'} · ${e.municipio || '?'} · ${e.confianca}${e.anp ? ' · já na ANP' : ''}`);
}
if (!okGeral) process.exitCode = 1;

// Radar de Novos Postos – MT (aba Telemetria). Lê o que o robô diário grava no Firestore (coleções radar_*)
// e deixa o administrador revisar, configurar fontes e pedir uma pesquisa na hora.
// O robô é scripts/radar/radar.mjs, rodado pelo GitHub Actions (.github/workflows/radar-postos.yml).
let F, db, perfil, admin = false, temTask = false, unsub = [];
let emps = [], alertas = [], execs = [], fontes = [], config = {}, erroLeitura = '', aba = 'geral', area = null, mapa = null, camada = null;
const filtro = { q: '', mun: '', cat: '', sit: '', conf: '', de: '', ate: '' };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dig = v => String(v || '').replace(/\D/g, '');
const semAc = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtCnpj = v => { const d = dig(v); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (v || ''); };
const fmtD = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : iso; };
const quando = v => { const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null); return d && !isNaN(d) ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; };
const ms = v => { const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null); return d && !isNaN(d) ? d.getTime() : 0; };
const PEND = '<em class="rdpend">pendente de confirmação</em>';
const val = v => (v === undefined || v === null || v === '') ? PEND : esc(v);

export const CATEGORIAS = { novo: 'Novo posto de combustível', ampliacao: 'Ampliação de posto existente', reforma: 'Reforma de posto existente', tanques: 'Instalação de tanques', renovacao: 'Renovação de licença', titularidade: 'Mudança de titularidade', ponto_proprio: 'Ponto de abastecimento próprio (fazenda ou frota)', outro: 'Outro evento de posto' };
export const EVENTOS = { req_lp: 'Solicitação de Licença Prévia', req_li: 'Solicitação de Licença de Instalação', req_lo: 'Solicitação de Licença de Operação', req_lp_li: 'Solicitação de LP e LI', req_lp_li_lo: 'Solicitação de LP, LI e LO', req_renov: 'Solicitação de renovação', req_titular: 'Mudança de titularidade ou razão social', req_outro: 'Requerimento ao órgão ambiental', emitida_lp: 'Licença Prévia emitida', emitida_li: 'Licença de Instalação emitida', emitida_lo: 'Licença de Operação emitida', emitida: 'Licença emitida', indeferido: 'Indeferido ou arquivado', analise: 'Processo em análise' };
export const SITUACOES = { solicitado: 'Solicitado (protocolo)', analise: 'Em análise', aprovado: 'Aprovado / licença emitida', indeferido: 'Indeferido ou arquivado', autorizado_anp: 'Autorizado pela ANP' };
export const CONFIANCA = { confirmado: 'Processo confirmado', possivel: 'Possível novo empreendimento', analise: 'Documento aguardando análise', nao_confirmado: 'Informação não confirmada' };
// Fontes previstas: só aparecem como "monitoradas" depois de uma execução real com sucesso (radar_fontes)
const FONTES_PREVISTAS = [
  { id: 'iomat', nome: 'Diário Oficial de MT (IOMAT)', url: 'https://iomat.mt.gov.br/' },
  { id: 'anp', nome: 'Base de postos da ANP (cruzamento)', url: 'https://revendedoresapi.anp.gov.br/' },
  { id: 'amm', nome: 'Jornal Oficial dos Municípios (AMM-MT)', url: 'https://amm.diariomunicipal.org/', obs: 'Entrega 2' },
  { id: 'querido', nome: 'Querido Diário (Rondonópolis)', url: 'https://queridodiario.ok.org.br/', obs: 'Entrega 2' },
  { id: 'simlam', nome: 'SIMLAM público (SEMA-MT)', url: 'https://monitoramento.sema.mt.gov.br/simlam/', obs: 'Bloqueia servidores fora do Brasil' },
  { id: 'semvirtual', nome: 'SEM@ Virtual (SEMA-MT)', url: 'https://sema.mt.gov.br/site/index.php/sem-virtual', obs: 'Exige login: não monitorada' },
  { id: 'pnla', nome: 'PNLA (MMA)', url: 'https://pnla.mma.gov.br/', obs: 'Pesquisa exige login: não monitorada' }
];

window.addEventListener('shotgun-crm', e => { ({ F, db, perfil, admin, temTask } = e.detail); ouvir(); });
window.addEventListener('argo-sair', () => { unsub.forEach(u => u()); unsub = []; emps = []; alertas = []; execs = []; fontes = []; config = {}; });
window.radarMT = { mostrar(el) { area = el; area.className = 'radar'; desenhar(); } };

function ouvir() {
  unsub.forEach(u => u()); unsub = []; erroLeitura = '';
  const falha = e => { erroLeitura = e.code === 'permission-denied' ? 'Sem permissão para ler o Radar. As regras do Firestore do Radar ainda não foram publicadas (veja docs/radar.md).' : 'Não consegui ler o Radar: ' + e.message; desenhar(); };
  const col = n => F.collection(db, n);
  unsub.push(F.onSnapshot(col('radar_empreendimentos'), s => { emps = s.docs.map(d => ({ id: d.id, ...d.data() })); desenhar(); }, falha));
  unsub.push(F.onSnapshot(F.query(col('radar_alertas'), F.orderBy('criado', 'desc'), F.limit(100)), s => { alertas = s.docs.map(d => ({ id: d.id, ...d.data() })); desenhar(); }, falha));
  unsub.push(F.onSnapshot(F.query(col('radar_execucoes'), F.orderBy('inicio', 'desc'), F.limit(30)), s => { execs = s.docs.map(d => ({ id: d.id, ...d.data() })); desenhar(); }, falha));
  unsub.push(F.onSnapshot(col('radar_fontes'), s => { fontes = s.docs.map(d => ({ id: d.id, ...d.data() })); desenhar(); }, falha));
  unsub.push(F.onSnapshot(F.doc(db, 'radar_config', 'geral'), s => { config = s.exists() ? s.data() : {}; desenhar(); }, falha));
}

const ativos = () => emps.filter(e => e.revisao?.status !== 'descartado');
const naoLidos = () => alertas.filter(a => !(a.lidoPor || []).includes(perfil?.uid));
const ultimaExec = () => execs[0];

function filtrados() {
  const q = semAc(filtro.q), qd = dig(filtro.q);
  return ativos().filter(e => {
    if (filtro.mun && e.ibge !== filtro.mun) return false;
    if (filtro.cat && e.categoria !== filtro.cat) return false;
    if (filtro.sit && e.situacao !== filtro.sit) return false;
    if (filtro.conf && e.confianca !== filtro.conf) return false;
    const d = String(e.ultimaData || '').slice(0, 10);
    if (filtro.de && d < filtro.de) return false;
    if (filtro.ate && d > filtro.ate) return false;
    if (q) {
      const alvo = semAc([e.razao, e.fantasia, e.municipio, ...(e.processos || []).map(p => p.numero)].join(' '));
      const nums = [dig(e.cnpj), ...(e.processos || []).map(p => dig(p.numero))].join(' ');
      if (!alvo.includes(q) && !(qd.length >= 4 && nums.includes(qd))) return false;
    }
    return true;
  }).sort((a, b) => String(b.ultimaData || '').localeCompare(String(a.ultimaData || '')));
}

function desenhar() {
  if (!area || !area.isConnected || !perfil) return;
  if (erroLeitura) { area.innerHTML = cab() + `<p class="crmmsg">${esc(erroLeitura)}</p>`; ligarCab(); return; }
  const abas = [['geral', 'Visão geral'], ['lista', `Empreendimentos (${ativos().length})`], ['mapa', 'Mapa'], ['docs', 'Documentos'], ['fontes', 'Fontes e execuções'], ['alertas', `Alertas${naoLidos().length ? ' (' + naoLidos().length + ')' : ''}`]];
  if (admin) abas.push(['config', 'Configuração']);
  if (!abas.some(a => a[0] === aba)) aba = 'geral';
  area.innerHTML = cab() + kpis() + `<div class="tools"><span class="pmodo rdnav" role="group" aria-label="Parte do Radar">${abas.map(([id, n]) => `<button type="button" data-raba="${id}" aria-pressed="${aba === id}">${n}</button>`).join('')}</span></div><div id="rdCorpo"></div>`;
  ligarCab();
  area.querySelectorAll('[data-raba]').forEach(b => b.onclick = () => { aba = b.dataset.raba; desenhar(); });
  const corpo = $('rdCorpo');
  ({ geral: vGeral, lista: vLista, mapa: vMapa, docs: vDocs, fontes: vFontes, alertas: vAlertas, config: vConfig })[aba](corpo);
}

function cab() {
  const u = ultimaExec(), ped = config.pedido && !config.pedido.atendido;
  return `<div class="rdcab"><div><b class="rdtit">Radar de Novos Postos – MT</b><small>${u ? `Última execução: ${quando(u.inicio)} · ${u.status === 'ok' ? 'concluída' : u.status === 'erro' ? 'com erro' : esc(u.status || '')}${u.teste ? ' (teste, sem gravar)' : ''}` : 'O robô ainda não gravou nenhuma execução.'}</small></div>
    ${admin ? `<button type="button" id="rdAgora" ${ped ? 'disabled' : ''}>${ped ? 'Pesquisa pedida, aguardando o robô…' : 'Pesquisar agora'}</button>` : ''}</div><p id="rdMsg" class="crmmsg" role="status" hidden></p>`;
}
function ligarCab() {
  const b = $('rdAgora'); if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    try { await F.setDoc(F.doc(db, 'radar_config', 'geral'), { pedido: { em: F.serverTimestamp(), por: perfil.nome || perfil.email, atendido: false } }, { merge: true }); msg('Pedido registrado. O robô confere a cada 15 minutos e começa a pesquisa na próxima checagem.'); }
    catch (e) { b.disabled = false; msg('Não consegui registrar o pedido: ' + e.message); }
  };
}
function msg(t) { const el = $('rdMsg'); if (!el) return; el.textContent = t; el.hidden = !t; clearTimeout(msg.t); msg.t = setTimeout(() => { el.hidden = true; }, 8000); }

function kpis() {
  const a = ativos(), d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const temEv = (e, re) => (e.eventos || []).some(x => re.test(x));
  const k = [
    ['Empreendimentos', a.length],
    ['Novos em 30 dias', a.filter(e => String(e.primeiraData || '').slice(0, 10) >= d30).length],
    ['LP solicitadas', a.filter(e => temEv(e, /^req_lp/)).length],
    ['LI solicitadas', a.filter(e => temEv(e, /^req_(li|lp_li)/)).length],
    ['Em análise', a.filter(e => e.situacao === 'solicitado' || e.situacao === 'analise').length],
    ['Fontes monitoradas', fontes.filter(f => f.situacao === 'integrada' && f.ativa !== false).length],
    ['Alertas pendentes', naoLidos().length],
    ['Aguardando revisão', a.filter(e => !e.revisao || e.revisao.status === 'pendente').length]
  ];
  return `<div class="rdkpis">${k.map(([n, v]) => `<div class="rdkpi"><b>${v}</b><small>${n}</small></div>`).join('')}</div>`;
}

function linha(e) {
  const p = (e.processos || [])[0] || {};
  return `<button type="button" class="crmrow rdrow" data-eid="${esc(e.id)}"><span><b>${esc(e.razao || e.fantasia || '(empresa não identificada)')}</b><small>${esc(e.municipio || 'Município não identificado')}${e.cnpj ? ' · ' + fmtCnpj(e.cnpj) : ''}${p.numero ? ' · Proc. ' + esc(p.numero) : ''}</small></span>
    <span><small>${esc(CATEGORIAS[e.categoria] || '')}</small><small>${esc(EVENTOS[e.ultimoEvento] || '')}</small></span>
    <span><span class="pill rdconf ${esc(e.confianca || '')}">${esc(CONFIANCA[e.confianca] || 'Sem classificação')}</span><small>${fmtD(e.ultimaData)}</small></span></button>`;
}
const ligarLinhas = el => el.querySelectorAll('[data-eid]').forEach(b => b.onclick = () => detalhe(b.dataset.eid));

function vazio() {
  if (!execs.length) return '<div class="teleembreve"><span class="pill">Aguardando o robô</span><b>Nenhum dado coletado ainda</b><small>O robô do Radar roda no GitHub Actions e grava aqui o que encontrar nas fontes públicas. Enquanto a chave do Firebase não estiver configurada, ele só roda em modo de teste, sem gravar. Nenhum dado fictício é mostrado.</small></div>';
  return '<p class="hint">Nenhum empreendimento com esses filtros.</p>';
}

function vGeral(el) {
  const a = ativos();
  if (!a.length) { el.innerHTML = vazio(); return; }
  const porMun = {}; a.forEach(e => { const m = e.municipio || 'Não identificado'; porMun[m] = (porMun[m] || 0) + 1; });
  const top = Object.entries(porMun).sort((x, y) => y[1] - x[1]).slice(0, 10), max = top[0]?.[1] || 1;
  const rec = [...a].sort((x, y) => ms(y.identificado) - ms(x.identificado) || String(y.ultimaData).localeCompare(String(x.ultimaData))).slice(0, 8);
  el.innerHTML = `<div class="rdgeral"><div class="crmbloco"><h4>Identificados por último</h4><div class="crmlist">${rec.map(linha).join('')}</div></div>
    <div class="crmbloco"><h4>Empreendimentos por município</h4><div class="rdbarras">${top.map(([m, n]) => `<button type="button" class="rdbarra" data-mun="${esc(m)}"><span>${esc(m)}</span><i style="width:${Math.max(6, n / max * 100)}%"></i><b>${n}</b></button>`).join('')}</div></div></div>`;
  ligarLinhas(el);
  el.querySelectorAll('[data-mun]').forEach(b => b.onclick = () => { const e = a.find(x => (x.municipio || 'Não identificado') === b.dataset.mun); filtro.mun = e?.ibge || ''; aba = 'lista'; desenhar(); });
}

function filtrosHtml() {
  const muns = [...new Map(ativos().filter(e => e.ibge).map(e => [e.ibge, e.municipio])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const opt = (obj, cur, todos) => `<option value="">${todos}</option>` + Object.entries(obj).map(([k, n]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(n)}</option>`).join('');
  return `<div class="tools rdfiltros">
    <input id="rfQ" type="search" placeholder="Empresa, CNPJ ou nº do processo" value="${esc(filtro.q)}" autocomplete="off">
    <select id="rfMun"><option value="">Todos os municípios</option>${muns.map(([id, n]) => `<option value="${id}" ${filtro.mun === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <select id="rfCat">${opt(CATEGORIAS, filtro.cat, 'Todas as categorias')}</select>
    <select id="rfSit">${opt(SITUACOES, filtro.sit, 'Todas as situações')}</select>
    <select id="rfConf">${opt(CONFIANCA, filtro.conf, 'Qualquer confiança')}</select>
    <label>De<input id="rfDe" type="date" value="${filtro.de}"></label><label>Até<input id="rfAte" type="date" value="${filtro.ate}"></label>
    ${Object.values(filtro).some(Boolean) ? '<button type="button" class="linkbtn" id="rfLimpa">Limpar filtros</button>' : ''}</div>`;
}
function ligarFiltros(el, redesenhar) {
  const set = (id, k, ev = 'change') => { const i = $(id); if (i) i.addEventListener(ev, () => { filtro[k] = i.value.trim(); redesenhar(); }); };
  set('rfMun', 'mun'); set('rfCat', 'cat'); set('rfSit', 'sit'); set('rfConf', 'conf'); set('rfDe', 'de'); set('rfAte', 'ate');
  const q = $('rfQ'); if (q) q.addEventListener('input', () => { filtro.q = q.value; clearTimeout(q.t); q.t = setTimeout(redesenhar, 250); });
  const l = $('rfLimpa'); if (l) l.onclick = () => { Object.keys(filtro).forEach(k => filtro[k] = ''); desenhar(); };
}

function vLista(el) {
  el.innerHTML = filtrosHtml() + '<div id="rdLista" class="crmlist"></div>';
  const pinta = () => { const f = filtrados(); $('rdLista').innerHTML = f.length ? `<small class="hint">${f.length} empreendimento(s)</small>` + f.map(linha).join('') : vazio(); ligarLinhas($('rdLista')); };
  ligarFiltros(el, pinta); pinta();
}

function vMapa(el) {
  el.innerHTML = filtrosHtml() + '<div id="rdMapa" class="rdmapa"></div><p class="hint">Ponto cheio: endereço exato (base da ANP ou documento). Ponto vazado: centro do município, localização aproximada.</p>';
  carregarLeaflet().then(L => {
    if (mapa) { mapa.remove(); mapa = null; }
    mapa = L.map('rdMapa', { scrollWheelZoom: false }).setView([-12.9, -55.9], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(mapa);
    const pinta = () => {
      if (camada) camada.remove(); camada = L.layerGroup().addTo(mapa);
      const cor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#FF5A1F';
      filtrados().filter(e => e.lat && e.lng).forEach(e => {
        const exato = e.coordFonte && e.coordFonte !== 'municipio';
        const p = (e.processos || [])[0] || {}, d = (e.docs || [])[0] || {};
        L.circleMarker([e.lat, e.lng], { radius: exato ? 7 : 6, color: cor, weight: 2, fillColor: cor, fillOpacity: exato ? .85 : .15 }).addTo(camada)
          .bindPopup(`<b>${esc(e.razao || '(empresa não identificada)')}</b><br>${esc(e.municipio || '')} – MT<br>${e.endereco ? esc(e.endereco) + '<br>' : ''}Processo: ${esc(p.numero || 'pendente')}<br>Licença: ${esc(EVENTOS[e.ultimoEvento] || '')}<br>Situação: ${esc(SITUACOES[e.situacao] || '')}<br>Identificado em ${quando(e.identificado)}${d.url ? `<br><a href="${esc(d.url)}" target="_blank" rel="noopener">Documento original</a>` : ''}`);
      });
    };
    ligarFiltros(el, pinta); pinta();
  }).catch(() => { $('rdMapa').innerHTML = '<p class="hint">Não consegui carregar o mapa (sem internet?).</p>'; });
}
function carregarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return carregarLeaflet.p ||= new Promise((ok, falha) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; s.onload = () => ok(window.L); s.onerror = () => { carregarLeaflet.p = null; falha(); }; document.head.appendChild(s);
  });
}

async function vDocs(el) {
  el.innerHTML = '<p class="hint">Carregando os documentos mais recentes…</p>';
  try {
    const s = await F.getDocs(F.query(F.collection(db, 'radar_documentos'), F.orderBy('coletado', 'desc'), F.limit(100)));
    const ds = s.docs.map(d => ({ id: d.id, ...d.data() }));
    el.innerHTML = ds.length ? `<div class="crmlist">${ds.map(d => `<div class="crmrow rddoc"><span><b>${esc(d.titulo || d.fonteNome || d.fonte)}</b><small>${esc(d.fonteNome || d.fonte)} · publicado em ${fmtD(d.dataPublicacao)} · coletado em ${quando(d.coletado)}</small><small class="rdtrecho">${esc(String(d.trecho || '').slice(0, 280))}…</small></span>
      <span><small>${esc(EVENTOS[d.evento] || '')}</small><small>${esc(d.municipio || '')}</small></span><span><span class="pill rdconf ${esc(d.confianca || '')}">${esc(CONFIANCA[d.confianca] || '')}</span>${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">Abrir original</a>` : ''}${d.eid ? `<button type="button" class="linkbtn" data-eid="${esc(d.eid)}">Ver empreendimento</button>` : ''}</span></div>`).join('')}</div>` : vazio();
    ligarLinhas(el);
  } catch (e) { el.innerHTML = `<p class="crmmsg">Não consegui ler os documentos: ${esc(e.message)}</p>`; }
}

function vFontes(el) {
  const porId = Object.fromEntries(fontes.map(f => [f.id, f]));
  const todas = [...FONTES_PREVISTAS, ...fontes.filter(f => !FONTES_PREVISTAS.some(p => p.id === f.id))];
  const sit = f => { const r = porId[f.id]; if (!r || r.situacao !== 'integrada') return `<span class="pill">Não integrada</span>${f.obs ? `<small>${esc(f.obs)}</small>` : ''}`; if (r.ativa === false) return '<span class="pill">Desligada</span>'; return `<span class="pill rdconf ${r.ultimoErro ? 'nao_confirmado' : 'confirmado'}">${r.ultimoErro ? 'Com erro na última coleta' : 'Monitorada'}</span><small>Última coleta ok: ${quando(r.ultimaOk) || '—'}</small>${r.ultimoErro ? `<small class="rderro">${esc(r.ultimoErro)}</small>` : ''}`; };
  el.innerHTML = `<div class="crmbloco"><h4>Fontes</h4><div class="crmlist">${todas.map(f => `<div class="crmrow"><span><b>${esc(porId[f.id]?.nome || f.nome)}</b><small><a href="${esc(porId[f.id]?.url || f.url)}" target="_blank" rel="noopener">${esc(porId[f.id]?.url || f.url)}</a></small></span><span></span><span>${sit(f)}</span></div>`).join('')}</div></div>
  <div class="crmbloco"><h4>Execuções do robô</h4>${execs.length ? `<div class="crmlist">${execs.map(x => `<div class="crmrow"><span><b>${quando(x.inicio)}${x.teste ? ' · teste' : ''}</b><small>${esc(x.gatilho === 'manual' ? 'Pedido manual' + (x.pedidoPor ? ' de ' + x.pedidoPor : '') : 'Agendada')} · ${x.duracaoSeg ? x.duracaoSeg + ' s' : ''}</small><small>${Object.entries(x.porFonte || {}).map(([k, v]) => `${esc(k)}: ${v.docs ?? 0} doc., ${v.novos ?? 0} novos${v.erro ? ' · erro: ' + esc(v.erro) : ''}`).join(' · ')}</small></span><span><small>${x.novos ?? 0} novos · ${x.atualizados ?? 0} atualizados</small></span><span><span class="pill rdconf ${x.status === 'ok' ? 'confirmado' : 'nao_confirmado'}">${x.status === 'ok' ? 'Concluída' : esc(x.status || '')}</span></span></div>`).join('')}</div>` : '<p class="hint">Nenhuma execução gravada ainda.</p>'}</div>`;
}

function vAlertas(el) {
  if (!alertas.length) { el.innerHTML = '<p class="hint">Nenhum alerta ainda. O robô cria um alerta quando acha um empreendimento novo ou uma mudança relevante.</p>'; return; }
  const nl = naoLidos();
  el.innerHTML = (nl.length ? '<div class="tools"><button type="button" id="rdLerTodos">Marcar todos como lidos</button></div>' : '') + `<div class="crmlist">${alertas.map(a => { const lido = (a.lidoPor || []).includes(perfil.uid); return `<div class="crmrow rdalerta ${lido ? 'lido' : ''}"><span><b>${esc(a.titulo)}</b><small class="rdpre">${esc(a.texto)}</small></span><span><small>${quando(a.criado)}</small></span><span>${a.eid ? `<button type="button" class="linkbtn" data-eid="${esc(a.eid)}">Ver</button>` : ''}${lido ? '' : `<button type="button" class="linkbtn" data-ler="${esc(a.id)}">Marcar lido</button>`}</span></div>`; }).join('')}</div>`;
  ligarLinhas(el);
  const ler = ids => Promise.all(ids.map(id => F.updateDoc(F.doc(db, 'radar_alertas', id), { lidoPor: F.arrayUnion(perfil.uid) }))).catch(e => msg('Não consegui marcar: ' + e.message));
  el.querySelectorAll('[data-ler]').forEach(b => b.onclick = () => ler([b.dataset.ler]));
  const t = $('rdLerTodos'); if (t) t.onclick = () => ler(nl.map(a => a.id));
}

function vConfig(el) {
  const freq = config.frequenciaHoras || 24, porId = Object.fromEntries(fontes.map(f => [f.id, f]));
  el.innerHTML = `<div class="crmbloco"><h4>Frequência do robô</h4><label>Pesquisar a cada<select id="rcFreq">${[6, 12, 24, 48, 72].map(h => `<option value="${h}" ${h === freq ? 'selected' : ''}>${h} horas</option>`).join('')}</select></label><small class="hint">O robô confere a cada 15 minutos e só pesquisa quando passou esse tempo desde a última pesquisa completa, ou quando alguém usa "Pesquisar agora".</small></div>
  <div class="crmbloco"><h4>Fontes ligadas</h4>${fontes.length ? fontes.map(f => `<label class="chk"><input type="checkbox" data-fonte="${esc(f.id)}" ${f.ativa !== false ? 'checked' : ''}> ${esc(f.nome || f.id)}</label>`).join('') : '<p class="hint">As fontes aparecem aqui depois da primeira execução do robô.</p>'}</div>
  <div class="crmbloco"><h4>Alertas</h4><label class="chk"><input type="checkbox" checked disabled> Dentro do app (aba Alertas)</label><label class="chk"><input type="checkbox" disabled> E-mail (Entrega 3: depende de uma conta de envio)</label><label class="chk"><input type="checkbox" disabled> WhatsApp (depende da API oficial da Meta)</label></div>`;
  $('rcFreq').onchange = e => F.setDoc(F.doc(db, 'radar_config', 'geral'), { frequenciaHoras: Number(e.target.value), alteradoPor: perfil.nome || perfil.email }, { merge: true }).then(() => msg('Frequência salva.')).catch(x => msg('Não consegui salvar: ' + x.message));
  el.querySelectorAll('[data-fonte]').forEach(c => c.onchange = () => F.updateDoc(F.doc(db, 'radar_fontes', c.dataset.fonte), { ativa: c.checked }).then(() => msg('Fonte ' + (c.checked ? 'ligada' : 'desligada') + '.')).catch(x => msg('Não consegui salvar: ' + x.message)));
}

/* ---------- Detalhe do empreendimento ---------- */
async function detalhe(eid) {
  const e = emps.find(x => x.id === eid); if (!e) return;
  let dlg = $('rdDlg');
  if (!dlg) { document.body.insertAdjacentHTML('beforeend', '<dialog id="rdDlg" class="tkdlg" aria-labelledby="rdDlgTit"><div class="tkdlghead"><h3 id="rdDlgTit"></h3><button type="button" id="rdDlgFechar" aria-label="Fechar">✕</button></div><div id="rdDlgBody"></div><p id="rdDlgMsg" class="hint" role="status"></p></dialog>'); dlg = $('rdDlg'); $('rdDlgFechar').onclick = () => dlg.close(); }
  $('rdDlgTit').textContent = e.razao || e.fantasia || 'Empreendimento';
  $('rdDlgMsg').textContent = '';
  const rev = e.revisao || {};
  $('rdDlgBody').innerHTML = `<div class="crmleadf">
    <div class="crmbloco"><h4>Empresa</h4><dl class="rddl">
      <dt>Razão social</dt><dd>${val(e.razao)}</dd><dt>Nome fantasia</dt><dd>${val(e.fantasia)}</dd><dt>CNPJ</dt><dd>${e.cnpj ? fmtCnpj(e.cnpj) : PEND}</dd>
      <dt>Município</dt><dd>${e.municipio ? esc(e.municipio) + ' – MT' : PEND}</dd><dt>Endereço</dt><dd>${val(e.endereco)}</dd>
      <dt>Coordenadas</dt><dd>${e.lat ? `${e.lat}, ${e.lng} <small>(${e.coordFonte === 'anp' ? 'base da ANP' : e.coordFonte === 'documento' ? 'documento' : 'centro do município, aproximado'})</small>` : PEND}</dd>
      <dt>Categoria</dt><dd>${esc(CATEGORIAS[e.categoria] || '')}</dd><dt>Situação</dt><dd>${esc(SITUACOES[e.situacao] || '')}</dd>
      <dt>Confiança</dt><dd><span class="pill rdconf ${esc(e.confianca || '')}">${esc(CONFIANCA[e.confianca] || '')}</span></dd>
      <dt>Na base da ANP</dt><dd>${e.anp ? `Sim, posto autorizado${e.anp.bandeira ? ' · ' + esc(e.anp.bandeira) : ''}${e.anp.autorizacao ? ' · autorização ' + esc(e.anp.autorizacao) : ''}` : (e.cnpj ? 'Não: o CNPJ ainda não aparece como posto autorizado' : 'Sem CNPJ para conferir')}</dd>
      <dt>Identificado pelo robô</dt><dd>${quando(e.identificado)}</dd></dl></div>
    <div class="crmbloco"><h4>Processos</h4>${(e.processos || []).length ? `<div class="crmlist">${e.processos.map(p => `<div class="crmrow"><span><b>${p.numero ? 'Processo ' + esc(p.numero) : 'Número do processo ' + PEND}</b><small>${esc(p.orgao || 'Órgão pendente')}${p.protocolo ? ' · protocolo da publicação ' + esc(p.protocolo) : ''}</small></span><span><small>${esc(EVENTOS[p.evento] || '')}</small></span><span><small>${fmtD(p.data)}</small></span></div>`).join('')}</div>` : '<p class="hint">Nenhum processo identificado.</p>'}</div>
    <div class="crmbloco"><h4>Documentos e evidências</h4><div id="rdDlgDocs" class="crmlist"><p class="hint">Carregando…</p></div></div>
    <div class="crmbloco"><h4>Histórico</h4><div id="rdDlgHist" class="crmlist"><p class="hint">Carregando…</p></div></div>
    <div class="crmbloco"><h4>Revisão</h4><p class="hint" style="margin:0">${rev.status && rev.status !== 'pendente' ? `${rev.status === 'confirmado' ? 'Confirmado' : 'Descartado'} por ${esc(rev.por || '')} em ${quando(rev.em)}${rev.nota ? ': ' + esc(rev.nota) : ''}` : 'Aguardando revisão de um administrador.'}</p>
      ${admin ? `<label>Observação<input id="rdNota" value="${esc(rev.nota || '')}" autocomplete="off"></label><div class="tools"><button type="button" class="primary" data-rev="confirmado">Confirmar</button><button type="button" data-rev="descartado">Descartar (não é posto ou é duplicado)</button>${rev.status && rev.status !== 'pendente' ? '<button type="button" data-rev="pendente">Voltar para pendente</button>' : ''}</div>` : ''}
      <div class="tools"><button type="button" id="rdCrm">${e.leadId ? 'Já está no CRM' : 'Criar lead no CRM'}</button></div></div></div>`;
  dlg.showModal();
  dlg.querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => {
    const nota = $('rdNota').value.trim(), status = b.dataset.rev;
    try {
      await F.updateDoc(F.doc(db, 'radar_empreendimentos', eid), { revisao: { status, nota, por: perfil.nome || perfil.email, em: F.serverTimestamp() } });
      await F.addDoc(F.collection(db, 'radar_historico'), { eid, tipo: 'revisao', de: rev.status || 'pendente', para: status, nota, por: perfil.nome || perfil.email, em: F.serverTimestamp() });
      $('rdDlgMsg').textContent = 'Revisão salva.'; setTimeout(() => detalhe(eid), 300);
    } catch (x) { $('rdDlgMsg').textContent = 'Não consegui salvar: ' + x.message; }
  });
  const bc = $('rdCrm'); if (e.leadId) bc.disabled = true;
  bc.onclick = async () => {
    bc.disabled = true;
    try {
      const ref = await F.addDoc(F.collection(db, 'crm'), { tipo: 'lead', empresa: e.razao || e.fantasia || '', cnpj: dig(e.cnpj), cidade: e.municipio ? e.municipio + ' - MT' : '', etapa: 'lead', origem: 'Prospecção ativa', contato: '', fone: '', email: '', contatos: [], prox: '', motivo: '', obs: `Radar de Novos Postos: ${EVENTOS[e.ultimoEvento] || ''} (${fmtD(e.ultimaData)})`, radar: eid, notas: [], owner: perfil.uid, vendedor: perfil.nome || perfil.email || '', criado: F.serverTimestamp() });
      await F.updateDoc(F.doc(db, 'radar_empreendimentos', eid), { leadId: ref.id }).catch(() => {});
      $('rdDlgMsg').textContent = 'Lead criado no CRM.'; bc.textContent = 'Já está no CRM';
    } catch (x) { bc.disabled = false; $('rdDlgMsg').textContent = 'Não consegui criar o lead: ' + x.message; }
  };
  try {
    const [ds, hs] = await Promise.all([
      F.getDocs(F.query(F.collection(db, 'radar_documentos'), F.where('eid', '==', eid))),
      F.getDocs(F.query(F.collection(db, 'radar_historico'), F.where('eid', '==', eid)))]);
    const docs = ds.docs.map(d => d.data()).sort((a, b) => String(b.dataPublicacao).localeCompare(String(a.dataPublicacao)));
    $('rdDlgDocs').innerHTML = docs.length ? docs.map(d => `<div class="crmrow rddoc"><span><b>${esc(d.fonteNome || d.fonte)} · ${fmtD(d.dataPublicacao)}</b><small>${esc(EVENTOS[d.evento] || '')} · coletado em ${quando(d.coletado)}</small><small class="rdtrecho">${esc(d.trecho || '')}</small></span><span></span><span>${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">Abrir original</a>` : ''}</span></div>`).join('') : '<p class="hint">Nenhum documento.</p>';
    const hist = hs.docs.map(d => d.data()).sort((a, b) => ms(b.em) - ms(a.em));
    $('rdDlgHist').innerHTML = hist.length ? hist.map(h => `<div class="crmrow"><span><b>${esc(h.descricao || (h.tipo === 'revisao' ? `Revisão: ${h.de} → ${h.para}` : h.tipo))}</b><small>${esc(h.por || 'robô')}${h.nota ? ' · ' + esc(h.nota) : ''}</small></span><span></span><span><small>${quando(h.em)}</small></span></div>`).join('') : '<p class="hint">Sem histórico.</p>';
  } catch (x) { $('rdDlgDocs').innerHTML = `<p class="hint">Não consegui carregar: ${esc(x.message)}</p>`; $('rdDlgHist').innerHTML = ''; }
}

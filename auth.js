// Consulta de CNPJ (BrasilAPI, CNPJ.ws ou minhareceita, o que responder primeiro), com os dados principais
window.cnpjInfo = async d => {
  d = String(d || '').replace(/\D/g, ''); if (d.length !== 14) return null;
  const js = u => fetch(u).then(x => { if (!x.ok) throw 0; return x.json(); });
  const tel = (...v) => v.filter(Boolean).map(x => String(x).replace(/\D/g, '')).filter(x => x.length >= 8)[0] || '';
  const rf = j => j.razao_social ? { razao: j.razao_social, fantasia: j.nome_fantasia || '', situacao: j.descricao_situacao_cadastral || '', abertura: j.data_inicio_atividade || '', atividade: j.cnae_fiscal_descricao || '', endereco: [[j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' '), j.numero, j.complemento, j.bairro].filter(Boolean).join(', '), municipio: j.municipio || '', uf: j.uf || '', cep: j.cep || '', telefone: tel(j.ddd_telefone_1, j.ddd_telefone_2), email: (j.email || '').toLowerCase(), socios: (j.qsa || []).map(x => ({ nome: x.nome_socio || x.nome || '', qual: x.qualificacao_socio || '' })) } : Promise.reject(0);
  const ws = j => { const e = j.estabelecimento || {}; return j.razao_social ? { razao: j.razao_social, fantasia: e.nome_fantasia || '', situacao: e.situacao_cadastral || '', abertura: e.data_inicio_atividade || '', atividade: (e.atividade_principal || {}).descricao || '', endereco: [[e.tipo_logradouro, e.logradouro].filter(Boolean).join(' '), e.numero, e.complemento, e.bairro].filter(Boolean).join(', '), municipio: (e.cidade || {}).nome || '', uf: (e.estado || {}).sigla || '', cep: e.cep || '', telefone: tel((e.ddd1 || '') + (e.telefone1 || '')), email: (e.email || '').toLowerCase(), socios: (j.socios || []).map(x => ({ nome: x.nome || '', qual: (x.qualificacao_socio || {}).descricao || '' })) } : Promise.reject(0); };
  const r = await Promise.any([js('https://brasilapi.com.br/api/cnpj/v1/' + d).then(rf), js('https://publica.cnpj.ws/cnpj/' + d).then(ws), js('https://minhareceita.org/' + d).then(rf)]).catch(() => null);
  if (r) { r.cnpj = d; Object.keys(r).forEach(k => { if (typeof r[k] === 'string') r[k] = r[k].replace(/\s+/g, ' ').trim(); }); }
  if (r) r.socios = (r.socios || []).map(x => ({ nome: String(x.nome).replace(/\s+/g, ' ').trim(), qual: String(x.qual).replace(/\s+/g, ' ').trim() })).filter(x => x.nome);
  return r;
};
// Login, perfis e tela de usuários (Firebase). Só roda quando firebase-config.js tem apiKey.
const C = window.FIREBASE_CONFIG || {};
if (C.apiKey) iniciar().catch(e => { console.error(e); erroLogin('Não foi possível carregar o login. Verifique a internet e recarregue.'); });

function erroLogin(t) { const b = document.getElementById('loginBox'); if (b) { b.hidden = false; document.getElementById('loginMsg').textContent = t; } }

async function iniciar() {
  const V = '10.12.2', base = `https://www.gstatic.com/firebasejs/${V}/`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  const app = initializeApp(C);
  const auth = A.getAuth(app);
  let db; try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache() }); } catch (e) { db = F.getFirestore(app); }
  const $ = id => document.getElementById(id);
  const body = document.body;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PARAM = F.doc(db, 'config', 'parametros');
  let perfil = null;

  const fb = window.argoFb = { admin: false, carregar, publicar };

  /* ---------- Login ---------- */
  const box = $('loginBox'), lmsg = t => { $('loginMsg').textContent = t };
  function mostrarLogin(t) { body.classList.add('locked'); box.hidden = false; if (t) lmsg(t); setTimeout(() => $('l-email').focus(), 50); }
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('l-email').value.trim(), senha = $('l-senha').value;
    if (!email || !senha) { lmsg('Informe e-mail e senha.'); return; }
    $('btnLogin').disabled = true; lmsg('Entrando…');
    try { senhaDigitada = senha; await A.signInWithEmailAndPassword(auth, email, senha); $('l-senha').value = ''; }
    catch (err) {
      const c = err.code || '';
      lmsg(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c) ? 'E-mail ou senha incorretos.' :
        /too-many-requests/.test(c) ? 'Muitas tentativas. Espere alguns minutos ou use "Esqueci minha senha".' :
        /network/.test(c) ? 'Sem internet. Conecte-se para entrar.' : 'Não foi possível entrar (' + c + ').');
    } finally { $('btnLogin').disabled = false; }
  });
  $('btnEsqueci').addEventListener('click', async () => {
    const email = $('l-email').value.trim();
    if (!email) { lmsg('Digite seu e-mail acima e toque de novo em "Esqueci minha senha".'); $('l-email').focus(); return; }
    try { await A.sendPasswordResetEmail(auth, email); lmsg('Se o e-mail estiver cadastrado, chega um link para criar nova senha. Veja também o spam.'); }
    catch (err) { lmsg('Não foi possível enviar (' + (err.code || 'erro') + ').'); }
  });
  $('btnSair').addEventListener('click', () => A.signOut(auth));

  /* ---------- Troca de senha obrigatória no primeiro acesso ---------- */
  let senhaDigitada = '', trocaOk = null;
  const sbox = $('senhaBox'), smsg = t => { $('senhaMsg').textContent = t };
  function exigirTroca() {
    box.hidden = true; body.classList.add('locked'); sbox.hidden = false;
    $('s-nova').value = ''; $('s-conf').value = '';
    setTimeout(() => $('s-nova').focus(), 50);
    return new Promise(res => { trocaOk = res; });
  }
  $('btnSenhaSair').addEventListener('click', () => { sbox.hidden = true; trocaOk = null; A.signOut(auth); });
  $('senhaForm').addEventListener('submit', async e => {
    e.preventDefault();
    const nova = $('s-nova').value, conf = $('s-conf').value;
    if (nova.length < 6) { smsg('A nova senha precisa ter pelo menos 6 caracteres.'); return; }
    if (nova !== conf) { smsg('As duas senhas não são iguais. Digite de novo.'); return; }
    if (senhaDigitada && nova === senhaDigitada) { smsg('A nova senha tem que ser diferente da senha inicial.'); return; }
    const u = auth.currentUser; if (!u) return;
    $('btnSenha').disabled = true; smsg('Salvando…');
    try {
      await A.updatePassword(u, nova);
      await F.updateDoc(F.doc(db, 'usuarios', u.uid), { trocarSenha: false, senhaTrocadaEm: F.serverTimestamp() });
      senhaDigitada = ''; sbox.hidden = true;
      const r = trocaOk; trocaOk = null; if (r) r();
    } catch (err) {
      const c = err.code || '';
      smsg(/requires-recent-login/.test(c) ? 'Por segurança, saia e entre de novo com a senha inicial para trocar.' :
        /weak-password/.test(c) ? 'Senha fraca: use pelo menos 6 caracteres.' :
        /network|unavailable/.test(c) ? 'Sem internet. Conecte-se e tente de novo.' : 'Não foi possível trocar a senha (' + c + ').');
    } finally { $('btnSenha').disabled = false; }
  });

  /* ---------- Cadastro no primeiro acesso: nome completo, estado de atuação e foto do rosto ---------- */
  const fbox = $('fotoBox'), fmsg = (t, ok) => { const m = $('fotoMsg'); m.textContent = t || ''; m.classList.toggle('ok', !!ok); };
  const CAD_UF = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
  $('cadUfs').innerHTML = Object.keys(CAD_UF).map(uf => `<label class="uuf" title="${CAD_UF[uf]}"><input type="checkbox" data-uf="${uf}"><span>${uf}</span></label>`).join('');
  const cadUfsMarcadas = () => [...$('cadUfs').querySelectorAll('input:checked')].map(x => x.dataset.uf);
  const cadUfConta = () => { const n = cadUfsMarcadas().length; $('cadUfN').textContent = n ? n + (n === 1 ? ' estado marcado' : ' estados marcados') : 'marque um ou mais'; };
  $('cadUfs').addEventListener('change', cadUfConta);
  const nomeCompleto = n => String(n || '').trim().split(/\s+/).filter(p => p.length >= 2).length >= 2;
  const limpaNome = n => String(n || '').replace(/\s+/g, ' ').trim();
  let fotoOk = null, fotoStream = null, fotoDado = '', cadCtx = null;
  const pararCam = () => { if (fotoStream) fotoStream.getTracks().forEach(t => t.stop()); fotoStream = null; };
  function modoFoto(tirada) { $('fotoVideo').hidden = tirada; $('fotoPrev').hidden = !tirada; $('btnFotoTirar').hidden = tirada; $('btnFotoRefazer').hidden = !tirada; }
  async function ligarCam() {
    modoFoto(false); fotoDado = ''; fmsg('');
    try { fotoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false }); $('fotoVideo').srcObject = fotoStream; $('btnFotoTirar').disabled = false; }
    catch (e) { $('btnFotoTirar').disabled = true; fmsg('Não foi possível abrir a câmera. Libere a câmera no navegador ou use "Enviar uma foto".'); }
  }
  // Recorta o centro em quadrado e reduz para 360 px em JPEG
  function reduzir(src, w, h, espelhar) {
    const lado = Math.min(w, h), c = document.createElement('canvas'); c.width = c.height = 360; const g = c.getContext('2d');
    if (espelhar) { g.translate(360, 0); g.scale(-1, 1); }
    g.drawImage(src, (w - lado) / 2, (h - lado) / 2, lado, lado, 0, 0, 360, 360);
    return c.toDataURL('image/jpeg', 0.82);
  }
  // ctx: { user, perfil (null = ainda não tem cadastro), foto (b64 já salvo ou '') }
  function exigirCadastro(ctx) {
    cadCtx = ctx; const p = ctx.perfil || {};
    box.hidden = true; body.classList.add('locked'); fbox.hidden = false; fmsg('');
    const novo = !ctx.perfil;
    $('cadTitulo').textContent = novo ? 'Crie seu cadastro' : 'Complete seu cadastro';
    $('cadIntro').textContent = novo ? `Primeiro acesso com ${ctx.user.email}. Preencha seus dados e envie: o administrador confere e libera o seu acesso.` : 'Antes de entrar, confirme seus dados. É rápido e só acontece uma vez.';
    $('btnFotoSalvar').textContent = novo ? 'Enviar cadastro' : 'Salvar e entrar';
    $('cadNome').value = nomeCompleto(p.nome) ? p.nome : '';
    const ufs = Array.isArray(p.estados) ? p.estados : [];
    $('cadUfs').querySelectorAll('input').forEach(i => { i.checked = ufs.includes(i.dataset.uf); }); cadUfConta();
    $('fotoAceite').checked = !!ctx.foto;
    if (ctx.foto) { pararCam(); fotoDado = ctx.foto; $('fotoPrev').src = ctx.foto; modoFoto(true); } else ligarCam();
    setTimeout(() => { if (!$('cadNome').value) $('cadNome').focus(); }, 50);
    return new Promise(res => { fotoOk = res; });
  }
  $('btnFotoTirar').addEventListener('click', () => { const v = $('fotoVideo'); if (!v.videoWidth) return; fotoDado = reduzir(v, v.videoWidth, v.videoHeight, true); $('fotoPrev').src = fotoDado; pararCam(); modoFoto(true); fmsg(''); });
  $('btnFotoRefazer').addEventListener('click', ligarCam);
  $('fotoArq').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return; const img = new Image();
    img.onload = () => { fotoDado = reduzir(img, img.naturalWidth, img.naturalHeight, false); URL.revokeObjectURL(img.src); $('fotoPrev').src = fotoDado; pararCam(); modoFoto(true); fmsg(''); };
    img.onerror = () => fmsg('Esse arquivo não é uma imagem válida.'); img.src = URL.createObjectURL(f); e.target.value = '';
  });
  $('btnFotoSair').addEventListener('click', () => { pararCam(); fbox.hidden = true; fotoOk = null; cadCtx = null; A.signOut(auth); });
  $('btnFotoSalvar').addEventListener('click', async () => {
    const ctx = cadCtx, u = auth.currentUser; if (!ctx || !u) return;
    const nome = limpaNome($('cadNome').value), estados = cadUfsMarcadas();
    if (!nomeCompleto(nome)) { fmsg('Digite seu nome completo (nome e sobrenome).'); $('cadNome').focus(); return; }
    if (!estados.length) { fmsg('Marque pelo menos um estado de atuação.'); return; }
    if (!fotoDado) { fmsg('Tire uma foto do rosto (ou envie uma) para continuar.'); return; }
    if (!$('fotoAceite').checked) { fmsg('Marque a autorização da foto para continuar.'); return; }
    $('btnFotoSalvar').disabled = true; fmsg('Salvando…', true);
    try {
      if (!ctx.perfil && !ctx.criado) {
        // Sem cadastro: cria como vendedor, bloqueado e aguardando o administrador liberar
        await F.setDoc(F.doc(db, 'usuarios', u.uid), { nome, email: (u.email || '').toLowerCase(), fone: '', papel: 'vendedor', papeis: ['vendedor'], estados, ativo: false, pendente: true, criado: F.serverTimestamp(), cadastroEm: F.serverTimestamp() });
        ctx.criado = true;
      }
      if (fotoDado !== ctx.foto) await F.setDoc(F.doc(db, 'fotos', u.uid), { b64: fotoDado, em: F.serverTimestamp(), aceite: true });
      if (ctx.perfil) await F.updateDoc(F.doc(db, 'usuarios', u.uid), { nome, estados, cadastroEm: F.serverTimestamp() });
      pararCam(); fbox.hidden = true; const r = fotoOk; fotoOk = null; cadCtx = null; if (r) r({ nome, estados });
    } catch (err) {
      const c = err.code || 'erro';
      fmsg(/permission/.test(c) ? (ctx.perfil ? 'O sistema ainda não permite salvar seus dados. Avise o administrador.' : 'O sistema ainda não aceita cadastros novos. Fale com o administrador.') + ' (' + c + ')' :
        /network|unavailable/.test(c) ? 'Sem internet. Conecte-se e tente de novo.' : 'Não foi possível salvar (' + c + '). Tente de novo.');
    } finally { $('btnFotoSalvar').disabled = false; }
  });
  // Foto já salva: '' se não tem; null se não deu para conferir (sem permissão ou sem internet)
  async function fotoSalva(uid) {
    try { const sn = await F.getDoc(F.doc(db, 'fotos', uid)); return sn.exists() ? (sn.data().b64 || '') : ''; }
    catch (e) { return null; }
  }
  // Pede o cadastro quando falta nome completo, estado de atuação ou foto
  const cadastroIncompleto = (p, foto) => foto === '' || !nomeCompleto(p.nome) || !(Array.isArray(p.estados) && p.estados.length);

  A.onAuthStateChanged(auth, async user => {
    perfil = null; fb.admin = false; fb.task = false; fb.temTask = false; body.classList.remove('is-admin', 'is-task', 'tem-task'); window.dispatchEvent(new Event('argo-sair'));
    if (!user) { sbox.hidden = true; trocaOk = null; fbox.hidden = true; fotoOk = null; cadCtx = null; pararCam(); }
    if (!user) { mostrarLogin('Entre com o e-mail e a senha que o administrador cadastrou para você.'); return; }
    try {
      const ref = F.doc(db, 'usuarios', user.uid);
      let snap = await F.getDoc(ref);
      if (!snap.exists()) {
        // Primeiro acesso do administrador: as regras só permitem para o e-mail do dono.
        try { await F.setDoc(ref, { nome: user.email.split('@')[0], email: user.email, fone: '', papel: 'adm', ativo: true, criado: F.serverTimestamp() }); snap = await F.getDoc(ref); }
        catch (e) { /* não é o dono */ }
      }
      if (!snap.exists()) {
        // Primeiro login de quem ainda não tem cadastro: pede os dados e deixa aguardando a liberação
        await exigirCadastro({ user, perfil: null, foto: (await fotoSalva(user.uid)) || '' });
        if (auth.currentUser?.uid !== user.uid) return;
        await A.signOut(auth); mostrarLogin('Cadastro enviado. O administrador vai conferir seus dados e liberar o seu acesso. Depois é só entrar de novo.'); return;
      }
      if (snap.data().ativo !== true) { await A.signOut(auth); mostrarLogin(snap.data().pendente ? 'Seu cadastro está aguardando a liberação do administrador.' : 'Seu acesso não está liberado. Fale com o administrador.'); return; }
      perfil = { uid: user.uid, ...snap.data() };
    } catch (e) {
      mostrarLogin(e.code === 'unavailable' ? 'Sem internet. Conecte-se para entrar.' : 'Não foi possível verificar seu acesso (' + (e.code || 'erro') + ').'); return;
    }
    if (perfil.trocarSenha === true) { await exigirTroca(); if (auth.currentUser?.uid !== user.uid) return; perfil.trocarSenha = false; }
    { const foto = await fotoSalva(user.uid); if (cadastroIncompleto(perfil, foto)) { const d = await exigirCadastro({ user, perfil, foto: foto || '' }); if (auth.currentUser?.uid !== user.uid) return; Object.assign(perfil, d); } }
    // Perfis: a pessoa pode ter mais de um (papeis); "papel" guarda o principal
    const papeis = Array.isArray(perfil.papeis) && perfil.papeis.length ? perfil.papeis : [perfil.papel || 'vendedor'];
    fb.admin = perfil.papel === 'adm' || papeis.includes('adm');
    fb.temTask = !fb.admin && papeis.includes('task');
    fb.task = fb.temTask && !papeis.includes('vendedor'); // só TASK
    body.classList.toggle('is-task', fb.task); body.classList.toggle('tem-task', fb.temTask);
    if (fb.task) {
      box.hidden = true; body.classList.remove('locked');
      $('tabUser').textContent = perfil.nome || perfil.email;
      aplicarModo(); abrirAba('tabTask');
      window.dispatchEvent(new CustomEvent('argo-perfil', { detail: { F, db, perfil, admin: false } })); return;
    }
    if (fb.admin || fb.temTask) window.dispatchEvent(new CustomEvent('argo-perfil', { detail: { F, db, perfil, admin: fb.admin } }));
    box.hidden = true; body.classList.remove('locked');
    $('tabUser').textContent = perfil.nome || perfil.email;
    aplicarPerfil();
    aplicarModo();
    await carregar(false);
    if (fb.admin) { ouvirUsuarios(); carregarE2(); carregarE3(); }
    carregarE4(); if (fb.admin) { carregarMod(); carregarBand(); }
    ouvirPropostas();
    window.dispatchEvent(new CustomEvent('shotgun-crm', { detail: { F, db, perfil, admin: fb.admin, temTask: fb.temTask } }));
    abrirAba('tabHoje');
    if (!fb.admin) F.getDoc(F.doc(db, 'publico', 'etapa2')).then(s => { if (s.exists() && s.data().json) E2PUB = JSON.parse(s.data().json); }).catch(() => {});
    if (!fb.admin) F.getDoc(F.doc(db, 'publico', 'etapa3')).then(s => { if (s.exists() && s.data().json) E3PUB = JSON.parse(s.data().json); }).catch(() => {});
  });

  function aplicarPerfil() {
    const v = { vNome: perfil.nome || '', vFone: perfil.fone || '', vEmail: perfil.email || '' };
    lsSet(VEND_KEY, v); Object.assign(CFG, v); lsSet(CFG_KEY, CFG);
    VEND.forEach(id => { const el = $('c-' + id); el.value = v[id]; el.readOnly = true; el.title = 'Alterado pelo administrador na tela Usuários'; });
    $('firstRun').hidden = true;
  }

  /* ---------- Parâmetros da equipe ---------- */
  async function carregar(forcar) {
    if (!perfil) return;
    if (fb.admin && lsGet(PEND_KEY) && !forcar) { teamStatus('Você tem alterações ainda não publicadas neste aparelho.'); return; }
    try {
      const snap = await F.getDoc(PARAM);
      if (!snap.exists()) { teamStatus(fb.admin ? 'Ainda não há parâmetros publicados. Revise abaixo e clique em Publicar para a equipe.' : 'O administrador ainda não publicou os parâmetros.'); return; }
      const j = snap.data();
      CFG = { ...cfgModelo(), ...semVend(j), ...vendData() };
      lsSet(CFG_KEY, CFG); if (forcar) lsSet(PEND_KEY, false); cfgDirty = false;
      renderCfg(); aplicarValidade(); totals(); aplicarPerfil();
      teamStatus(j._publicado ? 'Parâmetros da equipe atualizados (publicados em ' + fmtQuando(j._publicado) + (j._por ? ' por ' + j._por : '') + ').' : 'Parâmetros da equipe carregados.');
    } catch (e) {
      teamStatus('Sem conexão: usando os últimos parâmetros baixados neste aparelho.');
    }
  }
  async function publicar() {
    if (!fb.admin) return;
    const btn = $('btnPublish'); btn.disabled = true; pubStatus('Publicando…');
    try {
      const dados = JSON.parse(JSON.stringify(cfgParaPublicar()));
      await F.setDoc(PARAM, dados);
      lsSet(PEND_KEY, false); cfgDirty = false; status('');
      pubStatus('Publicado em ' + fmtQuando(dados._publicado) + '. A equipe recebe na próxima vez que abrir o app.');
      teamStatus('Parâmetros da equipe publicados por você.');
    } catch (e) { pubStatus('Não foi possível publicar (' + (e.code || e.message) + ').'); }
    finally { btn.disabled = false; }
  }

  /* ---------- Abas ---------- */
  const EXTRA = { tabHoje: 'viewHoje', tabTask: 'viewTask', tabUsers: 'viewUsers', tabList: 'viewList', tabCrm: 'viewCrm', tabTele: 'viewTele', tabE2: 'viewE2', tabE3: 'viewE3', tabE4: 'viewE4' };
  function abrirAba(tab) {
    Object.entries(EXTRA).forEach(([t, v]) => { const on = t === tab; $(v).hidden = !on; $(t).setAttribute('aria-selected', String(on)); });
    document.body.classList.toggle('semBarra', !!EXTRA[tab]);
    if (EXTRA[tab]) { $('viewProp').hidden = true; $('viewCfg').hidden = true; $('tabProp').setAttribute('aria-selected', 'false'); $('tabCfg').setAttribute('aria-selected', 'false'); }
    // Nova proposta fica dentro do CRM: enquanto ela estiver aberta, a aba CRM continua marcada
    if (tab === 'tabProp') $('tabCrm').setAttribute('aria-selected', 'true');
  }
  Object.keys(EXTRA).forEach(t => $(t).addEventListener('click', () => abrirAba(t)));
  ['tabProp', 'tabCfg'].forEach(t => $(t).addEventListener('click', () => abrirAba(t)));
  $('btnPdf').addEventListener('click', () => abrirAba('tabProp'), true);

  /* ---------- Propostas: envio para aprovação ---------- */
  const dig = v => String(v || '').replace(/\D/g, '');
  const waNum = v => { const d = dig(v); return d.length >= 10 && d.length <= 11 ? '55' + d : d; };
  const aprovMsg = t => { $('aprovMsg').textContent = t; };
  const pMsg = t => { $('pMsg').textContent = t; };
  const baseUrl = p => new URL(p, location.href).href.split('#')[0].split('?')[0];
  const linkAprov = id => baseUrl('aprovar.html') + '#' + id;
  const hojeIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  function abrirWa(num, texto, janela) {
    const url = 'https://wa.me/' + (num || '') + '?text=' + encodeURIComponent(texto);
    if (janela && !janela.closed) { janela.location.href = url; return; }
    window.open(url, '_blank') || (location.href = url);
  }
  const textoAprov = p => `Olá${p.contato ? ' ' + p.contato : ''}! Segue a proposta comercial da Argo nº ${p.numero} para ${p.cliente}.\n\nPara ver o PDF e aprovar, acesse:\n${linkAprov(p.id)}\n\n${p.vendedor} - Argo`;

  // Salva a proposta uma vez; se nada mudou desde o último envio, reaproveita o mesmo link.
  let ultimo = null;
  // Atualizar / Refazer: a nova versão substitui a proposta anterior (que fica guardada como "substituida")
  let refazer = null;
  function mostrarRefazer() { const el = $('refazInfo'); if (!el) return; el.hidden = !refazer; if (refazer) el.innerHTML = `<b>Atualizando a proposta nº ${esc(refazer.numero)}.</b> Ao enviar, a nova versão entra no lugar dela e o link antigo leva o cliente para a nova. <button type="button" class="lnk" id="refazCancel">Cancelar</button>`; }
  function limparRefazer() { refazer = null; mostrarRefazer(); }
  $('btnNova').addEventListener('click', limparRefazer);
  document.addEventListener('click', e => { if (e.target.id === 'refazCancel') { limparRefazer(); msg('Atualização cancelada. Se enviar agora, sai como uma proposta nova.'); } });
  async function salvarProposta(n) {
    const assin = JSON.stringify(S);
    if (ultimo && ultimo.assin === assin) { if (n && n !== ultimo.meta.waCli) { ultimo.meta.waCli = n; F.updateDoc(F.doc(db, 'propostas', ultimo.id), { waCli: n }).catch(() => {}); } return ultimo; }
    const b64 = buildPdf().output('datauristring').split(',')[1];
    if (b64.length > 950000) throw new Error('o PDF ficou grande demais (troque o logo por uma imagem menor)');
    const ref = F.doc(F.collection(db, 'propostas'));
    const rf = refazer, versao = rf ? rf.versao + 1 : 1;
    const numero = rf ? String(rf.numero || '').replace(/-R\d+$/, '') + '-R' + versao : hojeIso().replace(/-/g, '').slice(2) + '-' + ref.id.slice(0, 4).toUpperCase();
    const meta = {
      numero, status: 'enviada', owner: perfil.uid, vendedor: perfil.nome || '', vendedorFone: dig(perfil.fone),
      cliente: String(S.cliente || '').trim(), cnpj: S.cnpj || '', contato: String(S.contato || '').trim(), cidade: S.cidade || '',
      waCli: n, data: S.data || hojeIso(), validade: S.validade || '',
      totLic: sumRows(S.lic), totMen: sumRows(S.men), totDes: deslocamento(), implantacao: S.implantacao === 'Remota' ? 'Remota' : 'Presencial', arquivo: fileName(),
      dados: JSON.parse(assin), criado: F.serverTimestamp(),
      ...(window.crmLeadId ? { leadId: window.crmLeadId } : {}),
      ...(rf ? { owner: rf.owner || perfil.uid, vendedor: rf.vendedor || perfil.nome || '', vendedorFone: rf.vendedorFone || dig(perfil.fone), substitui: rf.id, substituiNumero: rf.numero || '', versao, ...(rf.leadId ? { leadId: rf.leadId } : {}) } : {})
    };
    const lote = F.writeBatch(db);
    lote.set(ref, meta);
    lote.set(F.doc(db, 'propostas', ref.id, 'arquivo', 'pdf'), { b64, nome: fileName() });
    await lote.commit();
    if (rf) {
      try { await F.updateDoc(F.doc(db, 'propostas', rf.id), { status: 'substituida', substituidaPor: ref.id, substituidaEm: F.serverTimestamp() }); }
      catch (e) { pMsg('A nova versão foi salva, mas não consegui marcar a nº ' + rf.numero + ' como substituída (' + (e.code || 'erro') + ').'); }
      limparRefazer();
    }
    ultimo = { id: ref.id, meta, assin };
    return ultimo;
  }
  function validarEnvio() {
    if (!perfil) return null;
    if (!String(S.cliente || '').trim()) { $('cliente').focus(); aprovMsg('Preencha o cliente antes de enviar.'); return null; }
    if (!window.jspdf) { aprovMsg('O gerador de PDF não carregou. Recarregue a página.'); return null; }
    const n = waNum($('waAprov').value);
    if (n && n.length < 12) { $('waAprov').focus(); aprovMsg('Confira o WhatsApp do cliente: DDD e número.'); return null; }
    return { n };
  }
  $('btnAprov').addEventListener('click', async () => {
    const v = validarEnvio(); if (!v) return;
    const janela = window.open('', '_blank');
    const btn = $('btnAprov'); btn.disabled = true; aprovMsg('Salvando a proposta…');
    try {
      const r = await salvarProposta(v.n);
      abrirWa(v.n, textoAprov({ ...r.meta, id: r.id }), janela);
      aprovMsg(`Proposta nº ${r.meta.numero} salva e enviada. Acompanhe na aba Propostas.`);
    } catch (e) {
      if (janela) janela.close();
      aprovMsg('Não foi possível enviar: ' + (e.code || e.message) + '.');
    } finally { btn.disabled = false; }
  });
  $('btnAprovCopy').addEventListener('click', async () => {
    const v = validarEnvio(); if (!v) return;
    const btn = $('btnAprovCopy'); btn.disabled = true; aprovMsg('Salvando a proposta…');
    try {
      const r = await salvarProposta(v.n);
      const link = linkAprov(r.id);
      $('aprovLink').value = link; $('aprovLinkRow').hidden = false;
      try { await navigator.clipboard.writeText(link); aprovMsg(`Proposta nº ${r.meta.numero} salva. Link copiado: cole no WhatsApp, e-mail ou onde preferir.`); }
      catch (_) { $('aprovLink').select(); aprovMsg(`Proposta nº ${r.meta.numero} salva. Toque em Copiar ao lado do link.`); }
    } catch (e) { aprovMsg('Não foi possível salvar: ' + (e.code || e.message) + '.'); }
    finally { btn.disabled = false; }
  });
  $('btnAprovLinkCopy').addEventListener('click', async () => {
    const i = $('aprovLink'); i.select();
    try { await navigator.clipboard.writeText(i.value); aprovMsg('Link copiado.'); } catch (_) { try { document.execCommand('copy'); aprovMsg('Link copiado.'); } catch (__) { aprovMsg('Selecione o link e copie.'); } }
  });
  $('btnNova').addEventListener('click', () => { $('waAprov').value = ''; $('aprovLinkRow').hidden = true; ultimo = null; });

  /* ---------- Aba Propostas ---------- */
  let unsubP = null, props = [];
  function ouvirPropostas() {
    if (unsubP) unsubP();
    const col = F.collection(db, 'propostas');
    const q = fb.admin ? F.query(col, F.orderBy('criado', 'desc'), F.limit(300)) : F.query(col, F.where('owner', '==', perfil.uid));
    unsubP = F.onSnapshot(q, qs => {
      props = qs.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.status !== 'substituida') // versões antigas ficam guardadas, mas saem do quadro
        .sort((a, b) => (b.criado?.seconds || 9e9) - (a.criado?.seconds || 9e9));
      desenharPropostas();
    }, e => pMsg('Não foi possível carregar as propostas (' + (e.code || 'erro') + ').'));
  }
  A.onAuthStateChanged(auth, u => { if (!u && unsubP) { unsubP(); unsubP = null; props = []; } });

  const fmtD = iso => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };
  const fmtTs = ts => ts && ts.toDate ? ts.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  function statusDe(p) {
    if (p.status === 'aprovada') return { cls: 'ok', txt: 'APROVADA' };
    if (p.validade && p.validade < hojeIso()) return { cls: 'exp', txt: 'Vencida' };
    return { cls: 'wait', txt: 'Aguardando aprovação' };
  }
  /* Jornada: 5 passos da proposta até o TASK */
  const PASSOS = ['Proposta', 'Dados Primários', 'Contrato', 'Pré TASK', 'TASK'];
  const feitosDe = p => [p.status === 'aprovada', !!p.e2Em, !!p.ctAceitoEm, !!p.e4Em, !!p.e4Em];
  const passoAtual = p => { const i = feitosDe(p).indexOf(false); return i < 0 ? 4 : i; };
  const passoSel = {};
  function passosHtml(p, sel) {
    const f = feitosDe(p), cur = passoAtual(p);
    return `<div class="jsteps" role="group" aria-label="Passos da proposta">${PASSOS.map((t, i) => `<button type="button" class="jst ${f[i] ? 'done' : i === cur ? 'cur' : 'lock'}" data-a="passo" data-i="${i}" aria-current="${i === sel ? 'step' : 'false'}" title="${t}${f[i] ? ': concluído' : i === cur ? ': próximo passo' : ': ainda bloqueado'}"><span class="bar"></span><span class="lbl"><span class="dot">${f[i] ? '✓' : i + 1}</span><em>${t}</em></span></button>`).join('')}</div>`;
  }
  function mostrarPasso(card, i) {
    passoSel[card.dataset.id] = i;
    card.querySelectorAll('[data-passo]').forEach(el => { el.hidden = +el.dataset.passo !== i; });
    card.querySelectorAll('.jst').forEach(b => b.setAttribute('aria-current', +b.dataset.i === i ? 'step' : 'false'));
  }
  /* Quadro por etapa */
  let modoQuadro = true, foco = null;
  try { modoQuadro = localStorage.getItem('argo-pmodo') !== 'lista'; } catch (_) {}
  const COLS = ['Proposta', 'Dados Primários', 'Contrato', 'Pré TASK', 'No TASK'];
  function miniStatus(p) {
    const c = passoAtual(p), ven = p.status !== 'aprovada' && p.validade && p.validade < hojeIso();
    return [ven ? ['exp', 'vencida'] : ['wait', 'aguardando aprovação'], ['wait', 'aguardando dados'], p.ctEm ? ['wait', 'aguardando aceite'] : ['', 'gerar contrato'], ['', 'com o vendedor'], ['ok', 'no TASK']][c];
  }
  function desenharQuadro(vis) {
    $('pBoard').innerHTML = COLS.map((t, ci) => {
      const cs = vis.filter(p => passoAtual(p) === ci);
      return `<div class="pcol"><h4>${t}<span>${cs.length}</span></h4>${cs.map(p => { const ms = miniStatus(p); return `<button type="button" class="pmini" data-foco="${esc(p.id)}" aria-pressed="${p.id === foco}"><b>${esc(p.cliente)}</b><small>Nº ${esc(p.numero)}${fb.admin && p.vendedor ? ' · ' + esc(p.vendedor) : ''}</small>${ms[1] ? `<span class="pill ${ms[0]}">${esc(ms[1])}</span>` : ''}</button>`; }).join('') || '<span class="vazio">Nenhuma</span>'}</div>`;
    }).join('');
  }
  function aplicarModo2() { $('pModoQuadro').setAttribute('aria-pressed', String(modoQuadro)); $('pModoLista').setAttribute('aria-pressed', String(!modoQuadro)); $('pBoard').hidden = !modoQuadro; }
  $('pModoQuadro').addEventListener('click', () => { modoQuadro = true; try { localStorage.setItem('argo-pmodo', 'quadro'); } catch (_) {} desenharPropostas(); });
  $('pModoLista').addEventListener('click', () => { modoQuadro = false; foco = null; try { localStorage.setItem('argo-pmodo', 'lista'); } catch (_) {} desenharPropostas(); });
  $('pBoard').addEventListener('click', e => { const b = e.target.closest('[data-foco]'); if (!b) return; foco = foco === b.dataset.foco ? null : b.dataset.foco; desenharPropostas(); if (foco) setTimeout(() => $('pList').scrollIntoView({ block: 'start', behavior: 'smooth' }), 0); });
  function abrirJornada(id, passo) {
    passoSel[id] = passo; foco = id; $('pBusca').value = ''; $('pFiltro').value = '';
    abrirAba('tabList'); desenharPropostas();
    setTimeout(() => { const c = $('pList').querySelector(`.pcard[data-id="${CSS.escape(id)}"]`); if (c) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 0);
  }
  /* Hoje: o próximo passo de cada proposta */
  // Dúvida enviada pelo cliente na página da proposta e ainda não lida
  const duvNova = p => !!p.duvidaEm && (!p.duvidaLidaEm || (p.duvidaLidaEm.seconds || 0) < (p.duvidaEm.seconds || 0));
  function pendencia(p) {
    if (duvNova(p)) return { t: 'Cliente enviou uma dúvida', d: `Recebida em ${fmtTs(p.duvidaEm)}. Leia e responda o cliente.`, passo: 0, b: 'Ver dúvida' };
    const ven = p.validade && p.validade < hojeIso();
    if (p.status !== 'aprovada') return ven ? { t: 'Proposta vencida', d: `Válida até ${fmtD(p.validade)}. Revise e reenvie ao cliente.`, passo: 0, b: 'Abrir proposta' }
      : { t: 'Aguardando o cliente aprovar', d: `Enviada em ${fmtTs(p.criado) || fmtD(p.data)}. Se demorar, reenvie o link.`, passo: 0, b: 'Ver proposta', cli: true };
    if (!p.e2Em) return { t: 'Enviar o formulário de dados complementares', d: `Aprovada em ${fmtTs(p.aprovadoEm)}. Envie o link ao cliente ou preencha por ele.`, passo: 1, b: 'Enviar dados' };
    if (!p.ctEm) return { t: 'Gerar e enviar o contrato', d: `Dados recebidos em ${fmtTs(p.e2Em)}.`, passo: 2, b: 'Gerar contrato' };
    if (!p.ctAceitoEm) return { t: 'Aguardando o aceite do contrato', d: `Contrato gerado em ${fmtTs(p.ctEm)}. Se demorar, reenvie o link.`, passo: 2, b: 'Ver contrato', cli: true };
    if (!p.e4Em) return { t: 'Preencher o Pré TASK', d: `Contrato aceito em ${fmtTs(p.ctAceitoEm)}. Ao salvar, o card vai para o TASK.`, passo: 3, b: 'Preencher agora' };
    return null;
  }
  async function verDuvidas(p, card) {
    const box = card.querySelector('.duvbox'); if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; box.innerHTML = '<p class="hint">Carregando…</p>';
    try {
      const qs = await F.getDocs(F.collection(db, 'propostas', p.id, 'duvidas'));
      const ds = qs.docs.map(d => d.data()).sort((a, b) => (b.em?.seconds || 0) - (a.em?.seconds || 0));
      box.innerHTML = ds.length ? ds.map(d => `<div class="duvitem"><div class="duvtop"><b>${esc(d.nome || 'Cliente')}</b><span class="meta">${esc(fmtTs(d.em))}</span></div><p>${esc(d.texto)}</p><button type="button" data-a="duvresp" data-nome="${esc(d.nome || '')}">Responder pelo WhatsApp</button></div>`).join('') : '<p class="hint">Nenhuma dúvida registrada.</p>';
      if (duvNova(p)) await F.updateDoc(F.doc(db, 'propostas', p.id), { duvidaLidaEm: F.serverTimestamp() });
    } catch (err) { box.innerHTML = `<p class="hint">Não foi possível carregar as dúvidas (${esc(err.code || err.message)}).</p>`; }
  }
  function desenharHoje() {
    if (!$('hList')) return;
    const minhas = fb.admin && $('hMinhas').checked;
    const itens = props.filter(p => !minhas || p.owner === perfil?.uid).map(p => ({ p, x: pendencia(p) })).filter(o => o.x)
      .sort((a, b) => (a.x.cli === b.x.cli ? 0 : a.x.cli ? 1 : -1));
    const meus = itens.filter(o => !o.x.cli).length;
    $('hCount').textContent = itens.length ? `${meus} com você · ${itens.length - meus} aguardando cliente` : '';
    $('hList').innerHTML = itens.length ? itens.map((o, i) => `<div class="hitem${o.x.cli ? ' cli' : ''}"><span class="n">${o.x.passo + 1}</span><div><b>${esc(o.x.t)} · ${esc(o.p.cliente)}</b><small>${esc(o.x.d)}${fb.admin && o.p.vendedor ? ' · ' + esc(o.p.vendedor) : ''}</small></div><button type="button"${o.x.cli ? '' : ' class="primary"'} data-hoje="${esc(o.p.id)}" data-passo="${o.x.passo}">${esc(o.x.b)}</button></div>`).join('')
      : `<p class="hint">${props.length ? 'Nenhuma pendência. Todas as propostas já estão no TASK.' : 'Nenhuma proposta ainda.'} Clique em <b>+ Nova proposta</b> para começar outra.</p>`;
  }
  $('hList').addEventListener('click', e => { const b = e.target.closest('[data-hoje]'); if (b) abrirJornada(b.dataset.hoje, +b.dataset.passo); });
  $('hMinhas').addEventListener('change', desenharHoje);
  function desenharPropostas() {
    const busca = $('pBusca').value.trim().toLowerCase(), filtro = $('pFiltro').value;
    const passa = p => !filtro || (filtro === 'ctok' ? !!p.ctAceitoEm : filtro === 'ctenv' ? (!!p.ctEm && !p.ctAceitoEm) : p.status === filtro);
    const vis = props.filter(p => passa(p) &&
      (!busca || [p.cliente, p.cnpj, p.numero, p.cidade, p.vendedor].join(' ').toLowerCase().includes(busca)));
    const ap = props.filter(p => p.status === 'aprovada').length;
    $('pCount').textContent = `${props.length} no total · ${ap} aprovada${ap === 1 ? '' : 's'}`;
    desenharHoje(); aplicarModo2();
    if (modoQuadro) desenharQuadro(vis);
    const lista = modoQuadro ? vis.filter(p => p.id === foco) : vis;
    if (modoQuadro && !lista.length) { $('pList').innerHTML = vis.length ? '<p class="hint">Clique em um card do quadro para abrir os passos da proposta.</p>' : `<p class="hint">${props.length ? 'Nenhuma proposta encontrada com esse filtro.' : 'Nenhuma proposta enviada ainda. Use "+ Nova proposta".'}</p>`; return; }
    $('pList').innerHTML = lista.length ? lista.map(p => {
      const st = statusDe(p), ok = p.status === 'aprovada';
      const sel = passoSel[p.id] != null ? passoSel[p.id] : passoAtual(p), oc = i => i === sel ? '' : ' hidden';
      return `<div class="pcard" data-id="${esc(p.id)}">
        <div class="top"><div><b>${esc(p.cliente)}</b><div class="meta">Nº ${esc(p.numero)} · ${esc(p.cidade || '')}${fb.admin ? ' · ' + esc(p.vendedor) : ''}</div></div>
          ${fb.admin ? '<button type="button" class="danger" data-a="excluirp">Excluir proposta</button>' : ''}</div>
        <div class="vals">Licenças ${brl(p.totLic)} · Mensalidade ${brl(p.totMen)} · ${p.implantacao === 'Remota' ? 'Implantação remota (sem custo)' : 'Deslocamento ' + brl(p.totDes)}</div>
        <div class="meta">Enviada em ${esc(fmtTs(p.criado) || fmtD(p.data))}${p.validade ? ' · válida até ' + esc(fmtD(p.validade)) : ''}${p.substitui ? `<br>Versão ${p.versao || 2} · atualiza a nº ${esc(p.substituiNumero || '')} <button type="button" class="lnk" data-a="pdfant">ver PDF anterior</button>` : ''}${ok ? `<br><b style="color:#1f7a46">Aprovada por ${esc(p.aprovadoNome)}${p.aprovadoCargo ? ' (' + esc(p.aprovadoCargo) + ')' : ''} em ${esc(fmtTs(p.aprovadoEm))}</b>` : ''}</div>
        ${passosHtml(p, sel)}
        <div class="etapa" data-passo="0"${oc(0)}><div class="etit">Passo 1 · Proposta</div>
          <div class="acts">
            <button type="button" data-a="pdf">Ver PDF</button>
            <button type="button" data-a="abrir">Abrir no formulário</button>
            ${ok ? '' : '<button type="button" class="primary" data-a="refazer" title="Edita esta proposta e envia uma nova versão no lugar dela">Atualizar / Refazer proposta</button>'}
            ${ok ? '' : '<button type="button" data-a="reenviar">Reenviar pelo WhatsApp</button>'}
            <button type="button" data-a="copiar">Copiar link da proposta</button>
            ${p.duvidaEm ? `<button type="button" data-a="duvidas"${duvNova(p) ? ' class="primary"' : ''}>Dúvidas do cliente${p.duvidaN ? ' (' + p.duvidaN + ')' : ''}${duvNova(p) ? ' · nova' : ''}</button>` : ''}
            <span class="pill ${st.cls}">${st.txt}</span>
          </div><div class="duvbox" hidden></div></div>
        <div class="etapa${ok ? '' : ' bloq'}" data-passo="1"${oc(1)}><div class="etit">Passo 2 · Dados complementares ${p.e2Em ? `<span class="pill ok">DADOS RECEBIDOS</span> <span class="meta">em ${esc(fmtTs(p.e2Em))}${p.e2Anexos ? ' · ' + p.e2Anexos + ' anexo' + (p.e2Anexos > 1 ? 's' : '') : ''}</span>` : ''}</div>
          <div class="acts">
            ${p.e2Em ? '<button type="button" class="primary" data-a="e2ver">Ver dados e anexos</button>' : ''}
            ${ok ? `<button type="button"${p.e2Em ? '' : ' class="primary"'} data-a="etapa2">Enviar pelo WhatsApp</button><button type="button" data-a="etapa2copy">Copiar link da Etapa 2</button><button type="button" data-a="etapa2vend">Preencher pelo vendedor</button>`
                 : '<button type="button" disabled>Enviar pelo WhatsApp</button><button type="button" disabled>Copiar link da Etapa 2</button><span class="hint">Libera quando o cliente aprovar a proposta.</span>'}
          </div>
          <div class="e2dados" hidden></div></div>
        <div class="etapa${p.e2Em ? '' : ' bloq'}" data-passo="2"${oc(2)}><div class="etit">Passo 3 · Contrato ${p.ctAceitoEm ? '<span class="pill ok">CONTRATO ACEITO</span>' : p.ctEm ? '<span class="pill wait">Aguardando aceite</span>' : ''}</div>
          ${p.ctAceitoEm ? `<div class="ctinfo">Aceito por ${esc(p.ctAceitoNome)}${p.ctAceitoCargo ? ' (' + esc(p.ctAceitoCargo) + ')' : ''}, CPF ${esc(p.ctAceitoCpf || '')}, em ${esc(fmtTs(p.ctAceitoEm))}</div>` : p.ctEm ? `<div class="meta">Contrato gerado em ${esc(fmtTs(p.ctEm))}</div>` : ''}
          <div class="acts">
            ${!p.e2Em ? '<button type="button" disabled>Gerar e enviar pelo WhatsApp</button><button type="button" disabled>Copiar link do contrato</button><span class="hint">Libera quando o cliente enviar os dados complementares.</span>'
              : p.ctAceitoEm ? '<button type="button" class="primary" data-a="ctpdf">Ver contrato aceito (PDF)</button><button type="button" data-a="ctcopy">Copiar link do contrato</button>'
              : `<button type="button" class="primary" data-a="ctenviar">${p.ctEm ? 'Gerar de novo e enviar pelo WhatsApp' : 'Gerar e enviar pelo WhatsApp'}</button><button type="button" data-a="ctcopy">Copiar link do contrato</button>${p.ctEm ? '<button type="button" data-a="ctpdf">Ver contrato (PDF)</button>' : ''}`}
          </div></div>
        <div class="etapa${p.ctAceitoEm ? '' : ' bloq'}" data-passo="3"${oc(3)}><div class="etit">Passo 4 · Pré TASK ${p.e4Em ? `<span class="pill ok">PREENCHIDO</span> <span class="meta">em ${esc(fmtTs(p.e4Em))}${p.e4Por ? ' por ' + esc(p.e4Por) : ''}</span>` : ''}</div>
          <div class="acts">
            ${!p.ctAceitoEm ? '<button type="button" disabled>Preencher dados</button><span class="hint">Libera quando o cliente aceitar o contrato. Responsabilidade do vendedor.</span>'
              : p.e4Em ? '<button type="button" data-a="e4ver">Ver dados</button><button type="button" data-a="e4">Editar dados</button>'
              : '<button type="button" class="primary" data-a="e4">Preencher dados</button><span class="hint">Responsabilidade do vendedor.</span>'}
          </div>
          <div class="e4box" hidden></div></div>
        <div class="etapa${p.e4Em ? '' : ' bloq'}" data-passo="4"${oc(4)}><div class="etit">Passo 5 · TASK ${p.e4Em ? '<span class="pill ok">NO TASK</span>' : ''}</div>
          <div class="acts">${p.e4Em ? `<span class="hint">O card desta proposta foi para o quadro do TASK, onde a equipe de implantação acompanha os checklists.</span>${fb.admin ? '<button type="button" data-a="irtask">Abrir o TASK</button>' : ''}` : '<span class="hint">O card entra sozinho no TASK quando o passo 4 for salvo.</span>'}</div></div>
        </div>`;
    }).join('') : `<p class="hint">${props.length ? 'Nenhuma proposta encontrada com esse filtro.' : 'Nenhuma proposta enviada ainda. Clique em "+ Nova proposta" para criar a primeira.'}</p>`;
  }
  /* ---------- Etapa 4: dados de referência para a implantação (vendedor) ---------- */
  const e4Visiveis = () => (cfgE4().secoes || []).map(sc => ({ ...sc, campos: (sc.campos || []).filter(c => c.show !== false && c.tipo !== 'arquivo') })).filter(sc => sc.campos.length);
  const ehOutro4 = v => /^outr[oa]s?(\b|$)/i.test(String(v || '').trim());
  // Seção que tem o bloco de filiais (fica fora das abas por filial)
  const e4TemFil = sc => sc.campos.some(c => String(c.filiaisOp || '').trim() || (c.tipo === 'multicond' && Object.values(c.cond || {}).some(l => (l || []).some(x => x.tipo === 'filiais'))));
  // Campo com a chave prefixada (f0__, f1__…) para valer só para uma filial
  const e4Pref = pref => c => ({ ...c, k: pref + c.k, cond: c.cond ? Object.fromEntries(Object.entries(c.cond).map(([o, l]) => [o, (l || []).map(x => ({ ...x, k: pref + x.k }))])) : c.cond });
  async function etapa4(p, card, editar) {
    const box = card.querySelector('.e4box');
    if (!box.hidden && box.dataset.modo === (editar ? 'e' : 'v')) { box.hidden = true; return; }
    box.hidden = false; box.dataset.modo = editar ? 'e' : 'v'; box.textContent = 'Carregando…';
    let d = {};
    try { const r = await F.getDoc(F.doc(db, 'propostas', p.id, 'etapa4', 'dados')); if (r.exists()) d = r.data(); }
    catch (err) { box.textContent = 'Não foi possível carregar (' + (err.code || err.message) + ').'; return; }
    const v = d.valores || {};
    if (!editar) {
      box.innerHTML = `<div class="refwrap"><table class="refs e2resp"><tbody>${Object.entries(d.campos || {}).map(([k, x]) => `<tr><td>${esc(k)}</td><td style="white-space:pre-wrap">${esc(x)}</td></tr>`).join('') || '<tr><td>Nada preenchido.</td></tr>'}</tbody></table></div>`;
      return;
    }
    // Bloco de filiais: quantidade + uma linha por filial (F1, F2…) com Posto/Loja e CNPJ
    const filBloco = (k, op, label) => `<div class="full e4fil" data-fil="${esc(k)}"${op ? ` data-op="${esc(op)}"` : ''} hidden><label class="e4filq"><span>${esc(label || 'Quantidade de filiais')} <b style="color:var(--danger)">*</b></span><input type="number" min="1" max="50" data-filq="${esc(k)}" value="${(v[k + '__fil'] || []).length || ''}"></label><div class="e4filrows"></div></div>`;
    const campo = c => {
      if (c.tipo === 'multicond') {
        const ops = String(c.opcoes || '').split(/[,;\n]/).map(o => o.trim()).filter(Boolean), val = v[c.k] || '';
        const lab = `<span>${esc(c.label)}${c.req ? ' <b style="color:var(--danger)">*</b>' : ''}</span>`;
        const blocos = ops.map(op => { const xs = (c.cond || {})[op] || []; if (!xs.length) return ''; return `<div class="full e4cond" data-cond="${esc(c.k)}" data-op="${esc(op)}" hidden><div class="grid e4grid">${xs.map(x => x.tipo === 'filiais' ? filBloco(x.k, '', x.label) : campo(x)).join('')}</div></div>`; }).join('');
        return `<label>${lab}<select data-k="${esc(c.k)}"${c.req ? ' required' : ''}><option value="">Escolha</option>${ops.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>${blocos}`;
      }
      if (c.tipo === 'anexo') return `<div class="full e4anexo" data-anx="${esc(c.k)}"><span class="e4anxlab">${esc(c.label)}${c.req ? ' <b style="color:var(--danger)">*</b>' : ''}</span><label class="e4anxbt">📎 Escolher arquivos<input type="file" multiple data-anxin="${esc(c.k)}" hidden></label><div class="e4anxlista"></div><label class="e4pfx" hidden><span>Senha do certificado (.pfx)</span><input data-pfx="${esc(c.k)}" value="${esc(v[c.k + '__senha'] || '')}" autocomplete="off"></label></div>`;
      const req = c.req ? ' required' : '', lab = `<span>${esc(c.label)}${c.req ? ' <b style="color:var(--danger)">*</b>' : ''}</span>`, val = v[c.k] || '', ph = c.ph ? ` placeholder="${esc(c.ph)}"` : '';
      const full = c.tipo === 'textolongo' || c.full ? ' class="full"' : '';
      if (c.tipo === 'textolongo') return `<label class="full">${lab}<textarea data-k="${esc(c.k)}" rows="3"${req}${ph}>${esc(val)}</textarea></label>`;
      if (c.tipo === 'simnao') return `<label${full}>${lab}<span class="tools">${['Sim', 'Não'].map(o => `<label class="chk"><input type="radio" name="e4_${esc(c.k)}" data-k="${esc(c.k)}" value="${o}"${val === o ? ' checked' : ''}${req}> ${o}</label>`).join('')}</span></label>`;
      if (c.tipo === 'opcoes') {
        const ops = String(c.opcoes || '').split(/[,;\n]/).map(o => o.trim()).filter(Boolean); if (c.outros && !ops.some(ehOutro4)) ops.push('Outros');
        const base = ops.find(o => o === val) || (ehOutro4(val.split(':')[0]) ? ops.find(ehOutro4) : '');
        const det = String(c.detalhe || '').trim() ? `<label class="full" data-det="${esc(c.k)}" hidden><span>${esc(c.detalhe)}</span><textarea data-detk="${esc(c.k)}" rows="4">${esc(v[c.k + '__det'] || '')}</textarea></label>` : '';
        const fil = String(c.filiaisOp || '').trim() ? filBloco(c.k, c.filiaisOp.trim(), 'Quantidade de filiais') : '';
        return `<label${full}>${lab}<select data-k="${esc(c.k)}"${req}><option value="">Escolha</option>${ops.map(o => `<option${o === base ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select><input data-outro="${esc(c.k)}" placeholder="Qual?" value="${esc(base && ehOutro4(base) ? val.replace(/^[^:]*:\s*/, '') : '')}"${base && ehOutro4(base) ? '' : ' hidden'}></label>${det}${fil}`;
      }
      const t = { data: 'type="date"', numero: 'type="number" min="0"', email: 'type="email"', telefone: 'inputmode="tel"', cpf: 'inputmode="numeric"', cnpj: 'inputmode="numeric"', cep: 'inputmode="numeric"' }[c.tipo] || '';
      return `<label${full}>${lab}<input data-k="${esc(c.k)}" ${t} value="${esc(val)}"${req}${ph}></label>`;
    };
    const secHtml = sc => `<div class="etit" style="margin:4px 0">${esc(sc.titulo)}</div><div class="grid e4grid">${(() => {
      // Cada Sim/Não que abre vira uma linha: a pergunta à esquerda e os campos dela ao lado
      const out = []; let g = null, deps = [];
      const fecha = () => { if (g) { out.push(`<div class="linha">${g}<div class="deps">${deps.join('')}</div></div>`); g = null; deps = []; } };
      sc.campos.forEach((c, i) => {
        const abre = c.tipo === 'simnao' && (c.abre != null ? c.abre : i === 0) && i < sc.campos.length - 1;
        const h = campo(c);
        if (abre) { fecha(); g = h.replace(/^<label/, `<label data-abre="${esc(c.k)}"`); return; }
        if (c.solto) fecha();
        (g ? deps : out).push(h);
      });
      fecha(); return out.join('');
    })()}</div>`;
    // Central com filiais: as seções seguintes são preenchidas filial por filial (uma aba para cada)
    const secs = e4Visiveis(), globais = secs.filter(e4TemFil), porFil = globais.length ? secs.filter(sc => !e4TemFil(sc)) : secs;
    box.innerHTML = globais.map(secHtml).join('') + '<div class="e4area"></div>' + `<div class="acts" style="margin-top:8px"><button type="button" class="primary" data-a="e4salvar">Salvar dados</button><button type="button" data-a="e4cancelar">Cancelar</button><span class="hint e4msg"></span></div>`;
    const area = box.querySelector('.e4area'); let ativa = 0;
    // Anexos: os já salvos ficam em v[k] (lista) e os novos em box._pend[k] até salvar
    box._v = v; box._pend = {};
    const kb = n => (n / 1024).toFixed(0) + ' KB';
    const ehPfx = n => /\.(pfx|p12)$/i.test(n || '');
    function desenharAnx(el) {
      const k = el.dataset.anx, salvos = Array.isArray(v[k]) ? v[k] : [], novos = box._pend[k] || [];
      el.querySelector('.e4anxlista').innerHTML = salvos.map((a, i) => `<span class="e4anxit">📄 ${esc(a.nome)} <small>${kb(a.tamanho || 0)}</small><button type="button" data-anxrm="s${i}" aria-label="Remover ${esc(a.nome)}">×</button></span>`).join('') + novos.map((f, i) => `<span class="e4anxit novo">📄 ${esc(f.name)} <small>${kb(f.size)} · novo</small><button type="button" data-anxrm="n${i}" aria-label="Remover ${esc(f.name)}">×</button></span>`).join('') || '<span class="hint">Nenhum arquivo.</span>';
      const pfx = salvos.some(a => ehPfx(a.nome)) || novos.some(f => ehPfx(f.name)), l = el.querySelector('.e4pfx'); l.hidden = !pfx; l.querySelector('input').disabled = !pfx;
    }
    box._desAnx = desenharAnx;
    if (!box._anxLigado) {
      box._anxLigado = true; // o quadro é reaproveitado: liga só uma vez e usa o estado atual guardado no box
      box.addEventListener('change', ev => { const inp = ev.target.closest('[data-anxin]'); if (!inp) return; const k = inp.dataset.anxin, fs = [...inp.files], pf = n => /\.(pfx|p12)$/i.test(n || ''); let ok = fs.filter(f => f.size <= 10485760); const avisos = ok.length < fs.length ? ['Arquivos acima de 10 MB não são aceitos: ' + fs.filter(f => f.size > 10485760).map(f => f.name).join(', ') + '.'] : [];
        // Apenas um certificado digital por CNPJ: o novo substitui o anterior
        const certs = ok.filter(f => pf(f.name));
        if (certs.length) { const novo = certs[certs.length - 1]; ok = ok.filter(f => !pf(f.name) || f === novo); const tinha = (box._v[k] || []).some(a => pf(a.nome)) || (box._pend[k] || []).some(f => pf(f.name)); box._v[k] = (box._v[k] || []).filter(a => !pf(a.nome)); box._pend[k] = (box._pend[k] || []).filter(f => !pf(f.name)); if (tinha || certs.length > 1) avisos.push('Só é permitido um certificado digital por CNPJ. Ficou o ' + novo.name + '.'); }
        box._pend[k] = (box._pend[k] || []).concat(ok); const m = box.querySelector('.e4msg'); if (m) m.textContent = avisos.join(' '); inp.value = ''; const el = inp.closest('[data-anx]'); el.style.outline = ''; box._desAnx(el); });
      box.addEventListener('click', ev => { const b = ev.target.closest('[data-anxrm]'); if (!b) return; const el = b.closest('[data-anx]'), k = el.dataset.anx, i = +b.dataset.anxrm.slice(1); if (b.dataset.anxrm[0] === 's') box._v[k] = (box._v[k] || []).filter((_, j) => j !== i); else box._pend[k].splice(i, 1); box._desAnx(el); });
    }
    const ligar = root => {
      // Sim/Não que abre os campos seguintes da seção
      root.querySelectorAll('[data-abre]').forEach(lab => {
        const deps = [...(lab.parentElement.querySelector(':scope > .deps')?.children || [])];
        const sync = () => { const sim = lab.querySelector('input:checked')?.value === 'Sim'; deps.forEach(x => { x.hidden = !sim; x.querySelectorAll('[data-k],[data-outro]').forEach(i => i.disabled = !sim); }); };
        lab.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', sync)); sync();
      });
      root.querySelectorAll('[data-anx]').forEach(desenharAnx);
      root.querySelectorAll('select[data-k]').forEach(sel => { const o = root.querySelector(`[data-outro="${CSS.escape(sel.dataset.k)}"]`); if (o) sel.addEventListener('change', () => { o.hidden = !ehOutro4(sel.value); if (!o.hidden) o.focus(); }); });
    };
    // Guarda o que já foi digitado na área antes de redesenhar
    const colher = () => {
      area.querySelectorAll('[data-k]').forEach(x => { const k = x.dataset.k; if (x.type === 'radio') { if (x.checked) v[k] = x.value; else if (!area.querySelector(`[data-k="${CSS.escape(k)}"]:checked`)) v[k] = ''; return; } const o = area.querySelector(`[data-outro="${CSS.escape(k)}"]`); v[k] = x.value + (o && !o.hidden && o.value.trim() ? ': ' + o.value.trim() : ''); });
      area.querySelectorAll('textarea[data-detk]').forEach(x => { v[x.dataset.detk + '__det'] = x.value; });
      area.querySelectorAll('[data-pfx]').forEach(x => { v[x.dataset.pfx + '__senha'] = x.value; });
    };
    const filiaisAtivas = () => { const bl = [...box.querySelectorAll('[data-fil]')].find(b => !b.hidden); return bl ? [...bl.querySelectorAll('.e4filrow')].map((r, i) => ({ cod: r.querySelector('[data-filn]').value.trim() || 'F' + (i + 1), tipo: r.querySelector('[data-filt]').value })) : []; };
    let assinatura = null;
    const desenharArea = () => {
      const fils = globais.length ? filiaisAtivas() : [], sig = JSON.stringify(fils);
      if (sig === assinatura) return; // só redesenha quando a lista de filiais muda
      assinatura = sig; colher();
      if (!fils.length) { area.dataset.modo = ''; area.innerHTML = porFil.map(secHtml).join(''); ligar(area); syncDet(); syncCond(); syncFil(); return; }
      if (ativa >= fils.length) ativa = 0;
      const ks = []; porFil.forEach(sc => sc.campos.forEach(c => { ks.push(c.k, c.k + '__det'); Object.values(c.cond || {}).forEach(l => (l || []).forEach(x => ks.push(x.k))); }));
      area.dataset.modo = 'fil';
      area.innerHTML = `<div class="etit e4pfh">Dados por filial</div><p class="hint">Preencha as informações de cada filial. Use as abas para trocar de filial.</p><div class="e4tabs" role="tablist">${fils.map((f, i) => `<button type="button" role="tab" data-fi="${i}" aria-selected="${i === ativa}">${esc([f.cod, f.tipo].filter(Boolean).join(' - '))}</button>`).join('')}</div>` +
        fils.map((f, i) => { const pref = 'f' + i + '__'; ks.forEach(k => { if (v[pref + k] === undefined && v[k] !== undefined) v[pref + k] = v[k]; }); return `<div class="e4pf" data-fi="${i}" data-cod="${esc(f.cod)}"${i === ativa ? '' : ' hidden'}>${i ? `<button type="button" class="e4copiar" data-copiar="${i}">Copiar dados da ${esc(fils[0].cod)}</button>` : ''}${porFil.map(sc => secHtml({ ...sc, campos: sc.campos.map(e4Pref(pref)) })).join('')}</div>`; }).join('');
      ligar(area); syncDet(); syncCond(); syncFil();
    };
    area.addEventListener('click', ev => {
      const tb = ev.target.closest('[data-fi][role=tab]'); if (tb) { ativa = +tb.dataset.fi; area.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', b === tb)); area.querySelectorAll('.e4pf').forEach(pf => pf.hidden = pf.dataset.fi !== tb.dataset.fi); return; }
      const cp = ev.target.closest('[data-copiar]'); if (cp) { colher(); const i = cp.dataset.copiar; Object.keys(v).filter(k => k.startsWith('f0__') && !Array.isArray(v[k]) && !/__senha$/.test(k)).forEach(k => { v['f' + i + '__' + k.slice(4)] = v[k]; }); area.innerHTML = ''; assinatura = null; desenharArea(); }
    });
    box.addEventListener('input', ev => { if (ev.target.dataset && ev.target.dataset.k) ev.target.style.borderColor = ''; });
    // Texto longo que abre depois de escolher uma opção (descrição configurada nos Parâmetros)
    const syncDet = () => box.querySelectorAll('[data-det]').forEach(l => { const sel = box.querySelector(`select[data-k="${CSS.escape(l.dataset.det)}"]`); const on = !!sel && !sel.disabled && !!sel.value; l.hidden = !on; l.querySelector('textarea').disabled = !on; });
    // Filiais: ao escolher a opção configurada (ex.: Central), pede a quantidade e abre uma linha por filial
    const filLinha = (k, i, f) => `<div class="e4filrow"${f.info ? ` data-info="${esc(JSON.stringify(f.info))}"` : ''}><input data-filn aria-label="Número da filial ${i + 1}" value="${esc(f.cod || 'F' + (i + 1))}"><select data-filt aria-label="F${i + 1} tipo"><option value="">Posto ou Loja</option>${['Posto', 'Loja'].map(o => `<option${f.tipo === o ? ' selected' : ''}>${o}</option>`).join('')}</select><input data-filc inputmode="numeric" placeholder="CNPJ" aria-label="F${i + 1} CNPJ" value="${esc(f.cnpj || '')}"><input data-filr placeholder="Razão social" aria-label="F${i + 1} razão social" value="${esc(f.razao || '')}"></div>`;
    // Razão social da filial pelo CNPJ; os demais dados da consulta ficam guardados para o card do TASK
    const razaoFil = async (inp, d) => {
      const row = inp.parentElement, r = row.querySelector('[data-filr]'); if (!r) return;
      if (inp.dataset.busca === d) return; inp.dataset.busca = d; const ph = r.placeholder; r.placeholder = 'Buscando…';
      const info = await window.cnpjInfo(d);
      if (inp.value.replace(/\D/g, '') !== d) return;
      row.dataset.info = info ? JSON.stringify(info) : '';
      r.placeholder = info ? 'Razão social' : (r.value.trim() ? ph : 'Razão social (não encontrada, digite)');
      if (info && info.razao && (!r.value.trim() || r.dataset.auto === '1')) { r.value = info.razao; r.dataset.auto = '1'; r.style.borderColor = ''; }
    };
    const desenharFil = (bl, lista) => { const k = bl.dataset.fil, n = Math.min(50, Math.max(0, parseInt(bl.querySelector('[data-filq]').value, 10) || 0)), rows = bl.querySelector('.e4filrows'); const atual = lista || [...rows.children].map(r => ({ cod: r.querySelector('[data-filn]').value, tipo: r.querySelector('[data-filt]').value, cnpj: r.querySelector('[data-filc]').value, razao: r.querySelector('[data-filr]').value, info: r.dataset.info ? JSON.parse(r.dataset.info) : null })); rows.innerHTML = Array.from({ length: n }, (_, i) => filLinha(k, i, atual[i] || {})).join(''); };
    box.querySelectorAll('[data-fil]').forEach(bl => { desenharFil(bl, v[bl.dataset.fil + '__fil'] || []); bl.querySelectorAll('.e4filrow').forEach(r => { const c = r.querySelector('[data-filc]'), d = c.value.replace(/\D/g, ''); if (d.length === 14 && (!r.querySelector('[data-filr]').value.trim() || !r.dataset.info)) razaoFil(c, d); }); bl.querySelector('[data-filq]').addEventListener('input', () => desenharFil(bl)); });
    box.addEventListener('input', ev => { if (ev.target.matches('[data-filc]')) { const d = ev.target.value.replace(/\D/g, '').slice(0, 14); ev.target.value = d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d; ev.target.style.borderColor = ''; if (d.length === 14) razaoFil(ev.target, d); } if (ev.target.matches('[data-filr]')) delete ev.target.dataset.auto; if (ev.target.matches('[data-filt],[data-filq],[data-filn]')) ev.target.style.borderColor = ''; });
    // Multi condicional: cada opção mostra os seus campos adicionais
    const syncCond = () => box.querySelectorAll('[data-cond]').forEach(bl => { const sel = box.querySelector(`select[data-k="${CSS.escape(bl.dataset.cond)}"]`); const on = !!sel && !sel.disabled && sel.value === bl.dataset.op; bl.hidden = !on; bl.querySelectorAll('input,select,textarea').forEach(x => x.disabled = !on); });
    const syncFil = () => box.querySelectorAll('[data-fil]').forEach(bl => { let on; if (bl.dataset.op) { const sel = box.querySelector(`select[data-k="${CSS.escape(bl.dataset.fil)}"]`); on = !!sel && !sel.disabled && sel.value.toLowerCase() === bl.dataset.op.toLowerCase(); } else on = !bl.parentElement.closest('[hidden]'); bl.hidden = !on; bl.querySelectorAll('input,select').forEach(x => x.disabled = !on); });
    box.addEventListener('change', ev => { syncDet(); syncCond(); syncFil(); if (!area.contains(ev.target)) desenharArea(); });
    box.addEventListener('input', ev => { if (ev.target.matches('[data-filq]')) desenharArea(); });
    ligar(box); syncDet(); syncCond(); syncFil(); desenharArea();
  }
  async function salvarE4(p, card, bt) {
    const box = card.querySelector('.e4box'), valores = {}, campos = {}; let falta = null;
    const rotulo = (sc, l) => campos[l] != null ? sc.titulo + ' - ' + l : l;
    const pegaFil = (sc, k, label) => {
      const bl = box.querySelector(`[data-fil="${CSS.escape(k)}"]`); if (!bl || bl.hidden) return;
      const q = bl.querySelector('[data-filq]'), rows = [...bl.querySelectorAll('.e4filrow')];
      if (!rows.length) { falta = falta || q; q.style.borderColor = 'var(--danger)'; }
      const fil = rows.map((r, i) => { const t = r.querySelector('[data-filt]'), cn = r.querySelector('[data-filc]'), nn = r.querySelector('[data-filn]'), rz = r.querySelector('[data-filr]'); if (!nn.value.trim()) { falta = falta || nn; nn.style.borderColor = 'var(--danger)'; } if (!t.value) { falta = falta || t; t.style.borderColor = 'var(--danger)'; } if (cn.value.replace(/\D/g, '').length !== 14) { falta = falta || cn; cn.style.borderColor = 'var(--danger)'; } let info = null; try { info = r.dataset.info ? JSON.parse(r.dataset.info) : null; } catch (e) {} if (info && String(info.cnpj || '').replace(/\D/g, '') !== cn.value.replace(/\D/g, '')) info = null; return { cod: nn.value.trim(), tipo: t.value, cnpj: cn.value, razao: rz.value.trim(), info }; });
      if (fil.length) { valores[k + '__fil'] = fil; campos[rotulo(sc, label)] = fil.map(f => [f.cod, f.tipo, f.cnpj, f.razao].filter(Boolean).join(' - ')).join('\n'); }
    };
    const subir = []; // anexos novos para enviar depois da validação
    // Nome padrão dos anexos: F1_CNPJ_RAZÃO_(Senha).pfx (certificado) ou F1_CNPJ_RAZÃO_nome-original (demais)
    let filAtual = null; const cnpjProp = String(p.cnpj || '').replace(/\D/g, '');
    const limpa = x => String(x || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
    const nomePad = (orig, senha) => { const m = String(orig).match(/^(.*?)(\.[^.]+)?$/), ext = m[2] || '', pfx = /^\.(pfx|p12)$/i.test(ext), ctx = filAtual || { cod: '', cnpj: cnpjProp, razao: p.cliente || '' }; return [ctx.cod, String(ctx.cnpj || '').replace(/\D/g, ''), ctx.razao, pfx ? (limpa(senha) ? '(' + senha + ')' : '') : m[1]].map(limpa).filter(Boolean).join('_') + ext; };
    const pega = (sc, c) => {
      if (c.tipo === 'anexo') {
        const el = box.querySelector(`[data-anx="${CSS.escape(c.k)}"]`); if (!el) return '';
        for (let x = el; x && x !== box; x = x.parentElement) if (x.hidden && !x.classList.contains('e4pf')) return '';
        const salvos = Array.isArray(box._v[c.k]) ? box._v[c.k] : [], novos = (box._pend || {})[c.k] || [];
        if (c.req && !salvos.length && !novos.length) { falta = falta || el.querySelector('.e4anxbt'); el.style.outline = '2px solid var(--danger)'; return ''; }
        if (!salvos.length && !novos.length) return '';
        const sn = el.querySelector('[data-pfx]'), senha = sn && !sn.disabled ? sn.value.trim() : '';
        const lista = salvos.map(a => ({ ...a, orig: a.orig || a.nome, nome: nomePad(a.orig || a.nome, senha) })); valores[c.k] = lista; box._v[c.k] = lista;
        novos.forEach(f => subir.push({ f, lista, campo: c.label, nome: nomePad(f.name, senha) }));
        const nomes = lista.map(a => a.nome).concat(subir.filter(u => u.lista === lista).map(u => u.nome)).join('\n'); campos[rotulo(sc, c.label)] = nomes;
        if (senha) { valores[c.k + '__senha'] = senha; campos[rotulo(sc, c.label + ' - Senha do certificado')] = senha; }
        return nomes;
      }
      const els = [...box.querySelectorAll(`[data-k="${CSS.escape(c.k)}"]`)].filter(x => !x.disabled); if (!els.length) return '';
      let val = els[0].type === 'radio' ? (els.find(x => x.checked)?.value || '') : els[0].value.trim();
      const o = box.querySelector(`[data-outro="${CSS.escape(c.k)}"]`); if (o && !o.hidden && val && o.value.trim()) val += ': ' + o.value.trim();
      els.forEach(x => x.style.borderColor = '');
      if (c.req && !val) { falta = falta || els[0]; els.forEach(x => x.style.borderColor = 'var(--danger)'); }
      if (val) { valores[c.k] = val; campos[rotulo(sc, c.label)] = c.tipo === 'data' ? fmtD(val) : val; }
      return val;
    };
    const proc = sc => c => {
      const val = pega(sc, c);
      if (val && c.tipo === 'multicond') ((c.cond || {})[val] || []).forEach(x => x.tipo === 'filiais' ? pegaFil(sc, x.k, x.label) : pega(sc, x));
      if (val && c.filiaisOp) pegaFil(sc, c.k, c.label + ' - Filiais');
      const dt = box.querySelector(`textarea[data-detk="${CSS.escape(c.k)}"]`);
      if (val && dt && !dt.disabled && dt.value.trim()) { valores[c.k + '__det'] = dt.value.trim(); campos[rotulo(sc, c.label + ' - ' + c.detalhe)] = dt.value.trim(); }
    };
    const secs = e4Visiveis(), globais = secs.filter(e4TemFil), area = box.querySelector('.e4area');
    if (area && area.dataset.modo === 'fil') {
      // Central: primeiro as seções gerais, depois cada filial com as suas respostas
      globais.forEach(sc => sc.campos.forEach(proc(sc)));
      const lista = Object.keys(valores).filter(k => /__fil$/.test(k)).map(k => valores[k])[0] || [];
      area.querySelectorAll('.e4pf').forEach(pf => {
        const i = +pf.dataset.fi, cod = (lista[i] && lista[i].cod) || pf.dataset.cod, pref = 'f' + i + '__', antes = new Set(Object.keys(campos)), dados = {};
        filAtual = { cod, cnpj: (lista[i] && lista[i].cnpj) || '', razao: (lista[i] && lista[i].razao) || '' };
        const lab = c => ({ ...c, label: cod + ' - ' + c.label, cond: c.cond ? Object.fromEntries(Object.entries(c.cond).map(([o, l]) => [o, (l || []).map(x => ({ ...x, label: cod + ' - ' + x.label }))])) : c.cond });
        secs.filter(sc => !e4TemFil(sc)).forEach(sc => sc.campos.map(e4Pref(pref)).map(lab).forEach(proc(sc)));
        Object.keys(campos).filter(k => !antes.has(k)).forEach(k => { dados[k.replace(cod + ' - ', '')] = campos[k]; });
        if (lista[i]) lista[i].dados = dados;
      });
      filAtual = null;
    } else secs.forEach(sc => sc.campos.forEach(proc(sc)));
    if (falta) { const pf = falta.closest('.e4pf'); if (pf && pf.hidden) box.querySelector(`.e4tabs [data-fi="${pf.dataset.fi}"]`)?.click(); }
    if (falta) { box.querySelector('.e4msg').textContent = 'Preencha os campos obrigatórios (CNPJ das filiais com 14 dígitos).'; falta.focus(); return; }
    bt.disabled = true; box.querySelector('.e4msg').textContent = 'Salvando…';
    try {
      const por = perfil.nome || perfil.email;
      // Envia os anexos novos em partes (mesmo formato dos anexos da Etapa 2)
      let n = 0;
      for (const u of subir) {
        n++; box.querySelector('.e4msg').textContent = `Enviando anexo ${n} de ${subir.length}…`;
        const b64 = await new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = err; r.readAsDataURL(u.f); });
        const ref = F.doc(F.collection(db, 'propostas', p.id, 'anexos')), PART = 700000, partes = Math.max(1, Math.ceil(b64.length / PART));
        for (let i = 0; i < partes; i++) await F.setDoc(F.doc(db, 'propostas', p.id, 'anexos', ref.id, 'partes', String(i).padStart(3, '0')), { d: b64.slice(i * PART, (i + 1) * PART) });
        const meta = { nome: u.nome, orig: u.f.name, tipo: u.f.type || 'application/octet-stream', tamanho: u.f.size, campo: u.campo, partes, etapa: 4, em: F.serverTimestamp() };
        await F.setDoc(ref, meta); u.lista.push({ id: ref.id, nome: u.nome, orig: u.f.name, tipo: meta.tipo, tamanho: u.f.size });
      }
      box._pend = {};
      const secoes = e4Visiveis().map(sc => ({ titulo: sc.titulo, labels: sc.campos.flatMap(c => [c.label, ...Object.values(c.cond || {}).flatMap(l => (l || []).map(x => x.label))]) })); // para o TASK agrupar os dados
      await F.setDoc(F.doc(db, 'propostas', p.id, 'etapa4', 'dados'), { valores, campos, secoes, em: F.serverTimestamp(), por, porUid: perfil.uid });
      await F.updateDoc(F.doc(db, 'propostas', p.id), { e4Em: F.serverTimestamp(), e4Por: por, e4PorUid: perfil.uid });
      box.hidden = true; pMsg(`Dados de referência da proposta nº ${p.numero} salvos.`);
    } catch (err) { box.querySelector('.e4msg').textContent = 'Não foi possível salvar (' + (err.code || err.message) + ').'; }
    finally { bt.disabled = false; }
  }
  let E2PUB = null; // formulário publicado (para a mensagem de envio)
  // Pré TASK: a mesma tela de validação final usada no card do TASK
  function abrirPreTask(p) {
    if (!window.PreTask) { pMsg('Recarregue a página (Ctrl+Shift+R) para abrir o Pré TASK.'); return; }
    window.PreTask.abrir({ F, db, perfil, pid: p.id, origem: 'proposta', podeTask: fb.admin || fb.temTask,
      verContrato: async (pid, bt) => {
        bt.disabled = true;
        try {
          const d = (await F.getDoc(F.doc(db, 'propostas', pid, 'arquivo', 'contrato'))).data();
          const doc = window.contratoPdf({ titulo: d.titulo, texto: d.texto, numero: p.numero, logo: logoAtual(), logoW: CFG.logoW, logoH: CFG.logoH,
            aceite: p.ctAceitoEm ? { nome: p.ctAceitoNome, cpf: p.ctAceitoCpf, cargo: p.ctAceitoCargo, em: fmtTs(p.ctAceitoEm), cliente: p.cliente } : null });
          const url = URL.createObjectURL(doc.output('blob')); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 120000);
        } catch (err) { pMsg('Não foi possível abrir o contrato (' + (err.code || err.message) + ').'); }
        finally { bt.disabled = false; }
      },
      aoSalvar: () => pMsg(`Pré TASK da proposta nº ${p.numero} salvo.`) });
  }
  function msgEtapa2(p, link) {
    const cfg = E2 || E2PUB || window.ETAPA2_PADRAO;
    let t = String(cfg.msgEnvio || window.ETAPA2_PADRAO.msgEnvio);
    if (!t.includes('{link}')) t += '\n{link}';
    const v = { contato: p.contato || '', cliente: p.cliente || '', numero: p.numero || '', link, vendedor: perfil.nome || p.vendedor || '' };
    return t.replace(/\{(contato|cliente|numero|link|vendedor)\}/g, (_, k) => v[k]).replace(/ +([,!.?])/g, '$1').replace(/ +\n/g, '\n');
  }
  // Exclusão pelo ADM, em qualquer etapa: apaga a proposta, os dados das etapas, anexos, arquivos e o card do TASK
  let excluirPArm = null;
  async function excluirProposta(p, bt) {
    if (!fb.admin) return;
    if (excluirPArm !== p.id) { excluirPArm = p.id; bt.textContent = 'Confirmar exclusão'; pMsg(`Clique de novo em "Confirmar exclusão" para apagar de vez a proposta nº ${p.numero} (${p.cliente}), com os dados das etapas, anexos, contrato e o card do TASK.`); setTimeout(() => { if (excluirPArm === p.id) { excluirPArm = null; bt.textContent = 'Excluir proposta'; } }, 6000); return; }
    excluirPArm = null; bt.disabled = true; bt.textContent = 'Excluindo…';
    const base = ['propostas', p.id], del = (...c) => F.deleteDoc(F.doc(db, ...base, ...c)).catch(() => {});
    try {
      const an = await F.getDocs(F.collection(db, ...base, 'anexos')).catch(() => ({ docs: [] }));
      for (const a of an.docs) {
        const pt = await F.getDocs(F.collection(db, ...base, 'anexos', a.id, 'partes')).catch(() => ({ docs: [] }));
        await Promise.all(pt.docs.map(x => del('anexos', a.id, 'partes', x.id)));
        await del('anexos', a.id);
      }
      await Promise.all([del('etapa2', 'resposta'), del('etapa4', 'dados'), del('arquivo', 'pdf'), del('arquivo', 'contrato')]);
      await F.deleteDoc(F.doc(db, ...base));
      await F.deleteDoc(F.doc(db, 'tasks', p.id)).catch(() => {});
      pMsg(`Proposta nº ${p.numero} (${p.cliente}) excluída.`);
    } catch (err) { bt.disabled = false; bt.textContent = 'Excluir proposta'; pMsg('Não foi possível excluir (' + (err.code || 'erro') + ').'); }
  }
  function linkEtapa2(p) {
    const sc = splitCidade(p.cidade);
    const dados = { c: p.cnpj, r: p.cliente, cid: sc.cidade, uf: sc.uf, v: perfil.nome || p.vendedor, w: dig(perfil.fone) || p.vendedorFone, n: p.numero, p: p.id };
    const b = btoa(unescape(encodeURIComponent(JSON.stringify(dados)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return baseUrl('dados.html') + '#d=' + b;
  }
  $('pBusca').addEventListener('input', desenharPropostas);
  $('pFiltro').addEventListener('change', desenharPropostas);
  $('pList').addEventListener('click', async e => {
    const bt = e.target.closest('[data-a]'), a = bt && bt.dataset.a, card = e.target.closest('.pcard'); if (!a || !card) return;
    const p = props.find(x => x.id === card.dataset.id); if (!p) return;
    if (a === 'passo') return mostrarPasso(card, +bt.dataset.i);
    if (a === 'duvidas') return verDuvidas(p, card);
    if (a === 'duvresp') { abrirWa(p.waCli, `Olá ${bt.dataset.nome || p.contato || ''}! Sobre a sua dúvida na proposta nº ${p.numero}:\n`); return; }
    if (a === 'irtask') return abrirAba('tabTask');
    if (a === 'excluirp') return excluirProposta(p, bt);
    if (a === 'e4') return abrirPreTask(p);
    if (a === 'e4ver') return etapa4(p, card, false);
    if (a === 'e4salvar') return salvarE4(p, card, bt);
    if (a === 'e4cancelar') { card.querySelector('.e4box').hidden = true; return; }
    if (a === 'reenviar') { abrirWa(p.waCli, textoAprov(p)); pMsg('WhatsApp aberto com o link da proposta.'); }
    if (a === 'copiar') { try { await navigator.clipboard.writeText(linkAprov(p.id)); pMsg('Link da proposta nº ' + p.numero + ' copiado.'); } catch (_) { pMsg('Link: ' + linkAprov(p.id)); } }
    if (a === 'abrir' || a === 'refazer') {
      S = { ...JSON.parse(JSON.stringify(p.dados || {})) }; save(); renderProp(); aplicarValidade(); totals();
      $('waAprov').value = p.waCli ? String(p.waCli).replace(/^55/, '') : '';
      ultimo = null;
      if (a === 'refazer') { refazer = { id: p.id, numero: p.numero, owner: p.owner, vendedor: p.vendedor, vendedorFone: p.vendedorFone, leadId: p.leadId || '', versao: p.versao || 1 }; mostrarRefazer(); }
      else limparRefazer();
      showTab(false); abrirAba('tabProp');
      msg(a === 'refazer' ? `Proposta nº ${p.numero} aberta para atualizar. Ajuste o que precisar e envie: a nova versão substitui esta.` : `Proposta nº ${p.numero} carregada. Se mudar algo, envie de novo para aprovação.`);
    }
    if (a === 'pdf' || a === 'pdfant') {
      pMsg('Abrindo o PDF…');
      try {
        const snap = await F.getDoc(F.doc(db, 'propostas', a === 'pdfant' ? p.substitui : p.id, 'arquivo', 'pdf'));
        const bin = atob(snap.data().b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([u8], { type: 'application/pdf' }));
        const l = document.createElement('a'); l.href = url; l.download = p.arquivo || 'Proposta Argo.pdf'; l.target = '_blank'; l.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000); pMsg('');
      } catch (err) { pMsg('Não foi possível abrir o PDF (' + (err.code || err.message) + ').'); }
    }
    if (a === 'e2ver') {
      const box = card.querySelector('.e2dados');
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false; box.textContent = 'Carregando…';
      try {
        const [r, an] = await Promise.all([F.getDoc(F.doc(db, 'propostas', p.id, 'etapa2', 'resposta')), F.getDocs(F.collection(db, 'propostas', p.id, 'anexos'))]);
        const d = r.exists() ? r.data() : { campos: {} };
        const linhas = Object.entries(d.campos || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
        const arqs = an.docs.map(x => ({ id: x.id, ...x.data() }));
        box.innerHTML = `<div class="refwrap"><table class="refs e2resp"><tbody>${linhas || '<tr><td>Sem respostas salvas.</td></tr>'}</tbody></table></div>
          ${arqs.length ? `<div class="etit" style="margin-top:6px">Anexos</div><div class="acts">${arqs.map(x => `<button type="button" data-a="anexo" data-aid="${esc(x.id)}">⬇ ${esc(x.nome)} <span class="meta">(${esc(x.campo || '')}, ${(Number(x.tamanho || 0) / 1048576).toFixed(1)} MB)</span></button>`).join('')}</div>` : ''}
          <div class="acts" style="margin-top:6px"><button type="button" data-a="e2copiar">Copiar dados</button></div>`;
        box.dataset.texto = d.texto || '';
      } catch (err) { box.textContent = 'Não foi possível carregar (' + (err.code || err.message) + ').'; }
      return;
    }
    if (a === 'e2copiar') { try { await navigator.clipboard.writeText(card.querySelector('.e2dados').dataset.texto || ''); pMsg('Dados copiados.'); } catch (_) { pMsg('Não foi possível copiar.'); } return; }
    if (a === 'anexo') {
      const aid = e.target.closest('[data-aid]').dataset.aid; const b = e.target.closest('button'); b.disabled = true;
      try {
        const meta = (await F.getDoc(F.doc(db, 'propostas', p.id, 'anexos', aid))).data();
        const ps = await F.getDocs(F.collection(db, 'propostas', p.id, 'anexos', aid, 'partes'));
        const b64 = ps.docs.sort((x, y) => x.id.localeCompare(y.id)).map(x => x.data().d).join('');
        const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([u8], { type: meta.tipo || 'application/octet-stream' }));
        const l = document.createElement('a'); l.href = url; l.download = meta.nome || 'anexo'; l.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (err) { pMsg('Não foi possível baixar o anexo (' + (err.code || err.message) + ').'); }
      finally { b.disabled = false; }
      return;
    }
    if (a === 'etapa2vend') { window.open(linkEtapa2(p) + '&vend=1', '_blank'); pMsg('Formulário da Etapa 2 aberto em outra aba para você preencher.'); return; }
    if (a === 'etapa2' || a === 'etapa2copy') {
      const link = linkEtapa2(p);
      if (a === 'etapa2copy') {
        try { await navigator.clipboard.writeText(link); pMsg('Link da Etapa 2 (proposta nº ' + p.numero + ') copiado. Cole no WhatsApp ou e-mail do cliente.'); }
        catch (_) { pMsg('Link da Etapa 2: ' + link); }
        return;
      }
      abrirWa(p.waCli, msgEtapa2(p, link));
      pMsg('WhatsApp aberto com o formulário da Etapa 2.');
    }
    if (a === 'ctenviar' || a === 'ctcopy') {
      if (!p.e2Em) return;
      const janela = a === 'ctenviar' ? window.open('', '_blank') : null;
      bt.disabled = true;
      try {
        if (!p.ctEm || (a === 'ctenviar' && !p.ctAceitoEm)) { pMsg('Gerando o contrato…'); await gerarContrato(p); }
        const link = linkContrato(p.id);
        if (a === 'ctcopy') {
          try { await navigator.clipboard.writeText(link); pMsg('Link do contrato (proposta nº ' + p.numero + ') copiado.'); }
          catch (_) { pMsg('Link do contrato: ' + link); }
        } else { abrirWa(p.waCli, msgEtapa3(p, link), janela); pMsg('Contrato gerado e WhatsApp aberto com o link.'); }
      } catch (err) {
        if (janela) janela.close();
        pMsg('Não foi possível gerar o contrato: ' + (err.code || err.message) + '.');
      } finally { bt.disabled = false; }
      return;
    }
    if (a === 'ctpdf') {
      bt.disabled = true; pMsg('Abrindo o contrato…');
      try {
        const d = (await F.getDoc(F.doc(db, 'propostas', p.id, 'arquivo', 'contrato'))).data();
        const doc = window.contratoPdf({ titulo: d.titulo, texto: d.texto, numero: p.numero, logo: logoAtual(), logoW: CFG.logoW, logoH: CFG.logoH,
          aceite: p.ctAceitoEm ? { nome: p.ctAceitoNome, cpf: p.ctAceitoCpf, cargo: p.ctAceitoCargo, em: fmtTs(p.ctAceitoEm), cliente: p.cliente } : null });
        const url = URL.createObjectURL(doc.output('blob'));
        const l = document.createElement('a'); l.href = url; l.download = 'Contrato Argo ' + p.numero + (p.ctAceitoEm ? ' - aceito' : '') + '.pdf'; l.target = '_blank'; l.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000); pMsg('');
      } catch (err) { pMsg('Não foi possível abrir o contrato (' + (err.code || err.message) + ').'); }
      finally { bt.disabled = false; }
      return;
    }
  });

  /* ---------- Etapa 3: contrato ---------- */
  let E3PUB = null;
  const cfgE3 = () => E3 || E3PUB || window.ETAPA3_PADRAO;
  const linkContrato = id => baseUrl('contrato.html') + '#' + id;
  function msgEtapa3(p, link) {
    let t = String(cfgE3().msgEnvio || window.ETAPA3_PADRAO.msgEnvio);
    if (!t.includes('{link}')) t += '\n{link}';
    const v = { contato: p.contato || '', cliente: p.cliente || '', numero: p.numero || '', link, vendedor: perfil.nome || p.vendedor || '' };
    return t.replace(/\{(contato|cliente|numero|link|vendedor)\}/g, (_, k) => v[k]).replace(/ +([,!.?])/g, '$1').replace(/ +\n/g, '\n');
  }
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function itensTexto(rows) {
    const ls = (rows || []).filter(r => !r.oculto && !r.semContrato && String(r.desc || '').trim()).map(r => {
      const q = qtyNum(r.qty), pr = num(r.price), temp = isentoTemp(r);
      let v = r.isento && !temp ? 'isento' : q === null ? brl(pr) + ' por unidade' : (q === 1 ? brl(pr) : q + ' x ' + brl(pr) + ' = ' + brl(q * pr));
      if (temp) v += ` (isento por ${Math.round(num(r.diasIsento))} dias a contar da emissão do primeiro cupom ou nota pelo sistema; depois, valor integral)`;
      return '- ' + String(r.desc).trim() + (r.sub ? ' (' + String(r.sub).trim() + ')' : '') + ': ' + v;
    });
    return ls.length ? ls.join('\n') : '- (nenhum item)';
  }
  // Dados disponíveis como marcadores: proposta + Etapa 2 + dados da Argo.
  async function valoresContrato(p) {
    const cfg2 = E2 || E2PUB || window.ETAPA2_PADRAO;
    const campos = (cfg2.secoes || []).flatMap(s => s.campos || []);
    const r = await F.getDoc(F.doc(db, 'propostas', p.id, 'etapa2', 'resposta'));
    const d = r.exists() ? r.data() : {};
    const V = {};
    if (d.valores) Object.assign(V, d.valores);
    else Object.entries(d.campos || {}).forEach(([lab, v]) => { const c = campos.find(x => x.label === lab); if (c) V[c.k] = v; });
    campos.forEach(c => { if (c.tipo === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(V[c.k] || '')) V[c.k] = fmtD(V[c.k]); });
    if (V.uf) V.uf = String(V.uf).toUpperCase();
    const ar = cfgE3().argo || {}, t = new Date(), sc = splitCidade(p.cidade);
    // Sede: campos da Etapa 2; se o formulário não pede endereço, busca pelo CNPJ (Receita, via BrasilAPI).
    const E = { log: V.logradouro, num: V.numero, comp: V.complemento, bai: V.bairro, cid: V.cidade, uf: V.uf, cep: V.cep };
    const cnpjD = dig(V.cnpj || p.cnpj);
    if (!E.log && cnpjD.length === 14) {
      try {
        const rr = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + cnpjD);
        if (rr.ok) { const j = await rr.json();
          Object.assign(E, { log: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' '), num: j.numero, comp: j.complemento, bai: j.bairro, cid: j.municipio, uf: j.uf, cep: j.cep && String(j.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') }); }
      } catch (_) {}
    }
    const cid = E.cid ? E.cid + (E.uf ? '/' + String(E.uf).toUpperCase() : '') : (sc.cidade + (sc.uf ? '/' + sc.uf : ''));
    const end = [[E.log, E.num].filter(Boolean).join(', nº ') + (E.comp ? ' - ' + E.comp : ''), E.bai ? 'bairro ' + E.bai : '', cid, E.cep ? 'CEP ' + E.cep : ''].filter(Boolean).join(', ');
    // Responsável legal: RG e endereço pelos campos da seção do responsável (achados pelo nome do campo).
    const secR = (cfg2.secoes || []).find(s => /respons/i.test(s.titulo || '') || s.id === 'responsavel') || { campos: [] };
    const porNome = re => { const c = (secR.campos || []).find(x => re.test(String(x.label || '').trim())); return c ? String(V[c.k] || '').trim() : ''; };
    const rgC = campos.find(c => c.tipo === 'rg');
    const rCid = porNome(/^cidade/i), rUf = porNome(/^(estado|uf)/i);
    const endResp = [[porNome(/^endere/i), porNome(/^n[uú]mero/i)].filter(Boolean).join(', nº ') + (porNome(/^complemento/i) ? ' - ' + porNome(/^complemento/i) : ''),
      porNome(/^bairro/i) ? 'bairro ' + porNome(/^bairro/i) : '', rCid ? rCid + (rUf ? '/' + rUf.toUpperCase() : '') : ''].filter(Boolean).join(', ');
    const dd = p.dados || {};
    return {
      ...V,
      razao: V.razao || p.cliente || '', cnpj: V.cnpj || p.cnpj || '', cliente: p.cliente || '', contato: p.contato || '',
      numero: p.numero || '', vendedor: p.vendedor || '', endereco_cliente: end, cidade_cliente: cid,
      rg_responsavel: rgC ? (V[rgC.k] || '') : '', endereco_responsavel: endResp,
      data: fmtD(hojeIso()), data_extenso: `${t.getDate()} de ${MESES[t.getMonth()]} de ${t.getFullYear()}`,
      data_proposta: fmtD(p.data), aprovado_por: p.aprovadoNome || '', aprovado_cargo: p.aprovadoCargo || '',
      // Itens marcados "Não constar em contrato" ficam fora da lista e do total do contrato
      total_licencas: brl((dd.lic || []).some(r => r.semContrato) ? sumRows(dd.lic.filter(r => !r.semContrato)) : p.totLic), total_mensalidade: brl((dd.men || []).some(r => r.semContrato) ? sumRows(dd.men.filter(r => !r.semContrato)) : p.totMen), total_deslocamento: brl(p.totDes),
      itens_licencas: itensTexto(dd.lic), itens_mensalidades: itensTexto(dd.men),
      argo_razao: ar.razao || '', argo_cnpj: ar.cnpj || '', argo_endereco: ar.endereco || '', argo_representante: ar.representante || '', argo_foro: ar.foro || ''
    };
  }
  const preencherModelo = (modelo, V) => String(modelo || '').replace(/\{([A-Za-z0-9_]+)\}/g, (_, k) => V[k] == null ? '' : String(V[k]));
  async function gerarContrato(p) {
    const cfg = cfgE3();
    const texto = preencherModelo(cfg.modelo, await valoresContrato(p));
    const titulo = cfg.titulo || window.ETAPA3_PADRAO.titulo;
    const b64 = window.contratoPdf({ titulo, texto, numero: p.numero, logo: logoAtual(), logoW: CFG.logoW, logoH: CFG.logoH }).output('datauristring').split(',')[1];
    if (b64.length + texto.length > 950000) throw new Error('o contrato ficou grande demais (troque o logo por uma imagem menor)');
    const lote = F.writeBatch(db);
    lote.set(F.doc(db, 'propostas', p.id, 'arquivo', 'contrato'), { b64, texto, titulo, aceiteTxt: cfg.textoAceite || window.ETAPA3_PADRAO.textoAceite, final: cfg.final || window.ETAPA3_PADRAO.final });
    lote.update(F.doc(db, 'propostas', p.id), { ctEm: F.serverTimestamp() });
    await lote.commit();
  }


  /* ---------- Parâmetros da Etapa 2 (ADM) ---------- */
  const E2DOC = F.doc(db, 'publico', 'etapa2');
  const TIPOS = window.ETAPA2_TIPOS || {};
  let E2 = null, e2Sujo = false;
  const e2Status = t => { $('e2Status').textContent = t; };
  const copia = o => JSON.parse(JSON.stringify(o));
  async function carregarE2() {
    try {
      const snap = await F.getDoc(E2DOC);
      E2 = snap.exists() && snap.data().json ? JSON.parse(snap.data().json) : copia(window.ETAPA2_PADRAO);
      e2Status(snap.exists() ? (snap.data().por ? 'Publicado por ' + snap.data().por + (snap.data().em ? ' em ' + fmtQuando(snap.data().em) : '') + '.' : '') : 'Usando o formulário padrão. Ajuste e publique.');
    } catch (e) { E2 = copia(window.ETAPA2_PADRAO); e2Status('Não foi possível carregar o formulário publicado; mostrando o padrão.'); }
    desenharE2();
  }
  function marcarE2() { e2Sujo = true; e2Status('Alterações ainda não publicadas.'); }
  // padrão: um Sim/Não no topo da seção controla os campos de baixo
  function abreSim(s, ci) { const c = s.campos[ci]; return c.abre != null ? c.abre : ci === 0; }
  function desenharE2() {
    if (!E2) return;
    if (E2.msgEnvio == null) E2.msgEnvio = window.ETAPA2_PADRAO.msgEnvio;
    $('e2Msg').value = E2.msgEnvio; previewMsg();
    $('e2Titulo').value = E2.titulo || ''; $('e2Intro').value = E2.intro || ''; $('e2Final').value = E2.final || ''; $('e2Contrato').checked = E2.contratoSocial !== false;
    $('e2Secoes').innerHTML = htmlSecoes(E2, TIPOS, 'o cliente');
  }
  // Editor de seções/campos (usado na Etapa 2 e na Etapa 4)
  // Editor do Multi condicional: para cada opção, a lista de campos adicionais
  const TIPOSCOND = { texto: 'Texto', textolongo: 'Texto longo', numero: 'Número', data: 'Data', cnpj: 'CNPJ', telefone: 'Telefone', email: 'E-mail', filiais: 'Filiais (quantidade + F1, F2… com Posto/Loja e CNPJ)' };
  function condEditor(c, ci) {
    const ops = String(c.opcoes || '').split(/[,;\n]/).map(o => o.trim()).filter(Boolean);
    return `<tr data-ci="${ci}" class="condrow"><td colspan="6">${ops.length ? ops.map(op => `<div class="condop" data-op="${esc(op)}"><b>Ao escolher “${esc(op)}”:</b>${((c.cond || {})[op] || []).map((x, xi) => `<div class="condx" data-xi="${xi}"><input data-cf="label" value="${esc(x.label)}" placeholder="Descrição do campo" aria-label="Descrição do campo"><select data-cf="tipo" aria-label="Tipo">${Object.entries(TIPOSCOND).map(([k, t]) => `<option value="${k}"${x.tipo === k ? ' selected' : ''}>${t}</option>`).join('')}</select><label class="chk"><input type="checkbox" data-cf="req"${x.req ? ' checked' : ''}> Obrigatório</label><button type="button" data-cx="del" aria-label="Excluir campo">✕</button></div>`).join('') || '<span class="hint">Nenhum campo adicional.</span>'}<button type="button" data-cx="add">+ Campo</button></div>`).join('') : '<span class="hint">Digite as opções acima para configurar os campos de cada uma.</span>'}</td></tr>`;
  }
  function htmlSecoes(CFGX, TIP, quem) {
    const E2 = CFGX;
    return E2.secoes.map((s, si) => `
      <section class="sec" data-si="${si}"><h2>Seção ${si + 1} <span>${s.campos.filter(c => c.show !== false || c.fixo).length} campos visíveis</span></h2><div class="body">
        <div class="e2head"><input data-s="titulo" value="${esc(s.titulo)}" aria-label="Título da seção">
          <button type="button" data-sa="up" ${si === 0 ? 'disabled' : ''} aria-label="Subir seção">↑</button>
          <button type="button" data-sa="down" ${si === E2.secoes.length - 1 ? 'disabled' : ''} aria-label="Descer seção">↓</button>
          ${s.campos.some(c => c.fixo) ? '' : '<button type="button" data-sa="del">Remover seção</button>'}</div>
        <div class="refwrap"><table class="e2tab"><thead><tr><th>Campo (como ${quem} vê)</th><th>Tipo</th><th class="c">Mostrar</th><th class="c">Obrigatório</th><th>Opções / exemplo</th><th><span class="sr">Ações</span></th></tr></thead><tbody>
        ${s.campos.map((c, ci) => `<tr data-ci="${ci}" class="${c.show === false && !c.fixo ? 'off' : ''}">
          <td><input data-f="label" value="${esc(c.label)}" aria-label="Nome do campo"></td>
          <td class="t"><select data-f="tipo" ${c.custom ? '' : 'disabled'} aria-label="Tipo">${Object.entries(TIP).map(([k, v]) => `<option value="${k}"${c.tipo === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
          <td class="c"><input type="checkbox" data-f="show" ${c.show !== false || c.fixo ? 'checked' : ''} ${c.fixo ? 'disabled' : ''} aria-label="Mostrar"></td>
          <td class="c"><input type="checkbox" data-f="req" ${c.req ? 'checked' : ''} ${c.fixo ? 'disabled' : ''} aria-label="Obrigatório"></td>
          <td class="o">${c.tipo === 'simnao' ? `<label class="chk"><input type="checkbox" data-f="abre" ${abreSim(s, ci) ? 'checked' : ''}> Só mostrar os campos abaixo desta seção se responder Sim</label>` : c.tipo === 'multicond' ? `<input data-f="opcoes" value="${esc(c.opcoes || '')}" placeholder="Separe por vírgula" aria-label="Opções"><span class="hint">Configure abaixo os campos de cada opção.</span>` : c.tipo === 'opcoes' ? `<input data-f="opcoes" value="${esc(c.opcoes || '')}" placeholder="Separe por vírgula" aria-label="Opções"><label class="chk"><input type="checkbox" data-f="outros" ${c.outros ? 'checked' : ''}> Incluir "Outros" com campo "Qual?"</label>${quem === 'o vendedor' ? `<input data-f="detalhe" value="${esc(c.detalhe || '')}" placeholder="Ao escolher, abrir texto longo com esta descrição (vazio = não abre)" aria-label="Descrição do texto longo">${c.filiaisOp ? `<input data-f="filiaisOp" value="${esc(c.filiaisOp)}" placeholder="Opção que pede filiais" aria-label="Opção que pede filiais">` : ''}` : ''}` : `<input data-f="ph" value="${esc(c.ph || '')}" placeholder="Texto de exemplo" aria-label="Exemplo">`}${c.tipo !== 'simnao' && s.campos.slice(0, ci).some((x, xi) => x.tipo === 'simnao' && abreSim(s, xi)) ? `<label class="chk"><input type="checkbox" data-f="solto" ${c.solto ? 'checked' : ''}> Fora do Sim/Não acima (sempre visível)</label>` : ''}</td>
          <td class="a"><button type="button" data-ca="up" ${ci === 0 ? 'disabled' : ''} aria-label="Subir">↑</button><button type="button" data-ca="down" ${ci === s.campos.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>${c.fixo ? '' : '<button type="button" data-ca="del" aria-label="Excluir campo" title="Excluir campo">✕</button>'}</td>
        </tr>${c.tipo === 'multicond' ? condEditor(c, ci) : ''}`).join('')}
        </tbody></table></div>
        <div class="tools"><button type="button" data-sa="add">+ Campo nesta seção</button></div>
      </div></section>`).join('');
  }
  function previewMsg() {
    if (!perfil) return;
    $('e2MsgPrev').textContent = 'Exemplo: ' + msgEtapa2({ contato: 'Pedro', cliente: 'POSTO EXEMPLO LTDA', numero: '261118-AB12' }, baseUrl('dados.html') + '#d=…');
  }
  $('e2Msg').addEventListener('input', e => { if (!E2) return; E2.msgEnvio = e.target.value; marcarE2(); previewMsg(); });
  ['e2Titulo', 'e2Intro', 'e2Final'].forEach(id => $(id).addEventListener('input', e => { if (!E2) return; E2[{ e2Titulo: 'titulo', e2Intro: 'intro', e2Final: 'final' }[id]] = e.target.value; marcarE2(); }));
  $('e2Contrato').addEventListener('change', e => { if (!E2) return; E2.contratoSocial = e.target.checked; marcarE2(); });
  function ligarSecoes(el, get, marcar, redesenhar) {
  el.addEventListener('input', e => {
    const sec = e.target.closest('[data-si]'); if (!sec || !get()) return; const E2 = get(), s = E2.secoes[+sec.dataset.si];
    if (e.target.dataset.s) { s.titulo = e.target.value; marcar(); return; }
    if (e.target.dataset.cf) { const c = s.campos[+e.target.closest('[data-ci]').dataset.ci], op = e.target.closest('[data-op]').dataset.op, x = c.cond[op][+e.target.closest('[data-xi]').dataset.xi]; x[e.target.dataset.cf] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; marcar(); return; }
    const tr = e.target.closest('[data-ci]'); const f = e.target.dataset.f; if (!tr || !f) return;
    const c = s.campos[+tr.dataset.ci];
    if (e.target.type === 'checkbox') { c[f] = e.target.checked; tr.classList.toggle('off', c.show === false); }
    else c[f] = e.target.value;
    marcar();
    if (f === 'tipo') redesenhar();
  });
  el.addEventListener('change', e => { if (e.target.dataset.f === 'opcoes') { const sec = e.target.closest('[data-si]'), tr = e.target.closest('[data-ci]'); if (get().secoes[+sec.dataset.si].campos[+tr.dataset.ci].tipo === 'multicond') redesenhar(); return; } if (e.target.dataset.f === 'tipo') { const sec = e.target.closest('[data-si]'), tr = e.target.closest('[data-ci]'); get().secoes[+sec.dataset.si].campos[+tr.dataset.ci].tipo = e.target.value; marcar(); redesenhar(); } });
  el.addEventListener('click', e => {
    const sec = e.target.closest('[data-si]'); if (!sec || !get()) return; const E2 = get(), si = +sec.dataset.si, s = E2.secoes[si];
    const troca = (arr, i, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };
    const sa = e.target.dataset.sa, ca = e.target.dataset.ca, cx = e.target.dataset.cx;
    if (cx) { const c = s.campos[+e.target.closest('[data-ci]').dataset.ci], op = e.target.closest('[data-op]').dataset.op; c.cond = c.cond || {}; const l = c.cond[op] = c.cond[op] || []; if (cx === 'add') l.push({ k: 'x' + Date.now().toString(36), label: 'Novo campo', tipo: 'texto', req: false }); else l.splice(+e.target.closest('[data-xi]').dataset.xi, 1); marcar(); redesenhar(); return; }
    if (sa === 'up' && si > 0) troca(E2.secoes, si, si - 1);
    else if (sa === 'down' && si < E2.secoes.length - 1) troca(E2.secoes, si, si + 1);
    else if (sa === 'del') E2.secoes.splice(si, 1);
    else if (sa === 'add') s.campos.push({ k: 'c' + Date.now().toString(36), label: 'Novo campo', tipo: 'texto', req: false, show: true, custom: true });
    else if (ca) {
      const ci = +e.target.closest('[data-ci]').dataset.ci;
      if (ca === 'up' && ci > 0) troca(s.campos, ci, ci - 1);
      else if (ca === 'down' && ci < s.campos.length - 1) troca(s.campos, ci, ci + 1);
      else if (ca === 'del') s.campos.splice(ci, 1);
      else return;
    } else return;
    marcar(); redesenhar();
  });
  }
  ligarSecoes($('e2Secoes'), () => E2, marcarE2, desenharE2);

  /* ---------- Parâmetros da Etapa 4 - Referência Implantação (ADM) ---------- */
  const E4DOC = F.doc(db, 'config', 'etapa4');
  const TIPOS4 = { ...Object.fromEntries(Object.entries(TIPOS).filter(([k]) => k !== 'arquivo')), multicond: 'Multi condicional', anexo: 'Anexo' };
  let E4 = null, e4Sujo = false;
  const e4Status = t => { $('e4Status').textContent = t; };
  const cfgE4 = () => E4 || copia(window.ETAPA4_PADRAO);
  async function carregarE4() {
    try {
      const snap = await F.getDoc(E4DOC);
      E4 = snap.exists() && snap.data().json ? JSON.parse(snap.data().json) : copia(window.ETAPA4_PADRAO);
      if (fb.admin) e4Status(snap.exists() ? (snap.data().por ? 'Publicado por ' + snap.data().por + (snap.data().em ? ' em ' + fmtQuando(snap.data().em) : '') + '.' : '') : 'Usando o formulário padrão. Ajuste e publique.');
    } catch (e) { E4 = copia(window.ETAPA4_PADRAO); if (fb.admin) e4Status('Não foi possível carregar o formulário publicado; mostrando o padrão.'); }
    e4Sujo = false; desenharE4();
  }
  function marcarE4() { e4Sujo = true; e4Status('Alterações ainda não publicadas.'); }
  function desenharE4() {
    if (!E4 || !fb.admin) return;
    $('e4Secoes').innerHTML = htmlSecoes(E4, TIPOS4, 'o vendedor');
    // Central: cada seção pode ser preenchida filial por filial (padrão) ou uma vez só para a Central
    $('e4Secoes').querySelectorAll('.sec[data-si]').forEach(sec => { const s = E4.secoes[+sec.dataset.si]; const d = document.createElement('label'); d.className = 'chk secfil'; d.innerHTML = `<input type="checkbox" data-porfil${s.porFilial === false ? '' : ' checked'}> Em Central, preencher esta seção filial por filial`; sec.querySelector('.body').prepend(d); });
  }
  $('e4Secoes').addEventListener('change', e => { if (!e.target.matches('[data-porfil]') || !E4) return; E4.secoes[+e.target.closest('[data-si]').dataset.si].porFilial = e.target.checked; marcarE4(); });

  /* ---------- Logos das Bandeiras (ADM): publico/bandeiras, lido pelo Pré TASK e pelos Dados Primários ---------- */
  const BANDDOC = F.doc(db, 'publico', 'bandeiras');
  const BAND_PADRAO = [{ nome: 'Petrobras', img: 'icons/bandeiras/petrobras.svg' }, { nome: 'Ipiranga', img: 'icons/bandeiras/ipiranga.svg' }, { nome: 'ALE', img: 'icons/bandeiras/ale.svg' }, { nome: 'Shell', img: '' }, { nome: 'Bandeira Branca', img: '' }];
  let BAND = null;
  const bandStatus = t => { $('bandStatus').textContent = t; };
  async function carregarBand() {
    try { const snap = await F.getDoc(BANDDOC); BAND = snap.exists() && snap.data().json ? JSON.parse(snap.data().json) : copia(BAND_PADRAO); bandStatus(snap.exists() ? (snap.data().por ? 'Publicado por ' + snap.data().por + (snap.data().em ? ' em ' + fmtQuando(snap.data().em) : '') + '.' : '') : 'Usando a lista padrão. Ajuste e publique.'); }
    catch (e) { BAND = copia(BAND_PADRAO); }
    desenharBand();
  }
  function desenharBand() {
    if (!BAND || !fb.admin) return;
    $('bandLista').innerHTML = BAND.map((b, i) => `<div class="bandrow" data-bi="${i}"><span class="bimg">${b.img ? `<img src="${esc(b.img)}" alt="">` : 'sem imagem'}</span><input data-bn value="${esc(b.nome)}" placeholder="Nome da bandeira" aria-label="Nome da bandeira"><label class="btn">${b.img ? 'Trocar imagem' : 'Escolher imagem'}<input type="file" accept="image/*,.svg" hidden data-bf></label>${b.img ? '<button type="button" data-bx>Tirar imagem</button>' : ''}<button type="button" data-bdel aria-label="Excluir bandeira">✕</button></div>`).join('') || '<p class="hint">Nenhuma bandeira cadastrada.</p>';
  }
  const marcarBand = () => bandStatus('Alterações ainda não publicadas.');
  // Imagem reduzida (até 400x160) para caber no cadastro; SVG pequeno entra como está
  function lerImagem(f) {
    return new Promise((ok, err) => {
      const rd = new FileReader(); rd.onerror = () => err(new Error('leitura'));
      rd.onload = () => { const url = rd.result; if (/svg/i.test(f.type || f.name) && url.length < 150000) return ok(url);
        const im = new Image(); im.onerror = () => err(new Error('imagem')); im.onload = () => { const k = Math.min(1, 400 / im.width, 160 / im.height), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL('image/png')); }; im.src = url; };
      rd.readAsDataURL(f);
    });
  }
  $('bandLista').addEventListener('input', e => { const r = e.target.closest('[data-bi]'); if (!r || !e.target.matches('[data-bn]')) return; BAND[+r.dataset.bi].nome = e.target.value; marcarBand(); });
  $('bandLista').addEventListener('change', async e => { const r = e.target.closest('[data-bi]'); if (!r || !e.target.matches('[data-bf]') || !e.target.files[0]) return; try { BAND[+r.dataset.bi].img = await lerImagem(e.target.files[0]); marcarBand(); desenharBand(); } catch (err) { bandStatus('Não foi possível ler esta imagem.'); } });
  $('bandLista').addEventListener('click', e => { const r = e.target.closest('[data-bi]'); if (!r) return; const i = +r.dataset.bi; if (e.target.closest('[data-bx]')) { BAND[i].img = ''; marcarBand(); desenharBand(); } else if (e.target.closest('[data-bdel]')) { BAND.splice(i, 1); marcarBand(); desenharBand(); } });
  $('btnBandNova').addEventListener('click', () => { if (!BAND) return; BAND.push({ nome: '', img: '' }); desenharBand(); $('bandLista').querySelector('.bandrow:last-child [data-bn]')?.focus(); });
  $('btnBandSalvar').addEventListener('click', async () => {
    if (!BAND || !fb.admin) return;
    const lista = BAND.map(b => ({ nome: String(b.nome || '').trim(), img: b.img || '' })).filter(b => b.nome || b.img);
    if (lista.some(b => !b.nome)) { bandStatus('Informe o nome de cada bandeira.'); return; }
    const json = JSON.stringify(lista); if (json.length > 900000) { bandStatus('As imagens ficaram grandes demais. Use imagens menores.'); return; }
    const btn = $('btnBandSalvar'); btn.disabled = true; bandStatus('Publicando…');
    try { const em = new Date().toISOString(); await F.setDoc(BANDDOC, { json, em, por: perfil.nome || perfil.email }); BAND = lista; desenharBand(); bandStatus('Logos publicados em ' + fmtQuando(em) + '.'); }
    catch (err) { bandStatus('Não foi possível publicar (' + (err.code || err.message) + ').'); }
    finally { btn.disabled = false; }
  });

  /* ---------- Módulos do TASK (ADM) ---------- */
  const MODDOC = F.doc(db, 'config', 'modulos');
  const TIPOSM = Object.fromEntries(Object.entries(TIPOS).filter(([k]) => k !== 'arquivo'));
  let MOD = null, modSujo = false;
  const modStatus = t => { $('modStatus').textContent = t; };
  async function carregarMod() {
    try {
      const snap = await F.getDoc(MODDOC);
      MOD = snap.exists() && snap.data().json ? JSON.parse(snap.data().json) : copia(window.MODULOS_PADRAO);
      if (fb.admin) modStatus(snap.exists() ? (snap.data().por ? 'Publicado por ' + snap.data().por + (snap.data().em ? ' em ' + fmtQuando(snap.data().em) : '') + '.' : '') : 'Usando os módulos padrão. Ajuste e publique.');
    } catch (e) { MOD = copia(window.MODULOS_PADRAO); }
    modSujo = false; desenharMod();
    try { if (lista.length) desenharUsuarios(); } catch (e) {}
  }
  function marcarMod() { modSujo = true; modStatus('Alterações ainda não publicadas.'); }
  function desenharMod() {
    if (!MOD || !fb.admin) return;
    MOD.secoes.forEach(s => { s.processos = s.processos || []; s.campos = s.campos || []; });
    $('modSecoes').innerHTML = htmlSecoes(MOD, TIPOSM, 'a equipe').replace(/<h2>Seção (\d+) /g, '<h2>Módulo $1 ');
    $('modSecoes').querySelectorAll('.sec[data-si]').forEach(sec => {
      const si = +sec.dataset.si, s = MOD.secoes[si], body = sec.querySelector('.body');
      const pais = MOD.secoes.filter((x, i) => i !== si && !x.pai);
      const pai = document.createElement('div'); pai.className = 'modpai';
      pai.innerHTML = `<span>Este módulo é</span><select data-mpai aria-label="Etapa de outro módulo"><option value="">um módulo principal</option>${pais.map(x => `<option value="${esc(x.id)}"${s.pai === x.id ? ' selected' : ''}>etapa dentro de ${esc(x.titulo)}</option>`).join('')}</select>`;
      body.prepend(pai);
      const pr = document.createElement('div'); pr.className = 'modproc';
      pr.innerHTML = `<h3>Processos (${s.processos.length})</h3><div class="refwrap"><table class="e2tab"><thead><tr><th><span class="sr">Ordem</span></th><th>Processo</th><th>Responsável padrão</th><th>Prazo (dias após a Data da Base)</th><th><span class="sr">Ações</span></th></tr></thead><tbody>${s.processos.map((x, pi) => `<tr data-pi="${pi}"><td class="mdrag"><span class="mhandle" data-mdrag title="Arraste para mudar a ordem" aria-hidden="true">⠿</span></td><td><input data-mp="t" value="${esc(x.t)}" aria-label="Processo"></td><td><input data-mp="resp" value="${esc(x.resp || '')}" placeholder="Ex.: Implantação" aria-label="Responsável padrão"></td><td><input data-mp="prazo" type="number" min="0" value="${esc(x.prazo || '')}" aria-label="Prazo em dias" style="max-width:110px"></td><td class="a"><button type="button" data-mpa="up" ${pi === 0 ? 'disabled' : ''} aria-label="Subir">↑</button><button type="button" data-mpa="down" ${pi === s.processos.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button><button type="button" data-mpa="del" aria-label="Excluir processo">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="hint">Nenhum processo.</td></tr>'}</tbody></table></div><div class="tools"><button type="button" data-mpa="add">+ Processo</button></div>`;
      body.appendChild(pr);
    });
  }
  ligarSecoes($('modSecoes'), () => MOD, marcarMod, desenharMod);
  $('modSecoes').addEventListener('input', e => { const t = e.target; if (!MOD || !t.dataset.mp) return; const s = MOD.secoes[+t.closest('[data-si]').dataset.si]; s.processos[+t.closest('[data-pi]').dataset.pi][t.dataset.mp] = t.value; marcarMod(); });
  $('modSecoes').addEventListener('change', e => { if (!MOD || !e.target.matches('[data-mpai]')) return; const s = MOD.secoes[+e.target.closest('[data-si]').dataset.si]; s.pai = e.target.value; if (s.pai) MOD.secoes.forEach(x => { if (x.pai === s.id) x.pai = ''; }); marcarMod(); desenharMod(); });
  $('modSecoes').addEventListener('click', e => {
    const b = e.target.closest('[data-mpa]'); if (!b || !MOD) return; const s = MOD.secoes[+b.closest('[data-si]').dataset.si], a = b.dataset.mpa;
    if (a === 'add') s.processos.push({ id: 'p' + Date.now().toString(36), t: 'Novo processo', resp: '', prazo: '' });
    else { const i = +b.closest('[data-pi]').dataset.pi, L = s.processos; if (a === 'del') L.splice(i, 1); else { const j = a === 'up' ? i - 1 : i + 1; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; } }
    marcarMod(); desenharMod();
  });
  // Arrastar a linha pela alça ⠿ (mouse e toque); as setas continuam como alternativa
  $('modSecoes').addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-mdrag]'); if (!h || !MOD) return; e.preventDefault();
    const tr = h.closest('tr'), tb = tr.parentElement, s = MOD.secoes[+tr.closest('[data-si]').dataset.si];
    tr.classList.add('arrastando');
    const mover = ev => { const rows = [...tb.children].filter(r => r !== tr && r.dataset.pi != null); const alvo = rows.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; }); if (alvo) { if (alvo !== tr.nextElementSibling) tb.insertBefore(tr, alvo); } else if (tb.lastElementChild !== tr) tb.appendChild(tr); };
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); window.removeEventListener('pointercancel', soltar); tr.classList.remove('arrastando');
      const ordem = [...tb.children].map(r => +r.dataset.pi).filter(n => !isNaN(n)); if (ordem.some((n, i) => n !== i)) { s.processos = ordem.map(i => s.processos[i]); marcarMod(); } desenharMod(); };
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar); window.addEventListener('pointercancel', soltar);
  });
  $('btnModNovo').addEventListener('click', () => { if (!MOD) return; MOD.secoes.push({ id: 'm' + Date.now().toString(36), titulo: 'Novo módulo', pai: '', campos: [], processos: [{ id: 'p' + Date.now().toString(36), t: 'Novo processo', resp: '', prazo: '' }] }); marcarMod(); desenharMod(); });
  let modResetT = 0;
  $('btnModPadrao').addEventListener('click', () => {
    if (Date.now() - modResetT > 4000) { modResetT = Date.now(); modStatus('Clique de novo para confirmar: os módulos voltam ao padrão (só vale depois de publicar).'); return; }
    modResetT = 0; MOD = copia(window.MODULOS_PADRAO); marcarMod(); desenharMod();
  });
  $('btnModSalvar').addEventListener('click', async () => {
    if (!MOD || !fb.admin) return;
    if (MOD.secoes.some(s => !String(s.titulo || '').trim()) || MOD.secoes.some(s => (s.processos || []).some(x => !String(x.t || '').trim())) || MOD.secoes.flatMap(s => s.campos).some(c => !String(c.label || '').trim())) { modStatus('Todo módulo, campo e processo precisa de um nome.'); return; }
    const btn = $('btnModSalvar'); btn.disabled = true; modStatus('Publicando…');
    try { const em = new Date().toISOString(); await F.setDoc(MODDOC, { json: JSON.stringify(MOD), em, por: perfil.nome || perfil.email }); modSujo = false; modStatus('Módulos publicados em ' + fmtQuando(em) + '. Valem para todos os cards do TASK.'); }
    catch (err) { modStatus('Não foi possível publicar (' + (err.code || err.message) + ').'); }
    finally { btn.disabled = false; }
  });
  ligarSecoes($('e4Secoes'), () => E4, marcarE4, desenharE4);
  $('btnE4Secao').addEventListener('click', () => { if (!E4) return; E4.secoes.push({ id: 's' + Date.now().toString(36), titulo: 'Nova seção', campos: [{ k: 'c' + Date.now().toString(36), label: 'Novo campo', tipo: 'texto', req: false, show: true, custom: true }] }); marcarE4(); desenharE4(); });
  let e4ResetT = 0;
  $('btnE4Padrao').addEventListener('click', () => {
    if (Date.now() - e4ResetT > 4000) { e4ResetT = Date.now(); e4Status('Clique de novo para confirmar: o formulário volta ao padrão (só vale depois de publicar).'); return; }
    e4ResetT = 0; E4 = copia(window.ETAPA4_PADRAO); marcarE4(); desenharE4();
  });
  $('btnE4Salvar').addEventListener('click', async () => {
    if (!E4 || !fb.admin) return;
    if (E4.secoes.flatMap(s => s.campos).some(c => !String(c.label || '').trim()) || E4.secoes.some(s => !String(s.titulo || '').trim())) { e4Status('Todo campo e toda seção precisam de um nome.'); return; }
    const btn = $('btnE4Salvar'); btn.disabled = true; e4Status('Publicando…');
    try {
      const em = new Date().toISOString();
      await F.setDoc(E4DOC, { json: JSON.stringify(E4), em, por: perfil.nome || perfil.email });
      e4Sujo = false; e4Status('Formulário publicado em ' + fmtQuando(em) + '. Vale para todas as propostas.');
    } catch (err) { e4Status('Não foi possível publicar (' + (err.code || err.message) + ').'); }
    finally { btn.disabled = false; }
  });
  $('btnE2Secao').addEventListener('click', () => { if (!E2) return; E2.secoes.push({ id: 's' + Date.now().toString(36), titulo: 'Nova seção', campos: [{ k: 'c' + Date.now().toString(36), label: 'Novo campo', tipo: 'texto', req: false, show: true, custom: true }] }); marcarE2(); desenharE2(); });
  let e2ResetT = 0;
  $('btnE2Padrao').addEventListener('click', () => {
    if (Date.now() - e2ResetT > 4000) { e2ResetT = Date.now(); e2Status('Clique de novo para confirmar: o formulário volta ao padrão (só vale depois de publicar).'); return; }
    e2ResetT = 0; E2 = copia(window.ETAPA2_PADRAO); marcarE2(); desenharE2();
  });
  $('btnE2Salvar').addEventListener('click', async () => {
    if (!E2 || !fb.admin) return;
    const vazio = E2.secoes.flatMap(s => s.campos).find(c => !String(c.label || '').trim());
    if (vazio || E2.secoes.some(s => !String(s.titulo || '').trim())) { e2Status('Todo campo e toda seção precisam de um nome.'); return; }
    const btn = $('btnE2Salvar'); btn.disabled = true; e2Status('Publicando…');
    try {
      const em = new Date().toISOString();
      await F.setDoc(E2DOC, { json: JSON.stringify(E2), em, por: perfil.nome || perfil.email });
      try { localStorage.setItem('argo-etapa2-cfg', JSON.stringify(E2)); } catch (_) {}
      e2Sujo = false; e2Status('Formulário publicado em ' + fmtQuando(em) + '. Vale para todos os links da Etapa 2.');
    } catch (err) { e2Status('Não foi possível publicar (' + (err.code || err.message) + ').'); }
    finally { btn.disabled = false; }
  });
  $('btnE2Ver').addEventListener('click', () => {
    const dados = { c: '', r: '', v: perfil.nome || '', w: dig(perfil.fone), n: 'EXEMPLO' };
    const b = btoa(unescape(encodeURIComponent(JSON.stringify(dados)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (e2Sujo) e2Status('Atenção: a visualização mostra a versão publicada. Publique para ver as alterações.');
    window.open(baseUrl('dados.html') + '#d=' + b, '_blank');
  });

  /* ---------- Parâmetros do contrato (ADM) ---------- */
  const E3DOC = F.doc(db, 'publico', 'etapa3');
  let E3 = null, e3Sujo = false;
  const e3Status = t => { $('e3Status').textContent = t; };
  const E3CAMPOS = { e3Msg: 'msgEnvio', e3Titulo: 'titulo', e3Aceite: 'textoAceite', e3Final: 'final', e3Modelo: 'modelo' };
  async function carregarE3() {
    try {
      const snap = await F.getDoc(E3DOC);
      E3 = snap.exists() && snap.data().json ? JSON.parse(snap.data().json) : copia(window.ETAPA3_PADRAO);
      e3Status(snap.exists() ? (snap.data().por ? 'Publicado por ' + snap.data().por + (snap.data().em ? ' em ' + fmtQuando(snap.data().em) : '') + '.' : '') : 'Usando o modelo provisório. Cole o seu contrato, preencha os dados da Argo e publique.');
    } catch (e) { E3 = copia(window.ETAPA3_PADRAO); e3Status('Não foi possível carregar o contrato publicado; mostrando o padrão.'); }
    desenharE3();
  }
  function marcarE3() { e3Sujo = true; e3Status('Alterações ainda não publicadas.'); }
  function desenharE3() {
    if (!E3) return;
    E3.argo = { ...window.ETAPA3_PADRAO.argo, ...(E3.argo || {}) };
    Object.entries(E3CAMPOS).forEach(([id, k]) => { $(id).value = E3[k] ?? window.ETAPA3_PADRAO[k] ?? ''; });
    document.querySelectorAll('[data-argo]').forEach(el => { el.value = E3.argo[el.dataset.argo] || ''; });
    previewMsgE3(); desenharMarcadores();
  }
  function previewMsgE3() {
    if (!perfil) return;
    $('e3MsgPrev').textContent = 'Exemplo: ' + msgEtapa3({ contato: 'Pedro', cliente: 'POSTO EXEMPLO LTDA', numero: '261118-AB12' }, baseUrl('contrato.html') + '#…');
  }
  function desenharMarcadores() {
    const cfg2 = E2 || window.ETAPA2_PADRAO;
    const grupos = [
      ['Proposta', [['numero', 'Nº da proposta'], ['data_extenso', 'Data de hoje por extenso'], ['data', 'Data de hoje'], ['data_proposta', 'Data da proposta'], ['cliente', 'Cliente (proposta)'], ['contato', 'Contato'], ['vendedor', 'Vendedor'], ['aprovado_por', 'Quem aprovou'], ['aprovado_cargo', 'Cargo de quem aprovou'],
        ['total_licencas', 'Total licenças'], ['total_mensalidade', 'Total mensalidade'], ['total_deslocamento', 'Deslocamento'], ['itens_licencas', 'Lista de licenças'], ['itens_mensalidades', 'Lista de mensalidades']]],
      ['Montados automaticamente', [['endereco_cliente', 'Endereço completo do cliente'], ['cidade_cliente', 'Cidade/UF do cliente'], ['rg_responsavel', 'RG do responsável'], ['endereco_responsavel', 'Endereço do responsável']]],
      ['Argo (contratada)', [['argo_razao', 'Razão social'], ['argo_cnpj', 'CNPJ'], ['argo_endereco', 'Endereço'], ['argo_representante', 'Representante'], ['argo_foro', 'Foro']]],
      ...(cfg2.secoes || []).map(s => ['Etapa 2 · ' + s.titulo, (s.campos || []).filter(c => c.tipo !== 'arquivo').map(c => [c.k, c.label])])
    ];
    $('e3Marc').innerHTML = grupos.filter(g => g[1].length).map(([t, ms]) => `<div class="mg">${esc(t)}</div>` + ms.map(([k, l]) => `<button type="button" data-mk="${esc(k)}" title="{${esc(k)}}">${esc(l)}</button>`).join('')).join('');
  }
  $('tabE3').addEventListener('click', () => { if (E3) desenharMarcadores(); });
  Object.keys(E3CAMPOS).forEach(id => $(id).addEventListener('input', e => { if (!E3) return; E3[E3CAMPOS[id]] = e.target.value; marcarE3(); if (id === 'e3Msg') previewMsgE3(); }));
  document.querySelectorAll('[data-argo]').forEach(el => el.addEventListener('input', () => { if (!E3) return; E3.argo[el.dataset.argo] = el.value; marcarE3(); }));
  $('e3Marc').addEventListener('click', e => {
    const k = e.target.closest('[data-mk]')?.dataset.mk; if (!k || !E3) return;
    const ta = $('e3Modelo'), ins = '{' + k + '}', i = ta.selectionStart ?? ta.value.length, j = ta.selectionEnd ?? i;
    ta.value = ta.value.slice(0, i) + ins + ta.value.slice(j); ta.focus(); ta.selectionStart = ta.selectionEnd = i + ins.length;
    E3.modelo = ta.value; marcarE3();
  });
  let e3ResetT = 0;
  $('btnE3Padrao').addEventListener('click', () => {
    if (Date.now() - e3ResetT > 4000) { e3ResetT = Date.now(); e3Status('Clique de novo para confirmar: o modelo volta ao provisório (só vale depois de publicar).'); return; }
    e3ResetT = 0; const argo = E3 && E3.argo; E3 = copia(window.ETAPA3_PADRAO); if (argo) E3.argo = argo; marcarE3(); desenharE3();
  });
  $('btnE3Salvar').addEventListener('click', async () => {
    if (!E3 || !fb.admin) return;
    if (!String(E3.modelo || '').trim()) { e3Status('O modelo do contrato não pode ficar vazio.'); return; }
    const btn = $('btnE3Salvar'); btn.disabled = true; e3Status('Publicando…');
    try {
      const em = new Date().toISOString();
      await F.setDoc(E3DOC, { json: JSON.stringify(E3), em, por: perfil.nome || perfil.email });
      e3Sujo = false; e3Status('Contrato publicado em ' + fmtQuando(em) + '. Vale para os próximos contratos gerados.');
    } catch (err) { e3Status('Não foi possível publicar (' + (err.code || err.message) + ').'); }
    finally { btn.disabled = false; }
  });
  $('btnE3Ver').addEventListener('click', () => {
    if (!E3) return;
    const ex = props.find(p => p.e2Em) || null, janela = window.open('', '_blank');
    const gerar = async () => {
      let V;
      if (ex) V = await valoresContrato(ex);
      else V = { numero: 'EXEMPLO', razao: 'POSTO EXEMPLO LTDA', cnpj: '00.000.000/0001-00', data_extenso: 'data de hoje' };
      const texto = preencherModelo(E3.modelo, V);
      const doc = window.contratoPdf({ titulo: E3.titulo, texto, numero: V.numero, logo: logoAtual(), logoW: CFG.logoW, logoH: CFG.logoH });
      const url = URL.createObjectURL(doc.output('blob'));
      if (janela && !janela.closed) janela.location.href = url; else { const l = document.createElement('a'); l.href = url; l.download = 'Contrato exemplo.pdf'; l.click(); }
      e3Status(ex ? 'Exemplo gerado com os dados da proposta nº ' + ex.numero + ' (nada foi enviado).' : 'Exemplo gerado sem dados: nenhuma proposta com dados complementares recebidos ainda.');
    };
    gerar().catch(err => { if (janela) janela.close(); e3Status('Não foi possível gerar o exemplo (' + (err.code || err.message) + ').'); });
  });

  /* ---------- Usuários (ADM) ---------- */
  let unsub = null, lista = [];
  const uStatus = t => { $('uStatus').textContent = t };
  function ouvirUsuarios() {
    if (unsub) return;
    unsub = F.onSnapshot(F.collection(db, 'usuarios'), qs => {
      lista = qs.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => !u.excluido).sort((a, b) => (pend(b) - pend(a)) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
      desenharUsuarios();
    }, () => uStatus('Não foi possível carregar a lista de usuários.'));
  }
  A.onAuthStateChanged(auth, u => { if (!u && unsub) { unsub(); unsub = null; } });

  const fotosU = {};
  const pend = u => u.pendente === true && u.ativo !== true ? 1 : 0;
  const UF_NOMES = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' }, UFS = Object.keys(UF_NOMES);
  function desenharUsuarios() {
    const np = lista.filter(pend).length;
    $('uCount').textContent = lista.length + (lista.length === 1 ? ' usuário' : ' usuários') + (np ? ` · ${np} aguardando liberação` : '');
    $('usersBody').innerHTML = lista.map(u => {
      const eu = perfil && u.uid === perfil.uid;
      return `<div class="ucard${pend(u) ? ' upend' : ''}" data-uid="${esc(u.uid)}">
        <div class="ucol0">${fotosU[u.uid] ? `<img class="ufoto" src="${fotosU[u.uid]}" alt="Foto de ${esc(u.nome)}">` : `<span class="ufoto" title="${fotosU[u.uid] === '' ? 'Ainda não enviou a foto' : 'Carregando'}"></span>`}</div>
        <div class="ucol1"><label class="ulab">Nome<input data-f="nome" value="${esc(u.nome)}" aria-label="Nome"></label><span class="umail">${esc(u.email)}</span></div>
        <label class="ulab ucol2">Telefone<input data-f="fone" value="${esc(u.fone)}" aria-label="Telefone" inputmode="tel"></label>
        <div class="ucol3"><span class="ulabt">Perfil</span>${(() => { const ps = Array.isArray(u.papeis) && u.papeis.length ? u.papeis : [u.papel === 'adm' || u.papel === 'task' ? u.papel : 'vendedor']; return `<div class="upapeis">${[['vendedor', 'Vendedor'], ['task', 'TASK'], ['adm', 'Administrador']].map(([k, l]) => `<label class="uchip"><input type="checkbox" data-papel="${k}"${ps.includes(k) ? ' checked' : ''}${eu ? ' disabled' : ''}> ${l}</label>`).join('')}</div>`; })()}${(() => { const ss = Array.isArray(u.setores) ? u.setores : [], top = ((MOD || window.MODULOS_PADRAO || {}).secoes || []).filter(m => !m.pai); return top.length ? `<span class="ulabt" style="display:block;margin-top:8px">Setor no TASK</span><div class="upapeis">${top.map(m => `<label class="uchip"><input type="checkbox" data-setor="${esc(m.id)}"${ss.includes(m.id) ? ' checked' : ''}> ${esc(m.titulo)}</label>`).join('')}</div>` : ''; })()}${(() => { const ps = Array.isArray(u.papeis) && u.papeis.length ? u.papeis : [u.papel === 'adm' || u.papel === 'task' ? u.papel : 'vendedor']; if (!ps.includes('vendedor')) return ''; const us = Array.isArray(u.estados) ? u.estados : []; return `<span class="ulabt" style="display:block;margin-top:8px">Estados de atuação <small class="uufn">${us.length ? us.length + (us.length === 1 ? ' estado' : ' estados') : 'nenhum marcado'}</small></span><div class="uufs">${UFS.map(uf => `<label class="uuf" title="${UF_NOMES[uf]}"><input type="checkbox" data-uf="${uf}"${us.includes(uf) ? ' checked' : ''}><span>${uf}</span></label>`).join('')}</div>`; })()}</div>
        <div class="ucol4"><span class="pill ${u.ativo ? '' : pend(u) ? 'pend' : 'off'}">${u.ativo ? 'Liberado' : pend(u) ? 'Aguardando liberação' : 'Bloqueado'}</span>${eu ? '<span class="hint">você</span>' : ''}</div>
        <div class="uacts">${eu ? '' : `<button type="button" data-a="toggle"${pend(u) ? ' class="primary"' : ''}>${u.ativo ? 'Bloquear' : 'Liberar'}</button><button type="button" data-a="excluir" class="danger">Excluir</button>`}<button type="button" data-a="reset">Nova senha</button>${fotosU[u.uid] ? '<button type="button" data-a="novafoto">Pedir nova foto</button>' : ''}</div></div>`;
    }).join('');
    lista.filter(u => !(u.uid in fotosU)).forEach(u => { fotosU[u.uid] = ''; F.getDoc(F.doc(db, 'fotos', u.uid)).then(sn => { if (sn.exists()) { fotosU[u.uid] = sn.data().b64 || ''; desenharUsuarios(); } }).catch(() => {}); });
  }
  $('usersBody').addEventListener('change', async e => {
    if (e.target.dataset.uf) {
      const tr = e.target.closest('[data-uid]'), estados = [...tr.querySelectorAll('[data-uf]:checked')].map(x => x.dataset.uf), u = lista.find(x => x.uid === tr.dataset.uid);
      const n = tr.querySelector('.uufn'); if (n) n.textContent = estados.length ? estados.length + (estados.length === 1 ? ' estado' : ' estados') : 'nenhum marcado';
      try { await F.updateDoc(F.doc(db, 'usuarios', tr.dataset.uid), { estados }); if (u) u.estados = estados; uStatus(estados.length ? 'Estados de atuação salvos: ' + estados.join(', ') + '.' : 'Nenhum estado de atuação marcado.'); }
      catch (err) { uStatus('Não foi possível salvar (' + (err.code || 'erro') + ').'); }
      return;
    }
    if (e.target.dataset.setor) {
      const tr = e.target.closest('[data-uid]'), setores = [...tr.querySelectorAll('[data-setor]:checked')].map(x => x.dataset.setor);
      try { await F.updateDoc(F.doc(db, 'usuarios', tr.dataset.uid), { setores }); uStatus(setores.length ? 'Setor salvo. Vale no próximo acesso da pessoa.' : 'Sem setor: a pessoa pode alterar todos os módulos.'); }
      catch (err) { uStatus('Não foi possível salvar (' + (err.code || 'erro') + ').'); }
      return;
    }
    if (e.target.dataset.papel) {
      const tr = e.target.closest('[data-uid]'), papeis = [...tr.querySelectorAll('[data-papel]:checked')].map(x => x.dataset.papel);
      if (!papeis.length) { e.target.checked = true; uStatus('A pessoa precisa ter pelo menos um perfil.'); return; }
      const papel = papeis.includes('adm') ? 'adm' : papeis.includes('vendedor') ? 'vendedor' : 'task';
      try { await F.updateDoc(F.doc(db, 'usuarios', tr.dataset.uid), { papeis, papel }); const u = lista.find(x => x.uid === tr.dataset.uid); if (u) { Object.assign(u, { papeis, papel }); desenharUsuarios(); } uStatus('Perfis salvos. Valem no próximo acesso da pessoa.'); }
      catch (err) { uStatus('Não foi possível salvar (' + (err.code || 'erro') + ').'); }
      return;
    }
    const tr = e.target.closest('[data-uid]'), f = e.target.dataset.f; if (!tr || !f) return;
    try { await F.updateDoc(F.doc(db, 'usuarios', tr.dataset.uid), { [f]: e.target.value.trim() }); uStatus('Alteração salva.'); }
    catch (err) { uStatus('Não foi possível salvar (' + (err.code || 'erro') + ').'); }
  });
  let excluirArm = {};
  $('usersBody').addEventListener('click', async e => {
    const a = e.target.dataset.a, tr = e.target.closest('[data-uid]'); if (!a || !tr) return;
    const u = lista.find(x => x.uid === tr.dataset.uid); if (!u) return;
    try {
      if (a === 'toggle') { await F.updateDoc(F.doc(db, 'usuarios', u.uid), u.ativo ? { ativo: false } : { ativo: true, pendente: false, liberadoEm: F.serverTimestamp() }); uStatus(u.ativo ? `${u.nome} bloqueado.` : `${u.nome} liberado.`); }
      if (a === 'excluir') {
        if (excluirArm.uid !== u.uid || Date.now() - excluirArm.t > 5000) { excluirArm = { uid: u.uid, t: Date.now() }; e.target.textContent = 'Confirmar exclusão'; uStatus(`Clique de novo em "Confirmar exclusão" para excluir ${u.nome}. As propostas dele continuam na aba Propostas.`); return; }
        excluirArm = {};
        await F.updateDoc(F.doc(db, 'usuarios', u.uid), { ativo: false, excluido: true, excluidoEm: F.serverTimestamp() });
        uStatus(`${u.nome} excluído. O acesso foi cortado na hora.`);
      }
      if (a === 'novafoto') { await F.deleteDoc(F.doc(db, 'fotos', u.uid)); delete fotosU[u.uid]; fotosU[u.uid] = ''; desenharUsuarios(); uStatus(`${u.nome} vai tirar uma foto nova no próximo acesso.`); }
      if (a === 'reset') { await A.sendPasswordResetEmail(auth, u.email); uStatus(`E-mail para criar nova senha enviado para ${u.email}.`); }
    } catch (err) { uStatus('Não foi possível concluir (' + (err.code || 'erro') + ').'); }
  });

  // Cadastro: usa uma segunda instância para não deslogar o administrador.
  let app2 = null;
  $('btnAddUser').addEventListener('click', async () => {
    const nome = $('u-nome').value.trim(), email = $('u-email').value.trim().toLowerCase(), fone = $('u-fone').value.trim(), senha = $('u-senha').value, papel = $('u-papel').value;
    if (!nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { uStatus('Informe nome e um e-mail válido.'); return; }
    if (senha.length < 6) { uStatus('A senha inicial precisa ter pelo menos 6 caracteres.'); return; }
    const btn = $('btnAddUser'); btn.disabled = true; uStatus('Cadastrando…');
    try {
      app2 = app2 || initializeApp(C, 'cadastro');
      const auth2 = A.getAuth(app2);
      const cred = await A.createUserWithEmailAndPassword(auth2, email, senha);
      await F.setDoc(F.doc(db, 'usuarios', cred.user.uid), { nome, email, fone, papel, papeis: [papel], ativo: true, trocarSenha: true, criado: F.serverTimestamp() });
      await A.signOut(auth2);
      ['u-nome', 'u-email', 'u-fone', 'u-senha'].forEach(id => $(id).value = ''); $('u-papel').value = 'vendedor';
      uStatus(`${nome} cadastrado. Passe para a pessoa o link do app, o e-mail e a senha inicial. No primeiro acesso o app pede para ela criar uma senha nova.`);
    } catch (err) {
      const c = err.code || '';
      if (/email-already-in-use/.test(c)) {
        // E-mail de alguém excluído antes: reativa o cadastro e manda e-mail para criar nova senha.
        try {
          const qs = await F.getDocs(F.query(F.collection(db, 'usuarios'), F.where('email', '==', email)));
          const ant = qs.docs[0];
          if (ant && ant.data().excluido) {
            await F.updateDoc(ant.ref, { nome, fone, papel, papeis: [papel], ativo: true, excluido: false, trocarSenha: false });
            await A.sendPasswordResetEmail(auth, email);
            ['u-nome', 'u-email', 'u-fone', 'u-senha'].forEach(id => $(id).value = ''); $('u-papel').value = 'vendedor';
            uStatus(`${nome} já tinha sido cadastrado antes e foi reativado. A senha inicial não vale para ele: chegou um e-mail em ${email} para criar uma nova.`);
            return;
          }
        } catch (_) {}
      }
      uStatus(/email-already-in-use/.test(c) ? 'Esse e-mail já tem conta. Se a pessoa estava bloqueada, libere na lista abaixo.' :
        /weak-password/.test(c) ? 'Senha fraca: use pelo menos 6 caracteres.' : 'Não foi possível cadastrar (' + c + ').');
    } finally { btn.disabled = false; }
  });
}

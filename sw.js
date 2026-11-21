// Funciona sem internet: guarda o app no aparelho. Parâmetros sempre tentam a rede primeiro.
const VERSAO = 'shotgun-v175'; // prefixo antigo era argo-v (o app reconhece os dois)
const ARQUIVOS = ['./', 'index.html', 'dados.html', 'auth.js', 'task.js', 'crm.js', 'telemetria.js', 'telemetria-anp.js', 'radar.js', 'anp.js', 'firebase-config.js', 'etapa2-padrao.js', 'aprovar.html', 'contrato.html', 'etapa3-padrao.js', 'etapa4-padrao.js', 'contrato-pdf.js', 'contrato-social.js', 'pretask.js', 'modulos-padrao.js', 'lib/municipios.js', 'lib/forge.min.js', 'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'jspdf.umd.min.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/argo-192.png', 'icons/shotgun-favicon.svg', 'icons/shotgun-logo-horizontal.svg', 'icons/shotgun-logo-horizontal-negativo.svg', 'icons/bandeiras/petrobras.svg', 'icons/bandeiras/ipiranga.svg', 'icons/bandeiras/ale.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())) });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())) });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) { // bibliotecas do login: guarda para usar sem internet
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(VERSAO).then(ca => ca.put(e.request, c)); return res })));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('parametros.json')) return; // sempre da rede; o app guarda a última cópia
  // App: rede primeiro (pega atualizações), cache se estiver sem internet.
  // 'no-cache' confere com o servidor a cada vez: sem isso o navegador podia entregar por até 10 min a cópia antiga do GitHub Pages
  const req = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSAO).then(ca => ca.put(e.request, c)) } return r })
    .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('index.html'))));
});

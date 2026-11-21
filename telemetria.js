// Telemetria: monitoramento de postos em construção. As pesquisas são sempre por Estado; o primeiro integrado será o MT.
// Por enquanto só a tela inicial: o funcionamento será definido depois.
(function () {
  const ATIVOS = ['MT'];
  const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
  const sel = document.getElementById('teleUf'), area = document.getElementById('teleArea');
  if (!sel || !area) return;
  const ord = [...ATIVOS, ...UFS.filter(u => !ATIVOS.includes(u))];
  sel.insertAdjacentHTML('beforeend', ord.map(u => ATIVOS.includes(u) ? `<option value="${u}">${u}</option>` : `<option value="${u}" disabled>${u} (em breve)</option>`).join(''));
  sel.addEventListener('change', () => {
    const uf = sel.value;
    if (uf === 'MT' && window.radarMT) return window.radarMT.mostrar(area); // Radar de Novos Postos – MT (radar.js)
    area.className = 'teleembreve';
    area.innerHTML = uf
      ? `<span class="pill">Em construção</span><b>Postos em construção em ${uf}</b><small>A integração de ${uf} está em construção. Assim que o funcionamento for definido, a lista de postos aparece aqui.</small>`
      : '<span class="pill">Em construção</span><b>Escolha um Estado</b><small>O monitoramento começa pelo Mato Grosso (MT). Os outros Estados entram depois.</small>';
  });
})();

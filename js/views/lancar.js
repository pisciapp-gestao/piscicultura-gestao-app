// Lançamento de ração, biometria, mortalidade, despesca e manejo (probiótico). Funciona sem internet:
// o item é gravado na fila local (IndexedDB) e enviado quando houver conexão.
import { icone } from '../icons.js';
import { esc, hojeISO, fmtData, fmtNum, fmtInt, num, uuid, ROTULO_TIPO, progresso, fmtPct, plural, numDecimal, numMoeda, pesoMedioTxt, fmtBRL } from '../util.js';
import * as db from '../db.js';
import * as rascunho from '../rascunho.js';
import { confirmar } from '../dialogo.js';
import { ligarTeclado } from '../teclado.js';
import { desfazerLancamento, minutosParaDesfazer } from '../desfazer.js';
import { ordemNatural } from './home.js';
import { renderTransferir } from './transferir.js';
import { AGUA_LIMITES, PESO_SACO_PADRAO_KG, CAUSAS_MORTE, TAXA_RACAO } from '../config.js';
import { sugestaoRacao, vivosDoLote, indicadoresDespesca, avisoPesoMedio, avaliarAgua, ehTambaqui, tipoRacaoDoLote, faltaNoEstoque } from '../calc.js';

const TIPOS = {
  racao: { rotulo: 'Ração', tabela: 'racao_consumo' },
  biometria: { rotulo: 'Biometria', tabela: 'biometrias' },
  mortalidade: { rotulo: 'Mortalidade', tabela: 'mortalidade' },
  despesca: { rotulo: 'Despesca', tabela: 'despescas', gerir: true }, // peso total da fazenda: só dono e gerente
  transferencia: { rotulo: 'Transferência', tabela: 'transferencias', gerir: true }, // peixes de um tanque para outro (sql/37): tela própria
  manejo: { rotulo: 'Manejo', tabela: 'manejos' },
  agua: { rotulo: 'Água', tabela: 'qualidade_agua' },
};

const casas = (x) => (Number.isInteger(x) ? 0 : Number.isInteger(Math.round(x * 100) / 10) ? 1 : 2);
const kgTxt = (v) => fmtNum(Number(v), casas(Number(v)));

const sacosTxt = (n) => `${fmtNum(n, casas(n))} ${n > 0 && n <= 1 ? 'saco' : 'sacos'}`; // 0,4 saco · 1 saco · 1,5 sacos
// ração é lançada em kg (o número que o equipamento mostra); o app mostra quantos sacos isso dá
const sacosDeKg = (kg, kgSaco) => Math.round((kg / kgSaco) * 10) / 10;
// "1.250" (ponto de milhar, como o equipamento às vezes mostra) = 1250 kg, não 1,25 kg
const kgDigitado = (v) => { const t = String(v ?? '').trim(); return /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : numDecimal(t); };
const kgEmSacosTxt = (kg, kgSaco) => `${fmtNum(kg, casas(kg))} kg = ${sacosTxt(sacosDeKg(kg, kgSaco))} de ${fmtNum(kgSaco, 0)} kg`;

// nome do lançamento para a pessoa ("Manejo" é o probiótico)
const ROTULO_LANC = { racao: 'Ração', biometria: 'Pesagem', mortalidade: 'Mortes', despesca: 'Despesca', manejo: 'Probiótico', agua: 'Água' };

const TITULO2 = { racao: 'Quantidade de ração', biometria: 'Pesagem dos peixes', mortalidade: 'Peixes mortos', despesca: 'Dados da despesca', manejo: 'Aplicação de probiótico', agua: 'Medição da água' };

function camposDoTipo(tipo, kgSaco, verDinheiro = false) {
  if (tipo === 'racao') {
    return `<label>Quantos kg de ração?
      <input id="racao-kg" class="grande" type="text" inputmode="decimal" autocomplete="off" placeholder="0" required></label>
      <div class="calc" id="conv">Digite o total em kg. Ex.: 600 kg = ${sacosTxt(sacosDeKg(600, kgSaco))}</div>
      <button type="button" class="chip repetir" id="b-ultima" hidden></button>
      <div class="sug-racao" id="sug-racao" hidden></div>
      <details class="como-det"><summary>Como lançar</summary>
      <ol class="como">
        <li>Digite o total de kg de ração dado hoje neste tanque (o número que o equipamento mostra).</li>
        <li>Pode ter vírgula: 37,5.</li>
        <li>O app mostra quantos sacos isso dá. Cada saco vale ${fmtNum(kgSaco, 0)} kg (muda em Fazenda &gt; Peso do saco).</li>
      </ol></details>`;
  }
  if (tipo === 'biometria') {
    return `
      <details class="como-det"><summary>Como pesar</summary>
      <ol class="como">
        <li>Pegue alguns peixes do tanque, de 5% a 10% do lote.</li>
        <li>Pese todos juntos, de uma vez.</li>
        <li>Anote o peso total e quantos peixes foram pesados.</li>
      </ol></details>
      <label><span id="rot-peso">Peso total dos peixes (kg)</span>
        <input id="peso" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 2,4" required></label>
      <label>Quantos peixes foram pesados?
        <input id="amostra" type="text" inputmode="numeric" autocomplete="off" placeholder="Ex.: 10" required></label>
      <div class="calc resultado" id="pm">Peso médio: —</div>
      <p id="aviso-amostra" class="aviso" hidden>Poucos peixes pesados: com menos de 30 o peso médio fica pouco confiável.</p>`;
  }
  if (tipo === 'agua') {
    return `<p class="calc" style="margin-top:0">Preencha só o que você mediu.</p>
      <div class="agua-campos">
        <label>Oxigênio (mg/L)<input id="ag-od" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 5,2"></label>
        <label>Temperatura (°C)<input id="ag-temp" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 29"></label>
        <label>pH<input id="ag-ph" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 6,5"></label>
        <label>Amônia tóxica (mg/L)<input id="ag-am" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 0,1"></label>
      </div>
      <div class="calc resultado" id="ag-res" hidden></div>
      <label>Observação <small class="mudo">(opcional)</small>
        <input id="ag-obs" type="text" maxlength="200" autocomplete="off"></label>`;
  }
  if (tipo === 'manejo') {
    return `<div class="tiles compactos" id="man-via" role="radiogroup" aria-label="Como foi aplicado">
        <button type="button" class="tile on" role="radio" aria-checked="true" data-via="racao"><span>Na ração</span></button>
        <button type="button" class="tile" role="radio" aria-checked="false" data-via="agua"><span>Na água</span></button>
      </div>
      <label>Produto
        <input id="man-produto" type="text" maxlength="80" autocomplete="off" list="man-produtos" placeholder="Nome do probiótico" required></label>
      <datalist id="man-produtos"></datalist>
      <div class="man-dose">
        <label>Dose
          <input id="man-dose" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 200" required></label>
        <label>Unidade
          <select id="man-unidade"><option value="g">g</option><option value="kg">kg</option><option value="mL">mL</option><option value="L">L</option></select></label>
      </div>
      <label>Observação <small class="mudo">(opcional)</small>
        <input id="man-obs" type="text" maxlength="200" autocomplete="off"></label>`;
  }
  if (tipo === 'despesca') {
    return `<div class="tiles compactos" id="desp-tipo" role="radiogroup" aria-label="Tipo de despesca">
        <button type="button" class="tile on" role="radio" aria-checked="true" data-desp="parcial"><span>Parcial</span></button>
        <button type="button" class="tile" role="radio" aria-checked="false" data-desp="total"><span>Total</span></button>
      </div>
      <p class="calc" id="desp-dica"></p>
      <label>Quantos peixes saíram?
        <input id="desp-qtd" class="grande" type="text" inputmode="numeric" autocomplete="off" placeholder="0" required></label>
      <label>Peso total bruto (kg)
        <input id="desp-bruto" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 9547" required></label>
      <label class="desp-desc"><span class="rot">Desconto do peso bruto <small class="opc">opcional</small></span>
        <span class="com-sufixo"><input id="desp-desc" type="text" inputmode="decimal" autocomplete="off" maxlength="5" placeholder="Ex.: 2"><em>%</em></span>
        <small class="mudo" id="desp-desc-ajuda">O peso líquido é preenchido sozinho.</small></label>
      <label><span class="rot">Peso total líquido (kg) <small class="opc">opcional</small></span>
        <input id="desp-liquido" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 9356"></label>
      ${verDinheiro ? `<label><span class="rot">Preço de venda por kg <small class="opc">opcional</small></span>
        <span class="com-prefixo"><em>R$</em><input id="desp-preco" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="0,00"></span></label>
      <label><span class="rot">Comprador <small class="opc">opcional</small></span>
        <input id="desp-comprador" type="text" maxlength="80" autocomplete="off"></label>` : ''}
      <div class="calc resultado" id="desp-calc" hidden></div>`;
  }
  return `<label>Quantos peixes morreram?
    <input id="qtd" class="grande" type="text" inputmode="numeric" autocomplete="off" placeholder="0" required></label>
    <details class="como-det"><summary>Como lançar</summary>
    <ol class="como">
      <li>Conte os peixes mortos encontrados hoje neste tanque.</li>
      <li>Digite o total e, se souber, escolha a causa abaixo.</li>
    </ol></details>`;
}

// a aba escolhida fica à vista no celular estreito. Na troca de aba, a faixa parte de onde estava e desliza até ela.
function centrarAba(sg, on, antes) {
  const alvo = Math.max(0, on.offsetLeft - (sg.clientWidth - on.offsetWidth) / 2);
  if (antes == null) { sg.scrollLeft = alvo; return; }
  sg.scrollLeft = antes;
  const suave = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  requestAnimationFrame(() => sg.scrollTo({ left: alvo, behavior: suave ? 'smooth' : 'auto' }));
}

export async function renderLancar(ctx, el, params = {}) {
  const { state } = ctx;
  const tiposVisiveis = Object.entries(TIPOS).filter(([, v]) => !v.gerir || ctx.podeGerir());
  const tipo = tiposVisiveis.some(([k]) => k === params.tipo) ? params.tipo : 'racao';
  // trocou de aba (Ração → Biometria...): o formulário novo entra em cascata, como uma tela nova
  // trocou de aba (Ração → Biometria...): o título e as abas ficam parados (só o risquinho desliza);
  // os balões do formulário entram em cascata (css: .troca-aba)
  if (params.de !== undefined && el.classList) { el.classList.add('cascata', 'troca-aba'); setTimeout(() => el.classList.remove('cascata', 'troca-aba'), 600); }
  // de onde veio (ronda ou tela do tanque): depois de salvar, o "voltar" leva para lá
  const volta = params.volta === 'ronda' || params.volta === 't' ? params.volta : '';
  const { tanques, lotes } = state.ref;
  const kgSaco = state.ref.kgSaco || PESO_SACO_PADRAO_KG;

  if (!tanques.length) {
    el.innerHTML = `<h1>Lançar</h1><div class="card vazio"><p>Nenhum tanque disponível.${ctx.podeGerir() ? ' Cadastre um tanque primeiro.' : ' Peça ao gerente para liberar seus tanques.'}</p>${ctx.podeGerir() ? '<a class="btn primario" href="#/tanques">Ir para Tanques</a>' : ''}</div>`;
    return;
  }

  if (tipo === 'transferencia') {
    const segHtml = `<div class="seg" style="--n:${tiposVisiveis.length}" role="tablist">${tiposVisiveis.map(([k, v]) => `<button type="button" data-tipo="${k}" class="${k === tipo ? 'on' : ''}">${v.rotulo}</button>`).join('')}</div>`;
    let primeira = true; // a tela da transferência se redesenha ao escolher tanques: o deslize das abas só na chegada
    const ligarSeg = () => {
      const sg = el.querySelector('.seg'), on = sg && sg.querySelector('button.on');
      if (on && sg.scrollWidth > sg.clientWidth) centrarAba(sg, on, primeira ? params.rolagem : null);
      if (primeira && params.de !== undefined && sg) sg.dataset.de = params.de;
      primeira = false;
      el.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.tipo !== tipo) renderLancar(ctx, el, { tipo: b.dataset.tipo, tanque: params.tanque, de: tiposVisiveis.findIndex(([k]) => k === tipo), volta, rolagem: el.querySelector('.seg').scrollLeft });
      }));
    };
    return renderTransferir(ctx, el, { tanque: params.tanque, segHtml, ligarSeg });
  }
  const ultimo = (await db.kvGet('ultimoTanque')) || '';
  const tanqueInicial = tanques.some((t) => t.id === params.tanque) ? params.tanque : (tanques.some((t) => t.id === ultimo) ? ultimo : tanques[0].id);
  const hoje = hojeISO();

  el.classList.remove('modo-sucesso');
  el.innerHTML = `
    <h1>Lançar</h1>
    <div class="seg" style="--n:${tiposVisiveis.length}" role="tablist">
      ${tiposVisiveis.map(([k, v]) => `<button type="button" data-tipo="${k}" class="${k === tipo ? 'on' : ''}">${v.rotulo}</button>`).join('')}
    </div>
    <div class="pc-duas lc-duas"><div>
    <form id="f" class="form passos" novalidate>
      <section class="passo">
        <h2 class="passo-t"><i>1</i> Tanque</h2>
        <div class="campo">
          <div class="tanque-atual"><div><b id="tanque-nome">${esc((tanques.find((t) => t.id === tanqueInicial) || {}).nome || '')}</b>${!params.tanque && tanqueInicial === ultimo ? '<small class="tq-ultimo" id="tq-ultimo">mesmo tanque do último lançamento · confira</small>' : ''}</div>
            ${tanques.length > 1 ? `<button type="button" class="btn mini" id="b-trocar">${params.escolher ? 'Fechar' : 'Trocar'}</button>` : ''}</div>
          <div class="tiles compactos" id="tiles" role="radiogroup" aria-label="Escolha o tanque"${params.escolher ? '' : ' hidden'}>${[...tanques].sort(ordemNatural).map((t) => `<button type="button" class="tile${t.id === tanqueInicial ? ' on' : ''}" role="radio" aria-checked="${t.id === tanqueInicial}" data-tanque="${esc(t.id)}"><span>${esc(t.nome)}</span>${((l) => (l ? `<small class="tile-fase">${esc(ROTULO_TIPO[l.tipo] || l.tipo)}</small>` : '<small class="tile-fase">sem lote</small>'))(lotes.find((l) => l.tanque_id === t.id))}<i class="ponto"></i></button>`).join('')}</div>
          <select id="tanque" hidden>${tanques.map((t) => `<option value="${esc(t.id)}"${t.id === tanqueInicial ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')}</select>
        </div>
        <p id="lote-linha" class="lote-linha" hidden></p>
        <div id="tq-info" class="tq-info" aria-live="polite" hidden></div>
        <label id="lote-wrap">Qual lote? <select id="lote"></select></label>
        <p id="aviso-lotes" class="aviso" hidden></p>
      </section>
      <section class="passo tipo-${tipo}">
        <h2 class="passo-t"><i>2</i> ${TITULO2[tipo]}</h2>
        ${camposDoTipo(tipo, kgSaco, ctx.verDinheiro && ctx.verDinheiro())}
        <div class="data-linha"><span>Data: <b id="data-txt">hoje</b></span><button type="button" class="link" id="b-data">Mudar</button></div>
        <label id="data-wrap" hidden>Data <input id="data" type="date" value="${hoje}" max="${hoje}" required></label>
      </section>
      ${tipo === 'mortalidade' ? `<section class="passo tipo-mortalidade">
        <h2 class="passo-t"><i>3</i> Causa provável <small class="mudo">(opcional)</small></h2>
        <div class="tiles compactos causas" id="causas">
          ${CAUSAS_MORTE.map(([r, d]) => `<button type="button" class="tile" data-causa="${esc(r)}"><span>${esc(r)}</span></button>`).join('')}
          <button type="button" class="tile" data-causa="outros"><span>Outra causa</span></button>
        </div>
        <p class="causa-dica" id="causa-dica" hidden></p>
        <label id="causa-outra-wrap" hidden>Qual foi a causa? <input id="causa-outra" maxlength="60" placeholder="Ex.: queda de energia no aerador"></label>
      </section>` : ''}
      <p id="erro" class="erro" hidden></p>
      <button class="btn primario grande" type="submit">Salvar ${tipo === 'agua' ? 'medição' : TIPOS[tipo].rotulo.toLowerCase()}</button>
      ${navigator.onLine ? '' : '<p class="mudo" style="margin:0;text-align:center">Sem internet: será salvo no celular e enviado depois.</p>'}
    </form></div>
    <aside class="lc-painel" id="painel-tq" aria-label="Resumo do tanque escolhido"></aside></div>`;

  // com 5 abas no celular estreito, a aba escolhida fica à vista
  { const sg = el.querySelector('.seg'), on = sg && sg.querySelector('button.on'); if (on && sg.scrollWidth > sg.clientWidth) centrarAba(sg, on, params.rolagem); }
  if (params.de !== undefined) { const sg = el.querySelector('.seg'); if (sg) sg.dataset.de = params.de; }
  el.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => renderLancar(ctx, el, { tipo: b.dataset.tipo, tanque: el.querySelector('#tanque').value, de: tiposVisiveis.findIndex(([k]) => k === tipo), volta, rolagem: el.querySelector('.seg').scrollLeft })));

  const f = el.querySelector('#f');
  let rascunhoSalvo = false, timerRascunho = null;
  const selTanque = f.querySelector('#tanque');
  f.querySelectorAll('#tiles .tile').forEach((b) => b.addEventListener('click', () => {
    selTanque.value = b.dataset.tanque;
    f.querySelectorAll('#tiles .tile').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
    selTanque.dispatchEvent(new Event('change'));
    f.querySelector('#tanque-nome').textContent = (tanques.find((t) => t.id === b.dataset.tanque) || {}).nome || '';
    fecharTiles();
    mostrarUltima();
  }));
  function fecharTiles() { const t = f.querySelector('#tiles'); t.hidden = true; const bt = f.querySelector('#b-trocar'); if (bt) bt.textContent = 'Trocar'; }
  const btTrocar = f.querySelector('#b-trocar');
  if (btTrocar) btTrocar.addEventListener('click', () => {
    const t = f.querySelector('#tiles'); t.hidden = !t.hidden; btTrocar.textContent = t.hidden ? 'Trocar' : 'Fechar';
  });
  const dataIn = f.querySelector('#data');
  f.querySelector('#b-data').addEventListener('click', () => {
    const w = f.querySelector('#data-wrap'); w.hidden = !w.hidden;
    f.querySelector('#b-data').textContent = w.hidden ? 'Mudar' : 'Fechar';
    if (!w.hidden) dataIn.focus();
  });
  dataIn.addEventListener('input', () => { f.querySelector('#data-txt').textContent = !dataIn.value || dataIn.value === hoje ? 'hoje' : fmtData(dataIn.value); });
  const selLote = f.querySelector('#lote');
  const erro = f.querySelector('#erro');
  const mostrarErro = (m) => { erro.textContent = m; erro.hidden = false; };

  function montarLotes() {
    const doTanque = lotes.filter((l) => l.tanque_id === selTanque.value);
    if (!doTanque.length) {
      selLote.innerHTML = '<option value="">— sem lote ativo —</option>';
      selLote.disabled = true;
      f.querySelector('#lote-wrap').hidden = false;
      f.querySelector('#lote-linha').hidden = true;
      f.querySelector('#aviso-lotes').hidden = true;
      mostrarErro('Este tanque não tem lote ativo. Peça ao gerente para cadastrar o lote.');
      return;
    }
    erro.hidden = true;
    selLote.disabled = false;
    f.querySelector('#lote-wrap').hidden = doTanque.length < 2;
    const linha = f.querySelector('#lote-linha');
    linha.hidden = doTanque.length !== 1;
    if (doTanque.length === 1) linha.textContent = `${ROTULO_TIPO[doTanque[0].tipo] || doTanque[0].tipo} · ${doTanque[0].especie}`;
    const avisoLotes = f.querySelector('#aviso-lotes');
    avisoLotes.hidden = !(doTanque.length > 1 && tipo === 'racao');
    avisoLotes.textContent = 'Este tanque tem mais de um lote ativo. A ração será contada só no lote escolhido acima.';
    selLote.innerHTML = doTanque.map((l) => `<option value="${esc(l.id)}">${esc(ROTULO_TIPO[l.tipo] || l.tipo)} · ${esc(l.especie)} · desde ${fmtData(l.data_entrada)}</option>`).join('');
  }
  selTanque.addEventListener('change', montarLotes);
  montarLotes();

  // painel ao lado (computador): ração dos últimos 7 dias, hoje × média e sobrevivência do tanque escolhido
  const painel = el.querySelector('#painel-tq');
  let dadosPainel = null, lendo = null;
  // ração dos últimos 7 dias e resumo dos lotes (só com internet), lidos uma vez para o painel e para a linha do celular;
  // se o resumo falhar, não guarda nada e tenta de novo na próxima troca de tanque
  const dadosGuardados = () => ctx.api.resumoGuardado().then((l) => (l ? { rac: [], res: Object.fromEntries(l.map((x) => [x.lote_id, x])), desde: '' } : null)).catch(() => null);
  // ao salvar, a conferência nunca segura o lançamento: sem resposta em 2,5 s, usa o que está guardado
  const dadosRapidos = async () => (await Promise.race([carregarDados(), new Promise((r) => setTimeout(() => r(null), 2500))])) || dadosGuardados();
  function carregarDados() {
    if (dadosPainel) return Promise.resolve(dadosPainel);
    if (!navigator.onLine) return dadosGuardados();
    if (!lendo) {
      const d7 = new Date(`${hoje}T12:00:00`); d7.setDate(d7.getDate() - 6);
      const desde = d7.toISOString().slice(0, 10);
      lendo = Promise.all([ctx.api.racaoPeriodo(desde).catch(() => []), ctx.api.resumoLotes()])
        .then(([rac, res]) => (dadosPainel = { rac, res: Object.fromEntries((res || []).map((x) => [x.lote_id, x])), desde }))
        .catch(() => null)
        .finally(() => { lendo = null; });
    }
    return lendo;
  }
  // ração do tanque dia a dia (inclui o que ainda está na fila do celular), média dos dias anteriores com ração e a de hoje
  async function racaoSemana(tid) {
    const d = await carregarDados();
    const fila = (await db.filaList()).filter((i) => i.tabela === 'racao_consumo' && i.payload.tanque_id === tid);
    const dias = Array.from({ length: 7 }, (_, i) => { const x = new Date(`${hoje}T12:00:00`); x.setDate(x.getDate() - (6 - i)); return x.toISOString().slice(0, 10); });
    const porDia = Object.fromEntries(dias.map((x) => [x, 0]));
    for (const r of (d && d.rac) || []) if (r.tanque_id === tid && r.data in porDia) porDia[r.data] += Number(r.quantidade_kg) || 0;
    for (const i of fila) if (i.payload.data in porDia) porDia[i.payload.data] += Number(i.payload.quantidade_kg) || 0;
    const ant = dias.slice(0, 6).map((x) => porDia[x]).filter((v) => v > 0);
    return { dias, porDia, media: ant.length ? ant.reduce((a, b) => a + b, 0) / ant.length : 0, hojeKg: porDia[hoje] };
  }
  const sc = (kg) => fmtNum(kg / kgSaco, kg / kgSaco < 10 && kg % kgSaco ? 1 : 0);
  const pesoTxt = (pm) => (pm < 1 ? fmtNum(pm * 1000, 0) + ' g' : fmtNum(pm, pm < 10 ? 2 : 1) + ' kg');
  async function pintarPainel() {
    if (!painel || getComputedStyle(painel).display === 'none') return;
    const t = tanques.find((x) => x.id === selTanque.value);
    if (!t) { painel.innerHTML = ''; return; }
    const doTanque = lotes.filter((l) => l.tanque_id === t.id);
    const { dias, porDia, media, hojeKg } = await racaoSemana(t.id);
    const maxD = Math.max(1, ...Object.values(porDia));
    let vivos = 0, ini = 0, pm = null, mortos = 0;
    for (const l of doTanque) {
      const r = dadosPainel && dadosPainel.res[l.id];
      ini += Number(l.quantidade_inicial) || 0; mortos += Number(r && r.mortos) || 0;
      vivos += vivosDoLote(l, r);
      if (r && r.ultimo_peso_medio_kg != null) pm = Number(r.ultimo_peso_medio_kg);
    }
    painel.innerHTML = `
      <p class="lc-cab">Resumo do tanque</p>
      <h2>${esc(t.nome)}</h2>
      <p class="mudo" style="margin:.1rem 0 0">${doTanque.length === 1 ? `${esc(ROTULO_TIPO[doTanque[0].tipo] || doTanque[0].tipo)} · ${esc(doTanque[0].especie)}` : doTanque.length ? `${doTanque.length} lotes ativos` : 'Sem lote ativo'}</p>
      ${doTanque.length ? `<dl class="lc-num">
        <div><dt>Peixes vivos</dt><dd>${fmtInt(vivos)}</dd></div>
        <div><dt>Peso médio</dt><dd>${pm != null ? (pm < 1 ? fmtNum(pm * 1000, 0) + ' g' : fmtNum(pm, 2) + ' kg') : '—'}</dd></div>
      </dl>
      ${ini > 0 && dadosPainel ? `${progresso((Math.max(0, ini - mortos) / ini) * 100, { tom: 'ok', fina: true, rotulo: 'Sobrevivência do lote' })}<p class="h-trilho-leg"><span>Sobrevivência</span><b>${fmtPct((Math.max(0, ini - mortos) / ini) * 100)}%</b></p>` : ''}` : ''}
      ${tipo === 'racao' || media || hojeKg ? `<h3 class="lc-sub">Ração de hoje</h3>
      ${media ? `${progresso((hojeKg / media) * 100, { tom: hojeKg >= media ? 'ok' : '', rotulo: 'Ração de hoje comparada à média' })}
        <p class="h-trilho-leg"><span><b>${sc(hojeKg)}</b> de ~${sc(media)} sacos (média dos dias com ração)</span></p>`
        : `<p class="mudo pequeno">${hojeKg ? `${sc(hojeKg)} sacos lançados hoje.` : 'Sem ração nos últimos dias para comparar.'}</p>`}
      <h3 class="lc-sub">Últimos 7 dias</h3>
      <ul class="lc-dias">${dias.map((d) => `<li class="${d === hoje ? 'hoje' : ''}"><span>${d === hoje ? 'Hoje' : fmtData(d).slice(0, 5)}</span><i><em style="width:${((porDia[d] / maxD) * 100).toFixed(1)}%"></em></i><b>${porDia[d] ? sc(porDia[d]) : '–'}</b></li>`).join('')}</ul>
      <p class="mudo pequeno" style="margin:.4rem 0 0">Em sacos de ${fmtNum(kgSaco, 0)} kg.</p>` : ''}`;
  }
  selTanque.addEventListener('change', pintarPainel);
  pintarPainel();

  // celular (sem o painel ao lado): os números do tanque e o que importa para este lançamento, numa linha
  const info = f.querySelector('#tq-info');
  let mortes7 = null;
  async function pintarInfo() {
    if (matchMedia('(min-width: 1100px)').matches) { info.hidden = true; return; }
    const tid = selTanque.value;
    const doTanque = lotes.filter((l) => l.tanque_id === tid);
    const d = await carregarDados();
    if (!doTanque.length || !d || selTanque.value !== tid) { if (selTanque.value === tid) info.hidden = true; return; }
    let vivos = 0, kg = 0, pm = null, bio = null;
    for (const l of doTanque) {
      const r = d.res[l.id], qi = Number(l.quantidade_inicial) || 0;
      const v = vivosDoLote(l, r);
      const p = r && r.ultimo_peso_medio_kg != null ? Number(r.ultimo_peso_medio_kg) : qi > 0 ? Number(l.peso_inicial_kg) / qi : null;
      vivos += v;
      if (p != null) kg += v * p;
      if (doTanque.length === 1) pm = p;
      if (r && r.ultima_biometria && (!bio || r.ultima_biometria > bio.data)) bio = { data: r.ultima_biometria, pm: Number(r.ultimo_peso_medio_kg) };
    }
    const nums = [`<b>${fmtInt(vivos)}</b> peixes`];
    if (pm != null) nums.push(`<b>${pesoTxt(pm)}</b> peso médio`);
    // o peso total de peixe fica só para quem gere a fazenda
    if (ctx.podeGerir() && kg > 0) nums.push(kg >= 1000 ? `<b>${fmtNum(kg / 1000, 1)} t</b> na água` : `<b>${fmtNum(kg, 0)} kg</b> na água`);
    let extra = '';
    if (tipo === 'racao') {
      const { media, hojeKg } = await racaoSemana(tid);
      extra = media ? `Hoje: <b>${sc(hojeKg)}</b> de ~${sc(media)} sacos (média dos últimos dias)`
        : hojeKg ? `Hoje: <b>${sc(hojeKg)}</b> ${hojeKg / kgSaco === 1 ? 'saco lançado' : 'sacos lançados'}` : 'Hoje: nenhum saco lançado ainda';
    } else if (tipo === 'biometria') {
      extra = bio ? `Última pesagem: <b>${fmtData(bio.data).slice(0, 5)}</b> · ${pesoTxt(bio.pm)} por peixe` : 'Ainda sem pesagem neste tanque';
    } else if (tipo === 'mortalidade') {
      if (!mortes7) {
        const d7 = new Date(`${hoje}T12:00:00`); d7.setDate(d7.getDate() - 6);
        mortes7 = await ctx.api.mortalidadePeriodo(d7.toISOString().slice(0, 10)).catch(() => []);
      }
      const ids = new Set(doTanque.map((l) => l.id));
      const n = mortes7.filter((m) => ids.has(m.lote_id)).reduce((a, m) => a + (Number(m.quantidade) || 0), 0);
      extra = `Mortes nos últimos 7 dias: <b>${fmtInt(n)}</b>`;
    }
    if (selTanque.value !== tid) return;
    info.innerHTML = `<span class="tq-nums">${nums.map((x) => `<span>${x}</span>`).join(' · ')}</span>${extra ? `<span class="tq-ctx">${extra}</span>` : ''}`;
    info.hidden = false;
  }
  selTanque.addEventListener('change', pintarInfo);
  selTanque.addEventListener('change', () => { const u = f.querySelector('#tq-ultimo'); if (u) u.remove(); });
  pintarInfo();
  // biometria: peso da amostra em gramas no alevino e no berçário (o banco guarda sempre em kg)
  const pesoEmGramas = () => { const l = lotes.find((x) => x.id === selLote.value); return !!l && ['alevinagem', 'bercario'].includes(l.tipo); };
  const pesoAmostraKg = () => { const el = f.querySelector('#peso'); if (!el) return 0; const v = numDecimal(el.value); return v > 0 ? (pesoEmGramas() ? v / 1000 : v) : v; };

  if (tipo === 'biometria') {
    // mortos por lote (só com internet): permite estimar os peixes vivos e a biomassa na hora
    let mortos = null;
    // alevino e berçário: a amostra se pesa em gramas no campo (50 alevinos = 400 g)
    const ajustaUnidade = () => {
      const g = pesoEmGramas();
      f.querySelector('#rot-peso').textContent = `Peso total dos peixes (${g ? 'gramas' : 'kg'})`;
      f.querySelector('#peso').placeholder = g ? 'Ex.: 400' : 'Ex.: 2,4';
    };
    selLote.addEventListener('change', ajustaUnidade); selTanque.addEventListener('change', ajustaUnidade); ajustaUnidade();
    const atualizaPm = () => {
      const p = pesoAmostraKg(), q = num(f.querySelector('#amostra').value);
      const pm = f.querySelector('#pm'), aviso = f.querySelector('#aviso-amostra');
      if (!(p > 0 && q > 0)) { pm.textContent = 'Peso médio: —'; aviso.hidden = true; return; }
      const medioG = (p / q) * 1000;
      let txt = `Peso médio: ${pesoMedioTxt(medioG / 1000)} por peixe`;
      const lote = lotes.find((l) => l.id === selLote.value);
      if (lote && mortos) {
        const vivos = Math.max(0, Number(lote.quantidade_inicial) - (mortos[lote.id] || 0));
        txt += `\nBiomassa estimada do tanque: ${fmtNum((vivos * medioG) / 1000, 0)} kg (${fmtInt(vivos)} peixes vivos)`;
      }
      pm.textContent = txt;
      aviso.hidden = !(q < 30);
    };
    f.querySelector('#peso').addEventListener('input', atualizaPm);
    f.querySelector('#amostra').addEventListener('input', atualizaPm);
    selLote.addEventListener('change', atualizaPm);
    selTanque.addEventListener('change', atualizaPm);
    if (navigator.onLine) {
      ctx.api.resumoLotes().then((r) => { mortos = Object.fromEntries(r.map((x) => [x.lote_id, Number(x.mortos) + Number(x.despescados || 0) + Number(x.transferidos || 0)])); atualizaPm(); }).catch(() => {});
    }
  }

  // água: mostra na hora o que está fora da faixa (só para tambaqui, a única espécie com faixa de fonte conhecida)
  const AG_CAMPOS = [['#ag-od', 'oxigenio_mgl', 'oxigenio', 'Oxigênio'], ['#ag-temp', 'temperatura_c', 'temperatura', 'Temperatura'], ['#ag-ph', 'ph', 'ph', 'pH'], ['#ag-am', 'amonia_mgl', 'amonia', 'Amônia']];
  const leituraAgua = () => Object.fromEntries(AG_CAMPOS.map(([s, k]) => { const t = f.querySelector(s).value.trim(); return [k, t ? numDecimal(t) : null]; }));
  const temTambaqui = () => lotes.some((l) => l.tanque_id === selTanque.value && ehTambaqui(l.especie));
  if (tipo === 'agua') {
    const res = f.querySelector('#ag-res');
    const pintar = () => {
      const m = leituraAgua();
      if (!temTambaqui() || Object.values(m).every((v) => v == null || !Number.isFinite(v))) { res.hidden = true; return; }
      const fora = avaliarAgua(m);
      res.textContent = fora.length ? fora.map((x) => x.texto[0].toUpperCase() + x.texto.slice(1)).join('\n') : 'Dentro da faixa do tambaqui.';
      res.hidden = false;
    };
    AG_CAMPOS.forEach(([s]) => f.querySelector(s).addEventListener('input', pintar));
    selTanque.addEventListener('change', pintar);
  }

  // manejo: na ração ou na água; o último produto já vem preenchido
  let manVia = 'racao';
  if (tipo === 'manejo') {
    f.querySelectorAll('#man-via .tile').forEach((b) => b.addEventListener('click', () => {
      manVia = b.dataset.via;
      f.querySelectorAll('#man-via .tile').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
    }));
    db.kvGet('produtosManejo').then((l) => {
      if (!Array.isArray(l) || !l.length) return;
      const entrada = f.querySelector('#man-produto'), lista = f.querySelector('#man-produtos');
      if (lista) lista.innerHTML = l.map((p) => `<option value="${esc(p)}"></option>`).join('');
      if (entrada && !entrada.value) entrada.value = l[0];
    }).catch(() => {});
  }

  // despesca: parcial mantém o lote; total encerra. Mostra as contas enquanto digita.
  let despTipo = 'parcial';
  if (tipo === 'despesca') {
    const dica = f.querySelector('#desp-dica');
    const pintarDica = () => { dica.textContent = despTipo === 'total' ? 'Tira todos os peixes que restam e encerra o lote.' : 'Tira parte dos peixes. O lote continua ativo com os que ficaram.'; };
    const contas = () => {
      const box = f.querySelector('#desp-calc');
      const q = num(f.querySelector('#desp-qtd').value), b = numDecimal(f.querySelector('#desp-bruto').value);
      const lq = f.querySelector('#desp-liquido').value.trim();
      if (!(q > 0 && b > 0)) { box.hidden = true; return; }
      const area = (tanques.find((t) => t.id === selTanque.value) || {}).area_ha;
      const i = indicadoresDespesca({ quantidade: q, peso_bruto_kg: b, peso_liquido_kg: lq ? numDecimal(lq) : null }, area);
      const L = [`Peso médio bruto: ${pesoMedioTxt(i.medioBrutoKg)} por peixe`];
      if (i.medioLiquidoKg != null) L.push(`Peso médio líquido: ${pesoMedioTxt(i.medioLiquidoKg)} por peixe`, `Diferença: ${fmtNum(i.difKg, 0)} kg (${fmtNum(i.difPct, 1)}% do bruto)`);
      if (i.peixesHa != null) L.push(`${fmtInt(i.peixesHa)} peixes por hectare`);
      const prTxt = (f.querySelector('#desp-preco') || { value: '' }).value.trim(), pr = prTxt ? numMoeda(prTxt) : null;
      if (pr > 0) L.push(`Receita: ${fmtBRL(i.kgVendido * pr)} (${fmtNum(i.kgVendido, 0)} kg ${i.receitaSobre} × ${fmtBRL(pr)})`);
      box.textContent = L.join('\n'); box.hidden = false;
    };
    f.querySelectorAll('#desp-tipo .tile').forEach((b) => b.addEventListener('click', () => {
      despTipo = b.dataset.desp;
      f.querySelectorAll('#desp-tipo .tile').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      pintarDica();
    }));
    // desconto em % (sugestão do cliente piloto, 15/11/2026): bruto − % = líquido, sem sair do app para a calculadora.
    // O último % usado fica guardado no aparelho e já vem preenchido na próxima despesca.
    const descEl = f.querySelector('#desp-desc'), liqEl = f.querySelector('#desp-liquido'), brutoEl = f.querySelector('#desp-bruto');
    try { const g = localStorage.getItem('despesca_desconto'); if (g) descEl.value = g; } catch { /* sem armazenamento */ }
    const aplicarDesconto = () => {
      const d = numDecimal(descEl.value), b = numDecimal(brutoEl.value);
      if (!String(descEl.value).trim() || !(d > 0 && d < 50) || !(b > 0) || (brutoEl.value.includes('.') && brutoEl.value.includes(','))) return;
      const lq = Math.round(b * (1 - d / 100) * 10) / 10;
      liqEl.value = String(lq).replace('.', ',');
      const aj = f.querySelector('#desp-desc-ajuda'); if (aj) aj.textContent = `${fmtNum(b, b % 1 ? 1 : 0)} kg − ${String(d).replace('.', ',')}% = ${fmtNum(lq, lq % 1 ? 1 : 0)} kg de peso líquido.`;
    };
    descEl.addEventListener('input', () => { aplicarDesconto(); contas(); });
    brutoEl.addEventListener('input', aplicarDesconto);
    liqEl.addEventListener('input', () => { descEl.value = ''; const aj = f.querySelector('#desp-desc-ajuda'); if (aj) aj.textContent = 'O peso líquido é preenchido sozinho.'; }); // líquido digitado à mão: vale o que foi digitado
    ['#desp-qtd', '#desp-bruto', '#desp-liquido', '#desp-preco'].forEach((s) => { const c = f.querySelector(s); if (c) c.addEventListener('input', contas); });
    selTanque.addEventListener('change', contas);
    pintarDica();
  }

  async function mostrarUltima() {
    const b = f.querySelector('#b-ultima');
    if (!b) return;
    const m = (await db.kvGet('ultimaRacao')) || {};
    const v = m[selTanque.value];
    if (!(v > 0)) { b.hidden = true; return; }
    b.hidden = false;
    const kg = Math.round(v * 100) / 100;
    b.textContent = `↺ Repetir ${kgTxt(kg)} kg (última vez)`;
    b.onclick = () => { const q = f.querySelector('#racao-kg'); q.value = kgTxt(kg); q.dispatchEvent(new Event('input')); q.focus(); };
  }
  mostrarUltima();

  // sugestão do dia: % do peso vivo do tanque pela faixa de peso (tabela em config.js; faixas sem fonte são provisórias)
  let resumoLotes = null;
  async function mostrarSugestao() {
    const box = f.querySelector('#sug-racao');
    if (!box) return;
    if (!resumoLotes && navigator.onLine) resumoLotes = Object.fromEntries(((await ctx.api.resumoLotes().catch(() => [])) || []).map((r) => [r.lote_id, r]));
    const sug = sugestaoRacao(lotes.filter((l) => l.tanque_id === selTanque.value), resumoLotes || {}, TAXA_RACAO);
    if (!sug) { box.hidden = true; return; }
    const kgSug = sug.kg < 10 ? Math.round(sug.kg * 10) / 10 : Math.round(sug.kg);
    const bio = sug.biomassaKg >= 1000 ? `${fmtNum(sug.biomassaKg / 1000, 1)} t` : `${fmtNum(sug.biomassaKg, 0)} kg`;
    box.hidden = false;
    box.innerHTML = `<button type="button" class="chip" id="b-sug">Sugestão: ${kgTxt(kgSug)} kg (${esc(sacosTxt(sacosDeKg(kgSug, kgSaco)))})</button>
      <small>${fmtNum(sug.pct, 1)}% do peso vivo${ctx.podeGerir() ? ` (${bio} de peixe)` : ''}${sug.provisoria ? ' · taxa provisória, confirme com o técnico' : ''}</small>`;
    box.querySelector('#b-sug').onclick = () => { const q = f.querySelector('#racao-kg'); q.value = kgTxt(kgSug); q.dispatchEvent(new Event('input')); q.focus(); };
  }
  if (tipo === 'racao') { mostrarSugestao(); selTanque.addEventListener('change', mostrarSugestao); }
  if (tipo === 'racao') {
    const q = f.querySelector('#racao-kg'), conv = f.querySelector('#conv');
    q.addEventListener('input', () => { const n = kgDigitado(q.value); conv.textContent = n > 0 ? kgEmSacosTxt(n, kgSaco) : `Digite o total em kg. Ex.: 600 kg = ${sacosTxt(sacosDeKg(600, kgSaco))}`; });
  }
  // funcionário: teclado grande na tela para os números da ronda (ração, mortes e pesagem)
  if (!ctx.podeGerir()) {
    const c = (sel) => f.querySelector(sel);
    if (tipo === 'racao') ligarTeclado([{ el: c('#racao-kg'), decimal: true }], c('#sug-racao'));
    else if (tipo === 'mortalidade') ligarTeclado([{ el: c('#qtd'), decimal: false }], c('#qtd').closest('label'));
    else if (tipo === 'biometria') ligarTeclado([{ el: c('#peso'), decimal: true }, { el: c('#amostra'), decimal: false }], c('#pm'));
    if (['racao', 'mortalidade', 'biometria'].includes(tipo)) f.classList.add('com-teclado');
  }

  // marca os tanques que já receberam ração hoje (fila local + servidor, quando houver internet)
  async function marcarAlimentados() {
    const feitos = new Set((await db.filaList()).filter((i) => i.tabela === 'racao_consumo' && i.payload.data === hoje).map((i) => i.payload.tanque_id));
    if (navigator.onLine) {
      try { for (const r of await ctx.api.resumoLotes()) { if (r.ultima_racao === hoje) { const l = lotes.find((x) => x.id === r.lote_id); if (l) feitos.add(l.tanque_id); } } } catch { /* sem detalhe */ }
    }
    feitosHoje = feitos;
    const tiles = f.querySelector('#tiles');
    const lista = [...tiles.querySelectorAll('.tile')];
    lista.forEach((b) => { const ok = feitos.has(b.dataset.tanque); const tem = lotes.some((l) => l.tanque_id === b.dataset.tanque); b.classList.toggle('feito', ok); b.classList.toggle('pend', !ok && tem); b.title = ok ? 'já recebeu ração hoje' : ''; });
    lista.sort((a, b2) => Number(a.classList.contains('feito')) - Number(b2.classList.contains('feito'))).forEach((b) => tiles.appendChild(b));
  }
  let feitosHoje = null;
  if (tipo === 'racao') marcarAlimentados();

  // Procura um lançamento parecido, na fila do aparelho e (com internet) no servidor.
  // Ração: mesmo tanque e dia com a mesma quantidade, ou qualquer um nos últimos 30 minutos.
  // Mortalidade: mesmo lote, dia e quantidade. Biometria: mesmo lote e dia.
  async function acharParecido(tp, pl) {
    if (tp === 'agua') return null; // medir de manhã e à tarde no mesmo dia é normal
    try {
      const tab = TIPOS[tp].tabela;
      const locais = (await db.filaList()).filter((i) => i.tabela === tab && i.payload.data === pl.data && (tp === 'racao' ? i.payload.tanque_id === pl.tanque_id : i.payload.lote_id === pl.lote_id));
      let regs = locais.map((i) => ({ q: tp === 'racao' ? i.payload.quantidade_kg : i.payload.quantidade, p: i.payload.produto, em: i.criado_em }));
      if (navigator.onLine) {
        const rem = await Promise.race([ctx.api.registrosDoDia(tp, pl), new Promise((r) => setTimeout(() => r([]), 2500))]).catch(() => []);
        regs = regs.concat(rem.map((r) => ({ q: tp === 'racao' ? r.quantidade_kg : r.quantidade, p: r.produto, em: r.criado_em })));
      }
      const agora = Date.now();
      const hora = (em) => new Date(em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      if (tp === 'racao') {
        const igual = regs.find((r) => Math.abs(Number(r.q) - pl.quantidade_kg) < 0.01);
        const recente = regs.find((r) => r.em && agora - new Date(r.em).getTime() < 30 * 60000);
        const r = igual || recente; if (!r) return null;
        return `Este tanque já recebeu ${kgTxt(Number(r.q))} kg (${sacosTxt(sacosDeKg(Number(r.q), kgSaco))}) neste dia${r.em ? ` (às ${hora(r.em)})` : ''}.`;
      }
      if (tp === 'manejo') { const r = regs.find((x) => x.p === pl.produto); return r ? `${pl.produto} já foi lançado neste lote nesta data${r.em ? ` (às ${hora(r.em)})` : ''}.` : null; }
      if (tp === 'despesca') { const r = regs.find((x) => Number(x.q) === pl.quantidade); return r ? `Já há uma despesca de ${plural(pl.quantidade, 'peixe', 'peixes')} neste lote nesta data${r.em ? ` (às ${hora(r.em)})` : ''}.` : null; }
      if (tp === 'mortalidade') { const r = regs.find((x) => Number(x.q) === pl.quantidade); return r ? `Já há ${plural(pl.quantidade, 'peixe morto lançado', 'peixes mortos lançados')} neste lote nesta data${r.em ? ` (às ${hora(r.em)})` : ''}.` : null; }
      return regs.length ? 'Já existe uma biometria deste lote nesta data.' : null;
    } catch { return null; }
  }

  // causa provável da mortalidade: toque escolhe, toque de novo desmarca; "Outra causa" abre o campo de texto
  let causaSel = '';
  const causaOutra = f.querySelector('#causa-outra');
  f.querySelectorAll('#causas .tile').forEach((b) => b.addEventListener('click', () => {
    causaSel = b.classList.contains('on') ? '' : b.dataset.causa;
    f.querySelectorAll('#causas .tile').forEach((x) => x.classList.toggle('on', x.dataset.causa === causaSel));
    f.querySelector('#causa-outra-wrap').hidden = causaSel !== 'outros';
    const dica = f.querySelector('#causa-dica'), par = CAUSAS_MORTE.find(([r]) => r === causaSel);
    dica.textContent = par ? par[1] : ''; dica.hidden = !par; // a explicação aparece só da causa escolhida
    if (causaSel === 'outros') causaOutra.focus();
  }));
  function causaEscolhida() {
    if (!causaSel) return '';
    if (causaSel !== 'outros') return causaSel;
    const t = causaOutra.value.trim().slice(0, 60);
    return t ? `Outros: ${t}` : 'Outros';
  }

  // pergunta antes de gravar um peso médio muito fora do esperado (kg no lugar de g, ponto de milhar); nunca bloqueia
  async function pesoConferido(loteId, quantidade, pesoTotalKg, data, dados) {
    const lote = lotes.find((l) => l.id === loteId);
    if (!lote) return true;
    const texto = avisoPesoMedio({ quantidade, pesoTotalKg, lote, r: dados && dados.res[lote.id], data });
    return !texto || confirmar({ titulo: 'Confira o peso', texto, ok: 'Está certo', cancelar: 'Corrigir' });
  }

  // Estoque registrado não cobre este lançamento de ração: avisa e pede a compra, mas deixa lançar (o peixe
  // já comeu; travar o funcionário no tanque só faria o lançamento ficar sem registro). Sem saldo conhecido, não pergunta.
  async function estoqueConferido(lote, kg) {
    try {
      const tipoR = tipoRacaoDoLote(lote && lote.tipo);
      if (navigator.onLine) ctx.api.saldosRacao().catch(() => null); // atualiza a cópia para a próxima vez
      const s = await db.kvGet('saldosRacao');
      if (!s || !Array.isArray(s.linhas) || !s.linhas.length) return true;
      const linha = s.porTipo ? s.linhas.find((x) => x.tipo_racao === tipoR) : s.linhas[0];
      const pend = (await db.filaList()).filter((i) => i.tabela === 'racao_consumo'
        && (!s.porTipo || tipoRacaoDoLote((lotes.find((l) => l.id === i.payload.lote_id) || {}).tipo) === tipoR))
        .reduce((t, i) => t + Number(i.payload.quantidade_kg || 0), 0);
      const falta = faltaNoEstoque(linha ? linha.saldo_kg : 0, pend, kg);
      if (!falta) return true;
      const kgSaco = state.ref.kgSaco || PESO_SACO_PADRAO_KG, nome = s.porTipo ? `ração de ${tipoR}` : 'ração';
      const sacosTxt = `${fmtNum(Math.ceil((falta / kgSaco) * 10) / 10, 1).replace(/,0$/, '')} ${falta / kgSaco <= 1 ? 'saco' : 'sacos'}`;
      return confirmar({
        titulo: `Falta ${nome} no estoque`,
        texto: `Pelo estoque registrado, faltam ${sacosTxt} (${fmtNum(falta, 0)} kg) de ${nome} para este lançamento. Pode lançar, mas ${ctx.podeGerir() ? 'registre a compra que faltou em Estoque de ração (ou conte o galpão)' : 'avise o dono para registrar a compra que faltou'}, para o estoque não ficar errado.`,
        ok: 'Lançar mesmo assim', cancelar: 'Voltar',
      });
    } catch { return true; }
  }

  // o lançamento em palavras: "600 kg de ração (24 sacos)", "12 peixes mortos"...
  const resumoDe = (payload) => (tipo === 'racao' ? `${kgTxt(payload.quantidade_kg)} kg de ração (${sacosTxt(sacosDeKg(payload.quantidade_kg, kgSaco))})`
    : tipo === 'biometria' ? `${pesoMedioTxt(payload.peso_amostra_kg / payload.quantidade_amostrada)} de peso médio (${fmtInt(payload.quantidade_amostrada)} peixes pesados)`
    : tipo === 'agua' ? [payload.oxigenio_mgl != null && `O₂ ${fmtNum(payload.oxigenio_mgl, 1)} mg/L`, payload.temperatura_c != null && `${fmtNum(payload.temperatura_c, 1)} °C`, payload.ph != null && `pH ${fmtNum(payload.ph, 1)}`, payload.amonia_mgl != null && `amônia ${fmtNum(payload.amonia_mgl, 2)} mg/L`].filter(Boolean).join(' · ')
    : tipo === 'manejo' ? `${payload.produto}: ${String(payload.dose).replace('.', ',')} ${payload.unidade} ${payload.via === 'agua' ? 'na água' : 'na ração'}`
    : tipo === 'despesca' ? `despesca ${payload.tipo}: ${plural(payload.quantidade, 'peixe', 'peixes')}, ${fmtNum(payload.peso_bruto_kg, 0)} kg bruto`
    : `${plural(payload.quantidade, 'peixe morto', 'peixes mortos')}`);

  const aoSalvar = async () => {
    erro.hidden = true;
    const lote_id = selLote.value;
    const data = f.querySelector('#data').value;
    if (!lote_id) return mostrarErro('Selecione um tanque com lote ativo.');
    if (!data) return mostrarErro('Informe a data.');
    if (data > hojeISO()) return mostrarErro('A data não pode ser no futuro.');
    // nenhum lançamento antes de o lote existir (antes só a despesca conferia: dava para lançar mortos em julho num lote de agosto)
    const loteSel = lotes.find((l) => l.id === lote_id);
    if (loteSel && data < loteSel.data_entrada) return mostrarErro(`A data não pode ser antes da entrada do lote (${fmtData(loteSel.data_entrada)}).`);

    const id = uuid();
    const base = { uuid_local: id, lote_id, data, registrado_por: state.perfil.id };
    let payload;
    if (tipo === 'racao') {
      const kgTxtCampo = f.querySelector('#racao-kg').value, q = kgDigitado(kgTxtCampo);
      if (kgTxtCampo.includes('.') && kgTxtCampo.includes(',')) return mostrarErro('Digite os kg sem ponto de milhar. Ex.: 1250,5');
      if (!(q > 0)) return mostrarErro('Informe quantos kg de ração foram dados (pode ter vírgula: 37,5).');
      if (q > 5000) return mostrarErro('Quantidade muito alta para um tanque num dia. Confira os kg.');
      payload = { ...base, tanque_id: selTanque.value, quantidade_kg: Math.round(q * 100) / 100 };
      if (!(await estoqueConferido(loteSel, payload.quantidade_kg))) return;
    } else if (tipo === 'biometria') {
      const pesoTxt = f.querySelector('#peso').value, p = pesoAmostraKg(), q = num(f.querySelector('#amostra').value);
      if (pesoTxt.includes('.') && pesoTxt.includes(',')) return mostrarErro('Digite o peso sem ponto de milhar. Ex.: 1250,5');
      if (!(p > 0)) return mostrarErro(`Informe o peso total da amostra em ${pesoEmGramas() ? 'gramas' : 'kg'}.`);
      if (!(q >= 1) || !Number.isInteger(q)) return mostrarErro('Informe quantos peixes foram pesados (número inteiro).');
      const loteB = lotes.find((l) => l.id === lote_id), dadosB = await dadosRapidos();
      const vivosB = loteB ? (dadosB && dadosB.res[loteB.id] ? vivosDoLote(loteB, dadosB.res[loteB.id]) : Number(loteB.quantidade_inicial) || null) : null;
      if (vivosB != null && vivosB > 0 && q > vivosB) return mostrarErro(`O tanque tem cerca de ${plural(vivosB, 'peixe', 'peixes')}: não dá para ter pesado ${fmtInt(q)}. Confira a quantidade (um zero a mais?).`);
      if (p / q > 100) return mostrarErro(`Deu ${fmtNum(p / q, 0)} kg por peixe, o que não existe em viveiro. Confira se o peso não foi digitado em gramas (${pesoEmGramas() ? 'o campo está em gramas' : 'o campo está em kg: 2.400 g = 2,4 kg'}).`);
      payload = { ...base, peso_amostra_kg: p, quantidade_amostrada: q };
      if (!(await pesoConferido(lote_id, q, p, data, await dadosRapidos()))) return;
    } else if (tipo === 'despesca') {
      const brutoTxt = f.querySelector('#desp-bruto').value, q = num(f.querySelector('#desp-qtd').value), b = numDecimal(brutoTxt);
      const lqTxt = f.querySelector('#desp-liquido').value.trim(), lq = lqTxt ? numDecimal(lqTxt) : null;
      if (!(q >= 1) || !Number.isInteger(q)) return mostrarErro('Informe quantos peixes saíram (número inteiro).');
      if ((brutoTxt.includes('.') && brutoTxt.includes(',')) || (lqTxt.includes('.') && lqTxt.includes(','))) return mostrarErro('Digite o peso sem ponto de milhar. Ex.: 9547,5');
      if (!(b > 0)) return mostrarErro('Informe o peso total bruto em kg.');
      if (lqTxt && !(lq > 0)) return mostrarErro('Confira o peso líquido em kg, ou deixe em branco.');
      if (lq != null && lq > b) return mostrarErro('O peso líquido não pode ser maior que o bruto.');
      const descTxt = (f.querySelector('#desp-desc') || { value: '' }).value.trim(), desc = descTxt ? numDecimal(descTxt) : null;
      if (descTxt && !(desc > 0 && desc < 50)) return mostrarErro('Confira o desconto: um número entre 0 e 50 (ex.: 2 para 2%), ou deixe em branco.');
      try { if (desc > 0) localStorage.setItem('despesca_desconto', descTxt); } catch { /* sem armazenamento */ }
      const lote = lotes.find((l) => l.id === lote_id);
      if (lote && data < lote.data_entrada) return mostrarErro(`A data não pode ser antes da entrada do lote (${fmtData(lote.data_entrada)}).`);
      const [despescaLigada, dados] = await Promise.all([
        navigator.onLine ? Promise.race([ctx.api.despescaAtiva().catch(() => true), new Promise((r) => setTimeout(() => r(true), 2500))]) : true,
        dadosRapidos(),
      ]);
      if (!despescaLigada) return mostrarErro('A despesca ainda não foi ativada neste sistema (falta rodar o sql/20 no Supabase).');
      // preço e comprador: só o dono vê e informa (valores em R$ só para o dono, sql/23 e sql/28)
      const precoTxt = (f.querySelector('#desp-preco') || { value: '' }).value.trim(), preco = precoTxt ? numMoeda(precoTxt) : null;
      if (precoTxt && !(preco > 0 && preco <= 1000)) return mostrarErro('Confira o preço de venda por kg (até R$ 1.000), ou deixe em branco.');
      const comprador = (f.querySelector('#desp-comprador') || { value: '' }).value.trim();
      if ((precoTxt || comprador) && navigator.onLine && !(await Promise.race([ctx.api.vendaAtiva().catch(() => true), new Promise((r) => setTimeout(() => r(true), 2500))]))) return mostrarErro('A venda na despesca ainda não foi ativada neste sistema (falta rodar o sql/28 no Supabase). Deixe preço e comprador em branco para salvar só a despesca.');
      payload = { ...base, tipo: despTipo, quantidade: q, peso_bruto_kg: b, peso_liquido_kg: lq, ...(preco || comprador ? { _venda: { preco_kg: preco || null, comprador: comprador || null } } : {}) };
      if (!(await pesoConferido(lote_id, q, b, data, dados))) return;
      // confere com o que o app estimava (só com internet); nunca bloqueia, porque a contagem da despesca é a real
      const vivos = dados && lote ? vivosDoLote(lote, dados.res[lote.id]) : null;
      const excede = vivos != null && q > vivos;
      if (despTipo === 'total' || excede) {
        const conta = vivos == null ? '' : ` O app estimava ${plural(vivos, 'peixe', 'peixes')} no lote.`;
        const texto = despTipo === 'total' ? `Serão registrados ${plural(q, 'peixe', 'peixes')} e o lote será encerrado.${conta}` : `Você informou ${plural(q, 'peixe', 'peixes')}, mais do que o estimado.${conta}`;
        if (!(await confirmar({ titulo: despTipo === 'total' ? 'Encerrar o lote com esta despesca?' : 'Conferir a quantidade', texto, ok: despTipo === 'total' ? 'Registrar e encerrar' : 'Registrar assim', cancelar: 'Voltar' }))) return;
      }
    } else if (tipo === 'agua') {
      const m = {};
      for (const [s, k, lim, nome] of AG_CAMPOS) {
        const t = f.querySelector(s).value.trim();
        if (!t) { m[k] = null; continue; }
        const v = numDecimal(t), [a, b] = AGUA_LIMITES[lim];
        if (!Number.isFinite(v) || v < a || v > b) return mostrarErro(`${nome}: confira o valor (de ${a} a ${b}).`);
        m[k] = v;
      }
      if (Object.values(m).every((v) => v == null)) return mostrarErro('Preencha pelo menos uma medição.');
      if (navigator.onLine && !(await Promise.race([ctx.api.aguaAtiva().catch(() => true), new Promise((r) => setTimeout(() => r(true), 2500))]))) return mostrarErro('A qualidade da água ainda não foi ativada neste sistema (falta rodar o sql/27 no Supabase).');
      const { lote_id: _semLote, ...semLote } = base;
      const agora = new Date();
      payload = { ...semLote, tanque_id: selTanque.value, ...m, hora: data === hoje ? `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}` : null, obs: f.querySelector('#ag-obs').value.trim() || null };
    } else if (tipo === 'manejo') {
      const produto = f.querySelector('#man-produto').value.trim(), doseTxt = f.querySelector('#man-dose').value.trim(), dose = numDecimal(doseTxt);
      const obs = f.querySelector('#man-obs').value.trim();
      if (!produto) return mostrarErro('Informe o nome do produto.');
      if (doseTxt.includes('.') && doseTxt.includes(',')) return mostrarErro('Digite a dose sem ponto de milhar. Ex.: 1250,5');
      if (!(dose > 0) || dose > 1000000) return mostrarErro('Informe a dose aplicada (até 1.000.000).');
      const lote = lotes.find((l) => l.id === lote_id);
      if (lote && data < lote.data_entrada) return mostrarErro(`A data não pode ser antes da entrada do lote (${fmtData(lote.data_entrada)}).`);
      if (navigator.onLine && !(await Promise.race([ctx.api.manejoAtivo().catch(() => true), new Promise((r) => setTimeout(() => r(true), 2500))]))) return mostrarErro('O manejo ainda não foi ativado neste sistema (falta rodar o sql/21 no Supabase).');
      payload = { ...base, tipo: 'probiotico', produto, dose, unidade: f.querySelector('#man-unidade').value, via: manVia, obs: obs || null };
    } else {
      const q = num(f.querySelector('#qtd').value);
      if (!(q >= 1) || !Number.isInteger(q)) return mostrarErro('Informe a quantidade de peixes mortos (número inteiro).');
      // um zero a mais vira "1 milhão de mortos" na Início: barra mais mortos do que peixes e confere perda grande
      const lote = lotes.find((l) => l.id === lote_id), dados = await dadosRapidos();
      const vivos = dados && lote ? vivosDoLote(lote, dados.res[lote.id]) : null;
      if (vivos != null && q > vivos) return mostrarErro(`O tanque tem cerca de ${plural(vivos, 'peixe vivo', 'peixes vivos')}. Confira o número (um zero a mais?). Se a contagem do lote estiver errada, peça para corrigir em Tanques.`);
      if (vivos != null && vivos > 0 && q > vivos * 0.05 && q > 50) {
        const pct = fmtNum((q / vivos) * 100, 1);
        if (!(await confirmar({ titulo: 'Confira a mortalidade', texto: `${plural(q, 'peixe morto', 'peixes mortos')} é ${pct}% do tanque (${plural(vivos, 'peixe', 'peixes')}) num dia só. Está certo?`, ok: 'Está certo', cancelar: 'Corrigir' }))) return;
      }
      payload = { ...base, quantidade: q };
      const causa = causaEscolhida();
      if (causa) payload.causa = causa;
    }

    // funcionário: confere o resumo antes de gravar (o número errado é pego aqui, não depois)
    if (!ctx.podeGerir()) {
      const agora = new Date();
      const certo = await confirmar({
        titulo: 'Confira antes de salvar',
        linhas: [['Tanque', (tanques.find((t) => t.id === selTanque.value) || {}).nome || ''], ['O quê', ROTULO_LANC[tipo]], ['Quanto', resumoDe(payload)],
          ['Quando', data === hoje ? `Hoje, ${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}` : fmtData(data)]],
        ok: 'Está certo, salvar', cancelar: 'Voltar e mudar',
      });
      if (!certo) return;
    }
    // possível lançamento duplicado (dois toques, ou duas pessoas lançando o mesmo)
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    const parecido = await acharParecido(tipo, payload);
    if (parecido) {
      const ok = await confirmar({ titulo: 'Isso já foi lançado?', texto: `${parecido} Lançar de novo mesmo assim?`, ok: 'Lançar mesmo assim', cancelar: 'Não lançar' });
      if (!ok) { btn.disabled = false; return; }
    }
    const criadoEm = new Date().toISOString();
    try {
      await db.filaAdd({
        uuid_local: id, tabela: TIPOS[tipo].tabela, payload,
        registrado_por: state.perfil.id, criado_em: criadoEm, status: 'pendente', erro: null, tentativas: 0,
      });
      await db.kvSet('ultimoTanque', selTanque.value);
    } catch (e) {
      btn.disabled = false;
      return mostrarErro('Não foi possível salvar no aparelho: ' + (e && e.message ? e.message : 'armazenamento indisponível'));
    }
    if (tipo === 'manejo') { // últimos produtos usados, para não digitar de novo
      try { const l = (await db.kvGet('produtosManejo')) || []; await db.kvSet('produtosManejo', [payload.produto, ...l.filter((p) => p !== payload.produto)].slice(0, 8)); } catch { /* opcional */ }
    }
    if (tipo === 'despesca' && payload.tipo === 'total') { // o lote já some daqui, mesmo antes de enviar
      state.ref.lotes = state.ref.lotes.filter((l) => l.id !== lote_id);
      try { await db.kvSet('ref', state.ref); } catch { /* opcional */ }
    }
    let ultimaAntes; // para o "Desfazer" devolver o "Repetir" de antes (senão ele sugeriria o número errado)
    if (tipo === 'racao') {
      try { const m = (await db.kvGet('ultimaRacao')) || {}; ultimaAntes = m[selTanque.value]; m[selTanque.value] = payload.quantidade_kg; await db.kvSet('ultimaRacao', m); } catch { /* opcional */ }
    }
    rascunhoSalvo = true; clearTimeout(timerRascunho); await rascunho.apagar(state.perfil.id, tipo);
    await ctx.atualizarPendentes();
    ctx.sincronizarAgora(); // em segundo plano; não trava a tela
    const nomeTanque = (tanques.find((t) => t.id === selTanque.value) || {}).nome || '';
    const resumo = resumoDe(payload);
    ctx.toast(navigator.onLine ? 'Salvo. Enviando…' : 'Salvo no celular. Será enviado quando houver internet.', 'ok');
    // sugestão de ronda: o próximo tanque (em ordem) que ainda não recebeu ração hoje
    let proximo = null;
    if (tipo === 'racao') {
      const feitos = new Set([...(feitosHoje || []), selTanque.value]);
      const ordem = [...tanques].sort(ordemNatural).filter((t) => lotes.some((l) => l.tanque_id === t.id));
      const i = ordem.findIndex((t) => t.id === selTanque.value);
      proximo = [...ordem.slice(i + 1), ...ordem.slice(0, Math.max(i, 0))].find((t) => !feitos.has(t.id)) || null;
    }
    el.classList.add('modo-sucesso'); // some título, abas e descrição: a tela fica só com a confirmação
    f.outerHTML = `
      <div class="sucesso card" role="status">
        <div class="sucesso-ic">${icone('check', 34)}</div>
        <h2>${tipo === 'manejo' ? 'Probiótico salvo' : tipo === 'agua' ? 'Medição salva' : `${TIPOS[tipo].rotulo} salva`}</h2>
        <p class="sucesso-res"><b>${esc(nomeTanque)}</b> · ${esc(resumo)}</p>
        ${tipo === 'agua' && temTambaqui() && avaliarAgua(payload).length ? `<p class="aviso">${avaliarAgua(payload).map((x) => esc(x.texto[0].toUpperCase() + x.texto.slice(1))).join('<br>')}</p>` : ''}
        ${navigator.onLine ? '' : '<p class="mudo nota">Sem internet: guardado no celular. Será enviado sozinho quando a internet voltar.</p>'}
        <div class="sucesso-acoes">
          ${proximo ? `<button type="button" class="btn primario grande" id="b-proximo">Próximo: ${esc(proximo.nome)}</button>` : `<button type="button" class="btn primario grande" id="b-outro">Lançar em outro tanque</button>`}
          ${minutosParaDesfazer(TIPOS[tipo].tabela, criadoEm) ? `<button type="button" class="btn desfazer" id="b-desfazer">${icone('desfazer', 20)} <span>Desfazer (${minutosParaDesfazer(TIPOS[tipo].tabela, criadoEm)} min)</span></button>` : ''}
          <div class="sucesso-links">${proximo ? '<button type="button" class="link" id="b-outro">Outro tanque</button><span aria-hidden="true">·</span>' : ''}${volta === 'ronda' ? `<a class="link" href="${ctx.podeGerir() ? '#/ronda' : '#/'}" id="b-volta">Voltar à ronda</a>` : volta === 't' ? `<a class="link" href="#/t/${esc(selTanque.value)}" id="b-volta">Voltar ao ${esc(nomeTanque)}</a>` : '<a class="link" href="#/">Voltar ao início</a>'}<span aria-hidden="true">·</span><a class="link" href="#/meus" id="b-meus">Meus lançamentos</a></div>
        </div>
      </div>`;
    el.querySelector('#b-outro').addEventListener('click', () => renderLancar(ctx, el, { tipo, escolher: '1', volta }));
    // Desfazer: vale por 5 minutos; o botão conta os minutos e some quando acaba
    const bd = el.querySelector('#b-desfazer');
    if (bd) {
      const tabela = TIPOS[tipo].tabela, tanqueSalvo = selTanque.value;
      let relogio = null;
      const conta = () => {
        const m = bd.isConnected ? minutosParaDesfazer(tabela, criadoEm) : 0;
        if (!m) { clearInterval(relogio); bd.remove(); return; }
        bd.querySelector('span').textContent = `Desfazer (${m} min)`;
      };
      relogio = setInterval(conta, 15000);
      bd.addEventListener('click', async () => {
        if (bd.disabled) return;
        bd.disabled = true;
        try {
          await desfazerLancamento(ctx, { uuidLocal: id, tabela, payload, criadoEm });
          clearInterval(relogio);
          if (tipo === 'racao') { try { const m = (await db.kvGet('ultimaRacao')) || {}; if (ultimaAntes > 0) m[tanqueSalvo] = ultimaAntes; else delete m[tanqueSalvo]; await db.kvSet('ultimaRacao', m); } catch { /* opcional */ } }
          ctx.toast('Desfeito. Pode lançar de novo.', 'ok');
          renderLancar(ctx, el, { tipo, tanque: tanqueSalvo, volta });
        } catch (e) {
          bd.disabled = false;
          ctx.toast((e && e.message) || 'Não foi possível desfazer.', 'erro');
        }
      });
    }
    const bp = el.querySelector('#b-proximo');
    if (bp) bp.addEventListener('click', () => renderLancar(ctx, el, { tipo, tanque: proximo.id, volta }));
  };
  // ---- rascunho: o que foi digitado fica no aparelho até salvar (sair da tela não perde) ----
  const guardarRascunho = () => { if (!rascunhoSalvo && f.isConnected) rascunho.guardar(state.perfil.id, tipo, rascunho.capturar(f)); };
  const agendarRascunho = () => { clearTimeout(timerRascunho); timerRascunho = setTimeout(guardarRascunho, 300); };
  f.addEventListener('input', agendarRascunho);
  f.addEventListener('change', agendarRascunho);
  f.addEventListener('click', (ev) => { if (ev.target.closest('#man-via, #desp-tipo, #causas')) agendarRascunho(); });
  // celular apagando a tela ou trocando de app: guarda na hora
  const aoEsconder = () => { if (!f.isConnected) { document.removeEventListener('visibilitychange', aoEsconder); return; } if (document.visibilityState === 'hidden') { clearTimeout(timerRascunho); guardarRascunho(); } };
  document.addEventListener('visibilitychange', aoEsconder);
  const salvoAntes = await rascunho.ler(state.perfil.id, tipo);
  if (salvoAntes && (!params.tanque || params.tanque === salvoAntes.tanque) && f.isConnected) {
    if (salvoAntes.tanque !== selTanque.value && tanques.some((t) => t.id === salvoAntes.tanque)) {
      const tile = f.querySelector(`#tiles .tile[data-tanque="${CSS.escape(salvoAntes.tanque)}"]`);
      if (tile) tile.click();
    }
    rascunho.aplicarCampos(f, salvoAntes);
    const quando = rascunho.diaDe(salvoAntes.em) === rascunho.diaDe(Date.now()) ? `das ${rascunho.horaDe(salvoAntes.em)}` : `de ${rascunho.diaDe(salvoAntes.em)} às ${rascunho.horaDe(salvoAntes.em)}`;
    f.insertAdjacentHTML('afterbegin', `<div class="aviso rascunho-aviso" id="rascunho-aviso" role="status"><span>Rascunho ${quando} recuperado. Confira antes de salvar.</span> <button type="button" class="link" id="b-limpar-rascunho">Limpar</button></div>`);
    f.querySelector('#b-limpar-rascunho').addEventListener('click', async () => {
      rascunhoSalvo = true; clearTimeout(timerRascunho);
      await rascunho.apagar(state.perfil.id, tipo);
      renderLancar(ctx, el, { tipo, tanque: selTanque.value, volta });
    });
  }

  // toque duplo: enquanto um salvamento está em andamento, o segundo é ignorado
  let salvando = false;
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (salvando) return;
    salvando = true;
    try { await aoSalvar(); } finally { salvando = false; }
  });
}

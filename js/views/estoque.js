// Estoque de ração: saldo (todos veem, só em kg) e compras (dono/gerente veem e lançam custo).
import { confirmar, formulario } from '../dialogo.js';
import { esc, fmtData, fmtNum, fmtInt, fmtBRL, hojeISO, num, numMoeda, moedaCampo, progresso } from '../util.js';
import { pizza, COR_RACAO } from '../graficos.js';
import { PESO_SACO_PADRAO_KG } from '../config.js';

import { situacaoEstoque, sugestaoCompraKg } from '../calc.js';
import { diasEntre } from '../util.js';
import { ESTOQUE_ATENCAO_DIAS, ESTOQUE_CRITICO_DIAS, ESTOQUE_COBERTURA_DIAS, CONTAGEM_LEMBRETE_DIAS } from '../config.js';

const MENSAGEM = {
  critico: 'Estoque acabando. Compre já e conte o que sobrou.',
  atencao: 'Planeje a próxima compra. Com pouco estoque, contar é rápido: aproveite para contar.',
  negativo: 'Foi lançada mais ração do que a registrada no estoque. Registre a compra que faltou (abaixo) ou faça uma contagem.',
  'sem-dado': 'Ainda sem ração lançada para estimar quanto dura.',
  ok: 'Estoque tranquilo.',
};

// Duas rações em estoques separados (sql/17): engorda e alevino. A aba escolhida vale para a tela toda.
const NOME_RACAO = { engorda: 'ração de engorda', alevino: 'ração de alevino' };
let tipoAtual = 'engorda';

// troca: {de} quando trocou de aba (Engorda ↔ Alevino): a tela antiga fica até a nova chegar, o título e as abas
// ficam parados (o risquinho desliza) e só os balões de baixo entram em cascata
export async function renderEstoque(ctx, el, troca = null) {
  if (!troca) el.innerHTML = '<h1>Estoque de ração</h1><p class="carregando">Carregando…</p>';
  const gerir = ctx.podeGerir();
  const din = ctx.verDinheiro(); // valor pago: só o dono vê e informa
  const kgS = ctx.state.ref.kgSaco || PESO_SACO_PADRAO_KG;
  const sc = (kg, d = 1) => { const v = Number(kg) / kgS; return fmtNum(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : d); };
  const [saldos, todasCompras, todasContagens] = await Promise.all([
    ctx.api.saldosRacao(), ctx.api.compras(gerir),
    gerir ? ctx.api.contagens().catch(() => []) : Promise.resolve([]),
  ]);
  const porTipo = saldos.porTipo;
  // consumo por ração só quando o banco já separa as duas (sql/17); antes disso, o total
  const consumo = await ctx.api.consumoDiario(30, porTipo ? tipoAtual : null).catch(() => []);
  if (!porTipo) tipoAtual = 'engorda';
  const doTipo = (x) => !porTipo || (x.tipo_racao || 'engorda') === tipoAtual;
  const saldo = saldos.linhas.find((x) => x.tipo_racao === tipoAtual) || saldos.linhas[0];
  const compras = todasCompras.filter(doTipo), contagens = todasContagens.filter(doTipo);
  const nomeR = porTipo ? NOME_RACAO[tipoAtual] : 'ração';
  const comprado = Number(saldo?.total_comprado_kg || 0);
  const consumido = Number(saldo?.total_consumido_kg || 0);
  const ajustes = Number(saldo?.total_ajustes_kg || 0);
  const kg = Number(saldo?.saldo_kg || 0);
  const hoje = hojeISO();
  // fazenda nova (sem 7 dias completos de histórico): estima pelo que foi dado hoje
  const hojeKg = consumo.filter((c) => c.data === hoje).reduce((t, c) => t + Number(c.quantidade_kg || 0), 0);
  const peloDeHoje = !(Number(saldo?.consumo_7d_kg) > 0) && hojeKg > 0;
  const sit = situacaoEstoque(kg, peloDeHoje ? hojeKg * 7 : saldo?.consumo_7d_kg, ESTOQUE_ATENCAO_DIAS, ESTOQUE_CRITICO_DIAS);
  const ult = contagens[0];
  const sugKg = sugestaoCompraKg(kg, sit.porDia, ESTOQUE_COBERTURA_DIAS);
  const diasSemContar = ult ? diasEntre(ult.data, hoje) : null;
  const corte = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const extrato = [
    ...compras.filter((c) => c.data_compra >= corte).map((c) => ({ d: c.data_compra, o: 1, t: `Entrada${c.fornecedor ? ' · ' + c.fornecedor : ''}`, kg: Number(c.quantidade_kg) })),
    ...consumo.map((c) => ({ d: c.data, o: 0, t: 'Ração dada aos peixes', kg: -Number(c.quantidade_kg) })),
    ...contagens.filter((c) => c.data >= corte).map((c) => ({ d: c.data, o: 2, t: Number(c.diferenca_kg) < 0 ? 'Contagem: faltou ração' : Number(c.diferenca_kg) > 0 ? 'Contagem: sobrou a mais' : 'Contagem: bateu certinho', kg: Number(c.diferenca_kg), cid: c.id })),
  ].sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.o - a.o));
  const totEntradas = extrato.filter((x) => x.kg > 0).reduce((t, x) => t + x.kg, 0);
  const totSaidas = Math.abs(extrato.filter((x) => x.kg < 0).reduce((t, x) => t + x.kg, 0)); // abs: evita "-0" quando não houve saída
  const sinal = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${sc(Math.abs(v))}`;

  if (troca) { el.classList.add('cascata', 'troca-aba'); setTimeout(() => el.classList.remove('cascata', 'troca-aba'), 600); }
  el.innerHTML = `
    <h1>Estoque de ração</h1>
    ${porTipo ? `<div class="seg" style="--n:2" role="tablist">${Object.entries(NOME_RACAO).map(([k]) => `<button type="button" data-tipo-racao="${k}" class="${k === tipoAtual ? 'on' : ''}">${k === 'engorda' ? 'Engorda' : 'Alevino'} <small>${((v) => `${sc(Math.max(0, v), 0)} ${Math.max(0, v / kgS) === 1 ? 'saco' : 'sacos'}`)(Number((saldos.linhas.find((x) => x.tipo_racao === k) || {}).saldo_kg || 0))}</small></button>`).join('')}</div>` : ''}
    <div class="pc-duas"><div>
    <div class="estoque-hero n-${sit.nivel}">
      <span>${porTipo ? `Ração de ${tipoAtual} em estoque` : 'Em estoque agora'}</span>
      <b>${sc(Math.max(0, kg), 0)}<em>${sc(Math.max(0, kg), 0) === '1' ? 'saco' : 'sacos'}</em></b>
      <small>${kg < 0 ? `faltou registrar a compra de ${sc(Math.abs(kg), 0)} ${sc(Math.abs(kg), 0) === '1' ? 'saco' : 'sacos'} (${fmtNum(Math.abs(kg), 0)} kg)` : `${fmtNum(kg, 0)} kg`}${sit.dias != null ? ` · dura cerca de <strong>${fmtInt(Math.floor(sit.dias))} dias</strong>` : ''}</small>
      ${sit.porDia > 0 ? `<small>Gasta ~${sc(sit.porDia)} ${sc(sit.porDia) === '1' ? 'saco' : 'sacos'} por dia (${peloDeHoje ? 'pelo que foi dado hoje' : 'média dos últimos 7 dias'})</small>` : ''}
      ${sit.dias != null || sit.nivel === 'negativo' ? `<div class="hero-prog">${progresso(((sit.dias || 0) / ESTOQUE_COBERTURA_DIAS) * 100, { tom: { atencao: 'alerta', critico: 'erro', negativo: 'erro' }[sit.nivel] || '', rotulo: `Ração para ${fmtInt(Math.floor(sit.dias || 0))} de ${ESTOQUE_COBERTURA_DIAS} dias` })}<p class="h-trilho-leg"><span>${fmtInt(Math.floor(sit.dias || 0))} de ${ESTOQUE_COBERTURA_DIAS} dias de ração${peloDeHoje ? ' (no ritmo de hoje)' : ''}</span><span>meta: ${ESTOQUE_COBERTURA_DIAS} dias</span></p></div>` : ''}
      ${sit.nivel === 'ok' ? '' : `<p>${MENSAGEM[sit.nivel]}</p>`}
    </div>
    ${porTipo && saldos.linhas.length > 1 ? `<div class="card">${pizza(saldos.linhas.map((x) => { const v = Math.max(0, Number(x.saldo_kg || 0)) / kgS; return { nome: x.tipo_racao === 'alevino' ? 'Alevino' : 'Engorda', valor: v, cor: COR_RACAO[x.tipo_racao === 'alevino' ? 'alevino' : 'engorda'], txt: `${fmtNum(v, 0)} sacos` }; }), { centro: fmtNum(saldos.linhas.reduce((a, x) => a + Math.max(0, Number(x.saldo_kg || 0)), 0) / kgS, 0), sub: 'sacos', rotulo: 'Estoque por tipo de ração' })}</div>` : ''}
    ${!navigator.onLine ? '<p class="aviso">Sem internet: os valores podem estar desatualizados.</p>' : ''}
    ${gerir && sugKg > 0 ? `<p class="aviso" id="sugestao-compra">Sugestão de compra: <b>~${fmtInt(Math.ceil(sugKg / kgS))} sacos</b> para a ração durar ${ESTOQUE_COBERTURA_DIAS} dias no ritmo atual.</p>` : ''}
    ${gerir && diasSemContar != null && diasSemContar >= CONTAGEM_LEMBRETE_DIAS ? `<p class="aviso" id="lembrete-contagem">A última contagem foi há ${fmtInt(diasSemContar)} dias. Contar toda semana deixa o saldo confiável.</p>` : ''}
    ${gerir ? (ult
      ? `<p class="mudo">Última contagem: ${fmtData(ult.data)} · ${Number(ult.diferenca_kg) === 0 ? 'bateu certinho' : `${Number(ult.diferenca_kg) < 0 ? 'faltaram' : 'sobraram'} ${sc(Math.abs(ult.diferenca_kg))} sacos`}</p>`
      : '<p class="aviso">Ainda não houve contagem. Não precisa contar tudo: conte por pilhas (camadas × sacos) ou espere o estoque ficar baixo, quando contar é rápido. É a contagem que deixa o saldo confiável.</p>') : ''}

    ${gerir ? `
    <details class="form-dobra dobra-passos" id="d-contagem">
      <summary>Contar a ${nomeR} no galpão</summary>
      <form id="f-contagem" class="form passos" novalidate>
        <section class="passo tipo-estoque">
          <h2 class="passo-t"><i>1</i> Conte as pilhas <small class="mudo">(ajuda opcional)</small></h2>
          <div class="pilhas" id="pilhas">
            <small class="mudo">Em cada pilha: quantas camadas de sacos e quantos sacos por camada.</small>
            <div id="pilhas-linhas"></div>
            <button type="button" class="btn mini" id="b-pilha">+ Adicionar pilha</button>
            <label>Sacos soltos ou abertos <input id="avulsos" type="number" inputmode="decimal" step="0.5" min="0" placeholder="0"></label>
            <div class="calc" id="tot-pilhas">Total das pilhas: —</div>
            <button type="button" class="btn" id="b-usar-pilhas" hidden>Usar este total</button>
          </div>
        </section>
        <section class="passo tipo-estoque">
          <h2 class="passo-t"><i>2</i> Total no galpão</h2>
          <label>Quantos sacos tem no galpão agora? <input id="contados" class="grande" type="number" inputmode="decimal" step="0.5" min="0" placeholder="0" required></label>
          <p class="ajuda">Pode ser meio saco (0,5).</p>
          <div class="calc" id="prev-cont">O sistema calcula ${sc(kg)} sacos.</div>
          <label>Observação — opcional <input id="obs" maxlength="120" placeholder="Ex.: 3 sacos molhados"></label>
        </section>
        <p id="erro-cont" class="erro" hidden></p>
        <button class="btn primario grande" type="submit">Registrar contagem</button>
      </form>
    </details>
    <details class="form-dobra dobra-passos" id="d-compra">
      <summary>Registrar compra de ${nomeR}</summary>
      <form id="f-compra" class="form passos" novalidate>
        <section class="passo tipo-estoque">
          <h2 class="passo-t"><i>1</i> Quanto chegou</h2>
          <div class="duas">
            <label>Nº de sacos <input id="sacos" class="grande" type="number" inputmode="numeric" step="1" min="1" placeholder="0" required></label>
            <label>kg por saco <input id="kgsaco" type="number" inputmode="decimal" step="0.1" min="0.1" value="${kgS}" required></label>
          </div>
          <label class="linha-check"><input type="checkbox" id="conferir"> Chegou menos sacos do que a nota</label>
          <label id="recebidos-wrap" hidden>Quantos sacos chegaram de fato? <input id="recebidos" class="grande" type="number" inputmode="decimal" step="0.5" min="0" placeholder="0"></label>
          <div class="calc" id="total">Total: —</div>
          <div class="data-linha"><span>Data: <b id="data-txt">hoje</b></span><button type="button" class="link" id="b-data">Mudar</button></div>
          <label id="data-wrap" hidden>Data da compra <input id="data" type="date" value="${hoje}" max="${hoje}" required></label>
        </section>
        <section class="passo tipo-estoque">
          <h2 class="passo-t"><i>2</i> Nota da compra <small class="mudo">(opcional)</small></h2>
          ${ctx.verDinheiro() ? '<label>Valor total pago <span class="com-prefixo"><em>R$</em><input id="custo" type="text" inputmode="numeric" autocomplete="off" maxlength="16" placeholder="0,00"></span></label>' : ''}
          <label>Fornecedor <input id="forn" maxlength="80" placeholder="Ex.: Agropecuária Boa Vista"></label>
        </section>
        <p id="erro" class="erro" hidden></p>
        <button class="btn primario grande" type="submit">Registrar entrada</button>
      </form>
    </details>` : ''}

    <h2>Resumo geral</h2>
    <div class="kpis">
      <div class="kpi"><span>Comprado</span><b>${sc(comprado, 0)} ${Math.round(comprado / kgS) === 1 ? 'saco' : 'sacos'}</b></div>
      <div class="kpi"><span>Consumido</span><b>${sc(consumido, 0)} ${Math.round(consumido / kgS) === 1 ? 'saco' : 'sacos'}</b></div>
      ${ajustes && gerir ? `<div class="kpi" style="grid-column:1/-1"><span>Ajustes de contagem</span><b>${sinal(ajustes)} sacos</b></div>` : ''}
      ${comprado > 0 ? `<div class="kpi" style="grid-column:1/-1">${progresso((consumido / comprado) * 100, { rotulo: 'Parte do comprado que já foi consumida' })}<small>${fmtNum(Math.min(100, (consumido / comprado) * 100), 0)}% de tudo o que foi comprado já foi dado aos peixes</small></div>` : ''}
    </div>

    ${gerir ? `<h2>Entradas registradas</h2>
    <div class="card">
      ${compras.length ? `<ul class="lista compras">${compras.map((c) => `<li>
          <div class="esq"><b>${fmtData(c.data_compra)} · ${sc(c.quantidade_kg)} ${sc(c.quantidade_kg) === '1' ? 'saco' : 'sacos'}</b>
            <small>${esc(c.fornecedor || 'sem fornecedor')}${din ? ` · ${c.custo_total != null ? fmtBRL(c.custo_total) : 'sem valor'}` : ''}${c.sacos_nota != null && Number(c.sacos_recebidos) < Number(c.sacos_nota) ? ` · <b class="falta-nota">faltaram ${fmtNum(Number(c.sacos_nota) - Number(c.sacos_recebidos), 0)} da nota</b>` : ''}</small></div>
          <span class="acoes-reg"><button class="btn mini" data-edit="${esc(c.id)}" type="button">Editar</button><button class="btn mini perigo" data-del="${esc(c.id)}" type="button">Excluir</button></span>
        </li>`).join('')}</ul>` : '<p class="mudo" style="margin:0">Nenhuma entrada registrada.</p>'}
    </div>` : ''}
    </div><div>
    <h2>Movimento dos últimos 30 dias</h2>
    ${extrato.length ? `<div class="ex-resumo">
      <div class="ex-tot entra"><span>Entradas</span><b>${totEntradas > 0 ? '+' : ''}${sc(totEntradas)}<em> sacos</em></b>${progresso((totEntradas / Math.max(totEntradas, totSaidas, 1)) * 100, { tom: 'ok', fina: true, rotulo: 'Entradas comparadas às saídas' })}<small>${fmtNum(totEntradas, 0)} kg · compras e sobras de contagem</small></div>
      <div class="ex-tot sai"><span>Saídas</span><b>${totSaidas > 0 ? '−' : ''}${sc(totSaidas)}<em> sacos</em></b>${progresso((totSaidas / Math.max(totEntradas, totSaidas, 1)) * 100, { tom: 'erro', fina: true, rotulo: 'Saídas comparadas às entradas' })}<small>${fmtNum(totSaidas, 0)} kg · ração dada e faltas de contagem</small></div>
    </div>` : ''}
    <div class="card">
      ${extrato.length ? `<ul class="extrato">${extrato.map((x) => `<li class="${x.kg < 0 ? 'sai' : 'entra'}">
        <span class="ex-d">${fmtData(x.d).slice(0, 5)}</span><span class="ex-t">${esc(x.t)} <i class="ex-tag ${x.kg < 0 ? 'sai' : 'entra'}">${x.kg < 0 ? 'Saída' : 'Entrada'}</i></span>
        <b>${sinal(x.kg)}<em> sacos</em></b>
        ${x.cid && ctx.state.perfil.papel === 'dono' ? `<button class="btn mini perigo" data-delc="${esc(x.cid)}" type="button">Excluir</button>` : ''}</li>`).join('')}</ul>`
        : '<p class="mudo" style="margin:0">Nenhum movimento nos últimos 30 dias.</p>'}
    </div>

    </div></div>`;

  el.querySelectorAll('[data-tipo-racao]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tipoRacao === tipoAtual) return;
    const de = [...el.querySelectorAll('[data-tipo-racao]')].findIndex((x) => x.dataset.tipoRacao === tipoAtual);
    tipoAtual = b.dataset.tipoRacao; renderEstoque(ctx, el, { de });
  }));
  if (troca) { const sg = el.querySelector('.seg'); if (sg) sg.dataset.de = troca.de; } // o risquinho sai da aba antiga
  if (!gerir) return;

  // ---- contagem física ----
  const fc = el.querySelector('#f-contagem');
  const ec = fc.querySelector('#erro-cont');
  fc.querySelector('#contados').addEventListener('input', () => {
    const n = num(fc.querySelector('#contados').value);
    const prev = fc.querySelector('#prev-cont');
    if (!(n >= 0)) { prev.textContent = `O sistema calcula ${sc(kg)} sacos.`; return; }
    const dif = n * kgS - kg;
    prev.textContent = `O sistema calcula ${sc(kg)} sacos. ` + (Math.abs(dif) < 0.5 ? 'Bateu certinho.' : `Diferença: ${dif < 0 ? 'faltam' : 'sobram'} ${sc(Math.abs(dif))} sacos.`);
  });
  // ajuda de contagem por pilhas
  const linhas = fc.querySelector('#pilhas-linhas');
  const somaPilhas = () => {
    let t = 0, algum = false;
    linhas.querySelectorAll('.pilha').forEach((l) => {
      const c = num(l.querySelector('.p-cam').value), s = num(l.querySelector('.p-sac').value);
      const v = c > 0 && s > 0 ? c * s : 0; if (v) algum = true;
      l.querySelector('.p-tot').textContent = v ? `= ${fmtInt(v)}` : '';
      t += v;
    });
    const av = num(fc.querySelector('#avulsos').value); if (av > 0) { t += av; algum = true; }
    fc.querySelector('#tot-pilhas').textContent = algum ? `Total das pilhas: ${fmtNum(t, t % 1 ? 1 : 0)} sacos` : 'Total das pilhas: —';
    const b = fc.querySelector('#b-usar-pilhas'); b.hidden = !algum; b.dataset.total = String(t);
  };
  const addPilha = () => {
    const d = document.createElement('div'); d.className = 'pilha';
    d.innerHTML = '<label>Camadas<input class="p-cam" type="number" inputmode="numeric" min="1" step="1"></label><span>×</span><label>Sacos por camada<input class="p-sac" type="number" inputmode="numeric" min="1" step="1"></label><b class="p-tot"></b>';
    d.querySelectorAll('input').forEach((i) => i.addEventListener('input', somaPilhas));
    linhas.appendChild(d);
  };
  addPilha();
  fc.querySelector('#b-pilha').addEventListener('click', addPilha);
  fc.querySelector('#avulsos').addEventListener('input', somaPilhas);
  fc.querySelector('#b-usar-pilhas').addEventListener('click', (ev) => {
    const c = fc.querySelector('#contados'); c.value = String(Number(ev.currentTarget.dataset.total));
    c.dispatchEvent(new Event('input', { bubbles: true })); c.focus();
  });
  fc.addEventListener('submit', async (ev) => {
    ev.preventDefault(); ec.hidden = true;
    const n = num(fc.querySelector('#contados').value);
    if (!(n >= 0)) { ec.textContent = 'Informe quantos sacos você contou (pode ser 0 ou meio saco: 0,5).'; ec.hidden = false; return; }
    if (!navigator.onLine) { ec.textContent = 'Sem internet. A contagem precisa ser registrada com conexão.'; ec.hidden = false; return; }
    const dif = n * kgS - kg;
    const ok = await confirmar({
      titulo: 'Registrar contagem?',
      texto: `Você contou ${fmtNum(n, Number.isInteger(n) ? 0 : 1)} ${n === 1 ? 'saco' : 'sacos'}. O sistema calculava ${sc(kg)}. ` + (Math.abs(dif) < 0.5 ? 'Bateu certinho.' : `O saldo será corrigido em ${dif < 0 ? '−' : '+'}${sc(Math.abs(dif))} sacos.`),
      ok: 'Registrar',
    });
    if (!ok) return;
    const btn = fc.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await ctx.api.registrarContagem(Math.round(n * kgS * 100) / 100, fc.querySelector('#obs').value.trim(), porTipo ? tipoAtual : null);
      ctx.toast('Contagem registrada', 'ok');
      renderEstoque(ctx, el);
    } catch (e) { ec.textContent = e.message; ec.hidden = false; btn.disabled = false; }
  });
  el.querySelectorAll('[data-delc]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar({ titulo: 'Excluir esta contagem?', texto: 'O saldo volta ao que era antes dela.', ok: 'Excluir', perigo: true }))) return;
    try { await ctx.api.excluir('racao_contagens', b.dataset.delc); ctx.toast('Contagem excluída', 'ok'); renderEstoque(ctx, el); }
    catch (e) { ctx.toast(e.message, 'erro'); }
  }));

  // ---- compra ----
  const f = el.querySelector('#f-compra');
  const erro = f.querySelector('#erro');
  // conferência de recebimento: o estoque entra pelo que CHEGOU, não pelo que a nota diz
  const conferir = f.querySelector('#conferir');
  const recebidos = () => (conferir.checked ? num(f.querySelector('#recebidos').value) : num(f.querySelector('#sacos').value));
  const total = () => { const s = recebidos(), k = num(f.querySelector('#kgsaco').value); return s >= 0 && k > 0 && num(f.querySelector('#sacos').value) > 0 ? s * k : null; };
  const atualiza = () => {
    const t = total(), nota = num(f.querySelector('#sacos').value), rec = recebidos(), kgs = fmtNum(num(f.querySelector('#kgsaco').value), 1);
    f.querySelector('#total').textContent = t == null ? 'Total: —'
      : conferir.checked && rec < nota ? `Entra no estoque: ${fmtNum(t, 1)} kg (${fmtNum(rec, rec % 1 ? 1 : 0)} sacos × ${kgs} kg)
Faltaram ${fmtNum(nota - rec, (nota - rec) % 1 ? 1 : 0)} ${nota - rec === 1 ? 'saco' : 'sacos'} da nota.`
      : `Total: ${fmtNum(t, 1)} kg (${fmtInt(nota)} sacos × ${kgs} kg)`;
  };
  f.addEventListener('input', () => { erro.hidden = true; }); // corrigiu um campo: a mensagem antiga some
  conferir.addEventListener('change', () => { f.querySelector('#recebidos-wrap').hidden = !conferir.checked; if (conferir.checked) f.querySelector('#recebidos').focus(); atualiza(); });
  f.querySelector('#recebidos').addEventListener('input', atualiza);
  f.querySelector('#sacos').addEventListener('input', atualiza);
  const dataIn = f.querySelector('#data');
  f.querySelector('#b-data').addEventListener('click', () => {
    const w = f.querySelector('#data-wrap'); w.hidden = !w.hidden;
    f.querySelector('#b-data').textContent = w.hidden ? 'Mudar' : 'Fechar';
    if (!w.hidden) dataIn.focus();
  });
  dataIn.addEventListener('input', () => { f.querySelector('#data-txt').textContent = !dataIn.value || dataIn.value === hoje ? 'hoje' : fmtData(dataIn.value); });
  f.querySelector('#kgsaco').addEventListener('input', atualiza);
  atualiza();

  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const falha = (m) => { erro.textContent = m; erro.hidden = false; };
    const s = num(f.querySelector('#sacos').value);
    if (!(s >= 1) || !Number.isInteger(s)) return falha('Informe o número de sacos (inteiro).');
    if (conferir.checked) {
      const rec = recebidos();
      if (!(rec >= 0)) return falha('Informe quantos sacos chegaram de fato.');
      if (rec === 0) return falha('Se não chegou nenhum saco, não registre a entrada: ela entra quando a ração chegar.');
      if (rec > s) return falha('Chegaram mais sacos do que a nota? Coloque o número maior em "Nº de sacos".');
    }
    const t = total();
    if (!t) return falha('Informe o peso de cada saco em kg.');
    if (!f.querySelector('#data').value) return falha('Informe a data.');
    const campoCusto = f.querySelector('#custo');
    const custo = !campoCusto || campoCusto.value.trim() === '' ? null : numMoeda(campoCusto.value);
    if (custo !== null && !(custo >= 0 && custo < 100000000)) return falha('Confira o valor pago. Ex.: 3.940,00');
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await ctx.api.registrarCompra({
        fazenda_id: ctx.state.perfil.fazenda_id, data_compra: f.querySelector('#data').value, quantidade_kg: t,
        custo_total: custo, fornecedor: f.querySelector('#forn').value.trim() || null,
        sacos_nota: s, sacos_recebidos: recebidos(), ...(porTipo ? { tipo_racao: tipoAtual } : {}),
      });
      ctx.toast('Entrada registrada', 'ok');
      renderEstoque(ctx, el);
    } catch (e) { falha(e.message); btn.disabled = false; }
  });

  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const c = compras.find((x) => x.id === b.dataset.del);
      const qual = c ? `${fmtData(c.data_compra)}: ${sc(c.quantidade_kg)} sacos${c.fornecedor ? ` (${c.fornecedor})` : ''}. ` : '';
      if (!(await confirmar({ titulo: 'Excluir esta entrada de ração?', texto: `${qual}O saldo de estoque será recalculado.`, ok: 'Excluir', perigo: true }))) return;
      try { await ctx.api.excluir('racao_estoque', b.dataset.del); ctx.toast('Entrada excluída', 'ok'); renderEstoque(ctx, el); }
      catch (e) { ctx.toast(e.message, 'erro'); }
    }));

  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
      const c = compras.find((x) => x.id === b.dataset.edit); if (!c) return;
      const hoje = hojeISO();
      const v = await formulario({
        titulo: 'Corrigir entrada de ração', texto: 'O saldo de estoque será recalculado.',
        campos: [
          { nome: 'data', rotulo: 'Data da compra', tipo: 'date', valor: c.data_compra, max: hoje },
          { nome: 'sacos', rotulo: `Quantidade (sacos de ${fmtNum(kgS, 0)} kg)`, tipo: 'number', valor: Math.round((Number(c.quantidade_kg) / kgS) * 100) / 100, step: '0.5', min: '0.5', inputmode: 'decimal', ajuda: `Hoje: ${fmtNum(Number(c.quantidade_kg), 0)} kg.` },
          ...(!ctx.verDinheiro() ? [] : [{ nome: 'custo', rotulo: 'Valor pago (opcional)', tipo: 'text', valor: moedaCampo(c.custo_total), prefixo: 'R$', inputmode: 'decimal', maxlength: '16', placeholder: 'Ex.: 3.940,00' }]),
          { nome: 'forn', rotulo: 'Fornecedor (opcional)', tipo: 'text', valor: c.fornecedor || '', maxlength: '80' },
          ...(porTipo ? [{ nome: 'tipo', rotulo: 'Qual ração', tipo: 'select', valor: c.tipo_racao || 'engorda', opcoes: [['engorda', 'Ração de engorda'], ['alevino', 'Ração de alevino']] }] : []),
        ],
        validar: (x) => (!x.data ? 'Informe a data.' : x.data > hoje ? 'A data não pode ser no futuro.' : !(num(x.sacos) > 0) ? 'Informe a quantidade de sacos.' : x.custo != null && String(x.custo).trim() !== '' && !(numMoeda(x.custo) >= 0 && numMoeda(x.custo) < 100000000) ? 'Confira o valor pago. Ex.: 3.940,00' : null),
      });
      if (!v) return;
      try {
        await ctx.api.atualizar('racao_estoque', c.id, { data_compra: v.data, quantidade_kg: Math.round(num(v.sacos) * kgS * 100) / 100, ...(v.custo === undefined ? {} : { custo_total: String(v.custo).trim() === '' ? null : numMoeda(v.custo) }), fornecedor: v.forn.trim() || null, ...(porTipo ? { tipo_racao: v.tipo } : {}) });
        ctx.toast('Entrada corrigida', 'ok'); renderEstoque(ctx, el);
      } catch (e) { ctx.toast(e.message, 'erro'); }
    }));
}

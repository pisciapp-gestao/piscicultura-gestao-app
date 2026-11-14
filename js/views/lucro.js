// Lucro por ciclo e despesas gerais (só o dono: valores em R$; precisam de internet).
import { esc, fmtData, fmtInt, fmtNum, fmtBRL, hojeISO, numDecimal, numMoeda, moedaCampo, ROTULO_TIPO, nomeArquivo, dataArquivo } from '../util.js';
import { calcularLote, fimDoLote, precoRacaoDoLote, pesoProduzido, ratearDespesas, fecharCiclo } from '../calc.js';
import { CATEGORIAS_DESPESA } from '../config.js';
import { confirmar, formulario } from '../dialogo.js';
import { carregarGerador, carregarFontes, abrirVisualizador } from '../pdf_ui.js';
import { gerarPdfLucro } from '../pdf_lucro.js';

const semAcesso = (el, t) => { el.innerHTML = `<h1>${t}</h1><div class="card vazio"><p>Esta tela é só para o dono (valores em R$).</p></div>`; };
const semRede = (el, t) => { el.innerHTML = `<h1>${t}</h1><div class="card vazio"><p>Esta tela precisa de internet.</p></div>`; };
const faltaSql = (el, t) => { el.innerHTML = `<h1>${t}</h1><div class="card vazio"><p>Este recurso ainda não foi ativado neste sistema (falta rodar o sql/29 no Supabase).</p></div>`; };
const rotuloCat = (k) => (CATEGORIAS_DESPESA.find(([v]) => v === k) || [k, k])[1];

export async function renderLucro(ctx, el) {
  const T = 'Lucro por ciclo';
  if (!ctx.verDinheiro()) return semAcesso(el, T);
  if (!navigator.onLine) return semRede(el, T);
  el.innerHTML = `<h1>${T}</h1><p class="carregando">Calculando…</p>`;
  const [lotes, compras, despesas, custos] = await Promise.all([ctx.api.lotes(), ctx.api.compras(true).catch(() => []), ctx.api.despesasGerais(), ctx.api.custosLote()]);
  if (!despesas || !custos) return faltaSql(el, T);
  const hoje = hojeISO();
  const tanques = ctx.state.ref.tanques;
  const nomeDe = (tid) => (tanques.find((t) => t.id === tid) || {}).nome || 'Tanque';
  const custoDe = Object.fromEntries(custos.map((x) => [x.lote_id, Number(x.custo_alevino)]));
  const dados = await Promise.all(lotes.map(async (l) => {
    const d = await ctx.api.dadosLote(l.id, { venda: true });
    const temReg = d.bios.length || d.mort.length || d.rac.length || d.desp.length;
    const fim = l.ativo || !temReg ? hoje : fimDoLote(l, d.bios, d.mort, d.rac, hoje, d.desp);
    return { l, d, fim, c: calcularLote(l, d.bios, d.mort, d.rac, fim, precoRacaoDoLote(compras, l.tipo), d.desp) }; // preço da ração que o lote come
  }));
  const { porLote, semRateio } = ratearDespesas(despesas, dados.map((x) => ({ id: x.l.id, ini: x.l.data_entrada, fim: x.fim, peso: pesoProduzido(x.c) })));
  const ciclos = dados.map((x) => {
    const fechado = !x.l.ativo && x.d.desp.some((d) => d.tipo === 'total');
    return { ...x, fechado, f: fecharCiclo({ c: x.c, custoAlevino: x.l.id in custoDe ? custoDe[x.l.id] : null, despesas: porLote[x.l.id] || 0, fechado }) };
  });
  const fechados = ciclos.filter((x) => x.fechado).sort((a, b) => (b.f.margem ?? -1e9) - (a.f.margem ?? -1e9));
  const andamento = ciclos.filter((x) => !x.fechado && x.l.ativo);
  const completos = fechados.filter((x) => x.f.completo);
  const anterior = (x) => completos.filter((o) => o.l.tanque_id === x.l.tanque_id && o.fim < x.l.data_entrada).sort((a, b) => b.fim.localeCompare(a.fim))[0] || null;
  const linha = (r, v, s = '') => `<li><div class="esq"><b>${r}</b>${s ? `<small>${s}</small>` : ''}</div><span class="valor">${v}</span></li>`;
  const din = (v) => (v == null ? '—' : fmtBRL(v));
  const cartao = (x, i) => {
    const f = x.f, ant = x.fechado && f.completo ? anterior(x) : null;
    return `<section class="card lucro-ciclo">
      <header><div><b>${x.fechado ? `${i + 1}º · ` : ''}${esc(nomeDe(x.l.tanque_id))} · ${esc(x.l.especie)}</b><small>${esc(ROTULO_TIPO[x.l.tipo] || x.l.tipo)} · ${fmtData(x.l.data_entrada)} a ${x.fechado ? fmtData(x.fim) : 'hoje'}</small></div>
        ${x.fechado ? `<span class="valor-lucro ${f.lucro != null && f.lucro < 0 ? 'neg' : ''}">${din(f.lucro)}<small>${f.margem != null ? `${fmtNum(f.margem * 100, 1)}% de margem` : 'lucro'}</small></span>` : '<span class="tag">Em andamento</span>'}</header>
      <ul class="lista numeros">
        ${linha(x.fechado ? 'Receita' : 'Receita até agora', din(f.receita))}
        ${linha('Ração', din(f.custoRacao), `pelo preço médio pago por kg da ração de ${['alevinagem', 'bercario'].includes(x.l.tipo) ? 'alevino' : 'engorda'}`)}
        ${linha('Alevinos', din(f.custoAlevino))}
        ${linha('Despesas gerais', din(f.despesas), 'divididas por peso produzido')}
        ${linha(x.fechado ? 'Custo total' : 'Custo até agora', din(f.custoTotal))}
        ${x.fechado && f.custoKg != null ? linha('Custo por kg vendido', fmtBRL(f.custoKg), ant && ant.f.custoKg != null ? `ciclo anterior: ${fmtBRL(ant.f.custoKg)}` : '') : ''}
      </ul>
      ${f.faltando.length && x.fechado ? `<p class="aviso">Conta incompleta. Falta: ${esc(f.faltando.join(', '))}.</p>` : ''}
      <div class="acoes-lucro no-print">
        <button class="btn mini" type="button" data-alevino="${esc(x.l.id)}">${x.l.id in custoDe ? 'Corrigir' : 'Informar'} custo do alevino</button>
        <a class="btn mini" href="#/relatorio/${esc(x.l.id)}">Relatório do lote</a>
        ${x.fechado ? `<button class="btn mini" type="button" data-pdf="${esc(x.l.id)}">PDF do fechamento</button>` : ''}
      </div></section>`;
  };
  const totalLucro = completos.reduce((s, x) => s + x.f.lucro, 0);
  el.innerHTML = `<h1>${T}</h1>
    <p class="mudo" style="margin-top:-.4rem">Receita das despescas menos ração, alevinos e despesas gerais.</p>
    ${completos.length ? `<div class="card destaques3"><div class="destaque"><span>Lucro dos ciclos com conta completa</span><b class="${totalLucro < 0 ? 'neg' : ''}">${fmtBRL(totalLucro)}</b><small>${fmtInt(completos.length)} ${completos.length === 1 ? 'ciclo' : 'ciclos'}</small></div></div>` : ''}
    <div class="acoes no-print"><a class="btn primario" href="#/despesas">Despesas gerais</a></div>
    ${semRateio > 0 ? `<p class="aviso">${fmtBRL(semRateio)} em despesas gerais ficaram fora da conta, porque na data não havia lote com peso produzido.</p>` : ''}
    <h2>Ciclos encerrados</h2>
    ${fechados.length ? fechados.map(cartao).join('') : '<div class="card vazio"><p>Ainda não há ciclo encerrado por despesca total.</p></div>'}
    <h2>Em andamento</h2>
    ${andamento.length ? andamento.map(cartao).join('') : '<div class="card vazio"><p>Nenhum lote ativo.</p></div>'}`;
  const porId = Object.fromEntries(ciclos.map((x) => [x.l.id, x]));
  el.querySelectorAll('[data-alevino]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.alevino;
    const v = await formulario({ titulo: 'Custo dos alevinos', texto: 'Quanto foi pago pelos peixes deste lote, em reais. Deixe em branco para apagar.',
      campos: [{ nome: 'valor', rotulo: 'Valor total', tipo: 'text', valor: id in custoDe ? moedaCampo(custoDe[id]) : '', prefixo: 'R$', inputmode: 'decimal', maxlength: '16', placeholder: 'Ex.: 1.500,00' }],
      validar: (x) => { const t = String(x.valor ?? '').trim(); if (!t) return null; const n = numMoeda(t); return n >= 0 && n <= 100000000 ? null : 'Confira o valor. Ex.: 12.500,50'; } });
    if (!v) return;
    try {
      const t = String(v.valor ?? '').trim();
      await (t ? ctx.api.salvarCustoLote(id, numMoeda(t)) : ctx.api.apagarCustoLote(id));
      ctx.toast('Custo salvo', 'ok'); renderLucro(ctx, el);
    } catch (e) { ctx.toast(e.message, 'erro'); }
  }));
  el.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', async () => {
    const x = porId[b.dataset.pdf]; if (!x) return;
    const texto = b.textContent; b.disabled = true; b.textContent = 'Gerando…';
    try {
      const [jsPDF, fontes] = await Promise.all([carregarGerador(), carregarFontes()]);
      const fazenda = (ctx.state.perfil.fazendas && ctx.state.perfil.fazendas.nome) || 'Piscicultura';
      const nomeTanque = nomeDe(x.l.tanque_id);
      const doc = gerarPdfLucro(jsPDF, { fazenda, logo: ctx.state.ref.logo || null, fontes, geradoEm: hoje, nomeTanque, lote: x.l, fim: x.fim, f: x.f, c: x.c });
      await abrirVisualizador({ blob: doc.output('blob'), nome: nomeArquivo(['Fechamento do ciclo', nomeTanque, dataArquivo(x.fim)], 'pdf'), titulo: `Fechamento · ${nomeTanque}`, toast: ctx.toast });
    } catch (e) { ctx.toast(e.message || 'Não foi possível gerar o PDF', 'erro'); }
    b.disabled = false; b.textContent = texto;
  }));
}

export async function renderDespesas(ctx, el) {
  const T = 'Despesas gerais';
  if (!ctx.verDinheiro()) return semAcesso(el, T);
  if (!navigator.onLine) return semRede(el, T);
  el.innerHTML = `<h1>${T}</h1><p class="carregando">Carregando…</p>`;
  const lista = await ctx.api.despesasGerais();
  if (!lista) return faltaSql(el, T);
  const hoje = hojeISO(), mes = hoje.slice(0, 7);
  const totalMes = lista.filter((d) => d.data.slice(0, 7) === mes).reduce((s, d) => s + Number(d.valor), 0);
  el.innerHTML = `<h1>${T}</h1>
    <p class="mudo" style="margin-top:-.4rem">Custos da fazenda que não são de um lote só. Entram no lucro divididos por peso produzido.</p>
    <details class="card form-dobra" id="d-desp"${lista.length ? '' : ' open'}>
      <summary>Nova despesa</summary>
    <form class="form" id="f-desp" novalidate>
      <label>Data <input id="d-data" type="date" value="${hoje}" max="${hoje}" required></label>
      <label>Tipo <select id="d-cat">${CATEGORIAS_DESPESA.map(([v, r]) => `<option value="${v}">${esc(r)}</option>`).join('')}</select></label>
      <label>Valor <span class="com-prefixo"><em>R$</em><input id="d-valor" type="text" inputmode="numeric" autocomplete="off" maxlength="16" placeholder="0,00" required></span></label>
      <label>Descrição <small class="mudo">(opcional)</small> <input id="d-desc" type="text" maxlength="120" autocomplete="off"></label>
      <p id="d-erro" class="erro" hidden></p>
      <button class="btn primario" type="submit">Salvar despesa</button>
    </form>
    </details>
    <h2>Lançadas</h2>
    <p class="mudo">Neste mês: <b>${fmtBRL(totalMes)}</b></p>
    <div class="card">${lista.length ? `<ul class="lista">${lista.map((d) => `<li><div class="esq"><b>${esc(rotuloCat(d.categoria))} · ${fmtBRL(d.valor)}</b><small>${fmtData(d.data)}${d.descricao ? ` · ${esc(d.descricao)}` : ''}</small></div><button class="btn mini perigo" type="button" data-del="${esc(d.id)}">Excluir</button></li>`).join('')}</ul>` : '<p class="mudo" style="margin:0">Nenhuma despesa lançada.</p>'}</div>`;
  const f = el.querySelector('#f-desp'), erro = el.querySelector('#d-erro');
  let salvando = false;
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (salvando) return;
    const falha = (m) => { erro.textContent = m; erro.hidden = false; };
    erro.hidden = true;
    const data = f.querySelector('#d-data').value, txt = f.querySelector('#d-valor').value.trim(), valor = numMoeda(txt);
    if (!data) return falha('Informe a data.');
    if (data > hoje) return falha('A data não pode ser no futuro.');
    if (!(valor > 0) || valor > 100000000) return falha('Confira o valor. Ex.: 1.250,50');
    salvando = true;
    try {
      await ctx.api.criarDespesa({ data, categoria: f.querySelector('#d-cat').value, valor, descricao: f.querySelector('#d-desc').value.trim() || null, registrado_por: ctx.state.perfil.id, fazenda_id: ctx.state.perfil.fazenda_id });
      ctx.toast('Despesa salva', 'ok'); renderDespesas(ctx, el);
    } catch (e) { falha(e.message); } finally { salvando = false; }
  });
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar({ titulo: 'Excluir esta despesa?', texto: 'O lucro dos ciclos será recalculado.', ok: 'Excluir', perigo: true }))) return;
    try { await ctx.api.excluir('despesas_gerais', b.dataset.del); ctx.toast('Despesa excluída', 'ok'); renderDespesas(ctx, el); }
    catch (e) { ctx.toast(e.message, 'erro'); }
  }));
}

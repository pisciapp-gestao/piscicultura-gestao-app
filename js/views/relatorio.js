// Relatórios por lote (precisam de internet: usam os dados já sincronizados no servidor).
import { PESO_SACO_PADRAO_KG, ESTOQUE_ATENCAO_DIAS, ESTOQUE_CRITICO_DIAS, CAUSAS_MORTE } from '../config.js';
import { carregarGerador, carregarFontes, abrirVisualizador } from '../pdf_ui.js';
import { gerarPdfLote } from '../pdf_lote.js';
import { gerarPdfFazenda } from '../pdf_fazenda.js';
import { gerarPdfRacao } from '../pdf_racao.js';
import { gerarPdfDespesca } from '../pdf_despesca.js';
import { confirmar, formulario } from '../dialogo.js';
import { icone } from '../icons.js';
import { esc, fmtData, fmtNum, fmtInt, fmtBRL, hojeISO, num, ROTULO_TIPO, faseCss, nomeArquivo, dataArquivo, progresso, fmtPct, numDecimal, numMoeda, moedaCampo, pesoMedioTxt, celulaCsv } from '../util.js';
import { pizza, COR_FASE, ORDEM_FASE } from '../graficos.js';
import { calcularNaIdade, fimDoLote, mediaDe, vivosDoLote, indicadoresDespesca, avisoPesoMedio, avaliarAgua, ehTambaqui } from '../calc.js';
import { calcularLote, precoMedioKg, precoRacaoDoLote, pontosPeso, pesoMedioKg, evolucaoPeso, racaoPorSemana, matrizRacao, situacaoEstoque } from '../calc.js';

export function svgPeso(pts, { un = 'g', dec = 0, vazio = 'O gráfico aparece a partir da primeira biometria.', rotulo = 'Evolução do peso médio' } = {}) {
  if (pts.length < 2) return `<p class="mudo">${vazio}</p>`;
  const W = 320, H = 150, pl = 36, pr = 10, pt = 10, pb = 22;
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  const t0 = t(pts[0].data), t1 = t(pts[pts.length - 1].data);
  const span = t1 > t0 ? t1 - t0 : 1;
  const ys = pts.map((p) => p.g);
  let ymin = Math.min(...ys) * 0.9, ymax = Math.max(...ys) * 1.05;
  if (ymax <= ymin) ymax = ymin + 1;
  const X = (d) => pl + ((t(d) - t0) / span) * (W - pl - pr);
  const Y = (g) => pt + (1 - (g - ymin) / (ymax - ymin)) * (H - pt - pb);
  const linha = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.data).toFixed(1)},${Y(p.g).toFixed(1)}`).join(' ');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="${rotulo}">
    <line class="eixo" x1="${pl}" y1="${pt}" x2="${pl}" y2="${H - pb}"/><line class="eixo" x1="${pl}" y1="${H - pb}" x2="${W - pr}" y2="${H - pb}"/>
    <text x="${pl - 4}" y="${pt + 8}" text-anchor="end">${fmtNum(ymax, dec)} ${un}</text>
    <text x="${pl - 4}" y="${H - pb}" text-anchor="end">${fmtNum(ymin, dec)} ${un}</text>
    <text x="${pl}" y="${H - 6}">${fmtData(pts[0].data)}</text>
    <text x="${W - pr}" y="${H - 6}" text-anchor="end">${fmtData(pts[pts.length - 1].data)}</text>
    <path class="linha" d="${linha}"/>
    ${pts.map((p) => `<circle class="pt${p.inicial ? ' ini' : ''}" cx="${X(p.data).toFixed(1)}" cy="${Y(p.g).toFixed(1)}" r="4"/>`).join('')}
  </svg>`;
}

const csvNum = (n, d = 2) => (n == null ? '' : Number(n).toFixed(d).replace('.', ','));
export function montarCsv(lote, nomeTanque, calc, bios, mort, rac, quem, desp = [], man = [], agua = []) {
  const L = [];
  L.push(['Relatório do lote'], ['Tanque', nomeTanque], ['Fase', ROTULO_TIPO[lote.tipo] || lote.tipo], ['Espécie', lote.especie],
    ['Entrada', fmtData(lote.data_entrada)], ['Peixes iniciais', lote.quantidade_inicial], ['Peso total inicial (kg)', csvNum(lote.peso_inicial_kg)],
    [], ['RESUMO'], ['Dias de cultivo', calc.diasCultivo], ['Peixes vivos (estimado)', calc.vivos], ['Mortos', calc.mortos],
    ['Ração total (kg)', csvNum(calc.racaoTotal)], ['Peso médio atual (g)', csvNum(calc.pmAtualG, 1)],
    ['Conversão alimentar aparente', csvNum(calc.ca)], ...(calc.custoKgProduzido != null ? [['Custo de ração por kg produzido (R$)', csvNum(calc.custoKgProduzido)]] : []), ['Ganho de peso diário (g/dia)', csvNum(calc.gpd)], [],
    ['RAÇÃO'], ['Data', 'Quantidade (kg)', 'Registrado por']);
  rac.forEach((r) => L.push([fmtData(r.data), csvNum(r.quantidade_kg), quem(r.registrado_por)]));
  L.push([], ['BIOMETRIAS'], ['Data', 'Peso da amostra (kg)', 'Peixes na amostra', 'Peso médio (g)', 'Registrado por']);
  bios.forEach((b) => L.push([fmtData(b.data), csvNum(b.peso_amostra_kg, 3), b.quantidade_amostrada, csvNum(pesoMedioKg(b) * 1000, 1), quem(b.registrado_por)]));
  L.push([], ['MORTALIDADE'], ['Data', 'Quantidade', 'Registrado por', 'Causa provável']);
  mort.forEach((m) => L.push([fmtData(m.data), m.quantidade, quem(m.registrado_por), m.causa || '']));
  if (desp.length) {
    L.push([], ['DESPESCAS'], ['Data', 'Tipo', 'Peixes', 'Peso bruto (kg)', 'Peso líquido (kg)', 'Preço (R$/kg)', 'Receita (R$)', 'Comprador', 'Registrado por']);
    desp.forEach((d) => L.push([fmtData(d.data), d.tipo === 'total' ? 'Total' : 'Parcial', d.quantidade, csvNum(d.peso_bruto_kg, 3), csvNum(d.peso_liquido_kg, 3), csvNum(d.preco_kg, 2), csvNum(indicadoresDespesca(d).receita, 2), d.comprador || '', quem(d.registrado_por)]));
  }
  if (agua.length) {
    L.push([], ['QUALIDADE DA ÁGUA'], ['Data', 'Hora', 'Oxigênio (mg/L)', 'Temperatura (°C)', 'pH', 'Amônia tóxica (mg/L)', 'Observação', 'Registrado por']);
    agua.forEach((a) => L.push([fmtData(a.data), a.hora || '', csvNum(a.oxigenio_mgl, 2), csvNum(a.temperatura_c, 1), csvNum(a.ph, 2), csvNum(a.amonia_mgl, 3), a.obs || '', quem(a.registrado_por)]));
  }
  if (man.length) {
    L.push([], ['PROBIÓTICO'], ['Data', 'Produto', 'Dose', 'Unidade', 'Aplicação', 'Observação', 'Registrado por']);
    man.forEach((m) => L.push([fmtData(m.data), m.produto, String(Number(m.dose)).replace('.', ','), m.unidade, m.via === 'agua' ? 'Na água' : 'Na ração', m.obs || '', quem(m.registrado_por)]));
  }
  return '﻿' + L.map((l) => l.map(celulaCsv).join(';')).join('\r\n');
}

export async function renderRelatorios(ctx, el) {
  el.innerHTML = '<h1>Relatórios</h1><p class="carregando">Carregando…</p>';
  if (!navigator.onLine) {
    el.innerHTML = '<h1>Relatórios</h1><div class="card vazio"><p>Os relatórios precisam de internet, porque usam os dados já enviados ao servidor.</p></div>';
    return;
  }
  const [lotes, resumoRows] = await Promise.all([ctx.api.lotes(), ctx.api.resumoLotes().catch(() => [])]);
  const resumo = Object.fromEntries((resumoRows || []).map((x) => [x.lote_id, x]));
  const tanques = ctx.state.ref.tanques;
  const nat = (x, y) => String(x).localeCompare(String(y), 'pt-BR', { numeric: true, sensitivity: 'base' });
  const nomeDe = (tid) => (tanques.find((t) => t.id === tid) || {}).nome || '';
  const porTanque = (l1, l2) => nat(nomeDe(l1.tanque_id), nomeDe(l2.tanque_id)) || String(l2.data_entrada).localeCompare(String(l1.data_entrada));
  const linhaLote = (l) => `<li><a class="item" href="#/relatorio/${esc(l.id)}"><span class="esq"><b>${esc(nomeDe(l.tanque_id))}</b>
      <small>${esc(ROTULO_TIPO[l.tipo] || l.tipo)} · ${esc(l.especie)} · desde ${fmtData(l.data_entrada)} · ${fmtInt(l.quantidade_inicial)} peixes</small>${sobreLote(l)}</span><span class="seta">${icone('direita', 20)}</span></a></li>`;
  function sobreLote(l) {
    const x = resumo[l.id], ini = Number(l.quantidade_inicial) || 0;
    if (!x || !ini || !l.ativo) return '';
    const pct = (Math.max(0, ini - Number(x.mortos || 0)) / ini) * 100;
    return `${progresso(pct, { fina: true, tom: pct >= 90 ? 'ok' : pct >= 75 ? 'alerta' : 'erro', rotulo: `Sobrevivência ${fmtPct(pct)}%` })}<small class="prog-leg">Sobrevivência ${fmtPct(pct)}%</small>`;
  }
  const ativos = lotes.filter((l) => l.ativo).sort(porTanque);
  const encerrados = lotes.filter((l) => !l.ativo).sort(porTanque);
  el.innerHTML = `<h1>Relatórios</h1>
    <p class="mudo" style="margin-top:-.4rem">O que você quer saber?</p>
    <div class="hub">
      ${ctx.verDinheiro() ? `<a class="hub-card" href="#/lucro"><span class="item-ic">${icone('relatorio')}</span><span class="esq"><b>Lucro por ciclo</b><small>Receita, custos e lucro de cada lote, para comparar os tanques.</small></span><span class="seta">${icone('direita', 20)}</span></a>` : ''}
      <a class="hub-card" href="#/relatorio/racao"><span class="item-ic">${icone('lancar')}</span><span class="esq"><b>Ração fornecida</b><small>Quanta ração cada tanque recebeu, hoje ou na semana. Dá para enviar pelo WhatsApp.</small></span><span class="seta">${icone('direita', 20)}</span></a>
      <a class="hub-card" href="#/estoque"><span class="item-ic">${icone('estoque')}</span><span class="esq"><b>Estoque de ração</b><small>Quanto resta no galpão e para quantos dias dá.</small></span><span class="seta">${icone('direita', 20)}</span></a>
      <button class="hub-card" id="b-pdf-fazenda" type="button"><span class="item-ic">${icone('relatorio')}</span><span class="esq"><b>Relatório geral da fazenda</b><small>PDF com estoque, lotes e mortalidade, para compartilhar.</small></span><span class="seta">${icone('direita', 20)}</span></button>
    </div>
    <h2>Relatório de um lote</h2>
    <p class="mudo" style="margin-top:-.4rem">Peso, mortalidade e ração de cada lote de peixes.</p>
    ${ativos.length ? `<div class="card"><ul class="lista lista-grade">${ativos.map(linhaLote).join('')}</ul></div>` : '<div class="card vazio"><p>Ainda não há lotes ativos.</p></div>'}
    ${encerrados.length ? `<details class="avancado"><summary>Lotes encerrados (${encerrados.length})</summary><div class="card"><ul class="lista">${encerrados.map(linhaLote).join('')}</ul></div></details>` : ''}`;

  const bf = el.querySelector('#b-pdf-fazenda');
  bf.addEventListener('click', async () => {
    const texto = bf.innerHTML; bf.disabled = true; bf.innerHTML = '<span class="item-ic">…</span><span class="esq"><b>Gerando o PDF…</b></span>';
    try {
      const gerir = ctx.podeGerir();
      const hoje = hojeISO();
      const kgS = ctx.state.ref.kgSaco || PESO_SACO_PADRAO_KG;
      const d30 = new Date(`${hoje}T00:00:00Z`); d30.setUTCDate(d30.getUTCDate() - 29);
      const desde = d30.toISOString().slice(0, 10);
      const [[jsPDF, fontes], saldoTotal, linhas, saldosTipo, compras, contagens] = await Promise.all([
        Promise.all([carregarGerador(), carregarFontes()]),
        ctx.api.saldoRacao(), ctx.api.racaoPeriodo(desde),
        ctx.api.saldosRacao().catch(() => null),
        gerir ? ctx.api.compras(true).catch(() => []) : Promise.resolve([]),
        gerir ? ctx.api.contagens().catch(() => []) : Promise.resolve([]),
      ]);
      // estoque igual ao da Início: ração que ficou negativa não desconta da outra (77 → 78 sacos),
      // e a duração usa a ração de engorda; numa fazenda nova (sem 7 dias), o ritmo de hoje
      const tiposR = saldosTipo && saldosTipo.porTipo ? saldosTipo.linhas : null;
      const saldo = saldoTotal ? { ...saldoTotal, ...(tiposR ? { saldo_kg: tiposR.reduce((t, x) => t + Math.max(0, Number(x.saldo_kg) || 0), 0) } : {}) } : saldoTotal;
      const engorda = tiposR ? (tiposR.find((x) => x.tipo_racao === 'engorda') || tiposR[0]) : saldoTotal;
      const tipoDoTanque = (tid) => { const l = lotes.find((x) => x.ativo && x.tanque_id === tid); return l && ['alevinagem', 'bercario'].includes(l.tipo) ? 'alevino' : 'engorda'; };
      const hojeKgEng = (linhas || []).filter((r) => r.data === hoje && (!tiposR || tipoDoTanque(r.tanque_id) === 'engorda')).reduce((t, r) => t + Number(r.quantidade_kg || 0), 0);
      const ritmoHoje = !(Number(engorda && engorda.consumo_7d_kg) > 0) && hojeKgEng > 0;
      const precoKg = ctx.verDinheiro() ? precoMedioKg(compras) : null;
      const nomeDe = (tid) => (tanques.find((t) => t.id === tid) || {}).nome || '';
      const ativos = lotes.filter((l) => l.ativo);
      const detalhes = await Promise.all(ativos.map(async (l) => {
        const { bios, mort, rac, desp } = await ctx.api.dadosLote(l.id, { venda: ctx.verDinheiro() });
        return { nomeTanque: nomeDe(l.tanque_id), lote: l, c: calcularLote(l, bios, mort, rac, hoje, ctx.verDinheiro() ? precoRacaoDoLote(compras, l.tipo) : null, desp) };
      }));
      detalhes.sort((a, b) => String(a.nomeTanque).localeCompare(String(b.nomeTanque), 'pt-BR', { numeric: true, sensitivity: 'base' }));
      const porDia = new Map(); const porTanque = new Map();
      for (const r of linhas) { porDia.set(r.data, (porDia.get(r.data) || 0) + Number(r.quantidade_kg)); porTanque.set(r.tanque_id, (porTanque.get(r.tanque_id) || 0) + Number(r.quantidade_kg)); }
      const racaoDia = [];
      for (let i = 0; i < 30; i++) { const dd = new Date(d30); dd.setUTCDate(dd.getUTCDate() + i); const iso = dd.toISOString().slice(0, 10); racaoDia.push({ data: iso, kg: porDia.get(iso) || 0 }); }
      const racaoTanque = tanques.filter((t) => porTanque.has(t.id)).map((t) => ({ nome: t.nome, kg: porTanque.get(t.id) }))
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric: true, sensitivity: 'base' }));
      const doc = gerarPdfFazenda(jsPDF, {
        logo: ctx.state.ref.logo || null, fazenda: (ctx.state.perfil.fazendas && ctx.state.perfil.fazendas.nome) || 'Piscicultura', geradoEm: hoje, kgSaco: kgS, gerir, dinheiro: ctx.verDinheiro(), fontes, saldo: saldo || {},
        sit: situacaoEstoque(engorda && engorda.saldo_kg, ritmoHoje ? hojeKgEng * 7 : engorda && engorda.consumo_7d_kg, ESTOQUE_ATENCAO_DIAS, ESTOQUE_CRITICO_DIAS), ritmoHoje, soEngorda: !!tiposR,
        lotes: detalhes, racaoDia, racaoTanque, precoKg, ultimaContagem: contagens[0] || null,
      });
      bf.disabled = false; bf.innerHTML = texto;
      await abrirVisualizador({ blob: doc.output('blob'), nome: nomeArquivo(['Relatório geral', (ctx.state.perfil.fazendas && ctx.state.perfil.fazendas.nome) || 'Piscicultura', dataArquivo(hoje)], 'pdf'), titulo: 'Relatório geral da fazenda', toast: ctx.toast });
    } catch (e) { ctx.toast(e.message || 'Não foi possível gerar o PDF', 'erro'); bf.disabled = false; bf.innerHTML = texto; }
  });
}

export async function renderRelatorioLote(ctx, el, id) {
  el.innerHTML = '<p class="carregando">Montando relatório…</p>';
  if (!navigator.onLine) {
    el.innerHTML = `<div class="card vazio"><p>O relatório precisa de internet.</p></div>`;
    return;
  }
  const gerir = ctx.podeGerir();
  const lote = await ctx.api.lote(id);
  if (!lote) { el.innerHTML = '<div class="card vazio">Lote não encontrado.<br><a class="btn" href="#/relatorio">Voltar</a></div>'; return; }
  const [{ bios, mort, rac, desp, man }, nomes, compras, agua] = await Promise.all([
    ctx.api.dadosLote(id, { venda: ctx.verDinheiro() }),
    ctx.api.nomesUsuarios().catch(() => ({})),
    gerir ? ctx.api.compras(true).catch(() => []) : Promise.resolve([]),
    ctx.api.aguaTanque(lote.tanque_id, lote.data_entrada),
  ]);
  const kgS = ctx.state.ref.kgSaco || PESO_SACO_PADRAO_KG;
  const quem = (uid) => nomes[uid] || (uid === ctx.state.perfil.id ? 'Você' : 'Colega');
  const hoje = hojeISO();
  const temReg = bios.length || mort.length || rac.length || desp.length;
  const fim = lote.ativo || !temReg ? hoje : fimDoLote(lote, bios, mort, rac, hoje, desp);
  // preço da ração que este lote come (alevino é mais cara que engorda)
  const precoLote = (l) => (ctx.verDinheiro() ? precoRacaoDoLote(compras, l.tipo) : null);
  const c = calcularLote(lote, bios, mort, rac, fim, precoLote(lote), desp);
  const nomeTanque = lote.tanques ? lote.tanques.nome : ((ctx.state.ref.tanques.find((t) => t.id === lote.tanque_id) || {}).nome || '');

  const unid = (v, u) => `${v}<em>${u}</em>`;
  const pesoUnid = (g) => (g >= 1000 ? unid(fmtNum(g / 1000, 2), 'kg') : unid(fmtNum(g, 0), 'g')); // 2,30 kg, não 2.300 g
  const destaque = (rotulo, valor, sub) => `<div class="destaque"><span>${rotulo}</span><b>${valor}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const linhaNum = (rotulo, valor, sub) => `<li><div class="esq"><b>${rotulo}</b>${sub ? `<small>${sub}</small>` : ''}</div><span class="valor">${valor}</span></li>`;
  // funcionário: corrige ou apaga só o que ELE lançou HOJE (sql/33). Dono e gerente: tudo.
  const meuId = ctx.state.perfil.id;
  const diaLocal = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const meuDeHoje = (r) => !!r && r.registrado_por === meuId && !!r.criado_em && diaLocal(r.criado_em) === hoje;
  const excluir = (tab, rid, r) => (gerir || (tab !== 'despescas' && meuDeHoje(r)) ? `<span class="acoes-reg no-print"><button class="btn mini no-print" data-edit="${tab}:${esc(rid)}" type="button">Editar</button><button class="btn mini perigo no-print" data-del="${tab}:${esc(rid)}" type="button">Excluir</button></span>` : '');
  const registro = (data, quemId, valor, tab, rid, r) => `<li><div class="esq"><b>${fmtData(data)}</b><small>${esc(quem(quemId))}</small></div><span class="valor">${valor}</span>${excluir(tab, rid, r)}</li>`;
  const secao = (titulo, itens, vazio) => `
    <section class="bloco"><h2>${titulo} <span class="contagem">${itens.length}</span></h2>
      <div class="card">${itens.length ? `<ul class="lista registros">${itens.join('')}</ul>` : `<p class="mudo" style="margin:0">${vazio}</p>`}</div></section>`;

  // ---- comparação com ciclos encerrados: na mesma idade deste lote e como terminaram ----
  let cmpHtml = '', cmpPdf = null;
  async function compararCiclos() {
    const todos = await ctx.api.lotes().catch(() => []);
    const enc = todos.filter((l) => !l.ativo && l.id !== lote.id && l.especie === lote.especie);
    const recentes = (a, b) => String(b.data_entrada).localeCompare(String(a.data_entrada));
    const anteriorTanque = enc.filter((l) => l.tanque_id === lote.tanque_id).sort(recentes)[0] || null;
    const mesmaFase = enc.filter((l) => l.tipo === lote.tipo).sort(recentes).slice(0, 6);
    if (!anteriorTanque && !mesmaFase.length) {
      return `<div class="card"><p class="mudo" style="margin:0">Ainda não há ciclos de ${esc(lote.especie)} encerrados para comparar. Quando um lote for encerrado (Tanques &gt; lote &gt; Encerrar), este quadro mostra como este ciclo está em relação aos anteriores na mesma idade.</p></div>`;
    }
    const ids = [...new Set([anteriorTanque && anteriorTanque.id, ...mesmaFase.map((l) => l.id)].filter(Boolean))];
    const dados = Object.fromEntries(await Promise.all(ids.map(async (lid) => [lid, await ctx.api.dadosLote(lid, { venda: ctx.verDinheiro() }).catch(() => null)])));
    const idade = c.diasCultivo;
    const naIdade = (l) => { const d = dados[l.id]; return d ? calcularNaIdade(l, d.bios, d.mort, d.rac, idade, precoLote(l), d.desp) : null; };
    const porMil = (x, l) => (x && Number(l.quantidade_inicial) > 0 ? (x.racaoTotal / Number(l.quantidade_inicial)) * 1000 : null);
    const ant = anteriorTanque ? naIdade(anteriorTanque) : null;
    const fase = mesmaFase.map((l) => ({ l, x: naIdade(l) })).filter((o) => o.x);
    const med = (k) => mediaDe(fase.map((o) => o.x), k);
    const medPorMil = mediaDe(fase.map((o) => ({ v: porMil(o.x, o.l) })), 'v');
    const g = (v) => (v == null ? '—' : v >= 1000 ? `${fmtNum(v / 1000, 2)} kg` : `${fmtNum(v, v < 10 ? 1 : 0)} g`);
    // [rótulo, este lote, ciclo anterior, média, formato, maior é melhor? (null = neutro)]
    const linhas = [
      ['Peso médio', c.pmAtualG, ant && ant.pmAtualG, med('pmAtualG'), g, true],
      ['Ganho diário', c.gpd, ant && ant.gpd, med('gpd'), (v) => (v == null ? '—' : `${fmtNum(v, 1)} g/dia`), true],
      ['Conversão alimentar', c.ca, ant && ant.ca, med('ca'), (v) => (v == null ? '—' : fmtNum(v, 2)), false],
      ['Sobrevivência', c.sobrevivencia, ant && ant.sobrevivencia, med('sobrevivencia'), (v) => (v == null ? '—' : `${fmtPct(v)}%`), true],
      ['Ração por mil peixes', porMil(c, lote), ant && porMil(ant, anteriorTanque), medPorMil, (v) => (v == null ? '—' : `${fmtNum(v, 0)} kg`), null],
      ...(ctx.verDinheiro() ? [['Custo da ração por kg produzido', c.custoKgProduzido, ant && ant.custoKgProduzido, med('custoKgProduzido'), (v) => (v == null ? '—' : fmtBRL(v)), false]] : []),
    ];
    // marca melhor/pior em relação à média da fase (ou ao ciclo anterior); só diferenças de 5% ou mais
    const marca = (este, ref, maior) => {
      if (maior == null || este == null || ref == null || !ref) return '';
      const dif = (este - ref) / Math.abs(ref);
      if (Math.abs(dif) < 0.05) return '<span class="cmp-tag igual">na média</span>';
      const melhor = maior ? dif > 0 : dif < 0;
      return `<span class="cmp-tag ${melhor ? 'melhor' : 'pior'}">${melhor ? 'melhor' : 'pior'} ${fmtInt(Math.abs(dif) * 100)}%</span>`;
    };
    const colAnt = anteriorTanque ? `<th class="n">Ciclo anterior<small>${esc(nomeTanque)} · ${fmtData(anteriorTanque.data_entrada)}</small></th>` : '';
    const colMed = fase.length ? `<th class="n">Média da fazenda<small>${fmtInt(fase.length)} ${fase.length === 1 ? 'ciclo' : 'ciclos'} de ${esc((ROTULO_TIPO[lote.tipo] || lote.tipo).toLowerCase())}</small></th>` : '';
    const tabela = `<div class="card"><table class="cmp">
      <thead><tr><th>No dia ${fmtInt(idade)} do ciclo</th><th class="n">Este lote</th>${colAnt}${colMed}</tr></thead>
      <tbody>${linhas.map(([r, e, a, m, f, maior]) => `<tr><td>${r}</td><td class="n" data-r="Este lote"><b>${f(e)}</b>${marca(e, fase.length ? m : a, maior)}</td>${anteriorTanque ? `<td class="n" data-r="Ciclo anterior">${f(a)}</td>` : ''}${fase.length ? `<td class="n" data-r="Média">${f(m)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
    const tagTxt = (este, ref, maior) => marca(este, ref, maior).replace(/<[^>]+>/g, '');
    cmpPdf = {
      idade,
      cab: ['INDICADOR', 'ESTE LOTE', ...(anteriorTanque ? [`CICLO ANTERIOR (${fmtData(anteriorTanque.data_entrada)})`] : []), ...(fase.length ? [`MÉDIA (${fase.length} ${fase.length === 1 ? 'CICLO' : 'CICLOS'})`] : [])],
      corpo: linhas.map(([r, e, a, m, f, maior]) => { const t = tagTxt(e, fase.length ? m : a, maior); return [r, `${f(e)}${t ? ` (${t})` : ''}`, ...(anteriorTanque ? [f(a)] : []), ...(fase.length ? [f(m)] : [])]; }),
      fim: '',
    };
    let fim = '';
    const dAnt = anteriorTanque && dados[anteriorTanque.id];
    if (dAnt) {
      const dataFim = fimDoLote(anteriorTanque, dAnt.bios, dAnt.mort, dAnt.rac, hoje, dAnt.desp);
      const fz = calcularLote(anteriorTanque, dAnt.bios, dAnt.mort, dAnt.rac, dataFim, precoLote(anteriorTanque), dAnt.desp);
      const dur = Math.max(0, Math.round((new Date(`${dataFim}T12:00:00`) - new Date(`${anteriorTanque.data_entrada}T12:00:00`)) / 864e5));
      cmpPdf.fim = `O ciclo anterior deste tanque durou ${fmtInt(dur)} dias e terminou com ${g(fz.pmAtualG)}${fz.ca != null ? `, conversão ${fmtNum(fz.ca, 2)}` : ''} e ${fmtPct(fz.sobrevivencia)}% de sobrevivência.`;
      fim = `<p class="cmp-fim">O ciclo anterior deste tanque durou <b>${fmtInt(dur)} dias</b> e terminou com <b>${g(fz.pmAtualG)}</b>${fz.ca != null ? `, conversão <b>${fmtNum(fz.ca, 2)}</b>` : ''} e <b>${fmtPct(fz.sobrevivencia)}%</b> de sobrevivência${gerir && fz.custoKgProduzido != null ? ` (ração a ${fmtBRL(fz.custoKgProduzido)} por kg produzido)` : ''}.</p>`;
    }
    return `${tabela}${fim}<p class="mudo nota">Comparação na mesma idade: os ciclos anteriores são recortados no dia ${fmtInt(idade)} depois da entrada; ciclo encerrado termina no último registro. Melhor/pior em relação à ${fase.length ? 'média da fazenda' : 'ciclo anterior'}, só com 5% ou mais de diferença.</p>`;
  }
  const pintarCmp = (h) => { cmpHtml = h; const box = el.querySelector('#cmp-ciclos'); if (box) box.innerHTML = `<h2>Comparação com ciclos anteriores</h2>${h}`; };
  compararCiclos().then(pintarCmp).catch(() => pintarCmp('<div class="card"><p class="mudo" style="margin:0">Não foi possível buscar os ciclos anteriores agora.</p></div>'));

  const abas = [['resumo', 'Resumo'], ['peso', 'Peso'], ['racao', 'Ração'], ['agua', 'Água'], ...(gerir && desp.length ? [['despesca', 'Despesca']] : []), ['registros', gerir ? 'Registros' : 'Lançamentos']];
  // ?aba=registros: atalho "Lançou errado?" da tela do tanque abre direto a lista de lançamentos
  let aba = /[?&]aba=registros(&|$)/.test(location.hash) ? 'registros' : 'resumo';

  const painelResumo = () => `
    <div class="card destaques3">
      ${destaque('Peso médio atual', c.pmAtualG != null ? pesoUnid(c.pmAtualG) : '—', c.pmAtualG != null ? `em ${fmtData(c.dataUltimaBio)}` : 'sem biometria ainda')}
      ${destaque('Ração fornecida', unid(fmtNum(c.racaoTotal, 0), 'kg'), `≈ ${fmtNum(c.racaoTotal / kgS, 1)} sacos` + (c.racaoMediaDia != null ? ` · média ${fmtNum(c.racaoMediaDia, 1)} kg/dia` : ''))}
      ${destaque('Conversão alimentar', c.ca != null ? fmtNum(c.ca, 2) : '—', c.ca != null ? 'kg de ração por kg ganho' : c.caAguardaPesagem ? 'lote cadastrado em andamento: aparece depois da próxima pesagem' : c.dataUltimaBio ? 'aparece quando houver ração lançada até a última biometria' : 'precisa de biometria com ganho')}
    </div>
    <section class="bloco"><h2>Situação do lote</h2>
      <div class="card"><ul class="lista numeros">
        ${linhaNum('Dias de cultivo', fmtInt(c.diasCultivo))}
        ${linhaNum(lote.ativo ? 'Peixes vivos (estim.)' : 'Peixes no tanque', fmtInt(c.vivos), `${fmtPct(c.sobrevivencia)}% de sobrevivência · ${fmtInt(c.mortos)} mortos`)}
        ${c.despescados ? linhaNum('Peixes retirados', fmtInt(c.despescados), gerir ? `${fmtNum(c.pesoDespescado, 0)} kg de peso bruto` : '') : ''}
        ${ctx.verDinheiro() && c.despescados ? linhaNum('Receita das despescas', c.receita != null ? fmtBRL(c.receita) : '—', c.receita == null ? 'informe o preço de venda na despesca' : c.despescasSemPreco ? `falta o preço em ${fmtInt(c.despescasSemPreco)} ${c.despescasSemPreco === 1 ? 'despesca' : 'despescas'}` : 'sobre o peso bruto') : ''}
        ${linhaNum('Biomassa estimada', c.biomassaAtual != null ? fmtNum(c.biomassaAtual, 0) + ' kg' : '—', `na entrada: ${fmtNum(c.biomassaInicial, 0)} kg`)}
        ${ctx.verDinheiro() ? linhaNum('Custo de ração', c.custoRacao != null ? fmtBRL(c.custoRacao) : '—', c.custoRacao != null ? 'pelo preço médio pago por kg' : 'registre o valor nas compras') : ''}
        ${ctx.verDinheiro() ? linhaNum('Custo de ração por kg produzido', c.custoKgProduzido != null ? fmtBRL(c.custoKgProduzido) : '—', c.custoKgProduzido != null ? 'ração até a última biometria ÷ peixe que ganhou peso' : 'precisa de preço nas compras e biometria com ganho') : ''}
      </ul></div>
      <p class="mudo nota">Valores estimados usam o peso médio da última biometria e a mortalidade registrada. Quanto mais biometrias, mais confiável.</p>
    </section>
    <section class="bloco" id="cmp-ciclos"><h2>Comparação com ciclos anteriores</h2>${cmpHtml || '<div class="card"><p class="mudo" style="margin:0">Buscando os ciclos anteriores…</p></div>'}</section>`;

  const painelPeso = () => {
    const ev = evolucaoPeso(lote, bios);
    return `
    <div class="card destaques3">
      ${destaque('Peso médio atual', c.pmAtualG != null ? pesoUnid(c.pmAtualG) : '—', `na entrada: ${c.pmInicialG >= 1000 ? fmtNum(c.pmInicialG / 1000, 2) + ' kg' : fmtNum(c.pmInicialG, 1) + ' g'}`)}
      ${destaque('Ganho diário', c.gpd != null ? unid(fmtNum(c.gpd, 2), 'g/dia') : '—', 'por peixe, desde a entrada')}
    </div>
    <section class="bloco"><h2>Evolução do peso médio</h2><div class="card">${svgPeso(pontosPeso(lote, bios))}</div></section>
    <section class="bloco"><h2>Biometrias <span class="contagem">${bios.length}</span></h2>
      <div class="card tabela">${ev.length > 1 ? `<table><thead><tr><th>Data</th><th class="n">Peso médio</th><th class="n">Ganho</th></tr></thead><tbody>
        ${[...ev].reverse().map((p) => `<tr><td>${fmtData(p.data)}${p.inicial ? ' <small>entrada</small>' : ''}</td><td class="n"><b>${fmtNum(p.g, p.g < 10 ? 1 : 0)} g</b></td><td class="n">${p.ganhoDia != null ? fmtNum(p.ganhoDia, 1) + ' g/dia' : '—'}</td></tr>`).join('')}
      </tbody></table>` : '<p class="mudo" style="margin:0">Nenhuma biometria registrada.</p>'}</div>
    </section>`;
  };

  const painelRacao = () => {
    const sem = racaoPorSemana(rac);
    const recentes = [...rac].reverse().slice(0, 14);
    return `
    <div class="card destaques3">
      ${destaque('Ração fornecida', unid(fmtNum(c.racaoTotal, 0), 'kg'), `≈ ${fmtNum(c.racaoTotal / kgS, 1)} sacos` + (c.racaoMediaDia != null ? ` · média ${fmtNum(c.racaoMediaDia, 1)} kg/dia` : ''))}
      ${ctx.verDinheiro() ? destaque('Custo de ração', c.custoRacao != null ? fmtBRL(c.custoRacao) : '—', c.custoRacao != null ? 'pelo preço médio pago por kg' : 'registre o valor nas compras') : ''}
      ${ctx.verDinheiro() && c.custoKgProduzido != null ? destaque('Custo por kg produzido', fmtBRL(c.custoKgProduzido), 'só a ração, por kg de peixe ganho') : ''}
    </div>
    <section class="bloco"><h2>Por semana</h2><div class="card">${svgSemanas(sem)}</div></section>
    <section class="bloco"><h2>Últimos lançamentos</h2>
      <div class="card tabela">${recentes.length ? `<table><thead><tr><th>Data</th><th class="n">Ração</th></tr></thead><tbody>
        ${recentes.map((r) => `<tr><td>${fmtData(r.data)}</td><td class="n"><b>${fmtNum(r.quantidade_kg, 1)} kg</b></td></tr>`).join('')}
      </tbody></table>${rac.length > 14 ? '<p class="mudo nota">Mostrando os 14 mais recentes. A lista completa está em Registros.</p>' : ''}` : '<p class="mudo" style="margin:0">Nenhuma ração lançada.</p>'}</div>
    </section>`;
  };

  const areaTanque = (ctx.state.ref.tanques.find((t) => t.id === lote.tanque_id) || {}).area_ha;
  const painelDespesca = () => {
    const kg = (v, d = 0) => `${fmtNum(v, d)} kg`;
    const cartao = (d) => {
      const i = indicadoresDespesca(d, areaTanque);
      return `<section class="bloco"><h2>${fmtData(d.data)} <span class="tag${d.tipo === 'total' ? ' ok' : ''}">${d.tipo === 'total' ? 'Total' : 'Parcial'}</span></h2>
        <div class="card"><ul class="lista numeros">
          ${linhaNum('Total de peixes', fmtInt(d.quantidade))}
          ${linhaNum('Peso total bruto', kg(d.peso_bruto_kg))}
          ${linhaNum('Peso total líquido', d.peso_liquido_kg != null ? kg(d.peso_liquido_kg) : '—')}
          ${i.difKg != null ? linhaNum('Diferença bruto − líquido', kg(i.difKg), `${fmtNum(i.difPct, 1)}% do peso bruto`) : ''}
          ${linhaNum('Peso médio por peixe (bruto)', pesoMedioTxt(i.medioBrutoKg))}
          ${i.medioLiquidoKg != null ? linhaNum('Peso médio por peixe (líquido)', pesoMedioTxt(i.medioLiquidoKg)) : ''}
          ${i.peixesHa != null ? linhaNum('Peixes por hectare', `${fmtInt(i.peixesHa)} peixes/ha`) : ''}
          ${d.preco_kg != null ? linhaNum('Preço de venda', `${fmtBRL(d.preco_kg)}/kg`, d.comprador ? esc(d.comprador) : '') : d.comprador ? linhaNum('Comprador', esc(d.comprador)) : ''}
          ${i.receita != null ? linhaNum('Receita', fmtBRL(i.receita), 'sobre o peso bruto') : ''}
        </ul>
        <button class="btn no-print" type="button" data-pdf-desp="${esc(d.id)}">Gerar PDF desta despesca</button></div></section>`;
    };
    return `${desp.length > 1 ? `<div class="card destaques3">${destaque('Peixes retirados', fmtInt(c.despescados), `em ${fmtInt(desp.length)} despescas`)}${destaque('Peso bruto retirado', unid(fmtNum(c.pesoDespescado, 0), 'kg'), '')}${c.receita != null ? destaque('Receita', fmtBRL(c.receita), c.despescasSemPreco ? `falta o preço em ${fmtInt(c.despescasSemPreco)}` : '') : ''}</div>` : ''}${[...desp].reverse().map(cartao).join('')}`;
  };

  const painelAgua = () => {
    if (!agua.length) return '<div class="card vazio"><p>Nenhuma medição da água neste tanque desde a entrada do lote.</p><a class="btn primario" href="#/lancar?tipo=agua&tanque=' + esc(lote.tanque_id) + '">Medir agora</a></div>';
    const n = (v, d) => (v == null ? '—' : fmtNum(Number(v), d));
    const tam = ehTambaqui(lote.especie), u = agua[agua.length - 1];
    const mortesDia = {}; mort.forEach((m) => { mortesDia[m.data] = (mortesDia[m.data] || 0) + Number(m.quantidade); });
    const od = agua.filter((a) => a.oxigenio_mgl != null).map((a) => ({ data: a.data, g: Number(a.oxigenio_mgl) }));
    const foraU = tam ? avaliarAgua(u) : [];
    return `<div class="card destaques3">
      ${destaque('Oxigênio', u.oxigenio_mgl != null ? unid(n(u.oxigenio_mgl, 1), 'mg/L') : '—', `em ${fmtData(u.data)}${u.hora ? ` às ${esc(u.hora)}` : ''}`)}
      ${destaque('Temperatura', u.temperatura_c != null ? unid(n(u.temperatura_c, 1), '°C') : '—', '')}
      ${destaque('pH', n(u.ph, 1), '')}
      ${destaque('Amônia tóxica', u.amonia_mgl != null ? unid(n(u.amonia_mgl, 2), 'mg/L') : '—', '')}
    </div>
    ${foraU.length ? `<p class="aviso">${foraU.map((x) => esc(x.texto[0].toUpperCase() + x.texto.slice(1))).join('<br>')}</p>` : ''}
    <section class="bloco"><h2>Oxigênio ao longo do tempo (mg/L)</h2><div class="card">${svgPeso(od, { un: '', dec: 1, vazio: 'O gráfico aparece a partir da segunda medição de oxigênio.', rotulo: 'Evolução do oxigênio' })}</div></section>
    <section class="bloco"><h2>Medições e mortes do dia</h2><div class="card tabela"><table><thead><tr><th>Data</th><th class="n">O₂</th><th class="n">°C</th><th class="n">pH</th><th class="n">NH₃</th><th class="n">Mortes</th></tr></thead><tbody>
      ${[...agua].reverse().slice(0, 30).map((a) => `<tr><td>${fmtData(a.data).slice(0, 5)}${a.hora ? ` <small>${esc(a.hora)}</small>` : ''}</td><td class="n">${n(a.oxigenio_mgl, 1)}</td><td class="n">${n(a.temperatura_c, 1)}</td><td class="n">${n(a.ph, 1)}</td><td class="n">${n(a.amonia_mgl, 2)}</td><td class="n">${mortesDia[a.data] ? fmtInt(mortesDia[a.data]) : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    ${agua.length > 30 ? `<p class="mudo nota">Mostrando as 30 medições mais recentes de ${fmtInt(agua.length)}. Todas vão na planilha (CSV).</p>` : ''}
    <p class="mudo nota">${tam ? 'Faixas do tambaqui: oxigênio de 4 a 8 mg/L, temperatura de 28 a 30 °C, pH de 5 a 7 e amônia tóxica abaixo de 0,46 mg/L (Embrapa, 2018). Confirme com o técnico da fazenda.' : `Ainda não há faixa de referência no app para ${esc(lote.especie)}. As medições aparecem sem alerta.`}</p></section>`;
  };

  const painelRegistros = () => `
    ${!gerir ? '<p class="aviso">Você pode corrigir ou apagar o que <b>você</b> lançou <b>hoje</b>. Para mudar um lançamento mais antigo, fale com o dono ou o gerente.</p>' : ''}
    ${secao('Ração lançada', [...rac].reverse().map((r) => registro(r.data, r.registrado_por, `${fmtNum(r.quantidade_kg, 1)} kg (≈ ${fmtNum(r.quantidade_kg / kgS, 1)} sacos)`, 'racao_consumo', r.id, r)), 'Nenhuma ração lançada.')}
    ${secao('Biometrias', [...bios].reverse().map((b) => registro(b.data, b.registrado_por, `${pesoMedioTxt(pesoMedioKg(b))}<small>${fmtInt(b.quantidade_amostrada)} ${Number(b.quantidade_amostrada) === 1 ? 'peixe' : 'peixes'} · ${fmtNum(b.peso_amostra_kg, 3)} kg</small>`, 'biometrias', b.id, b)), 'Nenhuma biometria registrada.')}
    ${secao('Mortalidade', [...mort].reverse().map((m) => registro(m.data, m.registrado_por, `${fmtInt(m.quantidade)} peixes${m.causa ? `<small class="causa">${esc(m.causa)}</small>` : ''}`, 'mortalidade', m.id, m)), 'Nenhuma mortalidade registrada.')}
    ${gerir && desp.length ? secao('Despescas', [...desp].reverse().map((d) => registro(d.data, d.registrado_por, `${fmtNum(d.peso_bruto_kg, 0)} kg bruto<small>${d.tipo === 'total' ? 'Total' : 'Parcial'} · ${fmtInt(d.quantidade)} peixes</small>`, 'despescas', d.id)), '') : ''}
    ${agua.length ? secao('Água', [...agua].reverse().map((a) => registro(a.data, a.registrado_por, `${[a.oxigenio_mgl != null && `O₂ ${fmtNum(Number(a.oxigenio_mgl), 1)}`, a.temperatura_c != null && `${fmtNum(Number(a.temperatura_c), 1)} °C`, a.ph != null && `pH ${fmtNum(Number(a.ph), 1)}`, a.amonia_mgl != null && `NH₃ ${fmtNum(Number(a.amonia_mgl), 2)}`].filter(Boolean).join(' · ')}${a.obs ? `<small>${esc(a.obs)}</small>` : ''}`, 'qualidade_agua', a.id, a)), '') : ''}
    ${man.length ? secao('Probiótico', [...man].reverse().map((m) => registro(m.data, m.registrado_por, `${String(Number(m.dose)).replace('.', ',')} ${esc(m.unidade)}<small>${esc(m.produto)} · ${m.via === 'agua' ? 'na água' : 'na ração'}${m.obs ? ` · ${esc(m.obs)}` : ''}</small>`, 'manejos', m.id, m)), '') : ''}`;

  const paineis = { resumo: painelResumo, peso: painelPeso, racao: painelRacao, agua: painelAgua, despesca: painelDespesca, registros: painelRegistros };

  el.innerHTML = `
    <h1>${esc(nomeTanque)} · ${esc(lote.especie)}</h1>
    <p class="mudo cab-lote"><span class="fase ${faseCss(lote.tipo)}"></span>${esc(ROTULO_TIPO[lote.tipo] || lote.tipo)} · entrada em ${fmtData(lote.data_entrada)} · ${lote.ativo ? 'lote ativo' : 'lote encerrado'}</p>
    <div class="seg no-print" style="--n:${abas.length}" role="tablist">${abas.map(([k, r]) => `<button type="button" data-aba="${k}">${r}</button>`).join('')}</div>
    <div id="painel"></div>
    <div class="acoes no-print">
      <button class="btn primario" id="b-pdf" type="button">Gerar PDF para compartilhar</button>
      <button class="btn" id="b-csv" type="button">Baixar planilha (CSV)</button>
    </div>`;

  const painel = el.querySelector('#painel');
  function pintar() {
    el.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.aba === aba));
    painel.innerHTML = paineis[aba]();
    painel.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        const [tab, rid] = b.dataset.del.split(':');
        const total = tab === 'despescas' && (desp.find((x) => x.id === rid) || {}).tipo === 'total';
        if (!(await confirmar({ titulo: 'Excluir este lançamento?', texto: `Os totais do relatório serão recalculados.${total ? ' O lote continua encerrado: se foi engano, reabra em Tanques.' : ''}`, ok: 'Excluir', perigo: true }))) return;
        try { await ctx.api.excluir(tab, rid); ctx.toast('Lançamento excluído', 'ok'); renderRelatorioLote(ctx, el, id); }
        catch (e) { ctx.toast(e.message, 'erro'); }
      }));
    painel.querySelectorAll('[data-pdf-desp]').forEach((b) =>
      b.addEventListener('click', async () => {
        const d = desp.find((x) => x.id === b.dataset.pdfDesp); if (!d) return;
        if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
        const texto = b.textContent; b.disabled = true; b.textContent = 'Gerando PDF…';
        try {
          const [jsPDF, fontes] = await Promise.all([carregarGerador(), carregarFontes()]);
          const fazenda = (ctx.state.perfil.fazendas && ctx.state.perfil.fazendas.nome) || 'Piscicultura';
          const doc = gerarPdfDespesca(jsPDF, { logo: ctx.state.ref.logo || null, fazenda, nomeTanque, lote, despesca: d, areaHa: areaTanque, geradoEm: hoje, fontes });
          await abrirVisualizador({ blob: doc.output('blob'), nome: nomeArquivo(['Relatório de despesca', nomeTanque || 'Tanque', dataArquivo(d.data)], 'pdf'), titulo: `Despesca · ${nomeTanque}`, toast: ctx.toast });
        } catch (e) { ctx.toast(e.message || 'Não foi possível gerar o PDF', 'erro'); }
        b.disabled = false; b.textContent = texto;
      }));
    painel.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', async () => {
        const [tab, rid] = b.dataset.edit.split(':');
        if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
        const campos = camposEdicao(tab, rid);
        if (!campos) return;
        const v = await formulario({ titulo: 'Corrigir lançamento', texto: 'Os totais do relatório serão recalculados.', campos: campos.lista, validar: campos.validar });
        if (!v) return;
        const aviso = campos.conferir && campos.conferir(v);
        if (aviso && !(await confirmar({ titulo: 'Confira o peso', texto: aviso, ok: 'Está certo', cancelar: 'Corrigir' }))) return;
        try { await ctx.api.atualizar(tab, rid, campos.montar(v)); ctx.toast('Lançamento corrigido', 'ok'); renderRelatorioLote(ctx, el, id); }
        catch (e) { ctx.toast(e.message, 'erro'); }
      }));
  }

  // campos da janela de correção de cada tipo de lançamento
  function camposEdicao(tab, rid) {
    const dataCampo = (valor) => ({ nome: 'data', rotulo: 'Data', tipo: 'date', valor, min: lote.data_entrada, max: hoje });
    const pesoOk = (t) => (String(t ?? '').includes('.') && String(t ?? '').includes(',') ? 'Digite o peso sem ponto de milhar. Ex.: 9547,5' : null);
    // compara com a pesagem mais recente, sem contar o próprio registro que está sendo corrigido
    const conferirPeso = (quantidade, pesoTotalKg, data, semId) => {
      const u = bios.filter((b) => b.id !== semId && b.data <= data).pop();
      return avisoPesoMedio({ quantidade, pesoTotalKg, lote, data, r: u ? { ultimo_peso_medio_kg: pesoMedioKg(u), ultima_biometria: u.data } : null });
    };
    const dataOk = (d) => (!d ? 'Informe a data.' : d > hoje ? 'A data não pode ser no futuro.' : d < lote.data_entrada ? `A data não pode ser antes da entrada do lote (${fmtData(lote.data_entrada)}).` : null);
    if (tab === 'racao_consumo') {
      const r = rac.find((x) => x.id === rid); if (!r) return null;
      return {
        lista: [dataCampo(r.data), { nome: 'kg', rotulo: 'Ração (kg)', tipo: 'number', valor: r.quantidade_kg, step: '0.1', min: '0.1', inputmode: 'decimal', ajuda: `1 saco = ${fmtNum(kgS, 0)} kg` }],
        validar: (v) => dataOk(v.data) || (num(v.kg) > 0 ? null : 'Informe a quantidade de ração em kg.') || (num(v.kg) <= 5000 ? null : 'Quantidade muito alta para um tanque. Confira os kg.'),
        montar: (v) => ({ data: v.data, quantidade_kg: num(v.kg) }),
      };
    }
    if (tab === 'biometrias') {
      const b = bios.find((x) => x.id === rid); if (!b) return null;
      return {
        lista: [dataCampo(b.data),
          { nome: 'qtd', rotulo: 'Peixes pesados', tipo: 'number', valor: b.quantidade_amostrada, step: '1', min: '1', inputmode: 'numeric' },
          { nome: 'peso', rotulo: 'Peso total da amostra (kg)', tipo: 'text', valor: b.peso_amostra_kg, inputmode: 'decimal' }],
        validar: (v) => dataOk(v.data) || (Number.isInteger(num(v.qtd)) && num(v.qtd) >= 1 ? null : 'Informe quantos peixes foram pesados (número inteiro).') || pesoOk(v.peso) || (numDecimal(v.peso) > 0 ? null : 'Informe o peso da amostra em kg.'),
        conferir: (v) => conferirPeso(num(v.qtd), numDecimal(v.peso), v.data, b.id),
        montar: (v) => ({ data: v.data, quantidade_amostrada: num(v.qtd), peso_amostra_kg: numDecimal(v.peso) }),
      };
    }
    if (tab === 'qualidade_agua') {
      const a = agua.find((x) => x.id === rid); if (!a) return null;
      const LIM = { od: [0, 25], temp: [0, 50], ph: [0, 14], am: [0, 50] };
      const txt = (v) => (v == null ? '' : String(Number(v)).replace('.', ','));
      const lista = [['od', 'Oxigênio (mg/L)', a.oxigenio_mgl], ['temp', 'Temperatura (°C)', a.temperatura_c], ['ph', 'pH', a.ph], ['am', 'Amônia tóxica (mg/L)', a.amonia_mgl]];
      const val = (v, k) => (String(v[k] ?? '').trim() === '' ? null : numDecimal(v[k]));
      return {
        lista: [dataCampo(a.data), ...lista.map(([nome, rotulo, valor]) => ({ nome, rotulo, tipo: 'text', valor: txt(valor), inputmode: 'decimal' })), { nome: 'obs', rotulo: 'Observação (opcional)', tipo: 'text', valor: a.obs || '', maxlength: 200 }],
        validar: (v) => dataOk(v.data) || (lista.every(([k]) => val(v, k) == null) ? 'Preencha pelo menos uma medição.' : null) || (lista.map(([k, r]) => { const x = val(v, k); return x != null && !(Number.isFinite(x) && x >= LIM[k][0] && x <= LIM[k][1]) ? `${r}: confira o valor.` : null; }).find(Boolean) || null),
        montar: (v) => ({ data: v.data, oxigenio_mgl: val(v, 'od'), temperatura_c: val(v, 'temp'), ph: val(v, 'ph'), amonia_mgl: val(v, 'am'), obs: String(v.obs || '').trim() || null }),
      };
    }
    if (tab === 'manejos') {
      const m = man.find((x) => x.id === rid); if (!m) return null;
      return {
        lista: [dataCampo(m.data),
          { nome: 'produto', rotulo: 'Produto', tipo: 'text', valor: m.produto, maxlength: 80 },
          { nome: 'dose', rotulo: 'Dose', tipo: 'text', valor: String(Number(m.dose)).replace('.', ','), inputmode: 'decimal' },
          { nome: 'unidade', rotulo: 'Unidade', tipo: 'select', valor: m.unidade, opcoes: [['g', 'g'], ['kg', 'kg'], ['mL', 'mL'], ['L', 'L']] },
          { nome: 'via', rotulo: 'Aplicação', tipo: 'select', valor: m.via, opcoes: [['racao', 'Na ração'], ['agua', 'Na água']] },
          { nome: 'obs', rotulo: 'Observação (opcional)', tipo: 'text', valor: m.obs || '', maxlength: 200 }],
        validar: (v) => dataOk(v.data) || (String(v.produto || '').trim() ? null : 'Informe o nome do produto.') || pesoOk(v.dose) || (numDecimal(v.dose) > 0 && numDecimal(v.dose) <= 1000000 ? null : 'Informe a dose aplicada (até 1.000.000).'),
        montar: (v) => ({ data: v.data, produto: String(v.produto).trim(), dose: numDecimal(v.dose), unidade: v.unidade, via: v.via, obs: String(v.obs || '').trim() || null }),
      };
    }
    if (tab === 'despescas') {
      const d = desp.find((x) => x.id === rid); if (!d) return null;
      return {
        lista: [dataCampo(d.data),
          { nome: 'qtd', rotulo: 'Peixes retirados', tipo: 'number', valor: d.quantidade, step: '1', min: '1', inputmode: 'numeric' },
          { nome: 'bruto', rotulo: 'Peso total bruto (kg)', tipo: 'text', valor: d.peso_bruto_kg, inputmode: 'decimal' },
          { nome: 'liquido', rotulo: 'Peso total líquido (kg, opcional)', tipo: 'text', valor: d.peso_liquido_kg ?? '', inputmode: 'decimal' },
          ...('preco_kg' in d ? [{ nome: 'preco', rotulo: 'Preço de venda por kg (opcional)', tipo: 'text', valor: moedaCampo(d.preco_kg), prefixo: 'R$', inputmode: 'decimal', maxlength: '10' },
            { nome: 'comprador', rotulo: 'Comprador (opcional)', tipo: 'text', valor: d.comprador || '', maxlength: 80 }] : [])],
        validar: (v) => dataOk(v.data) || (Number.isInteger(num(v.qtd)) && num(v.qtd) >= 1 ? null : 'Informe quantos peixes saíram (número inteiro).') || pesoOk(v.bruto) || pesoOk(v.liquido) || (numDecimal(v.bruto) > 0 ? null : 'Informe o peso bruto em kg.')
          || (String(v.liquido ?? '').trim() === '' || (numDecimal(v.liquido) > 0 && numDecimal(v.liquido) <= numDecimal(v.bruto)) ? null : 'O peso líquido deve ser maior que zero e até o peso bruto.')
          || (String(v.preco ?? '').trim() === '' || (numMoeda(v.preco) > 0 && numMoeda(v.preco) <= 1000) ? null : 'Confira o preço de venda por kg, ou deixe em branco.'),
        conferir: (v) => conferirPeso(num(v.qtd), numDecimal(v.bruto), v.data, null),
        montar: (v) => ({ data: v.data, quantidade: num(v.qtd), peso_bruto_kg: numDecimal(v.bruto), peso_liquido_kg: String(v.liquido ?? '').trim() === '' ? null : numDecimal(v.liquido), ...('preco_kg' in d ? { preco_kg: String(v.preco ?? '').trim() === '' ? null : numMoeda(v.preco), comprador: String(v.comprador || '').trim() || null } : {}) }),
      };
    }
    if (tab === 'mortalidade') {
      const m = mort.find((x) => x.id === rid); if (!m) return null;
      const opcoes = [['', 'Não informada'], ...CAUSAS_MORTE.map(([c]) => [c, c])];
      if (m.causa && !opcoes.some(([c]) => c === m.causa)) opcoes.push([m.causa, m.causa]);
      return {
        lista: [dataCampo(m.data),
          { nome: 'qtd', rotulo: 'Peixes mortos', tipo: 'number', valor: m.quantidade, step: '1', min: '1', inputmode: 'numeric' },
          { nome: 'causa', rotulo: 'Causa provável', tipo: 'select', valor: m.causa || '', opcoes }],
        validar: (v) => dataOk(v.data) || (Number.isInteger(num(v.qtd)) && num(v.qtd) >= 1 ? null : 'Informe quantos peixes morreram (número inteiro).'),
        montar: (v) => ({ data: v.data, quantidade: num(v.qtd), causa: v.causa || null }),
      };
    }
    return null;
  }
  el.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { aba = b.dataset.aba; pintar(); }));
  pintar();

  const bpdf = el.querySelector('#b-pdf');
  bpdf.addEventListener('click', async () => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    const texto = bpdf.textContent; bpdf.disabled = true; bpdf.textContent = 'Gerando PDF…';
    try {
      const [jsPDF, fontes] = await Promise.all([carregarGerador(), carregarFontes()]);
      const doc = gerarPdfLote(jsPDF, {
        logo: ctx.state.ref.logo || null, fazenda: (ctx.state.perfil.fazendas && ctx.state.perfil.fazendas.nome) || 'Piscicultura', lote, nomeTanque, c, bios, mort, rac,
        evo: evolucaoPeso(lote, bios), semanas: racaoPorSemana(rac), agua, kgSaco: kgS, gerir, dinheiro: ctx.verDinheiro(), geradoEm: hoje, fontes, cmp: cmpPdf,
      });
      const blob = doc.output('blob');
      const nome = nomeArquivo(['Relatório do lote', nomeTanque || 'Tanque', lote.especie, `lote de ${dataArquivo(lote.data_entrada)}`, dataArquivo(hoje)], 'pdf');
      bpdf.disabled = false; bpdf.textContent = texto;
      await abrirVisualizador({ blob, nome, titulo: `${nomeTanque} · ${lote.especie}`, toast: ctx.toast });
    } catch (e) { ctx.toast(e.message || 'Não foi possível gerar o PDF', 'erro'); bpdf.disabled = false; bpdf.textContent = texto; }
  });
  el.querySelector('#b-csv').addEventListener('click', () => baixarCsv(nomeArquivo(['Relatório do lote', nomeTanque || 'Tanque', lote.especie, `lote de ${dataArquivo(lote.data_entrada)}`, dataArquivo(hojeISO())], 'csv'), montarCsv(lote, nomeTanque, c, bios, mort, rac, quem, gerir ? desp : [], man, agua)));
}

function baixarCsv(nome, texto) {
  const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Barras de ração por semana (kg)
function svgSemanas(sem) {
  if (!sem.length) return '<p class="mudo" style="margin:0">Nenhuma ração lançada.</p>';
  const ult = sem.slice(-12);
  const W = 320, H = 150, pl = 8, pr = 8, pt = 16, pb = 24;
  const max = Math.max(...ult.map((s) => s.kg));
  const larg = (W - pl - pr) / ult.length;
  const barras = ult.map((s, i) => {
    const h = max > 0 ? ((H - pt - pb) * s.kg) / max : 0;
    const x = pl + i * larg + larg * 0.18, w = larg * 0.64, y = H - pb - h;
    const [, m, d] = s.inicio.split('-');
    return `<rect class="barra" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="3"/>
      ${ult.length <= 8 || i % 2 === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${d}/${m}</text>` : ''}
      ${ult.length <= 8 ? `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${fmtNum(s.kg, 0)}</text>` : ''}`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ração por semana">${barras}</svg>
    <p class="mudo nota" style="margin:.4rem 0 0">Cada barra é uma semana (início na segunda-feira), em kg.</p>`;
}

// Barras de ração por dia (kg), do mais antigo ao mais recente
function svgDias(linhasDia) {
  const dias = linhasDia.slice().reverse();
  const W = 320, H = 130, pl = 6, pr = 6, pt = 14, pb = 20;
  const max = Math.max(...dias.map((d) => d.kg), 1);
  const larg = (W - pl - pr) / dias.length;
  const passo = dias.length > 14 ? 5 : dias.length > 8 ? 2 : 1;
  const barras = dias.map((d, i) => {
    const h = ((H - pt - pb) * d.kg) / max;
    const x = pl + i * larg + larg * 0.14, w = larg * 0.72, y = H - pb - h;
    const [, m, dd] = d.data.split('-');
    const rot = (dias.length - 1 - i) % passo === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${dd}/${m}</text>` : '';
    return `<rect class="barra${i === dias.length - 1 ? ' hoje' : ' cinza'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, d.kg > 0 ? 1.5 : 0.8).toFixed(1)}" rx="${Math.min(3, w / 2).toFixed(1)}"/>${rot}`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ração por dia">${barras}</svg>`;
}

// Ração por tanque: o relatório que o responsável manda ao dono (dia ou semana)
export async function renderRacaoDia(ctx, el) {
  el.innerHTML = '<p class="carregando">Montando relatório…</p>';
  if (!navigator.onLine) {
    el.innerHTML = `<h1>Ração por dia</h1><div class="card vazio"><p>Este relatório precisa de internet.</p></div>`;
    return;
  }
  const tanques = ctx.state.ref.tanques;
  const lotesAtivos = (ctx.state.ref.lotes || []).filter((l) => l.ativo !== false);
  const kgS = ctx.state.ref.kgSaco || PESO_SACO_PADRAO_KG;
  const fazenda = (ctx.state.perfil.fazendas && ctx.state.perfil.fazendas.nome) || 'Piscicultura';
  const hoje = hojeISO();
  const somaDias = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let desde = somaDias(hoje, -59);
  let [linhas, resumoLista] = await Promise.all([ctx.api.racaoPeriodo(desde), ctx.api.resumoLotes().catch(() => [])]);
  const resumo = Object.fromEntries((resumoLista || []).map((x) => [x.lote_id, x]));
  // lote e peso estimado dos peixes de cada tanque (para "% do peso vivo")
  const infoTanque = (tid) => {
    const ls = lotesAtivos.filter((l) => l.tanque_id === tid);
    if (!ls.length) return { lote: '', vivos: null, biomassaKg: null, fase: null };
    const lote = ls.length > 1 ? `${ls.length} lotes` : `${ls[0].especie} · ${(ROTULO_TIPO[ls[0].tipo] || ls[0].tipo || '').toLowerCase()}`;
    let vivos = 0, bio = 0, temPeso = true;
    for (const l of ls) {
      const r0 = resumo[l.id];
      const v = vivosDoLote(l, r0);
      vivos += v;
      if (r0 && r0.ultimo_peso_medio_kg != null) bio += v * Number(r0.ultimo_peso_medio_kg); else temPeso = false;
    }
    return { lote, vivos, biomassaKg: temPeso && bio > 0 ? bio : null, fase: ls.every((l) => l.tipo === ls[0].tipo) ? ls[0].tipo : null };
  };
  const nat = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
  const diaSemana = (iso) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)).replace(/^./, (c) => c.toUpperCase());
  const diaCurto = (iso) => {
    const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)).replace('.', '');
    return `${wd} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  };
  const f1 = (v) => fmtNum(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1);
  const sacos = (v) => f1(v / kgS);
  const kgTxt = (v) => fmtNum(v, v % 1 ? 1 : 0);
  const kg = (v) => (v == null ? '<span class="vazio-cel">–</span>' : kgTxt(v));

  let per = 'hoje'; let outro = hoje; const desmarcados = new Set(); // tanques fora do relatório (vazio = todos)
  const intervalo = () => {
    if (per === 'hoje') return [hoje, hoje];
    if (per === 'ontem') return [somaDias(hoje, -1), somaDias(hoje, -1)];
    if (per === 'dia') return [outro, outro];
    const n = Number(per); return [somaDias(hoje, -(n - 1)), hoje];
  };

  function calcular() {
    const [ini, fim] = intervalo();
    const dias = [];
    for (let d = fim; d >= ini; d = somaDias(d, -1)) dias.push(d);
    const noPeriodo = linhas.filter((r) => r.data >= ini && r.data <= fim);
    const porTanque = new Map(); const porDia = new Map();
    for (const r of noPeriodo) {
      const q = Number(r.quantidade_kg) || 0;
      porTanque.set(r.tanque_id, (porTanque.get(r.tanque_id) || 0) + q);
      const m = porDia.get(r.data) || new Map(); m.set(r.tanque_id, (m.get(r.tanque_id) || 0) + q); porDia.set(r.data, m);
    }
    const ativosIds = new Set(lotesAtivos.map((l) => l.tanque_id));
    const todos = tanques.filter((t) => porTanque.has(t.id) || ativosIds.has(t.id))
      .map((t) => {
        const kg = porTanque.get(t.id) || 0; const inf = infoTanque(t.id);
        return { id: t.id, nome: t.nome, kg, ativo: ativosIds.has(t.id), ...inf, pesoVivoPct: inf.biomassaKg ? ((kg / dias.length) / inf.biomassaKg) * 100 : null };
      }).sort((a, b) => nat(a.nome, b.nome));
    const lista = todos.filter((t) => !desmarcados.has(t.id));
    const linhasDia = dias.map((d) => {
      const m = porDia.get(d) || new Map(); const por = {}; let tot = 0;
      lista.forEach((t) => { por[t.nome] = m.has(t.id) ? m.get(t.id) : null; tot += m.get(t.id) || 0; });
      return { data: d, kg: tot, por };
    });
    const total = lista.reduce((s, t) => s + t.kg, 0);
    const um = ini === fim;
    const rotulo = um ? (fim === hoje ? 'Hoje' : fim === somaDias(hoje, -1) ? 'Ontem' : diaSemana(fim)) : `Últimos ${dias.length} dias`;
    const periodo = um ? `${diaSemana(fim)}, ${fmtData(fim)}` : `${fmtData(ini).slice(0, 5)} a ${fmtData(fim)}`;
    // mesmo tamanho de período, logo antes (para comparar)
    const antFim = somaDias(ini, -1), antIni = somaDias(ini, -dias.length);
    const idsLista = new Set(lista.map((t) => t.id));
    const antKg = linhas.filter((x) => x.data >= antIni && x.data <= antFim && idsLista.has(x.tanque_id)).reduce((t, x) => t + (Number(x.quantidade_kg) || 0), 0);
    const anterior = { kg: antKg, rotulo: um ? 'Vs. dia anterior' : `Vs. ${dias.length} dias antes` };
    const individual = lista.length === 1 && todos.length > 1;
    const parcial = lista.length > 1 && lista.length < todos.length;
    const nomePer = um ? (fim === hoje ? 'Ração de hoje' : fim === somaDias(hoje, -1) ? 'Ração de ontem' : 'Ração do dia') : `Ração dos últimos ${dias.length} dias`;
    const titulo = individual ? lista[0].nome : nomePer;
    const periodoPdf = individual ? `${nomePer} · ${periodo}` : parcial ? `${periodo} · ${lista.length} de ${todos.length} tanques` : periodo;
    return { ini, fim, dias, todos, lista, linhasDia, total, um, rotulo, periodo, colunas: lista.map((t) => t.nome), anterior, individual, parcial, titulo, periodoPdf };
  }

  el.innerHTML = `
    <h1>Ração fornecida</h1>
    <div class="seg no-print" style="--n:4" role="tablist">${[['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7', '7 dias'], ['30', '30 dias']].map(([k, t]) => `<button type="button" data-per="${k}">${t}</button>`).join('')}</div>
    <label class="outro-dia no-print">Ou escolha um dia<input type="date" id="outro" max="${hoje}" value="${hoje}"></label>
    <div id="resumo"></div>
    <div id="corpo"></div>
    <div class="msg-acoes no-print" id="acoes-racao">
      <button class="btn primario grande" id="b-pdf-racao" type="button">Enviar relatório (PDF)</button>
    </div>
    <p class="no-print" style="text-align:center;margin:1.2rem 0 .4rem"><button class="link" id="b-csv" type="button">Baixar planilha (CSV)</button></p>`;

  let r = null;
  // ração do período dividida por fase do lote (só quando há mais de uma fase)
  function pizzaFase(lista) {
    // ração de tanque cujo lote já foi encerrado (despesca total) entra como "Lote encerrado":
    // sem isso o centro da pizza dava 19 sacos e o total do dia 23
    const porFase = {};
    for (const t of lista) if (t.kg > 0) { const f = t.fase || 'encerrado'; porFase[f] = (porFase[f] || 0) + t.kg; }
    const fases = [...ORDEM_FASE, 'encerrado'].filter((f) => porFase[f] > 0);
    if (fases.length < 2) return '';
    return `<div class="pz-faixa">${pizza(fases.map((f) => ({ nome: f === 'encerrado' ? 'Lote encerrado' : ROTULO_TIPO[f] || f, valor: porFase[f], cor: f === 'encerrado' ? '#b9c4bf' : COR_FASE[f], txt: `${sacos(porFase[f])} ${sacos(porFase[f]) === '1' ? 'saco' : 'sacos'}` })), { centro: sacos(Object.values(porFase).reduce((a, b) => a + b, 0)), sub: 'sacos', rotulo: 'Ração por fase' })}</div>`;
  }
  function pintar() {
    el.querySelectorAll('[data-per]').forEach((b) => b.classList.toggle('on', b.dataset.per === per));
    r = calcular();
    const marcado = (t) => !desmarcados.has(t.id);
    const maxKg = Math.max(1, ...r.todos.map((t) => t.kg || 0));
    const ranque = r.todos.map((t) => `
      <li class="racao-item${marcado(t) ? '' : ' fora'}"><label class="marca no-print" title="Incluir no relatório"><input type="checkbox" data-marca="${esc(t.id)}"${marcado(t) ? ' checked' : ''}><span></span></label><span class="esq"><b>${esc(t.nome)}</b>${t.kg > 0 || t.lote ? `<small>${[t.kg > 0 ? `${kgTxt(t.kg)} kg` : '', t.lote, t.pesoVivoPct != null && t.kg > 0 ? `${fmtNum(t.pesoVivoPct, 1)}% do peso vivo` : ''].filter(Boolean).map(esc).join(' · ')}</small>` : ''}${t.kg > 0 ? progresso((t.kg / maxKg) * 100, { fina: true, rotulo: `${t.nome}: ${kgTxt(t.kg)} kg` }) : ''}</span>
      ${t.kg > 0 ? `<b class="valor">${sacos(t.kg)} <small>sacos</small></b>` : `<span class="tag ${t.ativo ? 'aviso' : ''}">${t.ativo ? 'sem lançamento' : '–'}</span>`}</li>`).join('');
    const grafico = r.um || !r.lista.length ? '' : svgDias(r.linhasDia);
    const detalhe = r.um || !r.lista.length ? '' : `
      <h2>Dia a dia</h2>
      <div class="card">${grafico}</div>
      <details class="so-cel lista-recolhe"><summary><span class="vd-ic">${icone('relatorio', 20)}</span><span class="vd-t"><b>Ver dia a dia</b><small>Toque para abrir os ${r.linhasDia.length} dias</small></span><span class="vd-seta">${icone('direita', 20)}</span></summary>
      <div class="card dias-lista">${r.linhasDia.map((d) => d.kg > 0 ? `
        <details class="dia-det"><summary><span>${diaCurto(d.data)}</span><b>${sacos(d.kg)} <small>sacos</small></b></summary>
          <ul>${r.lista.filter((t) => d.por[t.nome] != null).map((t) => `<li><span>${esc(t.nome)}</span><b>${kgTxt(d.por[t.nome])} kg</b></li>`).join('')}</ul></details>` : `
        <div class="dia-det vazio"><span>${diaCurto(d.data)}</span><small>nada lançado</small></div>`).join('')}</div></details>
      <div class="card tabela matriz rolagem so-pc"><table>
        <thead><tr><th>Dia</th>${r.lista.map((t) => `<th class="n">${esc(t.nome)}</th>`).join('')}<th class="n total">Total</th></tr></thead>
        <tbody>${r.linhasDia.map((d) => `<tr><td>${diaCurto(d.data)}</td>${r.lista.map((t) => `<td class="n">${kg(d.por[t.nome])}</td>`).join('')}<td class="n total"><b>${d.kg ? kgTxt(d.kg) : '–'}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td>${r.lista.map((t) => `<td class="n">${fmtNum(t.kg, 0)}</td>`).join('')}<td class="n total">${fmtNum(r.total, 0)} kg</td></tr></tfoot>
      </table></div>
      <p class="mudo nota so-pc">Valores em kg. “–” significa que nada foi lançado naquele dia.</p>
      <p class="mudo nota so-cel">Toque num dia para ver a ração de cada tanque. A tabela completa vai no PDF.</p>`;
    const quem = r.individual ? r.lista[0].nome : r.parcial ? `${r.lista.length} de ${r.todos.length} tanques` : r.todos.length > 1 ? 'todos os tanques' : '';
    el.querySelector('#resumo').innerHTML = !r.todos.length ? '' : `<div class="racao-total"><small>${esc(r.periodo)}${quem ? ` · ${esc(quem)}` : ''}</small><b>${sacos(r.total)} sacos</b><span>${kgTxt(r.total)} kg no total</span>${pizzaFase(r.lista)}${(() => { const at = r.todos.filter((t) => t.ativo), com = at.filter((t) => t.kg > 0).length; return at.length > 1 ? `<div class="hero-prog">${progresso((com / at.length) * 100, { tom: com === at.length ? 'ok' : '', rotulo: `${com} de ${at.length} tanques com ração lançada` })}<p class="h-trilho-leg"><span>${fmtInt(com)} de ${fmtInt(at.length)} tanques com ração lançada</span></p></div>` : ''; })()}</div>`;
    el.querySelector('#acoes-racao').hidden = !r.todos.length;
    const bpdf = el.querySelector('#b-pdf-racao'); bpdf.disabled = !r.lista.length;
    el.querySelector('#b-csv').disabled = !r.lista.length;
    const todosMarcados = r.lista.length === r.todos.length;
    el.querySelector('#corpo').innerHTML = !r.todos.length ? '<div class="card vazio">Nenhum tanque com lote ativo ou ração neste período.</div>' : `
      <div class="racao-cab"><h2>Por tanque</h2>${r.todos.length > 1 ? `<label class="marca-todos no-print"><input type="checkbox" id="marca-todos"${todosMarcados ? ' checked' : ''}> Marcar todos</label>` : ''}</div>
      <div class="card"><ul class="lista racao-lista com-marca">${ranque}</ul></div>
      <p class="mudo nota no-print">${!r.lista.length ? 'Marque pelo menos um tanque para gerar o relatório.' : r.individual ? `Relatório só do <b>${esc(r.lista[0].nome)}</b>.` : r.parcial ? `Relatório com ${r.lista.length} de ${r.todos.length} tanques marcados.` : 'Desmarque os tanques que não quer no relatório. Deixe só um marcado para o relatório individual.'}</p>${r.lista.length ? detalhe : ''}`;
    el.querySelectorAll('[data-marca]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) desmarcados.delete(c.dataset.marca); else desmarcados.add(c.dataset.marca);
      pintar();
    }));
    const mt = el.querySelector('#marca-todos');
    if (mt) {
      mt.indeterminate = !todosMarcados && r.lista.length > 0;
      mt.addEventListener('change', () => { desmarcados.clear(); if (!mt.checked) r.todos.forEach((t) => desmarcados.add(t.id)); pintar(); });
    }
  }
  el.querySelectorAll('[data-per]').forEach((b) => b.addEventListener('click', () => { per = b.dataset.per; pintar(); }));
  el.querySelector('#outro').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    outro = e.target.value > hoje ? hoje : e.target.value; per = 'dia';
    // dia antes dos 60 já carregados (e o dia anterior, para comparar): busca de novo, senão mostrava zero
    const precisa = somaDias(outro, -1);
    if (precisa < desde) {
      try { linhas = await ctx.api.racaoPeriodo(precisa); desde = precisa; } catch (x) { ctx.toast('Não foi possível buscar esse dia agora', 'erro'); }
    }
    pintar();
  });
  const nomeRacao = (ext) => nomeArquivo(['Ração fornecida', fazenda, r.individual ? r.lista[0].nome : r.parcial ? `${r.lista.length} tanques` : '', r.um ? dataArquivo(r.fim) : `${dataArquivo(r.ini)} a ${dataArquivo(r.fim)}`], ext);
  pintar();

  const bp = el.querySelector('#b-pdf-racao');
  bp.addEventListener('click', async () => {
    const t0 = bp.textContent; bp.disabled = true; bp.textContent = 'Montando o relatório…';
    try {
      const [jsPDF, fontes] = await Promise.all([carregarGerador(), carregarFontes()]);
      const agora = new Date();
      const doc = gerarPdfRacao(jsPDF, { logo: ctx.state.ref.logo || null, fazenda, geradoEm: hoje, geradoHora: `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`, geradoPor: ctx.state.perfil.nome, kgSaco: kgS, fontes, titulo: r.titulo, periodo: r.periodoPdf, dias: r.dias.length, individual: r.individual, tanques: r.lista, linhasDia: r.linhasDia, colunas: r.colunas, anterior: r.anterior });
      bp.disabled = false; bp.textContent = t0;
      await abrirVisualizador({ blob: doc.output('blob'), nome: nomeRacao('pdf'), titulo: `Ração fornecida · ${r.individual ? r.lista[0].nome + ' · ' : ''}${r.periodo}`, toast: ctx.toast });
    } catch (e) { ctx.toast(e.message || 'Não foi possível gerar o PDF', 'erro'); bp.disabled = false; bp.textContent = t0; }
  });
  el.querySelector('#b-csv').addEventListener('click', () => {
    const L = [[`Ração fornecida (kg)${r.individual ? ' · ' + r.lista[0].nome : ''}`], [r.periodo], [], ['Dia', ...r.colunas, 'Total']];
    const c2 = (v) => csvNum(Math.round(Number(v) * 100) / 100).replace(/,00$/, ''); // 57,9 e não 57,900000000000006
    r.linhasDia.forEach((d) => L.push([fmtData(d.data), ...r.lista.map((t) => (d.por[t.nome] == null ? '' : c2(d.por[t.nome]))), c2(d.kg)]));
    L.push(['Total', ...r.lista.map((t) => c2(t.kg)), c2(r.total)]);
    baixarCsv(nomeRacao('csv'), '\ufeff' + L.map((l) => l.map(celulaCsv).join(';')).join('\r\n'));
  });
}

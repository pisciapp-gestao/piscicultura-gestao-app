import { esc, fmtInt, fmtNum, fmtData, hojeISO, diasEntre, num, ROTULO_TIPO, ROTULO_PAPEL, progresso, fmtPct } from '../util.js';
import * as db from '../db.js';
import { situacaoEstoque, previsaoDespesca, alertasManejo, vivosDoLote } from '../calc.js';
import { ESTOQUE_ATENCAO_DIAS, ESTOQUE_CRITICO_DIAS, ESTOQUE_COBERTURA_DIAS, CONTAGEM_LEMBRETE_DIAS, PLANO_AVISO_DIAS, ALERTAS } from '../config.js';
import { icone } from '../icons.js';
import { pedirTexto } from '../dialogo.js';
import { pizza, COR_FASE, ORDEM_FASE, COR_RACAO } from '../graficos.js';
import { metaDe, htmlPrevisao } from './despesca.js';
import { pintarTempo } from './tempo.js';
import { dadosDoDia, situacaoTanque, formatosSaco, ordemNatural, statusTanque } from './dia.js';
import { renderRonda } from './ronda.js';
import { avisoPedidos } from './pedidos.js';
export { renderTanqueDetalhe } from './tanque-detalhe.js';
export { ordemNatural, statusTanque };

// chips do que falta num tanque (Hoje e tela do tanque)
export const htmlChips = (itens) => itens.map((c) => `<span class="sit${c.tom ? ` ${c.tom}` : ''}">${esc(c.txt)}</span>`).join('');

// Cria um tanque direto da tela inicial (dono/gerente). O limite do pacote é imposto no banco.
async function novoTanque(ctx, el) {
  if (!navigator.onLine) return ctx.toast('Sem internet: cadastrar tanque precisa de conexão.', 'erro');
  const nomes = ctx.state.ref.tanques.map((t) => t.nome.toLowerCase());
  const nome = await pedirTexto({
    titulo: 'Novo tanque', rotulo: 'Nome do tanque', placeholder: 'Ex.: Tanque 3', ok: 'Criar tanque',
    validar: (v) => (nomes.includes(v.toLowerCase()) ? 'Já existe um tanque com esse nome.' : ''),
  });
  if (!nome) return;
  try {
    await ctx.api.criarTanque(ctx.state.perfil.fazenda_id, nome);
    await ctx.atualizarRef();
    ctx.toast(`${/^(tanque|viveiro)\b/i.test(nome) ? nome : `Tanque ${nome}`} criado`, 'ok');
    renderHome(ctx, el);
  } catch (e) { ctx.toast(e.message || 'Não foi possível criar o tanque', 'erro'); }
}

export async function renderHome(ctx, el) {
  const { state } = ctx;
  const primeiro = (state.perfil.nome || '').split(' ')[0];
  const { tanques, lotes } = state.ref;

  if (!tanques.length) {
    el.innerHTML = `<h1>Olá, ${esc(primeiro)}</h1>` + (state.perfil.papel === 'dono'
      ? `<div class="card vazio"><p>Nenhum tanque cadastrado ainda.</p><button class="btn primario" id="b-novo-tanque" type="button">Cadastrar o primeiro tanque</button></div>`
      : `<div class="card vazio"><p>Nenhum tanque liberado para você ainda.<br>Peça ao ${state.perfil.papel === 'gerente' ? 'dono' : 'dono ou ao gerente'} para liberar os seus tanques em Fazenda › Equipe.</p></div>`);
    const b0 = el.querySelector('#b-novo-tanque'); if (b0) b0.addEventListener('click', () => novoTanque(ctx, el));
    return;
  }

  // funcionário: a Hoje dele é a ronda (uma linha por tanque liberado, o que falta e as ações)
  if (!ctx.podeGerir()) return renderRonda(ctx, el, { inicio: true });

  el.innerHTML = `<div class="h-titulo"><h1>Hoje</h1></div><p class="carregando">Carregando tanques…</p>`;
  const D = await dadosDoDia(ctx, { mortes: true });
  const { hoje, resumo, semDetalhe, numerosGuardados, saldos, racao, mortes, porTanque, porDia, dias14 } = D;
  const agua = D.agua || [];
  // a ração de alevino só aparece na Início quando a fazenda usa (tem saldo, compra ou consumo)
  const usadas = saldos ? saldos.linhas.filter((s, i) => i === 0 || ['total_comprado_kg', 'total_consumido_kg', 'saldo_kg'].some((k) => Number(s[k]))) : [];
  // lembrete de contagem: a ração em uso há mais tempo sem contar
  const paraContar = usadas.filter((s) => Number(s.consumo_7d_kg) > 0).sort((a, b) => String(a.ultima_contagem || '').localeCompare(String(b.ultima_contagem || '')))[0] || usadas[0] || null;

  const metas = (await db.kvGet('metasDespesca')) || {};
  const F = formatosSaco(state.ref.kgSaco);
  const { kgS, sacos, nSacos } = F;

  const hojePorTipo = {};
  for (const t of tanques) {
    const kg = (porTanque[t.id] || {}).hojeKg || 0; if (!kg) continue;
    const l = lotes.find((x) => x.tanque_id === t.id);
    const tipoR = l && ['alevinagem', 'bercario'].includes(l.tipo) ? 'alevino' : 'engorda';
    hojePorTipo[tipoR] = (hojePorTipo[tipoR] || 0) + kg;
  }
  // consumo da semana; sem histórico (fazenda nova), usa o ritmo de hoje: 82 sacos ÷ 18 por dia = ~4 dias
  const consumo7d = (s) => (Number(s.consumo_7d_kg) > 0 ? Number(s.consumo_7d_kg) : (hojePorTipo[s.tipo_racao || 'engorda'] || 0) * 7);
  const peloDeHoje = (s) => !(Number(s.consumo_7d_kg) > 0) && (hojePorTipo[s.tipo_racao || 'engorda'] || 0) > 0;
  const mediaKg = D.mediaKg;
  const status = D.status;
  const grupo = (k) => tanques.filter((t) => status[t.id] === k).sort(ordemNatural);
  const faltam = grupo('falta'), feitos = grupo('ok'), vazios = grupo('semlote');
  const comLote = faltam.length + feitos.length;
  const achado = !comLote ? 'Nenhum tanque com lote ativo.'
    : faltam.length ? `<b>${fmtInt(faltam.length)} ${faltam.length === 1 ? 'tanque' : 'tanques'}</b> ainda sem ração`
    : '<b>Todos os tanques</b> já comeram hoje';
  const dataLonga = new Date(`${hoje}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  el.innerHTML = `
    <div class="h-titulo">
      <div><h1>Hoje</h1>
        <p class="h-achado">${esc(dataLonga.charAt(0).toUpperCase() + dataLonga.slice(1))} · ${achado}</p></div>
    </div>
    <div id="avisos">${avisoContagem(ctx, paraContar, hoje)}</div>
    ${semDetalhe ? '<p class="aviso">Sem conexão: mostrando só o que está guardado no aparelho. Os totais aparecem quando houver internet.</p>' : numerosGuardados ? '<p class="aviso">Sem conexão: números da última atualização, sem os lançamentos ainda não enviados.</p>' : ''}
    ${seguro(blocoAlertas, 'Atenção')}
    ${comLote ? `<a class="btn primario grande h-ronda" id="b-ronda" href="#/ronda">${icone('racao', 22)}<span>Fazer a ronda de hoje</span></a>` : ''}
    ${comLote ? seguro(numeros, 'Números') : ''}
    ${seguro(blocoTanques, 'Tanques')}
    <div class="h-grade">
      <div class="h-col">
        ${seguro(blocoDespescas, 'Despescas e mudanças de fase')}
        ${lotes.length ? seguro(blocoMortes, 'Mortalidade') : ''}
      </div>
      <div class="h-col">
        <section class="h-bloco" aria-labelledby="h-tempo" id="b-tempo"><header><h2 id="h-tempo">Tempo na fazenda</h2></header><p class="h-calmo">Carregando a previsão…</p></section>
        ${seguro(blocoEstoque, 'Estoque de ração')}
        ${seguro(blocoPeixe, 'Peixe na água')}
      </div>
    </div>`;
  avisoPlano(ctx, el.querySelector('#avisos'));
  avisoPedidos(ctx, el.querySelector('#avisos'));
  avisoConviteUsado(ctx, el.querySelector('#avisos'));
  pintarTempo(el.querySelector('#b-tempo'), ctx, hoje);

  // alertas de manejo: biometria vencida, ração fora da média, mortes repetidas (dono/gerente)
  function blocoAlertas() {
    if (semDetalhe) return '';
    const racaoHoje = {}, mediaSemana = {};
    for (const t of tanques) {
      const kg = (porTanque[t.id] || {}).hojeKg; if (kg) racaoHoje[t.id] = kg;
      const m = mediaKg(t.id); if (m) mediaSemana[t.id] = m;
    }
    const als = alertasManejo({ lotes, resumo, racaoHoje, mediaSemana, mortes: mortes || [], hoje, cfg: ALERTAS, agua });
    if (!als.length) return '';
    const nomeT = (id) => (tanques.find((t) => t.id === id) || {}).nome || 'Tanque';
    const lista = (itens, f) => { const n = itens.slice(0, 3).map(f).join(', '); return itens.length > 3 ? `${n} e mais ${itens.length - 3}` : n; };
    const linhas = als.map((a) => {
      if (a.tipo === 'agua') {
        const p = a.itens[0];
        return `<li class="al-morte"><div><b>Água fora da faixa ${a.itens.length === 1 ? `no ${esc(nomeT(p.tanque))}` : `em ${fmtInt(a.itens.length)} tanques`}</b>
          <span>${esc(lista(a.itens, (x) => `${nomeT(x.tanque)}: ${x.problemas.join(', ')}`))}. Confira a medição e os aeradores.</span></div>
          <a class="btn mini" href="#/lancar?tipo=agua&tanque=${esc(p.tanque)}">Medir de novo</a></li>`;
      }
      if (a.tipo === 'biometria') {
        const p = a.itens[0];
        return `<li class="al-bio"><div><b>${a.itens.length === 1 ? 'Biometria atrasada' : `${fmtInt(a.itens.length)} tanques sem biometria recente`}</b>
          <span>${esc(lista(a.itens, (x) => `${nomeT(x.tanque)} (${fmtInt(x.dias)} dias)`))}. Sem pesagem, peso, biomassa e previsão de despesca ficam desatualizados.</span></div>
          <a class="btn mini" href="#/lancar?tipo=biometria&tanque=${esc(p.tanque)}">Pesar ${esc(nomeT(p.tanque))}</a></li>`;
      }
      if (a.tipo === 'racao') {
        return `<li class="al-racao"><div><b>Ração fora da média hoje</b>
          <span>${esc(lista(a.itens, (x) => `${nomeT(x.tanque)}: ${fmtNum(x.kg, 0)} kg, ${x.desvio > 0 ? '+' : '−'}${fmtInt(Math.abs(x.desvio) * 100)}% da média`))}. Confira se o lançamento está certo ou se o peixe mudou de apetite.</span></div>
          <a class="btn mini" href="#/relatorio/racao">Ver ração</a></li>`;
      }
      const p = a.itens[0];
      return `<li class="al-morte"><div><b>Mortes ${a.itens.length === 1 ? `no ${esc(nomeT(p.tanque))}` : 'repetidas'} há ${fmtInt(p.dias)} dias seguidos</b>
        <span>${esc(lista(a.itens, (x) => `${nomeT(x.tanque)}: ${fmtInt(x.total)} peixes em ${fmtInt(x.dias)} dias`))}. Verifique oxigênio, sobra de ração e sinais de doença.</span></div>
        <a class="btn mini" href="#/t/${esc(p.tanque)}">Abrir tanque</a></li>`;
    }).join('');
    return `<section class="h-alertas" aria-labelledby="h-at"><h2 id="h-at">Atenção</h2><ul>${linhas}</ul></section>`;
  }

  // os números do dia: peixe na água, quanto vale (só o dono vê R$), quanto dura a ração e mortes da semana
  function numeros() {
    const ns = [];
    if (!semDetalhe) {
      let peixes = 0, kg = 0;
      for (const l of lotes) {
        const r = resumo[l.id];
        const v = vivosDoLote(l, r);
        const pm = r && r.ultimo_peso_medio_kg != null ? Number(r.ultimo_peso_medio_kg) : Number(l.peso_inicial_kg) / Math.max(1, Number(l.quantidade_inicial));
        peixes += v; kg += v * (pm || 0);
      }
      ns.push(`<div class="num"><span>Peixe na água</span><b>${kg >= 1000 ? fmtNum(kg / 1000, 1) : fmtNum(kg, 0)}<small> ${kg >= 1000 ? 't' : 'kg'}</small></b><small>${fmtInt(peixes)} peixes vivos</small></div>`);
      if (state.perfil.papel === 'dono' && state.ref.precoKg) ns.push(`<div class="num"><span>Vale hoje</span><b>${esc(valorCurto(kg * state.ref.precoKg))}</b><small>a R$ ${fmtNum(state.ref.precoKg, 2)}/kg</small></div>`);
    }
    if (usadas.length) {
      const algumNeg = usadas.some((x) => Number(x.saldo_kg) < 0);
      const sit = situacaoEstoque(Number(usadas[0].saldo_kg) || 0, consumo7d(usadas[0]), ESTOQUE_ATENCAO_DIAS, ESTOQUE_CRITICO_DIAS);
      const tom = { atencao: 'alerta', critico: 'erro', negativo: 'erro' }[sit.nivel] || '';
      ns.push(`<a class="num${tom ? ` ${tom}` : ''}" href="#/estoque"><span>Ração dura</span>${algumNeg ? '<b>0<small> dias</small></b><small>falta registrar compra</small>' : sit.dias != null ? `<b>${fmtInt(Math.floor(sit.dias))}<small> ${Math.floor(sit.dias) === 1 ? 'dia' : 'dias'}</small></b><small>${usadas.length > 1 ? 'engorda' : 'no galpão'}${peloDeHoje(usadas[0]) ? ', ritmo de hoje' : ''}</small>` : '<b>—</b><small>sem consumo</small>'}</a>`);
    }
    if (mortes) {
      const ativos = new Set(lotes.map((l) => l.id));
      const tot = mortes.filter((m) => ativos.has(m.lote_id)).reduce((a, m) => a + (Number(m.quantidade) || 0), 0);
      ns.push(`<div class="num"><span>Mortes 7 dias</span><b>${fmtInt(tot)}</b><small>${tot === 1 ? 'peixe' : 'peixes'}</small></div>`);
    }
    return ns.length ? `<div class="numeros n${ns.length}">${ns.join('')}</div>` : '';
  }

  // uma linha por tanque com o que falta hoje; tocar abre o tanque (botões grandes de lançar)
  function blocoTanques() {
    const linha = (t) => {
      const sit = situacaoTanque(D, t, F);
      return `<a class="card tq ${status[t.id]}" href="#/t/${esc(t.id)}"><span class="tq-cab"><b>${esc(t.nome)}</b><small>${esc(D.fase(t.id))}</small><span class="seta">${icone('direita', 18)}</span></span>
        <span class="sits">${htmlChips(sit.itens)}</span></a>`;
    };
    return `<section class="h-tanques" aria-labelledby="h-tq">
      <header><h2 id="h-tq">O que falta em cada tanque</h2><span class="h-meta">toque para abrir</span></header>
      <div class="hoje-tanques">${[...faltam, ...feitos, ...vazios].map(linha).join('')}</div>
    </section>`;
  }

  // um bloco com erro não derruba a tela: mostra um aviso pequeno no lugar dele e o resto aparece
  function seguro(fn, nome) {
    try { return fn(); } catch (e) {
      console.error(`Início: erro no bloco "${nome}"`, e);
      return `<section class="h-bloco"><p class="aviso pequeno">Não foi possível mostrar "${esc(nome)}" agora (${esc((e && e.message) || 'erro')}). O resto da tela segue normal.</p></section>`;
    }
  }

  function blocoDespescas() {
    if (semDetalhe || !lotes.length) return '';
    const nomeT = (id) => (tanques.find((t) => t.id === id) || {}).nome || 'Tanque';
    const ps = lotes.map((l) => ({ l, p: previsaoDespesca(l, resumo[l.id], metaDe(l, metas), hoje) }));
    const ordem = { pronto: 0, previsto: 1, 'sem-dado': 2 };
    const comData = ps.filter((x) => x.p.estado !== 'sem-dado').sort((a, b) => ordem[a.p.estado] - ordem[b.p.estado] || String(a.p.data).localeCompare(String(b.p.data)));
    const sem = ps.length - comData.length;
    return `<section class="h-bloco" aria-labelledby="h-desp">
      <header><h2 id="h-desp">Despescas e mudanças de fase</h2><span class="h-meta">pelo crescimento</span></header>
      ${comData.length ? `<ul class="h-desp">${comData.slice(0, 6).map(({ l, p }) => `<li><a href="#/t/${esc(l.tanque_id)}"><b>${esc(nomeT(l.tanque_id))}</b><span>${esc(ROTULO_TIPO[l.tipo] || l.tipo)}</span></a>${htmlPrevisao(p, l.tipo)}</li>`).join('')}</ul>` : ''}
      ${sem ? `<p class="h-calmo">${comData.length ? `Mais ${fmtInt(sem)}` : fmtInt(sem)} ${sem === 1 ? 'lote' : 'lotes'} ainda sem crescimento medido: a previsão aparece com uma pesagem feita alguns dias depois da entrada.</p>` : ''}
    </section>`;
  }


  function blocoPeixe() {
    let peixes = 0, kg = 0; const porT = {}, porFase = {};
    for (const l of lotes) {
      const r = resumo[l.id];
      const vivos = vivosDoLote(l, r);
      const pm = r && r.ultimo_peso_medio_kg != null ? Number(r.ultimo_peso_medio_kg) : Number(l.peso_inicial_kg) / Math.max(1, Number(l.quantidade_inicial));
      const b = vivos * (pm || 0);
      peixes += vivos; kg += b; porT[l.tanque_id] = (porT[l.tanque_id] || 0) + b;
      porFase[l.tipo] = (porFase[l.tipo] || 0) + b;
    }
    if (!lotes.length || semDetalhe) return '';
    const preco = state.ref.precoKg;
    const top = tanques.filter((t) => porT[t.id] > 0).sort((a, b) => porT[b.id] - porT[a.id]).slice(0, 4);
    const t = kg >= 1000;
    return `<section class="h-bloco" aria-labelledby="h-peixe">
      <header><h2 id="h-peixe">Peixe na água por fase</h2><span class="h-meta">${fmtInt(comLote)} ${comLote === 1 ? 'tanque' : 'tanques'} com lote</span></header>
      <dl class="h-pares">
        ${state.perfil.papel === 'dono' ? (preco
          ? `<div><dt>Valor estimado</dt><dd>${esc(valorCurto(kg * preco))}</dd></div><div><dt>Preço usado</dt><dd>R$ ${fmtNum(preco, 2)}/kg</dd></div>`
          : '<div><dt>Valor estimado</dt><dd><a href="#/mais">Informar preço do kg</a></dd></div>') : ''}
      </dl>
      ${Object.keys(porFase).filter((f) => porFase[f] > 0).length > 1 ? pizza(ORDEM_FASE.filter((f) => porFase[f] > 0).map((f) => ({ nome: ROTULO_TIPO[f] || f, valor: porFase[f], cor: COR_FASE[f], txt: t ? fmtNum(porFase[f] / 1000, 1) + ' t' : fmtNum(porFase[f], 0) + ' kg' })), { centro: t ? fmtNum(kg / 1000, 1) + ' t' : fmtNum(kg, 0) + ' kg', sub: 'por fase', rotulo: 'Peixe na água por fase' }) : ''}
      ${top.length > 1 ? `<ul class="h-barras">${top.map((x) => `<li><span>${esc(x.nome)}</span><b>${t ? fmtNum(porT[x.id] / 1000, 1) + ' t' : fmtNum(porT[x.id], 0) + ' kg'}</b><i style="width:${((porT[x.id] / porT[top[0].id]) * 100).toFixed(1)}%"></i></li>`).join('')}</ul>` : ''}
    </section>`;
  }

  function linhaEstoque(s, titulo) {
    const saldo = Number(s.saldo_kg) || 0;
    const sit = situacaoEstoque(saldo, consumo7d(s), ESTOQUE_ATENCAO_DIAS, ESTOQUE_CRITICO_DIAS);
    let nota = '';
    if (sit.nivel === 'negativo') nota = '<p class="h-alerta">Foi lançada mais ração do que a registrada no estoque. <a href="#/estoque">Registre a compra que faltou</a> ou conte o galpão.</p>';
    else if (sit.dias != null) {
      const fim = new Date(`${hoje}T12:00:00`); fim.setDate(fim.getDate() + Math.floor(sit.dias));
      const quando = fim.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
      const txt = `No ritmo de ${esc(nSacos(sacos(sit.porDia)))} por dia, acaba em <b>${esc(quando)}</b>.`;
      nota = sit.nivel === 'ok' ? `<p class="h-nota">${txt}</p>` : `<p class="${sit.nivel === 'critico' ? 'h-alerta' : 'aviso'}">${sit.nivel === 'critico' ? 'Está acabando: compre ração já.' : 'Hora de planejar a compra.'} Gasta ~${esc(nSacos(sacos(sit.porDia)))} por dia.</p>`;
    } else nota = '<p class="h-nota">Ainda sem ração lançada para estimar a duração.</p>';
    const tomEst = { atencao: 'alerta', critico: 'erro', negativo: 'erro' }[sit.nivel] || '';
    const quando = sit.dias != null ? (() => { const f = new Date(`${hoje}T12:00:00`); f.setDate(f.getDate() + Math.floor(sit.dias)); return f.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', ''); })() : '';
    return `<div class="h-est-linha">
      <div class="h-est-cab"><span>${esc(titulo || 'Ração')}</span><b>${fmtNum(Math.max(0, sacos(saldo)), 0)} <small>${Math.round(Math.max(0, sacos(saldo))) === 1 ? 'saco' : 'sacos'}</small></b></div>
      ${sit.dias != null || sit.nivel === 'negativo' ? progresso(((sit.dias || 0) / ESTOQUE_COBERTURA_DIAS) * 100, { fina: true, tom: tomEst, rotulo: `Estoque para ${fmtInt(Math.floor(sit.dias || 0))} de ${ESTOQUE_COBERTURA_DIAS} dias` }) : ''}
      <small class="h-est-sub">${sit.nivel === 'negativo' ? `faltou registrar a compra de ${esc(nSacos(Math.abs(sacos(saldo))))}` : sit.dias != null ? `dura ${fmtInt(Math.floor(sit.dias))} ${Math.floor(sit.dias) === 1 ? 'dia' : 'dias'}${peloDeHoje(s) ? ' no ritmo de hoje' : ''} · acaba por volta de ${esc(quando)}` : 'sem consumo para estimar'}</small>
      ${sit.nivel === 'critico' || sit.nivel === 'atencao' || sit.nivel === 'negativo' ? nota : ''}</div>`;
  }

  function blocoEstoque() {
    if (!usadas.length) return '';
    const duas = saldos.porTipo && usadas.length > 1;
    const temDias = racao && dias14.some((d) => porDia[d] > 0);
    return `<section class="h-bloco" aria-labelledby="h-est">
      <header><h2 id="h-est"><a href="#/estoque" style="color:inherit;text-decoration:none">Estoque de ração</a></h2><span class="h-meta">no galpão</span></header>
      ${duas ? pizza(usadas.map((s) => ({ nome: s.tipo_racao === 'alevino' ? 'Alevino' : 'Engorda', valor: Math.max(0, sacos(Number(s.saldo_kg) || 0)), cor: COR_RACAO[s.tipo_racao === 'alevino' ? 'alevino' : 'engorda'], txt: nSacos(Math.max(0, sacos(Number(s.saldo_kg) || 0))) })), { centro: fmtNum(usadas.reduce((a, s) => a + Math.max(0, sacos(Number(s.saldo_kg) || 0)), 0), 0), sub: 'sacos', rotulo: 'Estoque de ração por tipo' }) : ''}
      ${usadas.map((s) => linhaEstoque(s, duas ? (s.tipo_racao === 'alevino' ? 'Alevino' : 'Engorda') : 'Ração')).join('')}
      ${temDias ? `<div class="h-graf">${barras14()}</div><p class="h-graf-leg">Sacos dados por dia nos últimos 14 dias${duas ? ', somando as duas rações' : ''}. Hoje, em verde, ainda em andamento.</p>` : ''}
    </section>`;
  }

  function barras14() {
    const vals = dias14.map((d) => sacos(porDia[d]));
    const W = 320, H = 120, pl = 22, pr = 2, pt = 6, pb = 18;
    const passo = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((p) => Math.max(...vals) / p <= 3) || 1000;
    const topo = Math.max(passo, Math.ceil(Math.max(...vals) / passo) * passo + (Math.max(...vals) % passo === 0 ? passo : 0));
    const y = (v) => pt + (H - pt - pb) * (1 - v / topo);
    const larg = (W - pl - pr) / vals.length;
    const grade = []; for (let v = 0; v <= topo; v += passo) grade.push(`<line class="grade-y" x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${pl - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${fmtInt(v)}</text>`);
    const bs = vals.map((v, i) => {
      const x = pl + i * larg + larg * 0.16, w = larg * 0.68, h = (H - pt - pb) * (v / topo);
      const [, m, d] = dias14[i].split('-');
      const rot = i === 0 || i === 7 || i === 13 ? `<text x="${(i === 0 ? x : i === 13 ? x + w : x + w / 2).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === 13 ? 'end' : 'middle'}">${d}/${m}</text>` : '';
      return `<rect class="barra ${i === 13 ? 'hoje' : 'cinza'}" x="${x.toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, v > 0 ? 1.5 : 0).toFixed(1)}" rx="1.5"><title>${d}/${m}: ${fmtNum(v, 1)} sacos</title></rect>${rot}`;
    }).join('');
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sacos de ração dados por dia nos últimos 14 dias">${grade.join('')}${bs}</svg>`;
  }

  function blocoMortes() {
    if (!mortes) return '';
    const loteTanque = Object.fromEntries(lotes.map((l) => [l.id, l.tanque_id]));
    const porT = {}, causas = {};
    let total = 0;
    for (const m of mortes) {
      const tq = loteTanque[m.lote_id]; if (!tq) continue; // lote encerrado: fora do resumo dos tanques ativos
      const q = Number(m.quantidade) || 0;
      total += q; porT[tq] = (porT[tq] || 0) + q;
      if (m.causa) (causas[tq] ||= {})[m.causa] = ((causas[tq] || {})[m.causa] || 0) + q;
    }
    let vivos = 0;
    for (const l of lotes) vivos += vivosDoLote(l, resumo[l.id]);
    const ids = Object.keys(porT).sort((a, b) => porT[b] - porT[a]);
    const pior = ids[0];
    const outros = Math.max(1, comLote - 1);
    const mediaOutros = pior ? (total - porT[pior]) / outros : 0;
    const fora = pior && porT[pior] >= 10 && porT[pior] >= 3 * Math.max(mediaOutros, 1);
    const nomeT = (id) => (tanques.find((t) => t.id === id) || {}).nome || 'Tanque';
    const causaPior = pior && causas[pior] ? Object.entries(causas[pior]).sort((a, b) => b[1] - a[1])[0][0] : '';
    const pct = vivos + total > 0 ? (total / (vivos + total)) * 100 : 0;
    return `<section class="h-bloco" aria-labelledby="h-morte">
      <header><h2 id="h-morte">Mortalidade</h2><span class="h-meta">últimos 7 dias</span></header>
      <p class="h-lead"><span class="h-num">${fmtInt(total)}</span><span class="h-de">${total === 1 ? 'peixe' : 'peixes'}${total ? ` · ${fmtNum(pct, 2)}% do plantel` : ''}</span></p>
      ${fora
        ? `<p class="h-alerta"><b>${esc(nomeT(pior))}: ${fmtInt(porT[pior])} peixes</b>${causaPior ? ` (${esc(causaPior.toLowerCase())})` : ''}${mediaOutros >= 1 ? `, ${fmtNum(porT[pior] / mediaOutros, 0)}× a média dos outros tanques` : ', acima dos outros tanques'}.</p>`
        : `<p class="h-calmo">${total ? 'Nenhum tanque fora do normal.' : 'Nenhuma morte lançada na semana.'}</p>`}
    </section>`;
  }
}

// valor em reais, curto: R$ 1,06 mi · R$ 380 mil · R$ 12.400
function valorCurto(v) {
  if (v >= 1e6) return `R$ ${fmtNum(v / 1e6, 2)} mi`;
  if (v >= 1e5) return `R$ ${fmtNum(v / 1e3, 0)} mil`;
  return `R$ ${fmtNum(v, 0)}`;
}

// lembrete de contagem semanal (dono/gerente), só quando a ração está sendo usada
function avisoContagem(ctx, saldo, hoje) {
  if (!ctx.podeGerir() || !saldo || !(Number(saldo.consumo_7d_kg) > 0) || saldo.ultima_contagem === undefined) return '';
  const dias = saldo.ultima_contagem ? diasEntre(saldo.ultima_contagem, hoje) : null;
  if (dias != null && dias < CONTAGEM_LEMBRETE_DIAS) return '';
  return `<a class="aviso aviso-link" href="#/estoque" id="aviso-contagem">${dias == null ? 'O estoque de ração ainda não foi contado.' : `Faz ${fmtInt(dias)} dias sem contar o estoque de ração.`} Toque para contar: deixa o saldo confiável.</a>`;
}

// Quem entrou pelo link de convite (só o dono). Se o link foi repassado e entrou outra pessoa, o dono fica sabendo
// na hora e desativa em Equipe. Na primeira vez só marca a data (não avisa convites antigos).
async function avisoConviteUsado(ctx, caixa) {
  if (!caixa || ctx.state.perfil.papel !== 'dono' || !navigator.onLine) return;
  const meu = ctx.state.perfil.id;
  const visto = await db.kvGet('convitesVistos').catch(() => null);
  if (!visto || visto.id !== meu) { await db.kvSet('convitesVistos', { id: meu, em: new Date().toISOString() }).catch(() => {}); return; }
  let usados = [];
  try { usados = (await ctx.api.convitesUsadosDesde(visto.em)) || []; } catch { return; }
  usados = usados.filter((c) => c && c.usado_em && c.usado_em > visto.em);
  if (!usados.length) return;
  const nomes = await ctx.api.nomesUsuarios().catch(() => ({}));
  // a Início pode ter sido redesenhada enquanto buscava: usa a caixa de avisos que está na tela agora
  caixa = caixa.isConnected ? caixa : document.getElementById('avisos');
  if (!caixa || caixa.querySelector('#aviso-convite')) return;
  const quando = (iso) => { const d = new Date(iso); return `${fmtData(iso.slice(0, 10))} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const linhas = usados.map((c) => `<b>${esc(nomes[c.usado_por] || 'Uma pessoa')}</b> entrou como ${esc(ROTULO_PAPEL[c.papel] || c.papel)} pelo link de convite (${quando(c.usado_em)}).`).join('<br>');
  caixa.insertAdjacentHTML('afterbegin', `<div class="aviso" id="aviso-convite">${linhas} Não reconhece? <a href="#/equipe">Desative em Equipe</a>.
    <button class="btn mini" type="button" id="b-conheco">Conheço</button></div>`);
  caixa.querySelector('#b-conheco').addEventListener('click', async () => {
    await db.kvSet('convitesVistos', { id: meu, em: usados[0].usado_em }).catch(() => {});
    const a = caixa.querySelector('#aviso-convite'); if (a) a.remove();
  });
}

// aviso de teste/plano perto de vencer ou vencido (só o dono)
async function avisoPlano(ctx, caixa) {
  if (!caixa || ctx.state.perfil.papel !== 'dono' || !navigator.onLine) return;
  const p = await ctx.api.plano().catch(() => null);
  if (!p || !caixa.isConnected) return;
  const dias = p.valido_ate ? diasEntre(hojeISO(), p.valido_ate) : null;
  const quando = dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${fmtInt(dias)} dias (${fmtData(p.valido_ate)})`;
  const txt = p.estado === 'teste' && dias != null && dias <= PLANO_AVISO_DIAS ? `Seu teste grátis termina ${quando}. Escolha um pacote para continuar abrindo lotes.`
    : p.estado === 'ativo' && dias != null && dias <= PLANO_AVISO_DIAS ? `Seu plano vence ${quando}. Renove para continuar abrindo lotes.`
    : p.estado === 'carencia' ? `Seu plano venceu em ${fmtData(p.valido_ate)}. Renove logo: depois da carência, não dá para abrir lotes novos.`
    : p.estado === 'vencido' || p.estado === 'teste_acabou' ? 'Seu plano está vencido: não dá para abrir lotes novos. Os lançamentos continuam funcionando.'
    : '';
  if (txt) caixa.insertAdjacentHTML('afterbegin', `<a class="aviso aviso-link" href="#/plano" id="aviso-plano">${esc(txt)} <b>Ver plano</b></a>`);
}

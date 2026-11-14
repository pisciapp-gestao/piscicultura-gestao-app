// Tela de um tanque (todos os papéis): números de cada lote, sobrevivência, previsão de despesca e atalhos para lançar.
import { esc, fmtInt, fmtNum, fmtData, hojeISO, diasEntre, num, ROTULO_TIPO, FASES, faseCss, progresso, fmtPct } from '../util.js';
import * as db from '../db.js';
import { previsaoDespesca, vivosDoLote } from '../calc.js';
import { icone } from '../icons.js';
import { pedirTexto } from '../dialogo.js';
import { metaDe, htmlPrevisao, PROXIMA_FASE } from './despesca.js';
import { dadosDoDia, formatosSaco } from './dia.js';
import { acoesDoTanque } from './ronda.js';

export function htmlCardTanque(tanque, lotes, resumo, racaoHojeLocal, hoje, metas = {}, podeGerir = false, acoesHtml = '') {
  const nomeLote = (l) => `${ROTULO_TIPO[l.tipo] || l.tipo} · ${l.especie}`;
  const blocos = lotes.length
    ? lotes.map((l) => {
        const r = resumo[l.id];
        const dias = diasEntre(l.data_entrada, hoje);
        const vivos = r ? vivosDoLote(l, r) : null;
        // abaixo de 1 kg em gramas; acima, em kg como no resto do app (2,30 kg, não 2.300 g)
        const kg = r && r.ultimo_peso_medio_kg != null ? Number(r.ultimo_peso_medio_kg) : null;
        const pm = kg == null ? '—' : kg < 1 ? fmtNum(kg * 1000, 0) + '<em>g</em>' : fmtNum(kg, 2) + '<em>kg</em>';
        return `
        <section class="td-lote">
          ${lotes.length > 1 ? `<p class="lote-nome"><span class="fase ${faseCss(l.tipo)}"></span>${esc(nomeLote(l))}</p>` : ''}
          <div class="td-hero">
            <div><span>Peso médio atual</span><b>${pm}</b>${r && r.ultima_biometria ? `<small>em ${fmtData(r.ultima_biometria)}</small>` : '<small>sem biometria</small>'}</div>
            <div><span>Ração acumulada</span><b>${r ? fmtNum(r.racao_kg, 0) + '<em>kg</em>' : '—'}</b><small>desde a entrada</small></div>
          </div>
          <div class="td-stats">
            <div><span>Dias no tanque</span><b>${fmtInt(dias)}</b></div>
            <div><span>Peixes vivos (estim.)</span><b>${fmtInt(vivos ?? l.quantidade_inicial)}</b></div>
          </div>
          ${vivos != null && l.quantidade_inicial > 0 ? ((sv) => `<div class="td-sobre">${progresso((sv / l.quantidade_inicial) * 100, { tom: 'ok', rotulo: `Sobrevivência ${fmtPct((sv / l.quantidade_inicial) * 100)}%` })}<p class="h-trilho-leg"><span>Sobrevivência: ${fmtInt(sv)} de ${fmtInt(l.quantidade_inicial)} peixes${Number(r.despescados) ? ` (${fmtInt(r.despescados)} já despescados)` : ''}</span><b>${fmtPct((sv / l.quantidade_inicial) * 100)}%</b></p></div>`)(Math.max(0, l.quantidade_inicial - (Number(r.mortos) || 0))) : ''}
          ${r ? `<div class="td-prev"><div class="td-prev-cab"><span>${PROXIMA_FASE[l.tipo] ? 'Mudança de fase' : 'Despesca'}</span><button class="link" type="button" data-meta="${esc(l.id)}">Mudar meta</button></div>${htmlPrevisao(previsaoDespesca(l, r, metaDe(l, metas), hoje), l.tipo)}</div>` : ''}
        </section>`;
      }).join('')
    : podeGerir
      ? `<div class="card povoar">
          <p class="povoar-tit">Tanque vazio. Que fase vai entrar?</p>
          <div class="povoar-fases">${FASES.map(([v, r]) => `<a class="btn povoar-fase" href="#/tanque/${esc(tanque.id)}?fase=${v}"><span class="fase ${faseCss(v)}"></span>${r}</a>`).join('')}</div>
          <p class="mudo pequeno">Depois você informa a espécie, a quantidade e o peso de entrada.</p>
        </div>`
      : '<div class="card vazio"><p>Sem lote ativo neste tanque.</p><p class="mudo pequeno">Peça ao dono ou ao gerente para cadastrar o lote de peixes.</p></div>';

  const comLote = lotes.length > 0;
  const lancouHoje = lotes.some((l) => resumo[l.id] && resumo[l.id].ultima_racao === hoje) || racaoHojeLocal.has(tanque.id);
  const selo = !comLote ? '' : lancouHoje
    ? '<span class="tag ok"><i></i>Ração lançada hoje</span>'
    : '<span class="tag alerta"><i></i>Sem ração hoje</span>';
  const sub = lotes.length === 1 ? nomeLote(lotes[0]) : lotes.length > 1 ? `${lotes.length} lotes ativos` : 'Sem lote ativo';

  return `
  <section class="tanque-card tdet ${!comLote ? 'sem-lote' : lancouHoje ? 'ok' : 'falta'}">
    <header class="td-topo"><div><h1 class="td-nome">${esc(tanque.nome)}</h1><p class="td-sub">${esc(sub)}</p></div>${selo}</header>
    ${comLote ? acoesHtml : ''}
    ${blocos}
  </section>`;
}

// Tela de um tanque (todos os papéis): o que dar hoje, os botões grandes de lançar e os números do lote
export async function renderTanqueDetalhe(ctx, el, id) {
  const { state } = ctx;
  const tanque = state.ref.tanques.find((t) => t.id === id);
  if (!tanque) { el.innerHTML = '<div class="card vazio">Tanque não encontrado.</div>'; return; }
  el.innerHTML = '<p class="carregando">Carregando…</p>';
  const D = await dadosDoDia(ctx, { mortes: true, saldos: false });
  if (!el.isConnected) return;
  const { resumo, semDetalhe, numerosGuardados, hoje } = D;
  const F = formatosSaco(state.ref.kgSaco);
  const meus = state.ref.lotes.filter((l) => l.tanque_id === id);
  const metas = (await db.kvGet('metasDespesca')) || {};
  const gerir = ctx.podeGerir();

  // ração de hoje: já dada, ou quanto dar (média da semana; sem média, a sugestão pelo peso dos peixes)
  let plano = '';
  if (meus.length) {
    const kgHoje = D.hojeKg(id);
    if (D.status[id] === 'ok') plano = `<div class="plano-hoje ok"><span>Ração de hoje</span><b>✓ ${kgHoje ? `${esc(F.nSacos(F.sacos(kgHoje)))} dados (${fmtNum(kgHoje, 0)} kg)` : 'já lançada'}</b></div>`;
    else {
      const m = D.mediaKg(id), sg = m ? null : D.sugestao(id);
      if (m) plano = `<div class="plano-hoje"><span>Ração de hoje</span><b>Dar ${fmtNum(m, 0)} kg (${esc(F.nSacos(F.sacos(m)))})</b>
        <details><summary>Por que essa quantidade?</summary><p>É a média dos dias com ração neste tanque na última semana. Se o peixe comer menos ou sobrar ração, ajuste.</p></details></div>`;
      else if (sg && sg.kg > 0) plano = `<div class="plano-hoje"><span>Ração de hoje</span><b>Dar ~${fmtNum(sg.kg, 0)} kg (${esc(F.nSug(sg.kg))})</b>
        <details><summary>Por que essa quantidade?</summary><p>${fmtNum(sg.pct, 1)}% do peso dos peixes no tanque${gerir ? ` (${fmtNum(sg.biomassaKg || 0, 0)} kg)` : ''}, pela fase em que estão${sg.provisoria ? '. Taxa provisória' : ''}. Confirme a taxa com o técnico.</p></details></div>`;
    }
  }
  // mortes da semana deste tanque
  const ids = new Set(meus.map((l) => l.id));
  const mortes7 = D.mortes ? D.mortes.filter((x) => ids.has(x.lote_id)).reduce((a, x) => a + (Number(x.quantidade) || 0), 0) : null;
  const acoes = acoesDoTanque(ctx, D, tanque, F, 't');
  const grandes = acoes.filter((a) => ['racao', 'mortalidade', 'agua', 'biometria'].includes(a.tipo))
    .map((a) => (a.tipo === 'mortalidade' && mortes7 != null ? { ...a, sub: `${fmtInt(mortes7)} ${mortes7 === 1 ? 'peixe' : 'peixes'} em 7 dias` } : a));
  const outras = acoes.filter((a) => !grandes.some((g) => g.tipo === a.tipo));
  const acoesHtml = `${plano}
    <div class="acoes4">${grandes.map((a) => `<a class="acao${a.feita ? ' feita' : ''}${a.ruim ? ' ruim' : ''}${a.alerta ? ' alerta' : ''}" href="${a.href}" data-acao="${a.tipo}">${icone(a.ic, 28)}<span>${esc(a.rot)}</span><small>${esc(a.sub)}</small></a>`).join('')}</div>`;

  el.innerHTML = `${semDetalhe ? '<p class="aviso">Sem conexão: os totais aparecem quando houver internet.</p>' : numerosGuardados ? '<p class="aviso">Sem conexão: números da última atualização.</p>' : ''}
    ${htmlCardTanque(tanque, meus, resumo, D.racaoHojeLocal, hoje, metas, gerir, acoesHtml)}
    <ul class="lista td-lista card">
      ${meus.length ? outras.map((a) => `<li><a class="item" href="${a.href}" data-acao="${a.tipo}"><span class="item-ic">${icone(a.ic)}</span><span class="esq"><b>${esc(a.rot)}</b><small>${esc(a.sub)}</small></span><span class="seta">${icone('direita', 20)}</span></a></li>`).join('') : ''}
      ${meus.length ? `<li><a class="item td-rel" href="#/relatorio/${esc(meus[0].id)}"><span class="item-ic">${icone('relatorio')}</span><span class="esq"><b>Relatório do lote</b><small>Peso, ração, mortes, água, lançamentos e PDF</small></span><span class="seta">${icone('direita', 20)}</span></a></li>` : ''}
      ${meus.length && !gerir ? `<li><a class="item td-corrigir" href="#/meus"><span class="item-ic">${icone('historico')}</span><span class="esq"><b>Lançou errado?</b><small>Em Meus lançamentos: desfaça (5 minutos), corrija o de hoje ou peça correção dos dias anteriores.</small></span><span class="seta">${icone('direita', 20)}</span></a></li>` : ''}
      ${gerir ? `<li><a class="item td-cadastro" href="#/tanque/${esc(tanque.id)}"><span class="item-ic">${icone('ajuste')}</span><span class="esq"><b>Cadastro do tanque e lotes</b><small>Nome, área, povoar, editar, encerrar ou reabrir lote</small></span><span class="seta">${icone('direita', 20)}</span></a></li>` : ''}
    </ul>`;
  if (!el.querySelector('.td-lista li')) el.querySelector('.td-lista').remove();
  el.querySelectorAll('[data-meta]').forEach((b) => b.addEventListener('click', async () => {
    const l = meus.find((x) => x.id === b.dataset.meta); if (!l) return;
    const v = await pedirTexto({ titulo: 'Meta de despesca', rotulo: 'Peso médio de cada peixe na despesca (kg)', texto: String(metaDe(l, metas)).replace('.', ','), placeholder: 'Ex.: 2,5', maxlength: 8,
      validar: (t) => (num(t) > 0 && num(t) < 100 ? '' : 'Informe o peso em kg, ex.: 2,5') });
    if (!v) return;
    metas[l.id] = num(v); await db.kvSet('metasDespesca', metas);
    ctx.toast('Meta de despesca salva neste aparelho', 'ok');
    renderTanqueDetalhe(ctx, el, id);
  }));
}

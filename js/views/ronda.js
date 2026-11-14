// Ronda de hoje: uma linha por tanque com o que falta (serve para 3 ou 30 tanques).
// Abas "Falta fazer" e "Feitos"; com mais de 8 tanques aparece a busca. Tocar no tanque abre a janela
// com as ações dele (ração, mortes, água, pesagem, probiótico e, para dono e gerente, despesca).
// Dono e gerente abrem pela Hoje; para o funcionário, a ronda é a própria Hoje.
import { esc, fmtInt, fmtNum, ROTULO_TIPO } from '../util.js';
import { icone } from '../icons.js';
import { vivosDoLote } from '../calc.js';
import { dadosDoDia, situacaoTanque, formatosSaco, ordemNatural } from './dia.js';

let filtro = 'falta', busca = '';

// ações de um tanque (as mesmas na janela da ronda e na tela do tanque)
export function acoesDoTanque(ctx, D, t, F, volta) {
  const sit = situacaoTanque(D, t, F);
  const m = D.ultimaAgua[t.id];
  const ult = D.lotesDe(t.id).map((l) => D.resumo[l.id] && D.resumo[l.id].ultima_biometria).filter(Boolean).sort().pop();
  const href = (tipo) => `#/lancar?tipo=${tipo}&tanque=${encodeURIComponent(t.id)}&volta=${volta}`;
  const fmtD = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return [
    { tipo: 'racao', ic: 'racao', rot: 'Ração', sub: sit.racao && sit.racao.tom === 'ok' ? `${sit.racao.curto} hoje` : sit.racao && sit.racao.curto !== 'ração' ? `dar ${sit.racao.curto.replace('ração: ', '')}` : 'ainda não', feita: sit.racao && sit.racao.tom === 'ok' },
    { tipo: 'mortalidade', ic: 'morte', rot: 'Mortes', sub: 'contar e lançar' },
    { tipo: 'agua', ic: 'agua', rot: 'Água', sub: sit.agua && sit.agua.tom === 'ruim' ? sit.agua.curto : m && m.data === D.hoje ? (m.oxigenio_mgl != null && m.oxigenio_mgl !== '' ? `✓ O₂ ${fmtNum(Number(m.oxigenio_mgl), 1)}` : '✓ medida hoje') : 'ainda não', feita: !!(m && m.data === D.hoje), ruim: sit.agua && sit.agua.tom === 'ruim' },
    { tipo: 'biometria', ic: 'peso', rot: 'Pesagem', sub: ult ? `última ${fmtD(ult)}` : 'nunca pesado', alerta: sit.pesar },
    { tipo: 'manejo', ic: 'probi', rot: 'Probiótico', sub: 'na ração ou na água' },
    ctx.podeGerir() && { tipo: 'despesca', ic: 'despesca', rot: 'Despesca', sub: 'tirar peixes' },
  ].filter(Boolean).map((a) => ({ ...a, href: href(a.tipo) }));
}

export async function renderRonda(ctx, el, { inicio = false } = {}) {
  const { tanques, lotes } = ctx.state.ref;
  busca = '';
  el.innerHTML = `<h1>${inicio ? 'Hoje' : 'Ronda de hoje'}</h1><p class="carregando">Carregando tanques…</p>`;
  const D = await dadosDoDia(ctx, { saldos: true });
  if (!el.isConnected) return;
  const F = formatosSaco(ctx.state.ref.kgSaco);
  const comPeixe = [...tanques].filter((t) => D.status[t.id] !== 'semlote').sort(ordemNatural);
  const feitos = comPeixe.filter((t) => D.status[t.id] === 'ok').length;
  const total = comPeixe.length;
  // abre no que falta; com tudo feito, abre em "Feitos" (para os tanques continuarem à vista)
  filtro = total - feitos > 0 ? 'falta' : 'feitos';
  const dataLonga = new Date(`${D.hoje}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  // galpão: sacos de ração (soma dos tipos em uso, nunca negativo)
  const linhas = D.saldos ? D.saldos.linhas.filter((s, i) => i === 0 || ['total_comprado_kg', 'total_consumido_kg', 'saldo_kg'].some((k) => Number(s[k]))) : [];
  const galpaoKg = linhas.reduce((a, s) => a + Math.max(0, Number(s.saldo_kg) || 0), 0);
  const gerir = ctx.podeGerir();

  el.innerHTML = `
    <div class="h-titulo"><div><h1>${inicio ? 'Hoje' : 'Ronda de hoje'}</h1>
      <p class="h-achado">${esc(dataLonga.charAt(0).toUpperCase() + dataLonga.slice(1))} · <b>${fmtInt(feitos)} de ${fmtInt(total)}</b> ${total === 1 ? 'tanque' : 'tanques'} já com ração</p></div></div>
    ${D.semDetalhe ? '<p class="aviso">Sem conexão: mostrando só o que está guardado no aparelho.</p>' : D.numerosGuardados ? '<p class="aviso">Sem conexão: números da última atualização. O que você lançar fica guardado e conta aqui.</p>' : ''}
    ${total ? `<div class="ronda-barra" role="img" aria-label="${fmtInt(feitos)} de ${fmtInt(total)} tanques com ração"><i style="width:${Math.round((feitos / total) * 100)}%"></i></div>
    <div class="seg ronda-seg" style="--n:2" role="group" aria-label="Mostrar">
      <button type="button" data-rfiltro="falta" aria-pressed="${filtro === 'falta'}"${filtro === 'falta' ? ' class="on"' : ''}>Falta fazer (${fmtInt(total - feitos)})</button>
      <button type="button" data-rfiltro="feitos" aria-pressed="${filtro === 'feitos'}"${filtro === 'feitos' ? ' class="on"' : ''}>Feitos (${fmtInt(feitos)})</button>
    </div>
    ${total > 8 ? '<input id="ronda-busca" class="ronda-busca" type="search" placeholder="Procurar tanque" aria-label="Procurar tanque" autocomplete="off">' : ''}
    <div id="ronda-lista"></div>` : `<div class="card vazio"><p>Nenhum tanque com peixes ${gerir ? 'ainda' : 'liberado para você'}.</p>${gerir ? '<a class="btn primario" href="#/tanques">Ir para Tanques</a>' : ''}</div>`}
    ${linhas.length ? `<a class="card ronda-galpao" href="#/estoque"><span class="item-ic">${icone('estoque')}</span><span class="esq"><b>Galpão: ${esc(F.nSacos(F.sacos(galpaoKg)))} de ração</b><small>chegou ração ou quer contar? toque aqui</small></span><span class="seta">${icone('direita', 20)}</span></a>` : ''}
    <div class="card ronda-protocolo"><b>Errou algum número?</b>
      ${gerir ? '<p>Abra o tanque e toque em <b>Relatório do lote</b>: em <b>Lançamentos</b> dá para corrigir ou excluir.</p>'
        : '<p>Logo depois de salvar aparece <b>Desfazer</b>: vale por 5 minutos. Depois, até o fim do dia, corrija em <b>Meus lançamentos</b>. Dias anteriores: lá mesmo, <b>Pedir correção</b> (o dono ou o gerente aprova).</p><p>Não lance de novo para compensar: soma em dobro.</p>'}
      <a class="btn mini ronda-meus" href="#/meus">Meus lançamentos</a></div>`;

  const lista = el.querySelector('#ronda-lista');
  const pintar = () => {
    if (!lista) return;
    const q = busca.trim().toLowerCase();
    const ts = comPeixe.filter((t) => (filtro === 'feitos' ? D.status[t.id] === 'ok' : D.status[t.id] !== 'ok') && (!q || t.nome.toLowerCase().includes(q)));
    if (!ts.length) {
      lista.innerHTML = q ? '<p class="card mudo">Nenhum tanque com esse nome aqui.</p>'
        : filtro === 'falta' ? '<p class="ronda-feito">✓ Todos os tanques já receberam ração</p><p class="mudo pequeno">Mortes, água e pesagem: toque no tanque em <b>Feitos</b>.</p>'
        : '<p class="card mudo">Nenhum tanque com ração ainda.</p>';
      return;
    }
    lista.innerHTML = `<ul class="lista ronda-lista">${ts.map((t) => {
      const sit = situacaoTanque(D, t, F);
      const resto = [sit.agua, sit.pesar && { tom: 'falta', curto: 'pesar' }].filter(Boolean)
        .map((c) => (c.tom === 'ruim' ? `<b class="t-erro">${esc(c.curto)}</b>` : c.tom === 'falta' && c.curto === 'pesar' ? `<b class="t-alerta">${esc(c.curto)}</b>` : esc(c.curto))).join(' · ');
      return `<li class="rl"><button type="button" class="rl-tq" data-rtq="${esc(t.id)}" aria-label="${esc(t.nome)}: ações">
        <span class="esq"><b>${esc(t.nome)}</b><small>${esc(D.fase(t.id))}${resto ? ` · ${resto}` : ''}</small></span>
        <span class="sit ${sit.racao.tom}">${esc(sit.racao.curto)}</span><span class="seta">${icone('direita', 18)}</span></button></li>`;
    }).join('')}</ul>`;
    lista.querySelectorAll('[data-rtq]').forEach((b) => b.addEventListener('click', () => abrirAcoes(ctx, D, F, tanques.find((t) => t.id === b.dataset.rtq), b)));
  };
  pintar();
  el.querySelectorAll('[data-rfiltro]').forEach((b) => b.addEventListener('click', () => {
    filtro = b.dataset.rfiltro;
    el.querySelectorAll('[data-rfiltro]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    pintar();
  }));
  const bu = el.querySelector('#ronda-busca');
  if (bu) bu.addEventListener('input', () => { busca = bu.value; pintar(); });
}

// janela do tanque na ronda: todas as ações dele; "Abrir o tanque" leva para a tela com os números
function abrirAcoes(ctx, D, F, t, origem) {
  if (!t) return;
  const ls = D.lotesDe(t.id);
  const peixes = ls.reduce((a, l) => a + vivosDoLote(l, D.resumo[l.id]), 0);
  const kgCada = ls.length === 1 && D.resumo[ls[0].id] && D.resumo[ls[0].id].ultimo_peso_medio_kg != null ? Number(D.resumo[ls[0].id].ultimo_peso_medio_kg) : null;
  const sub = [ls.length > 1 ? `${ls.length} lotes` : ls.length ? ROTULO_TIPO[ls[0].tipo] || ls[0].tipo : '', !D.semDetalhe && peixes ? `${fmtInt(peixes)} peixes` : '', kgCada ? `${kgCada >= 1 ? `${fmtNum(kgCada, 2)} kg` : `${fmtNum(kgCada * 1000, 0)} g`} cada` : ''].filter(Boolean).join(' · ');
  const acoes = acoesDoTanque(ctx, D, t, F, 'ronda');
  const fundo = document.createElement('div');
  fundo.className = 'dialogo folha-acoes';
  fundo.setAttribute('role', 'dialog');
  fundo.setAttribute('aria-modal', 'true');
  fundo.setAttribute('aria-label', t.nome);
  fundo.innerHTML = `<div class="dialogo-caixa">
    <h3>${esc(t.nome)}</h3>${sub ? `<p class="mudo" style="margin:0">${esc(sub)}</p>` : ''}
    <div class="acoes-grade">${acoes.map((a) => `<a class="btn${a.feita ? ' feita' : ''}${a.ruim ? ' ruim' : ''}" href="${a.href}" data-acao="${a.tipo}">${icone(a.ic, 24)}<span>${esc(a.rot)}<small>${esc(a.sub)}</small></span></a>`).join('')}</div>
    <a class="btn grande" href="#/t/${esc(t.id)}">Abrir o ${esc(t.nome)}</a>
    <button type="button" class="btn grande" data-fechar>Fechar</button></div>`;
  const fechar = () => { document.removeEventListener('keydown', tecla); window.removeEventListener('hashchange', fechar); fundo.remove(); if (origem && origem.isConnected) try { origem.focus({ preventScroll: true }); } catch { /* ignora */ } };
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  fundo.addEventListener('click', (e) => { if (e.target === fundo || e.target.closest('[data-fechar]')) fechar(); });
  document.addEventListener('keydown', tecla);
  window.addEventListener('hashchange', fechar); // escolheu uma ação: a janela some e o lançamento abre
  document.body.appendChild(fundo);
  fundo.querySelector('.acoes-grade a').focus();
}

// Pedidos de correção (sql/35), para o dono e o gerente: aprovar (o banco corrige sozinho) ou recusar.
import { esc, fmtData } from '../util.js';
import { confirmar, formulario } from '../dialogo.js';
import { textoPedido, SITUACAO_PEDIDO } from '../correcao.js';

const quando = (iso) => { const d = new Date(iso); return `${fmtData(d.toISOString().slice(0, 10)).slice(0, 5)} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };

export async function renderPedidos(ctx, el) {
  if (!ctx.podeGerir()) { location.hash = '#/meus'; return; }
  el.innerHTML = '<h1>Pedidos de correção</h1><p class="sub-titulo">Carregando…</p>';
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const [pedidos, nomes] = await Promise.all([ctx.api.pedidosCorrecao({ desdeISO: desde }), ctx.api.nomesUsuarios().catch(() => ({}))]);
  if (!el.isConnected) return;
  if (pedidos === null) {
    el.innerHTML = '<h1>Pedidos de correção</h1><div class="card vazio"><p>O pedido de correção ainda não foi ativado neste sistema (falta rodar o sql/35 no Supabase).</p></div>';
    return;
  }
  const abertos = pedidos.filter((p) => p.status === 'pendente');
  const respondidos = pedidos.filter((p) => p.status !== 'pendente').slice(0, 30);
  const nome = (id) => nomes[id] || 'Alguém da equipe';
  const ref = ctx.state.ref;

  const cartao = (p) => {
    const t = textoPedido(p, ref);
    return `<div class="card pedido" data-pedido="${esc(p.id)}">
      <div class="pedido-cab"><b>${esc(t.titulo)}</b>${t.data ? `<small>lançado para ${esc(fmtData(t.data).slice(0, 5))}</small>` : ''}</div>
      <dl class="pedido-val">
        <div><dt>Lançado</dt><dd class="riscado">${esc(t.lancado)}</dd></div>
        <div><dt>${p.acao === 'apagar' ? 'Pede para' : 'Certo'}</dt><dd>${esc(t.certo)}</dd></div>
        <div><dt>Motivo</dt><dd>${esc(p.motivo)}</dd></div>
        <div><dt>Quem pediu</dt><dd>${esc(nome(p.pedido_por))} · ${esc(quando(p.pedido_em))}</dd></div>
      </dl>
      <div class="pedido-acoes">
        <button type="button" class="btn primario" data-aprovar="${esc(p.id)}">${p.acao === 'apagar' ? 'Aprovar e apagar' : 'Aprovar e corrigir'}</button>
        <button type="button" class="btn" data-recusar="${esc(p.id)}">Recusar</button>
      </div>
    </div>`;
  };
  const respondido = (p) => {
    const t = textoPedido(p, ref), [tom, rot] = SITUACAO_PEDIDO[p.status] || ['', p.status];
    return `<li><span class="esq"><b>${esc(t.titulo)}</b><small>${esc(t.lancado)} → ${esc(t.certo)} · ${esc(nome(p.pedido_por))}</small>
      ${p.respondido_em ? `<small>${esc(p.status === 'cancelado' ? 'Cancelado' : `Respondido por ${nome(p.respondido_por)}`)} · ${esc(quando(p.respondido_em))}${p.resposta ? ` · “${esc(p.resposta)}”` : ''}</small>` : ''}</span>
      <span class="sit ${tom}">${esc(rot)}</span></li>`;
  };

  el.innerHTML = `
    <h1>Pedidos de correção</h1>
    <p class="sub-titulo">${abertos.length ? `${abertos.length} ${abertos.length === 1 ? 'pedido esperando' : 'pedidos esperando'} você` : 'Nenhum pedido esperando você'}</p>
    ${abertos.length ? `<div class="pedidos-lista">${abertos.map(cartao).join('')}</div>` : ''}
    <div class="card ronda-protocolo"><b>Como funciona</b>
      <p>A equipe pede correção dos lançamentos dos últimos 7 dias. <b>Aprovar</b> corrige o lançamento na hora; tudo fica no Histórico (quem lançou, quem pediu e quem aprovou). <b>Recusar</b> deixa como está e a pessoa vê a sua resposta.</p></div>
    ${respondidos.length ? `<h2 class="meus-dia">Respondidos (30 dias)</h2><div class="card"><ul class="lista pedidos-resp">${respondidos.map(respondido).join('')}</ul></div>` : ''}`;

  const responder = async (b, aprovar) => {
    const p = pedidos.find((x) => x.id === (b.dataset.aprovar || b.dataset.recusar));
    if (!p || b.disabled) return;
    let resposta = null;
    if (aprovar) {
      const t = textoPedido(p, ref);
      if (!(await confirmar({ titulo: p.acao === 'apagar' ? 'Apagar o lançamento?' : 'Corrigir o lançamento?', linhas: [['Lançamento', t.titulo], ['Lançado', t.lancado], [p.acao === 'apagar' ? 'Fica' : 'Passa a', p.acao === 'apagar' ? 'apagado (dá para restaurar no Histórico)' : t.certo]], ok: p.acao === 'apagar' ? 'Apagar' : 'Corrigir', cancelar: 'Voltar' }))) return;
    } else {
      const v = await formulario({ titulo: 'Recusar o pedido', texto: 'O lançamento fica como está. A pessoa vê a sua resposta.', campos: [{ nome: 'resposta', rotulo: 'Resposta (opcional)', tipo: 'text', maxlength: 200 }], ok: 'Recusar', cancelar: 'Voltar' });
      if (!v) return;
      resposta = String(v.resposta || '').trim() || null;
    }
    b.disabled = true;
    try {
      await ctx.api.responderCorrecao(p.id, aprovar, resposta);
      ctx.toast(aprovar ? (p.acao === 'apagar' ? 'Lançamento apagado.' : 'Lançamento corrigido.') : 'Pedido recusado.', 'ok');
      ctx.atualizarRef && ctx.atualizarRef();
    } catch (e) {
      ctx.toast((e && e.message) || 'Não foi possível responder.', 'erro');
    }
    if (el.isConnected) renderPedidos(ctx, el);
  };
  el.querySelectorAll('[data-aprovar]').forEach((b) => b.addEventListener('click', () => responder(b, true)));
  el.querySelectorAll('[data-recusar]').forEach((b) => b.addEventListener('click', () => responder(b, false)));
}

// aviso na Hoje do dono e do gerente: quantos pedidos esperam resposta
export async function avisoPedidos(ctx, caixa) {
  if (!ctx.podeGerir() || !navigator.onLine || !caixa) return;
  const lista = await ctx.api.pedidosCorrecao({ desdeISO: new Date(Date.now() - 30 * 86400000).toISOString() }).catch(() => null);
  const n = (lista || []).filter((p) => p.status === 'pendente').length;
  if (!n) return;
  caixa = caixa.isConnected ? caixa : document.getElementById('avisos');
  if (!caixa || caixa.querySelector('.aviso-pedidos')) return;
  caixa.insertAdjacentHTML('afterbegin', `<a class="card aviso-pedidos" href="#/pedidos"><span class="esq"><b>${n} ${n === 1 ? 'pedido de correção' : 'pedidos de correção'}</b><small>A equipe pediu para corrigir ${n === 1 ? 'um lançamento' : 'lançamentos'}. Toque para aprovar ou recusar.</small></span><span class="sit falta">Responder</span></a>`);
}

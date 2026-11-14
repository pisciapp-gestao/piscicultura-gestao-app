// Meus lançamentos: o que a pessoa lançou nos últimos 7 dias (no aparelho e já enviado).
//  - até 5 minutos: Desfazer
//  - no mesmo dia: Corrigir direto (sql/33), pelo Relatório do lote > Lançamentos
//  - dias anteriores (até 7): o funcionário pede a correção (sql/35); dono e gerente corrigem direto
import { esc, hojeISO, fmtData } from '../util.js';
import { icone } from '../icons.js';
import * as db from '../db.js';
import { descricao } from './pendencias.js';
import { desfazerLancamento, minutosParaDesfazer, PRAZO_DESFAZER_MIN } from '../desfazer.js';
import { pedirCorrecao, podePedirCorrecao, DIAS_PEDIR_CORRECAO, SITUACAO_PEDIDO } from '../correcao.js';
import { confirmar } from '../dialogo.js';

const horaDe = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const diaLocal = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const menosDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - n); return diaLocal(d.toISOString()); };

export async function renderMeus(ctx, el) {
  const { state } = ctx;
  const meuId = state.perfil.id;
  const gerir = ctx.podeGerir();
  const hoje = hojeISO(), ontem = menosDias(hoje, 1);
  const desde = new Date(`${menosDias(hoje, DIAS_PEDIR_CORRECAO)}T00:00:00`).toISOString();
  el.innerHTML = '<h1>Meus lançamentos</h1><p class="sub-titulo">Carregando…</p>';

  const fila = (await db.filaList().catch(() => [])).filter((i) => i.registrado_por === meuId);
  let doBanco = [], pedidos = null, semSinal = !navigator.onLine;
  if (!semSinal) {
    try {
      [doBanco, pedidos] = await Promise.all([ctx.api.meusLancamentos(meuId, desde), gerir ? null : ctx.api.pedidosCorrecao({ desdeISO: desde, meus: meuId }).catch(() => null)]);
    } catch { semSinal = true; }
  }
  if (!el.isConnected) return;
  // no aparelho: tudo o que ainda não foi enviado; do banco: os últimos 7 dias
  const porUuid = new Map();
  for (const r of doBanco) porUuid.set(r.payload.uuid_local || `id:${r.tabela}:${r.payload.id}`, { tabela: r.tabela, payload: r.payload, criadoEm: r.payload.criado_em, onde: 'banco' });
  for (const i of fila) if (!porUuid.has(i.uuid_local)) porUuid.set(i.uuid_local, { tabela: i.tabela, payload: i.payload, criadoEm: i.criado_em, onde: i.status === 'erro' ? 'erro' : 'fila', erro: i.erro });
  const itens = [...porUuid.entries()].map(([chave, v]) => ({ chave, ...v })).sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  // pedido mais recente de cada lançamento (a lista vem do mais novo para o mais antigo)
  const pedidoDe = new Map();
  for (const p of pedidos || []) if (!pedidoDe.has(`${p.tabela}:${p.registro_id}`)) pedidoDe.set(`${p.tabela}:${p.registro_id}`, p);

  const { lotes } = state.ref;
  // onde corrigir: Relatório do lote > Lançamentos (a água é do tanque: vai para o lote ativo dele)
  const loteDe = (it) => it.payload.lote_id || ((lotes.find((l) => l.tanque_id === it.payload.tanque_id) || {}).id) || '';
  const sitEnvio = (it) => (it.onde === 'banco' ? '<span class="sit ok">✓ Enviado</span>' : it.onde === 'erro' ? '<span class="sit ruim">Não enviado</span>' : '<span class="sit falta">No celular</span>');

  function linha(it) {
    const d = descricao({ tabela: it.tabela, payload: it.payload }, state.ref);
    const min = it.chave.startsWith('id:') ? 0 : minutosParaDesfazer(it.tabela, it.criadoEm);
    const lote = loteDe(it);
    const enviado = it.onde === 'banco' && it.tabela !== 'despescas';
    const doDia = it.criadoEm && diaLocal(it.criadoEm) === hoje; // lançado hoje: quem lançou corrige direto
    const p = enviado ? pedidoDe.get(`${it.tabela}:${it.payload.id}`) : null;
    const [tom, rot] = p ? SITUACAO_PEDIDO[p.status] || ['', ''] : [];
    let acao = '';
    if (min) acao = `<button type="button" class="btn mini" data-desfazer="${esc(it.chave)}">${icone('desfazer', 18)} Desfazer (${min} min)</button>`;
    else if (enviado && lote && (doDia || gerir)) acao = `<a class="btn mini" href="#/relatorio/${esc(lote)}?aba=registros">Corrigir</a>`;
    else if (enviado && p && p.status === 'pendente') acao = `<button type="button" class="btn mini" data-cancelar-pedido="${esc(p.id)}">Cancelar pedido</button>`;
    else if (enviado && pedidos && podePedirCorrecao(it.tabela) && it.payload.data >= menosDias(hoje, DIAS_PEDIR_CORRECAO)) acao = `<button type="button" class="btn mini" data-pedir="${esc(it.chave)}">Pedir correção</button>`;
    return `<li class="meu" data-chave="${esc(it.chave)}">
      <div class="meu-cab"><span class="esq"><b>${esc(d.titulo)}</b><small>${esc([horaDe(it.criadoEm), d.valor, it.payload.data && it.payload.data !== diaLocal(it.criadoEm || new Date().toISOString()) ? `para ${fmtData(it.payload.data)}` : ''].filter(Boolean).join(' · '))}</small>
        ${it.onde === 'erro' ? `<small style="color:var(--erro)">${esc(it.erro || 'Erro no envio')}: veja em Pendentes</small>` : ''}
        ${p && p.status === 'recusado' && p.resposta ? `<small class="meu-resp">Resposta: ${esc(p.resposta)}</small>` : ''}</span>
        <span class="sits">${p && rot ? `<span class="sit ${tom}">${esc(rot)}</span>` : sitEnvio(it)}</span></div>
      ${acao ? `<div class="meu-acoes">${acao}</div>` : ''}
    </li>`;
  }
  // separados por dia (pelo dia em que foi lançado)
  const grupos = [];
  for (const it of itens) {
    const dia = it.criadoEm ? diaLocal(it.criadoEm) : hoje;
    const g = grupos[grupos.length - 1];
    if (g && g.dia === dia) g.itens.push(it); else grupos.push({ dia, itens: [it] });
  }
  const nomeDia = (d) => (d === hoje ? 'Hoje' : d === ontem ? 'Ontem' : fmtData(d).slice(0, 5));

  el.innerHTML = `
    <h1>Meus lançamentos</h1>
    <p class="sub-titulo">Últimos ${DIAS_PEDIR_CORRECAO} dias · o que você lançou</p>
    ${semSinal ? '<p class="aviso">Sem internet: aparece só o que está guardado neste celular.</p>' : ''}
    ${grupos.length ? grupos.map((g) => `<h2 class="meus-dia">${esc(nomeDia(g.dia))}</h2><div class="card"><ul class="lista meus-lista">${g.itens.map(linha).join('')}</ul></div>`).join('')
      : `<div class="card vazio"><p>Nada lançado nos últimos ${DIAS_PEDIR_CORRECAO} dias.</p><a class="btn primario" href="#/">Ir para a ronda</a></div>`}
    <div class="card ronda-protocolo"><b>Errou algum número?</b>
      <ol>
        <li><b>Desfazer</b>: até ${PRAZO_DESFAZER_MIN} minutos depois de salvar. O lançamento some e você lança de novo.</li>
        <li>No mesmo dia: <b>Corrigir</b> (abre o lote, em Lançamentos).</li>
        ${gerir ? '<li>Dias anteriores: <b>Corrigir</b> também (dono e gerente corrigem direto).</li>'
          : `<li>Dias anteriores (até ${DIAS_PEDIR_CORRECAO} dias): <b>Pedir correção</b>, com o valor certo. O dono ou o gerente aprova.</li>`}
        <li>Não lance de novo para compensar: soma em dobro.</li>
      </ol></div>`;

  el.querySelectorAll('[data-desfazer]').forEach((b) => b.addEventListener('click', async () => {
    const it = itens.find((x) => x.chave === b.dataset.desfazer);
    if (!it || b.disabled) return;
    b.disabled = true;
    try {
      await desfazerLancamento(ctx, { uuidLocal: it.chave, tabela: it.tabela, payload: it.payload, criadoEm: it.criadoEm });
      ctx.toast('Desfeito. Pode lançar de novo.', 'ok');
    } catch (e) {
      ctx.toast((e && e.message) || 'Não foi possível desfazer.', 'erro');
    }
    if (el.isConnected) renderMeus(ctx, el);
  }));
  el.querySelectorAll('[data-pedir]').forEach((b) => b.addEventListener('click', async () => {
    const it = itens.find((x) => x.chave === b.dataset.pedir);
    if (!it || b.disabled) return;
    b.disabled = true;
    const foi = await pedirCorrecao(ctx, it);
    b.disabled = false;
    if (foi && el.isConnected) renderMeus(ctx, el);
  }));
  el.querySelectorAll('[data-cancelar-pedido]').forEach((b) => b.addEventListener('click', async () => {
    if (b.disabled || !(await confirmar({ titulo: 'Cancelar o pedido de correção?', texto: 'O lançamento continua como está.', ok: 'Cancelar pedido', cancelar: 'Voltar' }))) return;
    b.disabled = true;
    try { await ctx.api.cancelarPedidoCorrecao(b.dataset.cancelarPedido); ctx.toast('Pedido cancelado.', 'ok'); }
    catch (e) { ctx.toast((e && e.message) || 'Não foi possível cancelar.', 'erro'); }
    if (el.isConnected) renderMeus(ctx, el);
  }));

  // o "Desfazer (x min)" conta sozinho; quando o prazo de algum acaba, a lista se redesenha
  if (itens.some((it) => !it.chave.startsWith('id:') && minutosParaDesfazer(it.tabela, it.criadoEm))) {
    const relogio = setInterval(() => {
      if (!el.isConnected) { clearInterval(relogio); return; }
      let mudou = false;
      el.querySelectorAll('[data-desfazer]').forEach((b) => {
        const it = itens.find((x) => x.chave === b.dataset.desfazer);
        const m = it ? minutosParaDesfazer(it.tabela, it.criadoEm) : 0;
        if (!m) mudou = true; else b.lastChild.textContent = ` Desfazer (${m} min)`;
      });
      if (mudou) { clearInterval(relogio); renderMeus(ctx, el); }
    }, 15000);
  }
}

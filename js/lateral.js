// Lateral do computador: atalhos que no celular ficam em "Mais" e um resumo do dia sempre à vista.
// O resumo usa o que é barato (lotes, fila do aparelho, previsão do tempo guardada) e só 2 consultas
// ao servidor, guardadas por 1 minuto para não repetir a cada troca de tela.
import { esc, fmtInt, fmtNum, hojeISO, progresso } from './util.js';
import * as db from './db.js';
import { icone } from './icons.js';
import { situacaoEstoque, previsaoDespesca } from './calc.js';
import { descricao } from './clima.js';
import { metaDe, metasDe } from './views/despesca.js';
import { ESTOQUE_ATENCAO_DIAS, ESTOQUE_CRITICO_DIAS, ESTOQUE_COBERTURA_DIAS, PESO_SACO_PADRAO_KG } from './config.js';

// Todos os atalhos possíveis, já filtrados pelo papel de quem está usando: [id, rota marcada, link, ícone, texto]
export function catalogoAtalhos(state, gerir) {
  const dono = state.perfil.papel === 'dono';
  return [
    ['estoque', 'estoque', '#/estoque', 'estoque', 'Estoque de ração'],
    dono && ['equipe', 'equipe', '#/equipe', 'equipe', 'Equipe'],
    dono && ['plano', 'plano', '#/plano', 'check', 'Meu plano'],
    dono && ['historico', 'historico', '#/historico', 'historico', 'Histórico e lixeira'],
    ['racao', 'relatorio-racao', '#/relatorio/racao', 'relatorio', 'Ração fornecida'],
    ['biometria', '', '#/lancar?tipo=biometria', 'lancar', 'Lançar biometria'],
    ['mortalidade', '', '#/lancar?tipo=mortalidade', 'lancar', 'Lançar mortalidade'],
    ['pendencias', 'pendencias', '#/pendencias', 'pendentes', 'Pendentes de envio'],
    state.admin && ['admin', 'admin', '#/admin', 'admin', 'Administração do sistema'],
  ].filter(Boolean);
}
// os 5 primeiros que a pessoa pode ver (o mesmo que aparecia antes da personalização)
const PADRAO = ['estoque', 'equipe', 'plano', 'historico']; // Tanques virou item do menu (13/11/2026)

// ids escolhidos (na ordem); sem escolha guardada, o padrão do papel
export async function atalhosEscolhidos(state, gerir) {
  const pode = new Set(catalogoAtalhos(state, gerir).map((x) => x[0]));
  const salvo = await db.kvGet('atalhosLateral');
  return (Array.isArray(salvo) ? salvo : PADRAO).filter((id) => pode.has(id));
}
export const salvarAtalhos = (ids) => db.kvSet('atalhosLateral', ids);

export function htmlAtalhos() {
  return `<nav class="lat-atalhos" id="lat-atalhos" aria-label="Atalhos"></nav>
    <section class="lat-hoje" id="lat-hoje" aria-label="Resumo de hoje"></section>`;
}

// desenha os atalhos escolhidos na lateral (chamada ao montar a tela e depois de mudar a escolha em Mais)
export async function pintarAtalhos(ctx, rota = null) {
  const nav = document.getElementById('lat-atalhos');
  if (!nav) return;
  const cat = Object.fromEntries(catalogoAtalhos(ctx.state, ctx.podeGerir()).map((x) => [x[0], x]));
  const ids = await atalhosEscolhidos(ctx.state, ctx.podeGerir());
  nav.innerHTML = ids.length ? `<p class="lat-rot">Atalhos</p>${ids.map((id) => { const [, r, href, ic, txt] = cat[id]; return `<a data-rota="${r}" href="${href}">${icone(ic, 17)}<span>${esc(txt)}</span></a>`; }).join('')}` : '';
  if (rota != null) marcarAtalho(rota);
}

let cache = { em: 0, resumo: null, saldos: null };

export async function atualizarLateral(ctx) {
  const box = document.getElementById('lat-hoje');
  if (!box || !matchMedia('(min-width: 900px)').matches) return; // só existe no computador
  const { state } = ctx;
  const hoje = hojeISO();
  const { tanques, lotes } = state.ref;
  if (navigator.onLine && Date.now() - cache.em > 60000) {
    const [r, s] = await Promise.all([ctx.api.resumoLotes().catch(() => null), ctx.api.saldosRacao().catch(() => null)]);
    cache = { em: Date.now(), resumo: r || cache.resumo, saldos: s || cache.saldos };
  }
  const resumo = Object.fromEntries((cache.resumo || []).map((x) => [x.lote_id, x]));
  const fila = await db.filaList();
  const feitos = new Set(fila.filter((i) => i.tabela === 'racao_consumo' && i.payload.data === hoje).map((i) => i.payload.tanque_id));
  for (const l of lotes) if (resumo[l.id] && resumo[l.id].ultima_racao === hoje) feitos.add(l.tanque_id);
  const comLote = tanques.filter((t) => lotes.some((l) => l.tanque_id === t.id));
  const comeram = comLote.filter((t) => feitos.has(t.id)).length;
  const blocos = [];

  if (comLote.length) {
    blocos.push(`<a class="lat-item" href="#/"><span>Ração de hoje</span><b>${fmtInt(comeram)} de ${fmtInt(comLote.length)} <small>tanques</small></b>${progresso((comeram / comLote.length) * 100, { fina: true, tom: comeram === comLote.length ? 'ok' : '', rotulo: `${comeram} de ${comLote.length} tanques alimentados` })}</a>`);
  }
  const linha = cache.saldos && cache.saldos.linhas && cache.saldos.linhas[0];
  if (linha) {
    const kgS = state.ref.kgSaco || PESO_SACO_PADRAO_KG;
    const tot = cache.saldos.linhas.reduce((a, x) => a + Math.max(0, Number(x.saldo_kg) || 0), 0);
    const sit = situacaoEstoque(Number(linha.saldo_kg) || 0, linha.consumo_7d_kg, ESTOQUE_ATENCAO_DIAS, ESTOQUE_CRITICO_DIAS);
    const tom = { atencao: 'alerta', critico: 'erro', negativo: 'erro' }[sit.nivel] || '';
    blocos.push(`<a class="lat-item" href="#/estoque"><span>Estoque</span><b>${fmtInt(tot / kgS)} <small>sacos</small></b>${sit.dias != null ? `${progresso((sit.dias / ESTOQUE_COBERTURA_DIAS) * 100, { fina: true, tom, rotulo: `Dura ${Math.floor(sit.dias)} dias` })}<small>dura ~${fmtInt(Math.floor(sit.dias))} dias</small>` : ''}</a>`);
  }
  if (ctx.podeGerir() && cache.resumo) {
    const metas = metasDe(ctx.state.ref, (await db.kvGet('metasDespesca')) || {}); // engorda: peso de venda (sql/38)
    const prox = lotes.filter((l) => l.tipo === 'engorda').map((l) => ({ l, p: previsaoDespesca(l, resumo[l.id], metaDe(l, metas), hoje) }))
      .filter((x) => x.p.estado !== 'sem-dado').sort((a, b) => (a.p.estado === 'pronto' ? -1 : 0) - (b.p.estado === 'pronto' ? -1 : 0) || String(a.p.data).localeCompare(String(b.p.data)))[0];
    if (prox) {
      const nome = (tanques.find((t) => t.id === prox.l.tanque_id) || {}).nome || 'Tanque';
      const quando = prox.p.estado === 'pronto' ? 'já no peso' : new Date(`${prox.p.data}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
      blocos.push(`<a class="lat-item" href="#/t/${esc(prox.l.tanque_id)}"><span>Próxima despesca</span><b>${esc(nome)}</b><small>${esc(quando)}</small></a>`);
    }
  }
  const clima = await db.kvGet('climaPrev');
  const dHoje = clima && clima.dias && clima.dias.find((d) => d.data === hoje);
  if (dHoje) blocos.push(`<a class="lat-item" href="#/"><span>Tempo hoje</span><b>${dHoje.max == null ? '—' : `${Math.round(dHoje.max)}°`} <small>mín. ${dHoje.min == null ? '—' : `${Math.round(dHoje.min)}°`}</small></b><small>${esc(descricao(dHoje.codigo))}${dHoje.chuva != null && dHoje.chuva >= 1 ? ` · ${fmtNum(dHoje.chuva, 0)} mm` : ''}</small></a>`);

  box.innerHTML = blocos.length ? `<p class="lat-rot">Hoje</p>${blocos.join('')}` : '';
}

// marca o atalho da tela aberta (e tira o destaque de "Mais" quando o atalho já indica onde está)
export function marcarAtalho(rota) {
  let achou = false;
  document.querySelectorAll('.lat-atalhos a').forEach((a) => { const on = !!rota && a.dataset.rota === rota; a.classList.toggle('on', on); if (on) achou = true; });
  if (achou) document.querySelectorAll('.lateral a[data-aba="mais"]').forEach((a) => { a.classList.remove('on'); a.removeAttribute('aria-current'); });
}

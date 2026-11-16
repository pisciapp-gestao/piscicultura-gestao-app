// Previsão de despesca: meta por lote (guardada no aparelho; sem meta, o padrão da fase) e a barra peso atual ÷ meta.
import { esc, fmtInt, fmtNum, progresso } from '../util.js';
import { ALVO_PADRAO_KG } from '../config.js';

// meta de despesca de um lote: a do mapa (metasDe) ou o padrão da fase
export const metaDe = (l, metas) => Number((metas || {})[l.id]) || ALVO_PADRAO_KG[l.tipo] || ALVO_PADRAO_KG.engorda;

// Peso de venda (sql/38): engorda usa o do tanque, senão o da fazenda, senão a meta antiga guardada no aparelho.
// As outras fases continuam com a meta de passar de fase (aparelho ou padrão). ref: state.ref; local: metas do aparelho.
export function metasDe(ref, local = {}) {
  const out = { ...(local || {}) };
  for (const l of (ref && ref.lotes) || []) {
    if (l.tipo !== 'engorda') continue;
    const t = (ref.tanques || []).find((x) => x.id === l.tanque_id);
    const v = (t && Number(t.peso_venda_kg) > 0 && Number(t.peso_venda_kg)) || (Number(ref.pesoVenda) > 0 && Number(ref.pesoVenda)) || null;
    if (v) out[l.id] = v;
  }
  return out;
}
// de onde vem o peso de venda do tanque (para o texto da tela)
export const origemPesoVenda = (tanque, ref) => (tanque && Number(tanque.peso_venda_kg) > 0 ? 'tanque' : ref && Number(ref.pesoVenda) > 0 ? 'fazenda' : 'padrao');

// "Faltam ≈ 1.180 sacos de ração até vender" + a ração certa agora (tabela Socil)
export function htmlPrevRacao(pr, kgSaco, tipo = 'engorda') {
  if (!pr) return '';
  const sacos = (kg) => fmtInt(Math.round(kg / kgSaco));
  const ate = PROXIMA_FASE[tipo] ? 'até passar de fase' : 'até vender';
  const falta = pr.pronto ? '' : `<p class="td-racao-falta"><span>Faltam ≈ <b>${sacos(pr.faltaKg)} sacos</b> de ração ${ate}</span>
    <small>${pr.fator && Math.round(Math.abs(pr.fator - 1) * 100) >= 1 ? `Pela tabela Socil seriam ${sacos(pr.tabelaKg)} sacos; este lote está gastando ${fmtInt(Math.round(Math.abs(pr.fator - 1) * 100))}% ${pr.fator > 1 ? 'a mais' : 'a menos'} que a tabela` : 'Pela tabela Socil, para os peixes vivos'}</small></p>`;
  const agora = pr.agora ? `<p class="td-racao-agora"><span>Ração certa agora</span><b>${esc(pr.agora.racao)}</b><small>${fmtInt(pr.agora.tratos)} ${pr.agora.tratos === 1 ? 'trato' : 'tratos'} por dia · ${fmtNum(pr.agora.pct, 1)}% do peso dos peixes</small></p>` : '';
  return falta + agora;
}
export const pesoTxt = (kg) => (kg < 1 ? `${fmtNum(kg * 1000, 0)} g` : `${fmtNum(kg, kg < 10 ? 1 : 0)} kg`);
export const dataCurta = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');

// linha de previsão de despesca (barra = peso atual ÷ meta)
// tipo: fase do lote. Só a engorda vai para despesca; as outras fases passam para a próxima.
export const PROXIMA_FASE = { bercario: 'alevinagem', alevinagem: 'recria', recria: 'engorda' };
const NOME_FASE = { alevinagem: 'alevinagem', recria: 'recria', engorda: 'engorda' };
export function htmlPrevisao(p, tipo = 'engorda') {
  const prox = PROXIMA_FASE[tipo];
  const leg = p.estado === 'pronto' ? `<b>${prox ? `Pronto para a ${NOME_FASE[prox]}` : 'Já no peso de despesca'}</b>`
    : p.estado === 'previsto' ? `${prox ? 'Passa de fase' : 'Despesca'}: <b>${esc(dataCurta(p.data))}</b> · ${p.dias === 0 ? 'hoje' : `em ${fmtInt(p.dias)} ${p.dias === 1 ? 'dia' : 'dias'}`}`
    : 'Faça uma biometria para prever a data';
  return `${progresso(p.pct || 0, { tom: p.estado === 'pronto' ? 'ok' : '', rotulo: `Peso ${pesoTxt(p.pmKg || 0)} de ${pesoTxt(p.alvoKg)}` })}
    <p class="h-trilho-leg"><span>${pesoTxt(p.pmKg || 0)} de ${pesoTxt(p.alvoKg)}</span><span>${leg}</span></p>`;
}

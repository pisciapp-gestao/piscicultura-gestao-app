// Dados do dia, usados pela Hoje, pela Ronda e pela tela do tanque (as três mostram o mesmo número).
// Com internet: busca no servidor e guarda; sem internet: usa o que ficou guardado + a fila do aparelho.
import { fmtNum, hojeISO, diasEntre, ROTULO_TIPO } from '../util.js';
import * as db from '../db.js';
import { sugestaoRacao, avaliarAgua, ehTambaqui } from '../calc.js';
import { PESO_SACO_PADRAO_KG, ALERTAS, TAXA_RACAO } from '../config.js';

export const ordemNatural = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric: true, sensitivity: 'base' });

// sacos e kg do jeito do produtor: "2 sacos", "1,5 saco", "8 kg" (menos de 1 saco vai em kg)
export function formatosSaco(kgSaco) {
  const kgS = kgSaco || PESO_SACO_PADRAO_KG;
  const sacos = (kg) => kg / kgS;
  const nSacos = (n) => { if (n > 0 && n < 0.95) return `${fmtNum(n * kgS, n * kgS < 10 ? 1 : 0)} kg`; const v = n >= 3 ? Math.round(n) : Math.round(n * 10) / 10; return `${fmtNum(v, Number.isInteger(v) ? 0 : 1)} ${v === 1 ? 'saco' : 'sacos'}`; };
  // sugestão: arredonda em meio saco, igual à tela Lançar
  const nSug = (kg) => { const n = sacos(kg); if (n < 0.95) return nSacos(n); const v = Math.round(n * 2) / 2; return `${fmtNum(v, Number.isInteger(v) ? 0 : 1)} ${v === 1 ? 'saco' : 'sacos'}`; };
  return { kgS, sacos, nSacos, nSug };
}

export function statusTanque(tanque, lotes, resumo, racaoHojeLocal, hoje) {
  const meus = lotes.filter((l) => l.tanque_id === tanque.id);
  if (!meus.length) return 'semlote';
  const lancou = racaoHojeLocal.has(tanque.id) || meus.some((l) => resumo[l.id] && resumo[l.id].ultima_racao === hoje);
  return lancou ? 'ok' : 'falta';
}

const desdeDe = (hoje) => (n) => { const d = new Date(`${hoje}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

export async function dadosDoDia(ctx, { mortes: comMortes = false, saldos: comSaldos = true } = {}) {
  const { tanques, lotes } = ctx.state.ref;
  const hoje = hojeISO();
  const desde = desdeDe(hoje);
  const resumo = {};
  let semDetalhe = false, saldos = null, racao = null, mortes = null, agua = null;
  if (navigator.onLine) {
    const [rs, sd, rc, mt, ag] = await Promise.all([
      ctx.api.resumoLotes().catch(() => null),
      comSaldos ? ctx.api.saldosRacao().catch(() => null) : null,
      ctx.api.racaoPeriodo(desde(13)).catch(() => null), // 14 dias: hoje e os 13 anteriores
      comMortes ? ctx.api.mortalidadePeriodo(desde(6)).catch(() => null) : null, // 7 dias com hoje
      ctx.api.aguaPeriodo(desde(13)).catch(() => null),
    ]);
    if (rs) for (const r of rs) resumo[r.lote_id] = r; else semDetalhe = true;
    saldos = sd; racao = rc; mortes = mt; agua = ag;
    if (rc) db.kvSet('racao14', rc).catch(() => {}); // sem sinal, "ração dada hoje" continua com o que já foi enviado
    if (ag) db.kvSet('agua14', ag).catch(() => {});
  } else {
    const g = await ctx.api.resumoGuardado().catch(() => null);
    if (g) for (const r of g) resumo[r.lote_id] = r; else semDetalhe = true;
    const rg = await db.kvGet('racao14').catch(() => null);
    if (Array.isArray(rg)) racao = rg.filter((r) => r.data >= desde(13));
    const ag = await db.kvGet('agua14').catch(() => null);
    if (Array.isArray(ag)) agua = ag.filter((r) => r.data >= desde(13));
  }
  const numerosGuardados = !semDetalhe && (!navigator.onLine || !!ctx.state.semRede);

  const fila = await db.filaList().catch(() => []);
  // peso de hoje (sql/42): a ração lançada neste aparelho e ainda não enviada já faz o peso subir (lançou sem sinal)
  for (const i of fila) {
    if (i.tabela !== 'racao_consumo' || !i.payload) continue;
    const r = resumo[i.payload.lote_id];
    if (!r || r.racao_desde_bio_kg == null) continue;
    const kg = Number(i.payload.quantidade_kg) || 0, copia = { ...r };
    copia.racao_kg = (Number(r.racao_kg) || 0) + kg;
    if (!r.ultima_biometria || i.payload.data > r.ultima_biometria) copia.racao_desde_bio_kg = (Number(r.racao_desde_bio_kg) || 0) + kg;
    else copia.racao_ate_bio_kg = (Number(r.racao_ate_bio_kg) || 0) + kg;
    resumo[i.payload.lote_id] = copia;
  }
  const pendHoje = fila.filter((i) => i.tabela === 'racao_consumo' && i.payload.data === hoje);
  const racaoHojeLocal = new Set(pendHoje.map((i) => i.payload.tanque_id));
  // água medida neste aparelho e ainda não enviada também conta
  const aguaFila = fila.filter((i) => i.tabela === 'qualidade_agua').map((i) => i.payload);

  // ração por tanque: hoje (banco + o que ainda está no aparelho) e a média dos dias com ração na última semana
  const porTanque = {};
  const dias14 = Array.from({ length: 14 }, (_, i) => desde(13 - i));
  const porDia = Object.fromEntries(dias14.map((d) => [d, 0]));
  const t0 = (id) => (porTanque[id] ||= { hojeKg: 0, semana: {} });
  for (const r of racao || []) {
    const kg = Number(r.quantidade_kg) || 0;
    if (r.data in porDia) porDia[r.data] += kg;
    const t = t0(r.tanque_id);
    if (r.data === hoje) t.hojeKg += kg;
    else if (r.data >= desde(7)) t.semana[r.data] = (t.semana[r.data] || 0) + kg;
  }
  for (const i of pendHoje) { const kg = Number(i.payload.quantidade_kg) || 0; t0(i.payload.tanque_id).hojeKg += kg; porDia[hoje] += kg; }
  const mediaKg = (id) => { const s = Object.values((porTanque[id] || {}).semana || {}); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
  const hojeKg = (id) => (porTanque[id] || {}).hojeKg || 0;

  const status = {};
  for (const t of tanques) status[t.id] = statusTanque(t, lotes, resumo, racaoHojeLocal, hoje);

  // última medição de água de cada tanque (servidor + aparelho)
  const ultimaAgua = {};
  for (const m of [...(agua || []), ...aguaFila]) { const u = ultimaAgua[m.tanque_id]; if (!u || `${m.data} ${m.hora || ''}` >= `${u.data} ${u.hora || ''}`) ultimaAgua[m.tanque_id] = m; }
  // a fazenda mede a água? (alguma medição nos 14 dias). Quem não mede não recebe "Água: medir" todo dia.
  const medeAgua = Object.keys(ultimaAgua).length > 0;

  const lotesDe = (id) => lotes.filter((l) => l.tanque_id === id);
  const sugestao = (id) => (semDetalhe ? null : sugestaoRacao(lotesDe(id), resumo, TAXA_RACAO));
  const fase = (id) => { const ls = lotesDe(id); return ls.length > 1 ? `${ls.length} lotes` : ls.length ? ROTULO_TIPO[ls[0].tipo] || ls[0].tipo : 'Sem peixes'; };

  return { hoje, desde, resumo, semDetalhe, numerosGuardados, saldos, racao, mortes, agua, porTanque, porDia, dias14, mediaKg, hojeKg, status, racaoHojeLocal, ultimaAgua, medeAgua, lotesDe, sugestao, fase };
}

// O que falta em um tanque hoje, em palavras do produtor. Devolve itens { tom: 'ok'|'falta'|'ruim'|'', txt }.
//  - ração: "✓ 2 sacos" ou "dar 2 sacos" (média da semana; sem média, a sugestão pelo peso)
//  - água: "✓ água ok", "O₂ 3,1 baixo" ou "medir água" (só se a fazenda mede água)
//  - pesar: lote há mais de 30 dias sem pesagem
export function situacaoTanque(D, t, f) {
  if (D.status[t.id] === 'semlote') return { racao: null, agua: null, pesar: false, itens: [] }; // o "Sem peixes" já aparece ao lado do nome
  const itens = [];
  let racao;
  if (D.status[t.id] === 'ok') {
    const kg = D.hojeKg(t.id);
    racao = { tom: 'ok', txt: kg ? `✓ Ração ${f.nSacos(f.sacos(kg))}` : '✓ Alimentado', curto: kg ? `✓ ${f.nSacos(f.sacos(kg))}` : '✓ ração' };
  } else {
    const m = D.mediaKg(t.id), sg = m ? null : D.sugestao(t.id);
    const qt = m ? f.nSacos(f.sacos(m)) : sg && sg.kg > 0 ? `~${f.nSug(sg.kg)}` : '';
    racao = { tom: 'falta', txt: qt ? `Ração: dar ${qt}` : 'Ração: lançar', curto: qt ? `ração: ${qt}` : 'ração' };
  }
  itens.push(racao);
  let agua = null;
  const m = D.ultimaAgua[t.id];
  if (m && m.data === D.hoje) {
    const tambaqui = D.lotesDe(t.id).some((l) => ehTambaqui(l.especie));
    const crit = tambaqui ? avaliarAgua(m).filter((x) => x.nivel === 'critico') : [];
    const od = m.oxigenio_mgl == null || m.oxigenio_mgl === '' ? null : Number(m.oxigenio_mgl);
    const odBaixo = crit.some((x) => /oxigênio/.test(x.texto));
    agua = crit.length ? { tom: 'ruim', txt: odBaixo ? `Oxigênio ${fmtNum(od, 1)} baixo` : 'Água fora da faixa', curto: odBaixo ? `O₂ ${fmtNum(od, 1)} baixo` : 'água fora da faixa' }
      : { tom: 'ok', txt: '✓ Água ok', curto: '✓ água', od };
  } else if (D.medeAgua) agua = { tom: 'falta', txt: 'Água: medir', curto: 'medir água' };
  if (agua) itens.push(agua);
  const pesar = !D.semDetalhe && D.lotesDe(t.id).some((l) => {
    const r = D.resumo[l.id], ult = (r && r.ultima_biometria) || l.data_entrada;
    return ult && diasEntre(ult, D.hoje) > ALERTAS.biometriaDias;
  });
  if (pesar) itens.push({ tom: 'falta', txt: 'Pesar', curto: 'pesar' });
  return { racao, agua, pesar, itens };
}

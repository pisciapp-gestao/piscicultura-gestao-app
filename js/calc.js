// Cálculos do relatório de um lote (puros, testáveis em Node)
import { diasEntre, fmtInt, fmtNum, pesoMedioTxt } from './util.js';
import { AGUA_TAMBAQUI as AG } from './config.js';

const soma = (arr, k) => arr.reduce((s, x) => s + Number(x[k] || 0), 0);

// Peixes que continuam no tanque: entrada − mortos − retirados nas despescas (linha do resumo_lotes)
export const vivosDoLote = (l, r) => Math.max(0, (Number(l.quantidade_inicial) || 0) - Number((r && r.mortos) || 0) - Number((r && r.despescados) || 0));

// Números de uma despesca. Sem peso líquido, os campos dele ficam null.
export function indicadoresDespesca(d, areaHa) {
  const q = Number(d.quantidade), b = Number(d.peso_bruto_kg), l = d.peso_liquido_kg == null ? null : Number(d.peso_liquido_kg);
  return {
    medioBrutoKg: q > 0 ? b / q : null,
    medioLiquidoKg: q > 0 && l != null ? l / q : null,
    difKg: l != null ? b - l : null,
    difPct: l != null && b > 0 ? ((b - l) / b) * 100 : null,
    peixesHa: Number(areaHa) > 0 && q > 0 ? q / Number(areaHa) : null,
    receita: Number(d.preco_kg) > 0 && b > 0 ? b * Number(d.preco_kg) : null, // sobre o peso bruto
  };
}

// Confere o peso médio de uma pesagem com a última do lote (r: linha do resumo; sem biometria, vale o peso da entrada).
// Destoa quando cai a menos de 1/3 ou passa de 3× o anterior mais 20 g por dia, folga maior que o crescimento real.
// Pega kg no lugar de g e ponto de milhar lido como decimal. Devolve o texto da pergunta, ou null se está normal.
export function avisoPesoMedio({ quantidade, pesoTotalKg, lote, r, data }) {
  const qi = Number(lote.quantidade_inicial) || 0;
  const temBio = !!(r && r.ultimo_peso_medio_kg != null);
  const ref = temBio ? Number(r.ultimo_peso_medio_kg) : qi > 0 ? Number(lote.peso_inicial_kg) / qi : null;
  const pm = quantidade > 0 ? pesoTotalKg / quantidade : null;
  if (!(ref > 0) || !(pm > 0)) return null;
  const dias = Math.max(0, diasEntre((temBio && r.ultima_biometria) || lote.data_entrada, data)) || 0;
  const plausivel = (x) => x >= ref / 3 && x <= ref * 3 + 0.02 * dias;
  if (plausivel(pm)) return null;
  const total = fmtNum(pesoTotalKg, Number.isInteger(pesoTotalKg) ? 0 : 3);
  // 2.400 digitado em gramas num campo de kg vira 2.400 kg por peixe ("2.400.000 g" no relatório): avisa a unidade
  const gramas = pm > ref && Math.abs(Math.log(pm / 1000 / ref)) < Math.abs(Math.log(pm / ref)) ? `Parece que o peso foi digitado em gramas: ${total} g = ${fmtNum(pesoTotalKg / 1000, 3)} kg. ` : '';
  return `${gramas}${fmtInt(quantidade)} ${quantidade === 1 ? 'peixe' : 'peixes'} em ${total} kg dá ${pesoMedioTxt(pm)} por peixe. ${temBio ? 'A última pesagem foi' : 'Na entrada eram'} ${pesoMedioTxt(ref)} por peixe. Está certo?`;
}

export function pesoMedioKg(b) {
  const q = Number(b.quantidade_amostrada);
  return q > 0 ? Number(b.peso_amostra_kg) / q : null;
}

/**
 * lote: {data_entrada, quantidade_inicial, peso_inicial_kg}
 * bios: biometrias ordenadas por data; mort: mortalidade; rac: consumo de ração
 * precoKg: preço médio do kg de ração (R$) ou null
 * desp: despescas do lote (parciais e total)
 *
 * Convenções (mostradas no relatório como "estimado"):
 *  - peso_inicial_kg é o peso TOTAL do lote na entrada
 *  - biomassa atual = peixes vivos estimados × peso médio da última biometria
 *  - conversão alimentar = ração fornecida até a última biometria ÷ ganho de biomassa
 *  - peixe despescado sai dos vivos, mas o peso bruto dele conta como ganho
 *  - lote encerrado por despesca total: números reais (peso retirado e toda a ração), sem estimativa
 */
export function calcularLote(lote, bios, mort, rac, hoje, precoKg = null, desp = []) {
  const qtdInicial = Number(lote.quantidade_inicial);
  const mortos = soma(mort, 'quantidade');
  const despescados = soma(desp, 'quantidade');
  const pesoDespescado = soma(desp, 'peso_bruto_kg');
  const comPreco = desp.filter((d) => Number(d.preco_kg) > 0);
  const receita = comPreco.length ? comPreco.reduce((s, d) => s + Number(d.peso_bruto_kg) * Number(d.preco_kg), 0) : null;
  const fechado = !lote.ativo && desp.some((d) => d.tipo === 'total'); // a despesca total contou os peixes de verdade
  const vivos = fechado ? 0 : Math.max(0, qtdInicial - mortos - despescados);
  const racaoTotal = soma(rac, 'quantidade_kg');
  const biomassaInicial = Number(lote.peso_inicial_kg);
  const pmInicial = qtdInicial > 0 ? biomassaInicial / qtdInicial : null; // kg

  const ultima = bios.length ? bios[bios.length - 1] : null;
  const pmAtual = ultima ? pesoMedioKg(ultima) : null; // kg
  const biomassaAtual = fechado ? 0 : pmAtual != null ? vivos * pmAtual : null;
  const ganhoBiomassa = biomassaAtual != null ? biomassaAtual + pesoDespescado - biomassaInicial : null;

  const racaoAteBio = fechado ? racaoTotal : ultima ? soma(rac.filter((r) => r.data <= ultima.data), 'quantidade_kg') : null;

  // Lote cadastrado "em andamento" (peixe já estava no tanque): a ração só começou a ser lançada no app
  // semanas depois da entrada. Comparar o ganho desde a entrada com a ração de poucos dias dava CA 0,02.
  // Nesse caso a conta começa na pesagem que marcou o início no app (a última até a 1ª ração lançada).
  const datasRac = rac.map((r) => r.data).filter(Boolean).sort();
  const primeiraRacao = datasRac[0] || null;
  const andamento = !fechado && primeiraRacao && diasEntre(lote.data_entrada, primeiraRacao) > 7;
  const base = andamento ? [...bios].reverse().find((b) => b.data <= primeiraRacao) : null;
  let ganhoCA = ganhoBiomassa, racaoCA = racaoAteBio;
  if (andamento) {
    if (base && ultima && ultima.data > base.data && pmAtual != null) {
      const antes = (lista, campo) => soma(lista.filter((x) => x.data <= base.data), campo);
      const vivosBase = Math.max(0, qtdInicial - antes(mort, 'quantidade') - antes(desp, 'quantidade'));
      const despDepois = soma(desp.filter((d) => d.data > base.data), 'peso_bruto_kg');
      ganhoCA = vivos * pmAtual + despDepois - vivosBase * pesoMedioKg(base);
      racaoCA = soma(rac.filter((r) => r.data >= base.data && r.data <= ultima.data), 'quantidade_kg');
    } else { ganhoCA = null; racaoCA = null; } // falta uma pesagem depois do início no app
  }
  // sem ração lançada até a última biometria não há conversão para calcular (mostrar 0,00 enganava)
  const ca = ganhoCA != null && ganhoCA > 0 && racaoCA > 0 ? racaoCA / ganhoCA : null;

  const diasCultivo = Math.max(0, diasEntre(lote.data_entrada, hoje));
  const diasAteBio = ultima ? diasEntre(lote.data_entrada, ultima.data) : null;
  const gpd = pmAtual != null && pmInicial != null && diasAteBio > 0 ? ((pmAtual - pmInicial) * 1000) / diasAteBio : null; // g/dia

  return {
    mortos,
    vivos,
    despescados,
    pesoDespescado,
    receita,
    despescasSemPreco: desp.length - comPreco.length,
    // retirado também sobreviveu; na despesca total vale a contagem real (no máximo 100%)
    sobrevivencia: qtdInicial > 0 ? Math.min(100, ((fechado ? despescados : Math.max(0, qtdInicial - mortos)) / qtdInicial) * 100) : null,
    racaoTotal,
    racaoMediaDia: diasCultivo > 0 ? racaoTotal / diasCultivo : null,
    diasCultivo,
    pmInicialG: pmInicial != null ? pmInicial * 1000 : null,
    pmAtualG: pmAtual != null ? pmAtual * 1000 : null,
    dataUltimaBio: ultima ? ultima.data : null,
    biomassaInicial,
    biomassaAtual,
    ganhoBiomassa,
    ca,
    gpd,
    custoRacao: precoKg != null ? racaoTotal * precoKg : null,
    // custo da ração por kg de peixe produzido (ração até a última biometria ÷ ganho de biomassa)
    custoKgProduzido: precoKg != null && ganhoCA > 0 && racaoCA > 0 ? (racaoCA * precoKg) / ganhoCA : null,
    // lote em andamento sem pesagem depois do início no app: a conversão aparece depois da próxima pesagem
    caAguardaPesagem: andamento && ca == null,
  };
}

// Preço médio do kg de ração a partir das compras que têm custo informado
export function precoMedioKg(compras) {
  const com = compras.filter((c) => c.custo_total != null && Number(c.custo_total) > 0);
  const kg = soma(com, 'quantidade_kg');
  return kg > 0 ? soma(com, 'custo_total') / kg : null;
}

// Pontos do gráfico de peso médio (g): entrada + biometrias
export function pontosPeso(lote, bios) {
  const pts = [];
  const qi = Number(lote.quantidade_inicial);
  if (qi > 0) pts.push({ data: lote.data_entrada, g: (Number(lote.peso_inicial_kg) / qi) * 1000, inicial: true });
  for (const b of bios) {
    const pm = pesoMedioKg(b);
    if (pm != null) pts.push({ data: b.data, g: pm * 1000 });
  }
  return pts;
}

// Evolução entre biometrias: peso médio (g) e ganho diário (g/dia) em relação ao ponto anterior (entrada incluída)
export function evolucaoPeso(lote, bios) {
  const pts = pontosPeso(lote, bios);
  return pts.map((p, i) => {
    const ant = i ? pts[i - 1] : null;
    const dias = ant ? diasEntre(ant.data, p.data) : null;
    return { data: p.data, g: p.g, inicial: !!p.inicial, ganhoDia: ant && dias > 0 ? (p.g - ant.g) / dias : null };
  });
}

// Data ISO (YYYY-MM-DD) somada de n dias; null se a data ou o n forem inválidos (nunca quebra a tela)
export function somarDias(iso, n) {
  if (!dataValida(iso) || n === null || n === '' || !Number.isFinite(Number(n))) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// data YYYY-MM-DD que existe no calendário (2026-02-30 e 2026-13-01 não)
export function dataValida(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return false;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso.slice(0, 10);
}

// Segunda-feira da semana (YYYY-MM-DD) de uma data ISO; null se a data for inválida
export function inicioSemana(iso) {
  if (!dataValida(iso)) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return somarDias(String(iso).slice(0, 10), -((d.getUTCDay() + 6) % 7)); // segunda = 0
}

// Ração somada por semana, da mais antiga para a mais recente
export function racaoPorSemana(rac) {
  const m = new Map();
  for (const r of rac) {
    const sem = inicioSemana(r.data); if (!sem) continue; // lançamento sem data válida fica fora do gráfico por semana
    m.set(sem, (m.get(sem) || 0) + (Number(r.quantidade_kg) || 0));
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([inicio, kg]) => ({ inicio, kg }));
}

// Matriz dias × tanques: linhas do dia mais recente ao mais antigo (inclui dias sem lançamento)
export function matrizRacao(linhas, tanqueIds, dias, hoje) {
  const celulas = new Map(); // "data|tanque" -> kg
  for (const r of linhas) {
    const k = `${r.data}|${r.tanque_id}`;
    celulas.set(k, (celulas.get(k) || 0) + Number(r.quantidade_kg || 0));
  }
  const datas = [];
  for (let i = 0; i < dias; i++) { const d = somarDias(hoje, -i); if (d) datas.push(d); }
  const totalTanque = Object.fromEntries(tanqueIds.map((t) => [t, 0]));
  const rows = datas.map((data) => {
    const por = {}; let total = 0;
    for (const t of tanqueIds) {
      const v = celulas.get(`${data}|${t}`);
      por[t] = v == null ? null : v;
      if (v != null) { total += v; totalTanque[t] += v; }
    }
    return { data, por, total };
  });
  return { rows, totalTanque, total: rows.reduce((s, r) => s + r.total, 0) };
}

// Situação do estoque de ração: quantos dias dura no ritmo dos últimos 7 dias.
// nivel: 'sem-dado' | 'ok' | 'atencao' | 'critico' | 'negativo'
// Quanto comprar (kg) para o estoque durar `dias` no ritmo atual (0 se já dá).
export function sugestaoCompraKg(saldoKg, porDiaKg, dias = 30) {
  const porDia = Number(porDiaKg) || 0;
  if (!(porDia > 0)) return 0;
  return Math.max(0, porDia * dias - Math.max(0, Number(saldoKg) || 0));
}

export function situacaoEstoque(saldoKg, consumo7dKg, atencaoDias = 15, criticoDias = 7) {
  const saldo = Number(saldoKg) || 0;
  const porDia = (Number(consumo7dKg) || 0) / 7;
  if (saldo < 0) return { nivel: 'negativo', dias: null, porDia };
  if (!(porDia > 0)) return { nivel: saldo === 0 ? 'critico' : 'sem-dado', dias: null, porDia };
  const dias = saldo / porDia;
  const d = Math.floor(dias);
  const nivel = d <= criticoDias ? 'critico' : d <= atencaoDias ? 'atencao' : 'ok';
  return { nivel, dias, porDia };
}

/**
 * Previsão de despesca de um lote pelo ritmo médio de crescimento desde a entrada.
 * lote: {data_entrada, quantidade_inicial, peso_inicial_kg}; r: linha do resumo_lotes
 * (ultimo_peso_medio_kg, ultima_biometria, mortos); alvoKg: peso médio de despesca.
 * Retorna { estado: 'sem-dado' | 'pronto' | 'previsto', pmKg, alvoKg, pct, gpdG, data, dias, biomassaKg }
 */
export function previsaoDespesca(lote, r, alvoKg, hoje) {
  const qi = Number(lote.quantidade_inicial) || 0;
  const pmIni = qi > 0 ? Number(lote.peso_inicial_kg) / qi : null;
  const pm = r && r.ultimo_peso_medio_kg != null ? Number(r.ultimo_peso_medio_kg) : pmIni;
  const vivos = vivosDoLote(lote, r);
  const base = { pmKg: pm, alvoKg, pct: pm != null && alvoKg > 0 ? Math.min(100, (pm / alvoKg) * 100) : null, biomassaKg: alvoKg * vivos };
  if (pm != null && pm >= alvoKg) return { ...base, estado: 'pronto' };
  const dataBio = r && r.ultima_biometria;
  const dias = dataBio ? diasEntre(lote.data_entrada, dataBio) : 0;
  // ganho abaixo de 0,1 g é arredondamento (19196,10 ÷ 12465 = 1,5399999999999998), não crescimento
  if (pm == null || pmIni == null || !dataBio || !(dias > 0) || pm - pmIni < 1e-4) return { ...base, estado: 'sem-dado' };
  const gpd = (pm - pmIni) / dias; // kg/dia
  // sem crescimento de verdade (menos de 0,1 g por dia, ou só diferença de arredondamento) não dá para prever:
  // a conta jogaria a data para séculos depois e a data inválida quebrava a tela
  if (!(gpd >= 0.0001)) return { ...base, estado: 'sem-dado' };
  const falta = Math.ceil((alvoKg - pm) / gpd);
  if (!(falta >= 0 && falta <= 3650)) return { ...base, estado: 'sem-dado' };
  const data = somarDias(dataBio, falta);
  if (!data) return { ...base, estado: 'sem-dado' };
  return { ...base, estado: 'previsto', gpdG: gpd * 1000, data, dias: Math.max(0, diasEntre(hoje, data)) };
}

// ----- lucro por ciclo -----
// Peso que o lote produziu: o retirado mais o que está na água, menos o que entrou
export const pesoProduzido = (c) => Math.max(0, Number(c && c.ganhoBiomassa) || 0);

// Divide cada despesa geral entre os lotes em cultivo na data, proporcional ao peso produzido.
// ciclos: [{ id, ini, fim, peso }]. Despesa sem lote com peso na data fica em semRateio.
export function ratearDespesas(despesas, ciclos) {
  const porLote = {}; let semRateio = 0;
  for (const d of despesas || []) {
    const v = Number(d.valor) || 0;
    const ativos = ciclos.filter((c) => c.ini <= d.data && d.data <= c.fim && c.peso > 0);
    const soma = ativos.reduce((s, c) => s + c.peso, 0);
    if (!(soma > 0)) { semRateio += v; continue; }
    for (const c of ativos) porLote[c.id] = (porLote[c.id] || 0) + (v * c.peso) / soma;
  }
  return { porLote, semRateio };
}

// Conta do ciclo. Sem receita não há lucro; o que faltar é listado em vez de virar zero.
export function fecharCiclo({ c, custoAlevino = null, despesas = 0, fechado = false }) {
  const faltando = [];
  if (c.receita == null) faltando.push('preço de venda na despesca');
  else if (c.despescasSemPreco) faltando.push(`preço em ${c.despescasSemPreco} ${c.despescasSemPreco === 1 ? 'despesca' : 'despescas'}`);
  if (custoAlevino == null) faltando.push('custo do alevino');
  if (c.custoRacao == null) faltando.push('valor pago nas compras de ração');
  const custoTotal = Number(c.custoRacao || 0) + Number(custoAlevino || 0) + Number(despesas || 0);
  const lucro = c.receita != null ? c.receita - custoTotal : null;
  return {
    receita: c.receita, custoRacao: c.custoRacao, custoAlevino, despesas, custoTotal, lucro, faltando,
    completo: fechado && !faltando.length,
    margem: lucro != null && c.receita > 0 ? lucro / c.receita : null,
    custoKg: c.pesoDespescado > 0 ? custoTotal / c.pesoDespescado : null,
  };
}

// Confere uma medição da água com a faixa do tambaqui. critico = pede ação; atencao = fora do ideal.
export const ehTambaqui = (especie) => /tambaqui/i.test(String(especie || ''));
export function avaliarAgua(m) {
  const v = (k) => (m[k] == null || m[k] === '' ? null : Number(m[k]));
  const fora = [], od = v('oxigenio_mgl'), t = v('temperatura_c'), ph = v('ph'), am = v('amonia_mgl');
  if (od != null && od < AG.oxigenio.min) fora.push({ nivel: 'critico', texto: `oxigênio baixo (${fmtNum(od, 1)} mg/L, mínimo ${AG.oxigenio.min})` });
  if (t != null && t < AG.temperatura.letal) fora.push({ nivel: 'critico', texto: `temperatura perigosa (${fmtNum(t, 1)} °C, abaixo de ${AG.temperatura.letal} causa mortalidade)` });
  else if (t != null && (t < AG.temperatura.min || t > AG.temperatura.max)) fora.push({ nivel: 'atencao', texto: `temperatura fora do ideal (${fmtNum(t, 1)} °C, ideal ${AG.temperatura.min} a ${AG.temperatura.max})` });
  if (ph != null && (ph < AG.ph.min || ph > AG.ph.max)) fora.push({ nivel: 'critico', texto: `pH fora da faixa (${fmtNum(ph, 1)}, faixa ${AG.ph.min} a ${AG.ph.max})` });
  if (am != null && am >= AG.amonia.max) fora.push({ nivel: 'critico', texto: `amônia tóxica alta (${fmtNum(am, 2)} mg/L, limite ${fmtNum(AG.amonia.max, 2)})` });
  return fora;
}

/**
 * Alertas de manejo (funções puras, testáveis em Node).
 * lotes: ativos; resumo: {lote_id: linha do resumo_lotes}; racaoHoje/mediaSemana: {tanque_id: kg};
 * mortes: [{data, lote_id, quantidade}] dos últimos dias; cfg: { biometriaDias, racaoDesvio, morteDiasSeguidos }.
 * Retorna [{ tipo: 'biometria' | 'racao' | 'morte', tanques: [tanque_id], ...detalhes }]
 */
export function alertasManejo({ lotes, resumo, racaoHoje, mediaSemana, mortes, hoje, cfg, agua = [] }) {
  const out = [];
  // 0) água: a medição mais recente de cada tanque com tambaqui, se for de hoje ou de ontem
  const comTambaqui = new Set(lotes.filter((l) => ehTambaqui(l.especie)).map((l) => l.tanque_id));
  const ultima = {};
  for (const m of agua) { const u = ultima[m.tanque_id]; if (!u || `${m.data} ${m.hora || ''}` >= `${u.data} ${u.hora || ''}`) ultima[m.tanque_id] = m; }
  const ruins = [];
  for (const [t, m] of Object.entries(ultima)) {
    if (!comTambaqui.has(t) || diasEntre(m.data, hoje) > 1) continue;
    const crit = avaliarAgua(m).filter((x) => x.nivel === 'critico');
    if (crit.length) ruins.push({ tanque: t, data: m.data, problemas: crit.map((x) => x.texto) });
  }
  if (ruins.length) out.push({ tipo: 'agua', itens: ruins });
  // 1) biometria vencida: última pesagem (ou a entrada, se nunca pesou) há mais de N dias
  const vencidos = [];
  for (const l of lotes) {
    const r = resumo[l.id];
    const ref = (r && r.ultima_biometria) || l.data_entrada;
    const dias = diasEntre(ref, hoje);
    if (dias > cfg.biometriaDias) vencidos.push({ tanque: l.tanque_id, lote: l.id, dias, nunca: !(r && r.ultima_biometria) });
  }
  if (vencidos.length) out.push({ tipo: 'biometria', itens: vencidos.sort((a, b) => b.dias - a.dias) });
  // 2) ração de hoje fora da média da semana (só tanques que já receberam hoje e têm média)
  const fora = [];
  for (const [tid, kg] of Object.entries(racaoHoje || {})) {
    const m = (mediaSemana || {})[tid];
    if (!(kg > 0) || !(m > 0)) continue;
    const desvio = kg / m - 1;
    if (Math.abs(desvio) >= cfg.racaoDesvio - 1e-9) fora.push({ tanque: tid, kg, media: m, desvio });
  }
  if (fora.length) out.push({ tipo: 'racao', itens: fora.sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio)) });
  // 3) mortes no mesmo tanque em N dias seguidos, terminando ontem ou hoje
  const tanqueDoLote = Object.fromEntries(lotes.map((l) => [l.id, l.tanque_id]));
  const diasPorTanque = {};
  for (const m of mortes || []) {
    const t = tanqueDoLote[m.lote_id]; if (!t || !(Number(m.quantidade) > 0)) continue;
    const d = (diasPorTanque[t] ||= {}); d[m.data] = (d[m.data] || 0) + Number(m.quantidade);
  }
  const repetidas = [];
  for (const [t, d] of Object.entries(diasPorTanque)) {
    for (const fim of [0, 1]) { // sequência que termina hoje ou ontem
      let seq = 0, total = 0;
      for (let i = fim; ; i++) {
        const iso = somarDias(hoje, -i);
        if (!iso || !d[iso]) break;
        seq++; total += d[iso];
      }
      if (seq >= cfg.morteDiasSeguidos) { repetidas.push({ tanque: t, dias: seq, total }); break; }
    }
  }
  if (repetidas.length) out.push({ tipo: 'morte', itens: repetidas.sort((a, b) => b.dias - a.dias || b.total - a.total) });
  return out;
}

// Data de fim de um lote encerrado: a despesca total ou, sem ela, o último registro
export function fimDoLote(lote, bios, mort, rac, hoje, desp = []) {
  if (lote.ativo) return hoje;
  const totais = desp.filter((d) => d.tipo === 'total').map((d) => d.data).sort();
  if (totais.length) return totais[totais.length - 1]; // a despesca total é o fim de verdade
  const ds = [...bios, ...mort, ...rac, ...desp].map((x) => x.data).sort();
  return ds.length ? ds[ds.length - 1] : lote.data_entrada;
}

// O mesmo cálculo do lote, mas só com o que aconteceu até "dias" depois da entrada (comparar ciclos na mesma idade)
export function calcularNaIdade(lote, bios, mort, rac, dias, precoKg = null, desp = []) {
  const corte = somarDias(lote.data_entrada, dias);
  if (!corte) return null; // sem data de entrada válida não dá para recortar na mesma idade
  const ate = (x) => x.data <= corte;
  return calcularLote(lote, bios.filter(ate), mort.filter(ate), rac.filter(ate), corte, precoKg, desp.filter(ate));
}

// média de um campo numérico, ignorando vazios
export const mediaDe = (lista, k) => { const v = lista.map((x) => x && x[k]).filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

// Sugestão de ração do dia de um tanque: biomassa (vivos × peso médio) × taxa da faixa de peso.
// lotes: os lotes ativos do tanque; resumo: {lote_id: linha}; tabela: TAXA_RACAO. Retorna null sem dados.
export function sugestaoRacao(lotes, resumo, tabela) {
  let kg = 0, bio = 0, provisoria = false, taxas = new Set();
  for (const l of lotes) {
    const r = resumo[l.id];
    const qi = Number(l.quantidade_inicial) || 0;
    const pm = r && r.ultimo_peso_medio_kg != null ? Number(r.ultimo_peso_medio_kg) : qi > 0 ? Number(l.peso_inicial_kg) / qi : null;
    if (!(pm > 0)) continue;
    const vivos = vivosDoLote(l, r);
    const faixa = tabela.find((f) => pm <= f.ateKg) || tabela[tabela.length - 1];
    const b = vivos * pm;
    bio += b; kg += (b * faixa.pct) / 100; taxas.add(faixa.pct);
    if (faixa.provisoria) provisoria = true;
  }
  if (!(kg > 0)) return null;
  return { kg, biomassaKg: bio, pct: taxas.size === 1 ? [...taxas][0] : (kg / bio) * 100, provisoria };
}

// Ração de cada lote: berçário e alevinagem usam ração de alevino; recria e engorda, a de engorda (igual ao sql/18).
export const tipoRacaoDoLote = (tipoLote) => (tipoLote === 'alevinagem' || tipoLote === 'bercario' ? 'alevino' : 'engorda');

// Preço do kg da ração que ESTE lote come: média das compras daquele tipo (alevino é mais cara que engorda).
// Sem compra com valor daquele tipo (ou compras antigas sem tipo), usa a média de todas.
export function precoRacaoDoLote(compras, tipoLote) {
  const tipo = tipoRacaoDoLote(tipoLote);
  const doTipo = (compras || []).filter((c) => (c.tipo_racao || 'engorda') === tipo);
  return precoMedioKg(doTipo) ?? precoMedioKg(compras || []);
}

// Quanto falta no estoque registrado para cobrir um lançamento de ração (kg). O saldo do servidor ainda não conta o que
// está na fila do celular sem enviar, por isso desconta os pendentes. 0 = o estoque cobre; null = saldo desconhecido.
export function faltaNoEstoque(saldoKg, pendentesKg, lancarKg) {
  if (saldoKg == null || saldoKg === '' || !Number.isFinite(Number(saldoKg))) return null;
  const resta = Number(saldoKg) - (Number(pendentesKg) || 0) - (Number(lancarKg) || 0);
  return resta < 0 ? Math.round(-resta * 100) / 100 : 0;
}

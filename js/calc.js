// Cálculos do relatório de um lote (puros, testáveis em Node)
import { diasEntre, fmtInt, fmtNum, pesoMedioTxt } from './util.js';
import { AGUA_TAMBAQUI as AG, TABELA_ALIMENTAR, TABELA_PEIXES } from './config.js';

const soma = (arr, k) => arr.reduce((s, x) => s + Number(x[k] || 0), 0);

// Peixes que continuam no tanque: entrada − mortos − retirados nas despescas − transferidos para outros tanques (linha do resumo_lotes)
export const vivosDoLote = (l, r) => Math.max(0, (Number(l.quantidade_inicial) || 0) - Number((r && r.mortos) || 0) - Number((r && r.despescados) || 0) - Number((r && r.transferidos) || 0));

// Números de uma despesca. Sem peso líquido, os campos dele ficam null.
export function indicadoresDespesca(d, areaHa) {
  const q = Number(d.quantidade), b = Number(d.peso_bruto_kg), l = d.peso_liquido_kg == null ? null : Number(d.peso_liquido_kg);
  return {
    medioBrutoKg: q > 0 ? b / q : null,
    medioLiquidoKg: q > 0 && l != null ? l / q : null,
    difKg: l != null ? b - l : null,
    difPct: l != null && b > 0 ? ((b - l) / b) * 100 : null,
    peixesHa: Number(areaHa) > 0 && q > 0 ? q / Number(areaHa) : null,
    // receita sobre o peso VENDIDO: o líquido quando informado (o bruto menos a quebra), senão o bruto
    kgVendido: l != null && l > 0 ? l : b,
    receitaSobre: l != null && l > 0 ? 'líquido' : 'bruto',
    receita: Number(d.preco_kg) > 0 && b > 0 ? (l != null && l > 0 ? l : b) * Number(d.preco_kg) : null,
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
export function calcularLote(lote, bios, mort, rac, hoje, precoKg = null, desp = [], transf = []) {
  // transferências (sql/37): saídas = peixes que foram para outros tanques (não é venda); entradas = vieram de outro tanque.
  // Quem chegou já está somado na entrada do lote (quantidade e peso iniciais); a ração da origem vem junto como custo.
  const saidas = (transf || []).filter((t) => t.lote_origem === lote.id);
  const entradas = (transf || []).filter((t) => t.lote_destino === lote.id);
  const transferidos = soma(saidas, 'quantidade');
  const pesoTransferido = saidas.reduce((s, t) => s + Number(t.quantidade) * Number(t.peso_medio_kg), 0);
  const racaoHerdada = soma(entradas, 'racao_kg');
  const racaoRepassada = soma(saidas, 'racao_kg');
  const qtdInicial = Number(lote.quantidade_inicial);
  const mortos = soma(mort, 'quantidade');
  const despescados = soma(desp, 'quantidade');
  const pesoDespescado = soma(desp, 'peso_bruto_kg');
  const comPreco = desp.filter((d) => Number(d.preco_kg) > 0);
  // kg vendido de cada despesca: o peso líquido quando informado, senão o bruto (pedido do cliente piloto, 15/11/2026)
  const vendido = (d) => (d.peso_liquido_kg != null && Number(d.peso_liquido_kg) > 0 ? Number(d.peso_liquido_kg) : Number(d.peso_bruto_kg) || 0);
  const pesoVendido = desp.reduce((s, d) => s + vendido(d), 0);
  const receita = comPreco.length ? comPreco.reduce((s, d) => s + vendido(d) * Number(d.preco_kg), 0) : null;
  const receitaSobreBruto = comPreco.filter((d) => !(d.peso_liquido_kg != null && Number(d.peso_liquido_kg) > 0)).length;
  const despTotal = desp.some((d) => d.tipo === 'total');
  const tudoTransferido = !lote.ativo && !despTotal && saidas.some((t) => t.encerrou_origem); // esvaziou numa transferência
  const fechado = !lote.ativo && (despTotal || tudoTransferido); // a despesca total (ou a transferência final) contou os peixes de verdade
  const vivos = fechado ? 0 : Math.max(0, qtdInicial - mortos - despescados - transferidos);
  const racaoTotal = soma(rac, 'quantidade_kg');
  const biomassaInicial = Number(lote.peso_inicial_kg);
  const pmInicial = qtdInicial > 0 ? biomassaInicial / qtdInicial : null; // kg

  const ultima = bios.length ? bios[bios.length - 1] : null;
  const pmAtual = ultima ? pesoMedioKg(ultima) : null; // kg
  const biomassaAtual = fechado ? 0 : pmAtual != null ? vivos * pmAtual : null;
  const ganhoBiomassa = biomassaAtual != null ? biomassaAtual + pesoDespescado + pesoTransferido - biomassaInicial : null;

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
      const vivosBase = Math.max(0, qtdInicial - antes(mort, 'quantidade') - antes(desp, 'quantidade') - antes(saidas, 'quantidade'));
      const despDepois = soma(desp.filter((d) => d.data > base.data), 'peso_bruto_kg')
        + saidas.filter((t) => t.data > base.data).reduce((s, t) => s + Number(t.quantidade) * Number(t.peso_medio_kg), 0);
      ganhoCA = vivos * pmAtual + despDepois - vivosBase * pesoMedioKg(base);
      racaoCA = soma(rac.filter((r) => r.data >= base.data && r.data <= ultima.data), 'quantidade_kg');
    } else { ganhoCA = null; racaoCA = null; } // falta uma pesagem depois do início no app
  }
  // sem ração lançada até a última biometria não há conversão para calcular (mostrar 0,00 enganava)
  const ca = ganhoCA != null && ganhoCA > 0 && racaoCA > 0 ? racaoCA / ganhoCA : null;

  // Peso de HOJE estimado pela ração dada desde a última pesagem (tambaqui, pela tabela de alimentação).
  // Sem biometria, a base é a entrada (só se a ração foi lançada desde o começo). A próxima biometria corrige.
  const est = !fechado && lote.ativo && ehTambaqui(lote.especie)
    ? (() => {
      const baseData = ultima ? ultima.data : andamento ? null : lote.data_entrada;
      const pmBase = ultima ? pmAtual : pmInicial;
      if (!baseData || !(pmBase > 0) || !(baseData < hoje)) return null;
      const racaoDesde = soma(rac.filter((r) => r.data > baseData && r.data <= hoje), 'quantidade_kg');
      // quanto este lote gasta em relação à tabela (mesma regra da previsão de ração até vender)
      // lote cadastrado em andamento: compara a partir da pesagem que marcou o início no app
      let fator = null;
      const pmDe = andamento ? (base ? pesoMedioKg(base) : null) : pmInicial;
      const racaoMedida = andamento ? racaoCA : racaoAteBio;
      const peixesMedia = andamento ? vivos : (qtdInicial + vivos) / 2;
      if (ultima && pmDe > 0 && pmAtual > pmDe * 1.2 && racaoMedida > 0) {
        const esperado = racaoTabelaPorPeixe(pmDe, pmAtual) * peixesMedia;
        if (esperado > 0) fator = Math.min(2, Math.max(0.7, racaoMedida / esperado));
      }
      const pm = pesoPelaRacao(pmBase, racaoDesde, vivos, fator);
      // crescer mais que o dobro do que a tabela prevê nesses dias não acontece: é ração lançada a mais (1.000 sacos em vez de 10)
      const maxKg = pmBase + 2 * (pesoTabelaApos(pmBase, diasEntre(baseData, hoje)) - pmBase) + 0.005;
      if (pm != null && pm <= maxKg) return { pm, baseData, racaoDesde, fator };
      // havia ração, peixe e peso, mas a ração não cabe em peixe nenhum: lançamento errado (ex.: 1.000 sacos em vez de 10)
      return racaoDesde > 0 && vivos > 0 ? { pm: null, impossivel: true, baseData, racaoDesde } : null;
    })()
    : null;

  const diasCultivo = Math.max(0, diasEntre(lote.data_entrada, hoje));
  const diasAteBio = ultima ? diasEntre(lote.data_entrada, ultima.data) : null;
  const gpd = pmAtual != null && pmInicial != null && diasAteBio > 0 ? ((pmAtual - pmInicial) * 1000) / diasAteBio : null; // g/dia

  return {
    mortos,
    vivos,
    despescados,
    pesoDespescado,
    pesoVendido,
    receita,
    receitaSobreBruto, // despescas com preço mas sem peso líquido: a receita delas usa o bruto
    despescasSemPreco: desp.length - comPreco.length,
    // retirado também sobreviveu; na despesca total vale a contagem real (no máximo 100%)
    sobrevivencia: qtdInicial > 0 ? Math.min(100, ((fechado ? despescados + transferidos : Math.max(0, qtdInicial - mortos)) / qtdInicial) * 100) : null,
    transferidos,
    pesoTransferido,
    racaoHerdada,
    racaoRepassada,
    tudoTransferido,
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
    // ração que ficou com este lote: a dada aqui + a que veio junto com os peixes − a que foi junto para outros tanques
    custoRacao: precoKg != null ? Math.max(0, racaoTotal + racaoHerdada - racaoRepassada) * precoKg : null,
    // custo da ração por kg de peixe produzido (ração até a última biometria ÷ ganho de biomassa)
    custoKgProduzido: precoKg != null && ganhoCA > 0 && racaoCA > 0 ? (racaoCA * precoKg) / ganhoCA : null,
    // lote em andamento sem pesagem depois do início no app: a conversão aparece depois da próxima pesagem
    caAguardaPesagem: andamento && ca == null,
    // peso de hoje estimado pela ração desde a última pesagem (null: sem ração nova, não é tambaqui ou lote encerrado)
    pmEstimadoG: est && est.pm != null ? est.pm * 1000 : null,
    biomassaEstimada: est && est.pm != null ? vivos * est.pm : null,
    estimadoDesde: est ? est.baseData : null,
    racaoDesdeBio: est ? est.racaoDesde : null,
    // ração lançada desde a pesagem é mais do que os peixes conseguem comer: avisar para conferir os lançamentos
    racaoImpossivel: !!(est && est.impossivel),
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
    custoKg: (c.pesoVendido ?? c.pesoDespescado) > 0 ? custoTotal / (c.pesoVendido ?? c.pesoDespescado) : null, // por kg vendido (líquido)
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
export function fimDoLote(lote, bios, mort, rac, hoje, desp = [], transf = []) {
  if (lote.ativo) return hoje;
  const totais = desp.filter((d) => d.tipo === 'total').map((d) => d.data).sort();
  if (totais.length) return totais[totais.length - 1]; // a despesca total é o fim de verdade
  const final = (transf || []).filter((t) => t.lote_origem === lote.id && t.encerrou_origem).map((t) => t.data).sort();
  if (final.length) return final[final.length - 1]; // esvaziou numa transferência
  const ds = [...bios, ...mort, ...rac, ...desp].map((x) => x.data).sort();
  return ds.length ? ds[ds.length - 1] : lote.data_entrada;
}

// O mesmo cálculo do lote, mas só com o que aconteceu até "dias" depois da entrada (comparar ciclos na mesma idade)
export function calcularNaIdade(lote, bios, mort, rac, dias, precoKg = null, desp = [], transf = []) {
  const corte = somarDias(lote.data_entrada, dias);
  if (!corte) return null; // sem data de entrada válida não dá para recortar na mesma idade
  const ate = (x) => x.data <= corte;
  return calcularLote(lote, bios.filter(ate), mort.filter(ate), rac.filter(ate), corte, precoKg, desp.filter(ate), (transf || []).filter(ate));
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

// Custo do alevino com as transferências (sql/37): o custo vai junto com os peixes, por peixe.
// Ex.: o Samaúma pagou R$ 23.080 por 115.400 alevinos (R$ 0,20 cada) e mandou 5.500 para o Peixinho:
// o Peixinho herda R$ 1.100 e o Samaúma fica com R$ 21.980. Encadeia (berçário → recria → engorda).
// lotes: [{id, quantidade_inicial}] (a entrada já inclui quem chegou); custoDe: {lote_id: R$} do que foi lançado;
// transfs: todas as transferências. Retorna {lote_id: R$ ou null (falta o custo de alguém na cadeia)}.
export function custoAlevinoComTransf(lotes, custoDe, transfs) {
  const porId = new Map(lotes.map((l) => [l.id, l]));
  const ts = transfs || [];
  const bruto = new Map(); // custo antes de mandar peixes adiante: o lançado + o herdado
  const visitando = new Set();
  const custoBruto = (id) => {
    if (bruto.has(id)) return bruto.get(id);
    if (visitando.has(id)) return null; // ciclo (não deveria existir): sem custo
    visitando.add(id);
    const entradas = ts.filter((t) => t.lote_destino === id);
    let herdado = 0, falta = false;
    for (const t of entradas) { const pp = porPeixe(t.lote_origem); if (pp == null) falta = true; else herdado += pp * Number(t.quantidade); }
    const proprio = id in custoDe ? Number(custoDe[id]) : null;
    const v = falta ? null : proprio == null && !entradas.length ? null : (proprio || 0) + herdado;
    visitando.delete(id); bruto.set(id, v);
    return v;
  };
  const porPeixe = (id) => { const l = porId.get(id); const b = custoBruto(id); const q = l ? Number(l.quantidade_inicial) : 0; return b == null || !(q > 0) ? null : b / q; };
  const out = {};
  for (const l of lotes) {
    const b = custoBruto(l.id);
    if (b == null) { out[l.id] = null; continue; }
    const pp = porPeixe(l.id) || 0;
    const saiu = ts.filter((t) => t.lote_origem === l.id).reduce((s, t) => s + pp * Number(t.quantidade), 0);
    out[l.id] = Math.max(0, b - saiu);
  }
  return out;
}

// ----- ração pela tabela de alimentação (pedido do cliente piloto, 16/11/2026) -----
// Ração que UM peixe come pela tabela para ir de pmIni a pmFim (kg). Em cada semana da tabela, a ração por grama
// ganho é a da semana (kg na semana ÷ 40.000 peixes ÷ gramas ganhos). Acima de 3,6 kg segue o ritmo da última semana.
export function racaoTabelaPorPeixe(pmIniKg, pmFimKg, tabela = TABELA_ALIMENTAR) {
  const a = Number(pmIniKg) * 1000, b = Number(pmFimKg) * 1000;
  if (!(a >= 0) || !(b > a)) return 0;
  let kg = 0;
  for (const [, pi, pf, , , , semanaKg] of tabela) {
    const lo = Math.max(a, pi), hi = Math.min(b, pf);
    if (hi > lo) kg += (semanaKg / TABELA_PEIXES) * ((hi - lo) / (pf - pi));
  }
  const ult = tabela[tabela.length - 1];
  if (b > ult[2]) kg += (ult[6] / TABELA_PEIXES / (ult[2] - ult[1])) * (b - Math.max(a, ult[2]));
  return kg;
}

// Peso médio (kg) que a tabela de alimentação prevê depois de "dias" partindo de pmKg (cada linha da tabela é uma semana;
// acima do fim da tabela segue o ritmo da última semana).
export function pesoTabelaApos(pmKg, dias, tabela = TABELA_ALIMENTAR) {
  let g = Number(pmKg) * 1000, resta = Math.max(0, Number(dias) || 0);
  if (!(g > 0)) return null;
  for (const [, pi, pf] of tabela) {
    if (resta <= 0) break;
    if (g >= pf) continue;
    const ritmo = (pf - pi) / 7; // g por dia nessa semana
    const ate = Math.min(resta, (pf - Math.max(g, pi)) / ritmo);
    g = Math.max(g, pi) + ate * ritmo; resta -= ate;
  }
  if (resta > 0) { const u = tabela[tabela.length - 1]; g += resta * ((u[2] - u[1]) / 7); }
  return g / 1000;
}

// Peso médio (kg) a que a ração dada leva os peixes, pela tabela: acha o peso final em que a ração da tabela por peixe,
// de pmBase até ele, iguala a ração dada ÷ peixes vivos (corrigida pelo fator do lote: 1,25 = gasta 25% a mais).
export function pesoPelaRacao(pmBaseKg, racaoKg, vivos, fator = null, tabela = TABELA_ALIMENTAR) {
  const a = Number(pmBaseKg), r = Number(racaoKg), v = Number(vivos);
  if (!(a > 0) || !(r > 0) || !(v > 0)) return null;
  const alvo = r / v / (fator > 0 ? fator : 1);
  const TETO = 30; // kg: nenhum peixe de viveiro chega perto disso
  if (!(a < TETO) || racaoTabelaPorPeixe(a, TETO, tabela) < alvo) return null; // ração demais para os peixes (erro de digitação?): sem estimativa
  let lo = a, hi = TETO;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (racaoTabelaPorPeixe(a, m, tabela) < alvo) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// Linha da tabela para o peso médio atual: qual ração dar e quantas vezes por dia
export function racaoCertaAgora(pmKg, tabela = TABELA_ALIMENTAR) {
  if (!(pmKg > 0)) return null;
  const g = pmKg * 1000;
  const l = tabela.find(([, , pf]) => g <= pf) || tabela[tabela.length - 1];
  return { racao: l[4], tratos: l[5], pct: l[3], semana: l[0] };
}

// Quanto falta de ração até o peso de venda (ou de passar de fase).
// Pela tabela, para os peixes vivos, ajustada pelo que este lote gastou de verdade em relação à tabela até agora
// (fator: 1,25 = gastou 25% a mais que a tabela; só com crescimento medido, entre 0,7 e 2).
// lote, r: linha do resumo_lotes; alvoKg: peso de venda; racaoRealKg: ração dada neste lote.
export function previsaoRacao(lote, r, alvoKg) {
  const qi = Number(lote.quantidade_inicial) || 0;
  const pmIni = qi > 0 ? Number(lote.peso_inicial_kg) / qi : null;
  const pm = r && r.ultimo_peso_medio_kg != null ? Number(r.ultimo_peso_medio_kg) : pmIni;
  if (!(pm > 0) || !(alvoKg > 0)) return null;
  const vivos = vivosDoLote(lote, r);
  const agora = racaoCertaAgora(pm);
  if (pm >= alvoKg || !(vivos > 0)) return { pronto: pm >= alvoKg, faltaKg: 0, tabelaKg: 0, fator: null, agora, vivos, pmKg: pm, alvoKg };
  const tabelaKg = racaoTabelaPorPeixe(pm, alvoKg) * vivos;
  let fator = null;
  const real = Number(r && r.racao_kg) || 0;
  if (pmIni > 0 && pm > pmIni * 1.2 && real > 0) {
    const esperado = racaoTabelaPorPeixe(pmIni, pm) * ((qi + vivos) / 2); // média dos peixes no período
    if (esperado > 0) fator = Math.min(2, Math.max(0.7, real / esperado));
  }
  return { pronto: false, faltaKg: tabelaKg * (fator || 1), tabelaKg, fator, agora, vivos, pmKg: pm, alvoKg };
}

// Qual ração cadastrada (sql/39) corresponde à ração que a tabela de alimentação indica.
// Compara a proteína (28%) e o grão (6 mm): "28% proteína · 10 mm" acha "28% · 6/10 mm". "Inicial" acha "Inicial".
// Se o grão não bater com nenhuma, vale a única com a mesma proteína. Sem certeza, devolve null (sem etiqueta).
function partesRacao(nome) {
  const t = String(nome || '').toLowerCase();
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(t);
  const prot = m ? Number(m[1].replace(',', '.')) : null;
  const resto = m ? t.replace(m[0], ' ') : t;
  const graos = (resto.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
  return { prot, inicial: /inicial/.test(t), graos };
}
export function racaoDaTabela(nomeTabela, racoes) {
  if (!nomeTabela || !Array.isArray(racoes) || !racoes.length) return null;
  const a = partesRacao(nomeTabela);
  const mesmas = racoes.filter((r) => { const b = partesRacao(r.nome); return a.prot != null ? b.prot === a.prot : a.inicial && b.inicial; });
  if (!mesmas.length) return null;
  const comGrao = mesmas.filter((r) => partesRacao(r.nome).graos.some((g) => a.graos.some((x) => Math.abs(x - g) < 0.01)));
  if (comGrao.length === 1) return comGrao[0];
  if (comGrao.length > 1) return null;
  return mesmas.length === 1 ? mesmas[0] : null;
}

// Relatório geral da fazenda em PDF: estoque de ração, lotes ativos e ração dos últimos 30 dias.
import { fmtNum, fmtInt, fmtData, fmtBRL, fmtPct, ROTULO_TIPO } from './util.js';
import { COR, M, LARG, TOPO, BASE, ferramentas, rodape, logoPdf, tabela, barras } from './pdf_lote.js';

const n = (v, d = 1) => fmtNum(v, d);
const MSG = {
  critico: 'Estoque acabando: compre ração já.',
  atencao: 'Planeje a próxima compra.',
  negativo: 'O consumo lançado passou do que foi comprado. Confira as compras e faça uma contagem.',
  'sem-dado': 'Ainda sem ração lançada para estimar quanto dura.',
  ok: 'Estoque tranquilo.',
};

export function gerarPdfFazenda(jsPDF, d) {
  const { fazenda, geradoEm, kgSaco, gerir, fontes, saldo, sit, lotes, racaoDia, racaoTanque, precoKg, ultimaContagem } = d;
  const dinheiro = d.dinheiro ?? gerir; // valores em R$ só para o dono
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const { cor, txt, caps, linha, largura, quebra } = ferramentas(doc, fontes);
  doc.setProperties({ title: `Relatório geral - ${fazenda}`, author: fazenda, creator: 'Gestão de Piscicultura' });
  let y = 0;
  const cabe = (h) => { if (y + h > BASE) { doc.addPage(); y = TOPO; } };

  // ---------- cabeçalho ----------
  logoPdf(doc, d.logo, M, 8.5, 10);
  caps(fazenda, M + 13, 16, { color: COR.rio, size: 7.5 });
  caps('Relatório geral', 210 - M, 16, { align: 'right' });
  txt('Situação da fazenda', M, 36, { size: 28, bold: true });
  txt(`em ${fmtData(geradoEm)}  ·  ração dos últimos 30 dias`, M, 44, { size: 12.5, color: COR.mudo });
  y = 53;

  const vivos = lotes.reduce((s, l) => s + (l.c.vivos || 0), 0);
  const biomassa = lotes.reduce((s, l) => s + (l.c.biomassaAtual || 0), 0);
  const racao30 = racaoDia.reduce((s, r) => s + r.kg, 0);
  const mortos = lotes.reduce((s, l) => s + (l.c.mortos || 0), 0);
  const inicial = lotes.reduce((s, l) => s + (Number(l.lote.quantidade_inicial) || 0), 0);
  const meta = [['Lotes ativos', fmtInt(lotes.length)], ['Peixes vivos (estim.)', fmtInt(vivos)], ['Mortos no total', `${fmtInt(mortos)}${inicial > 0 ? ` (${fmtPct((mortos / inicial) * 100)}%)` : ''}`], ['Ração em 30 dias', `${n(racao30 / kgSaco, 0)} sacos`]];
  cor('fill', COR.fundo); doc.roundedRect(M, y, LARG, 16, 5, 5, 'F');
  meta.forEach(([k, v], i) => { const x = M + 6 + ((LARG - 8) / 4) * i; caps(k, x, y + 6); txt(v, x, y + 11.4, { size: 10.5 }); });
  y += 28;

  let num = 0;
  const secao = (titulo, need = 30) => {
    cabe(need + 6); num += 1;
    if (num > 1) y += 4;
    linha(M, y, 210 - M, y, 0.25);
    cor('fill', COR.rio); doc.roundedRect(M, y - 0.5, 14, 1.1, 0.55, 0.55, 'F');
    txt(String(num).padStart(2, '0'), M, y + 9, { size: 8.5, bold: true, color: COR.rio });
    txt(titulo, M + 8, y + 9, { size: 12.5, bold: true });
    y += 17;
  };

  // ---------- 1. estoque ----------
  secao('Estoque de ração', 60);
  const kg = Number(saldo.saldo_kg) || 0;
  const porDia = sit.porDia || 0;
  const itens = [
    ['Em estoque', `${kg < 0 ? '-' : ''}${n(Math.abs(kg) / kgSaco, 0)}`, 'sacos', `${n(kg, 0)} kg`],
    ['Dura cerca de', sit.dias != null ? fmtInt(Math.floor(sit.dias)) : '-', sit.dias != null ? 'dias' : '', `${d.soEngorda ? 'engorda, ' : ''}${d.ritmoHoje ? 'no ritmo de hoje' : 'no ritmo dos últimos 7 dias'}`],
    ['Consumo médio', porDia > 0 ? n(porDia / kgSaco, 1) : '-', porDia > 0 ? 'sacos/dia' : '', porDia > 0 ? `${n(porDia, 0)} kg por dia` : 'sem consumo recente'],
    ['Comprado no total', n(Number(saldo.total_comprado_kg) / kgSaco, 0), 'sacos', `consumido: ${n(Number(saldo.total_consumido_kg) / kgSaco, 0)} sacos`],
  ];
  cor('fill', COR.fundo); doc.roundedRect(M, y, LARG, 31, 5, 5, 'F');
  const cw = (LARG - 12) / 4;
  itens.forEach((k, i) => {
    const x = M + 6 + i * cw;
    caps(k[0], x, y + 9);
    txt(k[1], x, y + 18, { size: 20 });
    if (k[2]) txt(k[2], x + largura(k[1], 20, false) + 1.4, y + 18, { size: 8.5, color: COR.mudo });
    txt(k[3], x, y + 24, { size: 7.5, color: COR.mudo });
    if (i) { cor('draw', COR.branco); doc.setLineWidth(0.7); doc.line(M + 3 + i * cw, y + 5, M + 3 + i * cw, y + 26); }
  });
  y += 31 + 6;
  const corMsg = sit.nivel === 'critico' || sit.nivel === 'negativo' ? [160, 40, 28] : sit.nivel === 'atencao' ? COR.ambar : COR.mudo;
  caps('Situação', M, y, { color: corMsg });
  txt(MSG[sit.nivel], M + 30, y, { size: 9.5 });
  y += 5.5;
  if (gerir) {
    caps('Contagem', M, y, { color: COR.mudo });
    txt(ultimaContagem ? `Última em ${fmtData(ultimaContagem.data)}: ${Number(ultimaContagem.diferenca_kg) === 0 ? 'bateu certinho' : `${Number(ultimaContagem.diferenca_kg) < 0 ? 'faltaram' : 'sobraram'} ${n(Math.abs(ultimaContagem.diferenca_kg) / kgSaco, 0)} sacos`}.` : 'Ainda não houve contagem física do estoque. Sem ela, o saldo é só o calculado.', M + 30, y, { size: 9.5 });
    y += 5.5;
  }
  y += 4;

  // ---------- 2. lotes ativos ----------
  secao('Lotes ativos', 44);
  if (lotes.length) {
    const corpo = lotes.map((l) => [
      l.nomeTanque, `${l.lote.especie} (${{ bercario: 'berç.', alevinagem: 'alev.', recria: 'recr.', engorda: 'eng.' }[l.lote.tipo] || l.lote.tipo})`, fmtInt(l.c.diasCultivo),
      l.c.pmAtualG != null ? n(l.c.pmAtualG, 0) : '-', fmtInt(l.c.vivos), fmtInt(l.c.mortos), l.c.sobrevivencia != null ? `${fmtPct(l.c.sobrevivencia)}%` : '-',
      l.c.biomassaAtual != null ? n(l.c.biomassaAtual, 0) : '-', l.c.ca != null ? n(l.c.ca, 2) : '-',
    ]);
    tabela(doc, y, [['TANQUE', 'ESPÉCIE', 'DIAS', 'PESO (g)', 'VIVOS', 'MORTOS', 'SOBREV.', 'BIOMASSA', 'CONV.']], corpo, ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'], [30, 34]);
    y = doc.lastAutoTable.finalY + 3;
    txt('Peso, vivos, biomassa (kg) e conversão são estimativas a partir da última biometria e da mortalidade lançada. Conversão: kg de ração por kg ganho.', M, y + 2, { size: 7.5, color: COR.mudo });
    y += 10;
  } else { txt('Nenhum lote ativo.', M, y + 1, { size: 9, color: COR.mudo }); y += 10; }

  // ---------- 3. ração ----------
  secao('Ração nos últimos 30 dias', 90);
  if (racao30 > 0) {
    txt('Total lançado por dia em todos os tanques, em kg.', M, y, { size: 8, color: COR.mudo });
    y += 3;
    cor('fill', COR.fundo); doc.roundedRect(M, y - 1, LARG, 50, 4, 4, 'F');
    barras(doc, M + 2, y, LARG - 4, 46, racaoDia.map((r) => ({ r: fmtData(r.data).slice(0, 5), v: r.kg })), txt);
    y += 56;
    const corpoT = racaoTanque.map((t) => [t.nome, n(t.kg, 0), n(t.kg / kgSaco, 1), n(t.kg / 30, 1), racao30 > 0 ? `${n((t.kg / racao30) * 100, 0)}%` : '-']);
    corpoT.push(['Total', n(racao30, 0), n(racao30 / kgSaco, 1), n(racao30 / 30, 1), '100%']);
    tabela(doc, y, [['TANQUE', 'RAÇÃO (kg)', `SACOS DE ${n(kgSaco, 0)} kg`, 'MÉDIA (kg/dia)', '% DO TOTAL']], corpoT, ['left', 'right', 'right', 'right', 'right']);
    y = doc.lastAutoTable.finalY + 4;
    if (dinheiro && precoKg != null) { txt(`Custo estimado de ração no período: ${fmtBRL(racao30 * precoKg)} (preço médio pago por kg: ${fmtBRL(precoKg)}).`, M, y + 2, { size: 8.5 }); y += 8; }
    y += 4;
  } else { txt('Nenhuma ração lançada nos últimos 30 dias.', M, y + 1, { size: 9, color: COR.mudo }); y += 10; }

  rodape(doc, fazenda, 'Situação da fazenda', txt, caps, linha, 'Relatório geral', d.logo);
  return doc;
}

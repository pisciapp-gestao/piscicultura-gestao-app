// Relatório de despesca (uma despesca, parcial ou total): dados, indicadores e observações.
import { fmtNum, fmtInt, fmtData, fmtBRL, ROTULO_TIPO, pesoMedioTxt } from './util.js';
import { COR, M, LARG, ferramentas, rodape, logoPdf, tabela } from './pdf_lote.js';
import { indicadoresDespesca } from './calc.js';

const kg = (v, d = 0) => `${fmtNum(v, d)} kg`;

// d: { fazenda, logo, fontes, geradoEm, nomeTanque, lote, despesca, areaHa }
export function gerarPdfDespesca(jsPDF, d) {
  const { fazenda, fontes, geradoEm, nomeTanque, lote, despesca: x, areaHa } = d;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const { txt, caps, linha, quebra } = ferramentas(doc, fontes);
  const titulo = `Despesca ${x.tipo === 'total' ? 'total' : 'parcial'}`;
  doc.setProperties({ title: `Relatório de despesca - ${nomeTanque} - ${fmtData(x.data)}`, author: fazenda, creator: 'Gestão de Piscicultura' });
  const i = indicadoresDespesca(x, areaHa);

  logoPdf(doc, d.logo, M, 8.5, 10);
  caps(fazenda, M + 13, 16, { color: COR.rio, size: 7.5 });
  caps('Relatório de despesca', 210 - M, 16, { align: 'right' });
  txt(nomeTanque || 'Tanque', M, 37, { size: 24, bold: true });
  txt(`${titulo} · ${fmtData(x.data)}`, M, 45, { size: 11.5, color: COR.mudo });
  let y = 56;

  const bloco = (nome, linhas) => {
    txt(nome, M, y, { size: 12, bold: true }); y += 3;
    tabela(doc, y, [['Informação', 'Valor']], linhas, ['left', 'right'], [LARG * 0.5, LARG * 0.5]);
    y = doc.lastAutoTable.finalY + 10;
  };
  bloco('Dados da despesca', [
    ['Data da despesca', fmtData(x.data)],
    ['Tipo', x.tipo === 'total' ? 'Total (lote encerrado)' : 'Parcial (lote continua)'],
    ['Tanque', nomeTanque || '-'],
    ['Lote', `${ROTULO_TIPO[lote.tipo] || lote.tipo} · ${lote.especie} · entrada em ${fmtData(lote.data_entrada)}`],
    ...(Number(areaHa) > 0 ? [['Área do tanque', `${fmtNum(areaHa, 2)} ha`]] : []),
    ['Total de peixes', `${fmtInt(x.quantidade)} peixes`],
    ['Peso total bruto', kg(x.peso_bruto_kg)],
    ['Peso total líquido', x.peso_liquido_kg != null ? kg(x.peso_liquido_kg) : 'não informado'],
  ]);
  bloco('Indicadores', [
    ...(i.difKg != null ? [['Diferença bruto - líquido', `${kg(i.difKg)} (${fmtNum(i.difPct, 1)}% do peso bruto)`]] : []),
    ['Peso médio por peixe (bruto)', pesoMedioTxt(i.medioBrutoKg)],
    ...(i.medioLiquidoKg != null ? [['Peso médio por peixe (líquido)', pesoMedioTxt(i.medioLiquidoKg)]] : []),
    ...(i.peixesHa != null ? [['Peixes por hectare', `${fmtInt(i.peixesHa)} peixes/ha`]] : []),
    ...(x.preco_kg != null ? [['Preço de venda', `${fmtBRL(x.preco_kg)} por kg`]] : []),
    ...(x.comprador ? [['Comprador', x.comprador]] : []),
    ...(i.receita != null ? [[`Receita (${fmtNum(i.kgVendido, 0)} kg ${i.receitaSobre} x ${fmtBRL(x.preco_kg)})`, fmtBRL(i.receita)]] : []),
  ]);

  const nota = quebra(`Gerado em ${fmtData(geradoEm)}. A conversão alimentar e a sobrevivência do lote estão no relatório do lote.`, LARG, 8, false);
  txt(nota, M, y, { size: 8, color: COR.mudo });
  rodape(doc, fazenda, nomeTanque || 'Tanque', txt, caps, linha, 'Relatório de despesca', d.logo);
  return doc;
}

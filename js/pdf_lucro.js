// Fechamento de um ciclo em PDF: receita, custos, lucro e indicadores.
import { fmtNum, fmtInt, fmtData, fmtBRL, ROTULO_TIPO } from './util.js';
import { COR, M, LARG, ferramentas, rodape, logoPdf, tabela } from './pdf_lote.js';

const din = (v) => (v == null ? 'não informado' : fmtBRL(v));

// d: { fazenda, logo, fontes, geradoEm, nomeTanque, lote, fim, f (fecharCiclo), c (calcularLote) }
export function gerarPdfLucro(jsPDF, d) {
  const { fazenda, fontes, geradoEm, nomeTanque, lote, fim, f, c } = d;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const { txt, caps, linha, quebra } = ferramentas(doc, fontes);
  doc.setProperties({ title: `Fechamento do ciclo - ${nomeTanque}`, author: fazenda, creator: 'Gestão de Piscicultura' });
  logoPdf(doc, d.logo, M, 8.5, 10);
  caps(fazenda, M + 13, 16, { color: COR.rio, size: 7.5 });
  caps('Fechamento do ciclo', 210 - M, 16, { align: 'right' });
  txt(nomeTanque || 'Tanque', M, 37, { size: 24, bold: true });
  txt(`${ROTULO_TIPO[lote.tipo] || lote.tipo} · ${lote.especie} · ${fmtData(lote.data_entrada)} a ${fmtData(fim)}`, M, 45, { size: 11.5, color: COR.mudo });
  let y = 56;
  const bloco = (nome, linhas) => {
    txt(nome, M, y, { size: 12, bold: true }); y += 3;
    tabela(doc, y, [['Item', 'Valor']], linhas, ['left', 'right'], [LARG * 0.62, LARG * 0.38]);
    y = doc.lastAutoTable.finalY + 10;
  };
  bloco('Resultado', [
    ['Receita das despescas', din(f.receita)],
    ['Ração', din(f.custoRacao)],
    ['Alevinos', din(f.custoAlevino)],
    ['Despesas gerais (divididas por peso produzido)', din(f.despesas)],
    ['Custo total', din(f.custoTotal)],
    ['Lucro', din(f.lucro)],
    ...(f.margem != null ? [['Margem', `${fmtNum(f.margem * 100, 1)}%`]] : []),
  ]);
  bloco('Produção', [
    ['Peixes retirados', fmtInt(c.despescados)],
    ['Peso bruto retirado', `${fmtNum(c.pesoDespescado, 0)} kg`],
    ...(c.pesoVendido != null && Math.abs(c.pesoVendido - c.pesoDespescado) > 0.5 ? [['Peso vendido (líquido)', `${fmtNum(c.pesoVendido, 0)} kg`]] : []),
    ...(f.custoKg != null ? [['Custo por kg vendido', fmtBRL(f.custoKg)]] : []),
    ...(c.ca != null ? [['Conversão alimentar', fmtNum(c.ca, 2)]] : []),
    ...(c.sobrevivencia != null ? [['Sobrevivência', `${fmtNum(c.sobrevivencia, 1)}%`]] : []),
  ]);
  const obs = `${f.faltando.length ? `Conta incompleta. Falta: ${f.faltando.join(', ')}. ` : ''}Ração pelo preço médio pago por kg. Gerado em ${fmtData(geradoEm)}.`;
  txt(quebra(obs, LARG, 8, false), M, y, { size: 8, color: COR.mudo });
  rodape(doc, fazenda, nomeTanque || 'Tanque', txt, caps, linha, 'Fechamento do ciclo', d.logo);
  return doc;
}

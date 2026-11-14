// Relatório do lote em PDF (A4), em estilo de documento técnico: texto, filetes finos e
// números grandes, sem cartões coloridos. Desenha com jsPDF (vetorial, texto selecionável).
// Recebe o construtor jsPDF (com o plugin autoTable aplicado) e, opcionalmente, as fontes
// em base64 { regular, bold } (Schibsted Grotesk). Sem fontes, usa Helvetica.
import { fmtNum, fmtInt, fmtData, fmtBRL, fmtPct, ROTULO_TIPO, diasEntre, plural } from './util.js';
import { pesoMedioKg, avaliarAgua, ehTambaqui } from './calc.js';

export const COR = {
  tinta: [23, 33, 29], mudo: [118, 130, 123], linha: [214, 223, 218], rio: [14, 79, 69], fundo: [240, 246, 243], fundo2: [231, 240, 235],
  suave: [160, 184, 172], ambar: [168, 100, 8], branco: [255, 255, 255],
};
export const M = 16;

// Logo no cabeçalho: a da fazenda (data URL) ou, sem ela, a marca do sistema desenhada em vetor.
// Ocupa um quadrado de lado s (mm) em (x, y).
export function logoPdf(doc, logo, x, y, s) {
  if (logo) {
    try {
      const pr = doc.getImageProperties(logo);
      const k = Math.min(s / pr.width, s / pr.height), w = pr.width * k, h = pr.height * k;
      doc.addImage(logo, pr.fileType || 'PNG', x + (s - w) / 2, y + (s - h) / 2, w, h);
      return;
    } catch (e) { /* imagem inválida: cai para a marca do sistema */ }
  }
  const u = s / 24;
  doc.setFillColor(...COR.rio); doc.roundedRect(x, y, s, s, 5.4 * u, 5.4 * u, 'F');
  doc.setFillColor(243, 247, 244);
  const X = (v) => x + (v - 1.4 + 0.1) * u * 0.95 + (s - 18.8 * u * 0.95) / 2, Y = (v) => y + 12 * u + (v - 12) * u * 0.95, K = u * 0.95;
  doc.lines([[5.8 * K, 7.4 * K], [-5.8 * K, 7.4 * K], [2.2 * K, -7.4 * K]], X(1.4), Y(4.6), [1, 1], 'F', true);
  [[8.2, 9.5, 5], [11.4, 7, 10], [14.6, 5.5, 13], [17.8, 8.5, 7]].forEach(([bx, by, bh]) => doc.roundedRect(X(bx), Y(by), 2.4 * K, bh * K, 1.2 * K, 1.2 * K, 'F'));
  doc.setFillColor(...COR.rio); doc.circle(X(19), Y(10.9), 0.8 * K, 'F');
}
export const LARG = 210 - 2 * M;
const TOPO = 26;
const BASE = 278;

const n = (v, d = 1) => fmtNum(v, d);
const dm = (iso) => fmtData(iso).slice(0, 5);

let FAM = 'helvetica';
function prepararFontes(doc, fontes) {
  FAM = 'helvetica';
  if (!fontes) return;
  doc.addFileToVFS('Schibsted-Regular.ttf', fontes.regular); doc.addFont('Schibsted-Regular.ttf', 'Schibsted', 'normal');
  doc.addFileToVFS('Schibsted-Bold.ttf', fontes.bold); doc.addFont('Schibsted-Bold.ttf', 'Schibsted', 'bold');
  FAM = 'Schibsted';
}

// Ferramentas de desenho compartilhadas com o relatório da fazenda
export function ferramentas(doc, fontes) {
  prepararFontes(doc, fontes);
  const cor = (t, v) => doc[t === 'fill' ? 'setFillColor' : t === 'draw' ? 'setDrawColor' : 'setTextColor'](...v);
  const fonte = (size, bold) => { doc.setFont(FAM, bold ? 'bold' : 'normal'); doc.setFontSize(size); };
  const txt = (s2, x, yy, { size = 10, bold = false, color = COR.tinta, align = 'left', cs = 0 } = {}) => {
    fonte(size, bold); cor('text', color);
    doc.text(Array.isArray(s2) ? s2 : String(s2), x, yy, { align, charSpace: cs });
  };
  const caps = (s2, x, yy, o = {}) => txt(String(s2).toUpperCase(), x, yy, { size: 7, color: COR.mudo, cs: 0.35, ...o });
  const linha = (x1, y1, x2, y2, w = 0.2, c2 = COR.linha) => { cor('draw', c2); doc.setLineWidth(w); doc.line(x1, y1, x2, y2); };
  const largura = (s2, size, bold) => { fonte(size, bold); return doc.getTextWidth(String(s2)); };
  const quebra = (s2, w, size, bold) => { fonte(size, bold); return doc.splitTextToSize(String(s2), w); };
  return { cor, fonte, txt, caps, linha, largura, quebra };
}

export { rodape, TOPO, BASE };

export function gerarPdfLote(jsPDF, d) {
  const { fazenda, lote, nomeTanque, c, bios, mort, evo, semanas, kgSaco, gerir, geradoEm, fontes } = d;
  const agua = d.agua || [];
  const encerrado = !lote.ativo;
  const pesoTxt = (g) => (g >= 1000 ? `${n(g / 1000, 2)} kg` : `${n(g, g < 10 ? 1 : 0)} g`); // 2,30 kg, não 2300 g
  const dinheiro = d.dinheiro ?? gerir; // valores em R$ só para o dono
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  prepararFontes(doc, fontes);
  doc.setProperties({ title: `Relatório do lote - ${nomeTanque} - ${lote.especie}`, author: fazenda, creator: 'Gestão de Piscicultura' });
  let y = 0;

  const cor = (t, v) => doc[t === 'fill' ? 'setFillColor' : t === 'draw' ? 'setDrawColor' : 'setTextColor'](...v);
  const fonte = (size, bold) => { doc.setFont(FAM, bold ? 'bold' : 'normal'); doc.setFontSize(size); };
  const txt = (s, x, yy, { size = 10, bold = false, color = COR.tinta, align = 'left', cs = 0 } = {}) => {
    fonte(size, bold); cor('text', color);
    doc.text(Array.isArray(s) ? s : String(s), x, yy, { align, charSpace: cs });
  };
  const caps = (s, x, yy, o = {}) => txt(String(s).toUpperCase(), x, yy, { size: 7, color: COR.mudo, cs: 0.35, ...o });
  const linha = (x1, y1, x2, y2, w = 0.2, c2 = COR.linha) => { cor('draw', c2); doc.setLineWidth(w); doc.line(x1, y1, x2, y2); };
  const largura = (s, size, bold) => { fonte(size, bold); return doc.getTextWidth(String(s)); };
  const quebra = (s, w, size, bold) => { fonte(size, bold); return doc.splitTextToSize(String(s), w); };
  const cabe = (h) => { if (y + h > BASE) { doc.addPage(); y = TOPO; } };

  // ---------- cabeçalho da primeira página ----------
  logoPdf(doc, d.logo, M, 8.5, 10);
  caps(fazenda, M + 13, 16, { color: COR.rio, size: 7.5 });
  caps('Relatório do lote', 210 - M, 16, { align: 'right' });
  const titulo = quebra(nomeTanque || 'Lote', LARG, 28, true).slice(0, 2);
  txt(titulo, M, 36, { size: 28, bold: true });
  y = 36 + (titulo.length - 1) * 11;
  txt(`${lote.especie}  ·  ${ROTULO_TIPO[lote.tipo] || lote.tipo}`, M, y + 8, { size: 12.5, color: COR.mudo });
  y += 17;

  const meta = [['Entrada', fmtData(lote.data_entrada)], ['Situação', lote.ativo ? 'Lote ativo' : 'Lote encerrado'], ['Peixes na entrada', fmtInt(lote.quantidade_inicial)], ['Relatório de', fmtData(geradoEm)]];
  cor('fill', COR.fundo); doc.roundedRect(M, y, LARG, 16, 5, 5, 'F');
  meta.forEach(([k, v], i) => { const x = M + 6 + ((LARG - 8) / 4) * i; caps(k, x, y + 6); txt(v, x, y + 11.4, { size: 10.5 }); });
  y += 28;

  // ---------- títulos de seção ----------
  let num = 0;
  const secao = (titulo2, need = 30) => {
    cabe(need + 6); num += 1;
    if (num > 1) y += 4;
    linha(M, y, 210 - M, y, 0.25);
    cor('fill', COR.rio); doc.roundedRect(M, y - 0.5, 14, 1.1, 0.55, 0.55, 'F');
    txt(String(num).padStart(2, '0'), M, y + 9, { size: 8.5, bold: true, color: COR.rio });
    txt(titulo2, M + 8, y + 9, { size: 12.5, bold: true });
    y += 17;
  };

  // ---------- 1. indicadores ----------
  secao('Indicadores do lote', 70);
  const ind = [
    ['Dias de cultivo', fmtInt(c.diasCultivo), 'dias', `desde ${fmtData(lote.data_entrada)}`],
    ['Peso médio atual', c.pmAtualG != null ? (c.pmAtualG >= 1000 ? n(c.pmAtualG / 1000, 2) : n(c.pmAtualG, 0)) : '-', c.pmAtualG != null ? (c.pmAtualG >= 1000 ? 'kg' : 'g') : '', c.dataUltimaBio ? `biometria de ${fmtData(c.dataUltimaBio)}` : 'sem biometria'],
    encerrado && c.despescados ? ['Peixes retirados', fmtInt(c.despescados), '', `de ${fmtInt(lote.quantidade_inicial)} na entrada`] : ['Peixes vivos', fmtInt(c.vivos), 'estim.', `de ${fmtInt(lote.quantidade_inicial)} na entrada`],
    ['Sobrevivência', c.sobrevivencia != null ? fmtPct(c.sobrevivencia) : '-', '%', `${plural(c.mortos, 'morto', 'mortos')}`],
    encerrado && c.despescados ? ['Peso retirado', n(c.pesoDespescado, 0), 'kg', `na entrada: ${n(c.biomassaInicial, 0)} kg`] : ['Biomassa', c.biomassaAtual != null ? n(c.biomassaAtual, 0) : '-', c.biomassaAtual != null ? 'kg' : '', `na entrada: ${n(c.biomassaInicial, 0)} kg`],
    ['Ração fornecida', n(c.racaoTotal, 0), 'kg', `${n(c.racaoTotal / kgSaco, 1)} sacos de ${n(kgSaco, 0)} kg`],
    ['Conversão alimentar', c.ca != null ? n(c.ca, 2) : '-', '', c.ca != null ? 'kg de ração por kg ganho' : c.caAguardaPesagem ? 'aparece após a próxima pesagem' : 'precisa de biometria'],
    ['Ganho diário', c.gpd != null ? n(c.gpd, 1) : '-', c.gpd != null ? 'g/dia' : '', 'por peixe desde a entrada'],
  ];
  if (dinheiro) {
    ind.push(['Custo de ração', c.custoRacao != null ? fmtBRL(c.custoRacao) : '-', '', c.custoRacao != null ? 'preço médio pago por kg' : 'sem valor nas compras']);
    ind.push(['Custo por kg produzido', c.custoKgProduzido != null ? fmtBRL(c.custoKgProduzido) : '-', '', c.custoKgProduzido != null ? 'ração até a biometria / peso ganho' : 'precisa de preço e biometria com ganho']);
  }
  const ch = 25, linhas = Math.ceil(ind.length / 4), cw = (LARG - 12) / 4;
  cabe(linhas * ch + 6);
  cor('fill', COR.fundo); doc.roundedRect(M, y, LARG, linhas * ch + 6, 5, 5, 'F');
  for (let r = 0; r < linhas; r++) {
    ind.slice(r * 4, r * 4 + 4).forEach((k, i) => {
      const x = M + 6 + i * cw, yy = y + 3 + r * ch;
      caps(k[0], x, yy + 6);
      const tam = String(k[1]).startsWith('R$') ? 16 : largura(k[1], 20, false) > cw - 9 ? 15 : 20;
      txt(k[1], x, yy + 15, { size: tam });
      if (k[2]) txt(k[2], x + largura(k[1], tam, false) + 1.4, yy + 15, { size: 8.5, color: COR.mudo });
      txt(k[3], x, yy + 21, { size: 7.5, color: COR.mudo });
      if (i) { cor('draw', COR.branco); doc.setLineWidth(0.7); doc.line(M + 3 + i * cw, yy + 2, M + 3 + i * cw, yy + ch - 2); }
    });
    if (r) { cor('draw', COR.branco); doc.setLineWidth(0.7); doc.line(M + 4, y + 3 + r * ch, M + LARG - 4, y + 3 + r * ch); }
  }
  y += linhas * ch + 6 + 8;

  // ---------- 2. observações ----------
  const obs = [];
  obs.push(['Crescimento', c.pmAtualG != null
    ? `Peso médio de ${pesoTxt(c.pmInicialG)} na entrada para ${pesoTxt(c.pmAtualG)} em ${fmtData(c.dataUltimaBio)}${c.gpd != null ? ` (${n(c.gpd, 1)} g por dia por peixe)` : ''}.`
    : 'Sem biometria registrada. Pese uma amostra para calcular peso médio, biomassa e conversão alimentar.']);
  const qi = Number(lote.quantidade_inicial) || 0;
  obs.push(['Sobrevivência', encerrado && c.despescados
    ? `${plural(c.mortos, 'morte registrada', 'mortes registradas')}. Na despesca total saíram ${fmtInt(c.despescados)} de ${fmtInt(qi)} peixes (${fmtPct(c.sobrevivencia ?? 0)}% de sobrevivência).`
    : `${plural(c.mortos, 'morte', 'mortes')} em ${fmtInt(qi)} peixes (${fmtPct(qi > 0 ? (c.mortos / qi) * 100 : 0)}%). Restam cerca de ${fmtInt(c.vivos)}.`]);
  if (c.despescados) obs.push(['Despesca', `${plural(c.despescados, 'peixe retirado', 'peixes retirados')}, ${n(c.pesoDespescado, 0)} kg de peso bruto.`]);
  obs.push(['Ração', `${n(c.racaoTotal, 0)} kg fornecidos (${n(c.racaoTotal / kgSaco, 1)} sacos de ${n(kgSaco, 0)} kg)${c.racaoMediaDia != null ? `, média de ${n(c.racaoMediaDia, 1)} kg por dia` : ''}.`]);
  if (c.ca != null) obs.push(['Conversão', `${n(c.ca, 2)} kg de ração por kg de peixe ganho até a última biometria. Referência usual: 1,2 a 2,0, conforme espécie e fase.`]);
  if (dinheiro && c.custoRacao != null) obs.push(['Custo', `${fmtBRL(c.custoRacao)} em ração, calculado pelo preço médio das compras com valor informado.`]);
  const alertas = [];
  if (bios.length < 2) alertas.push('Menos de duas biometrias: ganho de peso e conversão alimentar ficam pouco confiáveis. O ideal é pesar a cada 15 dias.');
  if (bios.some((b) => Number(b.quantidade_amostrada) < 30)) alertas.push('Há biometria com menos de 30 peixes pesados. Amostras pequenas dão peso médio menos preciso; o ideal é 5% a 10% do lote.');

  secao('Observações', 40);
  const colEsq = 30;
  const bloco = (rot, texto, corRot) => {
    const ls = quebra(texto, LARG - colEsq, 9.5, false);
    cabe(ls.length * 4.6 + 4);
    caps(rot, M, y + 0.2, { color: corRot || COR.mudo });
    txt(ls, M + colEsq, y, { size: 9.5 });
    y += ls.length * 4.6 + 1.6;
    linha(M, y, 210 - M, y, 0.12);
    y += 4.6;
  };
  obs.forEach(([r, t]) => bloco(r, t));
  alertas.forEach((a) => bloco('Atenção', a, COR.ambar));
  y += 3;

  // ---------- 3. peso ----------
  secao('Evolução do peso médio', 86);
  const pts = evo.filter((p) => p.g != null);
  if (pts.length >= 2) {
    txt('Peso médio por biometria, em gramas. O primeiro ponto é a entrada do lote.', M, y, { size: 8, color: COR.mudo });
    y += 3;
    cor('fill', COR.fundo); doc.roundedRect(M, y - 1, LARG, 62, 4, 4, 'F');
    grafico(doc, M + 2, y, LARG - 4, 58, pts.map((p) => ({ x: p.data, y: p.g })), (v) => (v === 0 ? '0' : n(v, v < 10 ? 1 : 0)), txt, caps);
    y += 66;
  } else { txt('São necessárias ao menos duas pesagens (a entrada conta como uma) para desenhar o gráfico.', M, y + 1, { size: 9, color: COR.mudo }); y += 9; }

  // ---------- 4. biometrias ----------
  secao('Biometrias', 44);
  if (evo.length) {
    const validas = bios.filter((b) => pesoMedioKg(b) != null);
    let k = 0;
    const corpo = evo.map((p) => {
      const b = p.inicial ? null : validas[k++];
      return [fmtData(p.data), p.inicial ? 'Entrada do lote' : `${fmtInt(b.quantidade_amostrada)} peixes`, n(p.g, 1), p.ganhoDia != null ? n(p.ganhoDia, 1) : '-', n(Math.max(0, diasEntre(lote.data_entrada, p.data)), 0)];
    });
    tabela(doc, y, [['DATA', 'AMOSTRA', 'PESO MÉDIO (g)', 'GANHO (g/dia)', 'DIA DO LOTE']], corpo, ['left', 'left', 'right', 'right', 'right']);
    y = doc.lastAutoTable.finalY + 3;
    txt('Peso médio = peso da amostra dividido pelo número de peixes pesados. Ganho = variação desde a pesagem anterior.', M, y + 2, { size: 7.5, color: COR.mudo });
    y += 10;
  } else { txt('Nenhuma biometria registrada.', M, y + 1, { size: 9, color: COR.mudo }); y += 9; }

  // ---------- 5. ração ----------
  secao('Ração por semana', 80);
  if (semanas.length) {
    txt('Total lançado de segunda a domingo, em kg. A última barra pode ser uma semana incompleta.', M, y, { size: 8, color: COR.mudo });
    y += 3;
    cor('fill', COR.fundo); doc.roundedRect(M, y - 1, LARG, 50, 4, 4, 'F');
    barras(doc, M + 2, y, LARG - 4, 46, semanas.slice(-20).map((s) => ({ r: dm(s.inicio), v: s.kg })), txt);
    y += 56;
    const corpo = semanas.slice().reverse().map((s) => [`Semana de ${fmtData(s.inicio)}`, n(s.kg, 1), n(s.kg / kgSaco, 1), n(s.kg / 7, 1)]);
    tabela(doc, y, [['SEMANA', 'RAÇÃO (kg)', `SACOS DE ${n(kgSaco, 0)} kg`, 'MÉDIA (kg/dia)']], corpo, ['left', 'right', 'right', 'right']);
    y = doc.lastAutoTable.finalY + 9;
  } else { txt('Nenhuma ração lançada.', M, y + 1, { size: 9, color: COR.mudo }); y += 9; }

  // ---------- 6. mortalidade ----------
  secao('Mortalidade', 44);
  if (mort.length) {
    let acc = 0;
    const todas = mort.map((m) => { acc += Number(m.quantidade); return [fmtData(m.data), fmtInt(m.quantidade), fmtInt(acc), `${n((acc / Number(lote.quantidade_inicial)) * 100, 2)}%`, m.causa || '-']; });
    const lim = todas.slice(-25);
    tabela(doc, y, [['DATA', 'MORTOS NO DIA', 'ACUMULADO', '% DO LOTE', 'CAUSA PROVÁVEL']], lim, ['left', 'right', 'right', 'right', 'left']);
    y = doc.lastAutoTable.finalY + 3;
    if (todas.length > lim.length) { txt(`Mostrando os ${lim.length} registros mais recentes de ${todas.length}.`, M, y + 2, { size: 7.5, color: COR.mudo }); y += 6; }
    y += 7;
  } else { txt('Nenhuma mortalidade registrada.', M, y + 1, { size: 9, color: COR.mudo }); y += 10; }

  // ---------- qualidade da água (quando houver medição) ----------
  if (agua.length) {
    secao('Qualidade da água', 44);
    const v = (x, dd) => (x == null || x === '' ? '-' : n(Number(x), dd));
    const tam = ehTambaqui(lote.especie);
    const ult = agua.slice(-20).reverse();
    const corpo = ult.map((a) => [`${fmtData(a.data)}${a.hora ? ' ' + a.hora : ''}`, v(a.oxigenio_mgl, 1), v(a.temperatura_c, 1), v(a.ph, 1), v(a.amonia_mgl, 2), tam && avaliarAgua(a).length ? avaliarAgua(a).map((x) => x.texto.split(' (')[0]).join(', ') : '-']);
    tabela(doc, y, [['DATA', 'OXIGÊNIO (mg/L)', 'TEMP. (°C)', 'pH', 'AMÔNIA (mg/L)', 'SITUAÇÃO']], corpo, ['left', 'right', 'right', 'right', 'right', 'left']);
    y = doc.lastAutoTable.finalY + 3;
    const nota = `${agua.length > ult.length ? `Mostrando as ${ult.length} medições mais recentes de ${agua.length}. ` : ''}${tam ? 'Faixas do tambaqui: oxigênio de 4 a 8 mg/L, temperatura de 28 a 30 °C, pH de 5 a 7 e amônia tóxica abaixo de 0,46 mg/L (Embrapa, 2018).' : ''}`;
    if (nota) { const ls = quebra(nota, LARG, 7.5, false); txt(ls, M, y + 2, { size: 7.5, color: COR.mudo }); y += ls.length * 3.4 + 2; }
    y += 7;
  }

  // ---------- comparação com ciclos anteriores (quando houver ciclo encerrado) ----------
  if (d.cmp) {
    secao('Comparação com ciclos anteriores', 50);
    txt(`Situação no dia ${fmtInt(d.cmp.idade)} do ciclo, comparada com os ciclos encerrados na mesma idade.`, M, y, { size: 8, color: COR.mudo });
    y += 3;
    tabela(doc, y, [d.cmp.cab], d.cmp.corpo, d.cmp.cab.map((_, i) => (i ? 'right' : 'left')));
    y = doc.lastAutoTable.finalY + 3;
    if (d.cmp.fim) { const ls = quebra(d.cmp.fim, LARG, 8.5, false); cabe(ls.length * 4 + 4); txt(ls, M, y + 2, { size: 8.5 }); y += ls.length * 4 + 3; }
    y += 7;
  }

  // ---------- 7. notas ----------
  secao('Notas', 50);
  [
    ['Biomassa', 'Peso total estimado dos peixes vivos: peixes vivos x peso médio da última biometria.'],
    ['Sobrevivência', 'Peixes que continuam vivos em relação ao que entrou, pela mortalidade registrada.'],
    ['Conversão alimentar', 'Kg de ração usados para cada kg de peixe ganho. Quanto menor, melhor o aproveitamento.'],
    ['Estimativas', 'Peixes vivos, biomassa e conversão dependem de mortalidade e biometrias lançadas. Quanto mais biometrias, mais confiável.'],
  ].forEach(([t, s]) => {
    const ls = quebra(s, LARG - 40, 8.5, false); cabe(ls.length * 4 + 3);
    txt(t, M, y, { size: 8.5, bold: true }); txt(ls, M + 38, y, { size: 8.5, color: COR.mudo });
    y += ls.length * 4 + 2.4;
  });

  rodape(doc, fazenda, nomeTanque, txt, caps, linha, 'Relatório do lote', d.logo);
  return doc;
}

// cabeçalho corrente (páginas 2+) e rodapé em todas as páginas
function rodape(doc, fazenda, titulo, txt, caps, linha, rotulo = 'Relatório do lote', logo = null) {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (p > 1) {
      logoPdf(doc, logo, M, 9.6, 6); caps(fazenda, M + 8.5, 14, { color: COR.rio, size: 7 }); caps(`${rotulo}  ·  ${titulo}`, 210 - M, 14, { align: 'right' });
    }
    txt('Gestão de Piscicultura', M, 291, { size: 7.5, color: COR.mudo });
    txt(`${p} / ${total}`, 210 - M, 291, { size: 7.5, color: COR.mudo, align: 'right' });
  }
}

export function tabela(doc, y, head, body, align, larguras = []) {
  const colStyles = {}; align.forEach((a, i) => { colStyles[i] = { halign: a, ...(larguras[i] ? { cellWidth: larguras[i] } : {}) }; });
  doc.autoTable({
    startY: y, head, body, margin: { left: M, right: M, top: TOPO, bottom: 16 }, theme: 'plain',
    styles: { font: FAM, fontSize: 9, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, textColor: COR.tinta, lineColor: COR.linha, lineWidth: { bottom: 0.15 } },
    headStyles: { font: FAM, fontStyle: 'bold', fontSize: 6.8, textColor: COR.mudo, fillColor: COR.fundo2, lineColor: COR.linha, lineWidth: { bottom: 0.12 }, cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 } },
    columnStyles: colStyles,
    didParseCell: (h) => { if (h.section === 'head') h.cell.styles.halign = align[h.column.index]; },
  });
}

function escala(max) {
  const bruto = (max || 1) / 3; const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) || mag;
  return { passo, topo: Math.max(passo, Math.ceil(max / passo) * passo) };
}

export function grafico(doc, x0, y0, w, h, pontos, fmtY, txt, caps) {
  const pl = 11, pr = 5, pt = 6, pb = 9;
  const X = x0 + pl, Y = y0 + pt, W = w - pl - pr, H = h - pt - pb;
  const t = (iso) => new Date(`${iso}T00:00:00Z`).getTime();
  const t0 = t(pontos[0].x), t1 = t(pontos[pontos.length - 1].x);
  const { passo, topo } = escala(Math.max(...pontos.map((p) => p.y)));
  const px = (iso) => X + (t1 === t0 ? 0 : ((t(iso) - t0) / (t1 - t0)) * W);
  const py = (v) => Y + H - (v / topo) * H;
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    doc.setDrawColor(...COR.linha); doc.setLineWidth(0.15); doc.line(X, py(v), X + W, py(v));
    txt(fmtY(v), X - 2, py(v) + 1, { size: 7, color: COR.mudo, align: 'right' });
  }
  doc.setDrawColor(...COR.rio); doc.setLineWidth(0.8); doc.setLineCap('round'); doc.setLineJoin('round');
  for (let i = 1; i < pontos.length; i++) doc.line(px(pontos[i - 1].x), py(pontos[i - 1].y), px(pontos[i].x), py(pontos[i].y));
  doc.setFillColor(...COR.branco); doc.setDrawColor(...COR.rio); doc.setLineWidth(0.6);
  pontos.forEach((p) => doc.circle(px(p.x), py(p.y), 1.1, 'FD'));
  doc.setLineCap('butt');
  const max = pontos.reduce((m, p, i) => (p.y > pontos[m].y ? i : m), 0);
  const rot = new Set([0, pontos.length - 1, ...(pontos.length <= 7 ? pontos.map((_, i) => i) : [max])]);
  [...rot].forEach((i) => {
    const p = pontos[i];
    txt(`${fmtY(p.y)} g`, px(p.x), py(p.y) - 2.8, { size: 7.5, bold: i === pontos.length - 1, align: i === 0 ? 'left' : i === pontos.length - 1 ? 'right' : 'center' });
  });
  const datas = pontos.length <= 5 ? pontos : [pontos[0], pontos[Math.floor(pontos.length / 2)], pontos[pontos.length - 1]];
  datas.forEach((p, i) => txt(fmtData(p.x), px(p.x), Y + H + 5.5, { size: 7, color: COR.mudo, align: i === 0 ? 'left' : i === datas.length - 1 ? 'right' : 'center' }));
}

export function barras(doc, x0, y0, w, h, itens, txt) {
  const pl = 11, pr = 2, pt = 5, pb = 8;
  const X = x0 + pl, Y = y0 + pt, W = w - pl - pr, H = h - pt - pb;
  const { passo, topo } = escala(Math.max(...itens.map((i) => i.v)));
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    const yy = Y + H - (v / topo) * H;
    doc.setDrawColor(...COR.linha); doc.setLineWidth(0.15); doc.line(X, yy, X + W, yy);
    txt(fmtNum(v, 0), X - 2, yy + 1, { size: 7, color: COR.mudo, align: 'right' });
  }
  const slot = W / itens.length, bw = Math.min(slot * 0.5, 5);
  const max = itens.reduce((m, it, i) => (it.v > itens[m].v ? i : m), 0);
  itens.forEach((it, i) => {
    const bh = (it.v / topo) * H, bx = X + i * slot + (slot - bw) / 2;
    doc.setFillColor(...(i === itens.length - 1 ? COR.rio : COR.suave)); doc.roundedRect(bx, Y + H - bh, bw, Math.max(bh, 0.8), Math.min(bw / 2, 1.6), Math.min(bw / 2, 1.6), 'F');
    if (i === itens.length - 1 || i === max) txt(fmtNum(it.v, 0), bx + bw / 2, Y + H - bh - 1.6, { size: 7, bold: true, align: 'center' });
    if (itens.length <= 8 || i % 3 === 0) txt(it.r, bx + bw / 2, Y + H + 4.5, { size: 6.8, color: COR.mudo, align: 'center' });
  });
}

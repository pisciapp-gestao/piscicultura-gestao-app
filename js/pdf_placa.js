// Placa do tanque em PDF (A5 em pé, 148 × 210 mm): moldura verde da marca, nome do tanque e o QR code
// desenhado em vetor (quadradinhos), nítido em qualquer tamanho de impressão (A5, A4 ou PVC/ACM).
import { COR, logoPdf, ferramentas } from './pdf_lote.js';

const VERDE = [18, 53, 45]; // --cromo do app

// d: { fazenda, logo, fontes, nomeTanque, especie, matriz, link, codigo }
export function gerarPdfPlaca(jsPDF, d) {
  const W = 148, H = 210;
  const doc = new jsPDF({ unit: 'mm', format: 'a5', compress: true });
  const { txt, caps, quebra } = ferramentas(doc, d.fontes);
  doc.setProperties({ title: `Placa - ${d.nomeTanque}`, author: d.fazenda, creator: 'Gestão de Piscicultura' });

  // moldura: fundo verde e a folha branca por dentro
  doc.setFillColor(...VERDE); doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(...COR.branco); doc.roundedRect(8, 8, W - 16, H - 16, 4, 4, 'F');

  logoPdf(doc, d.logo, 16, 16.5, 9);
  const faz = String(d.fazenda || '').length > 34 ? String(d.fazenda).slice(0, 33) + '…' : d.fazenda;
  caps(faz, 28, 22.4, { color: COR.rio, size: 8.5 });

  const nome = quebra(d.nomeTanque || 'Tanque', W - 36, 24, true).slice(0, 2);
  txt(nome, W / 2, 43, { size: 24, bold: true, color: VERDE, align: 'center' });
  const yEsp = 43 + (nome.length - 1) * 9.5 + 8;
  if (d.especie) txt(d.especie, W / 2, yEsp, { size: 11, color: COR.mudo, align: 'center' });

  // QR: 86 mm de lado, centralizado; a folha branca em volta já é a margem de leitura
  const n = d.matriz.length, lado = 86, u = lado / n, x0 = (W - lado) / 2, y0 = yEsp + 9;
  doc.setFillColor(0, 0, 0);
  d.matriz.forEach((linha, r) => {
    let c = 0;
    while (c < n) { // junta quadradinhos pretos vizinhos numa barra só: arquivo menor, sem frestas na impressão
      if (!linha[c]) { c++; continue; }
      let f = c; while (f + 1 < n && linha[f + 1]) f++;
      doc.rect(x0 + c * u, y0 + r * u, (f - c + 1) * u + 0.01, u + 0.01, 'F');
      c = f + 1;
    }
  });

  const yCh = y0 + lado + 13;
  txt(['Aponte a câmera do celular', 'e veja como estão os peixes hoje'], W / 2, yCh, { size: 13, bold: true, color: VERDE, align: 'center' });
  txt('Dados ao vivo, lançados pela equipe da fazenda', W / 2, yCh + 14, { size: 8.5, color: COR.mudo, align: 'center' });
  txt(`PisciApp · código ${d.codigo}`, W / 2, H - 14, { size: 7.5, color: COR.mudo, align: 'center' });
  return doc;
}

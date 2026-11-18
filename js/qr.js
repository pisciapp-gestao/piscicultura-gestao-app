// QR code das placas (sql/40). A biblioteca (vendor/qrcode.js, MIT) só é baixada quando o dono abre uma placa.
let promessa = null;
export function carregarQr() {
  if (!promessa) {
    promessa = new Promise((ok, falha) => {
      if (window.qrcode) { ok(window.qrcode); return; }
      const s = document.createElement('script');
      s.src = new URL('../vendor/qrcode.js', import.meta.url).href;
      s.onload = () => (window.qrcode ? ok(window.qrcode) : falha(new Error('Gerador do QR code inválido.')));
      s.onerror = () => falha(new Error('Não foi possível carregar o gerador do QR code. Confira a internet.'));
      document.head.appendChild(s);
    }).catch((e) => { promessa = null; throw e; });
  }
  return promessa;
}

// Matriz de quadradinhos (true = preto). Correção "Q": a placa ao ar livre ainda lê com até 25% sujo ou riscado.
export async function matrizQr(texto) {
  const qrcode = await carregarQr();
  const q = qrcode(0, 'Q');
  q.addData(texto);
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

// SVG com um único caminho; margem de 4 quadradinhos em branco (o mínimo que a norma pede para ler bem)
export function svgQr(m, rotulo = 'QR code') {
  const n = m.length, mg = 4, t = n + 2 * mg;
  let d = '';
  m.forEach((linha, r) => linha.forEach((preto, c) => { if (preto) d += `M${c + mg} ${r + mg}h1v1h-1z`; }));
  return `<svg viewBox="0 0 ${t} ${t}" role="img" aria-label="${rotulo}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// endereço que o QR abre: a página pública deste mesmo site (placa.html), com o código da placa
export const linkPlaca = (codigo, base = location.href) => new URL(`placa.html?c=${encodeURIComponent(codigo)}`, base).href;

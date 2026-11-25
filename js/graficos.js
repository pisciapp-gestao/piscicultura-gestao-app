// Gráfico de pizza (rosca): total no meio, legenda ao lado com valor e %.
// As cores das fases seguem a ordem do crescimento (claro → escuro), nos verdes do app.
import { esc, fmtNum } from './util.js';

export const COR_FASE = { bercario: '#c2e0d7', alevinagem: '#6fae9f', recria: '#1b6c5a', engorda: '#0d2621' };
export const ORDEM_FASE = ['bercario', 'alevinagem', 'recria', 'engorda'];
export const COR_RACAO = { engorda: '#1b6c5a', alevino: '#6fae9f' };
// Cor de cada ração cadastrada (sql/39: racoes.cor de 0 a 9). A mesma cor no lançamento, no estoque e no início,
// para o tratador reconhecer pela cor (como a cor do saco). Todas com texto branco legível por cima (contraste ≥ 4,5).
export const CORES_RACOES = ['#9a6510', '#2f6f9f', '#1b6c5a', '#6f4f9c', '#b0472f', '#1f7a83', '#7a5a2a', '#46616e', '#9c3f6e', '#4d7a2a'];
export const corRacao = (i) => CORES_RACOES[((Number(i) || 0) % CORES_RACOES.length + CORES_RACOES.length) % CORES_RACOES.length];

// fatias: [{ nome, valor, cor, txt? }]; txt é o valor já formatado para a legenda
export function pizza(fatias, { centro = '', sub = '', rotulo = 'Gráfico de pizza' } = {}) {
  const fs = fatias.filter((x) => Number(x.valor) > 0);
  const total = fs.reduce((a, x) => a + Number(x.valor), 0);
  if (!total) return '';
  const R = 52, r = 34, C = 60;
  const ponto = (ang, raio) => [C + raio * Math.sin(ang), C - raio * Math.cos(ang)];
  let ang = 0;
  const arcos = fs.map((x) => {
    const frac = Number(x.valor) / total, pct = frac * 100;
    const tit = `${x.nome}: ${x.txt || fmtNum(x.valor, 0)} (${fmtNum(pct, pct < 10 ? 1 : 0)}%)`;
    if (frac > 0.9999) return `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${x.cor}" stroke-width="${R - r}"><title>${esc(tit)}</title></circle>`;
    const a0 = ang, a1 = ang + frac * 2 * Math.PI; ang = a1;
    const g = frac > 0.5 ? 1 : 0;
    const [x0, y0] = ponto(a0, R), [x1, y1] = ponto(a1, R), [x2, y2] = ponto(a1, r), [x3, y3] = ponto(a0, r);
    const d = `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${g} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r} ${r} 0 ${g} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
    return `<path d="${d}" fill="${x.cor}"><title>${esc(tit)}</title></path>`;
  }).join('');
  const leg = fs.map((x) => {
    const pct = (Number(x.valor) / total) * 100;
    return `<li><i style="background:${x.cor}"></i><span>${esc(x.nome)}</span><b>${esc(x.txt || fmtNum(x.valor, 0))} <small>${fmtNum(pct, pct < 10 ? 1 : 0)}%</small></b></li>`;
  }).join('');
  return `<figure class="pizza"><svg viewBox="0 0 120 120" role="img" aria-label="${esc(rotulo)}">${arcos}
    ${centro ? `<text x="60" y="${sub ? 60 : 64}" text-anchor="middle" class="pz-c">${esc(centro)}</text>` : ''}${sub ? `<text x="60" y="74" text-anchor="middle" class="pz-s">${esc(sub)}</text>` : ''}</svg>
    <ul class="pz-leg">${leg}</ul></figure>`;
}

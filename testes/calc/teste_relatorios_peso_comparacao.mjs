// Relatórios (23/11/2026): peso de hoje estimado pela ração e comparação entre tanques no relatório geral.
// Uso: node testes/calc/teste_relatorios_peso_comparacao.mjs
import assert from 'node:assert/strict';
import { pesoPelaRacao, racaoTabelaPorPeixe, calcularLote, pesoTabelaApos } from '../../js/calc.js';
import { compararTanques } from '../../js/pdf_fazenda.js';

const ok = (m) => console.log('OK   ' + m);
const perto = (a, b, m, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} ≠ ${b}`);

// ---------- peso pela ração ----------
let semente = 2311;
const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
for (let i = 0; i < 10000; i++) {
  const pm = 0.002 + rnd() * 4, vivos = 100 + Math.floor(rnd() * 50000), kg = rnd() * 20000, f = rnd() < 0.3 ? null : 0.7 + rnd() * 1.3;
  const p = pesoPelaRacao(pm, kg, vivos, f);
  if (!(kg > 0) || racaoTabelaPorPeixe(pm, 30) * vivos * (f || 1) < kg) { assert.equal(p, null, 'sem ração ou ração impossível: sem estimativa'); continue; }
  assert.ok(p > pm, 'com ração o peso sobe');
  perto(racaoTabelaPorPeixe(pm, p) * vivos * (f || 1), kg, 'a ração da tabela até o peso estimado volta à ração dada', Math.max(0.01, kg * 1e-6));
}
ok('10 mil casos: a ração da tabela até o peso estimado é igual à ração dada (com e sem fator)');
assert.ok(pesoPelaRacao(0.8, 3000, 4000, 1.5) < pesoPelaRacao(0.8, 3000, 4000, 1), 'lote que gasta mais cresce menos');
ok('lote que gasta mais que a tabela: peso estimado menor');
for (const args of [[0, 100, 10], [0.5, 0, 10], [0.5, 100, 0], [null, 100, 10]]) assert.equal(pesoPelaRacao(...args), null);
ok('sem peso, sem ração ou sem peixe: sem estimativa');
assert.equal(pesoPelaRacao(0.002, 19471, 100), null);
ok('ração impossível para os peixes (194 kg por peixe): sem estimativa, em vez de um número errado');

const lote = { id: 'L', ativo: true, especie: 'Tambaqui', tipo: 'engorda', data_entrada: '2026-07-26', quantidade_inicial: 5000, peso_inicial_kg: 500 };
const bios = [{ data: '2026-10-24', peso_amostra_kg: 30, quantidade_amostrada: 50 }, { data: '2026-11-20', peso_amostra_kg: 40, quantidade_amostrada: 50 }];
const rac = []; for (let i = 0; i < 120; i++) rac.push({ data: new Date(Date.UTC(2026, 10, 23 - i)).toISOString().slice(0, 10), quantidade_kg: 80 });
const c = calcularLote(lote, bios, [], rac, '2026-11-23');
assert.equal(c.pmAtualG, 800); assert.ok(c.pmEstimadoG > 800); assert.equal(c.estimadoDesde, '2026-11-20'); assert.equal(c.racaoDesdeBio, 240);
perto(c.biomassaEstimada, c.vivos * c.pmEstimadoG / 1000, 'biomassa = vivos × peso estimado', 0.01);
assert.equal(c.ca, calcularLote(lote, bios, [], rac.filter((r) => r.data <= '2026-11-20'), '2026-11-23').ca, 'a conversão não muda com a estimativa');
ok('lote de tambaqui com ração depois da pesagem: peso de hoje > pesado; conversão continua pela biometria');
assert.equal(calcularLote({ ...lote, especie: 'Tilápia' }, bios, [], rac, '2026-11-23').pmEstimadoG, null);
assert.equal(calcularLote({ ...lote, ativo: false }, bios, [], rac, '2026-11-23').pmEstimadoG, null);
assert.equal(calcularLote(lote, bios, [], rac.filter((r) => r.data <= '2026-11-20'), '2026-11-23').pmEstimadoG, null);
ok('sem estimativa: outra espécie, lote encerrado ou sem ração depois da pesagem');
const errado = calcularLote(lote, bios, [], [...rac, { data: '2026-11-22', quantidade_kg: 500000 }], '2026-11-23');
assert.equal(errado.pmEstimadoG, null); assert.equal(errado.racaoImpossivel, true); assert.equal(errado.racaoDesdeBio, 500240);
assert.equal(c.racaoImpossivel, false);
ok('ração impossível lançada depois da pesagem: sem peso estimado e com aviso para conferir');
const milSacos = calcularLote(lote, bios, [], [...rac, { data: '2026-11-22', quantidade_kg: 25000 }], '2026-11-23');
assert.equal(milSacos.pmEstimadoG, null); assert.equal(milSacos.racaoImpossivel, true);
ok('1.000 sacos em vez de 10 (peixe de 800 g iria a ~3,5 kg em 3 dias): sem estimativa, com aviso');
perto(pesoTabelaApos(0.772, 7) * 1000, 836, 'uma semana da tabela a partir de 772 g', 0.01);
perto(pesoTabelaApos(0.772, 14) * 1000, 900, 'duas semanas', 0.01);
perto(pesoTabelaApos(3.6, 7) * 1000, 3800, 'depois do fim da tabela segue a última semana', 0.01);
ok('peso pela tabela depois de N dias');
const normal = calcularLote(lote, bios, [], rac, '2026-12-10');
assert.ok(normal.pmEstimadoG > 800 && !normal.racaoImpossivel, 'ração normal por 20 dias: estima sem aviso');
ok('ração normal por 3 semanas: estima sem aviso');
const avisoR = compararTanques([{ nomeTanque: 'T9', lote: { tipo: 'engorda' }, c: { ...errado } }, { nomeTanque: 'T8', lote: { tipo: 'engorda' }, c: { ...c } }], '2026-11-23');
assert.ok(avisoR.avisos.some((a) => a.startsWith('T9: ração lançada desde 20/11/2026 (500.240 kg)')), avisoR.avisos.join(' | '));
ok('relatório geral: o aviso da ração impossível entra no "O que olhar"');

// ---------- comparação entre tanques ----------
const L = (nome, tipo, ca, gpd, sobrevivencia, dataUltimaBio) => ({ nomeTanque: nome, lote: { tipo }, c: { ca, gpd, sobrevivencia, dataUltimaBio } });
const hoje = '2026-11-23';
const r = compararTanques([
  L('A1', 'alevinagem', 1.7, 0.5, 95, '2026-11-18'), L('A2', 'alevinagem', null, null, 98, null),
  L('T1', 'engorda', 2.5, 6, 97.7, '2026-11-20'), L('T3', 'engorda', 6.3, 5, 90, '2026-10-14'), L('T4', 'engorda', 3.1, 7.7, 98, '2026-10-09'),
], hoje);
assert.deepEqual([...r.pior].sort(), ['1:5', '3:2', '3:3', '3:4', '3:5', '4:5'].sort());
ok('pior de cada coluna só dentro da mesma fase; alevinagem com um só valor não é marcada; sem pesar > 30 dias e "nunca" marcados');
assert.equal(r.avisos.length, 3); assert.ok(r.avisos[1].startsWith('T3: a pior conversão da engorda'), r.avisos[1]);
ok('avisos agrupados por tanque, na ordem da tabela');
const iguais = compararTanques([L('X', 'engorda', 2, 6, 97, '2026-11-20'), L('Y', 'engorda', 2, 6, 97, '2026-11-20')], hoje);
assert.equal(iguais.pior.size, 0); assert.equal(iguais.avisos.length, 0);
const quase = compararTanques([L('X', 'engorda', 2, 6, 97, '2026-11-20'), L('Y', 'engorda', 2.05, 5.9, 96, '2026-11-20')], hoje);
assert.equal(quase.pior.size, 0);
ok('tanques iguais ou com diferença menor que 5%: nada em vermelho');
const fases = compararTanques([L('E', 'engorda', 2, 6, 97, '2026-11-20'), L('A', 'alevinagem', 9, 0.1, 50, '2026-11-20')], hoje);
assert.equal(fases.pior.size, 0);
ok('fases diferentes não se comparam');
console.log('RESULTADO: TUDO OK');

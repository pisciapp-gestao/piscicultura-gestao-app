// Contas da transferência de peixes (sql/37). Caso real do cliente piloto: o Samaúma (recria) passa peixes adiante.
// Rodar: node testes/calc/teste_transferencia.mjs
import assert from 'node:assert/strict';
import { calcularLote, vivosDoLote, fimDoLote, custoAlevinoComTransf } from '../../js/calc.js';

const perto = (a, b, m, d = 0.01) => assert.ok(Math.abs(a - b) <= d, `${m}: ${a} ≠ ${b}`);
const ok = (m) => console.log('OK   ' + m);

const sam = { id: 'S', ativo: true, data_entrada: '2025-05-02', quantidade_inicial: 115400, peso_inicial_kg: 11540 };
const pei = { id: 'P', ativo: true, data_entrada: '2025-11-27', quantidade_inicial: 5500, peso_inicial_kg: 4950 };
const t1 = { id: 't1', data: '2025-11-27', lote_origem: 'S', lote_destino: 'P', quantidade: 5500, peso_medio_kg: 0.9, racao_kg: 4824.561, encerrou_origem: false };
const rac = [{ data: '2025-10-31', quantidade_kg: 100000 }];
const mort = [{ data: '2025-09-10', quantidade: 1400 }];

// origem
const bioS = [{ data: '2025-11-27', peso_amostra_kg: 4950, quantidade_amostrada: 5500 }];
const cS = calcularLote(sam, bioS, mort, rac, '2025-11-30', 3, [], [t1]);
assert.equal(cS.transferidos, 5500); assert.equal(cS.vivos, 115400 - 1400 - 5500);
ok('origem: vivos = 115.400 − 1.400 mortos − 5.500 transferidos = 108.500');
perto(cS.ganhoBiomassa, 108500 * 0.9 + 5500 * 0.9 - 11540, 'ganho conta o peixe que saiu');
ok('origem: o ganho de peso conta os peixes que saíram (não somem da conta da conversão)');
perto(cS.custoRacao, (100000 - 4824.561) * 3, 'custo da origem');
ok('origem: custo de ração = (100.000 − 4.824,56 kg que foram junto) × R$ 3');
assert.equal(cS.receita, null); assert.equal(cS.despescados, 0);
ok('transferência não é venda: sem receita e sem despesca');
assert.equal(vivosDoLote(sam, { mortos: 1400, despescados: 0, transferidos: 5500 }), 108500);
ok('vivosDoLote (Hoje, Tanques) desconta os transferidos');

// destino
const cP = calcularLote(pei, [], [], [{ data: '2025-12-31', quantidade_kg: 2000 }], '2026-01-01', 3, [], [t1]);
perto(cP.custoRacao, (2000 + 4824.561) * 3, 'custo do destino');
ok('destino: custo de ração = (2.000 kg dados aqui + 4.824,56 herdados) × R$ 3');
assert.equal(cP.racaoTotal, 2000);
ok('destino: a ração "fornecida" e a conversão contam só o que foi dado aqui');

// esvaziou
const fimS = { ...sam, ativo: false };
const t2 = { ...t1, id: 't2', data: '2026-02-18', quantidade: 108500, encerrou_origem: true, racao_kg: 95175.439 };
const cF = calcularLote(fimS, bioS, mort, rac, '2026-02-18', 3, [], [t1, t2]);
assert.equal(cF.tudoTransferido, true); assert.equal(cF.vivos, 0); assert.equal(cF.sobrevivencia, Math.min(100, (114000 / 115400) * 100));
ok('esvaziou: "tudo transferido", 0 vivos, sobrevivência = 114.000 que saíram ÷ 115.400');
perto(cF.custoRacao, 0, 'toda a ração foi junto');
ok('esvaziou: toda a ração foi junto com os peixes (custo 0 na origem)');
assert.equal(fimDoLote(fimS, bioS, mort, rac, '2026-11-16', [], [t1, t2]), '2026-02-18');
ok('fim do ciclo = dia da transferência que esvaziou');

// custo do alevino segue por peixe, encadeado
const eng = { id: 'E', quantidade_inicial: 5500 };
const t3 = { lote_origem: 'P', lote_destino: 'E', quantidade: 5500 };
const r = custoAlevinoComTransf([{ id: 'S', quantidade_inicial: 115400 }, { id: 'P', quantidade_inicial: 5500 }, eng], { S: 23080 }, [t1, t3]);
perto(r.S, 23080 - 5500 * 0.2, 'Samaúma fica com o resto'); perto(r.P, 0, 'Peixinho passou tudo adiante'); perto(r.E, 1100, 'engorda herda R$ 1.100');
ok('alevino: R$ 0,20 por peixe; 5.500 peixes levam R$ 1.100 e seguem para a engorda');
const r2 = custoAlevinoComTransf([{ id: 'S', quantidade_inicial: 115400 }, { id: 'P', quantidade_inicial: 5500 }], {}, [t1]);
assert.equal(r2.P, null);
ok('sem o custo do alevino na origem, o destino também fica sem (o lucro pede o valor)');
console.log('RESULTADO: TUDO OK');

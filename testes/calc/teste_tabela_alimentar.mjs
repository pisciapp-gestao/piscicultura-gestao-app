// Tabela de alimentação do tambaqui (enviada pelo cliente piloto, 16/11/2026): ração do dia, ração certa e quanto falta até vender.
// Rodar: node testes/calc/teste_tabela_alimentar.mjs
import assert from 'node:assert/strict';
import { racaoTabelaPorPeixe, racaoCertaAgora, previsaoRacao, sugestaoRacao } from '../../js/calc.js';
import { TABELA_ALIMENTAR, TAXA_RACAO } from '../../js/config.js';
const perto = (a, b, m, d = 0.5) => assert.ok(Math.abs(a - b) <= d, `${m}: ${a} ≠ ${b}`);
const ok = (m) => console.log('OK   ' + m);

assert.equal(TABELA_ALIMENTAR.length, 52); perto(TABELA_ALIMENTAR.reduce((s, r) => s + r[6], 0), 230886, 'soma da tabela');
ok('52 semanas, 230.886 kg para 40.000 peixes (igual ao papel)');
perto(racaoTabelaPorPeixe(0.002, 3.6) * 40000, 230886, 'tabela inteira');
ok('de 2 g a 3,6 kg a conta devolve a tabela inteira');
perto(racaoTabelaPorPeixe(0.264, 3.5) * 5092 / 25, 1101, 'Mucajá', 1);
ok('Mucajá: 5.092 peixes de 264 g até 3,5 kg = ~1.101 sacos (a conta mostrada ao Guilherme)');
assert.equal(racaoCertaAgora(1.6).racao, '28% proteína · 10 mm'); assert.equal(racaoCertaAgora(0.03).racao, '45% proteína · 2,6 mm'); assert.equal(racaoCertaAgora(0.03).tratos, 4);
ok('ração certa: 1,6 kg → 28% proteína 10 mm; 30 g → 45% proteína, 4 tratos');
const s = sugestaoRacao([{ id: 'a', quantidade_inicial: 40000, peso_inicial_kg: 40000 * 3 }], { a: { ultimo_peso_medio_kg: 3, mortos: 0, despescados: 0 } }, TAXA_RACAO);
perto(s.kg, 960, 'ração do dia');
ok('ração do dia: 40.000 peixes de 3 kg × 0,8% = 960 kg (a tabela antiga dava 1.800)');
const lote = { quantidade_inicial: 10000, peso_inicial_kg: 10000 * 0.3 };
const sem = previsaoRacao(lote, { ultimo_peso_medio_kg: 0.3, racao_kg: 0, mortos: 0 }, 3.5);
perto(sem.faltaKg, racaoTabelaPorPeixe(0.3, 3.5) * 10000, 'sem histórico'); assert.equal(sem.fator, null);
ok('sem crescimento medido: falta = tabela × peixes vivos');
const esperado = racaoTabelaPorPeixe(0.3, 1) * 10000;
const com = previsaoRacao(lote, { ultimo_peso_medio_kg: 1, racao_kg: esperado * 1.25, mortos: 0 }, 3.5);
perto(com.fator, 1.25, 'fator', 0.001); perto(com.faltaKg, racaoTabelaPorPeixe(1, 3.5) * 10000 * 1.25, 'com perda real');
ok('lote gastou 25% a mais que a tabela até aqui: a previsão soma 25%');
assert.equal(previsaoRacao(lote, { ultimo_peso_medio_kg: 3.6, mortos: 0 }, 3.5).pronto, true);
ok('já passou do peso de venda: pronto');
// conversão alimentar informada pela fazenda (sql/41): falta = vivos × (peso de venda − peso atual) × conversão
const ca = previsaoRacao(lote, { ultimo_peso_medio_kg: 0.8, racao_kg: 0, mortos: 500 }, 2.5, 1.9);
perto(ca.faltaKg, 9500 * 1.7 * 1.9, 'com conversão'); assert.equal(ca.conversao, 1.9); assert.equal(ca.fator, null);
perto(ca.tabelaKg, racaoTabelaPorPeixe(0.8, 2.5) * 9500, 'tabela continua calculada para comparar');
ok('conversão 1,9: 9.500 vivos × 1,7 kg × 1,9 = 30.685 kg (e a tabela ao lado, para comparar)');
const ca2 = previsaoRacao(lote, { ultimo_peso_medio_kg: 1, racao_kg: esperado * 1.25, mortos: 0 }, 3.5, 2.2);
perto(ca2.faltaKg, 10000 * 2.5 * 2.2, 'conversão manda'); assert.equal(ca2.fator, null);
ok('com conversão informada, o ajuste automático pela tabela não se soma (55.000 kg)');
for (const nada of [null, 0, '', undefined, -1]) assert.equal(previsaoRacao(lote, { ultimo_peso_medio_kg: 0.3, racao_kg: 0, mortos: 0 }, 3.5, nada).conversao, undefined);
ok('conversão vazia, zero ou inválida: volta para a tabela');
assert.equal(previsaoRacao(lote, { ultimo_peso_medio_kg: 3.6, mortos: 0 }, 3.5, 1.9).pronto, true);
ok('com conversão, peixe já no peso: pronto, nada a prever');
console.log('RESULTADO: TUDO OK');

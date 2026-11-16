// Tabela Socil (enviada pelo cliente piloto, 16/11/2026): ração do dia, ração certa e quanto falta até vender.
// Rodar: node testes/calc/teste_socil.mjs
import assert from 'node:assert/strict';
import { racaoTabelaPorPeixe, racaoCertaAgora, previsaoRacao, sugestaoRacao } from '../../js/calc.js';
import { SOCIL, TAXA_RACAO } from '../../js/config.js';
const perto = (a, b, m, d = 0.5) => assert.ok(Math.abs(a - b) <= d, `${m}: ${a} ≠ ${b}`);
const ok = (m) => console.log('OK   ' + m);

assert.equal(SOCIL.length, 52); perto(SOCIL.reduce((s, r) => s + r[6], 0), 230886, 'soma da tabela');
ok('52 semanas, 230.886 kg para 40.000 peixes (igual ao papel)');
perto(racaoTabelaPorPeixe(0.002, 3.6) * 40000, 230886, 'tabela inteira');
ok('de 2 g a 3,6 kg a conta devolve a tabela inteira');
perto(racaoTabelaPorPeixe(0.264, 3.5) * 5092 / 25, 1101, 'Mucajá', 1);
ok('Mucajá: 5.092 peixes de 264 g até 3,5 kg = ~1.101 sacos (a conta mostrada ao Guilherme)');
assert.equal(racaoCertaAgora(1.6).racao, 'Sport 28 · 10 mm'); assert.equal(racaoCertaAgora(0.03).racao, 'Alevinos 45 · 2,6 mm'); assert.equal(racaoCertaAgora(0.03).tratos, 4);
ok('ração certa: 1,6 kg → Sport 28 10 mm; 30 g → Alevinos 45, 4 tratos');
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
console.log('RESULTADO: TUDO OK');

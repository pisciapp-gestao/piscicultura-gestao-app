// Estoque que não cobre o lançamento de ração (13/11/2026): tipo de ração do lote e quanto falta,
// descontando o que está na fila do celular sem enviar. 10 mil casos comparados com uma conta de referência.
// Uso: node testes/calc/teste_estoque_falta.mjs
import { tipoRacaoDoLote, faltaNoEstoque, precoRacaoDoLote } from '../../js/calc.js';
let ok = true; const checa = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); ok = ok && c; };
checa(['alevinagem', 'bercario'].every((t) => tipoRacaoDoLote(t) === 'alevino') && ['recria', 'engorda', undefined, ''].every((t) => tipoRacaoDoLote(t) === 'engorda'), 'berçário e alevinagem usam ração de alevino; recria e engorda, a de engorda (igual ao sql/18)');
{ const cp = [{ tipo_racao: 'engorda', quantidade_kg: 1000, custo_total: 3000 }, { tipo_racao: 'alevino', quantidade_kg: 100, custo_total: 600 }];
  checa(precoRacaoDoLote(cp, 'engorda') === 3 && precoRacaoDoLote(cp, 'bercario') === 6 && precoRacaoDoLote(cp.slice(0, 1), 'alevinagem') === 3, 'preço da ração do lote: pelo tipo que ele come (engorda R$ 3, alevino R$ 6); sem compra do tipo, a média geral'); }
checa(faltaNoEstoque(1000, 0, 250) === 0, 'estoque de 1000 kg cobre 250 kg: não falta nada');
checa(faltaNoEstoque(0, 0, 50) === 50, 'estoque zerado: faltam os 50 kg lançados');
checa(faltaNoEstoque(-925, 0, 50) === 975, 'estoque já negativo (−925 kg): falta o que já faltava mais o lançamento');
checa(faltaNoEstoque(100, 80, 50) === 30, 'pendentes sem enviar contam: 100 − 80 na fila − 50 = faltam 30');
checa(faltaNoEstoque(null, 0, 50) === null && faltaNoEstoque(undefined, 0, 50) === null && faltaNoEstoque('abc', 0, 50) === null, 'saldo desconhecido (sem internet e sem cópia): não inventa falta');
checa(faltaNoEstoque(100, 0, 100) === 0, 'exatamente o que tem: não falta');
let semente = 1311; const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
let erros = 0;
for (let i = 0; i < 10000; i++) {
  const saldo = Math.round((rnd() * 4000 - 1000) * 100) / 100, pend = Math.round(rnd() * 800 * 100) / 100, kg = Math.round(rnd() * 600 * 100) / 100;
  const ref = Math.max(0, Math.round((pend + kg - saldo) * 100) / 100);
  if (Math.abs(faltaNoEstoque(saldo, pend, kg) - ref) > 0.011) erros += 1;
}
checa(erros === 0, `10 mil casos aleatórios batem com a conta de referência (${erros} diferentes)`);
console.log(ok ? 'RESULTADO: TUDO OK' : 'RESULTADO: COM FALHAS');

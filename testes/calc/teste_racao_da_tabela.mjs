// A etiqueta "pela tabela" no lançamento: qual ração cadastrada é a que a tabela de alimentação indica.
import { racaoDaTabela, racaoCertaAgora } from '../../js/calc.js';
let ok = true; const checa = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); ok = ok && c; };
const R = ['Inicial · 0,8 a 1,0 mm', '45% · 2,6 mm', '36% · 2,6 mm', '32% · 4/6 mm', '28% · 6/10 mm'].map((nome, i) => ({ id: String(i), nome }));
const nome = (r) => (r ? r.nome : null);
checa(nome(racaoDaTabela('28% proteína · 10 mm', R)) === '28% · 6/10 mm', '28% 10 mm → 28% · 6/10 mm');
checa(nome(racaoDaTabela('28% proteína · 6 mm', R)) === '28% · 6/10 mm', '28% 6 mm → 28% · 6/10 mm');
checa(nome(racaoDaTabela('32% proteína · 4 mm', R)) === '32% · 4/6 mm', '32% 4 mm → 32% · 4/6 mm');
checa(nome(racaoDaTabela('45% proteína · 2,6 mm', R)) === '45% · 2,6 mm', '45% 2,6 mm → 45%');
checa(nome(racaoDaTabela('Inicial · 1,8 mm', R)) === 'Inicial · 0,8 a 1,0 mm', 'Inicial de outro grão → a única Inicial');
checa(racaoDaTabela('40% proteína · 3 mm', R) === null, 'proteína que a fazenda não tem → sem etiqueta');
const duas = [{ id: 'a', nome: '28% · 6 mm' }, { id: 'b', nome: '28% · 10 mm' }];
checa(nome(racaoDaTabela('28% proteína · 10 mm', duas)) === '28% · 10 mm', 'duas de 28%: escolhe pelo grão');
checa(racaoDaTabela('28% proteína · 8 mm', duas) === null, 'duas de 28% e grão diferente → sem certeza, sem etiqueta');
checa(nome(racaoDaTabela('28% proteína · 10 mm', [{ id: 'x', nome: 'Marca X 28% engorda' }])) === 'Marca X 28% engorda', 'nome livre com 28%: acha pela proteína');
const t = racaoCertaAgora(1.26);
checa(!!t && nome(racaoDaTabela(t.racao, R)) === '28% · 6/10 mm', `peixe de 1,26 kg: tabela diz ${t && t.racao} → 28% · 6/10 mm`);
console.log(ok ? '\nRESULTADO: TUDO OK' : '\nRESULTADO: HOUVE FALHAS'); process.exit(ok ? 0 : 1);

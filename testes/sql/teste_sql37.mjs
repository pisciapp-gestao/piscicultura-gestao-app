// Testa o sql/37: transferência de peixes entre tanques (pedido do cliente piloto, 16/11/2026).
// Caso real: em 27/11/2025 o Samaúma mandou 5.500 peixes para o Peixinho e 6.500 para o Piranha, todos de 900 g.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = process.env.SQL_DIR || fileURLToPath(new URL('../../sql/', import.meta.url));
let ok = true; const checa = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); ok = ok && c; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$; grant usage on schema auth to anon, authenticated;`);
for (const f of readdirSync(DIR).filter((f) => /^\d\d_.*\.sql$/.test(f) && !f.startsWith('05_')).sort()) await db.exec(readFileSync(DIR + f, 'utf8'));
await db.exec(readFileSync(DIR + '37_transferencia.sql', 'utf8')); // de novo: pode repetir
await db.exec(`grant usage on schema public to anon, authenticated; grant select, insert, update, delete on all tables in schema public to anon, authenticated;`);
const R = '00000000-0000-4000-8000-0000000000b1', V = '00000000-0000-4000-8000-0000000000b2', F = '00000000-0000-4000-8000-0000000000b3', X = '00000000-0000-4000-8000-0000000000b4';
await db.exec(`insert into auth.users values ('${R}','r@x'), ('${V}','v@x'), ('${F}','f@x'), ('${X}','x@x');`);
const como = async (uid, sql) => { await db.exec(`set role authenticated; set teste.uid = '${uid}';`); try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { erro: e.message, rows: [] }; } finally { await db.exec(`reset role; set teste.uid = '';`); } };
const um = (r) => r.rows[0] && Object.values(r.rows[0])[0];
const q1 = async (sql) => (await db.query(sql)).rows[0];
const g = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

const FZ = um(await como(R, `select criar_fazenda('São carlos', 'Rai', '111.444.777-35')`));
await db.exec(`update fazendas set teste_ate = current_date + 30 where id = '${FZ}'`);
const conv = async (papel, uid, nome) => { const c = um(await como(R, `select criar_convite('${papel}')`)); await como(uid, `select aceitar_convite('${c}', '${nome}')`); };
await conv('gerente', V, 'Victor'); await conv('funcionario', F, 'Zé');
const tq = async (nome) => (await db.query(`insert into tanques (fazenda_id, nome) values ('${FZ}', '${nome}') returning id`)).rows[0].id; // preparo direto no banco
const T8 = await tq('Tanque 8 - Samaúma'), T16 = await tq('Tanque 16 - Peixinho'), T9 = await tq('Tanque 9 - Piranha'), T2 = await tq('Tanque 2 - 5.5');
await db.query(`insert into usuario_tanques select u, t from unnest(array['${V}','${F}']::uuid[]) u, unnest(array['${T8}','${T16}','${T9}','${T2}']::uuid[]) t`); // o Rai liberou os tanques
const L8 = (await db.query(`insert into lotes (tanque_id, tipo, especie, data_entrada, quantidade_inicial, peso_inicial_kg) values ('${T8}', 'recria', 'Tambaqui', '2025-05-02', 115400, 11540) returning id`)).rows[0].id;
const L2 = (await db.query(`insert into lotes (tanque_id, tipo, especie, data_entrada, quantidade_inicial, peso_inicial_kg) values ('${T2}', 'engorda', 'Tambaqui', '2025-08-01', 10000, 5000) returning id`)).rows[0].id;
await db.query(`insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por) values ('${g(1)}', '${L8}', '${T8}', '2025-10-31', 100000, '${R}')`);
await db.query(`insert into mortalidade (uuid_local, lote_id, data, quantidade, registrado_por) values ('${g(2)}', '${L8}', '2025-09-10', 1400, '${R}')`);
await db.query(`insert into biometrias (uuid_local, lote_id, data, peso_amostra_kg, quantidade_amostrada, registrado_por) values ('${g(3)}', '${L2}', '2025-10-01', 100, 100, '${R}')`);

const dest = (arr) => `'${JSON.stringify(arr)}'::jsonb`;
// 1 → 2: Samaúma → Peixinho (vazio) e Piranha (vazio)
let r = await como(F, `select registrar_transferencia('${g(10)}', '${L8}', '2025-11-27', ${dest([{ tanque_id: T16, quantidade: 5500, peso_medio_kg: 0.9, tipo: 'engorda' }])}, false)`);
checa(/dono e o gerente/.test(r.erro || ''), 'funcionário não lança transferência');
r = await como(V, `select registrar_transferencia('${g(10)}', '${L8}', '2025-11-27', ${dest([{ tanque_id: T16, quantidade: 5500, peso_medio_kg: 0.9, tipo: 'engorda' }, { tanque_id: T9, quantidade: 6500, peso_medio_kg: 0.9, tipo: 'engorda' }])}, false)`);
checa(!r.erro && um(r) === 2, `gerente transfere para 2 tanques ${r.erro || ''}`);
const n16 = await q1(`select * from lotes where tanque_id = '${T16}' and ativo`);
checa(n16 && n16.quantidade_inicial === 5500 && Number(n16.peso_inicial_kg) === 4950 && n16.tipo === 'engorda' && n16.data_entrada.toISOString().slice(0, 10) === '2025-11-27' && n16.especie === 'Tambaqui',
  'Peixinho vazio: nasce lote de engorda com 5.500 peixes, 4.950 kg, na data da transferência');
const res = Object.fromEntries((await como(R, `select * from resumo_lotes()`)).rows.map((x) => [x.lote_id, x]));
checa(Number(res[L8].transferidos) === 12000, 'resumo: o Samaúma tem 12.000 transferidos');
const vivos8 = um(await como(R, `select quantidade_inicial - ${Number(res[L8].mortos)} - ${Number(res[L8].despescados)} - ${Number(res[L8].transferidos)} from lotes where id = '${L8}'`));
checa(vivos8 === 102000, `ficam 115.400 − 1.400 mortos − 12.000 = 102.000 no Samaúma (${vivos8})`);
const t16 = await q1(`select * from transferencias where lote_destino = '${n16.id}'`);
// 100.000 kg de ração × 5.500 / 114.000 vivos = 4.824,561 kg
checa(Math.abs(Number(t16.racao_kg) - 4824.561) < 0.01, `o custo vai junto: 100.000 kg × 5.500/114.000 = 4.824,56 kg de ração (${t16.racao_kg})`);
checa(Number(res[L8].ultimo_peso_medio_kg) === 0.9, 'a pesagem da transferência vira a última biometria do Samaúma (900 g)');
checa((await q1(`select ativo from lotes where id = '${L8}'`)).ativo === true, 'sem esvaziar: o Samaúma continua ativo');
r = await como(V, `select registrar_transferencia('${g(10)}', '${L8}', '2025-11-27', ${dest([{ tanque_id: T16, quantidade: 5500, peso_medio_kg: 0.9 }])}, false)`);
checa(!r.erro && um(r) === 0 && Number((await q1(`select count(*) n from transferencias`)).n) === 2, 'reenvio do mesmo grupo não duplica');

// junta num tanque que já tem peixe: 5.5 tinha 10.000 de 1 kg
r = await como(R, `select registrar_transferencia('${g(11)}', '${L8}', '2026-03-05', ${dest([{ tanque_id: T2, quantidade: 16224, peso_medio_kg: 1.1 }])}, false)`);
const l2 = await q1(`select * from lotes where id = '${L2}'`);
checa(!r.erro && l2.quantidade_inicial === 26224 && Number(l2.peso_inicial_kg) === 22846.4, `juntar: o lote do 5.5 vai a 26.224 peixes e 22.846,4 kg na entrada ${r.erro || ''}`);
const b2 = await q1(`select peso_amostra_kg / quantidade_amostrada pm from biometrias where lote_id = '${L2}' order by data desc, criado_em desc limit 1`);
checa(Math.abs(Number(b2.pm) - (10000 * 1 + 16224 * 1.1) / 26224) < 0.0001, `juntar: a pesagem nova é a média dos dois grupos (${Number(b2.pm).toFixed(4)} kg)`);

// erros
r = await como(R, `select registrar_transferencia('${g(12)}', '${L8}', '2099-01-01', ${dest([{ tanque_id: T9, quantidade: 1, peso_medio_kg: 1 }])}, false)`);
checa(/futuro/.test(r.erro || ''), 'data no futuro é barrada');
r = await como(R, `select registrar_transferencia('${g(13)}', '${L8}', '2025-12-01', ${dest([{ tanque_id: T8, quantidade: 1, peso_medio_kg: 1 }])}, false)`);
checa(/mesmo tanque/.test(r.erro || ''), 'não transfere para o próprio tanque');
r = await como(R, `select registrar_transferencia('${g(14)}', '${L8}', '2025-12-01', ${dest([{ tanque_id: T9, quantidade: 0, peso_medio_kg: 1 }])}, false)`);
checa(/quantos peixes/.test(r.erro || ''), 'quantidade zero é barrada');
const rx = await como(X, `select criar_fazenda('Outra', 'Xavier', '529.982.247-25')`); if (rx.erro) console.log('ERRO', rx.erro); const outra = um(rx);
const TX = (await db.query(`insert into tanques (fazenda_id, nome) values ('${outra}', 'T') returning id`)).rows[0].id;
r = await como(R, `select registrar_transferencia('${g(15)}', '${L8}', '2025-12-01', ${dest([{ tanque_id: TX, quantidade: 1, peso_medio_kg: 1 }])}, false)`);
checa(/não encontrado/.test(r.erro || ''), 'não manda peixe para tanque de outra fazenda');
checa(um(await como(X, `select count(*)::int from transferencias`)) === 0, 'outra fazenda não enxerga as transferências');

// desfazer
const antes16 = n16.id;
r = await como(R, `select desfazer_transferencia('${g(11)}')`);
const l2b = await q1(`select * from lotes where id = '${L2}'`);
checa(!r.erro && l2b.quantidade_inicial === 10000 && Number(l2b.peso_inicial_kg) === 5000, `desfazer o juntar: o 5.5 volta a 10.000 peixes e 5.000 kg ${r.erro || ''}`);
checa(Number((await q1(`select peso_amostra_kg / quantidade_amostrada pm from biometrias where lote_id = '${L2}' order by data desc, criado_em desc limit 1`)).pm) === 1, 'desfazer tira a pesagem criada (volta a 1 kg)');
await db.query(`insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por) values ('${g(4)}', '${antes16}', '${T16}', '2025-11-30', 50, '${R}')`);
r = await como(R, `select desfazer_transferencia('${g(10)}')`);
checa(/já tem lançamentos/.test(r.erro || ''), 'não desfaz se o lote novo já tem ração lançada');
await db.exec(`delete from racao_consumo where uuid_local = '${g(4)}'`);
r = await como(R, `select desfazer_transferencia('${g(10)}')`);
checa(!r.erro && um(r) === 2 && !(await q1(`select 1 x from lotes where id = '${antes16}'`)), `desfazer o 1→2: os lotes novos somem ${r.erro || ''}`);
checa(Number((await como(R, `select transferidos from resumo_lotes() where lote_id = '${L8}'`)).rows[0].transferidos) === 0, 'o Samaúma volta a 0 transferidos');

// esvaziar: tudo o que sobrou vai para o Peixinho e o Samaúma se encerra
r = await como(R, `select registrar_transferencia('${g(16)}', '${L8}', '2026-02-18', ${dest([{ tanque_id: T16, quantidade: 114000, peso_medio_kg: 1.1, tipo: 'engorda' }])}, true)`);
checa(!r.erro && (await q1(`select ativo from lotes where id = '${L8}'`)).ativo === false, `esvaziou: o Samaúma se encerra ${r.erro || ''}`);
const t2 = await q1(`select * from transferencias where grupo = '${g(16)}'`);
checa(Math.abs(Number(t2.racao_kg) - 100000) < 0.01, 'esvaziou: toda a ração (100.000 kg) vai junto');
r = await como(R, `select registrar_transferencia('${g(17)}', '${L8}', '2026-02-19', ${dest([{ tanque_id: T9, quantidade: 1, peso_medio_kg: 1 }])}, false)`);
checa(/encerrado/.test(r.erro || ''), 'lote encerrado não transfere de novo');
r = await como(R, `select desfazer_transferencia('${g(16)}')`);
checa(!r.erro && (await q1(`select ativo from lotes where id = '${L8}'`)).ativo === true, `desfazer reabre o Samaúma ${r.erro || ''}`);
console.log(ok ? 'RESULTADO: TUDO OK' : 'RESULTADO: FALHOU'); process.exit(ok ? 0 : 1);

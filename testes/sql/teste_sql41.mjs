// Testa o sql/41: conversão alimentar da fazenda (só o dono) e de cada tanque (dono e gerente).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = process.env.SQL_DIR || fileURLToPath(new URL('../../sql/', import.meta.url));
let ok = true; const checa = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); ok = ok && c; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$; grant usage on schema auth to anon, authenticated;`);
await db.exec(`grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;`);
for (const f of readdirSync(DIR).filter((f) => /^\d\d_.*\.sql$/.test(f) && !f.startsWith('05_')).sort()) await db.exec(readFileSync(DIR + f, 'utf8'));
await db.exec(readFileSync(DIR + '41_conversao_alimentar.sql', 'utf8')); // de novo: pode repetir

const R = '00000000-0000-4000-8000-0000000000d1', V = '00000000-0000-4000-8000-0000000000d2', F = '00000000-0000-4000-8000-0000000000d3', X = '00000000-0000-4000-8000-0000000000d4';
await db.exec(`insert into auth.users values ('${R}','r@x'), ('${V}','v@x'), ('${F}','f@x'), ('${X}','x@x');`);
const como = async (uid, sql) => { await db.exec(uid ? `set role authenticated; set teste.uid = '${uid}';` : `set role anon; set teste.uid = '';`); try { const r = await db.query(sql); return { rows: r.rows, n: r.affectedRows || 0 }; } catch (e) { return { erro: e.message, rows: [], n: 0 }; } finally { await db.exec(`reset role; set teste.uid = '';`); } };
const um = (r) => r.rows[0] && Object.values(r.rows[0])[0];
const q1 = async (sql) => (await db.query(sql)).rows[0];

const FZ = um(await como(R, `select criar_fazenda('Fazenda Sol', 'Rai', '111.444.777-35')`));
await db.exec(`update fazendas set teste_ate = current_date + 30 where id = '${FZ}'`);
const conv = async (papel, uid, nome) => { const c = um(await como(R, `select criar_convite('${papel}')`)); await como(uid, `select aceitar_convite('${c}', '${nome}')`); };
await conv('gerente', V, 'Victor'); await conv('funcionario', F, 'Zé');
const T = (await db.query(`insert into tanques (fazenda_id, nome) values ('${FZ}', 'Tanque 3') returning id`)).rows[0].id;
await db.query(`insert into usuario_tanques values ('${V}', '${T}'), ('${F}', '${T}')`);
const caFaz = async () => (await q1(`select conversao_alimentar c from fazendas where id = '${FZ}'`)).c;
const caTq = async () => (await q1(`select conversao_alimentar c from tanques where id = '${T}'`)).c;

let r = await como(R, `update fazendas set conversao_alimentar = 1.9 where id = '${FZ}'`);
checa(!r.erro && Number(await caFaz()) === 1.9, `dono informa a conversão da fazenda (1,9) ${r.erro || ''}`);
checa(Number(um(await como(F, `select conversao_alimentar from fazendas`))) === 1.9, 'funcionário lê a conversão (a previsão aparece para todos)');
await como(V, `update fazendas set conversao_alimentar = 1.2 where id = '${FZ}'`);
checa(Number(await caFaz()) === 1.9, 'gerente não muda a conversão da fazenda');
await como(F, `update fazendas set conversao_alimentar = 1.2 where id = '${FZ}'`);
checa(Number(await caFaz()) === 1.9, 'funcionário não muda a conversão da fazenda');
r = await como(R, `update fazendas set conversao_alimentar = 9 where id = '${FZ}'`);
checa(!!r.erro && Number(await caFaz()) === 1.9, 'conversão 9 é recusada (fora de 0,5 a 5)');
r = await como(R, `update fazendas set conversao_alimentar = 0.3 where id = '${FZ}'`);
checa(!!r.erro, 'conversão 0,3 é recusada');
r = await como(R, `update fazendas set conversao_alimentar = null where id = '${FZ}'`);
checa(!r.erro && (await caFaz()) == null, 'dono apaga: volta a usar a tabela');

r = await como(V, `update tanques set conversao_alimentar = 2.2 where id = '${T}'`);
checa(!r.erro && Number(await caTq()) === 2.2, `gerente informa a conversão do tanque (2,2) ${r.erro || ''}`);
await como(F, `update tanques set conversao_alimentar = 1.1 where id = '${T}'`);
checa(Number(await caTq()) === 2.2, 'funcionário não muda a conversão do tanque');
r = await como(V, `update tanques set conversao_alimentar = 6 where id = '${T}'`);
checa(!!r.erro && Number(await caTq()) === 2.2, 'conversão 6 no tanque é recusada');
const outra = um(await como(X, `select criar_fazenda('Outra', 'Xavier', '529.982.247-25')`));
r = await como(X, `update tanques set conversao_alimentar = 1 where id = '${T}'`);
checa(Number(await caTq()) === 2.2, 'dono de outra fazenda não muda o tanque');
r = await como(X, `select conversao_alimentar from tanques where id = '${T}'`);
checa(r.rows.length === 0, 'dono de outra fazenda não lê a conversão do tanque');
r = await como(null, `select conversao_alimentar from fazendas`);
checa(!!r.erro || r.rows.length === 0, 'visitante sem login não lê a conversão');

console.log(ok ? '\nRESULTADO: TUDO OK (sql/41 conversão alimentar)' : '\nRESULTADO: HÁ FALHAS');
process.exit(ok ? 0 : 1);

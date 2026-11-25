// Testa o sql/40: povoamentos em outra data (o lote soma sozinho; só dono/gerente; corrigir e excluir). Postgres de verdade (PGlite).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = process.env.SQL_DIR || fileURLToPath(new URL('../../sql/', import.meta.url));
let ok = true; const checa = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); ok = ok && c; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$; grant usage on schema auth to anon, authenticated;`);
await db.exec(`grant usage on schema public to anon, authenticated; alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;`);
for (const f of readdirSync(DIR).filter((f) => /^\d\d_.*\.sql$/.test(f) && !f.startsWith('05_')).sort()) await db.exec(readFileSync(DIR + f, 'utf8'));
await db.exec(readFileSync(DIR + '40_povoamentos.sql', 'utf8')); // de novo: pode repetir
await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;`);

const D = '00000000-0000-4000-8000-0000000000a1', W = '00000000-0000-4000-8000-0000000000a3', G = '00000000-0000-4000-8000-0000000000a5', G2 = '00000000-0000-4000-8000-0000000000a6', D2 = '00000000-0000-4000-8000-0000000000a9';
const T = '00000000-0000-4000-8000-0000000000b1', T3 = '00000000-0000-4000-8000-0000000000b3', L = '00000000-0000-4000-8000-0000000000c1';
await db.exec(`insert into auth.users values ('${D}','d@x'), ('${W}','w@x'), ('${G}','g@x'), ('${G2}','g2@x'), ('${D2}','d2@x');`);
const como = async (uid, sql) => {
  await db.exec(`set role authenticated; set teste.uid = '${uid}';`);
  try { const r = await db.query(sql); return { rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { erro: e.message, rows: [], n: 0 }; }
  finally { await db.exec(`reset role; set teste.uid = '';`); }
};
await como(D, `select criar_fazenda('Fazenda X', 'Dono', '529.982.247-25')`);
await como(D2, `select criar_fazenda('Fazenda Y', 'Outro', '111.444.777-35')`);
const F = (await db.query(`select fazenda_id f from usuarios where id = '${D}'`)).rows[0].f;
await db.exec(`insert into usuarios (id, fazenda_id, nome, papel) values ('${W}','${F}','Func','funcionario'), ('${G}','${F}','Gerente','gerente'), ('${G2}','${F}','Gerente 2','gerente');
  insert into tanques (id, fazenda_id, nome) values ('${T}','${F}','T1'), ('${T3}','${F}','T3');
  insert into usuario_tanques (usuario_id, tanque_id) values ('${W}','${T}'), ('${G}','${T}'), ('${G2}','${T3}') on conflict do nothing;
  insert into lotes (id, tanque_id, tipo, especie, data_entrada, quantidade_inicial, peso_inicial_kg) values
    ('${L}','${T}','bercario','Tambaqui', hoje_local() - 10, 50000, 125);`); // 50.000 a 2,5 g
const lote = async () => (await db.query(`select quantidade_inicial q, peso_inicial_kg::float kg, data_entrada from lotes where id = '${L}'`)).rows[0];
const add = (uid, dias, q, kg) => como(uid, `insert into povoamentos (lote_id, data, quantidade, peso_total_kg, registrado_por) values ('${L}', hoje_local() - ${dias}, ${q}, ${kg}, '${uid}') returning id`);

// 30.000 peixes de 5 cm (~3 g) 4 dias depois
let r = await add(G, 6, 30000, 90);
checa(!r.erro, `gerente do tanque adiciona 30.000 peixes em outra data ${r.erro || ''}`);
const P1 = r.rows[0]?.id;
let l = await lote(); checa(l.q === 80000 && Math.abs(l.kg - 215) < 0.001, `lote soma sozinho: 80.000 peixes e 215 kg (veio ${l.q} e ${l.kg})`);
r = await add(D, 2, 10000, 30); const P2 = r.rows[0]?.id;
l = await lote(); checa(!r.erro && l.q === 90000 && Math.abs(l.kg - 245) < 0.001, `dono adiciona mais 10.000: 90.000 e 245 kg ${r.erro || ''}`);

// permissões
r = await add(W, 1, 1000, 3); checa(!!r.erro, 'funcionário NÃO adiciona povoamento');
r = await add(G2, 1, 1000, 3); checa(!!r.erro, 'gerente sem acesso ao tanque NÃO adiciona');
r = await add(D2, 1, 1000, 3); checa(!!r.erro, 'dono de outra fazenda NÃO adiciona');
r = await como(D2, `select count(*)::int c from povoamentos`); checa(r.rows[0]?.c === 0, 'dono de outra fazenda NÃO vê os povoamentos');
r = await como(W, `select count(*)::int c from povoamentos`); checa(r.rows[0]?.c === 2, 'funcionário do tanque vê os povoamentos');
r = await como(W, `delete from povoamentos where id = '${P1}'`); checa(r.n === 0 && (await lote()).q === 90000, 'funcionário NÃO exclui povoamento');

// regras de data
r = await add(G, 11, 1000, 3); checa(!!r.erro && /antes/.test(r.erro), 'data antes do 1º povoamento: recusada');
r = await add(G, -1, 1000, 3); checa(!!r.erro && /futuro/.test(r.erro), 'data no futuro: recusada');
r = await add(G, 1, 0, 3); checa(!!r.erro, 'zero peixes: recusado');

// corrigir
r = await como(G, `update povoamentos set quantidade = 20000, peso_total_kg = 60 where id = '${P1}'`);
l = await lote(); checa(!r.erro && r.n === 1 && l.q === 80000 && Math.abs(l.kg - 215) < 0.001, `corrigir 30.000 → 20.000: lote fica 80.000 e 215 kg ${r.erro || ''}`);
r = await como(G, `update povoamentos set data = hoje_local() - 20 where id = '${P1}'`); checa(!!r.erro, 'corrigir para antes do 1º povoamento: recusado');

// corrigir o 1º povoamento (pela tela do lote)
r = await como(D, `update lotes set data_entrada = hoje_local() - 3 where id = '${L}'`); checa(!!r.erro && /depois de outro/.test(r.erro), '1º povoamento não pode passar para depois de outro povoamento');
r = await como(D, `update lotes set quantidade_inicial = 30000 where id = '${L}'`); checa(!!r.erro, 'lote não pode ficar com menos peixes que os povoamentos extras');
r = await como(D, `update lotes set quantidade_inicial = 70000, peso_inicial_kg = 190 where id = '${L}'`); checa(!r.erro && r.n === 1, `corrigir o 1º povoamento para 40.000 (total 70.000) funciona ${r.erro || ''}`);

// excluir
r = await como(G, `delete from povoamentos where id = '${P2}'`);
l = await lote(); checa(!r.erro && r.n === 1 && l.q === 60000 && Math.abs(l.kg - 160) < 0.001, `excluir os 10.000: lote volta para 60.000 e 160 kg ${r.erro || ''}`);

// apagar o lote leva os povoamentos junto
r = await como(D, `delete from lotes where id = '${L}'`);
checa(!r.erro && (await db.query(`select count(*)::int c from povoamentos`)).rows[0].c === 0, `apagar o lote apaga os povoamentos ${r.erro || ''}`);

console.log(ok ? 'RESULTADO: TUDO OK' : 'RESULTADO: FALHOU');
process.exit(ok ? 0 : 1);

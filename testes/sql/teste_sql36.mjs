// Testa o sql/36: quem foi DESATIVADO numa fazenda aceita o convite de outra e muda de fazenda.
// Caso real (15/11/2026): o Victor saiu de uma fazenda e o convite de gerente do Rai dizia "já está ligada a uma fazenda".
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = process.env.SQL_DIR || fileURLToPath(new URL('../../sql/', import.meta.url));
let ok = true; const checa = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); ok = ok && c; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$; grant usage on schema auth to anon, authenticated;`);
for (const f of readdirSync(DIR).filter((f) => /^\d\d_.*\.sql$/.test(f) && !f.startsWith('05_')).sort()) await db.exec(readFileSync(DIR + f, 'utf8'));
await db.exec(readFileSync(DIR + '36_convite_muda_de_fazenda.sql', 'utf8')); // de novo: pode repetir
await db.exec(`grant usage on schema public to anon, authenticated; grant select, insert, update, delete on all tables in schema public to anon, authenticated;`);
const G = '00000000-0000-4000-8000-0000000000a1', R = '00000000-0000-4000-8000-0000000000a2', V = '00000000-0000-4000-8000-0000000000a3', N = '00000000-0000-4000-8000-0000000000a4';
await db.exec(`insert into auth.users values ('${G}','g@x'), ('${R}','r@x'), ('${V}','v@x'), ('${N}','n@x');`);
const como = async (uid, sql) => { await db.exec(`set role authenticated; set teste.uid = '${uid}';`); try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { erro: e.message, rows: [] }; } finally { await db.exec(`reset role; set teste.uid = '';`); } };
const um = (r) => r.rows[0] && Object.values(r.rows[0])[0];

const FG = um(await como(G, `select criar_fazenda('Suporte', 'Guilherme', '529.982.247-25')`));
const FR = um(await como(R, `select criar_fazenda('São carlos', 'Rai', '111.444.777-35')`));
const T1 = um(await como(G, `insert into tanques (fazenda_id, nome) values ('${FG}', 'T1') returning id`));
const conviteG = um(await como(G, `select criar_convite('gerente')`));
checa(!(await como(V, `select aceitar_convite('${conviteG}', 'Victor')`)).erro, 'Victor entra como gerente na fazenda do Guilherme');
await como(G, `insert into usuario_tanques values ('${V}', '${T1}')`);

const conviteR = um(await como(R, `select criar_convite('gerente')`));
let r = await como(V, `select aceitar_convite('${conviteR}', 'Victor')`);
checa(/ainda está ativa em outra fazenda/.test(r.erro || ''), `ainda ATIVO na fazenda antiga: o convite do Rai explica o que fazer (${r.erro})`);
checa(um(await como(V, `select current_fazenda()`)) === FG, 'recusado: o Victor continua na fazenda antiga');

await como(G, `update usuarios set ativo = false where id = '${V}'`); // o Guilherme desativa (Fazenda > Equipe)
checa(um(await como(V, `select count(*)::int from tanques`)) === 0, 'desativado: não vê mais nenhum tanque');
r = await como(V, `select aceitar_convite('${conviteR}', 'Victor Lima')`);
checa(!r.erro && um(r) === FR, `desativado: aceita o convite do Rai ${r.erro || ''}`);
const u = (await db.query(`select fazenda_id, papel, ativo, nome from usuarios where id = '${V}'`)).rows[0];
checa(u.fazenda_id === FR && u.papel === 'gerente' && u.ativo === true && u.nome === 'Victor Lima', 'agora é gerente ATIVO na São carlos, com o nome novo');
checa(um(await como(V, `select current_fazenda()`)) === FR, 'o banco já reconhece a fazenda nova');
checa((await db.query(`select count(*)::int n from usuario_tanques where usuario_id = '${V}'`)).rows[0].n === 0, 'os tanques liberados na fazenda antiga foram tirados');
checa(um(await como(V, `select count(*)::int from tanques where fazenda_id = '${FG}'`)) === 0, 'não enxerga nada da fazenda antiga');
checa(!!(await como(V, `select aceitar_convite('${conviteR}', 'Victor')`)).erro, 'o mesmo convite não serve duas vezes');

// dono não muda de fazenda por convite, nem desativado
await db.exec(`update usuarios set ativo = false where id = '${G}'`);
const outro = um(await como(R, `select criar_convite('funcionario')`));
r = await como(G, `select aceitar_convite('${outro}', 'Guilherme')`);
checa(/dono de outra fazenda/.test(r.erro || ''), `dono (mesmo desativado) não entra por convite (${r.erro})`);
await db.exec(`update usuarios set ativo = true where id = '${G}'`);
// conta nova continua igual
checa(!(await como(N, `select aceitar_convite('${outro}', 'Novo')`)).erro, 'conta nova aceita o convite como antes');
console.log(ok ? 'RESULTADO: TUDO OK' : 'RESULTADO: FALHOU'); process.exit(ok ? 0 : 1);

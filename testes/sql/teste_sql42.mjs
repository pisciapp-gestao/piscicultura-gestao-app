// Testa o sql/42: acompanhamento dos clientes no painel do administrador. Postgres de verdade (PGlite).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = process.env.SQL_DIR || fileURLToPath(new URL('../../sql/', import.meta.url));
let ok = true; const checa = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); ok = ok && c; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$; grant usage on schema auth to anon, authenticated;`);
for (const f of readdirSync(DIR).filter((f) => /^\d\d_.*\.sql$/.test(f) && !f.startsWith('05_')).sort()) await db.exec(readFileSync(DIR + f, 'utf8'));
await db.exec(readFileSync(DIR + '42_admin_acompanhamento.sql', 'utf8')); // de novo: pode repetir
await db.exec(`grant usage on schema public to anon, authenticated; grant select, insert, update, delete on all tables in schema public to anon, authenticated;`);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C = id(2), A = id(3), F2 = id(4);
await db.exec(`insert into auth.users values ('${C}','c@x'), ('${A}','a@x'), ('${F2}','f@x');`);
const como = async (uid, sql) => {
  await db.exec(`set role authenticated; set teste.uid = '${uid}';`);
  try { const r = await db.query(sql); return { rows: r.rows }; }
  catch (e) { return { erro: e.message, rows: [] }; }
  finally { await db.exec(`reset role; set teste.uid = '';`); }
};
await como(C, `select criar_fazenda('São Carlos', 'Paulo', '714.287.938-60')`);
await como(A, `select criar_fazenda('Fazenda do Hugo', 'Hugo', '390.533.447-05')`);
const faz = async (u) => (await db.query(`select fazenda_id f from usuarios where id = '${u}'`)).rows[0].f;
const Y = await faz(C), Z = await faz(A);
const hoje = (await db.query(`select (now() at time zone 'America/Boa_Vista')::date::text d`)).rows[0].d;
const dia = (n) => `('${hoje}'::date - ${n})`;
const T1 = id(11), T2 = id(12), L1 = id(21), L2 = id(22), L3 = id(23);
await db.exec(`insert into administradores (usuario_id) values ('${A}');
  insert into usuarios (id, fazenda_id, nome, papel) values ('${F2}', '${Y}', 'Zé', 'funcionario');
  insert into tanques (id, fazenda_id, nome) values ('${T1}', '${Y}', 'Tanque 1'), ('${T2}', '${Y}', 'Tanque 2');
  insert into lotes (id, tanque_id, tipo, especie, data_entrada, quantidade_inicial, peso_inicial_kg, ativo) values
    ('${L1}', '${T1}', 'engorda', 'Tambaqui', ${dia(90)}, 5000, 500, true),
    ('${L2}', '${T2}', 'engorda', 'Tambaqui', ${dia(30)}, 2000, 100, true),
    ('${L3}', '${T2}', 'engorda', 'Tambaqui', ${dia(400)}, 9000, 900, false);
  insert into biometrias (uuid_local, lote_id, data, peso_amostra_kg, quantidade_amostrada, registrado_por) values
    ('${id(31)}', '${L1}', ${dia(20)}, 20, 50, '${C}'), ('${id(32)}', '${L1}', ${dia(5)}, 40, 50, '${C}');
  insert into mortalidade (uuid_local, lote_id, data, quantidade, registrado_por) values
    ('${id(41)}', '${L1}', ${dia(2)}, 30, '${F2}'), ('${id(42)}', '${L1}', ${dia(20)}, 70, '${F2}'), ('${id(43)}', '${L2}', ${dia(0)}, 5, '${F2}');
  insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por) values
    ('${id(51)}', '${L1}', '${T1}', ${dia(0)}, 100, '${F2}'), ('${id(52)}', '${L2}', '${T2}', ${dia(0)}, 25, '${F2}'),
    ('${id(53)}', '${L1}', '${T1}', ${dia(1)}, 90, '${F2}'), ('${id(54)}', '${L1}', '${T1}', ${dia(7)}, 80, '${F2}'), ('${id(55)}', '${L1}', '${T1}', ${dia(8)}, 999, '${F2}');
  insert into racao_estoque (fazenda_id, data_compra, quantidade_kg) values ('${Y}', ${dia(30)}, 5000);
  insert into qualidade_agua (uuid_local, tanque_id, data, hora, oxigenio_mgl, registrado_por) values
    ('${id(61)}', '${T1}', ${dia(1)}, '07:00', 5.5, '${F2}'), ('${id(62)}', '${T2}', ${dia(0)}, '06:30', 3.2, '${F2}'), ('${id(63)}', '${T1}', ${dia(0)}, '05:00', 4.1, '${F2}');`);

// despesca e transferência saem dos vivos
await db.exec(`insert into despescas (uuid_local, lote_id, data, tipo, quantidade, peso_bruto_kg, registrado_por) values ('${id(71)}', '${L1}', ${dia(3)}, 'parcial', 400, 300, '${C}')`).catch((e) => console.log('despesca:', e.message));

let r = await como(A, `select * from admin_acompanhamento() where fazenda_id = '${Y}'`);
checa(!r.erro && r.rows.length === 1, 'administrador vê a linha da fazenda do cliente' + (r.erro ? ': ' + r.erro : ''));
const x = r.rows[0] || {};
checa(Number(x.lotes_ativos) === 2, `lotes ativos = 2 (o encerrado não conta): ${x.lotes_ativos}`);
checa(Number(x.peixes_vivos) === (5000 - 100 - 400) + (2000 - 5), `peixes vivos = entrada − mortos − despescados: ${x.peixes_vivos}`);
checa(Math.abs(Number(x.biomassa_kg) - 4500 * 0.8) < 0.01, `biomassa só dos lotes pesados (4.500 × 0,8 kg = 3.600): ${x.biomassa_kg}`);
checa(Number(x.lotes_sem_biometria) === 1, 'lote sem biometria contado à parte');
checa(Number(x.racao_hoje_kg) === 125, `ração de hoje = 125 kg: ${x.racao_hoje_kg}`);
checa(Number(x.racao_7d_kg) === 170, `ração dos 7 dias antes de hoje = 90 + 80 (o dia 8 fica fora): ${x.racao_7d_kg}`);
checa(Number(x.mortos_7d) === 35, `mortes de hoje e dos 6 dias antes = 30 + 5: ${x.mortos_7d}`);
checa(Number(x.estoque_kg) === 5000 - 1294, `estoque = comprado − consumido: ${x.estoque_kg}`);
checa(Number(x.oxigenio_mgl) === 3.2 && x.oxigenio_tanque === 'Tanque 2', `última medição de oxigênio (hoje 06:30 no Tanque 2): ${x.oxigenio_mgl} ${x.oxigenio_tanque}`);
checa(x.ultima_atividade != null, 'última atividade preenchida');
const zr = (await como(A, `select * from admin_acompanhamento() where fazenda_id = '${Z}'`)).rows[0];
checa(zr && Number(zr.lotes_ativos) === 0 && Number(zr.peixes_vivos) === 0 && zr.biomassa_kg == null && zr.ultima_atividade == null, 'fazenda sem nada: zeros e vazios, sem erro');

r = await como(C, `select * from admin_acompanhamento()`);
checa(/administradores/.test(r.erro || ''), 'dono de fazenda (não administrador) é barrado');
r = await como(F2, `select * from admin_acompanhamento()`);
checa(/administradores/.test(r.erro || ''), 'funcionário é barrado');
await db.exec(`set role anon; set teste.uid = '';`);
try { await db.query(`select * from admin_acompanhamento()`); checa(false, 'visitante sem login é barrado'); } catch (e) { checa(true, 'visitante sem login é barrado'); }
await db.exec(`reset role;`);

console.log(ok ? 'RESULTADO: TUDO OK' : 'RESULTADO: HÁ FALHAS');
process.exit(ok ? 0 : 1);

// Testa o sql/39: estoque por ração (pedido de 17/11/2026). Fazenda São carlos com 3 rações.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = process.env.SQL_DIR || fileURLToPath(new URL('../../sql/', import.meta.url));
let ok = true; const checa = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); ok = ok && c; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$; grant usage on schema auth to anon, authenticated;`);
for (const f of readdirSync(DIR).filter((f) => /^\d\d_.*\.sql$/.test(f) && !f.startsWith('05_')).sort()) await db.exec(readFileSync(DIR + f, 'utf8'));
await db.exec(readFileSync(DIR + '39_racao_por_tipo.sql', 'utf8')); // de novo: pode repetir
await db.exec(`grant usage on schema public to anon, authenticated; grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  revoke select on racao_estoque from anon, authenticated;
  grant select (id, fazenda_id, data_compra, quantidade_kg, fornecedor, criado_em, sacos_nota, sacos_recebidos, tipo_racao, racao_id) on racao_estoque to authenticated;`);
const R = '00000000-0000-4000-8000-0000000000c1', V = '00000000-0000-4000-8000-0000000000c2', F = '00000000-0000-4000-8000-0000000000c3', X = '00000000-0000-4000-8000-0000000000c4';
await db.exec(`insert into auth.users values ('${R}','r@x'), ('${V}','v@x'), ('${F}','f@x'), ('${X}','x@x');`);
const como = async (uid, sql) => { await db.exec(`set role authenticated; set teste.uid = '${uid}';`); try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { erro: e.message, rows: [] }; } finally { await db.exec(`reset role; set teste.uid = '';`); } };
const um = (r) => r.rows[0] && Object.values(r.rows[0])[0];
const g = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

const FZ = um(await como(R, `select criar_fazenda('São carlos', 'Rai', '111.444.777-35')`));
await db.exec(`update fazendas set teste_ate = current_date + 30 where id = '${FZ}'`);
const conv = async (papel, uid, nome) => { const c = um(await como(R, `select criar_convite('${papel}')`)); await como(uid, `select aceitar_convite('${c}', '${nome}')`); };
await conv('gerente', V, 'Victor'); await conv('funcionario', F, 'Zé');
const T1 = (await db.query(`insert into tanques (fazenda_id, nome) values ('${FZ}', 'Tanque 1') returning id`)).rows[0].id;
await db.query(`insert into usuario_tanques values ('${V}', '${T1}'), ('${F}', '${T1}')`);
const L1 = (await db.query(`insert into lotes (tanque_id, tipo, especie, data_entrada, quantidade_inicial, peso_inicial_kg) values ('${T1}', 'engorda', 'Tambaqui', current_date - 60, 10000, 5000) returning id`)).rows[0].id;

// cadastro
let r = await como(F, `insert into racoes (fazenda_id, nome) values ('${FZ}', '28% · 6/10 mm') returning id`);
checa(!!r.erro, 'funcionário não cadastra ração');
r = await como(V, `insert into racoes (fazenda_id, nome, fase, cor) values ('${FZ}', '28% · 6/10 mm', 'engorda', 4) returning id`);
checa(!r.erro, `gerente cadastra ração ${r.erro || ''}`); const R28 = um(r);
const R32 = um(await como(R, `insert into racoes (fazenda_id, nome, fase, cor) values ('${FZ}', '32% · 4/6 mm', 'recria', 2) returning id`));
const R45 = um(await como(R, `insert into racoes (fazenda_id, nome, fase, cor) values ('${FZ}', '45% · 2,6 mm', 'alevino', 1) returning id`));
r = await como(R, `insert into racoes (fazenda_id, nome) values ('${FZ}', ' 28% · 6/10 MM ') returning id`);
checa(!!r.erro, 'não deixa duas rações com o mesmo nome');
checa(um(await como(F, `select count(*)::int from racoes`)) === 3, 'funcionário vê as 3 rações (para escolher)');
r = await como(F, `update racoes set ativa = false where id = '${R45}' returning id`);
checa(!r.rows.length, 'funcionário não desativa ração');

// começo: contagem no galpão (38 sacos de 25 kg de 28% e 12 de 32%)
r = await como(F, `select registrar_contagem_racao('${R28}', 950)`);
checa(/permissão/.test(r.erro || ''), 'funcionário não registra contagem');
r = await como(V, `select registrar_contagem_racao('${R28}', 950, 'contagem inicial')`);
checa(!r.erro && Number(um(r)) === 950, `contagem inicial de 28%: diferença = 950 kg ${r.erro || ''}`);
await como(V, `select registrar_contagem_racao('${R32}', 300)`);

// compra e tratos
r = await como(V, `insert into racao_estoque (fazenda_id, data_compra, quantidade_kg, tipo_racao, racao_id) values ('${FZ}', current_date, 1000, 'engorda', '${R28}') returning id`);
checa(!r.erro, `compra de 40 sacos de 28% ${r.erro || ''}`);
r = await como(F, `insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por, racao_id) values ('${g(1)}', '${L1}', '${T1}', current_date - 1, 250, '${F}', '${R28}') returning id`);
checa(!r.erro, `trato de 250 kg de 28% ${r.erro || ''}`);
await como(F, `insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por, racao_id) values ('${g(2)}', '${L1}', '${T1}', current_date - 1, 50, '${F}', '${R32}')`);
await como(F, `insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por) values ('${g(3)}', '${L1}', '${T1}', current_date - 2, 999, '${F}')`);

const s = Object.fromEntries((await como(F, `select * from saldo_por_racao()`)).rows.map((x) => [x.racao_id, x]));
checa(Number(s[R28].saldo_kg) === 1700, `28%: 950 contados + 1.000 comprados − 250 dados = 1.700 kg (${s[R28] && s[R28].saldo_kg})`);
checa(Number(s[R32].saldo_kg) === 250 && Number(s[R32].consumo_7d_kg) === 50, `32%: 300 − 50 = 250 kg; gastou 50 nos 7 dias (${s[R32] && s[R32].saldo_kg})`);
checa(Number(s[R45].saldo_kg) === 0, '45%: sem nada, saldo 0');
checa(Object.keys(s).length === 3, 'o trato antigo sem ração não entra em nenhuma ração');
const ordem = (await como(R, `select nome from saldo_por_racao()`)).rows.map((x) => x.nome);
checa(ordem.join('|') === '45% · 2,6 mm|32% · 4/6 mm|28% · 6/10 mm', `ordem: alevino, recria, engorda (${ordem.join(' | ')})`);
r = await como(V, `select registrar_contagem_racao('${R28}', 1650)`);
checa(Number(um(r)) === -50, 'contagem depois: faltaram 50 kg (1.650 − 1.700)');
const cd = (await como(F, `select * from consumo_diario_racao(30, '${R28}')`)).rows;
checa(cd.length === 1 && Number(cd[0].quantidade_kg) === 250, 'extrato de 28%: um dia com 250 kg');
const vis = (await como(V, `select racao_id from racao_estoque`)).rows;
checa(vis.length === 1 && vis[0].racao_id === R28, 'compras saem com a ração');

// outra fazenda
const outra = um(await como(X, `select criar_fazenda('Outra', 'Xavier', '529.982.247-25')`));
await db.exec(`update fazendas set teste_ate = current_date + 30 where id = '${outra}'`);
const RX = um(await como(X, `insert into racoes (fazenda_id, nome) values ('${outra}', 'Dele') returning id`));
checa(um(await como(X, `select count(*)::int from racoes`)) === 1, 'outra fazenda só vê a própria ração');
r = await como(F, `insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por, racao_id) values ('${g(4)}', '${L1}', '${T1}', current_date, 10, '${F}', '${RX}')`);
checa(/não encontrada/.test(r.erro || ''), 'trato não usa ração de outra fazenda');
r = await como(R, `select registrar_contagem_racao('${RX}', 10)`);
checa(/não encontrada/.test(r.erro || ''), 'contagem não usa ração de outra fazenda');
r = await como(R, `insert into racoes (fazenda_id, nome) values ('${outra}', 'Intrusa')`);
checa(!!r.erro, 'não cadastra ração na fazenda dos outros');
r = await como(X, `select * from saldo_por_racao()`);
checa(r.rows.length === 1 && Number(r.rows[0].saldo_kg) === 0, 'saldo da outra fazenda não mistura');

// desativar
r = await como(V, `update racoes set ativa = false where id = '${R45}' returning id`);
checa(r.rows.length === 1, 'gerente desativa a ração que não usa');
checa((await como(R, `select nome from saldo_por_racao()`)).rows.at(-1).nome === '45% · 2,6 mm', 'desativada vai para o fim da lista');

console.log(ok ? '\nRESULTADO: TUDO OK' : '\nRESULTADO: HOUVE FALHAS'); process.exit(ok ? 0 : 1);

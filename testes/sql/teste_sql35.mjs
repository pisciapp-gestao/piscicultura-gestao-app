// Testa o sql/35: pedir correção (funcionário pede, dono ou gerente aprova ou recusa). Postgres de verdade (PGlite).
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
await db.exec(readFileSync(DIR + '35_pedir_correcao.sql', 'utf8')); // de novo: pode repetir
await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated; revoke insert, update, delete on pedidos_correcao from anon, authenticated;`);

const D = '00000000-0000-4000-8000-0000000000a1', W = '00000000-0000-4000-8000-0000000000a3', W2 = '00000000-0000-4000-8000-0000000000a4', G = '00000000-0000-4000-8000-0000000000a5', G2 = '00000000-0000-4000-8000-0000000000a6';
const D2 = '00000000-0000-4000-8000-0000000000a9';
const T = '00000000-0000-4000-8000-0000000000b1', T3 = '00000000-0000-4000-8000-0000000000b3', L = '00000000-0000-4000-8000-0000000000c1', L3 = '00000000-0000-4000-8000-0000000000c3';
await db.exec(`insert into auth.users values ('${D}','d@x'), ('${W}','w@x'), ('${W2}','w2@x'), ('${G}','g@x'), ('${G2}','g2@x'), ('${D2}','d2@x');`);
const como = async (uid, sql) => {
  await db.exec(`set role authenticated; set teste.uid = '${uid}';`);
  try { const r = await db.query(sql); return { rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { erro: e.message, rows: [], n: 0 }; }
  finally { await db.exec(`reset role; set teste.uid = '';`); }
};
await como(D, `select criar_fazenda('Fazenda X', 'Dono', '529.982.247-25')`);
await como(D2, `select criar_fazenda('Fazenda Y', 'Outro', '111.444.777-35')`);
const F = (await db.query(`select fazenda_id f from usuarios where id = '${D}'`)).rows[0].f;
await db.exec(`insert into usuarios (id, fazenda_id, nome, papel) values ('${W}','${F}','Func','funcionario'), ('${W2}','${F}','Func 2','funcionario'), ('${G}','${F}','Gerente','gerente'), ('${G2}','${F}','Gerente 2','gerente');
  insert into tanques (id, fazenda_id, nome) values ('${T}','${F}','T1'), ('${T3}','${F}','T3');
  insert into usuario_tanques (usuario_id, tanque_id) values ('${W}','${T}'), ('${W2}','${T}'), ('${G}','${T}'), ('${G2}','${T3}') on conflict do nothing;
  insert into lotes (id, tanque_id, tipo, especie, data_entrada, quantidade_inicial, peso_inicial_kg) values
    ('${L}','${T}','engorda','Tambaqui','2026-01-01',3000,300), ('${L3}','${T3}','engorda','Tambaqui','2026-01-01',100,10);`);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const idDe = async (tab, n) => (await db.query(`select id from ${tab} where uuid_local='${uuid(n)}'`)).rows[0]?.id;
const val = async (tab, col, n) => (await db.query(`select ${col} v from ${tab} where uuid_local='${uuid(n)}'`)).rows[0]?.v;
const diasAtras = (tab, n, d) => db.exec(`update ${tab} set data = hoje_local() - ${d}, criado_em = now() - interval '${d} days' where uuid_local='${uuid(n)}'`);
const racao = async (uid, n, q, dias = 2) => { await db.exec(`insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por) values ('${uuid(n)}','${L}','${T}',hoje_local(),${q},'${uid}')`); await diasAtras('racao_consumo', n, dias); return idDe('racao_consumo', n); };
const pedir = (uid, tab, id, acao, campos, motivo = 'Digitei o número errado') => como(uid, `select pedir_correcao('${tab}', '${id}', '${acao}', '${JSON.stringify(campos)}'::jsonb, '${motivo}') id`);
const responder = (uid, id, aprovar, resp = null) => como(uid, `select responder_correcao('${id}', ${aprovar}, ${resp == null ? 'null' : `'${resp}'`}) r`);
const pedido = async (id) => (await db.query(`select * from pedidos_correcao where id = '${id}'`)).rows[0];

// ---- pedir e aprovar ----
const r1 = await racao(W, 1, 6000);
let r = await pedir(W, 'racao_consumo', r1, 'corrigir', { quantidade_kg: 600 });
checa(!r.erro && r.rows[0]?.id, `funcionário pede: ração de 2 dias atrás, 6000 → 600 kg ${r.erro || ''}`);
const p1 = r.rows[0]?.id;
checa((await pedido(p1))?.status === 'pendente' && Number((await pedido(p1)).antes.quantidade_kg) === 6000, 'pedido guarda o valor lançado e fica pendente');
checa(Number(await val('racao_consumo', 'quantidade_kg', 1)) === 6000, 'pedir NÃO muda o lançamento');
r = await pedir(W, 'racao_consumo', r1, 'corrigir', { quantidade_kg: 500 });
checa(!!r.erro && /aberto/.test(r.erro), 'segundo pedido do mesmo lançamento: recusado');
r = await como(W, `select count(*)::int c from pedidos_correcao`); checa(r.rows[0]?.c === 1, 'funcionário vê o próprio pedido');
r = await como(W2, `select count(*)::int c from pedidos_correcao`); checa(r.rows[0]?.c === 0, 'outro funcionário NÃO vê o pedido');
r = await como(G2, `select count(*)::int c from pedidos_correcao`); checa(r.rows[0]?.c === 0, 'gerente sem acesso ao tanque NÃO vê o pedido');
r = await como(D2, `select count(*)::int c from pedidos_correcao`); checa(r.rows[0]?.c === 0, 'dono de outra fazenda NÃO vê o pedido');
r = await como(G, `select count(*)::int c from pedidos_correcao where status='pendente'`); checa(r.rows[0]?.c === 1, 'gerente do tanque vê o pedido');
r = await responder(W, p1, true); checa(!!r.erro && Number(await val('racao_consumo', 'quantidade_kg', 1)) === 6000, 'funcionário NÃO aprova o próprio pedido');
r = await responder(G2, p1, true); checa(!!r.erro, 'gerente sem acesso ao tanque NÃO aprova');
r = await responder(D2, p1, true); checa(!!r.erro, 'dono de outra fazenda NÃO aprova');
r = await como(W, `update pedidos_correcao set status = 'aprovado' where id = '${p1}'`); checa(!!r.erro || r.n === 0, 'ninguém muda o pedido direto na tabela');
r = await como(W, `insert into pedidos_correcao (fazenda_id, tabela, registro_id, acao, antes, motivo, pedido_por) values ('${F}','racao_consumo','${r1}','apagar','{}','x','${W}')`); checa(!!r.erro, 'ninguém cria pedido direto na tabela (só pela função)');
r = await responder(G, p1, true);
checa(!r.erro && r.rows[0]?.r === 'aprovado' && Number(await val('racao_consumo', 'quantidade_kg', 1)) === 600, `gerente aprova: o banco corrige para 600 kg ${r.erro || ''}`);
const pp = await pedido(p1);
checa(pp.status === 'aprovado' && pp.respondido_por === G && pp.respondido_em, 'pedido fica aprovado, com quem respondeu e quando');
const h = (await db.query(`select quem, antes->>'quantidade_kg' a, depois->>'quantidade_kg' d from historico where tabela='racao_consumo' and registro_id='${r1}' order by id desc limit 1`)).rows[0];
checa(h && h.quem === G && Number(h.a) === 6000 && Number(h.d) === 600, 'Histórico: quem aprovou, antes 6000 e depois 600');
r = await responder(D, p1, false); checa(!!r.erro && /respondido/.test(r.erro), 'pedido já respondido não responde de novo');

// ---- recusar, cancelar, apagar ----
const m1 = (await db.exec(`insert into mortalidade (uuid_local, lote_id, data, quantidade, registrado_por) values ('${uuid(2)}','${L}',hoje_local(),30,'${W}')`), await diasAtras('mortalidade', 2, 3), await idDe('mortalidade', 2));
r = await pedir(W, 'mortalidade', m1, 'corrigir', { quantidade: 3 }); const p2 = r.rows[0]?.id;
r = await responder(D, p2, false, 'Contei 30 mesmo');
checa(!r.erro && (await pedido(p2)).status === 'recusado' && (await pedido(p2)).resposta === 'Contei 30 mesmo' && Number(await val('mortalidade', 'quantidade', 2)) === 30, 'dono recusa com motivo: o lançamento fica como estava');
r = await pedir(W, 'mortalidade', m1, 'apagar', {}, 'Lancei duas vezes'); const p3 = r.rows[0]?.id;
checa(!r.erro, `depois de recusado, pode pedir de novo (agora para apagar) ${r.erro || ''}`);
r = await como(W2, `select cancelar_pedido_correcao('${p3}')`); checa(!!r.erro, 'outro funcionário NÃO cancela o pedido');
r = await como(W, `select cancelar_pedido_correcao('${p3}')`); checa(!r.erro && (await pedido(p3)).status === 'cancelado', 'quem pediu cancela');
r = await pedir(W, 'mortalidade', m1, 'apagar', {}, 'Lancei duas vezes'); const p4 = r.rows[0]?.id;
r = await responder(D, p4, true);
checa(!r.erro && !(await idDe('mortalidade', 2)), `pedido de apagar aprovado: o lançamento sai ${r.erro || ''}`);
checa((await db.query(`select count(*)::int c from historico where tabela='mortalidade' and acao='excluiu' and registro_id='${m1}'`)).rows[0].c === 1, 'a exclusão vai para o Histórico (dá para restaurar)');

// ---- regras do pedido ----
const r5 = await racao(D, 5, 600); r = await pedir(W, 'racao_consumo', r5, 'corrigir', { quantidade_kg: 60 }); checa(!!r.erro && /quem lançou/.test(r.erro), 'NÃO pede correção do lançamento de outra pessoa');
const r6 = await racao(W, 6, 600, 9); r = await pedir(W, 'racao_consumo', r6, 'corrigir', { quantidade_kg: 60 }); checa(!!r.erro && /7 dias/.test(r.erro), 'lançamento com mais de 7 dias: só dono ou gerente');
const r7 = await racao(W, 7, 600);
for (const [c, m] of [[{ quantidade_kg: 0 }, 'zero kg'], [{ quantidade_kg: 99999 }, 'kg absurdo'], [{ quantidade_kg: 'abc' }, 'texto'], [{ tanque_id: T3 }, 'campo que não pode'], [{ registrado_por: D }, 'trocar quem lançou'], [{}, 'vazio'], [{ quantidade_kg: 600 }, 'igual ao lançado']]) {
  r = await pedir(W, 'racao_consumo', r7, 'corrigir', c); checa(!!r.erro, `recusa: ${m}`);
}
r = await pedir(W, 'racao_consumo', r7, 'corrigir', { quantidade_kg: 60 }, ''); checa(!!r.erro, 'recusa: sem motivo');
r = await pedir(W, 'despescas', r7, 'apagar', {}); checa(!!r.erro, 'despesca: sem pedido (só dono e gerente)');
const b1 = (await db.exec(`insert into biometrias (uuid_local, lote_id, data, peso_amostra_kg, quantidade_amostrada, registrado_por) values ('${uuid(8)}','${L}',hoje_local(),24,20,'${W}')`), await diasAtras('biometrias', 8, 1), await idDe('biometrias', 8));
r = await pedir(W, 'biometrias', b1, 'corrigir', { quantidade_amostrada: 2.5 }); checa(!!r.erro, 'peixes pesados: só número inteiro');
r = await pedir(W, 'biometrias', b1, 'corrigir', { peso_amostra_kg: 2.4, quantidade_amostrada: 30 }); const p8 = r.rows[0]?.id;
checa(!r.erro, `pesagem: corrige peso e quantidade juntos ${r.erro || ''}`);
await db.exec(`update biometrias set peso_amostra_kg = 25 where id = '${b1}'`); // o dono mexeu antes de aprovar
r = await responder(D, p8, true); checa(!!r.erro && /mudou/.test(r.erro) && Number(await val('biometrias', 'peso_amostra_kg', 8)) === 25, 'lançamento mudou depois do pedido: NÃO aplica por cima');
r = await responder(D, p8, false, 'Já corrigi'); checa(!r.erro, 'e o dono recusa');
const a1 = (await db.exec(`insert into qualidade_agua (uuid_local, tanque_id, data, oxigenio_mgl, ph, registrado_por) values ('${uuid(9)}','${T}',hoje_local(),50,7,'${W}')`.replace(',50,7,', ',5,7,')), await diasAtras('qualidade_agua', 9, 1), await idDe('qualidade_agua', 9));
r = await pedir(W, 'qualidade_agua', a1, 'corrigir', { oxigenio_mgl: 30 }); checa(!!r.erro, 'água: oxigênio 30 recusado');
r = await pedir(W, 'qualidade_agua', a1, 'corrigir', { oxigenio_mgl: null, ph: null }); checa(!!r.erro, 'água: não deixa a medição sem nenhum valor');
r = await pedir(W, 'qualidade_agua', a1, 'corrigir', { oxigenio_mgl: 3.5, ph: null }); const p9 = r.rows[0]?.id;
r = await responder(G, p9, true);
checa(!r.erro && Number(await val('qualidade_agua', 'oxigenio_mgl', 9)) === 3.5 && (await val('qualidade_agua', 'ph', 9)) === null, `água: corrige o oxigênio e tira o pH ${r.erro || ''}`);
const mj = (await db.exec(`insert into manejos (uuid_local, lote_id, data, produto, dose, unidade, via, registrado_por) values ('${uuid(10)}','${L}',hoje_local(),'Bac',2000,'g','racao','${W}')`), await diasAtras('manejos', 10, 2), await idDe('manejos', 10));
r = await pedir(W, 'manejos', mj, 'corrigir', { dose: 200 }); r = await responder(D, r.rows[0]?.id, true);
checa(!r.erro && Number(await val('manejos', 'dose', 10)) === 200, `probiótico: dose corrigida ${r.erro || ''}`);
// lançamento apagado depois do pedido
const r11 = await racao(W, 11, 70); r = await pedir(W, 'racao_consumo', r11, 'corrigir', { quantidade_kg: 7 }); const p11 = r.rows[0]?.id;
await db.exec(`delete from racao_consumo where id = '${r11}'`);
r = await responder(D, p11, true); checa(!!r.erro && /não existe/.test(r.erro), 'lançamento apagado depois do pedido: avisa para recusar');
// funcionário que perdeu o acesso ao tanque
const r12 = await racao(W, 12, 70); await db.exec(`delete from usuario_tanques where usuario_id='${W}'`);
r = await pedir(W, 'racao_consumo', r12, 'corrigir', { quantidade_kg: 7 }); checa(!!r.erro, 'sem acesso ao tanque: NÃO pede');
await db.exec(`insert into usuario_tanques (usuario_id, tanque_id) values ('${W}','${T}')`);
// funções internas e visitante
checa((await db.query(`select has_function_privilege('anon', 'pedir_correcao(text, uuid, text, jsonb, text)', 'execute') x`)).rows[0].x === false, 'visitante sem login NÃO usa pedir_correcao');
checa((await db.query(`select has_function_privilege('authenticated', 'lancamento_para_correcao(text, uuid)', 'execute') x`)).rows[0].x === false, 'a função que lê qualquer lançamento NÃO pode ser chamada direto');
r = await como(W2, `select * from lancamento_para_correcao('racao_consumo', '${r12}')`); checa(!!r.erro, 'funcionário NÃO lê lançamento pela função interna');

console.log(ok ? 'RESULTADO: TUDO OK' : 'RESULTADO: FALHOU');
process.exit(ok ? 0 : 1);

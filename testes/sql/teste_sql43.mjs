// Testa o sql/43: placas com QR code (página pública do tanque, sem login).
// Confere quem pode ligar/desligar, o que o visitante vê, o que NUNCA sai (R$, quantidade, mortes, equipe),
// e que o lançado sem sinal aparece na placa com a data do lançamento quando chega ao banco.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const DIR = process.env.SQL_DIR || fileURLToPath(new URL('../../sql/', import.meta.url));
let ok = true; const checa = (c, m) => { console.log((c ? 'OK    ' : 'FALHA ') + m); ok = ok && c; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$; grant usage on schema auth to anon, authenticated;`);
// como no Supabase: as permissões padrão (anon e authenticated em tudo) existem ANTES dos arquivos rodarem
await db.exec(`grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;`);
for (const f of readdirSync(DIR).filter((f) => /^\d\d_.*\.sql$/.test(f) && !f.startsWith('05_')).sort()) await db.exec(readFileSync(DIR + f, 'utf8'));
await db.exec(readFileSync(DIR + '43_placas_qr_code.sql', 'utf8')); // de novo: pode repetir

const R = '00000000-0000-4000-8000-0000000000c1', V = '00000000-0000-4000-8000-0000000000c2', F = '00000000-0000-4000-8000-0000000000c3', X = '00000000-0000-4000-8000-0000000000c4';
await db.exec(`insert into auth.users values ('${R}','r@x'), ('${V}','v@x'), ('${F}','f@x'), ('${X}','x@x');`);
const como = async (uid, sql) => { await db.exec(uid ? `set role authenticated; set teste.uid = '${uid}';` : `set role anon; set teste.uid = '';`); try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { erro: e.message, rows: [] }; } finally { await db.exec(`reset role; set teste.uid = '';`); } };
const um = (r) => r.rows[0] && Object.values(r.rows[0])[0];
const q1 = async (sql) => (await db.query(sql)).rows[0];
const g = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const hoje = (await q1(`select (now() at time zone 'America/Boa_Vista')::date::text d`)).d;
const diaAntes = async (n) => (await q1(`select ('${hoje}'::date - ${n})::text d`)).d;

const FZ = um(await como(R, `select criar_fazenda('Fazenda Sol', 'Rai Dono', '111.444.777-35')`));
await db.exec(`update fazendas set teste_ate = current_date + 30, preco_kg = 9.5 where id = '${FZ}'`);
const conv = async (papel, uid, nome) => { const c = um(await como(R, `select criar_convite('${papel}')`)); await como(uid, `select aceitar_convite('${c}', '${nome}')`); };
await conv('gerente', V, 'Victor Gerente'); await conv('funcionario', F, 'Zé Funcionário');
const tq = async (nome) => (await db.query(`insert into tanques (fazenda_id, nome) values ('${FZ}', '${nome}') returning id`)).rows[0].id;
const T3 = await tq('Tanque 3'), T7 = await tq('Tanque 7 vazio');
await db.query(`insert into usuario_tanques select u, t from unnest(array['${V}','${F}']::uuid[]) u, unnest(array['${T3}','${T7}']::uuid[]) t`);
const d120 = await diaAntes(120), d60 = await diaAntes(60), d30 = await diaAntes(30), d1 = await diaAntes(1);
const L3 = (await db.query(`insert into lotes (tanque_id, tipo, especie, data_entrada, quantidade_inicial, peso_inicial_kg) values ('${T3}', 'engorda', 'Tambaqui', '${d120}', 40000, 4800) returning id`)).rows[0].id;
await db.query(`insert into biometrias (uuid_local, lote_id, data, peso_amostra_kg, quantidade_amostrada, registrado_por) values
  ('${g(1)}', '${L3}', '${d60}', 15, 50, '${R}'), ('${g(2)}', '${L3}', '${d30}', 40, 50, '${R}'), ('${g(3)}', '${L3}', '${d30}', 41, 50, '${R}')`);
await db.query(`insert into mortalidade (uuid_local, lote_id, data, quantidade, registrado_por) values ('${g(4)}', '${L3}', '${d30}', 777, '${F}')`);
await db.query(`insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por) values ('${g(5)}', '${L3}', '${T3}', '${d1}', 333, '${F}')`);
await db.query(`insert into qualidade_agua (uuid_local, tanque_id, data, hora, oxigenio_mgl, temperatura_c, ph, amonia_mgl, registrado_por) values
  ('${g(6)}', '${T3}', '${d1}', '06:10', 5.6, 29.1, 6.4, 0.12, '${F}')`);

// ---------- serviço à parte: só funciona na fazenda liberada pelo administrador ----------
const ADM = '00000000-0000-4000-8000-0000000000c9';
await db.exec(`insert into auth.users values ('${ADM}','adm@x'); insert into administradores (usuario_id) values ('${ADM}');`);
let r0 = await como(R, `select codigo from placa_salvar('${T3}', true, true, true, true, false)`);
checa(/serviço à parte/.test(r0.erro || ''), 'sem liberação: o dono não cria placa (serviço à parte)');
r0 = await como(R, `select placa_salvar_whatsapp('95991442495')`);
checa(/serviço à parte/.test(r0.erro || ''), 'sem liberação: nem o WhatsApp dos visitantes');
r0 = await como(R, `update fazendas set placas_liberadas = true where id = '${FZ}'`);
checa(!!r0.erro && !(await q1(`select placas_liberadas l from fazendas where id = '${FZ}'`)).l, 'o dono não consegue se liberar mexendo direto na tabela');
r0 = await como(R, `select admin_liberar_placas('${FZ}', true)`);
checa(/administradores/.test(r0.erro || ''), 'o dono não chama a liberação do administrador');
checa(um(await como(R, `select placas_liberadas from fazendas where id = '${FZ}'`)) === false, 'o dono lê se a fazenda tem as placas liberadas');
r0 = await como(ADM, `select admin_liberar_placas('${FZ}', true)`);
checa(!r0.erro && (await q1(`select placas_liberadas l from fazendas where id = '${FZ}'`)).l === true, 'o administrador libera as placas da fazenda' + (r0.erro ? ': ' + r0.erro : ''));
checa((await q1(`select count(*)::int c from admin_acoes where acao = 'liberou as placas com QR code' and fazenda_id = '${FZ}'`)).c === 1, 'a liberação fica no registro de ações do administrador');
checa((await como(ADM, `select * from admin_placas_liberadas()`)).rows.length === 1 && !!(await como(R, `select * from admin_placas_liberadas()`)).erro, 'só o administrador lista as fazendas liberadas');

// ---------- quem cuida das placas ----------
let r = await como(F, `select codigo from placa_salvar('${T3}', true, true, true, true, false)`);
checa(/Apenas o dono/.test(r.erro || ''), 'funcionário não cria placa');
r = await como(V, `select codigo from placa_salvar('${T3}', true, true, true, true, false)`);
checa(/Apenas o dono/.test(r.erro || ''), 'gerente não cria placa');
r = await como(null, `select codigo from placa_salvar('${T3}', true, true, true, true, false)`);
checa(!!r.erro, 'visitante sem login não cria placa');
r = await como(R, `select * from placa_salvar('${T3}', null, null, null, null, null)`);
const P = r.rows[0];
checa(!r.erro && P && /^[a-z0-9]{10}$/.test(P.codigo) && P.ligada === false, `dono cria a placa: código de 10 letras/números, nasce DESLIGADA ${r.erro || ''}`);
checa(!/[01oil]/.test(P.codigo), 'código sem letras que se confundem (0, o, 1, l, i)');
const codigos = new Set(); for (let i = 0; i < 300; i++) codigos.add(um(await db.query(`select placa_novo_codigo()`)));
checa(codigos.size === 300, 'trezentos códigos sorteados, nenhum repetido');
r = await como(null, `select placa_publica('${P.codigo}') j`);
checa(!r.erro && um(r).disponivel === false && um(r).fazenda === 'Fazenda Sol' && !um(r).tanque, 'placa desligada: visitante vê só o nome da fazenda');
r = await como(R, `select * from placa_salvar('${T3}', true, null, null, null, null)`);
checa(!r.erro && r.rows[0].ligada && r.rows[0].codigo === P.codigo && r.rows[0].mostra_agua, 'dono liga a placa: o código continua o mesmo');
checa((await como(V, `select * from placas`)).rows.length === 0 && (await como(F, `select * from placas`)).rows.length === 0, 'gerente e funcionário não leem a tabela de placas');
r = await como(V, `update placas set ligada = false`); checa(!!r.erro || Number((await q1(`select count(*) n from placas where not ligada`)).n) === 0, 'gerente não desliga pela tabela');
r = await como(R, `insert into placas (tanque_id, fazenda_id, codigo) values ('${T7}', '${FZ}', 'aaaaaaaaaa')`);
checa(!!r.erro, 'nem o dono grava direto na tabela (só pelas funções)');

// ---------- outra fazenda e visitante ----------
const outra = um(await como(X, `select criar_fazenda('Outra', 'Xavier', '529.982.247-25')`));
r = await como(X, `select * from placa_salvar('${T3}', false, null, null, null, null)`);
checa(/não encontrado|serviço à parte/.test(r.erro || ''), 'dono de outra fazenda não mexe na placa do Tanque 3 (nem tem as placas liberadas)');
r = await como(X, `select placa_trocar_codigo('${T3}')`);
checa(!!r.erro, 'dono de outra fazenda não troca o código do Tanque 3');
checa((await como(X, `select * from placas`)).rows.length === 0, 'dono de outra fazenda não lê as placas');
r = await como(null, `select * from placas`);
checa(!!r.erro || r.rows.length === 0, 'visitante sem login não lê a tabela de placas');
r = await como(null, `select whatsapp_visitantes from fazendas`);
checa(!!r.erro || r.rows.length === 0, 'visitante sem login não lê a tabela de fazendas');

// ---------- o que o visitante vê ----------
r = await como(null, `select placa_publica('${P.codigo}') j`);
let J = um(r);
checa(!r.erro && J.disponivel && J.fazenda === 'Fazenda Sol' && J.tanque === 'Tanque 3' && J.hoje === hoje, `placa ligada: fazenda, tanque e a data de hoje em Boa Vista ${r.erro || ''}`);
const lt = J.lotes[0];
checa(J.lotes.length === 1 && lt.fase === 'engorda' && lt.especie === 'Tambaqui' && lt.data_entrada === d120, 'lote ativo: fase, espécie e data de entrada');
checa(Number(lt.peso_inicial_g) === 120, 'peso médio na entrada: 4.800 kg ÷ 40.000 = 120 g');
checa(lt.pesagens.length === 2 && lt.pesagens[0].data === d60 && Number(lt.pesagens[0].g) === 300 && Number(lt.pesagens[1].g) === 820,
  `pesagens: uma por dia, a última lançada no dia (300 g e 820 g) ${JSON.stringify(lt.pesagens)}`);
checa(lt.racao_hoje === false, 'ração de ontem não conta como ração de hoje');
checa(J.agua && J.agua.data === d1 && J.agua.hora === '06:10' && Number(J.agua.oxigenio_mgl) === 5.6 && Number(J.agua.amonia_mgl) === 0.12, 'água: a última medição, com data e hora');
checa(J.whatsapp == null, 'WhatsApp não aparece sem o dono ligar');
const texto = JSON.stringify(J);
for (const proibido of ['quantidade', '40000', '4800', '777', '333', 'custo', 'preco', '9.5', 'Rai', 'Victor', 'Zé', 'registrado_por', 'peso_amostra', 'fazenda_id', 'tanque_id', 'lote_id', FZ, T3, L3])
  checa(!texto.includes(proibido), `a página do visitante não traz "${proibido}"`);

// ---------- lançado sem sinal chega depois: aparece com a data do lançamento ----------
// a equipe deu ração hoje 06:30 sem sinal; o celular só envia às 15h (criado_em = hora do envio)
await db.query(`insert into racao_consumo (uuid_local, lote_id, tanque_id, data, quantidade_kg, registrado_por, criado_em) values ('${g(7)}', '${L3}', '${T3}', '${hoje}', 50, '${F}', now())`);
// água de HOJE cedo lançada sem sinal, e uma medição de ANTEONTEM que só agora chegou (não pode passar na frente)
const d2 = await diaAntes(2);
await db.query(`insert into qualidade_agua (uuid_local, tanque_id, data, hora, oxigenio_mgl, temperatura_c, registrado_por, criado_em) values
  ('${g(8)}', '${T3}', '${hoje}', '05:50', 3.4, 28.6, '${F}', now() - interval '1 minute'),
  ('${g(9)}', '${T3}', '${d2}', '18:00', 7.0, 30.0, '${F}', now())`);
await db.query(`insert into biometrias (uuid_local, lote_id, data, peso_amostra_kg, quantidade_amostrada, registrado_por, criado_em) values ('${g(10)}', '${L3}', '${hoje}', 59, 50, '${F}', now())`);
J = um(await como(null, `select placa_publica('${P.codigo}') j`));
checa(J.lotes[0].racao_hoje === true, 'ração lançada sem sinal hoje: assim que chega, a placa mostra "dada"');
checa(J.agua.data === hoje && J.agua.hora === '05:50' && Number(J.agua.oxigenio_mgl) === 3.4 && J.agua.ph == null, 'água de hoje cedo (enviada depois) vira a medição mostrada, só com o que foi medido');
checa(J.lotes[0].pesagens.length === 3 && Number(J.lotes[0].pesagens[2].g) === 1180 && J.lotes[0].pesagens[2].data === hoje, 'pesagem de hoje chega e entra no gráfico (1.180 g)');
// lançamento com data no futuro (relógio errado do celular) não aparece como "hoje"
await db.query(`insert into qualidade_agua (uuid_local, tanque_id, data, hora, oxigenio_mgl, registrado_por) values ('${g(11)}', '${T3}', ('${hoje}'::date + 3), '07:00', 9.9, '${F}')`);
J = um(await como(null, `select placa_publica('${P.codigo}') j`));
checa(Number(J.agua.oxigenio_mgl) === 3.4, 'medição com data no futuro não passa na frente da de hoje');

// ---------- o que aparece ----------
await como(R, `select placa_salvar('${T3}', null, false, false, true, true)`);
r = await como(R, `select placa_salvar_whatsapp('95 9999')`);
checa(/inválido/.test(r.erro || ''), 'WhatsApp curto demais é recusado');
r = await como(R, `select placa_salvar_whatsapp('(95) 99144-2495')`);
checa(um(r) === '95991442495', 'WhatsApp guardado só com números');
r = await como(F, `select placa_salvar_whatsapp('95999990000')`);
checa(/Apenas o dono/.test(r.erro || ''), 'funcionário não troca o WhatsApp da placa');
J = um(await como(null, `select placa_publica('${P.codigo}') j`));
checa(J.agua == null && J.mostra.agua === false && J.mostra.crescimento === false && J.whatsapp === '95991442495', 'sem água: a medição nem sai do banco; WhatsApp ligado aparece');
await como(R, `select placa_salvar('${T3}', null, true, true, true, false)`);

// ---------- trocar o código ----------
const novo = um(await como(R, `select placa_trocar_codigo('${T3}')`));
checa(/^[a-z0-9]{10}$/.test(novo) && novo !== P.codigo, 'trocar o QR code: código novo');
checa(um(await como(null, `select placa_publica('${P.codigo}') j`)) == null, 'a placa antiga para de funcionar na hora');
checa(um(await como(null, `select placa_publica('${novo}') j`)).disponivel === true, 'a placa nova funciona');
r = await como(R, `select placa_trocar_codigo('${T7}')`);
checa(/ainda não tem placa/.test(r.erro || ''), 'trocar o código de tanque sem placa avisa');

// ---------- códigos estranhos ----------
for (const c of ['', 'ABCDEFGHJK', `${novo}x`, "x' or '1'='1", 'aaaaaaaaaa'])
  checa(um(await como(null, `select placa_publica('${c.replace(/'/g, "''")}') j`)) == null, `código "${c}" não abre nada`);
checa(um(await como(null, `select placa_publica(null) j`)) == null, 'código vazio não abre nada');

// ---------- tanque vazio, fazenda bloqueada, tanque excluído ----------
const P7 = (await como(R, `select * from placa_salvar('${T7}', true, null, null, null, null)`)).rows[0];
J = um(await como(null, `select placa_publica('${P7.codigo}') j`));
checa(J.disponivel && J.lotes.length === 0 && J.agua == null, 'tanque sem peixe: página abre sem lote nem água');
await db.exec(`update fazendas set bloqueada = true where id = '${FZ}'`);
J = um(await como(null, `select placa_publica('${novo}') j`));
checa(J.disponivel === false && !J.tanque, 'fazenda bloqueada pelo administrador: placa fica indisponível');
await db.exec(`update fazendas set bloqueada = false where id = '${FZ}'`);
await db.exec(`delete from tanques where id = '${T7}'`);
checa(um(await como(null, `select placa_publica('${P7.codigo}') j`)) == null, 'tanque excluído: a placa some junto');

// ---------- permissões das funções ----------
const pode = async (role, fn) => (await q1(`select has_function_privilege('${role}', '${fn}', 'execute') v`)).v;
checa(await pode('anon', 'placa_publica(text)'), 'visitante sem login chama placa_publica');
for (const fn of ['placa_salvar(uuid, boolean, boolean, boolean, boolean, boolean)', 'placa_trocar_codigo(uuid)', 'placa_salvar_whatsapp(text)', 'placa_novo_codigo()'])
  checa(!(await pode('anon', fn)), `visitante sem login NÃO chama ${fn.split('(')[0]}`);
checa(!(await pode('authenticated', 'placa_novo_codigo()')), 'ninguém chama placa_novo_codigo direto');
checa(!(await q1(`select has_table_privilege('anon', 'placas', 'select') v`)).v, 'visitante sem permissão na tabela placas');

// ---------- retirar a liberação: a placa impressa para de mostrar os dados ----------
{
  const cod = (await q1(`select codigo from placas where tanque_id = '${T3}'`)).codigo;
  const ligadaAntes = (await q1(`select ligada from placas where tanque_id = '${T3}'`)).ligada;
  if (!ligadaAntes) await como(R, `select placa_salvar('${T3}', true, null, null, null, null)`);
  checa((await como(null, `select placa_publica('${cod}') j`)).rows[0].j.disponivel === true, 'liberada e ligada: o visitante vê os dados');
  await como(ADM, `select admin_liberar_placas('${FZ}', false)`);
  const j = (await como(null, `select placa_publica('${cod}') j`)).rows[0].j;
  checa(j.disponivel === false && j.lotes === undefined, 'liberação retirada: a página do visitante fica indisponível, sem dados');
  checa(/serviço à parte/.test((await como(R, `select placa_trocar_codigo('${T3}')`)).erro || ''), 'liberação retirada: o dono não mexe mais nas placas');
}
console.log(ok ? '\nRESULTADO: TUDO OK (sql/43 placas com QR code)' : '\nRESULTADO: HÁ FALHAS');
process.exit(ok ? 0 : 1);

-- ============================================================
-- 43. PLACAS COM QR CODE (página pública de cada tanque)
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
--
-- Pedido de 16/11/2026: placa na beira do tanque para estudantes, Embrapa e visitantes. Quem aponta o
-- celular para o QR vê, sem entrar no app, como estão os peixes daquele tanque AGORA (lido do banco
-- na hora em que a página abre; o que a equipe lançou sem sinal aparece assim que chega ao banco,
-- sempre com a data do lançamento, não a do envio).
--  * só o dono liga, desliga, escolhe o que aparece e troca o código (placa perdida ou copiada);
--  * o visitante só chega aos dados pela função placa_publica(código), que devolve o mínimo:
--    nome da fazenda e do tanque, espécie, fase, dias de cultivo, peso médio das pesagens,
--    última medição da água e se a ração de hoje já foi dada;
--  * NUNCA saem: valores em R$, quantidade de peixes, biomassa, mortes, despescas, nomes da equipe.
-- ============================================================

create table if not exists placas (
  tanque_id uuid primary key references tanques(id) on delete cascade,
  fazenda_id uuid not null references fazendas(id) on delete cascade,
  codigo text not null unique check (codigo ~ '^[a-z0-9]{10}$'),
  ligada boolean not null default false,               -- nasce desligada: o dono decide publicar
  mostra_agua boolean not null default true,
  mostra_crescimento boolean not null default true,
  mostra_fases boolean not null default true,
  mostra_whatsapp boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_placas_fazenda on placas(fazenda_id);
alter table placas enable row level security;

-- o dono lê as placas da fazenda; gravar, só pelas funções abaixo
drop policy if exists placas_select on placas;
create policy placas_select on placas for select using (fazenda_id = current_fazenda() and current_papel() = 'dono');
revoke all on placas from public, anon;
revoke insert, update, delete on placas from authenticated;
grant select on placas to authenticated;

-- WhatsApp que aparece na página do visitante (um para a fazenda toda; só números, com DDD)
alter table fazendas add column if not exists whatsapp_visitantes text;
alter table fazendas drop constraint if exists fazendas_whatsapp_visitantes_ok;
alter table fazendas add constraint fazendas_whatsapp_visitantes_ok check (whatsapp_visitantes is null or whatsapp_visitantes ~ '^[0-9]{10,13}$');
grant select (whatsapp_visitantes) on fazendas to authenticated;

-- código do QR: 10 letras/números sorteados (sem 0/o, 1/l/i, que se confundem ao digitar)
create or replace function placa_novo_codigo() returns text
language plpgsql volatile set search_path = public as $$
declare
  alfa constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  b bytea; c text; i int;
begin
  loop
    b := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    c := '';
    for i in 0..9 loop
      c := c || substr(alfa, 1 + (get_byte(b, i + case when i >= 6 then 4 else 0 end) % 31), 1); -- pula os bytes fixos da versão do uuid
    end loop;
    exit when not exists (select 1 from placas where codigo = c);
  end loop;
  return c;
end $$;
revoke execute on function placa_novo_codigo() from public, anon, authenticated;

-- liga/desliga e escolhe o que aparece. Primeira vez: cria a placa (com código novo).
create or replace function placa_salvar(p_tanque uuid, p_ligada boolean, p_agua boolean, p_crescimento boolean, p_fases boolean, p_whatsapp boolean)
returns placas
language plpgsql security definer set search_path = public as $$
declare v_f uuid := current_fazenda(); r placas;
begin
  if v_f is null or current_papel() is distinct from 'dono' then raise exception 'Apenas o dono cuida das placas com QR code'; end if;
  if not exists (select 1 from tanques where id = p_tanque and fazenda_id = v_f) then raise exception 'Tanque não encontrado'; end if;
  insert into placas (tanque_id, fazenda_id, codigo, ligada, mostra_agua, mostra_crescimento, mostra_fases, mostra_whatsapp)
  values (p_tanque, v_f, placa_novo_codigo(), coalesce(p_ligada, false), coalesce(p_agua, true), coalesce(p_crescimento, true), coalesce(p_fases, true), coalesce(p_whatsapp, false))
  on conflict (tanque_id) do update set
    ligada = coalesce(p_ligada, placas.ligada), mostra_agua = coalesce(p_agua, placas.mostra_agua),
    mostra_crescimento = coalesce(p_crescimento, placas.mostra_crescimento), mostra_fases = coalesce(p_fases, placas.mostra_fases),
    mostra_whatsapp = coalesce(p_whatsapp, placas.mostra_whatsapp), atualizado_em = now()
  returning * into r;
  return r;
end $$;
revoke execute on function placa_salvar(uuid, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function placa_salvar(uuid, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- placa perdida ou copiada: código novo, e a placa antiga para de funcionar na hora
create or replace function placa_trocar_codigo(p_tanque uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_f uuid := current_fazenda(); v_c text;
begin
  if v_f is null or current_papel() is distinct from 'dono' then raise exception 'Apenas o dono cuida das placas com QR code'; end if;
  update placas set codigo = placa_novo_codigo(), atualizado_em = now() where tanque_id = p_tanque and fazenda_id = v_f returning codigo into v_c;
  if v_c is null then raise exception 'Este tanque ainda não tem placa'; end if;
  return v_c;
end $$;
revoke execute on function placa_trocar_codigo(uuid) from public, anon;
grant execute on function placa_trocar_codigo(uuid) to authenticated;

-- WhatsApp da fazenda para os visitantes (vazio apaga)
create or replace function placa_salvar_whatsapp(p_numero text) returns text
language plpgsql security definer set search_path = public as $$
declare v_f uuid := current_fazenda(); v_n text := nullif(regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g'), '');
begin
  if v_f is null or current_papel() is distinct from 'dono' then raise exception 'Apenas o dono cuida das placas com QR code'; end if;
  if v_n is not null and v_n !~ '^[0-9]{10,13}$' then raise exception 'WhatsApp inválido: use o DDD e o número, por exemplo (95) 99999-0000'; end if;
  update fazendas set whatsapp_visitantes = v_n where id = v_f;
  return v_n;
end $$;
revoke execute on function placa_salvar_whatsapp(text) from public, anon;
grant execute on function placa_salvar_whatsapp(text) to authenticated;

-- A PÁGINA DO VISITANTE (sem login). Código que não existe: null. Placa desligada: só o nome da fazenda.
create or replace function placa_publica(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p placas; v_faz fazendas; v_tq tanques; v_hoje date := (now() at time zone 'America/Boa_Vista')::date;
  v_lotes jsonb; v_agua jsonb;
begin
  if p_codigo is null or p_codigo !~ '^[a-z0-9]{10}$' then return null; end if;
  select * into p from placas where codigo = p_codigo;
  if not found then return null; end if;
  select * into v_faz from fazendas where id = p.fazenda_id;
  select * into v_tq from tanques where id = p.tanque_id;
  if not p.ligada or coalesce(v_faz.bloqueada, false) then
    return jsonb_build_object('disponivel', false, 'fazenda', v_faz.nome);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'fase', l.tipo, 'especie', l.especie, 'data_entrada', l.data_entrada,
      'peso_inicial_g', round(l.peso_inicial_kg / nullif(l.quantidade_inicial, 0) * 1000, 1),
      -- uma pesagem por dia (a última lançada no dia), no máximo as 60 mais recentes
      'pesagens', (select coalesce(jsonb_agg(jsonb_build_object('data', x.data, 'g', x.g) order by x.data), '[]'::jsonb) from (
          select distinct on (b.data) b.data, round(b.peso_amostra_kg / nullif(b.quantidade_amostrada, 0) * 1000, 1) as g
          from biometrias b where b.lote_id = l.id and b.data <= v_hoje
          order by b.data desc, b.criado_em desc limit 60) x),
      'racao_hoje', exists (select 1 from racao_consumo r where r.lote_id = l.id and r.data = v_hoje)
    ) order by l.data_entrada desc, l.criado_em desc), '[]'::jsonb)
  into v_lotes
  from lotes l where l.tanque_id = p.tanque_id and l.ativo;

  if p.mostra_agua then
    select jsonb_build_object('data', a.data, 'hora', a.hora, 'oxigenio_mgl', a.oxigenio_mgl, 'temperatura_c', a.temperatura_c, 'ph', a.ph, 'amonia_mgl', a.amonia_mgl)
    into v_agua
    from qualidade_agua a where a.tanque_id = p.tanque_id and a.data <= v_hoje
    order by a.data desc, a.hora desc nulls last, a.criado_em desc limit 1;
  end if;

  return jsonb_build_object(
    'disponivel', true, 'fazenda', v_faz.nome, 'tanque', v_tq.nome, 'hoje', v_hoje,
    'mostra', jsonb_build_object('agua', p.mostra_agua, 'crescimento', p.mostra_crescimento, 'fases', p.mostra_fases),
    'whatsapp', case when p.mostra_whatsapp then v_faz.whatsapp_visitantes end,
    'lotes', v_lotes, 'agua', v_agua);
end $$;
revoke execute on function placa_publica(text) from public;
grant execute on function placa_publica(text) to anon, authenticated;

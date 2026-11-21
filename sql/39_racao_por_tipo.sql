-- ============================================================
-- 39. ESTOQUE POR RAÇÃO (cada ração que a fazenda compra: 45% 2,6 mm, 32% 4/6 mm, 28% 6/10 mm...)
-- Rode no SQL Editor do Supabase (depois do 01 a 38). Pode rodar de novo sem estragar nada.
--
-- Pedido do Guilherme (17/11/2026): "não existe jogar ração sem saber qual é; o dono precisa desse controle".
--  * a fazenda cadastra as suas rações (dono e gerente); nome livre; desativar tira da escolha mas guarda o histórico;
--  * cada trato, compra e contagem diz qual ração foi (racao_id). O app obriga a escolher no trato;
--  * o estoque de cada ração = compras − tratos + ajustes das contagens. Começa com uma contagem no galpão;
--  * fazenda sem ração cadastrada continua como antes (engorda e alevino, sql/17).
-- ============================================================

create table if not exists racoes (
  id uuid primary key default gen_random_uuid(),
  fazenda_id uuid not null references fazendas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 60),
  fase text not null default 'engorda' check (fase in ('alevino', 'recria', 'engorda')),
  cor smallint not null default 0 check (cor between 0 and 9),
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists racoes_nome_unico on racoes (fazenda_id, lower(trim(nome)));
alter table racoes enable row level security;

-- ver: todos da fazenda (o tratador escolhe). Criar e mudar: dono e gerente. Apagar: ninguém (desativa).
drop policy if exists racoes_select on racoes;
create policy racoes_select on racoes for select using (fazenda_id = current_fazenda());
drop policy if exists racoes_insert on racoes;
create policy racoes_insert on racoes for insert
  with check (fazenda_id = current_fazenda() and coalesce(current_papel(), '') in ('dono', 'gerente'));
drop policy if exists racoes_update on racoes;
create policy racoes_update on racoes for update
  using (fazenda_id = current_fazenda() and coalesce(current_papel(), '') in ('dono', 'gerente'))
  with check (fazenda_id = current_fazenda());
revoke all on racoes from anon;
grant select, insert, update on racoes to authenticated;

-- qual ração foi (antigos ficam sem: entram no estoque antigo, engorda/alevino)
alter table racao_consumo add column if not exists racao_id uuid references racoes(id);
alter table racao_estoque add column if not exists racao_id uuid references racoes(id);
alter table racao_contagens add column if not exists racao_id uuid references racoes(id);
create index if not exists idx_consumo_racao on racao_consumo (racao_id) where racao_id is not null;
grant select (racao_id) on racao_estoque to authenticated;  -- a tabela só entrega as colunas liberadas (sql/23)

-- a ração tem que ser da mesma fazenda do lançamento
create or replace function trg_racao_mesma_fazenda() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_faz uuid;
begin
  if new.racao_id is null then return new; end if;
  if tg_table_name = 'racao_consumo' then
    select fazenda_id into v_faz from tanques where id = new.tanque_id;
  else
    v_faz := new.fazenda_id;
  end if;
  if not exists (select 1 from racoes where id = new.racao_id and fazenda_id = v_faz) then
    raise exception 'Ração não encontrada nesta fazenda';
  end if;
  return new;
end $$;
revoke execute on function trg_racao_mesma_fazenda() from public, anon, authenticated;
drop trigger if exists racao_mesma_fazenda on racao_consumo;
create trigger racao_mesma_fazenda before insert or update of racao_id, tanque_id on racao_consumo for each row execute function trg_racao_mesma_fazenda();
drop trigger if exists racao_mesma_fazenda on racao_estoque;
create trigger racao_mesma_fazenda before insert or update of racao_id on racao_estoque for each row execute function trg_racao_mesma_fazenda();
drop trigger if exists racao_mesma_fazenda on racao_contagens;
create trigger racao_mesma_fazenda before insert or update of racao_id on racao_contagens for each row execute function trg_racao_mesma_fazenda();

-- histórico (lixeira) da lista de rações, como nas outras tabelas
drop trigger if exists historico_racoes on racoes;
create trigger historico_racoes after update or delete on racoes for each row execute function trg_registrar_historico();

-- Saldo de cada ração cadastrada (ativas primeiro; dentro, alevino → recria → engorda e nome).
create or replace function saldo_por_racao()
returns table (
  racao_id uuid, nome text, fase text, cor smallint, ativa boolean,
  total_comprado_kg numeric, total_consumido_kg numeric, total_ajustes_kg numeric,
  saldo_kg numeric, consumo_7d_kg numeric, ultima_contagem date
)
language sql stable security definer set search_path = public as $$
  with hoje as (select (now() at time zone 'America/Boa_Vista')::date as d),
  c as (select e.racao_id r, sum(e.quantidade_kg) v from racao_estoque e
        where e.fazenda_id = current_fazenda() and e.racao_id is not null group by 1),
  a as (select k.racao_id r, sum(k.diferenca_kg) v, max(k.data) ult from racao_contagens k
        where k.fazenda_id = current_fazenda() and k.racao_id is not null group by 1),
  s as (select rc.racao_id r, sum(rc.quantidade_kg) v,
               sum(rc.quantidade_kg) filter (where rc.data >= (select d from hoje) - 7 and rc.data < (select d from hoje)) v7
        from racao_consumo rc join tanques tq on tq.id = rc.tanque_id
        where tq.fazenda_id = current_fazenda() and rc.racao_id is not null group by 1)
  select x.id, x.nome, x.fase, x.cor, x.ativa,
         coalesce(c.v, 0), coalesce(s.v, 0), coalesce(a.v, 0),
         coalesce(c.v, 0) - coalesce(s.v, 0) + coalesce(a.v, 0), coalesce(s.v7, 0), a.ult
  from racoes x left join c on c.r = x.id left join s on s.r = x.id left join a on a.r = x.id
  where x.fazenda_id = current_fazenda()
  order by not x.ativa, array_position(array['alevino', 'recria', 'engorda'], x.fase), lower(x.nome)
$$;

-- Contagem física de UMA ração (só dono/gerente). Devolve a diferença em kg.
-- A primeira contagem é o começo do estoque daquela ração (saldo 0 → diferença = o que tem no galpão).
create or replace function registrar_contagem_racao(p_racao uuid, p_contado_kg numeric, p_obs text default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_saldo numeric; v_dif numeric; v_fase text; v_hoje date := (now() at time zone 'America/Boa_Vista')::date;
begin
  if coalesce(current_papel(), '') not in ('dono', 'gerente') or current_fazenda() is null then
    raise exception 'Sem permissão para registrar contagem';
  end if;
  if p_contado_kg is null or p_contado_kg < 0 then raise exception 'Quantidade contada inválida'; end if;
  select fase into v_fase from racoes where id = p_racao and fazenda_id = current_fazenda();
  if v_fase is null then raise exception 'Ração não encontrada nesta fazenda'; end if;
  select s.saldo_kg into v_saldo from saldo_por_racao() s where s.racao_id = p_racao;
  v_dif := p_contado_kg - coalesce(v_saldo, 0);
  insert into racao_contagens (fazenda_id, data, contado_kg, saldo_sistema_kg, diferenca_kg, obs, registrado_por, tipo_racao, racao_id)
  values (current_fazenda(), v_hoje, p_contado_kg, coalesce(v_saldo, 0), v_dif, nullif(trim(coalesce(p_obs, '')), ''), auth.uid(),
          case when v_fase = 'alevino' then 'alevino' else 'engorda' end, p_racao);
  return v_dif;
end $$;

-- Consumo diário de UMA ração (extrato da tela Estoque) — visível a todos os papéis, como o consumo_diario().
create or replace function consumo_diario_racao(p_dias int, p_racao uuid)
returns table (data date, quantidade_kg numeric)
language sql stable security definer set search_path = public as $$
  select rc.data, sum(rc.quantidade_kg)
  from racao_consumo rc join tanques t on t.id = rc.tanque_id
  where t.fazenda_id = current_fazenda() and rc.racao_id = p_racao
    and rc.data >= (now() at time zone 'America/Boa_Vista')::date - least(greatest(p_dias, 1), 365)
  group by rc.data order by rc.data desc
$$;

-- compras: a ração de cada compra sai pela própria tabela (coluna liberada acima); racao_estoque_visivel() fica como no sql/23

revoke execute on function saldo_por_racao() from public, anon;
revoke execute on function registrar_contagem_racao(uuid, numeric, text) from public, anon;
revoke execute on function consumo_diario_racao(int, uuid) from public, anon;
grant execute on function saldo_por_racao() to authenticated;
grant execute on function registrar_contagem_racao(uuid, numeric, text) to authenticated;
grant execute on function consumo_diario_racao(int, uuid) to authenticated;

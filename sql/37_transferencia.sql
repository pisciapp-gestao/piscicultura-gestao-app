-- ============================================================
-- 37. TRANSFERÊNCIA DE PEIXES ENTRE TANQUES
-- Rode no SQL Editor do Supabase (depois do 01 a 36). Pode rodar de novo sem estragar nada.
--
-- Pedido do cliente piloto (16/11/2026): o berçário e a recria passam peixes para outros tanques.
--  * sai de UM tanque e vai para um ou mais (para juntar dois tanques, uma transferência de cada);
--  * cada destino recebe quantidade e peso médio (a pesagem vale como biometria);
--  * destino vazio: nasce um lote novo; destino com peixe: junta no lote que já está lá;
--  * o CUSTO vai junto: a ração já dada na origem segue na proporção dos peixes que saíram;
--  * não é venda: não entra em despesca nem em receita;
--  * esvaziou a origem: o lote dela se encerra como "tudo transferido";
--  * só dono e gerente; desfazer volta tudo como era (enquanto o lote novo não tiver lançamentos).
-- ============================================================

create table if not exists transferencias (
  id uuid primary key default gen_random_uuid(),
  grupo uuid not null,                             -- gerado no celular: tudo o que saiu junto, de uma vez (reenvio não duplica)
  fazenda_id uuid not null references fazendas(id) on delete cascade,
  data date not null,
  lote_origem uuid not null references lotes(id) on delete cascade,
  lote_destino uuid not null references lotes(id) on delete cascade,
  quantidade integer not null check (quantidade > 0),
  peso_medio_kg numeric(10,4) not null check (peso_medio_kg > 0),
  racao_kg numeric(12,3) not null default 0 check (racao_kg >= 0),   -- ração da origem que vai junto (custo)
  criou_lote boolean not null default false,       -- o lote do destino nasceu nesta transferência
  encerrou_origem boolean not null default false,  -- esta transferência esvaziou a origem
  bio_origem uuid,                                 -- pesagens criadas aqui (o desfazer tira)
  bio_destino uuid,
  registrado_por uuid not null references usuarios(id),
  criado_em timestamptz not null default now(),
  constraint transferencias_lotes_diferentes check (lote_origem <> lote_destino)
);
create index if not exists idx_transf_origem on transferencias(lote_origem, data);
create index if not exists idx_transf_destino on transferencias(lote_destino, data);
create index if not exists idx_transf_grupo on transferencias(grupo);
alter table transferencias enable row level security;

-- ler: quem vê a origem ou o destino. Gravar e apagar: só pelas funções abaixo.
drop policy if exists transferencias_select on transferencias;
create policy transferencias_select on transferencias for select
  using (fazenda_id = current_fazenda() and (
    exists (select 1 from lotes l where l.id = lote_origem and tem_acesso_tanque(l.tanque_id))
    or exists (select 1 from lotes l where l.id = lote_destino and tem_acesso_tanque(l.tanque_id))));

-- peixes que ainda estão no lote (estimativa: entrada − mortos − despescados − transferidos)
create or replace function vivos_lote(p_lote uuid) returns integer
language sql stable security definer set search_path = public as $$
  select greatest(0, l.quantidade_inicial
    - coalesce((select sum(m.quantidade) from mortalidade m where m.lote_id = l.id), 0)
    - coalesce((select sum(d.quantidade) from despescas d where d.lote_id = l.id), 0)
    - coalesce((select sum(t.quantidade) from transferencias t where t.lote_origem = l.id), 0))::int
  from lotes l where l.id = p_lote
$$;
revoke execute on function vivos_lote(uuid) from public, anon, authenticated;

-- p_destinos: [{"tanque_id": "...", "quantidade": 5500, "peso_medio_kg": 0.9, "tipo": "engorda"}, ...]
-- (tipo só vale quando o destino está vazio e nasce lote novo)
create or replace function registrar_transferencia(p_grupo uuid, p_lote_origem uuid, p_data date, p_destinos jsonb, p_esvaziou boolean)
returns int
language plpgsql security definer set search_path = public as $$
declare
  o lotes; d jsonb; v_tq uuid; v_qtd int; v_pm numeric; v_tipo text; v_dest lotes;
  v_vivos int; v_total int := 0; v_kg_total numeric := 0; v_racao numeric; v_criou boolean;
  v_vivos_dest int; v_pm_dest numeric; v_bio_o uuid; v_bio_d uuid; v_n int := 0; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro'; end if;
  if current_papel() is distinct from 'dono' and current_papel() is distinct from 'gerente' then
    raise exception 'Só o dono e o gerente lançam transferência';
  end if;
  if exists (select 1 from transferencias where grupo = p_grupo) then return 0; end if;   -- reenvio: já foi gravada
  select * into o from lotes where id = p_lote_origem for update;
  if o.id is null or not tem_acesso_tanque(o.tanque_id) then raise exception 'Lote de origem não encontrado'; end if;
  if not o.ativo then raise exception 'Este lote já foi encerrado'; end if;
  if p_data is null or p_data > hoje_local() then raise exception 'A data não pode ser no futuro'; end if;
  if p_data < o.data_entrada then raise exception 'A data é antes da entrada dos peixes neste tanque (%)', to_char(o.data_entrada, 'DD/MM/YYYY'); end if;
  if jsonb_typeof(p_destinos) is distinct from 'array' or jsonb_array_length(p_destinos) = 0 then raise exception 'Escolha para onde vão os peixes'; end if;
  if jsonb_array_length(p_destinos) > 20 then raise exception 'No máximo 20 tanques por vez'; end if;

  for d in select * from jsonb_array_elements(p_destinos) loop
    v_qtd := (d->>'quantidade')::int; v_pm := (d->>'peso_medio_kg')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Informe quantos peixes vão para cada tanque'; end if;
    if v_pm is null or v_pm <= 0 or v_pm > 20 then raise exception 'Informe o peso médio de cada tanque'; end if;
    v_total := v_total + v_qtd; v_kg_total := v_kg_total + v_qtd * v_pm;
  end loop;

  v_vivos := vivos_lote(o.id);
  -- ração acumulada na origem que ainda não foi repassada: dada aqui + herdada − já repassada
  v_racao := coalesce((select sum(quantidade_kg) from racao_consumo where lote_id = o.id), 0)
           + coalesce((select sum(racao_kg) from transferencias where lote_destino = o.id), 0)
           - coalesce((select sum(racao_kg) from transferencias where lote_origem = o.id), 0);
  v_racao := greatest(0, v_racao);

  -- a pesagem da transferência vale como biometria da origem (os peixes saíram dela)
  if not p_esvaziou then
    v_bio_o := gen_random_uuid();
    insert into biometrias (id, uuid_local, lote_id, data, peso_amostra_kg, quantidade_amostrada, registrado_por)
    values (v_bio_o, gen_random_uuid(), o.id, p_data, round(v_kg_total, 3), v_total, auth.uid());
  end if;

  for d in select * from jsonb_array_elements(p_destinos) loop
    v_tq := (d->>'tanque_id')::uuid; v_qtd := (d->>'quantidade')::int; v_pm := (d->>'peso_medio_kg')::numeric;
    if v_tq = o.tanque_id then raise exception 'O destino não pode ser o mesmo tanque'; end if;
    if not exists (select 1 from tanques where id = v_tq and fazenda_id = current_fazenda()) or not tem_acesso_tanque(v_tq) then
      raise exception 'Tanque de destino não encontrado';
    end if;
    v_criou := false; v_bio_d := null;
    select * into v_dest from lotes where tanque_id = v_tq and ativo order by data_entrada desc, criado_em desc limit 1 for update;
    if v_dest.id is null then
      v_tipo := coalesce(nullif(d->>'tipo', ''), o.tipo);
      if v_tipo not in ('bercario', 'alevinagem', 'recria', 'engorda') then raise exception 'Fase inválida'; end if;
      insert into lotes (tanque_id, tipo, especie, data_entrada, quantidade_inicial, peso_inicial_kg, ativo)
      values (v_tq, v_tipo, o.especie, p_data, v_qtd, greatest(0.01, round(v_qtd * v_pm, 2)), true)
      returning * into v_dest;
      v_criou := true;
    else
      -- junta no lote que já está lá: a pesagem nova é a média dos dois grupos
      v_vivos_dest := vivos_lote(v_dest.id);
      v_pm_dest := coalesce((select b.peso_amostra_kg / nullif(b.quantidade_amostrada, 0) from biometrias b
                             where b.lote_id = v_dest.id order by b.data desc, b.criado_em desc limit 1),
                            v_dest.peso_inicial_kg / nullif(v_dest.quantidade_inicial, 0));
      update lotes set quantidade_inicial = quantidade_inicial + v_qtd,
                       peso_inicial_kg = round(peso_inicial_kg + v_qtd * v_pm, 2)
        where id = v_dest.id;
      if v_vivos_dest > 0 and v_pm_dest is not null then
        v_bio_d := gen_random_uuid();
        insert into biometrias (id, uuid_local, lote_id, data, peso_amostra_kg, quantidade_amostrada, registrado_por)
        values (v_bio_d, gen_random_uuid(), v_dest.id, p_data, round(v_vivos_dest * v_pm_dest + v_qtd * v_pm, 3), v_vivos_dest + v_qtd, auth.uid());
      end if;
    end if;
    insert into transferencias (grupo, fazenda_id, data, lote_origem, lote_destino, quantidade, peso_medio_kg, racao_kg,
                                criou_lote, encerrou_origem, bio_origem, bio_destino, registrado_por)
    values (p_grupo, current_fazenda(), p_data, o.id, v_dest.id, v_qtd, v_pm,
            round(v_racao * v_qtd / greatest(v_vivos, v_total), 3), v_criou, p_esvaziou, v_bio_o, v_bio_d, auth.uid());
    v_n := v_n + 1;
  end loop;

  if p_esvaziou then update lotes set ativo = false where id = o.id; end if;
  return v_n;
end $$;
revoke execute on function registrar_transferencia(uuid, uuid, date, jsonb, boolean) from public, anon;
grant execute on function registrar_transferencia(uuid, uuid, date, jsonb, boolean) to authenticated;

-- desfaz uma transferência inteira (o grupo). O lote novo do destino só sai se ainda não tiver lançamentos.
create or replace function desfazer_transferencia(p_grupo uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t transferencias; v_n int := 0; v_origem uuid; v_reabre boolean := false;
begin
  if current_papel() is distinct from 'dono' and current_papel() is distinct from 'gerente' then
    raise exception 'Só o dono e o gerente desfazem transferência';
  end if;
  if not exists (select 1 from transferencias where grupo = p_grupo and fazenda_id = current_fazenda()) then
    raise exception 'Transferência não encontrada';
  end if;
  -- não desfaz se algum destino já passou estes peixes adiante
  if exists (select 1 from transferencias depois join transferencias esta on esta.lote_destino = depois.lote_origem
             where esta.grupo = p_grupo and depois.grupo <> p_grupo and depois.criado_em > esta.criado_em) then
    raise exception 'Estes peixes já foram transferidos de novo. Desfaça a transferência mais nova primeiro.';
  end if;
  for t in select * from transferencias where grupo = p_grupo and fazenda_id = current_fazenda() for update loop
    v_origem := t.lote_origem; v_reabre := v_reabre or t.encerrou_origem;
    if t.bio_destino is not null then delete from biometrias where id = t.bio_destino; end if;
    if t.criou_lote then
      if exists (select 1 from racao_consumo where lote_id = t.lote_destino) or exists (select 1 from biometrias where lote_id = t.lote_destino)
         or exists (select 1 from mortalidade where lote_id = t.lote_destino) or exists (select 1 from despescas where lote_id = t.lote_destino)
         or exists (select 1 from transferencias where lote_destino = t.lote_destino and id <> t.id) then
        raise exception 'O tanque que recebeu os peixes já tem lançamentos. Exclua-os antes de desfazer.';
      end if;
      delete from transferencias where id = t.id;
      delete from lotes where id = t.lote_destino;
    else
      update lotes set quantidade_inicial = quantidade_inicial - t.quantidade,
                       peso_inicial_kg = greatest(0.01, round(peso_inicial_kg - t.quantidade * t.peso_medio_kg, 2))
        where id = t.lote_destino;
      delete from transferencias where id = t.id;
    end if;
    if t.bio_origem is not null then delete from biometrias where id = t.bio_origem; end if;
    v_n := v_n + 1;
  end loop;
  -- reabre a origem que esta transferência esvaziou (se o tanque não tiver outro lote ativo)
  if v_reabre and not exists (select 1 from lotes l2 join lotes o on o.tanque_id = l2.tanque_id where o.id = v_origem and l2.ativo and l2.id <> o.id) then
    update lotes set ativo = true where id = v_origem;
  end if;
  return v_n;
end $$;
revoke execute on function desfazer_transferencia(uuid) from public, anon;
grant execute on function desfazer_transferencia(uuid) to authenticated;

-- resumo por lote: agora com os peixes transferidos para outros tanques (coluna nova no fim)
drop function if exists resumo_lotes();
create function resumo_lotes()
returns table (
  lote_id uuid,
  racao_kg numeric,
  mortos bigint,
  ultimo_peso_medio_kg numeric,
  ultima_biometria date,
  ultima_racao date,
  despescados bigint,
  transferidos bigint
)
language sql stable set search_path = public as $$
  select
    l.id,
    coalesce((select sum(rc.quantidade_kg) from racao_consumo rc where rc.lote_id = l.id), 0),
    coalesce((select sum(m.quantidade) from mortalidade m where m.lote_id = l.id), 0),
    (select b.peso_amostra_kg / nullif(b.quantidade_amostrada, 0)
       from biometrias b where b.lote_id = l.id
       order by b.data desc, b.criado_em desc limit 1),
    (select max(b.data) from biometrias b where b.lote_id = l.id),
    (select max(rc.data) from racao_consumo rc where rc.lote_id = l.id),
    coalesce((select sum(d.quantidade) from despescas d where d.lote_id = l.id), 0),
    coalesce((select sum(t.quantidade) from transferencias t where t.lote_origem = l.id), 0)
  from lotes l
$$;
revoke execute on function resumo_lotes() from public, anon;
grant execute on function resumo_lotes() to authenticated;

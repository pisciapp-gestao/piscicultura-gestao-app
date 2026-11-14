-- ============================================================
-- 35. PEDIR CORREÇÃO (layout novo, etapa 3, 14/11/2026)
-- Rode no SQL Editor do Supabase (depois do 01 a 34). Pode rodar de novo sem estragar nada.
--
-- Como fica a correção de um lançamento:
--   * Até 5 minutos depois de salvar: "Desfazer" (app; já existia).
--   * No mesmo dia: quem lançou corrige ou apaga direto (sql/33; continua igual, pedido do cliente piloto).
--   * Dos dias anteriores (até 7 dias): o funcionário PEDE a correção, com o valor certo e o motivo.
--     O dono ou o gerente aprova (o banco corrige sozinho) ou recusa. Depois de 7 dias, só o dono ou o gerente.
-- Vale para ração, mortalidade, pesagem (biometria), água e probiótico. Despesca continua só dono/gerente.
-- A correção aprovada passa pelo mesmo gatilho do Histórico: fica registrado quem aprovou, antes e depois.
-- O pedido guarda quem pediu, quando, o motivo e a resposta.
-- ============================================================

create table if not exists pedidos_correcao (
  id uuid primary key default gen_random_uuid(),
  fazenda_id uuid not null references fazendas(id) on delete cascade,
  tabela text not null check (tabela in ('racao_consumo', 'mortalidade', 'biometrias', 'qualidade_agua', 'manejos')),
  registro_id uuid not null,
  tanque_id uuid references tanques(id) on delete cascade,
  acao text not null check (acao in ('corrigir', 'apagar')),
  antes jsonb not null,                        -- o lançamento como estava na hora do pedido
  campos jsonb not null default '{}'::jsonb,   -- os valores certos (só na ação "corrigir")
  motivo text not null check (char_length(btrim(motivo)) between 1 and 200),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado', 'cancelado')),
  pedido_por uuid not null references usuarios(id) on delete cascade,
  pedido_em timestamptz not null default now(),
  resposta text check (resposta is null or char_length(resposta) <= 200),
  respondido_por uuid references usuarios(id) on delete set null,
  respondido_em timestamptz
);
create index if not exists idx_pedidos_correcao_fazenda on pedidos_correcao(fazenda_id, status, pedido_em desc);
create index if not exists idx_pedidos_correcao_pedido_por on pedidos_correcao(pedido_por, pedido_em desc);
-- um pedido aberto por lançamento
create unique index if not exists uq_pedidos_correcao_aberto on pedidos_correcao(tabela, registro_id) where status = 'pendente';
alter table pedidos_correcao enable row level security;

-- leitura: quem pediu vê os seus; dono e gerente veem os dos tanques que eles enxergam.
-- Ninguém grava direto: só pelas funções abaixo (que conferem tudo).
drop policy if exists pedidos_correcao_select on pedidos_correcao;
create policy pedidos_correcao_select on pedidos_correcao for select to authenticated
  using (fazenda_id = current_fazenda()
         and (pedido_por = auth.uid() or (current_papel() in ('dono', 'gerente') and (tanque_id is null or tem_acesso_tanque(tanque_id)))));
revoke insert, update, delete on pedidos_correcao from anon, authenticated;

-- campos que cada tipo de lançamento deixa corrigir (todos numéricos)
create or replace function campos_corrigiveis(p_tabela text) returns text[]
language sql immutable set search_path = public as $$
  select case p_tabela
    when 'racao_consumo' then array['quantidade_kg']
    when 'mortalidade' then array['quantidade']
    when 'biometrias' then array['peso_amostra_kg', 'quantidade_amostrada']
    when 'qualidade_agua' then array['oxigenio_mgl', 'temperatura_c', 'ph', 'amonia_mgl']
    when 'manejos' then array['dose']
  end
$$;

-- confere os valores pedidos (antes de abrir o pedido e de novo antes de aprovar)
create or replace function conferir_campos_correcao(p_tabela text, p_campos jsonb) returns void
language plpgsql immutable set search_path = public as $$
declare k text; v numeric; t text;
begin
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' or p_campos = '{}'::jsonb then
    raise exception 'Informe o valor certo.';
  end if;
  for k in select jsonb_object_keys(p_campos) loop
    if not (k = any (campos_corrigiveis(p_tabela))) then raise exception 'Campo que não pode ser corrigido: %', k; end if;
    t := jsonb_typeof(p_campos -> k);
    if t = 'null' and p_tabela = 'qualidade_agua' then continue; end if; -- na água, apagar uma das medidas vale
    if t <> 'number' then raise exception 'Valor inválido em %', k; end if;
    v := (p_campos ->> k)::numeric;
    if k in ('quantidade_kg') and not (v > 0 and v <= 5000) then raise exception 'Ração: de 0 a 5.000 kg.'; end if;
    if k in ('quantidade', 'quantidade_amostrada') and not (v >= 1 and v = trunc(v) and v <= 10000000) then raise exception 'Quantidade de peixes: número inteiro a partir de 1.'; end if;
    if k = 'peso_amostra_kg' and not (v > 0 and v <= 100000) then raise exception 'Peso da pesagem inválido.'; end if;
    if k = 'dose' and not (v > 0 and v <= 1000000) then raise exception 'Dose inválida.'; end if;
    if k = 'oxigenio_mgl' and not (v between 0 and 25) then raise exception 'Oxigênio: de 0 a 25.'; end if;
    if k = 'temperatura_c' and not (v between 0 and 50) then raise exception 'Temperatura: de 0 a 50.'; end if;
    if k = 'ph' and not (v between 0 and 14) then raise exception 'pH: de 0 a 14.'; end if;
    if k = 'amonia_mgl' and not (v between 0 and 50) then raise exception 'Amônia: de 0 a 50.'; end if;
  end loop;
end $$;

-- o lançamento (como jsonb) e o tanque dele
create or replace function lancamento_para_correcao(p_tabela text, p_id uuid, out registro jsonb, out tanque uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if campos_corrigiveis(p_tabela) is null then raise exception 'Tipo de lançamento inválido.'; end if;
  execute format('select to_jsonb(x) from %I x where x.id = $1', p_tabela) into registro using p_id;
  if registro is null then return; end if;
  tanque := coalesce((registro ->> 'tanque_id')::uuid, (select l.tanque_id from lotes l where l.id = (registro ->> 'lote_id')::uuid));
end $$;

-- ---------- funcionário (ou qualquer um da equipe) pede ----------
create or replace function pedir_correcao(p_tabela text, p_registro uuid, p_acao text, p_campos jsonb, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_faz uuid := current_fazenda(); v_reg jsonb; v_tq uuid; v_id uuid; k text;
begin
  if v_faz is null or auth.uid() is null then raise exception 'Sem acesso.'; end if;
  if p_acao not in ('corrigir', 'apagar') then raise exception 'Ação inválida.'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 1 and 200 then raise exception 'Informe o motivo (até 200 letras).'; end if;
  select registro, tanque into v_reg, v_tq from lancamento_para_correcao(p_tabela, p_registro);
  if v_reg is null then raise exception 'Lançamento não encontrado.'; end if;
  if (v_reg ->> 'registrado_por')::uuid is distinct from auth.uid() then raise exception 'Só quem lançou pode pedir a correção.'; end if;
  if v_tq is null or not tem_acesso_tanque(v_tq) then raise exception 'Sem acesso a este tanque.'; end if;
  if (v_reg ->> 'data')::date < hoje_local() - 7 then raise exception 'Lançamento com mais de 7 dias: só o dono ou o gerente corrige.'; end if;
  if exists (select 1 from pedidos_correcao where tabela = p_tabela and registro_id = p_registro and status = 'pendente') then
    raise exception 'Já existe um pedido aberto para este lançamento.';
  end if;
  if p_acao = 'corrigir' then
    perform conferir_campos_correcao(p_tabela, p_campos);
    -- nada mudou? não abre pedido
    if not exists (select 1 from jsonb_object_keys(p_campos) k2 where (v_reg -> k2) is distinct from (p_campos -> k2)
                   and not (jsonb_typeof(v_reg -> k2) = 'number' and jsonb_typeof(p_campos -> k2) = 'number' and (v_reg ->> k2)::numeric = (p_campos ->> k2)::numeric)) then
      raise exception 'O valor certo é igual ao lançado.';
    end if;
    -- a água precisa continuar com pelo menos uma medida
    if p_tabela = 'qualidade_agua' then
      if (select bool_and(jsonb_typeof(coalesce(p_campos -> c, v_reg -> c)) = 'null') from unnest(campos_corrigiveis('qualidade_agua')) c) then
        raise exception 'A medição precisa ter pelo menos um valor. Para tirar a medição toda, peça para apagar.';
      end if;
    end if;
  end if;
  insert into pedidos_correcao (fazenda_id, tabela, registro_id, tanque_id, acao, antes, campos, motivo, pedido_por)
  values (v_faz, p_tabela, p_registro, v_tq, p_acao, v_reg, case when p_acao = 'corrigir' then p_campos else '{}'::jsonb end, btrim(p_motivo), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------- quem pediu desiste ----------
create or replace function cancelar_pedido_correcao(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pedidos_correcao set status = 'cancelado', respondido_em = now(), respondido_por = auth.uid()
  where id = p_id and pedido_por = auth.uid() and status = 'pendente' and fazenda_id = current_fazenda();
  if not found then raise exception 'Pedido não encontrado ou já respondido.'; end if;
end $$;

-- ---------- dono ou gerente responde ----------
create or replace function responder_correcao(p_id uuid, p_aprovar boolean, p_resposta text default null)
returns text language plpgsql security definer set search_path = public as $$
declare p pedidos_correcao; v_atual jsonb; v_tq uuid; v_set text; v_n int; k text;
begin
  if current_papel() not in ('dono', 'gerente') then raise exception 'Só o dono ou o gerente responde pedidos de correção.'; end if;
  if p_resposta is not null and char_length(p_resposta) > 200 then raise exception 'Resposta: até 200 letras.'; end if;
  select * into p from pedidos_correcao where id = p_id and fazenda_id = current_fazenda() for update;
  if p.id is null or (p.tanque_id is not null and not tem_acesso_tanque(p.tanque_id)) then raise exception 'Pedido não encontrado.'; end if;
  if p.status <> 'pendente' then raise exception 'Este pedido já foi respondido.'; end if;
  if p_aprovar then
    select registro, tanque into v_atual, v_tq from lancamento_para_correcao(p.tabela, p.registro_id);
    if v_atual is null then raise exception 'O lançamento não existe mais (foi apagado). Recuse o pedido.'; end if;
    if p.acao = 'apagar' then
      execute format('delete from %I where id = $1', p.tabela) using p.registro_id;
    else
      -- alguém já mexeu nos mesmos campos depois do pedido? não aplica por cima
      for k in select jsonb_object_keys(p.campos) loop
        if (v_atual -> k) is distinct from (p.antes -> k) then
          raise exception 'O lançamento mudou depois do pedido. Recuse e peça para pedir de novo.';
        end if;
      end loop;
      perform conferir_campos_correcao(p.tabela, p.campos);
      select string_agg(format('%I = ($1 ->> %L)::numeric', c, c), ', ') into v_set from jsonb_object_keys(p.campos) c;
      execute format('update %I set %s where id = $2', p.tabela, v_set) using p.campos, p.registro_id;
      get diagnostics v_n = row_count;
      if v_n <> 1 then raise exception 'Não foi possível corrigir o lançamento.'; end if;
    end if;
  end if;
  update pedidos_correcao set status = case when p_aprovar then 'aprovado' else 'recusado' end,
    resposta = nullif(btrim(coalesce(p_resposta, '')), ''), respondido_por = auth.uid(), respondido_em = now()
  where id = p.id;
  return case when p_aprovar then 'aprovado' else 'recusado' end;
end $$;

revoke execute on function campos_corrigiveis(text), conferir_campos_correcao(text, jsonb), lancamento_para_correcao(text, uuid),
  pedir_correcao(text, uuid, text, jsonb, text), cancelar_pedido_correcao(uuid), responder_correcao(uuid, boolean, text) from public, anon;
grant execute on function pedir_correcao(text, uuid, text, jsonb, text), cancelar_pedido_correcao(uuid), responder_correcao(uuid, boolean, text) to authenticated;
-- as auxiliares ficam só para as funções acima (lancamento_para_correcao lê qualquer lançamento: não pode ser chamada direto)
revoke execute on function lancamento_para_correcao(text, uuid) from authenticated;

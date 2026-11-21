-- ============================================================
-- POVOAMENTOS EXTRAS: peixes que entram no MESMO lote em outra data
-- (ex.: berçário povoado em 10/11 com 50.000 e em 14/11 com mais 30.000).
-- Rode no SQL Editor do Supabase (depois do 01 a 38). Pode rodar de novo sem estragar nada.
--
-- O 1º povoamento continua no próprio lote (data_entrada, quantidade_inicial, peso_inicial_kg).
-- Cada povoamento extra entra aqui, e o lote soma sozinho: quantidade_inicial e peso_inicial_kg
-- passam a ser o TOTAL que entrou no tanque. Assim todas as contas do app (vivos, biomassa,
-- conversão alimentar, comparação de ciclos) continuam certas sem mudar nada.
-- Só dono e gerente lançam, corrigem e excluem.
-- ============================================================

create table if not exists povoamentos (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references lotes(id) on delete cascade,
  data date not null,
  quantidade integer not null check (quantidade between 1 and 10000000),
  peso_total_kg numeric(12,3) not null check (peso_total_kg > 0),
  registrado_por uuid references usuarios(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_povoamentos_lote on povoamentos(lote_id, data);
alter table povoamentos enable row level security;

drop policy if exists povoamentos_select on povoamentos;
drop policy if exists povoamentos_insert on povoamentos;
drop policy if exists povoamentos_update on povoamentos;
drop policy if exists povoamentos_delete on povoamentos;
create policy povoamentos_select on povoamentos for select
  using (exists (select 1 from lotes l where l.id = lote_id and tem_acesso_tanque(l.tanque_id)));
create policy povoamentos_insert on povoamentos for insert
  with check (current_papel() in ('dono','gerente') and registrado_por = auth.uid()
              and exists (select 1 from lotes l where l.id = lote_id and tem_acesso_tanque(l.tanque_id)));
create policy povoamentos_update on povoamentos for update
  using (current_papel() in ('dono','gerente') and exists (select 1 from lotes l where l.id = lote_id and tem_acesso_tanque(l.tanque_id)))
  with check (exists (select 1 from lotes l where l.id = lote_id and tem_acesso_tanque(l.tanque_id)));
create policy povoamentos_delete on povoamentos for delete
  using (current_papel() in ('dono','gerente') and exists (select 1 from lotes l where l.id = lote_id and tem_acesso_tanque(l.tanque_id)));

-- o lote soma/subtrai sozinho (roda com as permissões de quem lançou: as regras do lote continuam valendo)
create or replace function trg_povoamentos_somar_lote() returns trigger
language plpgsql set search_path = public as $$
declare v_ini date;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'UPDATE' and new.lote_id <> old.lote_id then raise exception 'Não dá para mudar o povoamento de lote'; end if;
    select data_entrada into v_ini from lotes where id = new.lote_id;
    if new.data < v_ini then raise exception 'A data do povoamento não pode ser antes do 1º povoamento do lote'; end if;
    if new.data > (now() at time zone 'America/Boa_Vista')::date then raise exception 'A data do povoamento está no futuro'; end if;
  end if;
  if tg_op = 'INSERT' then
    update lotes set quantidade_inicial = quantidade_inicial + new.quantidade,
                     peso_inicial_kg = peso_inicial_kg + new.peso_total_kg where id = new.lote_id;
    return new;
  elsif tg_op = 'UPDATE' then
    update lotes set quantidade_inicial = quantidade_inicial - old.quantidade + new.quantidade,
                     peso_inicial_kg = peso_inicial_kg - old.peso_total_kg + new.peso_total_kg where id = new.lote_id;
    return new;
  else
    -- lote sendo apagado em cascata: não há o que subtrair
    update lotes set quantidade_inicial = greatest(1, quantidade_inicial - old.quantidade),
                     peso_inicial_kg = greatest(0.01, peso_inicial_kg - old.peso_total_kg) where id = old.lote_id;
    return old;
  end if;
end $$;

drop trigger if exists povoamentos_somar_lote on povoamentos;
create trigger povoamentos_somar_lote after insert or update or delete on povoamentos
  for each row execute function trg_povoamentos_somar_lote();

-- o lote não pode ficar com menos peixes do que os povoamentos extras somam
-- (protege a correção do 1º povoamento feita na tela "Corrigir dados do lote")
create or replace function trg_lotes_conferir_povoamentos() returns trigger
language plpgsql set search_path = public as $$
declare v_q int; v_p numeric; v_d date;
begin
  select coalesce(sum(quantidade), 0), coalesce(sum(peso_total_kg), 0), min(data) into v_q, v_p, v_d from povoamentos where lote_id = new.id;
  if v_q > 0 and new.quantidade_inicial <= v_q then raise exception 'O 1º povoamento precisa ter pelo menos 1 peixe'; end if;
  if v_d is not null and new.data_entrada > v_d then raise exception 'A data do 1º povoamento não pode ser depois de outro povoamento do lote (%)', to_char(v_d, 'DD/MM/YYYY'); end if;
  return new;
end $$;

drop trigger if exists lotes_conferir_povoamentos on lotes;
create trigger lotes_conferir_povoamentos before update of quantidade_inicial, peso_inicial_kg, data_entrada on lotes
  for each row execute function trg_lotes_conferir_povoamentos();

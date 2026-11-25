-- 42) Acompanhamento dos clientes no painel do administrador + biomassa que acompanha a ração (pedido do Hugo, 25/11/2026).
--
-- PARTE 1 — resumo_lotes ganha 3 colunas (as antigas ficam iguais, o app antigo continua funcionando):
--   racao_ate_bio_kg   = ração dada até a data da última biometria
--   racao_desde_bio_kg = ração dada DEPOIS da última biometria (sem biometria: toda a ração do lote)
--   primeira_racao     = data da primeira ração lançada (lote cadastrado com peixe já no tanque)
-- Com elas o app estima o peso de HOJE pela tabela de alimentação (tela Hoje, Tanques, sugestão de ração, painel).
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
  transferidos bigint,
  racao_ate_bio_kg numeric,
  racao_desde_bio_kg numeric,
  primeira_racao date
)
language sql stable set search_path = public as $$
  select x.id, x.racao_kg, x.mortos, x.pm, x.ub, x.ur, x.despescados, x.transferidos,
    case when x.ub is null then 0 else coalesce((select sum(rc.quantidade_kg) from racao_consumo rc where rc.lote_id = x.id and rc.data <= x.ub), 0) end,
    case when x.ub is null then x.racao_kg else coalesce((select sum(rc.quantidade_kg) from racao_consumo rc where rc.lote_id = x.id and rc.data > x.ub), 0) end,
    x.pr
  from (
    select l.id,
      coalesce((select sum(rc.quantidade_kg) from racao_consumo rc where rc.lote_id = l.id), 0) as racao_kg,
      coalesce((select sum(m.quantidade) from mortalidade m where m.lote_id = l.id), 0) as mortos,
      (select b.peso_amostra_kg / nullif(b.quantidade_amostrada, 0)
         from biometrias b where b.lote_id = l.id
         order by b.data desc, b.criado_em desc limit 1) as pm,
      (select max(b.data) from biometrias b where b.lote_id = l.id) as ub,
      (select max(rc.data) from racao_consumo rc where rc.lote_id = l.id) as ur,
      coalesce((select sum(d.quantidade) from despescas d where d.lote_id = l.id), 0) as despescados,
      coalesce((select sum(t.quantidade) from transferencias t where t.lote_origem = l.id), 0) as transferidos,
      (select min(rc.data) from racao_consumo rc where rc.lote_id = l.id) as pr
    from lotes l
  ) x
$$;
revoke execute on function resumo_lotes() from public, anon;
grant execute on function resumo_lotes() to authenticated;

-- PARTE 2 — acompanhamento no painel do administrador.
--
-- Uma linha por fazenda com os números do dia a dia, para o administrador acompanhar sem entrar como suporte:
-- lotes ativos, peixes na água, biomassa (peso da última biometria de cada lote), ração de hoje e dos últimos 7 dias,
-- mortes dos últimos 7 dias, estoque de ração, última medição de oxigênio e a última atividade (qualquer lançamento).
--   * SÓ LEITURA. Só quem está em `administradores` consegue chamar (eh_admin); para os outros dá erro.
--   * Não mostra valores em R$ nem nomes de pessoas.
--   * Os números seguem as mesmas contas do app (resumo_lotes e saldo_racao), com a data de Roraima.
-- Pode rodar de novo sem problema. Rode depois do sql/37 (transferências) e do sql/34 (suporte).

drop function if exists admin_acompanhamento();
create function admin_acompanhamento() returns table (
  fazenda_id uuid,
  lotes_ativos bigint,
  peixes_vivos bigint,
  biomassa_kg numeric,          -- só dos lotes com biometria (peixes vivos × peso médio da última biometria)
  lotes_sem_biometria bigint,
  racao_hoje_kg numeric,
  racao_7d_kg numeric,          -- os 7 dias antes de hoje (igual ao saldo_racao)
  mortos_7d bigint,             -- hoje e os 6 dias antes
  estoque_kg numeric,           -- comprado − consumido + ajustes das contagens
  oxigenio_mgl numeric,         -- última medição da fazenda
  oxigenio_em date,
  oxigenio_tanque text,
  ultima_atividade timestamptz, -- último lançamento de qualquer tipo
  lotes jsonb                   -- um item por lote ativo, para o app estimar o peso de hoje pela ração (mesma conta das telas)
)
language plpgsql stable security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Boa_Vista')::date;
begin
  if not eh_admin() then raise exception 'Apenas administradores'; end if;
  return query
  with lt as (
    select t.fazenda_id as faz, l.id,
      greatest(0, l.quantidade_inicial
        - coalesce((select sum(m.quantidade) from mortalidade m where m.lote_id = l.id), 0)
        - coalesce((select sum(d.quantidade) from despescas d where d.lote_id = l.id), 0)
        - coalesce((select sum(tr.quantidade) from transferencias tr where tr.lote_origem = l.id), 0))::bigint as vivos,
      (select b.peso_amostra_kg / nullif(b.quantidade_amostrada, 0) from biometrias b where b.lote_id = l.id
        order by b.data desc, b.criado_em desc limit 1) as pm
    from lotes l join tanques t on t.id = l.tanque_id
    where l.ativo
  )
  select f.id,
    (select count(*) from lt where lt.faz = f.id),
    (select coalesce(sum(lt.vivos), 0)::bigint from lt where lt.faz = f.id),
    (select round(sum(lt.vivos * lt.pm), 1) from lt where lt.faz = f.id and lt.pm is not null),
    (select count(*) from lt where lt.faz = f.id and lt.pm is null),
    (select coalesce(sum(rc.quantidade_kg), 0) from racao_consumo rc join tanques t on t.id = rc.tanque_id
      where t.fazenda_id = f.id and rc.data = v_hoje),
    (select coalesce(sum(rc.quantidade_kg), 0) from racao_consumo rc join tanques t on t.id = rc.tanque_id
      where t.fazenda_id = f.id and rc.data >= v_hoje - 7 and rc.data < v_hoje),
    (select coalesce(sum(m.quantidade), 0)::bigint from mortalidade m join lotes l on l.id = m.lote_id join tanques t on t.id = l.tanque_id
      where t.fazenda_id = f.id and m.data > v_hoje - 7 and m.data <= v_hoje),
    (select coalesce((select sum(e.quantidade_kg) from racao_estoque e where e.fazenda_id = f.id), 0)
          - coalesce((select sum(rc.quantidade_kg) from racao_consumo rc join tanques t on t.id = rc.tanque_id where t.fazenda_id = f.id), 0)
          + coalesce((select sum(c.diferenca_kg) from racao_contagens c where c.fazenda_id = f.id), 0)),
    a.oxigenio_mgl, a.data, a.tanque,
    (select max(x) from (
      select max(rc.criado_em) x from racao_consumo rc join tanques t on t.id = rc.tanque_id where t.fazenda_id = f.id
      union all select max(b.criado_em) from biometrias b join lotes l on l.id = b.lote_id join tanques t on t.id = l.tanque_id where t.fazenda_id = f.id
      union all select max(m.criado_em) from mortalidade m join lotes l on l.id = m.lote_id join tanques t on t.id = l.tanque_id where t.fazenda_id = f.id
      union all select max(q.criado_em) from qualidade_agua q join tanques t on t.id = q.tanque_id where t.fazenda_id = f.id
      union all select max(d.criado_em) from despescas d join lotes l on l.id = d.lote_id join tanques t on t.id = l.tanque_id where t.fazenda_id = f.id
    ) u),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'especie', l.especie, 'tipo', l.tipo, 'ativo', l.ativo, 'data_entrada', l.data_entrada,
        'quantidade_inicial', l.quantidade_inicial, 'peso_inicial_kg', l.peso_inicial_kg,
        'mortos', r.mortos, 'despescados', r.despescados, 'transferidos', r.transferidos,
        'ultimo_peso_medio_kg', r.ultimo_peso_medio_kg, 'ultima_biometria', r.ultima_biometria, 'racao_kg', r.racao_kg,
        'racao_ate_bio_kg', r.racao_ate_bio_kg, 'racao_desde_bio_kg', r.racao_desde_bio_kg, 'primeira_racao', r.primeira_racao)), '[]'::jsonb)
      from lotes l join tanques t on t.id = l.tanque_id join resumo_lotes() r on r.lote_id = l.id
      where t.fazenda_id = f.id and l.ativo)
  from fazendas f
  left join lateral (
    select q.oxigenio_mgl, q.data, t.nome as tanque from qualidade_agua q join tanques t on t.id = q.tanque_id
    where t.fazenda_id = f.id and q.oxigenio_mgl is not null
    order by q.data desc, q.hora desc nulls last, q.criado_em desc limit 1
  ) a on true;
end $$;

revoke execute on function admin_acompanhamento() from public, anon;
grant execute on function admin_acompanhamento() to authenticated;

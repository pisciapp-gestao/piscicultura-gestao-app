-- ============================================================
-- 41. CONVERSÃO ALIMENTAR (da fazenda e de cada tanque)
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
--
-- Pedido de 18/11/2026: o cliente precisa poder alterar a conversão alimentar usada na previsão
-- "Faltam X sacos até vender". A tabela de alimentação do app tem conversão 1,6; na fazenda real deu de 1,9 a 2,4.
-- Com a conversão informada, a previsão é: peixes vivos × (peso de venda − peso médio atual) × conversão.
-- Sem conversão informada, continua a conta pela tabela de alimentação (como antes).
--  * a da fazenda: só o dono muda (como o peso do saco e o peso de venda);
--  * a do tanque: dono e gerente (como o nome, a área e o peso de venda do tanque). Vazio = usa a da fazenda.
-- ============================================================
alter table fazendas add column if not exists conversao_alimentar numeric(4,2);
alter table fazendas drop constraint if exists fazendas_conversao_ok;
alter table fazendas add constraint fazendas_conversao_ok check (conversao_alimentar is null or (conversao_alimentar >= 0.5 and conversao_alimentar <= 5));
grant select (conversao_alimentar) on fazendas to authenticated;

alter table tanques add column if not exists conversao_alimentar numeric(4,2);
alter table tanques drop constraint if exists tanques_conversao_ok;
alter table tanques add constraint tanques_conversao_ok check (conversao_alimentar is null or (conversao_alimentar >= 0.5 and conversao_alimentar <= 5));

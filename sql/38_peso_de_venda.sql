-- ============================================================
-- 38. PESO DE VENDA (da fazenda e de cada tanque)
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
--
-- Pedido do cliente piloto (16/11/2026): com o peso de venda, o app diz quanto falta de ração até vender
-- (pela tabela de alimentação). Um peso para a fazenda toda e, se quiser, um próprio por tanque (a realidade de um
-- tanque pode ser diferente da do outro). Tanque sem peso próprio usa o da fazenda.
--  * o da fazenda: só o dono muda (como o peso do saco);
--  * o do tanque: dono e gerente (como o nome e a área do tanque).
-- Antes, a "meta de despesca" ficava só no aparelho de cada um.
-- ============================================================
alter table fazendas add column if not exists peso_venda_kg numeric(6,3);
alter table fazendas drop constraint if exists fazendas_peso_venda_ok;
alter table fazendas add constraint fazendas_peso_venda_ok check (peso_venda_kg is null or (peso_venda_kg > 0 and peso_venda_kg <= 20));
grant select (peso_venda_kg) on fazendas to authenticated;

alter table tanques add column if not exists peso_venda_kg numeric(6,3);
alter table tanques drop constraint if exists tanques_peso_venda_ok;
alter table tanques add constraint tanques_peso_venda_ok check (peso_venda_kg is null or (peso_venda_kg > 0 and peso_venda_kg <= 20));

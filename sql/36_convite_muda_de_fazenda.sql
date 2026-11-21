-- ============================================================
-- 36. CONVITE PARA QUEM FOI DESATIVADO EM OUTRA FAZENDA
-- Rode no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
--
-- Caso real (15/11/2026): o Victor era gerente numa fazenda, saiu, e o convite de gerente
-- de outra fazenda respondia "Esta conta já está ligada a uma fazenda". Uma conta é de UMA
-- fazenda por vez, e o app só deixa o dono DESATIVAR a pessoa (não apagar, para não perder
-- quem lançou o quê).
--
-- Agora: quem está DESATIVADO numa fazenda pode aceitar o convite de outra e muda de fazenda.
--  - continua bloqueado quem está ATIVO em outra fazenda (o dono de lá precisa desativar antes);
--  - continua bloqueado quem é DONO (dono não muda de fazenda por convite);
--  - os lançamentos antigos ficam na fazenda antiga; os tanques liberados lá são tirados.
-- ============================================================
create or replace function aceitar_convite(p_token text, p_nome text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c convites; u usuarios;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro'; end if;
  select * into u from usuarios where id = auth.uid();
  if u.id is not null and u.ativo then
    raise exception 'Esta conta ainda está ativa em outra fazenda. Peça ao dono dela para desativar o seu acesso (Fazenda > Equipe) e abra o convite de novo.';
  end if;
  if u.id is not null and u.papel = 'dono' then
    raise exception 'Esta conta é de dono de outra fazenda e não pode entrar por convite. Use outro e-mail.';
  end if;
  p_nome := trim(coalesce(p_nome, ''));
  if length(p_nome) < 2 or length(p_nome) > 80 then raise exception 'Informe o seu nome'; end if;
  select * into c from convites where token = p_token for update;
  if c.token is null then raise exception 'Convite não encontrado. Peça um link novo ao dono.'; end if;
  if c.cancelado then raise exception 'Este convite foi cancelado. Peça um link novo ao dono.'; end if;
  if c.usado_em is not null then raise exception 'Este convite já foi usado. Peça um link novo ao dono.'; end if;
  if c.expira_em <= now() then raise exception 'Este convite expirou. Peça um link novo ao dono.'; end if;
  if u.id is null then
    insert into usuarios (id, fazenda_id, nome, papel) values (auth.uid(), c.fazenda_id, p_nome, c.papel);
  else
    -- desativado em outra fazenda: tira os tanques de lá e passa para a fazenda do convite
    delete from usuario_tanques where usuario_id = u.id;
    update usuarios set fazenda_id = c.fazenda_id, nome = p_nome, papel = c.papel, ativo = true where id = u.id;
  end if;
  update convites set usado_por = auth.uid(), usado_em = now() where token = c.token;
  return c.fazenda_id;
end $$;
revoke execute on function aceitar_convite(text, text) from public, anon;
grant execute on function aceitar_convite(text, text) to authenticated;

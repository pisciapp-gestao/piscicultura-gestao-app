// Rações da fazenda (sql/39): a lista que o tratador escolhe em cada trato. Dono e gerente cadastram,
// mudam o nome e a cor e desativam a que não usam mais (sai da escolha, o histórico fica).
// Pedido do Guilherme, 17/11/2026: "não existe jogar ração sem saber qual é; o dono precisa desse controle".
import { esc } from '../util.js';
import { confirmar } from '../dialogo.js';
import { corRacao, CORES_RACOES } from '../graficos.js';
import { TABELA_ALIMENTAR } from '../config.js';

const FASES = [['alevino', 'Alevino'], ['recria', 'Recria'], ['engorda', 'Engorda']];
const ROTULO_FASE = Object.fromEntries(FASES);

// sugestão para começar: as rações da tabela de alimentação, na ordem em que o peixe passa por elas
function sugestoes() {
  const nomes = [...new Set(TABELA_ALIMENTAR.map((l) => l[4]))];
  return nomes.map((nome, i) => ({ nome, cor: i % CORES_RACOES.length, fase: /^Inicial|^45%/.test(nome) ? 'alevino' : /^28%/.test(nome) ? 'engorda' : 'recria' }));
}

export async function renderRacoes(ctx, el) {
  if (!ctx.podeGerir()) { el.innerHTML = '<h1>Rações</h1><p class="mudo">Só o dono e o gerente cadastram as rações.</p>'; return; }
  el.innerHTML = '<h1>Rações</h1><p class="carregando">Carregando…</p>';
  const lista = await ctx.api.racoes();
  if (lista === null) { el.innerHTML = '<h1>Rações</h1><p class="aviso">O cadastro de rações ainda não foi ativado neste sistema (falta rodar o sql/39 no Supabase).</p>'; return; }
  const ativas = lista.filter((r) => r.ativa), paradas = lista.filter((r) => !r.ativa);
  let editando = null; // a ração aberta no formulário (null = nova)

  const linha = (r) => `<li class="rc-lin${r.ativa ? '' : ' parada'}">
      <span class="rc-cor" style="background:${corRacao(r.cor)}" aria-hidden="true"></span>
      <span class="esq"><b>${esc(r.nome)}</b><small>${r.ativa ? esc(ROTULO_FASE[r.fase] || '') : 'Desativada'}</small></span>
      <button type="button" class="btn mini" data-ed="${esc(r.id)}">${r.ativa ? 'Editar' : 'Reativar'}</button></li>`;

  el.innerHTML = `
    <h1>Rações</h1>
    <p class="sub-titulo">As rações que a fazenda compra. Em cada trato o tratador escolhe uma delas, e o estoque mostra quanto tem de cada.</p>
    ${!lista.length ? `<div class="card rc-vazio">
      <p><b>Nenhuma ração cadastrada.</b> Enquanto não houver, o app continua com o estoque de engorda e alevino.</p>
      <ol class="rc-passos"><li>Cadastre as rações que a fazenda usa.</li><li>Em Estoque de ração, conte os sacos de cada uma no galpão: essa contagem é o começo do estoque.</li><li>A partir daí, todo trato pede a ração.</li></ol>
      <button type="button" class="btn primario" id="b-sug">Começar com as rações da tabela de alimentação</button>
      <small class="mudo">Dá para mudar os nomes e apagar as que não usa depois.</small>
    </div>` : ''}
    ${ativas.length ? `<div class="card"><ul class="lista rc-lista">${ativas.map(linha).join('')}</ul></div>` : ''}
    <div class="card rc-form" id="rc-form">
      <h2 class="passo-t" id="rc-titulo">Nova ração</h2>
      <form id="f-racao" class="form" novalidate>
        <label>Nome <input id="rc-nome" maxlength="60" autocomplete="off" placeholder="Ex.: 28% · 6/10 mm" required></label>
        <small class="mudo">Use o que está escrito no saco: proteína e tamanho do grão. Pode pôr a marca, fica só na sua fazenda.</small>
        <fieldset class="rc-fs"><legend>Fase</legend><div class="seg" style="--n:3" role="radiogroup">${FASES.map(([k, t]) => `<button type="button" role="radio" data-fase="${k}">${t}</button>`).join('')}</div></fieldset>
        <fieldset class="rc-fs"><legend>Cor</legend><div class="rc-cores" role="radiogroup">${CORES_RACOES.map((c, i) => `<button type="button" role="radio" class="rc-cor-bt" data-cor="${i}" style="background:${c}" aria-label="Cor ${i + 1}"></button>`).join('')}</div></fieldset>
        <p id="rc-erro" class="erro" hidden></p>
        <button class="btn primario grande" type="submit" id="rc-salvar">Cadastrar ração</button>
        <div class="par-btns" id="rc-mais" hidden>
          <button type="button" class="btn" id="rc-cancelar">Cancelar</button>
          <button type="button" class="btn perigo" id="rc-desativar">Desativar</button>
        </div>
      </form>
    </div>
    ${paradas.length ? `<h2>Desativadas</h2><div class="card"><ul class="lista rc-lista">${paradas.map(linha).join('')}</ul></div>` : ''}`;

  const f = el.querySelector('#f-racao'), erro = f.querySelector('#rc-erro'), nome = f.querySelector('#rc-nome');
  let fase = 'engorda', cor = 0;
  const pinta = () => {
    f.querySelectorAll('[data-fase]').forEach((b) => { const on = b.dataset.fase === fase; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    f.querySelectorAll('[data-cor]').forEach((b) => { const on = Number(b.dataset.cor) === cor; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  };
  const abrir = (r) => {
    editando = r; erro.hidden = true;
    nome.value = r ? r.nome : ''; fase = r ? r.fase : 'engorda';
    cor = r ? Number(r.cor) || 0 : (lista.length % CORES_RACOES.length);
    el.querySelector('#rc-titulo').textContent = r ? 'Editar ração' : 'Nova ração';
    f.querySelector('#rc-salvar').textContent = r ? 'Salvar alterações' : 'Cadastrar ração';
    f.querySelector('#rc-mais').hidden = !r;
    pinta();
  };
  abrir(null);
  f.querySelectorAll('[data-fase]').forEach((b) => b.addEventListener('click', () => { fase = b.dataset.fase; pinta(); }));
  f.querySelectorAll('[data-cor]').forEach((b) => b.addEventListener('click', () => { cor = Number(b.dataset.cor); pinta(); }));
  f.querySelector('#rc-cancelar').addEventListener('click', () => abrir(null));

  const salvar = async (r) => {
    if (!navigator.onLine) throw new Error('Sem internet. O cadastro de rações precisa de conexão.');
    await ctx.api.salvarRacao({ ...r, fazenda_id: ctx.state.perfil.fazenda_id });
  };
  const repetido = (n, id) => lista.some((x) => x.id !== id && x.nome.trim().toLowerCase() === n.trim().toLowerCase());

  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); erro.hidden = true;
    const n = nome.value.trim();
    const falha = (m) => { erro.textContent = m; erro.hidden = false; };
    if (!n) return falha('Escreva o nome da ração. Ex.: 28% · 6/10 mm');
    if (repetido(n, editando && editando.id)) return falha('Já existe uma ração com esse nome.');
    const btn = f.querySelector('#rc-salvar'); btn.disabled = true;
    try {
      await salvar({ id: editando && editando.id, nome: n, fase, cor, ativa: true });
      ctx.toast(editando ? 'Ração alterada' : 'Ração cadastrada', 'ok');
      renderRacoes(ctx, el);
    } catch (e) { falha(e.message); btn.disabled = false; }
  });

  f.querySelector('#rc-desativar').addEventListener('click', async () => {
    if (!editando) return;
    if (!(await confirmar({ titulo: `Desativar ${editando.nome}?`, texto: 'Ela sai da escolha do trato e do estoque. Os tratos e compras antigos continuam guardados. Dá para reativar depois.', ok: 'Desativar', perigo: true }))) return;
    try { await salvar({ ...editando, ativa: false }); ctx.toast('Ração desativada', 'ok'); renderRacoes(ctx, el); }
    catch (e) { ctx.toast(e.message, 'erro'); }
  });

  el.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', async () => {
    const r = lista.find((x) => x.id === b.dataset.ed); if (!r) return;
    if (!r.ativa) {
      try { await salvar({ ...r, ativa: true }); ctx.toast('Ração reativada', 'ok'); renderRacoes(ctx, el); }
      catch (e) { ctx.toast(e.message, 'erro'); }
      return;
    }
    abrir(r);
    el.querySelector('#rc-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    nome.focus({ preventScroll: true });
  }));

  const bs = el.querySelector('#b-sug');
  if (bs) bs.addEventListener('click', async () => {
    const sug = sugestoes();
    if (!(await confirmar({ titulo: `Cadastrar ${sug.length} rações?`, texto: sug.map((s) => s.nome).join(' · '), ok: 'Cadastrar' }))) return;
    bs.disabled = true;
    try {
      for (const s of sug) await salvar({ ...s, ativa: true });
      ctx.toast('Rações cadastradas', 'ok');
      renderRacoes(ctx, el);
    } catch (e) { ctx.toast(e.message, 'erro'); bs.disabled = false; }
  });
}

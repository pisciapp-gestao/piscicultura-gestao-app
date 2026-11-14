// Ponto de entrada: sessão, perfil, roteamento, sincronização offline.
import { SUPABASE_URL, SUPABASE_ANON_KEY, TIMEOUT_REDE_MS, TIMEOUT_LEITURA_MS, LIMITE_ABERTURA_MS, JANELA_SEM_REDE_MS, TERMOS_VERSAO } from './config.js';
import { iniciarSeg } from './seg.js';
import { DEV_LOGIN, loginAutomaticoAtivo } from './dev-login.js';
import { esc, parseHash, ROTULO_PAPEL, traduzErro, ehErroDeRede, plural, ligarMascaraMoeda } from './util.js';
import { criarApi } from './api.js';
import * as db from './db.js';
import { sincronizar } from './sync.js';
import { icone } from './icons.js';
import { confirmar } from './dialogo.js';
import { splashDoDia } from './splash.js';
import { renderLogin } from './views/login.js';
import { renderCadastro, renderCriarFazenda, renderRecuperar, renderNovaSenha, renderAceitarConvite, renderAceiteTermos } from './views/cadastro.js';
import { renderHome, renderTanqueDetalhe } from './views/home.js';
import { renderLancar } from './views/lancar.js';
import { renderTanques, renderTanque } from './views/tanques.js';
import { renderEstoque } from './views/estoque.js';
import { renderRelatorios, renderRelatorioLote, renderRacaoDia } from './views/relatorio.js';
import { renderEquipe } from './views/equipe.js';
import { renderPlano } from './views/plano.js';
import { renderHistorico } from './views/historico.js';
import { renderAdmin } from './views/admin.js';
import { renderPendencias } from './views/pendencias.js';
import { renderMais } from './views/mais.js';
import { renderRonda } from './views/ronda.js';
import { renderMeus } from './views/meus.js';
import { renderPedidos } from './views/pedidos.js';
import { renderLucro, renderDespesas } from './views/lucro.js';
import { htmlAtalhos, atualizarLateral, marcarAtalho, pintarAtalhos } from './lateral.js';
import { registrarRota, linhaVoltar, ehAbaPrincipal } from './voltar.js';
import { olhoNasSenhas } from './senha.js';

const root = document.getElementById('root');
splashDoDia();
// iOS ignora user-scalable=no: bloqueia o zoom por gesto de pinça e o toque duplo
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
let ultimoToque = 0;
document.addEventListener('touchend', (e) => {
  const t = Date.now();
  if (t - ultimoToque < 350 && !(e.target.closest && e.target.closest('input, select, textarea'))) e.preventDefault();
  ultimoToque = t;
}, { passive: false });
const state = { user: null, perfil: null, ref: { tanques: [], lotes: [] }, pendentes: 0, semRede: false, convite: null };
let client = null;
let api = null;
let saindo = false;
let rotaAtual = '';
let tokenRota = 0;
let timerToast;

// ---------- utilidades de tela ----------
function toast(msg, tipo = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = '';
  if (tipo === 'ok') { // visto que se desenha: confirma o salvamento sem enfeite
    const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('class', 'toast-visto'); sv.setAttribute('aria-hidden', 'true');
    const pa = document.createElementNS('http://www.w3.org/2000/svg', 'path'); pa.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5'); sv.appendChild(pa); t.appendChild(sv);
  }
  t.appendChild(document.createTextNode(msg));
  t.className = `on ${tipo}`;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.className = ''; }, 3200);
}

function atualizarPill() {
  const off = !navigator.onLine || state.semRede;
  const n = state.pendentes;
  for (const pill of [document.getElementById('pill'), document.getElementById('pill-lateral')]) {
    if (!pill) continue;
    if (off) { pill.textContent = n ? `Sem internet · ${plural(n, 'pendente', 'pendentes')}` : 'Sem internet'; pill.className = 'pill off'; }
    else if (n) { pill.textContent = `${plural(n, 'pendente', 'pendentes')}`; pill.className = 'pill off'; }
    else { pill.textContent = 'Online'; pill.className = 'pill'; }
  }
}

async function atualizarPendentes() {
  const fila = await db.filaList();
  state.pendentes = state.perfil ? fila.filter((i) => i.registrado_por === state.perfil.id).length : fila.length;
  atualizarPill();
}

// ---------- dados de referência (tanques e lotes ativos) guardados para uso offline ----------
async function carregarRefLocal() {
  const ref = await db.kvGet('ref');
  // a cópia guardada é da pessoa E da fazenda (o administrador em suporte troca de fazenda com o mesmo usuário)
  state.ref = ref && state.perfil && ref.userId === state.perfil.id && (!ref.fazendaId || ref.fazendaId === state.perfil.fazenda_id) ? ref : { tanques: [], lotes: [] };
}

async function atualizarRef() {
  if (!navigator.onLine || !state.user || !api) return false;
  try {
    const [tanques, lotes, kgSaco, logo, precoKg] = await Promise.all([api.tanques(), api.lotes({ apenasAtivos: true }), api.kgSaco().catch(() => null), api.logo().catch(() => undefined), api.precoKg().catch(() => null)]);
    state.ref = { tanques, lotes, kgSaco: kgSaco || (state.ref && state.ref.kgSaco) || null, logo: logo === undefined ? (state.ref && state.ref.logo) || null : logo, precoKg, userId: state.perfil.id, fazendaId: state.perfil.fazenda_id, atualizado_em: new Date().toISOString() };
    await db.kvSet('ref', state.ref);
    atualizarMarca();
    state.semRede = false;
    atualizarPill();
    return true;
  } catch (e) {
    if (ehErroDeRede(e && e.original)) state.semRede = true;
    atualizarPill();
    return false;
  }
}

// topo: sempre a marca do sistema (o logo da fazenda aparece só nos relatórios em PDF)
function atualizarMarca() {
  document.querySelectorAll('.logo-sm').forEach((el) => { el.className = 'logo-sm'; el.innerHTML = icone('peixe', 26); });
}

// ---------- sincronização ----------
async function sincronizarAgora() {
  if (!client || !state.user || !state.perfil) return null;
  if (!navigator.onLine) return { semRede: true, enviados: 0, falhas: 0 };
  if (Date.now() < redeMortaAte && !(await testarRede())) return { semRede: true, enviados: 0, falhas: 0 };
  const r = await sincronizar(client, state.perfil.id);
  if (r.ocupado) return r;
  state.semRede = !!r.semRede;
  await atualizarPendentes();
  // a tela de Pendentes mostrava "Sem internet" e os itens já enviados até sair dela: redesenha
  if (rotaAtual === 'pendencias' && (r.enviados || r.falhas || !r.semRede)) rotear();
  if (r.sessaoExpirada) { mostrarLogin('Sua sessão expirou. Entre novamente para enviar os lançamentos pendentes.'); return r; }
  if (r.enviados) {
    toast(`${plural(r.enviados, 'lançamento enviado', 'lançamentos enviados')}`, 'ok');
    atualizarRef().then(() => { if (rotaAtual === '') rotear(); });
  }
  if (r.falhas) toast(`${plural(r.falhas, 'lançamento', 'lançamentos')} com erro — veja em Pendentes`, 'erro');
  return r;
}

// ---------- contexto passado às telas ----------
const ctx = {
  state,
  api: null,
  podeGerir: () => !!state.perfil && (state.perfil.papel === 'dono' || state.perfil.papel === 'gerente'),
  // valores em R$ (preço da ração, custo, preço do peixe): só o dono (decisão de 10/11/2026)
  verDinheiro: () => !!state.perfil && state.perfil.papel === 'dono',
  emSuporte: () => !!(state.perfil && state.perfil.suporte),
  entrarSuporte,
  sairSuporte,
  toast,
  atualizarRef,
  recarregarTopo: atualizarMarca,
  atualizarPendentes,
  sincronizarAgora,
  entrar,
  sair,
  cadastrar,
  criarFazenda,
  aceitarConvite,
  descartarConvite,
  aceitarTermos,
  mostrarLogin: () => mostrarLogin(),
  mostrarCadastro,
  mostrarRecuperar,
  pedirRecuperacao,
  definirNovaSenha,
};

// ---------- login / sessão ----------
// Aparelho desconectado (celular perdido: o dono ou o suporte tirou a conta deste aparelho) ou sessão encerrada:
// apaga a cópia dos números da fazenda e a sessão guardada, e volta para a tela de entrar.
async function aparelhoDesconectado(aviso = 'Este aparelho foi desconectado da conta (pelo dono da fazenda ou pelo suporte). Entre de novo com seu e-mail e senha.') {
  for (const k of ['perfil', 'ref', 'resumo', 'racao14', 'agua14', 'admin']) { try { await db.kvDel(k); } catch { /* ignora */ } }
  try { Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignora */ }
  state.user = null; state.perfil = null; state.ref = { tanques: [], lotes: [] };
  mostrarLogin(aviso);
}

function mostrarLogin(aviso) {
  state.user = null;
  if (!aviso && state.convite) aviso = 'Você recebeu um convite para entrar numa fazenda. Se já tem conta, entre. Se não tem, toque em "Criar minha conta" abaixo.';
  atualizarPendentes();
  renderLogin(ctx, root, aviso);
}

function mostrarMensagem(titulo, texto, comSair = true) {
  root.innerHTML = `<main class="login"><div class="login-card"><div class="logo">${icone('peixe', 44)}</div><h1>${esc(titulo)}</h1>
    <p class="aviso">${esc(texto)}</p>${comSair ? '<button class="btn grande" id="b-sair" type="button">Sair</button>' : ''}</div></main>`;
  const b = root.querySelector('#b-sair');
  if (b) b.addEventListener('click', () => sair(true));
}

function mostrarCadastro() { renderCadastro(ctx, root); }
function mostrarRecuperar() { renderRecuperar(ctx, root); }

async function pedirRecuperacao(email) {
  if (!navigator.onLine) throw new Error('Sem internet. Conecte-se para continuar.');
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw new Error(traduzErro(error));
}

async function definirNovaSenha(senha) {
  const { data, error } = await client.auth.updateUser({ password: senha });
  if (error) throw new Error(traduzErro(error));
  history.replaceState(null, '', location.pathname + '#/');
  await abrirApp(data.user);
}

// O link do e-mail (confirmar conta ou recuperar senha) volta ao app com os dados na parte "#..." do endereço.
async function tratarLinkDeEmail() {
  const h = location.hash || '';
  if (!/(access_token|error_code|error=)/.test(h) || h.startsWith('#/')) return false;
  const q = new URLSearchParams(h.slice(1));
  history.replaceState(null, '', location.pathname + '#/');
  if (q.get('error') || q.get('error_code')) {
    mostrarLogin(/expired|otp_expired/i.test(`${q.get('error_code')} ${q.get('error_description')}`) ? 'O link do e-mail expirou ou já foi usado. Peça um novo.' : 'Não foi possível validar o link do e-mail.');
    return true;
  }
  if (!q.get('access_token') || !q.get('refresh_token')) return false;
  try {
    const { data, error } = await client.auth.setSession({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token') });
    if (error || !data.session) throw error || new Error('sessão inválida');
    if (q.get('type') === 'recovery') { renderNovaSenha(ctx, root); return true; }
    await abrirApp(data.session.user);
    return true;
  } catch { mostrarLogin('O link do e-mail expirou ou já foi usado. Peça um novo.'); return true; }
}

async function cadastrar(email, senha) {
  if (!navigator.onLine) throw new Error('Sem internet. Conecte-se para criar a conta.');
  // com convite pendente, o link de confirmação do e-mail volta trazendo o convite (serve até se abrir em outro navegador)
  const opcoes = state.convite ? { emailRedirectTo: `${location.origin}${location.pathname}?convite=${encodeURIComponent(state.convite)}` } : {};
  // aceite dos termos fica registrado na própria conta (versão e data), junto com o cadastro
  if (TERMOS_VERSAO) opcoes.data = { termos_versao: TERMOS_VERSAO, termos_aceito_em: new Date().toISOString() };
  const { data, error } = await client.auth.signUp({ email, password: senha, options: opcoes });
  if (error) throw new Error(traduzErro(error));
  // e-mail já cadastrado: o Supabase não avisa (evita descobrir quem tem conta) e devolve usuário sem identidades
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('Este e-mail já tem conta. Toque em "Já tenho conta" e entre.');
  if (!data.session) return 'confirmar';
  await abrirApp(data.session.user);
  return 'entrou';
}

async function criarFazenda(fazenda, nome, user, documento) {
  await api.criarFazenda(fazenda, nome, documento);
  await abrirApp(user);
  // o mesmo CPF/CNPJ já usou o teste grátis em outra fazenda (sql/31): a fazenda nasce sem teste
  try {
    const p = await api.plano();
    if (p && p.estado === 'teste_acabou') toast('Este CPF/CNPJ já usou o teste grátis. Para abrir lotes nesta fazenda, escolha um pacote em Fazenda > Meu plano.', 'erro');
  } catch { /* sem plano: nada a avisar */ }
}

// ---------- convite por link (sql/10) ----------
// O link é .../#/convite/<token>. Guarda o token no aparelho para sobreviver ao cadastro e à confirmação do e-mail.
function capturarConvite() {
  const m = /^#\/convite\/([A-Za-z0-9]{16,128})/.exec(location.hash || '');
  const daBusca = new URLSearchParams(location.search).get('convite');
  const token = (m && m[1]) || (daBusca && /^[A-Za-z0-9]{16,128}$/.test(daBusca) ? daBusca : null);
  if (m) history.replaceState(null, '', location.pathname + '#/');
  else if (daBusca) history.replaceState(null, '', location.pathname + location.hash); // mantém o #access_token da confirmação
  if (token) { try { localStorage.setItem('convite', token); } catch { /* sem armazenamento: vale só nesta aba */ } }
  let guardado = token;
  if (!guardado) { try { guardado = localStorage.getItem('convite'); } catch { /* ignora */ } }
  state.convite = guardado || null;
}

function descartarConvite() {
  state.convite = null;
  try { localStorage.removeItem('convite'); } catch { /* ignora */ }
}

async function aceitarConvite(token, nome, user) {
  await api.aceitarConvite(token, nome);
  descartarConvite();
  await abrirApp(user);
  toast('Você entrou na fazenda. O dono vai liberar os tanques que você vai usar.', 'ok');
}

async function aceitarTermos() {
  const { data, error } = await client.auth.updateUser({ data: { termos_versao: TERMOS_VERSAO, termos_aceito_em: new Date().toISOString() } });
  if (error) throw new Error(traduzErro(error));
  await abrirApp(data.user);
}

async function entrar(email, senha) {
  try { sessionStorage.removeItem('sem-auto-login'); } catch { /* ignora */ }
  if (!navigator.onLine) throw new Error('Sem internet. Conecte-se para entrar.');
  const { data, error } = await client.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(traduzErro(error));
  await abrirApp(data.session.user);
}

// sinal morto: o celular diz que tem internet, mas a resposta não chega. Com dados guardados, não fica esperando.
const comLimite = (promessa, ms) => Promise.race([promessa, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout de rede')), ms))]);

async function abrirApp(user) {
  state.user = user;
  ctx.api = api;
  let perfil = null;
  let daRede = false;
  const guardado = await db.kvGet('perfil');
  const temGuardado = !!(guardado && guardado.id === user.id);
  if (guardado && !temGuardado) { await db.kvDel('resumo'); await db.kvDel('racao14'); await db.kvDel('agua14'); } // outra conta neste aparelho
  try {
    perfil = await (temGuardado ? comLimite(api.perfil(user.id), LIMITE_ABERTURA_MS) : api.perfil(user.id));
    daRede = true;
    if (perfil) await db.kvSet('perfil', perfil);
  } catch (e) {
    const cache = guardado;
    if (temGuardado) { perfil = cache; state.semRede = true; redeMortaAte = Date.now() + JANELA_SEM_REDE_MS; } // sem rede: usa o perfil guardado
    else { mostrarMensagem('Não foi possível carregar seu perfil', e.message || 'Tente novamente.'); return; }
  }
  // termos novos: quem ainda não aceitou esta versão aceita antes de entrar (só com internet, para não travar o campo)
  if (TERMOS_VERSAO && daRede && (user.user_metadata || {}).termos_versao !== TERMOS_VERSAO) { state.user = user; renderAceiteTermos(ctx, root, user); return; }
  // sem acesso (tirado da fazenda, desativado ou fazenda suspensa): apaga do aparelho a cópia dos números da fazenda.
  // Sem isso, quem perdeu o acesso ainda via os dados guardados ao abrir o app sem internet.
  const apagarCopias = async () => { for (const k of ['perfil', 'ref', 'resumo', 'racao14', 'agua14', 'admin']) await db.kvDel(k); };
  if (!perfil) { if (daRede && guardado) await apagarCopias(); if (state.convite) renderAceitarConvite(ctx, root, user, state.convite); else renderCriarFazenda(ctx, root, user); return; }
  if (state.convite) { // conta já está numa fazenda: o convite não serve para ela
    descartarConvite();
    setTimeout(() => toast('Convite não usado: esta conta já faz parte de uma fazenda.', 'erro'), 600);
  }
  if (perfil.ativo === false) { if (daRede) await apagarCopias(); mostrarMensagem('Acesso desativado', 'Seu acesso a esta fazenda foi desativado. Fale com o dono.'); return; }
  // suporte do administrador (sql/34): em suporte o banco mostra a fazenda do cliente, e a própria some (fica parecendo
  // "bloqueada"). Antes dessa conferência, pergunta se há suporte aberto e abre a fazenda do cliente como dono.
  if (daRede && perfil.fazenda_id && !perfil.fazendas) {
    const sup = await api.meuSuporte().catch(() => null);
    if (sup && sup.fazenda_id) {
      perfil = { ...perfil, fazenda_id: sup.fazenda_id, papel: 'dono', fazendas: { nome: sup.nome }, suporte: { nome: sup.nome, expira: sup.expira } };
      await db.kvSet('perfil', perfil);
    }
  }
  // fazenda bloqueada pelo administrador (sql/15): o perfil vem, mas a fazenda não aparece
  if (daRede && perfil.fazenda_id && !perfil.fazendas) {
    // ou este aparelho foi desconectado (celular perdido, sql/24): o banco já não reconhece a sessão
    if (!(await api.sessaoAindaValida().catch(() => true))) return aparelhoDesconectado();
    await apagarCopias();
    mostrarMensagem('Acesso suspenso', 'O acesso desta fazenda ao sistema está suspenso. Os dados continuam guardados. Fale com o suporte para liberar.');
    return;
  }
  // administrador do sistema (sql/15): guardado no aparelho para o menu aparecer também sem internet
  const adminGuardado = async () => { const a = await db.kvGet('admin'); return !!(a && a.id === user.id && a.admin); };
  if (daRede) {
    try { state.admin = await comLimite(api.souAdmin(), LIMITE_ABERTURA_MS); await db.kvSet('admin', { id: user.id, admin: state.admin }); }
    catch { state.admin = await adminGuardado(); }
  } else state.admin = await adminGuardado();

  state.perfil = perfil;
  await carregarRefLocal();
  await atualizarPendentes();
  montarShell();
  if (!state.ref.tanques.length && navigator.onLine) await atualizarRef(); // primeiro acesso: precisa dos tanques antes de desenhar
  else atualizarRef().then((ok) => { if (ok && rotaAtual === '') rotear(); });
  rotear();
  sincronizarAgora();
}

// Sem sessão válida e sem internet: abre com o perfil guardado, só para lançar offline.
async function abrirOffline(perfil) {
  state.user = null;
  ctx.api = apiSemSessao(); // sem sessão, qualquer chamada ficaria presa tentando renovar o login
  state.perfil = perfil;
  await carregarRefLocal();
  await atualizarPendentes();
  montarShell();
  rotear();
}

async function restaurarSessao() {
  let session = null, semConexao = false;
  const perfilGuardado = await db.kvGet('perfil');
  try {
    // sessão vencida com sinal morto: renovar demoraria quase um minuto e acabava na tela de login
    const r = await (perfilGuardado ? comLimite(client.auth.getSession(), LIMITE_ABERTURA_MS) : client.auth.getSession());
    session = r.data.session;
    if (r.error && (r.error.name === 'AuthRetryableFetchError' || ehErroDeRede(r.error))) semConexao = true;
  } catch { semConexao = true; }
  if (session) return abrirApp(session.user);
  if (perfilGuardado && (!navigator.onLine || semConexao)) {
    state.semRede = semConexao;
    if (semConexao) redeMortaAte = Date.now() + JANELA_SEM_REDE_MS;
    return abrirOffline(perfilGuardado);
  }
  // só em teste (PRs do Vercel / localhost): entra sozinho, a menos que a pessoa tenha clicado em Sair
  let saiu = false; try { saiu = sessionStorage.getItem('sem-auto-login') === '1'; } catch { /* ignora */ }
  if (!saiu && navigator.onLine && loginAutomaticoAtivo()) {
    try { return await entrar(DEV_LOGIN.email, DEV_LOGIN.senha); } catch (e) { console.warn('login automático falhou:', e.message); }
  }
  mostrarLogin();
}

// Abriu sem sessão por falta de rede e o sinal voltou: recupera a sessão sem redesenhar a tela (não apaga o que está sendo digitado).
let retomando = false;
async function retomarSessao() {
  if (retomando || state.user || !state.perfil || !document.getElementById('view')) return;
  retomando = true;
  try {
    if (Date.now() < redeMortaAte && !(await testarRede())) return;
    const { data: { session }, error } = await comLimite(client.auth.getSession(), TIMEOUT_LEITURA_MS);
    if (session) {
      state.user = session.user;
      ctx.api = api;
      state.semRede = false;
      atualizarPill();
      await sincronizarAgora();
      await atualizarRef();
    } else if (!error) mostrarLogin('Sua sessão expirou. Entre novamente para enviar os lançamentos pendentes.');
  } catch { /* continua sem rede: tenta de novo depois */ } finally { retomando = false; }
}

async function sair(forcar = false) {
  await atualizarPendentes();
  if (!forcar && state.pendentes && !(await confirmar({ titulo: 'Há lançamentos sem enviar', texto: `${state.pendentes === 1 ? 'Um lançamento neste aparelho ainda não foi enviado.' : `${state.pendentes} lançamentos neste aparelho ainda não foram enviados.`} Eles continuam guardados e saem quando você entrar de novo. Sair mesmo assim?`, ok: 'Sair mesmo assim', cancelar: 'Ficar', perigo: true }))) return;
  saindo = true;
  try { sessionStorage.setItem('sem-auto-login', '1'); } catch { /* ignora */ }
  try { await client.auth.signOut(); } catch { /* ignora */ }
  // se estiver sem internet o signOut falha e a sessão local ficaria: limpa na mão
  try { Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignora */ }
  await db.kvDel('perfil');
  await db.kvDel('ref');
  await db.kvDel('resumo');
  await db.kvDel('racao14');
  await db.kvDel('agua14');
  state.user = null; state.perfil = null; state.ref = { tanques: [], lotes: [] };
  saindo = false;
  mostrarLogin();
}

// ---------- suporte do administrador (sql/34) ----------
// Trocar de fazenda: apaga as cópias da fazenda anterior e abre o app de novo (perfil, tanques e números da outra).
async function trocarDeFazenda() {
  for (const k of ['perfil', 'ref', 'resumo', 'racao14', 'agua14']) { try { await db.kvDel(k); } catch { /* ignora */ } }
  location.hash = '#/';
  location.reload();
}
async function semPendentesParaTrocar() {
  await atualizarPendentes();
  if (!state.pendentes) return true;
  toast('Há lançamentos sem enviar neste aparelho. Envie (ou descarte em Pendentes) antes de trocar de fazenda.', 'erro');
  return false;
}
async function entrarSuporte(fazendaId, motivo) {
  if (!(await semPendentesParaTrocar())) return false;
  await api.adminEntrarSuporte(fazendaId, motivo);
  await trocarDeFazenda();
  return true;
}
async function sairSuporte(venceu = false) {
  if (!venceu && !(await semPendentesParaTrocar())) return;
  try { await api.adminSairSuporte(); } catch (e) { if (!venceu) { toast(e.message, 'erro'); return; } }
  await trocarDeFazenda();
}
const suporteVenceu = () => { const s = state.perfil && state.perfil.suporte; return !!(s && s.expira && Date.now() > Date.parse(s.expira)); };
const horaCurta = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// ---------- estrutura e rotas ----------
// No celular: barra de cima + abas embaixo. No computador: a mesma navegação numa lateral (o CSS troca uma pela outra).
function montarShell() {
  const p = state.perfil;
  const fazenda = esc((p.fazendas && p.fazendas.nome) || 'Piscicultura');
  const papel = esc(ROTULO_PAPEL[p.papel] || p.papel);
  // menu: Hoje, Tanques, Relatórios e Fazenda (o lançar fica dentro de cada tanque e da ronda)
  const links = [['', '#/', 'inicio', 'Hoje'], ['tanques', '#/tanques', 'tanques', 'Tanques'], ['relatorio', '#/relatorio', 'relatorio', 'Relatórios'], ['mais', '#/mais', 'fazenda', 'Fazenda']];
  const sup = p.suporte;
  const faixa = sup ? `<div class="faixa-suporte" role="status"><span><b>Suporte</b> · ${esc(p.nome)} (administrador) · até ${horaCurta(sup.expira)}</span><button class="btn mini" type="button" data-sair-suporte>Sair do suporte</button></div>` : '';
  root.innerHTML = `
  <div class="app${sup ? ' em-suporte' : ''}">
    <header class="topo">
      <div class="marca"><span class="logo-sm"></span>
        <div><strong>${fazenda}</strong><small>${sup ? `Suporte · ${esc(p.nome)}` : `${esc(p.nome)} · ${papel}`}</small></div></div>
      <a id="pill" class="pill" href="#/pendencias"></a>
    </header>
    ${faixa ? `<div class="faixa-cel">${faixa}</div>` : ''}
    <aside class="lateral" aria-label="Navegação">
      <div class="marca"><span class="logo-sm"></span><div><strong>${fazenda}</strong><small>Piscicultura</small></div></div>
      ${faixa}
      <nav>${links.map(([aba, href, ic, txt]) => `<a data-aba="${aba}" href="${href}">${icone(ic, 19)}<span>${txt}</span></a>`).join('')}</nav>
      ${htmlAtalhos()}
      <div class="lateral-pe">
        <a id="pill-lateral" class="pill" href="#/pendencias"></a>
        <div class="perfil-linha"><span class="avatar">${esc((p.nome || '?').trim().charAt(0).toUpperCase())}</span><div><b>${esc(p.nome)}</b><small>${papel}</small></div></div>
      </div>
    </aside>
    <main id="view" class="view"></main>
    <nav class="abas" aria-label="Navegação">
      ${links.map(([aba, href, ic, txt]) => `<a data-aba="${aba}" href="${href}"><span>${icone(ic)}</span>${txt}</a>`).join('')}
    </nav>
  </div>`;
  atualizarPill();
  atualizarMarca();
  pintarAtalhos(ctx, parseHash(location.hash).rota);
  root.querySelectorAll('[data-sair-suporte]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmar({ titulo: 'Sair do suporte?', texto: `Você volta para a sua fazenda. O que fez na ${(p.fazendas && p.fazendas.nome) || 'fazenda do cliente'} fica no histórico dela.`, ok: 'Sair do suporte' })) sairSuporte();
  }));
}

function renderErro(el, e) {
  const rede = e && (/conex|internet/i.test(e.message || ''));
  el.innerHTML = `<div class="card vazio"><p>${esc((e && e.message) || 'Erro inesperado')}</p>
    ${rede ? '<p class="mudo">Esta tela precisa de internet.</p>' : ''}<button class="btn" id="b-retry" type="button">Tentar de novo</button></div>`;
  el.querySelector('#b-retry').addEventListener('click', async () => { if (Date.now() < redeMortaAte) await testarRede(); rotear(); });
}

async function rotear() {
  const view = document.getElementById('view');
  if (!view || !state.perfil) return;
  // suporte venceu (2 horas): o banco já devolveu o administrador para a fazenda dele; o app acompanha
  if (suporteVenceu() && navigator.onLine) { toast('O tempo do suporte acabou (2 horas). Voltando para a sua fazenda.', 'erro'); sairSuporte(true); return; }
  const { rota, partes, params } = parseHash(location.hash);
  rotaAtual = rota;
  // aba acesa: o tanque e o cadastro ficam em Tanques; ronda, lançar e meus lançamentos, em Hoje; o resto, em Fazenda
  const aba = ['t', 'tanque', 'tanques'].includes(rota) ? 'tanques' : ['', 'ronda', 'lancar', 'meus', 'pedidos'].includes(rota) ? '' : rota === 'relatorio' || rota === 'lucro' || rota === 'despesas' ? 'relatorio' : 'mais';
  document.querySelectorAll('.abas a, .lateral a[data-aba]').forEach((a) => {
    const on = a.dataset.aba === aba;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  marcarAtalho(rota === 'relatorio' && partes[0] === 'racao' ? 'relatorio-racao' : rota);
  registrarRota(location.hash, rota, partes);
  const el = document.createElement('div'); // contêiner novo por rota: renderizações atrasadas não sujam a tela atual
  view.replaceChildren(...(ehAbaPrincipal(rota, partes) ? [] : [linhaVoltar(rota)]), el);
  const meu = ++tokenRota;
  window.scrollTo(0, 0);
  try {
    switch (rota) {
      case 't': await renderTanqueDetalhe(ctx, el, partes[0]); break;
      case 'lancar': await renderLancar(ctx, el, params); break;
      case 'lucro': await renderLucro(ctx, el); break;
      case 'despesas': await renderDespesas(ctx, el); break;
      case 'relatorio': await (partes[0] === 'racao' ? renderRacaoDia(ctx, el) : partes[0] ? renderRelatorioLote(ctx, el, partes[0]) : renderRelatorios(ctx, el)); break;
      case 'tanques': await renderTanques(ctx, el); break;
      case 'tanque': await renderTanque(ctx, el, partes[0], params); break;
      case 'estoque': await renderEstoque(ctx, el); break;
      case 'equipe': await renderEquipe(ctx, el); break;
      case 'plano': await renderPlano(ctx, el); break;
      case 'historico': await renderHistorico(ctx, el); break;
      case 'admin': await renderAdmin(ctx, el); break;
      case 'pendencias': await renderPendencias(ctx, el); break;
      case 'ronda': await renderRonda(ctx, el); break;
      case 'meus': await renderMeus(ctx, el); break;
      case 'pedidos': await renderPedidos(ctx, el); break;
      case 'mais': case 'fazenda': renderMais(ctx, el); break;
      default: await renderHome(ctx, el);
    }
  } catch (e) {
    if (meu === tokenRota) renderErro(el, e);
  }
  atualizarLateral(ctx).catch(() => {}); // resumo do dia na lateral (computador)
}

// ---------- inicialização ----------
// Depois de uma falha de rede, as telas não esperam pela resposta. Um teste de sinal à parte, leve, reabre tudo quando responder.
let redeMortaAte = 0, testando = null;
// com o nome AbortError o cliente do banco não repete a chamada (repetiria 3 vezes e prenderia a tela por 7 s)
const semRedeErro = () => Object.assign(new Error('Failed to fetch (sem rede)'), { name: 'AbortError' });
function testarRede() {
  if (!navigator.onLine) return Promise.resolve(false);
  if (testando) return testando;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  testando = fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY }, signal: ctrl.signal, cache: 'no-store' }).then(
    () => { redeMortaAte = 0; state.semRede = false; atualizarPill(); return true; }, // qualquer resposta prova que há sinal
    () => { redeMortaAte = Date.now() + JANELA_SEM_REDE_MS; state.semRede = true; atualizarPill(); return false; },
  ).finally(() => { clearTimeout(timer); testando = null; });
  return testando;
}
function apiSemSessao() {
  const falha = () => Promise.reject(Object.assign(new Error('Sem conexão com a internet'), { original: { message: 'Failed to fetch' } }));
  return new Proxy(api, { get: (t, k) => (k === 'resumoGuardado' ? t[k] : k === 'resumoLotes' ? t.resumoGuardado : typeof t[k] === 'function' ? falha : t[k]) });
}
function criarCliente() {
  const LEITURA = /\/rest\/v1\/rpc\/(resumo_lotes|saldo_racao|consumo_diario|plano_atual|eh_admin|nomes_equipe|meu_suporte|acessos_suporte)|grant_type=refresh_token/;
  const fetchComTimeout = (url, opts = {}) => {
    if (Date.now() < redeMortaAte) return Promise.reject(semRedeErro());
    const ctrl = new AbortController();
    const leitura = (opts.method || 'GET') === 'GET' || LEITURA.test(String(url));
    const timer = setTimeout(() => ctrl.abort(), leitura ? TIMEOUT_LEITURA_MS : TIMEOUT_REDE_MS);
    if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort());
    return fetch(url, { ...opts, signal: ctrl.signal }).then(
      (r) => { redeMortaAte = 0; if (state.semRede) { state.semRede = false; atualizarPill(); } return r; },
      (e) => { redeMortaAte = Date.now() + JANELA_SEM_REDE_MS; state.semRede = true; atualizarPill(); throw semRedeErro(); },
    ).finally(() => clearTimeout(timer));
  };
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: fetchComTimeout },
  });
}

async function iniciar() {
  iniciarSeg();
  if (SUPABASE_ANON_KEY.startsWith('COLE_') || !window.supabase) {
    mostrarMensagem('Configuração pendente', 'A chave do Supabase ainda não foi configurada neste app (js/config.js).', false);
    return;
  }
  client = criarCliente();
  api = criarApi(client);
  ctx.api = api;

  client.auth.onAuthStateChange((evento) => {
    // a sessão acabou sem a pessoa tocar em Sair (venceu, ou o aparelho foi desconectado pelo dono/suporte):
    // apaga também a cópia dos números guardada no aparelho
    if (evento === 'SIGNED_OUT' && !saindo && state.user) aparelhoDesconectado('Este aparelho saiu da conta. Entre novamente com seu e-mail e senha.');
  });

  window.addEventListener('hashchange', rotear);
  window.addEventListener('offline', atualizarPill);
  window.addEventListener('online', async () => {
    state.semRede = false;
    redeMortaAte = 0;
    atualizarPill();
    if (!state.perfil) return;
    // estava em modo offline sem sessão (app aberto, sem tela de login): tenta recuperar a sessão
    if (!state.user) { await retomarSessao(); return; }
    await sincronizarAgora();
    await atualizarRef();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user && navigator.onLine) sincronizarAgora();
  });
  // rede pode voltar sem disparar o evento "online" (ex.: antena de satélite): tenta de tempos em tempos
  setInterval(async () => {
    if (!navigator.onLine) return;
    const estavaSemRede = state.semRede || Date.now() < redeMortaAte;
    if (estavaSemRede && !(await testarRede())) return;
    if (!state.user) { retomarSessao(); return; }
    if (state.pendentes) await sincronizarAgora();
    if (estavaSemRede) await atualizarRef();
  }, 20000);

  capturarConvite();
  if (await tratarLinkDeEmail()) return;
  await restaurarSessao();
}

olhoNasSenhas(document.body); // olho para mostrar/esconder a senha em todos os campos de senha
ligarMascaraMoeda(document.body); // campos de R$: números entram pela direita, como no caixa eletrônico
if ('serviceWorker' in navigator) {
  // Versão nova publicada com o app aberto: a cópia nova assume e o app avisa ("Atualizar"), sem recarregar
  // sozinho no meio de um lançamento. Ao voltar para o app, confere se saiu versão nova.
  const jaTinha = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (jaTinha) avisarVersaoNova(); });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {}); });
  }).catch(() => {}));
}
function avisarVersaoNova() {
  if (document.getElementById('versao-nova')) return;
  const d = document.createElement('div');
  d.id = 'versao-nova'; d.className = 'versao-nova'; d.setAttribute('role', 'status');
  d.innerHTML = '<span>Versão nova do app</span><button type="button" class="btn mini">Atualizar</button>';
  d.querySelector('button').addEventListener('click', () => location.reload());
  document.body.appendChild(d);
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

iniciar();

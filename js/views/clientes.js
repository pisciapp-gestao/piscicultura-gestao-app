// Fazendas dos clientes (pedido do Hugo, 25/11/2026): a tela do dia a dia do administrador do SISTEMA.
// Todas as fazendas numa lista com busca, os números de cada uma em tempo real (sql/42, atualiza a cada minuto)
// e "Entrar como suporte" em um toque. O painel completo (cobranças, pacotes, financeiro) continua em #/admin.
import { icone } from '../icons.js';
import { esc, fmtData, fmtBRL, fmtInt, fmtNum, plural, hojeISO } from '../util.js';
import { pedirEntrarSuporte, situacaoFazenda } from './admin.js';
import { pesoHoje, vivosDoLote } from '../calc.js';

const ATUALIZA_MS = 60000;
const KG_SACO = 25;
const diasAte = (iso) => Math.round((Date.parse(String(iso).slice(0, 10)) - Date.parse(hojeISO())) / 864e5);
const horaDe = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
function haQuanto(iso) {
  if (!iso) return 'nunca lançou nada';
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return min <= 1 ? 'lançou agora há pouco' : `último lançamento há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `último lançamento há ${plural(h, 'hora', 'horas')}`;
  return `último lançamento há ${plural(Math.round(h / 24), 'dia', 'dias')}`;
}
const kgOuT = (kg) => (kg >= 1000 ? `${fmtNum(kg / 1000, 1)} t` : `${fmtNum(kg, 0)} kg`);

// avisos de uma fazenda: [classe, texto]. Os vermelhos primeiro.
export function avisosCliente(f, a, cobranca) {
  const out = [];
  const p = f.plano || {};
  if (f.bloqueada) out.push(['erro', 'Bloqueada']);
  if (['vencido', 'carencia'].includes(p.estado)) out.push(['erro', 'Mensalidade vencida']);
  if (p.estado === 'teste_acabou') out.push(['erro', 'Teste acabou']);
  if (cobranca) out.push(['alerta', `Cobrança esperando: ${fmtBRL(cobranca.valor)}`]);
  if (p.estado === 'teste' && p.valido_ate && diasAte(p.valido_ate) >= 0 && diasAte(p.valido_ate) <= 3) out.push(['alerta', `Teste acaba em ${plural(diasAte(p.valido_ate), 'dia', 'dias')}`]);
  if (a) {
    if (a.oxigenio_mgl != null && Number(a.oxigenio_mgl) < 4 && a.oxigenio_em && diasAte(a.oxigenio_em) >= -1) out.push(['erro', `Oxigênio baixo: ${fmtNum(a.oxigenio_mgl, 1)} mg/L (${esc(a.oxigenio_tanque || '')})`]);
    const est = Number(a.estoque_kg), porDia = Number(a.racao_7d_kg) / 7;
    if (Number(a.lotes_ativos) > 0 && est < 0) out.push(['erro', 'Estoque de ração negativo (falta lançar compra)']);
    else if (porDia > 0 && est / porDia < 7) out.push(['alerta', `Ração para ${plural(Math.max(0, Math.floor(est / porDia)), 'dia', 'dias')}`]);
    if (a.racao_conferir) out.push(['alerta', `Ração lançada a mais em ${plural(a.racao_conferir, 'lote', 'lotes')} (conferir)`]);
    const parada = Number(a.lotes_ativos) > 0 && (!a.ultima_atividade || Date.now() - Date.parse(a.ultima_atividade) > 3 * 864e5);
    if (parada && !f.bloqueada) out.push(['alerta', a.ultima_atividade ? `Parada há ${plural(Math.floor((Date.now() - Date.parse(a.ultima_atividade)) / 864e5), 'dia', 'dias')}` : 'Nunca lançou']);
    if (Number(a.mortos_7d) > 0 && Number(a.peixes_vivos) > 0 && Number(a.mortos_7d) / (Number(a.peixes_vivos) + Number(a.mortos_7d)) >= 0.02) out.push(['alerta', `${fmtInt(a.mortos_7d)} mortes na semana`]);
  }
  return out.sort((x, y) => (x[0] === 'erro' ? 0 : 1) - (y[0] === 'erro' ? 0 : 1));
}

export async function renderClientes(ctx, el, estado = { busca: '' }) {
  if (!ctx.state.admin) {
    el.innerHTML = `<h1>Fazendas dos clientes</h1><div class="card vazio"><p>Esta tela é do administrador do sistema.</p>
      <p class="mudo">Você entrou como <b>${esc(ctx.state.perfil.nome || '')}</b>${ctx.state.email ? ` (${esc(ctx.state.email)})` : ''}, que não está cadastrado como administrador. Entre com a conta de administrador ou peça para cadastrar esta conta.</p></div>`;
    return;
  }
  el.innerHTML = '<h1>Fazendas dos clientes</h1><p class="carregando">Carregando…</p>';
  if (!navigator.onLine) { el.innerHTML = '<h1>Fazendas dos clientes</h1><div class="card vazio">Precisa de internet.</div>'; return; }
  const rota = location.hash;
  let fazendas = [], cobrancas = [], acomp = null, quando = null, placasLib = null;

  async function carregar() {
    const [fz, cb, ac, pl] = await Promise.all([ctx.api.adminFazendas(), ctx.api.adminCobrancas().catch(() => []), ctx.api.adminAcompanhamento(), ctx.api.adminPlacasLiberadas ? ctx.api.adminPlacasLiberadas().catch(() => null) : null]);
    placasLib = pl;
    fazendas = fz; cobrancas = (cb || []).filter((c) => c.status === 'pendente'); acomp = comBiomassaHoje(ac); quando = new Date();
  }
  // biomassa de HOJE de cada fazenda: mesma conta das telas do cliente (última biometria + ração dada depois dela)
  function comBiomassaHoje(lista) {
    const hoje = hojeISO();
    for (const a of lista || []) {
      if (!Array.isArray(a.lotes)) continue;
      let kg = 0, comPeso = 0, estimados = 0, conferir = 0;
      for (const l of a.lotes) {
        const ph = pesoHoje({ ...l, ativo: true }, l, hoje, { semEntrada: true });
        if (ph.impossivel) conferir++;
        if (ph.kg == null) continue;
        kg += vivosDoLote(l, l) * ph.kg; comPeso++; if (ph.estimado) estimados++;
      }
      a.biomassa_kg = comPeso ? kg : null; a.biomassa_estimada = estimados > 0; a.racao_conferir = conferir;
    }
    return lista;
  }
  const dados = (f) => (acomp ? acomp.find((a) => a.fazenda_id === f.id) : null);
  const emSuporte = ctx.emSuporte && ctx.emSuporte();
  const aqui = emSuporte ? ctx.state.perfil.fazenda_id : null;

  function cartao(f) {
    const a = dados(f), s = situacaoFazenda(f), p = f.plano || {};
    const cob = cobrancas.find((c) => c.fazenda_id === f.id);
    const av = avisosCliente(f, a, cob);
    const num = (rot, val, sub = '') => `<div class="cli-num"><span>${rot}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const o2 = a && a.oxigenio_mgl != null ? `${fmtNum(a.oxigenio_mgl, 1)}` : '—';
    return `<article class="card cli-card${f.id === aqui ? ' cli-aqui' : ''}" data-faz="${esc(f.id)}">
      <header class="cli-cab">
        <div class="esq"><h2>${esc(f.nome)}</h2><small>${esc(f.dono_nome || 'sem dono')}${f.dono_email ? ` · ${esc(f.dono_email)}` : ''}</small></div>
        <span class="cli-tags"><span class="tag ${s.classe}">${esc(s.rotulo)}${!f.bloqueada && p.valido_ate ? ` até ${fmtData(p.valido_ate)}` : ''}</span>${placasLib && placasLib.has(f.id) ? '<span class="tag ok">Placas QR</span>' : ''}</span>
      </header>
      ${av.length ? `<div class="cli-avisos">${av.map(([c, t]) => `<span class="cli-aviso ${c}">${t}</span>`).join('')}</div>` : ''}
      ${a ? `<div class="cli-nums">
        ${num('Peixes na água', fmtInt(a.peixes_vivos), plural(Number(a.lotes_ativos), 'lote ativo', 'lotes ativos'))}
        ${num('Biomassa hoje', a.biomassa_kg != null ? `${a.biomassa_estimada ? '≈ ' : ''}${kgOuT(Number(a.biomassa_kg))}` : '—', Number(a.lotes_sem_biometria) ? `${plural(Number(a.lotes_sem_biometria), 'lote', 'lotes')} sem biometria` : a.biomassa_estimada ? 'biometria + ração dada depois' : 'pela última biometria')}
        ${num('Ração hoje', `${fmtNum(Number(a.racao_hoje_kg) / KG_SACO, 1)} sc`, `semana: ${fmtNum(Number(a.racao_7d_kg) / 7 / KG_SACO, 1)} sc/dia`)}
        ${num('Estoque', `${fmtNum(Number(a.estoque_kg) / KG_SACO, 0)} sc`, `${fmtNum(Number(a.estoque_kg), 0)} kg`)}
        ${num('Mortes (7 dias)', fmtInt(a.mortos_7d))}
        ${num('Oxigênio', o2 === '—' ? '—' : `${o2} <em>mg/L</em>`, a.oxigenio_em ? `${fmtData(a.oxigenio_em)}${a.oxigenio_tanque ? ` · ${esc(a.oxigenio_tanque)}` : ''}` : 'sem medição')}
      </div>` : ''}
      <p class="cli-pe mudo">${a ? haQuanto(a.ultima_atividade) : esc(`última ração: ${f.ultimo_lancamento ? fmtData(f.ultimo_lancamento) : 'nunca'}`)} · ${plural(Number(f.tanques), 'tanque', 'tanques')} · ${plural(Number(f.pessoas), 'pessoa', 'pessoas')}</p>
      <div class="cli-acoes">
        ${f.id === aqui ? '<button class="btn" type="button" data-sair>Sair do suporte</button><span class="tag ok">Você está aqui</span>'
          : `<button class="btn primario" type="button" data-suporte="${esc(f.id)}">Entrar como suporte</button>`}
        <a class="btn" href="#/admin?f=${encodeURIComponent(f.id)}">Ficha e cobrança</a>
      </div>
    </article>`;
  }

  function ordenar(lista) {
    const peso = (f) => { const av = avisosCliente(f, dados(f), cobrancas.find((c) => c.fazenda_id === f.id)); return av.some((x) => x[0] === 'erro') ? 0 : av.length ? 1 : 2; };
    const ativ = (f) => { const a = dados(f); return a && a.ultima_atividade ? Date.parse(a.ultima_atividade) : 0; };
    return [...lista].sort((x, y) => peso(x) - peso(y) || ativ(y) - ativ(x) || String(x.nome).localeCompare(String(y.nome), 'pt-BR'));
  }
  function lista() {
    const t = estado.busca.trim().toLowerCase();
    const l = ordenar(fazendas.filter((f) => !t || [f.nome, f.dono_nome, f.dono_email].some((x) => String(x || '').toLowerCase().includes(t))));
    return l.length ? l.map(cartao).join('') : '<div class="card vazio">Nenhuma fazenda com esse nome.</div>';
  }
  function totais() {
    if (!acomp) return '';
    const s = (k) => acomp.reduce((t, a) => t + (Number(a[k]) || 0), 0);
    const comAviso = fazendas.filter((f) => avisosCliente(f, dados(f), cobrancas.find((c) => c.fazenda_id === f.id)).length).length;
    return `<div class="kpis cli-kpis">
      <div class="kpi"><span>Fazendas</span><b>${fmtInt(fazendas.length)}</b></div>
      <div class="kpi"><span>Peixes na água</span><b>${fmtInt(s('peixes_vivos'))}</b></div>
      <div class="kpi"><span>Biomassa</span><b>${kgOuT(s('biomassa_kg'))}</b></div>
      <div class="kpi"><span>Ração hoje</span><b>${fmtNum(s('racao_hoje_kg') / KG_SACO, 0)} sc</b></div>
      <div class="kpi${comAviso ? ' alerta' : ''}"><span>Precisam de atenção</span><b>${fmtInt(comAviso)}</b></div>
    </div>`;
  }
  function desenhar() {
    const foco = document.activeElement && document.activeElement.id === 'cli-busca';
    el.innerHTML = `<h1>Fazendas dos clientes</h1>
      <p class="mudo cli-atual">Atualiza sozinho a cada minuto · ${quando ? `atualizado às ${horaDe(quando)}` : ''} <button class="link" type="button" id="cli-recarregar">Atualizar agora</button></p>
      ${acomp ? '' : '<div class="aviso">Os números de cada fazenda (peixes, biomassa, ração, oxigênio) aparecem depois que o sql/42 for rodado no banco. A lista e o suporte já funcionam.</div>'}
      ${totais()}
      <label class="adm-busca cli-busca">Procurar <input id="cli-busca" type="search" placeholder="Fazenda, dono ou e-mail" value="${esc(estado.busca)}" autocomplete="off"></label>
      <div id="cli-lista" class="cli-lista">${lista()}</div>`;
    const b = el.querySelector('#cli-busca');
    b.addEventListener('input', () => { estado.busca = b.value; el.querySelector('#cli-lista').innerHTML = lista(); ligar(); });
    if (foco) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
    el.querySelector('#cli-recarregar').addEventListener('click', () => atualizar(true));
    ligar();
  }
  function ligar() {
    el.querySelectorAll('[data-suporte]').forEach((b) => { if (b.dataset.ligado) return; b.dataset.ligado = '1'; b.addEventListener('click', async () => {
      const f = fazendas.find((x) => x.id === b.dataset.suporte);
      b.disabled = true;
      try { if (!(await pedirEntrarSuporte(ctx, f))) b.disabled = false; } catch (e) { ctx.toast(e.message, 'erro'); b.disabled = false; }
    }); });
    el.querySelectorAll('[data-sair]').forEach((b) => { if (b.dataset.ligado) return; b.dataset.ligado = '1'; b.addEventListener('click', () => ctx.sairSuporte()); });
  }
  let timer = null;
  async function atualizar(avisar = false) {
    if (location.hash !== rota || !el.isConnected) { clearInterval(timer); return; }
    if (!navigator.onLine) return;
    try { await carregar(); if (location.hash === rota && el.isConnected) desenhar(); if (avisar) ctx.toast('Atualizado', 'ok'); }
    catch (e) { if (avisar) ctx.toast(e.message || 'Não foi possível atualizar', 'erro'); }
  }
  await carregar();
  desenhar();
  timer = setInterval(() => atualizar(false), ATUALIZA_MS);
}

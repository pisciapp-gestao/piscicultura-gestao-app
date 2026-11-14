// Cadastro de tanques e lotes (dono e gerente). Precisa de internet.
import { confirmar, ocupado, formulario } from '../dialogo.js';
import { icone } from '../icons.js';
import { ESPECIES } from '../config.js';
import { esc, fmtData, fmtInt, fmtNum, hojeISO, num, ROTULO_TIPO, FASES, areaHa, progresso, fmtPct, plural } from '../util.js';
import { lerPlanilha } from '../planilha.js';
import { vivosDoLote } from '../calc.js';
import * as db from '../db.js';
import { ordemNatural } from './home.js';


// 2,3 kg / 500 g; 5,5 ha
const pmTxt = (kg) => (kg >= 1 ? `${fmtNum(kg, kg % 1 ? 2 : 0)} kg` : `${fmtNum(kg * 1000, 0)} g`);
// tamanho do alevino (cm) -> peso aproximado (g). Peso = a x comprimento^3 (relação peso-comprimento de peixes jovens).
// Tambaqui e redondos: a = 0,025 (5 cm = 3 g); tilápia é mais fina: a = 0,017 (5 cm = 2 g). É estimativa: pese quando puder.
export const gramasPorCm = (cm, especie = '') => { const c = Number(cm); if (!(c > 0)) return null; const a = /til[aá]pia/i.test(especie) ? 0.017 : 0.025; return Math.round(a * c * c * c * 10) / 10; };
const UNIDADES_PESO = [['g', 'gramas'], ['kg', 'kg'], ['cm', 'tamanho em cm (estimar o peso)']];
// valor + unidade do formulário -> kg por peixe
const pesoKgDe = (valor, un, especie) => { const v = num(valor); if (!(v > 0)) return null; if (un === 'cm') { const g = gramasPorCm(v, especie); return g ? g / 1000 : null; } return un === 'g' ? v / 1000 : v; };
const haTxt = (ha) => `${fmtNum(ha, Number(ha) % 1 ? 2 : 0).replace(/(,\d)0$/, '$1')} ha`;
// Nome com limite de letras: o campo para de aceitar no limite. Mostra quantas faltam perto do fim,
// para a pessoa não achar que o nome foi cortado sem motivo.
function contarLetras(input) {
  if (!input || !input.maxLength || input.maxLength < 1) return;
  const aviso = document.createElement('small'); aviso.className = 'conta-letras'; input.after(aviso);
  const atualiza = () => {
    const n = input.value.length, max = input.maxLength;
    aviso.hidden = n < max - 15;
    aviso.textContent = n >= max ? `${n} de ${max} letras: o nome não cabe mais` : `${n} de ${max} letras`;
    aviso.classList.toggle('no-limite', n >= max);
  };
  input.addEventListener('input', atualiza); atualiza();
}

const semPermissao = (el) => { el.innerHTML = '<div class="card vazio">Você não tem permissão para esta tela.</div>'; };
const avisoOffline = () => (navigator.onLine ? '' : '<p class="aviso">Sem internet: cadastros de tanques e lotes só funcionam com conexão.</p>');

export async function renderTanques(ctx, el) {
  const gerir = ctx.podeGerir();
  const { tanques, lotes } = ctx.state.ref;
  // peixes vivos (entrada − mortos − despescados), igual à Início; sem o resumo, mostra a entrada
  const resumo = Object.fromEntries((((await db.kvGet('resumo').catch(() => null)) || [])).map((r) => [r.lote_id, r]));

  const comPeixe = tanques.filter((t) => lotes.some((l) => l.tanque_id === t.id)).length;
  el.innerHTML = `
    <h1>Tanques</h1>
    <p class="sub-titulo">${gerir ? `${plural(tanques.length, 'tanque', 'tanques')} · ${fmtInt(comPeixe)} com peixes` : 'Os tanques liberados para você'}</p>
    ${gerir ? avisoOffline() : ''}
    <div class="card">
      ${tanques.length ? `<ul class="lista lista-grade">${[...tanques].sort(ordemNatural).map((t) => {
        const ls = lotes.filter((l) => l.tanque_id === t.id);
        const peixes = ls.reduce((a, l) => a + (resumo[l.id] ? vivosDoLote(l, resumo[l.id]) : Number(l.quantidade_inicial) || 0), 0);
        const sub = ls.length > 1 ? `${ls.length} lotes ativos · ${fmtInt(peixes)} peixes` : ls.length ? `${ROTULO_TIPO[ls[0].tipo] || ls[0].tipo} · ${fmtInt(peixes)} peixes` : 'sem lote ativo';
        return `<li><a class="esq" href="#/t/${esc(t.id)}"><b>${esc(t.nome)}</b><small>${esc(sub)}${t.area_ha ? ` · ${haTxt(t.area_ha)}` : ''}</small></a><span class="seta">${icone('direita', 20)}</span></li>`;
      }).join('')}</ul>` : (ctx.state.perfil.papel === 'dono' ? '<p class="mudo" style="margin:0">Nenhum tanque cadastrado ainda.</p>' : gerir ? '<p class="aviso" style="margin:0">Nenhum tanque liberado para você. Se a fazenda já tem tanques, peça ao dono para liberar em Fazenda › Equipe, em vez de cadastrar de novo.</p>' : '<p class="aviso" style="margin:0">Nenhum tanque liberado para você ainda. Peça ao dono ou ao gerente.</p>')}
    </div>
    ${gerir ? `<div class="pc-duas">
    <details class="card form-dobra" id="d-novo-tanque">
      <summary>Novo tanque</summary>
    <form id="f-novo" class="form" novalidate>
      <div class="duas">
        <label>Nome do tanque <input id="nome" maxlength="60" placeholder="Ex.: Tanque 1" required></label>
        <label>Área (hectares) <small class="mudo">opcional</small><input id="area" type="text" inputmode="decimal" placeholder="Ex.: 5,5"></label>
      </div>
      <p id="erro" class="erro" hidden></p>
      <button class="btn primario" type="submit">Cadastrar tanque</button>
    </form>
    </details>
    <details class="card form-dobra" id="d-planilha">
      <summary>Cadastrar vários tanques de uma vez (colar planilha)</summary>
      <div class="form">
        <p class="mudo" style="margin-top:0">Copie as linhas do Excel (ou escreva uma por linha) nesta ordem: <b>Tanque · Área (ha) · Fase · Peixes · Peso médio · Data de povoamento</b>. Pode separar por tabulação ou ponto e vírgula. Peso em kg ou com "g" (ex.: 500 g). Tanque sem peixes entra só como tanque.</p>
        <textarea id="planilha" rows="7" aria-label="Linhas da planilha ou mensagem do WhatsApp com os tanques" placeholder="Tanque 1;5,5;Engorda;12000;2,3;10/06/2026&#10;Tanque 6;8,5;Recria;98000;500 g;15/08/2026&#10;Tanque 8;2,3"></textarea>
        <div id="previa"></div>
        <p id="erro-pl" class="erro" hidden></p>
        <button class="btn primario" id="b-importar" type="button" hidden>Cadastrar</button>
      </div>
    </details>
    </div>` : ''}`;
  if (!gerir) return; // funcionário: só a lista dos tanques dele

  const f = el.querySelector('#f-novo');
  contarLetras(f && f.querySelector('#nome'));
  const erro = f.querySelector('#erro');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const nome = f.querySelector('#nome').value.trim();
    const areaTxt = f.querySelector('#area').value.trim(), area = areaHa(areaTxt);
    if (!nome) { erro.textContent = 'Informe o nome do tanque.'; erro.hidden = false; return; }
    if (areaTxt && !area) { erro.textContent = 'Área inválida. Use hectares, ex.: 5,5'; erro.hidden = false; return; }
    if (tanques.some((t) => t.nome.toLowerCase() === nome.toLowerCase())) { erro.textContent = 'Já existe um tanque com esse nome.'; erro.hidden = false; return; }
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      const novoId = await ctx.api.criarTanque(ctx.state.perfil.fazenda_id, nome, area);
      await ctx.atualizarRef();
      ctx.toast('Tanque cadastrado. Agora informe o povoamento.', 'ok');
      if (novoId) { location.hash = `#/tanque/${novoId}`; return; } // tanque novo abre já no formulário de povoamento
      renderTanques(ctx, el);
    } catch (e) {
      erro.textContent = e.message; erro.hidden = false; btn.disabled = false;
    }
  });

  // ---- vários tanques de uma vez (colar planilha) ----
  const ta = el.querySelector('#planilha'), previa = el.querySelector('#previa'), bImp = el.querySelector('#b-importar'), erroPl = el.querySelector('#erro-pl');
  let linhas = [];
  const mostrar = () => {
    erroPl.hidden = true;
    linhas = lerPlanilha(ta.value, tanques, lotes);
    const validas = linhas.filter((l) => !l.erro);
    previa.innerHTML = linhas.length ? `<div class="rolagem"><table class="previa-pl">
      <thead><tr><th>Tanque</th><th class="n">Área</th><th>Fase</th><th class="n">Peixes</th><th class="n">Peso médio</th><th>Início</th><th class="n">Peso total</th></tr></thead>
      <tbody>${linhas.map((l) => l.erro ? `<tr class="pl-erro"><td colspan="7"><b>Linha ${l.n}:</b> ${esc(l.erro)}</td></tr>`
        : `<tr><td>${esc(l.nome)}${l.existe ? ' <small class="mudo">(já existe)</small>' : ''}</td><td class="n">${l.area ? haTxt(l.area).replace(' ha', '') : '—'}</td><td>${l.tipo ? esc(ROTULO_TIPO[l.tipo]) : '—'}</td>
           <td class="n">${l.qtd ? fmtInt(l.qtd) : '—'}</td><td class="n">${l.pm ? (l.pm < 1 ? fmtNum(l.pm * 1000, 0) + ' g' : fmtNum(l.pm, 2) + ' kg') : '—'}</td>
           <td>${l.data ? fmtData(l.data) : '—'}</td><td class="n">${l.qtd ? fmtNum(l.qtd * l.pm, 0) + ' kg' : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="mudo">${plural(validas.length, 'linha pronta', 'linhas prontas')}${linhas.length - validas.length ? `, ${linhas.length - validas.length} com problema (corrija ou apague)` : ''}.</p>` : '';
    bImp.hidden = !validas.length;
    bImp.textContent = `Cadastrar ${plural(validas.length, 'linha', 'linhas')}`;
  };
  ta.addEventListener('input', mostrar);
  bImp.addEventListener('click', async () => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    const validas = linhas.filter((l) => !l.erro);
    if (linhas.length !== validas.length && !(await confirmar({ titulo: 'Há linhas com problema', texto: 'Só as linhas certas serão cadastradas. Continuar?', ok: 'Continuar' }))) return;
    const livre = ocupado('Cadastrando…');
    let feitos = 0;
    try {
      for (const l of validas) {
        const tq = l.existe || { id: await ctx.api.criarTanque(ctx.state.perfil.fazenda_id, l.nome, l.area).catch((e) => (/sql\/17/.test(e.message) ? ctx.api.criarTanque(ctx.state.perfil.fazenda_id, l.area ? `${l.nome} · ${haTxt(l.area)}` : l.nome) : Promise.reject(e))) };
        if (l.existe && l.area && !l.existe.area_ha) await ctx.api.renomearTanque(tq.id, l.existe.nome, l.area);
        if (l.qtd) {
          const loteId = await ctx.api.criarLote({ tanque_id: tq.id, tipo: l.tipo, especie: l.especie, data_entrada: l.data, quantidade_inicial: l.qtd, peso_inicial_kg: Math.round(l.qtd * l.pm * 100) / 100 });
          if (l.pmHoje) await ctx.api.biometriaInicial(loteId, l.pmHoje, ctx.state.perfil.id, hojeISO());
        }
        feitos++;
      }
      await ctx.atualizarRef(true);
      ctx.toast(`${plural(feitos, 'linha cadastrada', 'linhas cadastradas')}`, 'ok');
      renderTanques(ctx, el);
    } catch (e) {
      erroPl.textContent = `Parou na linha ${validas[feitos]?.n}: ${e.message}${feitos ? ` (as ${feitos} anteriores foram cadastradas)` : ''}`; erroPl.hidden = false;
      await ctx.atualizarRef(true).catch(() => {});
    } finally { livre(); }
  });
}

export async function renderTanque(ctx, el, id, params = {}) {
  if (!ctx.podeGerir()) return semPermissao(el);
  const tanque = ctx.state.ref.tanques.find((t) => t.id === id);
  if (!tanque) { el.innerHTML = '<div class="card vazio">Tanque não encontrado.<br></div>'; return; }

  el.innerHTML = `<h1>${esc(tanque.nome)}</h1><p class="carregando">Carregando…</p>`;
  const [lotesTodos, resumoRows] = await Promise.all([ctx.api.lotes(), ctx.api.resumoLotes().catch(() => [])]);
  const todos = lotesTodos.filter((l) => l.tanque_id === id);
  const povs = await ctx.api.povoamentos(todos.map((l) => l.id)).catch(() => []);
  const extrasDe = (lid) => povs.filter((p) => p.lote_id === lid);
  // 1º povoamento = total do lote menos os povoamentos extras (o banco soma os extras no lote)
  const primeiro = (l) => { const ex = extrasDe(l.id); const q = Number(l.quantidade_inicial) - ex.reduce((a, p) => a + Number(p.quantidade), 0); const kg = Number(l.peso_inicial_kg) - ex.reduce((a, p) => a + Number(p.peso_total_kg), 0); return { q, kg, pm: q > 0 ? kg / q : 0 }; };
  const ativos = todos.filter((l) => l.ativo);
  // peixe na água agora (mesma estimativa da tela Início: vivos × último peso médio)
  const resumo = Object.fromEntries((resumoRows || []).map((r) => [r.lote_id, r]));
  let vivos = 0, biomassa = 0, iniciais = 0;
  for (const l of ativos) {
    iniciais += Number(l.quantidade_inicial) || 0;
    const r = resumo[l.id];
    const v = vivosDoLote(l, r);
    const pm = r && r.ultimo_peso_medio_kg != null ? Number(r.ultimo_peso_medio_kg) : Number(l.peso_inicial_kg) / Math.max(1, Number(l.quantidade_inicial));
    vivos += v; biomassa += v * (pm || 0);
  }
  const area = Number(tanque.area_ha) || 0;
  const temArea = 'area_ha' in tanque; // banco com o sql/17
  const dono = ctx.state.perfil.papel === 'dono';
  const hoje = hojeISO();
  // veio do tanque vazio na Início ("Que fase vai entrar?"): fase já escolhida e formulário em foco
  const doInicio = FASES.some(([v]) => v === params.fase);
  const faseIni = doInicio ? params.fase : 'engorda';

  el.innerHTML = `
    <h1>${esc(tanque.nome)}</h1>
    ${avisoOffline()}
    ${ativos.length || area ? `<div class="kpis tq-resumo">
      <div class="kpi"><span>Peixes vivos</span><b>${fmtInt(vivos)}</b>${iniciais > 0 ? `${progresso((vivos / iniciais) * 100, { tom: 'ok', fina: true, rotulo: `Sobrevivência ${fmtPct((vivos / iniciais) * 100)}%` })}<small>${fmtPct((vivos / iniciais) * 100)}% dos ${fmtInt(iniciais)} que entraram</small>` : ''}</div>
      <div class="kpi"><span>Peixe na água</span><b>${biomassa >= 1000 ? fmtNum(biomassa / 1000, 1) + ' t' : fmtNum(biomassa, 0) + ' kg'}</b></div>
      ${area ? `<div class="kpi"><span>Área</span><b>${haTxt(area)}</b></div>
      <div class="kpi"><span>Densidade</span><b>${fmtInt(vivos / area)} peixes/ha</b><small>${fmtNum(biomassa / 1000 / area, 1)} t/ha</small></div>` : ''}
    </div>` : ''}

    <div class="pc-duas"><div>
    <h2>Lotes</h2>
    <div class="card">
      ${todos.length ? `<ul class="lista">${todos.map((l) => `
        <li class="item-dobra"><details class="lote-dobra" data-lote="${esc(l.id)}"${params.aberto === l.id ? ' open' : ''}>
          <summary><span class="esq"><b>${esc(ROTULO_TIPO[l.tipo] || l.tipo)} · ${esc(l.especie)}</b>
            <small>${extrasDe(l.id).length ? `povoado em ${extrasDe(l.id).length + 1} datas, de ${fmtData(l.data_entrada)} a ${fmtData(extrasDe(l.id).slice(-1)[0].data)}` : `povoado em ${fmtData(l.data_entrada)}`} · ${fmtInt(l.quantidade_inicial)} peixes · ${pmTxt(Number(l.peso_inicial_kg) / Math.max(1, Number(l.quantidade_inicial)))} cada na entrada (${fmtNum(l.peso_inicial_kg, 0)} kg)</small></span>
            <span class="tag ${l.ativo ? 'ok' : ''}">${l.ativo ? 'Ativo' : 'Encerrado'}</span></summary>
          <div class="povoamentos">
            <p class="pov-tit">Povoamentos</p>
            <ul class="lista pov-lista">
              <li><div class="esq"><b>${fmtData(l.data_entrada)} · ${fmtInt(primeiro(l).q)} peixes</b><small>1º povoamento · ${pmTxt(primeiro(l).pm)} cada (${fmtNum(primeiro(l).kg, primeiro(l).kg < 100 ? 1 : 0)} kg)</small></div>
                <button class="btn mini" data-editar-lote="${esc(l.id)}" type="button">Corrigir</button></li>
              ${extrasDe(l.id).map((p) => `<li><div class="esq"><b>${fmtData(p.data)} · +${fmtInt(p.quantidade)} peixes</b><small>${pmTxt(Number(p.peso_total_kg) / Math.max(1, Number(p.quantidade)))} cada (${fmtNum(p.peso_total_kg, Number(p.peso_total_kg) < 100 ? 1 : 0)} kg)</small></div>
                <span class="pov-bts"><button class="btn mini" data-editar-pov="${esc(p.id)}" type="button">Corrigir</button><button class="btn mini perigo" data-excluir-pov="${esc(p.id)}" type="button">Excluir</button></span></li>`).join('')}
            </ul>
            ${l.ativo ? `<button class="btn mini primario" data-add-pov="${esc(l.id)}" type="button">+ Adicionar peixes (povoamento em outra data)</button>` : ''}
          </div>
          <div class="acoes">
            <a class="btn mini" href="#/relatorio/${esc(l.id)}">Relatório</a>
            <button class="btn mini" data-editar-lote="${esc(l.id)}" type="button">Editar</button>
            ${l.ativo ? `<button class="btn mini perigo" data-encerrar="${esc(l.id)}" type="button">Encerrar</button>` : `<button class="btn mini" data-reabrir="${esc(l.id)}" type="button">Reabrir</button>`}
          </div>
        </details></li>`).join('')}</ul>` : '<p class="mudo" style="margin:0">Nenhum lote neste tanque ainda.</p>'}
    </div>

    </div><div>
    <details class="card form-dobra" id="d-lote"${doInicio || !todos.length ? ' open' : ''}>
      <summary>${doInicio ? `Povoar com ${esc(ROTULO_TIPO[faseIni])}` : 'Novo lote de peixes'}</summary>
    <form id="f-lote" class="form" novalidate>
      <div class="duas">
        <label>Fase
          <select id="tipo">${FASES.map(([v, r]) => `<option value="${v}"${v === faseIni ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
        <label>Espécie
          <select id="especie">${ESPECIES.map((e) => `<option value="${esc(e)}">${esc(e)}</option>`).join('')}<option value="__outra">Outra…</option></select></label>
      </div>
      <label id="especie-outra-wrap" hidden>Qual espécie? <input id="especie-outra" maxlength="60" placeholder="Digite o nome do peixe"></label>
      <label class="linha-check"><input type="checkbox" id="andamento"> Os peixes já estão no tanque (lote em andamento)</label>
      <label><span id="rot-data">Data de povoamento</span> <input id="data" type="date" value="${hoje}" max="${hoje}" required></label>
      <p class="mudo pequeno" style="margin-top:-.3rem">O dia em que os peixes entraram no tanque, mesmo que tenha sido antes de usar o app. Entrou peixe em outro dia? Cadastre o primeiro e depois toque em "+ Adicionar peixes" no lote.</p>
      <label>Quantidade de peixes <input id="qtd" type="number" inputmode="numeric" step="1" min="1" required></label>
      <div class="duas">
        <label><span id="rot-pm">Peso médio de cada peixe</span> <input id="pm-in" type="text" inputmode="decimal" placeholder="Ex.: 2,3" required></label>
        <label>Unidade <select id="pm-un"><option value="kg">kg</option><option value="g">gramas</option><option value="cm">tamanho em cm</option></select></label>
      </div>
      <p class="calc" id="cm-est" hidden></p>
      <div class="duas" id="hoje-wrap" hidden>
        <label>Peso médio de hoje <input id="pmh-in" type="text" inputmode="decimal" placeholder="Ex.: 2,3"></label>
        <label>Unidade <select id="pmh-un"><option value="kg">kg</option><option value="g">gramas</option></select></label>
      </div>
      <p class="mudo pequeno" id="ajuda-andamento" hidden>O peso de hoje vira a primeira pesagem (biometria) do lote, para a curva de crescimento começar certa. Se não souber o peso na entrada, use uma estimativa.</p>
      <div class="calc" id="pm">Peso total do povoamento: —</div>
      <p id="erro" class="erro" hidden></p>
      <button class="btn primario" type="submit">Cadastrar lote</button>
    </form>
    </details>

    <details class="card form-dobra" id="d-nome">
      <summary>Nome${temArea ? ' e área' : ''} do tanque</summary>
    <form id="f-nome" class="form" novalidate>
      <div class="duas">
        <label>Nome <input id="nome" maxlength="60" value="${esc(tanque.nome)}"></label>
        ${temArea ? `<label>Área (hectares) <input id="area" type="text" inputmode="decimal" value="${tanque.area_ha != null ? esc(String(tanque.area_ha).replace('.', ',')) : ''}" placeholder="Ex.: 5,5"></label>` : ''}
      </div>
      <p id="erro-nome" class="erro" hidden></p>
      <button class="btn" type="submit">Salvar</button>
    </form>
    </details>
    </div></div>
    ${dono ? `<details class="avancado">
      <summary>Opções avançadas</summary>
      <div class="card">
        <p style="margin-top:0"><b>Excluir um lote</b><br><span class="mudo">Apaga o lote e tudo o que foi lançado nele. Use se o lote foi cadastrado errado.</span></p>
        ${todos.length ? `<ul class="lista">${todos.map((l) => `<li><div class="esq"><b>${esc(ROTULO_TIPO[l.tipo] || l.tipo)} · ${esc(l.especie)}</b><small>desde ${fmtData(l.data_entrada)} · ${l.ativo ? 'ativo' : 'encerrado'}</small></div>
          <button class="btn mini perigo" data-excluir-lote="${esc(l.id)}" type="button">Excluir</button></li>`).join('')}</ul>` : '<p class="mudo">Nenhum lote.</p>'}
        <hr>
        <p><b>Apagar o tanque inteiro</b><br><span class="mudo">Apaga o tanque, os lotes e todos os lançamentos dele. Serve para zerar e recomeçar.</span></p>
        <button class="btn perigo" id="b-apagar-tanque" type="button">Apagar este tanque</button>
      </div>
    </details>` : ''}`;

  // peso médio por peixe → peso total do lote (o banco guarda o total)
  const f = el.querySelector('#f-lote');
  if (doInicio) {
    requestAnimationFrame(() => el.querySelector('#d-lote').scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
  const especieForm = () => (f.querySelector('#especie').value === '__outra' ? f.querySelector('#especie-outra').value : f.querySelector('#especie').value);
  const pmKg = (inp, un) => pesoKgDe(f.querySelector(inp).value, f.querySelector(un).value, especieForm());
  const atualizaPm = () => {
    const q = num(f.querySelector('#qtd').value), pm = pmKg('#pm-in', '#pm-un');
    const cm = f.querySelector('#pm-un').value === 'cm', est = f.querySelector('#cm-est');
    est.hidden = !cm;
    if (cm) est.textContent = pm ? `${fmtNum(num(f.querySelector('#pm-in').value), 1)} cm ≈ ${fmtNum(pm * 1000, 1)} g por peixe (estimativa para ${especieForm() || 'peixe'}). Pese uma amostra quando puder.` : 'Digite o tamanho do peixe em cm (ex.: 5). O app estima o peso: 5 cm ≈ 3 g no tambaqui.';
    f.querySelector('#pm').textContent = q > 0 && pm ? `Peso total do povoamento: ${fmtNum(q * pm, q * pm < 100 ? 1 : 0)} kg (${fmtInt(q)} × ${pmTxt(pm)})` : 'Peso total do povoamento: —';
  };
  // alevino e berçário se pesam em gramas no campo; recria e engorda em kg (recria chega a 1,5 kg). A unidade acompanha a fase
  // escolhida (a pessoa ainda pode trocar). Só muda o que ela não mexeu.
  const unidadeDaFase = () => {
    const g = ['alevinagem', 'bercario'].includes(f.querySelector('#tipo').value);
    for (const [inp, un] of [['#pm-in', '#pm-un'], ['#pmh-in', '#pmh-un']]) {
      const sel = f.querySelector(un);
      if (sel.dataset.mexeu) continue;
      sel.value = g ? 'g' : 'kg';
      f.querySelector(inp).placeholder = g ? 'Ex.: 2' : 'Ex.: 2,3';
    }
    atualizaPm();
  };
  f.querySelectorAll('#pm-un, #pmh-un').forEach((s) => s.addEventListener('change', () => { s.dataset.mexeu = '1'; }));
  f.querySelector('#tipo').addEventListener('change', unidadeDaFase);
  unidadeDaFase();
  f.addEventListener('input', atualizaPm); f.addEventListener('change', atualizaPm);
  const andamento = f.querySelector('#andamento');
  andamento.addEventListener('change', () => {
    const on = andamento.checked;
    f.querySelector('#hoje-wrap').hidden = !on; f.querySelector('#ajuda-andamento').hidden = !on;
    f.querySelector('#rot-data').textContent = 'Data de povoamento';
    f.querySelector('#rot-pm').textContent = on ? 'Peso médio na entrada' : 'Peso médio de cada peixe';
  });

  f.querySelector('#especie').addEventListener('change', (e) => { const o = e.target.value === '__outra'; f.querySelector('#especie-outra-wrap').hidden = !o; if (o) f.querySelector('#especie-outra').focus(); });

  const erro = f.querySelector('#erro');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const especie = f.querySelector('#especie').value === '__outra' ? f.querySelector('#especie-outra').value.trim() : f.querySelector('#especie').value;
    const qtd = num(f.querySelector('#qtd').value), pm = pmKg('#pm-in', '#pm-un'), pmHoje = andamento.checked ? pmKg('#pmh-in', '#pmh-un') : null;
    const peso = qtd > 0 && pm ? Math.round(qtd * pm * 100) / 100 : 0;
    const falha = (m) => { erro.textContent = m; erro.hidden = false; };
    if (!especie) return falha('Informe a espécie.');
    if (!f.querySelector('#data').value) return falha('Informe a data de povoamento.');
    if (!(qtd >= 1) || !Number.isInteger(qtd)) return falha('Informe a quantidade de peixes (número inteiro).');
    if (!pm) return falha('Informe o peso médio de cada peixe.');
    if (pm > 30) return falha('Peso médio acima de 30 kg por peixe. Confira se não digitou o peso total ou se a unidade é gramas.');
    if (andamento.checked && !pmHoje) return falha('Informe o peso médio de hoje (ou desmarque "lote em andamento").');
    if (!(peso > 0)) return falha('Peso total do lote inválido.');
    if (ativos.length && !(await confirmar({ titulo: ativos.length === 1 ? 'Este tanque já tem um lote ativo' : `Este tanque já tem ${ativos.length} lotes ativos`, texto: 'Se o lote anterior terminou, encerre-o antes de cadastrar o novo. Quer cadastrar outro lote mesmo assim?', ok: 'Cadastrar mesmo assim', cancelar: 'Voltar' }))) return;
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const loteId = await ctx.api.criarLote({ tanque_id: id, tipo: f.querySelector('#tipo').value, especie, data_entrada: f.querySelector('#data').value, quantidade_inicial: qtd, peso_inicial_kg: peso });
      if (pmHoje) await ctx.api.biometriaInicial(loteId, pmHoje, ctx.state.perfil.id, hoje);
      await ctx.atualizarRef();
      ctx.toast('Lote cadastrado', 'ok');
      if (doInicio) { location.hash = `#/t/${id}`; return; } // volta para a tela do tanque, já com o lote e os botões de lançar
      renderTanque(ctx, el, id);
    } catch (e) { falha(e.message); btn.disabled = false; }
  });

  el.querySelectorAll('[data-encerrar]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmar({ titulo: 'Encerrar este lote?', texto: 'Ele deixa de aparecer nos lançamentos. O histórico e o relatório continuam disponíveis.', ok: 'Encerrar lote' }))) return;
      try {
        await ctx.api.encerrarLote(b.dataset.encerrar);
        await ctx.atualizarRef();
        ctx.toast('Lote encerrado', 'ok');
        renderTanque(ctx, el, id);
      } catch (e) { ctx.toast(e.message, 'erro'); }
    }));

  el.querySelectorAll('[data-editar-lote]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
      const l = todos.find((x) => x.id === b.dataset.editarLote); if (!l) return;
      const ex = extrasDe(l.id), p1 = primeiro(l), exQ = ex.reduce((a, p) => a + Number(p.quantidade), 0), exKg = ex.reduce((a, p) => a + Number(p.peso_total_kg), 0);
      const v = await formulario({
        titulo: ex.length ? 'Corrigir lote e 1º povoamento' : 'Corrigir dados do lote', texto: `Os relatórios do lote serão recalculados com os dados novos.${ex.length ? ` Os outros ${plural(ex.length, 'povoamento', 'povoamentos')} (${fmtInt(exQ)} peixes) continuam somados.` : ''}`,
        campos: [
          { nome: 'tipo', rotulo: 'Fase', tipo: 'select', valor: l.tipo, opcoes: FASES },
          { nome: 'especie', rotulo: 'Espécie', tipo: 'text', valor: l.especie, maxlength: '60' },
          { nome: 'data', rotulo: ex.length ? 'Data do 1º povoamento' : 'Data de povoamento', tipo: 'date', valor: l.data_entrada, max: ex.length ? ex[0].data : hoje },
          { nome: 'qtd', rotulo: ex.length ? 'Peixes no 1º povoamento' : 'Quantidade de peixes', tipo: 'number', valor: p1.q, step: '1', min: '1', inputmode: 'numeric' },
          { nome: 'pm', rotulo: 'Peso médio de cada peixe na entrada', tipo: 'text', valor: String(p1.pm < 1 ? Math.round(p1.pm * 10000) / 10 : Math.round(p1.pm * 1000) / 1000).replace('.', ','), inputmode: 'decimal' },
          { nome: 'un', rotulo: 'Unidade do peso', tipo: 'select', valor: p1.pm < 1 ? 'g' : 'kg', opcoes: UNIDADES_PESO },
        ],
        validar: (x) => { const pm = pesoKgDe(x.pm, x.un, x.especie); return !x.especie.trim() ? 'Informe a espécie.' : !x.data ? 'Informe a data de povoamento.' : x.data > hoje ? 'A data não pode ser no futuro.'
          : ex.length && x.data > ex[0].data ? `A data do 1º povoamento não pode ser depois de ${fmtData(ex[0].data)} (outro povoamento do lote).`
          : !(Number.isInteger(num(x.qtd)) && num(x.qtd) >= 1) ? 'Informe a quantidade de peixes (número inteiro).' : !pm ? 'Informe o peso médio de cada peixe.' : pm > 30 ? 'Peso médio acima de 30 kg: confira a unidade (é por peixe).' : null; },
      });
      if (!v) return;
      try {
        const pm = pesoKgDe(v.pm, v.un, v.especie);
        await ctx.api.atualizar('lotes', l.id, { tipo: v.tipo, especie: v.especie.trim(), data_entrada: v.data, quantidade_inicial: num(v.qtd) + exQ, peso_inicial_kg: Math.round((num(v.qtd) * pm + exKg) * 100) / 100 });
        await ctx.atualizarRef();
        ctx.toast('Lote corrigido', 'ok');
        renderTanque(ctx, el, id, { aberto: l.id });
      } catch (e) { ctx.toast(e.message, 'erro'); }
    }));

  // ---- povoamento em outra data (sql/36): soma peixes no mesmo lote ----
  const formPov = async (l, p) => {
    const pmIni = p ? Number(p.peso_total_kg) / Math.max(1, Number(p.quantidade)) : null;
    const g = p ? pmIni < 1 : ['alevinagem', 'bercario'].includes(l.tipo);
    return formulario({
      titulo: p ? 'Corrigir povoamento' : `Adicionar peixes · ${ROTULO_TIPO[l.tipo] || l.tipo}`,
      texto: p ? 'O total de peixes do lote é recalculado.' : `Peixes que entraram neste lote em outra data. Eles somam aos ${fmtInt(l.quantidade_inicial)} que já estão no lote (povoado em ${fmtData(l.data_entrada)}).`,
      campos: [
        { nome: 'data', rotulo: 'Data deste povoamento', tipo: 'date', valor: p ? p.data : hoje, min: l.data_entrada, max: hoje },
        { nome: 'qtd', rotulo: 'Quantos peixes entraram', tipo: 'number', valor: p ? p.quantidade : '', step: '1', min: '1', inputmode: 'numeric' },
        { nome: 'pm', rotulo: 'Peso médio (ou tamanho) de cada peixe', tipo: 'text', valor: p ? String(g ? Math.round(pmIni * 10000) / 10 : Math.round(pmIni * 1000) / 1000).replace('.', ',') : '', inputmode: 'decimal', ajuda: `Comprou por tamanho? Escolha "cm" na unidade: 5 cm ≈ ${fmtNum(gramasPorCm(5, l.especie), 1)} g (estimativa para ${l.especie}).` },
        { nome: 'un', rotulo: 'Unidade', tipo: 'select', valor: g ? 'g' : 'kg', opcoes: UNIDADES_PESO },
      ],
      validar: (x) => { const pm = pesoKgDe(x.pm, x.un, l.especie); return !x.data ? 'Informe a data do povoamento.' : x.data > hoje ? 'A data não pode ser no futuro.' : x.data < l.data_entrada ? `A data não pode ser antes do 1º povoamento (${fmtData(l.data_entrada)}).`
        : !(Number.isInteger(num(x.qtd)) && num(x.qtd) >= 1) ? 'Informe quantos peixes entraram (número inteiro).' : !pm ? 'Informe o peso médio ou o tamanho de cada peixe.' : pm > 30 ? 'Peso médio acima de 30 kg: confira a unidade (é por peixe).' : null; },
    });
  };
  const camposPov = (v, l) => { const pm = pesoKgDe(v.pm, v.un, l.especie); return { data: v.data, quantidade: num(v.qtd), peso_total_kg: Math.round(num(v.qtd) * pm * 1000) / 1000 }; };
  el.querySelectorAll('[data-add-pov]').forEach((b) => b.addEventListener('click', async () => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    const l = todos.find((x) => x.id === b.dataset.addPov); if (!l) return;
    const v = await formPov(l, null); if (!v) return;
    const c = camposPov(v, l);
    try {
      await ctx.api.adicionarPovoamento({ lote_id: l.id, ...c }, ctx.state.perfil.id);
      await ctx.atualizarRef(true);
      ctx.toast(`+${fmtInt(c.quantidade)} peixes no lote`, 'ok');
      renderTanque(ctx, el, id, { aberto: l.id });
    } catch (e) { ctx.toast(e.message, 'erro'); }
  }));
  el.querySelectorAll('[data-editar-pov]').forEach((b) => b.addEventListener('click', async () => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    const p = povs.find((x) => x.id === b.dataset.editarPov); const l = p && todos.find((x) => x.id === p.lote_id); if (!l) return;
    const v = await formPov(l, p); if (!v) return;
    try {
      await ctx.api.corrigirPovoamento(p.id, camposPov(v, l));
      await ctx.atualizarRef(true);
      ctx.toast('Povoamento corrigido', 'ok');
      renderTanque(ctx, el, id, { aberto: l.id });
    } catch (e) { ctx.toast(e.message, 'erro'); }
  }));
  el.querySelectorAll('[data-excluir-pov]').forEach((b) => b.addEventListener('click', async () => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    const p = povs.find((x) => x.id === b.dataset.excluirPov); if (!p) return;
    if (!(await confirmar({ titulo: 'Excluir este povoamento?', texto: `Os ${fmtInt(p.quantidade)} peixes de ${fmtData(p.data)} saem do total do lote.`, ok: 'Excluir', perigo: true }))) return;
    try {
      await ctx.api.excluirPovoamento(p.id);
      await ctx.atualizarRef(true);
      ctx.toast('Povoamento excluído', 'ok');
      renderTanque(ctx, el, id, { aberto: p.lote_id });
    } catch (e) { ctx.toast(e.message, 'erro'); }
  }));

  el.querySelectorAll('[data-reabrir]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
      const texto = ativos.length ? `Este tanque já tem ${ativos.length === 1 ? 'um lote ativo' : `${ativos.length} lotes ativos`}. Os dois vão aparecer nos lançamentos.` : 'Ele volta a aparecer nos lançamentos.';
      if (!(await confirmar({ titulo: 'Reabrir este lote?', texto, ok: 'Reabrir lote' }))) return;
      try {
        await ctx.api.reabrirLote(b.dataset.reabrir);
        await ctx.atualizarRef();
        ctx.toast('Lote reaberto', 'ok');
        renderTanque(ctx, el, id);
      } catch (e) { ctx.toast(e.message, 'erro'); }
    }));

  // resumo do que será apagado (para o dono saber o que perde)
  async function resumoDe(lotesIds) {
    const r = { bios: 0, mort: 0, racN: 0, racKg: 0 };
    for (const lid of lotesIds) {
      const d = await ctx.api.dadosLote(lid);
      r.bios += d.bios.length; r.mort += d.mort.length; r.racN += d.rac.length; r.racKg += d.rac.reduce((s, x) => s + Number(x.quantidade_kg || 0), 0);
    }
    return r;
  }
  const txtResumo = (r) => `${plural(r.bios, 'biometria', 'biometrias')}, ${plural(r.mort, 'registro', 'registros')} de mortalidade e ${plural(r.racN, 'lançamento', 'lançamentos')} de ração (${fmtNum(r.racKg, 0)} kg). A ração apagada volta para o saldo do estoque.`;

  el.querySelectorAll('[data-excluir-lote]').forEach((b) => b.addEventListener('click', async () => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    try {
      const lote = todos.find((l) => l.id === b.dataset.excluirLote);
      const livre0 = ocupado('Conferindo o que será apagado…');
      let r, lixo; try { [r, lixo] = await Promise.all([resumoDe([lote.id]), ctx.api.temLixeira()]); } finally { livre0(); }
      if (!(await confirmar({ titulo: 'Excluir este lote?', texto: `Será apagado com ${txtResumo(r)} ${lixo ? 'Fica na lixeira por 180 dias: dá para restaurar em Fazenda > Histórico e lixeira.' : 'Não dá para desfazer.'}`, ok: 'Excluir lote', perigo: true, digitar: 'excluir' }))) return;
      const livre = ocupado('Excluindo o lote…');
      try { await ctx.api.excluirLote(lote.id); await ctx.atualizarRef(true); } finally { livre(); }
      ctx.toast('Lote excluído', 'ok');
      renderTanque(ctx, el, id);
    } catch (e) { ctx.toast(e.message, 'erro'); }
  }));

  const ba = el.querySelector('#b-apagar-tanque');
  if (ba) ba.addEventListener('click', async () => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    try {
      const livre0 = ocupado('Conferindo o que será apagado…');
      let r, lixo; try { [r, lixo] = await Promise.all([resumoDe(todos.map((l) => l.id)), ctx.api.temLixeira()]); } finally { livre0(); }
      if (!(await confirmar({ titulo: `Apagar "${tanque.nome}"?`, texto: `Serão apagados ${plural(todos.length, 'lote', 'lotes')}, ${txtResumo(r)} ${lixo ? 'Fica na lixeira por 180 dias: dá para restaurar em Fazenda > Histórico e lixeira.' : 'Não dá para desfazer.'}`, ok: 'Apagar tanque', perigo: true, digitar: tanque.nome }))) return;
      const livre = ocupado('Apagando o tanque…');
      try {
        await ctx.api.excluirTanque(id);
        await ctx.atualizarRef(true);
      } finally { livre(); }
      ctx.toast('Tanque apagado', 'ok');
      location.hash = '#/tanques';
    } catch (e) { ctx.toast(e.message, 'erro'); }
  });

  const fn = el.querySelector('#f-nome');
  contarLetras(fn && fn.querySelector('#nome'));
  fn.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = fn.querySelector('#erro-nome'); e.hidden = true;
    const nome = fn.querySelector('#nome').value.trim();
    const ai = fn.querySelector('#area'), areaTxt = ai ? ai.value.trim() : '', areaV = areaHa(areaTxt);
    if (!nome) { e.textContent = 'Informe o nome.'; e.hidden = false; return; }
    if (areaTxt && !areaV) { e.textContent = 'Área inválida. Use hectares, ex.: 5,5'; e.hidden = false; return; }
    try {
      await ctx.api.renomearTanque(id, nome, ai ? areaV : undefined);
      await ctx.atualizarRef();
      ctx.toast('Salvo', 'ok');
      renderTanque(ctx, el, id);
    } catch (err) { e.textContent = err.message; e.hidden = false; }
  });
}

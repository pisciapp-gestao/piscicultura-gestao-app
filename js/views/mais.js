import { esc, ROTULO_PAPEL, fmtData, hojeISO, diasEntre, nomeArquivo, dataArquivo, plural } from '../util.js';
import { icone } from '../icons.js';
import { confirmar } from '../dialogo.js';
import { num, fmtNum, fmtInt } from '../util.js';
import { PESO_SACO_PADRAO_KG, TERMOS_VERSAO, AMBIENTE_NOME } from '../config.js';
import { reduzirLogo } from '../util.js';
import { catalogoAtalhos, atalhosEscolhidos, salvarAtalhos, pintarAtalhos } from '../lateral.js';

export function renderMais(ctx, el) {
  const { state } = ctx;
  const p = state.perfil;
  const gerir = ctx.podeGerir();
  const dono = p.papel === 'dono';
  // grupos da tela Fazenda (o que antes ficava solto no "Mais")
  const grupos = [
    ['No dia a dia', [
      ['#/estoque', 'estoque', 'Estoque de ração', gerir ? 'Saldo, compras e contagem' : 'Saldo de ração'],
      gerir && ['#/despesas', 'estoque', 'Despesas gerais', 'Energia, mão de obra e outros custos'],
      ['#/meus', 'lancar', 'Meus lançamentos', 'Últimos 7 dias: desfazer, corrigir ou pedir correção'],
      gerir && ['#/pedidos', 'historico', 'Pedidos de correção', 'Aprovar ou recusar o que a equipe pediu para corrigir'],
      ['#/pendencias', 'pendentes', 'Pendentes de envio', state.pendentes ? `${state.pendentes} aguardando envio` : 'Nada pendente'],
    ]],
    ['Pessoas', [dono && ['#/equipe', 'equipe', 'Equipe', 'Pessoas, papéis e tanques liberados']]],
    ['Plano', [dono && ['#/plano', 'check', 'Meu plano', 'Pacote de tanques e prazo']]],
    ['Segurança', [dono && ['#/historico', 'historico', 'Histórico e lixeira', 'Quem alterou ou excluiu, e restaurar']]],
    ['Sistema', [state.admin && ['#/admin', 'admin', 'Administração do sistema', 'Todas as fazendas, cobranças e pacotes']]],
  ].map(([t, its]) => [t, its.filter(Boolean)]).filter(([, its]) => its.length);
  const htmlGrupo = ([titulo, its]) => `<h2 class="mais-t">${esc(titulo)}</h2><div class="card"><ul class="lista">${its.map(([href, ic, t, s]) => `
      <li><a class="item" href="${href}"><span class="item-ic">${icone(ic)}</span><span class="esq"><b>${esc(t)}</b><small>${esc(s)}</small></span><span class="seta">${icone('direita', 20)}</span></a></li>`).join('')}</ul></div>`;

  el.innerHTML = `
    <h1>Fazenda</h1>
    <p class="sub-titulo">${esc((p.fazendas && p.fazendas.nome) || '')}${p.suporte ? ' · suporte do administrador' : ` · você é ${p.papel === 'funcionario' ? 'funcionário' : `o ${esc(ROTULO_PAPEL[p.papel] || p.papel).toLowerCase()}`}`}</p>
    <div class="pc-duas"><div>
    ${grupos.map(htmlGrupo).join('')}

    <div class="card">
      <div class="perfil-linha"><span class="avatar">${esc((p.nome || '?').trim().charAt(0).toUpperCase())}</span>
        <div><b>${esc(p.nome)}</b><small style="display:block">${esc(ROTULO_PAPEL[p.papel] || p.papel)} · ${esc((p.fazendas && p.fazendas.nome) || '')}</small></div></div>
      <div class="par-btns">
        <button class="btn" id="b-atualizar" type="button">Atualizar dados</button>
        <button class="btn perigo" id="b-sair" type="button">Sair</button>
      </div>
    </div>

    <div id="teste"></div>
    </div><div>
    <h2 class="mais-t">Ajustes</h2>
    <details class="card form-dobra lat-cfg" id="cfg-atalhos">
      <summary><span><b id="t-atalhos">Atalhos da barra lateral</b><small>O que aparece no menu do lado e em que ordem</small></span></summary>
      <div class="form">
      <small style="display:block">Escolha o que aparece no menu do lado esquerdo e em que ordem. Vale para este computador.</small>
      <ul class="atalhos-cfg" id="lista-atalhos"></ul>
      </div>
    </details>

    ${p.papel === 'dono' ? `<details class="card form-dobra">
      <summary><span><b>Peso do saco de ração</b><small>${fmtNum(state.ref.kgSaco || PESO_SACO_PADRAO_KG, 0)} kg por saco</small></span></summary>
      <div class="form">
      <small style="display:block">Usado para converter sacos em kg ao lançar a ração.</small>
      <form id="f-saco" class="saco-linha"><label class="saco-campo"><span>Quilos por saco</span>
        <span class="com-sufixo"><input id="kgsaco" type="number" inputmode="decimal" step="0.1" min="1" value="${state.ref.kgSaco || PESO_SACO_PADRAO_KG}" required><em>kg</em></span></label>
      <button class="btn primario" type="submit">Salvar</button></form></div></details>` : ''}

    ${p.papel === 'dono' ? `<details class="card form-dobra">
      <summary><span><b>Preço do peixe</b><small>${state.ref.precoKg ? `R$ ${fmtNum(state.ref.precoKg, 2)} por kg` : 'não informado'}</small></span></summary>
      <div class="form">
      <small style="display:block">Usado só para estimar, na tela Início, quanto vale o peixe que está na água.</small>
      <form id="f-preco" class="saco-linha"><label class="saco-campo"><span>Reais por quilo</span>
        <span class="com-sufixo"><input id="precokg" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="Ex.: 9,50" value="${state.ref.precoKg || ''}" required><em>R$/kg</em></span></label>
      <button class="btn primario" type="submit">Salvar</button></form></div></details>` : ''}

    ${p.papel === 'dono' ? `<details class="card form-dobra">
      <summary><span><b>Logo da fazenda</b><small>${state.ref.logo ? 'logo enviado' : 'sem logo: usa a marca do sistema'}</small></span></summary>
      <div class="form">
      <small style="display:block">Aparece no cabeçalho dos relatórios em PDF. Sem logo, usamos a marca do sistema.</small>
      <div class="logo-linha"><span class="caixa">${state.ref.logo ? `<img src="${esc(state.ref.logo)}" alt="">` : icone('peixe', 44)}</span>
        <div class="cfg-btns"><button class="btn" id="b-logo" type="button">${state.ref.logo ? 'Trocar logo' : 'Enviar logo'}</button>
        ${state.ref.logo ? '<button class="btn perigo" id="b-logo-x" type="button">Remover</button>' : '<small class="mudo">PNG ou JPG. Fundo transparente fica melhor.</small>'}</div></div>
      <input id="in-logo" type="file" accept="image/*" hidden></div></details>` : ''}

    ${p.papel === 'dono' ? `<details class="card form-dobra">
      <summary><span><b>Cópia de segurança dos dados</b><small>Baixar ou importar</small></span></summary>
      <div class="form">
      <small style="display:block">Um arquivo com tudo da fazenda: tanques, lotes, lançamentos, compras, contagens e equipe. Inclui os valores pagos e o preço do peixe: guarde só com você e não mande para a equipe.</small>
      <div class="cfg-lista">
        <button class="hub-card" id="b-copia" type="button"><span class="item-ic">${icone('baixar')}</span><span class="esq"><b>Baixar cópia</b><small>Salva um arquivo para guardar no Drive ou mandar por e-mail</small></span><span class="seta">${icone('direita', 20)}</span></button>
        <button class="hub-card" id="b-importar" type="button"><span class="item-ic">${icone('subir')}</span><span class="esq"><b>Importar cópia</b><small>Devolve o que faltar, sem alterar o que existe</small></span><span class="seta">${icone('direita', 20)}</span></button>
      </div>
      <input id="in-copia" type="file" accept=".json,application/json" hidden></div></details>` : ''}
    </div></div>

    ${TERMOS_VERSAO ? '<p class="mudo nota" style="text-align:center"><a href="termos.html" target="_blank" rel="noopener">Termos de uso</a> · <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a></p>' : ''}
    ${state.admin ? `<p class="mudo nota" style="text-align:center">Banco em uso: ${esc(AMBIENTE_NOME)}</p>` : ''}
    <details class="card">
      <summary>Como instalar no celular</summary>
      <p><b>Android (Chrome):</b> menu (três pontos) → “Instalar app” ou “Adicionar à tela inicial”.</p>
      <p><b>iPhone (Safari):</b> botão Compartilhar → “Adicionar à Tela de Início”.</p>
      <p class="mudo">Instalar é importante: no iPhone, lançamentos guardados sem internet podem ser apagados pelo sistema se o app não estiver instalado.</p>
    </details>`;

  pintarCfgAtalhos();
  async function pintarCfgAtalhos() {
    const ul = el.querySelector('#lista-atalhos');
    if (!ul) return;
    const cat = catalogoAtalhos(state, gerir);
    const escolhidos = await atalhosEscolhidos(state, gerir);
    const resto = cat.map((x) => x[0]).filter((id) => !escolhidos.includes(id));
    const porId = Object.fromEntries(cat.map((x) => [x[0], x]));
    ul.innerHTML = [...escolhidos, ...resto].map((id, i) => {
      const on = escolhidos.includes(id), [, , , ic, txt] = porId[id];
      return `<li class="${on ? 'on' : ''}"><label><input type="checkbox" data-at="${esc(id)}"${on ? ' checked' : ''}>${icone(ic, 17)}<span>${esc(txt)}</span></label>
        ${on ? `<span class="at-ordem"><button type="button" class="btn mini" data-sobe="${esc(id)}" aria-label="Subir ${esc(txt)}"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="btn mini" data-desce="${esc(id)}" aria-label="Descer ${esc(txt)}"${i === escolhidos.length - 1 ? ' disabled' : ''}>↓</button></span>` : ''}</li>`;
    }).join('');
    const salvar = async (ids) => { await salvarAtalhos(ids); await pintarAtalhos(ctx, null); pintarCfgAtalhos(); };
    ul.querySelectorAll('[data-at]').forEach((c) => c.addEventListener('change', () => {
      const id = c.dataset.at;
      salvar(c.checked ? [...escolhidos, id] : escolhidos.filter((x) => x !== id));
    }));
    const mover = (id, d) => { const a = [...escolhidos], i = a.indexOf(id), j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; salvar(a); };
    ul.querySelectorAll('[data-sobe]').forEach((b) => b.addEventListener('click', () => mover(b.dataset.sobe, -1)));
    ul.querySelectorAll('[data-desce]').forEach((b) => b.addEventListener('click', () => mover(b.dataset.desce, 1)));
  }

  const fs = el.querySelector('#f-saco');
  if (fs) fs.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const kg = num(fs.querySelector('#kgsaco').value);
    if (!(kg >= 1 && kg <= 100)) return ctx.toast('Informe o peso do saco em kg (ex.: 25).', 'erro');
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    try {
      await ctx.api.salvarKgSaco(state.perfil.fazenda_id, kg);
      if (!(await ctx.api.kgSaco())) return ctx.toast('Falta rodar o sql/03 no Supabase.', 'erro');
      await ctx.atualizarRef(true);
      ctx.toast(`Saco = ${fmtNum(kg, 0)} kg`, 'ok');
    } catch (e) { ctx.toast('Não salvou: ' + e.message, 'erro'); }
  });
  const fp = el.querySelector('#f-preco');
  if (fp) fp.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const preco = num(fp.querySelector('#precokg').value);
    if (!(preco > 0 && preco <= 1000)) return ctx.toast('Informe o preço do quilo em reais (ex.: 9,50).', 'erro');
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    try {
      await ctx.api.salvarPrecoKg(state.perfil.fazenda_id, preco);
      if (!(await ctx.api.precoKg())) return ctx.toast('Falta rodar o sql/16 no Supabase.', 'erro');
      await ctx.atualizarRef(true);
      ctx.toast(`Peixe = R$ ${fmtNum(preco, 2)} por kg`, 'ok');
    } catch (e) { ctx.toast(/preco_kg/i.test(e.message || '') ? 'Falta rodar o sql/16 no Supabase.' : 'Não salvou: ' + e.message, 'erro'); }
  });
  const salvarLogo = async (dataUrl, msg) => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    try {
      await ctx.api.salvarLogo(state.perfil.fazenda_id, dataUrl);
      if (dataUrl && !(await ctx.api.logo())) return ctx.toast('Falta rodar o sql/09 no Supabase.', 'erro');
      await ctx.atualizarRef(true); ctx.recarregarTopo(); ctx.toast(msg, 'ok'); renderMais(ctx, el);
    } catch (e) { ctx.toast(/logo/.test(e.message || '') && /column|schema/.test(e.message || '') ? 'Falta rodar o sql/09 no Supabase (coluna do logo).' : 'Não salvou: ' + e.message, 'erro'); }
  };
  const inLogo = el.querySelector('#in-logo');
  if (inLogo) {
    el.querySelector('#b-logo').addEventListener('click', () => inLogo.click());
    inLogo.addEventListener('change', async () => {
      const f = inLogo.files && inLogo.files[0]; if (!f) return;
      try { await salvarLogo(await reduzirLogo(f), 'Logo salva'); } catch (e) { ctx.toast(e.message || 'Imagem inválida', 'erro'); }
    });
    const x = el.querySelector('#b-logo-x');
    if (x) x.addEventListener('click', () => salvarLogo(null, 'Logo removida'));
  }
  const bcop = el.querySelector('#b-copia');
  if (bcop) bcop.addEventListener('click', async () => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    bcop.disabled = true; const txt = bcop.textContent; bcop.textContent = 'Preparando…';
    try {
      const dados = await ctx.api.exportarTudo();
      const n = Object.values(dados.tabelas).reduce((s, l) => s + l.length, 0);
      const nome = nomeArquivo(['Cópia dos dados', (p.fazendas && p.fazendas.nome) || 'Fazenda', dataArquivo(hojeISO())], 'json');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 1)], { type: 'application/json' }));
      a.download = nome; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      ctx.toast(`Cópia baixada: ${plural(n, 'registro', 'registros')}`, 'ok');
    } catch (e) { ctx.toast('Não foi possível gerar a cópia: ' + e.message, 'erro'); }
    bcop.disabled = false; bcop.textContent = txt;
  });
  const bimp = el.querySelector('#b-importar'), incop = el.querySelector('#in-copia');
  if (bimp) bimp.addEventListener('click', () => { if (!navigator.onLine) return ctx.toast('Sem internet', 'erro'); incop.value = ''; incop.click(); });
  if (incop) incop.addEventListener('change', async () => {
    const arq = incop.files && incop.files[0]; if (!arq) return;
    let copia;
    try { copia = JSON.parse(await arq.text()); } catch { return ctx.toast('Este arquivo não é uma cópia do app.', 'erro'); }
    if (!copia || typeof copia.tabelas !== 'object' || Array.isArray(copia.tabelas)) return ctx.toast('Este arquivo não é uma cópia do app.', 'erro');
    const qtd = (t) => (Array.isArray(copia.tabelas[t]) ? copia.tabelas[t].length : 0);
    const resumo = `${plural(qtd('tanques'), 'tanque', 'tanques')}, ${plural(qtd('lotes'), 'lote', 'lotes')}, ${plural(qtd('racao_consumo') + qtd('biometrias') + qtd('mortalidade') + qtd('despescas') + qtd('manejos') + qtd('qualidade_agua'), 'lançamento', 'lançamentos')} e ${plural(qtd('racao_estoque'), 'compra', 'compras')}`;
    if (!(await confirmar({ titulo: 'Importar esta cópia?', texto: `Cópia de ${copia.gerado_em ? fmtData(copia.gerado_em) : 'data desconhecida'} com ${resumo}. Só volta o que estiver faltando; nada que já existe é alterado.`, ok: 'Importar' }))) return;
    bimp.disabled = true;
    try {
      const r = await ctx.api.importarCopia(copia);
      const n = Object.values(r).reduce((s, v) => s + Number(v || 0), 0);
      await ctx.atualizarRef(true);
      ctx.toast(n ? `${n === 1 ? '1 registro voltou' : `${fmtInt(n)} registros voltaram`} para a fazenda` : 'Nada para importar: tudo da cópia já está na fazenda.', 'ok');
    } catch (e) { ctx.toast(e.message, 'erro'); }
    bimp.disabled = false;
  });
  el.querySelector('#b-atualizar').addEventListener('click', async () => {
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    await ctx.atualizarRef(true);
    await ctx.sincronizarAgora(true);
    ctx.toast('Dados atualizados', 'ok');
  });
  el.querySelector('#b-sair').addEventListener('click', () => ctx.sair());
  if (p.papel === 'dono' && navigator.onLine) {
    // com pacote contratado, o cartão é do plano (antes continuava "teste grátis, faltam 30 dias")
    Promise.all([ctx.api.testeAte(), ctx.api.plano().catch(() => null)]).then(([ate, plano]) => {
      if (plano && ['ativo', 'carencia', 'vencido'].includes(plano.estado)) {
        const d = plano.valido_ate ? diasEntre(hojeISO(), plano.valido_ate) : null;
        el.querySelector('#teste').innerHTML = `<a class="card" href="#/plano" style="display:block;color:inherit;text-decoration:none"><b>${plano.estado === 'ativo' ? 'Plano ativo' : 'Plano vencido'}</b>
          <small style="display:block">${plano.valido_ate ? `${plano.estado === 'ativo' ? 'Pago até' : 'Venceu em'} ${fmtData(plano.valido_ate)}${d != null && d >= 0 ? ` (${d === 1 ? 'falta 1 dia' : `faltam ${d} dias`})` : ''}.` : ''}</small></a>`;
        return;
      }
      if (!ate) return;
      const falta = diasEntre(hojeISO(), ate);
      el.querySelector('#teste').innerHTML = `<div class="card"><b>${falta >= 0 ? 'Período de teste grátis' : 'Período de teste terminou'}</b>
        <small style="display:block">${falta > 0 ? `${falta === 1 ? 'Falta 1 dia' : `Faltam ${falta} dias`}: vai até ${fmtData(ate)}.` : falta === 0 ? 'Termina hoje.' : `Terminou em ${fmtData(ate)}.`}</small></div>`;
    }).catch(() => {});
  }
}

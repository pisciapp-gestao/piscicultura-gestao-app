// Placas com QR code (sql/40): o dono liga a página pública de cada tanque, escolhe o que aparece,
// imprime a placa e troca o código se a placa for perdida ou copiada. Fica em Fazenda › Visitantes.
import { esc, ROTULO_TIPO, nomeArquivo } from '../util.js';
import { icone } from '../icons.js';
import { confirmar } from '../dialogo.js';
import { matrizQr, svgQr, linkPlaca } from '../qr.js';
import { carregarGerador, carregarFontes, abrirVisualizador } from '../pdf_ui.js';

const faltaSql = (e) => /placa|whatsapp_visitantes/i.test((e && e.message) || '') && /exist|schema|column|relation|function|could not find/i.test((e && e.message) || '');
const erroSql = (e) => (faltaSql(e) ? new Error('Falta rodar o sql/40 (placas com QR code) no Supabase.') : e);

function soDono(ctx, el) {
  if (ctx.state.perfil.papel === 'dono') return false;
  el.innerHTML = '<h1>Placas com QR code</h1><div class="card vazio"><p>Só o dono da fazenda cuida das placas com QR code.</p></div>';
  return true;
}

// espécie e fase dos lotes ativos do tanque ("Tambaqui · Engorda"), ou "Sem peixes no momento"
function descreverTanque(ctx, tanqueId) {
  const ls = (ctx.state.ref.lotes || []).filter((l) => l.tanque_id === tanqueId && l.ativo !== false);
  if (!ls.length) return { texto: 'Sem peixes no momento', especie: '' };
  const esp = [...new Set(ls.map((l) => l.especie).filter(Boolean))].join(', ');
  const fases = [...new Set(ls.map((l) => ROTULO_TIPO[l.tipo] || l.tipo))].join(' e ');
  return { texto: [esp, fases].filter(Boolean).join(' · '), especie: esp };
}

const fmtWhats = (n) => {
  const d = String(n || '').replace(/\D/g, ''), l = d.length > 11 ? d.slice(-11) : d;
  return l.length === 11 ? `(${l.slice(0, 2)}) ${l.slice(2, 7)}-${l.slice(7)}` : l.length === 10 ? `(${l.slice(0, 2)}) ${l.slice(2, 6)}-${l.slice(6)}` : d;
};

export async function renderPlacas(ctx, el) {
  if (soDono(ctx, el)) return;
  el.innerHTML = '<h1>Placas com QR code</h1><p class="sub-titulo">Carregando…</p>';
  let tanques, placas, whats;
  try { [tanques, placas, whats] = await Promise.all([ctx.api.tanques(), ctx.api.placas(), ctx.api.whatsappVisitantes()]); }
  catch (e) { throw erroSql(e); }
  const porTanque = Object.fromEntries(placas.map((p) => [p.tanque_id, p]));
  el.innerHTML = `
    <h1>Placas com QR code</h1>
    <p class="sub-titulo">Página de cada tanque para escolas e visitantes</p>
    <p class="mudo">Quem aponta o celular para a placa vê os dados do tanque na hora, sem entrar no app. Nunca aparecem valores em R$, quantidade de peixes, mortes nem nomes da equipe.</p>
    ${tanques.length ? `<div class="card"><ul class="lista">${tanques.map((t) => {
      const p = porTanque[t.id];
      const tag = !p ? '<span class="tag"><i></i>Sem placa</span>' : p.ligada ? '<span class="tag ok"><i></i>Ligada</span>' : '<span class="tag"><i></i>Desligada</span>';
      return `<li><a class="item" href="#/placa/${esc(t.id)}"><span class="item-ic">${icone('qr')}</span><span class="esq"><b>${esc(t.nome)}</b><small>${esc(descreverTanque(ctx, t.id).texto)}</small></span>${tag}<span class="seta">${icone('direita', 20)}</span></a></li>`;
    }).join('')}</ul></div>` : '<div class="card vazio"><p>Cadastre os tanques primeiro (aba Tanques).</p></div>'}
    <h2 class="mais-t">WhatsApp para visitantes</h2>
    <details class="card form-dobra" id="d-whats"${whats ? '' : ' open'}>
      <summary><span><b>WhatsApp da fazenda</b><small>${whats ? esc(fmtWhats(whats)) : 'não informado'}</small></span></summary>
      <div class="form">
        <small style="display:block">Aparece só nas placas em que você ligar “WhatsApp da fazenda”, para a escola ou o visitante falar com vocês.</small>
        <form id="f-whats" class="saco-linha"><label class="saco-campo"><span>Número com DDD</span>
          <input id="whats" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="(95) 99999-0000" value="${esc(whats ? fmtWhats(whats) : '')}"></label>
        <button class="btn primario" type="submit">Salvar</button></form>
      </div>
    </details>`;
  el.querySelector('#f-whats').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = el.querySelector('#whats').value.replace(/\D/g, '');
    if (v && !/^[0-9]{10,13}$/.test(v)) return ctx.toast('WhatsApp inválido: use o DDD e o número, por exemplo (95) 99999-0000.', 'erro');
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    try {
      await ctx.api.salvarWhatsappVisitantes(v);
      ctx.toast(v ? 'WhatsApp salvo' : 'WhatsApp apagado das placas', 'ok');
      renderPlacas(ctx, el);
    } catch (e) { ctx.toast(erroSql(e).message, 'erro'); }
  });
}

export async function renderPlaca(ctx, el, tanqueId) {
  if (soDono(ctx, el)) return;
  el.innerHTML = '<h1>Placa</h1><p class="sub-titulo">Carregando…</p>';
  let tanques, placas, whats;
  try { [tanques, placas, whats] = await Promise.all([ctx.api.tanques(), ctx.api.placas(), ctx.api.whatsappVisitantes()]); }
  catch (e) { throw erroSql(e); }
  const t = tanques.find((x) => x.id === tanqueId);
  if (!t) { el.innerHTML = '<h1>Placa</h1><div class="card vazio"><p>Tanque não encontrado.</p><a class="btn" href="#/placas">Ver as placas</a></div>'; return; }
  let p = placas.find((x) => x.tanque_id === tanqueId);
  if (!p) { try { p = await ctx.api.salvarPlaca(tanqueId, {}); } catch (e) { throw erroSql(e); } } // primeira vez: nasce desligada
  const link = linkPlaca(p.codigo);
  const desc = descreverTanque(ctx, tanqueId);
  let qr = '';
  try { qr = svgQr(await matrizQr(link), `QR code da placa do ${t.nome}`); } catch (e) { qr = `<p class="erro">${esc(e.message)}</p>`; }
  const ops = [
    ['agua', 'mostra_agua', 'Água', 'Situação e medições, com a faixa do tambaqui'],
    ['crescimento', 'mostra_crescimento', 'Crescimento', 'Gráfico das pesagens e ganho de peso por dia'],
    ['fases', 'mostra_fases', 'Fases do cultivo', 'Em que fase o tanque está'],
    ['whatsapp', 'mostra_whatsapp', 'WhatsApp da fazenda', whats ? fmtWhats(whats) : 'Cadastre o número em Placas com QR code › WhatsApp'],
  ];
  el.innerHTML = `
    <h1>Placa do ${esc(t.nome)}</h1>
    <p class="sub-titulo">${esc(desc.texto)}</p>
    <div class="card">
      <label class="linha-check"><input type="checkbox" id="c-ligada"${p.ligada ? ' checked' : ''}> Mostrar a página deste tanque ao público</label>
      <small style="display:block;margin-top:.5rem">${p.ligada ? 'Ligada: quem ler o QR vê os dados de agora.' : 'Desligada: quem ler o QR vê “Informações indisponíveis no momento”.'}</small>
    </div>
    <details class="card form-dobra">
      <summary><span><b>O que aparece</b><small style="display:block">Nome, espécie, fase, peso médio, dias de cultivo e ração de hoje sempre aparecem</small></span></summary>
      <div class="form">
        ${ops.map(([k, col, n, d]) => `<label class="linha-check placa-op"><input type="checkbox" data-bloco="${k}"${p[col] ? ' checked' : ''}${k === 'whatsapp' && !whats ? ' disabled' : ''}><span><b>${n}</b><small>${esc(d)}</small></span></label>`).join('')}
        <p class="aviso">Nunca aparece: valores em R$, quantidade de peixes, biomassa, mortes, despescas e nomes da equipe.</p>
        <button class="btn primario" type="button" id="b-salvar-blocos">Salvar</button>
      </div>
    </details>
    <div class="folha-wrap">
      <div class="folha" aria-label="Como a placa fica impressa">
        <div class="f-marca">${icone('peixe', 22)}<span>${esc((ctx.state.perfil.fazendas && ctx.state.perfil.fazendas.nome) || '')}</span></div>
        <div><h2>${esc(t.nome)}</h2>${desc.especie ? `<div class="f-esp">${esc(desc.especie)}</div>` : ''}</div>
        <div class="qr">${qr}</div>
        <div class="f-chamada">Aponte a câmera do celular<br>e veja como estão os peixes hoje</div>
        <div class="f-peq">PisciApp · código ${esc(p.codigo)}</div>
      </div>
      ${p.ligada ? '' : '<p class="aviso" style="max-width:400px;margin:0">Esta placa está desligada: ligue acima antes de colocar na beira do tanque.</p>'}
    </div>
    <div class="card placa-acoes">
      <button class="btn primario grande" type="button" id="b-pdf">${icone('baixar', 20)} Baixar PDF da placa</button>
      <div class="par-btns">
        <a class="btn" id="b-ver" href="${esc(link)}" target="_blank" rel="noopener">Ver como o visitante vê</a>
        <button class="btn" type="button" id="b-copiar">Copiar link</button>
      </div>
      <button class="btn perigo" type="button" id="b-trocar">Trocar o QR code</button>
      <p class="mudo nota">Para ficar ao ar livre: imprima em A5 (ou A4) e plastifique, ou mande fazer em PVC/ACM. A placa não precisa ser trocada quando o tanque recebe peixes novos.</p>
    </div>`;

  const salvar = async (campos, msg) => {
    if (!navigator.onLine) { ctx.toast('Sem internet', 'erro'); return false; }
    try { await ctx.api.salvarPlaca(tanqueId, campos); ctx.toast(msg, 'ok'); renderPlaca(ctx, el, tanqueId); return true; }
    catch (e) { ctx.toast(erroSql(e).message, 'erro'); return false; }
  };
  const cl = el.querySelector('#c-ligada');
  cl.addEventListener('change', async () => {
    const quer = cl.checked;
    if (!(await salvar({ ligada: quer }, quer ? 'Placa ligada: o QR já mostra os dados' : 'Placa desligada'))) cl.checked = !quer;
  });
  el.querySelector('#b-salvar-blocos').addEventListener('click', () => {
    const c = {};
    el.querySelectorAll('[data-bloco]').forEach((x) => { if (!x.disabled) c[x.dataset.bloco] = x.checked; });
    salvar(c, 'Salvo');
  });
  el.querySelector('#b-copiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); ctx.toast('Link copiado', 'ok'); }
    catch { ctx.toast(link); }
  });
  el.querySelector('#b-trocar').addEventListener('click', async () => {
    if (!(await confirmar({ titulo: `Trocar o QR code do ${t.nome}?`, texto: 'A placa já impressa para de funcionar na hora. Use se ela foi perdida ou copiada, e imprima a nova.', ok: 'Trocar QR code', perigo: true }))) return;
    if (!navigator.onLine) return ctx.toast('Sem internet', 'erro');
    try { await ctx.api.trocarCodigoPlaca(tanqueId); ctx.toast('QR code trocado. Imprima a placa nova.', 'ok'); renderPlaca(ctx, el, tanqueId); }
    catch (e) { ctx.toast(erroSql(e).message, 'erro'); }
  });
  const bp = el.querySelector('#b-pdf');
  bp.addEventListener('click', async () => {
    bp.disabled = true;
    try {
      const [jsPDF, fontes, matriz, { gerarPdfPlaca }] = await Promise.all([carregarGerador(), carregarFontes(), matrizQr(link), import('../pdf_placa.js')]);
      const fazenda = (ctx.state.perfil.fazendas && ctx.state.perfil.fazendas.nome) || 'Piscicultura';
      const doc = gerarPdfPlaca(jsPDF, { fazenda, logo: ctx.state.ref.logo, fontes, nomeTanque: t.nome, especie: desc.especie, matriz, link, codigo: p.codigo });
      await abrirVisualizador({ blob: doc.output('blob'), nome: nomeArquivo(['Placa', t.nome, fazenda], 'pdf'), titulo: `Placa · ${t.nome}`, toast: ctx.toast });
    } catch (e) { ctx.toast('Não foi possível gerar o PDF: ' + e.message, 'erro'); }
    bp.disabled = false;
  });
}

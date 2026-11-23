// Transferência de peixes entre tanques (pedido do cliente piloto, 16/11/2026; maquete A aprovada).
// Sai de UM tanque e vai para um ou mais. Destino vazio: nasce um lote novo; destino com peixe: junta no lote de lá.
// O custo (ração já dada na origem) vai junto, na proporção dos peixes. Não é venda. Só dono e gerente, só com internet.
import { esc, hojeISO, fmtData, fmtNum, fmtInt, uuid, ROTULO_TIPO, FASES, numDecimal, ehErroDeRede } from '../util.js';
import { confirmar } from '../dialogo.js';
import { ordemNatural } from './home.js';
import { PROXIMA_FASE } from './despesca.js';
import { vivosDoLote } from '../calc.js';
import { PESO_SACO_PADRAO_KG } from '../config.js';

const inteiro = (v) => { const t = String(v ?? '').replace(/\D/g, ''); return t ? Number(t) : null; };
const milhar = (n) => (n == null ? '' : fmtInt(n));

// segHtml: as abas do Lançar (Ração, Biometria...) já montadas; trocarTipo(k): volta para outra aba
export async function renderTransferir(ctx, el, { tanque, segHtml, ligarSeg }) {
  const { tanques, lotes } = ctx.state.ref;
  const kgS = ctx.state.ref.kgSaco || PESO_SACO_PADRAO_KG;
  const ativos = (lotes || []).filter((l) => l.ativo);
  const loteDe = (tid) => ativos.filter((l) => l.tanque_id === tid).sort((a, b) => String(b.data_entrada).localeCompare(String(a.data_entrada)))[0] || null;
  const ordenados = [...tanques].sort(ordemNatural);
  const comPeixe = ordenados.filter((t) => loteDe(t.id));
  const nomeDe = (tid) => (tanques.find((t) => t.id === tid) || {}).nome || 'Tanque';

  if (!comPeixe.length) {
    el.innerHTML = `<h1>Lançar</h1>${segHtml}<div class="card vazio"><p>Nenhum tanque com peixe para transferir.</p></div>`;
    ligarSeg(); return;
  }
  let resumo = {};
  try { resumo = Object.fromEntries(((await ctx.api.resumoLotes()) || []).map((r) => [r.lote_id, r])); } catch { /* sem resumo: mostra a entrada */ }
  const vivosDe = (l) => (l ? (resumo[l.id] ? vivosDoLote(l, resumo[l.id]) : Number(l.quantidade_inicial) || 0) : 0);

  let origem = comPeixe.some((t) => t.id === tanque) ? tanque : comPeixe[0].id;
  let destinos = []; // [{tanque, qtd, g, tipo}]
  let data = hojeISO();
  let escolhendo = null; // 'origem' | 'destino' | null
  // um código por transferência, criado ao abrir a tela e mantido nas novas tentativas: se o sinal cair depois que o
  // banco gravou, tocar em Salvar de novo manda o MESMO código e o banco não grava outra vez (sql/37 confere o grupo)
  const grupo = uuid();

  const lo = () => loteDe(origem);
  const racaoOrigemKg = () => { const r = resumo[(lo() || {}).id]; return r ? Number(r.racao_kg) || 0 : 0; };

  // texto embaixo de cada destino: junta ou começa lote novo, e quanto custo vai junto
  function htmlLeva(d, i) {
    const l = loteDe(d.tanque), lOrig = lo();
    const total = destinos.reduce((s, x) => s + (x.qtd || 0), 0);
    const base = Math.max(vivosDe(lOrig), total);
    const leva = d.qtd && base ? (racaoOrigemKg() * d.qtd) / base / kgS : 0;
    const fase = d.tipo || PROXIMA_FASE[lOrig.tipo] || lOrig.tipo;
    return `${l
        ? `Junta com os <b>${fmtInt(vivosDe(l))} peixes</b> que já estão lá (${esc(ROTULO_TIPO[l.tipo] || l.tipo)})`
        : `Tanque vazio: começa um lote de <select data-tipo="${i}" aria-label="Fase do lote novo">${FASES.map(([k, r]) => `<option value="${k}"${k === fase ? ' selected' : ''}>${r}</option>`).join('')}</select>`}<span class="tf-custo">${leva >= 0.5 ? ` · leva <b>≈ ${fmtNum(leva, 0)} ${Math.round(leva) === 1 ? 'saco' : 'sacos'}</b> de custo` : ''}</span>`;
  }
  const custoTxt = (d) => { const total = destinos.reduce((s, x) => s + (x.qtd || 0), 0); const base = Math.max(vivosDe(lo()), total); const leva = d.qtd && base ? (racaoOrigemKg() * d.qtd) / base / kgS : 0; return leva >= 0.5 ? ` · leva <b>≈ ${fmtNum(leva, 0)} ${Math.round(leva) === 1 ? 'saco' : 'sacos'}</b> de custo` : ''; };

  // conta do "Confira" (sem os campos: atualiza enquanto a pessoa digita)
  function htmlConta() {
    const vivos = vivosDe(lo()), total = destinos.reduce((s, d) => s + (d.qtd || 0), 0), ficam = vivos - total;
    return `<div class="tf-saldo">
            <div><span>No ${esc(nomeDe(origem))} antes</span><b>${fmtInt(vivos)} peixes</b></div>
            <div><span>Saem para ${destinos.length} ${destinos.length === 1 ? 'tanque' : 'tanques'}</span><b>− ${fmtInt(total)}</b></div>
            <div class="tot"><span>Ficam no ${esc(nomeDe(origem))}</span><b>${fmtInt(Math.max(0, ficam))} peixes</b></div>
          </div>
          ${total > vivos && vivos > 0 ? `<p class="tf-aviso">Saem <b>${fmtInt(total - vivos)} peixes a mais</b> do que o app estima no tanque. Se a contagem estiver certa, pode salvar: o tanque é esvaziado.</p>` : ''}`;
  }
  function atualizarContas() {
    el.querySelectorAll('.tf-dest').forEach((box) => { const d = destinos[Number(box.dataset.i)]; const c = box.querySelector('.tf-custo'); if (d && c) c.innerHTML = custoTxt(d); });
    const conta = el.querySelector('#tf-conta'); if (conta) conta.innerHTML = htmlConta();
    const total = destinos.reduce((s, d) => s + (d.qtd || 0), 0), cb = el.querySelector('#tf-esvaziou');
    if (cb && total >= vivosDe(lo()) && total > 0) cb.checked = true;
  }

  function htmlDestino(d, i) {
    return `<div class="tf-dest" data-i="${i}">
      <div class="tf-dest-t"><b>${esc(nomeDe(d.tanque))}</b><button class="tf-x" type="button" data-tirar="${i}" aria-label="Tirar ${esc(nomeDe(d.tanque))}">×</button></div>
      <div class="tf-duas">
        <label>Peixes<input type="text" inputmode="numeric" autocomplete="off" data-qtd="${i}" value="${milhar(d.qtd)}" placeholder="0"></label>
        <label>Peso médio<span class="com-sufixo"><input type="text" inputmode="decimal" autocomplete="off" data-g="${i}" value="${d.g != null ? fmtNum(d.g, d.g % 1 ? 1 : 0) : ''}" placeholder="Ex.: 900"><em>g</em></span></label>
      </div>
      <p class="tf-leva">${htmlLeva(d, i)}</p>
    </div>`;
  }

  function tiles(lista, marcado) {
    return `<div class="tiles compactos" role="listbox">${lista.map((t) => { const l = loteDe(t.id);
      return `<button type="button" class="tile${t.id === marcado ? ' on' : ''}" data-tile="${esc(t.id)}"><span>${esc(t.nome)}</span><small class="tile-fase">${l ? `${esc(ROTULO_TIPO[l.tipo] || l.tipo)} · ${fmtInt(vivosDe(l))}` : 'vazio'}</small></button>`; }).join('')}</div>`;
  }

  function pintar() {
    const lOrig = lo(), vivos = vivosDe(lOrig);
    const total = destinos.reduce((s, d) => s + (d.qtd || 0), 0);
    const ficam = vivos - total;
    const livres = ordenados.filter((t) => t.id !== origem && !destinos.some((d) => d.tanque === t.id));
    const esvaziar = el.querySelector('#tf-esvaziou');
    const marcadoEsvaziar = esvaziar ? esvaziar.checked : false;
    el.innerHTML = `
      <h1>Lançar</h1>
      ${segHtml}
      <form id="tf" class="form passos" novalidate>
        <section class="passo">
          <h2 class="passo-t"><i>1</i> Sai de</h2>
          <div class="tf-de"><div><b>${esc(nomeDe(origem))}</b><small>${esc(ROTULO_TIPO[lOrig.tipo] || lOrig.tipo)} · cerca de ${fmtInt(vivos)} peixes · ${fmtNum(racaoOrigemKg() / kgS, 0)} sacos dados</small></div>
            ${comPeixe.length > 1 ? `<button type="button" class="btn mini" id="b-origem">${escolhendo === 'origem' ? 'Fechar' : 'Trocar'}</button>` : ''}</div>
          ${escolhendo === 'origem' ? tiles(comPeixe, origem) : ''}
        </section>
        <section class="passo">
          <h2 class="passo-t"><i>2</i> Vai para</h2>
          ${destinos.map(htmlDestino).join('')}
          ${escolhendo === 'destino' ? `<p class="mudo" style="margin:0">Escolha o tanque que recebe os peixes:</p>${tiles(livres, null)}` : livres.length ? `<button type="button" class="tf-add" id="b-add">+ ${destinos.length ? 'Outro tanque' : 'Escolher o tanque'}</button>` : ''}
          <div class="data-linha"><span>Data: <b>${data === hojeISO() ? 'hoje' : fmtData(data)}</b></span><button type="button" class="link" id="b-data">Mudar</button></div>
          <label id="tf-data-wrap" hidden>Data <input id="tf-data" type="date" value="${data}" max="${hojeISO()}" min="${lOrig.data_entrada}"></label>
        </section>
        ${destinos.length ? `<section class="passo">
          <h2 class="passo-t"><i>3</i> Confira</h2>
          <div id="tf-conta">${htmlConta()}</div>
          <label class="tf-check"><input type="checkbox" id="tf-esvaziou"${marcadoEsvaziar || ficam <= 0 ? ' checked' : ''}> <span>Esvaziou o ${esc(nomeDe(origem))} (todos os peixes saíram)<small>O ciclo dele se encerra como “tudo transferido”, não como venda.</small></span></label>
        </section>` : ''}
        <p id="tf-erro" class="erro" hidden></p>
        ${destinos.length ? '<button class="btn primario grande" type="submit" id="b-salvar">Salvar transferência</button>' : ''}
        ${navigator.onLine ? '' : '<p class="mudo" style="margin:0;text-align:center">A transferência precisa de internet para salvar.</p>'}
      </form>`;
    ligar();
  }

  function ligar() {
    ligarSeg();
    const f = el.querySelector('#tf');
    const bo = f.querySelector('#b-origem');
    if (bo) bo.addEventListener('click', () => { escolhendo = escolhendo === 'origem' ? null : 'origem'; pintar(); });
    const ba = f.querySelector('#b-add');
    if (ba) ba.addEventListener('click', () => { escolhendo = 'destino'; pintar(); });
    f.querySelectorAll('[data-tile]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.tile;
      if (escolhendo === 'origem') { origem = id; destinos = destinos.filter((d) => d.tanque !== id); }
      else destinos.push({ tanque: id, qtd: null, g: null, tipo: null });
      escolhendo = null; pintar();
      if (destinos.length) { const ult = el.querySelector(`[data-qtd="${destinos.length - 1}"]`); if (ult && !ult.value) ult.focus(); }
    }));
    f.querySelectorAll('[data-tirar]').forEach((b) => b.addEventListener('click', () => { destinos.splice(Number(b.dataset.tirar), 1); pintar(); }));
    // digitação: guarda o valor sem redesenhar (não perde o foco); o resumo é refeito ao sair do campo
    f.querySelectorAll('[data-qtd]').forEach((inp) => {
      inp.addEventListener('input', () => { const n = inteiro(inp.value); destinos[Number(inp.dataset.qtd)].qtd = n; atualizarContas(); });
      inp.addEventListener('change', () => { const n = destinos[Number(inp.dataset.qtd)].qtd; if (n != null) inp.value = milhar(n); }); // 5500 → 5.500
    });
    f.querySelectorAll('[data-g]').forEach((inp) => {
      inp.addEventListener('input', () => { const v = numDecimal(inp.value); destinos[Number(inp.dataset.g)].g = v > 0 ? v : null; });
    });
    f.querySelectorAll('[data-tipo]').forEach((s) => s.addEventListener('change', () => { destinos[Number(s.dataset.tipo)].tipo = s.value; }));
    f.querySelector('#b-data').addEventListener('click', () => {
      const w = f.querySelector('#tf-data-wrap'); w.hidden = !w.hidden;
      f.querySelector('#b-data').textContent = w.hidden ? 'Mudar' : 'Fechar';
      if (!w.hidden) f.querySelector('#tf-data').focus();
    });
    f.querySelector('#tf-data').addEventListener('change', (e) => { if (e.target.value) { data = e.target.value; pintar(); } });
    f.addEventListener('submit', salvar);
  }

  async function salvar(e) {
    e.preventDefault();
    const erro = el.querySelector('#tf-erro');
    const mostrar = (m) => { erro.textContent = m; erro.hidden = !m; if (m) erro.scrollIntoView({ block: 'center' }); };
    if (!navigator.onLine) return mostrar('Sem internet: a transferência precisa de conexão para salvar.');
    const lOrig = lo();
    for (const d of destinos) {
      if (!(d.qtd > 0)) return mostrar(`Informe quantos peixes vão para o ${nomeDe(d.tanque)}.`);
      if (!(d.g > 0)) return mostrar(`Informe o peso médio dos peixes que vão para o ${nomeDe(d.tanque)} (em gramas).`);
      if (d.g > 20000) return mostrar(`Confira o peso médio do ${nomeDe(d.tanque)}: ${fmtNum(d.g, 0)} g é mais de 20 kg por peixe.`);
    }
    const esvaziou = el.querySelector('#tf-esvaziou').checked;
    const total = destinos.reduce((s, d) => s + d.qtd, 0);
    const pequenos = destinos.filter((d) => d.g < 1 || (d.g >= 1 && d.g < 5 && lOrig.tipo === 'engorda'));
    if (pequenos.length && !(await confirmar({ titulo: 'Confira o peso médio', texto: `O peso médio é em gramas por peixe. ${pequenos.map((d) => `${nomeDe(d.tanque)}: ${fmtNum(d.g, 1)} g`).join(' · ')}. Está certo?`, ok: 'Está certo', cancelar: 'Corrigir' }))) return;
    const texto = `${fmtInt(total)} peixes saem do ${nomeDe(origem)} para ${destinos.map((d) => nomeDe(d.tanque)).join(' e ')}${esvaziou ? `. O ${nomeDe(origem)} fica vazio e o ciclo dele se encerra.` : '.'}`;
    if (!(await confirmar({ titulo: 'Salvar a transferência?', texto, ok: 'Salvar' }))) return;
    const b = el.querySelector('#b-salvar'); b.disabled = true; b.textContent = 'Salvando…'; mostrar('');
    try {
      const gravados = await ctx.api.registrarTransferencia({
        grupo, loteOrigem: lOrig.id, data, esvaziou,
        destinos: destinos.map((d) => ({ tanque_id: d.tanque, quantidade: d.qtd, peso_medio_kg: Math.round(d.g * 10) / 10000, tipo: loteDe(d.tanque) ? null : (d.tipo || PROXIMA_FASE[lOrig.tipo] || lOrig.tipo) })),
      });
      await ctx.atualizarRef(true);
      // 0 = o banco já tinha este código: a tentativa anterior chegou, mesmo sem a resposta ter voltado
      ctx.toast(Number(gravados) === 0 ? 'Esta transferência já tinha sido salva na tentativa anterior' : 'Transferência salva', 'ok');
      location.hash = `#/relatorio/${lOrig.id}`;
    } catch (err) {
      const semSinal = ehErroDeRede(err && err.original);
      b.disabled = false; b.textContent = semSinal ? 'Tentar de novo' : 'Salvar transferência';
      mostrar(semSinal ? 'O sinal caiu na hora de salvar e não dá para saber se a transferência chegou. Quando o sinal voltar, toque em "Tentar de novo": se ela já tiver chegado, não será lançada duas vezes.'
        : /registrar_transferencia|function/.test(err.message || '') ? 'A transferência ainda não está ligada no banco desta fazenda. Avise o suporte.' : (err.message || 'Não foi possível salvar.'));
    }
  }

  pintar();
}

// Página pública do tanque (placa com QR code, sql/40). Abre sem login: quem lê a placa vê como estão os peixes
// AGORA, lido do banco na hora. Nada fica guardado no aparelho do visitante.
// Só chega aqui o que a função placa_publica entrega: nunca R$, quantidade de peixes, mortes ou nomes da equipe.
import { SUPABASE_URL, SUPABASE_ANON_KEY, AGUA_TAMBAQUI as AG } from './config.js';
import { avaliarAgua, ehTambaqui } from './calc.js';
import { esc, fmtNum, fmtData, diasEntre, pesoMedioTxt, ROTULO_TIPO } from './util.js';
import { icone } from './icons.js';

const LIMITE_MS = 12000;
const DIAS_MEDICAO_VELHA = 2; // medição com mais de 2 dias: não mostra a situação de hoje com dado antigo
const FASES = [
  ['bercario', 'Berçário', 'Os peixes chegam bem pequenos e ficam protegidos nos primeiros dias.'],
  ['alevinagem', 'Alevinagem', 'Os alevinos crescem e passam a comer uma ração maior.'],
  ['recria', 'Recria', 'Os juvenis ganham tamanho antes de ir para a engorda.'],
  ['engorda', 'Engorda', 'Os peixes ficam até chegar ao peso de venda.'],
];
const POR_QUE = {
  oxigenio: 'O peixe respira o oxigênio que está dissolvido na água. Com pouco oxigênio ele come menos e fica estressado.',
  temperatura: 'O peixe não controla a temperatura do próprio corpo: o quanto ele come e cresce depende da água.',
  ph: 'Mostra se a água está ácida ou básica. Fora da faixa, o peixe se estressa.',
  amonia: 'Vem das fezes e da ração que sobra. Em excesso, prejudica as brânquias.',
};

export function codigoDaUrl(loc = location) {
  const c = new URLSearchParams(loc.search).get('c') || '';
  return /^[a-z0-9]{10}$/.test(c) ? c : null;
}

export async function buscarPlaca(codigo) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIMITE_MS);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/placa_publica`, {
      method: 'POST', cache: 'no-store', signal: ctrl.signal,
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_codigo: codigo }),
    });
    if (!r.ok) throw Object.assign(new Error('servidor'), { servidor: true });
    return await r.json();
  } finally { clearTimeout(timer); }
}

// "hoje às 06:10", "ontem às 18:00", "12/11 às 06:10 (há 4 dias)"
function quando(data, hora, hoje) {
  const d = diasEntre(data, hoje);
  const h = hora ? ` às ${esc(hora)}` : '';
  if (d <= 0) return `hoje${h}`;
  if (d === 1) return `ontem${h}`;
  return `${fmtData(data).slice(0, 5)}${h} (há ${d} dias)`;
}

const peso = (g) => esc(pesoMedioTxt(Number(g) / 1000));
const pesoHero = (g) => { const t = pesoMedioTxt(Number(g) / 1000).split(' '); return `${esc(t[0])}<em>${esc(t[1] || '')}</em>`; };

function grafico(pts) {
  // mesmo desenho do gráfico de peso do Relatório do lote
  const W = 320, H = 150, pl = 48, pr = 10, pt = 10, pb = 22;
  const t = (d) => Date.parse(d + 'T12:00:00Z');
  const t0 = t(pts[0].data), t1 = Math.max(t(pts[pts.length - 1].data), t0 + 1);
  const ys = pts.map((p) => Number(p.g));
  const ymin = Math.min(...ys) * 0.9, ymax = Math.max(Math.max(...ys) * 1.05, ymin + 1);
  const X = (d) => pl + ((t(d) - t0) / (t1 - t0)) * (W - pl - pr);
  const Y = (g) => pt + (1 - (g - ymin) / (ymax - ymin)) * (H - pt - pb);
  const linha = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.data).toFixed(1)},${Y(Number(p.g)).toFixed(1)}`).join(' ');
  const ult = pts[pts.length - 1];
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Peso médio: de ${peso(pts[0].g)} em ${fmtData(pts[0].data)} para ${peso(ult.g)} em ${fmtData(ult.data)}">
    <line class="eixo" x1="${pl}" y1="${pt}" x2="${pl}" y2="${H - pb}"/><line class="eixo" x1="${pl}" y1="${H - pb}" x2="${W - pr}" y2="${H - pb}"/>
    <text x="${pl - 4}" y="${pt + 8}" text-anchor="end">${peso(ymax)}</text><text x="${pl - 4}" y="${H - pb}" text-anchor="end">${peso(ymin)}</text>
    <text x="${pl}" y="${H - 6}">${fmtData(pts[0].data).slice(0, 5)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${fmtData(ult.data).slice(0, 5)}</text>
    <path class="linha" d="${linha}"/>${pts.map((p, i) => `<circle class="pt${i ? '' : ' ini'}" cx="${X(p.data).toFixed(1)}" cy="${Y(Number(p.g)).toFixed(1)}" r="4"/>`).join('')}</svg>`;
}

function indicador(nome, faixa, valor, estado, porque) {
  const tag = estado === 'ok' ? '<span class="tag ok"><i></i>na faixa</span>' : estado === 'ruim' ? '<span class="tag erro"><i></i>fora da faixa</span>' : '';
  return `<li class="ind"><span class="esq"><b>${nome}</b>${faixa ? `<small>${faixa}</small>` : ''}${porque ? `<details><summary>Por que isso importa?</summary><p>${porque}</p></details>` : ''}</span><span class="dir"><b>${valor}</b>${tag}</span></li>`;
}

// situação da água: tag do topo, frase de resumo e as linhas dos dados técnicos
export function situacaoAgua(agua, hoje, tambaqui) {
  if (!agua) return { tag: '<span class="tag"><i></i>Sem medição da água</span>', resumo: 'A equipe ainda não lançou medições da água neste tanque.', linhas: '', quando: '' };
  const velha = diasEntre(agua.data, hoje) > DIAS_MEDICAO_VELHA;
  const fora = tambaqui && !velha ? avaliarAgua(agua) : [];
  const v = (k) => (agua[k] == null ? null : Number(agua[k]));
  const est = (val, f) => (!tambaqui || velha || val == null ? '' : (f.min != null && val < f.min) || (f.max != null && val > f.max) ? 'ruim' : 'ok');
  const medidos = [['oxigenio_mgl', 'oxigênio'], ['temperatura_c', 'temperatura'], ['ph', 'pH'], ['amonia_mgl', 'amônia']].filter(([k]) => v(k) != null).map(([, n]) => n);
  const lista = medidos.length > 1 ? `${medidos.slice(0, -1).join(', ')} e ${medidos[medidos.length - 1]}` : medidos[0] || '';
  let tag, resumo;
  if (velha) { tag = '<span class="tag"><i></i>Sem medição recente</span>'; resumo = `A última medição tem mais de ${DIAS_MEDICAO_VELHA} dias. A situação de hoje não é mostrada com dado antigo.`; }
  else if (!tambaqui) { tag = '<span class="tag"><i></i>Água medida</span>'; resumo = 'O app ainda não tem faixa de referência para esta espécie: as medições aparecem sem verde ou vermelho.'; }
  else if (fora.length) {
    const critico = fora.some((x) => x.nivel === 'critico');
    tag = `<span class="tag ${critico ? 'erro' : 'alerta'}"><i></i>Água em atenção</span>`;
    resumo = `${fora.map((x) => x.texto.charAt(0).toUpperCase() + x.texto.slice(1)).join('; ')}. A equipe da fazenda vê o mesmo aviso no app.`;
  } else { tag = '<span class="tag ok"><i></i>Água boa</span>'; resumo = `${lista.charAt(0).toUpperCase() + lista.slice(1)} dentro da faixa para o tambaqui.`; }
  const fx = (t) => (tambaqui ? t : '');
  const linhas = [
    v('oxigenio_mgl') != null && indicador('Oxigênio dissolvido', fx(`Faixa para tambaqui: ${AG.oxigenio.min} a ${AG.oxigenio.max} mg/L`), `${fmtNum(v('oxigenio_mgl'), 1)} mg/L`, est(v('oxigenio_mgl'), AG.oxigenio), POR_QUE.oxigenio),
    v('temperatura_c') != null && indicador('Temperatura', fx(`Faixa para tambaqui: ${AG.temperatura.min} a ${AG.temperatura.max} °C`), `${fmtNum(v('temperatura_c'), 1)} °C`, est(v('temperatura_c'), AG.temperatura), POR_QUE.temperatura),
    v('ph') != null && indicador('pH', fx(`Faixa para tambaqui: ${AG.ph.min} a ${AG.ph.max}`), fmtNum(v('ph'), 1), est(v('ph'), AG.ph), POR_QUE.ph),
    v('amonia_mgl') != null && indicador('Amônia tóxica', fx(`Limite para tambaqui: ${fmtNum(AG.amonia.max, 2)} mg/L`), `${fmtNum(v('amonia_mgl'), 2)} mg/L`, est(v('amonia_mgl'), { max: AG.amonia.max - 1e-9 }), POR_QUE.amonia),
  ].filter(Boolean).join('');
  return { tag, resumo, linhas, quando: quando(agua.data, agua.hora, hoje) };
}

function blocoLote(l, d, varios, i) {
  const hoje = d.hoje;
  const pontos = [...(l.peso_inicial_g != null ? [{ data: l.data_entrada, g: l.peso_inicial_g }] : []), ...l.pesagens.filter((p) => p.data !== l.data_entrada || l.peso_inicial_g == null)];
  const ult = l.pesagens.length ? l.pesagens[l.pesagens.length - 1] : null;
  const atual = ult || (l.peso_inicial_g != null ? { data: l.data_entrada, g: l.peso_inicial_g } : null);
  const dias = Math.max(0, diasEntre(l.data_entrada, hoje));
  const fase = ROTULO_TIPO[l.fase] || l.fase;
  const ganho = pontos.length >= 2 && diasEntre(pontos[0].data, pontos[pontos.length - 1].data) > 0
    ? (Number(pontos[pontos.length - 1].g) - Number(pontos[0].g)) / diasEntre(pontos[0].data, pontos[pontos.length - 1].data) : null;
  return {
    hero: `<section class="td-lote">${varios ? `<p class="lote-nome"><span class="fase"></span>Lote ${i + 1} · ${esc(fase)}</p>` : ''}
      <div class="td-hero"><div><span>Peso médio ${ult ? 'atual' : 'na entrada'}</span><b>${atual ? pesoHero(atual.g) : '—'}</b><small>${atual ? `em ${fmtData(atual.data)}` : 'sem pesagem ainda'}</small></div>
        <div><span>Dias de cultivo</span><b>${dias}</b><small>desde ${fmtData(l.data_entrada)}</small></div></div>
      <div class="td-stats"><div><span>Fase</span><b>${esc(fase)}</b></div><div><span>Ração de hoje</span><b>${l.racao_hoje ? 'Dada ✓' : 'Ainda não lançada'}</b></div></div></section>`,
    grafico: d.mostra.crescimento && pontos.length >= 2 ? `<div class="card"><header><h3>Crescimento${varios ? ` · lote ${i + 1}` : ''}</h3><small>peso médio em cada pesagem</small></header>${grafico(pontos)}</div>` : '',
    tecnico: d.mostra.crescimento && ganho != null ? indicador(`Ganho de peso por dia${varios ? ` · lote ${i + 1}` : ''}`, `Média entre a 1ª e a última pesagem (${peso(pontos[0].g)} → ${peso(pontos[pontos.length - 1].g)} em ${diasEntre(pontos[0].data, pontos[pontos.length - 1].data)} dias)`, `${fmtNum(ganho, ganho < 10 ? 1 : 0)} g/dia`, '', '') : '',
  };
}

function whatsLink(num) {
  const n = String(num || '').replace(/\D/g, '');
  const completo = n.length <= 11 ? `55${n}` : n;
  const local = n.length > 11 ? n.slice(-11) : n;
  const txt = local.length === 11 ? `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}` : local.length === 10 ? `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}` : local;
  return { href: `https://wa.me/${completo}?text=${encodeURIComponent('Olá! Vi a placa do tanque e queria saber mais sobre a criação de peixes.')}`, txt };
}

const casca = (fazenda, conteudo) => `<div class="app publico"><header class="topo"><div class="marca"><span class="logo-sm">${icone('peixe', 26)}</span><div><strong>${esc(fazenda || 'Piscicultura')}</strong><small>Página pública do tanque</small></div></div></header>
  <main class="view"><div class="tela-entra">${conteudo}</div></main></div>`;
const rodape = (fazenda) => `<p class="rodape-pub">Dados lançados pela equipe da ${esc(fazenda)} no PisciApp.<br>Atualizados toda vez que esta página é aberta.</p>
  <p class="rodape-pub"><button class="link" type="button" data-recarregar>Atualizar agora</button></p>`;

// HTML da página (função pura: os testes conferem cada situação)
export function htmlPlaca(d) {
  if (d == null) return casca('', `<div class="card vazio"><h2 style="margin-top:0">Placa não encontrada</h2><p>Este QR code não está mais em uso. Se a placa foi trocada, peça à fazenda a placa nova.</p></div>`);
  if (!d.disponivel) return casca(d.fazenda, `<div class="card vazio"><h2 style="margin-top:0">Informações indisponíveis no momento</h2><p>A fazenda pausou a página deste tanque. Fale com a equipe da ${esc(d.fazenda)}.</p></div>`);
  const lotes = d.lotes || [];
  const tambaqui = lotes.some((l) => ehTambaqui(l.especie));
  const especies = [...new Set(lotes.map((l) => l.especie).filter(Boolean))];
  const fases = [...new Set(lotes.map((l) => ROTULO_TIPO[l.fase] || l.fase))];
  const ag = d.mostra.agua ? situacaoAgua(d.agua, d.hoje, tambaqui) : null;
  const sub = lotes.length ? `${esc(fases.join(' e '))} · ${esc(especies.join(', '))}${especies.length === 1 && tambaqui ? ' <i>(Colossoma macropomum)</i>' : ''}` : 'Sem peixes no momento';
  const blocos = lotes.map((l, i) => blocoLote(l, d, lotes.length > 1, i));
  const tecnicoCresc = blocos.map((b) => b.tecnico).join('');
  const temTecnico = (ag && ag.linhas) || tecnicoCresc;
  const fasesCard = d.mostra.fases ? `<div class="card"><header><h3>As fases do cultivo</h3></header><ul class="lista">${FASES.map(([k, n, t]) => `<li><span class="esq"><b>${n}</b><small>${t}</small></span>${lotes.some((l) => l.fase === k) ? '<span class="tag ok"><i></i>este tanque</span>' : ''}</li>`).join('')}</ul></div>` : '';
  const w = d.whatsapp ? whatsLink(d.whatsapp) : null;
  return casca(d.fazenda, `<section class="tanque-card tdet">
      <header class="td-topo"><div><h1 class="td-nome">${esc(d.tanque)}</h1><p class="td-sub">${sub}</p></div>${lotes.length ? (ag ? ag.tag : '') : '<span class="tag"><i></i>Em preparo</span>'}</header>
      ${lotes.length ? '' : '<div class="pub-resumo"><span>Entre um ciclo e outro</span><b>Tanque em preparo para receber peixes novos</b></div>'}
      ${ag && lotes.length ? `<div class="pub-resumo"><span>Água${ag.quando ? ` · medida ${ag.quando}` : ''}</span><b>${esc(ag.resumo)}</b></div>` : ''}
      ${blocos.map((b) => b.hero).join('')}
    </section>
    ${lotes.length ? '' : '<div class="card"><p style="margin:0">Quando o tanque for povoado de novo, esta página passa a mostrar os peixes novos sozinha, sem trocar a placa.</p></div>'}
    ${blocos.map((b) => b.grafico).join('')}
    ${temTecnico ? `<details class="card form-dobra"><summary><span><b>Dados técnicos</b><small style="display:block">${[ag && ag.linhas && 'Água', tecnicoCresc && 'Crescimento'].filter(Boolean).join(' e ')}</small></span></summary><div class="form">
      ${ag && ag.linhas ? `<p class="sub-bloco">Água · ${ag.quando}</p><ul class="lista">${ag.linhas}</ul>` : ''}
      ${tecnicoCresc ? `<p class="sub-bloco">Crescimento</p><ul class="lista">${tecnicoCresc}</ul>` : ''}
      ${ag && ag.linhas && tambaqui ? '<p class="fonte">Faixas da água: Embrapa Amazônia Oriental, cartilha "Criação de tambaqui" (2018). São as mesmas que o PisciApp usa nos alertas da fazenda.</p>' : ''}
    </div></details>` : ''}
    ${fasesCard}
    ${w ? `<div class="card"><h3>Quer saber mais?</h3><p class="mudo" style="margin:.3rem 0 .8rem">Fale com a equipe da fazenda: ${esc(w.txt)}</p><a class="btn primario grande" href="${esc(w.href)}" target="_blank" rel="noopener">Falar no WhatsApp</a></div>` : ''}
    ${rodape(d.fazenda)}`);
}

const erroHtml = (titulo, texto) => casca('', `<div class="card vazio"><h2 style="margin-top:0">${esc(titulo)}</h2><p>${esc(texto)}</p><button class="btn" type="button" data-recarregar>Tentar de novo</button></div>`);

export async function iniciarPlaca(raiz = document.getElementById('root')) {
  const codigo = codigoDaUrl();
  if (!codigo) { raiz.innerHTML = htmlPlaca(null); return; }
  const carregar = async () => {
    try {
      const d = await buscarPlaca(codigo);
      raiz.innerHTML = htmlPlaca(d);
      if (d && d.disponivel) document.title = `${d.tanque} · ${d.fazenda}`;
    } catch (e) {
      raiz.innerHTML = !navigator.onLine || (e && !e.servidor)
        ? erroHtml('Sem conexão', 'Não foi possível buscar os dados do tanque. Confira a internet do celular e tente de novo.')
        : erroHtml('Não foi possível abrir agora', 'O sistema não respondeu. Tente de novo em alguns instantes.');
    }
    raiz.querySelectorAll('[data-recarregar]').forEach((b) => b.addEventListener('click', () => { raiz.innerHTML = '<p class="carregando">Atualizando…</p>'; carregar(); }));
  };
  await carregar();
}

if (typeof document !== 'undefined' && document.getElementById('root') && document.body.dataset.pagina === 'placa') iniciarPlaca();

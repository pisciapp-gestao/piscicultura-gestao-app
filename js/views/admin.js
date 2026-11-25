// Painel do administrador do SISTEMA (sql/15): todas as fazendas, cobranças e pacotes.
// Só aparece para quem está na tabela administradores; o banco confere de novo em cada ação.
import { confirmar, formulario } from '../dialogo.js';
import { icone } from '../icons.js';
import { esc, fmtData, fmtBRL, fmtInt, fmtNum, num, numDecimal, numMoeda, moedaCampo, plural, hojeISO } from '../util.js';
import { resumoPeriodo, acertoSocios, situacaoCliente, receitaMensal, limitesMes, documentoValido, fmtDocumento } from '../financeiro.js';

const ESTADO = {
  teste: ['Em teste', 'ok'], teste_acabou: ['Teste acabou', 'erro'], ativo: ['Pagante', 'ok'],
  carencia: ['Em carência', 'alerta'], vencido: ['Vencido', 'erro'], livre: ['Sem limite', ''],
};
const FILTROS = [['todas', 'Todas'], ['teste', 'Em teste'], ['ativo', 'Pagantes'], ['atencao', 'Vencidas'], ['livre', 'Sem limite'], ['bloqueada', 'Bloqueadas'], ['semdoc', 'Sem CPF/CNPJ']];
const diasAte = (iso) => Math.round((Date.parse(String(iso).slice(0, 10)) - Date.parse(hojeISO())) / 864e5);
const desde = (iso) => { if (!iso) return 'nunca lançou ração'; const d = -diasAte(iso); return d <= 0 ? 'lançou ração hoje' : d === 1 ? 'lançou ração ontem' : `lançou ração há ${d} dias`; };
const TIPO_LANC = { receita: 'Receita', despesa: 'Despesa', retirada: 'Retirada' };
const CATEGORIAS_SISTEMA = [['', 'Sem categoria'], ['servidor', 'Servidor / banco de dados'], ['dominio', 'Domínio / site'], ['impostos', 'Impostos'], ['marketing', 'Divulgação'], ['implantacao', 'Implantação / treinamento'], ['outros', 'Outros']];
const ROT_CAT = Object.fromEntries(CATEGORIAS_SISTEMA);

const horaDe = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export const situacaoFazenda = (f) => situacao(f);
// Entrar como suporte (sql/34) pedindo o motivo, que o dono vê. Usado no painel e na tela Fazendas dos clientes.
export async function pedirEntrarSuporte(ctx, f) {
  const v = await formulario({
    titulo: `Entrar na ${f.nome} como suporte?`,
    texto: 'Você vê e pode alterar tudo como o dono: tanques, lotes, lançamentos, estoque, equipe e vendas. Tudo o que fizer fica no histórico da fazenda com o seu nome e "(suporte)", e o dono vê quem entrou. Vale por 2 horas. Use quando o cliente pedir ajuda.',
    campos: [{ nome: 'motivo', rotulo: 'Motivo (o dono vê)', tipo: 'text', valor: '', maxlength: '120', placeholder: 'Ex.: cliente pediu ajuda com o estoque' }],
    validar: (x) => (String(x.motivo || '').trim().length >= 3 ? null : 'Escreva o motivo (o dono vê).'),
    ok: 'Entrar como suporte',
  });
  if (!v) return false;
  return ctx.entrarSuporte(f.id, v.motivo.trim());
}

function situacao(f) {
  if (f.bloqueada) return { rotulo: 'Bloqueada', classe: 'erro', grupo: 'bloqueada' };
  const p = f.plano || {}; const [rotulo, classe] = ESTADO[p.estado] || ['—', ''];
  const grupo = p.estado === 'teste' ? 'teste' : p.estado === 'ativo' ? 'ativo' : ['carencia', 'vencido', 'teste_acabou'].includes(p.estado) ? 'atencao' : p.estado === 'livre' ? 'livre' : 'outra';
  return { rotulo, classe, grupo };
}

export async function renderAdmin(ctx, el, aba = 'fazendas', estado = { filtro: 'todas', busca: '' }) {
  if (!estado.mes) estado.mes = hojeISO().slice(0, 7);
  if (!ctx.state.admin) { el.innerHTML = '<div class="card vazio">Somente administradores do sistema.</div>'; return; }
  el.innerHTML = `<h1>Administração</h1><p class="carregando">Carregando…</p>`;
  if (!navigator.onLine) { el.innerHTML = `<h1>Administração</h1><div class="card vazio">Precisa de internet.</div>`; return; }
  const [fazendas, cobrancas, pacotes, config, fin] = await Promise.all([
    ctx.api.adminFazendas(), ctx.api.adminCobrancas(), ctx.api.adminPacotes(), ctx.api.adminConfig(),
    aba === 'financeiro' ? ctx.api.adminFinanceiro() : Promise.resolve(undefined),
  ]);
  const pendentes = cobrancas.filter((c) => c.status === 'pendente');
  const conta = (g) => fazendas.filter((f) => situacao(f).grupo === g).length;
  const recarregar = (novaAba = aba) => renderAdmin(ctx, el, novaAba, estado);

  const validade = (f) => { const p = f.plano || {}; return f.bloqueada ? '' : p.valido_ate ? ` até ${fmtData(p.valido_ate)}` : ''; };
  const parada = (f) => !f.bloqueada && (f.ultimo_lancamento ? -diasAte(f.ultimo_lancamento) >= 7 : -diasAte(f.criado_em) >= 7);
  const atencao = () => {
    const a = [];
    const item = (classe, titulo, texto, botao) => `<div class="adm-alerta ${classe}"><div><b>${titulo}</b><small>${texto}</small></div>${botao}</div>`;
    const abrir = (f, t = 'Abrir') => `<button class="btn mini" type="button" data-abrir="${esc(f.id)}">${t}</button>`;
    if (config.modo_piloto) a.push(item('alerta', 'Modo piloto ligado', 'Quem contrata um pacote usa 12 meses de graça. Desligue antes do primeiro cliente pagante.', '<button class="btn mini" type="button" data-ir-aba="pacotes">Ver</button>'));
    if (pendentes.length) a.push(item('alerta', `${plural(pendentes.length, 'cobrança esperando', 'cobranças esperando')} confirmação`, pendentes.map((c) => `${esc(c.fazenda)}: ${fmtBRL(c.valor)}`).join(' · ') + '. Confira se o dinheiro entrou.', '<button class="btn mini" type="button" data-ir-aba="cobrancas">Ver</button>'));
    for (const f of fazendas) {
      const p = f.plano || {};
      if (f.bloqueada) continue;
      if (['vencido', 'carencia', 'teste_acabou'].includes(p.estado)) a.push(item('erro', `${esc(f.nome)}: ${p.estado === 'teste_acabou' ? 'teste acabou' : 'mensalidade vencida'}`, `${p.valido_ate ? `Desde ${fmtData(p.valido_ate)}. ` : ''}Cobre ou bloqueie.`, abrir(f)));
      else if (p.estado === 'teste' && p.valido_ate && diasAte(p.valido_ate) >= 0 && diasAte(p.valido_ate) <= 3) a.push(item('alerta', `${esc(f.nome)}: teste acaba em ${plural(diasAte(p.valido_ate), 'dia', 'dias')}`, 'Bom momento para ligar e oferecer o plano.', abrir(f)));
      if (parada(f) && f.tanques) a.push(item('alerta', `${esc(f.nome)}: parada`, `${desde(f.ultimo_lancamento)[0].toUpperCase()}${desde(f.ultimo_lancamento).slice(1)}. Ligue para saber se precisa de ajuda.`, abrir(f)));
    }
    const semdoc = fazendas.filter((f) => !f.documento).length;
    if (semdoc) a.push(item('alerta', `${plural(semdoc, 'fazenda', 'fazendas')} sem CPF/CNPJ`, 'Sem o documento, a mesma pessoa pode fazer outro teste grátis.', '<button class="btn mini" type="button" data-filtro="semdoc">Ver</button>'));
    return a;
  };
  const abaFazendas = () => {
    const f = estado.aberta && fazendas.find((x) => x.id === estado.aberta);
    if (f) return fichaFazenda(f);
    const at = atencao();
    return `
      <div class="kpis adm-kpis">
        <div class="kpi"><span>Fazendas</span><b>${fazendas.length}</b></div>
        <div class="kpi"><span>Em teste</span><b>${conta('teste')}</b></div>
        <div class="kpi"><span>Pagantes</span><b>${conta('ativo')}</b></div>
        <div class="kpi"><span>Vencidas / bloqueadas</span><b>${conta('atencao') + conta('bloqueada')}</b></div>
      </div>
      <h2>Precisa de atenção <span class="contagem">${at.length}</span></h2>
      ${at.length ? `<div class="adm-alertas">${at.join('')}</div>` : '<p class="mudo nota">Tudo certo por aqui.</p>'}
      <h2>Clientes</h2>
      <label class="adm-busca">Procurar <input id="adm-busca" type="search" placeholder="Fazenda, dono, e-mail ou CPF/CNPJ" value="${esc(estado.busca)}"></label>
      <div class="adm-filtros">${FILTROS.map(([k, r]) => `<button type="button" class="chip${estado.filtro === k ? ' on' : ''}" data-filtro="${k}">${r}</button>`).join('')}</div>
      <div id="adm-lista">${listaFazendas()}</div>`;
  };
  const listaFazendas = () => {
    const termo = estado.busca.trim().toLowerCase();
    const lista = fazendas.filter((f) => (estado.filtro === 'todas' || (estado.filtro === 'semdoc' ? !f.documento : situacao(f).grupo === estado.filtro))
      && (!termo || [f.nome, f.dono_nome, f.dono_email].some((x) => String(x || '').toLowerCase().includes(termo))
        || (termo.replace(/\D/g, '').length >= 3 && String(f.documento || '').includes(termo.replace(/\D/g, '')))));
    return lista.length ? `<div class="card adm-lista">${lista.map((f) => {
        const s = situacao(f), p = f.plano || {};
        return `<button type="button" class="adm-faz adm-linha" data-abrir="${esc(f.id)}">
          <span class="esq"><b>${esc(f.nome)}</b>
            <small>${esc(f.dono_nome || 'sem dono')}${f.dono_email ? ` · ${esc(f.dono_email)}` : ''}</small>
            <small>${plural(f.tanques, 'tanque', 'tanques')}, ${fmtInt(p.em_uso || 0)} em uso${p.limite ? ` de ${p.limite}` : ''} · ${desde(f.ultimo_lancamento)}</small>
            <small>CPF/CNPJ: ${f.documento ? esc(fmtDocumento(f.documento)) : '<b class="adm-semdoc">não informado</b>'}</small></span>
          <span class="tag ${s.classe}">${esc(s.rotulo)}${esc(validade(f))}</span><span class="seta">${icone('direita', 20)}</span>
        </button>`;
      }).join('')}</div>` : '<div class="card vazio">Nenhuma fazenda neste filtro.</div>';
  };
  const fichaFazenda = (f) => {
    const s = situacao(f), p = f.plano || {}, cob = pendentes.find((c) => c.fazenda_id === f.id);
    const acaoLi = (attr, titulo, sub, extra = '') => `<li><button type="button" class="adm-acao${extra}" ${attr}><span class="esq"><b>${titulo}</b><small>${sub}</small></span><span class="seta">${icone('direita', 20)}</span></button></li>`;
    return `
      <button type="button" class="link adm-voltar" data-fechar-ficha>‹ Todas as fazendas</button>
      <div class="card adm-ficha">
        <header><h2>${esc(f.nome)}</h2><span class="tag ${s.classe}">${esc(s.rotulo)}${esc(validade(f))}</span></header>
        <dl class="adm-dados">
          <div><dt>Dono</dt><dd>${esc(f.dono_nome || '—')}</dd></div>
          <div><dt>E-mail</dt><dd>${esc(f.dono_email || '—')}</dd></div>
          <div><dt>CPF/CNPJ</dt><dd>${f.documento ? esc(fmtDocumento(f.documento)) : '<b class="adm-semdoc">não informado</b>'}</dd></div>
          <div><dt>Entrou em</dt><dd>${fmtData(f.criado_em)}</dd></div>
          <div><dt>Pessoas</dt><dd>${fmtInt(f.pessoas)}</dd></div>
          <div><dt>Tanques</dt><dd>${fmtInt(f.tanques)}, ${fmtInt(p.em_uso || 0)} em uso${p.limite ? ` de ${p.limite}` : ' (sem limite)'}</dd></div>
          <div><dt>Último lançamento de ração</dt><dd>${f.ultimo_lancamento ? fmtData(f.ultimo_lancamento) : 'nenhum'}</dd></div>
        </dl>
      </div>
      ${cob ? `<div class="adm-alerta alerta"><div><b>Cobrança esperando: ${fmtBRL(cob.valor)}</b><small>Pacote de ${fmtInt(cob.tanques_max)} tanques, pedido em ${fmtData(cob.criada_em)}.</small></div><button class="btn mini" type="button" data-ir-aba="cobrancas">Ver</button></div>` : ''}
      <h2>Ações</h2>
      <div class="card"><ul class="lista adm-acoes">
        ${acaoLi(`data-suporte="${esc(f.id)}"`, 'Entrar como suporte', 'Ver e alterar tudo como o dono, por 2 horas. Fica no histórico da fazenda', ' adm-principal')}
        ${acaoLi(`data-estender="${esc(f.id)}"`, p.estado === 'livre' ? 'Dar prazo de teste' : 'Estender teste', 'Mais dias de uso grátis')}
        ${acaoLi(`data-documento="${esc(f.id)}"`, f.documento ? 'Corrigir CPF/CNPJ' : 'Informar CPF/CNPJ', 'Um teste grátis por documento')}
        ${acaoLi(`data-desconectar-dono="${esc(f.id)}"`, 'Desconectar celular do dono', 'Perdeu o celular? Sai da conta em todos os aparelhos')}
        ${f.bloqueada ? acaoLi(`data-liberar="${esc(f.id)}"`, 'Liberar a fazenda', 'Volta a funcionar como antes')
          : acaoLi(`data-bloquear="${esc(f.id)}"`, 'Bloquear a fazenda', 'Ninguém vê nem lança até liberar. Os dados ficam guardados', ' perigo')}
      </ul></div>
      <h2>Acessos do suporte</h2>
      <div class="card" id="adm-acessos"><p class="mudo" style="margin:0">Carregando…</p></div>`;
  };

  const abaCobrancas = () => `
    <h2>Pendentes <span class="contagem">${pendentes.length}</span></h2>
    ${pendentes.length ? pendentes.map((c) => `<article class="card adm-cob">
        <header><b>${esc(c.fazenda)}</b><b>${fmtBRL(c.valor)}</b></header>
        <small>Pacote de ${fmtInt(c.tanques_max)} tanques · pedido em ${fmtData(c.criada_em)}${c.origem ? ` · ${esc(c.origem)}` : ''}</small>
        <div class="acoes"><button class="btn mini primario" data-pagar="${esc(c.id)}" type="button">Marcar como paga</button></div>
      </article>`).join('') : '<div class="card vazio">Nenhuma cobrança pendente.</div>'}
    <h2>Últimos 60 dias</h2>
    <div class="card">${cobrancas.filter((c) => c.status !== 'pendente').length ? `<ul class="lista">${cobrancas.filter((c) => c.status !== 'pendente').map((c) => `
      <li><div class="esq"><b>${esc(c.fazenda)}</b><small>${fmtInt(c.tanques_max)} tanques · ${fmtBRL(c.valor)} · ${c.status === 'paga' ? `paga em ${fmtData(c.paga_em)}` : 'cancelada'}</small></div>
      <span class="tag ${c.status === 'paga' ? 'ok' : ''}">${c.status === 'paga' ? 'Paga' : 'Cancelada'}</span></li>`).join('')}</ul>` : '<p class="mudo" style="margin:0">Nada nos últimos 60 dias.</p>'}</div>`;

  const abaPacotes = () => `
    <div class="card adm-piloto${config.modo_piloto ? ' ligado' : ''}">
      <b>Modo piloto: ${config.modo_piloto ? 'LIGADO' : 'desligado'}</b>
      <small>${config.modo_piloto ? 'Contratar um pacote libera 12 meses na hora, sem cobrar. Desligue antes de ter cliente pagante.' : 'Contratar um pacote cria uma cobrança pendente; ela libera o pacote quando for marcada como paga.'}</small>
      <div class="acoes"><button class="btn mini ${config.modo_piloto ? 'perigo' : ''}" id="b-piloto" type="button">${config.modo_piloto ? 'Desligar modo piloto' : 'Ligar modo piloto'}</button></div>
    </div>
    <h2>Pacotes</h2>
    <div class="card"><ul class="lista">${pacotes.map((p) => `
      <li><div class="esq"><b>${esc(p.nome)}</b><small>até ${fmtInt(p.tanques_max)} tanques · ${fmtBRL(p.preco_mensal)} por mês</small></div>
        ${p.ativo ? '' : '<span class="tag">Inativo</span>'}<button class="btn mini" data-pacote="${p.tanques_max}" type="button">Editar</button></li>`).join('')}</ul>
      <div class="acoes"><button class="btn" id="b-novo-pacote" type="button">Novo pacote</button></div></div>
    <p class="mudo nota">Pacote inativo não aparece para os donos, mas quem já tem continua com ele.</p>`;

  const abaFinanceiro = () => {
    if (fin === null) return '<div class="card vazio">O financeiro precisa do <b>sql/32</b> rodado no banco.</div>';
    const { ini, fim } = limitesMes(estado.mes);
    const mes = resumoPeriodo({ lancamentos: fin.lancamentos, recebimentos: fin.recebimentos, ini, fim });
    const ac = acertoSocios({ lancamentos: fin.lancamentos, recebimentos: fin.recebimentos, socios: fin.socios });
    const nomeSocio = (id) => (fin.socios.find((x) => x.id === id) || {}).nome || '';
    const doMes = [
      ...fin.recebimentos.filter((r) => r.data >= ini && r.data <= fim).map((r) => ({ ...r, tipo: 'cobranca' })),
      ...fin.lancamentos.filter((l) => l.data >= ini && l.data <= fim),
    ].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
    const linhaLanc = (l) => {
      if (l.tipo === 'cobranca') return `<li><div class="esq"><b>Mensalidade · ${esc(l.fazenda)}</b><small>${fmtData(l.data)} · ${plural(l.meses, 'mês', 'meses')} de ${fmtBRL(l.mensal)}</small></div><b class="fin-mais">+ ${fmtBRL(l.valor)}</b></li>`;
      const sinal = l.tipo === 'receita' ? '+' : '−';
      const quem = l.tipo === 'despesa' ? (l.socio_id ? ` · paga por ${esc(nomeSocio(l.socio_id))}` : ' · paga pelo caixa') : l.tipo === 'retirada' ? ` · ${esc(nomeSocio(l.socio_id))}` : l.fazenda ? ` · ${esc(l.fazenda)}` : '';
      return `<li><div class="esq"><b>${TIPO_LANC[l.tipo]}${l.categoria ? ` · ${esc(ROT_CAT[l.categoria] || l.categoria)}` : ''}</b>
        <small>${fmtData(l.data)}${quem}${l.descricao ? ` · ${esc(l.descricao)}` : ''}</small></div>
        <b class="${l.tipo === 'receita' ? 'fin-mais' : 'fin-menos'}">${sinal} ${fmtBRL(l.valor)}</b>
        <button class="btn mini" data-lanc="${esc(l.id)}" type="button">Abrir</button></li>`;
    };
    const hoje = fin.hoje || hojeISO();
    return `
      ${fin.modo_piloto ? `<div class="card adm-piloto ligado"><b>Modo piloto LIGADO</b><small>Quem contrata um pacote usa 12 meses de graça. Desligue na aba Pacotes antes do primeiro cliente pagante.</small></div>` : ''}
      ${fin.sem_limite ? `<div class="card adm-piloto ligado"><b>${plural(fin.sem_limite, 'fazenda sem limite nenhum', 'fazendas sem limite nenhum')}</b><small>Fazendas antigas, de antes do teste grátis: usam quantos tanques quiserem sem pagar. Veja em Fazendas > Sem limite e use "Dar prazo de teste" para começar a cobrar.</small></div>` : ''}
      <label class="adm-busca">Mês <input id="fin-mes" type="month" value="${esc(estado.mes)}" max="${esc(hoje.slice(0, 7))}"></label>
      <div class="kpis adm-kpis">
        <div class="kpi"><span>Entrou no mês</span><b>${fmtBRL(mes.receitas)}</b></div>
        <div class="kpi"><span>Despesas no mês</span><b>${fmtBRL(mes.despesas)}</b></div>
        <div class="kpi"><span>Resultado do mês</span><b class="${mes.resultado < 0 ? 'fin-menos' : ''}">${fmtBRL(mes.resultado)}</b></div>
        <div class="kpi"><span>Mensalidades em dia</span><b>${fmtBRL(receitaMensal(fin.clientes, hoje))}</b></div>
      </div>
      ${Number(fin.pendentes) > 0 ? `<p class="mudo nota">Cobranças pendentes, ainda não pagas: <b>${fmtBRL(fin.pendentes)}</b> (aba Cobranças).</p>` : ''}

      <h2>Acerto entre sócios <small class="mudo">desde o começo</small></h2>
      <div class="card"><ul class="lista">${ac.socios.map((x) => `
        <li><div class="esq"><b>${esc(x.nome)} · ${fmtNum(x.percentual, x.percentual % 1 ? 2 : 0)}%${x.ativo ? '' : ' (inativo)'}</b>
          <small>Parte do resultado ${fmtBRL(x.parte)} · pagou do bolso ${fmtBRL(x.pagou)} · já retirou ${fmtBRL(x.retirou)}</small>
          <small>${x.saldo >= 0 ? 'Tem a receber' : 'Retirou a mais'}: <b class="${x.saldo < 0 ? 'fin-menos' : ''}">${fmtBRL(Math.abs(x.saldo))}</b></small></div></li>`).join('')}
        <li><div class="esq"><b>Caixa: ${fmtBRL(ac.caixa)}</b><small>O que deveria estar guardado: entradas − despesas pagas pelo caixa − retiradas</small></div></li></ul>
        <div class="acoes"><button class="btn mini" id="b-socios" type="button">Sócios e divisão</button></div></div>

      <h2>Clientes pagantes <span class="contagem">${fin.clientes.length}</span></h2>
      ${fin.clientes.length ? `<div class="card"><ul class="lista">${fin.clientes.map((c) => { const st = c.bloqueada ? { rotulo: 'Bloqueada', classe: 'erro' } : situacaoCliente(c.pago_ate, hoje); return `
        <li><div class="esq"><b>${esc(c.fazenda)}</b><small>${c.documento ? `${esc(fmtDocumento(c.documento))} · ` : ''}${fmtBRL(c.mensal)} por mês · ${fmtInt(c.tanques)} tanques · pago até ${fmtData(c.pago_ate)}</small></div>
        <span class="tag ${st.classe}">${esc(st.rotulo)}</span></li>`; }).join('')}</ul></div>` : '<div class="card vazio">Nenhum cliente pagou ainda (as liberações do modo piloto não contam).</div>'}

      <h2>Movimento do mês</h2>
      <div class="card">${doMes.length ? `<ul class="lista">${doMes.map(linhaLanc).join('')}</ul>` : '<p class="mudo" style="margin:0">Nada neste mês.</p>'}
        <div class="acoes"><button class="btn primario" id="b-novo-lanc" type="button">Novo lançamento</button></div></div>
      <p class="mudo nota">Mensalidades entram sozinhas quando a cobrança é marcada como paga. Lance aqui o resto: despesas do sistema (diga quem pagou), retiradas de cada sócio e receitas fora do app.</p>`;
  };

  el.innerHTML = `
    <h1>Administração</h1>
    <div class="seg" style="--n:4" role="tablist">
      <button type="button" data-aba="fazendas" class="${aba === 'fazendas' ? 'on' : ''}">Fazendas</button>
      <button type="button" data-aba="cobrancas" class="${aba === 'cobrancas' ? 'on' : ''}">Cobranças${pendentes.length ? ` (${pendentes.length})` : ''}</button>
      <button type="button" data-aba="pacotes" class="${aba === 'pacotes' ? 'on' : ''}">Pacotes</button>
      <button type="button" data-aba="financeiro" class="${aba === 'financeiro' ? 'on' : ''}">Financeiro</button>
    </div>
    <div id="adm-corpo">${aba === 'cobrancas' ? abaCobrancas() : aba === 'pacotes' ? abaPacotes() : aba === 'financeiro' ? abaFinanceiro() : abaFazendas()}</div>`;

  el.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => recarregar(b.dataset.aba)));
  const acao = async (fn, msg) => { try { const r = await fn(); ctx.toast(typeof msg === 'function' ? msg(r) : msg, 'ok'); recarregar(); } catch (e) { ctx.toast(e.message, 'erro'); } };
  const fazPor = (id) => fazendas.find((f) => f.id === id);

  // ---- fazendas ----
  // busca e filtros redesenham só a lista (o campo de busca fica, com o cursor onde estava)
  const redesenharLista = () => { el.querySelector('#adm-lista').innerHTML = listaFazendas(); ligarFazendas(); };
  const busca = el.querySelector('#adm-busca');
  if (busca) busca.addEventListener('input', () => { estado.busca = busca.value; redesenharLista(); });
  el.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => {
    estado.filtro = b.dataset.filtro;
    el.querySelectorAll('.adm-filtros [data-filtro]').forEach((x) => x.classList.toggle('on', x.dataset.filtro === estado.filtro));
    redesenharLista();
  }));
  function ligarFazendas() {
    el.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => { estado.aberta = b.dataset.abrir; recarregar('fazendas'); window.scrollTo(0, 0); }));
    el.querySelectorAll('[data-fechar-ficha]').forEach((b) => b.addEventListener('click', () => { estado.aberta = null; recarregar('fazendas'); }));
    el.querySelectorAll('[data-ir-aba]').forEach((b) => b.addEventListener('click', () => { estado.aberta = null; recarregar(b.dataset.irAba); }));
    const caixaAcessos = el.querySelector('#adm-acessos');
    if (caixaAcessos && estado.aberta) ctx.api.acessosSuporte(estado.aberta).then((l) => {
      caixaAcessos.innerHTML = l.length ? `<ul class="lista registros">${l.map((a) => `<li><div class="esq"><b>${esc(a.quem)}</b><small>${fmtData(a.inicio)} ${horaDe(a.inicio)}–${horaDe(a.fim)}${a.motivo ? ` · ${esc(a.motivo)}` : ''}</small></div></li>`).join('')}</ul>` : '<p class="mudo" style="margin:0">Ninguém do suporte entrou nesta fazenda.</p>';
    }).catch(() => { caixaAcessos.innerHTML = '<p class="mudo" style="margin:0">Não deu para carregar os acessos agora.</p>'; });
    el.querySelectorAll('[data-estender]').forEach((b) => b.addEventListener('click', async () => {
      const f = fazPor(b.dataset.estender);
      const v = await formulario({
        titulo: `Estender teste: ${f.nome}`, texto: f.teste_ate ? `O teste vai até ${fmtData(f.teste_ate)}. Os dias somam a partir do que falta (ou de hoje, se já acabou).` : 'Esta fazenda não tem teste grátis; os dias contam a partir de hoje.',
        campos: [{ nome: 'dias', rotulo: 'Quantos dias a mais?', tipo: 'number', valor: 15, step: '1', min: '1', max: '365', inputmode: 'numeric' }],
        validar: (x) => (Number.isInteger(num(x.dias)) && num(x.dias) >= 1 && num(x.dias) <= 365 ? null : 'Informe de 1 a 365 dias.'),
        ok: 'Estender',
      });
      if (v) acao(() => ctx.api.adminEstenderTeste(f.id, num(v.dias)), (ate) => `Teste estendido até ${fmtData(ate)}`);
    }));
    el.querySelectorAll('[data-documento]').forEach((b) => b.addEventListener('click', async () => {
      const f = fazPor(b.dataset.documento);
      const v = await formulario({
        titulo: `CPF/CNPJ: ${f.nome}`, texto: 'Do dono ou da fazenda. Este número passa a contar como teste grátis já usado.',
        campos: [{ nome: 'doc', rotulo: 'CPF ou CNPJ', tipo: 'text', valor: f.documento ? fmtDocumento(f.documento) : '', inputmode: 'numeric', maxlength: '18' }],
        validar: (x) => (documentoValido(x.doc) ? null : 'CPF ou CNPJ inválido. Confira os números.'),
      });
      if (v) acao(() => ctx.api.adminDefinirDocumento(f.id, v.doc.replace(/\D/g, '')), 'CPF/CNPJ salvo');
    }));
    el.querySelectorAll('[data-bloquear]').forEach((b) => b.addEventListener('click', async () => {
      const f = fazPor(b.dataset.bloquear);
      if (!(await confirmar({ titulo: `Bloquear ${f.nome}?`, texto: 'Ninguém desta fazenda consegue ver nem lançar nada até você liberar. Os dados continuam guardados.', ok: 'Bloquear', perigo: true, digitar: f.nome }))) return;
      acao(() => ctx.api.adminBloquear(f.id, true), 'Fazenda bloqueada');
    }));
    // suporte (sql/34): entra na fazenda do cliente e vê/altera tudo como o dono, por até 2 horas
    el.querySelectorAll('[data-suporte]').forEach((b) => b.addEventListener('click', async () => {
      const f = fazPor(b.dataset.suporte);
      b.disabled = true;
      try { if (!(await pedirEntrarSuporte(ctx, f))) b.disabled = false; } catch (e) { ctx.toast(e.message, 'erro'); b.disabled = false; }
    }));
    el.querySelectorAll('[data-acessos]').forEach((b) => b.addEventListener('click', async () => {
      const f = fazPor(b.dataset.acessos);
      b.disabled = true;
      try {
        const l = await ctx.api.acessosSuporte(f.id);
        const card = b.closest('article'); card.querySelector('.adm-acessos')?.remove();
        card.insertAdjacentHTML('beforeend', `<div class="adm-acessos"><b>Acessos do suporte</b>${l.length ? `<ul class="lista">${l.map((a) => `<li><div class="esq"><b>${esc(a.quem)}</b><small>${fmtData(a.inicio)} ${horaDe(a.inicio)}–${horaDe(a.fim)}${a.motivo ? ` · ${esc(a.motivo)}` : ''}</small></div></li>`).join('')}</ul>` : '<p class="mudo" style="margin:0">Ninguém do suporte entrou nesta fazenda.</p>'}</div>`);
      } catch (e) { ctx.toast(e.message, 'erro'); } finally { b.disabled = false; }
    }));
    // o dono perdeu o celular e ligou para o suporte: tira a conta dele de todos os aparelhos
    el.querySelectorAll('[data-desconectar-dono]').forEach((b) => b.addEventListener('click', async () => {
      const f = fazPor(b.dataset.desconectarDono);
      if (!(await confirmar({ titulo: `Desconectar o celular do dono de ${f.nome}?`, texto: `${f.dono_nome || 'O dono'} sai da conta em todos os aparelhos (o perdido apaga os números quando pegar sinal). Ele entra de novo no celular novo com o e-mail e a senha; se esqueceu a senha, usa "Esqueci a senha".`, ok: 'Desconectar', perigo: true }))) return;
      acao(() => ctx.api.adminDesconectarDono(f.id), (n) => (n ? `${n === 1 ? '1 aparelho desconectado' : `${n} aparelhos desconectados`}` : 'Nenhum aparelho do dono estava conectado'));
    }));
    el.querySelectorAll('[data-liberar]').forEach((b) => b.addEventListener('click', async () => {
      const f = fazPor(b.dataset.liberar);
      if (!(await confirmar({ titulo: `Liberar ${f.nome}?`, texto: 'A fazenda volta a funcionar como antes.', ok: 'Liberar' }))) return;
      acao(() => ctx.api.adminBloquear(f.id, false), 'Fazenda liberada');
    }));
  }
  ligarFazendas();

  // ---- cobranças ----
  el.querySelectorAll('[data-pagar]').forEach((b) => b.addEventListener('click', async () => {
    const c = cobrancas.find((x) => x.id === b.dataset.pagar);
    const v = await formulario({
      titulo: `Marcar como paga: ${c.fazenda}`, texto: `Pacote de ${c.tanques_max} tanques, ${fmtBRL(c.valor)} por mês. Confira se o dinheiro entrou antes de confirmar.`,
      campos: [{ nome: 'meses', rotulo: 'Quantos meses foram pagos?', tipo: 'number', valor: c.meses || 1, step: '1', min: '1', max: '24', inputmode: 'numeric' }],
      validar: (x) => (Number.isInteger(num(x.meses)) && num(x.meses) >= 1 && num(x.meses) <= 24 ? null : 'Informe de 1 a 24 meses.'),
      ok: 'Confirmar pagamento',
    });
    if (v) acao(() => ctx.api.adminConfirmarPagamento(c.id, num(v.meses)), 'Pagamento confirmado: pacote liberado');
  }));

  // ---- pacotes ----
  const bp = el.querySelector('#b-piloto');
  if (bp) bp.addEventListener('click', async () => {
    const ligar = !config.modo_piloto;
    if (!(await confirmar({ titulo: ligar ? 'Ligar o modo piloto?' : 'Desligar o modo piloto?', texto: ligar ? 'Contratar um pacote volta a liberar 12 meses na hora, sem cobrança.' : 'A partir de agora, contratar um pacote cria uma cobrança pendente, que só libera quando você marcar como paga (ou quando o pagamento automático existir).', ok: ligar ? 'Ligar' : 'Desligar', perigo: ligar }))) return;
    acao(() => ctx.api.adminDefinirPiloto(ligar), ligar ? 'Modo piloto ligado' : 'Modo piloto desligado');
  });
  const editarPacote = async (p) => {
    const novo = !p;
    const v = await formulario({
      titulo: novo ? 'Novo pacote' : `Editar: ${p.nome}`,
      campos: [
        ...(novo ? [{ nome: 'tanques', rotulo: 'Até quantos tanques?', tipo: 'number', step: '1', min: '1', inputmode: 'numeric' }] : []),
        { nome: 'nome', rotulo: 'Nome', tipo: 'text', valor: novo ? '' : p.nome, maxlength: '60' },
        { nome: 'preco', rotulo: 'Preço por mês (R$)', tipo: 'number', valor: novo ? '' : p.preco_mensal, step: '0.01', min: '0', inputmode: 'decimal' },
        { nome: 'ativo', rotulo: 'Aparece para os donos?', tipo: 'select', valor: novo || p.ativo ? 'sim' : 'nao', opcoes: [['sim', 'Sim, ativo'], ['nao', 'Não, inativo']] },
      ],
      validar: (x) => (novo && !(Number.isInteger(num(x.tanques)) && num(x.tanques) >= 1) ? 'Informe até quantos tanques (número inteiro).'
        : novo && pacotes.some((q) => q.tanques_max === num(x.tanques)) ? 'Já existe um pacote com esse número de tanques: use Editar.'
        : !x.nome.trim() ? 'Informe o nome.' : !(num(x.preco) >= 0) ? 'Informe o preço.' : null),
    });
    if (v) acao(() => ctx.api.adminSalvarPacote({ tanques_max: novo ? num(v.tanques) : p.tanques_max, nome: v.nome.trim(), preco: num(v.preco), ativo: v.ativo === 'sim' }), 'Pacote salvo');
  };
  el.querySelectorAll('[data-pacote]').forEach((b) => b.addEventListener('click', () => editarPacote(pacotes.find((p) => p.tanques_max === Number(b.dataset.pacote)))));
  const bn = el.querySelector('#b-novo-pacote'); if (bn) bn.addEventListener('click', () => editarPacote(null));

  // ---- financeiro ----
  if (aba !== 'financeiro' || !fin) return;
  const mesIn = el.querySelector('#fin-mes');
  mesIn.addEventListener('change', () => { if (/^\d{4}-\d{2}$/.test(mesIn.value)) { estado.mes = mesIn.value; recarregar(); } });
  let salvando = false;
  const editarLanc = async (l) => {
    const novo = !l; const hoje = fin.hoje || hojeISO();
    const socios = fin.socios.filter((x) => x.ativo || (l && l.socio_id === x.id));
    const v = await formulario({
      titulo: novo ? 'Novo lançamento' : `Editar ${TIPO_LANC[l.tipo].toLowerCase()}`,
      campos: [
        { nome: 'tipo', rotulo: 'O que é?', tipo: 'select', valor: novo ? 'despesa' : l.tipo, opcoes: [['despesa', 'Despesa do sistema'], ['retirada', 'Retirada de sócio'], ['receita', 'Receita fora do app']] },
        { nome: 'data', rotulo: 'Data', tipo: 'date', valor: novo ? hoje : l.data, max: hoje },
        { nome: 'valor', rotulo: 'Valor', tipo: 'text', valor: novo ? '' : moedaCampo(l.valor), prefixo: 'R$', inputmode: 'decimal', maxlength: '16', placeholder: 'Ex.: 1.250,50' },
        { nome: 'socio', rotulo: 'Quem pagou / quem retirou', tipo: 'select', valor: novo ? '' : l.socio_id || '', opcoes: [['', 'O caixa (ou ninguém, na receita)'], ...socios.map((x) => [x.id, x.nome])] },
        { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', valor: novo ? '' : l.categoria || '', opcoes: CATEGORIAS_SISTEMA },
        { nome: 'fazenda', rotulo: 'Cliente (só na receita)', tipo: 'select', valor: novo ? '' : l.fazenda_id || '', opcoes: [['', 'Nenhum'], ...fazendas.map((f) => [f.id, f.nome])] },
        { nome: 'descricao', rotulo: 'Descrição', tipo: 'text', valor: novo ? '' : l.descricao || '', maxlength: '200' },
      ],
      validar: (x) => {
        const n = numMoeda(String(x.valor).trim());
        if (!(n > 0) || n >= 10000000) return 'Confira o valor. Ex.: 1.250,50';
        if (!x.data || x.data > hoje) return 'A data não pode ser no futuro.';
        if (x.tipo === 'retirada' && !x.socio) return 'Diga qual sócio retirou.';
        return null;
      },
    });
    if (!v || salvando) return;
    salvando = true;
    const dados = { id: novo ? '' : l.id, tipo: v.tipo, data: v.data, valor: numMoeda(String(v.valor).trim()), socio_id: v.tipo === 'receita' ? '' : v.socio,
      categoria: v.categoria, fazenda_id: v.tipo === 'receita' ? v.fazenda : '', descricao: v.descricao };
    try { await acao(() => ctx.api.adminSalvarLancamento(dados), 'Lançamento salvo'); } finally { salvando = false; }
  };
  el.querySelector('#b-novo-lanc').addEventListener('click', () => editarLanc(null));
  el.querySelectorAll('[data-lanc]').forEach((b) => b.addEventListener('click', async () => {
    const l = fin.lancamentos.find((x) => x.id === b.dataset.lanc);
    const o = await formulario({ titulo: `${TIPO_LANC[l.tipo]} de ${fmtBRL(l.valor)}`, texto: `${fmtData(l.data)}${l.descricao ? ` · ${l.descricao}` : ''}`,
      campos: [{ nome: 'o', rotulo: 'O que fazer?', tipo: 'select', valor: 'editar', opcoes: [['editar', 'Editar'], ['excluir', 'Excluir']] }], ok: 'Continuar' });
    if (!o) return;
    if (o.o === 'editar') { editarLanc(l); return; }
    if (await confirmar({ titulo: 'Excluir este lançamento?', texto: `${TIPO_LANC[l.tipo]} de ${fmtBRL(l.valor)} em ${fmtData(l.data)}. Fica registrado no histórico do administrador.`, ok: 'Excluir', perigo: true }))
      acao(() => ctx.api.adminExcluirLancamento(l.id), 'Lançamento excluído');
  }));
  el.querySelector('#b-socios').addEventListener('click', async () => {
    const lista = [...fin.socios, { id: '', nome: '', percentual: 0, ativo: true }];
    const pct = (x, i) => numDecimal(String(x[`p${i}`] || '').trim() || '0');
    const v = await formulario({
      titulo: 'Sócios e divisão', texto: 'Os percentuais precisam somar 100%. A divisão vale para todo o resultado, desde o começo. Sócio com 0% fica inativo. A última linha é para incluir alguém novo (deixe vazia se não for o caso).',
      campos: lista.flatMap((x, i) => [
        { nome: `n${i}`, rotulo: x.id ? `Sócio ${i + 1}` : 'Novo sócio (opcional)', tipo: 'text', valor: x.nome, maxlength: '60' },
        { nome: `p${i}`, rotulo: '% do resultado', tipo: 'text', valor: x.id ? String(x.percentual).replace('.', ',') : '', inputmode: 'decimal', maxlength: '6' },
      ]),
      validar: (x) => {
        let soma = 0;
        for (let i = 0; i < lista.length; i++) {
          const nome = String(x[`n${i}`] || '').trim();
          if (!lista[i].id && !nome) continue;
          if (nome.length < 2) return 'Informe o nome de cada sócio.';
          if (!(pct(x, i) >= 0 && pct(x, i) <= 100)) return 'Percentual de 0 a 100.';
          soma += pct(x, i);
        }
        return Math.abs(soma - 100) < 0.001 ? null : `Os percentuais precisam somar 100%. Hoje somam ${fmtNum(soma, 2)}%.`;
      },
    });
    if (!v) return;
    const dados = lista.map((x, i) => ({ id: x.id, nome: String(v[`n${i}`] || '').trim(), percentual: pct(v, i), ativo: pct(v, i) > 0 }))
      .filter((x) => x.id || x.nome);
    acao(() => ctx.api.adminSalvarSocios(dados), 'Sócios salvos');
  });
}

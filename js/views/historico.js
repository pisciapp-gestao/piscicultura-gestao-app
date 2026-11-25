// Histórico e lixeira (somente dono): o que foi excluído (com Restaurar) e o que foi alterado, por quem e quando.
// Precisa do sql/12. Os registros vêm da tabela historico, gravados por gatilhos no banco.
import { confirmar } from '../dialogo.js';
import { icone } from '../icons.js';
import { esc, fmtData, fmtNum, fmtInt, fmtBRL, ROTULO_PAPEL, ROTULO_TIPO, plural } from '../util.js';

// ordem de importância: o item "principal" de uma operação é o de nível mais alto (tanque > lote > lançamento)
const NIVEL = { tanques: 0, lotes: 1, racao_estoque: 2, racao_contagens: 2, biometrias: 3, mortalidade: 3, racao_consumo: 3, usuario_tanques: 4, usuarios: 4 };

const quando = (iso) => {
  const d = new Date(iso);
  return `${fmtData(iso)} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// descrição de um registro (como estava antes)
function descrever(h, nomeTanque, nomePessoa) {
  const a = h.antes || {};
  switch (h.tabela) {
    case 'tanques': return `Tanque ${a.nome || ''}`;
    case 'lotes': return `Lote de ${a.especie || 'peixe'} (${(ROTULO_TIPO[a.tipo] || a.tipo || '').toLowerCase()}) no ${nomeTanque(a.tanque_id)}, entrada em ${fmtData(a.data_entrada)}`;
    case 'racao_consumo': return `Ração: ${fmtNum(a.quantidade_kg, 1)} kg em ${fmtData(a.data)} no ${nomeTanque(a.tanque_id)}`;
    case 'biometrias': return `Biometria de ${fmtData(a.data)}: ${fmtInt(a.quantidade_amostrada)} peixes, ${fmtNum(a.peso_amostra_kg, 3)} kg`;
    case 'mortalidade': return `Mortalidade: ${fmtInt(a.quantidade)} peixes em ${fmtData(a.data)}${a.causa ? ` (${a.causa})` : ''}`;
    case 'qualidade_agua': return `Água no ${nomeTanque(a.tanque_id)} em ${fmtData(a.data)}`;
    case 'despesas_gerais': return `Despesa geral de ${fmtData(a.data)}: ${fmtBRL(a.valor)}`;
    case 'custos_lote': return `Custo do alevino: ${fmtBRL(a.custo_alevino)}`;
    case 'manejos': return `Probiótico ${a.produto || ''}: ${fmtNum(a.dose, 2)} ${a.unidade || ''} em ${fmtData(a.data)}`;
    case 'despescas': return `Despesca ${a.tipo === 'total' ? 'total' : 'parcial'} de ${fmtData(a.data)}: ${fmtInt(a.quantidade)} peixes, ${fmtNum(a.peso_bruto_kg, 0)} kg bruto`;
    case 'racao_estoque': return `Compra de ração: ${fmtNum(a.quantidade_kg, 0)} kg em ${fmtData(a.data_compra)}${a.fornecedor ? ` (${a.fornecedor})` : ''}`;
    case 'racao_contagens': return `Contagem de estoque de ${fmtData(a.data)}: ${fmtNum(a.contado_kg, 0)} kg`;
    case 'usuario_tanques': return `Acesso de ${nomePessoa(a.usuario_id)} ao ${nomeTanque(a.tanque_id)}`;
    case 'usuarios': return `${a.nome || 'Pessoa'} (equipe)`;
    default: return h.tabela;
  }
}

// o que mudou numa alteração: "campo: antes → depois"
const ROTULO_CAMPO = {
  data: 'Data', data_compra: 'Data', data_entrada: 'Povoamento', quantidade_kg: 'Quantidade (kg)', quantidade: 'Quantidade', causa: 'Causa',
  oxigenio_mgl: 'Oxigênio (mg/L)', temperatura_c: 'Temperatura (°C)', ph: 'pH', amonia_mgl: 'Amônia (mg/L)',
  valor: 'Valor', categoria: 'Tipo', descricao: 'Descrição', custo_alevino: 'Custo do alevino',
  preco_kg: 'Preço (R$/kg)', comprador: 'Comprador',
  produto: 'Produto', dose: 'Dose', unidade: 'Unidade', via: 'Aplicação', obs: 'Observação',
  peso_bruto_kg: 'Peso bruto (kg)', peso_liquido_kg: 'Peso líquido (kg)',
  quantidade_amostrada: 'Peixes pesados', peso_amostra_kg: 'Peso da amostra (kg)', custo_total: 'Valor pago', fornecedor: 'Fornecedor',
  especie: 'Espécie', tipo: 'Fase', quantidade_inicial: 'Peixes', peso_inicial_kg: 'Peso total (kg)', ativo: 'Ativo', nome: 'Nome', papel: 'Papel',
};
function valor(campo, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (campo === 'ativo') return v ? 'sim' : 'não';
  if (campo === 'papel') return ROTULO_PAPEL[v] || v;
  if (campo === 'tipo') return ROTULO_TIPO[v] || v;
  if (campo === 'custo_total') return fmtBRL(v);
  if (/^data/.test(campo)) return fmtData(v);
  if (typeof v === 'number') return fmtNum(v, Number.isInteger(v) ? 0 : 2);
  return String(v);
}
function mudancas(h) {
  const a = h.antes || {}, d = h.depois || {};
  return Object.keys(ROTULO_CAMPO).filter((k) => k in d && JSON.stringify(a[k]) !== JSON.stringify(d[k]))
    .map((k) => `${ROTULO_CAMPO[k]}: ${valor(k, a[k])} → ${valor(k, d[k])}`);
}

export async function renderHistorico(ctx, el, aba = 'lixeira') {
  if (ctx.state.perfil.papel !== 'dono') { el.innerHTML = '<div class="card vazio">Somente o dono vê o histórico.</div>'; return; }
  el.innerHTML = `<h1>Histórico e lixeira</h1><p class="carregando">Carregando…</p>`;
  if (!navigator.onLine) { el.innerHTML = `<h1>Histórico e lixeira</h1><div class="card vazio">Precisa de internet.</div>`; return; }
  const [lista, nomes, acessos] = await Promise.all([ctx.api.historico(), ctx.api.nomesUsuarios().catch(() => ({})), ctx.api.acessosSuporte().catch(() => [])]);
  if (!lista) { el.innerHTML = `<h1>Histórico e lixeira</h1><div class="card vazio">O histórico ainda não foi ativado neste sistema (falta rodar o sql/12 no Supabase).</div>`; return; }

  const tanquesConhecidos = Object.fromEntries((ctx.state.ref.tanques || []).map((t) => [t.id, t.nome]));
  for (const h of lista) if (h.tabela === 'tanques' && h.antes) tanquesConhecidos[h.antes.id] = tanquesConhecidos[h.antes.id] || h.antes.nome;
  const nomeTanque = (tid) => (tanquesConhecidos[tid] ? `tanque ${tanquesConhecidos[tid]}` : 'tanque');
  const nomePessoa = (uid) => nomes[uid] || 'alguém';
  const quem = (uid) => (uid ? nomes[uid] || 'Alguém da equipe' : 'Administrador do sistema');

  // lixeira: exclusões agrupadas por operação (excluir um lote leva os lançamentos dele junto)
  const grupos = new Map();
  for (const h of lista.filter((x) => x.acao === 'excluiu')) {
    if (!grupos.has(h.operacao)) grupos.set(h.operacao, []);
    grupos.get(h.operacao).push(h);
  }
  const lixeira = [...grupos.values()]
    .filter((g) => g.some((h) => h.tabela !== 'usuario_tanques')) // tirar acesso a um tanque não é "lixo": aparece em Alterações
    .map((g) => {
      const principal = [...g].sort((x, y) => NIVEL[x.tabela] - NIVEL[y.tabela])[0];
      return { op: principal.operacao, principal, junto: g.length - 1, quem: principal.quem, quando: principal.quando, restaurado: g.every((h) => h.restaurado_em) };
    });
  const alteracoes = lista.filter((h) => h.acao === 'alterou' || (h.acao === 'excluiu' && h.tabela === 'usuario_tanques' && !lista.some((x) => x.operacao === h.operacao && x.tabela === 'tanques')));

  const itemLixo = (g) => `<li>
      <div class="esq"><b>${esc(descrever(g.principal, nomeTanque, nomePessoa))}</b>
        <small>${g.junto ? `e mais ${plural(g.junto, 'registro apagado', 'registros apagados')} junto · ` : ''}excluído por ${esc(quem(g.quem))} em ${quando(g.quando)}</small></div>
      ${g.restaurado ? '<span class="tag ok">Restaurado</span>' : `<button class="btn mini" data-restaurar="${esc(g.op)}" type="button">Restaurar</button>`}
    </li>`;
  const itemAlt = (h) => {
    const m = h.acao === 'excluiu' ? ['Acesso removido'] : mudancas(h);
    return `<li><div class="esq"><b>${esc(descrever(h, nomeTanque, nomePessoa))}</b>
      ${m.length ? `<small class="mud">${m.map(esc).join('<br>')}</small>` : ''}
      <small>${h.acao === 'excluiu' ? 'removido' : 'alterado'} por ${esc(quem(h.quem))} em ${quando(h.quando)}</small></div></li>`;
  };

  el.innerHTML = `
    
    <h1>Histórico e lixeira</h1>
    <div class="seg" style="--n:2" role="tablist">
      <button type="button" data-aba="lixeira" class="${aba === 'lixeira' ? 'on' : ''}">Lixeira</button>
      <button type="button" data-aba="alteracoes" class="${aba === 'alteracoes' ? 'on' : ''}">Alterações</button>
    </div>
    ${aba === 'lixeira'
      ? `<p class="mudo nota">O que foi excluído fica aqui por 180 dias. Restaurar traz de volta tudo o que foi apagado junto.</p>
         <div class="card">${lixeira.length ? `<ul class="lista registros">${lixeira.map(itemLixo).join('')}</ul>` : '<p class="mudo" style="margin:0">Nada foi excluído.</p>'}</div>`
      : `<p class="mudo nota">Correções em lançamentos, compras, lotes e equipe, com como era antes e como ficou.</p>
         <div class="card">${alteracoes.length ? `<ul class="lista registros">${alteracoes.map(itemAlt).join('')}</ul>` : '<p class="mudo" style="margin:0">Nenhuma alteração registrada.</p>'}</div>`}
    ${acessos && acessos.length ? `<h2>Acessos do suporte</h2>
      <p class="mudo nota">Quando você pede ajuda, o suporte do PisciApp entra na fazenda. O que ele fez aparece acima com "(suporte)".</p>
      <div class="card"><ul class="lista registros">${acessos.map((a) => `<li><div class="esq"><b>${esc(a.quem)} (suporte)</b><small>${quando(a.inicio)} até ${quando(a.fim).split(' às ')[1]}${a.motivo ? ` · ${esc(a.motivo)}` : ''}</small></div></li>`).join('')}</ul></div>` : ''}`;

  el.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => renderHistorico(ctx, el, b.dataset.aba)));
  el.querySelectorAll('[data-restaurar]').forEach((b) => b.addEventListener('click', async () => {
    const g = lixeira.find((x) => String(x.op) === b.dataset.restaurar);
    if (!(await confirmar({ titulo: 'Restaurar?', texto: `${descrever(g.principal, nomeTanque, nomePessoa)}${g.junto ? ` e mais ${plural(g.junto, 'registro apagado', 'registros apagados')} junto` : ''} voltam como estavam.`, ok: 'Restaurar' }))) return;
    b.disabled = true;
    try {
      const n = await ctx.api.restaurarExclusao(g.op);
      await ctx.atualizarRef(true);
      ctx.toast(`${plural(n, 'registro restaurado', 'registros restaurados')}`, 'ok');
      renderHistorico(ctx, el, 'lixeira');
    } catch (e) { ctx.toast(e.message, 'erro'); b.disabled = false; }
  }));
}

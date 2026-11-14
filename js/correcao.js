// Pedir correção (sql/35): o funcionário pede, com o valor certo e o motivo; o dono ou o gerente aprova ou recusa.
// Vale para lançamentos de dias anteriores (até 7 dias). No mesmo dia, quem lançou corrige direto (sql/33).
import { formulario } from './dialogo.js';
import { numDecimal, num } from './util.js';
import { descricao } from './views/pendencias.js';

export const DIAS_PEDIR_CORRECAO = 7;

// campos que dá para pedir para corrigir: [coluna, rótulo, 'int'|'dec', pode ficar em branco]
const CAMPOS = {
  racao_consumo: [['quantidade_kg', 'Quantos kg de ração (o certo)', 'dec']],
  mortalidade: [['quantidade', 'Quantos peixes mortos (o certo)', 'int']],
  biometrias: [['peso_amostra_kg', 'Peso total dos peixes pesados, em kg (o certo)', 'dec'], ['quantidade_amostrada', 'Quantos peixes foram pesados (o certo)', 'int']],
  qualidade_agua: [['oxigenio_mgl', 'Oxigênio (mg/L)', 'dec', true], ['temperatura_c', 'Temperatura (°C)', 'dec', true], ['ph', 'pH', 'dec', true], ['amonia_mgl', 'Amônia tóxica (mg/L)', 'dec', true]],
  manejos: [['dose', 'Dose (na unidade lançada)', 'dec']],
};
const LIMITES = { quantidade_kg: [0, 5000, 'Ração: de 0 a 5.000 kg.'], quantidade: [1, 1e7, 'Peixes mortos: número inteiro a partir de 1.'], peso_amostra_kg: [0, 100000, 'Confira o peso da pesagem.'],
  quantidade_amostrada: [1, 1e7, 'Peixes pesados: número inteiro a partir de 1.'], dose: [0, 1e6, 'Confira a dose.'], oxigenio_mgl: [0, 25, 'Oxigênio: de 0 a 25.'],
  temperatura_c: [0, 50, 'Temperatura: de 0 a 50.'], ph: [0, 14, 'pH: de 0 a 14.'], amonia_mgl: [0, 50, 'Amônia: de 0 a 50.'] };
const POSITIVO = new Set(['quantidade_kg', 'peso_amostra_kg', 'dose']); // maior que zero
const MOTIVOS = [['numero', 'Digitei o número errado', 'corrigir'], ['duas', 'Lancei duas vezes (apagar)', 'apagar'], ['tanque', 'Lancei no tanque errado (apagar)', 'apagar'], ['outro', 'Outro motivo', 'corrigir']];

export const podePedirCorrecao = (tabela) => !!CAMPOS[tabela];
const paraCampo = (v) => (v == null || v === '' ? '' : String(Number(v)).replace('.', ','));

// lê o formulário: devolve { campos } (só o que mudou) ou { erro }
function lerCampos(tabela, antes, valores) {
  const campos = {};
  for (const [k, , tipo, branco] of CAMPOS[tabela]) {
    const t = String(valores[k] ?? '').trim();
    if (!t) {
      if (!branco) return { erro: 'Informe o valor certo.' };
      if (antes[k] != null) campos[k] = null;
      continue;
    }
    const v = tipo === 'int' ? num(t) : numDecimal(t);
    const [a, b, msg] = LIMITES[k];
    if (!Number.isFinite(v) || v < a || v > b || (POSITIVO.has(k) && !(v > 0)) || (tipo === 'int' && !Number.isInteger(v))) return { erro: msg };
    if (antes[k] == null || Number(antes[k]) !== v) campos[k] = v;
  }
  if (tabela === 'qualidade_agua' && CAMPOS.qualidade_agua.every(([k]) => (k in campos ? campos[k] : antes[k]) == null)) return { erro: 'A medição precisa ter pelo menos um valor. Se for tirar tudo, escolha "Lancei duas vezes (apagar)".' };
  if (!Object.keys(campos).length) return { erro: 'O valor certo é igual ao lançado. Mude o número ou escolha apagar.' };
  return { campos };
}

const semSql = (e) => /pedir_correcao|pedidos_correcao|Could not find the function|schema cache/i.test(String((e && e.message) || ''));

// Abre a janela, envia o pedido. Devolve true se o pedido foi enviado.
export async function pedirCorrecao(ctx, it) {
  const defs = CAMPOS[it.tabela];
  if (!defs) return false;
  let pedido = null;
  const valores = await formulario({
    titulo: 'Pedir correção',
    texto: `${descricao(it, ctx.state.ref).titulo} · lançado: ${descricao(it, ctx.state.ref).valor}. O dono ou o gerente recebe o pedido e aprova; até lá, o lançamento fica como está.`,
    campos: [
      { nome: 'motivo', rotulo: 'O que aconteceu?', tipo: 'select', valor: 'numero', opcoes: MOTIVOS.map(([v, r]) => [v, r]) },
      ...defs.map(([k, r, tipo, branco]) => ({ nome: k, rotulo: r, tipo: 'text', valor: paraCampo(it.payload[k]), inputmode: tipo === 'int' ? 'numeric' : 'decimal', maxlength: 12, ajuda: branco ? 'Em branco: não mediu' : '' })),
      { nome: 'detalhe', rotulo: 'Explique (opcional)', tipo: 'text', maxlength: 120 },
    ],
    ok: 'Enviar pedido', cancelar: 'Voltar',
    validar: (v) => {
      const m = MOTIVOS.find(([k]) => k === v.motivo) || MOTIVOS[0];
      const detalhe = String(v.detalhe || '').trim();
      if (m[0] === 'outro' && !detalhe) return 'Explique o motivo.';
      const motivo = detalhe ? `${m[1].replace(/ \(apagar\)$/, '')}: ${detalhe}` : m[1].replace(/ \(apagar\)$/, '');
      if (m[2] === 'apagar') { pedido = { acao: 'apagar', campos: {}, motivo }; return ''; }
      const r = lerCampos(it.tabela, it.payload, v);
      if (r.erro) return r.erro;
      pedido = { acao: 'corrigir', campos: r.campos, motivo };
      return '';
    },
  });
  if (!valores || !pedido) return false;
  try {
    await ctx.api.pedirCorrecao(it.tabela, it.payload.id, pedido.acao, pedido.campos, pedido.motivo);
    ctx.toast('Pedido enviado. O dono ou o gerente vai responder.', 'ok');
    return true;
  } catch (e) {
    ctx.toast(semSql(e) ? 'O pedido de correção ainda não foi ativado neste sistema (falta rodar o sql/35 no Supabase).' : (e && e.message) || 'Não foi possível enviar o pedido.', 'erro');
    return false;
  }
}

// "Lançado: 6.000 kg (240 sacos)" → "Certo: 600 kg (24 sacos)" ou "apagar"
export function textoPedido(p, ref) {
  const lancado = descricao({ tabela: p.tabela, payload: p.antes }, ref);
  const certo = p.acao === 'apagar' ? 'apagar o lançamento' : descricao({ tabela: p.tabela, payload: { ...p.antes, ...p.campos } }, ref).valor;
  return { titulo: lancado.titulo, lancado: lancado.valor, certo, data: p.antes && p.antes.data };
}

export const SITUACAO_PEDIDO = {
  pendente: ['falta', 'Correção pedida'], aprovado: ['ok', '✓ Corrigido'], recusado: ['ruim', 'Correção recusada'], cancelado: ['', 'Pedido cancelado'],
};

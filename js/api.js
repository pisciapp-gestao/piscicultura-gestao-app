// Camada de acesso ao Supabase. Todas as funções lançam ErroApi (mensagem já em português).
import * as db from './db.js';
import { uuid, traduzErro, hojeISO, ehErroDeRede } from './util.js';

export class ErroApi extends Error {
  constructor(original) {
    super(traduzErro(original));
    this.original = original;
    this.code = original && original.code;
  }
}

const TABELAS_EXCLUIVEIS = new Set(['despesas_gerais', 'biometrias', 'mortalidade', 'despescas', 'manejos', 'qualidade_agua', 'racao_consumo', 'racao_estoque', 'racao_contagens']);
const TABELAS_EDITAVEIS = new Set(['biometrias', 'mortalidade', 'despescas', 'manejos', 'qualidade_agua', 'racao_consumo', 'racao_estoque', 'lotes']);

// venda de uma despesca (só o dono; sql/28): preço e comprador vazios apagam a venda
async function gravarVenda(client, despescaUuid, preco, comprador) {
  const r = preco == null && !comprador
    ? await client.from('despesca_vendas').delete().eq('despesca_uuid', despescaUuid)
    : await client.from('despesca_vendas').upsert({ despesca_uuid: despescaUuid, preco_kg: preco ?? null, comprador: comprador || null }, { onConflict: 'despesca_uuid' });
  if (r.error) throw new ErroApi(r.error);
}

export function criarApi(client) {
  const ok = (res) => {
    if (res.error) throw new ErroApi(res.error);
    return res.data;
  };

  // o Supabase devolve no máximo 1000 linhas por consulta: pagina para não truncar totais
  async function todos(fazer) {
    const out = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await fazer().range(i, i + 999);
      if (error) throw new ErroApi(error);
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }

  return {
    // ----- perfil / referência -----
    async perfil(userId) {
      return ok(await client.from('usuarios').select('id,nome,papel,fazenda_id,ativo,fazendas(nome)').eq('id', userId).maybeSingle());
    },
    // plano da fazenda; null se o sql/07 ainda não foi rodado
    async plano() {
      const { data, error } = await client.rpc('plano_atual');
      return error ? null : (Array.isArray(data) ? data[0] : data) || null;
    },
    async pacotes() {
      const { data, error } = await client.from('pacotes').select('tanques_max,nome,preco_mensal').order('tanques_max');
      return error ? [] : data || [];
    },
    async contratarPacote(n) {
      return ok(await client.rpc('contratar_pacote', { p_tanques_max: n }));
    },
    async criarFazenda(fazenda, nome, documento) {
      return ok(await client.rpc('criar_fazenda', { p_fazenda: fazenda, p_nome: nome, p_documento: documento }));
    },
    // fim do teste grátis; null se não houver (fazenda antiga) ou se o sql/06 não foi rodado
    async testeAte() {
      const { data, error } = await client.from('fazendas').select('teste_ate').maybeSingle();
      return error || !data ? null : data.teste_ate || null;
    },
    // peso do saco de ração da fazenda; null se a coluna ainda não existe (sql/03 não rodado)
    async kgSaco() {
      const { data, error } = await client.from('fazendas').select('kg_saco').maybeSingle();
      if (error || !data || !(Number(data.kg_saco) > 0)) return null;
      return Number(data.kg_saco);
    },
    async salvarKgSaco(fazendaId, kg) {
      ok(await client.from('fazendas').update({ kg_saco: kg }).eq('id', fazendaId));
    },
    // logo da fazenda (data URL); null se não há ou se o sql/09 ainda não foi rodado
    async logo() {
      const { data, error } = await client.from('fazendas').select('logo').maybeSingle();
      return error || !data || !data.logo ? null : data.logo;
    },
    async salvarLogo(fazendaId, dataUrl) {
      ok(await client.from('fazendas').update({ logo: dataUrl || null }).eq('id', fazendaId));
    },
    // preço do kg do peixe para estimar o valor na água; null se não definido ou se o sql/16 não foi rodado
    // Com o sql/22 o preço sai por preco_peixe(), que só responde ao dono (o funcionário não recebe o preço nem no aparelho).
    async precoKg() {
      const r = await client.rpc('preco_peixe');
      if (!r.error) return Number(r.data) > 0 ? Number(r.data) : null;
      if (!(r.error.code === 'PGRST202' || /preco_peixe/i.test(r.error.message || ''))) return null;
      const { data, error } = await client.from('fazendas').select('preco_kg').maybeSingle(); // banco ainda sem o sql/22
      if (error || !data || !(Number(data.preco_kg) > 0)) return null;
      return Number(data.preco_kg);
    },
    async salvarPrecoKg(fazendaId, preco) {
      ok(await client.from('fazendas').update({ preco_kg: preco }).eq('id', fazendaId));
    },
    async tanques() {
      // area_ha vem do sql/17; sem ele, lê só o nome
      const r = await client.from('tanques').select('id,nome,area_ha').order('nome');
      if (r.error && /area_ha/i.test(r.error.message || '')) return ok(await client.from('tanques').select('id,nome').order('nome'));
      return ok(r);
    },
    async lotes({ apenasAtivos = false } = {}) {
      let q = client.from('lotes').select('id,tanque_id,tipo,especie,data_entrada,quantidade_inicial,peso_inicial_kg,ativo');
      if (apenasAtivos) q = q.eq('ativo', true);
      return ok(await q.order('data_entrada', { ascending: false }));
    },
    async lote(id) {
      return ok(await client.from('lotes').select('id,tanque_id,tipo,especie,data_entrada,quantidade_inicial,peso_inicial_kg,ativo,tanques(nome)').eq('id', id).maybeSingle());
    },
    // guarda o último resumo no aparelho: sem rede, as telas mostram os números da última atualização
    async resumoLotes() {
      try {
        const linhas = ok(await client.rpc('resumo_lotes')) || [];
        db.kvSet('resumo', linhas).catch(() => {});
        return linhas;
      } catch (e) {
        const guardado = ehErroDeRede(e && e.original) ? await db.kvGet('resumo') : null;
        if (guardado) return guardado;
        throw e;
      }
    },
    resumoGuardado: () => db.kvGet('resumo'),

    // ----- tanques e lotes (dono/gerente) -----
    async criarTanque(fazendaId, nome, area = null) {
      const id = uuid(); // gerado aqui: o gerente só enxerga o tanque depois do gatilho que o vincula
      const linha = { id, fazenda_id: fazendaId, nome, ...(area ? { area_ha: area } : {}) };
      const r = await client.from('tanques').insert(linha);
      if (r.error && /area_ha/i.test(r.error.message || '')) throw new Error('A área do tanque ainda não foi ativada neste sistema (falta rodar o sql/17 no Supabase). Cadastre sem a área.');
      ok(r);
      return id;
    },
    async renomearTanque(id, nome, area) {
      const campos = { nome, ...(area !== undefined ? { area_ha: area } : {}) };
      const r = await client.from('tanques').update(campos).eq('id', id);
      if (r.error && /area_ha/i.test(r.error.message || '')) throw new Error('A área do tanque ainda não foi ativada neste sistema (falta rodar o sql/17 no Supabase).');
      ok(r);
    },
    async criarLote(lote) {
      const id = uuid();
      const r = await client.from('lotes').insert({ id, ...lote });
      if (r.error && /lotes_tipo_check/i.test(r.error.message || '')) throw new Error('As fases Berçário e Recria ainda não foram ativadas neste sistema (falta rodar o sql/17 no Supabase). Use Alevinagem por enquanto.');
      ok(r);
      return id;
    },
    // pesagem de hoje de um lote que já estava no tanque (cadastro de lote em andamento)
    async biometriaInicial(loteId, pesoMedioKg, userId, data) {
      ok(await client.from('biometrias').insert({ id: uuid(), uuid_local: uuid(), lote_id: loteId, data, peso_amostra_kg: Math.round(pesoMedioKg * 1000) / 1000, quantidade_amostrada: 1, registrado_por: userId }));
    },
    // exclusões definitivas (só o dono; o RLS barra os demais). Apagam em cascata os lançamentos.
    async excluirLote(id) {
      const d = ok(await client.from('lotes').delete().eq('id', id).select('id'));
      if (!d || !d.length) throw new Error('Não foi possível excluir. Só o dono pode excluir lotes.');
    },
    async excluirTanque(id) {
      const d = ok(await client.from('tanques').delete().eq('id', id).select('id'));
      if (!d || !d.length) throw new Error('Não foi possível excluir. Só o dono pode excluir tanques.');
    },
    // o banco já tem a tabela de despescas (sql/20)? Só responde false quando ela comprovadamente não existe.
    async despescaAtiva() {
      const { error } = await client.from('despescas').select('id').limit(1);
      return !(error && (error.code === '42P01' || error.code === 'PGRST205'));
    },
    async aguaAtiva() {
      const { error } = await client.from('qualidade_agua').select('id').limit(1);
      return !(error && (error.code === '42P01' || error.code === 'PGRST205'));
    },
    aguaPeriodo(desde) {
      return todos(() => client.from('qualidade_agua').select('id,data,hora,tanque_id,oxigenio_mgl,temperatura_c,ph,amonia_mgl').gte('data', desde).order('data').order('id'));
    },
    // sem o sql/27 a tabela não existe: o relatório segue sem medições
    aguaTanque(tanqueId, desde) {
      return todos(() => client.from('qualidade_agua').select('id,data,hora,tanque_id,oxigenio_mgl,temperatura_c,ph,amonia_mgl,obs,registrado_por,criado_em').eq('tanque_id', tanqueId).gte('data', desde).order('data').order('id')).catch(() => []);
    },
    // o banco já tem a tabela de venda só do dono (sql/28)?
    async vendaAtiva() {
      const { error } = await client.from('despesca_vendas').select('despesca_uuid').limit(1);
      return !(error && (error.code === '42P01' || error.code === 'PGRST205'));
    },
    salvarVenda(despescaUuid, preco, comprador) { return gravarVenda(client, despescaUuid, preco, comprador); },
    // ----- custos (sql/29). null = tabela ainda não existe -----
    async despesasGerais() {
      const { data, error } = await client.from('despesas_gerais').select('id,data,categoria,valor,descricao').order('data', { ascending: false }).order('id').limit(1000);
      if (error) { if (error.code === '42P01' || error.code === 'PGRST205') return null; throw new ErroApi(error); }
      return data || [];
    },
    async custosLote() {
      const { data, error } = await client.from('custos_lote').select('lote_id,custo_alevino');
      if (error) { if (error.code === '42P01' || error.code === 'PGRST205') return null; throw new ErroApi(error); }
      return data || [];
    },
    async criarDespesa(linha) { ok(await client.from('despesas_gerais').insert(linha)); },
    async salvarCustoLote(loteId, valor) { ok(await client.from('custos_lote').upsert({ lote_id: loteId, custo_alevino: valor }, { onConflict: 'lote_id' })); },
    async apagarCustoLote(loteId) { ok(await client.from('custos_lote').delete().eq('lote_id', loteId)); },
    async manejoAtivo() {
      const { error } = await client.from('manejos').select('id').limit(1);
      return !(error && (error.code === '42P01' || error.code === 'PGRST205'));
    },
    async encerrarLote(id) {
      ok(await client.from('lotes').update({ ativo: false }).eq('id', id));
    },

    // lançamentos já gravados no mesmo dia (para avisar de duplicidade ao lançar)
    async registrosDoDia(tipo, pl) {
      if (tipo === 'racao') return ok(await client.from('racao_consumo').select('quantidade_kg,criado_em').eq('tanque_id', pl.tanque_id).eq('data', pl.data)) || [];
      const tab = tipo === 'mortalidade' ? 'mortalidade' : tipo === 'despesca' ? 'despescas' : tipo === 'manejo' ? 'manejos' : 'biometrias';
      return ok(await client.from(tab).select(tipo === 'biometria' ? 'criado_em' : tipo === 'manejo' ? 'produto,criado_em' : 'quantidade,criado_em').eq('lote_id', pl.lote_id).eq('data', pl.data)) || [];
    },

    // ----- ração: estoque -----
    async saldoRacao() {
      const d = ok(await client.rpc('saldo_racao'));
      const s = Array.isArray(d) ? d[0] : d;
      // Banco sem o sql/04: a função antiga não devolve o consumo dos últimos 7 dias; calcula aqui.
      if (s && s.consumo_7d_kg == null) {
        try {
          const hoje = hojeISO();
          const d7 = new Date(`${hoje}T00:00:00Z`); d7.setUTCDate(d7.getUTCDate() - 7);
          const linhas = await todos(() => client.from('racao_consumo').select('id,quantidade_kg').gte('data', d7.toISOString().slice(0, 10)).lt('data', hoje).order('id'));
          s.consumo_7d_kg = linhas.reduce((t, r) => t + Number(r.quantidade_kg || 0), 0);
        } catch { /* segue sem estimativa */ }
      }
      return s;
    },
    // saldo de cada ração (engorda e alevino, sql/17). Sem o sql/17: uma linha só, o total, contada como engorda.
    async saldosRacao() {
      const { data, error } = await client.rpc('saldo_racao_por_tipo');
      let r;
      if (!error && Array.isArray(data) && data.length) r = { porTipo: true, linhas: data };
      else { const s = await this.saldoRacao(); r = { porTipo: false, linhas: s ? [{ ...s, tipo_racao: 'engorda' }] : [] }; }
      db.kvSet('saldosRacao', { ...r, em: Date.now() }).catch(() => {});
      return r;
    },
    async consumoDiario(dias = 30, tipo = null) {
      if (tipo) {
        const { data, error } = await client.rpc('consumo_diario_tipo', { p_dias: dias, p_tipo: tipo });
        if (!error) return data || [];
      }
      return ok(await client.rpc('consumo_diario', { p_dias: dias })) || [];
    },
    async contagens() {
      const ler = (cols) => client.from('racao_contagens').select(cols).order('criado_em', { ascending: false }).limit(60);
      const r = await ler('id,data,contado_kg,saldo_sistema_kg,diferenca_kg,obs,criado_em,tipo_racao');
      return (r.error ? ok(await ler('id,data,contado_kg,saldo_sistema_kg,diferenca_kg,obs,criado_em')) : r.data) || [];
    },
    async registrarContagem(kg, obs, tipo = null) {
      if (tipo) {
        const r = await client.rpc('registrar_contagem', { p_contado_kg: kg, p_obs: obs || null, p_tipo: tipo });
        if (!r.error) return Number(r.data);
        if (!(r.error.code === 'PGRST202' || /registrar_contagem/i.test(r.error.message || ''))) throw new ErroApi(r.error);
      }
      return Number(ok(await client.rpc('registrar_contagem', { p_contado_kg: kg, p_obs: obs || null })));
    },
    async juntarValorPago(lista) {
      const r = await client.rpc('racao_estoque_visivel');
      if (r.error || !Array.isArray(r.data)) return lista;
      const valor = new Map(r.data.map((x) => [x.id, x.custo_total]));
      for (const c of lista) if (valor.has(c.id)) c.custo_total = valor.get(c.id);
      return lista;
    },
    async compras(podeGerir) {
      let lista;
      if (podeGerir) {
        // sacos_nota/sacos_recebidos vêm do sql/14 (conferência de recebimento); sem ele, lê sem as duas colunas
        const ler = (cols) => todos(() => client.from('racao_estoque').select(cols).order('data_compra', { ascending: false }).order('id'));
        lista = await ler('id,data_compra,quantidade_kg,fornecedor,sacos_nota,sacos_recebidos,tipo_racao') // tipo_racao: sql/17
          .catch(() => ler('id,data_compra,quantidade_kg,fornecedor,sacos_nota,sacos_recebidos'))
          .catch(() => ler('id,data_compra,quantidade_kg,fornecedor'));
        // valor pago (sql/23): não sai mais pela tabela; vem de racao_estoque_visivel(), que só entrega ao dono
        await this.juntarValorPago(lista);
      } else {
        lista = ok(await client.rpc('racao_estoque_visivel'));
        lista.sort((a, b) => (a.data_compra < b.data_compra ? 1 : -1));
      }
      return lista;
    },
    async registrarCompra(c) {
      let linha = { id: uuid(), ...c };
      let r = await client.from('racao_estoque').insert(linha);
      // banco sem o sql/17: grava sem o tipo (conta como engorda)
      if (r.error && /tipo_racao/i.test(r.error.message || '')) {
        const { tipo_racao, ...semTipo } = linha; linha = semTipo;
        r = await client.from('racao_estoque').insert(linha);
      }
      // banco sem o sql/14: grava sem a conferência (o kg que chegou continua certo)
      if (r.error && /sacos_(nota|recebidos)/i.test(r.error.message || '')) {
        const { sacos_nota, sacos_recebidos, ...sem } = linha;
        ok(await client.from('racao_estoque').insert(sem));
        return;
      }
      ok(r);
    },
    // importar a cópia baixada em Mais (sql/14). Devolve quantos registros voltaram por tabela.
    async importarCopia(copia) {
      const { data, error } = await client.rpc('importar_copia', { p_copia: copia });
      if (error && (error.code === 'PGRST202' || /importar_copia/i.test(error.message || ''))) throw new Error('A importação ainda não foi ativada neste sistema (falta rodar o sql/14 no Supabase).');
      if (error) throw new ErroApi(error);
      return data || {};
    },

    // ----- relatório de um lote -----
    // venda: true só para o dono (preço e comprador vêm da tabela só dele, sql/28)
    async dadosLote(loteId, { venda = false } = {}) {
      const [bios, mort, rac, desp, man] = await Promise.all([
        todos(() => client.from('biometrias').select('id,data,peso_amostra_kg,quantidade_amostrada,registrado_por,criado_em').eq('lote_id', loteId).order('data').order('id')),
        todos(() => client.from('mortalidade').select('id,data,quantidade,causa,registrado_por,criado_em').eq('lote_id', loteId).order('data').order('id'))
          .catch(() => todos(() => client.from('mortalidade').select('id,data,quantidade,registrado_por,criado_em').eq('lote_id', loteId).order('data').order('id'))),
        todos(() => client.from('racao_consumo').select('id,data,quantidade_kg,registrado_por,criado_em').eq('lote_id', loteId).order('data').order('id')),
        // sem o sql/20 a tabela não existe: o relatório segue sem despescas
        todos(() => client.from('despescas').select('id,uuid_local,data,tipo,quantidade,peso_bruto_kg,peso_liquido_kg,registrado_por').eq('lote_id', loteId).order('data').order('id'))
          .catch(() => []),
        todos(() => client.from('manejos').select('id,data,tipo,produto,dose,unidade,via,obs,registrado_por,criado_em').eq('lote_id', loteId).order('data').order('id')).catch(() => []), // sem o sql/21: segue sem manejos
      ]);
      if (venda && desp.length) {
        const vendas = await todos(() => client.from('despesca_vendas').select('despesca_uuid,preco_kg,comprador').in('despesca_uuid', desp.map((d) => d.uuid_local)).order('despesca_uuid'))
          .catch(() => null); // sem o sql/28: segue sem preço
        if (vendas) {
          const por = new Map(vendas.map((v) => [v.despesca_uuid, v]));
          for (const d of desp) { const v = por.get(d.uuid_local); d.preco_kg = v && v.preco_kg != null ? Number(v.preco_kg) : null; d.comprador = (v && v.comprador) || null; }
        }
      }
      return { bios, mort, rac, desp, man };
    },
    // ração de todos os tanques visíveis ao usuário a partir de uma data (para a tabela dia × tanque)
    async racaoPeriodo(desde) {
      return todos(() => client.from('racao_consumo').select('id,data,tanque_id,quantidade_kg').gte('data', desde).order('data').order('id'));
    },
    // mortes de todos os lotes visíveis a partir de uma data (resumo da semana na tela Início); sem o sql/08, vem sem a causa
    async mortalidadePeriodo(desde) {
      const ler = (cols) => todos(() => client.from('mortalidade').select(cols).gte('data', desde).order('id'));
      return ler('id,data,lote_id,quantidade,causa').catch(() => ler('id,data,lote_id,quantidade'));
    },
    // nomes de toda a equipe (sql/10). Sem o sql/10, cai na tabela: o funcionário só enxerga o próprio nome.
    async nomesUsuarios() {
      const r = await client.rpc('nomes_equipe');
      const lista = r.error ? ok(await client.from('usuarios').select('id,nome')) : r.data || [];
      return Object.fromEntries(lista.map((u) => [u.id, u.nome]));
    },
    // "Desfazer" logo depois de lançar: apaga pelo código do aparelho (uuid_local), porque o id do banco o aparelho não sabe.
    // O funcionário só apaga o que ele mesmo lançou hoje (sql/33); devolve quantas linhas saíram (0 = nada a apagar ou sem permissão).
    async apagarPorUuid(tabela, uuidLocal) {
      if (!TABELAS_EXCLUIVEIS.has(tabela)) throw new Error('Tabela não permitida');
      const d = ok(await client.from(tabela).delete().eq('uuid_local', uuidLocal).select('id'));
      return (d || []).length;
    },
    // o que a pessoa lançou desde uma hora (Meus lançamentos: 7 dias), em todas as tabelas de lançamento; tabela que não existe (sql não rodado) vem vazia
    async meusLancamentos(userId, desdeISO) {
      const tabs = ['racao_consumo', 'mortalidade', 'biometrias', 'qualidade_agua', 'manejos', 'despescas'];
      const listas = await Promise.all(tabs.map(async (t) => {
        const { data, error } = await client.from(t).select('*').eq('registrado_por', userId).gte('criado_em', desdeISO).order('criado_em', { ascending: false }).limit(300);
        if (error) { if (ehErroDeRede(error)) throw new ErroApi(error); return []; }
        return (data || []).map((r) => ({ tabela: t, payload: r }));
      }));
      return listas.flat();
    },
    // ----- pedidos de correção (sql/35) -----
    // null = sql/35 ainda não rodado
    async pedidosCorrecao({ desdeISO, meus } = {}) {
      let q = client.from('pedidos_correcao').select('*').order('pedido_em', { ascending: false }).limit(300);
      if (desdeISO) q = q.gte('pedido_em', desdeISO);
      if (meus) q = q.eq('pedido_por', meus);
      const { data, error } = await q;
      if (error) { if (ehErroDeRede(error)) throw new ErroApi(error); return null; }
      return data || [];
    },
    async pedirCorrecao(tabela, registroId, acao, campos, motivo) {
      return ok(await client.rpc('pedir_correcao', { p_tabela: tabela, p_registro: registroId, p_acao: acao, p_campos: campos, p_motivo: motivo }));
    },
    async cancelarPedidoCorrecao(id) { ok(await client.rpc('cancelar_pedido_correcao', { p_id: id })); },
    async responderCorrecao(id, aprovar, resposta) {
      return ok(await client.rpc('responder_correcao', { p_id: id, p_aprovar: aprovar, p_resposta: resposta || null }));
    },
    async excluir(tabela, id) {
      if (!TABELAS_EXCLUIVEIS.has(tabela)) throw new Error('Tabela não permitida');
      ok(await client.from(tabela).delete().eq('id', id));
    },
    // corrige um registro (dono/gerente; o funcionário só o que ele lançou hoje, sql/33; o RLS barra os demais sem dar erro, por isso confere se alguma linha mudou)
    async atualizar(tabela, id, campos) {
      if (!TABELAS_EDITAVEIS.has(tabela)) throw new Error('Tabela não permitida');
      // despesca: preço e comprador não ficam nela (sql/28), vão para a venda, só do dono (gravada depois da despesca)
      let venda = null;
      if (tabela === 'despescas' && ('preco_kg' in campos || 'comprador' in campos)) {
        const { preco_kg, comprador, ...resto } = campos;
        venda = { preco_kg: preco_kg ?? null, comprador: comprador || null }; campos = resto;
      }
      const r = await client.from(tabela).update(campos).eq('id', id).select('id');
      if (r.error && /lotes_tipo_check/i.test(r.error.message || '')) throw new Error('As fases Berçário e Recria ainda não foram ativadas neste sistema (falta rodar o sql/17 no Supabase).');
      const d = ok(r);
      if (!d || !d.length) throw new Error('Não foi possível salvar. Sem permissão para alterar este registro.');
      if (venda) {
        const x = (ok(await client.from('despescas').select('id,uuid_local').eq('id', id).limit(1)) || []).find((r) => r.id === id);
        if (x && x.uuid_local) await gravarVenda(client, x.uuid_local, venda.preco_kg, venda.comprador);
      }
    },
    async reabrirLote(id) {
      const d = ok(await client.from('lotes').update({ ativo: true }).eq('id', id).select('id'));
      if (!d || !d.length) throw new Error('Não foi possível reabrir. Sem permissão para alterar este lote.');
    },

    // ----- equipe (dono) -----
    async equipe() {
      const [usuarios, vinculos] = await Promise.all([
        client.from('usuarios').select('id,nome,papel,ativo').order('nome'),
        client.from('usuario_tanques').select('usuario_id,tanque_id'),
      ]);
      return { usuarios: ok(usuarios), vinculos: ok(vinculos) };
    },
    async atualizarUsuario(id, campos) {
      ok(await client.from('usuarios').update(campos).eq('id', id));
    },
    // ----- painel do administrador do sistema (sql/15). Cada função confere no banco se quem chama é administrador.
    async souAdmin() {
      const { data, error } = await client.rpc('eh_admin');
      return !error && data === true; // sem o sql/15: ninguém é administrador
    },
    async adminFazendas() { return ok(await client.rpc('admin_fazendas')) || []; },
    async adminCobrancas() { return ok(await client.rpc('admin_cobrancas')) || []; },
    async adminPacotes() { return ok(await client.rpc('admin_pacotes')) || []; },
    async adminConfig() { const d = ok(await client.rpc('admin_config')); return (Array.isArray(d) ? d[0] : d) || {}; },
    async adminConfirmarPagamento(cobranca, meses) { ok(await client.rpc('admin_confirmar_pagamento', { p_cobranca: cobranca, p_meses: meses })); },
    async adminEstenderTeste(fazenda, dias) { return ok(await client.rpc('admin_estender_teste', { p_fazenda: fazenda, p_dias: dias })); },
    async adminBloquear(fazenda, bloquear) { ok(await client.rpc('admin_bloquear', { p_fazenda: fazenda, p_bloquear: bloquear })); },
    async adminSalvarPacote(p) { ok(await client.rpc('admin_salvar_pacote', { p_tanques_max: p.tanques_max, p_nome: p.nome, p_preco: p.preco, p_ativo: p.ativo })); },
    async adminDefinirPiloto(ligado) { ok(await client.rpc('admin_definir_piloto', { p_ligado: ligado })); },
    async adminDefinirDocumento(fazenda, documento) { ok(await client.rpc('admin_definir_documento', { p_fazenda: fazenda, p_documento: documento })); },
    // financeiro do sistema (sql/33); null = SQL ainda não rodado
    async adminFinanceiro() {
      const r = await client.rpc('admin_financeiro');
      if (r.error && (r.error.code === 'PGRST202' || r.error.code === '42883')) return null;
      return ok(r) || null;
    },
    async adminSalvarLancamento(l) { return ok(await client.rpc('admin_salvar_lancamento', { p: l })); },
    async adminExcluirLancamento(id) { ok(await client.rpc('admin_excluir_lancamento', { p_id: id })); },
    async adminSalvarSocios(lista) { ok(await client.rpc('admin_salvar_socios', { p: lista })); },

    // ----- cópia de segurança (dono): tudo o que a fazenda tem, tabela por tabela -----
    async exportarTudo() {
      const tabelas = ['fazendas', 'usuarios', 'tanques', 'usuario_tanques', 'lotes', 'biometrias', 'mortalidade', 'despescas', 'despesca_vendas', 'manejos', 'qualidade_agua', 'custos_lote', 'despesas_gerais', 'racao_consumo', 'racao_estoque', 'racao_contagens'];
      const out = { gerado_em: new Date().toISOString(), versao: 1, tabelas: {}, sem_acesso: [] };
      for (const t of tabelas) {
        try {
          out.tabelas[t] = await todos(() => {
            // fazendas: o preço do peixe não sai mais em "select *" (sql/22); vai pelas colunas e o preço à parte
            const colunas = { fazendas: 'id,nome,criado_em,teste_ate,logo,kg_saco,bloqueada',
              racao_estoque: 'id,fazenda_id,data_compra,quantidade_kg,fornecedor,criado_em,sacos_nota,sacos_recebidos,tipo_racao' }[t] || '*';
            const q = client.from(t).select(colunas);
            return t === 'usuario_tanques' ? q.order('usuario_id').order('tanque_id') : q.order('id');
          });
        } catch { out.sem_acesso.push(t); } // tabela que ainda não existe neste banco (sql não rodado)
      }
      const fz = (out.tabelas.fazendas || [])[0];
      if (fz) { try { fz.preco_kg = await this.precoKg(); } catch { /* sem preço: segue */ } }
      if (out.tabelas.racao_estoque) { try { await this.juntarValorPago(out.tabelas.racao_estoque); } catch { /* sem valor: segue */ } }
      return out;
    },

    // ----- histórico e lixeira (sql/12) -----
    async historico() {
      const { data, error } = await client.from('historico')
        .select('id,tabela,registro_id,acao,operacao,quem,quando,antes,depois,restaurado_em')
        .order('quando', { ascending: false }).limit(600);
      return error ? null : data || []; // null = sql/12 ainda não rodado
    },
    async restaurarExclusao(operacao) {
      return Number(ok(await client.rpc('restaurar_exclusao', { p_operacao: operacao })));
    },
    // a lixeira existe? (para avisar nas exclusões que dá para restaurar)
    async temLixeira() {
      const { error } = await client.from('historico').select('id').limit(1);
      return !error;
    },

    // ----- convites por link (sql/10) -----
    async convitesAbertos() {
      const { data, error } = await client.from('convites').select('token,papel,criado_em,expira_em')
        .is('usado_em', null).eq('cancelado', false).gt('expira_em', new Date().toISOString()).order('criado_em', { ascending: false });
      return error ? null : data || []; // null = sql/10 ainda não rodado
    },
    // ----- celular perdido (sql/24): aparelhos conectados e desconectar à distância -----
    async aparelhosConectados() {
      const { data, error } = await client.rpc('aparelhos_conectados');
      return error ? null : Object.fromEntries((data || []).map((x) => [x.usuario_id, x])); // null = sql/24 ainda não rodado
    },
    async desconectarAparelhos(usuarioId) { return Number(ok(await client.rpc('desconectar_aparelhos', { p_usuario: usuarioId }))) || 0; },
    // suporte do administrador (sql/34): entra na fazenda do cliente como dono, por até 2 horas
    async meuSuporte() { return ok(await client.rpc('meu_suporte')) || null; },
    async adminEntrarSuporte(fazendaId, motivo) { return ok(await client.rpc('admin_entrar_suporte', { p_fazenda: fazendaId, p_motivo: motivo || null })); },
    async adminSairSuporte() { ok(await client.rpc('admin_sair_suporte')); },
    async acessosSuporte(fazendaId) { return ok(await client.rpc('acessos_suporte', fazendaId ? { p_fazenda: fazendaId } : {})) || []; },
    async adminDesconectarDono(fazendaId) { return Number(ok(await client.rpc('admin_desconectar_dono', { p_fazenda: fazendaId }))) || 0; },
    // a sessão deste aparelho ainda existe no servidor? (false = foi desconectado pelo dono ou pelo suporte)
    async sessaoAindaValida() {
      const { error } = await client.auth.getUser();
      return !(error && (error.status === 403 || error.status === 401 || /session/i.test(error.message || '')));
    },
    // convites usados depois de uma data (para avisar o dono quem entrou pelo link)
    async convitesUsadosDesde(iso) {
      const { data, error } = await client.from('convites').select('token,papel,usado_por,usado_em')
        .gt('usado_em', iso).order('usado_em', { ascending: false }).limit(10);
      return error ? [] : data || [];
    },
    async criarConvite(papel) {
      return ok(await client.rpc('criar_convite', { p_papel: papel }));
    },
    async cancelarConvite(token) {
      ok(await client.rpc('cancelar_convite', { p_token: token }));
    },
    async verConvite(token) {
      const d = ok(await client.rpc('ver_convite', { p_token: token }));
      return Array.isArray(d) ? d[0] : d;
    },
    async aceitarConvite(token, nome) {
      return ok(await client.rpc('aceitar_convite', { p_token: token, p_nome: nome }));
    },
    async salvarVinculos(usuarioId, adicionar, remover) {
      if (adicionar.length) ok(await client.from('usuario_tanques').insert(adicionar.map((t) => ({ usuario_id: usuarioId, tanque_id: t }))));
      if (remover.length) ok(await client.from('usuario_tanques').delete().eq('usuario_id', usuarioId).in('tanque_id', remover));
    },
  };
}

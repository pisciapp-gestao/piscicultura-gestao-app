// Envio da fila offline para o Supabase.
// - Cada item já nasce com uuid_local (gerado no celular). Se o envio é repetido, o banco
//   recusa com 23505 (único) e tratamos como "já enviado": não duplica.
// - Rede caiu, sinal ruim ou servidor instável (5xx): para e mantém tudo na fila; nada é descartado.
//   O app tenta de novo sozinho (a cada 20 s com o app aberto, ao voltar a internet e ao reabrir).
// - Só envia itens do usuário logado (o banco exige registrado_por = auth.uid()).
import { filaList, filaPut, filaRemove, kvGet, kvSet } from './db.js';

// Depois de enviar, anota o lançamento na cópia dos números guardada no aparelho (kv 'resumo').
// Sem isso, quem lança com sinal, fecha o app e abre no campo sem sinal via o tanque "sem ração":
// a cópia só se renovava quando a Início abria com sinal. Quando a Início abre com sinal, a cópia
// é trocada pelos números do banco, então uma diferença aqui dura pouco.
export async function anotarNoResumo(tabela, p) {
  try {
    if (tabela === 'qualidade_agua') { // a água medida vai para a lista dos últimos dias (a Ronda mostra "✓ água" sem sinal)
      const ag = await kvGet('agua14');
      if (Array.isArray(ag)) { ag.push({ data: p.data, hora: p.hora, tanque_id: p.tanque_id, oxigenio_mgl: p.oxigenio_mgl, temperatura_c: p.temperatura_c, ph: p.ph, amonia_mgl: p.amonia_mgl }); await kvSet('agua14', ag); }
      return;
    }
    const linhas = await kvGet('resumo');
    const r = Array.isArray(linhas) ? linhas.find((x) => x.lote_id === p.lote_id) : null;
    if (!r) return;
    const n = (v) => Number(v) || 0;
    if (tabela === 'racao_consumo') {
      r.racao_kg = n(r.racao_kg) + n(p.quantidade_kg);
      if (!r.ultima_racao || p.data > r.ultima_racao) r.ultima_racao = p.data;
      // peso de hoje (sql/42): a ração depois da última biometria faz o peso subir também sem sinal
      if (r.racao_desde_bio_kg != null) {
        if (!r.ultima_biometria || p.data > r.ultima_biometria) r.racao_desde_bio_kg = n(r.racao_desde_bio_kg) + n(p.quantidade_kg);
        else r.racao_ate_bio_kg = n(r.racao_ate_bio_kg) + n(p.quantidade_kg);
      }
      if (!r.primeira_racao || p.data < r.primeira_racao) r.primeira_racao = p.data;
    } else if (tabela === 'mortalidade') {
      r.mortos = n(r.mortos) + n(p.quantidade);
    } else if (tabela === 'despescas') {
      r.despescados = n(r.despescados) + n(p.quantidade);
    } else if (tabela === 'biometrias' && n(p.quantidade_amostrada) > 0 && (!r.ultima_biometria || p.data >= r.ultima_biometria)) {
      r.ultima_biometria = p.data;
      r.ultimo_peso_medio_kg = n(p.peso_amostra_kg) / n(p.quantidade_amostrada);
      // pesagem nova: a ração até ela vira "até a biometria" e o peso de hoje recomeça desta pesagem
      if (r.racao_desde_bio_kg != null) { r.racao_ate_bio_kg = n(r.racao_kg); r.racao_desde_bio_kg = 0; }
    } else return;
    await kvSet('resumo', linhas);
    if (tabela === 'racao_consumo') { // a lista de ração dos últimos dias (Início sem sinal) também
      const rac = await kvGet('racao14');
      if (Array.isArray(rac)) { rac.push({ data: p.data, tanque_id: p.tanque_id, lote_id: p.lote_id, quantidade_kg: p.quantidade_kg }); await kvSet('racao14', rac); }
    }
  } catch { /* sem armazenamento: só deixa de atualizar a cópia */ }
}
// O contrário de anotarNoResumo: um lançamento desfeito sai da cópia guardada no aparelho.
// A última pesagem não volta para a anterior (não está guardada): a cópia se renova na próxima abertura com sinal.
export async function desanotarNoResumo(tabela, p) {
  try {
    const tira = async (chave, igual) => {
      const l = await kvGet(chave);
      if (!Array.isArray(l)) return;
      const i = l.findIndex(igual);
      if (i >= 0) { l.splice(i, 1); await kvSet(chave, l); }
    };
    if (tabela === 'qualidade_agua') {
      await tira('agua14', (x) => x.tanque_id === p.tanque_id && x.data === p.data && (x.hora || null) === (p.hora || null) && Number(x.oxigenio_mgl) === Number(p.oxigenio_mgl));
      return;
    }
    if (tabela === 'racao_consumo') await tira('racao14', (x) => x.tanque_id === p.tanque_id && x.data === p.data && Math.abs(Number(x.quantidade_kg) - Number(p.quantidade_kg)) < 0.001);
    const linhas = await kvGet('resumo');
    const r = Array.isArray(linhas) ? linhas.find((x) => x.lote_id === p.lote_id) : null;
    if (!r) return;
    const n = (v) => Number(v) || 0;
    if (tabela === 'racao_consumo') {
      r.racao_kg = Math.max(0, n(r.racao_kg) - n(p.quantidade_kg));
      if (r.racao_desde_bio_kg != null) {
        if (!r.ultima_biometria || p.data > r.ultima_biometria) r.racao_desde_bio_kg = Math.max(0, n(r.racao_desde_bio_kg) - n(p.quantidade_kg));
        else r.racao_ate_bio_kg = Math.max(0, n(r.racao_ate_bio_kg) - n(p.quantidade_kg));
      }
    }
    else if (tabela === 'mortalidade') r.mortos = Math.max(0, n(r.mortos) - n(p.quantidade));
    else if (tabela === 'despescas') r.despescados = Math.max(0, n(r.despescados) - n(p.quantidade));
    else return;
    await kvSet('resumo', linhas);
  } catch { /* sem armazenamento: só deixa de atualizar a cópia */ }
}
import { ehErroDeRede, ehErroDeSessao, traduzErro } from './util.js';

const TABELAS = new Set(['biometrias', 'mortalidade', 'racao_consumo', 'despescas', 'manejos', 'qualidade_agua']);
let rodando = false;
let envioAtual = null;

// espera o envio em andamento terminar (o "Desfazer" precisa saber se o item ainda está na fila ou já foi para o banco)
export const esperarEnvio = () => envioAtual || Promise.resolve();

export function sincronizar(client, userId) {
  if (rodando) return Promise.resolve({ ocupado: true, enviados: 0, falhas: 0, semRede: false, sessaoExpirada: false });
  rodando = true;
  envioAtual = enviar(client, userId).finally(() => { rodando = false; envioAtual = null; });
  return envioAtual;
}

async function enviar(client, userId) {
  const r = { ocupado: false, enviados: 0, falhas: 0, semRede: false, sessaoExpirada: false };
  const tentados = new Set();
  try {
    // laço externo: pega também itens que entraram na fila enquanto sincronizava
    for (;;) {
      const itens = (await filaList()).filter((i) => i.registrado_por === userId && !tentados.has(i.uuid_local));
      if (!itens.length) break;
      for (const it of itens) {
        tentados.add(it.uuid_local);
        if (!TABELAS.has(it.tabela)) {
          it.status = 'erro'; it.erro = 'Tipo de lançamento desconhecido';
          await filaPut(it); r.falhas++;
          continue;
        }
        let error = null, status = 0;
        try {
          // a venda da despesca (preço/comprador, só do dono) viaja junto na fila, mas vai para outra tabela (sql/28)
          const { _venda, ...registro } = it.payload;
          ({ error, status } = await client.from(it.tabela).insert(registro));
          // banco ainda sem a coluna "causa" (sql/08 não rodado): salva sem ela em vez de travar a fila
          if (error && it.payload.causa !== undefined && /causa/i.test(error.message || '')) {
            const { causa, ...semCausa } = it.payload;
            ({ error, status } = await client.from(it.tabela).insert(semCausa));
          }
        } catch (e) {
          error = { message: String((e && e.message) || e), code: '' };
        }
        if ((!error || error.code === '23505') && it.payload._venda) {
          // a despesca já está no banco; agora a venda (de novo, se for repetição: a gravação substitui)
          const v = it.payload._venda;
          let ev = null, sv = 0;
          try {
            ({ error: ev, status: sv } = await client.from('despesca_vendas')
              .upsert({ despesca_uuid: it.payload.uuid_local, preco_kg: v.preco_kg ?? null, comprador: v.comprador || null }, { onConflict: 'despesca_uuid' }));
          } catch (e) { ev = { message: String((e && e.message) || e), code: '' }; }
          if (ev) {
            if (!error) await anotarNoResumo(it.tabela, it.payload); // a despesca entrou: o resumo já conta
            if (ehErroDeRede(ev) || sv >= 500 || sv === 408 || sv === 429) { r.semRede = true; return r; }
            if (ehErroDeSessao(ev)) { r.sessaoExpirada = true; return r; }
            it.status = 'erro'; it.erro = 'A despesca foi enviada, mas o preço de venda não foi gravado: ' + traduzErro(ev);
            it.tentativas = (it.tentativas || 0) + 1;
            await filaPut(it); r.falhas++;
            continue;
          }
        }
        if (!error || error.code === '23505') {
          if (!error) await anotarNoResumo(it.tabela, it.payload); // 23505 = já tinha ido antes: não soma de novo
          await filaRemove(it.uuid_local);
          r.enviados++;
          continue;
        }
        // rede fora, sinal ruim ou servidor sobrecarregado/instável (5xx, 408, 429): é temporário.
        // Mantém o item como está (sem marcar erro) e tenta de novo mais tarde.
        if (ehErroDeRede(error) || status >= 500 || status === 408 || status === 429) { r.semRede = true; return r; }
        if (ehErroDeSessao(error)) { r.sessaoExpirada = true; return r; }
        it.status = 'erro';
        it.erro = traduzErro(error);
        it.tentativas = (it.tentativas || 0) + 1;
        await filaPut(it);
        r.falhas++;
      }
    }
  } finally { /* rodando volta a false em sincronizar() */ }
  return r;
}

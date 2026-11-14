# Monta a tela Início e a tela do tanque 10 mil vezes CADA, no navegador de verdade, com fazendas geradas ao acaso
# (semente fixa): tanques e lotes de todas as fases, pesagem vazia/igual à entrada/antes da entrada, mais mortos que
# peixes, estoque negativo, previsão do tempo com dias vazios, os 3 papéis. Nenhuma montagem pode dar erro, ter bloco
# com "Não foi possível mostrar" nem texto quebrado (undefined, NaN, Infinity, Invalid Date, [object Object]).
import os, json
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
N = int(os.environ.get('N', '10000'))

JS = r"""
async ({ N }) => {
  const { renderHome } = await import('/js/views/home.js');
  const { renderTanqueDetalhe } = await import('/js/views/tanque-detalhe.js');
  const db = await import('/js/db.js');
  let semente = 777;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  const um = (l) => l[Math.floor(rnd() * l.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const hoje = new Date(); const iso = (n) => new Date(hoje.getTime() - n * 864e5).toISOString().slice(0, 10);
  const RUIM = /undefined|NaN|Infinity|Invalid Date|\[object Object\]|Não foi possível mostrar/;
  const falhas = [];
  let home = 0, detalhe = 0;
  function fazenda() {
    const nt = um([0, 1, 2, 5, 15, 40]);
    const tanques = Array.from({ length: nt }, (_, i) => ({ id: 'T' + i, nome: um(['Tanque ' + (i + 1), 'Viveiro <b>' + i + '</b> & "x"', '🐟 ' + i]), area_ha: um([null, 0, 0.1, 2.3, 18]) }));
    const lotes = [], resumo = [];
    tanques.forEach((t, i) => {
      for (let k = 0; k < um([0, 1, 1, 1, 2, 3]); k++) {
        const q = um([0, 1, 3, 100, 5200, 18441, 43000, 98000]);
        const pm = um([0, 0.005, 0.05, 0.25, 0.5, 1.1, 1.8, 2.3, 4]);
        const id = `L${i}_${k}`;
        const ent = iso(int(-10, 600));
        lotes.push({ id, tanque_id: t.id, tipo: um(['bercario', 'alevinagem', 'recria', 'engorda']), especie: um(['Tambaqui', 'Tilápia']), data_entrada: ent, quantidade_inicial: q, peso_inicial_kg: Math.round(q * pm * 100) / 100, ativo: true, tanques: { nome: t.nome } });
        if (rnd() < 0.85) resumo.push({ lote_id: id, racao_kg: um([0, 10, 1e6]), mortos: int(0, q + 100),
          ultimo_peso_medio_kg: um([null, 0, pm, pm * (1 + 1e-12), pm + 1e-7, pm * 1.4, pm * 0.8]),
          ultima_biometria: um([null, ent, iso(int(-5, 700)), iso(0)]), ultima_racao: um([null, iso(0), iso(1)]) });
      }
    });
    if (rnd() < 0.1 && tanques.length) lotes.push({ id: 'orfao', tanque_id: 'NAO_EXISTE', tipo: 'engorda', especie: 'Tambaqui', data_entrada: iso(30), quantidade_inicial: 10, peso_inicial_kg: 5, ativo: true, tanques: null });
    const racao = Array.from({ length: int(0, 60) }, () => ({ data: iso(int(0, 13)), quantidade_kg: um([0, 0.5, 25, 300, 1e5]), tanque_id: tanques.length ? um(tanques).id : 'X', lote_id: lotes.length ? um(lotes).id : 'Y' }));
    const mortes = Array.from({ length: int(0, 20) }, () => ({ data: iso(int(0, 6)), quantidade: int(0, 300), lote_id: lotes.length ? um(lotes).id : 'Y', causa: um([null, 'Oxigênio']) }));
    const linha = (tipo) => ({ tipo_racao: tipo, total_comprado_kg: um([0, 1000, 1e6]), total_consumido_kg: um([0, 500, 2e6]), total_ajustes_kg: um([0, -50]), saldo_kg: um([-4000, 0, 25, 23000, 1e6]), consumo_7d_kg: um([0, 7, 3500, 1e5]), ultima_contagem: um([null, iso(3), iso(400)]) });
    const saldos = um([null, { porTipo: false, linhas: [linha('engorda')] }, { porTipo: true, linhas: [linha('engorda'), linha('alevino')] }, { porTipo: true, linhas: [] }]);
    return { tanques, lotes, resumo, racao, mortes, saldos };
  }
  // previsão do tempo guardada (com dias vazios) e meta de despesca guardada para alguns lotes
  await db.kvSet('climaLocal', { lat: 2.82, lon: -60.67 });
  for (let i = 0; i < N; i++) {
    const f = fazenda();
    const papel = um(['dono', 'gerente', 'funcionario']);
    const tempoDias = Array.from({ length: 4 }, (_, k) => ({ data: iso(-k), min: um([null, -3, 19, 26]), max: um([null, 30, 37]), chuva: um([null, 0, 40]), codigo: um([null, 3, 63, 999]) }));
    await db.kvSet('climaPrev', { lat: 2.82, lon: -60.67, em: Date.now(), dias: tempoDias });
    if (i % 50 === 0) await db.kvSet('metasDespesca', Object.fromEntries(f.lotes.slice(0, 3).map((l) => [l.id, um([0.001, 2.5, 100])])));
    const ctx = {
      state: { perfil: { id: 'U', nome: 'Ana', papel, fazenda_id: 'F', fazendas: { nome: 'Fazenda' } }, ref: { tanques: f.tanques, lotes: f.lotes, kgSaco: um([25, 20, 40]), precoKg: um([null, 9.5]) } },
      api: {
        resumoLotes: async () => f.resumo, saldosRacao: async () => { if (!f.saldos) throw new Error('rpc'); return f.saldos; },
        racaoPeriodo: async () => f.racao, mortalidadePeriodo: async () => f.mortes, aguaPeriodo: async () => [], plano: async () => ({ estado: um(['ativo', 'teste', 'vencido']), valido_ate: iso(-5), em_uso: 1, limite: 5 }),
        criarTanque: async () => {},
        // pedidos de correção (sql/35): sem o sql (null), nenhum, alguns abertos, ou erro do servidor
        pedidosCorrecao: async () => { const v = um(['null', 'vazio', 'alguns', 'erro']); if (v === 'erro') throw new Error('rpc'); return v === 'null' ? null : v === 'vazio' ? [] : Array.from({ length: int(1, 4) }, (_, k) => ({ id: 'P' + k, status: um(['pendente', 'aprovado']), tabela: 'racao_consumo', acao: 'corrigir', antes: {}, campos: {} })); },
      },
      podeGerir: () => papel !== 'funcionario', toast: () => {}, atualizarRef: async () => true,
    };
    const el = document.createElement('div');
    try {
      await renderHome(ctx, el); home++;
      const t = el.innerText || el.textContent;
      const m = t.match(RUIM); if (m) falhas.push({ tela: 'Início', i, papel, achou: m[0], trecho: t.slice(Math.max(0, m.index - 80), m.index + 80) });
    } catch (e) { falhas.push({ tela: 'Início', i, papel, erro: String(e && e.message || e) }); }
    const el2 = document.createElement('div');
    const tid = f.tanques.length ? um(f.tanques).id : 'NAO_EXISTE';
    try {
      await renderTanqueDetalhe(ctx, el2, tid); detalhe++;
      const t = el2.innerText || el2.textContent;
      const m = t.match(RUIM); if (m) falhas.push({ tela: 'Tanque', i, papel, achou: m[0], trecho: t.slice(Math.max(0, m.index - 80), m.index + 80) });
    } catch (e) { falhas.push({ tela: 'Tanque', i, papel, erro: String(e && e.message || e) }); }
    if (falhas.length > 30) break;
  }
  return { home, detalhe, falhas };
}
"""

with sync_playwright() as pw:
    b = pw.chromium.launch(**LANCAR)
    pg = b.new_page(reduced_motion='reduce')
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(BASE + 'testes/telas/pagina_vazia.html')
    r = pg.evaluate(JS, {'N': N})
    b.close()
print(f"Tela Início montada {r['home']} vezes; tela do tanque montada {r['detalhe']} vezes")
for f in r['falhas'][:15]: print('FALHA', json.dumps(f, ensure_ascii=False)[:400])
for e in erros[:5]: print('FALHA erro de JS na página:', e[:300])
ok = not r['falhas'] and not erros and r['home'] >= N and r['detalhe'] >= N
print('RESULTADO:', 'TUDO OK' if ok else f"{len(r['falhas']) + len(erros) or 1} PROBLEMA(S)")

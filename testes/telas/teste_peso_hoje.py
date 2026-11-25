# Peso de hoje nas telas (sql/42, pedido dos clientes 25/11/2026): a biomassa acompanha a ração dada depois da última
# biometria na Início, em Tanques e na tela do tanque; sem sinal, a ração lançada também faz o peso subir.
# Supabase SIMULADO. Celular e computador.
import os
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
import json, time, datetime, re
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
SB = 'https://ppvliseblxpsepmeknnl.supabase.co'
U = '11111111-1111-4111-8111-111111111111'; F = '22222222-2222-4222-8222-222222222222'
T = '33333333-3333-4333-8333-333333333333'; L = '44444444-4444-4444-8444-444444444444'
ok = True
def checa(c, m):
    global ok
    print(('OK   ' if c else 'FALHA ') + m); ok = ok and c
d = lambda n: (datetime.date.today() - datetime.timedelta(days=n)).isoformat()
LOTE = {'id': L, 'tanque_id': T, 'tipo': 'engorda', 'especie': 'Tambaqui', 'data_entrada': d(90), 'quantidade_inicial': 1000, 'peso_inicial_kg': 50, 'ativo': True, 'tanques': {'nome': 'Tanque 1'}}

def abrir(pw, vp, colunas=True, desde=45):
    b = pw.chromium.launch(**LANCAR); ctx = b.new_context(reduced_motion='reduce', viewport=vp); pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    def rota(route, req):
        u = req.url
        if not u.startswith(SB):
            return route.continue_() if (u.startswith(BASE) or 'cdn' in u or 'jsdelivr' in u or 'unpkg' in u or 'fonts.g' in u) else route.abort()
        path = urlparse(u).path; obj = 'object' in (req.headers.get('accept') or '')
        js = lambda o, st=200: route.fulfill(status=st, content_type='application/json', body=json.dumps(o))
        if req.method in ('POST', 'PATCH') and '/rpc/' not in path: return js([], 201)
        if '/rpc/' in path:
            fn = path.split('/')[-1]
            if fn == 'resumo_lotes':
                r = {'lote_id': L, 'racao_kg': 3000 + desde, 'mortos': 0, 'ultimo_peso_medio_kg': 0.5, 'ultima_biometria': d(3), 'ultima_racao': d(0), 'despescados': 0, 'transferidos': 0}
                if colunas: r.update({'racao_ate_bio_kg': 3000, 'racao_desde_bio_kg': desde, 'primeira_racao': d(90)})
                return js([r])
            if fn == 'saldo_racao': return js([{'saldo_kg': 5000, 'consumo_7d_kg': 350, 'total_comprado_kg': 9000, 'total_consumido_kg': 4000, 'total_ajustes_kg': 0}])
            return js(False if fn == 'eh_admin' else None if fn in ('plano_atual', 'meu_suporte') else [])
        tab = path.split('/')[-1]
        perfil = {'id': U, 'nome': 'Hugo', 'papel': 'dono', 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'Fazenda Teste'}}
        if tab == 'usuarios': return js(perfil if obj else [perfil])
        if tab == 'tanques': return js([{'id': T, 'nome': 'Tanque 1', 'area_ha': 1}])
        if tab == 'lotes': return js(LOTE if obj else [LOTE])
        if tab == 'fazendas': return js({'kg_saco': 25} if obj else [{'kg_saco': 25}])
        return js([])
    pg.route('**/*', rota)
    s = {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 2592000, 'expires_at': int(time.time()) + 2592000, 'user': {'id': U, 'aud': 'authenticated'}}
    pg.add_init_script(f"localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(s))});")
    return b, ctx, pg, erros

def numero(txt):  # "531 kg" / "0,53 t" → kg
    m = re.search(r'([\d.]+(?:,\d+)?)\s*(t|kg)', txt)
    if not m: return None
    v = float(m.group(1).replace('.', '').replace(',', '.'))
    return v * 1000 if m.group(2) == 't' else v

with sync_playwright() as pw:
    for nome, vp in [('celular', {'width': 390, 'height': 844}), ('pc', {'width': 1366, 'height': 900})]:
        b, ctx, pg, erros = abrir(pw, vp)
        pg.goto(BASE + '#/'); pg.wait_for_selector('#view', timeout=20000); pg.wait_for_timeout(2500)
        t = pg.inner_text('#view'); i = t.find('Peixe na água')
        kg_inicio = numero(t[i:i + 40]) if i >= 0 else None
        checa(kg_inicio is not None and kg_inicio > 500, f'{nome}: Início: peixe na água maior que na biometria (1.000 × 0,5 kg = 500 kg): {kg_inicio}')
        pg.goto(BASE + f'#/t/{T}'); pg.wait_for_selector('.td-hero', timeout=20000); pg.wait_for_timeout(800)
        h = pg.inner_text('.td-hero')
        checa('Peso médio hoje' in h and '≈' in h and 'pela ração' in h and 'pesado 500 g' in h, f'{nome}: tanque mostra "Peso médio hoje ≈" pela ração e o peso pesado: {h[:120]!r}')
        g = re.search(r'≈\s*([\d.]+)', h); g = int(g.group(1).replace('.', '')) if g else 0
        checa(505 < g < 560, f'{nome}: peso de hoje plausível depois de 45 kg de ração em 3 dias para 1.000 peixes de 500 g: {g} g')
        checa(pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{nome}: sem rolar para os lados')
        pg.screenshot(path=f'peso_hoje_{nome}.png', full_page=True)
        # sem sinal: a ração lançada entra na conta (cópia guardada no aparelho)
        antes = pg.evaluate("""async () => { const db = await import('./js/db.js'); const r = await db.kvGet('resumo'); return r && r[0] ? r[0].racao_desde_bio_kg : null; }""")
        pg.evaluate(f"""async () => {{ const s = await import('./js/sync.js'); await s.anotarNoResumo('racao_consumo', {{ lote_id: '{L}', tanque_id: '{T}', data: '{d(0)}', quantidade_kg: 15 }}); }}""")
        depois = pg.evaluate("""async () => { const db = await import('./js/db.js'); const r = await db.kvGet('resumo'); return r && r[0] ? r[0].racao_desde_bio_kg : null; }""")
        checa(antes is not None and abs(float(depois) - float(antes) - 15) < 1e-6, f'{nome}: ração lançada sem sinal soma na "ração depois da biometria" guardada: {antes} → {depois}')
        ctx.set_offline(True)
        pg.goto(BASE + '#/mais'); pg.wait_for_timeout(600); pg.goto(BASE + f'#/t/{T}'); pg.wait_for_timeout(2500)
        h2 = pg.inner_text('.td-hero') if pg.locator('.td-hero').count() else ''
        g2 = re.search(r'≈\s*([\d.]+)', h2); g2 = int(g2.group(1).replace('.', '')) if g2 else 0
        checa(g2 > g, f'{nome}: sem sinal, o peso de hoje sobe com a ração lançada: {g} g → {g2} g')
        # lançado SEM SINAL de verdade: fica na fila do aparelho (ainda não foi para o banco) e já conta no peso
        pg.evaluate(f"""async () => {{ const db = await import('./js/db.js'); await db.filaAdd({{ uuid_local: 'fila-1', tabela: 'racao_consumo', payload: {{ uuid_local: 'fila-1', lote_id: '{L}', tanque_id: '{T}', data: '{d(0)}', quantidade_kg: 15, registrado_por: '{U}' }}, registrado_por: '{U}', criado_em: new Date().toISOString(), status: 'pendente', erro: null, tentativas: 0 }}); }}""")
        pg.goto(BASE + '#/mais'); pg.wait_for_timeout(600); pg.goto(BASE + f'#/t/{T}'); pg.wait_for_timeout(2500)
        h3 = pg.inner_text('.td-hero') if pg.locator('.td-hero').count() else ''
        g3 = re.search(r'≈\s*([\d.]+)', h3); g3 = int(g3.group(1).replace('.', '')) if g3 else 0
        checa(g3 > g2, f'{nome}: ração na fila do aparelho (sem sinal, ainda não enviada) também faz o peso subir: {g2} g → {g3} g')
        pg.goto(BASE + '#/'); pg.wait_for_timeout(2500)
        t3 = pg.inner_text('#view'); i3 = t3.find('Peixe na água'); kg3 = numero(t3[i3:i3 + 40]) if i3 >= 0 else None
        checa(kg3 is not None and kg3 > kg_inicio, f'{nome}: Início sem sinal: peixe na água sobe com a ração lançada: {kg_inicio} → {kg3}')
        pg.evaluate("async () => { const db = await import('./js/db.js'); await db.filaRemove ? db.filaRemove('fila-1') : null; }")
        ctx.set_offline(False)
        pg.evaluate(f"""async () => {{ const s = await import('./js/sync.js'); await s.anotarNoResumo('biometrias', {{ lote_id: '{L}', data: '{d(0)}', peso_amostra_kg: 30, quantidade_amostrada: 50 }}); }}""")
        r = pg.evaluate("""async () => { const db = await import('./js/db.js'); const r = await db.kvGet('resumo'); return r[0]; }""")
        checa(float(r['racao_desde_bio_kg']) == 0 and abs(float(r['ultimo_peso_medio_kg']) - 0.6) < 1e-9, f'{nome}: biometria nova sem sinal: o peso recomeça da pesagem (ração depois = 0)')
        checa(not erros, f'{nome}: sem erro de JavaScript {erros[:2]}')
        b.close()
    # banco ainda sem o sql/42: telas como antes (peso da biometria), sem erro
    b, ctx, pg, erros = abrir(pw, {'width': 390, 'height': 844}, colunas=False)
    pg.goto(BASE + f'#/t/{T}'); pg.wait_for_selector('.td-hero', timeout=20000); pg.wait_for_timeout(800)
    h = pg.inner_text('.td-hero')
    checa('Peso médio atual' in h and '500' in h and '≈' not in h, 'sem o sql/42: mostra o peso da biometria, como antes')
    checa(not erros, 'sem o sql/42: sem erro de JavaScript')
    b.close()
    # ração lançada a mais: aviso no tanque, sem peso absurdo
    b, ctx, pg, erros = abrir(pw, {'width': 390, 'height': 844}, desde=25000)
    pg.goto(BASE + f'#/t/{T}'); pg.wait_for_selector('.td-hero', timeout=20000); pg.wait_for_timeout(800)
    h = pg.inner_text('.td-hero')
    checa('confira a ração lançada' in h and '≈' not in h, 'ração lançada a mais (1.000 sacos): aviso no tanque, sem estimativa absurda')
    b.close()

print('RESULTADO: TUDO OK' if ok else 'RESULTADO: HÁ FALHAS')

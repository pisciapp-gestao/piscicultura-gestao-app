# Povoamento em outra data (14/11/26, sql/40), Supabase SIMULADO: o lote mostra os povoamentos, adiciona peixes
# com peso por tamanho (5 cm), corrige e exclui. Tanque novo abre direto no povoamento. 'Data de povoamento' no formulário.
import os
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
import json, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
SB = 'https://ppvliseblxpsepmeknnl.supabase.co'
U = '11111111-1111-4111-8111-111111111111'
F = '22222222-2222-4222-8222-222222222222'
T = '33333333-3333-4333-8333-333333333333'    # com área e lote ativo
T2 = '66666666-6666-4666-8666-666666666666'   # sem área, sem lote
L1 = '44444444-4444-4444-8444-444444444444'

dados = {
  'usuarios': [{'id': U, 'nome': 'Teste Dono', 'papel': 'dono', 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'Fazenda Teste'}}],
  'tanques': [{'id': T, 'nome': 'Tanque 01', 'area_ha': 2}, {'id': T2, 'nome': 'Tanque 02', 'area_ha': None}],
  'lotes': [{'id': L1, 'tanque_id': T, 'tipo': 'recria', 'especie': 'Tambaqui', 'data_entrada': '2026-09-01', 'quantidade_inicial': 10000, 'peso_inicial_kg': 5000, 'ativo': True, 'tanques': {'nome': 'Tanque 01'}}],
  'racao_consumo': [], 'biometrias': [], 'mortalidade': [],
  'racao_estoque': [{'id': 'c1', 'data_compra': time.strftime('%Y-%m-%d'), 'quantidade_kg': 500, 'custo_total': None, 'fornecedor': 'Agro X', 'tipo_racao': 'engorda'}],
  'racao_contagens': [], 'usuario_tanques': [],
  'povoamentos': [{'id': 'p1', 'lote_id': L1, 'data': '2026-09-05', 'quantidade': 2000, 'peso_total_kg': 1000}],
}
posts, externos, erros_js = [], [], []

def rota(route, req):
    url = req.url
    if not url.startswith(SB):
        if url.startswith(BASE) or url.startswith('data:') or 'cdn' in url or 'jsdelivr' in url or 'unpkg' in url or 'fonts.g' in url:
            return route.continue_()
        externos.append(url); return route.abort()
    p = urlparse(url); path = p.path
    if req.method == 'POST' and '/rest/v1/' in path and '/rpc/' not in path:
        tab = path.split('/')[-1]; body = json.loads(req.post_data or '{}')
        for linha in (body if isinstance(body, list) else [body]): posts.append((tab, linha))
        return route.fulfill(status=201, content_type='application/json', body='[]')
    if req.method == 'DELETE':
        posts.append(('DELETE ' + path.split('/')[-1], dict(parse_qs(p.query))))
        return route.fulfill(status=200, content_type='application/json', body='[{"id":"x"}]')
    if req.method == 'PATCH':
        posts.append(('PATCH ' + path.split('/')[-1], json.loads(req.post_data or '{}')))
        return route.fulfill(status=200, content_type='application/json', body='[{"id":"x"}]')
    if '/rpc/' in path:
        fn = path.split('/')[-1]
        out = {'resumo_lotes': [{'lote_id': L1, 'mortos': 0, 'ultimo_peso_medio_kg': 0.8}], 'plano_atual': None,
               'saldo_racao': [{'total_comprado_kg': 500, 'total_consumido_kg': 0, 'total_ajustes_kg': 0, 'saldo_kg': 500, 'consumo_7d_kg': 0, 'ultima_contagem': None}],
               'consumo_diario': []}.get(fn, [])
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(out))
    if '/rest/v1/' in path:
        tab = path.split('/')[-1]
        linhas = [{'kg_saco': 25, 'teste_ate': None}] if tab == 'fazendas' else list(dados.get(tab, []))
        q = parse_qs(p.query)
        if 'id' in q and q['id'][0].startswith('eq.'): linhas = [r for r in linhas if r.get('id') == q['id'][0][3:]]
        if 'object' in (req.headers.get('accept') or ''):
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(linhas[0] if linhas else None))
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(linhas))
    externos.append(url); return route.abort()

sessao = {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 3600 * 24 * 30,
          'expires_at': int(time.time()) + 3600 * 24 * 30, 'user': {'id': U, 'email': 't@t.com', 'aud': 'authenticated', 'role': 'authenticated'}}
ok = True
def abrir_dobra(pg, sel):  # toca na linha que abre o formulário (só se estiver fechada), como a pessoa faz
    d = pg.locator(sel).first; d.wait_for(state='attached', timeout=20000)
    if d.get_attribute('open') is None: d.locator('summary').first.click(); pg.wait_for_timeout(200)
def checa(cond, msg):
    global ok
    print(('OK   ' if cond else 'FALHA ') + msg); ok = ok and cond
def achou(tab, **campos):
    return any(t == tab and all(abs(float(l.get(k, -1))) - abs(float(v)) == 0 if isinstance(v, (int, float)) else l.get(k) == v for k, v in campos.items()) for t, l in posts)


def abrir(papel):
    dados['usuarios'][0]['papel'] = papel
    pg = b.new_page(reduced_motion='reduce', viewport={'width': 390, 'height': 844})
    pg.on('pageerror', lambda e: erros_js.append(str(e)))
    pg.route('**/*', rota)
    pg.add_init_script(f"localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(sessao))});")
    pg.goto(BASE + '#/'); pg.wait_for_selector('#view', timeout=20000)
    return pg

with sync_playwright() as pw:
    b = pw.chromium.launch(**LANCAR)
    pg = abrir('dono')
    pg.goto(BASE + f'#/tanque/{T}'); pg.wait_for_selector('.lote-dobra', timeout=15000)
    pg.locator('.lote-dobra summary').first.click(); pg.wait_for_timeout(300)
    txt = pg.inner_text('.lote-dobra')
    checa('povoado em 2 datas' in txt, 'lote com 2 povoamentos diz "povoado em 2 datas"')
    checa('01/09/2026 · 8.000 peixes' in txt and '05/09/2026 · +2.000 peixes' in txt, f'lista: 1º povoamento 8.000 (10.000 − 2.000) e +2.000 em 05/09')
    pg.screenshot(path='povoamentos_lista.png', full_page=True)
    # adicionar por tamanho: 30.000 de 5 cm
    pg.click('[data-add-pov]'); pg.wait_for_selector('.dialogo-caixa', timeout=5000)
    pg.fill('.dialogo-caixa input[name=qtd]', '30000'); pg.fill('.dialogo-caixa input[name=pm]', '5'); pg.select_option('.dialogo-caixa select[name=un]', 'cm')
    pg.screenshot(path='povoamentos_add.png')
    pg.click('.dialogo-caixa button[type=submit]'); pg.wait_for_timeout(1200)
    checa(achou('povoamentos', lote_id=L1, quantidade=30000, peso_total_kg=93), f'grava +30.000 de 5 cm ≈ 3,1 g = 93 kg ({[l for t, l in posts if t == "povoamentos"]})')
    checa(any(t == 'povoamentos' and l.get('registrado_por') == U for t, l in posts), 'grava quem lançou')
    pg.close()
    # corrigir e excluir o povoamento extra
    pg = abrir('dono')
    pg.goto(BASE + f'#/tanque/{T}'); pg.wait_for_selector('.lote-dobra', timeout=15000); pg.locator('.lote-dobra summary').first.click()
    pg.click('[data-editar-pov="p1"]'); pg.wait_for_selector('.dialogo-caixa', timeout=5000)
    checa(pg.input_value('.dialogo-caixa input[name=qtd]') == '2000' and pg.input_value('.dialogo-caixa input[name=pm]') == '500' and pg.input_value('.dialogo-caixa select[name=un]') == 'g', 'corrigir abre com 2.000 peixes e 500 g')
    pg.fill('.dialogo-caixa input[name=qtd]', '2500'); pg.click('.dialogo-caixa button[type=submit]'); pg.wait_for_timeout(1200)
    checa(any(t == 'PATCH povoamentos' and l.get('quantidade') == 2500 and abs(l.get('peso_total_kg') - 1250) < 0.01 for t, l in posts), 'corrige para 2.500 peixes (1.250 kg)')
    pg.click('[data-excluir-pov="p1"]'); pg.wait_for_selector('.dialogo-caixa', timeout=5000)
    pg.click('.dialogo-caixa [data-ok]'); pg.wait_for_timeout(1200)
    checa(any(t == 'DELETE povoamentos' for t, l in posts), 'exclui o povoamento')
    # corrigir o 1º povoamento mantém os extras somados
    pg.wait_for_selector('.lote-dobra', timeout=15000); abrir_dobra(pg, '.lote-dobra')
    pg.locator('.pov-lista [data-editar-lote]').first.click(); pg.wait_for_selector('.dialogo-caixa', timeout=5000)
    checa(pg.input_value('.dialogo-caixa input[name=qtd]') == '8000', 'corrigir lote mostra só o 1º povoamento (8.000)')
    pg.fill('.dialogo-caixa input[name=qtd]', '9000'); pg.click('.dialogo-caixa button[type=submit]'); pg.wait_for_timeout(1200)
    checa(any(t == 'PATCH lotes' and l.get('quantidade_inicial') == 11000 and abs(l.get('peso_inicial_kg') - 5500) < 0.01 for t, l in posts), 'corrigir o 1º para 9.000 grava total 11.000 (9.000 + 2.000) e 5.500 kg')
    pg.close()
    # formulário novo: data de povoamento e peso por cm
    pg = abrir('dono')
    pg.goto(BASE + f'#/tanque/{T2}'); pg.wait_for_selector('#f-lote', timeout=15000)
    checa(pg.inner_text('#rot-data') == 'Data de povoamento', 'formulário diz "Data de povoamento"')
    pg.check('#andamento'); checa(pg.inner_text('#rot-data') == 'Data de povoamento', 'lote antigo (em andamento) também pede "Data de povoamento"')
    pg.uncheck('#andamento')
    pg.select_option('#tipo', 'bercario'); pg.fill('#qtd', '40000'); pg.fill('#pm-in', '5'); pg.select_option('#pm-un', 'cm'); pg.wait_for_timeout(200)
    checa('≈ 3,1 g' in pg.inner_text('#cm-est'), f'5 cm mostra ≈ 3,1 g ({pg.inner_text("#cm-est")})')
    pg.click('#f-lote button[type=submit]'); pg.wait_for_timeout(1200)
    checa(achou('lotes', tanque_id=T2, tipo='bercario', quantidade_inicial=40000, peso_inicial_kg=124), 'grava berçário: 40.000 × 3,1 g = 124 kg')
    pg.close()
    # tanque novo abre direto no povoamento
    pg = abrir('dono')
    pg.goto(BASE + '#/tanques'); abrir_dobra(pg, '#d-novo-tanque')
    pg.fill('#f-novo #nome', 'Tanque 99'); pg.click('#f-novo button[type=submit]'); pg.wait_for_timeout(1500)
    checa(pg.evaluate('location.hash').startswith('#/tanque/'), f'tanque novo abre a tela de povoar ({pg.evaluate("location.hash")})')
    pg.close()
    b.close()

checa(not externos, f'nenhuma requisição para fora ({externos[:2]})')
checa(not erros_js, f'sem erro de JavaScript ({erros_js[:2]})')
print('\nRESULTADO: TUDO OK' if ok else '\nRESULTADO: HOUVE FALHAS'); raise SystemExit(0 if ok else 1)

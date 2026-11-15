# Teste das telas de edição do PisciApp com o Supabase SIMULADO (nenhuma requisição sai para o banco real).
import os
# Onde o app está rodando (python -m http.server 5500 na pasta do projeto) e qual navegador usar.
# NAVEGADOR=chrome usa o Chrome instalado; NAVEGADOR= (vazio) usa o Chromium do Playwright (playwright install chromium).
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
import json, re, sys, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
SB = 'https://ppvliseblxpsepmeknnl.supabase.co'
U = '11111111-1111-4111-8111-111111111111'
F = '22222222-2222-4222-8222-222222222222'
T = '33333333-3333-4333-8333-333333333333'
L1 = '44444444-4444-4444-8444-444444444444'   # ativo
L2 = '55555555-5555-4555-8555-555555555555'   # encerrado
H = time.strftime('%Y-%m-%d')

dados = {
  'usuarios': [{'id': U, 'nome': 'Teste Dono', 'papel': 'dono', 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'Fazenda Teste'}}],
  'tanques': [{'id': T, 'nome': 'Tanque 1'}],
  'lotes': [
    {'id': L1, 'tanque_id': T, 'tipo': 'engorda', 'especie': 'Tambaqui', 'data_entrada': '2026-09-01', 'quantidade_inicial': 1000, 'peso_inicial_kg': 50, 'ativo': True, 'tanques': {'nome': 'Tanque 1'}},
    {'id': L2, 'tanque_id': T, 'tipo': 'alevinagem', 'especie': 'Tilápia', 'data_entrada': '2026-06-01', 'quantidade_inicial': 500, 'peso_inicial_kg': 5, 'ativo': False, 'tanques': {'nome': 'Tanque 1'}},
  ],
  'racao_consumo': [{'id': 'r1', 'data': '2026-10-10', 'quantidade_kg': 30, 'registrado_por': U, 'tanque_id': T}],
  'biometrias': [{'id': 'b1', 'data': '2026-10-05', 'peso_amostra_kg': 10, 'quantidade_amostrada': 50, 'registrado_por': U}],
  'mortalidade': [{'id': 'm1', 'data': '2026-10-06', 'quantidade': 3, 'causa': 'Temperatura', 'registrado_por': U}],
  'racao_estoque': [{'id': 'c1', 'data_compra': '2026-10-01', 'quantidade_kg': 500, 'custo_total': 1200, 'fornecedor': 'Agro X'}],
  'racao_contagens': [], 'usuario_tanques': [],
}
patches, externos, erros_js = [], [], []

def rota(route, req):
    url = req.url
    if not url.startswith(SB):
        if url.startswith(BASE) or url.startswith('data:') or 'cdn' in url or 'jsdelivr' in url or 'unpkg' in url or 'fonts.g' in url:
            return route.continue_()
        externos.append(url); return route.abort()
    p = urlparse(url); path = p.path
    if req.method == 'PATCH':
        tab = path.split('/')[-1]; idf = parse_qs(p.query).get('id', [''])[0].replace('eq.', '')
        body = json.loads(req.post_data or '{}'); patches.append((tab, idf, body))
        for r in dados.get(tab, []):
            if r['id'] == idf: r.update(body)
        return route.fulfill(status=200, content_type='application/json', body=json.dumps([{'id': idf}]))
    if '/rpc/' in path:
        fn = path.split('/')[-1]
        out = {'resumo_lotes': [], 'plano_atual': None,
               'saldo_racao': [{'total_comprado_kg': 500, 'total_consumido_kg': 30, 'total_ajustes_kg': 0, 'saldo_kg': 470, 'consumo_7d_kg': 70, 'ultima_contagem': None}],
               'consumo_diario': []}.get(fn, [])
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(out))
    if '/rest/v1/' in path:
        tab = path.split('/')[-1]
        if tab == 'fazendas':
            linhas = [{'kg_saco': 25, 'teste_ate': None}]
        else:
            linhas = list(dados.get(tab, []))
            q = parse_qs(p.query)
            for k in ('id', 'lote_id'):
                if k in q and q[k][0].startswith('eq.'):
                    v = q[k][0][3:]
                    if k == 'lote_id': linhas = linhas if v == L1 else []
                    else: linhas = [r for r in linhas if r['id'] == v]
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

with sync_playwright() as pw:
    b = pw.chromium.launch(**LANCAR)
    pg = b.new_page(reduced_motion='reduce', viewport={'width': 390, 'height': 844})
    pg.on('pageerror', lambda e: erros_js.append(str(e)))
    pg.route('**/*', rota)
    pg.add_init_script(f"localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(sessao))});")
    pg.goto(BASE + '#/'); pg.wait_for_selector('#view', timeout=20000)

    # 1) Registros do lote: editar ração, biometria e mortalidade
    pg.goto(BASE + f'#/relatorio/{L1}'); pg.wait_for_selector('.seg button[data-aba=registros]', timeout=15000)
    pg.click('.seg button[data-aba=registros]'); pg.wait_for_timeout(500); pg.screenshot(path='registros.png', full_page=True)
    pg.click('[data-edit="racao_consumo:r1"]'); pg.wait_for_selector('.dialogo form'); pg.wait_for_timeout(400); pg.screenshot(path='dialogo.png')
    pg.fill('.dialogo [name=kg]', '0'); pg.click('.dialogo button[type=submit]')
    checa(pg.is_visible('.dialogo [data-erro]') and 'kg' in pg.inner_text('.dialogo [data-erro]'), 'ração: bloqueia quantidade zero')
    pg.fill('.dialogo [name=data]', '2030-01-01'); pg.fill('.dialogo [name=kg]', '42.5'); pg.click('.dialogo button[type=submit]')
    checa('futuro' in pg.inner_text('.dialogo [data-erro]'), 'ração: bloqueia data no futuro')
    pg.fill('.dialogo [name=data]', '2026-10-11'); pg.click('.dialogo button[type=submit]')
    pg.wait_for_timeout(800)
    checa(('racao_consumo', 'r1', {'data': '2026-10-11', 'quantidade_kg': 42.5}) in patches, 'ração: grava data e 42,5 kg')

    pg.click('.seg button[data-aba=registros]')
    pg.click('[data-edit="biometrias:b1"]'); pg.wait_for_selector('.dialogo form')
    pg.fill('.dialogo [name=qtd]', '2.5'); pg.click('.dialogo button[type=submit]')
    checa('inteiro' in pg.inner_text('.dialogo [data-erro]'), 'biometria: bloqueia quantidade não inteira')
    pg.fill('.dialogo [name=qtd]', '40'); pg.fill('.dialogo [name=peso]', '12'); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(800)
    checa(('biometrias', 'b1', {'data': '2026-10-05', 'quantidade_amostrada': 40, 'peso_amostra_kg': 12}) in patches, 'biometria: grava 40 peixes / 12 kg')

    pg.click('.seg button[data-aba=registros]')
    pg.click('[data-edit="mortalidade:m1"]'); pg.wait_for_selector('.dialogo form')
    checa(pg.input_value('.dialogo [name=causa]') == 'Temperatura', 'mortalidade: abre com a causa atual')
    pg.fill('.dialogo [name=data]', '2026-08-01'); pg.click('.dialogo button[type=submit]')
    checa('antes da entrada' in pg.inner_text('.dialogo [data-erro]'), 'mortalidade: bloqueia data antes da entrada do lote')
    pg.fill('.dialogo [name=data]', '2026-10-07'); pg.fill('.dialogo [name=qtd]', '5'); pg.select_option('.dialogo [name=causa]', '')
    pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(800)
    checa(('mortalidade', 'm1', {'data': '2026-10-07', 'quantidade': 5, 'causa': None}) in patches, 'mortalidade: grava 5 peixes, sem causa')

    n = len(patches)
    pg.click('.seg button[data-aba=registros]'); pg.click('[data-edit="racao_consumo:r1"]'); pg.wait_for_selector('.dialogo form')
    pg.click('.dialogo [data-cancelar]'); pg.wait_for_timeout(400)
    checa(len(patches) == n and not pg.is_visible('.dialogo'), 'cancelar não grava nada')

    # 2) Estoque: editar compra
    pg.goto(BASE + '#/estoque'); pg.wait_for_selector('[data-edit="c1"]', timeout=15000)
    pg.click('[data-edit="c1"]'); pg.wait_for_selector('.dialogo form')
    pg.fill('.dialogo [name=sacos]', '30'); pg.fill('.dialogo [name=custo]', ''); pg.fill('.dialogo [name=forn]', '  Agro Y ')
    pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(800)
    checa(('racao_estoque', 'c1', {'data_compra': '2026-10-01', 'quantidade_kg': 750, 'custo_total': None, 'fornecedor': 'Agro Y'}) in patches, 'compra: 30 sacos de 25 kg gravam 750 kg, sem valor, fornecedor sem espaços')

    # 3) Tanque: editar lote e reabrir encerrado
    pg.goto(BASE + f'#/tanque/{T}'); abrir_dobra(pg, f'details[data-lote="{L1}"]'); pg.wait_for_selector(f'[data-editar-lote="{L1}"]', timeout=15000)
    pg.screenshot(path='tanque.png', full_page=True)
    checa(pg.locator(f'[data-reabrir="{L2}"]').count() == 1 and pg.locator(f'[data-reabrir="{L1}"]').count() == 0, 'Reabrir aparece só no lote encerrado')
    pg.click(f'[data-editar-lote="{L1}"]'); pg.wait_for_selector('.dialogo form')
    pg.fill('.dialogo [name=especie]', 'Tambacu'); pg.fill('.dialogo [name=qtd]', '1200'); pg.fill('.dialogo [name=pm]', '0,05'); pg.select_option('.dialogo [name=un]', 'kg')
    pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(800)
    checa(('lotes', L1, {'tipo': 'engorda', 'especie': 'Tambacu', 'data_entrada': '2026-09-01', 'quantidade_inicial': 1200, 'peso_inicial_kg': 60}) in patches, 'lote: grava espécie, quantidade e peso (1.200 × 0,05 kg = 60 kg)')
    abrir_dobra(pg, f'details[data-lote="{L2}"]'); pg.wait_for_selector(f'[data-reabrir="{L2}"]')
    pg.click(f'[data-reabrir="{L2}"]'); pg.wait_for_selector('.dialogo [data-ok]')
    checa('já tem um lote ativo' in pg.inner_text('.dialogo'), 'reabrir: avisa que já há lote ativo')
    pg.click('.dialogo [data-ok]'); pg.wait_for_timeout(800)
    checa(('lotes', L2, {'ativo': True}) in patches, 'reabrir: grava ativo = true')

    # 4) Equipe: só o convite por link (o "vincular pelo e-mail" saiu em 11/11/2026)
    pg.goto(BASE + '#/equipe'); pg.wait_for_timeout(1500)
    t = pg.inner_text('#view')
    checa(pg.locator('#f-novo').count() == 0 and 'Vincular pelo e-mail' not in t, 'equipe: sem o antigo "vincular pelo e-mail"')
    pg.screenshot(path=sys.argv[1] if len(sys.argv) > 1 else 'equipe.png')
    b.close()

checa(not erros_js, 'nenhum erro de JavaScript na página' + ('' if not erros_js else ': ' + ' | '.join(erros_js[:3])))
checa(not externos, 'nenhuma requisição para fora do teste' + ('' if not externos else ': ' + externos[0]))
print('RESULTADO:', 'TUDO OK' if ok else 'COM FALHAS')

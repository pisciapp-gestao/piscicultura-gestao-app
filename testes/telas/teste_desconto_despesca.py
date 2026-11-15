# Despesca com DESCONTO em % (sugestão do cliente piloto, 15/11/2026): o dono digita o bruto e o % (ex.: 2)
# e o app preenche o peso líquido; a receita sai sobre o líquido. Supabase SIMULADO.
import os
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
import json, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
SB = 'https://ppvliseblxpsepmeknnl.supabase.co'
U = '11111111-1111-4111-8111-111111111111'; F = '22222222-2222-4222-8222-222222222222'; T = '33333333-3333-4333-8333-333333333333'
ok = True
def checa(c, m):
    global ok
    print(('OK   ' if c else 'FALHA ') + m); ok = ok and c

errs = []; posts = []
with sync_playwright() as pw:
    b = pw.chromium.launch(**LANCAR); ctx = b.new_context(reduced_motion='reduce', viewport={'width': 390, 'height': 1100}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    perfil = {'id': U, 'nome': 'Rai', 'papel': 'dono', 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'São carlos'}}
    def rota(route, req):
        u = req.url
        if not u.startswith(SB): return route.continue_()
        path = urlparse(u).path; obj = 'object' in (req.headers.get('accept') or '')
        j = lambda o, st=200: route.fulfill(status=st, content_type='application/json', body=json.dumps(o))
        tab = path.split('/')[-1]
        if req.method in ('POST', 'PATCH') and '/rpc/' not in path:
            corpo = json.loads(req.post_data or '[]'); corpo = corpo if isinstance(corpo, list) else [corpo]
            for c in corpo: posts.append((tab, c))
            return j(corpo, 201)
        if '/rpc/' in path:
            return j([{'saldo_kg': 5000, 'consumo_7d_kg': 70}] if tab == 'saldo_racao' else False if tab == 'eh_admin' else None if tab in ('plano_atual', 'meu_suporte') else [])
        if tab == 'usuarios': return j(perfil if obj else [perfil])
        if tab == 'tanques': return j([{'id': T, 'nome': 'Tanque 1 - Represa', 'area_ha': 15.9}])
        if tab == 'lotes': return j([{'id': 'l1', 'tanque_id': T, 'tipo': 'engorda', 'especie': 'Tambaqui', 'data_entrada': '2026-02-17', 'quantidade_inicial': 41979, 'peso_inicial_kg': 25187, 'ativo': True}])
        if tab == 'fazendas': return j({'kg_saco': 25} if obj else [{'kg_saco': 25}])
        if tab in ('despescas', 'despesca_vendas'): return j([])
        return j(None if obj else [])
    ctx.route('**/*', rota)
    s = {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 2592000, 'expires_at': int(time.time()) + 2592000, 'user': {'id': U, 'aud': 'authenticated'}}
    pg.add_init_script(f"localStorage.setItem('splash', new Date().toDateString()); if (!localStorage.getItem('sb-ppvliseblxpsepmeknnl-auth-token')) localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(s))});")

    pg.goto(BASE + f'#/lancar?tipo=despesca&tanque={T}'); pg.wait_for_selector('#desp-desc', timeout=20000); pg.wait_for_timeout(800)
    pg.fill('#desp-qtd', '4134'); pg.fill('#desp-desc', '2'); pg.fill('#desp-bruto', '12568'); pg.wait_for_timeout(200)
    checa(pg.input_value('#desp-liquido') == '12316,6', f'12.568 kg − 2% = 12.316,6 kg de líquido ({pg.input_value("#desp-liquido")!r})')
    pg.fill('#desp-preco', '1100'); pg.wait_for_timeout(200)
    calc = pg.inner_text('#desp-calc').replace(' ', ' ')
    checa('R$ 135.482,60' in calc and 'líquido' in calc, f'receita sobre o líquido: 12.316,6 × R$ 11 = R$ 135.482,60 ({calc.splitlines()[-1]!r})')
    pg.fill('#desp-desc', '3'); pg.wait_for_timeout(200)
    checa(pg.input_value('#desp-liquido') == '12191', f'mudar o % recalcula: 12.568 − 3% = 12.191 ({pg.input_value("#desp-liquido")!r})')
    pg.fill('#desp-liquido', '12300'); pg.wait_for_timeout(200)
    checa(pg.input_value('#desp-desc') == '', 'líquido digitado à mão: o % sai (vale o que foi digitado)')
    pg.fill('#desp-desc', '80'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(800)
    checa('desconto' in pg.inner_text('#erro').lower() and not posts, 'desconto de 80% é barrado')
    pg.fill('#desp-desc', '2'); pg.wait_for_timeout(200); pg.click('#f button[type=submit]'); pg.wait_for_timeout(1500)
    for _ in range(3):
        if not pg.locator('.dialogo [data-ok]').count(): break
        pg.click('.dialogo [data-ok]'); pg.wait_for_timeout(800)
    d = [c for t_, c in posts if t_ == 'despescas']
    checa(len(d) == 1 and float(d[0]['peso_liquido_kg']) == 12316.6 and float(d[0]['peso_bruto_kg']) == 12568, f'grava bruto 12568 e líquido 12316,6 ({[(c.get("peso_bruto_kg"), c.get("peso_liquido_kg")) for c in d]})')
    checa(pg.evaluate("localStorage.getItem('despesca_desconto')") == '2', 'o 2% fica guardado para a próxima despesca')
    pg.goto(BASE + '#/'); pg.wait_for_timeout(800); pg.goto(BASE + f'#/lancar?tipo=despesca&tanque={T}'); pg.reload(); pg.wait_for_selector('#desp-desc', timeout=20000); pg.wait_for_timeout(600)
    checa(pg.input_value('#desp-desc') == '2', 'próxima despesca já vem com 2%')
    pg.screenshot(path='desconto_despesca.png')
    b.close()

checa(not errs, 'nenhum erro de JavaScript' + ('' if not errs else ': ' + ' | '.join(errs[:3])))
print('RESULTADO:', 'TUDO OK' if ok else 'COM FALHAS')

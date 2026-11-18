# Conversão alimentar (sql/41), com o Supabase SIMULADO:
# o dono informa a conversão da fazenda em Fazenda › Ajustes; a previsão "Faltam X sacos até vender" da tela do tanque
# e do relatório do lote passa a usar peixes vivos × peso que falta × conversão. O gerente informa a do tanque.
# O funcionário vê a previsão, mas não altera nada.
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
U = '11111111-1111-4111-8111-111111111111'; F = '22222222-2222-4222-8222-222222222222'
T = '33333333-3333-4333-8333-333333333333'; L = '44444444-4444-4444-8444-444444444444'
ok = True
def checa(c, m):
    global ok
    print(('OK   ' if c else 'FALHA ') + m); ok = ok and c

def sacos(kg): return f'{round(kg / 25):,}'.replace(',', '.')

def rodar(pw, papel):
    erros = []
    st = {'ca_faz': None, 'ca_tq': None, 'patches': []}
    perfil = {'id': U, 'nome': 'Zé', 'papel': papel, 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'Fazenda Sol'}}
    b = pw.chromium.launch(**LANCAR); ctx = b.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce'); pg = ctx.new_page()
    pg.on('pageerror', lambda e: erros.append(str(e)))
    def rota(route, req):
        u = req.url
        if not u.startswith(SB): return route.continue_()
        path = urlparse(u).path; obj = 'object' in (req.headers.get('accept') or ''); tab = path.split('/')[-1]
        j = lambda o, s=200: route.fulfill(status=s, content_type='application/json', body=json.dumps(o))
        if req.method == 'PATCH':
            corpo = json.loads(req.post_data or '{}'); st['patches'].append((tab, corpo))
            if tab == 'fazendas' and 'conversao_alimentar' in corpo: st['ca_faz'] = corpo['conversao_alimentar']
            if tab == 'tanques' and 'conversao_alimentar' in corpo: st['ca_tq'] = corpo['conversao_alimentar']
            return j([], 200)
        if '/rpc/' in path:
            if tab == 'resumo_lotes': return j([{'lote_id': L, 'racao_kg': 9000, 'mortos': 500, 'despescados': 0, 'transferidos': 0, 'ultimo_peso_medio_kg': 0.8, 'ultima_biometria': '2026-11-10'}])
            return j([{'saldo_kg': 5000, 'consumo_7d_kg': 70}] if tab == 'saldo_racao' else False if tab == 'eh_admin' else None if tab in ('plano_atual', 'meu_suporte') else [])
        if tab == 'usuarios': return j(perfil if obj else [perfil])
        if tab == 'tanques': return j([{'id': T, 'nome': 'Tanque 3', 'area_ha': 1, 'peso_venda_kg': None, 'conversao_alimentar': st['ca_tq']}])
        if tab == 'lotes': return j([{'id': L, 'tanque_id': T, 'tipo': 'engorda', 'especie': 'Tambaqui', 'data_entrada': '2026-07-01', 'quantidade_inicial': 10000, 'peso_inicial_kg': 1000, 'ativo': True, 'tanques': {'nome': 'Tanque 3'}}])
        if tab == 'resumo_lotes': return j([{'lote_id': L, 'racao_kg': 9000, 'mortos': 500, 'despescados': 0, 'transferidos': 0, 'ultimo_peso_medio_kg': 0.8, 'ultima_biometria': '2026-11-10'}])
        if tab == 'biometrias' and req.method == 'GET': return j([{'id': 'b1', 'lote_id': L, 'data': '2026-11-10', 'peso_amostra_kg': 40, 'quantidade_amostrada': 50, 'registrado_por': U, 'criado_em': '2026-11-10T10:00:00Z'}])
        if tab == 'mortalidade' and req.method == 'GET': return j([{'id': 'm1', 'lote_id': L, 'data': '2026-10-01', 'quantidade': 500, 'registrado_por': U, 'criado_em': '2026-10-01T10:00:00Z'}])
        if tab == 'usuario_tanques': return j([{'usuario_id': U, 'tanque_id': T}])
        if tab == 'fazendas':
            linha = {'kg_saco': 25, 'peso_venda_kg': 2.5, 'conversao_alimentar': st['ca_faz']}
            return j(linha if obj else [linha])
        return j(None if obj else [])
    ctx.route('**/*', rota)
    s = {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 2592000, 'expires_at': int(time.time()) + 2592000, 'user': {'id': U, 'aud': 'authenticated'}}
    pg.add_init_script(f"if (!localStorage.getItem('sb-ppvliseblxpsepmeknnl-auth-token')) localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(s))});")
    falta = lambda: pg.locator('.ra-falta').first.inner_text() if pg.locator('.ra-falta').count() else ''
    def tanque():
        pg.goto(BASE + '#/mais'); pg.wait_for_timeout(200); pg.goto(BASE + f'#/t/{T}'); pg.wait_for_selector('.td-prev', timeout=15000); pg.wait_for_timeout(500)

    pg.goto(BASE + '#/'); pg.wait_for_selector('nav.abas', timeout=20000); pg.wait_for_timeout(1500)
    tanque()
    checa(('Pela tabela' in falta() or 'Tabela:' in falta()) and 'Conversão' not in falta(), f'{papel}: sem conversão informada, a previsão vai pela tabela ({falta()!r})')
    if papel == 'dono':
        pg.goto(BASE + '#/mais'); pg.wait_for_selector('#f-conv', state='attached', timeout=10000)
        checa('não informada' in pg.inner_text('#view'), 'Fazenda › Conversão alimentar: "não informada"')
        pg.click('details:has(#f-conv) summary'); pg.fill('#conv', '9'); pg.click('#f-conv button[type=submit]'); pg.wait_for_timeout(300)
        checa(st['ca_faz'] is None and 'entre 0,5 e 5' in pg.inner_text('#toast'), 'conversão 9 é recusada na tela')
        pg.fill('#conv', '1,9'); pg.click('#f-conv button[type=submit]'); pg.wait_for_timeout(1200)
        checa(st['ca_faz'] == 1.9, f'dono salva a conversão da fazenda: 1,9 ({st["ca_faz"]})')
        checa('1,9 kg de ração por kg de peixe' in pg.inner_text('#view'), 'Fazenda mostra "1,9 kg de ração por kg de peixe"')
        tanque()
        esperado = sacos(9500 * (2.5 - 0.8) * 1.9)
        checa(esperado in falta() and 'Conversão 1,9 da fazenda' in falta(), f'tanque: faltam {esperado} sacos = 9.500 vivos × 1,7 kg × 1,9 ÷ 25 ({falta()!r})')
        pg.goto(BASE + f'#/relatorio/{L}'); pg.wait_for_timeout(2500)
        checa(esperado in pg.inner_text('#view') and 'Conversão 1,9 da fazenda' in pg.inner_text('#view'), 'relatório do lote mostra a mesma previsão')
    else:
        st['ca_faz'] = 1.9
        pg.goto(BASE + '#/mais'); pg.wait_for_timeout(600)
        pg.click('#b-atualizar'); pg.wait_for_timeout(1200)
        checa(pg.locator('#f-conv').count() == 0, f'{papel}: não altera a conversão da fazenda')
        tanque()
        checa('Conversão 1,9 da fazenda' in falta(), f'{papel}: vê a previsão com a conversão da fazenda')
    if papel in ('dono', 'gerente'):
        tanque(); pg.click('[data-conv]'); pg.wait_for_selector('.dialogo input', timeout=5000)
        pg.fill('.dialogo input', '2,2'); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(1800)
        checa(st['ca_tq'] == 2.2, f'{papel}: salva a conversão do tanque: 2,2 ({st["ca_tq"]})')
        esperado = sacos(9500 * 1.7 * 2.2)
        checa(esperado in falta() and 'Conversão 2,2 deste tanque' in falta(), f'{papel}: tanque usa a própria conversão: {esperado} sacos ({falta()!r})')
        pg.click('[data-conv]'); pg.wait_for_selector('.dialogo input', timeout=5000)
        pg.fill('.dialogo input', ''); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(1800)
        checa(st['ca_tq'] is None and 'Conversão 1,9 da fazenda' in falta(), f'{papel}: apagar a do tanque volta para a da fazenda')
    else:
        checa(pg.locator('[data-conv]').count() == 0, f'{papel}: sem botão "Conversão" no tanque')
    checa(not pg.evaluate('document.documentElement.scrollWidth > innerWidth'), f'{papel}: tela do tanque sem rolar para o lado')
    checa(not erros, f'{papel}: nenhum erro de JavaScript' + ('' if not erros else ': ' + ' | '.join(erros[:2])))
    b.close()

with sync_playwright() as pw:
    for p in ('dono', 'gerente', 'funcionario'): rodar(pw, p)
print('RESULTADO:', 'TUDO OK' if ok else 'COM FALHAS')

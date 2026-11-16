# Manejo (aplicação de probiótico) na tela, com o Supabase SIMULADO: lançar, validar, funcionário, Registros, corrigir, CSV, abas roláveis no celular.
import os
_ARQ = os.path.abspath(__file__)
_PRE = open(os.path.join(os.path.dirname(_ARQ), 'teste_despesca.py'), encoding='utf-8').read().split('with sync_playwright() as pw:')[0]
exec(_PRE)   # mesma simulação do banco do teste de despesca

SEM_TABELA = {'sim': False}
LINHA = {'id': 'm9', 'data': '2026-10-05', 'tipo': 'probiotico', 'produto': 'Bac Antigo', 'dose': 150, 'unidade': 'g', 'via': 'agua', 'obs': 'manhã', 'registrado_por': U}
_rota = rota
def rota(route, req):
    if '/rest/v1/manejos' in req.url and req.method == 'GET' and SEM_TABELA['sim']:
        return route.fulfill(status=404, content_type='application/json', body=json.dumps({'code': '42P01', 'message': 'relation "manejos" does not exist'}))
    return _rota(route, req)
def preparar(papel, com_linha=False):
    est.update(novo_estado(papel)); est['manejos'] = [dict(LINHA)] if com_linha else []
def abrir_em(b, largura):
    pg = b.new_page(reduced_motion='reduce', viewport={'width': largura, 'height': 844}, accept_downloads=True, locale='pt-BR')
    pg.on('pageerror', lambda e: erros_js.append(str(e)))
    pg.route('**/*', rota)
    pg.add_init_script(f"localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(sessao))});")
    pg.goto(BASE + '#/'); pg.wait_for_selector('#view', timeout=20000); pg.wait_for_timeout(800)
    return pg
def form(pg):
    pg.goto(BASE + '#/mais'); pg.wait_for_timeout(300)
    pg.goto(BASE + f'#/lancar?tipo=manejo&tanque={T}'); pg.wait_for_selector('#man-dose', timeout=15000); pg.wait_for_timeout(400)
posts_m = lambda: [x for t, x in est['posts'] if t == 'manejos']

with sync_playwright() as pw:
    b = pw.chromium.launch(**LANCAR)

    # funcionário lança; dono com 6 abas no celular estreito
    preparar('funcionario'); pg = abrir_em(b, 390); form(pg)
    checa(pg.locator('.seg button').count() == 5 and pg.locator('.seg button[data-tipo=manejo]').count() == 1, 'funcionário: 5 abas, com Manejo')
    pg.fill('#man-produto', 'Bac Forte'); pg.fill('#man-dose', '200'); pg.click('#man-via [data-via=agua]'); pg.fill('#man-obs', 'após a ração')
    pg.click('#f button[type=submit]'); pg.wait_for_selector('.dialogo-resumo', timeout=10000)
    cf = pg.inner_text('.dialogo-resumo'); checa('Probiótico' in cf and 'Bac Forte' in cf, f'funcionário confere antes de salvar: {cf!r}'); pg.click('.dialogo [data-ok]')
    pg.wait_for_selector('.sucesso', timeout=10000); pg.wait_for_timeout(1200)
    m = posts_m()
    checa(len(m) == 1 and m[0]['produto'] == 'Bac Forte' and m[0]['dose'] == 200 and m[0]['unidade'] == 'g' and m[0]['via'] == 'agua' and m[0]['obs'] == 'após a ração' and m[0]['tipo'] == 'probiotico', f'funcionário: lançamento enviado {m}')
    t = pg.inner_text('.sucesso')
    checa('Probiótico salvo' in t and 'Bac Forte: 200 g na água' in t, f'tela de sucesso: {t[:80]!r}')
    form(pg)
    checa(pg.input_value('#man-produto') == 'Bac Forte', 'o último produto já vem preenchido')
    pg.close()

    preparar('dono'); pg = abrir_em(b, 320); form(pg)
    n = pg.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
    checa(not n and pg.locator('.seg button').count() == 7, '320 px: 7 abas (com Transferência) sem transbordar a página')
    corta = pg.evaluate("[...document.querySelectorAll('.seg button')].some(b => b.scrollWidth > b.clientWidth + 1)")
    checa(not corta, '320 px: nenhum nome de aba cortado')
    r = pg.evaluate("(() => { const b = document.querySelector('.seg button.on').getBoundingClientRect(); return [b.left, b.right, innerWidth]; })()")
    checa(r[0] >= 0 and r[1] <= r[2], f'320 px: a aba Manejo escolhida fica à vista {r}')
    pg.screenshot(path='manejo_320.png', full_page=True)

    # validações
    pg.fill('#man-produto', ''); pg.fill('#man-dose', '200'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(250)
    checa('nome do produto' in pg.inner_text('#erro'), 'exige o produto')
    pg.fill('#man-produto', 'Bac'); pg.fill('#man-dose', '0'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(250)
    checa('dose' in pg.inner_text('#erro'), 'exige a dose')
    pg.fill('#man-dose', '1.250,5'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(250)
    checa('ponto de milhar' in pg.inner_text('#erro'), 'recusa 1.250,5')
    SEM_TABELA['sim'] = True; pg.fill('#man-dose', '250,5'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(700)
    checa('sql/21' in pg.inner_text('#erro'), 'sem o sql/21: avisa e não salva'); SEM_TABELA['sim'] = False
    checa(not posts_m(), 'nada enviado nas validações')
    pg.select_option('#man-unidade', 'mL'); pg.click('#f button[type=submit]'); pg.wait_for_selector('.sucesso', timeout=10000); pg.wait_for_timeout(1000)
    m = posts_m(); checa(len(m) == 1 and m[0]['dose'] == 250.5 and m[0]['unidade'] == 'mL' and m[0]['via'] == 'racao' and m[0]['obs'] is None, f'vírgula e unidade: {m}')
    pg.close()

    # Registros, corrigir, CSV
    preparar('dono', True); pg = abrir_em(b, 390)
    pg.goto(BASE + f'#/relatorio/{L1}'); pg.wait_for_selector('.seg button[data-aba=registros]', timeout=15000)
    pg.click('.seg button[data-aba=registros]'); pg.wait_for_timeout(300)
    t = pg.inner_text('#painel'); checa('Probiótico' in t and 'Bac Antigo' in t and 'na água' in t and 'manhã' in t, 'Registros mostra a aplicação')
    pg.click('[data-edit="manejos:m9"]'); pg.wait_for_selector('.dialogo form')
    pg.fill('.dialogo [name=produto]', ''); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(200)
    checa('nome do produto' in pg.inner_text('.dialogo [data-erro]'), 'corrigir: exige o produto')
    pg.fill('.dialogo [name=produto]', 'Bac Novo'); pg.fill('.dialogo [name=dose]', '175,5'); pg.select_option('.dialogo [name=via]', 'racao'); pg.fill('.dialogo [name=obs]', '')
    pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(800)
    p = [x for tb, i, x in est['patches'] if tb == 'manejos']
    checa(p and p[0]['produto'] == 'Bac Novo' and p[0]['dose'] == 175.5 and p[0]['via'] == 'racao' and p[0]['obs'] is None, f'corrigir grava: {p}')
    with pg.expect_download() as dl: pg.click('#b-csv')
    dl.value.save_as('manejo.csv'); c = open('manejo.csv', encoding='utf-8-sig').read()
    checa('PROBIÓTICO' in c and 'Bac Novo' in c and '175,5' in c, 'planilha CSV traz a aplicação')
    pg.close()
    # ----- erros que alguém pode cometer nesta tela -----
    def tenta(pg, dose='200', produto='Bac'):
        pg.fill('#man-produto', produto); pg.fill('#man-dose', dose); pg.click('#f button[type=submit]'); pg.wait_for_timeout(350)
        return pg.inner_text('#erro') if pg.locator('#erro:not([hidden])').count() else ''
    preparar('dono'); pg = abrir_em(b, 390); form(pg)
    for d, m in [('abc', 'letras'), ('-5', 'negativa'), ('0,000', 'zero com casas'), ('', 'vazia'), ('1.000.000', 'dois pontos'), ('99999999999', 'absurda')]:
        checa('dose' in tenta(pg, d).lower(), f'dose {m} ({d!r}): recusa')
    checa('produto' in tenta(pg, '10', '    ').lower(), 'produto só com espaços: recusa')
    pg.fill('#man-produto', 'x' * 120); checa(len(pg.input_value('#man-produto')) <= 80 or pg.get_attribute('#man-produto', 'maxlength') == '80', 'produto: limite de 80 letras')
    pg.click('#b-data'); pg.fill('#data', '2030-01-01'); checa('futuro' in tenta(pg, '10'), 'data no futuro: recusa')
    pg.fill('#data', '2020-01-01'); checa('entrada do lote' in tenta(pg, '10'), 'data antes da entrada do lote: recusa')
    checa(not posts_m(), 'nada enviado com dados errados')
    # toque duplo não grava duas vezes
    pg.close(); preparar('dono'); pg = abrir_em(b, 390); form(pg)
    pg.fill('#man-produto', 'Bac Duplo'); pg.fill('#man-dose', '10')
    pg.evaluate("const b = document.querySelector('#f button[type=submit]'); b.click(); b.click();"); pg.wait_for_selector('.sucesso', timeout=10000); pg.wait_for_timeout(1200)
    checa(len(posts_m()) == 1, f'toque duplo: grava uma vez só ({len(posts_m())})')
    pg.close()
    # mesmo produto no mesmo dia pergunta antes
    preparar('dono', True); pg = abrir_em(b, 390); form(pg)
    pg.fill('#man-produto', 'Bac Antigo'); pg.fill('#man-dose', '10'); pg.click('#f button[type=submit]'); pg.wait_for_selector('.dialogo', timeout=5000)
    checa('já foi lançado' in pg.inner_text('.dialogo'), 'mesmo produto na mesma data: pergunta antes')
    pg.locator('.dialogo button', has_text='Não lançar').click(); pg.wait_for_timeout(400); checa(not posts_m(), '"Não lançar" não grava')
    pg.close()
    # texto malicioso não roda em nenhuma tela
    X = '<img src=x onerror="window.__xss=1">'
    preparar('dono'); est['manejos'] = [{**LINHA, 'produto': X, 'obs': X}]; pg = abrir_em(b, 390)
    pg.goto(BASE + f'#/relatorio/{L1}'); pg.wait_for_selector('.seg button[data-aba=registros]', timeout=15000); pg.click('.seg button[data-aba=registros]'); pg.wait_for_timeout(500)
    checa(X in pg.inner_text('#painel') and pg.evaluate('!window.__xss') and pg.locator('#painel img[src=x]').count() == 0, 'Registros: texto malicioso aparece como texto')
    form(pg); pg.context.set_offline(True); pg.wait_for_timeout(200)
    pg.fill('#man-produto', X); pg.fill('#man-dose', '10'); pg.fill('#man-obs', X); pg.click('#f button[type=submit]'); pg.wait_for_selector('.sucesso', timeout=10000); pg.wait_for_timeout(300)
    checa(X in pg.inner_text('.sucesso') and pg.evaluate('!window.__xss'), 'sucesso: texto malicioso aparece como texto')
    pg.goto(BASE + '#/pendencias'); pg.wait_for_timeout(600)
    t = pg.inner_text('#view'); checa('Probiótico' in t and X in t and pg.evaluate('!window.__xss'), 'Pendentes: mostra o probiótico, sem rodar o texto')
    pg.goto(BASE + f'#/lancar?tipo=manejo&tanque={T}'); pg.wait_for_selector('#man-dose', timeout=8000); pg.wait_for_timeout(300)
    checa(pg.evaluate('!window.__xss') and pg.locator('#man-produtos img').count() == 0, 'lista de produtos: sem rodar o texto')
    pg.context.set_offline(False); pg.close()
    # tanque com dois lotes: grava no lote escolhido; tanque sem lote: recusa
    preparar('dono'); L9 = '99999999-9999-4999-8999-999999999999'
    est['lotes'].append({**est['lotes'][0], 'id': L9, 'tipo': 'recria', 'especie': 'Pirarucu'}); pg = abrir_em(b, 390); form(pg)
    pg.select_option('#lote', L9); pg.fill('#man-produto', 'Bac'); pg.fill('#man-dose', '10'); pg.click('#f button[type=submit]'); pg.wait_for_selector('.sucesso', timeout=10000); pg.wait_for_timeout(1000)
    checa(posts_m() and posts_m()[0]['lote_id'] == L9, 'dois lotes: grava no lote escolhido'); pg.close()
    preparar('dono'); est['lotes'][0]['ativo'] = False; pg = abrir_em(b, 390); form(pg)
    pg.fill('#man-produto', 'Bac'); pg.fill('#man-dose', '10'); pg.click('#f button[type=submit]'); pg.wait_for_timeout(400)
    checa(not posts_m() and 'lote ativo' in pg.inner_text('#erro'), 'tanque sem lote ativo: recusa'); pg.close()

    # atalho na tela do tanque, para qualquer papel
    preparar('funcionario'); pg = abrir_em(b, 390); pg.goto(BASE + f'#/t/{T}'); pg.wait_for_selector('a[href*="tipo=biometria"]', timeout=15000)
    checa(pg.locator('a[href*="tipo=manejo"]').count() == 1, 'tela do tanque: atalho Manejo')
    pg.close(); b.close()

checa(not erros_js, f'sem erro de JavaScript: {erros_js[:3]}')
print('RESULTADO: TUDO OK' if ok else 'RESULTADO: FALHOU')
sys.exit(0 if ok else 1)

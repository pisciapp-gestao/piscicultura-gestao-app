# Qualidade da água na tela, com o Supabase SIMULADO: lançar, validar, faixa do tambaqui, relatório, corrigir, erros comuns.
import os
_ARQ = os.path.abspath(__file__)
_PRE = open(os.path.join(os.path.dirname(_ARQ), 'teste_despesca.py'), encoding='utf-8').read().split('with sync_playwright() as pw:')[0]
exec(_PRE)

SEM = {'sim': False}
_rota = rota
def rota(route, req):
    if '/rest/v1/qualidade_agua' in req.url and req.method == 'GET' and SEM['sim']:
        return route.fulfill(status=404, content_type='application/json', body=json.dumps({'code': '42P01', 'message': 'relation "qualidade_agua" does not exist'}))
    return _rota(route, req)
def preparar(papel, leituras=()):
    est.update(novo_estado(papel)); est['manejos'] = []; est['qualidade_agua'] = list(leituras)
def abrir_em(b, w):
    pg = b.new_page(reduced_motion='reduce', viewport={'width': w, 'height': 844}, accept_downloads=True, locale='pt-BR')
    pg.on('pageerror', lambda e: erros_js.append(str(e))); pg.route('**/*', rota)
    pg.add_init_script(f"localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(sessao))});")
    pg.goto(BASE + '#/'); pg.wait_for_selector('#view', timeout=20000); pg.wait_for_timeout(800); return pg
def form(pg):
    pg.goto(BASE + '#/mais'); pg.wait_for_timeout(300); pg.goto(BASE + f'#/lancar?tipo=agua&tanque={T}'); pg.wait_for_selector('#ag-od', timeout=15000); pg.wait_for_timeout(400)
env = lambda: [x for t, x in est['posts'] if t == 'qualidade_agua']
HOJE = time.strftime('%Y-%m-%d')
A1 = {'id': 'a1', 'data': HOJE, 'hora': '07:10', 'tanque_id': T, 'oxigenio_mgl': 3.2, 'temperatura_c': 29, 'ph': 6.5, 'amonia_mgl': 0.1, 'obs': 'nascer do sol', 'registrado_por': U}
A0 = {**A1, 'id': 'a0', 'data': '2026-10-20', 'hora': None, 'oxigenio_mgl': 5.5, 'obs': None}

with sync_playwright() as pw:
    b = pw.chromium.launch(**LANCAR)
    preparar('funcionario'); pg = abrir_em(b, 390); form(pg)
    checa(pg.locator('.seg button[data-tipo=agua]').count() == 1, 'funcionário tem a aba Água')
    pg.fill('#ag-od', '3,5'); pg.fill('#ag-temp', '29'); pg.wait_for_timeout(150)
    checa('Oxigênio baixo' in pg.inner_text('#ag-res'), f'mostra na hora: {pg.inner_text("#ag-res")!r}')
    pg.fill('#ag-od', '5,2'); pg.wait_for_timeout(150); checa('Dentro da faixa' in pg.inner_text('#ag-res'), 'dentro da faixa')
    pg.fill('#ag-od', '3,5'); pg.fill('#ag-obs', 'cedo'); pg.click('#f button[type=submit]'); pg.wait_for_selector('.dialogo-resumo', timeout=10000)
    cf = pg.inner_text('.dialogo-resumo'); checa('Água' in cf and 'O₂ 3,5' in cf, f'funcionário confere antes de salvar: {cf!r}'); pg.click('.dialogo [data-ok]')
    pg.wait_for_selector('.sucesso', timeout=10000); pg.wait_for_timeout(1200)
    x = env(); checa(len(x) == 1 and x[0]['oxigenio_mgl'] == 3.5 and x[0]['temperatura_c'] == 29 and x[0]['ph'] is None and x[0]['tanque_id'] == T and 'lote_id' not in x[0] and x[0]['hora'] and x[0]['obs'] == 'cedo', f'enviado: {x}')
    t = pg.inner_text('.sucesso'); checa('Medição salva' in t and 'Oxigênio baixo' in t, f'sucesso avisa: {t[:90]!r}'); pg.close()

    preparar('dono'); pg = abrir_em(b, 320); form(pg)
    r = pg.evaluate("(() => { const b = document.querySelector('.seg button.on').getBoundingClientRect(); return [b.left, b.right, innerWidth, document.documentElement.scrollWidth > innerWidth + 1, document.querySelectorAll('.seg button').length]; })()")
    checa(r[0] >= 0 and r[1] <= r[2] and not r[3] and r[4] == 7, f'320 px: 7 abas (com Transferência), aba Água à vista, sem transbordar {r}')
    pg.screenshot(path='agua_320.png', full_page=True)
    def tenta(campos):
        for s in ['#ag-od', '#ag-temp', '#ag-ph', '#ag-am']: pg.fill(s, campos.get(s, ''))
        pg.click('#f button[type=submit]'); pg.wait_for_timeout(300)
        return pg.inner_text('#erro') if pg.locator('#erro:not([hidden])').count() else ''
    checa('pelo menos uma' in tenta({}), 'tudo vazio: recusa')
    checa('Oxigênio' in tenta({'#ag-od': 'abc'}), 'letras: recusa')
    checa('Oxigênio' in tenta({'#ag-od': '30'}), 'oxigênio impossível: recusa')
    checa('pH' in tenta({'#ag-ph': '15'}), 'pH impossível: recusa')
    checa('Temperatura' in tenta({'#ag-temp': '-3'}), 'temperatura negativa: recusa')
    checa('Amônia' in tenta({'#ag-am': '1.000,5'}), 'ponto e vírgula juntos: recusa')
    pg.click('#b-data'); pg.fill('#data', '2030-01-01'); checa('futuro' in tenta({'#ag-od': '5'}), 'data futura: recusa')
    pg.fill('#data', HOJE)
    SEM['sim'] = True; checa('sql/27' in tenta({'#ag-od': '5'}), 'sem o sql/27: avisa e não salva'); SEM['sim'] = False
    checa(not env(), 'nada enviado com erro')
    pg.close()

    # zero é medição; duas medições no mesmo dia não perguntam; toque duplo grava uma
    preparar('dono', [A1]); pg = abrir_em(b, 390); form(pg)
    pg.fill('#ag-od', '0'); pg.evaluate("const b = document.querySelector('#f button[type=submit]'); b.click(); b.click();"); pg.wait_for_selector('.sucesso', timeout=10000); pg.wait_for_timeout(1000)
    checa(pg.locator('.dialogo').count() == 0 and len(env()) == 1 and env()[0]['oxigenio_mgl'] == 0, f'zero vale, sem pergunta e toque duplo grava um: {env()}'); pg.close()

    # Início, relatório e correção
    preparar('dono', [A0, A1]); pg = abrir_em(b, 390)
    pg.goto(BASE + '#/mais'); pg.wait_for_timeout(300); pg.goto(BASE + '#/'); pg.wait_for_selector('.h-alertas', timeout=15000); pg.wait_for_timeout(500)
    t = pg.inner_text('.h-alertas'); checa('Água fora da faixa' in t and 'oxigênio baixo' in t, f'Início alerta: {t[:120]!r}')
    pg.goto(BASE + f'#/relatorio/{L1}'); pg.wait_for_selector('.seg button[data-aba=agua]', timeout=15000); pg.click('.seg button[data-aba=agua]'); pg.wait_for_timeout(500)
    t = pg.inner_text('#painel'); checa('3,2' in t and 'Oxigênio baixo' in t and 'Embrapa' in t and 'Mortes' in t and pg.locator('#painel svg.grafico').count() == 1, 'aba Água: valores, aviso, fonte, mortes e gráfico')
    pg.screenshot(path='agua_relatorio.png', full_page=True)
    pg.click('.seg button[data-aba=registros]'); pg.wait_for_timeout(300); pg.click('[data-edit="qualidade_agua:a1"]'); pg.wait_for_selector('.dialogo form')
    for s in ['od', 'temp', 'ph', 'am']: pg.fill(f'.dialogo [name={s}]', '')
    pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(200); checa('pelo menos uma' in pg.inner_text('.dialogo [data-erro]'), 'corrigir: exige uma medição')
    pg.fill('.dialogo [name=od]', '99'); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(200); checa('Oxigênio' in pg.inner_text('.dialogo [data-erro]'), 'corrigir: barra valor impossível')
    pg.fill('.dialogo [name=od]', '4,5'); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(800)
    p = [x for tb, i, x in est['patches'] if tb == 'qualidade_agua']; checa(p and p[0]['oxigenio_mgl'] == 4.5 and p[0]['ph'] is None, f'corrigir grava: {p}')
    with pg.expect_download() as dl: pg.click('#b-csv')
    dl.value.save_as('agua.csv'); checa('QUALIDADE DA ÁGUA' in open('agua.csv', encoding='utf-8-sig').read(), 'CSV traz as medições'); pg.close()

    # outra espécie: mostra sem alerta; texto malicioso não roda; sem internet guarda
    X = '<img src=x onerror="window.__xss=1">'
    preparar('dono', [{**A1, 'obs': X}]); est['lotes'][0]['especie'] = 'Tilápia'; pg = abrir_em(b, 390)
    pg.goto(BASE + '#/mais'); pg.wait_for_timeout(300); pg.goto(BASE + '#/'); pg.wait_for_timeout(1200); checa(pg.locator('text=Água fora da faixa').count() == 0, 'tilápia: sem alerta')
    pg.goto(BASE + f'#/relatorio/{L1}'); pg.wait_for_selector('.seg button[data-aba=agua]', timeout=15000); pg.click('.seg button[data-aba=agua]'); pg.wait_for_timeout(400)
    t = pg.inner_text('#painel'); checa('Ainda não há faixa' in t and 'Oxigênio baixo' not in t, 'tilápia: mostra sem faixa')
    pg.click('.seg button[data-aba=registros]'); pg.wait_for_timeout(300); checa(X in pg.inner_text('#painel') and pg.evaluate('!window.__xss'), 'texto malicioso aparece como texto')
    form(pg); pg.context.set_offline(True); pg.wait_for_timeout(200); pg.fill('#ag-od', '5'); pg.click('#f button[type=submit]'); pg.wait_for_selector('.sucesso', timeout=10000); pg.wait_for_timeout(300)
    pg.goto(BASE + '#/pendencias'); pg.wait_for_timeout(600); checa('Água' in pg.inner_text('#view') and 'O₂ 5' in pg.inner_text('#view'), 'sem internet: guarda e aparece em Pendentes')
    pg.context.set_offline(False); pg.close(); b.close()

checa(not erros_js, f'sem erro de JavaScript: {erros_js[:3]}')
print('RESULTADO: TUDO OK' if ok else 'RESULTADO: FALHOU')
sys.exit(0 if ok else 1)

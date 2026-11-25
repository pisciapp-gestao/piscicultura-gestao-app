# Placas com QR code (sql/43), com o Supabase SIMULADO:
# 1) a página do visitante (placa.html) em cada situação: água boa, em atenção, medição antiga, tanque vazio,
#    placa desligada, código que não existe, sem internet; no celular (320 e 390 px) e no computador; sem transbordo.
# 2) o dono em Fazenda › Placas: liga, escolhe o que aparece, o QR lido pela câmera abre a página certa, PDF, trocar código.
#    Gerente e funcionário não veem a entrada.
# 3) SEM SINAL: o funcionário lança ração e água sem internet; a placa não mostra nada até chegar ao banco;
#    quando o sinal volta, aparece no app (Meus lançamentos: "Enviado") E na placa, com a hora do LANÇAMENTO.
import os
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
import json, time, re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
SB = 'https://ppvliseblxpsepmeknnl.supabase.co'
U = '11111111-1111-4111-8111-111111111111'; F = '22222222-2222-4222-8222-222222222222'
T = '33333333-3333-4333-8333-333333333333'; L = '44444444-4444-4444-8444-444444444444'; T2 = '55555555-5555-4555-8555-555555555555'
COD = 'k7x2m9pqrs'
BV = timezone(timedelta(hours=-4))  # Boa Vista
HOJE = datetime.now(BV).date().isoformat()
dia = lambda n: (datetime.now(BV).date() - timedelta(days=n)).isoformat()
ok = True
def checa(c, m):
    global ok
    print(('OK   ' if c else 'FALHA ') + m); ok = ok and c

try:
    import cv2, numpy as np
    def ler_qr(png):
        img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
        txt, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
        return txt
except Exception:
    ler_qr = None

def lote(**k):
    base = {'fase': 'engorda', 'especie': 'Tambaqui', 'data_entrada': dia(121), 'peso_inicial_g': 120,
            'pesagens': [{'data': dia(90), 'g': 290}, {'data': dia(60), 'g': 510}, {'data': dia(30), 'g': 800}, {'data': dia(4), 'g': 1180}], 'racao_hoje': True}
    base.update(k); return base
def placa(**k):
    base = {'disponivel': True, 'fazenda': 'Fazenda Sol', 'tanque': 'Tanque 3', 'hoje': HOJE, 'mostra': {'agua': True, 'crescimento': True, 'fases': True},
            'whatsapp': '95991442495', 'lotes': [lote()], 'agua': {'data': HOJE, 'hora': '06:10', 'oxigenio_mgl': 5.6, 'temperatura_c': 29.1, 'ph': 6.4, 'amonia_mgl': 0.12}}
    base.update(k); return base
CENARIOS = {
    'boa': placa(),
    'atencao': placa(agua={'data': HOJE, 'hora': '06:10', 'oxigenio_mgl': 3.4, 'temperatura_c': 29.1, 'ph': 6.4, 'amonia_mgl': 0.12}),
    'velha': placa(agua={'data': dia(5), 'hora': '06:10', 'oxigenio_mgl': 3.4, 'temperatura_c': 29.1}),
    'vazio': placa(lotes=[], agua=None),
    'tilapia': placa(lotes=[lote(especie='Tilápia', racao_hoje=False, pesagens=[])], whatsapp=None, mostra={'agua': True, 'crescimento': False, 'fases': False}),
    'desligada': {'disponivel': False, 'fazenda': 'Fazenda Sol'},
    'nao_existe': None,
    'xss': placa(fazenda='<img src=x onerror="window.__xss=1">Sol', tanque='<b id="xss">T</b>'),
}

with sync_playwright() as pw:
    b = pw.chromium.launch(**LANCAR)

    # ---------------- 1) página do visitante ----------------
    def visitante(cen, largura=390, falhar=False):
        erros, fora = [], []
        ctx = b.new_context(viewport={'width': largura, 'height': 844}, timezone_id='America/Boa_Vista', reduced_motion='reduce')
        pg = ctx.new_page(); pg.on('pageerror', lambda e: erros.append(str(e)))
        def rota(route, req):
            if not req.url.startswith(SB): return route.continue_()
            if not req.url.endswith('/rest/v1/rpc/placa_publica'): fora.append(req.url); return route.fulfill(status=404, body='{}')
            if falhar['on'] if isinstance(falhar, dict) else falhar: return route.abort()
            corpo = json.loads(req.post_data or '{}')
            d = CENARIOS[cen] if corpo.get('p_codigo') == COD else None
            route.fulfill(status=200, content_type='application/json', body=json.dumps(d))
        ctx.route('**/*', rota)
        return ctx, pg, erros, fora
    def abrir(cen, largura=390, codigo=COD, falhar=False):
        ctx, pg, erros, fora = visitante(cen, largura, falhar)
        pg.goto(BASE + f'placa.html?c={codigo}'); pg.wait_for_selector('.app.publico', timeout=15000); pg.wait_for_timeout(300)
        return ctx, pg, erros, fora

    ctx, pg, erros, fora = abrir('boa')
    txt = pg.inner_text('body')
    checa('Tanque 3' in txt and 'Fazenda Sol' in txt and 'Página pública do tanque' in txt, 'visitante: nome do tanque e da fazenda')
    checa('Água boa' in txt and 'medida hoje às 06:10' in txt, 'água boa: tag verde e "medida hoje às 06:10"')
    checa('1,18' in pg.inner_text('.td-hero') and '121' in pg.inner_text('.td-hero'), 'peso médio atual 1,18 kg e 121 dias de cultivo')
    checa('Dada ✓' in pg.inner_text('.td-stats') and 'Engorda' in pg.inner_text('.td-stats'), 'fase e "Ração de hoje: Dada ✓"')
    checa(pg.locator('svg.grafico circle').count() == 5, 'gráfico de crescimento com a entrada e as 4 pesagens')
    pg.click('details.form-dobra summary'); pg.wait_for_timeout(200)
    det = pg.inner_text('details.form-dobra')
    checa('Oxigênio dissolvido' in det and '5,6 mg/L' in det and 'Amônia tóxica' in det and 'Embrapa' in det, 'dados técnicos: medições com a faixa do tambaqui e a fonte')
    checa('g/dia' in det, 'dados técnicos: ganho de peso por dia')
    checa(pg.locator('.lista li', has_text='Engorda').locator('.tag.ok').count() == 1, 'fases do cultivo: "este tanque" na engorda')
    w = pg.locator('a.btn', has_text='Falar no WhatsApp').get_attribute('href') or ''
    checa(w.startswith('https://wa.me/5595991442495?text='), f'WhatsApp abre a conversa com a fazenda ({w[:40]})')
    for proibido in ['R$', 'peixes vivos', 'mortes', 'biomassa']: checa(proibido not in txt, f'a página não mostra "{proibido}"')
    checa(not fora, 'a página só chama placa_publica (nada mais do banco)' + ('' if not fora else ': ' + fora[0]))
    largo = pg.evaluate('document.documentElement.scrollWidth > innerWidth')
    checa(not largo and not erros, f'390 px: sem rolar para o lado e sem erro de JavaScript {erros[:1]}')
    checa(pg.title().startswith('Tanque 3'), f'título da aba com o nome do tanque ({pg.title()})')
    pg.screenshot(path='placa_visitante_390.png', full_page=True); ctx.close()

    for larg in (320, 1280):
        ctx, pg, erros, _ = abrir('boa', larg)
        checa(not pg.evaluate('document.documentElement.scrollWidth > innerWidth') and not erros and pg.locator('.lateral, nav.abas').count() == 0,
              f'{larg} px: cabe na tela, sem menu do app')
        if larg == 1280: pg.screenshot(path='placa_visitante_1280.png', full_page=True)
        ctx.close()

    ctx, pg, erros, _ = abrir('atencao'); txt = pg.inner_text('body')
    checa('Água em atenção' in txt and 'Oxigênio baixo' in txt and 'vê o mesmo aviso' in txt, 'água em atenção: oxigênio baixo explicado')
    pg.click('details.form-dobra summary'); pg.wait_for_timeout(150)
    checa(pg.locator('li.ind', has_text='Oxigênio').locator('.tag.erro').count() == 1, 'oxigênio marcado "fora da faixa"'); ctx.close()

    ctx, pg, erros, _ = abrir('velha'); txt = pg.inner_text('body')
    checa('Sem medição recente' in txt and 'mais de 2 dias' in txt and 'há 5 dias' in txt, 'medição de 5 dias atrás: não mostra a situação de hoje com dado antigo')
    pg.click('details.form-dobra summary'); pg.wait_for_timeout(150)
    checa(pg.locator('li.ind .tag.ok, li.ind .tag.erro').count() == 0, 'medição antiga: sem verde/vermelho'); ctx.close()

    ctx, pg, erros, _ = abrir('vazio'); txt = pg.inner_text('body')
    checa('Em preparo' in txt and 'Sem peixes no momento' in txt and pg.locator('.td-hero').count() == 0, 'tanque vazio: "em preparo", sem peso nem dias'); ctx.close()

    ctx, pg, erros, _ = abrir('tilapia'); txt = pg.inner_text('body')
    checa('sem verde ou vermelho' in txt and 'Ainda não lançada' in txt and 'Falar no WhatsApp' not in txt and 'As fases do cultivo' not in txt and pg.locator('svg.grafico').count() == 0,
          'tilápia (sem faixa no app): medições sem cor; blocos desligados pelo dono não aparecem')
    checa('peso médio na entrada' in pg.inner_text('.td-hero').lower(), 'sem pesagem: mostra o peso médio da entrada'); ctx.close()

    ctx, pg, erros, _ = abrir('desligada'); txt = pg.inner_text('body')
    checa('Informações indisponíveis' in txt and 'Tanque 3' not in txt, 'placa desligada: indisponível, sem dados'); ctx.close()
    ctx, pg, erros, _ = abrir('nao_existe'); checa('Placa não encontrada' in pg.inner_text('body'), 'código que não existe: "placa não encontrada"'); ctx.close()
    ctx, pg, erros, fora = abrir('boa', codigo='abc'); checa('Placa não encontrada' in pg.inner_text('body') and not fora, 'código fora do formato: nem consulta o banco'); ctx.close()

    ctx, pg, erros, _ = abrir('xss')
    checa(pg.evaluate('window.__xss') is None and pg.locator('#xss').count() == 0 and '<b id="xss">T</b>' in pg.inner_text('h1'), 'nome com HTML aparece como texto (sem injeção)'); ctx.close()

    estado = {'on': True}
    ctx, pg, erros, _ = abrir('boa', falhar=estado)
    checa('Sem conexão' in pg.inner_text('body'), 'sem internet: avisa e oferece tentar de novo')
    estado['on'] = False; pg.click('[data-recarregar]'); pg.wait_for_selector('.td-hero', timeout=10000)
    checa('Água boa' in pg.inner_text('body') and not erros, '"Tentar de novo" com internet abre a página'); ctx.close()

    # ---------------- 2) o dono em Fazenda › Placas ----------------
    def app(papel, banco=None, offline_inicio=False):
        erros, chamadas = [], []
        banco = banco if banco is not None else {}
        st = {'placas': {}, 'whats': None, 'falhar': False}
        perfil = {'id': U, 'nome': 'Zé', 'papel': papel, 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'Fazenda Sol'}}
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, timezone_id='America/Boa_Vista', reduced_motion='reduce', permissions=['clipboard-read', 'clipboard-write'])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: erros.append(str(e)))
        def rota(route, req):
            u = req.url
            if not u.startswith(SB): return route.continue_()
            path = urlparse(u).path; obj = 'object' in (req.headers.get('accept') or ''); tab = path.split('/')[-1]
            j = lambda o, s=200: route.fulfill(status=s, content_type='application/json', body=json.dumps(o))
            if '/rpc/' in path:
                corpo = json.loads(req.post_data or '{}'); chamadas.append((tab, corpo))
                if tab == 'placa_salvar':
                    p = st['placas'].get(corpo['p_tanque']) or {'tanque_id': corpo['p_tanque'], 'fazenda_id': F, 'codigo': COD, 'ligada': False, 'mostra_agua': True, 'mostra_crescimento': True, 'mostra_fases': True, 'mostra_whatsapp': False}
                    for k, c in [('p_ligada', 'ligada'), ('p_agua', 'mostra_agua'), ('p_crescimento', 'mostra_crescimento'), ('p_fases', 'mostra_fases'), ('p_whatsapp', 'mostra_whatsapp')]:
                        if corpo.get(k) is not None: p[c] = corpo[k]
                    st['placas'][corpo['p_tanque']] = p; return j(p)
                if tab == 'placa_trocar_codigo': st['placas'][corpo['p_tanque']]['codigo'] = 'novo2345ab'; return j('novo2345ab')
                if tab == 'placa_salvar_whatsapp': st['whats'] = re.sub(r'\D', '', corpo.get('p_numero') or '') or None; return j(st['whats'])
                return j([{'saldo_kg': 5000, 'consumo_7d_kg': 70}] if tab == 'saldo_racao' else False if tab == 'eh_admin' else None if tab in ('plano_atual', 'meu_suporte') else [])
            if req.method in ('POST', 'PATCH'):
                if st['falhar']: return j({'code': 'XX000', 'message': 'fora do ar'}, 500)
                corpo = json.loads(req.post_data or '[]'); corpo = corpo if isinstance(corpo, list) else [corpo]
                for c in corpo:
                    t = banco.setdefault(tab, {})
                    if c.get('uuid_local') in t: return j({'code': '23505', 'message': 'duplicate key'}, 409)
                    t[c.get('uuid_local')] = {**c, 'id': c.get('uuid_local'), 'criado_em': datetime.now(timezone.utc).isoformat()}
                return j(corpo, 201)
            if tab == 'usuarios': return j(perfil if obj else [perfil])
            if tab == 'tanques': return j([{'id': T, 'nome': 'Tanque 3', 'area_ha': 1, 'fazenda_id': F}, {'id': T2, 'nome': 'Tanque 7', 'area_ha': 1, 'fazenda_id': F}])
            if tab == 'lotes': return j([{'id': L, 'tanque_id': T, 'tipo': 'engorda', 'especie': 'Tambaqui', 'data_entrada': dia(121), 'quantidade_inicial': 1000, 'peso_inicial_kg': 120, 'ativo': True, 'tanques': {'nome': 'Tanque 3'}}])
            if tab == 'resumo_lotes': return j([{'lote_id': L, 'racao_kg': 500, 'mortos': 10, 'despescados': 0, 'ultimo_peso_medio_kg': 1.18, 'ultima_biometria': dia(4)}])
            if tab == 'usuario_tanques': return j([{'usuario_id': U, 'tanque_id': T}, {'usuario_id': U, 'tanque_id': T2}])
            if tab == 'placas': return j(list(st['placas'].values()))
            if tab == 'fazendas':
                if 'whatsapp_visitantes' in u: return j({'whatsapp_visitantes': st['whats']} if obj else [{'whatsapp_visitantes': st['whats']}])
                return j({'kg_saco': 25} if obj else [{'kg_saco': 25}])
            if tab in ('racao_consumo', 'qualidade_agua') and req.method == 'GET': return j(list(banco.get(tab, {}).values()) if not obj else None)
            return j(None if obj else [])
        ctx.route('**/*', rota)
        s = {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 2592000, 'expires_at': int(time.time()) + 2592000, 'user': {'id': U, 'aud': 'authenticated'}}
        pg.add_init_script(f"if (!localStorage.getItem('sb-ppvliseblxpsepmeknnl-auth-token')) localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(s))});")
        return ctx, pg, erros, chamadas, st

    ctx, pg, erros, chamadas, st = app('dono')
    pg.goto(BASE + '#/mais'); pg.wait_for_selector('nav.abas', timeout=20000); pg.wait_for_timeout(800)
    checa(pg.locator('a.item[href="#/placas"]').count() == 1 and 'Visitantes' in pg.inner_text('#view'), 'dono: Fazenda › Visitantes › Placas com QR code')
    pg.click('a.item[href="#/placas"]'); pg.wait_for_selector('#f-whats', timeout=10000)
    lista = pg.inner_text('#view')
    checa('Tanque 3' in lista and 'Tanque 7' in lista and lista.count('Sem placa') == 2, 'lista os tanques, ainda "Sem placa"')
    checa('Tambaqui · Engorda' in lista and 'Sem peixes no momento' in lista, 'cada tanque com espécie e fase (ou sem peixes)')
    pg.fill('#whats', '95 9999'); pg.click('#f-whats button[type=submit]'); pg.wait_for_timeout(300)
    checa('inválido' in pg.inner_text('#toast') and st['whats'] is None, 'WhatsApp curto é recusado na tela')
    pg.fill('#whats', '(95) 99144-2495'); pg.click('#f-whats button[type=submit]'); pg.wait_for_timeout(900)
    checa(st['whats'] == '95991442495' and '(95) 99144-2495' in pg.inner_text('#d-whats summary'), 'WhatsApp salvo e mostrado formatado')
    pg.click('a.item[href="#/placa/%s"]' % T); pg.wait_for_selector('.folha .qr svg', timeout=15000); pg.wait_for_timeout(300)
    checa(any(c[0] == 'placa_salvar' for c in chamadas) and st['placas'][T]['ligada'] is False, 'primeira vez: a placa é criada DESLIGADA')
    checa('Esta placa está desligada' in pg.inner_text('#view') and not pg.is_checked('#c-ligada'), 'aviso de placa desligada antes de imprimir')
    link = pg.get_attribute('#b-ver', 'href')
    checa(link == BASE + f'placa.html?c={COD}', f'"Ver como o visitante vê" leva à página pública ({link})')
    if ler_qr:
        # a tela entra em cascata (~0,5 s) e o aviso "WhatsApp salvo" fica por cima por ~3 s: centraliza o QR e espera os dois
        pg.wait_for_selector('#toast:not(.on)', state='attached', timeout=6000); pg.evaluate("document.querySelector('.folha .qr').scrollIntoView({block: 'center'})"); pg.wait_for_timeout(900)
        png = pg.locator('.folha .qr svg').screenshot(animations='disabled'); open('qr_tela.png', 'wb').write(png); lido = ler_qr(png)
        checa(lido == link, f'o QR na tela, lido como uma câmera, abre a página certa ({lido!r})')
    else: print('      (leitura do QR pulada: OpenCV não instalado)')
    pg.click('#c-ligada'); pg.wait_for_timeout(900)
    checa(st['placas'][T]['ligada'] is True and pg.is_checked('#c-ligada') and 'Esta placa está desligada' not in pg.inner_text('#view'), 'dono liga a placa')
    pg.click('details.form-dobra summary'); pg.wait_for_timeout(200)
    checa(not pg.locator('[data-bloco=whatsapp]').is_disabled(), 'com número cadastrado, o WhatsApp pode ser ligado')
    pg.uncheck('[data-bloco=crescimento]'); pg.check('[data-bloco=whatsapp]'); pg.click('#b-salvar-blocos'); pg.wait_for_timeout(900)
    checa(st['placas'][T]['mostra_crescimento'] is False and st['placas'][T]['mostra_whatsapp'] is True and st['placas'][T]['mostra_agua'] is True, 'o que aparece: crescimento desligado, WhatsApp ligado')
    pg.click('#b-copiar'); pg.wait_for_timeout(300)
    checa(pg.evaluate('navigator.clipboard.readText()') == link, 'copiar link')
    pg.click('#b-pdf'); pg.wait_for_selector('.pdf-view canvas', timeout=25000); pg.wait_for_timeout(500)
    checa(pg.locator('.pdf-view canvas').count() == 1, 'PDF da placa: uma página (A5)')
    if ler_qr:
        lido = ler_qr(pg.locator('.pdf-view canvas').screenshot())
        checa(lido == link, f'o QR do PDF também abre a página certa ({lido!r})')
    pg.click('.pdf-view [data-fechar]'); pg.wait_for_timeout(300)
    pg.click('#b-trocar'); pg.wait_for_selector('.dialogo [data-ok]'); pg.click('.dialogo [data-ok]'); pg.wait_for_timeout(1000)
    checa(any(c[0] == 'placa_trocar_codigo' for c in chamadas) and pg.get_attribute('#b-ver', 'href').endswith('c=novo2345ab') and 'novo2345ab' in pg.inner_text('.folha'), 'trocar o QR code: placa com o código novo')
    checa(not pg.evaluate('document.documentElement.scrollWidth > innerWidth') and not erros, f'tela da placa no celular sem transbordo e sem erro {erros[:1]}')
    pg.screenshot(path='placa_dono_390.png', full_page=True)
    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_timeout(400)
    checa(not pg.evaluate('document.documentElement.scrollWidth > innerWidth'), 'tela da placa no computador sem transbordo')
    pg.screenshot(path='placa_dono_1280.png', full_page=True)
    ctx.close()

    for papel in ('gerente', 'funcionario'):
        ctx, pg, erros, chamadas, st = app(papel)
        pg.goto(BASE + '#/mais'); pg.wait_for_selector('nav.abas', timeout=20000); pg.wait_for_timeout(600)
        sem = pg.locator('a.item[href="#/placas"]').count() == 0
        pg.goto(BASE + '#/placas'); pg.wait_for_timeout(800)
        checa(sem and 'Só o dono' in pg.inner_text('#view') and not any(c[0].startswith('placa') for c in chamadas), f'{papel}: sem entrada de placas e sem acesso pelo endereço')
        ctx.close()

    # ---------------- 3) sem sinal → volta → aparece no app E na placa ----------------
    banco = {}
    def placa_do_banco():
        rac = [r for r in banco.get('racao_consumo', {}).values() if r.get('tanque_id') == T and r.get('data') == HOJE]
        ag = sorted([r for r in banco.get('qualidade_agua', {}).values() if r.get('tanque_id') == T and r.get('data') <= HOJE], key=lambda r: (r['data'], r.get('hora') or ''))
        a = ag[-1] if ag else None
        return placa(lotes=[lote(racao_hoje=bool(rac))], agua=a and {k: a.get(k) for k in ('data', 'hora', 'oxigenio_mgl', 'temperatura_c', 'ph', 'amonia_mgl')})
    vctx = b.new_context(viewport={'width': 390, 'height': 844}, timezone_id='America/Boa_Vista')
    vctx.route('**/*', lambda route, req: route.fulfill(status=200, content_type='application/json', body=json.dumps(placa_do_banco())) if req.url.startswith(SB) else route.continue_())
    vis = vctx.new_page()
    def ver_placa():
        vis.goto(BASE + f'placa.html?c={COD}'); vis.wait_for_selector('.td-hero', timeout=15000); vis.wait_for_timeout(200); return vis.inner_text('body')

    ctx, pg, erros, chamadas, st = app('funcionario', banco)
    sinal = lambda on: (ctx.set_offline(not on), pg.evaluate(f"window.dispatchEvent(new Event('{'online' if on else 'offline'}'))"))
    pg.goto(BASE + '#/'); pg.wait_for_selector('nav.abas', timeout=20000); pg.wait_for_timeout(3500)
    v = ver_placa()
    checa('Ainda não lançada' in v and 'Sem medição da água' in v, 'antes: placa mostra ração "ainda não lançada" e sem medição')
    sinal(False); pg.reload(); pg.wait_for_selector('nav.abas', timeout=20000); pg.wait_for_timeout(600)
    pg.goto(BASE + f'#/lancar?tipo=racao&tanque={T}'); pg.wait_for_selector('#racao-kg', timeout=10000); pg.fill('#racao-kg', '30')
    pg.locator('#f button[type=submit]').click(); pg.wait_for_timeout(500)
    for _ in range(3):
        if not pg.locator('.dialogo:not(.sai) [data-ok]').count(): break
        pg.click('.dialogo:not(.sai) [data-ok]'); pg.wait_for_timeout(400)
    pg.goto(BASE + '#/mais'); pg.wait_for_timeout(200)
    pg.goto(BASE + f'#/lancar?tipo=agua&tanque={T}'); pg.wait_for_selector('#ag-od', timeout=10000)
    pg.fill('#ag-od', '3,4'); pg.fill('#ag-temp', '29'); hora_lancada = datetime.now(BV).strftime('%H:%M')
    pg.locator('#f button[type=submit]').click(); pg.wait_for_timeout(500)
    for _ in range(3):
        if not pg.locator('.dialogo:not(.sai) [data-ok]').count(): break
        pg.click('.dialogo:not(.sai) [data-ok]'); pg.wait_for_timeout(400)
    pg.goto(BASE + '#/meus'); pg.wait_for_timeout(800)
    meus = pg.inner_text('#view')
    checa(meus.count('No celular') >= 2 and not banco, f'sem sinal: os 2 lançamentos aparecem no app ("No celular") e nada saiu')
    v = ver_placa()
    checa('Ainda não lançada' in v and 'Sem medição da água' in v, 'sem sinal: a placa ainda não mostra (nada chegou ao banco)')
    # espera o relógio virar o minuto: prova que a hora mostrada é a do lançamento, não a do envio
    for _ in range(70):
        if datetime.now(BV).strftime('%H:%M') != hora_lancada: break
        time.sleep(1)
    sinal(True)
    for _ in range(12):
        pg.wait_for_timeout(1000)
        if len(banco.get('racao_consumo', {})) == 1 and len(banco.get('qualidade_agua', {})) == 1: break
    ag = list(banco.get('qualidade_agua', {}).values())
    checa(len(banco.get('racao_consumo', {})) == 1 and len(ag) == 1, 'sinal voltou: os 2 lançamentos chegaram ao banco, uma vez cada')
    checa(ag and ag[0].get('data') == HOJE and ag[0].get('hora') == hora_lancada, f'a água chegou com a data e a hora do LANÇAMENTO ({ag and ag[0].get("hora")} = {hora_lancada}; envio às {datetime.now(BV).strftime("%H:%M")})')
    pg.goto(BASE + '#/mais'); pg.wait_for_timeout(200); pg.goto(BASE + '#/meus'); pg.wait_for_timeout(1200)
    meus = pg.inner_text('#view')
    checa(meus.count('Enviado') >= 2 and 'No celular' not in meus, 'no app: Meus lançamentos mostra os 2 como "Enviado"')
    v = ver_placa()
    checa('Dada ✓' in v, 'na placa: ração de hoje "Dada ✓"')
    checa('Água em atenção' in v and f'medida hoje às {hora_lancada}' in v and 'Oxigênio baixo' in v, f'na placa: água de hoje às {hora_lancada} (hora do lançamento), oxigênio baixo')
    checa(not erros, 'nenhum erro de JavaScript no app' + ('' if not erros else ': ' + ' | '.join(erros[:2])))
    ctx.close(); vctx.close()
    b.close()

print('RESULTADO:', 'TUDO OK' if ok else 'COM FALHAS')

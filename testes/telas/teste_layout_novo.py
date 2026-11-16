# Layout novo (13/11/2026), etapa 1, com o Supabase SIMULADO:
# - menu Hoje / Tanques / Relatórios / Fazenda (celular e lateral do computador)
# - Hoje do dono: botão "Fazer a ronda de hoje", números, uma linha por tanque com o que falta
# - Ronda: uma linha por tanque, "Falta fazer" e "Feitos", busca com mais de 8 tanques, janela de ações ao tocar,
#   lançar pela janela e voltar à ronda; o tanque lançado passa para "Feitos"
# - Tanque: ração de hoje e os 4 botões grandes (Ração, Mortes, Água, Pesagem); despesca só para dono e gerente
# - Fazenda: grupos (dia a dia, pessoas, plano, segurança)
# - funcionário: a Hoje é a ronda; Tanques mostra só a lista; nunca vê despesca nem R$
# - celular (390) e computador (1366): sem rolagem para o lado e sem erro de JavaScript
import os
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
import json, time
from datetime import date, timedelta
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
SB = 'https://ppvliseblxpsepmeknnl.supabase.co'
U = '11111111-1111-4111-8111-111111111111'; F = '22222222-2222-4222-8222-222222222222'
HOJE = date.today().isoformat(); ONTEM = (date.today() - timedelta(days=1)).isoformat()
tid = lambda i: f'33333333-3333-4333-8333-{i:012d}'
lid = lambda i: f'44444444-4444-4444-8444-{i:012d}'
# 10 tanques: 9 com peixes (para a busca da ronda aparecer) e 1 vazio
TANQUES = [{'id': tid(i), 'nome': f'Tanque {i}', 'area_ha': 1} for i in range(1, 11)]
LOTES = [{'id': lid(i), 'tanque_id': tid(i), 'tipo': 'engorda' if i > 2 else 'recria', 'especie': 'Tambaqui', 'data_entrada': '2026-09-01',
          'quantidade_inicial': 1000, 'peso_inicial_kg': 100, 'ativo': True, 'tanques': {'nome': f'Tanque {i}'}} for i in range(1, 10)]
RESUMO = [{'lote_id': lid(i), 'racao_kg': 500, 'mortos': 10, 'despescados': 0, 'ultima_racao': HOJE if i == 1 else ONTEM,
           'ultima_biometria': HOJE, 'ultimo_peso_medio_kg': 0.8} for i in range(1, 10)]
RACAO = [{'id': i, 'data': ONTEM, 'tanque_id': tid(i), 'quantidade_kg': 50} for i in range(1, 10)] + [{'id': 99, 'data': HOJE, 'tanque_id': tid(1), 'quantidade_kg': 50}]
AGUA = [{'id': 1, 'data': HOJE, 'hora': '06:00', 'tanque_id': tid(2), 'oxigenio_mgl': 3.1, 'temperatura_c': 29, 'ph': 7, 'amonia_mgl': None},
        {'id': 2, 'data': HOJE, 'hora': '06:00', 'tanque_id': tid(1), 'oxigenio_mgl': 5.8, 'temperatura_c': 29, 'ph': 7, 'amonia_mgl': None}]
SALDOS = [{'tipo_racao': 'engorda', 'total_comprado_kg': 5000, 'total_consumido_kg': 1000, 'total_ajustes_kg': 0, 'saldo_kg': 4000, 'consumo_7d_kg': 3150, 'ultima_contagem': HOJE}]
ok = True
def checa(c, m):
    global ok
    print(('OK   ' if c else 'FALHA ') + m); ok = ok and c

def rodar(papel, largura):
    erros, posts = [], []
    perfil = {'id': U, 'nome': 'Zé', 'papel': papel, 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'Fazenda Sol'}}
    pc = largura >= 900
    rot = f'{papel} {"PC" if pc else "celular"}'
    with sync_playwright() as pw:
        b = pw.chromium.launch(**LANCAR); ctx = b.new_context(reduced_motion='reduce', viewport={'width': largura, 'height': 900 if pc else 844}); pg = ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
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
                if tab == 'resumo_lotes':  # como o banco: a ração enviada hoje marca o lote como alimentado
                    hoje_l = {c.get('lote_id') for t_, c in posts if t_ == 'racao_consumo' and c.get('data') == HOJE}
                    return j([dict(r, ultima_racao=HOJE) if r['lote_id'] in hoje_l else r for r in RESUMO])
                if tab == 'saldo_racao_por_tipo': return j(SALDOS)
                if tab == 'saldo_racao': return j([SALDOS[0]])
                if tab == 'preco_peixe': return j(10)
                return j(False if tab == 'eh_admin' else None if tab in ('plano_atual', 'meu_suporte') else [])
            if tab == 'usuarios': return j(perfil if obj else [perfil])
            if tab == 'tanques': return j(TANQUES)
            if tab == 'lotes': return j(LOTES)
            if tab == 'racao_consumo': return j(RACAO + [{'id': 1000 + i, 'data': c.get('data'), 'tanque_id': c.get('tanque_id'), 'quantidade_kg': c.get('quantidade_kg')} for i, (t_, c) in enumerate(posts) if t_ == 'racao_consumo'])
            if tab == 'qualidade_agua': return j(AGUA)
            if tab == 'usuario_tanques': return j([{'usuario_id': U, 'tanque_id': t['id']} for t in TANQUES])
            if tab == 'fazendas': return j({'kg_saco': 25, 'preco_kg': 10} if obj else [{'kg_saco': 25, 'preco_kg': 10}])
            return j(None if obj else [])
        ctx.route('**/*', rota)
        s = {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 2592000, 'expires_at': int(time.time()) + 2592000, 'user': {'id': U, 'aud': 'authenticated'}}
        pg.add_init_script(f"if (!localStorage.getItem('sb-ppvliseblxpsepmeknnl-auth-token')) localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(s))});")
        sem_rolagem = lambda: pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        pg.goto(BASE + '#/'); pg.wait_for_selector('nav.abas', state='attached', timeout=20000); pg.wait_for_timeout(2500)
        menu = pg.eval_on_selector_all('.lateral > nav:not(.lat-atalhos) a' if pc else 'nav.abas a', 'els => els.map(e => e.innerText.trim())')
        checa(menu == ['Hoje', 'Tanques', 'Relatórios', 'Fazenda'], f'{rot}: menu Hoje / Tanques / Relatórios / Fazenda ({menu})')
        t = pg.inner_text('#view')
        if papel == 'dono':
            checa(pg.locator('#b-ronda').count() == 1 and 'Fazer a ronda de hoje' in t, f'{rot}: Hoje tem "Fazer a ronda de hoje"')
            checa(pg.locator('.numeros .num').count() >= 3 and 'Peixe na água' in t and 'Ração dura' in t and 'Vale hoje' in t, f'{rot}: Hoje mostra os números (peixe, valor, ração, mortes)')
            linhas = pg.locator('.hoje-tanques .tq')
            checa(linhas.count() == 10, f'{rot}: uma linha por tanque na Hoje ({linhas.count()} de 10)')
            t1 = pg.locator('.hoje-tanques .tq', has_text='Tanque 1').first.inner_text(); t2 = pg.locator('.hoje-tanques .tq', has_text='Tanque 2').first.inner_text()
            checa('✓ Ração 2 sacos' in t1 and '✓ Água ok' in t1, f'{rot}: Tanque 1 com ração e água feitas ({t1!r})')
            checa('Ração: dar 2 sacos' in t2 and 'Oxigênio 3,1 baixo' in t2, f'{rot}: Tanque 2 diz quanto dar e o oxigênio baixo ({t2!r})')
            checa('Água: medir' in pg.locator('.hoje-tanques .tq', has_text='Tanque 3').first.inner_text(), f'{rot}: tanque sem medição de hoje pede "Água: medir"')
            pg.screenshot(path=f'layout_hoje_{papel}_{largura}.png', full_page=True)
            checa(sem_rolagem(), f'{rot}: Hoje sem rolagem para o lado')
            pg.click('#b-ronda'); pg.wait_for_selector('.ronda-lista', timeout=10000); pg.wait_for_timeout(400)
        else:
            checa(pg.locator('.ronda-lista').count() == 1 and pg.locator('#b-ronda').count() == 0 and pg.locator('.numeros').count() == 0, f'{rot}: a Hoje do funcionário é a ronda (sem números da fazenda)')
        rt = pg.inner_text('#view')
        checa('1 de 9' in rt and 'Falta fazer (8)' in rt and 'Feitos (1)' in rt, f'{rot}: ronda mostra 1 de 9 e as abas Falta fazer (8) / Feitos (1)')
        checa(pg.locator('.ronda-lista .rl').count() == 8, f'{rot}: "Falta fazer" lista os 8 tanques sem ração')
        checa(pg.locator('#ronda-busca').count() == 1, f'{rot}: com mais de 8 tanques aparece a busca')
        pg.fill('#ronda-busca', 'tanque 5'); pg.wait_for_timeout(200)
        checa(pg.locator('.ronda-lista .rl').count() == 1, f'{rot}: a busca acha o Tanque 5')
        pg.fill('#ronda-busca', ''); pg.wait_for_timeout(200)
        pg.click('[data-rfiltro=feitos]'); pg.wait_for_timeout(200)
        checa(pg.locator('.ronda-lista .rl').count() == 1 and 'Tanque 1' in pg.inner_text('.ronda-lista'), f'{rot}: "Feitos" mostra o Tanque 1')
        pg.click('[data-rfiltro=falta]'); pg.wait_for_timeout(200)
        checa('O₂ 3,1 baixo' in pg.locator('.rl', has_text='Tanque 2').inner_text(), f'{rot}: a linha do Tanque 2 avisa o oxigênio baixo')
        pg.screenshot(path=f'layout_ronda_{papel}_{largura}.png', full_page=True)
        checa(sem_rolagem(), f'{rot}: Ronda sem rolagem para o lado')
        # tocar no tanque: janela com as ações
        pg.locator('.rl-tq', has_text='Tanque 3').click(); pg.wait_for_selector('.folha-acoes', timeout=5000); pg.wait_for_timeout(300)
        acoes = pg.eval_on_selector_all('.folha-acoes [data-acao]', 'els => els.map(e => e.dataset.acao)')
        esperado = ['racao', 'mortalidade', 'agua', 'biometria', 'manejo'] + (['despesca', 'transferencia'] if papel == 'dono' else [])
        checa(acoes == esperado, f'{rot}: janela do tanque com as ações {esperado} ({acoes})')
        checa('dar 2 sacos' in pg.inner_text('.folha-acoes'), f'{rot}: a janela diz quanto dar de ração')
        pg.screenshot(path=f'layout_janela_{papel}_{largura}.png')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        checa(pg.locator('.folha-acoes').count() == 0, f'{rot}: Esc fecha a janela')
        # lançar pela janela e voltar à ronda
        pg.locator('.rl-tq', has_text='Tanque 3').click(); pg.wait_for_selector('.folha-acoes')
        pg.click('.folha-acoes [data-acao=racao]'); pg.wait_for_selector('#racao-kg', timeout=10000); pg.wait_for_timeout(400)
        checa(pg.locator('.folha-acoes').count() == 0 and 'Tanque 3' in pg.inner_text('#tanque-nome'), f'{rot}: Ração abre o lançamento do Tanque 3 e a janela some')
        pg.fill('#racao-kg', '50'); pg.locator('#f button[type=submit]').click(); pg.wait_for_timeout(900)
        for _ in range(3):
            if not pg.locator('.dialogo [data-ok]').count(): break
            pg.click('.dialogo [data-ok]'); pg.wait_for_timeout(600)
        checa(pg.locator('#b-volta').count() == 1 and 'Voltar à ronda' in pg.inner_text('#b-volta'), f'{rot}: depois de salvar, "Voltar à ronda"')
        pg.click('#b-volta'); pg.wait_for_selector('.ronda-lista', timeout=10000); pg.wait_for_timeout(600)
        rt = pg.inner_text('#view')
        checa('2 de 9' in rt and 'Feitos (2)' in rt, f'{rot}: de volta à ronda, o Tanque 3 passou para Feitos (2 de 9)')
        # tela do tanque
        pg.goto(BASE + f'#/t/{tid(2)}'); pg.wait_for_selector('.acoes4', timeout=10000); pg.wait_for_timeout(400)
        grandes = pg.eval_on_selector_all('.acoes4 [data-acao]', 'els => els.map(e => e.dataset.acao)')
        checa(grandes == ['racao', 'mortalidade', 'agua', 'biometria'], f'{rot}: tanque com os 4 botões grandes ({grandes})')
        checa('Dar 50 kg (2 sacos)' in pg.inner_text('.plano-hoje'), f'{rot}: tanque mostra a ração de hoje ({pg.inner_text(".plano-hoje")[:60]!r})')
        checa(pg.locator('.acao.ruim[data-acao=agua]').count() == 1, f'{rot}: botão Água em vermelho (oxigênio baixo)')
        tem_desp = pg.locator('[data-acao=despesca]').count() > 0
        checa(tem_desp == (papel == 'dono'), f'{rot}: despesca {"aparece" if papel == "dono" else "não aparece"} no tanque')
        checa((pg.locator('.td-cadastro').count() == 1) == (papel == 'dono') and (pg.locator('.td-corrigir').count() == 1) == (papel != 'dono'), f'{rot}: tanque leva ao cadastro (dono) ou a "Lançou errado?" (funcionário)')
        pg.screenshot(path=f'layout_tanque_{papel}_{largura}.png', full_page=True)
        checa(sem_rolagem(), f'{rot}: tanque sem rolagem para o lado')
        # Tanques e Fazenda
        pg.goto(BASE + '#/tanques'); pg.wait_for_timeout(1200)
        checa(pg.locator('.lista-grade li').count() == 10 and pg.locator('a[href="#/t/' + tid(1) + '"]').count() == 1, f'{rot}: Tanques lista os 10 tanques e abre a tela do tanque')
        checa((pg.locator('#d-novo-tanque').count() == 1) == (papel == 'dono'), f'{rot}: cadastro de tanque só para o dono')
        pg.goto(BASE + '#/mais'); pg.wait_for_timeout(800)
        ft = pg.inner_text('#view')
        checa(ft.startswith('Fazenda') and 'No dia a dia' in ft and (('Pessoas' in ft and 'Segurança' in ft) if papel == 'dono' else 'Pessoas' not in ft), f'{rot}: Fazenda separada em grupos')
        pg.screenshot(path=f'layout_fazenda_{papel}_{largura}.png', full_page=True)
        checa(sem_rolagem(), f'{rot}: Fazenda sem rolagem para o lado')
        if papel != 'dono':
            checa('R$' not in rt and 'R$' not in ft, f'{rot}: funcionário não vê R$ na ronda nem na Fazenda')
        checa(not erros, f'{rot}: nenhum erro de JavaScript' + ('' if not erros else ': ' + ' | '.join(erros[:3])))
        b.close()

for papel in ['dono', 'funcionario']:
    for largura in [390, 1366]:
        rodar(papel, largura)
print('RESULTADO:', 'TUDO OK' if ok else 'COM FALHAS')

# Fazendas dos clientes (administrador do sistema, sql/42) com o Supabase SIMULADO: botão no topo, números de cada fazenda,
# avisos, busca, entrar como suporte em 1 toque, trocar de fazenda pela faixa, atualização sozinha, sem o sql/42,
# quem não é administrador. Celular e computador.
import os
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
import json, time, datetime
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
SB = 'https://ppvliseblxpsepmeknnl.supabase.co'
U = '11111111-1111-4111-8111-111111111111'; F = '22222222-2222-4222-8222-222222222222'
FA, FB, FC = 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003'
ok = True
def checa(c, m):
    global ok
    print(('OK   ' if c else 'FALHA ') + m); ok = ok and c

hoje = datetime.date.today().isoformat()
ISO = lambda s: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + s))
PL = lambda e, ate='2027-01-01': {'estado': e, 'valido_ate': ate, 'em_uso': 2, 'limite': 10}
FAZENDAS = [
  {'id': FA, 'nome': 'Fazenda São Carlos', 'criado_em': '2026-09-01T10:00:00Z', 'bloqueada': False, 'dono_nome': 'Paulo', 'dono_email': 'paulo@sc.com', 'pessoas': 3, 'tanques': 4, 'ultimo_lancamento': hoje, 'plano': PL('ativo')},
  {'id': FB, 'nome': 'Piscicultura Lua', 'criado_em': '2026-09-05T10:00:00Z', 'bloqueada': False, 'dono_nome': 'Beto', 'dono_email': 'beto@lua.com', 'pessoas': 2, 'tanques': 2, 'ultimo_lancamento': '2026-10-01', 'plano': PL('vencido', '2026-11-01')},
  {'id': FC, 'nome': 'Sítio Novo', 'criado_em': '2026-11-20T10:00:00Z', 'bloqueada': False, 'dono_nome': 'Ana', 'dono_email': 'ana@novo.com', 'pessoas': 1, 'tanques': 0, 'ultimo_lancamento': None, 'plano': PL('teste', hoje)},
]
ACOMP = [
  {'fazenda_id': FA, 'lotes_ativos': 3, 'peixes_vivos': 12500, 'biomassa_kg': 10400.5, 'lotes_sem_biometria': 1, 'racao_hoje_kg': 300, 'racao_7d_kg': 2100, 'mortos_7d': 40, 'estoque_kg': 5000, 'oxigenio_mgl': 3.1, 'oxigenio_em': hoje, 'oxigenio_tanque': 'Tanque 2', 'ultima_atividade': ISO(-1800)},
  {'fazenda_id': FB, 'lotes_ativos': 1, 'peixes_vivos': 3000, 'biomassa_kg': 900, 'lotes_sem_biometria': 0, 'racao_hoje_kg': 0, 'racao_7d_kg': 0, 'mortos_7d': 0, 'estoque_kg': -50, 'oxigenio_mgl': None, 'oxigenio_em': None, 'oxigenio_tanque': None, 'ultima_atividade': ISO(-10 * 86400)},
  {'fazenda_id': FC, 'lotes_ativos': 0, 'peixes_vivos': 0, 'biomassa_kg': None, 'lotes_sem_biometria': 0, 'racao_hoje_kg': 0, 'racao_7d_kg': 0, 'mortos_7d': 0, 'estoque_kg': 0, 'oxigenio_mgl': None, 'oxigenio_em': None, 'oxigenio_tanque': None, 'ultima_atividade': None},
]

def abrir(pw, vp, admin=True, sql42=True):
    b = pw.chromium.launch(**LANCAR); pg = b.new_page(reduced_motion='reduce', viewport=vp)
    est = {'rpc': [], 'erros': [], 'sup': None, 'placas': set()}
    pg.on('pageerror', lambda e: est['erros'].append(str(e)))
    def rota(route, req):
        u = req.url
        if not u.startswith(SB):
            if u.startswith(BASE) or 'cdn' in u or 'jsdelivr' in u or 'unpkg' in u or 'fonts.g' in u: return route.continue_()
            return route.abort()
        path = urlparse(u).path; obj = 'object' in (req.headers.get('accept') or '')
        js = lambda o, st=200: route.fulfill(status=st, content_type='application/json', body=json.dumps(o))
        sup = est['sup']
        if '/rpc/' in path:
            fn = path.split('/')[-1]; corpo = json.loads(req.post_data or '{}'); est['rpc'].append((fn, corpo))
            if fn == 'eh_admin': return js(admin)
            if fn == 'meu_suporte': return js(sup)
            if fn == 'admin_entrar_suporte':
                nome = next(f['nome'] for f in FAZENDAS if f['id'] == corpo['p_fazenda'])
                est['sup'] = {'fazenda_id': corpo['p_fazenda'], 'nome': nome, 'expira': ISO(7200)}; return js(est['sup'])
            if fn == 'admin_sair_suporte': est['sup'] = None; return js(None)
            if fn == 'admin_fazendas': return js(FAZENDAS) if admin else js({'code': 'P0001', 'message': 'Apenas administradores'}, 400)
            if fn == 'admin_cobrancas': return js([{'id': 1, 'fazenda_id': FA, 'fazenda': 'Fazenda São Carlos', 'valor': 250, 'status': 'pendente', 'tanques_max': 10, 'criada_em': ISO(-3600)}])
            if fn == 'admin_acompanhamento':
                if not sql42: return js({'code': 'PGRST202', 'message': 'Could not find the function public.admin_acompanhamento'}, 404)
                return js(ACOMP)
            if fn == 'admin_placas_liberadas': return js(sorted(est['placas']))
            if fn == 'admin_liberar_placas':
                (est['placas'].add if corpo['p_liberar'] else est['placas'].discard)(corpo['p_fazenda']); return js(corpo['p_liberar'])
            if fn == 'admin_config': return js({'modo_piloto': False})
            if fn.startswith('admin_'): return js([])
            if fn == 'saldo_racao': return js([{'saldo_kg': 0, 'consumo_7d_kg': 0}])
            return js(None if fn == 'plano_atual' else [])
        tab = path.split('/')[-1]
        perfil = {'id': U, 'nome': 'Hugo', 'papel': 'dono', 'fazenda_id': F, 'ativo': True, 'fazendas': None if sup else {'nome': 'Fazenda do Hugo'}}
        if tab == 'usuarios': return js(perfil if obj else [perfil])
        if tab == 'fazendas': return js({'kg_saco': 25} if obj else [{'kg_saco': 25}])
        return js([])
    pg.route('**/*', rota)
    s = {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 2592000, 'expires_at': int(time.time()) + 2592000, 'user': {'id': U, 'aud': 'authenticated'}}
    pg.add_init_script(f"localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(s))});")
    return b, pg, est

def cartao(pg, fid): return pg.locator(f'.cli-card[data-faz="{fid}"]')

with sync_playwright() as pw:
    for nome, vp in [('celular', {'width': 390, 'height': 844}), ('pc', {'width': 1366, 'height': 900})]:
        b, pg, est = abrir(pw, vp)
        pg.goto(BASE + '#/'); pg.wait_for_selector('#view', timeout=20000); pg.wait_for_timeout(1200)
        botao = pg.locator('.btn-clientes-ic:visible' if nome == 'celular' else '.btn-clientes:visible')
        checa(botao.count() == 1, f'{nome}: administrador tem o botão "Fazendas dos clientes" sempre à vista ({"topo" if nome == "celular" else "lateral"})')
        botao.first.click(); pg.wait_for_selector('.cli-card', timeout=20000); pg.wait_for_timeout(500)
        t = pg.inner_text('#view')
        checa('15.500' in t and '11,3 t' in t, f'{nome}: totais de todas as fazendas (peixes 15.500, biomassa 11,3 t)')
        a = cartao(pg, FA).inner_text()
        checa('12.500' in a and '10,4 t' in a and '12,0 sc' in a and '200 sc' in a and '40' in a, f'{nome}: São Carlos mostra peixes, biomassa, ração de hoje (12 sacos), estoque e mortes')
        checa('Oxigênio baixo: 3,1 mg/L (Tanque 2)' in a and 'Cobrança esperando: R$' in a, f'{nome}: avisos de oxigênio baixo e cobrança esperando')
        checa('1 lote sem biometria' in a and 'há 30 min' in a, f'{nome}: lote sem biometria e última atividade')
        l = cartao(pg, FB).inner_text()
        checa('Mensalidade vencida' in l and 'Estoque de ração negativo' in l and 'Parada há 10 dias' in l, f'{nome}: Lua mostra vencida, estoque negativo e parada')
        ordem = pg.eval_on_selector_all('.cli-card', 'l => l.map((x) => x.dataset.faz)')
        checa(ordem.index(FC) == 2, f'{nome}: fazendas com problema em cima')
        pg.fill('#cli-busca', 'lua'); pg.wait_for_timeout(300)
        checa(pg.locator('.cli-card').count() == 1 and cartao(pg, FB).count() == 1 and pg.evaluate("document.activeElement.id") == 'cli-busca', f'{nome}: busca filtra sem perder o cursor')
        pg.fill('#cli-busca', ''); pg.wait_for_timeout(300)
        checa(pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{nome}: sem rolar para os lados')
        pg.screenshot(path=f'clientes_{nome}.png', full_page=True)
        # atualização sozinha: muda o número no "banco" e espera o minuto
        ACOMP[0]['peixes_vivos'] = 12400
        pg.click('#cli-recarregar'); pg.wait_for_timeout(1200)
        checa('12.400' in cartao(pg, FA).inner_text(), f'{nome}: "Atualizar agora" traz o número novo')
        ACOMP[0]['peixes_vivos'] = 12500
        # entrar como suporte em 1 toque (com o motivo)
        cartao(pg, FA).locator('[data-suporte]').click(); pg.wait_for_selector('.dialogo', timeout=5000)
        pg.fill('.dialogo input', 'conferir oxigênio'); pg.click('.dialogo button[type=submit]')
        pg.wait_for_selector('.faixa-suporte:visible', timeout=20000); pg.wait_for_timeout(800)
        ent = [r for r in est['rpc'] if r[0] == 'admin_entrar_suporte']
        checa(len(ent) == 1 and ent[0][1] == {'p_fazenda': FA, 'p_motivo': 'conferir oxigênio'}, f'{nome}: entra como suporte na São Carlos direto da lista')
        f = pg.locator('.faixa-suporte:visible').first
        checa('Trocar de fazenda' in f.inner_text(), f'{nome}: faixa do suporte tem "Trocar de fazenda"')
        f.locator('a', has_text='Trocar de fazenda').click(); pg.wait_for_selector('.cli-card', timeout=20000); pg.wait_for_timeout(500)
        c = cartao(pg, FA).inner_text()
        checa('Você está aqui' in c and 'Sair do suporte' in c, f'{nome}: na lista, a fazenda atual aparece marcada com "Sair do suporte"')
        cartao(pg, FB).locator('[data-suporte]').click(); pg.wait_for_selector('.dialogo', timeout=5000)
        pg.fill('.dialogo input', 'mensalidade vencida'); pg.click('.dialogo button[type=submit]')
        pg.wait_for_function("() => { const m = document.querySelector(innerWidth >= 900 ? '.lateral .marca' : '.topo'); return !!document.querySelector('.faixa-suporte') && m && m.innerText.includes('Piscicultura Lua'); }", timeout=20000)
        checa(est['sup'] and est['sup']['fazenda_id'] == FB, f'{nome}: troca direto para outra fazenda')
        pg.goto(BASE + '#/clientes'); pg.wait_for_selector('.cli-card', timeout=20000)
        cartao(pg, FB).locator('[data-sair]').click(); pg.wait_for_function("() => !document.querySelector('.faixa-suporte')", timeout=20000)
        checa(est['sup'] is None, f'{nome}: "Sair do suporte" pela lista volta para a própria fazenda')
        # ficha e cobrança abre a ficha certa no painel
        pg.goto(BASE + '#/clientes'); pg.wait_for_selector('.cli-card', timeout=20000)
        cartao(pg, FB).locator('a', has_text='Ficha').click(); pg.wait_for_selector('.adm-ficha', timeout=20000)
        checa('Piscicultura Lua' in pg.inner_text('.adm-ficha'), f'{nome}: "Ficha e cobrança" abre a ficha da fazenda no painel')
        checa(not est['erros'], f'{nome}: sem erro de JavaScript {est["erros"][:2]}')
        b.close()

    # placas com QR code: serviço à parte, o administrador libera e retira pela ficha da fazenda
    b, pg, est = abrir(pw, {'width': 390, 'height': 844})
    pg.goto(BASE + f'#/admin?f={FA}'); pg.wait_for_selector('.adm-ficha', timeout=20000); pg.wait_for_timeout(500)
    pg.click(f'[data-placas-liberar="{FA}"]'); pg.wait_for_selector('.dialogo', timeout=5000)
    checa('contratar' in pg.inner_text('.dialogo'), 'liberar placas: lembra de liberar depois que o cliente contratar')
    pg.click('.dialogo [data-ok]'); pg.wait_for_selector(f'[data-placas-retirar="{FA}"]', timeout=15000)
    checa(any(r[0] == 'admin_liberar_placas' and r[1] == {'p_fazenda': FA, 'p_liberar': True} for r in est['rpc']), 'administrador libera as placas da São Carlos')
    pg.goto(BASE + '#/clientes'); pg.wait_for_selector('.cli-card', timeout=20000)
    checa('Placas QR' in cartao(pg, FA).inner_text() and 'Placas QR' not in cartao(pg, FB).inner_text(), 'na lista, só a fazenda liberada mostra "Placas QR"')
    pg.goto(BASE + f'#/admin?f={FA}'); pg.wait_for_selector(f'[data-placas-retirar="{FA}"]', timeout=20000)
    pg.click(f'[data-placas-retirar="{FA}"]'); pg.wait_for_selector('.dialogo', timeout=5000)
    checa('indisponível' in pg.inner_text('.dialogo'), 'retirar avisa que as placas impressas param de mostrar os dados')
    pg.click('.dialogo [data-ok]'); pg.wait_for_selector(f'[data-placas-liberar="{FA}"]', timeout=15000)
    checa(FA not in est['placas'] and not est['erros'], 'administrador retira as placas, sem erro')
    b.close()

    # sem o sql/42 no banco: a lista e o suporte funcionam, com aviso
    b, pg, est = abrir(pw, {'width': 390, 'height': 844}, sql42=False)
    pg.goto(BASE + '#/clientes'); pg.wait_for_selector('.cli-card', timeout=20000)
    t = pg.inner_text('#view')
    checa('sql/42' in t and pg.locator('.cli-card').count() == 3 and pg.locator('[data-suporte]').count() == 3, 'sem o sql/42: aviso, lista e botões de suporte')
    checa(not est['erros'], 'sem o sql/42: sem erro de JavaScript')
    b.close()
    # quem não é administrador
    b, pg, est = abrir(pw, {'width': 390, 'height': 844}, admin=False)
    pg.goto(BASE + '#/'); pg.wait_for_selector('#view', timeout=20000); pg.wait_for_timeout(1000)
    checa(pg.locator('.btn-clientes-ic, .btn-clientes').count() == 0, 'quem não é administrador não vê o botão')
    pg.goto(BASE + '#/clientes'); pg.wait_for_timeout(1500)
    t = pg.inner_text('#view')
    checa('administrador' in t and 'Hugo' in t and pg.locator('.cli-card').count() == 0, 'quem não é administrador vê explicação clara (com o nome de quem entrou), sem dados')
    checa(not any(r[0] in ('admin_fazendas', 'admin_acompanhamento') for r in est['rpc']), 'quem não é administrador nem chega a pedir os dados')
    b.close()

print('RESULTADO: TUDO OK' if ok else 'RESULTADO: HÁ FALHAS')

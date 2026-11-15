# Teste das telas de convite do PisciApp com o Supabase SIMULADO (nenhuma requisição sai para o banco real).
import os
# Onde o app está rodando (python -m http.server 5500 na pasta do projeto) e qual navegador usar.
# NAVEGADOR=chrome usa o Chrome instalado; NAVEGADOR= (vazio) usa o Chromium do Playwright (playwright install chromium).
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
import json, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
SB = 'https://ppvliseblxpsepmeknnl.supabase.co'
D = '11111111-1111-4111-8111-111111111111'   # dono
N = '66666666-6666-4666-8666-666666666666'   # pessoa nova, sem fazenda
F = '22222222-2222-4222-8222-222222222222'
TOK = 'a' * 64
ok = True
def checa(cond, msg):
    global ok
    print(('OK   ' if cond else 'FALHA ') + msg); ok = ok and cond

def sessao(uid):
    return {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 2592000,
            'expires_at': int(time.time()) + 2592000, 'user': {'id': uid, 'email': 'p@t.com', 'aud': 'authenticated', 'role': 'authenticated'}}

def montar(pw, uid, estado):
    """estado: dict com perfis, convite_estado; registra rpc chamadas em estado['rpc']"""
    b = pw.chromium.launch(**LANCAR)
    pg = b.new_page(reduced_motion='reduce', viewport={'width': 390, 'height': 844})
    estado.setdefault('rpc', []); estado.setdefault('externos', []); estado.setdefault('erros', []); estado.setdefault('signup', [])
    pg.on('pageerror', lambda e: estado['erros'].append(str(e)))
    def rota(route, req):
        url = req.url
        if not url.startswith(SB):
            if url.startswith(BASE) or 'cdn' in url or 'jsdelivr' in url or 'unpkg' in url or 'fonts.g' in url:
                return route.continue_()
            estado['externos'].append(url); return route.abort()
        p = urlparse(url); path = p.path
        js = lambda o, st=200: route.fulfill(status=st, content_type='application/json', body=json.dumps(o))
        if path.startswith('/auth/v1/signup'):
            estado['signup'].append(url); return js({'id': N, 'email': 'n@t.com', 'identities': [{'id': 'i'}]})
        if '/rpc/' in path:
            fn = path.split('/')[-1]; body = json.loads(req.post_data or '{}'); estado['rpc'].append((fn, body))
            if fn == 'ver_convite':
                return js({'estado': estado.get('convite_estado', 'valido'), 'fazenda': 'Fazenda Sol', 'papel': 'funcionario', 'expira_em': '2026-10-27T12:00:00+00:00'})
            if fn == 'aceitar_convite':
                estado['perfis'][N] = {'id': N, 'nome': body['p_nome'], 'papel': 'funcionario', 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'Fazenda Sol'}}
                return js(F)
            if fn == 'criar_convite':
                estado.setdefault('abertos', []).append({'token': TOK, 'papel': body['p_papel'], 'criado_em': '2026-10-20T12:00:00+00:00', 'expira_em': '2026-10-27T12:00:00+00:00'})
                return js(TOK)
            if fn == 'cancelar_convite':
                estado['abertos'] = [c for c in estado.get('abertos', []) if c['token'] != body['p_token']]; return js(None)
            if fn == 'nomes_equipe': return js([{'id': D, 'nome': 'Dona Ana'}])
            if fn == 'saldo_racao': return js([{'total_comprado_kg': 0, 'total_consumido_kg': 0, 'total_ajustes_kg': 0, 'saldo_kg': 0, 'consumo_7d_kg': 0, 'ultima_contagem': None}])
            return js([] if fn != 'plano_atual' else None)
        if '/rest/v1/' in path:
            tab = path.split('/')[-1]; q = parse_qs(p.query)
            if tab == 'usuarios' and 'id' in q:
                pf = estado['perfis'].get(q['id'][0][3:])
                return js(pf) if 'object' in (req.headers.get('accept') or '') else js([pf] if pf else [])
            if tab == 'usuarios': return js([v for v in estado['perfis'].values()])
            if tab == 'convites': return js(estado.get('abertos', []))
            if tab == 'fazendas': return js({'kg_saco': 25, 'teste_ate': None, 'logo': None} if 'object' in (req.headers.get('accept') or '') else [{'kg_saco': 25, 'teste_ate': None, 'logo': None}])
            return js([])
        estado['externos'].append(url); return route.abort()
    pg.route('**/*', rota)
    if uid:
        pg.add_init_script(f"if (!sessionStorage.getItem('iniciado')) {{ localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(sessao(uid)))}); sessionStorage.setItem('iniciado', '1'); }}")
    return b, pg

perfil_dono = {'id': D, 'nome': 'Dona Ana', 'papel': 'dono', 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'Fazenda Sol'}}

with sync_playwright() as pw:
    # A) dono gera, copia e cancela convite
    est = {'perfis': {D: perfil_dono}}
    b, pg = montar(pw, D, est)
    pg.goto(BASE + '#/equipe'); pg.wait_for_selector('#b-convite', timeout=20000)
    pg.select_option('#conv-papel', 'gerente'); pg.click('#b-convite'); pg.wait_for_selector('#conv-novo:not([hidden])')
    link = pg.input_value('#conv-link')
    checa(link == BASE + '#/convite/' + TOK, 'dono: link gerado no formato .../#/convite/<token>')
    checa(('criar_convite', {'p_papel': 'gerente'}) in est['rpc'], 'dono: pede convite com o papel escolhido (gerente)')
    href = pg.get_attribute('#b-whats', 'href')
    checa(href.startswith('https://wa.me/?text=') and 'Fazenda%20Sol' in href and 'gerente' in href and TOK in href, 'dono: botão do WhatsApp leva mensagem com fazenda, papel e link')
    pg.goto(BASE + '#/mais'); pg.goto(BASE + '#/equipe'); pg.wait_for_selector(f'[data-cancelar-conv="{TOK}"]', timeout=15000)
    checa('Convites em aberto' in pg.inner_text('#convite'), 'dono: convite aparece em "Convites em aberto"')
    pg.screenshot(path='equipe_convite.png', full_page=True)
    pg.click(f'[data-cancelar-conv="{TOK}"]'); pg.click('.dialogo [data-ok]'); pg.wait_for_timeout(1200)
    checa(('cancelar_convite', {'p_token': TOK}) in est['rpc'] and not pg.is_visible(f'[data-cancelar-conv="{TOK}"]'), 'dono: cancelar some com o convite')
    checa('Vincular pelo e-mail' not in pg.inner_text('#view'), 'dono: só o convite por link (o vincular por e-mail saiu)')
    errA = est['erros'] + est['externos']; b.close()

    # B) pessoa nova: abre o link sem login, cria conta (o e-mail de confirmação volta com o convite)
    est = {'perfis': {}}
    b, pg = montar(pw, None, est)
    pg.goto(BASE + '#/convite/' + TOK); pg.wait_for_selector('#f-login', timeout=20000)
    checa('recebeu um convite' in pg.inner_text('main'), 'sem login: tela de entrada avisa do convite')
    checa(pg.evaluate("localStorage.getItem('convite')") == TOK and '#/convite' not in pg.url, 'sem login: convite guardado no aparelho e tirado do endereço')
    pg.click('#b-criar'); pg.wait_for_selector('#f-cad')
    checa('fazenda que te convidou' in pg.inner_text('main'), 'cadastro: texto fala do convite (não do teste grátis)')
    pg.fill('#email', 'n@t.com'); pg.fill('#senha', 'tilapia2026'); pg.click('#f-cad button[type=submit]'); pg.wait_for_timeout(1500)
    su = est['signup'][0] if est['signup'] else ''
    checa(('convite%3D' + TOK) in su or ('convite=' + TOK) in su, 'cadastro: link de confirmação do e-mail leva o convite junto')
    errB = est['erros'] + est['externos']; b.close()

    # C) pessoa nova logada (voltou pela confirmação com ?convite=): aceita e entra
    est = {'perfis': {D: perfil_dono}}
    b, pg = montar(pw, N, est)
    pg.goto(BASE + '?convite=' + TOK + '#/'); pg.wait_for_selector('#f-conv', timeout=20000)
    t = pg.inner_text('main')
    checa('Entrar na Fazenda Sol' in t and 'Funcionário' in t, 'aceitar: mostra "Entrar na Fazenda Sol" como Funcionário')
    checa('?convite' not in pg.url, 'aceitar: convite tirado do endereço')
    pg.wait_for_timeout(5000); pg.screenshot(path='aceitar_convite.png')
    pg.click('#f-conv button[type=submit]')
    checa('Informe o seu nome' in pg.inner_text('#f-conv'), 'aceitar: exige o nome')
    pg.fill('#nome', 'Zé'); pg.click('#f-conv button[type=submit]'); pg.wait_for_selector('nav.abas', timeout=15000)
    checa(('aceitar_convite', {'p_token': TOK, 'p_nome': 'Zé'}) in est['rpc'], 'aceitar: envia token e nome')
    checa(pg.evaluate("localStorage.getItem('convite')") is None, 'aceitar: convite apagado do aparelho depois de usar')
    checa('Fazenda Sol' in pg.inner_text('header'), 'aceitar: app abre já na Fazenda Sol')
    errC = est['erros'] + est['externos']; b.close()

    # D) convite expirado: explica e oferece cadastrar a própria fazenda
    est = {'perfis': {}, 'convite_estado': 'expirado'}
    b, pg = montar(pw, N, est)
    pg.goto(BASE + '#/convite/' + TOK); pg.wait_for_selector('#b-propria', state='attached', timeout=20000)
    checa('Convite não disponível' in pg.inner_text('main') and 'expirou' in pg.inner_text('main'), 'expirado: explica que o convite expirou')
    pg.click('details.avancado summary'); pg.click('#b-propria'); pg.wait_for_selector('#f-faz')
    checa(pg.evaluate("localStorage.getItem('convite')") is None, 'expirado: "cadastrar minha fazenda" descarta o convite e abre o cadastro da fazenda')
    errD = est['erros'] + est['externos']; b.close()

    # E) quem já está numa fazenda abre um convite: avisa e descarta
    est = {'perfis': {D: perfil_dono}}
    b, pg = montar(pw, D, est)
    pg.goto(BASE + '#/convite/' + TOK); pg.wait_for_selector('nav.abas', timeout=20000); pg.wait_for_timeout(1000)
    checa('ainda está ativa em outra fazenda' in pg.inner_text('#toast') and 'desativar' in pg.inner_text('#toast') and pg.evaluate("localStorage.getItem('convite')") is None, 'já tem fazenda: avisa "convite não usado" e descarta')
    errE = est['erros'] + est['externos']; b.close()

todos = errA + errB + errC + errD + errE
checa(not todos, 'nenhum erro de JavaScript nem requisição para fora do teste' + ('' if not todos else ': ' + ' | '.join(todos[:3])))
print('RESULTADO:', 'TUDO OK' if ok else 'COM FALHAS')

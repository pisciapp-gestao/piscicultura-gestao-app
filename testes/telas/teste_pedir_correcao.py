# Etapa 3, parte 1 (14/11/2026): pedir correção (sql/35), com o Supabase SIMULADO.
# - funcionário: Meus lançamentos mostra 7 dias por dia; hoje = Corrigir direto; dias anteriores = Pedir correção
# - a janela confere o valor (igual ao lançado, zero) e manda o pedido com o valor certo e o motivo; "apagar" sem números
# - pedido aberto: "Correção pedida" e "Cancelar pedido"; recusado: mostra a resposta
# - dono: aviso na Hoje, tela de pedidos com lançado × certo, aprovar (confirma) e recusar (com resposta); Fazenda tem o atalho
# - funcionário não abre a tela de pedidos; celular (390) e computador (1366) sem rolagem para o lado e sem erro de JavaScript
import os
_AQUI = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(_AQUI, 'saida'), exist_ok=True); os.chdir(os.path.join(_AQUI, 'saida'))
_CANAL = os.environ.get('NAVEGADOR', 'chrome')
LANCAR = {'channel': _CANAL} if _CANAL else {}
import json, time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = os.environ.get('APP_URL', 'http://127.0.0.1:5500/')
SB = 'https://ppvliseblxpsepmeknnl.supabase.co'
U = '11111111-1111-4111-8111-111111111111'; W = '11111111-1111-4111-8111-222222222222'; F = '22222222-2222-4222-8222-222222222222'
tid = lambda i: f'33333333-3333-4333-8333-{i:012d}'
lid = lambda i: f'44444444-4444-4444-8444-{i:012d}'
HOJE = date.today(); dia = lambda n: (HOJE - timedelta(days=n)).isoformat()
TANQUES = [{'id': tid(i), 'nome': f'Tanque {i}', 'area_ha': 1} for i in range(1, 3)]
LOTES = [{'id': lid(i), 'tanque_id': tid(i), 'tipo': 'engorda', 'especie': 'Tambaqui', 'data_entrada': '2026-09-01', 'quantidade_inicial': 1000, 'peso_inicial_kg': 100, 'ativo': True, 'tanques': {'nome': f'Tanque {i}'}} for i in range(1, 3)]
def iso(dt): return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
agora = datetime.now(timezone.utc)
ok = True
def checa(c, m):
    global ok
    print(('OK   ' if c else 'FALHA ') + m); ok = ok and c

def rodar(papel, largura):
    erros, rpcs = [], []
    eu = W if papel == 'funcionario' else U
    banco = {
        'racao_consumo': [{'id': 'r-velho', 'uuid_local': 'u-r1', 'lote_id': lid(1), 'tanque_id': tid(1), 'data': dia(2), 'quantidade_kg': 2500, 'registrado_por': W, 'criado_em': iso(agora - timedelta(days=2))}],
        'mortalidade': [{'id': 'm-hoje', 'uuid_local': 'u-m1', 'lote_id': lid(2), 'data': dia(0), 'quantidade': 3, 'registrado_por': W, 'criado_em': iso(agora - timedelta(hours=1))}],
        'qualidade_agua': [{'id': 'a-velho', 'uuid_local': 'u-a1', 'tanque_id': tid(1), 'data': dia(3), 'hora': '06:00', 'oxigenio_mgl': 5.0, 'temperatura_c': 29, 'ph': None, 'amonia_mgl': None, 'registrado_por': W, 'criado_em': iso(agora - timedelta(days=3))}],
    }
    pedidos = []
    if papel == 'dono':
        pedidos += [{'id': 'p1', 'fazenda_id': F, 'tabela': 'racao_consumo', 'registro_id': 'r-velho', 'tanque_id': tid(1), 'acao': 'corrigir', 'antes': banco['racao_consumo'][0], 'campos': {'quantidade_kg': 250},
                     'motivo': 'Digitei o número errado', 'status': 'pendente', 'pedido_por': W, 'pedido_em': iso(agora - timedelta(hours=3)), 'resposta': None, 'respondido_por': None, 'respondido_em': None},
                    {'id': 'p2', 'fazenda_id': F, 'tabela': 'qualidade_agua', 'registro_id': 'a-velho', 'tanque_id': tid(1), 'acao': 'apagar', 'antes': banco['qualidade_agua'][0], 'campos': {},
                     'motivo': 'Lancei duas vezes', 'status': 'pendente', 'pedido_por': W, 'pedido_em': iso(agora - timedelta(hours=2)), 'resposta': None, 'respondido_por': None, 'respondido_em': None}]
    perfil = {'id': eu, 'nome': 'Zé' if papel == 'funcionario' else 'Dona Ana', 'papel': papel, 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'Fazenda Sol'}}
    pc = largura >= 900
    rot = f'{papel} {"PC" if pc else "celular"}'
    with sync_playwright() as pw:
        b = pw.chromium.launch(**LANCAR); ctx = b.new_context(reduced_motion='reduce', viewport={'width': largura, 'height': 900 if pc else 844}); pg = ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        def rota(route, req):
            u = req.url
            if not u.startswith(SB): return route.continue_()
            pr = urlparse(u); path = pr.path; q = parse_qs(pr.query); obj = 'object' in (req.headers.get('accept') or '')
            j = lambda o, st=200: route.fulfill(status=st, content_type='application/json', body=json.dumps(o))
            tab = path.split('/')[-1]
            if '/rpc/' in path:
                corpo = json.loads(req.post_data or '{}')
                if tab in ('pedir_correcao', 'responder_correcao', 'cancelar_pedido_correcao'):
                    rpcs.append((tab, corpo))
                    if tab == 'pedir_correcao':
                        reg = next(r for t in banco.values() for r in t if r['id'] == corpo['p_registro'])
                        pedidos.insert(0, {'id': f'n{len(rpcs)}', 'fazenda_id': F, 'tabela': corpo['p_tabela'], 'registro_id': corpo['p_registro'], 'tanque_id': tid(1), 'acao': corpo['p_acao'], 'antes': reg, 'campos': corpo['p_campos'],
                                           'motivo': corpo['p_motivo'], 'status': 'pendente', 'pedido_por': eu, 'pedido_em': iso(datetime.now(timezone.utc)), 'resposta': None, 'respondido_por': None, 'respondido_em': None})
                        return j(pedidos[0]['id'])
                    p = next(x for x in pedidos if x['id'] == corpo['p_id'])
                    if tab == 'cancelar_pedido_correcao': p['status'] = 'cancelado'; return j(None)
                    p.update(status='aprovado' if corpo['p_aprovar'] else 'recusado', resposta=corpo.get('p_resposta'), respondido_por=eu, respondido_em=iso(datetime.now(timezone.utc)))
                    if corpo['p_aprovar'] and p['acao'] == 'corrigir':
                        for r in banco[p['tabela']]:
                            if r['id'] == p['registro_id']: r.update(p['campos'])
                    return j(p['status'])
                if tab == 'resumo_lotes': return j([])
                if tab == 'nomes_equipe': return j([{'id': W, 'nome': 'Zé'}, {'id': U, 'nome': 'Dona Ana'}])
                return j(False if tab == 'eh_admin' else None if tab in ('plano_atual', 'meu_suporte') else [])
            if tab == 'usuarios': return j(perfil if obj else [perfil])
            if tab == 'tanques': return j(TANQUES)
            if tab == 'lotes': return j(LOTES)
            if tab == 'usuario_tanques': return j([{'usuario_id': eu, 'tanque_id': t['id']} for t in TANQUES])
            if tab == 'fazendas': return j({'kg_saco': 25} if obj else [{'kg_saco': 25}])
            if tab == 'pedidos_correcao':
                meus = q.get('pedido_por', [''])[0].replace('eq.', '')
                return j([p for p in pedidos if not meus or p['pedido_por'] == meus])
            if 'registrado_por' in q:
                quem = q['registrado_por'][0].replace('eq.', '')
                return j([r for r in banco.get(tab, []) if r['registrado_por'] == quem])
            return j(None if obj else [])
        ctx.route('**/*', rota)
        s = {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 2592000, 'expires_at': int(time.time()) + 2592000, 'user': {'id': eu, 'aud': 'authenticated'}}
        pg.add_init_script(f"if (!localStorage.getItem('sb-ppvliseblxpsepmeknnl-auth-token')) localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(s))});")
        sem_rolagem = lambda: pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        pg.goto(BASE + '#/'); pg.wait_for_selector('nav.abas', state='attached', timeout=20000); pg.wait_for_timeout(2000)

        if papel == 'funcionario':
            pg.goto(BASE + '#/meus'); pg.wait_for_selector('.meus-lista', timeout=10000); pg.wait_for_timeout(400)
            dias = pg.eval_on_selector_all('.meus-dia', 'els => els.map(e => e.innerText.trim())')
            checa(dias[:1] == ['Hoje'] and len(dias) == 3, f'{rot}: Meus lançamentos separado por dia, 7 dias ({dias})')
            checa('Últimos 7 dias' in pg.inner_text('#view'), f'{rot}: subtítulo "Últimos 7 dias"')
            mh = pg.locator('.meu', has_text='Mortalidade').first
            checa(mh.locator('a', has_text='Corrigir').count() == 1 and mh.locator('[data-pedir]').count() == 0, f'{rot}: lançado hoje: Corrigir direto (sem pedido)')
            rv = pg.locator('.meu', has_text='Ração').first
            checa(rv.locator('[data-pedir]').count() == 1 and rv.locator('a', has_text='Corrigir').count() == 0, f'{rot}: ração de 2 dias atrás: Pedir correção (sem Corrigir direto)')
            # a janela confere o valor
            rv.locator('[data-pedir]').click(); pg.wait_for_selector('.dialogo form', timeout=5000)
            checa(pg.input_value('.dialogo [name=quantidade_kg]') == '2500' and '2.500 kg' in pg.inner_text('.dialogo'), f'{rot}: janela já vem com o valor lançado (2500)')
            pg.screenshot(path=f'pedir_correcao_janela_{largura}.png')
            pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(200)
            checa('igual ao lançado' in pg.inner_text('.dialogo [data-erro]'), f'{rot}: valor igual ao lançado: pede para mudar')
            pg.fill('.dialogo [name=quantidade_kg]', '0'); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(200)
            checa('5.000' in pg.inner_text('.dialogo [data-erro]'), f'{rot}: zero kg: recusa')
            pg.fill('.dialogo [name=quantidade_kg]', '250'); pg.fill('.dialogo [name=detalhe]', 'era 250'); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(1500)
            env = [c for t, c in rpcs if t == 'pedir_correcao']
            checa(len(env) == 1 and env[0]['p_tabela'] == 'racao_consumo' and env[0]['p_registro'] == 'r-velho' and env[0]['p_acao'] == 'corrigir' and env[0]['p_campos'] == {'quantidade_kg': 250} and env[0]['p_motivo'] == 'Digitei o número errado: era 250',
                  f'{rot}: pedido enviado com o valor certo e o motivo ({env})')
            rv = pg.locator('.meu', has_text='Ração').first
            checa('Correção pedida' in rv.inner_text() and rv.locator('[data-cancelar-pedido]').count() == 1, f'{rot}: depois do pedido: "Correção pedida" e "Cancelar pedido"')
            pg.screenshot(path=f'pedir_correcao_meus_{largura}.png', full_page=True)
            checa(sem_rolagem(), f'{rot}: Meus lançamentos sem rolagem para o lado')
            # água: pedir para apagar (sem números)
            av = pg.locator('.meu', has_text='Água').first
            av.locator('[data-pedir]').click(); pg.wait_for_selector('.dialogo form', timeout=5000)
            pg.select_option('.dialogo [name=motivo]', 'duas'); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(1500)
            env = [c for t, c in rpcs if t == 'pedir_correcao']
            checa(len(env) == 2 and env[1]['p_acao'] == 'apagar' and env[1]['p_campos'] == {} and env[1]['p_motivo'] == 'Lancei duas vezes', f'{rot}: "Lancei duas vezes" pede para apagar ({env[1] if len(env) > 1 else env})')
            # cancelar o pedido da ração
            pg.locator('.meu', has_text='Ração').first.locator('[data-cancelar-pedido]').click(); pg.wait_for_selector('.dialogo [data-ok]', timeout=5000); pg.click('.dialogo [data-ok]'); pg.wait_for_timeout(1500)
            checa(any(t == 'cancelar_pedido_correcao' for t, c in rpcs) and pg.locator('.meu', has_text='Ração').first.locator('[data-pedir]').count() == 1 and 'Pedido cancelado' in pg.locator('.meu', has_text='Ração').first.inner_text(),
                  f'{rot}: cancelar o pedido (pode pedir de novo)')
            # recusado mostra a resposta
            pedidos[0]['status'] = 'recusado'; pedidos[0]['resposta'] = 'Conferi, estava certo'
            pg.goto(BASE + '#/mais'); pg.wait_for_timeout(300); pg.goto(BASE + '#/meus'); pg.wait_for_selector('.meus-lista', timeout=10000); pg.wait_for_timeout(400)
            av = pg.locator('.meu', has_text='Água').first.inner_text()
            checa('Correção recusada' in av and 'Conferi, estava certo' in av, f'{rot}: pedido recusado mostra a resposta ({av!r})')
            pg.goto(BASE + '#/pedidos'); pg.wait_for_timeout(1200)
            checa('#/meus' in pg.url, f'{rot}: funcionário não abre a tela de pedidos (vai para Meus lançamentos)')
        else:
            pg.wait_for_selector('.aviso-pedidos', timeout=10000)
            checa('2 pedidos de correção' in pg.inner_text('.aviso-pedidos'), f'{rot}: Hoje avisa "2 pedidos de correção"')
            pg.screenshot(path=f'pedir_correcao_hoje_{largura}.png')
            pg.click('.aviso-pedidos'); pg.wait_for_selector('.pedido', timeout=10000); pg.wait_for_timeout(300)
            c1 = pg.locator('.pedido', has_text='Ração').first.inner_text()
            checa('2.500 kg' in c1 and '250 kg (10 sacos)' in c1 and 'Digitei o número errado' in c1 and 'Zé' in c1, f'{rot}: pedido mostra lançado, certo, motivo e quem pediu ({c1!r})')
            checa(pg.locator('.pedido .riscado').count() == 2, f'{rot}: o valor lançado aparece riscado')
            pg.screenshot(path=f'pedir_correcao_pedidos_{largura}.png', full_page=True)
            checa(sem_rolagem(), f'{rot}: tela de pedidos sem rolagem para o lado')
            pg.locator('.pedido', has_text='Ração').first.locator('[data-aprovar]').click(); pg.wait_for_selector('.dialogo-resumo', timeout=5000)
            checa('250 kg (10 sacos)' in pg.inner_text('.dialogo-resumo'), f'{rot}: aprovar pede confirmação mostrando o valor novo')
            pg.click('.dialogo [data-ok]'); pg.wait_for_timeout(1500)
            ap = [c for t, c in rpcs if t == 'responder_correcao']
            checa(len(ap) == 1 and ap[0]['p_id'] == 'p1' and ap[0]['p_aprovar'] is True, f'{rot}: aprovar chama o banco ({ap})')
            checa(pg.locator('.pedido').count() == 1 and '1 pedido esperando' in pg.inner_text('#view') and '✓ Corrigido' in pg.inner_text('.pedidos-resp'), f'{rot}: aprovado sai da lista e vai para Respondidos')
            pg.locator('.pedido').first.locator('[data-recusar]').click(); pg.wait_for_selector('.dialogo form', timeout=5000)
            pg.fill('.dialogo [name=resposta]', 'Foi medido duas vezes mesmo'); pg.click('.dialogo button[type=submit]'); pg.wait_for_timeout(1500)
            ap = [c for t, c in rpcs if t == 'responder_correcao']
            checa(len(ap) == 2 and ap[1]['p_aprovar'] is False and ap[1]['p_resposta'] == 'Foi medido duas vezes mesmo', f'{rot}: recusar manda a resposta ({ap[-1]})')
            checa('Nenhum pedido esperando' in pg.inner_text('#view') and 'Correção recusada' in pg.inner_text('.pedidos-resp'), f'{rot}: sem pedidos abertos; recusado nos Respondidos')
            pg.goto(BASE + '#/mais'); pg.wait_for_timeout(600)
            checa(pg.locator('a[href="#/pedidos"]').count() == 1, f'{rot}: Fazenda tem "Pedidos de correção"')
            pg.goto(BASE + '#/meus'); pg.wait_for_selector('.ronda-protocolo', timeout=10000)
            checa(pg.locator('[data-pedir]').count() == 0, f'{rot}: dono não pede correção (corrige direto)')
        checa(not erros, f'{rot}: nenhum erro de JavaScript' + ('' if not erros else ': ' + ' | '.join(erros[:3])))
        b.close()

for papel in ['funcionario', 'dono']:
    for largura in [390, 1366]:
        rodar(papel, largura)
print('RESULTADO:', 'TUDO OK' if ok else 'COM FALHAS')

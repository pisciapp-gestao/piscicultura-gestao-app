# Transferência de peixes (sql/37, pedido do cliente piloto, 16/11/2026). Supabase SIMULADO.
# Caso real: o Samaúma (recria) manda 5.500 peixes para o Peixinho e 6.500 para o Piranha, todos de 900 g.
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
T8, T16, T9, T2 = ('33333333-3333-4333-8333-00000000000%d' % i for i in (8, 6, 9, 2))
L8, L2 = '44444444-4444-4444-8444-000000000008', '44444444-4444-4444-8444-000000000002'
ok = True
def checa(c, m):
    global ok
    print(('OK   ' if c else 'FALHA ') + m); ok = ok and c

TANQUES = [{'id': T8, 'nome': 'Tanque 8 - Samaúma', 'area_ha': 7.88}, {'id': T16, 'nome': 'Tanque 16 - Peixinho', 'area_ha': 2.15},
           {'id': T9, 'nome': 'Tanque 9 - Piranha', 'area_ha': 2.82}, {'id': T2, 'nome': 'Tanque 2 - 5.5', 'area_ha': 5.85}]
LOTES = [{'id': L8, 'tanque_id': T8, 'tipo': 'recria', 'especie': 'Tambaqui', 'data_entrada': '2025-05-02', 'quantidade_inicial': 115400, 'peso_inicial_kg': 11540, 'ativo': True},
         {'id': L2, 'tanque_id': T2, 'tipo': 'engorda', 'especie': 'Tambaqui', 'data_entrada': '2025-08-01', 'quantidade_inicial': 10000, 'peso_inicial_kg': 5000, 'ativo': True}]
RESUMO = [{'lote_id': L8, 'racao_kg': 100000, 'mortos': 1400, 'despescados': 0, 'transferidos': 12000, 'ultimo_peso_medio_kg': 0.9, 'ultima_biometria': '2025-11-27', 'ultima_racao': '2025-11-30'},
          {'lote_id': L2, 'racao_kg': 20000, 'mortos': 0, 'despescados': 0, 'transferidos': 0, 'ultimo_peso_medio_kg': 1.0, 'ultima_biometria': '2025-10-01', 'ultima_racao': '2025-11-30'}]
TRANSF = [{'id': 't1', 'grupo': 'g1', 'data': '2025-08-26', 'lote_origem': L8, 'lote_destino': 'outro', 'quantidade': 12000, 'peso_medio_kg': 0.264, 'racao_kg': 1250, 'criou_lote': True, 'encerrou_origem': False, 'registrado_por': U, 'criado_em': '2025-08-26T10:00:00Z'}]

def rodar(papel):
    errs = []; rpcs = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(**LANCAR); ctx = b.new_context(reduced_motion='reduce', viewport={'width': 390, 'height': 1000}); pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        perfil = {'id': U, 'nome': 'Victor', 'papel': papel, 'fazenda_id': F, 'ativo': True, 'fazendas': {'nome': 'São carlos'}}
        def rota(route, req):
            u = req.url
            if not u.startswith(SB): return route.continue_()
            path = urlparse(u).path; obj = 'object' in (req.headers.get('accept') or '')
            j = lambda o, st=200: route.fulfill(status=st, content_type='application/json', body=json.dumps(o))
            tab = path.split('/')[-1]
            if '/rpc/' in path:
                if tab == 'registrar_transferencia':
                    rpcs.append(json.loads(req.post_data or '{}')); return j(2)
                if tab == 'resumo_lotes': return j(RESUMO)
                return j([{'saldo_kg': 5000, 'consumo_7d_kg': 70}] if tab == 'saldo_racao' else False if tab == 'eh_admin' else None if tab in ('plano_atual', 'meu_suporte') else [])
            if req.method in ('POST', 'PATCH'): return j([], 201)
            if tab == 'usuarios': return j(perfil if obj else [perfil])
            if tab == 'tanques': return j(TANQUES)
            if tab == 'lotes':
                q = urlparse(u).query
                if 'id=eq.' + L8 in q: return j(dict(LOTES[0], tanques={'nome': 'Tanque 8 - Samaúma'}) if obj else [LOTES[0]])
                return j(LOTES)
            if tab == 'transferencias': return j(TRANSF)
            if tab == 'usuario_tanques': return j([{'usuario_id': U, 'tanque_id': t['id']} for t in TANQUES])
            if tab == 'fazendas': return j({'kg_saco': 25} if obj else [{'kg_saco': 25}])
            return j(None if obj else [])
        ctx.route('**/*', rota)
        s = {'access_token': 'x', 'refresh_token': 'y', 'token_type': 'bearer', 'expires_in': 2592000, 'expires_at': int(time.time()) + 2592000, 'user': {'id': U, 'aud': 'authenticated'}}
        pg.add_init_script(f"localStorage.setItem('splash', new Date().toDateString()); if (!localStorage.getItem('sb-ppvliseblxpsepmeknnl-auth-token')) localStorage.setItem('sb-ppvliseblxpsepmeknnl-auth-token', {json.dumps(json.dumps(s))});")

        pg.goto(BASE + f'#/lancar?tipo=racao&tanque={T8}'); pg.wait_for_selector('.seg button', timeout=20000); pg.wait_for_timeout(800)
        abas = [x.strip() for x in pg.locator('.seg > button').all_inner_texts()]
        if papel == 'funcionario':
            checa('Transferência' not in abas, f'funcionário não vê a aba Transferência ({abas})')
            b.close(); return errs
        checa('Transferência' in abas, f'dono/gerente vê a aba Transferência ({abas})')
        pg.click('.seg > button[data-tipo="transferencia"]'); pg.wait_for_selector('#tf', timeout=10000); pg.wait_for_timeout(400)
        de = pg.inner_text('.tf-de').replace('\xa0', ' ')
        checa('Samaúma' in de and '102.000 peixes' in de, f'sai do Samaúma com 115.400 − 1.400 mortos − 12.000 já transferidos = 102.000 ({de!r})')
        pg.click('#b-add'); pg.click(f'[data-tile="{T16}"]'); pg.wait_for_timeout(150)
        pg.fill('[data-qtd="0"]', '5500'); pg.fill('[data-g="0"]', '900'); pg.locator('[data-g="0"]').blur(); pg.wait_for_timeout(150)
        leva = pg.inner_text('.tf-dest .tf-leva').replace('\xa0', ' ')
        checa('começa um lote' in leva and '216 sacos' in leva, f'Peixinho vazio: começa lote novo e leva ≈ 216 sacos de custo = 100.000 kg × 5.500/102.000 ÷ 25 ({leva!r})')
        checa(pg.locator('[data-tipo="0"]').input_value() == 'engorda', 'recria → o lote novo já vem como Engorda')
        pg.click('#b-add'); pg.click(f'[data-tile="{T9}"]'); pg.wait_for_timeout(150)
        pg.fill('[data-qtd="1"]', '6500'); pg.fill('[data-g="1"]', '900'); pg.locator('[data-g="1"]').blur(); pg.wait_for_timeout(150)
        pg.click('#b-add'); pg.click(f'[data-tile="{T2}"]'); pg.wait_for_timeout(150)
        leva2 = pg.locator('.tf-dest').nth(2).inner_text().replace('\xa0', ' ')
        checa('Junta com os 10.000 peixes' in leva2, f'5.5 já tem peixe: avisa que junta ({leva2.splitlines()[-1]!r})')
        pg.click('[data-tirar="2"]'); pg.wait_for_timeout(150)
        saldo = pg.inner_text('.tf-saldo').replace('\xa0', ' ')
        checa('− 12.000' in saldo and '90.000 peixes' in saldo, f'confere: saem 12.000, ficam 90.000 ({saldo.splitlines()[-1]!r})')
        checa(not pg.locator('#tf-esvaziou').is_checked(), 'ainda sobra peixe: "esvaziou" vem desmarcado')
        pg.click('#b-salvar'); pg.wait_for_timeout(500)
        for _ in range(3):
            if not pg.locator('.dialogo [data-ok]').count(): break
            pg.click('.dialogo [data-ok]'); pg.wait_for_timeout(700)
        pg.wait_for_timeout(800)
        checa(len(rpcs) == 1, f'chama registrar_transferencia uma vez ({len(rpcs)})')
        if rpcs:
            r = rpcs[0]; d = r.get('p_destinos') or []
            checa(r.get('p_lote_origem') == L8 and r.get('p_esvaziou') is False and len(d) == 2, 'origem certa, sem esvaziar, 2 destinos')
            checa([(x['tanque_id'], x['quantidade'], x['peso_medio_kg'], x['tipo']) for x in d] == [(T16, 5500, 0.9, 'engorda'), (T9, 6500, 0.9, 'engorda')], f'5.500 e 6.500 peixes de 0,9 kg, lotes novos de engorda ({d})')
        checa(f'#/relatorio/{L8}' in pg.url, f'depois de salvar abre o relatório do Samaúma ({pg.url})')
        try: pg.wait_for_selector('.tf-lista', timeout=15000)
        except Exception: print('TELA:', pg.inner_text('#view')[:600]); print('ERROS', errs)
        rel = pg.inner_text('#view').replace('\xa0', ' ')
        checa('Peixes transferidos' in rel and '12.000' in rel, 'relatório: mostra os peixes transferidos')
        checa('Transferências' in rel and '→' in rel and 'levaram 50 sacos' in rel, 'relatório: a transferência aparece com o custo que foi junto (1.250 kg = 50 sacos)')
        checa(pg.locator('.tf-desfazer').count() == 1, 'dono/gerente vê "Desfazer esta transferência"')
        pg.screenshot(path='transferencia_relatorio.png', full_page=True)
        b.close()
    return errs

errs = rodar('gerente') + rodar('funcionario')
checa(not errs, 'nenhum erro de JavaScript' + ('' if not errs else ': ' + ' | '.join(errs[:3])))
print('RESULTADO:', 'TUDO OK' if ok else 'COM FALHAS')

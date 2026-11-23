# Transferência com SINAL FRACO (Supabase SIMULADO, que age como o banco: o mesmo grupo não grava duas vezes):
# 1) o banco grava, mas a resposta se perde  2) a tela diz que não dá para saber se chegou e oferece "Tentar de novo"
# 3) tentar de novo manda o MESMO grupo: o banco não grava outra vez e a tela avisa que já tinha sido salva
# 4) erro do banco (não de sinal) continua mostrando a mensagem do banco
# (testa o caso real de 16/11/2026: com um código novo a cada toque, a transferência entrava duas vezes)
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

def rodar(papel, modo):
    errs = []; rpcs = []; gravados = set()
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
                    corpo = json.loads(req.post_data or '{}'); rpcs.append(corpo)
                    if modo == 'banco-recusa': return j({'code': 'P0001', 'message': 'Este lote já foi encerrado'}, 400)
                    if corpo.get('p_grupo') in gravados: return j(0)          # como o sql/37: reenvio do mesmo grupo não grava
                    gravados.add(corpo.get('p_grupo'))
                    if len(rpcs) == 1: return route.abort('timedout')          # gravou, mas a resposta se perdeu
                    return j(2)
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
        def salvar():
            pg.click('#b-salvar'); pg.wait_for_timeout(500)
            for _ in range(3):
                if not pg.locator('.dialogo [data-ok]').count(): break
                pg.click('.dialogo [data-ok]'); pg.wait_for_timeout(700)
            pg.wait_for_timeout(900)
        salvar()
        if modo == 'banco-recusa':
            msg = pg.inner_text('#tf-erro') if pg.locator('#tf-erro').is_visible() else ''
            checa('Este lote já foi encerrado' in msg, f'erro do banco: mostra a mensagem do banco ({msg!r})')
            checa(pg.inner_text('#b-salvar') == 'Salvar transferência', 'erro do banco: o botão continua "Salvar transferência"')
            b.close(); return errs
        msg = pg.inner_text('#tf-erro') if pg.locator('#tf-erro').is_visible() else ''
        checa('não dá para saber se a transferência chegou' in msg, f'sinal caiu: avisa que não dá para saber se chegou ({msg[:70]!r})')
        checa(pg.inner_text('#b-salvar') == 'Tentar de novo', f'sinal caiu: o botão vira "Tentar de novo" ({pg.inner_text("#b-salvar")!r})')
        checa(len(gravados) == 1, 'o banco gravou a primeira tentativa (só a resposta se perdeu)')
        pg.evaluate("window.dispatchEvent(new Event('online'))"); pg.wait_for_timeout(600)  # o sinal volta
        salvar()
        grupos = [r.get('p_grupo') for r in rpcs]
        checa(len(rpcs) == 2 and len(set(grupos)) == 1, f'tentar de novo manda o MESMO grupo ({len(rpcs)} chamadas, {len(set(grupos))} grupo)')
        checa(len(gravados) == 1, f'a transferência foi gravada UMA vez ({len(gravados)})')
        toast = pg.inner_text('#toast')
        checa('já tinha sido salva' in toast, f'avisa que já tinha sido salva na tentativa anterior ({toast!r})')
        checa('#/relatorio/' in pg.url, 'vai para o relatório do lote para conferir')
        b.close(); return errs

for modo in ('sinal-fraco', 'banco-recusa'):
    erros = rodar('dono', modo)
    checa(not erros, f'{modo}: nenhum erro de JavaScript {erros[:2]}')
print('RESULTADO:', 'TUDO OK' if ok else 'COM FALHAS')

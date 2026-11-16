// Configuração do projeto Supabase.
// A chave "anon public" é pública por desenho (fica no navegador de qualquer jeito);
// quem protege os dados é o RLS no banco. NUNCA coloque aqui a chave "service_role".
//
// UM BANCO POR ENDEREÇO DO SITE: o banco atual é de TESTE e DEMONSTRAÇÃO. Quando os clientes tiverem
// um banco só deles (ver docs/INFRA.md), crie o projeto no Supabase, rode os sql/ e acrescente aqui
// o endereço do site dos clientes com a URL e a chave pública (publishable/anon) desse projeto novo.
// Endereço que não estiver na lista usa o "padrao" (testes, prévias da Vercel e localhost).
const AMBIENTES = {
  padrao: { nome: 'testes e demonstração', url: 'https://ppvliseblxpsepmeknnl.supabase.co', chave: 'sb_publishable_ckz6Ih2NnJ_xOb4i4_ea8w_uBGQyW3t' },
  // banco só dos clientes (projeto "Piscicultura Clientes", organização PisciApp no Supabase), criado em 11/11/2026
  'pisciapp-gestao.vercel.app': { nome: 'clientes', url: 'https://ljunnpmszkkgoqmtvxse.supabase.co', chave: 'sb_publishable_2KYZgELf4iFhLI40EB1Eog_S3-tNYHi' },
  // 'app.seudominio.com.br': { nome: 'clientes', url: 'https://XXXXXXXX.supabase.co', chave: 'sb_publishable_XXXXXXXX' },
};
export function ambienteDo(host) {
  return AMBIENTES[String(host || '').toLowerCase()] || AMBIENTES.padrao;
}
const AMBIENTE = ambienteDo(typeof location !== 'undefined' ? location.hostname : '');
export const AMBIENTE_NOME = AMBIENTE.nome;
export const SUPABASE_URL = AMBIENTE.url;
export const SUPABASE_ANON_KEY = AMBIENTE.chave;

// Peso padrão de um saco de ração (kg), usado ao registrar compras.
export const PESO_SACO_PADRAO_KG = 25;

// Avisos de estoque: dias de ração restantes (no ritmo dos últimos 7 dias).
export const ESTOQUE_ATENCAO_DIAS = 15;
export const ESTOQUE_CRITICO_DIAS = 7;
// Sugestão de compra: quanto comprar para o estoque durar este número de dias no ritmo atual.
export const ESTOQUE_COBERTURA_DIAS = 30;
// Lembrar de contar o estoque quando a última contagem tiver este número de dias (ou mais).
export const CONTAGEM_LEMBRETE_DIAS = 7;
// Avisar o dono quando faltar este número de dias (ou menos) para o teste/plano vencer.
export const PLANO_AVISO_DIAS = 7;

// Tempo máximo (ms) esperando o servidor antes de considerar "sem conexão".
export const TIMEOUT_REDE_MS = 15000; // envio de lançamentos e login
export const TIMEOUT_LEITURA_MS = 8000; // leitura de dados
export const LIMITE_ABERTURA_MS = 3000; // ao abrir, com dados guardados no aparelho, não espera a rede mais que isso
export const JANELA_SEM_REDE_MS = 30000; // depois de uma falha de rede, as telas não esperam pela rede nesse tempo (um teste de sinal à parte reabre tudo)

// Dias de teste grátis para fazendas novas (o valor que vale é o do banco; este é só o texto da tela).
export const TESTE_DIAS = 30;

// Espécies mais criadas (a última opção "Outra" deixa a pessoa digitar).
export const ESPECIES = ['Tambaqui', 'Tambacu', 'Tilápia', 'Matrinxã', 'Pirarucu', 'Pintado', 'Pacu', 'Curimatã', 'Carpa'];

// Causa provável da morte dos peixes: [rótulo, dica curta para quem está no tanque].
export const CAUSAS_MORTE = [
  ['Falta de oxigênio', 'peixes boquejando na superfície'],
  ['Temperatura', 'água muito quente ou muito fria'],
  ['Doença ou parasitas', 'manchas, feridas, nadando estranho'],
  ['Qualidade da água', 'água verde, suja ou com cheiro forte'],
  ['Predadores', 'aves, lontra, jacaré'],
  ['Manejo', 'despesca, transporte, estresse'],
];

// Termos de uso e política de privacidade (termos.html e privacidade.html).
// null = desligado: as páginas existem como MINUTA, mas o app não pede aceite nem mostra os links.
// Para ligar: preencha os dados da empresa nas duas páginas, revise com um advogado e coloque aqui a data
// da versão (ex.: '2026-11-01'). Quem já tem conta verá o pedido de aceite no próximo acesso;
// quem criar conta marca o aceite no cadastro. Mudou o texto? Troque a data: todos aceitam de novo.
export const TERMOS_VERSAO = null;

// Peso médio de despesca (kg por peixe) usado na previsão quando o lote não tem meta própria.
// É só um ponto de partida: cada lote pode ter a sua meta (tela do tanque > "Mudar meta").
export const ALVO_PADRAO_KG = { bercario: 0.005, alevinagem: 0.05, recria: 0.8, engorda: 2.5 };

// Avisos do tempo (sugestões de manejo; ajuste à realidade da fazenda)
export const CLIMA = {
  friagemMinC: 20,      // mínima abaixo disso: peixe tropical come menos
  quedaC: 4,            // mínima de amanhã cai isso ou mais em relação a hoje
  calorMaxC: 35,        // máxima acima disso: água quente, menos oxigênio
  chuvaForteMm: 30,     // chuva do dia acima disso
  validadeMin: 180,     // quanto tempo a previsão guardada vale antes de buscar de novo
};

// Alertas de manejo na Início (dono/gerente)
// Água do tambaqui: Tabela 1 da cartilha "Criação de tambaqui" (Embrapa Amazônia Oriental, 2018).
// Para as outras espécies não há faixa no app: mostra as medições, sem alerta.
export const AGUA_TAMBAQUI = { oxigenio: { min: 4, max: 8 }, temperatura: { min: 28, max: 30, letal: 18 }, ph: { min: 5, max: 7 }, amonia: { max: 0.46 } };
export const AGUA_LIMITES = { oxigenio: [0, 25], temperatura: [0, 50], ph: [0, 14], amonia: [0, 50] }; // valor possível de digitar
export const CATEGORIAS_DESPESA = [['energia', 'Energia'], ['mao_de_obra', 'Mão de obra'], ['probiotico', 'Probiótico'], ['manutencao', 'Manutenção'], ['combustivel', 'Combustível'], ['outros', 'Outros']];
export const ALERTAS = {
  biometriaDias: 30,     // lote sem pesagem há mais que isso: números estimados desatualizados
  racaoDesvio: 0.4,      // ração de hoje 40% abaixo ou acima da média do tanque na semana
  morteDiasSeguidos: 3,  // mortes no mesmo tanque por esse número de dias seguidos
};

// Tabela de alimentação do tambaqui em viveiro escavado, Roraima (26 a 32 °C), enviada pelo cliente piloto (16/11/2026).
// Uma linha por semana: [semana, peso inicial g, peso final g, % da biomassa por dia, ração, tratos por dia, kg na semana para 40.000 peixes].
// A tabela soma 230.886 kg em 52 semanas (conversão 1,6, sem mortalidade); na fazenda real deu 1,9 a 2,4.
export const TABELA_ALIMENTAR = [
  [1, 2, 5, 20, 'Inicial · 0,8 a 1,0 mm', 6, 112],
  [2, 5, 10, 10, 'Inicial · 1,3 a 1,8 mm', 6, 140],
  [3, 10, 18, 6.2, 'Inicial · 1,8 mm', 6, 174.2],
  [4, 18, 28, 5.6, '45% proteína · 2,6 mm', 4, 284.7],
  [5, 28, 40, 5.2, '45% proteína · 2,6 mm', 4, 408.2],
  [6, 40, 53, 4.8, '36% proteína · 2,6 mm', 4, 542.6],
  [7, 53, 66, 4.5, '36% proteína · 2,6 mm', 4, 673.5],
  [8, 66, 80, 4.3, '32% proteína · 4 mm', 4, 789.7],
  [9, 80, 100, 4, '32% proteína · 4 mm', 3, 904.8],
  [10, 100, 130, 3.8, '32% proteína · 4 mm', 3, 1072.4],
  [11, 130, 161, 3.6, '32% proteína · 6 mm', 3, 1325.2],
  [12, 161, 200, 3.5, '32% proteína · 6 mm', 3, 1563.4],
  [13, 200, 245, 3.3, '28% proteína · 6 mm', 2, 1853.1],
  [14, 245, 297, 3.2, '28% proteína · 6 mm', 2, 2169.1],
  [15, 297, 350, 3, '28% proteína · 6 mm', 2, 2515.6],
  [16, 350, 404, 2.9, '28% proteína · 6 mm', 2, 2838.9],
  [17, 404, 463, 2.8, '28% proteína · 6 mm', 2, 3140.7],
  [18, 463, 524, 2.7, '28% proteína · 6 mm', 2, 3452.3],
  [19, 524, 586, 2.6, '28% proteína · 6 mm', 2, 3749.6],
  [20, 586, 650, 2.5, '28% proteína · 6 mm', 2, 4026.2],
  [21, 650, 710, 2.4, '28% proteína · 6 mm', 2, 4289.6],
  [22, 710, 772, 2.3, '28% proteína · 6 mm', 2, 4501.9],
  [23, 772, 836, 2.2, '28% proteína · 6 mm', 2, 4704.2],
  [24, 836, 900, 2.1, '28% proteína · 6 mm', 2, 4896.4],
  [25, 900, 975, 2, '28% proteína · 10 mm', 2, 5067],
  [26, 975, 1050, 1.9, '28% proteína · 10 mm', 2, 5276.7],
  [27, 1050, 1125, 1.9, '28% proteína · 10 mm', 2, 5462.3],
  [28, 1125, 1200, 1.8, '28% proteína · 10 mm', 2, 5625],
  [29, 1200, 1287, 1.7, '28% proteína · 10 mm', 2, 5765.9],
  [30, 1287, 1375, 1.6, '28% proteína · 10 mm', 2, 5941.3],
  [31, 1375, 1462, 1.6, '28% proteína · 10 mm', 2, 6096.9],
  [32, 1462, 1550, 1.5, '28% proteína · 10 mm', 2, 6224.7],
  [33, 1550, 1637, 1.5, '28% proteína · 10 mm', 2, 6334.2],
  [34, 1637, 1725, 1.4, '28% proteína · 10 mm', 2, 6418],
  [35, 1725, 1812, 1.3, '28% proteína · 10 mm', 2, 6485],
  [36, 1812, 1900, 1.3, '28% proteína · 10 mm', 2, 6528.3],
  [37, 1900, 1987, 1.2, '28% proteína · 10 mm', 2, 6556],
  [38, 1987, 2075, 1.2, '28% proteína · 10 mm', 2, 6561.6],
  [39, 2075, 2162, 1.1, '28% proteína · 10 mm', 2, 6552.5],
  [40, 2162, 2250, 1.1, '28% proteína · 10 mm', 2, 6522.9],
  [41, 2250, 2362, 1, '28% proteína · 10 mm', 2, 6479.6],
  [42, 2362, 2475, 1, '28% proteína · 10 mm', 2, 6485.7],
  [43, 2475, 2587, 0.9, '28% proteína · 10 mm', 2, 6472.2],
  [44, 2587, 2700, 0.9, '28% proteína · 10 mm', 2, 6434.4],
  [45, 2700, 2800, 0.8, '28% proteína · 10 mm', 2, 6378.2],
  [46, 2800, 2900, 0.8, '28% proteína · 10 mm', 2, 6614.4],
  [47, 2900, 3000, 0.8, '28% proteína · 10 mm', 2, 6788.3],
  [48, 3000, 3100, 0.8, '28% proteína · 10 mm', 2, 7022.4],
  [49, 3100, 3200, 0.8, '28% proteína · 10 mm', 2, 7256.5],
  [50, 3200, 3300, 0.8, '28% proteína · 10 mm', 2, 7490.1],
  [51, 3300, 3400, 0.8, '28% proteína · 10 mm', 2, 7724.6],
  [52, 3400, 3600, 0.8, '28% proteína · 10 mm', 2, 8192.8],
];
export const TABELA_PEIXES = 40000;

// Sugestão de ração do dia: % do peso vivo (biomassa) pela faixa de peso médio da tabela de alimentação (acima de 3,6 kg, 0,8%)
export const TAXA_RACAO = [...TABELA_ALIMENTAR.map(([, , pf, pct]) => ({ ateKg: pf / 1000, pct })), { ateKg: Infinity, pct: 0.8 }];


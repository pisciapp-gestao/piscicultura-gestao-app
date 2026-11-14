// Botão de voltar único do app: toda tela que não é aba principal ganha um "‹ <de onde veio>" no topo.
// Guarda o caminho percorrido (pilha de rotas); voltar leva para a tela anterior de verdade.
// Aberta direto (link, recarregar), usa o destino padrão da tela.
import { icone } from './icons.js';
import { esc } from './util.js';

const PADRAO = {
  t: ['#/tanques', 'Tanques'], tanque: ['#/tanques', 'Tanques'], ronda: ['#/', 'Hoje'], lancar: ['#/', 'Hoje'], meus: ['#/', 'Hoje'], pedidos: ['#/', 'Hoje'], estoque: ['#/mais', 'Fazenda'],
  equipe: ['#/mais', 'Fazenda'], plano: ['#/mais', 'Fazenda'], historico: ['#/mais', 'Fazenda'], pendencias: ['#/mais', 'Fazenda'],
  admin: ['#/mais', 'Fazenda'], relatorio: ['#/relatorio', 'Relatórios'], lucro: ['#/relatorio', 'Relatórios'], despesas: ['#/lucro', 'Lucro por ciclo'],
};
const NOME = {
  '': 'Hoje', ronda: 'Ronda', lancar: 'Lançar', meus: 'Meus lançamentos', pedidos: 'Pedidos de correção', mais: 'Fazenda', fazenda: 'Fazenda', tanques: 'Tanques', tanque: 'Tanque', t: 'Tanque', estoque: 'Estoque',
  equipe: 'Equipe', plano: 'Meu plano', historico: 'Histórico', pendencias: 'Pendentes', admin: 'Administração', lucro: 'Lucro por ciclo', despesas: 'Despesas gerais',
};
const partesDe = (hash) => String(hash || '#/').replace(/^#\/?/, '').split('?')[0].split('/');
const nomeDe = (hash) => {
  const [rota, sub] = partesDe(hash);
  if (rota === 'relatorio') return !sub ? 'Relatórios' : sub === 'racao' ? 'Ração fornecida' : 'Relatório do lote';
  return NOME[rota] || 'Voltar';
};

// abas principais: não têm voltar e recomeçam o caminho
export const ehAbaPrincipal = (rota, partes) => rota === '' || rota === 'tanques' || rota === 'mais' || rota === 'fazenda' || (rota === 'relatorio' && !partes[0]);

let pilha = [];
let voltando = false;
export const marcarVoltando = () => { voltando = true; };
export function registrarRota(hash, rota, partes) {
  const h = hash || '#/';
  const foiVolta = voltando; voltando = false;
  if (ehAbaPrincipal(rota, partes)) pilha = [h];
  else if (foiVolta) {
    // clicou no voltar: sai da tela atual; se o destino era o padrão (não estava no caminho), ele vira o começo
    pilha.pop();
    if (pilha[pilha.length - 1] !== h) pilha = [h];
  } else if (pilha.length >= 2 && pilha[pilha.length - 2] === h) pilha.pop(); // voltou pelo botão do celular/navegador
  else if (pilha[pilha.length - 1] !== h) pilha.push(h);
  if (pilha.length > 30) pilha = pilha.slice(-30);
}

// para onde o voltar leva e com que nome (função pura, testada em testes/calc/teste_10mil.mjs)
export function destinoVoltar(rota) {
  const anterior = pilha.length >= 2 ? pilha[pilha.length - 2] : null;
  return anterior ? [anterior, nomeDe(anterior)] : (PADRAO[rota] || ['#/', 'Início']);
}
export const reiniciarPilha = () => { pilha = []; };

export function linhaVoltar(rota) {
  const [href, txt] = destinoVoltar(rota);
  const p = document.createElement('p');
  p.className = 'no-print linha-voltar';
  p.innerHTML = `<a class="voltar" href="${esc(href)}">${icone('voltar', 18)} ${esc(txt)}</a>`;
  p.querySelector('a').addEventListener('click', marcarVoltando);
  return p;
}

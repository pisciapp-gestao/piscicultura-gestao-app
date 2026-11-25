// Lê vários tanques/lotes colados de uma vez. Aceita dois formatos:
//  1) planilha (Excel colado, separado por tabulação ou ponto e vírgula), uma linha por tanque:
//     Tanque · Área (ha) · Fase · Peixes · Peso médio · Início do ciclo · Espécie (opcional)
//  2) mensagem de WhatsApp em blocos, como o produtor costuma mandar:
//     Tanque 1 / 5.5 hectares / Engorda / 12.000 peixes / 2.300 kg / Início do ciclo / 10/06/2026
// O peso é sempre o peso MÉDIO de cada peixe ("2.300 kg" = 2,3 kg; "500 g" = 0,5 kg).
import { hojeISO } from './util.js';

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// chave para achar o mesmo tanque: "Tanque 1", "tanque 01 · 5,5 ha" e "TANQUE 1" são o mesmo
export function chaveTanque(nome) {
  const s = semAcento(nome);
  const m = s.match(/^(tanque|viveiro|tq)\s*0*(\d+)/);
  return m ? `${m[1] === 'tq' ? 'tanque' : m[1]}-${m[2]}` : s.replace(/\s+/g, ' ');
}

export function fase(txt) {
  const s = semAcento(txt);
  if (!s) return null;
  if (/^berc/.test(s)) return 'bercario';
  if (/^alev/.test(s)) return 'alevinagem';
  if (/^recri/.test(s)) return 'recria';
  if (/^engord/.test(s)) return 'engorda';
  return undefined; // texto que não é fase
}

// "12.000" / "12000" / "12 000" -> 12000
const inteiro = (txt) => { const s = String(txt || '').replace(/[.\s]/g, '').replace(/,\d*$/, ''); return /^\d+$/.test(s) ? Number(s) : null; };
// "5,5" / "5.5" / "0.91" -> número
const decimal = (txt) => { const s = String(txt || '').trim().replace(',', '.'); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null; };

// peso médio por peixe em kg: "2.300 kg" -> 2,3 ; "500 g" -> 0,5 ; "1,8" -> 1,8 ; "1.800" -> 1,8
export function pesoMedio(txt) {
  const s = semAcento(txt).replace(/\s+/g, ' ');
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(kg|quilos?|g|gramas?|gr)?\.?$/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  if (!(v > 0)) return null;
  const un = m[2] || '';
  return /^g/.test(un) ? v / 1000 : v;
}

// "10/06/2026" -> "2026-06-10"
export function dataBR(txt) {
  const m = String(txt || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function validar(l, tanques, lotesAtivos) {
  const existe = tanques.find((t) => chaveTanque(t.nome) === chaveTanque(l.nome));
  l.existe = existe || null;
  if (!l.nome) return 'falta o nome do tanque.';
  if (l.areaTxt && !l.area) return `área "${l.areaTxt}" não entendida (use hectares, ex.: 5,5).`;
  const temLote = l.qtd || l.pmTxt || l.data || l.tipo;
  if (!temLote) return null; // só o tanque
  if (!l.tipo) return l.faseTxt ? `fase "${l.faseTxt}" não reconhecida (use Berçário, Alevinagem, Recria ou Engorda).` : 'falta a fase (Berçário, Alevinagem, Recria ou Engorda).';
  if (!l.qtd) return 'falta a quantidade de peixes.';
  if (!l.pm) return l.pmTxt ? `peso "${l.pmTxt}" não entendido (ex.: 2,3 kg ou 500 g).` : 'falta o peso médio de cada peixe.';
  if (l.pm > 30) return `peso médio de ${l.pm} kg por peixe parece o peso total. Informe o peso de UM peixe.`;
  if (!l.data) return 'falta a data de povoamento (dd/mm/aaaa).';
  if (l.data > hojeISO()) return 'a data de povoamento está no futuro.';
  if (existe && lotesAtivos.some((x) => x.tanque_id === existe.id)) return `"${existe.nome}" já tem lote ativo. Cadastre pela tela do tanque.`;
  return null;
}

function blocosWhatsApp(texto) {
  const linhas = texto.split(/\r?\n/).map((s) => s.replace(/\*/g, '').replace(/^\[[^\]]*\]\s*[^:]*:\s*/, '').trim()).filter(Boolean);
  const blocos = []; let b = null; let esperaData = false;
  for (const ln of linhas) {
    const s = semAcento(ln);
    if (/^(tanque|viveiro)\s*\d+/.test(s)) { b = { nome: ln.replace(/\s+/g, ' ').replace(/^(\w)/, (c) => c.toUpperCase()) }; blocos.push(b); esperaData = false; continue; }
    if (!b) continue;
    if (/\bsacos?\b|\bracao\b/.test(s)) { b = null; continue; } // mensagem passou a falar do estoque de ração
    const ha = s.match(/^(\d+(?:[.,]\d+)?)\s*(hectares?|ha)\b/);
    const px = s.match(/^([\d.\s]+)\s*peixes?\b/);
    const dt = dataBR(ln);
    if (ha) { b.areaTxt = ha[1]; }
    else if (px) { b.qtdTxt = px[1]; }
    else if (/inicio do ciclo|data de povoamento|povoad[oa] em/.test(s)) { if (dt) b.dataTxt = ln; else esperaData = true; }
    else if (dt && (esperaData || !b.dataTxt)) { b.dataTxt = ln; esperaData = false; }
    else if (fase(ln)) { if (!b.faseTxt) b.faseTxt = ln; }
    else if (pesoMedio(ln)) { b.pmTxt = ln; }
    else if (/falta povoar|vazio/.test(s)) { b.vazio = true; }
  }
  return blocos;
}

export function lerPlanilha(texto, tanques = [], lotesAtivos = []) {
  const bruto = String(texto || '');
  if (!bruto.trim()) return [];
  const tabular = /[\t;]/.test(bruto);
  let itens;
  if (tabular) {
    itens = bruto.split(/\r?\n/).map((ln, i) => ({ ln, n: i + 1 })).filter((x) => x.ln.trim())
      .map(({ ln, n }) => { const c = ln.split(/\t|;/).map((x) => x.trim()); return { n, nome: c[0], areaTxt: c[1], faseTxt: c[2], qtdTxt: c[3], pmTxt: c[4], dataTxt: c[5], especie: c[6] }; })
      .filter((x) => !/^(tanque|nome)$/i.test(semAcento(x.nome)) || x.qtdTxt && inteiro(x.qtdTxt)); // ignora a linha de títulos
  } else {
    itens = blocosWhatsApp(bruto).map((b, i) => ({ n: i + 1, ...b }));
  }
  return itens.map((x) => {
    const l = {
      n: x.n, nome: (x.nome || '').trim(), areaTxt: (x.areaTxt || '').trim(), area: decimal(x.areaTxt),
      faseTxt: (x.faseTxt || '').trim(), tipo: fase(x.faseTxt) || null,
      qtd: inteiro(x.qtdTxt), pmTxt: (x.pmTxt || '').trim(), pm: pesoMedio(x.pmTxt), data: dataBR(x.dataTxt),
      especie: (x.especie || '').trim() || 'Não informada',
    };
    if (l.area != null) l.area = Math.round(l.area * 100) / 100;
    if (!(l.area > 0)) l.area = null;
    l.erro = validar(l, tanques, lotesAtivos);
    return l;
  });
}

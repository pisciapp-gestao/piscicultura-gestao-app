// Balões que abrem e fecham (<details>: "Registrar compra", "Contar a ração", "Como lançar"...):
// ao abrir, o balão cresce até o tamanho do conteúdo e o conteúdo aparece; ao fechar, recolhe até sobrar só o título.
// Vale para todo <details> do app, presente ou futuro (um só ouvinte no documento). Pedido do Guilherme, 16/11/2026.
// Quem pediu menos movimento no celular abre e fecha na hora, como antes.
const DURACAO = 240;
const EASE = 'cubic-bezier(.23, 1, .32, 1)'; // o mesmo --ease do app.css

const semMovimento = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function animar(det, abrir) {
  const sum = det.querySelector(':scope > summary');
  if (!sum) return false;
  // interrompido no meio: parte da altura em que está agora
  const emCurso = det._sanfona;
  const altInicio = det.getBoundingClientRect().height;
  if (emCurso) { emCurso.cancel(); det._sanfona = null; }
  const conteudo = [...det.children].filter((c) => c !== sum);

  det.classList.toggle('fechando', !abrir); // a setinha já gira no começo de fechar
  if (abrir) det.open = true;
  const altFim = abrir ? det.scrollHeight : sum.getBoundingClientRect().height;
  det.style.overflow = 'hidden';
  const anim = det.animate({ height: [`${altInicio}px`, `${altFim}px`] }, { duration: DURACAO, easing: EASE });
  if (abrir) conteudo.forEach((c) => c.animate({ opacity: [0, 1], transform: ['translateY(-6px)', 'none'] }, { duration: DURACAO, easing: EASE }));
  det._sanfona = anim;
  anim.onfinish = () => {
    det._sanfona = null; det.style.overflow = ''; det.classList.remove('fechando');
    if (!abrir) det.open = false;
  };
  anim.oncancel = () => { det.style.overflow = ''; };
  return true;
}

export function iniciarSanfona() {
  if (iniciarSanfona.feito || !Element.prototype.animate) return; // sem o recurso: abre e fecha na hora
  iniciarSanfona.feito = true;
  document.addEventListener('click', (e) => {
    const sum = e.target.closest && e.target.closest('summary');
    if (!sum || e.defaultPrevented || semMovimento()) return;
    const det = sum.parentElement;
    if (!det || det.tagName !== 'DETAILS' || det.hasAttribute('data-sem-anim')) return;
    if (e.target.closest('a, button, input, select, label') && e.target.closest('a, button, input, select, label') !== sum) return; // botão dentro do título
    const abrir = det._sanfona ? det.classList.contains('fechando') : !det.open;
    if (animar(det, abrir)) e.preventDefault();
  });
}

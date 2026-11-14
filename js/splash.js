// Abertura: um tambaqui em 3D vem do fundo da água, chega perto e vira para o lado, revelando o app.
// Aparece só na primeira abertura do dia, dura ~3,5 s, some ao toque e não roda se o aparelho pede
// menos movimento. O 3D (Three.js, js/splash3d.bundle.js) só abre se já estiver no cache offline; senão, nesse dia
// fica sem abertura até o cache terminar. O peixe vetorial (SVG + CSS) abaixo é só para aparelho sem WebGL.

const TAMBAQUI = `
<svg class="tambaqui" viewBox="0 0 200 100" width="250" height="125" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="tb-corpo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2d3320"/><stop offset=".45" stop-color="#5c5a31"/>
      <stop offset=".72" stop-color="#b0733a"/><stop offset="1" stop-color="#cf5a30"/>
    </linearGradient>
    <linearGradient id="tb-nadadeira" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#cf5a30"/><stop offset="1" stop-color="#8f3a1f"/>
    </linearGradient>
  </defs>
  <g class="tb-corpo-todo">
    <g class="tb-cauda"><path d="M50 49 C40 40 26 22 6 8 C8 30 20 42 32 50 C20 58 8 70 6 92 C26 78 40 60 50 51 Z" fill="#3a3a22"/></g>
    <path d="M62 33 C66 27 74 24 82 26 C78 31 72 34 66 36 Z" fill="#3a3a22"/>
    <path d="M80 18 C90 -2 114 -3 128 14 C112 12 97 17 88 26 Z" fill="#2a2f1c"/>
    <path d="M44 50 C50 17 100 4 142 21 C168 31 182 44 186 53 C181 66 162 80 136 86 C98 98 54 82 44 50 Z" fill="url(#tb-corpo)"/>
    <path d="M60 40 C90 18 130 20 156 36" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="3" stroke-linecap="round"/>
    <path d="M139 26 C129 44 131 66 142 80" fill="none" stroke="#1d2114" stroke-opacity=".4" stroke-width="2" stroke-linecap="round"/>
    <path d="M84 84 C92 98 108 99 118 92 C108 90 98 87 92 81 Z" fill="url(#tb-nadadeira)"/>
    <g class="tb-peitoral"><path d="M142 66 C134 74 122 82 108 86 C124 90 142 82 150 70 Z" fill="url(#tb-nadadeira)"/></g>
    <circle cx="161" cy="45" r="5.6" fill="#f3efe0"/><circle cx="162.4" cy="45.5" r="3" fill="#16190f"/>
    <path d="M185 54 C181 58 176 58 171 56" fill="none" stroke="#1d2114" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>
  </g>
</svg>`;

export function splashDoDia() {
  try {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const hoje = new Date().toDateString();
    if (localStorage.getItem('splash') === hoje) return;
    localStorage.setItem('splash', hoje);
  } catch { return; }
  const el = document.createElement('div');
  el.className = 'splash s3d';
  document.body.appendChild(el);
  let saiu = false, parar = () => {};
  const sair = () => { if (saiu) return; saiu = true; parar(); el.classList.add('sai'); setTimeout(() => el.remove(), 320); };
  el.addEventListener('click', sair);
  abrir3d(el, sair, (f) => { parar = f; }).catch((e) => {
    if (saiu) return;
    if (e && e.message === 'lento') {
      // 3D ainda não está guardado no celular (1ª vez ou internet fraca): hoje não mostra nada
      // (nada do peixe antigo) e libera o dia, para o 3D aparecer na próxima abertura.
      saiu = true; parar(); el.remove();
      try { localStorage.removeItem('splash'); } catch { /* sem armazenamento */ }
      return;
    }
    fallbackSvg(el, sair); // só quando o aparelho não tem 3D (WebGL)
  });
}

// O 3D só abre na hora se a biblioteca e o peixe já estão no cache offline (o sw.js guarda ao instalar).
async function jaGuardado() {
  if (!('caches' in window)) return true;
  try {
    const arqs = ['js/splash3d.bundle.js', 'assets/peixe/peixe.bin', 'assets/peixe/cor.jpg', 'assets/peixe/normal.jpg'];
    return (await Promise.all(arqs.map((a) => caches.match(new URL(a, location.href).href)))).every(Boolean);
  } catch { return true; }
}

async function abrir3d(el, sair, registrarParada) {
  if (!(await jaGuardado())) throw new Error('lento');
  const tempo = new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 4000));
  // biblioteca 3D + modelo do peixe (malha e texturas); se passar de 4 s, hoje fica sem abertura
  const { mod, dados } = await Promise.race([(async () => { const m = await import('./splash3d.bundle.js'); return { mod: m, dados: await m.carregar('assets/peixe/') }; })(), tempo]);
  if (!el.isConnected) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'splash-canvas';
  const largura = el.clientWidth || innerWidth, altura = el.clientHeight || innerHeight;
  canvas.width = largura; canvas.height = altura;
  el.appendChild(canvas);
  const peixe = mod.criar(canvas, { largura, altura, dpr: window.devicePixelRatio || 1, lado: Math.random() < 0.5 ? 1 : -1, dados });
  let raf = 0, antes = performance.now();
  registrarParada(() => { cancelAnimationFrame(raf); try { peixe.destruir(); } catch { /* já liberado */ } });
  const quadro = (agora) => {
    const dt = Math.min(0.05, (agora - antes) / 1000); antes = agora;
    peixe.passo(dt); peixe.desenhar();
    el.style.opacity = String(peixe.fade());
    if (peixe.fim()) return sair();
    raf = requestAnimationFrame(quadro);
  };
  raf = requestAnimationFrame(quadro);
}

function fallbackSvg(el, sair) {
  el.classList.remove('s3d');
  el.innerHTML = `<span class="splash-agua"></span><span class="splash-bolha b1"></span><span class="splash-bolha b2"></span><span class="splash-bolha b3"></span><span class="splash-peixe"><span class="splash-balanco">${TAMBAQUI}</span></span>`;
  setTimeout(sair, 1800);
}

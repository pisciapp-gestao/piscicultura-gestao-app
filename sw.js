// Service worker: deixa o app abrir sem internet.
// EstratÃ©gia: rede primeiro (sempre pega a versÃ£o nova quando hÃ¡ sinal), com limite de 2,5 s;
// se a rede falhar ou demorar, usa a cÃ³pia guardada. RequisiÃ§Ãµes ao Supabase (outro domÃ­nio)
// NÃƒO passam por aqui: os dados offline ficam no IndexedDB (js/db.js), nÃ£o neste cache.
const CACHE = 'piscicultura-shell-v120';
const SHELL = [
  './',
  'index.html',
  'termos.html',
  'privacidade.html',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/supabase.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/inter-var.woff2', 'fonts/manrope-var.woff2', 'js/icons.js', 'js/graficos.js', 'js/clima.js', 'js/lateral.js', 'js/voltar.js', 'js/senha.js', 'js/views/despesca.js', 'js/views/tanque-detalhe.js', 'js/views/tempo.js', 'js/dialogo.js', 'js/splash.js', 'js/splash3d.bundle.js', 'assets/peixe/peixe.bin', 'assets/peixe/cor.jpg', 'assets/peixe/normal.jpg',
  'js/app.js', 'js/config.js', 'js/dev-login.js', 'js/seg.js', 'js/util.js', 'js/calc.js', 'js/db.js', 'js/sync.js', 'js/api.js', 'js/planilha.js',
  'js/views/login.js', 'js/views/home.js', 'js/views/dia.js', 'js/views/ronda.js', 'js/views/meus.js', 'js/views/lancar.js', 'js/teclado.js', 'js/desfazer.js', 'js/views/tanques.js',
  'js/pdf_lote.js', 'js/pdf_fazenda.js', 'js/pdf_racao.js', 'js/pdf_despesca.js', 'js/pdf_lucro.js', 'js/views/lucro.js', 'js/pagina_legal.js', 'js/pdf_ui.js', 'js/views/estoque.js', 'js/views/relatorio.js', 'js/views/equipe.js', 'js/views/pendencias.js', 'js/views/mais.js', 'js/views/cadastro.js', 'js/views/plano.js', 'js/views/historico.js', 'js/views/admin.js', 'js/financeiro.js', 'js/rascunho.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(redePrimeiro(req));
});

// Sinal morto: depois de uma falha, os próximos arquivos vêm direto da cópia guardada, sem esperar arquivo por arquivo.
const SEM_REDE_MS = 30000;
let semRedeAte = 0;

async function redePrimeiro(req) {
  const cache = await caches.open(CACHE);
  const guardado = async () => (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
  const copia = await guardado();
  if (copia && (!navigator.onLine || Date.now() < semRedeAte)) return copia;
  try {
    const resp = await Promise.race([
      fetch(req, { cache: 'no-cache' }), // sempre pergunta ao servidor se mudou (o cache do navegador podia entregar o .js velho)
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), copia ? 2500 : 20000)),
    ]);
    if (resp && resp.ok) cache.put(req, resp.clone());
    semRedeAte = 0;
    return resp;
  } catch (err) {
    semRedeAte = Date.now() + SEM_REDE_MS;
    if (copia) return copia;
    throw err;
  }
}

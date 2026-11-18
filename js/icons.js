// Ícones de linha (SVG inline, herdam a cor do texto).
const P = {
  inicio: '<path d="M4 11.2 12 4.5l8 6.7V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  lancar: '<path d="M12 5v14M5 12h14"/>',
  relatorio: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  baixar: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
  subir: '<path d="M12 16V5m0 0L8 9m4-4 4 4M5 19h14"/>',
  mais: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  tanque: '<ellipse cx="12" cy="6.5" rx="7" ry="2.7"/><path d="M5 6.5v11c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-11"/><path d="M5 12c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7"/>',
  estoque: '<path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2z"/><path d="M4 8.2 12 12.5l8-4.3M12 12.5V20"/>',
  equipe: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.4-3.3 2.6-5 5.5-5s5.1 1.7 5.5 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.7c2.4.1 3.8 1.6 4.2 4.3"/>',
  pendentes: '<path d="M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  direita: '<path d="m9.5 6 6 6-6 6"/>',
  voltar: '<path d="m14.5 6-6 6 6 6"/>',
  olho: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  olhoFechado: '<path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 5.4-1.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  admin: '<path d="M12 3.5 5 6.3v5.2c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6.3z"/><path d="m9.2 12.2 2 2 3.8-4"/>',
  historico: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/><path d="M12 8v4.5l3 1.8"/>',
  // telas novas (13/11/2026): Tanques, Fazenda e os botões grandes do tanque
  tanques: '<path d="M3 7c3 2 6 2 9 0s6-2 9 0M3 12c3 2 6 2 9 0s6-2 9 0M3 17c3 2 6 2 9 0s6-2 9 0"/>',
  fazenda: '<path d="M4 20V9l8-5 8 5v11M9 20v-6h6v6"/>',
  racao: '<path d="M7 3h10l-1 4H8zM6 7h12v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/><path d="M9 12h6"/>',
  morte: '<path d="M4 12c3-5 9-6 13-2l3-3v10l-3-3c-4 4-10 3-13-2z"/><path d="m8 10 2 2m0-2-2 2"/>',
  agua: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  peso: '<path d="M5 20h14l-2-11H7z"/><path d="M9 9a3 3 0 0 1 6 0"/>',
  probi: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
  despesca: '<path d="M3 13c4-6 12-6 16 0-4 6-12 6-16 0z"/><path d="m19 13 3-3v6z"/>',
  apagar: '<path d="M9 5h11v14H9l-6-7z"/><path d="m12.5 9.5 5 5M17.5 9.5l-5 5"/>',
  transferir: '<path d="M4 8h13"/><path d="m13 4 4 4-4 4"/><path d="M20 16H7"/><path d="m11 20-4-4 4-4"/>',
  desfazer: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  ajuste: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  peixe: '<g fill="currentColor" stroke="none"><path d="M1.4 4.6 7.2 12l-5.8 7.4L3.6 12z"/><rect x="8.2" y="9.5" width="2.4" height="5" rx="1.2"/><rect x="11.4" y="7" width="2.4" height="10" rx="1.2"/><rect x="14.6" y="5.5" width="2.4" height="13" rx="1.2"/><path fill-rule="evenodd" d="M17.8 9.7a1.2 1.2 0 0 1 2.4 0v4.6a1.2 1.2 0 0 1-2.4 0zM18.2 10.9a.8.8 0 1 0 1.6 0 .8.8 0 1 0-1.6 0z"/></g>',
};
export function icone(nome, tam = 24) {
  return `<svg class="ic" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[nome] || ''}</svg>`;
}

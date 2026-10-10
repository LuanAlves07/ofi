// Ícones de traço (24x24, desenhados para o OFI). Use: icon('home'), catIcon('Mercado').

const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  plus: 'M12 5v14M5 12h14',
  cart: 'M3 4h2l2.2 10.4a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L19.5 8H6.2M9 20h.01M17 20h.01',
  food: 'M7 3v7a2 2 0 0 0 2 2M11 3v7a2 2 0 0 1-2 2M9 3v18M17 21V3c-2 1-3 3.5-3 7h3',
  car: 'M4 16v-4l2-5h12l2 5v4zM4 16v3h3v-3M17 16v3h3v-3M7.5 12.5h.01M16.5 12.5h.01',
  building: 'M5 21V4h10v17M15 9h4v12M8 8h4M8 12h4M8 16h4M3 21h18',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  play: 'M3 5h18v12H3zM10 8.5l5 2.5-5 2.5zM8 21h8',
  ticket: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM10 7v10',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  book: 'M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM8 7h7',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  wallet: 'M4 7h15a1 1 0 0 1 1 1v11H5a1 1 0 0 1-1-1zM4 7l11-3v3M16 13h.01',
  incoming: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  repeat: 'M4 9h13l-3-3M20 15H7l3 3',
  calendar: 'M4 6h16v15H4zM4 10h16M9 3v4M15 3v4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  check: 'M5 12l5 5 9-10',
  cloud: 'M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18z',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  download: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
  upload: 'M12 15V3M7 8l5-5 5 5M4 17v3h16v-3',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h5',
  backspace: 'M8 5h12v14H8l-6-7zM12 9l5 6M17 9l-5 6',
  pen: 'M4 20h4L19 9l-4-4L4 16z',
  keypad: 'M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01',
  alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  chevron: 'M9 6l6 6-6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  up: 'M12 19V5M6 11l6-6 6 6',
  pause: 'M8 5v14M16 5v14',
  resume: 'M7 4l12 8-12 8z',
  x: 'M6 6l12 12M18 6 6 18',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  share: 'M12 3v12M7 8l5-5 5 5M5 12v8h14v-8',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
};

export const icon = (name, size = 20, cls = '') =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.box}"/></svg>`;

const CAT = {
  'Mercado': 'cart', 'Alimentação': 'food', 'Transporte': 'car', 'Moradia': 'building', 'Contas': 'bolt',
  'Saúde': 'heart', 'Assinaturas': 'play', 'Lazer': 'ticket', 'Compras': 'bag', 'Educação': 'book',
  'Dívidas': 'card', 'Outros': 'box', 'Salário': 'wallet', 'Outras receitas': 'incoming', 'Transferência (não conta)': 'repeat',
};

/** Ícone da categoria; categorias novas mostram a inicial. */
export const catIcon = (name, size = 20) =>
  CAT[name] ? icon(CAT[name], size) : `<span class="ic-letter" style="font-size:${Math.round(size * 0.7)}px">${String(name || '?').trim().charAt(0).toUpperCase()}</span>`;

// Utilidades gerais: dinheiro, datas, texto, ids.

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const norm = (s = '') =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmt = (v) => brl.format(Number(v) || 0);

// Converte "1.234,56", "1234.56", "R$ 85", "-45,9" em número.
export function parseMoney(str) {
  if (typeof str === 'number') return str;
  if (str == null) return NaN;
  let s = String(str).replace(/R\$|\s| /gi, '').trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s)) return NaN;
  if (s.includes(',')) {
    // formato brasileiro: ponto = milhar, vírgula = decimal
    if (s.lastIndexOf('.') > s.lastIndexOf(',')) s = s.replace(/,/g, ''); // 1,234.56
    else s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // 1.234 = mil duzentos e trinta e quatro
  }
  const n = parseFloat(s);
  return neg ? -n : n;
}

export const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());
export const monthKey = (iso) => iso.slice(0, 7);

// Aceita dd/mm/aaaa, dd/mm/aa, dd/mm, aaaa-mm-dd, aaaammdd.
export function parseDate(str, refYear = new Date().getFullYear()) {
  if (!str) return null;
  const s = String(str).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/))) {
    let y = m[3] ? Number(m[3]) : refYear;
    if (y < 100) y += 2000;
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

export const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MESES[m - 1].charAt(0).toUpperCase()}${MESES[m - 1].slice(1)} ${y}`;
};
export const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const daysInMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

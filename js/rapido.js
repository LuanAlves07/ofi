// Lançamento rápido: transforma texto livre em um lançamento.
// Exemplos:
//   "mercado 85,90"            -> despesa, hoje, Mercado
//   "uber 23,50 ontem"         -> despesa, ontem, Transporte
//   "+ salario 3500 05/10"     -> receita em 05/10
//   "tênis 600 em 6x"          -> 6 parcelas de 100 (uma por mês)
//   "presente 50 #Lazer"       -> força a categoria
import { parseMoney, parseDate, toISO, capitalize, norm } from './util.js';
import { categorize, DEFAULT_CATEGORIES } from './categorias.js';

const INCOME_WORDS = /^(recebi|receita|salario|entrada|ganhei|freela|freelance|pix recebido)\b/;

export function parseQuick(text, { userRules = [], categories, today = new Date() } = {}) {
  let s = ` ${String(text || '').trim()} `;
  if (!s.trim()) return { error: 'Digite algo como "mercado 85"' };

  let type = 'despesa';
  const t = s.trim();
  if (t.startsWith('+')) { type = 'receita'; s = s.replace('+', ' '); }
  else if (t.startsWith('-')) { s = s.replace('-', ' '); }

  // categoria forçada: #Lazer ou #"Outras receitas"
  let forced = null;
  s = s.replace(/#"([^"]+)"|#(\S+)/, (_, a, b) => { forced = a || b; return ' '; });

  // parcelas: "em 10x", "10x"
  let installments = 1;
  s = s.replace(/\s(?:em\s+)?(\d{1,2})\s*x(?=\s)/i, (_, n) => { installments = Math.max(1, Number(n)); return ' '; });

  // data
  let date = toISO(today);
  const d = new Date(today);
  s = s.replace(/\s(hoje|ontem|anteontem)(?=\s)/i, (_, w) => {
    const k = w.toLowerCase();
    if (k === 'ontem') d.setDate(d.getDate() - 1);
    if (k === 'anteontem') d.setDate(d.getDate() - 2);
    date = toISO(d);
    return ' ';
  });
  s = s.replace(/\s(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?=\s)/, (_, ds) => {
    const p = parseDate(ds, today.getFullYear());
    if (p) date = p;
    return ' ';
  });

  // valor: último número da frase
  const nums = [...s.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?=\s)/gi)];
  if (!nums.length) return { error: 'Não achei o valor. Ex.: "mercado 85,90"' };
  const last = nums[nums.length - 1];
  const amount = Math.abs(parseMoney(last[1]));
  s = s.slice(0, last.index) + ' ' + s.slice(last.index + last[0].length);

  let desc = s.replace(/\s+/g, ' ').replace(/^(de|no|na|em)\s/i, '').trim();
  if (!desc) desc = type === 'receita' ? 'Receita' : 'Gasto';
  if (type === 'despesa' && INCOME_WORDS.test(norm(desc))) type = 'receita';

  let category = null;
  if (forced) {
    const f = norm(forced);
    category = (categories || DEFAULT_CATEGORIES).find((c) => norm(c.name) === f || norm(c.name).startsWith(f))?.name || null;
  }
  if (!category) category = categorize(desc, type, userRules, categories);

  return { date, desc: capitalize(desc), amount, type, category, installments };
}

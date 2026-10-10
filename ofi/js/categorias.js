// Categorias padrão e categorização automática por palavras-chave.
import { norm } from './util.js';

export const IGNORAR = 'Transferência (não conta)';

export const DEFAULT_CATEGORIES = [
  { name: 'Mercado', emoji: '🛒', limit: 0 },
  { name: 'Alimentação', emoji: '🍔', limit: 0 },
  { name: 'Transporte', emoji: '🚗', limit: 0 },
  { name: 'Moradia', emoji: '🏠', limit: 0 },
  { name: 'Contas', emoji: '💡', limit: 0 },
  { name: 'Saúde', emoji: '💊', limit: 0 },
  { name: 'Assinaturas', emoji: '📺', limit: 0 },
  { name: 'Lazer', emoji: '🎉', limit: 0 },
  { name: 'Compras', emoji: '🛍️', limit: 0 },
  { name: 'Educação', emoji: '📚', limit: 0 },
  { name: 'Dívidas', emoji: '💳', limit: 0 },
  { name: 'Outros', emoji: '📦', limit: 0 },
  { name: 'Salário', emoji: '💰', limit: 0, income: true },
  { name: 'Outras receitas', emoji: '💵', limit: 0, income: true },
  { name: IGNORAR, emoji: '🔄', limit: 0, ignore: true },
];

// A ordem importa: a primeira regra que bater vence.
const BUILTIN = [
  [IGNORAR, 'valor adicionado na conta por cartao|transferencia entre contas proprias|pagamento de fatura|pagamento fatura|pgto fatura|pag fatura|pagamento recebido|transferencia entre contas|aplicacao|resgate|rdb|cdb'],
  ['Dívidas', 'multa de atraso|juros de atraso|juros de divida|juros limite|juros excesso|iof de atraso|iof complementar|emprestimo|parcela emprestimo|acordo|financiamento|consignado|juros|iof|serasa|renegociacao'],
  ['Salário', 'salario|pagamento recebido salario|folha|adiantamento salarial|pro labore|freela|freelance|rendimento'],
  ['Compras', 'shopee|mercado livre|mercadolivre|mercadopago|amazon|magalu|magazine luiza|americanas|shein|aliexpress|casas bahia|renner|riachuelo|c&a|centauro|netshoes|kabum|loja'],
  ['Mercado', 'mercadinho|mercearia|minimercado|minimercado|emporio|adega|mercado|supermercado|supermerc|atacadao|atacado|assai|carrefour|pao de acucar|extra|hortifruti|sacolao|acougue'],
  ['Alimentação', 'ifood|restaurante|lanchonete|lanche|padaria|pizza|pizzaria|burger|hamburguer|mc donalds|mcdonalds|bk|burger king|subway|almoco|jantar|cafe|cafeteria|rappi|acai|sorvete|marmita|bar e restaurante'],
  ['Transporte', 'uber|99|99app|99pop|cabify|gasolina|combustivel|posto|shell|ipiranga|petrobras|br mania|onibus|metro|bilhete unico|estacionamento|pedagio|sem parar|veloe|conectcar|oficina|mecanico'],
  ['Moradia', 'aluguel|condominio|iptu|imobiliaria'],
  ['Contas', 'luz|energia|enel|cemig|copel|light|celpe|coelba|agua|sabesp|copasa|sanepar|internet|vivo|claro|tim|oi|net|gas|comgas|celular|telefone'],
  ['Saúde', 'farmacia|drogaria|droga raia|drogasil|pague menos|medico|consulta|exame|laboratorio|plano de saude|unimed|amil|hapvida|dentista|odonto|academia|smartfit|smart fit'],
  ['Assinaturas', 'netflix|spotify|prime video|amazon prime|disney|hbo|max|globoplay|youtube|apple|icloud|google one|google storage|chatgpt|openai|claude|anthropic|deezer|crunchyroll|assinatura|mensalidade'],
  ['Lazer', 'cinema|ingresso|show|bar|balada|viagem|hotel|airbnb|steam|playstation|psn|xbox|nintendo|parque'],
  ['Educação', 'curso|faculdade|universidade|escola|livro|livraria|udemy|alura|rocketseat|material escolar'],
];

const compile = (pattern) =>
  new RegExp(`(^|[^a-z0-9])(${pattern.split('|').map((k) =>
    norm(k).replace(/[.*+?^${}()[\]\\]/g, '\\$&')).join('|')})($|[^a-z0-9])`);

const BUILTIN_RX = BUILTIN.map(([cat, p]) => [cat, compile(p)]);

/**
 * Define a categoria de uma descrição.
 * userRules: [{ match: 'texto normalizado', category }] — aprendidas quando você corrige uma categoria.
 */
export function categorize(desc, type, userRules = [], categories = DEFAULT_CATEGORIES) {
  const n = norm(desc);
  const valid = new Set(categories.map((c) => c.name));
  for (const r of userRules) {
    if (r.match && n.includes(r.match) && valid.has(r.category)) return r.category;
  }
  for (const [cat, rx] of BUILTIN_RX) {
    if (!valid.has(cat)) continue;
    if (rx.test(n)) {
      const isIncomeCat = categories.find((c) => c.name === cat)?.income;
      // não colocar despesa em categoria de receita (e vice-versa), exceto "não conta"
      if (cat === IGNORAR) return cat;
      if (type === 'receita' && !isIncomeCat) continue;
      if (type === 'despesa' && isIncomeCat) continue;
      return cat;
    }
  }
  return type === 'receita' ? 'Outras receitas' : 'Outros';
}

// "Pix enviado 12345 Mercado do Zé 08/10" -> "pix enviado mercado do ze"
export function ruleKey(desc) {
  return norm(desc)
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[*#\-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const emojiOf = (name, categories = DEFAULT_CATEGORIES) =>
  categories.find((c) => c.name === name)?.emoji || DEFAULT_CATEGORIES.find((c) => c.name === name)?.emoji || '🏷️';

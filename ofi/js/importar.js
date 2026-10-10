// Importação de extratos: OFX (qualquer banco) e CSV (Nubank, Inter, Itaú, C6, genérico).
import { parseMoney, parseDate, norm, capitalize } from './util.js';
import { categorize } from './categorias.js';

export function parseStatement(text, { cardMode = null, userRules = [], categories } = {}) {
  const raw = String(text || '').replace(/^﻿/, '');
  const isOFX = /<OFX>|OFXHEADER/i.test(raw);
  const res = isOFX ? parseOFX(raw) : parseCSV(raw);
  // Fatura de cartão em CSV costuma vir com compras POSITIVAS -> inverter.
  const invert = cardMode ?? res.looksLikeCard;
  const items = res.rows
    .filter((r) => r.date && Number.isFinite(r.amount) && r.amount !== 0)
    .map((r) => {
      const signed = invert ? -r.amount : r.amount;
      const type = signed < 0 ? 'despesa' : 'receita';
      const desc = capitalize(r.desc.replace(/\s+/g, ' ').trim()) || '(sem descrição)';
      return {
        date: r.date,
        desc,
        amount: Math.abs(signed),
        type,
        category: categorize(desc, type, userRules, categories),
        importKey: r.fitid ? `ofx:${r.fitid}` : `${r.date}|${signed.toFixed(2)}|${norm(desc)}`,
      };
    });
  return { format: isOFX ? 'OFX' : 'CSV', looksLikeCard: !!res.looksLikeCard, items, columns: res.columns };
}

// ---------- OFX ----------
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
}

export function parseOFX(text) {
  const rows = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const body = b.split(/<\/STMTTRN>/i)[0];
    const memo = tag(body, 'MEMO');
    const name = tag(body, 'NAME');
    rows.push({
      date: parseDate(tag(body, 'DTPOSTED')),
      amount: parseMoney(tag(body, 'TRNAMT')),
      desc: decodeEntities(memo && name && !memo.includes(name) ? `${name} ${memo}` : memo || name),
      fitid: tag(body, 'FITID'),
    });
  }
  return { rows, looksLikeCard: false, columns: null };
}

const decodeEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// ---------- CSV ----------
export function splitCSVLine(line, delim) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function detectDelim(lines) {
  const sample = lines.slice(0, 10).join('\n');
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let q = false;
  for (const c of sample) {
    if (c === '"') q = !q;
    else if (!q && c in counts) counts[c]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

const H_DATE = /^(data|date|dt|data lancamento|data de lancamento|data da compra|data movimento|data mov)/;
const H_AMOUNT = /^(valor|amount|quantia|valor \(r\$\)|valor r\$|vlr|montante)/;
const H_CREDIT = /^(credito|entrada|entradas)/;
const H_DEBIT = /^(debito|saida|saidas)/;
const H_DESC = /(descricao|title|historico|estabelecimento|lancamento|memo|detalhe|identificacao|nome)/;

export function parseCSV(text) {
  let lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], columns: null };
  const delim = detectDelim(lines);
  let table = lines.map((l) => splitCSVLine(l, delim));

  // acha a linha de cabeçalho (alguns bancos colocam informações antes)
  let hIdx = table.findIndex((r) => r.some((c) => H_DATE.test(norm(c))) && r.some((c) => H_AMOUNT.test(norm(c)) || H_DEBIT.test(norm(c))));
  let header = hIdx >= 0 ? table[hIdx].map(norm) : null;
  const data = hIdx >= 0 ? table.slice(hIdx + 1) : table;

  let iDate = -1, iAmt = -1, iCred = -1, iDeb = -1, iDesc = [];
  if (header) {
    header.forEach((h, i) => {
      if (iDate < 0 && H_DATE.test(h)) iDate = i;
      else if (iAmt < 0 && H_AMOUNT.test(h) && !/saldo/.test(h)) iAmt = i;
      else if (iCred < 0 && H_CREDIT.test(h)) iCred = i;
      else if (iDeb < 0 && H_DEBIT.test(h)) iDeb = i;
      else if (H_DESC.test(h) && !/saldo|identificador/.test(h)) iDesc.push(i);
    });
  }
  // sem cabeçalho reconhecível: adivinha pelo conteúdo
  if (iDate < 0 || (iAmt < 0 && iDeb < 0)) {
    const sample = data.slice(0, 20);
    const ncols = Math.max(...sample.map((r) => r.length));
    const score = (fn) => [...Array(ncols).keys()].map((i) => sample.filter((r) => fn(r[i] ?? '')).length);
    const dateScore = score((v) => !!parseDate(v) && /\d/.test(v) && /[/\-]/.test(v) || /^\d{8}$/.test(v));
    iDate = dateScore.indexOf(Math.max(...dateScore));
    const numScore = score((v) => /\d/.test(v) && Number.isFinite(parseMoney(v)) && !parseDate(v));
    numScore[iDate] = -1;
    iAmt = numScore.indexOf(Math.max(...numScore));
    const lenScore = [...Array(ncols).keys()].map((i) =>
      i === iDate || i === iAmt ? -1 : sample.reduce((a, r) => a + ((r[i] || '').replace(/[\d.,\-\s]/g, '').length), 0));
    iDesc = [lenScore.indexOf(Math.max(...lenScore))];
  }

  const rows = data.map((r) => {
    let amount;
    if (iAmt >= 0) amount = parseMoney(r[iAmt]);
    else {
      const c = parseMoney(r[iCred] || '0') || 0;
      const d = parseMoney(r[iDeb] || '0') || 0;
      amount = c - Math.abs(d);
    }
    return {
      date: parseDate(r[iDate]),
      amount,
      desc: iDesc.map((i) => r[i]).filter(Boolean).join(' - '),
    };
  });

  // Nubank cartão: "date,title,amount" (compras positivas)
  const looksLikeCard = !!header && header.includes('title') && header.includes('amount');
  return { rows, looksLikeCard, columns: { iDate, iAmt, iDesc, header } };
}

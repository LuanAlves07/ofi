import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parseDate } from '../js/util.js';
import { parseQuick } from '../js/rapido.js';
import { parseStatement } from '../js/importar.js';
import { simulate, budgetForMonths } from '../js/dividas.js';
import { categorize } from '../js/categorias.js';
import { merge, emptyData, b64encode, b64decode } from '../js/armazenamento.js';

const today = new Date(2026, 9, 8);

test('parseMoney', () => {
  assert.equal(parseMoney('1.234,56'), 1234.56);
  assert.equal(parseMoney('R$ 85'), 85);
  assert.equal(parseMoney('-45,9'), -45.9);
  assert.equal(parseMoney('1234.56'), 1234.56);
  assert.equal(parseMoney('1.234'), 1234);
  assert.equal(parseMoney('(10,00)'), -10);
  assert.equal(parseMoney('1,234.56'), 1234.56);
});

test('parseDate', () => {
  assert.equal(parseDate('05/10/2026'), '2026-10-05');
  assert.equal(parseDate('5/1/26'), '2026-01-05');
  assert.equal(parseDate('20261005120000[-3:BRT]'), '2026-10-05');
  assert.equal(parseDate('2026-10-05'), '2026-10-05');
});

test('lançamento rápido', () => {
  let r = parseQuick('mercado 85,90', { today });
  assert.deepEqual([r.desc, r.amount, r.type, r.category, r.date], ['Mercado', 85.9, 'despesa', 'Mercado', '2026-10-08']);
  r = parseQuick('uber 23,50 ontem', { today });
  assert.deepEqual([r.desc, r.amount, r.category, r.date], ['Uber', 23.5, 'Transporte', '2026-10-07']);
  r = parseQuick('+ salário 3.500 05/10', { today });
  assert.deepEqual([r.type, r.amount, r.category, r.date], ['receita', 3500, 'Salário', '2026-10-05']);
  r = parseQuick('tênis 600 em 6x', { today });
  assert.deepEqual([r.desc, r.amount, r.installments], ['Tênis', 600, 6]);
  r = parseQuick('presente mãe 50 #lazer', { today });
  assert.equal(r.category, 'Lazer');
  r = parseQuick('ifood 42', { today });
  assert.equal(r.category, 'Alimentação');
  r = parseQuick('recebi freela 800', { today });
  assert.equal(r.type, 'receita');
  r = parseQuick('99 pop 18', { today });
  assert.deepEqual([r.amount, r.category], [18, 'Transporte']);
  assert.ok(parseQuick('mercado', { today }).error);
});

test('categorias', () => {
  assert.equal(categorize('Netflix.com', 'despesa'), 'Assinaturas');
  assert.equal(categorize('Mercado Livre', 'despesa'), 'Compras');
  assert.equal(categorize('Pagamento de fatura', 'despesa'), 'Transferência (não conta)');
  assert.equal(categorize('Posto Shell', 'despesa'), 'Transporte');
  assert.equal(categorize('Coisa aleatoria', 'despesa'), 'Outros');
  assert.equal(categorize('Padaria do ze', 'despesa', [{ match: 'padaria do ze', category: 'Mercado' }]), 'Mercado');
});

test('CSV Nubank conta', () => {
  const csv = `Data,Valor,Identificador,Descrição
01/10/2026,-150.00,abc,Compra no débito - Supermercado Dia
02/10/2026,3500.00,def,Transferência recebida pelo Pix - EMPRESA LTDA
03/10/2026,-89.90,ghi,"Compra no débito - Netflix, Inc"`;
  const r = parseStatement(csv);
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items.map((i) => [i.type, i.amount]), [['despesa', 150], ['receita', 3500], ['despesa', 89.9]]);
  assert.equal(r.items[0].category, 'Mercado');
  assert.equal(r.items[2].category, 'Assinaturas');
});

test('CSV Nubank cartão (compras positivas)', () => {
  const csv = `date,title,amount
2026-09-10,Ifood *Restaurante,45.90
2026-09-12,Uber *Trip,22.10
2026-09-15,Pagamento recebido,-500.00`;
  const r = parseStatement(csv);
  assert.equal(r.looksLikeCard, true);
  assert.deepEqual(r.items.map((i) => [i.type, i.amount, i.category]), [
    ['despesa', 45.9, 'Alimentação'], ['despesa', 22.1, 'Transporte'], ['receita', 500, 'Transferência (não conta)']]);
});

test('CSV Inter com ponto e vírgula e cabeçalho extra', () => {
  const csv = `Extrato Conta Corrente
Conta ;12345
Período ;01/10/2026 a 08/10/2026

Data Lançamento;Histórico;Descrição;Valor;Saldo
01/10/2026;Pix enviado ;Joao Silva;-1.200,00;2.300,00
02/10/2026;Compra no debito;POSTO IPIRANGA;-180,50;2.119,50`;
  const r = parseStatement(csv);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].amount, 1200);
  assert.equal(r.items[1].category, 'Transporte');
  assert.match(r.items[0].desc, /Pix enviado - Joao Silva/);
});

test('CSV sem cabeçalho', () => {
  const csv = `05/10/2026;PADARIA CENTRAL;-12,50
06/10/2026;SALARIO;3000,00`;
  const r = parseStatement(csv);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].desc, 'PADARIA CENTRAL');
  assert.equal(r.items[1].type, 'receita');
});

test('CSV com colunas de débito e crédito separadas', () => {
  const csv = `Data;Descrição;Crédito;Débito
05/10/2026;Farmacia Pague Menos;;35,00
06/10/2026;Salario;2500,00;`;
  const r = parseStatement(csv);
  assert.deepEqual(r.items.map((i) => [i.type, i.amount]), [['despesa', 35], ['receita', 2500]]);
});

test('OFX', () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261003000000[-3:BRT]
<TRNAMT>-59.90
<FITID>111
<MEMO>DROGASIL 123
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>2800.00<FITID>112<MEMO>SALARIO EMPRESA</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const r = parseStatement(ofx);
  assert.equal(r.format, 'OFX');
  assert.deepEqual(r.items.map((i) => [i.date, i.type, i.amount, i.category, i.importKey]), [
    ['2026-10-03', 'despesa', 59.9, 'Saúde', 'ofx:111'], ['2026-10-05', 'receita', 2800, 'Salário', 'ofx:112']]);
});

test('simulador: avalanche paga menos juros que bola de neve', () => {
  const debts = [
    { id: 'a', name: 'Cartão', balance: 3000, rate: 14, minPayment: 300 },
    { id: 'b', name: 'Empréstimo', balance: 8000, rate: 4, minPayment: 400 },
    { id: 'c', name: 'Loja', balance: 600, rate: 6, minPayment: 100 },
  ];
  const av = simulate(debts, 1200, 'avalanche');
  const sn = simulate(debts, 1200, 'snowball');
  assert.ok(av.feasible && sn.feasible);
  assert.ok(av.totalInterest <= sn.totalInterest, `${av.totalInterest} <= ${sn.totalInterest}`);
  assert.equal(av.focusOrder[0], 'a');
  assert.equal(sn.focusOrder[0], 'c');
  assert.equal(av.series.at(-1), 0);
  // pagamento do 1º mês soma o orçamento
  assert.ok(Math.abs(av.firstMonth.reduce((s, x) => s + x.pay, 0) - 1200) < 0.01);
  console.log('avalanche', av.months, 'meses', av.totalInterest, '| snowball', sn.months, sn.totalInterest);
});

test('simulador: inviável', () => {
  const debts = [{ id: 'a', name: 'Rotativo', balance: 10000, rate: 15, minPayment: 500 }];
  assert.equal(simulate(debts, 400).reason, 'budget');
  assert.equal(simulate(debts, 1000).reason, 'juros');
  const b = budgetForMonths(debts, 12);
  const r = simulate(debts, b);
  assert.ok(r.feasible && r.months <= 12, JSON.stringify([b, r.months]));
});

test('merge entre dispositivos', () => {
  const base = emptyData();
  const a = structuredClone(base), b = structuredClone(base);
  a.transactions.push({ id: '1', desc: 'A', updatedAt: 10 });
  b.transactions.push({ id: '2', desc: 'B', updatedAt: 11 });
  b.transactions.push({ id: '3', desc: 'velho', updatedAt: 5 });
  a.deleted['3'] = 12;
  const m = merge(a, b);
  assert.deepEqual(m.transactions.map((t) => t.id).sort(), ['1', '2']);
  const c = structuredClone(m); c.transactions[0].desc = 'novo'; c.transactions[0].updatedAt = 99;
  assert.equal(merge(c, m).transactions.find((t) => t.id === c.transactions[0].id).desc, 'novo');
});

test('base64 utf-8', () => {
  const s = 'Alimentação ção 🎉 R$ 1.234,56';
  assert.equal(b64decode(b64encode(s)), s);
});

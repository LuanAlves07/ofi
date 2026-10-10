// Simulador de quitação de dívidas (avalanche x bola de neve).
//
// debt: { id, name, balance, rate (% ao mês), minPayment }
// budget: quanto você consegue pagar por mês no TOTAL (mínimos + extra).
//
// Avalanche: o extra vai para a dívida com MAIOR juros (paga menos juros no total).
// Bola de neve: o extra vai para a MENOR dívida (vitórias rápidas, motivação).
// Quando uma dívida acaba, a parcela dela é somada ao ataque da próxima.

const MAX_MONTHS = 600;

export function simulate(debts, budget, strategy = 'avalanche') {
  const ds = debts
    .filter((d) => d.balance > 0.005)
    .map((d) => ({ id: d.id, name: d.name, bal: +d.balance, rate: (+d.rate || 0) / 100, min: +d.minPayment || 0, interest: 0, paidOffMonth: null }));
  const minSum = ds.reduce((a, d) => a + d.min, 0);
  const result = { strategy, budget, minSum, feasible: true, months: 0, totalInterest: 0, totalPaid: 0, order: [], series: [sumBal(ds)], firstMonth: [] };
  if (!ds.length) return result;
  if (budget < minSum - 0.005) { result.feasible = false; result.reason = 'budget'; return result; }

  const pick = strategy === 'snowball'
    ? (a, b) => a.bal - b.bal || b.rate - a.rate
    : (a, b) => b.rate - a.rate || a.bal - b.bal;

  let growing = 0;
  for (let m = 1; m <= MAX_MONTHS; m++) {
    const before = sumBal(ds);
    for (const d of ds) if (d.bal > 0) { const j = d.bal * d.rate; d.bal += j; d.interest += j; }
    let left = budget;
    const paidNow = {};
    // 1) mínimos
    for (const d of ds) if (d.bal > 0) {
      const p = Math.min(d.min, d.bal, left);
      d.bal -= p; left -= p; paidNow[d.id] = (paidNow[d.id] || 0) + p;
    }
    // 2) extra na dívida da vez (e o que sobrar, na seguinte)
    for (const d of ds.filter((x) => x.bal > 0.005).sort(pick)) {
      if (left <= 0.005) break;
      const p = Math.min(d.bal, left);
      d.bal -= p; left -= p; paidNow[d.id] = (paidNow[d.id] || 0) + p;
    }
    result.totalPaid += budget - left;
    if (m === 1) result.firstMonth = ds.map((d) => ({ id: d.id, name: d.name, pay: round(paidNow[d.id] || 0) }));
    for (const d of ds) if (d.bal <= 0.005 && d.paidOffMonth == null) { d.bal = 0; d.paidOffMonth = m; result.order.push({ id: d.id, name: d.name, month: m }); }
    const after = sumBal(ds);
    result.series.push(after);
    if (after <= 0.005) { result.months = m; break; }
    growing = after >= before - 0.005 ? growing + 1 : 0;
    if (growing >= 6 || m === MAX_MONTHS) { result.feasible = false; result.reason = 'juros'; result.months = m; break; }
  }
  result.totalInterest = round(ds.reduce((a, d) => a + d.interest, 0));
  result.totalPaid = round(result.totalPaid);
  // ordem de ataque atual (para mostrar "foque nesta")
  result.focusOrder = debts.filter((d) => d.balance > 0.005)
    .map((d) => ({ ...d, r: (+d.rate || 0) / 100, bal: +d.balance }))
    .sort((a, b) => pick({ bal: a.bal, rate: a.r }, { bal: b.bal, rate: b.r }))
    .map((d) => d.id);
  return result;
}

const sumBal = (ds) => round(ds.reduce((a, d) => a + Math.max(0, d.bal), 0));
const round = (v) => Math.round(v * 100) / 100;

// Extra mínimo para quitar em N meses (busca binária). Útil para metas.
export function budgetForMonths(debts, months, strategy = 'avalanche') {
  const minSum = debts.reduce((a, d) => a + (d.balance > 0 ? +d.minPayment || 0 : 0), 0);
  let lo = minSum, hi = Math.max(minSum, debts.reduce((a, d) => a + +d.balance, 0) * 2 + 1);
  if (!simulate(debts, hi, strategy).feasible) return null;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const r = simulate(debts, mid, strategy);
    if (r.feasible && r.months <= months) hi = mid; else lo = mid;
  }
  return Math.ceil(hi);
}

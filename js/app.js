// OFI — Organização Financeira. Controle leve para organizar o dinheiro e sair das dívidas.
import { uid, fmt, fmtDate, todayISO, toISO, monthKey, monthLabel, addMonths, daysInMonth, pad, esc, parseMoney, norm } from './util.js';
import { parseQuick } from './rapido.js';
import { parseStatement } from './importar.js';
import { simulate, budgetForMonths } from './dividas.js';
import { ruleKey } from './categorias.js';
import { mascot, say, MASCOT_NAME } from './mascote.js';
import { icon, catIcon } from './icones.js';
import {
  emptyData, normalizeData, loadConfig, saveConfig, clearConfig, loadCache, saveCache,
  remoteLoad, remoteSave, merge,
} from './armazenamento.js';

// Troque aqui para renomear o app inteiro.
export const APP_NAME = 'OFI';

// ======================================================================
// Estado
// ======================================================================
const cache = loadCache();
const S = {
  data: normalizeData(cache?.data || emptyData()),
  sha: cache?.sha || null,
  dirty: !!cache?.dirty,
  cfg: loadConfig(),
  tab: 'home',
  sub: null,
  histMonth: monthKey(todayISO()),
  histFilter: 'all',
  sheet: null,
  add: null,
  onb: null,
  tour: null,
  slider: null,
  importPreview: null,
  saving: false, again: false, lastPull: 0, status: 'local', statusMsg: '',
};

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const now = () => Date.now();
const touch = (it) => { it.updatedAt = now(); return it; };
const cur = () => monthKey(todayISO());
const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch {} };
const money = (v) => { const n = parseMoney(v); return Number.isFinite(n) ? Math.abs(n) : null; };
const brNum = (v) => (v || v === 0 ? String(v).replace('.', ',') : '');

function persistCache() { saveCache({ data: S.data, sha: S.sha, dirty: S.dirty }); }
function mutate(fn, { render: doRender = true } = {}) {
  fn(S.data);
  S.data.updatedAt = now();
  S.dirty = true;
  persistCache();
  scheduleSync();
  if (doRender) render();
}
function removeItem(coll, id) {
  S.data[coll] = S.data[coll].filter((x) => x.id !== id);
  S.data.deleted[id] = now();
}

// ======================================================================
// Nuvem (opcional): repositório privado do GitHub
// ======================================================================
const isGitHub = () => S.cfg?.mode === 'github' && !!S.cfg.token;
let syncTimer = null;
function scheduleSync() {
  if (!isGitHub()) return setStatus('local');
  setStatus('saving');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 1200);
}
async function sync() {
  if (!isGitHub()) return;
  if (S.saving) { S.again = true; return; }
  S.saving = true;
  setStatus('saving');
  try {
    try {
      S.sha = await remoteSave(S.cfg, S.data, S.sha);
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      const r = await remoteLoad(S.cfg);
      S.data = merge(S.data, r.data);
      S.sha = await remoteSave(S.cfg, S.data, r.sha);
      if (!S.sheet) render();
    }
    S.dirty = false;
    persistCache();
    setStatus('ok');
  } catch (e) {
    setStatus('error', e.message);
  } finally {
    S.saving = false;
    if (S.again) { S.again = false; sync(); }
  }
}
async function pull() {
  if (!isGitHub()) return;
  try {
    const r = await remoteLoad(S.cfg);
    S.lastPull = now();
    if (r.data) { S.data = S.dirty ? merge(S.data, r.data) : r.data; S.sha = r.sha; }
    else { S.sha = null; S.dirty = true; }
    persistCache();
    if (generateRecurring() || S.dirty) { S.dirty = true; await sync(); } else setStatus('ok');
    if (!S.sheet && !S.onb) render();
  } catch (e) { setStatus('error', e.message); }
}
function setStatus(st, msg = '') {
  S.status = st;
  S.statusMsg = msg;
  const el = $('#syncStatus');
  el.className = `sync ${st}`;
  el.textContent = { ok: 'na nuvem', saving: 'salvando…', error: 'erro ao salvar', local: 'neste aparelho' }[st];
  el.title = msg;
}
window.addEventListener('focus', () => { if (isGitHub() && !S.dirty && !S.saving && now() - S.lastPull > 30_000) pull(); });
window.addEventListener('online', () => { if (S.dirty) sync(); });

// ======================================================================
// Contas fixas viram lançamentos no dia
// ======================================================================
function generateRecurring() {
  const today = todayISO();
  let created = 0;
  for (const r of S.data.recurring) {
    if (!r.active) continue;
    for (const m of [addMonths(cur(), -1), cur()]) {
      if (r.startMonth && m < r.startMonth) continue;
      const date = `${m}-${pad(Math.min(r.day, daysInMonth(m)))}`;
      if (date > today) continue;
      const id = `rec_${r.id}_${m}`;
      if (S.data.deleted[id] || S.data.transactions.some((t) => t.id === id)) continue;
      S.data.transactions.push(touch({ id, date, desc: r.desc, amount: r.amount, type: r.type, category: r.category, source: 'fixa', recurringId: r.id }));
      created++;
    }
  }
  if (created) { S.data.updatedAt = now(); S.dirty = true; persistCache(); }
  return created;
}

// ======================================================================
// Contas do mês
// ======================================================================
const catInfo = (name) => S.data.categories.find((c) => c.name === name) || {};
const emo = (name) => catIcon(name);
const counts = (t) => !catInfo(t.category).ignore;
const txOfMonth = (m) => S.data.transactions.filter((t) => monthKey(t.date) === m);
const debtsActive = () => S.data.debts.filter((d) => d.balance > 0.005);
const debtMinSum = () => debtsActive().reduce((a, d) => a + (+d.minPayment || 0), 0);
// Sem valor escolhido: sugere o mínimo que quita tudo em até 36 meses (sem passar do que sobra no mês).
let suggestMemo = { key: '', v: 0 };
function suggestedBudget() {
  const ds = debtsActive();
  const room = monthRoom();
  const key = JSON.stringify([ds.map((d) => [d.balance, d.rate, d.minPayment]), room]);
  if (suggestMemo.key === key) return suggestMemo.v;
  const min = debtMinSum();
  let v = min;
  if (!simulate(ds, min).feasible || simulate(ds, min).months > 36) {
    const need = budgetForMonths(ds, 36) || min;
    v = Math.ceil(Math.min(need, room > min ? room : need) / 10) * 10;
  }
  suggestMemo = { key, v: Math.max(min, v) };
  return suggestMemo.v;
}
function monthRoom() {
  const inc = Math.max(
    S.data.recurring.filter((r) => r.active && r.type === 'receita').reduce((a, r) => a + r.amount, 0),
    txOfMonth(cur()).filter((t) => t.type === 'receita' && counts(t)).reduce((a, t) => a + t.amount, 0));
  const fixed = S.data.recurring.filter((r) => r.active && r.type === 'despesa').reduce((a, r) => a + r.amount, 0);
  return Math.max(0, (inc - fixed) * 0.6); // deixa ~40% pro dia a dia
}
const debtBudget = () => Math.max(S.data.settings.debtBudget || suggestedBudget(), debtMinSum());
const plan = (budget = debtBudget(), strategy = S.data.settings.strategy) => simulate(debtsActive(), budget, strategy);
const whenFree = (months) => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + months);
  return monthLabel(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`).toLowerCase().replace(' ', ' de ');
};
const isVariable = (t) => t.type === 'despesa' && counts(t) && t.source !== 'fixa' && t.category !== 'Dívidas';

/** "Pode gastar hoje": o que sobra pro dia a dia depois das fixas e do plano das dívidas. */
function monthPlan() {
  const m = cur();
  const txs = txOfMonth(m);
  const fixedIn = S.data.recurring.filter((r) => r.active && r.type === 'receita').reduce((a, r) => a + r.amount, 0);
  const realIn = txs.filter((t) => t.type === 'receita' && counts(t)).reduce((a, t) => a + t.amount, 0);
  const income = Math.max(fixedIn, realIn);
  const fixedOut = S.data.recurring.filter((r) => r.active && r.type === 'despesa').reduce((a, r) => a + r.amount, 0);
  const debts = debtsActive().length ? debtBudget() : 0;
  const spent = txs.filter(isVariable).reduce((a, t) => a + t.amount, 0);
  const allowance = income - fixedOut - debts;
  const left = allowance - spent;
  const daysLeft = daysInMonth(m) - new Date().getDate() + 1;
  const perDay = left / daysLeft;
  const used = allowance > 0 ? spent / allowance : spent > 0 ? 1.01 : 0;
  const elapsed = (new Date().getDate() - 1) / daysInMonth(m);
  const mood = left < 0 || allowance <= 0 ? 'bad' : used > Math.max(0.85, elapsed + 0.15) ? 'warn' : 'good';
  return { income, fixedOut, debts, spent, allowance, left, daysLeft, perDay, used, mood };
}

function byCategory(m) {
  const map = new Map();
  for (const t of txOfMonth(m)) if (t.type === 'despesa' && counts(t)) map.set(t.category, (map.get(t.category) || 0) + t.amount);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function upcomingBills(limit = 2) {
  const d0 = new Date().getDate();
  const items = [];
  for (const r of S.data.recurring) if (r.active && r.type === 'despesa') items.push({ day: r.day, name: r.desc, amount: r.amount, e: emo(r.category) });
  for (const d of debtsActive()) if (d.dueDay) items.push({ day: +d.dueDay, name: d.name, amount: +d.minPayment, e: icon('card') });
  return items
    .map((i) => ({ ...i, inDays: i.day >= d0 ? i.day - d0 : i.day + daysInMonth(cur()) - d0 }))
    .sort((a, b) => a.inDays - b.inDays)
    .slice(0, limit);
}
const inDaysLabel = (n) => (n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);

// ======================================================================
// Render
// ======================================================================
function render() {
  const onb = S.onb != null;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
  $('#nav').hidden = onb;
  $('#fab').hidden = onb || !['home', 'hist'].includes(S.tab);
  app.innerHTML = onb ? viewOnboarding() : { home: viewHome, hist: viewHist, debts: viewDebts, more: viewMore }[S.tab]();
  if (S.tour) placeTour();
}

// ---------------- Início ----------------
const MOOD = {
  good: ['feliz', 'No ritmo certo'],
  warn: ['preocupado', 'Atenção aos gastos'],
  bad: ['preocupado', 'Acima do limite'],
};
function viewHome() {
  const p = monthPlan();
  const cats = byCategory(cur()).slice(0, 4);
  const bills = upcomingBills(2);
  const [mood, line] = MOOD[p.mood];

  const hero = p.income > 0 ? `
    <section class="card hero tap" data-act="plan-open" id="tourHero">
      <div class="hero-mascot">${mascot(mood, 64)}<span class="mood ${p.mood}">${line}</span></div>
      <div class="label">${p.left >= 0 ? 'Pode gastar hoje' : 'Passou do mês em'}</div>
      <div class="big num ${p.left < 0 ? 'neg' : ''}">${fmt(p.left >= 0 ? Math.max(0, p.perDay) : -p.left)}</div>
      <div class="muted small">${p.left >= 0 ? `${fmt(p.left)} até o fim do mês · ${p.daysLeft} ${p.daysLeft === 1 ? 'dia' : 'dias'}` : 'segura os gastos até virar o mês'}</div>
      <div class="meter ${p.mood === 'good' ? '' : p.mood}"><div style="width:${Math.min(100, p.used * 100)}%"></div></div>
    </section>` : `
    <section class="card hero" id="tourHero">
      ${say('calmo', 'Me conta quanto entra por mês que eu calculo quanto dá pra gastar por dia.')}
      <button class="btn primary big" data-act="income-open" style="margin-top:14px">Informar renda mensal</button>
    </section>`;

  let focus = '';
  if (debtsActive().length) {
    const pl = plan();
    if (pl.feasible) {
      const d = S.data.debts.find((x) => x.id === pl.focusOrder[0]);
      const pay = pl.firstMonth.find((x) => x.id === d.id)?.pay || 0;
      focus = `
      <section class="card line-card tap" data-act="debt-open" data-id="${d.id}">
        <div class="emoji-badge">${icon('target')}</div>
        <div class="grow"><div class="t">Foco: ${esc(d.name)}</div><div class="s">pague <b class="num">${fmt(pay)}</b> este mês · livre em ${whenFree(pl.months)}</div></div>
        <span class="chev">›</span>
      </section>`;
    } else {
      focus = `<section class="card line-card tap" data-goto="debts"><div class="emoji-badge">${icon('alert')}</div><div class="grow"><div class="t">Plano das dívidas não fecha</div><div class="s">toque pra ajustar</div></div><span class="chev">›</span></section>`;
    }
  }

  const billsHTML = bills.map((b) => `
    <section class="card line-card">
      <div class="emoji-badge">${b.e}</div>
      <div class="grow"><div class="t">${esc(b.name)}</div><div class="s">vence ${inDaysLabel(b.inDays)}</div></div>
      <b class="num">${fmt(b.amount)}</b>
    </section>`).join('');

  const catsHTML = cats.length ? `
    <section class="card">
      <div class="row between" style="margin-bottom:12px"><h2>Pra onde foi</h2><button class="btn ghost sm" data-goto="hist">ver tudo ›</button></div>
      <div class="cat-grid">${cats.map(([c, v]) => {
        const lim = catInfo(c).limit || 0;
        const over = lim && v > lim;
        return `<button class="cat-tile" data-act="hist-cat" data-cat="${esc(c)}">
          <div class="top-line"><span class="name">${emo(c)} ${esc(c)}</span>${over ? '<span class="neg small">▲</span>' : ''}</div>
          <div class="val num ${over ? 'neg' : ''}">${fmt(v)}</div>
          ${lim ? `<div class="mini-meter ${over ? 'bad' : ''}"><div style="width:${Math.min(100, (v / lim) * 100)}%"></div></div><small class="muted">de ${fmt(lim)}</small>` : ''}
        </button>`;
      }).join('')}</div>
    </section>` : `<section class="card tap" data-act="add-open">${say('feliz', 'Registre seu primeiro gasto no botão <b>+</b>. Leva poucos segundos.', 56)}</section>`;

  return hero + focus + billsHTML + catsHTML;
}

// ---------------- Histórico ----------------
function viewHist() {
  const m = S.histMonth;
  const all = txOfMonth(m);
  const f = S.histFilter;
  const list = all
    .filter((t) => f === 'all' || (f === 'out' ? t.type === 'despesa' : f === 'in' ? t.type === 'receita' : t.category === f))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const out = list.filter((t) => t.type === 'despesa' && counts(t)).reduce((a, t) => a + t.amount, 0);
  const inn = list.filter((t) => t.type === 'receita' && counts(t)).reduce((a, t) => a + t.amount, 0);
  const usedCats = [...new Set(all.map((t) => t.category))];
  const chip = (key, label) => `<button class="chip ${f === key ? 'on' : ''}" data-act="hist-filter" data-f="${esc(key)}">${label}</button>`;
  const today = todayISO();
  const yest = toISO(new Date(Date.now() - 864e5));
  const groups = new Map();
  for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  const dayName = (d) => (d === today ? 'Hoje' : d === yest ? 'Ontem' : new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }));

  return `
    <div class="month-switch">
      <button class="icon-btn" data-act="hist-prev" aria-label="Mês anterior">‹</button>
      <b>${monthLabel(m)}</b>
      <button class="icon-btn" data-act="hist-next" aria-label="Próximo mês" ${m >= cur() ? 'disabled style="opacity:.3"' : ''}>›</button>
    </div>
    <div class="row" style="justify-content:center;gap:18px">
      <span class="small muted">saiu <b class="num neg">${fmt(out)}</b></span>
      <span class="small muted">entrou <b class="num pos">${fmt(inn)}</b></span>
    </div>
    <div class="chips">${chip('all', 'Tudo')}${chip('out', 'Saídas')}${chip('in', 'Entradas')}${usedCats.map((c) => chip(c, `${emo(c)} ${esc(c)}`)).join('')}</div>
    <section class="card" style="padding:8px 10px">
      ${list.length ? [...groups.entries()].map(([d, ts]) => `
        <div class="day-label">${dayName(d)}</div>
        ${ts.map((t) => `<button class="tx" data-act="tx-open" data-id="${t.id}">
          <div class="emoji-badge sm">${emo(t.category)}</div>
          <div class="d"><b>${esc(t.desc)}</b><small>${esc(t.category)}${t.source === 'fixa' ? ' · fixa' : ''}</small></div>
          <span class="v num ${!counts(t) ? 'muted' : t.type === 'receita' ? 'pos' : ''}">${t.type === 'receita' ? '+' : '−'}${fmt(t.amount)}</span>
        </button>`).join('')}`).join('') : `<div style="padding:24px 8px">${say('calmo', 'Nenhum lançamento neste mês.', 56)}</div>`}
    </section>`;
}

// ---------------- Dívidas ----------------
function ring(pct) {
  const r = 58, c = 2 * Math.PI * r;
  return `<svg width="150" height="150" viewBox="0 0 150 150" aria-hidden="true">
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--track)" stroke-width="14"/>
    ${pct > 0.005 ? '' : '<!--'}<circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--good)" stroke-width="14" stroke-linecap="round"
      stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 75 75)"/>${pct > 0.005 ? '' : '-->'}
  </svg>`;
}

function viewDebts() {
  const ds = S.data.debts;
  if (!ds.length) return `
    <section class="card">
      ${say('feliz', 'Nenhuma dívida aqui. Tem alguma? Me mostra que eu monto o plano pra você sair dela.')}
      <button class="btn primary big" data-act="debt-new" style="margin-top:14px">+ Adicionar dívida</button>
    </section>`;

  const active = debtsActive();
  const total = active.reduce((a, d) => a + +d.balance, 0);
  const orig = ds.reduce((a, d) => a + Math.max(+d.original || 0, +d.balance), 0);
  const pct = orig ? (orig - total) / orig : 0;
  const pl = plan();

  if (!active.length) return `
    <section class="card hero">
      ${mascot('festa', 120)}
      <h2 style="margin:8px 0 4px">Livre de dívidas!</h2>
      <p class="muted small" style="margin-bottom:16px">Você quitou ${fmt(orig)}. Que orgulho.</p>
      <button class="btn big" data-act="debt-new">+ Adicionar dívida</button>
    </section>
    ${debtList(ds, pl)}`;

  const focus = pl.feasible ? S.data.debts.find((x) => x.id === pl.focusOrder[0]) : null;
  const focusPay = focus ? pl.firstMonth.find((x) => x.id === focus.id)?.pay || 0 : 0;

  return `
    <section class="card" style="text-align:center">
      <div class="ring-wrap">${ring(pct)}<div class="center"><b>${Math.round(pct * 100)}%</b><span class="small muted">quitado</span></div></div>
      <div style="margin-top:8px">faltam <b class="num">${fmt(total)}</b></div>
      <div class="muted small">${pl.feasible ? `livre em <b>${whenFree(pl.months)}</b>` : 'ajuste o valor abaixo'}</div>
    </section>

    ${focus ? `
    <section class="card line-card">
      <div class="emoji-badge">${icon('target')}</div>
      <div class="grow"><div class="t">Agora: ${esc(focus.name)}</div><div class="s">pague <b class="num">${fmt(focusPay)}</b> nela · mínimo nas outras</div></div>
      <button class="btn primary sm" data-act="debt-pay" data-id="${focus.id}">Paguei</button>
    </section>` : ''}

    <section class="card" style="display:grid;gap:12px" id="tourSlider">
      <div class="row between"><h2>Valor mensal para dívidas</h2><b class="num" id="sliderVal" style="font-size:1.3rem">${fmt(S.slider ?? debtBudget())}</b></div>
      ${sliderInput()}
      <div class="seg" role="group" aria-label="Estratégia">
        <button data-act="strategy" data-v="avalanche" class="${S.data.settings.strategy === 'avalanche' ? 'on' : ''}">Menos juros</button>
        <button data-act="strategy" data-v="snowball" class="${S.data.settings.strategy === 'snowball' ? 'on' : ''}">Menor primeiro</button>
      </div>
      <div id="debtLive">${debtLive(S.slider ?? debtBudget())}</div>
    </section>

    ${debtList(ds, pl)}
    <button class="btn big" data-act="debt-new">+ Adicionar dívida</button>`;
}

function sliderRange() {
  const min = Math.ceil(debtMinSum() / 10) * 10;
  const p = monthPlan();
  const room = Math.max(0, p.allowance + p.debts);
  const max = Math.max(min + 300, Math.ceil(Math.max(min * 3, Math.min(room, min * 6)) / 50) * 50);
  return { min, max };
}
function sliderInput() {
  const { min, max } = sliderRange();
  const v = Math.min(max, Math.max(min, S.slider ?? debtBudget()));
  return `<input type="range" class="slider" id="debtSlider" min="${min}" max="${max}" step="10" value="${v}" aria-label="Valor mensal para dívidas">
    <div class="row between small muted"><span>mínimo ${fmt(min)}</span><span>${fmt(max)}</span></div>`;
}

function debtLive(budget) {
  const p = plan(budget);
  if (!p.feasible) return say('preocupado', p.reason === 'budget' ? 'Isso é menos que a soma das parcelas mínimas.' : 'Assim os juros crescem mais rápido que o pagamento. Arrasta pra direita ou renegocia a dívida mais cara.', 52);
  const base = plan(debtMinSum());
  let gain = '';
  if (budget > debtMinSum() + 5) {
    gain = base.feasible
      ? `<div class="gain">${base.months - p.months} ${base.months - p.months === 1 ? 'mês' : 'meses'} antes e ${fmt(base.totalInterest - p.totalInterest)} a menos de juros do que pagando só o mínimo</div>`
      : '<div class="gain">Pagando só o mínimo, a dívida não acabaria. Com esse valor, acaba.</div>';
  } else if (!base.feasible) gain = '<div class="gain bad">Só no mínimo os juros não deixam quitar. Aumente o valor.</div>';
  return `
    <div class="live">
      <div class="stat"><small>livre em</small><b>${whenFree(p.months)}</b></div>
      <div class="stat"><small>juros até lá</small><b class="num">${fmt(p.totalInterest)}</b></div>
    </div>
    ${gain ? `<div style="margin-top:10px">${gain}</div>` : ''}
    <details style="margin-top:10px"><summary>Ver projeção</summary><div class="chart" style="margin-top:8px">${lineChart(p.series)}</div></details>`;
}

function debtList(ds, pl) {
  return `<section class="card" style="padding:8px 10px">
    ${ds.map((d) => {
      const o = Math.max(+d.original || 0, +d.balance);
      const done = d.balance <= 0.005;
      const isFocus = pl.feasible && pl.focusOrder[0] === d.id;
      return `<button class="tx" data-act="debt-open" data-id="${d.id}">
        <div class="emoji-badge sm">${icon(done ? 'check' : 'card')}</div>
        <div class="d"><b>${esc(d.name)} ${isFocus ? '<span class="tag">foco</span>' : ''}</b>
          <div class="bar"><div style="width:${o ? ((o - d.balance) / o) * 100 : 0}%"></div></div></div>
        <span class="v num">${done ? 'quitada' : fmt(d.balance)}</span>
      </button>`;
    }).join('')}
  </section>`;
}

function lineChart(series) {
  const W = 520, H = 190, L = 64, R = 12, T = 10, B = 26;
  const n = series.length - 1;
  if (n < 1) return '';
  const max = Math.max(...series) || 1;
  const x = (i) => L + (i / n) * (W - L - R);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const short = (v) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(v)}`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo devedor cai de ${fmt(series[0])} a zero em ${n} meses" data-series='${JSON.stringify(series)}' data-l="${L}" data-r="${R}" data-w="${W}" data-h="${H}" data-t="${T}" data-b="${B}">
    ${[0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="var(--border)"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end" font-size="12" fill="var(--muted)">${short(max * f)}</text>`).join('')}
    ${[0, Math.round(n / 2), n].map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}" font-size="12" fill="var(--muted)">${i === 0 ? 'hoje' : `${i} meses`}</text>`).join('')}
    <polyline points="${series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <line class="xh" y1="${T}" y2="${H - B}" stroke="var(--ink-2)" opacity="0"/>
    <circle class="dot" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" opacity="0"/>
    <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>
  </svg>`;
}

// ---------------- Mais ----------------
const MORE = [
  ['fixas', 'repeat', 'Contas fixas', 'aluguel, luz, salário'],
  ['importar', 'download', 'Importar extrato', 'OFX ou CSV do banco'],
  ['cats', 'tag', 'Categorias', 'limites por mês'],
  ['install', 'phone', 'Instalar app', 'ícone na tela'],
  ['sync', 'cloud', 'Nuvem', 'PC + celular juntos'],
  ['backup', 'shield', 'Backup', 'baixar ou restaurar'],
];
function viewMore() {
  if (S.sub) return `<button class="back" data-act="sub-back">‹ Voltar</button>` + { fixas: subFixas, importar: subImport, cats: subCats, install: subInstall, sync: subSync, backup: subBackup }[S.sub]();
  return `
    <div class="tiles">${MORE.map(([k, e, t, s]) => `<button class="tile" data-act="sub" data-k="${k}"><span class="e">${icon(e, 22)}</span><b>${t}</b><small>${s}</small></button>`).join('')}</div>
    <section class="card tap" data-act="tour-start">${say('feliz', `Esqueceu como funciona? Toca aqui que eu, o <b>${MASCOT_NAME}</b>, te mostro de novo.`, 56)}</section>
    <p class="muted small" style="text-align:center">${APP_NAME} · seus dados ficam com você</p>`;
}

function subFixas() {
  const rs = [...S.data.recurring].sort((a, b) => a.day - b.day);
  const out = rs.filter((r) => r.active && r.type === 'despesa').reduce((a, r) => a + r.amount, 0);
  return `
    <h2>Contas fixas</h2>
    ${rs.length ? `<p class="muted small">Saem <b class="num">${fmt(out)}</b> por mês. Entram sozinhas no dia.</p>
    <section class="card" style="padding:8px 10px">${rs.map((r) => `
      <button class="tx" data-act="fixa-open" data-id="${r.id}" style="${r.active ? '' : 'opacity:.45'}">
        <div class="emoji-badge sm">${emo(r.category)}</div>
        <div class="d"><b>${esc(r.desc)}</b><small>dia ${r.day}${r.active ? '' : ' · pausada'}</small></div>
        <span class="v num ${r.type === 'receita' ? 'pos' : ''}">${r.type === 'receita' ? '+' : '−'}${fmt(r.amount)}</span>
      </button>`).join('')}</section>` : say('calmo', 'Aluguel, luz, internet… cadastra uma vez e eu lanço todo mês.', 56)}
    <button class="btn primary big" data-act="fixa-new">+ Nova conta fixa</button>`;
}

function subImport() {
  const pv = S.importPreview;
  if (!pv) return `
    <h2>Importar extrato</h2>
    <label class="drop" id="drop">
      <input type="file" id="fileInput" accept=".csv,.ofx,.txt,text/csv" multiple hidden>
      <div class="muted">${icon('file', 36)}</div><b>Escolher arquivo</b><div class="muted small">OFX ou CSV</div>
    </label>
    <details><summary>Onde baixo isso?</summary>
      <ol class="steps" style="margin-top:10px">
        <li><b>Nubank:</b> app → Extrato (ou Fatura) → exportar</li>
        <li><b>Outros bancos:</b> internet banking → Extrato → salvar como <b>OFX</b></li>
      </ol>
    </details>`;
  const sel = pv.items.filter((i) => i.include).length;
  return `
    <div class="row between"><h2>${pv.items.length} lançamentos</h2>
      <label class="row small" style="gap:6px"><input type="checkbox" data-act="card-mode" ${pv.cardMode ? 'checked' : ''}> fatura de cartão</label></div>
    ${pv.items.some((i) => i.dup) ? `<p class="muted small">${pv.items.filter((i) => i.dup).length} já estavam aqui (desmarcados)</p>` : ''}
    <section class="card" style="padding:6px 14px">${pv.items.map((it, i) => `
      <div class="imp-row ${it.dup ? 'dup' : ''}">
        <input type="checkbox" data-act="imp-inc" data-i="${i}" ${it.include ? 'checked' : ''} aria-label="Incluir">
        <div class="grow"><div class="ellipsis">${esc(it.desc)}</div><small class="muted">${fmtDate(it.date).slice(0, 5)}${it.dupWhy ? ` · ${esc(it.dupWhy)}` : ''}</small>
          <div><select data-act="imp-cat" data-i="${i}" aria-label="Categoria">${catOptions(it.category, it.type)}</select></div></div>
        <b class="num ${it.type === 'receita' ? 'pos' : ''}" style="text-align:right">${it.type === 'receita' ? '+' : '−'}${fmt(it.amount)}</b>
      </div>`).join('') || '<p class="muted">Não achei lançamentos nesse arquivo.</p>'}</section>
    <div class="two"><button class="btn" data-act="imp-cancel">Cancelar</button><button class="btn primary" data-act="imp-confirm" ${sel ? '' : 'disabled'}>Importar ${sel}</button></div>`;
}

function subCats() {
  return `
    <h2>Categorias</h2>
    <p class="muted small">Coloque um limite e eu aviso quando passar.</p>
    <section class="card" style="padding:6px 14px">
      ${S.data.categories.filter((c) => !c.ignore).map((c) => `
        <div class="imp-row">
          <span class="emoji-badge sm">${catIcon(c.name)}</span>
          <div class="grow">${esc(c.name)}</div>
          ${c.income ? '<small class="muted">entrada</small>' : `<input class="input" style="width:120px;padding:8px 10px" inputmode="decimal" data-act="cat-limit" data-name="${esc(c.name)}" value="${c.limit ? brNum(c.limit) : ''}" placeholder="sem limite" aria-label="Limite ${esc(c.name)}">`}
          <button class="btn ghost sm" data-act="cat-del" data-name="${esc(c.name)}" aria-label="Remover">${icon('x', 16)}</button>
        </div>`).join('')}
    </section>
    <form class="row" data-form="cat-new">
            <input class="input grow" name="name" placeholder="Nova categoria" required>
      <button class="btn primary">+</button>
    </form>`;
}

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (S.sub === 'install') render(); });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function subInstall() {
  if (isStandalone()) return `<section class="card">${say('festa', 'Já tô instalado! Você tá me usando como app.')}</section>`;
  return `
    <h2>Instalar no celular</h2>
    ${installEvt ? `<button class="btn primary big" data-act="install">Instalar ${APP_NAME}</button>` : ''}
    ${isIOS() ? `
    <section class="card"><ol class="steps">
      <li>Abra este link no <b>Safari</b></li>
      <li>Toque em <b>Compartilhar</b> (quadrado com seta)</li>
      <li>Toque em <b>Adicionar à Tela de Início</b></li>
    </ol></section>` : `
    <section class="card"><ol class="steps">
      <li><b>Android:</b> Chrome → menu ⋮ → <b>Instalar app</b></li>
      <li><b>iPhone:</b> Safari → Compartilhar → <b>Adicionar à Tela de Início</b></li>
      <li><b>PC:</b> Chrome/Edge → ícone ⊕ na barra de endereço</li>
    </ol></section>`}
    ${say('feliz', 'Funciono sem internet. Pra me passar pra alguém, é só mandar o link — cada pessoa tem os próprios dados.', 52)}`;
}

function subSync() {
  const c = S.cfg || {};
  const on = isGitHub();
  return `
    <h2>Nuvem (opcional)</h2>
    <section class="card line-card"><div class="emoji-badge">${icon(on ? 'cloud' : 'phone')}</div>
      <div class="grow"><div class="t">${on ? 'Salvando no GitHub' : 'Salvo só neste aparelho'}</div><div class="s">${on ? `${esc(c.owner)}/${esc(c.repo)}${S.statusMsg ? ` · ${esc(S.statusMsg)}` : ''}` : 'conecte pra usar no PC e no celular'}</div></div></section>
    <form class="card" style="display:grid;gap:12px" data-form="cfg" autocomplete="off">
      <div class="two">
        <label class="field">Usuário GitHub<input class="input" name="owner" required value="${esc(c.owner || '')}"></label>
        <label class="field">Repositório privado<input class="input" name="repo" required value="${esc(c.repo || 'ofi-dados')}"></label>
      </div>
      <label class="field">Token<input class="input" type="password" name="token" autocomplete="off" ${c.token ? 'placeholder="•••• salvo"' : 'required placeholder="github_pat_…"'}></label>
      <input type="hidden" name="path" value="${esc(c.path || 'dados.json')}">
      <button class="btn primary big">${on ? 'Atualizar' : 'Conectar'}</button>
      ${on ? '<button type="button" class="btn ghost danger" data-act="disconnect">Desconectar este aparelho</button>' : ''}
    </form>
    <details><summary>Como criar o token (2 min)</summary>
      <ol class="steps" style="margin-top:10px">
        <li>github.com/new → nome <code>ofi-dados</code> → <b>Private</b> → criar</li>
        <li>Settings → Developer settings → <b>Fine-grained tokens</b> → Generate</li>
        <li>Only select repositories → <code>ofi-dados</code></li>
        <li>Permissions → Contents → <b>Read and write</b></li>
        <li>Copiar e colar aqui</li>
      </ol>
    </details>`;
}

function subBackup() {
  return `
    <h2>Backup</h2>
    <button class="btn big" data-act="export">${icon('download', 18)} Baixar backup</button>
    <label class="btn big" style="text-align:center">${icon('upload', 18)} Restaurar backup<input type="file" accept=".json" data-act="restore" hidden></label>
    <p class="muted small">Sem a nuvem ligada, faça um backup de vez em quando.</p>`;
}

// ---------------- Primeiro acesso (com o Ofi) ----------------
const PRESET_FIXAS = [['Aluguel', '', 'Moradia'], ['Luz', '', 'Contas'], ['Água', '', 'Contas'], ['Internet', '', 'Contas'], ['Celular', '', 'Contas'], ['Condomínio', '', 'Moradia'], ['Faculdade', '', 'Educação'], ['Streaming', '', 'Assinaturas'], ['Academia', '', 'Saúde'], ['Plano de saúde', '', 'Saúde']];
function viewOnboarding() {
  const o = S.onb;
  const dots = `<div class="dots">${[1, 2, 3].map((i) => `<i class="${o.step === i ? 'on' : ''}"></i>`).join('')}</div>`;
  if (o.step === 0) return `
    <div class="onb">
      <div class="float">${mascot('feliz', 150)}</div>
      <h1>Oi! Eu sou o ${MASCOT_NAME}</h1>
      <p class="muted">Sou seu assistente de organização financeira. Três perguntas rápidas e seu plano fica pronto.</p>
      <button class="btn primary big" data-act="onb-next">Começar</button>
      <button class="btn ghost" data-act="onb-cloud">Já uso em outro aparelho</button>
    </div>`;
  if (o.step === 1) return `
    <div class="onb">${dots}
      ${say('feliz', '<b>Quanto entra por mês?</b><br>Salário, freela, o que for.')}
      <input class="input big" inputmode="decimal" id="onbIncome" placeholder="R$ 0,00" value="${esc(o.income || '')}">
      <div>
        <p class="muted small" style="margin-bottom:8px">Cai que dia?</p>
        <div class="chips wrap">${[1, 5, 10, 15, 20, 25, 30].map((d) => `<button class="chip ${o.payDay === d ? 'on' : ''}" data-act="onb-day" data-d="${d}">${d}</button>`).join('')}</div>
      </div>
      <button class="btn primary big" data-act="onb-next">Próximo</button>
      <button class="btn ghost" data-act="onb-skip">Varia muito / pular</button>
    </div>`;
  if (o.step === 2) return `
    <div class="onb">${dots}
      ${say('calmo', '<b>Quais contas chegam todo mês?</b><br>Toca nas que você tem.')}
      <div class="chips wrap">${PRESET_FIXAS.map(([n, e]) => `<button class="chip ${o.fixas[n] ? 'on' : ''}" data-act="onb-fixa" data-n="${n}">${n}</button>`).join('')}</div>
      ${Object.keys(o.fixas).length ? `<div class="quick-list">${Object.entries(o.fixas).map(([n, v]) => `
        <div class="row"><span class="grow">${n}</span>
          <input class="input" style="width:120px" inputmode="decimal" placeholder="R$" data-onb-fixa="${n}" value="${esc(v.amount || '')}" aria-label="Valor ${n}">
          <input class="input" style="width:70px" inputmode="numeric" placeholder="dia" data-onb-dia="${n}" value="${esc(v.day || '')}" aria-label="Dia ${n}"></div>`).join('')}</div>` : ''}
      <button class="btn primary big" data-act="onb-next">Próximo</button>
    </div>`;
  const n = S.data.debts.length;
  return `
    <div class="onb">${dots}
      ${say(n ? 'feliz' : 'calmo', n ? `Anotei ${n === 1 ? 'essa' : `essas ${n}`}. Tem mais alguma?` : '<b>Tem dívidas?</b><br>Cartão, empréstimo, crediário… sem vergonha, tô aqui pra isso.')}
      ${n ? `<div class="quick-list">${S.data.debts.map((d) => `<div class="card line-card" style="padding:12px"><div class="emoji-badge sm">${icon('card')}</div><div class="grow t">${esc(d.name)}</div><b class="num">${fmt(d.balance)}</b></div>`).join('')}</div>` : ''}
      <button class="btn ${n ? '' : 'primary'} big" data-act="debt-new">+ Adicionar ${n ? 'outra' : 'dívida'}</button>
      <button class="btn ${n ? 'primary' : 'ghost'} big" data-act="onb-finish">${n ? 'Pronto!' : 'Não tenho dívidas'}</button>
    </div>`;
}

// ---------------- Tour guiado ----------------
const TOUR = [
  { sel: '#tourHero', tab: 'home', mood: 'feliz', text: 'Esse é o número mais importante: <b>quanto dá pra gastar hoje</b> sem se enrolar. Toca nele pra ver a conta.' },
  { sel: '#fab', tab: 'home', mood: 'feliz', text: 'Gastou? Toca no <b>+</b>, digita o valor e escolhe o emoji. Pronto.' },
  { sel: '[data-tab=debts]', tab: 'home', mood: 'calmo', text: 'Aqui eu monto o <b>plano pra sair das dívidas</b> e te digo qual pagar primeiro.' },
  { sel: '[data-tab=hist]', tab: 'home', mood: 'calmo', text: 'Tudo que você lançou fica no <b>Histórico</b>. Toca em qualquer item pra corrigir.' },
  { sel: '[data-tab=more]', tab: 'home', mood: 'feliz', text: 'Em <b>Mais</b> tem contas fixas, importar extrato e instalar no celular.' },
  { sel: null, tab: 'home', mood: 'festa', text: 'É isso! Um gasto por vez e a gente organiza tudo.' },
];
function startTour() { S.tour = { i: 0 }; S.tab = 'home'; S.sub = null; closeSheet(); render(); scrollTo(0, 0); }
function placeTour() {
  let ov = $('#tour');
  if (!ov) { ov = document.createElement('div'); ov.id = 'tour'; ov.dataset.act = 'tour-next'; document.body.appendChild(ov); }
  const step = TOUR[S.tour.i];
  const target = step.sel && $(step.sel);
  const r = target?.getBoundingClientRect();
  const pad8 = 8;
  const spot = r ? `<div class="tour-spot" style="left:${r.left - pad8}px;top:${r.top - pad8}px;width:${r.width + pad8 * 2}px;height:${r.height + pad8 * 2}px"></div>` : '<div class="tour-dim"></div>';
  const below = r && r.top + r.height / 2 < innerHeight / 2;
  const pos = !r ? 'top:50%;transform:translateY(-50%)' : below ? `top:${Math.min(r.bottom + 18, innerHeight - 240)}px` : `bottom:${innerHeight - r.top + 18}px`;
  ov.innerHTML = `${spot}<div class="tour-card" style="${pos}">
    ${say(step.mood, step.text, 64)}
    <div class="row between" style="margin-top:12px">
      <button class="btn ghost sm" data-act="tour-end">Pular</button>
      <span class="muted small">${S.tour.i + 1}/${TOUR.length}</span>
      <button class="btn primary sm" data-act="tour-next">${S.tour.i === TOUR.length - 1 ? 'Concluir' : 'Próximo'}</button>
    </div></div>`;
}
function endTour() { S.tour = null; $('#tour')?.remove(); mutate((d) => { d.settings.toured = true; }, { render: false }); }
window.addEventListener('resize', () => S.tour && placeTour());

// ======================================================================
// Painéis (sheets)
// ======================================================================
function openSheet(kind, extra = {}) {
  S.sheet = { kind, ...extra };
  $('#sheetWrap').hidden = false;
  renderSheet();
  buzz(8);
}
function closeSheet() {
  S.sheet = null;
  S.add = null;
  $('#sheetWrap').hidden = true;
}
function renderSheet() {
  if (!S.sheet) return;
  $('#sheet').innerHTML = { add: sheetAdd, plan: sheetPlan, debt: sheetDebt, debtForm: sheetDebtForm, pay: sheetPay, fixa: sheetFixa, income: sheetIncome, party: sheetParty }[S.sheet.kind]();
}

const catOptions = (sel, type) => S.data.categories
  .filter((c) => c.ignore || (type === 'receita' ? c.income : !c.income))
  .map((c) => `<option value="${esc(c.name)}" ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

function catsForPick(type) {
  const since = toISO(new Date(Date.now() - 90 * 864e5));
  const freq = {};
  for (const t of S.data.transactions) if (t.type === type && t.date >= since) freq[t.category] = (freq[t.category] || 0) + 1;
  return S.data.categories.filter((c) => !c.ignore && (type === 'receita' ? c.income : !c.income))
    .sort((a, b) => (freq[b.name] || 0) - (freq[a.name] || 0));
}

// --- lançar / editar
function openAdd(tx) {
  S.add = tx
    ? { editId: tx.id, type: tx.type, cents: String(Math.round(tx.amount * 100)), category: tx.category, desc: tx.desc, date: tx.date, text: false }
    : { type: 'despesa', cents: '', category: null, desc: '', date: todayISO(), text: false };
  openSheet('add');
}
function saveLabel(a, val) {
  return !val ? 'Digite o valor' : !a.category ? 'Escolha a categoria' : a.editId ? 'Salvar' : `Lançar ${fmt(val)}`;
}
function sheetAdd() {
  const a = S.add;
  const val = (+a.cents || 0) / 100;
  const today = todayISO(), yest = toISO(new Date(Date.now() - 864e5));
  const other = a.date !== today && a.date !== yest;
  if (a.text) return `
    <div class="row between"><h3>Digitar em texto</h3><button class="btn ghost sm" data-act="add-text">Teclado</button></div>
    <form data-form="quick" style="display:grid;gap:10px">
      <input class="input big" id="quickInput" placeholder="mercado 85,90" autocomplete="off" enterkeyhint="done">
      <div class="muted small" id="quickPreview">ex.: <b>uber 23 ontem</b> · <b>+ salário 3500</b> · <b>tênis 600 em 6x</b></div>
      <button class="btn primary big">Salvar</button>
    </form>`;
  return `
    <div class="row">
      <div class="seg grow" role="group" aria-label="Tipo">
        <button data-act="add-type" data-v="despesa" class="${a.type === 'despesa' ? 'on out' : ''}">Saída</button>
        <button data-act="add-type" data-v="receita" class="${a.type === 'receita' ? 'on in' : ''}">Entrada</button>
      </div>
      ${a.editId ? '' : '<button class="btn ghost sm" data-act="add-text" aria-label="Digitar em texto">' + icon('pen', 18) + '</button>'}
    </div>
    <div class="amount num ${val ? '' : 'zero'}" id="addAmount">${fmt(val)}</div>
    <div class="picks">${catsForPick(a.type).map((c) => `<button class="pick ${a.category === c.name ? 'on' : ''}" data-act="add-cat" data-cat="${esc(c.name)}"><span class="e">${catIcon(c.name, 22)}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
    <div class="chips">
      <button class="chip ${a.date === today ? 'on' : ''}" data-act="add-date" data-v="${today}">Hoje</button>
      <button class="chip ${a.date === yest ? 'on' : ''}" data-act="add-date" data-v="${yest}">Ontem</button>
      <label class="chip ${other ? 'on' : ''}">${icon('calendar', 16)} ${other ? fmtDate(a.date).slice(0, 5) : 'Outro dia'}<input type="date" data-act="add-date-pick" value="${a.date}" class="date-hidden"></label>
      <input class="chip-input" id="addDesc" placeholder="Descrição" value="${esc(a.desc)}" autocomplete="off" aria-label="Descrição (opcional)">
    </div>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-act="key" data-k="${n}">${n}</button>`).join('')}<button data-act="key" data-k="00">00</button><button data-act="key" data-k="0">0</button><button data-act="key" data-k="del" aria-label="Apagar">⌫</button></div>
    <button class="btn primary big" data-act="add-save" ${val > 0 && a.category ? '' : 'disabled'}>${saveLabel(a, val)}</button>
    ${a.editId ? '<button class="btn ghost danger" data-act="tx-del">Excluir lançamento</button>' : ''}`;
}
function updateAddLive() {
  const a = S.add;
  const val = (+a.cents || 0) / 100;
  const el = $('#addAmount');
  if (!el) return renderSheet();
  el.textContent = fmt(val);
  el.classList.toggle('zero', !val);
  const btn = $('[data-act=add-save]');
  btn.disabled = !(val > 0 && a.category);
  btn.textContent = saveLabel(a, val);
}
function saveAdd() {
  const a = S.add;
  const amount = (+a.cents || 0) / 100;
  if (!(amount > 0) || !a.category) return;
  const desc = (a.desc || '').trim() || a.category;
  if (a.editId) {
    const t = S.data.transactions.find((x) => x.id === a.editId);
    const catChanged = t.category !== a.category;
    mutate(() => Object.assign(touch(t), { type: a.type, amount, category: a.category, desc, date: a.date }), { render: false });
    if (catChanged) learnRule(desc, a.category);
    closeSheet(); render();
    toast(catChanged ? 'Salvo. Vou lembrar dessa categoria.' : 'Salvo');
  } else {
    const id = uid();
    mutate((d) => d.transactions.push(touch({ id, date: a.date, desc, amount, type: a.type, category: a.category, source: 'manual' })), { render: false });
    closeSheet(); render();
    buzz(20);
    toast(`${a.category} · ${fmt(amount)}`, () => mutate(() => removeItem('transactions', id)));
  }
}

// --- detalhe do "pode gastar"
function sheetPlan() {
  const p = monthPlan();
  const line = (e, l, v, cls = '') => `<div class="row between" style="padding:6px 0"><span>${l}</span><b class="num ${cls}">${v}</b></div>`;
  return `
    <h3>Como cheguei nesse número</h3>
    <section class="card" style="padding:10px 16px">
      ${line('', 'Entra no mês', fmt(p.income), 'pos')}
      ${line('', 'Contas fixas', `− ${fmt(p.fixedOut)}`)}
      ${p.debts ? line('', 'Dívidas (seu plano)', `− ${fmt(p.debts)}`) : ''}
      ${line('', 'Já gastou no dia a dia', `− ${fmt(p.spent)}`)}
      <hr style="border:0;border-top:1px solid var(--border);margin:6px 0">
      ${line('', 'Sobra', fmt(p.left), p.left < 0 ? 'neg' : '')}
      ${line('', `÷ ${p.daysLeft} dias`, `${fmt(Math.max(0, p.perDay))}/dia`)}
    </section>
    <div class="two"><button class="btn" data-act="income-open">Alterar renda</button><button class="btn" data-act="go-fixas">Contas fixas</button></div>
    <button class="btn primary big" data-act="sheet-close">Entendi</button>`;
}

function sheetIncome() {
  const r = S.data.recurring.find((x) => x.type === 'receita' && x.active);
  return `
    <h3>Renda mensal</h3>
    <input class="input big" id="incomeVal" inputmode="decimal" placeholder="R$ 0,00" value="${r ? brNum(r.amount) : ''}">
    <label class="field">Dia que cai<input class="input" id="incomeDay" inputmode="numeric" value="${r?.day || 5}"></label>
    <button class="btn primary big" data-act="income-save">Salvar</button>`;
}

function sheetParty() {
  return `<div style="text-align:center;display:grid;gap:10px;justify-items:center;padding:10px 0">
    <div class="float">${mascot('festa', 150)}</div>
    <h3 style="font-size:1.5rem">${esc(S.sheet.title)}</h3>
    <p class="muted">${esc(S.sheet.text)}</p>
    <button class="btn primary big" data-act="sheet-close">Continuar</button></div>`;
}

// --- dívidas
const RATE_PRESETS = [['Cartão', 14], ['Cheque especial', 8], ['Empréstimo', 5], ['Crediário', 4], ['Consignado', 1.8], ['Sem juros', 0]];
function sheetDebtForm() {
  const d = S.sheet.id ? S.data.debts.find((x) => x.id === S.sheet.id) : {};
  const rate = d.rate;
  return `
    <h3>${d.id ? 'Editar dívida' : 'Nova dívida'}</h3>
    <form data-form="debt" style="display:grid;gap:12px">
      <label class="field">Nome<input class="input" name="name" required value="${esc(d.name || '')}" placeholder="Cartão Nubank"></label>
      <label class="field">Quanto falta pagar hoje<input class="input big" name="balance" inputmode="decimal" required value="${brNum(d.balance)}" placeholder="R$ 0,00"></label>
      <div class="two">
        <label class="field">Parcela mínima<input class="input" name="minPayment" inputmode="decimal" required value="${brNum(d.minPayment)}" placeholder="R$"></label>
        <label class="field">Vence dia<input class="input" name="dueDay" inputmode="numeric" value="${d.dueDay || ''}" placeholder="10"></label>
      </div>
      <div class="field">Juros ao mês
        <div class="chips wrap" style="justify-content:flex-start">${RATE_PRESETS.map(([n, r]) => `<button type="button" class="chip ${rate != null && +rate === r ? 'on' : ''}" data-act="rate-pick" data-r="${r}">${n}${r ? ` ~${brNum(r)}%` : ''}</button>`).join('')}</div>
        <input class="input" name="rate" inputmode="decimal" value="${brNum(rate)}" placeholder="% ao mês (tá no app do banco)" required>
      </div>
      <button class="btn primary big">Salvar</button>
      ${d.id ? '<button type="button" class="btn ghost danger" data-act="debt-del">Excluir dívida</button>' : ''}
    </form>`;
}
function sheetDebt() {
  const d = S.data.debts.find((x) => x.id === S.sheet.id);
  const o = Math.max(+d.original || 0, +d.balance);
  const ord = plan().order?.find((x) => x.id === d.id);
  return `
    <h3>${esc(d.name)}</h3>
    <div class="amount num">${fmt(d.balance)}</div>
    <div class="bar" style="height:10px"><div style="width:${o ? ((o - d.balance) / o) * 100 : 0}%"></div></div>
    <div class="live">
      <div class="stat"><small>juros</small><b>${brNum(d.rate)}% a.m.</b></div>
      <div class="stat"><small>${ord ? 'quita em' : 'mínimo'}</small><b>${ord ? whenFree(ord.month) : fmt(d.minPayment)}</b></div>
    </div>
    ${d.balance > 0 ? `<button class="btn primary big" data-act="debt-pay" data-id="${d.id}">Registrar pagamento</button>` : ''}
    <button class="btn big" data-act="debt-edit" data-id="${d.id}">Editar</button>`;
}
function sheetPay() {
  const d = S.data.debts.find((x) => x.id === S.sheet.id);
  const sug = Math.min(+d.balance, plan().firstMonth?.find((x) => x.id === d.id)?.pay || +d.minPayment);
  const v = S.sheet.value ?? sug;
  const chip = (l, x) => `<button class="chip ${Math.abs(v - x) < 0.01 ? 'on' : ''}" data-act="pay-pick" data-v="${x}">${l} ${fmt(x)}</button>`;
  return `
    <h3>Pagamento · ${esc(d.name)}</h3>
    <input class="input big" id="payVal" inputmode="decimal" value="${brNum(Math.round(v * 100) / 100)}">
    <div class="chips wrap">
      ${chip('Plano', sug)}${Math.abs(sug - d.minPayment) > 0.01 && +d.minPayment < +d.balance ? chip('Mínimo', +d.minPayment) : ''}${chip('Quitar', +d.balance)}
    </div>
    <button class="btn primary big" data-act="pay-save">Confirmar</button>`;
}

// --- contas fixas
function sheetFixa() {
  const r = S.sheet.id ? S.data.recurring.find((x) => x.id === S.sheet.id) : null;
  const f = S.sheet.form || (S.sheet.form = r ? { ...r } : { type: 'despesa', desc: '', amount: '', day: 10, category: 'Contas' });
  return `
    <h3>${r ? 'Conta fixa' : 'Nova conta fixa'}</h3>
    <div class="seg"><button data-act="fixa-type" data-v="despesa" class="${f.type === 'despesa' ? 'on out' : ''}">Saída</button><button data-act="fixa-type" data-v="receita" class="${f.type === 'receita' ? 'on in' : ''}">Entrada</button></div>
    <form data-form="fixa" style="display:grid;gap:12px">
      <label class="field">Nome<input class="input" name="desc" required value="${esc(f.desc)}" placeholder="Aluguel"></label>
      <div class="two">
        <label class="field">Valor<input class="input" name="amount" inputmode="decimal" required value="${brNum(f.amount)}"></label>
        <label class="field">Dia<input class="input" name="day" inputmode="numeric" required value="${f.day}"></label>
      </div>
      <div class="picks">${catsForPick(f.type).map((c) => `<button type="button" class="pick ${f.category === c.name ? 'on' : ''}" data-act="fixa-cat" data-cat="${esc(c.name)}"><span class="e">${catIcon(c.name, 22)}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
      <button class="btn primary big">Salvar</button>
      ${r ? `<div class="two"><button type="button" class="btn" data-act="fixa-toggle">${r.active ? 'Pausar' : 'Ativar'}</button><button type="button" class="btn danger" data-act="fixa-del">Excluir</button></div>` : ''}
    </form>`;
}
function syncFixaForm() {
  const form = $('form[data-form=fixa]');
  if (!form || !S.sheet?.form) return;
  const fd = Object.fromEntries(new FormData(form));
  Object.assign(S.sheet.form, { desc: fd.desc, amount: fd.amount, day: fd.day });
}

// ======================================================================
// Ações
// ======================================================================
function learnRule(desc, category) {
  const key = ruleKey(desc);
  if (key.length < 3 || norm(desc) === norm(category)) return 0;
  let n = 0;
  mutate((d) => {
    const ex = d.userRules.find((r) => r.match === key);
    if (ex) { ex.category = category; touch(ex); } else d.userRules.unshift(touch({ id: uid(), match: key, category }));
    for (const t of d.transactions) if (ruleKey(t.desc) === key && t.category !== category) { t.category = category; touch(t); n++; }
  }, { render: false });
  return n;
}

function handleQuick(text) {
  const r = parseQuick(text, { userRules: S.data.userRules, categories: S.data.categories });
  if (r.error) { toast(r.error); return; }
  const ids = [];
  mutate((d) => {
    const n = r.installments;
    const [y, m, dd] = r.date.split('-');
    for (let i = 0; i < n; i++) {
      const mk = addMonths(`${y}-${m}`, i);
      const id = uid(); ids.push(id);
      d.transactions.push(touch({
        id, date: `${mk}-${pad(Math.min(+dd, daysInMonth(mk)))}`, desc: n > 1 ? `${r.desc} (${i + 1}/${n})` : r.desc,
        amount: Math.round((r.amount / n) * 100) / 100, type: r.type, category: r.category, source: 'rapido',
      }));
    }
  }, { render: false });
  closeSheet(); render(); buzz(20);
  toast(`${r.desc} · ${fmt(r.amount)}${r.installments > 1 ? ` em ${r.installments}x` : ''}`, () => mutate(() => ids.forEach((id) => removeItem('transactions', id))));
}

function deleteTx(id) {
  const t = S.data.transactions.find((x) => x.id === id);
  if (!t) return;
  const snapshot = structuredClone(S.data);
  mutate((d) => {
    if (t.debtPaymentId) {
      const pmt = d.debtPayments.find((p) => p.id === t.debtPaymentId);
      const debt = pmt && d.debts.find((x) => x.id === pmt.debtId);
      if (debt) { debt.balance = Math.round((+debt.balance + pmt.amount) * 100) / 100; touch(debt); }
      if (pmt) removeItem('debtPayments', pmt.id);
    }
    removeItem('transactions', id);
  }, { render: false });
  closeSheet(); render();
  toast('Lançamento excluído', () => { const del = S.data.deleted; S.data = snapshot; S.data.deleted = { ...del }; delete S.data.deleted[id]; mutate(() => {}); });
}

function payDebt(id, amount, date = todayISO()) {
  const d = S.data.debts.find((x) => x.id === id);
  const pid = uid();
  mutate((data) => {
    d.balance = Math.max(0, Math.round((d.balance - amount) * 100) / 100);
    touch(d);
    data.debtPayments.push(touch({ id: pid, debtId: d.id, date, amount }));
    data.transactions.push(touch({ id: uid(), date, desc: `Pagamento ${d.name}`, amount, type: 'despesa', category: 'Dívidas', source: 'divida', debtPaymentId: pid }));
  }, { render: false });
  closeSheet(); render();
  if (d.balance <= 0) {
    confetti(); buzz([30, 40, 30]); $('#toast').classList.remove('show');
    const left = debtsActive().length;
    openSheet('party', { title: `Quitou: ${d.name}!`, text: left ? `Menos uma! Faltam ${left}. A parcela dela agora reforça a próxima.` : 'Era a última. Você está livre de dívidas.' });
  } else { buzz(20); toast(`Faltam ${fmt(d.balance)} em ${d.name}`); }
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(S.data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ofi-backup-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function readFiles(files) {
  const raw = [];
  let looksLikeCard = false;
  for (const f of files) {
    const buf = await f.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    looksLikeCard ||= parseStatement(text).looksLikeCard;
    raw.push(text);
  }
  S.importPreview = { cardMode: looksLikeCard, raw };
  buildPreview();
  render();
}
function buildPreview() {
  const pv = S.importPreview;
  const existing = new Set(S.data.transactions.map((t) => t.importKey).filter(Boolean));
  const fixed = S.data.transactions.filter((t) => t.source === 'fixa');
  const seen = new Set();
  pv.items = [];
  for (const text of pv.raw) {
    for (const it of parseStatement(text, { cardMode: pv.cardMode, userRules: S.data.userRules, categories: S.data.categories }).items) {
      let dupWhy = existing.has(it.importKey) || seen.has(it.importKey) ? 'já importado' : '';
      // não contar duas vezes uma conta fixa que já entrou sozinha
      const fx = !dupWhy && fixed.find((f) => f.type === it.type && monthKey(f.date) === monthKey(it.date) && Math.abs(f.amount - it.amount) <= Math.max(0.5, f.amount * 0.01));
      if (fx) dupWhy = `parece "${fx.desc}" (fixa)`;
      seen.add(it.importKey);
      pv.items.push({ ...it, dup: !!dupWhy, dupWhy, include: !dupWhy });
    }
  }
  pv.items.sort((a, b) => b.date.localeCompare(a.date));
}

let toastT;
let toastUndo = null;
function toast(msg, undo) {
  const el = $('#toast');
  toastUndo = undo || null;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Desfazer</button>' : ''}`;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.classList.remove('show'); toastUndo = null; }, undo ? 5000 : 2800);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#1c1c1e', '#8c8278', '#b08d57', '#d8d2c8', '#5f5750'];
  for (let i = 0; i < 60; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.style.left = `${Math.random() * 100}vw`;
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = `${Math.random() * 0.4}s`;
    s.style.animationDuration = `${1.2 + Math.random() * 0.8}s`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 2600);
  }
}

function finishOnboarding() {
  const o = S.onb;
  mutate((d) => {
    const inc = money(o.income);
    if (inc) d.recurring.push(touch({ id: uid(), desc: 'Salário', amount: inc, day: o.payDay || 5, type: 'receita', category: 'Salário', active: true, startMonth: cur() }));
    for (const [n, v] of Object.entries(o.fixas)) {
      const a = money(v.amount);
      if (!a) continue;
      d.recurring.push(touch({ id: uid(), desc: n, amount: a, day: Math.min(31, Math.max(1, +v.day || 10)), type: 'despesa', category: PRESET_FIXAS.find((p) => p[0] === n)[2], active: true, startMonth: cur() }));
    }
    d.settings.onboarded = true;
    generateRecurring();
  }, { render: false });
  S.onb = null;
  if (!S.cfg) { S.cfg = { mode: 'local' }; saveConfig(S.cfg); }
  confetti();
  startTour();
}

// ======================================================================
// Eventos
// ======================================================================
document.addEventListener('click', (e) => {
  if (S.tour) {
    const t = e.target.closest('[data-act]');
    if (t?.dataset.act === 'tour-end') return endTour();
    if (++S.tour.i >= TOUR.length) return endTour();
    return placeTour();
  }
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { S.tab = tabBtn.dataset.tab; S.sub = null; S.slider = null; render(); scrollTo(0, 0); buzz(5); return; }
  const go = e.target.closest('[data-goto]');
  if (go) { S.tab = go.dataset.goto; S.sub = null; render(); scrollTo(0, 0); return; }
  if (e.target.matches?.('.date-hidden')) { try { e.target.showPicker(); } catch {} return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const { act, id } = el.dataset;
  const a = S.add;

  switch (act) {
    case 'undo': toastUndo?.(); toastUndo = null; $('#toast').classList.remove('show'); break;
    case 'sheet-close': closeSheet(); render(); break;
    case 'sync-now': if (isGitHub()) (S.dirty ? sync() : pull()); else { S.tab = 'more'; S.sub = 'sync'; render(); } break;
    case 'tour-start': startTour(); break;

    case 'add-open': openAdd(); break;
    case 'add-type': a.type = el.dataset.v; a.category = null; renderSheet(); break;
    case 'add-cat': a.category = el.dataset.cat; buzz(6); document.querySelectorAll('.pick').forEach((p) => p.classList.toggle('on', p === el)); updateAddLive(); break;
    case 'add-date': a.date = el.dataset.v; renderSheet(); break;
    case 'add-text': a.text = !a.text; renderSheet(); if (a.text) $('#quickInput')?.focus(); break;
    case 'key': {
      const k = el.dataset.k;
      if (k === 'del') a.cents = a.cents.slice(0, -1);
      else if (a.cents.length < 9) a.cents = (a.cents + k).replace(/^0+/, '');
      buzz(4); updateAddLive();
      break;
    }
    case 'add-save': saveAdd(); break;
    case 'tx-open': { const t = S.data.transactions.find((x) => x.id === id); if (t) openAdd(t); break; }
    case 'tx-del': deleteTx(S.add.editId); break;

    case 'plan-open': openSheet('plan'); break;
    case 'income-open': openSheet('income'); break;
    case 'income-save': {
      const v = money($('#incomeVal').value);
      if (!v) { toast('Digite um valor'); break; }
      const day = Math.min(31, Math.max(1, +$('#incomeDay').value || 5));
      mutate((d) => {
        const r = d.recurring.find((x) => x.type === 'receita' && x.active);
        if (r) Object.assign(touch(r), { amount: v, day });
        else d.recurring.push(touch({ id: uid(), desc: 'Salário', amount: v, day, type: 'receita', category: 'Salário', active: true, startMonth: cur() }));
        generateRecurring();
      }, { render: false });
      closeSheet(); render(); toast('Renda salva');
      break;
    }
    case 'go-fixas': closeSheet(); S.tab = 'more'; S.sub = 'fixas'; render(); break;
    case 'hist-cat': S.tab = 'hist'; S.histMonth = cur(); S.histFilter = el.dataset.cat; render(); scrollTo(0, 0); break;

    case 'hist-prev': S.histMonth = addMonths(S.histMonth, -1); render(); break;
    case 'hist-next': if (S.histMonth < cur()) { S.histMonth = addMonths(S.histMonth, 1); render(); } break;
    case 'hist-filter': S.histFilter = el.dataset.f; render(); break;

    case 'debt-new': openSheet('debtForm'); break;
    case 'debt-open': openSheet('debt', { id }); break;
    case 'debt-edit': openSheet('debtForm', { id }); break;
    case 'debt-pay': openSheet('pay', { id }); break;
    case 'rate-pick': {
      $('form[data-form=debt] [name=rate]').value = brNum(+el.dataset.r);
      el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el));
      break;
    }
    case 'debt-del':
      if (confirmTap(el, 'Toque de novo pra excluir')) { mutate(() => removeItem('debts', S.sheet.id), { render: false }); closeSheet(); render(); }
      break;
    case 'pay-pick': S.sheet.value = +el.dataset.v; renderSheet(); break;
    case 'pay-save': {
      const v = money($('#payVal').value);
      if (!v) { toast('Digite o valor'); break; }
      payDebt(S.sheet.id, v);
      break;
    }
    case 'strategy': mutate((d) => { d.settings.strategy = el.dataset.v; }); break;

    case 'sub': S.sub = el.dataset.k; render(); scrollTo(0, 0); break;
    case 'sub-back': S.sub = null; S.importPreview = null; render(); break;
    case 'fixa-new': openSheet('fixa'); break;
    case 'fixa-open': openSheet('fixa', { id }); break;
    case 'fixa-type': syncFixaForm(); S.sheet.form.type = el.dataset.v; S.sheet.form.category = el.dataset.v === 'receita' ? 'Salário' : 'Contas'; renderSheet(); break;
    case 'fixa-cat': syncFixaForm(); S.sheet.form.category = el.dataset.cat; renderSheet(); break;
    case 'fixa-toggle': mutate((d) => { const r = d.recurring.find((x) => x.id === S.sheet.id); r.active = !r.active; touch(r); generateRecurring(); }, { render: false }); closeSheet(); render(); break;
    case 'fixa-del': if (confirmTap(el, 'Toque de novo')) { mutate(() => removeItem('recurring', S.sheet.id), { render: false }); closeSheet(); render(); } break;
    case 'imp-cancel': S.importPreview = null; render(); break;
    case 'imp-confirm': {
      const sel = S.importPreview.items.filter((i) => i.include);
      mutate((d) => { for (const { date, desc, amount, type, category, importKey } of sel) d.transactions.push(touch({ id: uid(), date, desc, amount, type, category, importKey, source: 'import' })); }, { render: false });
      S.importPreview = null; S.tab = 'hist'; S.sub = null; S.histFilter = 'all';
      if (sel.length) S.histMonth = sel.map((i) => monthKey(i.date)).sort().pop();
      render(); toast(`${sel.length} lançamentos importados`);
      break;
    }
    case 'cat-del': {
      const name = el.dataset.name;
      if (S.data.transactions.some((t) => t.category === name)) { toast('Tem lançamentos nela'); break; }
      mutate((d) => { d.categories = d.categories.filter((c) => c.name !== name); });
      break;
    }
    case 'install': installEvt?.prompt(); installEvt?.userChoice.then(() => { installEvt = null; render(); }); break;
    case 'export': exportBackup(); break;
    case 'disconnect':
      if (confirmTap(el, 'Toque de novo pra confirmar')) { clearConfig(); S.cfg = { mode: 'local' }; saveConfig(S.cfg); setStatus('local'); render(); }
      break;

    case 'onb-next':
      if (S.onb.step === 1) S.onb.income = $('#onbIncome')?.value || '';
      S.onb.step++; render(); scrollTo(0, 0);
      break;
    case 'onb-skip': S.onb.income = ''; S.onb.step++; render(); break;
    case 'onb-day': S.onb.income = $('#onbIncome')?.value || ''; S.onb.payDay = +el.dataset.d; render(); break;
    case 'onb-fixa': {
      const n = el.dataset.n;
      if (S.onb.fixas[n]) delete S.onb.fixas[n]; else S.onb.fixas[n] = { amount: '', day: '' };
      render();
      $(`[data-onb-fixa="${n}"]`)?.focus();
      break;
    }
    case 'onb-finish': finishOnboarding(); break;
    case 'onb-cloud': S.onb = null; S.cfg = { mode: 'local' }; saveConfig(S.cfg); S.tab = 'more'; S.sub = 'sync'; render(); break;
  }
});

function confirmTap(el, msg) {
  if (el.dataset.armed) return true;
  el.dataset.armed = '1';
  const old = el.textContent;
  el.textContent = msg;
  setTimeout(() => { delete el.dataset.armed; el.textContent = old; }, 3000);
  return false;
}

document.addEventListener('change', async (e) => {
  const el = e.target;
  switch (el.dataset.act) {
    case 'add-date-pick': if (el.value) { S.add.date = el.value; renderSheet(); } break;
    case 'imp-inc': S.importPreview.items[+el.dataset.i].include = el.checked; render(); break;
    case 'imp-cat': S.importPreview.items[+el.dataset.i].category = el.value; break;
    case 'card-mode': S.importPreview.cardMode = el.checked; buildPreview(); render(); break;
    case 'cat-limit': {
      const v = el.value.trim() ? money(el.value) : 0;
      mutate((d) => { d.categories.find((c) => c.name === el.dataset.name).limit = v || 0; }, { render: false });
      toast('Limite salvo');
      break;
    }
    case 'restore': {
      const f = el.files[0];
      if (!f) break;
      try { const data = normalizeData(JSON.parse(await f.text())); mutate((d) => Object.assign(d, data)); toast('Backup restaurado'); }
      catch { toast('Arquivo inválido'); }
      break;
    }
  }
  if (el.id === 'fileInput' && el.files.length) readFiles([...el.files]);
  if (el.id === 'debtSlider') { mutate((d) => { d.settings.debtBudget = +el.value; }, { render: false }); }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'addDesc') S.add.desc = el.value;
  if (el.id === 'debtSlider') {
    S.slider = +el.value;
    $('#sliderVal').textContent = fmt(S.slider);
    $('#debtLive').innerHTML = debtLive(S.slider);
  }
  if (el.id === 'quickInput') {
    const r = parseQuick(el.value, { userRules: S.data.userRules, categories: S.data.categories });
    $('#quickPreview').innerHTML = !el.value.trim() ? 'ex.: <b>uber 23 ontem</b> · <b>+ salário 3500</b>'
      : r.error ? esc(r.error) : `${emo(r.category)} <b>${esc(r.desc)}</b> · ${fmt(r.amount)}${r.installments > 1 ? ` em ${r.installments}x` : ''} · ${fmtDate(r.date).slice(0, 5)} · ${r.type === 'receita' ? 'entrada' : esc(r.category)}`;
  }
  if (el.dataset.onbFixa) S.onb.fixas[el.dataset.onbFixa].amount = el.value;
  if (el.dataset.onbDia) S.onb.fixas[el.dataset.onbDia].day = el.value;
  if (el.id === 'onbIncome') S.onb.income = el.value;
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form));
  switch (form.dataset.form) {
    case 'quick': handleQuick($('#quickInput').value); break;
    case 'debt': {
      const balance = money(fd.balance), minPayment = money(fd.minPayment), rate = money(fd.rate);
      if (balance == null || minPayment == null || rate == null) { toast('Confere os valores'); break; }
      const d = S.sheet.id ? S.data.debts.find((x) => x.id === S.sheet.id) : null;
      mutate((data) => {
        const v = { name: fd.name.trim(), balance, rate, minPayment, dueDay: fd.dueDay ? Math.min(31, +fd.dueDay) : null };
        if (d) Object.assign(touch(d), v, { original: Math.max(+d.original || 0, balance) });
        else data.debts.push(touch({ id: uid(), ...v, original: balance, createdAt: todayISO() }));
      }, { render: false });
      closeSheet(); render(); toast(d ? 'Salvo' : 'Dívida adicionada');
      break;
    }
    case 'fixa': {
      const amount = money(fd.amount);
      if (!amount) { toast('Digite o valor'); break; }
      const f = S.sheet.form;
      const v = { desc: fd.desc.trim(), amount, day: Math.min(31, Math.max(1, +fd.day || 1)), type: f.type, category: f.category };
      mutate((d) => {
        const r = S.sheet.id && d.recurring.find((x) => x.id === S.sheet.id);
        if (r) Object.assign(touch(r), v);
        else d.recurring.push(touch({ id: uid(), ...v, active: true, startMonth: cur() }));
        generateRecurring();
      }, { render: false });
      closeSheet(); render(); toast('Conta fixa salva');
      break;
    }
    case 'cat-new': {
      const name = fd.name.trim();
      if (S.data.categories.some((c) => norm(c.name) === norm(name))) { toast('Já existe'); break; }
      mutate((d) => { d.categories.splice(d.categories.findIndex((c) => c.income || c.ignore), 0, { name, emoji: '', limit: 0 }); });
      break;
    }
    case 'cfg': {
      const token = fd.token.trim() || S.cfg?.token;
      if (!token) { toast('Cole o token'); break; }
      const cfg = { mode: 'github', owner: fd.owner.trim(), repo: fd.repo.trim(), path: fd.path || 'dados.json', token };
      setStatus('saving');
      try {
        const r = await remoteLoad(cfg);
        S.cfg = cfg; saveConfig(cfg);
        const hasLocal = S.data.transactions.length || S.data.debts.length || S.data.recurring.length;
        if (r.data) S.data = hasLocal ? merge(S.data, r.data) : r.data;
        S.sha = r.sha; S.dirty = true;
        persistCache(); generateRecurring();
        await sync();
        if (S.status === 'ok') { toast('Conectado à nuvem'); confetti(); }
        render();
      } catch (err) { setStatus(isGitHub() ? 'error' : 'local', err.message); toast(err.message); }
      break;
    }
  }
});

// fechar painel arrastando pra baixo
let dragY = null;
const sheetEl = $('#sheet');
sheetEl.addEventListener('touchstart', (e) => { if (sheetEl.scrollTop <= 0 && !e.target.closest('input, .keypad, .picks, .chips')) dragY = e.touches[0].clientY; }, { passive: true });
sheetEl.addEventListener('touchmove', (e) => { if (dragY != null) sheetEl.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - dragY)}px)`; }, { passive: true });
sheetEl.addEventListener('touchend', (e) => {
  if (dragY == null) return;
  const dy = e.changedTouches[0].clientY - dragY;
  dragY = null;
  sheetEl.style.transform = '';
  if (dy > 110) { closeSheet(); render(); }
});

// teclado físico
document.addEventListener('keydown', (e) => {
  if (S.tour) { if (e.key === 'Escape') endTour(); else if (e.key === 'Enter' || e.key === 'ArrowRight') { if (++S.tour.i >= TOUR.length) endTour(); else placeTour(); } return; }
  if (e.key === 'Escape' && S.sheet) { closeSheet(); render(); return; }
  if (S.sheet?.kind === 'add' && !S.add.text && !e.target.closest('input, textarea')) {
    if (/^\d$/.test(e.key)) { e.preventDefault(); if (S.add.cents.length < 9) S.add.cents = (S.add.cents + e.key).replace(/^0+/, ''); updateAddLive(); }
    else if (e.key === 'Backspace') { e.preventDefault(); S.add.cents = S.add.cents.slice(0, -1); updateAddLive(); }
    else if (e.key === 'Enter') { e.preventDefault(); saveAdd(); }
    return;
  }
  if (!S.sheet && !S.onb && (e.key === '+' || e.key === 'n') && !e.target.closest('input, textarea, select')) { e.preventDefault(); openAdd(); }
});

// arrastar arquivo
document.addEventListener('dragover', (e) => { const d = e.target.closest?.('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', (e) => e.target.closest?.('#drop')?.classList.remove('over'));
document.addEventListener('drop', (e) => {
  const d = e.target.closest?.('#drop');
  if (!d) return;
  e.preventDefault();
  if (e.dataTransfer.files.length) readFiles([...e.dataTransfer.files]);
});

// tooltip do gráfico
document.addEventListener('pointermove', (e) => {
  const tip = $('#tip');
  const svg = e.target.classList?.contains('hit') ? e.target.closest('svg') : null;
  if (!svg) { if (!tip.hidden) { tip.hidden = true; document.querySelectorAll('svg .xh, svg .dot').forEach((n) => n.setAttribute('opacity', 0)); } return; }
  const series = JSON.parse(svg.dataset.series);
  const [L, R, W, H, T, B] = ['l', 'r', 'w', 'h', 't', 'b'].map((k) => +svg.dataset[k]);
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const n = series.length - 1;
  const i = Math.max(0, Math.min(n, Math.round(((p.x - L) / (W - L - R)) * n)));
  const x = L + (i / n) * (W - L - R);
  const y = T + (1 - series[i] / (Math.max(...series) || 1)) * (H - T - B);
  const xh = svg.querySelector('.xh'); xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('opacity', 0.35);
  const dot = svg.querySelector('.dot'); dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('opacity', 1);
  tip.textContent = `${i === 0 ? 'Hoje' : whenFree(i)}: ${fmt(series[i])}`;
  tip.hidden = false;
  tip.style.left = `${Math.min(e.clientX + 12, innerWidth - 190)}px`;
  tip.style.top = `${e.clientY - 38}px`;
});

// ======================================================================
// Início do app
// ======================================================================
document.title = APP_NAME;
$('#appName').textContent = APP_NAME;
const hasData = S.data.transactions.length || S.data.debts.length || S.data.recurring.length;
if (!S.data.settings.onboarded && !hasData && !isGitHub()) S.onb = { step: 0, income: '', payDay: 5, fixas: {} };
setStatus(isGitHub() ? (S.dirty ? 'saving' : 'ok') : 'local');
generateRecurring();
render();
if (isGitHub()) pull();
if (new URLSearchParams(location.search).has('add') && !S.onb) openAdd();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

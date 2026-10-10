// Armazenamento: cache no navegador + sincronização com um repositório PRIVADO do GitHub.
// O arquivo de dados é um JSON único (ex.: dados.json) gravado pela API de conteúdo do GitHub.
import { DEFAULT_CATEGORIES } from './categorias.js';

const CFG_KEY = 'financas.cfg';
const CACHE_KEY = 'financas.cache';
const COLLECTIONS = ['transactions', 'recurring', 'debts', 'debtPayments', 'userRules'];

export function emptyData() {
  return {
    version: 1,
    updatedAt: Date.now(),
    transactions: [],
    recurring: [],
    debts: [],
    debtPayments: [],
    userRules: [],
    deleted: {},
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: { strategy: 'avalanche', debtBudget: 0 },
  };
}

export function normalizeData(d) {
  const base = emptyData();
  const out = { ...base, ...(d || {}) };
  for (const c of COLLECTIONS) if (!Array.isArray(out[c])) out[c] = [];
  if (!out.deleted || typeof out.deleted !== 'object') out.deleted = {};
  if (!Array.isArray(out.categories) || !out.categories.length) out.categories = base.categories;
  out.categories = out.categories.map((c) => ({ ...c, emoji: c.emoji || base.categories.find((b) => b.name === c.name)?.emoji || '🏷️' }));
  out.settings = { ...base.settings, ...(out.settings || {}) };
  return out;
}

// ---------- configuração local (token fica SÓ neste navegador) ----------
const safe = (fn, fb) => { try { return fn(); } catch { return fb; } };
export const loadConfig = () => safe(() => JSON.parse(localStorage.getItem(CFG_KEY)) || null, null);
export const saveConfig = (cfg) => safe(() => localStorage.setItem(CFG_KEY, JSON.stringify(cfg)));
export const clearConfig = () => safe(() => localStorage.removeItem(CFG_KEY));
export const loadCache = () => safe(() => JSON.parse(localStorage.getItem(CACHE_KEY)) || null, null);
export const saveCache = (state) => safe(() => localStorage.setItem(CACHE_KEY, JSON.stringify(state)));

// ---------- base64 com UTF-8 ----------
export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------- API do GitHub ----------
const API = 'https://api.github.com';
const url = (cfg) =>
  `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;
const headers = (cfg, accept = 'application/vnd.github+json') => ({
  Authorization: `Bearer ${cfg.token}`,
  Accept: accept,
  'X-GitHub-Api-Version': '2022-11-28',
});

export class GitHubError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function explain(res) {
  let body = '';
  try { body = (await res.json()).message || ''; } catch {}
  const map = {
    401: 'Token inválido ou expirado.',
    403: 'O token não tem permissão de escrita nesse repositório (Contents: Read and write).',
    404: 'Repositório não encontrado (confira usuário/nome e se o token tem acesso a ele).',
    409: 'Os dados mudaram em outro dispositivo.',
    422: 'O GitHub recusou a gravação.',
  };
  return new GitHubError(res.status, `${map[res.status] || 'Erro no GitHub'} ${body ? `(${body})` : ''}`.trim());
}

/** Lê o arquivo. Retorna { data, sha } ou { data: null, sha: null } se ainda não existe. */
export async function remoteLoad(cfg) {
  const q = cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : '';
  const res = await fetch(url(cfg) + q, { headers: headers(cfg), cache: 'no-store' });
  if (res.status === 404) {
    // pode ser "arquivo não existe" (ok) ou "repo não existe" (erro)
    const repo = await fetch(`${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`, { headers: headers(cfg) });
    if (!repo.ok) throw await explain(repo);
    return { data: null, sha: null };
  }
  if (!res.ok) throw await explain(res);
  const meta = await res.json();
  let text;
  if (meta.content) text = b64decode(meta.content);
  else {
    // arquivos > 1 MB vêm sem conteúdo; busca bruto
    const raw = await fetch(url(cfg) + q, { headers: headers(cfg, 'application/vnd.github.raw+json'), cache: 'no-store' });
    if (!raw.ok) throw await explain(raw);
    text = await raw.text();
  }
  return { data: normalizeData(JSON.parse(text)), sha: meta.sha };
}

export async function remoteSave(cfg, data, sha, message = 'Atualiza finanças') {
  const body = { message, content: b64encode(JSON.stringify(data, null, 1)) };
  if (sha) body.sha = sha;
  if (cfg.branch) body.branch = cfg.branch;
  const res = await fetch(url(cfg), { method: 'PUT', headers: { ...headers(cfg), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw await explain(res);
  const j = await res.json();
  return j.content.sha;
}

// ---------- mesclagem (para quando PC e celular editam ao mesmo tempo) ----------
// Cada item tem id + updatedAt. Exclusões ficam registradas em data.deleted[id] = timestamp.
export function merge(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const out = normalizeData({ ...remote });
  out.deleted = { ...remote.deleted };
  for (const [id, t] of Object.entries(local.deleted || {})) out.deleted[id] = Math.max(t, out.deleted[id] || 0);
  for (const c of COLLECTIONS) {
    const map = new Map();
    for (const it of remote[c] || []) map.set(it.id, it);
    for (const it of local[c] || []) {
      const r = map.get(it.id);
      if (!r || (it.updatedAt || 0) >= (r.updatedAt || 0)) map.set(it.id, it);
    }
    out[c] = [...map.values()].filter((it) => !(out.deleted[it.id] >= (it.updatedAt || 0)));
  }
  // configurações e categorias: vence o mais recente
  const newer = (local.updatedAt || 0) >= (remote.updatedAt || 0) ? local : remote;
  out.categories = newer.categories;
  out.settings = newer.settings;
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  // limpa registros de exclusão com mais de 90 dias
  const cutoff = Date.now() - 90 * 864e5;
  for (const [id, t] of Object.entries(out.deleted)) if (t < cutoff) delete out.deleted[id];
  return out;
}

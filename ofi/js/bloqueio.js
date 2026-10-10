// OFI — bloqueio do app (PIN de 4 dígitos + biometria do aparelho).
// Tudo fica só neste aparelho (localStorage). Não é login: protege contra quem pega o celular/PC aberto.
const KEY = 'ofi.lock';
const AWAY_MS = 30000;          // volta a pedir depois de 30 s fora do app
const ITER = 150000;
const enc = new TextEncoder();

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const write = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } };

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPin(pin, saltB64) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: ITER }, base, 256);
  return b64(bits);
}

export const lockState = () => { const c = read(); return { on: !!c?.hash, bio: !!c?.bio }; };

export async function bioSupported() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}

async function verifyPin(pin) {
  const c = read();
  if (!c?.hash) return true;
  return (await hashPin(pin, c.salt)) === c.hash;
}

export async function setPin(pin) {
  const old = read() || {};
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  write({ ...old, salt, hash: await hashPin(pin, salt), fails: 0, until: 0 });
}

export function removeLock() { write(null); document.documentElement.removeAttribute('data-locked'); }

export async function enableBio() {
  const c = read(); if (!c?.hash) return false;
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'OFI' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'ofi', displayName: 'OFI' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    } });
    if (!cred) return false;
    write({ ...c, bio: b64(cred.rawId) });
    return true;
  } catch { return false; }
}
export function disableBio() { const c = read(); if (c) { delete c.bio; write(c); } }

async function bioUnlock() {
  const c = read(); if (!c?.bio) return false;
  try {
    const r = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(c.bio) }],
      userVerification: 'required', timeout: 60000,
    } });
    return !!r;
  } catch { return false; }
}

// ---------------- tela do PIN ----------------
let el = null;
const root = document.documentElement;

function ui() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'lock'; el.className = 'lock'; el.hidden = true;
  el.innerHTML = `
    <div class="lock-in">
      <img src="img/ofi-calmo.png" alt="" width="84" height="84" class="lock-img">
      <h1 id="lockTitle"></h1>
      <p class="muted small" id="lockMsg"></p>
      <div class="pin-dots" id="pinDots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="keypad lock-pad" id="lockPad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <button type="button" data-k="bio" id="lockBio" aria-label="Usar biometria"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M17 21h2a2 2 0 0 0 2-2v-2M9 10v1M15 10v1M12 10v4h-1M9.5 16.5c1.4 1 3.6 1 5 0"/></svg></button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k="del" aria-label="Apagar"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6"/></svg></button>
      </div>
      <button type="button" class="btn ghost" id="lockExtra"></button>
    </div>`;
  document.body.appendChild(el);
  return el;
}

// Pede um PIN. mode: 'unlock' | 'new' (digita 2x) | 'check' (confirma o PIN atual). Devolve o PIN ou null (cancelou).
function askPin({ mode, title, msg, cancel, bio, forgot }) {
  const box = ui();
  return new Promise((resolve) => {
    let buf = '', first = null, busy = false, timer = null;
    const $ = (s) => box.querySelector(s);
    const t = $('#lockTitle'), m = $('#lockMsg'), dots = [...box.querySelectorAll('#pinDots i')], extra = $('#lockExtra'), bioBtn = $('#lockBio');
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < buf.length));
    const say = (a, b) => { t.textContent = a; m.textContent = b || ''; };
    const shake = () => { $('#pinDots').classList.remove('shake'); void $('#pinDots').offsetWidth; $('#pinDots').classList.add('shake'); navigator.vibrate?.(60); };
    const done = (v) => { clearInterval(timer); document.removeEventListener('keydown', onKey); box.removeEventListener('click', onClick); box.hidden = true; resolve(v); };
    const wait = () => { const c = read(); const s = Math.ceil(((c?.until || 0) - Date.now()) / 1000); return s > 0 ? s : 0; };

    const refreshWait = () => {
      const s = wait();
      box.classList.toggle('busy', s > 0);
      if (s > 0) m.textContent = `Muitas tentativas. Aguarde ${s} s.`;
      else if (m.textContent.startsWith('Muitas')) m.textContent = msg || '';
    };

    const submit = async () => {
      if (busy || buf.length < 4 || wait()) return;
      busy = true;
      const pin = buf; buf = ''; paint();
      if (mode === 'new') {
        if (first === null) { first = pin; say('Repita o PIN', 'Só pra ter certeza.'); }
        else if (first === pin) { busy = false; return done(pin); }
        else { first = null; say(title, 'Os PINs não batem. Tente de novo.'); shake(); }
      } else {
        const ok = await verifyPin(pin);
        if (ok) { const c = read(); if (c) { c.fails = 0; c.until = 0; write(c); } busy = false; return done(pin); }
        const c = read() || {}; c.fails = (c.fails || 0) + 1;
        if (c.fails >= 5) c.until = Date.now() + Math.min(300, 15 * 2 ** (c.fails - 5)) * 1000;
        write(c); shake(); m.textContent = 'PIN incorreto.'; refreshWait();
      }
      busy = false;
    };
    const press = (k) => {
      if (busy || wait()) return;
      if (k === 'del') buf = buf.slice(0, -1);
      else if (/^\d$/.test(k) && buf.length < 4) buf += k;
      paint(); if (buf.length === 4) submit();
    };
    const tryBio = async () => { if (await bioUnlock()) done('bio'); };
    const onClick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'lockExtra') return extraAct();
      if (b.dataset.k === 'bio') return tryBio();
      if (b.dataset.k) press(b.dataset.k);
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Escape' && cancel) done(null);
    };
    let confirmingReset = false;
    const extraAct = () => {
      if (cancel) return done(null);
      if (!forgot) return;
      if (!confirmingReset) { confirmingReset = true; extra.textContent = 'Toque de novo: apaga os dados deste aparelho'; extra.classList.add('danger'); return; }
      // esqueci o PIN: limpa tudo deste aparelho (a nuvem, se ligada, continua intacta)
      try { Object.keys(localStorage).filter((k) => k.startsWith('financas.') || k === KEY).forEach((k) => localStorage.removeItem(k)); } catch { /* ok */ }
      location.reload();
    };

    say(title, msg);
    buf = ''; paint(); box.hidden = false; box.classList.remove('busy');
    bioBtn.style.visibility = bio ? 'visible' : 'hidden';
    extra.hidden = !(cancel || forgot);
    extra.classList.remove('danger');
    extra.textContent = cancel ? 'Cancelar' : 'Esqueci o PIN';
    box.addEventListener('click', onClick); document.addEventListener('keydown', onKey);
    timer = setInterval(refreshWait, 500); refreshWait();
    if (bio && !wait()) setTimeout(tryBio, 250);
  });
}

let locking = false;
export async function lockNow() {
  const st = lockState();
  if (!st.on || locking) return;
  locking = true;
  root.setAttribute('data-locked', '1');
  await askPin({ mode: 'unlock', title: 'OFI bloqueado', msg: 'Digite seu PIN.', bio: st.bio, forgot: true });
  root.removeAttribute('data-locked');
  locking = false;
}

// Fluxos usados pelas configurações
export const askNewPin = () => askPin({ mode: 'new', title: 'Crie um PIN', msg: '4 números. Ele protege o OFI neste aparelho.', cancel: true });
export const askCurrentPin = (title = 'Digite o PIN atual') => askPin({ mode: 'check', title, msg: '', cancel: true });

export function initLock() {
  if (lockState().on) lockNow();
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (lockState().on && hiddenAt && Date.now() - hiddenAt > AWAY_MS) lockNow();
  });
}

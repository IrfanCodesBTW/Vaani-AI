'use strict';
/* ==========================================================================
   Vaani AI , Console (product dashboard) SPA.
   Vanilla JS. Zero dependencies. Hash routing. Talks only to our own /api/*
   so provider keys stay server side. No em dashes anywhere. Use commas or periods.
   ========================================================================== */

/* ---------- tiny DOM helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (tag, attrs, kids) => {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  }
  if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
    if (c == null || c === false) return;
    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
  return n;
};

/* XSS guard. Always escape any user supplied string before it touches innerHTML.
   Most rendering uses el()+textContent which is safe by construction. esc() is the
   belt-and-suspenders for the rare html: paths. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- app state ---------- */
const State = {
  me: null,            // { user, tenant }
  health: null,        // { ok, providers, model }
  agents: [],
  providers: null,
  credentialStatus: null,
  usage: null,
  telephony: null,
  wallet: null,
  presets: [],
  tickets: [],
  demoLinks: [],
  agency: null,
  invoices: [],
  integrations: [],
  agencyPrompt: null,
  organizations: [],
  voiceFilters: { from: '', to: '', agentId: '', campaignId: '', provider: '', direction: '' },
  activeAgentId: null,
  loaded: { agents: false, providers: false, usage: false, telephony: false, wallet: false, presets: false, tickets: false, demoLinks: false, agency: false, invoices: false, integrations: false, agencyPrompt: false, voice: false, organizations: false, transcripts: false }
};

let routeCleanup = null;

const VOICE_MODELS = ['mulberry', 'muga'];
const RUMIK_MODEL_HINTS = {
  mulberry: 'Fast, promo-friendly default for phone agents.',
  muga: 'More expressive delivery with tone control.',
};
const SARVAM_TTS_MODELS = ['bulbul:v2', 'bulbul:v3'];
const SARVAM_MODEL_HINTS = {
  'bulbul:v2': 'Earlier Bulbul generation.',
  'bulbul:v3': 'Latest Bulbul generation, recommended default.',
};
const SPEAKERS = ['speaker_1', 'speaker_2', 'speaker_3', 'speaker_4'];
const SARVAM_VOICES = ['anushka', 'shubh', 'ritu', 'priya', 'neha', 'rahul', 'pooja', 'simran', 'kavya', 'amit'];
const MUGA_TONES = ['neutral', 'happy', 'sad', 'excited', 'angry', 'whisper'];
/* Rs per 1000 chars. Mulberry promo about Rs 0.50 / 1000. Muga slightly higher. */
const RATE = { mulberry: 0.50, muga: 0.99 };

/* ===========================================================================
   FETCH WRAPPER
   credentials:include so the vaani_sess cookie rides along. JSON in, JSON out.
   A 401 on any authed call bounces to the login card.
   =========================================================================== */
async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 35000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    clearTimeout(timeout);
    if (e && e.name === 'AbortError') throw new ApiError(408, 'The agent took too long to respond. Please try again.');
    throw new ApiError(0, 'Network error. Is the server running.');
  }
  clearTimeout(timeout);
  if (res.status === 401 && !opts.allow401) {
    State.me = null;
    if (!path.endsWith('/api/me')) renderAuth();
    throw new ApiError(401, 'Please sign in.');
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.indexOf('application/json') !== -1) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || data.message || ('Request failed (' + res.status + ').'), data);
    return data;
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new ApiError(res.status, txt || ('Request failed (' + res.status + ').'));
  }
  return res; // raw (e.g. audio/wav)
}
function ApiError(status, message, data) { this.status = status; this.message = message; this.data = data || {}; }
ApiError.prototype = Object.create(Error.prototype);

/* ===========================================================================
   TOASTS
   =========================================================================== */
function toast(message, kind, title) {
  kind = kind || 'info';
  const host = $('#toasts');
  if (!host) return;

  // Toast Queue Cap: Ensure maximum 5 active toasts to prevent viewport overflow
  const MAX_TOASTS = 5;
  const activeToasts = Array.from(host.children || []).filter((child) => !child._dismissed);
  if (activeToasts.length >= MAX_TOASTS) {
    const oldest = activeToasts[0];
    if (typeof oldest._dismiss === 'function') oldest._dismiss();
    else if (typeof oldest.remove === 'function') oldest.remove();
  }

  let autoTimer = null;
  const t = el('div', { class: 'toast ' + kind, role: kind === 'err' ? 'alert' : 'status' }, [
    el('span', { class: 'ti', 'aria-hidden': 'true' }),
    el('div', {}, [title ? el('b', {}, title) : null, el('div', {}, message)])
  ]);
  const dismiss = () => {
    if (t._dismissed) return;
    t._dismissed = true;
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    t.classList.add('out');
    setTimeout(() => { if (t.parentNode) t.remove(); }, 320);
  };
  t._dismiss = dismiss;
  t.addEventListener('click', dismiss);
  host.appendChild(t);
  autoTimer = setTimeout(dismiss, kind === 'err' ? 5200 : 3400);
}
window.toast = toast;

/* ===========================================================================
   MODAL
   =========================================================================== */
let activeModalClose = null;

function closeModal() {
  if (typeof activeModalClose === 'function') {
    activeModalClose();
  } else {
    const host = $('#modal-host');
    if (host) {
      host.classList.add('hide');
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = '';
    }
  }
}
window.closeModal = closeModal;

function modal(opts) {
  // opts: { title, body(node), confirmText, confirmKind, onConfirm, cancelText }
  const host = $('#modal-host');
  if (!host) return () => {};

  // Clean up active modal before re-entrant open
  if (typeof activeModalClose === 'function') {
    try { activeModalClose(); } catch (_) {}
  }

  const prevActive = typeof document !== 'undefined' ? document.activeElement : null;

  let keyListener = null;
  const close = () => {
    if (keyListener && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('keydown', keyListener);
      keyListener = null;
    }
    activeModalClose = null;
    host.classList.add('hide');
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = '';
    if (prevActive && typeof prevActive.focus === 'function') {
      try { prevActive.focus(); } catch (_) {}
    }
  };
  activeModalClose = close;

  const confirmBtn = el('button', { class: 'btn ' + (opts && opts.confirmKind === 'danger' ? 'btn-danger' : 'btn-primary') }, (opts && opts.confirmText) || 'Confirm');
  confirmBtn.addEventListener('click', () => {
    confirmBtn.disabled = true;
    try {
      if (opts && typeof opts.onConfirm === 'function') {
        const res = opts.onConfirm();
        if (res && typeof res.then === 'function') {
          res.then(
            () => { close(); },
            (e) => {
              confirmBtn.disabled = false;
              toast((e && e.message) || 'Action failed.', 'err');
            }
          );
          return;
        }
      }
      close();
    } catch (e) {
      confirmBtn.disabled = false;
      toast((e && e.message) || 'Action failed.', 'err');
    }
  });

  const card = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, [
    el('h3', {}, (opts && opts.title) || ''),
    (opts && opts.body) || null,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: close }, (opts && opts.cancelText) || 'Cancel'),
      confirmBtn
    ])
  ]);

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    keyListener = (e) => {
      if (e.key === 'Escape') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab' && typeof card.querySelectorAll === 'function') {
        const focusables = card.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || (typeof card.contains === 'function' && !card.contains(document.activeElement))) {
            if (typeof last.focus === 'function') last.focus();
            if (typeof e.preventDefault === 'function') e.preventDefault();
          }
        } else {
          if (document.activeElement === last || (typeof card.contains === 'function' && !card.contains(document.activeElement))) {
            if (typeof first.focus === 'function') first.focus();
            if (typeof e.preventDefault === 'function') e.preventDefault();
          }
        }
      }
    };
    document.addEventListener('keydown', keyListener);
  }

  host.innerHTML = '';
  host.appendChild(el('div', { onclick: (e) => { if (e.target === e.currentTarget) close(); }, style: 'position:absolute;inset:0' }));
  host.appendChild(card);
  host.classList.remove('hide');
  host.setAttribute('aria-hidden', 'false');

  const focusTarget = () => {
    try {
      const initialInput = typeof card.querySelector === 'function' ? card.querySelector('input, select, textarea') : null;
      if (initialInput && typeof initialInput.focus === 'function') initialInput.focus();
      else if (typeof confirmBtn.focus === 'function') confirmBtn.focus();
    } catch (_) {}
  };
  focusTarget();
  setTimeout(focusTarget, 20);

  return close;
}

function openModal(opts) {
  return modal(opts);
}
window.modal = modal;
window.openModal = openModal;

/* ===========================================================================
   SMALL UTILITIES
   =========================================================================== */
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase() || '?';
}
function isPlatformUserClient(user) {
  return !!user && (user.role === 'super_admin' || user.role === 'admin');
}
function clientOrgRole() {
  const user = State.me && State.me.user;
  if (isPlatformUserClient(user) || (user && user.role === 'owner')) return 'owner';
  return (State.me && (State.me.user.orgRole || (State.me.membership && State.me.membership.role))) || 'operator';
}
function hasClientOrgRole(minimum) {
  const levels = { viewer: 1, analyst: 2, operator: 3, admin: 4, owner: 5 };
  return (levels[clientOrgRole()] || 0) >= (levels[minimum] || 99);
}
function selectableAgents() {
  return (State.agents || []).filter((a) => !a.restricted || hasClientOrgRole('admin'));
}
function capabilityTags(agent) {
  const tags = (agent && agent.capabilities) || [];
  return el('div', { class: 'ac-meta agent-tags' }, tags.map((tag) =>
    el('span', { class: 'tag tag-' + (tag.kind || 'domain') }, tag.label)
  ));
}
function brandSVG(size) {
  // Inline operating-system mark. Returns an <svg> node so auth remains resilient.
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('width', size || 30); svg.setAttribute('height', size || 30);
  svg.innerHTML =
    '<rect x="4" y="4" width="32" height="32" rx="10" fill="#1F1F1F" stroke="#B9FF66" stroke-width="1.5"/>' +
    '<path d="M12 14l8 13 8-13h-4.2l-3.8 7.2-3.8-7.2H12z" fill="#B9FF66"/>';
  return svg;
}
function fmtInr(n) {
  const v = Number(n || 0);
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function skeleton(kind, n) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < (n || 1); i++) frag.appendChild(el('div', { class: 'sk ' + (kind || 'sk-card') }));
  return frag;
}

let chartsPromise = null;
function ensureCharts() {
  if (window.VaaniCharts) return Promise.resolve(window.VaaniCharts);
  if (chartsPromise) return chartsPromise;
  chartsPromise = new Promise((resolve, reject) => {
    const script = el('script', { src: '/assets/charts.js?v=20260905-vaani1' });
    script.onload = () => window.VaaniCharts ? resolve(window.VaaniCharts) : reject(new Error('Analytics bundle did not initialize.'));
    script.onerror = () => reject(new Error('Analytics bundle could not be loaded.'));
    document.head.appendChild(script);
  });
  return chartsPromise;
}

/* ===========================================================================
   BOOT
   =========================================================================== */
async function boot() {
  try {
    const me = await api('/api/me', { allow401: true });
    State.me = me;
    renderShell();
  } catch (e) {
    if (e.status === 401) renderAuth();
    else { renderAuth(); }
  }
}

/* ===========================================================================
   AUTH GATE
   =========================================================================== */
function renderAuth() {
  let mode = 'login'; // or 'signup'
  const root = $('#app');
  root.removeAttribute('aria-busy');

  function draw() {
    const errBox = el('div', { class: 'auth-err', id: 'authErr' });
    const fields = [];
    if (mode === 'signup') {
      fields.push(field('Your name', el('input', { class: 'input', id: 'f_name', type: 'text', placeholder: 'Your full name', autocomplete: 'name' })));
      fields.push(field('Company', el('input', { class: 'input', id: 'f_company', type: 'text', placeholder: 'Your agency or company', autocomplete: 'organization' })));
    }
    const emailInput = el('input', { class: 'input', id: 'f_email', type: 'email', placeholder: 'you@company.com', autocomplete: 'email' });
    const passwordInput = el('input', { class: 'input', id: 'f_pass', type: 'password', placeholder: 'Enter your password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password' });
    const showPassword = el('button', { class: 'auth-show-password', type: 'button', 'aria-label': 'Show password', onclick: () => {
      const visible = passwordInput.type === 'text';
      passwordInput.type = visible ? 'password' : 'text';
      showPassword.textContent = visible ? 'Show' : 'Hide';
      showPassword.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
    } }, 'Show');
    fields.push(field('Work email', emailInput));
    fields.push(el('div', { class: 'field' }, [el('label', { for: 'f_pass' }, 'Password'), el('div', { class: 'auth-password' }, [passwordInput, showPassword])]));

    const submit = el('button', { class: 'btn btn-primary btn-lg auth-submit', type: 'submit' }, mode === 'login' ? 'Sign in' : 'Create workspace');

    const form = el('form', { class: 'auth-form', onsubmit: onSubmit }, fields.concat([errBox, submit]));

    const formPanel = el('section', { class: 'auth-form-panel' }, [
      el('div', { class: 'auth-brand' }, [
        (function () { const s = brandSVG(34); s.classList.add('lm'); return s; })(),
        el('span', { class: 'nm' }, [document.createTextNode('Vaani '), el('em', {}, 'AI')])
      ]),
      el('div', { class: 'auth-heading' }, [
        el('span', { class: 'section-kicker' }, mode === 'login' ? 'Secure operator access' : 'New workspace'),
        el('h1', {}, mode === 'login' ? 'Welcome back.' : 'Run the whole agency.'),
        el('p', { class: 'sub' }, mode === 'login' ? 'Clients, money, voice agents, invoices, and operations in one place.' : 'Create an isolated workspace for AI voice operations. Telephony and carrier charges remain separate.')
      ]),
      form,
      el('div', { class: 'auth-toggle' }, [
        document.createTextNode(mode === 'login' ? 'Need a new workspace? ' : 'Already have a workspace? '),
        el('button', { type: 'button', onclick: () => { mode = mode === 'login' ? 'signup' : 'login'; draw(); } }, mode === 'login' ? 'Create account' : 'Sign in')
      ]),
      mode === 'login' ? el('div', { class: 'auth-demo' }, [el('span', { class: 'auth-demo-dot' }), el('span', {}, 'Use your workspace credentials. Admin access is role-gated and audited.')]) : null
    ]);

    const proofPanel = el('aside', { class: 'auth-proof-panel' }, [
      el('div', { class: 'auth-grid-pattern', 'aria-hidden': 'true' }),
      el('div', { class: 'auth-proof-top' }, [
        el('span', { class: 'auth-proof-label' }, 'Agency command centre'),
        el('span', { class: 'auth-live-pill' }, [el('span', {}), 'Voice stack online'])
      ]),
      el('div', { class: 'auth-proof-copy' }, [
        el('h2', {}, 'One operating system. Every client signal.'),
        el('p', {}, 'Know what is live, what is owed, which clients need attention, and what the team should do next.')
      ]),
      el('div', { class: 'auth-proof-metrics' }, [
        el('div', {}, [el('strong', {}, '₹'), el('span', {}, 'Invoice and wallet clarity')]),
        el('div', {}, [el('strong', {}, '24/7'), el('span', {}, 'Voice agent operations')]),
        el('div', {}, [el('strong', {}, '100%'), el('span', {}, 'Audited admin actions')])
      ]),
      el('div', { class: 'auth-capabilities' }, ['Client lifecycle', 'Invoices', 'AI voice agents', 'WhatsApp ready', 'Ad research ready'].map((label) => el('span', {}, label)))
    ]);

    root.innerHTML = '';
    root.appendChild(el('div', { class: 'auth-wrap' }, [formPanel, proofPanel]));
    const first = $('#' + (mode === 'signup' ? 'f_name' : 'f_email'));
    if (first) first.focus();
  }

  function field(label, input) {
    return el('div', { class: 'field' }, [el('label', {}, label), input]);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const err = $('#authErr');
    err.classList.remove('show');
    const email = ($('#f_email').value || '').trim();
    const password = $('#f_pass').value || '';
    if (!email || !password) { showErr('Email and password are required.'); return; }
    if (mode === 'signup' && password.length < 12) { showErr('Use at least 12 characters for your password.'); return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = mode === 'login' ? 'Signing in...' : 'Creating workspace...';
    try {
      let body, route;
      if (mode === 'signup') {
        body = { email: email, password: password, name: ($('#f_name').value || '').trim(), company: ($('#f_company').value || '').trim() };
        route = '/api/auth/signup';
      } else {
        body = { email: email, password: password };
        route = '/api/auth/login';
      }
      const res = await api(route, { method: 'POST', body: body, allow401: true });
      State.me = { user: res.user, tenant: res.tenant };
      resetData();
      toast(mode === 'login' ? 'Signed in.' : 'Account created.', 'ok');
      renderShell();
    } catch (ex) {
      btn.disabled = false; btn.textContent = mode === 'login' ? 'Sign in' : 'Create workspace';
      if (ex.status === 409) showErr('That email is already registered. Try signing in.');
      else if (ex.status === 401) showErr('Wrong email or password.');
      else showErr(ex.message || 'Something went wrong.');
    }
  }
  function showErr(m) { const err = $('#authErr'); err.textContent = m; err.classList.add('show'); }

  draw();
}
function resetData() {
  State.agents = []; State.providers = null; State.usage = null; State.telephony = null;
  State.wallet = null; State.presets = []; State.tickets = [];
  State.demoLinks = [];
  State.agency = null; State.invoices = []; State.integrations = []; State.agencyPrompt = null;
  State.organizations = [];
  State.voiceFilters = { from: '', to: '', agentId: '', campaignId: '', provider: '', direction: '' };
  State.loaded = { agents: false, providers: false, usage: false, telephony: false, wallet: false, presets: false, tickets: false, demoLinks: false, agency: false, invoices: false, integrations: false, agencyPrompt: false, voice: false, organizations: false, transcripts: false };
  State.activeAgentId = null;
}

function clearCachesOnOrgSwitch() {
  resetData();
}

/* ===========================================================================
   CONSOLE SHELL & DUAL-TIER NAVIGATION (MILESTONE M2)
   =========================================================================== */
const ROUTES = [
  // Primary top-pill routes (5)
  { id: 'overview', label: 'Overview', icon: 'grid', primary: true, rail: true },
  { id: 'agents', label: 'Agents', icon: 'users', primary: true },
  { id: 'presets', label: 'Presets', icon: 'template', secondary: true },
  { id: 'studio', label: 'Voice Studio', icon: 'wave', primary: true },
  { id: 'demos', label: 'Demo links', icon: 'link', secondary: true, rail: true, ownerOnly: true },
  { id: 'talk', label: 'Talk to it', icon: 'mic', primary: true },
  { id: 'telephony', label: 'Telephony', icon: 'phone', primary: true, rail: true },
  { id: 'invoices', label: 'Invoices', icon: 'invoice', secondary: true, ownerOnly: true },
  { id: 'integrations', label: 'Integrations', icon: 'plug', secondary: true, ownerOnly: true },
  { id: 'agency-prompt', label: 'Agency prompt', icon: 'prompt', secondary: true, ownerOnly: true },
  { id: 'billing', label: 'Billing', icon: 'wallet', secondary: true },
  { id: 'support', label: 'Support', icon: 'support', secondary: true },
  { id: 'admin', label: 'Clients', icon: 'shield', secondary: true, adminOnly: true },
  { id: 'settings', label: 'Settings', icon: 'gear', secondary: true, rail: true }
];

function canAccessRoute(route, user) {
  if (!user && State.me) user = State.me.user;
  if (!user) return false;
  if (route.adminOnly && !isPlatformUserClient(user)) return false;
  if (route.ownerOnly && !isPlatformUserClient(user) && clientOrgRole() !== 'owner') return false;
  return true;
}

function navIcon(name, opts) {
  opts = opts || {};
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3 3 0 0 1 0 5.6"/><path d="M17 14.5a5.5 5.5 0 0 1 3.5 5.5"/>',
    wave: '<path d="M2 12h2l2-6 3 14 3-18 3 14 2-6h2"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/>',
    phone: '<path d="M5 3.5h3l1.5 4.5-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5z"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/>',
    template: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    wallet: '<path d="M4 6.5h14a2 2 0 0 1 2 2v9H4a2 2 0 0 1-2-2v-11a2 2 0 0 0 2 2z"/><path d="M15 11h7v4h-7a2 2 0 0 1 0-4z"/>',
    support: '<path d="M4 13a8 8 0 0 1 16 0v5a2 2 0 0 1-2 2h-3"/><path d="M4 13v4H2v-4h2M20 13v4h2v-4h-2"/>',
    shield: '<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3z"/><path d="m9 12 2 2 4-5"/>',
    link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
    invoice: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6M9 19h4"/>',
    plug: '<path d="M8 3v5M16 3v5M6 8h12v2a6 6 0 0 1-12 0V8zM12 16v5"/>',
    prompt: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 2 2-2 2M12 13h5"/>',
    logout: '<path d="M14 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5H14"/><path d="M17 8l4 4-4 4"/><path d="M21 12H9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };
  const size = opts.size === 'sm' ? ' nav-ico-sm' : (opts.size === 'lg' ? ' nav-ico-lg' : '');
  const svg = '<svg class="ic' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.grid) + '</svg>';
  if (opts.chip === false) return svg;
  return '<span class="nav-ico-chip">' + svg + '</span>';
}

function renderOrgSwitcher(tenant) {
  const orgs = State.organizations.length ? State.organizations : (State.me && State.me.organizations) || [];
  if (!orgs || orgs.length <= 1) return null;
  const select = el('select', {
    class: 'org-switcher',
    'aria-label': 'Switch organization',
    onchange: async (e) => {
      const organizationId = e.target.value;
      if (!organizationId || organizationId === tenant.id) return;
      try {
        await api('/api/organizations/switch', { method: 'POST', body: { organizationId } });
        State.me = await api('/api/me');
        clearCachesOnOrgSwitch();
        renderShell();
        toast('Switched workspace.', 'ok');
      } catch (err) {
        toast(err.message || 'Could not switch workspace.', 'err');
        e.target.value = tenant.id;
      }
    }
  }, orgs.map((row) => el('option', { value: row.organizationId, selected: row.organizationId === tenant.id }, row.organization ? row.organization.name : tenant.name)));
  return el('label', { class: 'org-switcher-wrap' }, [el('span', { class: 'muted' }, 'Workspace'), select]);
}

async function loadOrganizations() {
  if (State.loaded.organizations) return State.organizations;
  const data = await api('/api/organizations');
  State.organizations = data.organizations || [];
  State.loaded.organizations = true;
  return State.organizations;
}

function handleQuickCreate() {
  if (hasClientOrgRole('operator')) {
    openEditAgent(null);
  } else {
    goto('agents');
  }
}

function openDropdown() {
  const menu = $('#overflowDropdownMenu');
  const trigger = $('#overflowDropdownTrigger');
  const container = $('#nav-overflow-menu');
  if (menu && trigger && container) {
    menu.classList.remove('hide');
    trigger.setAttribute('aria-expanded', 'true');
    container.classList.add('open');
  }
}

function closeDropdown() {
  const menu = $('#overflowDropdownMenu');
  const trigger = $('#overflowDropdownTrigger');
  const container = $('#nav-overflow-menu');
  if (menu && trigger && container) {
    menu.classList.add('hide');
    trigger.setAttribute('aria-expanded', 'false');
    container.classList.remove('open');
  }
}

function toggleDropdown(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const menu = $('#overflowDropdownMenu');
  if (menu && menu.classList.contains('hide')) openDropdown();
  else closeDropdown();
}

function initDropdownBehavior() {
  const container = $('#nav-overflow-menu');
  const trigger = $('#overflowDropdownTrigger');
  const menu = $('#overflowDropdownMenu');
  if (!container || !trigger || !menu) return;

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) closeDropdown();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.classList.contains('hide')) {
      closeDropdown();
      trigger.focus();
    }
  });

  let hoverTimer = null;
  container.addEventListener('mouseenter', () => {
    if (window.innerWidth > 820) {
      clearTimeout(hoverTimer);
      openDropdown();
    }
  });
  container.addEventListener('mouseleave', () => {
    if (window.innerWidth > 820) {
      hoverTimer = setTimeout(closeDropdown, 200);
    }
  });
}

function openUserMenu() {
  const menu = $('#userProfileMenu');
  const badge = $('#userIdentityBadge');
  if (menu && badge) {
    menu.classList.remove('hide');
    badge.setAttribute('aria-expanded', 'true');
  }
}

function closeUserMenu() {
  const menu = $('#userProfileMenu');
  const badge = $('#userIdentityBadge');
  if (menu && badge) {
    menu.classList.add('hide');
    badge.setAttribute('aria-expanded', 'false');
  }
}

function toggleUserMenu(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const menu = $('#userProfileMenu');
  if (menu && menu.classList.contains('hide')) openUserMenu();
  else closeUserMenu();
}

function initUserMenuBehavior() {
  const badge = $('#userIdentityBadge');
  const menu = $('#userProfileMenu');
  if (!badge || !menu) return;

  document.addEventListener('click', (e) => {
    if (!badge.contains(e.target) && !menu.contains(e.target)) {
      closeUserMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.classList.contains('hide')) {
      closeUserMenu();
      badge.focus();
    }
  });
}

function toggleMobileDrawer(forceState) {
  const shell = $('.vaani-shell') || $('.shell');
  const drawer = $('#mobileDrawer');
  const scrim = $('#navDrawerScrim');
  const btn = $('#mobileNavToggle');
  if (!shell) return;
  const isOpen = typeof forceState === 'boolean' ? forceState : !shell.classList.contains('nav-open');
  shell.classList.toggle('nav-open', isOpen);
  shell.classList.toggle('drawer-open', isOpen);
  if (drawer) drawer.classList.toggle('hide', !isOpen);
  if (scrim) scrim.classList.toggle('hide', !isOpen);
  if (btn) btn.setAttribute('aria-expanded', String(isOpen));
}

function closeMobileDrawer() {
  toggleMobileDrawer(false);
}

function initMobileDrawerBehavior() {
  const toggleBtn = $('#mobileNavToggle');
  const scrim = $('#navDrawerScrim');
  if (toggleBtn) toggleBtn.onclick = () => toggleMobileDrawer();
  if (scrim) scrim.onclick = () => closeMobileDrawer();
}

function openQuickSearch() {
  const host = $('#modal-host');
  if (!host) return;
  const close = () => {
    host.classList.add('hide');
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = '';
  };

  const searchInput = el('input', {
    class: 'input quick-search-input',
    placeholder: 'Search routes, agents, calls, settings...',
    type: 'search',
    autocomplete: 'off'
  });

  const resultsList = el('div', { class: 'quick-search-results' });

  function renderResults(query) {
    const q = (query || '').toLowerCase().trim();
    resultsList.innerHTML = '';
    const user = State.me && State.me.user;

    const matchingRoutes = ROUTES.filter((r) => canAccessRoute(r, user) && (!q || r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)));
    const matchingAgents = (State.agents || []).filter((a) => !q || a.name.toLowerCase().includes(q));

    if (!matchingRoutes.length && !matchingAgents.length) {
      resultsList.appendChild(el('div', { class: 'quick-search-empty muted' }, 'No matching results found.'));
      return;
    }

    if (matchingRoutes.length) {
      resultsList.appendChild(el('div', { class: 'quick-search-group-title' }, 'Routes'));
      matchingRoutes.forEach((r) => {
        resultsList.appendChild(el('a', {
          class: 'quick-search-item',
          href: '#/' + r.id,
          onclick: () => { close(); goto(r.id); },
          html: navIcon(r.icon, { chip: false }) + '<span class="item-title">' + esc(r.label) + '</span><span class="badge-route">#/' + r.id + '</span>'
        }));
      });
    }

    if (matchingAgents.length) {
      resultsList.appendChild(el('div', { class: 'quick-search-group-title' }, 'Agents'));
      matchingAgents.slice(0, 5).forEach((a) => {
        resultsList.appendChild(el('div', {
          class: 'quick-search-item',
          onclick: () => { close(); openEditAgent(a); },
          html: navIcon('users', { chip: false }) + '<span class="item-title">' + esc(a.name) + '</span><span class="badge-action">Edit</span>'
        }));
      });
    }
  }

  searchInput.addEventListener('input', (e) => renderResults(e.target.value));

  const dialog = el('div', { class: 'modal quick-search-dialog', role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'quick-search-header' }, [
      el('span', { class: 'search-glyph', html: navIcon('search', { chip: false }) }),
      searchInput,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: close }, 'ESC')
    ]),
    resultsList
  ]);

  host.innerHTML = '';
  host.appendChild(el('div', { onclick: (ev) => { if (ev.target === ev.currentTarget) close(); }, style: 'position:absolute;inset:0' }));
  host.appendChild(dialog);
  host.classList.remove('hide');
  host.setAttribute('aria-hidden', 'false');

  renderResults('');
  setTimeout(() => searchInput.focus(), 50);
}

function renderShell() {
  loadOrganizations().catch(() => {});
  const root = $('#app');
  root.removeAttribute('aria-busy');
  const t = State.me.tenant, u = State.me.user;

  // Filter routes by role
  const primaryRoutes = ROUTES.filter((r) => r.primary && canAccessRoute(r, u));
  const secondaryRoutes = ROUTES.filter((r) => r.secondary && canAccessRoute(r, u));
  const railRoutes = ROUTES.filter((r) => r.rail && canAccessRoute(r, u));
  const accessibleAll = ROUTES.filter((r) => canAccessRoute(r, u));

  // 1. Compact 56px Vertical Icon Rail
  const sideRail = el('aside', { class: 'side-rail side', role: 'navigation', 'aria-label': 'Quick Actions' }, [
    el('div', { class: 'rail-brand' }, [
      el('a', { href: '#/overview', class: 'rail-logo-badge', title: 'Vaani AI', 'aria-label': 'Vaani AI' }, [
        el('span', { class: 'monogram' }, 'V')
      ])
    ]),
    el('nav', { class: 'rail-nav nav' }, railRoutes.map((r) =>
      el('a', {
        href: '#/' + r.id,
        class: 'rail-item',
        'data-route': r.id,
        'aria-label': r.label,
        title: r.label,
        html: navIcon(r.icon, { chip: false }) + '<span class="rail-item-label" style="display:none">' + esc(r.label) + '</span>'
      })
    )),
    el('div', { class: 'rail-foot side-foot' }, [
      el('button', {
        class: 'rail-action-plus',
        id: 'quick-create-btn',
        title: 'Create New Agent',
        'aria-label': 'Create New Agent',
        onclick: handleQuickCreate,
        html: navIcon('plus', { chip: false })
      })
    ])
  ]);

  // 2. Top Navigation Bar with Pill Route Buttons
  const topBrandSection = el('div', { class: 'top-nav-left' }, [
    el('button', {
      class: 'mobile-nav-toggle menu-btn',
      id: 'mobileNavToggle',
      'aria-label': 'Toggle Navigation Menu',
      onclick: toggleMobileDrawer,
      html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
    }),
    el('div', { class: 'top-brand' }, [
      el('span', { class: 'brand-title' }, 'Vaani AI'),
      el('span', { class: 'ttl', id: 'routeTitle', style: 'display:none' }, 'Overview')
    ])
  ]);

  const primaryPills = primaryRoutes.map((r) =>
    el('a', {
      href: '#/' + r.id,
      class: 'nav-pill',
      'data-route': r.id,
      role: 'tab',
      title: r.label,
      html: navIcon(r.icon, { chip: false, size: 'sm' }) + '<span class="nav-pill-label">' + esc(r.label) + '</span>'
    })
  );

  const overflowMenu = el('div', { class: 'dropdown-menu hide', id: 'overflowDropdownMenu', role: 'menu' },
    secondaryRoutes.map((r) =>
      el('a', {
        href: '#/' + r.id,
        class: 'dropdown-item',
        'data-route': r.id,
        role: 'menuitem',
        onclick: closeDropdown,
        html: navIcon(r.icon) + '<span class="dropdown-item-label">' + esc(r.label) + '</span>'
      })
    )
  );

  const overflowTrigger = el('button', {
    class: 'nav-pill dropdown-trigger',
    id: 'overflowDropdownTrigger',
    'aria-expanded': 'false',
    'aria-haspopup': 'true',
    'aria-label': 'More routes',
    onclick: toggleDropdown,
    html: navIcon('more', { chip: false, size: 'sm' }) + '<span class="nav-pill-label">More</span> <span class="chevron">∨</span>'
  });

  const navPillDropdown = secondaryRoutes.length ? el('div', { class: 'nav-pill-dropdown', id: 'nav-overflow-menu' }, [
    overflowTrigger,
    overflowMenu
  ]) : null;

  const navPillGroup = el('nav', { class: 'nav-pill-group nav', role: 'tablist', 'aria-label': 'Primary Navigation' }, [
    ...primaryPills,
    navPillDropdown
  ].filter(Boolean));

  // User identity details & initials
  const displayName = (u && u.name) || 'Bogdan Nikitin';
  const displayHandle = '@' + ((u && u.name) ? u.name.toLowerCase().replace(/\s+/g, '') : ((u && u.email) ? u.email.split('@')[0] : 'Nixtio'));
  const userInits = initials(displayName);

  const userProfileMenu = el('div', { class: 'user-profile-menu profile-menu hide', id: 'userProfileMenu', role: 'menu' }, [
    el('div', { class: 'user-menu-header' }, [
      el('div', { class: 'user-menu-name' }, displayName),
      el('div', { class: 'user-menu-role muted' }, (u && u.role) ? u.role.replace('_', ' ') : 'operator')
    ]),
    el('div', { class: 'user-menu-tenant tenant-chip' }, [
      el('div', { class: 'av', style: 'display:none' }, userInits),
      el('div', { class: 'meta' }, [
        el('div', { class: 'tn', title: t.name }, t.name),
        el('div', { class: 'tp muted' }, (t.plan || 'studio') + ' plan')
      ])
    ]),
    renderOrgSwitcher(t),
    el('div', { class: 'user-menu-divider' }),
    el('a', { href: '#/settings', class: 'user-menu-item', onclick: closeUserMenu }, [
      el('span', { html: navIcon('gear', { chip: false }) }),
      el('span', {}, 'Workspace settings')
    ]),
    el('button', { class: 'user-menu-item logout-btn side-logout', onclick: doLogout }, [
      el('span', { html: navIcon('logout', { chip: false }) }),
      el('span', {}, 'Sign out')
    ])
  ]);

  const userBadge = el('div', {
    class: 'user-identity-badge',
    id: 'userIdentityBadge',
    role: 'button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    tabindex: '0',
    onclick: toggleUserMenu
  }, [
    el('div', { class: 'user-info' }, [
      el('span', { class: 'user-name' }, displayName),
      el('span', { class: 'user-handle' }, displayHandle)
    ]),
    el('div', { class: 'user-avatar-wrap' }, [
      el('div', { class: 'user-avatar av' }, userInits),
      el('span', { class: 'notification-counter' }, '2')
    ])
  ]);

  const searchTrigger = el('button', {
    class: 'nav-search-trigger',
    id: 'navSearchTrigger',
    'aria-label': 'Quick Search',
    title: 'Search agents, calls, or settings',
    onclick: openQuickSearch,
    html: navIcon('search', { chip: false })
  });

  const topMeta = el('div', { class: 'top-meta' }, [
    el('div', { class: 'health-row hide-mobile', id: 'healthRow' }, healthChips()),
    searchTrigger,
    userBadge,
    userProfileMenu
  ]);

  const topNavBar = el('header', { class: 'top-nav-bar top', role: 'banner' }, [
    topBrandSection,
    navPillGroup,
    topMeta
  ]);

  // Mobile Navigation Drawer (<= 820px)
  const mobileDrawer = el('aside', { class: 'mobile-drawer hide', id: 'mobileDrawer', role: 'dialog', 'aria-label': 'Mobile Navigation' }, [
    el('div', { class: 'mobile-drawer-header' }, [
      el('div', { class: 'top-brand' }, [
        el('span', { class: 'monogram' }, 'V'),
        el('span', { class: 'brand-title' }, 'Vaani AI')
      ]),
      el('button', { class: 'btn-close-drawer', onclick: closeMobileDrawer, 'aria-label': 'Close Menu' }, '✕')
    ]),
    el('nav', { class: 'mobile-drawer-nav nav' }, accessibleAll.map((r) =>
      el('a', {
        href: '#/' + r.id,
        class: 'mobile-nav-item',
        'data-route': r.id,
        onclick: closeMobileDrawer,
        html: navIcon(r.icon) + '<span>' + esc(r.label) + '</span>'
      })
    )),
    el('div', { class: 'mobile-drawer-footer side-foot' }, [
      renderOrgSwitcher(t),
      el('button', { class: 'side-logout', onclick: doLogout, html: navIcon('logout', { chip: false }) + '<span>Sign out</span>' })
    ])
  ]);

  const impersonationBanner = State.me.impersonation ? el('div', { class: 'impersonation-banner' }, [
    el('div', {}, [el('b', {}, 'Viewing as ' + u.email), el('span', {}, 'Read-only safety mode. Reason: ' + (State.me.impersonation.reason || 'Support review'))]),
    el('button', { class: 'btn btn-dark', onclick: exitImpersonation }, 'Exit user view')
  ]) : null;

  const shellViewport = el('div', { class: 'shell-viewport' }, [
    topNavBar,
    impersonationBanner,
    el('main', { class: 'main-content main', id: 'view', role: 'main' }),
    el('div', { class: 'nav-drawer-scrim nav-scrim hide', id: 'navDrawerScrim', onclick: closeMobileDrawer })
  ]);

  const shell = el('div', { class: 'vaani-shell shell' + (impersonationBanner ? ' is-impersonating' : '') }, [
    sideRail,
    shellViewport,
    mobileDrawer
  ]);

  root.innerHTML = '';
  root.appendChild(shell);

  initDropdownBehavior();
  initUserMenuBehavior();
  initMobileDrawerBehavior();

  window.removeEventListener('hashchange', onRoute);
  window.addEventListener('hashchange', onRoute);
  loadHealth();
  onRoute();
}

async function exitImpersonation() {
  await api('/api/auth/impersonation/exit', { method: 'POST', body: {} });
  State.me = await api('/api/me');
  renderShell();
  toast('Returned to super admin.', 'ok');
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST', allow401: true }); } catch (e) {}
  State.me = null; resetData();
  toast('Signed out.', 'info');
  renderAuth();
}

/* ---- health chips ---- */
function healthChips() {
  const layers = [
    { key: 'tts', label: 'TTS' },
    { key: 'llm', label: 'Brain' },
    { key: 'telephony', label: 'Telephony' }
  ];
  return layers.map((L) => {
    const chip = el('span', { class: 'hchip loading', 'data-layer': L.key }, [
      el('span', { class: 'dot' }),
      el('span', { class: 'lbl-txt' }, L.label)
    ]);
    return chip;
  });
}
async function loadHealth() {
  try {
    const h = await api('/api/health', { allow401: true });
    State.health = h;
    paintHealth();
  } catch (e) {
    $$('#healthRow .hchip').forEach((c) => { c.className = 'hchip bad'; });
  }
}
function paintHealth() {
  const h = State.health; if (!h) return;
  const map = {
    tts: h.providers && h.providers.tts ? Object.values(h.providers.tts).some(Boolean) : false,
    llm: h.providers && h.providers.llm ? Object.values(h.providers.llm).some(Boolean) : false,
    telephony: h.providers && h.providers.telephony ? Object.values(h.providers.telephony).some(Boolean) : false
  };
  $$('#healthRow .hchip').forEach((c) => {
    const layer = c.getAttribute('data-layer');
    c.classList.remove('loading');
    c.className = 'hchip ' + (map[layer] ? 'ok' : 'bad');
    c.setAttribute('data-layer', layer);
  });
}

/* ===========================================================================
   ROUTER & SYNCHRONIZATION
   =========================================================================== */
function currentRoute() {
  const hash = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  const found = ROUTES.find((r) => r.id === hash && canAccessRoute(r));
  return found ? found.id : 'overview';
}

function updateActiveNav(activeId) {
  // 1. Top pill buttons
  $$('.nav-pill-group .nav-pill[data-route]').forEach((pill) => {
    const isActive = pill.getAttribute('data-route') === activeId;
    pill.classList.toggle('active', isActive);
    pill.setAttribute('aria-selected', String(isActive));
  });

  // 2. Left rail icon buttons
  $$('.side-rail .rail-item[data-route]').forEach((item) => {
    const isActive = item.getAttribute('data-route') === activeId;
    item.classList.toggle('active', isActive);
  });

  // 3. Overflow dropdown items & trigger indicator
  const activeRoute = ROUTES.find((r) => r.id === activeId);
  const isSecondary = !!(activeRoute && activeRoute.secondary);
  const trigger = $('#overflowDropdownTrigger');
  if (trigger) {
    trigger.classList.toggle('has-active-child', isSecondary);
    trigger.classList.toggle('active', isSecondary);
  }
  $$('#overflowDropdownMenu a[data-route]').forEach((item) => {
    const isActive = item.getAttribute('data-route') === activeId;
    item.classList.toggle('active', isActive);
  });

  // 4. Mobile drawer navigation links
  $$('.mobile-drawer .mobile-nav-item[data-route]').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-route') === activeId);
  });

  // 5. Generic .nav a compatibility
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('data-route') === activeId));

  // 6. Document & route titles
  const r = ROUTES.find((x) => x.id === activeId);
  const label = r ? r.label : 'Overview';
  document.title = label + ' — Vaani AI';
  const tt = $('#routeTitle');
  if (tt) tt.textContent = label;

  closeDropdown();
  closeMobileDrawer();
  closeUserMenu();
}

function onRoute() {
  if (!State.me) return;
  closeModal();
  if (routeCleanup) { try { routeCleanup(); } catch (_) {} routeCleanup = null; }

  const requestedHash = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  const requestedRoute = ROUTES.find((r) => r.id === requestedHash);
  if (requestedRoute && !canAccessRoute(requestedRoute)) {
    toast('Access restricted: ' + requestedRoute.label + ' requires elevated permissions.', 'warn');
  }

  const id = currentRoute();
  updateActiveNav(id);

  const shell = $('.vaani-shell') || $('.shell');
  if (shell) {
    shell.classList.remove('nav-open');
    shell.classList.remove('drawer-open');
  }

  const view = $('#view');
  if (!view) return;
  view.innerHTML = '';
  const wrap = el('div', { class: 'view' });
  view.appendChild(wrap);
  ({
    overview: viewOverview, agents: viewAgents, presets: viewPresets, studio: viewStudio, demos: viewDemoLinks,
    talk: viewTalk, telephony: viewTelephony, invoices: viewInvoices, integrations: viewIntegrations,
    'agency-prompt': viewAgencyPrompt, billing: viewBilling,
    support: viewSupport, admin: viewAdmin, settings: viewSettings
  }[id] || viewOverview)(wrap);
}

function goto(id) { location.hash = '#/' + id; }

/* ---- shared view header (refactored for command center) ---- */
function viewHead(title, kickerOrSub, actions) {
  const isOverview = (currentRoute() === 'overview') || /^(good evening|welcome back)/i.test(title);
  const routeName = isOverview ? 'OVERVIEW' : title.replace(/^(good evening|welcome back)[^.]*\./i, '').trim().toUpperCase();

  const titleWrap = el('div', { class: 'command-title-wrap view-head-copy' }, [
    el('div', { class: 'command-title' }, [
      el('span', { class: 'brand-crumb' }, 'VAANI AI /'),
      el('h1', { class: 'route-crumb' }, routeName || title),
      el('h2', { style: 'display:none' }, title)
    ]),
    kickerOrSub ? el('p', { class: 'command-sub' }, kickerOrSub) : null
  ]);

  const controls = el('div', { class: 'command-controls view-actions' });

  if (isOverview) {
    const dateBtn = el('button', {
      class: 'pill-filter pill-filter-date',
      id: 'hdrFilterDate',
      title: 'Filter by date range',
      html: '<span class="pill-lbl">Date:</span> <span class="pill-val">Now</span> <span class="chevron">∨</span>'
    });
    dateBtn.onclick = () => {
      const ranges = ['Now', 'Last 24h', '7 Days', '30 Days'];
      const valSpan = dateBtn.querySelector('.pill-val');
      const cur = valSpan ? valSpan.textContent : 'Now';
      const next = ranges[(ranges.indexOf(cur) + 1) % ranges.length];
      if (valSpan) valSpan.textContent = next;
      toast('Date filter: ' + next, 'info');
    };

    const agentBtn = el('button', {
      class: 'pill-filter pill-filter-agent',
      id: 'hdrFilterAgent',
      title: 'Filter by agent',
      html: '<span class="pill-lbl">Agent:</span> <span class="pill-val">All</span> <span class="chevron">∨</span>'
    });
    agentBtn.onclick = () => {
      const agents = State.agents || [];
      if (!agents.length) { toast('No agents configured.', 'info'); return; }
      const options = ['All', ...agents.map((a) => a.name)];
      const valSpan = agentBtn.querySelector('.pill-val');
      const cur = valSpan ? valSpan.textContent : 'All';
      const nextIdx = (options.indexOf(cur) + 1) % options.length;
      const next = options[nextIdx];
      if (valSpan) valSpan.textContent = next;
      State.voiceFilters.agentId = next === 'All' ? '' : (agents[nextIdx - 1] ? agents[nextIdx - 1].id : '');
      toast('Filtered by agent: ' + next, 'info');
      const chartHost = $('#overviewChartHost');
      if (chartHost && window.VaaniCharts) {
        loadVoiceAnalytics(State.voiceFilters, false).then((payload) => {
          window.VaaniCharts.mountVoiceOverview(chartHost, payload.data, payload.filters, () => {});
        }).catch(() => {});
      }
    };

    const profileBtn = el('button', {
      class: 'pill-filter pill-filter-profile',
      id: 'hdrFilterProfile',
      title: 'Filter by user profile',
      html: '<span class="pill-lbl">Profile:</span> <span class="pill-val">' + esc((State.me && State.me.user && State.me.user.name) || 'Bogdan') + '</span> <span class="chevron">∨</span>'
    });
    profileBtn.onclick = () => {
      const defaultName = (State.me && State.me.user && State.me.user.name) || 'Bogdan';
      const profiles = [defaultName, 'All Profiles', 'Nixtio'];
      const valSpan = profileBtn.querySelector('.pill-val');
      const cur = valSpan ? valSpan.textContent : defaultName;
      const next = profiles[(profiles.indexOf(cur) + 1) % profiles.length];
      if (valSpan) valSpan.textContent = next;
      toast('Profile filter: ' + next, 'info');
    };

    const tuneBtn = el('button', {
      class: 'pill-filter-tune',
      id: 'hdrFilterTune',
      title: 'Voice Studio Tuning',
      html: '<span class="tune-icon">⊶</span> <span class="pill-val">Tune</span>'
    });
    tuneBtn.onclick = () => goto('studio');

    controls.appendChild(dateBtn);
    controls.appendChild(agentBtn);
    controls.appendChild(profileBtn);
    controls.appendChild(tuneBtn);
  }

  if (actions) {
    if (Array.isArray(actions)) actions.forEach((a) => controls.appendChild(a));
    else controls.appendChild(actions);
  }

  const head = el('div', { class: 'view-head command-header' }, [titleWrap, controls]);

  const originalAppend = head.appendChild.bind(head);
  head.appendChild = function (child) {
    if (child && child.classList && (child.classList.contains('view-actions') || child.classList.contains('btn') || child.classList.contains('pill-filter'))) {
      controls.appendChild(child);
      return child;
    }
    return originalAppend(child);
  };

  return head;
}

/* ===========================================================================
   1. OVERVIEW
   =========================================================================== */
async function renderOverview(root) {
  if (!root) root = $('#view') || document.body;
  if (isPlatformUserClient(State.me && State.me.user)) return viewAgencyOverview(root);
  return viewTenantOverview(root);
}
window.renderOverview = renderOverview;

async function viewOverview(root) {
  return renderOverview(root);
}

async function viewAgencyOverview(root) {
  const name = State.me.user.name || State.me.user.email;
  const head = viewHead('Good evening, ' + name + '.', 'Revenue, client activity, invoices, and operational risk across the agency.');
  head.appendChild(el('div', { class: 'view-actions' }, [
    el('button', { class: 'btn btn-ghost', onclick: () => goto('admin') }, 'Open clients'),
    el('button', { class: 'btn btn-primary', onclick: () => goto('invoices') }, 'Issue invoice')
  ]));
  root.appendChild(head);
  const chartHost = el('div', { class: 'agency-chart-host', 'aria-busy': 'true' }, [skeleton('sk-stat', 4), skeleton('sk-card', 2)]);
  const recentHost = el('div', { class: 'card agency-recent-card' }, skeleton('sk-card', 1));
  const actionCard = el('div', { class: 'card agency-command-card' }, [
    el('span', { class: 'section-kicker' }, 'Next actions'),
    el('h3', {}, 'Move the agency forward.'),
    el('p', {}, 'Log client outreach, issue an invoice, review setup requests, or update the operating prompt.'),
    el('div', { class: 'agency-action-list' }, [
      actionLink('Approach a client', 'Record a WhatsApp, email, call, or meeting touchpoint.', 'admin'),
      actionLink('Issue an invoice', 'Create a stored INR invoice and track its lifecycle.', 'invoices'),
      actionLink('Review integrations', 'WhatsApp and Meta Ad Library setup states.', 'integrations'),
      actionLink('Edit agency prompt', 'Keep one persistent operating instruction.', 'agency-prompt')
    ])
  ]);
  root.appendChild(chartHost);
  root.appendChild(el('div', { class: 'agency-bottom-grid' }, [recentHost, actionCard]));
  try {
    const data = await api('/api/agency/overview');
    State.agency = data; State.loaded.agency = true;
    chartHost.innerHTML = ''; chartHost.removeAttribute('aria-busy');
    const charts = await ensureCharts();
    charts.mountAgencyDashboard(chartHost, data);
    renderRecentAgencyActivity(recentHost, data.recent || []);
  } catch (e) {
    chartHost.innerHTML = '';
    chartHost.appendChild(el('div', { class: 'card card-pad error-state' }, [el('h3', {}, 'Agency analytics unavailable'), el('p', {}, e.message || 'Could not load analytics.'), el('button', { class: 'btn btn-ghost', onclick: () => onRoute() }, 'Try again')]));
    renderRecentAgencyActivity(recentHost, []);
  }
}

function actionLink(title, copy, route) {
  return el('button', { class: 'agency-action', onclick: () => goto(route) }, [
    el('span', {}, [el('strong', {}, title), el('small', {}, copy)]),
    el('span', { class: 'agency-action-arrow', 'aria-hidden': 'true' }, '→')
  ]);
}

function renderRecentAgencyActivity(host, rows) {
  host.innerHTML = '';
  host.appendChild(el('div', { class: 'agency-card-head' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Live operations'), el('h3', {}, 'Recent client activity')]), el('button', { class: 'btn btn-quiet btn-sm', onclick: () => goto('admin') }, 'View clients')]));
  if (!rows.length) {
    host.appendChild(el('div', { class: 'empty compact' }, [el('div', { class: 'ttl' }, 'No client activity yet'), el('p', {}, 'Approaches and lifecycle changes will appear here.') ]));
    return;
  }
  rows.forEach((row) => host.appendChild(el('div', { class: 'agency-activity-row' }, [
    el('span', { class: 'agency-activity-icon' }, initials(row.tenantName)),
    el('div', {}, [el('strong', {}, row.tenantName), el('p', {}, row.summary || row.type)]),
    el('time', {}, relativeTime(row.createdAt))
  ])));
}

function relativeTime(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  return Math.floor(diff / 86400000) + 'd';
}

async function viewTenantOverview(root) {
  const name = (State.me && State.me.user && (State.me.user.name || State.me.user.email)) || 'Bogdan';
  root.appendChild(viewHead('Welcome back, ' + name + '.', 'Voice KPIs, call outcomes, AI runtime spend, and campaign signal for this workspace.'));

  // Paired KPI Metric Cards row (.kpi-card) per media_1788551580193.png & R3
  const kpiCardCustomer = renderKpiCard({
    id: 'kpiCardCustomer',
    title: 'Customer',
    metricA: { delta: '2.4%', up: true, val: '0', lbl: 'Total Calls' },
    metricB: { delta: '1.1%', up: false, val: '0.0%', lbl: 'Answer Rate' },
    sparkType: 'wave'
  });

  const kpiCardProduct = renderKpiCard({
    id: 'kpiCardProduct',
    title: 'Product',
    metricA: { delta: '2.4%', up: true, val: '0s', lbl: 'Talk Time' },
    metricB: { delta: '1.1%', up: false, val: '₹0', lbl: 'AI Spend' },
    sparkType: 'matrix'
  });

  const kpiRow = el('div', { class: 'overview-kpi-row', id: 'overviewKpis' }, [
    kpiCardCustomer,
    kpiCardProduct
  ]);
  root.appendChild(kpiRow);

  function updateKpiCardsWithData(data) {
    const kpis = (data && data.kpis) || {};
    const callsVal = kpis.calls ? Number(kpis.calls).toLocaleString('en-IN') : '0';
    const rateVal = (kpis.answeredRate != null ? Number(kpis.answeredRate).toFixed(1) : '0.0') + '%';
    const timeVal = formatDuration(kpis.durationSec || 0);
    const spendVal = '₹' + Math.round((kpis.aiSpendPaise || 0) / 100).toLocaleString('en-IN');

    const valA1 = kpiCardCustomer.querySelector('.kpi-metric-a .kpi-value');
    const valB1 = kpiCardCustomer.querySelector('.kpi-metric-b .kpi-value');
    if (valA1) valA1.textContent = callsVal;
    if (valB1) valB1.textContent = rateVal;

    const valA2 = kpiCardProduct.querySelector('.kpi-metric-a .kpi-value');
    const valB2 = kpiCardProduct.querySelector('.kpi-metric-b .kpi-value');
    if (valA2) valA2.textContent = timeVal;
    if (valB2) valB2.textContent = spendVal;

    // Dynamically update Dual-Wave Sparkline in Customer Card
    const oldWave = kpiCardCustomer.querySelector('.kpi-spark-wrap');
    const newWave = buildDualWaveSpark(data);
    if (oldWave && oldWave.parentNode) {
      oldWave.parentNode.removeChild(oldWave);
      kpiCardCustomer.appendChild(newWave);
    }

    // Dynamically update Dot-Matrix Visualizer in Product Card
    const oldMatrix = kpiCardProduct.querySelector('.kpi-dot-matrix');
    const newMatrix = buildDotMatrixSpark(data);
    if (oldMatrix && oldMatrix.parentNode) {
      oldMatrix.parentNode.removeChild(oldMatrix);
      kpiCardProduct.appendChild(newMatrix);
    }
  }

  const chartHost = el('div', { class: 'agency-chart-host voice-chart-host', id: 'overviewChartHost', 'aria-busy': 'true' }, [skeleton('sk-stat', 4), skeleton('sk-card', 2)]);
  const body = el('div', { class: 'grid grid-12', style: 'margin-top:18px' }, [
    chartHost,
    el('div', { class: 'card card-pad', id: 'qaHost' }, [
      el('h3', { class: 't-h3', style: 'margin-bottom:14px' }, 'Quick actions'),
      el('div', { class: 'qa-row' }, [
        el('button', { class: 'btn btn-primary', onclick: () => goto('agents') }, 'Build an agent'),
        el('button', { class: 'btn btn-ghost', onclick: () => goto('studio') }, 'Open Voice Studio'),
        el('button', { class: 'btn btn-ghost', onclick: () => goto('talk') }, 'Talk to it'),
        el('button', { class: 'btn btn-ghost', onclick: () => goto('telephony') }, 'Telephony')
      ]),
      el('div', { class: 'divider', style: 'margin:18px 0' }),
      el('div', { id: 'provMini', class: 'soft', style: 'font-size:.85rem' }, 'Checking providers...')
    ])
  ]);
  root.appendChild(body);

  async function loadVoiceAnalytics(filters, demo) {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => { if (value) params.set(key, value); });
    if (demo) params.set('demo', 'true');
    const [overview, filterOptions, agentsRes] = await Promise.all([
      api('/api/voice/overview?' + params.toString()),
      api('/api/voice/filters'),
      State.loaded.agents ? Promise.resolve({ agents: State.agents }) : api('/api/agents')
    ]);
    State.agents = agentsRes.agents || [];
    State.loaded.agents = true;
    State.loaded.voice = true;
    return {
      data: overview.data,
      filters: Object.assign({}, filters, {
        agents: filterOptions.agents || [],
        campaigns: filterOptions.campaigns || [],
        providers: filterOptions.providers || [],
        directions: filterOptions.directions || []
      })
    };
  }

  try {
    const payload = await loadVoiceAnalytics(State.voiceFilters, false);
    updateKpiCardsWithData(payload.data);
    chartHost.innerHTML = '';
    chartHost.removeAttribute('aria-busy');
    const charts = await ensureCharts();
    const rerender = async (nextFilters) => {
      State.voiceFilters = nextFilters;
      chartHost.setAttribute('aria-busy', 'true');
      const next = await loadVoiceAnalytics(nextFilters, false);
      updateKpiCardsWithData(next.data);
      charts.mountVoiceOverview(chartHost, next.data, next.filters, rerender);
      chartHost.removeAttribute('aria-busy');
    };
    charts.mountVoiceOverview(chartHost, payload.data, payload.filters, rerender);
  } catch (e) {
    chartHost.innerHTML = '';
    chartHost.appendChild(el('div', { class: 'card card-pad error-state' }, [
      el('h3', {}, 'Voice analytics unavailable'),
      el('p', {}, e.message || 'Could not load voice analytics.'),
      el('button', { class: 'btn btn-ghost', onclick: async () => {
        try {
          const payload = await loadVoiceAnalytics(State.voiceFilters, true);
          updateKpiCardsWithData(payload.data);
          const charts = await ensureCharts();
          charts.mountVoiceOverview(chartHost, payload.data, payload.filters, () => {});
        } catch (err) { toast(err.message || 'Demo analytics failed.', 'err'); }
      } }, 'Load demo analytics')
    ]));
  }

  ensureProviders().then(() => {
    const pm = $('#provMini'); if (!pm) return;
    const reg = State.providers || {};
    const live = [];
    ['tts', 'llm', 'telephony'].forEach((layer) => {
      (reg[layer] || []).forEach((p) => { if (p.live) live.push(p.label); });
    });
    pm.textContent = live.length ? ('Active providers: ' + live.join(', ') + '.') : 'No live providers detected.';
  }).catch(() => {});
}

function formatDuration(sec) {
  const num = Number(sec);
  const total = Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
  if (total < 60) return total + 's';
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return rem ? (mins + 'm ' + rem + 's') : (mins + 'm');
}

function renderKpiCard(options) {
  const opt = options || {};
  const card = el('div', { class: 'card kpi-card', id: opt.id || undefined }, [
    el('div', { class: 'kpi-card-header' }, [
      el('span', { class: 'kpi-card-title' }, opt.title || ''),
      el('button', { class: 'kpi-card-more', 'aria-label': 'Card actions' }, '···')
    ]),
    el('div', { class: 'kpi-metrics-pair' }, [
      el('div', { class: 'kpi-metric-col kpi-metric-a' }, [
        el('div', { class: 'kpi-indicator ' + (opt.metricA && opt.metricA.up ? 'up' : 'down') }, [
          el('span', { class: 'kpi-arrow' }, opt.metricA && opt.metricA.up ? '▲' : '▼'),
          el('span', { class: 'kpi-delta' }, (opt.metricA && opt.metricA.delta) || '')
        ]),
        el('div', { class: 'kpi-value' }, String((opt.metricA && opt.metricA.val) ?? '')),
        el('div', { class: 'kpi-label' }, (opt.metricA && opt.metricA.lbl) || '')
      ]),
      el('div', { class: 'kpi-metric-col kpi-metric-b' }, [
        el('div', { class: 'kpi-indicator ' + (opt.metricB && opt.metricB.up ? 'up' : 'down') }, [
          el('span', { class: 'kpi-arrow' }, opt.metricB && opt.metricB.up ? '▲' : '▼'),
          el('span', { class: 'kpi-delta' }, (opt.metricB && opt.metricB.delta) || '')
        ]),
        el('div', { class: 'kpi-value' }, String((opt.metricB && opt.metricB.val) ?? '')),
        el('div', { class: 'kpi-label' }, (opt.metricB && opt.metricB.lbl) || '')
      ])
    ]),
    opt.sparkType === 'wave' ? buildDualWaveSpark(opt.data) :
    opt.sparkType === 'matrix' ? buildDotMatrixSpark(opt.data) : null
  ]);
  return card;
}
window.renderKpiCard = renderKpiCard;

function buildDualWaveSpark(data) {
  const wrap = el('div', { class: 'kpi-spark-wrap' });
  const ns = 'http://www.w3.org/2000/svg';
  const W = 280, H = 52, padX = 0, padY = 6;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'kpi-spark-svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Dual wave telemetry sparkline');

  // Series extraction supporting full overview payload, raw series arrays, or KPI summaries
  function extractSeries(d) {
    if (!d) return null;
    let sA = [], sB = [];
    if (Array.isArray(d)) {
      if (!d.length) return null;
      if (typeof d[0] === 'object' && d[0] !== null) {
        sA = d.map((x) => Number(x.calls ?? x.v ?? x.val ?? x.y ?? x.a ?? 0));
        sB = d.map((x) => Number(x.answered ?? x.durationSec ?? x.b ?? (x.calls != null ? x.calls * 0.7 : 0)));
      } else {
        sA = d.map((x) => Number(x || 0));
        sB = sA.map((v, i) => Math.max(0, v * (0.65 + 0.25 * Math.sin((i + 1) * 1.2))));
      }
    } else if (typeof d === 'object') {
      if (Array.isArray(d.days) && d.days.length) {
        sA = d.days.map((x) => Number(x.calls || 0));
        sB = d.days.map((x) => Number(x.answered || 0));
      } else if (Array.isArray(d.seriesA)) {
        sA = d.seriesA.map(Number);
        sB = Array.isArray(d.seriesB) ? d.seriesB.map(Number) : sA.map((v) => v * 0.7);
      } else if (d.kpis && Number(d.kpis.calls || 0) > 0) {
        const calls = Number(d.kpis.calls || 0);
        const rate = Number(d.kpis.answeredRate != null ? d.kpis.answeredRate : 70) / 100;
        sA = [calls * 0.5, calls * 0.8, calls * 1.2, calls * 0.7, calls * 1.1, calls * 0.9];
        sB = sA.map((v) => v * rate);
      }
    }
    if (!sA.length || sA.every((v) => v === 0)) return null;
    return { sA, sB };
  }

  // Smooth Catmull-Rom cubic Bezier spline computation
  function computeSpline(series) {
    const n = series.length;
    const max = Math.max(1, ...series);
    const min = Math.min(0, ...series);
    const range = max - min || 1;
    const coords = series.map((v, i) => ({
      x: Number((padX + (n === 1 ? (W - 2 * padX) / 2 : (i / (n - 1)) * (W - 2 * padX))).toFixed(1)),
      y: Number((H - padY - ((v - min) / range) * (H - 2 * padY)).toFixed(1))
    }));
    if (coords.length === 1) {
      const y = coords[0].y;
      return {
        line: 'M0,' + y + ' L' + W + ',' + y,
        area: 'M0,' + y + ' L' + W + ',' + y + ' L' + W + ',' + H + ' L0,' + H + ' Z'
      };
    }
    let line = 'M' + coords[0].x + ',' + coords[0].y;
    for (let i = 1; i < coords.length; i++) {
      const p0 = coords[i - 1];
      const p1 = coords[i];
      const prev = coords[i - 2] || p0;
      const next = coords[i + 1] || p1;
      const cp1x = Number((p0.x + (p1.x - prev.x) * 0.25).toFixed(1));
      const cp1y = Math.min(H - padY, Math.max(padY, Number((p0.y + (p1.y - prev.y) * 0.25).toFixed(1))));
      const cp2x = Number((p1.x - (next.x - p0.x) * 0.25).toFixed(1));
      const cp2y = Math.min(H - padY, Math.max(padY, Number((p1.y - (next.y - p0.y) * 0.25).toFixed(1))));
      line += ' C' + cp1x + ',' + cp1y + ' ' + cp2x + ',' + cp2y + ' ' + p1.x + ',' + p1.y;
    }
    const area = line + ' L' + coords[n - 1].x + ',' + H + ' L' + coords[0].x + ',' + H + ' Z';
    return { line, area };
  }

  const extracted = extractSeries(data);
  // Elegant baseline curve if telemetry is empty/idle
  const seriesLime = extracted ? extracted.sA : [14, 28, 12, 34, 20, 26];
  const seriesOrange = extracted ? extracted.sB : [20, 10, 30, 15, 28, 18];

  const waveLime = computeSpline(seriesLime);
  const waveOrange = computeSpline(seriesOrange);

  svg.innerHTML =
    '<defs>' +
      '<linearGradient id="waveLimeGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#B9FF66" stop-opacity="0.28"/>' +
        '<stop offset="100%" stop-color="#B9FF66" stop-opacity="0"/>' +
      '</linearGradient>' +
      '<linearGradient id="waveOrangeGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#FF9B22" stop-opacity="0.22"/>' +
        '<stop offset="100%" stop-color="#FF9B22" stop-opacity="0"/>' +
      '</linearGradient>' +
    '</defs>' +
    '<path d="' + waveLime.area + '" fill="url(#waveLimeGrad)" />' +
    '<path d="' + waveLime.line + '" fill="none" stroke="#B9FF66" stroke-width="2.2" stroke-linecap="round" />' +
    '<path d="' + waveOrange.area + '" fill="url(#waveOrangeGrad)" />' +
    '<path d="' + waveOrange.line + '" fill="none" stroke="#FF9B22" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="3 2" />';

  wrap.appendChild(svg);
  return wrap;
}
window.buildDualWaveSpark = buildDualWaveSpark;

function buildDotMatrixSpark(data) {
  const wrap = el('div', { class: 'kpi-dot-matrix', role: 'img', 'aria-label': 'Dot-matrix signal chart' });

  // Baseline fallback pattern preserving reference aesthetic & single-pass unit tests
  const fallback = [
    'green', 'green', 'muted', 'orange', 'green', 'green', 'white', 'muted', 'green', 'orange', 'green', 'white',
    'muted', 'green', 'green', 'green', 'muted', 'orange', 'green', 'green', 'muted', 'green', 'orange', 'green',
    'green', 'orange', 'muted', 'green', 'green', 'white', 'green', 'muted', 'green', 'green', 'orange', 'muted',
    'orange', 'green', 'green', 'muted', 'green', 'green', 'orange', 'green', 'white', 'muted', 'green', 'green'
  ];

  let pattern = fallback;

  if (data) {
    let buckets = new Array(12).fill(0);
    let statusWeights = new Array(12).fill(0); // 0: green, 1: orange, 2: white
    let hasData = false;

    if (Array.isArray(data)) {
      if (data.length > 0) {
        hasData = true;
        if (data.length <= 12) {
          const offset = 12 - data.length;
          data.forEach((item, idx) => {
            const val = typeof item === 'object' && item !== null ? Number(item.durationSec ?? item.v ?? item.calls ?? item.val ?? 0) : Number(item || 0);
            buckets[offset + idx] = val;
          });
        } else {
          const step = data.length / 12;
          for (let c = 0; c < 12; c++) {
            const start = Math.floor(c * step);
            const end = Math.floor((c + 1) * step);
            let sum = 0;
            for (let i = start; i < end; i++) {
              const item = data[i];
              sum += typeof item === 'object' && item !== null ? Number(item.durationSec ?? item.v ?? item.calls ?? item.val ?? 0) : Number(item || 0);
            }
            buckets[c] = sum;
          }
        }
      }
    } else if (typeof data === 'object') {
      if (Array.isArray(data.days) && data.days.length) {
        hasData = true;
        const days = data.days;
        if (days.length <= 12) {
          const offset = 12 - days.length;
          days.forEach((d, idx) => {
            buckets[offset + idx] = Number(d.durationSec || d.calls || 0);
            if (Number(d.aiSpendPaise || 0) > 5000) statusWeights[offset + idx] = 1;
          });
        } else {
          const step = days.length / 12;
          for (let c = 0; c < 12; c++) {
            const start = Math.floor(c * step);
            const end = Math.floor((c + 1) * step);
            let sumDur = 0, sumSpend = 0;
            for (let i = start; i < end; i++) {
              sumDur += Number(days[i].durationSec || 0);
              sumSpend += Number(days[i].aiSpendPaise || 0);
            }
            buckets[c] = sumDur;
            if (sumSpend > 5000 * (end - start)) statusWeights[c] = 1;
          }
        }
      } else if (data.kpis) {
        const total = Number(data.kpis.durationSec || data.kpis.calls || 0);
        if (total > 0) {
          hasData = true;
          const profile = [0.4, 0.6, 0.3, 0.7, 0.9, 1.0, 0.8, 0.5, 0.7, 0.6, 0.4, 0.2];
          buckets = profile.map((p) => p * total / 12);
        }
      }
    }

    if (hasData && !buckets.every((v) => v === 0)) {
      const maxVal = Math.max(1, ...buckets);
      const heights = buckets.map((v) => (v > 0 ? Math.min(4, Math.max(1, Math.round((v / maxVal) * 4))) : 0));
      pattern = [];
      for (let r = 0; r < 4; r++) {
        const levelFromBottom = 4 - r; // r=0 is top (level 4), r=3 is bottom (level 1)
        for (let c = 0; c < 12; c++) {
          const colHeight = heights[c];
          if (levelFromBottom > colHeight) {
            pattern.push('muted');
          } else {
            if (statusWeights[c] === 1) {
              pattern.push(levelFromBottom === colHeight ? 'orange' : 'green');
            } else if (levelFromBottom === colHeight && colHeight === 4) {
              pattern.push(c % 3 === 0 ? 'white' : 'green');
            } else if (c % 5 === 2 && levelFromBottom === 2) {
              pattern.push('white');
            } else {
              pattern.push('green');
            }
          }
        }
      }
    }
  }

  pattern.forEach((type) => {
    const dot = el('span', { class: 'matrix-dot ' + (type !== 'muted' ? type : '') });
    wrap.appendChild(dot);
  });
  return wrap;
}
window.buildDotMatrixSpark = buildDotMatrixSpark;

function statCard(lbl, val, delta, up) {
  const isUp = up !== false && (up === true || !String(delta).includes('-'));
  const arrow = isUp ? '▲ ' : '▼ ';
  const deltaText = delta ? (String(delta).startsWith('▲') || String(delta).startsWith('▼') ? delta : (arrow + delta)) : '';
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'lbl' }, lbl),
    el('div', { class: 'val' }, val),
    el('div', { class: 'delta' + (isUp ? ' up' : ' down') }, deltaText)
  ]);
}
function estimateCost(usage) {
  // fallback if backend does not return costInr in totals
  let c = 0;
  (usage.days || []).forEach((d) => { c += (d.costInr || (d.chars || 0) / 1000 * RATE.mulberry); });
  return Math.round(c * 100) / 100;
}

/* ---- sparkline (inline SVG, no libs) ---- */
function sparkPanel(days) {
  const data = (days || []).map((d) => ({ day: d.day, v: d.chars || 0 }));
  const total = data.reduce((s, d) => s + d.v, 0);
  const head = el('div', { class: 'hd' }, [
    el('div', { class: 't' }, 'Usage, characters per day'),
    el('div', { class: 'v' }, '₹' + Math.round(total / 1000).toLocaleString('en-IN') + ' total')
  ]);
  const svg = buildSpark(data);
  const xlabels = el('div', { class: 'spark-x' }, [
    el('span', {}, data.length ? shortDay(data[0].day) : ''),
    el('span', {}, data.length ? shortDay(data[data.length - 1].day) : 'no data yet')
  ]);
  return el('div', {}, [head, svg, xlabels]);
}
function shortDay(iso) {
  if (!iso) return '';
  const p = iso.split('-'); return p.length === 3 ? (p[2] + '/' + p[1]) : iso;
}
function buildSpark(data) {
  const W = 600, H = 120, pad = 6;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'spark-svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML =
    '<defs>' +
    '<linearGradient id="sparkline" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B9FF66"/><stop offset="0.6" stop-color="#FF9B22"/><stop offset="1" stop-color="#B9FF66"/></linearGradient>' +
    '<linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B9FF66" stop-opacity="0.24"/><stop offset="1" stop-color="#B9FF66" stop-opacity="0"/></linearGradient>' +
    '</defs>';
  if (!data.length) {
    const txt = document.createElementNS(ns, 'text');
    txt.setAttribute('x', W / 2); txt.setAttribute('y', H / 2 + 4); txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', '#777777'); txt.setAttribute('font-size', '13'); txt.setAttribute('font-family', 'monospace');
    txt.textContent = 'Synthesize something to see usage here.';
    svg.appendChild(txt);
    return svg;
  }
  const max = Math.max(1, ...data.map((d) => d.v));
  const n = data.length;
  const x = (i) => pad + (n === 1 ? (W - 2 * pad) / 2 : (i / (n - 1)) * (W - 2 * pad));
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  let line = '';
  data.forEach((d, i) => { line += (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(d.v).toFixed(1) + ' '; });
  const area = 'M' + x(0).toFixed(1) + ' ' + (H - pad) + ' ' + line.replace(/^M/, 'L') + 'L' + x(n - 1).toFixed(1) + ' ' + (H - pad) + ' Z';
  const areaP = document.createElementNS(ns, 'path'); areaP.setAttribute('class', 'area'); areaP.setAttribute('d', area);
  const lineP = document.createElementNS(ns, 'path'); lineP.setAttribute('class', 'ln'); lineP.setAttribute('d', line.trim());
  svg.appendChild(areaP); svg.appendChild(lineP);
  // last point dot
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', x(n - 1)); c.setAttribute('cy', y(data[n - 1].v)); c.setAttribute('r', 3.2);
  c.setAttribute('fill', '#B9FF66'); c.setAttribute('stroke', '#1F1F1F'); c.setAttribute('stroke-width', '1');
  svg.appendChild(c);
  return svg;
}

/* ===========================================================================
   PROVIDERS + AGENTS data loaders
   =========================================================================== */
async function ensureProviders() {
  if (State.loaded.providers) return State.providers;
  const res = await api('/api/providers');
  State.credentialStatus = res.credentialStatus || [];
  State.providers = {
    stt: res.stt || [],
    llm: res.llm || [],
    tts: res.tts || [],
    telephony: res.telephony || [],
  };
  State.loaded.providers = true;
  return State.providers;
}
async function ensureAgents(force) {
  if (State.loaded.agents && !force) return State.agents;
  const res = await api('/api/agents');
  State.agents = res.agents || [];
  State.loaded.agents = true;
  return State.agents;
}
async function ensureTelephony(force) {
  if (State.loaded.telephony && !force) return State.telephony;
  const res = await api('/api/telephony/status');
  State.telephony = res.carriers ? res : { carriers: { vobiz: res } };
  State.loaded.telephony = true;
  return State.telephony;
}

function telephonyCarrier(id) {
  const root = State.telephony || {};
  return (root.carriers && root.carriers[id]) || (root.provider === id ? root : null);
}

function dids() {
  const vobiz = telephonyCarrier('vobiz') || {};
  const voicelink = telephonyCarrier('voicelink') || {};
  const list = []
    .concat(Array.isArray(vobiz.dids) ? vobiz.dids : [])
    .concat(Array.isArray(voicelink.dids) ? voicelink.dids : []);
  if (!list.length) {
    if (vobiz.did) list.push({ number: vobiz.did });
    if (voicelink.did) list.push({ number: voicelink.did });
  }
  return list.map((d) => (typeof d === 'string' ? d : d.number || d.did)).filter(Boolean);
}

/* ===========================================================================
   2. AGENTS
   =========================================================================== */
async function viewAgents(root) {
  root.appendChild(viewHead('Agents', 'Each agent is a persona plus a voice. Preview the voice, then assign a number and ship it.'));

  const builder = buildAgentForm(null);
  root.appendChild(builder);

  const gridHost = el('div', { id: 'agentsGrid', class: 'agents-grid', style: 'margin-top:22px' }, skeleton('sk-card', 3));
  root.appendChild(gridHost);

  try {
    await Promise.all([ensureAgents(true), ensureTelephony().catch(() => null), ensureProviders().catch(() => null)]);
    refillDidOptions();
    paintAgents();
  } catch (e) {
    gridHost.innerHTML = '';
    gridHost.appendChild(el('div', { class: 'empty muted' }, 'Could not load agents. ' + esc(e.message)));
  }
}

function refillDidOptions() {
  const sel = $('#f_did'); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: '' }, 'No number assigned'));
  dids().forEach((n) => sel.appendChild(el('option', { value: n }, n)));
  if (cur) sel.value = cur;
}

function buildAgentForm(existing) {
  const e = existing || {};
  const tts = e.tts || {};
  const card = el('div', { class: 'card builder' });
  const state = {
    provider: tts.provider || 'rumik',
    model: tts.model || (tts.provider === 'sarvam' ? 'bulbul:v3' : 'mulberry'),
    voice: tts.voice || 'shubh',
    speaker: tts.speaker || 'speaker_2',
    f0: tts.f0_up_key != null ? tts.f0_up_key : 0
  };

  const nameI = el('input', { class: 'input', id: 'f_name', type: 'text', value: e.name || '', placeholder: 'Front Desk', maxlength: 80 });
  const personaI = el('textarea', { class: 'textarea', id: 'f_persona', rows: 4, placeholder: 'You are a warm, sharp receptionist. Answer in 1 to 2 short spoken sentences, qualify the lead, and book a callback.' }, e.persona || '');
  const greetI = el('input', { class: 'input', id: 'f_greeting', type: 'text', value: e.greeting || '', placeholder: 'Hi, thanks for calling Vaani AI. How can I help today.', maxlength: 600 });
  const descI = el('input', { class: 'input', id: 'f_desc', type: 'text', value: (tts.description || ''), placeholder: 'Optional voice direction, e.g. calm and confident' });

  const brandSeg = el('div', { class: 'seg', id: 'f_brand_seg' }, [
    el('button', { type: 'button', class: state.provider === 'rumik' ? 'on' : '', 'data-p': 'rumik', onclick: () => { state.provider = 'rumik'; if (!VOICE_MODELS.includes(state.model)) state.model = 'mulberry'; syncVoice(); } }, 'Vaani Native (Rumik)'),
    el('button', { type: 'button', class: state.provider === 'sarvam' ? 'on' : '', 'data-p': 'sarvam', onclick: () => { state.provider = 'sarvam'; if (!SARVAM_TTS_MODELS.includes(state.model)) state.model = 'bulbul:v3'; syncVoice(); } }, 'Sarvam'),
  ]);
  const brandHint = el('p', { class: 'hint', id: 'f_brand_hint', style: 'margin:6px 0 0' }, '');

  const rumikModelSeg = el('div', { class: 'seg', id: 'f_rumik_model_seg' }, VOICE_MODELS.map((m) =>
    el('button', { type: 'button', class: m === state.model ? 'on' : '', 'data-m': m, onclick: () => { state.model = m; syncVoice(); } }, m)
  ));
  const rumikModelHint = el('p', { class: 'hint', id: 'f_rumik_model_hint', style: 'margin:6px 0 0' }, '');

  const sarvamModelSeg = el('div', { class: 'seg', id: 'f_sarvam_model_seg' }, SARVAM_TTS_MODELS.map((m) =>
    el('button', { type: 'button', class: m === state.model ? 'on' : '', 'data-m': m, onclick: () => { state.model = m; syncVoice(); } }, m)
  ));
  const sarvamModelHint = el('p', { class: 'hint', id: 'f_sarvam_model_hint', style: 'margin:6px 0 0' }, '');

  const sarvamVoiceSel = el('select', { class: 'select', id: 'f_sarvam_voice' }, SARVAM_VOICES.map((v) =>
    el('option', { value: v, selected: v === state.voice ? 'selected' : false }, v)
  ));
  sarvamVoiceSel.addEventListener('change', () => { state.voice = sarvamVoiceSel.value; });

  const speakerSel = el('select', { class: 'select', id: 'f_speaker' }, SPEAKERS.map((s) =>
    el('option', { value: s, selected: s === state.speaker ? 'selected' : false }, s)
  ));
  speakerSel.addEventListener('change', () => { state.speaker = speakerSel.value; });
  const f0Val = el('span', { class: 'rv', id: 'f_f0_val' }, String(state.f0));
  const f0Range = el('input', { type: 'range', id: 'f_f0', min: -12, max: 12, step: 1, value: state.f0, oninput: (ev) => { state.f0 = +ev.target.value; f0Val.textContent = (state.f0 > 0 ? '+' : '') + state.f0; } });
  if (state.f0 > 0) f0Val.textContent = '+' + state.f0;

  const didSel = el('select', { class: 'select', id: 'f_did' }, [el('option', { value: '' }, 'No number assigned')]);
  if (e.telephony && e.telephony.did) { /* set after dids load */ setTimeout(() => { try { didSel.value = e.telephony.did; } catch (x) {} }, 0); }
  const wfI = el('input', { class: 'input', id: 'f_workflow', type: 'number', min: '1', placeholder: 'Dograh workflow ID', value: e.dograhWorkflowId || '' });
  const restrictedI = el('input', { type: 'checkbox', id: 'f_restricted', checked: e.restricted ? 'checked' : false });

  const brandField = field('Voice brand (TTS provider)', el('div', {}, [brandSeg, brandHint]));
  const rumikModelField = field('Vaani Native model', el('div', {}, [rumikModelSeg, rumikModelHint]));
  const sarvamModelField = field('Sarvam model', el('div', {}, [sarvamModelSeg, sarvamModelHint]));
  const sarvamVoiceField = field('Sarvam voice', sarvamVoiceSel);
  const speakerField = field('Speaker (Vaani Native mulberry)', speakerSel);
  const descField = field('Voice direction (Vaani Native mulberry)', descI);

  function syncVoice() {
    $$('#f_brand_seg button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-p') === state.provider));
    $$('#f_rumik_model_seg button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-m') === state.model));
    $$('#f_sarvam_model_seg button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-m') === state.model));
    const isRumik = state.provider === 'rumik';
    const isMul = isRumik && state.model === 'mulberry';
    brandHint.textContent = isRumik
      ? 'Vaani Native (Rumik) TTS. Pick mulberry for fast phone agents or muga for expressive delivery.'
      : 'Sarvam Bulbul TTS. Pick a Bulbul model, then choose the speaker voice.';
    rumikModelHint.textContent = RUMIK_MODEL_HINTS[state.model] || '';
    sarvamModelHint.textContent = SARVAM_MODEL_HINTS[state.model] || '';
    rumikModelField.style.display = isRumik ? '' : 'none';
    sarvamModelField.style.display = isRumik ? 'none' : '';
    sarvamVoiceField.style.display = isRumik ? 'none' : '';
    speakerField.style.display = isMul ? '' : 'none';
    descField.style.display = isMul ? '' : 'none';
    f0Range.closest('.field').style.display = isMul ? '' : 'none';
  }

  const useWorkspaceI = el('input', { type: 'checkbox', id: 'f_use_workspace', checked: e.useWorkspacePipeline !== false ? 'checked' : false });
  const pipelineWrap = el('div', { class: 'settings-form', id: 'f_pipeline_wrap', style: e.useWorkspacePipeline === false ? '' : 'display:none' });
  const pipelineState = { useWorkspace: e.useWorkspacePipeline !== false, getPipeline: null };
  useWorkspaceI.addEventListener('change', () => {
    pipelineState.useWorkspace = useWorkspaceI.checked;
    pipelineWrap.style.display = pipelineState.useWorkspace ? 'none' : '';
  });
  ensureProviders().then((reg) => {
    const controls = buildPipelineControls(reg, e.pipeline || {});
    pipelineState.getPipeline = controls.getPayload;
    pipelineWrap.appendChild(controls.root);
  }).catch(() => {});

  const submitBtn = el('button', { class: 'btn btn-primary' }, existing ? 'Save changes' : 'Create agent');
  const form = el('form', { onsubmit: onSave }, [
    el('div', { class: 'form-grid' }, [
      field('Agent name', nameI),
      field('Assigned number', didSel),
      field('Dograh workflow ID', wfI),
      el('div', { class: 'field' }, [el('label', {}, [restrictedI, document.createTextNode(' Restrict this agent to admins')])]),
      (function () { const f = field('Persona', personaI); f.classList.add('full'); return f; })(),
      (function () { const f = field('Greeting', greetI); f.classList.add('full'); return f; })(),
      el('div', { class: 'field full' }, [el('label', {}, [useWorkspaceI, document.createTextNode(' Use workspace pipeline defaults')])]),
      pipelineWrap,
      el('div', { class: 'field full' }, [el('div', { class: 'section-kicker', style: 'margin-bottom:10px' }, 'Voice'), el('p', { class: 'hint', style: 'margin:0 0 12px' }, 'Choose the TTS brand, then pick the model and voice settings for this agent.')]),
      brandField,
      rumikModelField,
      sarvamModelField,
      sarvamVoiceField,
      field('Pitch, f0_up_key (Vaani Native mulberry)', el('div', { class: 'range-row' }, [f0Range, f0Val])),
      speakerField,
      descField
    ]),
    el('div', { class: 'flex gap-2', style: 'margin-top:18px;align-items:center' }, [submitBtn, existing ? el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => modalClose() }, 'Cancel') : null])
  ]);

  card.appendChild(el('h3', {}, existing ? 'Edit agent' : 'New agent'));
  card.appendChild(el('p', { class: 'hint' }, existing ? 'Update the persona, voice, or assigned number.' : 'Describe the persona and pick a voice. You can preview it instantly before assigning a number.'));
  card.appendChild(form);
  syncVoice();

  let _modalClose = null;
  function modalClose() { if (_modalClose) _modalClose(); }
  card._setModalClose = (fn) => { _modalClose = fn; };

  async function onSave(ev) {
    ev.preventDefault();
    const name = nameI.value.trim();
    const persona = personaI.value.trim();
    if (!name) { toast('Give the agent a name.', 'err'); nameI.focus(); return; }
    if (!persona) { toast('Add a persona so the agent knows how to behave.', 'err'); personaI.focus(); return; }
    submitBtn.disabled = true; submitBtn.textContent = existing ? 'Saving...' : 'Creating...';
    const payload = {
      name: name,
      persona: persona,
      greeting: greetI.value.trim(),
      did: didSel.value || '',
      dograhWorkflowId: wfI.value ? Number(wfI.value) : null,
      restricted: restrictedI.checked,
      useWorkspacePipeline: pipelineState.useWorkspace,
      tts: {
        provider: state.provider,
        model: state.model,
        speaker: state.speaker,
        f0_up_key: state.f0,
        voice: state.voice,
        description: descI.value.trim()
      }
    };
    if (!pipelineState.useWorkspace && pipelineState.getPipeline) payload.pipeline = pipelineState.getPipeline();
    try {
      if (existing) {
        payload.id = existing.id;
        const res = await api('/api/agents/update', { method: 'POST', body: payload });
        const idx = State.agents.findIndex((a) => a.id === existing.id);
        if (idx !== -1) State.agents[idx] = res.agent || Object.assign({}, existing, payload);
        toast('Agent updated.', 'ok');
        modalClose();
      } else {
        const res = await api('/api/agents', { method: 'POST', body: payload });
        if (res.agent) State.agents.push(res.agent);
        toast('Agent created.', 'ok');
        // reset the inline form
        nameI.value = ''; personaI.value = ''; greetI.value = ''; descI.value = ''; didSel.value = '';
      }
      paintAgents();
    } catch (ex) {
      toast(ex.message || 'Could not save agent.', 'err');
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = existing ? 'Save changes' : 'Create agent';
    }
  }

  return card;
}

function paintAgents() {
  const grid = $('#agentsGrid'); if (!grid) return;
  refillDidOptions();
  grid.innerHTML = '';
  if (!State.agents.length) {
    grid.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'ttl' }, 'No agents yet'),
      el('div', {}, 'Use the builder above to create your first voice agent.')
    ]));
    return;
  }
  State.agents.forEach((a) => grid.appendChild(agentCard(a)));
}

function agentCard(a) {
  const tts = a.tts || {};
  const brand = (tts.provider || 'rumik');
  const model = tts.model || (brand === 'sarvam' ? 'bulbul:v3' : 'mulberry');
  const voiceLine = brand === 'sarvam'
    ? ('Sarvam / ' + model + (tts.voice ? ' / ' + tts.voice : ''))
    : ('Vaani Native (Rumik) / ' + model + (tts.speaker ? ' / ' + tts.speaker : '') + (tts.f0_up_key ? ' / pitch ' + (tts.f0_up_key > 0 ? '+' : '') + tts.f0_up_key : ''));
  const did = a.telephony && a.telephony.did ? a.telephony.did : null;

  const previewBtn = el('button', { class: 'btn btn-ghost btn-sm' }, 'Preview voice');
  previewBtn.addEventListener('click', () => previewAgentVoice(a, previewBtn));

  // textContent everywhere = XSS safe for persona/name
  return el('div', { class: 'card card-glow agent-card' }, [
    el('div', { class: 'ac-top' }, [
      el('div', { class: 'ac-av' }, initials(a.name)),
      el('div', { style: 'min-width:0' }, [
        el('div', { class: 'ac-name' }, a.name),
        el('div', { class: 'ac-voice' }, voiceLine)
      ])
    ]),
    el('div', { class: 'ac-persona' }, a.persona || 'No persona set.'),
    capabilityTags(a),
    el('div', { class: 'ac-meta' }, [
      did ? el('span', { class: 'tag' }, did) : el('span', { class: 'tag' }, 'no number'),
      el('span', { class: 'tag' }, brand + ' / ' + model),
      a.restricted ? el('span', { class: 'tag tag-access' }, 'Admin only') : null
    ]),
    el('div', { class: 'ac-actions' }, [
      previewBtn,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openEditAgent(a) }, 'Edit'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => confirmDeleteAgent(a) }, 'Delete')
    ])
  ]);
}

async function previewAgentVoice(a, btn) {
  const tts = a.tts || {};
  const text = (a.greeting && a.greeting.trim()) || ('Hi, this is ' + (a.name || 'your agent') + '. How can I help today.');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'Synthesizing...';
  try {
    const body = {
      text: text,
      provider: tts.provider || 'rumik',
      model: tts.model || (tts.provider === 'sarvam' ? 'bulbul:v3' : 'mulberry'),
      speaker: tts.speaker,
      f0_up_key: tts.f0_up_key,
      description: tts.description,
      voice: tts.voice,
      language: tts.provider === 'sarvam' ? 'hi-IN' : undefined
    };
    const res = await api('/api/tts', { method: 'POST', body: body });
    const buf = await res.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    btn.textContent = 'Playing...';
    audio.onended = () => { btn.textContent = old; btn.disabled = false; URL.revokeObjectURL(url); };
  } catch (ex) {
    toast(ex.message || 'Voice preview failed.', 'err');
    btn.textContent = old; btn.disabled = false;
  }
}

function openEditAgent(a) {
  const form = buildAgentForm(a);
  form.style.boxShadow = 'none'; form.style.border = '0'; form.style.background = 'transparent'; form.style.padding = '0';
  const host = $('#modal-host');
  const close = () => { activeModalClose = null; host.classList.add('hide'); host.setAttribute('aria-hidden', 'true'); host.innerHTML = ''; };
  activeModalClose = close;
  form._setModalClose(() => { close(); paintAgents(); });
  const card = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: 'max-width:600px' }, [form]);
  host.innerHTML = '';
  host.appendChild(el('div', { onclick: (ev) => { if (ev.target === ev.currentTarget) close(); }, style: 'position:absolute;inset:0' }));
  host.appendChild(card);
  host.classList.remove('hide');
  host.setAttribute('aria-hidden', 'false');
  setTimeout(refillDidOptions, 0);
}

function confirmDeleteAgent(a) {
  modal({
    title: 'Delete agent',
    body: el('p', {}, ['Delete ', el('b', {}, a.name), '. This cannot be undone.']),
    confirmText: 'Delete agent', confirmKind: 'danger',
    onConfirm: async () => {
      await api('/api/agents/delete', { method: 'POST', body: { id: a.id } });
      State.agents = State.agents.filter((x) => x.id !== a.id);
      paintAgents();
      toast('Agent deleted.', 'ok');
    }
  });
}

/* helper used by builder */
function field(label, input) { return el('div', { class: 'field' }, [el('label', {}, label), input]); }

function pipelineLayerModels(layerKey, picked) {
  if (layerKey === 'tts' && picked.id === 'rumik') return VOICE_MODELS;
  if (layerKey === 'tts' && picked.id === 'sarvam') return ['bulbul:v2', 'bulbul:v3'];
  if (layerKey === 'stt' && picked.id === 'sarvam') return ['saarika:v2.5', 'saaras:v3'];
  if (layerKey === 'llm' && picked.id === 'groq') return ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
  if (layerKey === 'llm' && picked.id === 'sarvam') return ['sarvam-105b'];
  if (layerKey === 'llm' && picked.id === 'gemini') return ['gemini-flash-latest', 'gemini-2.5-flash'];
  return [picked.model].filter(Boolean);
}

function buildPipelineControls(reg, existingPipe) {
  const state = {
    stt: { provider: (existingPipe.stt || {}).provider || 'deepgram', model: (existingPipe.stt || {}).model || '' },
    llm: { provider: (existingPipe.llm || {}).provider || 'groq', model: (existingPipe.llm || {}).model || '' },
    tts: { provider: (existingPipe.tts || {}).provider || 'rumik', model: (existingPipe.tts || {}).model || '', voice: (existingPipe.tts || {}).voice || '' },
  };
  const root = el('div', { class: 'settings-form' });
  ['stt', 'llm', 'tts'].forEach((layerKey) => {
    const list = (reg[layerKey] || []).filter((p) => p.implemented);
    const provSel = el('select', { class: 'select' }, list.map((p) => el('option', { value: p.id, selected: p.id === state[layerKey].provider ? 'selected' : false }, p.label)));
    const modelSel = el('select', { class: 'select' });
    const voiceSel = layerKey === 'tts' ? el('select', { class: 'select' }, SARVAM_VOICES.map((v) => el('option', { value: v, selected: v === state[layerKey].voice ? 'selected' : false }, v))) : null;
    function refillModels() {
      const picked = list.find((p) => p.id === provSel.value) || list[0];
      state[layerKey].provider = provSel.value;
      modelSel.innerHTML = '';
      pipelineLayerModels(layerKey, picked).forEach((m) => modelSel.appendChild(el('option', { value: m, selected: m === state[layerKey].model ? 'selected' : false }, m)));
      if (voiceSel) voiceSel.style.display = picked.id === 'sarvam' ? '' : 'none';
    }
    provSel.addEventListener('change', refillModels);
    refillModels();
    const fields = [field(layerKey.toUpperCase() + ' provider', provSel), field('Model', modelSel)];
    if (voiceSel) fields.push(field('Sarvam voice', voiceSel));
    root.appendChild(el('div', { style: 'margin-bottom:10px' }, fields));
    state[layerKey].modelSel = modelSel;
    if (voiceSel) state[layerKey].voiceSel = voiceSel;
  });
  return {
    root,
    getPayload() {
      return {
        stt: { provider: state.stt.provider, model: state.stt.modelSel.value },
        llm: { provider: state.llm.provider, model: state.llm.modelSel.value },
        tts: {
          provider: state.tts.provider,
          model: state.tts.modelSel.value,
          ...(state.tts.voiceSel ? { voice: state.tts.voiceSel.value } : {}),
        },
      };
    },
  };
}

/* ===========================================================================
   3. VOICE STUDIO
   =========================================================================== */
function viewStudio(root) {
  root.appendChild(viewHead('Voice Studio', 'Type anything, pick a model, and synthesize. See the waveform, hear it back, and watch the cost in real time.'));

  const st = { provider: 'rumik', model: 'mulberry', tone: 'neutral', speaker: 'speaker_2', f0: 0, stream: false, voice: 'shubh' };

  const providerSeg = el('div', { class: 'seg' }, ['rumik', 'sarvam'].map((p) =>
    el('button', { type: 'button', class: p === st.provider ? 'on' : '', 'data-p': p, onclick: () => { st.provider = p; syncCtl(); updateCost(); } }, p === 'rumik' ? 'Vaani Native (Rumik)' : (p === 'sarvam' ? 'Sarvam' : p))
  ));
  const sarvamVoiceSel = el('select', { class: 'select' }, SARVAM_VOICES.map((v) => el('option', { value: v, selected: v === st.voice ? 'selected' : false }, v)));
  sarvamVoiceSel.addEventListener('change', () => { st.voice = sarvamVoiceSel.value; });

  const textArea = el('textarea', { class: 'textarea studio-text', id: 's_text', placeholder: 'Welcome to Vaani AI. Production-grade AI voice starts from ₹1 per minute for the AI layer.' }, 'Welcome to Vaani AI. Production-grade AI voice starts from ₹1 per minute for the AI layer.');

  // model picker
  const modelSeg = el('div', { class: 'seg' }, VOICE_MODELS.map((m) =>
    el('button', { type: 'button', class: m === st.model ? 'on' : '', 'data-m': m, onclick: () => { st.model = m; syncCtl(); updateCost(); } }, m)
  ));
  // muga tones
  const toneSeg = el('div', { class: 'seg', id: 's_tones' }, MUGA_TONES.map((tn) =>
    el('button', { type: 'button', class: tn === st.tone ? 'on' : '', 'data-t': tn, onclick: () => { st.tone = tn; $$('#s_tones button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-t') === tn)); } }, tn)
  ));
  // mulberry controls
  const speakerSel = el('select', { class: 'select' }, SPEAKERS.map((s) => el('option', { value: s, selected: s === st.speaker ? 'selected' : false }, s)));
  speakerSel.addEventListener('change', () => { st.speaker = speakerSel.value; });
  const f0Val = el('span', { class: 'rv' }, '0');
  const f0Range = el('input', { type: 'range', min: -12, max: 12, step: 1, value: 0, oninput: (ev) => { st.f0 = +ev.target.value; f0Val.textContent = (st.f0 > 0 ? '+' : '') + st.f0; } });
  const descI = el('input', { class: 'input', placeholder: 'Optional voice direction, e.g. warm and reassuring' });
  descI.addEventListener('input', () => { st.desc = descI.value; });

  const mugaCtl = field('Tone (muga)', toneSeg);
  const mulSpeaker = field('Speaker (mulberry)', speakerSel);
  const mulPitch = field('Pitch, f0_up_key', el('div', { class: 'range-row' }, [f0Range, f0Val]));
  const mulDesc = field('Voice direction (mulberry)', descI);
  const rumikModelField = field('Model', modelSeg);
  const sarvamModelSeg = el('div', { class: 'seg', id: 's_sarvam_models' }, ['bulbul:v2', 'bulbul:v3'].map((m) =>
    el('button', { type: 'button', class: m === 'bulbul:v3' ? 'on' : '', 'data-m': m, onclick: () => { st.model = m; $$('#s_sarvam_models button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-m') === m)); } }, m)
  ));
  const sarvamModelField = field('Sarvam model', sarvamModelSeg);
  const sarvamVoiceField = field('Sarvam voice', sarvamVoiceSel);

  const streamToggle = el('label', { class: 'streamtoggle' }, [
    el('input', { type: 'checkbox', onchange: (ev) => { st.stream = ev.target.checked; } }),
    document.createTextNode('Stream progressively (low latency)')
  ]);

  function syncCtl() {
    $$('.seg button[data-p]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-p') === st.provider));
    const isRumik = st.provider === 'rumik';
    const isMul = isRumik && st.model === 'mulberry';
    rumikModelField.style.display = isRumik ? '' : 'none';
    sarvamModelField.style.display = isRumik ? 'none' : '';
    sarvamVoiceField.style.display = isRumik ? 'none' : '';
    mugaCtl.style.display = isMul ? '' : 'none';
    [mulSpeaker, mulPitch, mulDesc].forEach((f) => f.style.display = isMul ? '' : 'none');
    streamToggle.style.display = isRumik ? '' : 'none';
    if (!isRumik && !['bulbul:v2', 'bulbul:v3'].includes(st.model)) st.model = 'bulbul:v3';
  }

  const charsEl = el('span', { class: 'c-chars', id: 's_chars' }, '0 chars');
  const costEl = el('span', { class: 'c-cost', id: 's_cost' }, [document.createTextNode('about '), el('b', {}, '₹0.00')]);
  function updateCost() {
    const len = (textArea.value || '').length;
    const capped = Math.min(len, 2000);
    const cost = capped / 1000 * (RATE[st.model] || RATE.mulberry);
    charsEl.textContent = len + ' chars' + (len > 2000 ? ' (capped at 2000)' : '');
    costEl.innerHTML = '';
    costEl.appendChild(document.createTextNode('about '));
    costEl.appendChild(el('b', {}, '₹' + cost.toFixed(2)));
  }
  textArea.addEventListener('input', updateCost);

  const synthBtn = el('button', { class: 'btn btn-primary' }, 'Synthesize');
  const audioEl = el('audio', { controls: 'controls', preload: 'none' });
  const waveCanvas = el('canvas', { class: 'wave-canvas', id: 's_wave' });
  const playerRow = el('div', { class: 'player-row', style: 'display:none' }, [audioEl]);

  synthBtn.addEventListener('click', () => doSynthesize(st, textArea, synthBtn, audioEl, waveCanvas, playerRow));

  const main = el('div', { class: 'card studio-main' }, [
    field('Text to speak', textArea),
    el('div', { class: 'wave-wrap' }, [waveCanvas, playerRow]),
    el('div', { class: 'flex items-center gap-2', style: 'flex-wrap:wrap' }, [synthBtn, streamToggle])
  ]);

  const side = el('div', { class: 'studio-side' }, [
    el('div', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3', style: 'margin-bottom:14px' }, 'Voice'),
      field('TTS provider', providerSeg),
      rumikModelField,
      sarvamModelField,
      sarvamVoiceField,
      mugaCtl, mulSpeaker, mulPitch, mulDesc
    ]),
    el('div', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3', style: 'margin-bottom:14px' }, 'Economics'),
      el('div', { class: 'cost-readout' }, [charsEl, costEl]),
      el('p', { class: 'muted', style: 'font-size:.8rem;margin-top:10px' }, 'Mulberry promo is about Rs 0.50 per 1000 chars, roughly 20x cheaper than ElevenLabs.')
    ])
  ]);

  root.appendChild(el('div', { class: 'studio-grid' }, [main, side]));
  syncCtl(); updateCost();
  // size the canvas after layout
  setTimeout(() => sizeCanvas(waveCanvas), 30);
  window.addEventListener('resize', () => sizeCanvas(waveCanvas), { once: true });
}

async function doSynthesize(st, textArea, btn, audioEl, canvas, playerRow) {
  const raw = (textArea.value || '').trim();
  if (!raw) { toast('Type something to synthesize.', 'err'); textArea.focus(); return; }
  let text = raw.slice(0, 2000);
  // muga tone is applied as a [tone] prefix
  if (st.model === 'muga' && st.tone && st.tone !== 'neutral') text = '[' + st.tone + '] ' + text;

  const old = btn.textContent; btn.disabled = true; btn.textContent = 'Synthesizing...';

  if (st.stream) {
    try {
      await streamSynthesize(text, st, canvas, btn);
      btn.disabled = false; btn.textContent = old;
      refreshUsageSoft();
      return;
    } catch (ex) {
      toast('Stream failed, falling back to file. ' + (ex.message || ''), 'info');
      // fall through to normal synth
    }
  }

  try {
    const body = { text: text, provider: st.provider, model: st.model };
    if (st.provider === 'rumik' && st.model === 'mulberry') { body.speaker = st.speaker; body.f0_up_key = st.f0; if (st.desc) body.description = st.desc; }
    if (st.provider === 'sarvam') { body.voice = st.voice; body.language = 'hi-IN'; }
    const res = await api('/api/tts', { method: 'POST', body: body });
    const chars = res.headers.get('X-Chars');
    const credits = res.headers.get('X-Credits-Used');
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    audioEl.src = url; playerRow.style.display = '';
    drawWaveformFromBuffer(buf.slice(0), canvas);
    audioEl.play().catch(() => {});
    toast('Synthesized ' + (chars || text.length) + ' chars' + (credits ? ', ' + credits + ' credits.' : '.'), 'ok');
    refreshUsageSoft();
  } catch (ex) {
    toast(ex.message || 'Synthesis failed.', 'err');
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

function refreshUsageSoft() {
  // invalidate cached usage so Overview reflects new chars next visit
  State.loaded.usage = false; State.usage = null;
}

/* ---- waveform rendering ---- */
function sizeCanvas(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 560, h = canvas.clientHeight || 90;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // idle baseline
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(110,123,255,0.25)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}
function drawWaveformFromBuffer(arrbuf, canvas) {
  try {
    const samples = decodeWavPcm(arrbuf);
    if (!samples) { sizeCanvas(canvas); return; }
    drawWaveform(samples, canvas);
  } catch (e) { sizeCanvas(canvas); }
}
function decodeWavPcm(arrbuf) {
  const dv = new DataView(arrbuf);
  if (dv.byteLength < 44) return null;
  // verify RIFF/WAVE
  if (dv.getUint32(0, false) !== 0x52494646) return null; // 'RIFF'
  // walk chunks to find fmt + data
  let off = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= dv.byteLength) {
    const id = dv.getUint32(off, false);
    const sz = dv.getUint32(off + 4, true);
    if (id === 0x666d7420) { // 'fmt '
      fmt = { format: dv.getUint16(off + 8, true), channels: dv.getUint16(off + 10, true), bits: dv.getUint16(off + 22, true) };
    } else if (id === 0x64617461) { // 'data'
      dataOff = off + 8; dataLen = sz; break;
    }
    off += 8 + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0 || fmt.bits !== 16) return null;
  const n = Math.floor(dataLen / 2);
  const ch = fmt.channels || 1;
  const out = new Float32Array(Math.floor(n / ch));
  let j = 0;
  for (let i = 0; i + ch <= n; i += ch) {
    const s = dv.getInt16(dataOff + i * 2, true);
    out[j++] = s / 32768;
  }
  return out;
}
function drawWaveform(samples, canvas) {
  sizeCanvas(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr, h = canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);
  const bars = Math.max(40, Math.min(180, Math.floor(w / 4)));
  const block = Math.floor(samples.length / bars) || 1;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#34E7E4'); grad.addColorStop(0.6, '#6E7BFF'); grad.addColorStop(1, '#A855F7');
  ctx.fillStyle = grad;
  const bw = w / bars;
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    for (let k = 0; k < block; k++) { const v = Math.abs(samples[b * block + k] || 0); if (v > peak) peak = v; }
    const bh = Math.max(2, peak * (h * 0.92));
    const x = b * bw, y = (h - bh) / 2;
    const r = Math.min(bw * 0.34, 2);
    roundRect(ctx, x + bw * 0.18, y, bw * 0.64, bh, r);
  }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.fill();
}

/* ---- streaming TTS (PCM int16 LE 24kHz) via /api/ws-connect then wss Rumik ---- */
async function streamSynthesize(text, st, canvas, btn) {
  const mint = await api('/api/ws-connect', { method: 'POST', body: { text: text, model: st.model } });
  if (!mint.ws_url) throw new ApiError(0, 'No ws_url returned.');
  return new Promise((resolve, reject) => {
    let ws, audioCtx, nextTime = 0, started = false, chunks = [];
    const SR = 24000;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR }); } catch (e) { return reject(new ApiError(0, 'No Web Audio.')); }
    const url = mint.ws_url + (mint.token && mint.ws_url.indexOf('token=') === -1 ? (mint.ws_url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(mint.token) : '');
    try { ws = new WebSocket(url); } catch (e) { return reject(new ApiError(0, 'WebSocket failed.')); }
    ws.binaryType = 'arraybuffer';
    const fail = (m) => { try { ws.close(); } catch (e) {} reject(new ApiError(0, m)); };
    const timeout = setTimeout(() => fail('Stream timed out.'), 20000);
    ws.onopen = () => { try { ws.send(JSON.stringify({ text: text, model: st.model })); } catch (e) {} };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try { const m = JSON.parse(ev.data); if (m.type === 'end' || m.done) { clearTimeout(timeout); finish(); } } catch (e) {}
        return;
      }
      const pcm = new Int16Array(ev.data);
      if (!pcm.length) return;
      chunks.push(pcm);
      const f32 = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
      const ab = audioCtx.createBuffer(1, f32.length, SR);
      ab.copyToChannel(f32, 0);
      const src = audioCtx.createBufferSource(); src.buffer = ab; src.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      if (nextTime < now) nextTime = now + 0.04;
      src.start(nextTime); nextTime += ab.duration;
      started = true;
    };
    ws.onclose = () => { clearTimeout(timeout); if (started) finish(); else fail('Stream closed early.'); };
    ws.onerror = () => { clearTimeout(timeout); fail('Stream connection error.'); };
    function finish() {
      // draw the gathered waveform once
      if (chunks.length) {
        let total = 0; chunks.forEach((c) => total += c.length);
        const all = new Float32Array(total); let o = 0;
        chunks.forEach((c) => { for (let i = 0; i < c.length; i++) all[o++] = c[i] / 32768; });
        try { drawWaveform(all, canvas); } catch (e) {}
      }
      try { ws.close(); } catch (e) {}
      resolve();
    }
  });
}

/* ===========================================================================
   4. DEMO LINKS
   =========================================================================== */
async function viewDemoLinks(root) {
  const routeDef = ROUTES.find((r) => r.id === 'demos');
  if (!canAccessRoute(routeDef)) {
    toast('Access restricted: ' + (routeDef ? routeDef.label : 'Demo links') + ' requires elevated permissions.', 'warn');
    goto('overview');
    return;
  }
  root.appendChild(viewHead('Demo links', 'Create a tenant-branded web voice experience for one agent, then share it without exposing Studio access or provider secrets.'));
  const grid = el('div', { class: 'demo-admin-grid' }, [
    el('div', { class: 'card demo-create-card', id: 'demoCreateHost' }),
    el('div', { class: 'card demo-list-card', id: 'demoListHost' })
  ]);
  root.appendChild(grid);

  const createHost = $('#demoCreateHost', root);
  const listHost = $('#demoListHost', root);
  createHost.appendChild(skeleton('sk-card', 1));
  listHost.appendChild(skeleton('sk-card', 1));

  try {
    await ensureAgents();
    const payload = await api('/api/demo-links');
    State.demoLinks = payload.demoLinks || [];
    State.loaded.demoLinks = true;
  } catch (error) {
    createHost.innerHTML = '';
    listHost.innerHTML = '';
    listHost.appendChild(el('div', { class: 'demo-error', role: 'alert' }, error.message || 'Demo links could not be loaded.'));
    return;
  }

  function ephemeralUrl(id) {
    try { return sessionStorage.getItem('vaani_demo_' + id) || ''; } catch (_) { return ''; }
  }
  function rememberUrl(id, url) {
    try { sessionStorage.setItem('vaani_demo_' + id, url); } catch (_) {}
  }
  async function copyUrl(url) {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast('Demo link copied.', 'ok'); }
    catch (_) {
      const input = el('textarea', { style: 'position:fixed;opacity:0;pointer-events:none' }, url);
      document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove();
      toast('Demo link copied.', 'ok');
    }
  }
  function openUrl(url) {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }
  function redraw() {
    root.innerHTML = '';
    viewDemoLinks(root);
  }

  createHost.innerHTML = '';
  createHost.appendChild(el('div', { class: 'demo-card-head' }, [
    el('div', {}, [el('h3', { class: 't-h3' }, 'Create a share link'), el('p', { class: 'muted' }, 'The full URL is shown once. Only its SHA-256 hash is stored on the server.')])
  ]));
  if (!State.agents.length) {
    createHost.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'ttl' }, 'Create an agent first'),
      el('p', {}, 'A demo link must be scoped to one tenant-owned agent.'),
      el('button', { class: 'btn btn-primary', onclick: () => goto('agents') }, 'Open agents')
    ]));
  } else {
    const agent = el('select', { class: 'select', id: 'demoAgent' }, State.agents.map((item) => el('option', { value: item.id }, item.name)));
    const label = el('input', { class: 'input', id: 'demoLabel', maxlength: '80', placeholder: 'Prospect demo' });
    const expiry = el('select', { class: 'select', id: 'demoExpiry' }, [1, 3, 7, 14, 30].map((days) => el('option', { value: days, selected: days === 7 ? 'selected' : false }, days + (days === 1 ? ' day' : ' days'))));
    const duration = el('select', { class: 'select', id: 'demoDuration' }, [60, 180, 300, 600].map((seconds) => el('option', { value: seconds, selected: seconds === 300 ? 'selected' : false }, Math.round(seconds / 60) + (seconds === 60 ? ' minute' : ' minutes'))));
    const starts = el('input', { class: 'input', id: 'demoStarts', type: 'number', min: '1', max: '1000', value: '25', inputmode: 'numeric' });
    const submit = el('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Create demo link');
    const form = el('form', { class: 'demo-create-form' }, [
      el('div', { class: 'field full' }, [el('label', {}, 'Agent'), agent]),
      el('div', { class: 'field full' }, [el('label', {}, 'Internal label'), label]),
      el('div', { class: 'field' }, [el('label', {}, 'Expires after'), expiry]),
      el('div', { class: 'field' }, [el('label', {}, 'Call duration'), duration]),
      el('div', { class: 'field full' }, [el('label', {}, 'Maximum starts'), starts]),
      submit
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); submit.disabled = true; submit.textContent = 'Creating...';
      try {
        const result = await api('/api/demo-links', { method: 'POST', body: {
          agentId: agent.value, label: label.value.trim(), expiresInDays: Number(expiry.value),
          maxSessionSeconds: Number(duration.value), maxStarts: Number(starts.value)
        } });
        const fullUrl = location.origin + result.sharePath;
        rememberUrl(result.demoLink.id, fullUrl);
        State.demoLinks.unshift(result.demoLink);
        await copyUrl(fullUrl);
        toast('Created and copied. Open it in a separate tab to test.', 'ok', 'Demo ready');
        redraw();
      } catch (error) {
        toast(error.message || 'Demo link could not be created.', 'err');
        submit.disabled = false; submit.textContent = 'Create demo link';
      }
    });
    createHost.appendChild(form);
  }

  listHost.innerHTML = '';
  listHost.appendChild(el('div', { class: 'demo-card-head' }, [
    el('div', {}, [el('h3', { class: 't-h3' }, 'Distributed demos'), el('p', { class: 'muted' }, 'Revoke access immediately or create a replacement when a one-time URL is no longer available.')]),
    el('span', { class: 'tag' }, State.demoLinks.length + ' total')
  ]));
  if (!State.demoLinks.length) {
    listHost.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'ttl' }, 'No demo links yet'), el('p', {}, 'Create one to share a branded web voice experience.') ]));
  } else {
    const agentNames = Object.fromEntries(State.agents.map((item) => [item.id, item.name]));
    const list = el('div', { class: 'demo-link-list' });
    State.demoLinks.forEach((item) => {
      const url = ephemeralUrl(item.id);
      const status = item.status || 'active';
      const card = el('article', { class: 'demo-link-row' }, [
        el('div', { class: 'demo-link-main' }, [
          el('div', { class: 'demo-link-title' }, [el('strong', {}, item.label), el('span', { class: 'demo-status ' + status }, status)]),
          el('div', { class: 'demo-link-meta' }, [
            el('span', {}, agentNames[item.agentId] || 'Agent'),
            el('span', {}, item.starts + ' of ' + item.maxStarts + ' starts'),
            el('span', {}, 'Expires ' + new Date(item.expiresAt).toLocaleDateString())
          ]),
          !url && status === 'active' ? el('p', { class: 'demo-once-note' }, 'The secret URL is not recoverable after this browser session. Revoke and replace it if needed.') : null
        ]),
        el('div', { class: 'demo-link-actions' }, [
          el('button', { class: 'btn btn-ghost', disabled: !url ? 'disabled' : false, onclick: () => openUrl(url) }, 'Open'),
          el('button', { class: 'btn btn-ghost', disabled: !url ? 'disabled' : false, onclick: () => copyUrl(url) }, 'Copy'),
          status === 'active' ? el('button', { class: 'btn btn-danger-soft', onclick: () => modal({
            title: 'Revoke this demo link?',
            body: el('p', { class: 'muted' }, 'Visitors will no longer be able to start a voice session with this URL.'),
            confirmText: 'Revoke link', confirmKind: 'danger',
            onConfirm: async () => { await api('/api/demo-links/revoke', { method: 'POST', body: { id: item.id } }); try { sessionStorage.removeItem('vaani_demo_' + item.id); } catch (_) {} toast('Demo link revoked.', 'ok'); redraw(); }
          }) }, 'Revoke') : null
        ])
      ]);
      list.appendChild(card);
    });
    listHost.appendChild(list);
  }
}

/* ===========================================================================
   5. TALK TO IT
   =========================================================================== */
async function viewTalk(root) {
  root.appendChild(viewHead('Talk to your agent', 'A direct realtime voice call through the same Dograh workflow runtime used on the phone.'));

  await ensureAgents().catch(() => {});
  if (!State.activeAgentId && State.agents.length) State.activeAgentId = State.agents[0].id;

  const PHASE_LABELS = {
    idle: 'Ready',
    requesting_permission: 'Requesting microphone',
    connecting: 'Connecting',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Agent speaking',
    ended: 'Call ended',
    error: 'Needs attention'
  };

  const transcript = el('div', { class: 'transcript', id: 't_transcript', 'aria-live': 'polite' }, [
    el('div', { class: 'talk-empty', id: 't_talk_empty' }, [
      el('div', { class: 'voice-orb', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span'), el('span'), el('span')]),
      el('div', { class: 'voice-call-stage-title' }, 'Ready for a live voice call'),
      el('p', { class: 'muted' }, 'Start once. Speak naturally, interrupt the agent, and continue without pressing send.')
    ])
  ]);

  const agentSel = el('select', { class: 'select' }, State.agents.length
    ? State.agents.map((a) => el('option', { value: a.id, selected: a.id === State.activeAgentId ? 'selected' : false }, a.name))
    : [el('option', { value: '' }, 'No agents yet')]);
  agentSel.addEventListener('change', () => { State.activeAgentId = agentSel.value; });

  const statusDot = el('span', { class: 'conversation-dot', 'aria-hidden': 'true' });
  const statusText = el('span', {}, PHASE_LABELS.idle);
  const statusPill = el('div', { class: 'conversation-status idle', role: 'status' }, [statusDot, statusText]);
  const runtimePill = el('div', { class: 'conversation-pipeline' }, 'Dograh realtime voice · Deepgram · Groq · Vaani Native (Rumik)');
  const sessionBtn = el('button', { class: 'btn btn-primary conversation-btn', 'aria-label': 'Start voice call' }, [
    el('span', { class: 'conversation-btn-icon', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.9z"/></svg>' }),
    el('span', { class: 'conversation-btn-label' }, 'Start voice call')
  ]);
  const audio = el('audio', { autoplay: 'autoplay', playsinline: 'playsinline' });

  const diagRows = {
    connect: el('div', { class: 'diag-row' }, [el('span', { class: 'k' }, 'Connect time'), el('span', { class: 'v pending' }, '—')]),
    firstPartial: el('div', { class: 'diag-row' }, [el('span', { class: 'k' }, 'First partial transcript'), el('span', { class: 'v pending' }, '—')]),
    turnFinalize: el('div', { class: 'diag-row' }, [el('span', { class: 'k' }, 'Turn finalize'), el('span', { class: 'v pending' }, '—')]),
    firstResponse: el('div', { class: 'diag-row' }, [el('span', { class: 'k' }, 'First response'), el('span', { class: 'v pending' }, '—')]),
    bargeIn: el('div', { class: 'diag-row' }, [el('span', { class: 'k' }, 'Barge-in stop latency'), el('span', { class: 'v pending' }, '—')])
  };

  let pc = null;
  let ws = null;
  let stream = null;
  let running = false;
  let peerId = '';
  let callPhase = 'idle';
  let connectStartedAt = 0;
  let liveBubble = null;
  let botBubble = null;
  let bargeInStartedAt = 0;
  let gotFirstResponse = false;
  const metrics = { connectMs: null, firstPartialMs: null, turnFinalizeMs: null, firstResponseMs: null, bargeInMs: null };

  function setDiag(key, value) {
    const row = diagRows[key];
    if (!row) return;
    const valueEl = $('.v', row);
    valueEl.textContent = value;
    valueEl.classList.remove('pending');
  }
  function resetDiagnostics() {
    metrics.connectMs = metrics.firstPartialMs = metrics.turnFinalizeMs = metrics.firstResponseMs = metrics.bargeInMs = null;
    gotFirstResponse = false;
    Object.keys(diagRows).forEach((key) => {
      const valueEl = $('.v', diagRows[key]);
      valueEl.textContent = '—';
      valueEl.classList.add('pending');
    });
  }
  function formatMs(ms) {
    return Number.isFinite(ms) ? ms.toFixed(0) + 'ms' : '—';
  }
  function setPhase(phase, label) {
    callPhase = phase;
    statusPill.className = 'conversation-status ' + phase;
    statusText.textContent = label || PHASE_LABELS[phase] || phase;
  }
  function setButton(active) {
    running = active;
    $('.conversation-btn-label', sessionBtn).textContent = active ? 'End voice call' : 'Start voice call';
    sessionBtn.classList.toggle('active', active);
    sessionBtn.setAttribute('aria-label', active ? 'End voice call' : 'Start voice call');
    agentSel.disabled = active;
  }
  function hideEmptyState() {
    const empty = $('#t_talk_empty', transcript);
    if (empty) empty.remove();
  }
  function scrollTranscript() {
    transcript.scrollTop = transcript.scrollHeight;
  }
  function addBubble(role, text) {
    hideEmptyState();
    const bubble = el('div', { class: 'bubble ' + role }, text);
    transcript.appendChild(bubble);
    scrollTranscript();
    return bubble;
  }
  function paintUserTranscription(text, isFinal) {
    text = String(text || '').trim();
    if (!text) return;
    hideEmptyState();
    if (!metrics.firstPartialMs && connectStartedAt) {
      metrics.firstPartialMs = Date.now() - connectStartedAt;
      setDiag('firstPartial', formatMs(metrics.firstPartialMs));
    }
    if (isFinal) {
      if (liveBubble) {
        liveBubble.textContent = text;
        liveBubble.classList.remove('live-transcript');
        liveBubble = null;
      } else {
        addBubble('user', text);
      }
      if (!metrics.turnFinalizeMs && connectStartedAt) {
        metrics.turnFinalizeMs = Date.now() - connectStartedAt;
        setDiag('turnFinalize', formatMs(metrics.turnFinalizeMs));
      }
      setPhase('thinking', PHASE_LABELS.thinking);
      return;
    }
    if (!liveBubble || !liveBubble.isConnected) {
      liveBubble = el('div', { class: 'bubble user live-transcript' }, text);
      transcript.appendChild(liveBubble);
    } else {
      liveBubble.textContent = text;
    }
    if (callPhase === 'speaking') {
      if (!bargeInStartedAt) bargeInStartedAt = Date.now();
    } else {
      setPhase('listening', PHASE_LABELS.listening);
    }
    scrollTranscript();
  }
  function paintBotText(text) {
    text = String(text || '').trim();
    if (!text) return;
    hideEmptyState();
    if (botBubble && botBubble.isConnected) {
      botBubble.textContent = (botBubble.textContent + ' ' + text).trim();
    } else {
      botBubble = addBubble('bot', text);
    }
    scrollTranscript();
  }
  function stopCall(message, phase) {
    const wasRunning = running;
    setButton(false);
    if (ws && ws.readyState < 2) { try { ws.close(); } catch (_) {} }
    ws = null;
    if (pc) {
      try { pc.getSenders().forEach((s) => s.track && s.track.stop()); pc.close(); } catch (_) {}
    }
    pc = null;
    window.__rumikPc = null;
    window.__vaaniPc = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    audio.srcObject = null;
    liveBubble = null;
    botBubble = null;
    bargeInStartedAt = 0;
    connectStartedAt = 0;
    if (phase === 'error') setPhase('error', message || PHASE_LABELS.error);
    else if (wasRunning || phase === 'ended') setPhase('ended', message || PHASE_LABELS.ended);
    else setPhase(phase || 'idle', message || PHASE_LABELS.idle);
  }
  function securePeerId() {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return 'PC-' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function fetchTurn(url) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      return response.ok ? await response.json() : null;
    } catch (_) { return null; }
  }
  async function handleSignal(message) {
    if (!pc) return;
    if (message.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: message.payload.sdp });
      return;
    }
    if (message.type === 'ice-candidate') {
      const c = message.payload && message.payload.candidate;
      if (c) await pc.addIceCandidate(c).catch(() => {});
      return;
    }
    if (message.type === 'call-ended') return stopCall('Call ended', 'ended');
    if (message.type === 'error' || message.type === 'rtf-pipeline-error') {
      const detail = (message.payload && (message.payload.message || message.payload.error)) || 'Realtime voice call failed';
      addBubble('sys', detail);
      stopCall(PHASE_LABELS.error, 'error');
      return;
    }
    if (message.type === 'rtf-user-transcription') {
      const p = message.payload || {};
      if (p.text) paintUserTranscription(p.text, !!p.final);
      return;
    }
    if (message.type === 'rtf-bot-text') {
      const p = message.payload || {};
      if (p.text) paintBotText(p.text);
      return;
    }
    if (message.type === 'rtf-bot-started-speaking') {
      botBubble = null;
      setPhase('speaking', PHASE_LABELS.speaking);
      return;
    }
    if (message.type === 'rtf-bot-stopped-speaking') {
      if (bargeInStartedAt) {
        metrics.bargeInMs = Date.now() - bargeInStartedAt;
        setDiag('bargeIn', formatMs(metrics.bargeInMs));
        bargeInStartedAt = 0;
      }
      botBubble = null;
      setPhase('listening', PHASE_LABELS.listening);
      return;
    }
    if (message.type === 'rtf-ttfb-metric') {
      const p = message.payload || {};
      if (!gotFirstResponse) {
        gotFirstResponse = true;
        metrics.firstResponseMs = Number(p.ttfb_seconds || 0) * 1000;
        setDiag('firstResponse', formatMs(metrics.firstResponseMs) + ' · ' + String(p.processor || p.model || 'live runtime'));
      }
    }
  }
  async function startCall() {
    if (running || !State.activeAgentId) return;
    resetDiagnostics();
    transcript.innerHTML = '';
    transcript.appendChild(el('div', { class: 'talk-empty', id: 't_talk_empty' }, [
      el('div', { class: 'voice-orb', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span'), el('span'), el('span')]),
      el('div', { class: 'voice-call-stage-title' }, 'Connecting your call'),
      el('p', { class: 'muted' }, 'Allow microphone access when your browser asks.')
    ]));
    setButton(true);
    setPhase('requesting_permission', PHASE_LABELS.requesting_permission);
    connectStartedAt = Date.now();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      setPhase('connecting', PHASE_LABELS.connecting);
      const session = await api('/api/voice/session', { method: 'POST', timeoutMs: 15000, body: { agentId: State.activeAgentId } });
      const turn = session.turnCredentials || await fetchTurn(session.turnCredentialsUrl);
      const iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
      if (turn && turn.uris && turn.uris.length) {
        iceServers.push({ urls: turn.uris, username: turn.username, credential: turn.password });
      }
      pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: turn ? 'relay' : 'all' });
      window.__rumikPc = pc;
      window.__vaaniPc = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.ontrack = (event) => { if (event.track.kind === 'audio') { audio.srcObject = event.streams[0]; audio.play().catch(() => {}); } };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === 'connected') {
          if (!metrics.connectMs && connectStartedAt) {
            metrics.connectMs = Date.now() - connectStartedAt;
            setDiag('connect', formatMs(metrics.connectMs));
          }
          hideEmptyState();
          setPhase('listening', PHASE_LABELS.listening);
        }
        if (pc.connectionState === 'failed') {
          setPhase('error', PHASE_LABELS.error);
          stopCall('Connection failed', 'error');
        }
      };
      peerId = securePeerId();
      ws = new WebSocket(session.signalingUrl);
      ws.onmessage = async (event) => {
        try { await handleSignal(JSON.parse(event.data)); }
        catch (error) { setPhase('error', PHASE_LABELS.error); toast(error.message || 'Realtime signaling failed.', 'err'); }
      };
      ws.onclose = (event) => { if (running && event.reason !== 'call ended') stopCall('Call ended', 'ended'); };
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Dograh signaling connection failed')); });
      pc.onicecandidate = (event) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'ice-candidate', payload: { candidate: event.candidate ? { candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid, sdpMLineIndex: event.candidate.sdpMLineIndex } : null, pc_id: peerId } }));
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', payload: { sdp: offer.sdp, type: 'offer', pc_id: peerId, workflow_id: session.workflowId, workflow_run_id: session.workflowRunId } }));
    } catch (error) {
      stopCall('Could not connect', 'error');
      setPhase('error', PHASE_LABELS.error);
      hideEmptyState();
      addBubble('sys', error.message || 'Could not start the realtime voice call.');
      toast(error.message || 'Realtime voice call failed.', 'err');
    }
  }

  sessionBtn.addEventListener('click', () => running ? stopCall('Ready', 'ended') : startCall());
  routeCleanup = () => { if (running) stopCall('Call ended', 'ended'); };

  const panel = el('div', { class: 'card talk-panel' }, [
    el('div', { class: 'talk-head' }, [
      el('div', { class: 'talk-identity' }, [el('div', { class: 'who' }, ['Phone-runtime conversation ', el('span', {}, '(automatic turn-taking)')]), statusPill, runtimePill]),
      el('div', { class: 'talk-agent-select' }, [el('span', {}, 'Agent'), agentSel])
    ]),
    transcript,
    el('div', { class: 'talk-input' }, [sessionBtn, audio])
  ]);
  const info = el('div', { class: 'talk-side' }, [
    el('div', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3' }, 'Live diagnostics'),
      el('p', { class: 'muted', style: 'font-size:.84rem' }, 'Measured from signaling and realtime feedback events during this call.'),
      el('div', { class: 'talk-diagnostics' }, Object.values(diagRows))
    ]),
    el('div', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3' }, 'The actual phone runtime'),
      el('p', { class: 'muted' }, 'Your microphone is connected to Dograh over WebRTC. Dograh runs the same published workflow, Deepgram, Groq and Vaani Native (Rumik) pipeline used for phone calls.'),
      el('hr', { class: 'divider' }),
      el('p', { class: 'muted' }, 'Interim captions show what Deepgram hears. Final captions close the turn and trigger the agent response. Use End voice call to release the microphone.')
    ])
  ]);
  root.appendChild(el('div', { class: 'talk-grid' }, [panel, info]));
}

/* ===========================================================================
   5. TELEPHONY
   =========================================================================== */
async function viewTelephony(root) {
  root.appendChild(viewHead('Telephony', 'Choose a voice agent, place an outbound call, then review the timestamped transcript and summary from the same screen.'));

  const vobizHost = el('div', { class: 'carrier-card card', id: 'telStatus' }, skeleton('sk-line', 5));
  const voicelinkHost = el('div', { class: 'carrier-card card is-secondary', id: 'telVoiceLink' }, skeleton('sk-line', 5));
  const dialHost = el('div', { class: 'card card-pad', id: 'telDial' }, skeleton('sk-line', 6));
  const analyticsHost = el('div', { class: 'card card-pad', id: 'telAnalytics' });
  const transcriptHost = el('div', { class: 'card card-pad', id: 'telTranscripts', style: 'margin-top:18px' }, skeleton('sk-line', 4));
  root.appendChild(el('div', { class: 'tel-carrier-grid' }, [vobizHost, voicelinkHost]));
  root.appendChild(el('div', { class: 'tel-grid tel-grid-dial', style: 'margin-top:18px' }, [dialHost, analyticsHost]));
  root.appendChild(transcriptHost);

  try {
    const s = await ensureTelephony(true);
    paintTelephony(vobizHost, (s.carriers && s.carriers.vobiz) || s, 'vobiz');
    paintTelephony(voicelinkHost, (s.carriers && s.carriers.voicelink) || { provider: 'voicelink', connected: false }, 'voicelink');
  } catch (e) {
    vobizHost.innerHTML = '';
    vobizHost.appendChild(el('div', { class: 'muted' }, 'Could not reach telephony status. ' + esc(e.message)));
  }

  try {
    await ensureAgents();
    dialHost.innerHTML = '';
    dialHost.appendChild(dialForm());
    refreshDialNumbers(State.telephony);
  } catch (e) {
    dialHost.innerHTML = '';
    dialHost.appendChild(el('div', { class: 'muted' }, 'Could not load agents. ' + esc(e.message)));
  }

  paintAgentAnalytics(analyticsHost);
  paintTranscriptsPanel(transcriptHost);
}

function paintAgentAnalytics(host) {
  host.innerHTML = '';
  host.appendChild(el('h3', { class: 't-h3' }, 'Agent performance'));
  if (!hasClientOrgRole('analyst')) {
    host.appendChild(el('p', { class: 'muted' }, 'Analyst access is required to compare agents across outbound calls.'));
    return;
  }
  host.appendChild(el('p', { class: 'muted', style: 'font-size:.85rem' }, 'Live outbound calls only. Demo seed data is excluded.'));
  const body = el('div', { class: 'agent-analytics-list' }, skeleton('sk-line', 3));
  host.appendChild(body);
  api('/api/telephony/agent-analytics').then((res) => {
    body.innerHTML = '';
    const rows = res.agents || [];
    if (!rows.length) {
      body.appendChild(el('p', { class: 'muted' }, 'Place outbound calls with more than one agent to compare answer rate, duration, and sentiment.'));
      return;
    }
    rows.forEach((row) => {
      body.appendChild(el('div', { class: 'agent-analytics-row' }, [
        el('div', {}, [
          el('div', { class: 'ac-name' }, row.agentName),
          el('div', { class: 'muted', style: 'font-size:.78rem' }, row.calls + ' outbound calls')
        ]),
        el('div', { class: 'agent-analytics-kpis' }, [
          el('span', {}, 'Answered ' + row.answerRate + '%'),
          el('span', {}, 'Avg ' + row.avgDurationSec + 's'),
          el('span', {}, 'Failed ' + row.failRate + '%')
        ])
      ]));
    });
  }).catch((e) => {
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'muted' }, e.message || 'Analytics unavailable.'));
  });
}

let txPollTimer = null;

function transcriptNeedsClientRefresh(row) {
  if (!row) return false;
  if (row.status === 'pending') return true;
  return row.status === 'unavailable' && !(row.turns || []).length && !String(row.verbatim || '').trim();
}

function stopTranscriptPolling() {
  if (txPollTimer) {
    clearInterval(txPollTimer);
    txPollTimer = null;
  }
}

function paintTranscriptsPanel(host) {
  host.innerHTML = '';
  host.appendChild(el('h3', { class: 't-h3' }, 'Outbound transcripts'));
  if (!hasClientOrgRole('analyst')) {
    host.appendChild(el('p', { class: 'muted' }, 'Transcripts are limited to analyst, operator, and admin roles.'));
    return;
  }
  const searchI = el('input', { class: 'input', id: 'tx_q', placeholder: 'Search phrases, topics, numbers, or agent names' });
  const agentF = el('select', { class: 'select', id: 'tx_agent' }, [el('option', { value: '' }, 'All agents')].concat(
    (State.agents || []).map((a) => el('option', { value: a.id }, a.name))
  ));
  const numF = el('input', { class: 'input', id: 'tx_num', placeholder: 'Filter by destination' });
  const list = el('div', { id: 'tx_list', class: 'tx-list' }, skeleton('sk-line', 4));
  const detail = el('div', { id: 'tx_detail', class: 'tx-detail' }, [
    el('p', { class: 'muted' }, 'Select a call to read the verbatim transcript or the summary.')
  ]);
  let timer = null;
  const reload = () => loadTranscripts(list, detail, { q: searchI.value, agentId: agentF.value, number: numF.value });
  [searchI, agentF, numF].forEach((node) => {
    node.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(reload, 220); });
    node.addEventListener('change', reload);
  });
  host.appendChild(el('div', { class: 'tx-filters' }, [searchI, agentF, numF]));
  host.appendChild(el('div', { class: 'tx-split' }, [list, detail]));
  stopTranscriptPolling();
  reload();
  txPollTimer = setInterval(() => {
    if (!host.isConnected) { stopTranscriptPolling(); return; }
    reload();
  }, 6000);
}

async function loadTranscripts(list, detail, filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.agentId) params.set('agentId', filters.agentId);
  if (filters.number) params.set('number', filters.number);
  const activeId = ($('#tx_list .tx-row.on') && $('#tx_list .tx-row.on').getAttribute('data-tx-id')) || '';
  try {
    const res = await api('/api/telephony/transcripts?' + params.toString());
    const rows = res.transcripts || [];
    list.innerHTML = '';
    if (!rows.length) {
      list.appendChild(el('div', { class: 'empty muted' }, 'No matching transcripts yet. Place an outbound call to capture one.'));
      return;
    }
    rows.forEach((row) => {
      const btn = el('button', { class: 'tx-row', type: 'button', 'data-tx-id': row.id }, [
        el('div', { class: 'tx-row-top' }, [
          el('b', {}, row.agentName || 'Agent'),
          el('span', { class: 'pill' }, row.status)
        ]),
        el('div', { class: 'muted', style: 'font-size:.78rem' }, (row.destination || 'unknown') + ' · ' + new Date(row.startedAt).toLocaleString()),
        row.summary && row.summary.overview ? el('div', { class: 'tx-row-snip' }, row.summary.overview) : null
      ]);
      btn.addEventListener('click', () => {
        $$('#tx_list .tx-row').forEach((n) => n.classList.remove('on'));
        btn.classList.add('on');
        openTranscriptDetail(detail, row);
      });
      list.appendChild(btn);
      if (row.id === activeId) {
        btn.classList.add('on');
        openTranscriptDetail(detail, row, { preserveMode: true });
      }
    });
  } catch (e) {
    list.innerHTML = '';
    list.appendChild(el('div', { class: 'muted' }, e.message || 'Could not load transcripts.'));
  }
}

function highlightText(text, query) {
  const q = String(query || '').trim();
  if (!q) return document.createTextNode(text || '');
  const src = String(text || '');
  const lower = src.toLowerCase();
  const needle = q.toLowerCase();
  const frag = document.createDocumentFragment();
  let i = 0;
  while (i < src.length) {
    const found = lower.indexOf(needle, i);
    if (found < 0) { frag.appendChild(document.createTextNode(src.slice(i))); break; }
    if (found > i) frag.appendChild(document.createTextNode(src.slice(i, found)));
    frag.appendChild(el('mark', {}, src.slice(found, found + q.length)));
    i = found + q.length;
  }
  return frag;
}

function openTranscriptDetail(host, row, opts) {
  opts = opts || {};
  const q = ($('#tx_q') && $('#tx_q').value) || '';
  let mode = opts.preserveMode && host.dataset && host.dataset.txMode ? host.dataset.txMode : 'verbatim';
  if (row._detailPoll) clearInterval(row._detailPoll);
  host.innerHTML = '';
  host.dataset.txMode = mode;
  const tabs = el('div', { class: 'tx-tabs' }, [
    el('button', { type: 'button', class: 'on', 'data-mode': 'verbatim' }, 'Verbatim'),
    el('button', { type: 'button', 'data-mode': 'summary' }, 'Summary')
  ]);
  const body = el('div', { class: 'tx-body' });
  const refreshBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, row.status === 'pending' ? 'Refresh from call' : 'Refresh');
  function paint() {
    body.innerHTML = '';
    if (mode === 'summary') {
      const sum = row.summary || {};
      body.appendChild(el('p', {}, highlightText(sum.overview || 'Summary is not ready yet.', q)));
      [['Highlights', sum.highlights], ['Outcomes', sum.outcomes], ['Action items', sum.actionItems]].forEach((pair) => {
        if (!(pair[1] || []).length) return;
        body.appendChild(el('h4', { class: 'tx-h4' }, pair[0]));
        const ul = el('ul', { class: 'tx-ul' });
        pair[1].forEach((item) => ul.appendChild(el('li', {}, highlightText(item, q))));
        body.appendChild(ul);
      });
      body.appendChild(el('div', { class: 'pill', style: 'margin-top:10px' }, 'Sentiment: ' + (sum.sentiment || 'neutral')));
    } else {
      (row.turns || []).forEach((turn) => {
        body.appendChild(el('div', { class: 'tx-turn ' + turn.role }, [
          el('div', { class: 'tx-turn-meta' }, (turn.role === 'agent' ? 'Agent' : 'Customer') + (turn.timestamp ? ' · ' + turn.timestamp : '')),
          el('div', {}, highlightText(turn.text, q))
        ]));
      });
      if (!(row.turns || []).length) {
        body.appendChild(el('p', { class: 'muted' }, row.status === 'pending'
          ? 'The call is still in progress or the transcript has not landed yet.'
          : (row.verbatim || 'No spoken turns were stored for this call.')));
      }
    }
  }
  tabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    mode = btn.getAttribute('data-mode');
    host.dataset.txMode = mode;
    $$('button', tabs).forEach((n) => n.classList.toggle('on', n === btn));
    paint();
  });
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      const res = await api('/api/telephony/transcripts/' + encodeURIComponent(row.id) + '/refresh', { method: 'POST', body: {} });
      Object.assign(row, res.transcript || {});
      paint();
      toast('Transcript updated.', 'ok');
    } catch (e) {
      toast(e.message || 'Refresh failed.', 'err');
    } finally {
      refreshBtn.disabled = false;
    }
  });
  host.appendChild(el('div', { class: 'tx-detail-head' }, [
    el('div', {}, [
      el('div', { class: 'ac-name' }, row.agentName || 'Agent'),
      el('div', { class: 'muted', style: 'font-size:.8rem' }, (row.destination || '') + ' · ' + row.provider + ' · ' + new Date(row.startedAt).toLocaleString())
    ]),
    refreshBtn
  ]));
  host.appendChild(tabs);
  host.appendChild(body);
  paint();
  if (transcriptNeedsClientRefresh(row)) {
    row._detailPoll = setInterval(async () => {
      if (!host.isConnected) { clearInterval(row._detailPoll); row._detailPoll = null; return; }
      try {
        const res = await api('/api/telephony/transcripts/' + encodeURIComponent(row.id));
        if (res.transcript) Object.assign(row, res.transcript);
        paint();
        if (!transcriptNeedsClientRefresh(row)) {
          clearInterval(row._detailPoll);
          row._detailPoll = null;
        }
      } catch (_) {}
    }, 5000);
  }
}

function paintTelephony(host, s, id) {
  host.innerHTML = '';
  const carrierId = id || s.provider || 'vobiz';
  const connected = s.connected === true && s.ok !== false;
  const config = s.configuration || {};
  const didList = Array.isArray(s.dids) ? s.dids : (s.did ? [{ number: s.did, status: 'active' }] : []);
  const title = carrierId === 'voicelink' ? 'VoiceLink' : 'VoBiz via Dograh';

  host.appendChild(el('div', { class: 'carrier-card-head' }, [
    el('h3', {}, title),
    el('span', { class: 'carrier-status-pill ' + (connected ? 'ok' : (s.error ? 'warn' : 'bad')) }, connected ? 'Connected' : (s.error ? 'Blocked' : 'Unavailable'))
  ]));
  if (s.secrets) host.appendChild(el('div', { class: 'status-line' }, [el('span', { class: 'k' }, 'Credentials'), el('span', { class: 'v' }, (s.secrets.resellerUser || 'configured') + (s.secrets.did ? (' · DID ' + s.secrets.did) : ''))]));
  if (s.wallet) host.appendChild(el('div', { class: 'status-line' }, [el('span', { class: 'k' }, 'Wallet'), el('span', { class: 'v' }, (s.wallet.currency || 'INR') + ' ' + (s.wallet.balance != null ? s.wallet.balance : 'n/a'))]));

  if (didList.length) {
    host.appendChild(el('div', { class: 'muted', style: 'font-size:.8rem;margin-bottom:8px' }, carrierId === 'voicelink' ? 'VoiceLink DIDs' : 'VoBiz numbers'));
    didList.forEach((d) => {
      const num = typeof d === 'string' ? d : (d.did_number || d.number || d.did || '');
      const status = d.user_status_label || d.status || 'active';
      const exp = d.expiry_date || d.expiry || d.expires || d.expiresAt;
      const route = d.inboundWorkflowName || (d.inboundWorkflowId ? 'Workflow ' + d.inboundWorkflowId : d.label || status);
      host.appendChild(el('div', { class: 'did-row' }, [
        el('div', {}, [el('div', { class: 'num' }, num), el('div', { class: 'exp' }, exp ? 'Expires ' + exp : route)]),
        el('span', { class: 'pill' }, [el('span', { class: 'dot' + (status !== 'active' ? ' warn' : '') }), status])
      ]));
    });
  }

  if (s.routing) {
    host.appendChild(el('div', { class: 'divider', style: 'margin:14px 0' }));
    host.appendChild(el('div', { class: 'status-line' }, [el('span', { class: 'k' }, 'Inbound route'), el('span', { class: 'v' }, s.routing.inboundRoute || s.routing.inbound || 'not configured')]));
    host.appendChild(el('div', { class: 'status-line' }, [el('span', { class: 'k' }, 'Outbound route'), el('span', { class: 'v' }, s.routing.outboundRoute || s.routing.outbound || 'not configured')]));
  }
  if (s.engine) host.appendChild(el('div', { class: 'status-line' }, [el('span', { class: 'k' }, 'Engine'), el('span', { class: 'v' }, (s.engine.status || 'unknown') + (s.engine.channels != null ? (' · ' + s.engine.channels + ' channels') : ''))]));

  if (config.name || config.id) {
    host.appendChild(el('div', { class: 'divider', style: 'margin:14px 0' }));
    host.appendChild(el('div', { class: 'status-line' }, [el('span', { class: 'k' }, 'Configuration'), el('span', { class: 'v' }, config.name || ('Config ' + (config.id || '')))]));
    host.appendChild(el('div', { class: 'status-line' }, [el('span', { class: 'k' }, 'Outbound workflow'), el('span', { class: 'v' }, s.workflowId ? 'Workflow ' + s.workflowId : 'not configured')]));
  }
  if (s.dashboard) host.appendChild(el('div', { class: 'status-line' }, [el('span', { class: 'k' }, 'Console'), el('a', { class: 'v', href: s.dashboard, target: '_blank', rel: 'noopener', style: 'color:var(--accent)' }, 'Open dashboard')]));
  if (s.error || s.loginError) host.appendChild(el('div', { class: 'inbound-note' }, esc(s.error || s.loginError)));
  host.appendChild(el('div', { class: 'inbound-note' }, carrierId === 'voicelink'
    ? 'Optional secondary carrier. Configure VOICELINK_WEBSOCKET_URL and VOICELINK_WEBHOOK_URL before test dials.'
    : 'Primary carrier. Dograh initiates outbound calls and routes inbound workflows.'));
}

function preferredOutboundAgentId() {
  const tenantId = State.me && State.me.tenant && State.me.tenant.id;
  const stored = tenantId ? localStorage.getItem('vaani.outboundAgent.' + tenantId) : '';
  const agents = selectableAgents();
  const ids = new Set(agents.map((a) => a.id));
  if (stored && ids.has(stored)) return stored;
  const tenantDefault = State.me && State.me.tenant && State.me.tenant.defaultOutboundAgentId;
  if (tenantDefault && ids.has(tenantDefault)) return tenantDefault;
  return agents[0] ? agents[0].id : '';
}

function rememberOutboundAgent(agentId) {
  const tenantId = State.me && State.me.tenant && State.me.tenant.id;
  if (tenantId && agentId) localStorage.setItem('vaani.outboundAgent.' + tenantId, agentId);
}

function dialForm() {
  const agents = selectableAgents();
  const selectedId = { value: preferredOutboundAgentId() };
  const carrierSel = el('select', { class: 'select', id: 'dial_carrier' }, [
    el('option', { value: 'voicelink' }, 'VoiceLink (primary)'),
    el('option', { value: 'vobiz' }, 'VoBiz (secondary)')
  ]);
  const numI = el('input', { class: 'input', id: 'dial_num', type: 'tel', inputmode: 'numeric', maxlength: 10, placeholder: '9876543210' });
  numI.addEventListener('input', () => { numI.value = numI.value.replace(/\D/g, '').slice(0, 10); });
  const btn = el('button', { class: 'btn btn-primary' }, 'Place call');
  const picker = el('div', { class: 'agent-pick', id: 'dial_agent_pick' });
  const spec = el('div', { class: 'agent-pick-spec muted', id: 'dial_agent_spec' });

  function paintPicker() {
    picker.innerHTML = '';
    if (!agents.length) {
      picker.appendChild(el('p', { class: 'muted' }, 'Create a voice agent first, then return here to dial.'));
      return;
    }
    agents.forEach((agent) => {
      const on = agent.id === selectedId.value;
      const card = el('button', { type: 'button', class: 'agent-pick-card' + (on ? ' on' : '') }, [
        el('div', { class: 'agent-pick-title' }, [
          el('b', {}, agent.name),
          agent.id === (State.me.tenant && State.me.tenant.defaultOutboundAgentId) ? el('span', { class: 'tag tag-voice' }, 'Default') : null
        ]),
        capabilityTags(agent)
      ]);
      card.addEventListener('click', () => {
        selectedId.value = agent.id;
        rememberOutboundAgent(agent.id);
        paintPicker();
      });
      picker.appendChild(card);
    });
    const chosen = agents.find((a) => a.id === selectedId.value);
    const rawProv = (chosen && chosen.tts && chosen.tts.provider) || 'rumik';
    const provLabel = rawProv === 'rumik' ? 'Vaani Native (Rumik)' : (rawProv === 'sarvam' ? 'Sarvam' : rawProv);
    spec.textContent = chosen
      ? provLabel + ' voice · workflow ' + (chosen.dograhWorkflowId || 'workspace default') + (chosen.greeting ? ' · ' + chosen.greeting : '')
      : '';
  }
  paintPicker();

  const defaultBtn = hasClientOrgRole('admin')
    ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Set as workspace default')
    : null;
  if (defaultBtn) {
    defaultBtn.addEventListener('click', async () => {
      if (!selectedId.value) return;
      defaultBtn.disabled = true;
      try {
        const res = await api('/api/telephony/default-agent', { method: 'POST', body: { agentId: selectedId.value } });
        if (State.me && State.me.tenant) State.me.tenant.defaultOutboundAgentId = res.agentId;
        paintPicker();
        toast('Default outbound agent updated.', 'ok');
      } catch (e) {
        toast(e.message || 'Could not save default agent.', 'err');
      } finally {
        defaultBtn.disabled = false;
      }
    });
  }

  if (!hasClientOrgRole('operator')) {
    btn.disabled = true;
    btn.textContent = 'Operator role required';
  }

  const form = el('form', { class: 'dial-form', onsubmit: (e) => { e.preventDefault(); onDial(numI, btn, carrierSel, selectedId); } }, [
    el('h3', { class: 't-h3' }, 'Outbound call'),
    el('p', { class: 'muted', style: 'font-size:.85rem' }, 'Pick the agent that should speak on this call. The workspace default is preselected. You can override it per call.'),
    el('div', { class: 'field' }, [el('label', {}, 'Voice agent'), picker, spec, defaultBtn]),
    field('Carrier', carrierSel),
    el('div', { class: 'field' }, [
      el('label', {}, 'Number'),
      el('div', { class: 'dial-input-row' }, [el('span', { class: 'prefix' }, '+91'), numI])
    ]),
    el('div', { class: 'cost-warn' }, ['This places a ', el('b', {}, 'real paid call'), ' and charges your telephony account.']),
    btn
  ]);
  return form;
}
function refreshDialNumbers(s) {
  const sel = $('#dial_carrier'); if (!sel) return;
  const carriers = (s && s.carriers) || { vobiz: s };
  const vobizLive = carriers.vobiz && carriers.vobiz.connected;
  const voiceLive = carriers.voicelink && carriers.voicelink.connected;
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: 'voicelink' }, 'VoiceLink (primary)' + (voiceLive ? '' : ' · unavailable')));
  sel.appendChild(el('option', { value: 'vobiz' }, 'VoBiz (secondary)' + (vobizLive ? '' : ' · unavailable')));
  if (voiceLive) sel.value = 'voicelink';
  else if (vobizLive) sel.value = 'vobiz';
}

function onDial(numI, btn, carrierSel, selectedId) {
  const num = (numI.value || '').replace(/\D/g, '');
  const carrier = carrierSel ? carrierSel.value : 'vobiz';
  const agent = selectableAgents().find((a) => a.id === (selectedId && selectedId.value));
  if (num.length !== 10) { toast('Enter a valid 10 digit mobile number.', 'err'); numI.focus(); return; }
  if (!agent) { toast('Select a voice agent before placing the call.', 'err'); return; }
  const carrierLabel = carrier === 'voicelink' ? 'VoiceLink' : 'VoBiz';
  modal({
    title: 'Confirm a real call',
    body: el('div', {}, [
      el('p', {}, ['You are about to place a real outbound call to ', el('b', {}, '+91 ' + num), ' via ', el('b', {}, carrierLabel), ' using ', el('b', {}, agent.name), '.']),
      el('div', { class: 'danger-note' }, [
        el('b', {}, 'This is a live, paid call. '),
        document.createTextNode('The selected agent voice, persona, and Dograh workflow will be used for this call only.')
      ])
    ]),
    confirmText: 'Yes, place the call', confirmKind: 'danger',
    onConfirm: async () => {
      btn.disabled = true; btn.textContent = 'Dialing...';
      try {
        await api('/api/telephony/dial', { method: 'POST', body: { number: num, provider: carrier, agentId: agent.id, confirm: true } });
        rememberOutboundAgent(agent.id);
        toast('Call placed to +91 ' + num + ' with ' + agent.name + '.', 'ok');
        State.loaded.telephony = false;
        const list = $('#tx_list'); const detail = $('#tx_detail');
        if (list && detail) loadTranscripts(list, detail, { q: ($('#tx_q') && $('#tx_q').value) || '', agentId: ($('#tx_agent') && $('#tx_agent').value) || '', number: ($('#tx_num') && $('#tx_num').value) || '' });
        const analytics = $('#telAnalytics');
        if (analytics) paintAgentAnalytics(analytics);
      } catch (ex) {
        if (ex.status === 400 && ex.data && ex.data.code === 'needs_confirm') toast('Confirmation required. Please retry.', 'err');
        else toast((ex.data && ex.data.detail) ? ex.data.detail : (ex.message || 'Dial failed.'), 'err');
      } finally {
        btn.disabled = false; btn.textContent = 'Place call';
      }
    }
  });
}

/* ===========================================================================
   6. PRESETS, BILLING, SUPPORT, AND SUPER ADMIN
   =========================================================================== */
async function viewPresets(root) {
  root.appendChild(viewHead('Agent presets', 'Start with a production-minded intake flow, then customize the voice, instructions, calendar, and your own number.'));
  const notice = el('div', { class: 'inbound-note', style: 'margin:0 0 18px' }, 'Presets are starting points. Personal Injury does not provide legal advice, and Dental does not diagnose. Review the workflow and consent language before using it live.');
  const host = el('div', { class: 'preset-grid' }, skeleton('sk-card', 6));
  root.appendChild(notice); root.appendChild(host);
  try {
    const out = await api('/api/presets');
    State.presets = out.presets || [];
    host.innerHTML = '';
    State.presets.forEach((p) => {
      const privacy = p.recommendedPrivacyMode || p.privacyMode || 'standard';
      host.appendChild(el('article', { class: 'card preset-card' }, [
        el('div', { class: 'preset-icon' }, (p.name || '?').slice(0, 1)),
        el('div', { class: 'flex items-center justify-between gap-2' }, [
          el('h3', { class: 't-h3' }, p.name),
          el('span', { class: 'badge-ready' }, privacy.replace(/_/g, ' '))
        ]),
        el('p', { class: 'muted' }, p.description || 'Editable voice-agent starting point.'),
        el('div', { class: 'preset-meta' }, [
          el('span', {}, p.category || 'Voice agent'),
          el('span', {}, 'BYON ready')
        ]),
        el('button', { class: 'btn btn-primary', onclick: () => createFromPreset(p) }, 'Use this preset')
      ]));
    });
    if (!State.presets.length) host.appendChild(el('div', { class: 'empty muted' }, 'No presets are available.'));
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad muted' }, e.message)); }
}

function createFromPreset(preset) {
  modal({
    title: 'Create ' + preset.name,
    body: el('div', {}, [
      el('p', {}, 'This creates an editable agent in your workspace. No phone number is attached until you connect your own number.'),
      field('Agent name', el('input', { class: 'input', id: 'preset_agent_name', value: preset.name }))
    ]),
    confirmText: 'Create agent',
    onConfirm: async () => {
      const name = ($('#preset_agent_name').value || preset.name).trim();
      await api('/api/agents', { method: 'POST', body: { presetId: preset.id, name: name } });
      State.loaded.agents = false;
      toast(name + ' created.', 'ok');
      goto('agents');
    }
  });
}

/* ===========================================================================
   AGENCY FINANCE, INTEGRATIONS, AND OPERATING PROMPT
   =========================================================================== */
async function viewInvoices(root) {
  const routeDef = ROUTES.find((r) => r.id === 'invoices');
  if (!canAccessRoute(routeDef)) {
    toast('Access restricted: ' + (routeDef ? routeDef.label : 'Invoices') + ' requires elevated permissions.', 'warn');
    goto('overview');
    return;
  }
  const canManage = isPlatformUserClient(State.me.user);
  const head = viewHead('Invoices', canManage ? 'Create, issue, and track agency invoices. Stored status never implies an email was sent.' : 'Review invoices issued to this workspace. Agency operators control status and collection records.');
  if (canManage) head.appendChild(el('div', { class: 'view-actions' }, [el('button', { class: 'btn btn-primary', onclick: openInvoiceComposer }, 'Create invoice')]));
  root.appendChild(head);
  const summary = el('div', { class: 'invoice-summary-grid' }, skeleton('sk-stat', 4));
  const tableCard = el('section', { class: 'card invoice-table-card' }, skeleton('sk-card', 1));
  root.appendChild(summary); root.appendChild(tableCard);
  try {
    const out = await api('/api/invoices');
    State.invoices = out.invoices || []; State.loaded.invoices = true;
    paintInvoices(summary, tableCard, State.invoices);
  } catch (e) {
    summary.innerHTML = '';
    tableCard.innerHTML = '';
    tableCard.appendChild(el('div', { class: 'error-state' }, [el('h3', {}, 'Invoices unavailable'), el('p', {}, e.message), el('button', { class: 'btn btn-ghost', onclick: () => onRoute() }, 'Try again')]));
  }
}

function invoiceEffectiveStatus(row) { return row.status || row.storedStatus || 'draft'; }
function invoiceStatusLabel(status) { return String(status || 'draft').replace(/_/g, ' '); }
function paintInvoices(summary, host, rows) {
  const sums = { outstanding: 0, overdue: 0, paid: 0, issued: 0 };
  rows.forEach((row) => {
    const status = invoiceEffectiveStatus(row);
    if (status === 'issued' || status === 'overdue') sums.outstanding += row.amountPaise || 0;
    if (status === 'overdue') sums.overdue += row.amountPaise || 0;
    if (status === 'paid') sums.paid += row.amountPaise || 0;
    if (row.storedStatus === 'issued' || row.storedStatus === 'paid') sums.issued += row.amountPaise || 0;
  });
  summary.innerHTML = '';
  [['Outstanding', sums.outstanding, 'Issued and unpaid'], ['Overdue', sums.overdue, 'Past the due date'], ['Paid', sums.paid, 'Recorded as collected'], ['Total issued', sums.issued, 'Excludes drafts and voids']].forEach((item, index) => summary.appendChild(el('article', { class: 'agency-metric' + (index === 1 ? ' critical' : index === 2 ? ' positive' : '') }, [el('div', { class: 'agency-metric-label' }, item[0]), el('div', { class: 'agency-metric-value' }, '₹' + fmtInr(item[1] / 100)), el('div', { class: 'agency-metric-note' }, item[2])] )));
  host.innerHTML = '';
  const controls = el('div', { class: 'invoice-table-head' }, [
    el('div', {}, [el('span', { class: 'section-kicker' }, 'Agency finance'), el('h3', {}, 'Invoice register')]),
    el('div', { class: 'invoice-filters' }, ['all','draft','issued','overdue','paid','void'].map((status) => el('button', { class: 'invoice-filter' + (status === 'all' ? ' active' : ''), 'data-filter': status, onclick: (event) => {
      $$('.invoice-filter', host).forEach((button) => button.classList.toggle('active', button === event.currentTarget));
      renderInvoiceRows(host.querySelector('tbody'), rows, status);
    } }, invoiceStatusLabel(status))))
  ]);
  const table = el('table', { class: 'data-table invoice-table' }, [
    el('thead', {}, el('tr', {}, ['Invoice','Client','Issued','Due','Status','Amount',''].map((label) => el('th', {}, label)))),
    el('tbody')
  ]);
  host.appendChild(controls);
  host.appendChild(el('div', { class: 'table-scroll' }, table));
  renderInvoiceRows(table.querySelector('tbody'), rows, 'all');
}

function renderInvoiceRows(body, rows, filter) {
  body.innerHTML = '';
  const visible = rows.filter((row) => filter === 'all' || invoiceEffectiveStatus(row) === filter);
  if (!visible.length) {
    const canManage = isPlatformUserClient(State.me.user);
    const cell = el('td', { colspan: '7' }, el('div', { class: 'empty compact' }, [el('div', { class: 'ttl' }, filter === 'all' ? 'No invoices yet' : 'No ' + filter + ' invoices'), el('p', {}, canManage ? 'Create an invoice to start the register.' : 'Agency-issued invoices will appear here.'), filter === 'all' && canManage ? el('button', { class: 'btn btn-primary btn-sm', onclick: openInvoiceComposer }, 'Create invoice') : null]));
    body.appendChild(el('tr', {}, cell)); return;
  }
  visible.forEach((row) => {
    const status = invoiceEffectiveStatus(row);
    body.appendChild(el('tr', {}, [
      el('td', { class: 'mono-cell' }, row.invoiceNumber),
      el('td', {}, [el('strong', {}, row.clientName), row.clientEmail ? el('small', {}, row.clientEmail) : null]),
      el('td', {}, row.issueDate), el('td', {}, row.dueDate),
      el('td', {}, el('span', { class: 'status-badge status-' + status }, invoiceStatusLabel(status))),
      el('td', { class: 'money-cell' }, '₹' + fmtInr((row.amountPaise || 0) / 100)),
      el('td', {}, el('button', { class: 'btn btn-quiet btn-sm', onclick: () => inspectInvoice(row) }, 'Open'))
    ]));
  });
}

async function openInvoiceComposer() {
  if (!isPlatformUserClient(State.me.user)) { toast('Only agency operators can create invoices.', 'err'); return; }
  let tenants = [];
  if (isPlatformUserClient(State.me.user)) {
    try { tenants = (await api('/api/admin/tenants')).tenants || []; } catch (_) {}
  }
  if (!tenants.length) tenants = [State.me.tenant];
  const tenantSelect = el('select', { class: 'select' }, tenants.map((tenant) => el('option', { value: tenant.id }, tenant.name)));
  const clientName = el('input', { class: 'input', value: tenants[0].name || '' });
  tenantSelect.onchange = () => { const selected = tenants.find((tenant) => tenant.id === tenantSelect.value); if (selected) clientName.value = selected.name; };
  const clientEmail = el('input', { class: 'input', type: 'email', placeholder: 'billing@client.com' });
  const description = el('textarea', { class: 'textarea', placeholder: 'Automation system implementation and monthly operations' });
  const amount = el('input', { class: 'input', type: 'number', min: '1', max: '10000000', step: '0.01', placeholder: '5000' });
  const issueDate = el('input', { class: 'input', type: 'date', value: new Date().toISOString().slice(0, 10) });
  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const dueDate = el('input', { class: 'input', type: 'date', value: due });
  const issueNow = el('input', { type: 'checkbox', checked: 'checked' }); issueNow.checked = true;
  modal({
    title: 'Create invoice',
    body: el('div', { class: 'invoice-form' }, [
      field('Client workspace', tenantSelect), field('Client name', clientName), field('Billing email, optional', clientEmail), field('Amount in INR', amount), field('Issue date', issueDate), field('Due date', dueDate), field('Description', description),
      el('label', { class: 'check-row' }, [issueNow, el('span', {}, [el('strong', {}, 'Issue now'), el('small', {}, 'Stores an issued invoice. It does not send an email.')])])
    ]),
    confirmText: 'Create invoice',
    onConfirm: async () => {
      const paise = Math.round(Number(amount.value) * 100);
      const out = await api('/api/invoices', { method: 'POST', body: { tenantId: tenantSelect.value, clientName: clientName.value.trim(), clientEmail: clientEmail.value.trim(), description: description.value.trim(), amountPaise: paise, issueDate: issueDate.value, dueDate: dueDate.value, issueNow: issueNow.checked } });
      toast(out.note || 'Invoice created.', 'ok');
      State.loaded.invoices = false; goto('invoices'); onRoute();
    }
  });
}

function inspectInvoice(row) {
  const status = invoiceEffectiveStatus(row);
  const actions = el('div', { class: 'invoice-detail-actions' });
  if (isPlatformUserClient(State.me.user)) {
    if (row.storedStatus === 'draft') actions.appendChild(el('button', { class: 'btn btn-primary', onclick: () => updateInvoiceStatus(row.id, 'issued') }, 'Issue invoice'));
    if (row.storedStatus === 'issued') actions.appendChild(el('button', { class: 'btn btn-primary', onclick: () => updateInvoiceStatus(row.id, 'paid') }, 'Mark paid'));
    if (row.storedStatus === 'draft' || row.storedStatus === 'issued') actions.appendChild(el('button', { class: 'btn btn-ghost', onclick: () => updateInvoiceStatus(row.id, 'void') }, 'Void invoice'));
  }
  actions.appendChild(el('button', { class: 'btn btn-ghost', onclick: () => window.print() }, 'Print'));
  modal({
    title: row.invoiceNumber,
    body: el('article', { class: 'invoice-detail' }, [
      el('div', { class: 'invoice-detail-top' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Billed to'), el('h4', {}, row.clientName), row.clientEmail ? el('p', {}, row.clientEmail) : null]), el('span', { class: 'status-badge status-' + status }, invoiceStatusLabel(status))]),
      el('div', { class: 'invoice-detail-amount' }, [el('span', {}, 'Amount'), el('strong', {}, '₹' + fmtInr((row.amountPaise || 0) / 100))]),
      el('p', { class: 'invoice-detail-description' }, row.description),
      el('dl', {}, [el('div', {}, [el('dt', {}, 'Issued'), el('dd', {}, row.issueDate)]), el('div', {}, [el('dt', {}, 'Due'), el('dd', {}, row.dueDate)]), el('div', {}, [el('dt', {}, 'Delivery'), el('dd', {}, row.deliveryStatus === 'not_sent' ? 'Not emailed' : row.deliveryStatus)])]),
      actions
    ]),
    confirmText: 'Close', onConfirm: async () => {}
  });
}

async function updateInvoiceStatus(invoiceId, status) {
  try {
    await api('/api/invoices/status', { method: 'POST', body: { invoiceId, status } });
    toast('Invoice marked ' + invoiceStatusLabel(status) + '.', 'ok');
    closeModal();
    onRoute();
  } catch (e) { toast(e.message, 'err'); }
}

async function viewIntegrations(root) {
  const routeDef = ROUTES.find((r) => r.id === 'integrations');
  if (!canAccessRoute(routeDef)) {
    toast('Access restricted: ' + (routeDef ? routeDef.label : 'Integrations') + ' requires elevated permissions.', 'warn');
    goto('overview');
    return;
  }
  root.appendChild(viewHead('Integrations', 'Bring client conversations and ad research into the operating system without pretending setup is complete.'));
  const host = el('div', { class: 'integration-grid' }, skeleton('sk-card', 2)); root.appendChild(host);
  try {
    const out = await api('/api/integrations');
    State.integrations = out.integrations || []; State.loaded.integrations = true;
    host.innerHTML = '';
    State.integrations.forEach((item) => host.appendChild(integrationCard(item)));
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad error-state' }, e.message)); }
}

function integrationCard(item) {
  const requested = item.status === 'requested';
  const mark = item.id === 'whatsapp-business' ? 'WA' : 'META';
  const button = el('button', { class: 'btn ' + (requested ? 'btn-ghost' : 'btn-primary'), disabled: requested ? 'disabled' : null }, requested ? 'Setup requested' : 'Request setup');
  button.onclick = async () => {
    button.disabled = true; button.textContent = 'Recording request...';
    try { const out = await api('/api/integrations/request', { method: 'POST', body: { integrationId: item.id } }); toast(out.note, 'ok'); onRoute(); }
    catch (e) { button.disabled = false; button.textContent = 'Request setup'; toast(e.message, 'err'); }
  };
  return el('article', { class: 'card integration-card' }, [
    el('div', { class: 'integration-head' }, [el('span', { class: 'integration-mark' }, mark), el('span', { class: 'status-badge ' + (requested ? 'status-requested' : 'status-setup') }, requested ? 'requested' : 'setup required')]),
    el('span', { class: 'section-kicker' }, item.category), el('h3', {}, item.name), el('p', {}, item.description),
    el('div', { class: 'integration-columns' }, [
      el('div', {}, [el('h4', {}, 'What you will see'), el('ul', {}, (item.capabilities || []).map((value) => el('li', {}, value)))]),
      el('div', {}, [el('h4', {}, 'Required to connect'), el('ul', {}, (item.setup || []).map((value) => el('li', {}, value)))])
    ]),
    el('div', { class: 'integration-foot' }, [button, el('small', {}, 'No external service is contacted by this request.')])
  ]);
}

async function viewAgencyPrompt(root) {
  root.appendChild(viewHead('Agency prompt', 'One persistent operating instruction for this workspace. Per-agent personas remain separate.'));
  const host = el('div', { class: 'prompt-layout' }, [el('section', { class: 'card prompt-editor' }, skeleton('sk-card', 1)), el('aside', { class: 'card prompt-guide' }, skeleton('sk-card', 1))]);
  root.appendChild(host);
  try {
    const out = await api('/api/agency/prompt'); State.agencyPrompt = out; State.loaded.agencyPrompt = true;
    paintAgencyPrompt(host, out);
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad error-state' }, e.message)); }
}

function paintAgencyPrompt(host, data) {
  const text = el('textarea', { class: 'agency-prompt-text', maxlength: '12000', placeholder: 'Define how Agency OS should reason about client priorities, reporting, delivery quality, and escalation...' });
  text.value = data.prompt || '';
  const count = el('span', { class: 'prompt-count' }, text.value.length.toLocaleString('en-IN') + ' / 12,000');
  text.oninput = () => { count.textContent = text.value.length.toLocaleString('en-IN') + ' / 12,000'; };
  const save = el('button', { class: 'btn btn-primary' }, 'Save operating prompt');
  save.onclick = async () => {
    save.disabled = true; save.textContent = 'Saving...';
    try { const out = await api('/api/agency/prompt', { method: 'POST', body: { prompt: text.value } }); toast('Agency prompt saved as version ' + out.version + '.', 'ok'); paintAgencyPrompt(host, out); }
    catch (e) { toast(e.message, 'err'); save.disabled = false; save.textContent = 'Save operating prompt'; }
  };
  const editor = el('section', { class: 'card prompt-editor' }, [
    el('div', { class: 'prompt-meta' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Persistent context'), el('h3', {}, 'Agency operating prompt')]), el('span', { class: 'status-badge status-active' }, 'Version ' + (data.version || 0))]),
    text,
    el('div', { class: 'prompt-editor-foot' }, [el('div', {}, [count, el('small', {}, data.updatedAt ? 'Updated ' + new Date(data.updatedAt).toLocaleString('en-IN') + (data.updatedBy ? ' by ' + data.updatedBy : '') : 'Not saved yet')]), save])
  ]);
  const guide = el('aside', { class: 'card prompt-guide' }, [
    el('span', { class: 'section-kicker' }, 'Prompt contract'), el('h3', {}, 'What belongs here'),
    el('ul', {}, ['Agency priorities and escalation rules', 'Reporting cadence and decision principles', 'Delivery quality standards', 'How to treat client money and access'].map((value) => el('li', {}, value))),
    el('div', { class: 'prompt-boundary' }, [el('strong', {}, 'Boundary'), el('p', {}, 'This text does not authorize external messages, calls, payments, or tool actions. Those still require their normal confirmation gates.')])
  ]);
  host.innerHTML = ''; host.appendChild(editor); host.appendChild(guide);
}

async function viewBilling(root) {
  root.appendChild(viewHead('Billing', 'Prepaid INR wallet, immutable transaction history, and secure PayU checkout.'));
  const host = el('div', { class: 'grid grid-12' }, [
    el('section', { class: 'card card-pad', id: 'walletSummary' }, skeleton('sk-card', 1)),
    el('section', { class: 'card card-pad', id: 'walletLedger' }, skeleton('sk-card', 1))
  ]);
  root.appendChild(host);
  try {
    const out = await api('/api/wallet');
    const wallet = out.wallet || {}; const rows = out.ledger || [];
    const sum = $('#walletSummary'); sum.innerHTML = '';
    sum.appendChild(el('div', { class: 'muted' }, 'Available credit'));
    sum.appendChild(el('div', { class: 'wallet-big' }, ['₹' + fmtInr(wallet.balanceInr != null ? wallet.balanceInr : (wallet.balancePaise || 0) / 100), el('small', {}, ' INR') ]));
    sum.appendChild(el('p', { class: 'muted' }, 'New accounts receive a one-time ₹10 trial credit. Voice and carrier usage are deducted separately according to the live rate card.'));
    const packs = [{ id: 'starter', inr: 200 }, { id: 'growth', inr: 500 }, { id: 'scale', inr: 1000 }];
    sum.appendChild(el('div', { class: 'pack-row' }, packs.map((pack) => el('button', { class: 'btn btn-ghost', onclick: () => startRecharge(pack.id) }, 'Add ₹' + fmtInr(pack.inr)))));
    const ledger = $('#walletLedger'); ledger.innerHTML = '';
    ledger.appendChild(el('h3', { class: 't-h3', style: 'margin-bottom:14px' }, 'Transaction history'));
    rows.slice(0, 20).forEach((x) => ledger.appendChild(el('div', { class: 'ledger-row' }, [
      el('div', {}, [el('div', {}, x.description || String(x.type || '').replace(/_/g, ' ')), el('small', { class: 'muted' }, x.createdAt || '')]),
      el('b', { class: Number(x.amountPaise) >= 0 ? 'money-plus' : 'money-minus' }, (Number(x.amountPaise) >= 0 ? '+' : '') + '₹' + fmtInr(Number(x.amountPaise || 0) / 100))
    ])));
    if (!rows.length) ledger.appendChild(el('div', { class: 'muted' }, 'No wallet activity yet.'));
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad muted' }, e.message)); }
}

async function startRecharge(packId) {
  try {
    const out = await api('/api/payment-intents', { method: 'POST', body: { packId: packId } });
    const checkoutUrl = out.checkout && (out.checkout.action || out.checkout.url);
    if (checkoutUrl && out.checkout.fields) {
      const form = el('form', { method: 'POST', action: checkoutUrl });
      Object.keys(out.checkout.fields).forEach((k) => form.appendChild(el('input', { type: 'hidden', name: k, value: out.checkout.fields[k] })));
      document.body.appendChild(form); form.submit(); return;
    }
    toast(out.message || 'PayU checkout is not enabled yet. Your wallet was not charged.', 'info');
  } catch (e) { toast(e.message, 'err'); }
}

async function viewSupport(root) {
  root.appendChild(viewHead('Support', 'Open a ticket and keep every reply attached to your workspace.'));
  const subject = el('input', { class: 'input', placeholder: 'What do you need help with.' });
  const message = el('textarea', { class: 'input textarea', placeholder: 'Describe the issue, expected result, and what happened.' });
  const create = el('button', { class: 'btn btn-primary' }, 'Open ticket');
  const list = el('div', { class: 'ticket-list' }, skeleton('sk-card', 2));
  create.onclick = async () => {
    create.disabled = true;
    try {
      await api('/api/support/tickets', { method: 'POST', body: { subject: subject.value.trim(), message: message.value.trim(), priority: 'normal' } });
      subject.value = ''; message.value = ''; toast('Support ticket opened.', 'ok'); await loadTickets(list);
    } catch (e) { toast(e.message, 'err'); } finally { create.disabled = false; }
  };
  root.appendChild(el('div', { class: 'support-layout' }, [
    el('section', { class: 'card card-pad support-compose' }, [el('h3', { class: 't-h3' }, 'New ticket'), field('Subject', subject), field('Message', message), create]),
    list
  ]));
  await loadTickets(list);
}

async function loadTickets(host) {
  try {
    const out = await api('/api/support/tickets'); host.innerHTML = '';
    (out.tickets || []).forEach((t) => host.appendChild(ticketCard(t, false)));
    if (!(out.tickets || []).length) host.appendChild(el('div', { class: 'card card-pad muted' }, 'No support tickets yet.'));
  } catch (e) { host.innerHTML = ''; host.appendChild(el('div', { class: 'card card-pad muted' }, e.message)); }
}

function ticketCard(t, admin) {
  const messages = (t.messages || []).map((m) => el('div', { class: 'ticket-message' }, [
    el('b', {}, m.authorName || m.authorRole || 'User'), el('span', {}, m.message || m.body || '')
  ]));
  const reply = el('input', { class: 'input', placeholder: 'Write a reply.' });
  const send = el('button', { class: 'btn btn-ghost' }, 'Reply');
  send.onclick = async () => {
    const msg = reply.value.trim(); if (!msg) return;
    send.disabled = true;
    try {
      await api(admin ? '/api/admin/tickets/reply' : '/api/support/tickets/reply', { method: 'POST', body: { ticketId: t.id, message: msg } });
      toast('Reply sent.', 'ok'); onRoute();
    } catch (e) { toast(e.message, 'err'); } finally { send.disabled = false; }
  };
  const adminControls = admin ? el('div', { class: 'ticket-admin-controls' }, [
    (function () { const s = el('select', { class: 'select' }, ['open','in_progress','waiting_on_customer','resolved','closed'].map((v) => el('option', { value: v }, v.replace(/_/g, ' ')))); s.value = t.status || 'open'; s.setAttribute('data-ticket-status', t.id); return s; })(),
    (function () { const s = el('select', { class: 'select' }, ['low','normal','high','urgent'].map((v) => el('option', { value: v }, v))); s.value = t.priority || 'normal'; s.setAttribute('data-ticket-priority', t.id); return s; })(),
    el('button', { class: 'btn btn-ghost', onclick: async () => { const status = document.querySelector('[data-ticket-status="' + t.id + '"]').value; const priority = document.querySelector('[data-ticket-priority="' + t.id + '"]').value; await api('/api/admin/tickets/update', { method: 'POST', body: { ticketId: t.id, status: status, priority: priority } }); toast('Ticket updated.', 'ok'); onRoute(); } }, 'Update')
  ]) : null;
  return el('article', { class: 'card ticket-card' }, [
    el('div', { class: 'flex items-center justify-between gap-2' }, [el('h3', { class: 't-h3' }, t.subject), el('span', { class: 'pill' }, t.status || 'open')]),
    adminControls, ...messages, el('div', { class: 'ticket-reply' }, [reply, send])
  ]);
}

async function viewAdmin(root) {
  if (!State.me || !['super_admin', 'admin'].includes(State.me.user.role)) { goto('overview'); return; }
  const superAdmin = State.me.user.role === 'super_admin';
  const head = viewHead('Clients', 'Add, approach, inspect, pause, and offboard client workspaces with an immutable activity trail.');
  if (superAdmin) head.appendChild(el('div', { class: 'view-actions' }, [el('button', { class: 'btn btn-primary', onclick: openClientComposer }, 'Add client')]));
  root.appendChild(head);
  const stats = el('div', { class: 'admin-kpi-grid' }, skeleton('sk-stat', 5));
  const tenantHost = el('div', { class: 'card admin-client-card' }, skeleton('sk-card', 1));
  const ticketHost = el('div', { class: 'ticket-list' }, skeleton('sk-card', 2));
  const eventHost = el('div', { class: 'card card-pad admin-table agency-events-card' }, skeleton('sk-card', 1));
  root.appendChild(stats); root.appendChild(el('div', { class: 'admin-layout' }, [tenantHost, ticketHost])); root.appendChild(eventHost);
  try {
    const calls = [api('/api/admin/tickets'), api('/api/admin/payment-events')];
    if (superAdmin) calls.unshift(api('/api/admin/overview'), api('/api/admin/tenants'), api('/api/admin/users'));
    const data = await Promise.all(calls);
    const o = superAdmin ? data[0] : { totals: {} }, ts = superAdmin ? data[1] : { tenants: [] }, users = superAdmin ? data[2] : { users: [] }, tickets = data[superAdmin ? 3 : 0], events = data[superAdmin ? 4 : 1];
    stats.innerHTML = '';
    const totals = o.totals || {};
    [['Active clients', totals.activeTenants != null ? totals.activeTenants : 'Restricted', 'Live workspaces'], ['Revenue recorded', superAdmin ? '₹' + fmtInr((totals.invoicedPaise || 0) / 100) : 'Restricted', 'Issued invoices'], ['Outstanding', superAdmin ? '₹' + fmtInr((totals.outstandingPaise || 0) / 100) : 'Restricted', 'Receivables'], ['Open tickets', totals.openTickets != null ? totals.openTickets : (tickets.tickets || []).filter((t) => t.status !== 'closed').length, 'Needs attention'], ['Calls', superAdmin ? totals.calls : 'Restricted', 'Tracked usage']].forEach((x) => stats.appendChild(el('article', { class: 'agency-metric' }, [el('div', { class: 'agency-metric-label' }, x[0]), el('div', { class: 'agency-metric-value' }, String(x[1] || 0)), el('div', { class: 'agency-metric-note' }, x[2])])));
    tenantHost.innerHTML = ''; tenantHost.appendChild(el('div', { class: 'admin-client-head' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Portfolio'), el('h3', {}, 'Client workspaces')]), superAdmin ? el('button', { class: 'btn btn-ghost btn-sm', onclick: openClientComposer }, 'Add client') : null]));
    if (superAdmin) (ts.tenants || []).forEach((t) => tenantHost.appendChild(adminTenantRow(t, (users.users || []).filter((u) => u.tenantId === t.id))));
    else tenantHost.appendChild(el('div', { class: 'muted' }, 'Tenant controls require super admin access.'));
    ticketHost.innerHTML = ''; (tickets.tickets || []).forEach((t) => ticketHost.appendChild(ticketCard(t, true)));
    eventHost.innerHTML = ''; eventHost.appendChild(el('div', { class: 'agency-card-head' }, [el('div', {}, [el('span', { class: 'section-kicker' }, 'Financial operations'), el('h3', {}, 'PayU event log')]) ]));
    (events.events || []).slice(0, 25).forEach((e) => eventHost.appendChild(el('div', { class: 'admin-row' }, [el('div', {}, [el('b', {}, e.txnid || 'Unknown transaction'), el('small', { class: 'muted' }, (e.reason || '') + ' · ' + (e.createdAt || ''))]), el('span', { class: 'pill' }, e.status || 'received')])));
    if (!(events.events || []).length) eventHost.appendChild(el('div', { class: 'muted' }, 'No PayU webhooks received yet.'));
  } catch (e) { tenantHost.innerHTML = ''; tenantHost.appendChild(el('div', { class: 'muted' }, e.message)); }
}

function adminTenantRow(t, users) {
  const wallet = t.wallet || {};
  const toggle = el('button', { class: 'btn btn-ghost' }, t.status === 'suspended' ? 'Reactivate' : 'Suspend');
  toggle.onclick = async () => {
    const status = t.status === 'suspended' ? 'active' : 'suspended';
    await api('/api/admin/tenants/status', { method: 'POST', body: { tenantId: t.id, status: status } });
    toast('Tenant set to ' + status + '.', 'ok'); onRoute();
  };
  const credit = el('button', { class: 'btn btn-ghost', onclick: () => adjustWallet(t) }, 'Adjust credit');
  const inspect = el('button', { class: 'btn btn-primary', onclick: () => inspectTenant(t, users || []) }, 'Open workspace');
  const approach = el('button', { class: 'btn btn-ghost', onclick: () => openClientApproach(t) }, 'Log approach');
  return el('div', { class: 'admin-client-row' }, [
    el('div', { class: 'admin-client-identity' }, [el('span', { class: 'client-avatar' }, initials(t.name)), el('div', {}, [el('b', {}, t.name), el('small', { class: 'muted' }, (t.users || 0) + ' users, ' + (t.agents || 0) + ' agents')])]),
    el('div', { class: 'admin-client-signal' }, [el('span', {}, 'Activity'), el('strong', {}, fmtInr((t.calls || 0)) + ' calls')]),
    el('div', { class: 'admin-client-signal' }, [el('span', {}, 'Outstanding'), el('strong', {}, '₹' + fmtInr((t.outstandingPaise || 0) / 100))]),
    el('div', { class: 'admin-client-signal' }, [el('span', {}, 'Wallet'), el('strong', {}, '₹' + fmtInr((wallet.balancePaise || 0) / 100))]),
    el('span', { class: 'status-badge status-' + (t.status || 'active') }, invoiceStatusLabel(t.status || 'active')),
    el('div', { class: 'admin-client-actions' }, [inspect, approach, credit, toggle])
  ]);
}

function openClientComposer() {
  const name = el('input', { class: 'input', placeholder: 'Client or company name' });
  const ownerName = el('input', { class: 'input', placeholder: 'Primary owner name, optional' });
  const ownerEmail = el('input', { class: 'input', type: 'email', placeholder: 'owner@client.com, optional' });
  const password = el('input', { class: 'input', type: 'password', placeholder: '12+ character temporary password' });
  modal({ title: 'Add client workspace', body: el('div', { class: 'invoice-form' }, [field('Workspace name', name), field('Owner name', ownerName), field('Owner email', ownerEmail), field('Temporary password', password), el('p', { class: 'form-note' }, 'Leave owner fields empty to create an onboarding workspace. No invitation email will be sent.')]), confirmText: 'Create workspace', onConfirm: async () => {
    const out = await api('/api/admin/tenants', { method: 'POST', body: { name: name.value.trim(), ownerName: ownerName.value.trim(), ownerEmail: ownerEmail.value.trim(), password: password.value } });
    toast((out.tenant || {}).name + ' created. ' + out.note, 'ok'); onRoute();
  }});
}

function openClientApproach(t) {
  const channel = el('select', { class: 'select' }, ['whatsapp','email','phone','linkedin','meeting','other'].map((value) => el('option', { value }, invoiceStatusLabel(value))));
  const summary = el('textarea', { class: 'textarea', placeholder: 'What happened, what they need, and the next move.' });
  modal({ title: 'Log approach to ' + t.name, body: el('div', { class: 'invoice-form' }, [field('Channel', channel), field('Summary', summary)]), confirmText: 'Record activity', onConfirm: async () => {
    await api('/api/admin/client-approach', { method: 'POST', body: { tenantId: t.id, channel: channel.value, summary: summary.value.trim() } });
    toast('Client approach recorded.', 'ok'); onRoute();
  }});
}

async function inspectTenant(t, users) {
  const out = await api('/api/admin/tenant-detail?tenantId=' + encodeURIComponent(t.id));
  const tabs = [
    ['Users', (out.users || []).map((u) => u.name + ' · ' + u.email + ' · ' + u.role)],
    ['Agents', (out.agents || []).map((a) => a.name + ' · ' + ((a.telephony || {}).did || 'No number'))],
    ['Numbers', (out.numbers || []).map((n) => n.address + ' · ' + n.provider + ' · ' + n.status)],
    ['Calls', (out.usage || []).map((u) => u.day + ' · ' + (u.calls || 0) + ' calls')],
    ['Billing', (out.ledger || []).map((x) => (x.type || 'entry') + ' · ₹' + fmtInr((x.amountPaise || 0) / 100))],
    ['Support', (out.tickets || []).map((x) => x.subject + ' · ' + x.status)]
  ];
  const body = el('div', { class: 'tenant-inspector' }, tabs.map((tab) => el('section', {}, [el('h4', {}, tab[0]), ...(tab[1].length ? tab[1].map((line) => el('div', { class: 'inspector-line' }, line)) : [el('div', { class: 'muted' }, 'No records')])])));
  const user = (out.users || []).find((u) => u.role !== 'super_admin' && u.status === 'active');
  if (user) body.prepend(el('button', { class: 'btn btn-dark', onclick: () => startImpersonation(user) }, 'View as ' + user.email));
  modal({ title: out.tenant.name, body: body, confirmText: 'Close', onConfirm: async () => {} });
}

function startImpersonation(user) {
  const reason = el('input', { class: 'input', placeholder: 'Support ticket or investigation reason' });
  const password = el('input', { class: 'input', type: 'password', placeholder: 'Your super admin password' });
  modal({ title: 'View as ' + user.email, body: el('div', {}, [el('p', {}, 'This creates a 30 minute read-only user session. Billing, roles, status, and secrets remain blocked.'), field('Reason', reason), field('Re-enter your password', password)]), confirmText: 'Enter user view', onConfirm: async () => {
    await api('/api/admin/impersonations', { method: 'POST', body: { userId: user.id, reason: reason.value.trim(), password: password.value } });
    State.me = await api('/api/me'); renderShell(); goto('overview');
  }});
}

function adjustWallet(t) {
  const amount = el('input', { class: 'input', type: 'number', step: '0.01', placeholder: '100.00' });
  const reason = el('input', { class: 'input', placeholder: 'Required adjustment reason' });
  modal({ title: 'Adjust ' + t.name + ' wallet', body: el('div', {}, [field('Amount in INR, negative deducts', amount), field('Reason', reason)]), confirmText: 'Apply adjustment', onConfirm: async () => {
    const paise = Math.round(Number(amount.value) * 100);
    await api('/api/admin/wallet/adjust', { method: 'POST', body: { tenantId: t.id, amountPaise: paise, reason: reason.value.trim(), idempotencyKey: 'ui_' + Date.now() + '_' + Math.random().toString(36).slice(2) } });
    toast('Wallet adjusted.', 'ok'); onRoute();
  }});
}

/* ===========================================================================
   7. SETTINGS
   =========================================================================== */
async function viewSettings(root) {
  root.appendChild(viewHead('Settings', 'API keys, voice pipeline, telephony providers, and workspace identity. Configure providers here instead of editing server files.'));

  const keysHost = el('div', { id: 'apiKeysHost', class: 'settings-keys' }, skeleton('sk-card', 2));
  root.appendChild(keysHost);

  const provHost = el('div', { id: 'provHost' }, skeleton('sk-card', 3));
  root.appendChild(provHost);

  const t = State.me.tenant;
  const nameI = el('input', { class: 'input', id: 'set_name', type: 'text', value: t.name || '' });
  const colorVal = (t.branding && t.branding.color) || '#6E7BFF';
  const colorI = el('input', { type: 'color', id: 'set_color', value: colorVal });
  const colorHex = el('input', { class: 'input', id: 'set_color_hex', value: colorVal, style: 'max-width:130px;font-family:var(--mono)' });
  colorI.addEventListener('input', () => { colorHex.value = colorI.value; });
  colorHex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(colorHex.value)) colorI.value = colorHex.value; });

  const saveBtn = el('button', { class: 'btn btn-primary' }, 'Save tenant settings');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
    try {
      // tenant settings update is best effort. If the route is absent, surface a soft note.
      await api('/api/tenant/update', { method: 'POST', body: { name: nameI.value.trim(), color: colorI.value } });
      State.me.tenant.name = nameI.value.trim();
      State.me.tenant.branding = Object.assign({}, State.me.tenant.branding, { color: colorI.value });
      const tn = $('.tenant-chip .tn'); if (tn) { tn.textContent = State.me.tenant.name; tn.title = State.me.tenant.name; }
      const av = $('.tenant-chip .av'); if (av) av.textContent = initials(State.me.tenant.name);
      toast('Tenant settings saved.', 'ok');
    } catch (ex) {
      toast(ex.status === 404 ? 'Tenant settings endpoint not available in this build.' : (ex.message || 'Save failed.'), 'err');
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'Save tenant settings';
    }
  });

  root.appendChild(el('div', { class: 'card card-pad', style: 'margin-top:8px' }, [
    el('h3', { class: 't-h3', style: 'margin-bottom:16px' }, 'Tenant'),
    el('div', { class: 'settings-form' }, [
      field('Tenant name', nameI),
      el('div', { class: 'field' }, [el('label', {}, 'Brand color'), el('div', { class: 'color-row' }, [colorI, colorHex])]),
      el('div', { class: 'flex gap-2', style: 'margin-top:6px' }, [saveBtn, el('button', { class: 'btn btn-ghost', onclick: doLogout }, 'Sign out')])
    ])
  ]));

  const privacySelect = el('select', { class: 'select', id: 'privacy_mode' }, [
    el('option', { value: 'standard' }, 'Standard retention'),
    el('option', { value: 'metadata_only' }, 'Privacy mode, metadata only'),
    el('option', { value: 'no_recording' }, 'HIPAA mode, no recording or transcript retention')
  ]);
  const privacySave = el('button', { class: 'btn btn-primary' }, 'Save privacy mode');
  privacySave.onclick = async () => {
    privacySave.disabled = true;
    try { await api('/api/privacy', { method: 'POST', body: { mode: privacySelect.value } }); toast('Privacy mode saved.', 'ok'); }
    catch (e) { toast(e.message, 'err'); } finally { privacySave.disabled = false; }
  };
  const provider = el('select', { class: 'select' }, [
    el('option', { value: 'vobiz' }, 'VoBiz (via Dograh)'),
    el('option', { value: 'voicelink' }, 'VoiceLink'),
  ]);
  const address = el('input', { class: 'input', placeholder: 'Verified E.164 number or SIP address' });
  const label = el('input', { class: 'input', placeholder: 'Main sales line' });
  const byonList = el('div', { class: 'byon-list muted' }, 'Loading connections...');
  const byonSave = el('button', { class: 'btn btn-ghost' }, 'Connect my number');
  byonSave.onclick = async () => {
    byonSave.disabled = true;
    try { await api('/api/byon', { method: 'POST', body: { provider: provider.value, address: address.value.trim(), label: label.value.trim() } }); toast('Number connection saved for verification.', 'ok'); await loadByon(byonList); }
    catch (e) { toast(e.message, 'err'); } finally { byonSave.disabled = false; }
  };
  root.appendChild(el('div', { class: 'settings-split' }, [
    el('section', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3' }, 'Privacy and HIPAA mode'),
      el('p', { class: 'muted privacy-copy' }, 'HIPAA mode disables recording and transcript retention in Vaani AI. It does not by itself make your organization HIPAA compliant. You still need appropriate provider BAAs, policies, access controls, consent, and legal review.'),
      field('Retention policy', privacySelect), privacySave
    ]),
    el('section', { class: 'card card-pad' }, [
      el('h3', { class: 't-h3' }, 'Bring your own number'),
      el('p', { class: 'muted privacy-copy' }, 'Connect only a number or SIP address that your organization owns and has verified with the carrier.'),
      field('Provider', provider), field('Number or SIP address', address), field('Label', label), byonSave, byonList
    ])
  ]));
  Promise.all([
    api('/api/privacy').then((x) => { privacySelect.value = x.mode || 'standard'; }),
    loadByon(byonList)
  ]).catch(() => {});

  try {
    const reg = await ensureProviders();
    paintApiKeys(keysHost);
    paintProviders(provHost, reg);
  } catch (e) {
    keysHost.innerHTML = '';
    keysHost.appendChild(el('div', { class: 'card card-pad muted' }, 'Could not load API keys. ' + esc(e.message)));
    provHost.innerHTML = '';
    provHost.appendChild(el('div', { class: 'card card-pad muted' }, 'Could not load providers. ' + esc(e.message)));
  }
}

function paintApiKeys(host) {
  host.innerHTML = '';
  const statusMap = {};
  (State.credentialStatus || []).forEach((row) => { statusMap[row.catalogId] = row; });

  const card = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' }, [
    el('h3', { class: 't-h3', style: 'margin-bottom:8px' }, 'API keys and credentials'),
    el('p', { class: 'muted', style: 'font-size:.85rem;margin-bottom:16px' }, 'Keys are encrypted per workspace. They never appear in the browser after save. Server .env values still work as fallback for bootstrapping.'),
  ]);
  host.appendChild(card);

  const catalogPromise = api('/api/credentials/catalog').then((r) => r.catalog || []).catch(() => []);

  catalogPromise.then((catalog) => {
    catalog.forEach((item) => {
      const st = statusMap[item.id] || {};
      const badge = st.configured
        ? el('span', { class: 'badge-live' }, [el('span', { class: 'd' }), 'Configured · ' + (st.maskedSuffix || '****')])
        : st.source === 'server_env'
          ? el('span', { class: 'badge-ready' }, [el('span', { class: 'd' }), 'Using server env'])
          : el('span', { class: 'badge-ready' }, [el('span', { class: 'd' }), 'Needs key']);

      const form = el('div', { class: 'settings-form api-key-form' });
      const inputs = {};
      (item.fields || []).forEach((fld) => {
        const input = fld.type === 'password'
          ? el('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: fld.placeholder || '' })
          : el('input', { class: 'input', type: 'text', autocomplete: 'off', placeholder: fld.placeholder || '' });
        inputs[fld.name] = input;
        form.appendChild(field(fld.label, input));
      });

      const saveBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Save ' + item.label);
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
          const fields = {};
          for (const [name, input] of Object.entries(inputs)) fields[name] = input.value.trim();
          await api('/api/credentials/catalog', {
            method: 'POST',
            body: { catalogId: item.id, fields, idempotencyKey: 'catalog-' + item.id + '-' + Date.now() },
          });
          Object.values(inputs).forEach((input) => { if (input.type === 'password') input.value = ''; });
          State.loaded.providers = false;
          toast(item.label + ' credentials saved.', 'ok');
          const reg = await ensureProviders();
          paintApiKeys(host);
          const provHost = $('#provHost');
          if (provHost) paintProviders(provHost, reg);
        } catch (e) {
          toast(e.message || 'Could not save credentials.', 'err');
        } finally {
          saveBtn.disabled = false;
        }
      });

      form.appendChild(el('div', { class: 'flex gap-2', style: 'margin-top:8px' }, [saveBtn]));
      card.appendChild(el('div', { class: 'api-key-card', style: 'margin-top:16px;padding-top:16px;border-top:1px solid var(--border)' }, [
        el('div', { class: 'pc-top', style: 'margin-bottom:8px' }, [el('div', { class: 'pc-name' }, item.label), badge]),
        el('p', { class: 'muted', style: 'font-size:.82rem;margin-bottom:10px' }, item.description || ''),
        form,
      ]));
    });
  });
}

async function loadByon(host) {
  const out = await api('/api/byon'); host.innerHTML = '';
  (out.connections || []).forEach((x) => host.appendChild(el('div', { class: 'status-line' }, [
    el('span', { class: 'k' }, x.label || x.provider), el('span', { class: 'v' }, (x.address || '') + ' · ' + (x.status || 'pending'))
  ])));
  if (!(out.connections || []).length) host.textContent = 'No number connected yet.';
}

function paintProviders(host, reg) {
  host.innerHTML = '';
  const tenantPipeline = (State.me && State.me.tenant && State.me.tenant.pipeline) || {};
  const layers = [
    { key: 'stt', label: 'Speech to text' },
    { key: 'llm', label: 'Brain, LLM' },
    { key: 'tts', label: 'Text to speech' },
    { key: 'telephony', label: 'Telephony' },
  ];
  const pipelineCard = el('div', { class: 'card card-pad', style: 'margin-bottom:18px' }, [
    el('h3', { class: 't-h3', style: 'margin-bottom:12px' }, 'Workspace pipeline'),
    el('p', { class: 'muted', style: 'font-size:.85rem;margin-bottom:14px' }, 'Choose STT, LLM, and TTS independently. Sarvam and Vaani Native (Rumik) can be mixed per layer.'),
  ]);
  const pipelineState = {
    stt: { provider: (tenantPipeline.stt || {}).provider || 'deepgram', model: (tenantPipeline.stt || {}).model || '' },
    llm: { provider: (tenantPipeline.llm || {}).provider || 'groq', model: (tenantPipeline.llm || {}).model || '' },
    tts: { provider: (tenantPipeline.tts || {}).provider || 'rumik', model: (tenantPipeline.tts || {}).model || '', voice: (tenantPipeline.tts || {}).voice || '' },
  };
  ['stt', 'llm', 'tts'].forEach((layerKey) => {
    const list = (reg[layerKey] || []).filter((p) => p.implemented);
    const provSel = el('select', { class: 'select' }, list.map((p) => el('option', { value: p.id, selected: p.id === pipelineState[layerKey].provider ? 'selected' : false }, p.label + (p.live ? '' : ' (needs setup)'))));
    const modelSel = el('select', { class: 'select' });
    const voiceSel = layerKey === 'tts' ? el('select', { class: 'select' }, SARVAM_VOICES.map((v) => el('option', { value: v }, v))) : null;
    function refillModels() {
      const picked = list.find((p) => p.id === provSel.value) || list[0];
      pipelineState[layerKey].provider = provSel.value;
      modelSel.innerHTML = '';
      const models = layerKey === 'tts' && picked.id === 'rumik' ? VOICE_MODELS
        : layerKey === 'tts' && picked.id === 'sarvam' ? ['bulbul:v2', 'bulbul:v3']
          : layerKey === 'stt' && picked.id === 'sarvam' ? ['saarika:v2.5', 'saaras:v3']
            : layerKey === 'llm' && picked.id === 'groq' ? ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']
              : layerKey === 'llm' && picked.id === 'sarvam' ? ['sarvam-105b']
                : [picked.model].filter(Boolean);
      models.forEach((m) => modelSel.appendChild(el('option', { value: m, selected: m === pipelineState[layerKey].model ? 'selected' : false }, m)));
      if (voiceSel) voiceSel.style.display = picked.id === 'sarvam' ? '' : 'none';
    }
    provSel.addEventListener('change', refillModels);
    refillModels();
    const fields = [field(layerKey.toUpperCase() + ' provider', provSel), field('Model', modelSel)];
    if (voiceSel) fields.push(field('Sarvam voice', voiceSel));
    pipelineCard.appendChild(el('div', { class: 'settings-form', style: 'margin-bottom:12px' }, fields));
    pipelineState[layerKey].modelSel = modelSel;
    if (voiceSel) pipelineState[layerKey].voiceSel = voiceSel;
  });
  const saveBtn = el('button', { class: 'btn btn-primary' }, 'Save pipeline');
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      const body = {
        stt: { provider: pipelineState.stt.provider, model: pipelineState.stt.modelSel.value },
        llm: { provider: pipelineState.llm.provider, model: pipelineState.llm.modelSel.value },
        tts: {
          provider: pipelineState.tts.provider,
          model: pipelineState.tts.modelSel.value,
          ...(pipelineState.tts.voiceSel ? { voice: pipelineState.tts.voiceSel.value } : {}),
        },
      };
      const out = await api('/api/tenant/pipeline', { method: 'POST', body });
      if (out.tenant) State.me.tenant = out.tenant;
      toast('Workspace pipeline saved.', 'ok');
      State.loaded.providers = false;
    } catch (e) { toast(e.message || 'Could not save pipeline.', 'err'); }
    finally { saveBtn.disabled = false; }
  };
  pipelineCard.appendChild(saveBtn);
  host.appendChild(pipelineCard);

  layers.forEach((L) => {
    const list = reg[L.key] || [];
    const wrap = el('div', { class: 'prov-layer' }, [
      el('div', { class: 'lh' }, [el('span', { class: 'lt' }, L.label)]),
      el('div', { class: 'prov-grid' }, list.length ? list.map(provCard) : [el('div', { class: 'muted' }, 'No providers registered.')])
    ]);
    host.appendChild(wrap);
  });
}
function provCard(p) {
  const live = !!p.live;
  const selected = !!p.selected;
  const needs = p.needs || [];
  return el('div', { class: 'card prov-card' }, [
    el('div', { class: 'pc-top' }, [
      el('div', { class: 'pc-name' }, p.label || p.id),
      selected && live
        ? el('span', { class: 'badge-live' }, [el('span', { class: 'd' }), 'Selected'])
        : live
          ? el('span', { class: 'badge-ready' }, [el('span', { class: 'd' }), 'Configured'])
          : el('span', { class: 'badge-ready' }, [el('span', { class: 'd' }), 'Needs setup'])
    ]),
    selected && live
      ? el('div', { class: 'pc-needs' }, 'Default provider for dashboard-owned requests.')
      : live
        ? el('div', { class: 'pc-needs' }, 'Credentials available. Select it through trusted server configuration.')
      : el('div', { class: 'pc-needs' }, needs.length
          ? ['Add credentials in ', el('strong', {}, 'Settings → API keys'), ' or configure ', ...needs.flatMap((n, i) => i ? [document.createTextNode(', '), el('code', {}, n)] : [el('code', {}, n)]), document.createTextNode(' on the server.')]
          : 'Adapter is implemented but not configured.')
  ]);
}

/* ===========================================================================
   START
   =========================================================================== */
let _booted = false;
function bootOnce() { if (_booted) return; _booted = true; boot(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootOnce);
else bootOnce();

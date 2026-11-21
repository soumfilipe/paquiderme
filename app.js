import {
  OOB, b64url, randomString, pkceChallenge, normalizeHost,
  sanitizeHtml, emojiFragment, safeUrl, timeAgo, h, svgIcon, sparkline, parseNextMaxId,
} from './lib.js';

// anti-clickjacking: o GitHub Pages não permite cabeçalhos (frame-ancestors), então o app se recusa a rodar dentro de um iframe
if (window.top !== window.self) { document.documentElement.hidden = true; try { window.top.location = window.self.location; } catch { /* sem permissão: fica oculto */ } }

const APP_NAME = 'Paquiderme';
const SCOPES = 'read write push';
// Diretório onde o app está publicado (funciona em /, em subpasta e em domínio próprio)
const APP_URL = new URL('.', location.href).href;

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Armazenamento local ---------- */

const store = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem('pq.' + k);
      return v == null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('pq.' + k, JSON.stringify(v)); } catch { /* sem espaço/privado */ } },
  del(k) { try { localStorage.removeItem('pq.' + k); } catch { /* ignora */ } },
};

let session = null; // { host, token, account } — conta ativa
let appStarted = false;

// Várias contas: 'sessions' guarda todas; 'session' é a ativa
const sessions = () => store.get('sessions', []);
const sameAcc = (x, y) => x.host === y.host && x.account.id === y.account.id;
function persistSession() {
  store.set('session', session);
  const l = sessions();
  const i = l.findIndex((x) => sameAcc(x, session));
  if (i >= 0) l[i] = session; else l.push(session);
  store.set('sessions', l);
}
const seenKey = () => `seenNotif.${session.host}.${session.account.id}`;
const scrollKey = (kind) => `scroll.${session.host}.${session.account.id}.${kind}`;

const mkSearch = () => ({ active: false, q: '', type: '', res: null, loading: false, error: null, more: false });
const mkList = () => ({ items: [], more: true, loading: false, error: null });
const mkState = () => ({
  tab: 'home',
  home: mkList(),
  notifications: mkList(),
  notifTab: 'all',      // all | mentions | dms
  mentions: mkList(),
  convs: mkList(),
  followedTags: { items: [], loaded: false, loading: false, error: null },
  local: mkList(),
  global: mkList(),
  other: mkList(),
  tag: mkList(),
  search: mkSearch(),
  trends: { tags: [], statuses: [], links: [], people: [], notices: [], loading: false, error: null, loaded: false },
  profiles: [],        // pilha de telas (perfis, conversas, listas) abertas por cima da aba atual
  lists: { items: [], loaded: false, loading: false, error: null },
  newPosts: [],        // publicações que chegaram em tempo real e esperam o toque para entrar
  homeList: null,      // id da lista exibida no Início (null = timeline principal)
  listTl: mkList(),
  me: null,            // perfil da aba Conta
  settingsOpen: false,
  explore: {
    seg: store.get('seg') === 'search' ? 'local' : store.get('seg', 'local'),
    tag: null,
    tagFollowing: null,
    otherHost: store.get('otherHost', ''),
  },
});
let state = mkState();

/* ---------- Avisos ---------- */

let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------- Login (OAuth com PKCE) ---------- */

function showLogin(message = '', { add = false } = {}) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').textContent = message;
  const has = sessions().length > 0;
  $('#login-cancel').hidden = !has;
  $('#login-add-note').hidden = !(add || has);
  const last = store.get('lastHost');
  if (add) $('#instance').value = '';
  else if (last) $('#instance').value = last;
  if (add) $('#instance').focus();
}

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}

async function postForm(url, data) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data),
    });
  } catch {
    throw new Error('Não consegui falar com a instância. Verifique o endereço e a conexão.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Erro ${res.status}`);
  return json;
}

async function ensureApp(host) {
  const known = store.get('app.' + host);
  if (known && known.app_url === APP_URL) return known;
  const r = await postForm(`https://${host}/api/v1/apps`, {
    client_name: APP_NAME,
    redirect_uris: `${APP_URL}\n${OOB}`,
    scopes: SCOPES,
    website: APP_URL,
  });
  const app = { client_id: r.client_id, client_secret: r.client_secret, app_url: APP_URL };
  store.set('app.' + host, app);
  return app;
}

async function startLogin(manual) {
  const err = $('#login-error');
  err.textContent = '';
  const host = normalizeHost($('#instance').value);
  if (!host) { err.textContent = 'Endereço de instância inválido.'; return; }
  try {
    const app = await ensureApp(host);
    const verifier = randomString(48);
    const stateParam = randomString(16);
    store.set('pending', { host, verifier, state: stateParam, manual });
    store.set('lastHost', host);
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: app.client_id,
      redirect_uri: manual ? OOB : APP_URL,
      scope: SCOPES,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
      state: stateParam,
    });
    const url = `https://${host}/oauth/authorize?${q}`;
    if (manual) window.open(url, '_blank', 'noopener');
    else location.href = url;
  } catch (e) {
    err.textContent = e.message;
  }
}

async function finishLogin(code, pending, redirectUri) {
  const { host } = pending;
  const app = store.get('app.' + host);
  if (!app) throw new Error('Registro do app não encontrado. Comece o login de novo.');
  const tok = await postForm(`https://${host}/oauth/token`, {
    grant_type: 'authorization_code',
    code,
    client_id: app.client_id,
    client_secret: app.client_secret,
    redirect_uri: redirectUri,
    code_verifier: pending.verifier,
    scope: SCOPES,
  });
  const res = await fetch(`https://${host}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!res.ok) throw new Error('Login feito, mas não consegui ler a conta.');
  const a = await res.json();
  session = {
    host,
    token: tok.access_token,
    account: { id: a.id, acct: a.acct, username: a.username, display_name: a.display_name, avatar: a.avatar_static || a.avatar, url: a.url, emojis: a.emojis },
  };
  persistSession();
  store.del('pending');
}

async function handleCallback(params) {
  const pending = store.get('pending');
  history.replaceState(null, '', APP_URL);
  if (params.get('error')) {
    showLogin(params.get('error_description') || params.get('error'));
    return;
  }
  if (!pending || params.get('state') !== pending.state) {
    showLogin('Resposta de login inesperada. Tente de novo.');
    return;
  }
  try {
    await finishLogin(params.get('code'), pending, APP_URL);
  } catch (e) {
    showLogin(e.message);
  }
}

function activate(s) {
  saveScroll();
  liveClose(); live.base = ''; live.query = false; live.tries = 0;
  session = s;
  store.set('session', s);
  state = mkState();
  Object.assign(pushState, { loading: false, supported: false, standalone: false, sub: null, error: null, loaded: false });
  setUnread(false);
  appStarted = false;
  try { $('#sheet').close(); } catch { /* ignora */ }
  $('#view').replaceChildren();
  window.scrollTo(0, 0);
  startApp();
}

// Sai da conta ativa; se houver outra, passa para ela
async function logout({ revoke = true, message = '' } = {}) {
  const gone = session;
  liveClose();
  if (gone && revoke) {
    const app = store.get('app.' + gone.host);
    if (app) {
      try {
        await postForm(`https://${gone.host}/oauth/revoke`, {
          client_id: app.client_id, client_secret: app.client_secret, token: gone.token,
        });
      } catch { /* segue mesmo se falhar */ }
    }
  }
  if (gone) clearCaches(gone);
  store.del('session');
  session = null;
  if (gone) store.set('sessions', sessions().filter((x) => !sameAcc(x, gone)));
  const next = sessions()[0];
  state = mkState();
  if (next) { activate(next); if (message) toast(message); return; }
  showLogin(message);
}

/* ---------- API ---------- */

async function api(path, { method = 'GET', params, body, form, headers = {}, host, auth = true, onHeaders } = {}) {
  const target = host || session.host;
  // o token nunca sai da instância do usuário
  if (auth && target !== session.host) throw new Error('Requisição autenticada para outra instância bloqueada.');
  const url = new URL(path, `https://${target}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else if (v != null) url.searchParams.set(k, v);
    }
  }
  const init = { method, headers: { ...headers } };
  if (auth) init.headers.Authorization = `Bearer ${session.token}`;
  if (form) {
    init.body = form; // multipart: o navegador define o Content-Type com o boundary
  } else if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(auth
      ? 'Sem conexão com a instância.'
      : `Não consegui acessar ${target}. Ela pode estar fora do ar ou não aceitar acesso de outros sites.`);
  }
  if (auth && res.status === 401) {
    await logout({ revoke: false, message: 'Sessão expirada. Entre de novo.' });
    throw new Error('Sessão expirada.');
  }
  if (onHeaders) onHeaders(res.headers);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((json && json.error) || `Erro ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/* ---------- Renderização ---------- */

function nameNode(account) {
  return h('span', {}, emojiFragment(account.display_name || account.username, account.emojis));
}

function paintAction(btn, icon, count, on) {
  if (!btn.dataset.label) btn.dataset.label = btn.getAttribute('aria-label') || '';
  if (btn.dataset.label) btn.setAttribute('aria-label', count ? `${btn.dataset.label}, ${count}` : btn.dataset.label);
  btn.replaceChildren(svgIcon(icon, 20), h('span', { class: 'count' }, count ? String(count) : ''));
  btn.classList.toggle('on', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function actionButton(cls, icon, count, on, onclick, label) {
  const b = h('button', { type: 'button', class: cls, 'aria-label': label, onclick });
  paintAction(b, icon, count, on);
  return b;
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.replaceChildren(svgIcon(el.dataset.icon, Number(el.dataset.size) || 24));
  });
}

async function toggle(btn, sh, kind, visibility) {
  const isBoost = kind === 'boost';
  const was = isBoost ? sh.reblogged : sh.favourited;
  const verb = isBoost ? (was ? 'unreblog' : 'reblog') : (was ? 'unfavourite' : 'favourite');
  btn.disabled = true;
  try {
    const r = await api(`/api/v1/statuses/${sh.id}/${verb}`, { method: 'POST', body: verb === 'reblog' && visibility ? { visibility } : undefined });
    const u = r.reblog || r; // reblog devolve o "invólucro"; o original vem em .reblog
    if (isBoost) {
      sh.reblogged = u.reblogged;
      sh.reblogs_count = u.reblogs_count;
      paintAction(btn, 'boost', sh.reblogs_count, sh.reblogged);
    } else {
      sh.favourited = u.favourited;
      sh.favourites_count = u.favourites_count;
      paintAction(btn, 'fav', sh.favourites_count, sh.favourited);
    }
    btn.classList.add('pulse');
    setTimeout(() => btn.classList.remove('pulse'), 600);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

function boostSheet(btn, sh) {
  const items = [
    { label: 'Impulsionar', icon: 'boost', onclick: () => toggle(btn, sh, 'boost') },
    { label: 'Impulsionar sem listar', icon: 'vis-unlisted', onclick: () => toggle(btn, sh, 'boost', 'unlisted') },
    { label: 'Impulsionar só para seguidores', icon: 'vis-private', onclick: () => toggle(btn, sh, 'boost', 'private') },
  ];
  const qa = sh.quote_approval;
  if (!qa || qa.current_user !== 'denied') items.push({ label: 'Citar', icon: 'edit', onclick: () => openComposer({ quote: sh }) });
  openSheet('Impulsionar', items);
}

async function toggleBookmark(btn, sh) {
  const was = !!sh.bookmarked;
  btn.disabled = true;
  try {
    const r = await api(`/api/v1/statuses/${sh.id}/${was ? 'unbookmark' : 'bookmark'}`, { method: 'POST' });
    sh.bookmarked = (r.reblog || r).bookmarked;
    paintAction(btn, 'bookmark', 0, sh.bookmarked);
    btn.classList.add('pulse');
    setTimeout(() => btn.classList.remove('pulse'), 600);
    toast(sh.bookmarked ? 'Salvo' : 'Removido dos salvos');
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Menu inferior (folha de ações) ---------- */

function openSheet(title, items, content) {
  const d = $('#sheet');
  d.replaceChildren(h('div', { class: 'sheet-box' },
    title ? h('p', { class: 'sheet-title muted small' }, title) : null,
    content || null,
    ...items.map((it) => it.href
      ? h('a', { class: 'sheet-item', href: safeUrl(it.href), target: '_blank', rel: 'noopener noreferrer', onclick: () => d.close() }, it.icon ? svgIcon(it.icon, 20) : null, it.label)
      : h('button', { type: 'button', class: `sheet-item${it.danger ? ' danger' : ''}`, onclick: async () => { if (it.keepOpen) { if (await it.onclick() !== false) d.close(); return; } d.close(); await it.onclick(); } }, it.icon ? svgIcon(it.icon, 20) : null, it.label)),
    h('button', { type: 'button', class: 'sheet-item cancel', onclick: () => d.close() }, 'Cancelar')));
  if (!d.open) d.showModal();
}

// Some das listas as publicações de uma conta que acabou de ser silenciada/bloqueada
function purgeAccount(id) {
  const keep = (s) => s.account.id !== id && !(s.reblog && s.reblog.account.id === id);
  ['home', 'local', 'global', 'tag', 'listTl'].forEach((k) => { state[k].items = state[k].items.filter(keep); });
  state.trends.statuses = state.trends.statuses.filter(keep);
  state.notifications.items = state.notifications.items.filter((n) => n.account.id !== id);
  render();
}

function applyRel(account, rel) {
  [state.me, ...state.profiles].forEach((p) => { if (p && p.id === account.id && !p.type) p.rel = rel; });
}

async function relOf(account) {
  const r = await api('/api/v1/accounts/relationships', { params: { 'id[]': [account.id] } });
  return r[0];
}

async function muteAccount(account, duration) {
  try {
    const rel = await api(`/api/v1/accounts/${account.id}/mute`, { method: 'POST', body: { notifications: true, duration } });
    applyRel(account, rel);
    purgeAccount(account.id);
    toast(`@${account.acct} silenciado`);
  } catch (e) { toast(e.message); }
}

async function accountAction(account, verb, msg) {
  try {
    const rel = await api(`/api/v1/accounts/${account.id}/${verb}`, { method: 'POST' });
    applyRel(account, rel);
    if (verb === 'block' || verb === 'mute') purgeAccount(account.id); else render();
    toast(msg);
  } catch (e) { toast(e.message); }
}

function reportSheet(account, status) {
  const comment = h('textarea', { class: 'sheet-text', rows: '4', maxlength: '1000', placeholder: 'O que há de errado? (opcional)', 'aria-label': 'Motivo da denúncia' });
  const remote = account.acct.includes('@');
  const fwd = h('input', { type: 'checkbox', checked: true });
  openSheet(`Denunciar @${account.acct}`, [{
    label: 'Enviar denúncia', icon: 'flag', danger: true,
    onclick: async () => {
      try {
        await api('/api/v1/reports', { method: 'POST', body: {
          account_id: account.id, status_ids: status ? [status.id] : undefined,
          comment: comment.value.trim() || undefined, forward: remote ? fwd.checked : undefined,
        } });
        toast('Denúncia enviada');
      } catch (e) { toast(e.message); }
    },
  }], h('div', { class: 'sheet-form' }, comment,
    remote ? h('label', { class: 'sheet-check' }, fwd, ` Encaminhar também à instância de @${account.acct.split('@')[1]}`) : null));
}

async function followOptions(account, patch, msg) {
  try {
    const rel = await api(`/api/v1/accounts/${account.id}/follow`, { method: 'POST', body: patch });
    applyRel(account, rel);
    render();
    toast(msg);
  } catch (e) { toast(e.message); }
}

function followItems(account, rel) {
  if (!rel || !rel.following) return [];
  const showing = rel.showing_reblogs !== false;
  return [
    { label: showing ? `Ocultar impulsos de @${account.acct}` : `Mostrar impulsos de @${account.acct}`, icon: 'boost',
      onclick: () => followOptions(account, { reblogs: !showing, notify: !!rel.notifying }, showing ? 'Impulsos ocultos' : 'Impulsos visíveis') },
    { label: rel.notifying ? `Parar de avisar publicações de @${account.acct}` : `Avisar quando @${account.acct} publicar`, icon: rel.notifying ? 'notifications' : 'notifications-ring',
      onclick: () => followOptions(account, { reblogs: showing, notify: !rel.notifying }, rel.notifying ? 'Avisos desligados' : 'Você será avisado') },
  ];
}

function moderationItems(account, rel, status) {
  const muted = rel && rel.muting;
  const blocked = rel && rel.blocking;
  return [
    ...followItems(account, rel),
    muted
      ? { label: `Deixar de silenciar @${account.acct}`, icon: 'mute', onclick: () => accountAction(account, 'unmute', 'Silenciamento removido') }
      : { label: `Silenciar @${account.acct}`, icon: 'mute', onclick: () => openSheet(`Silenciar @${account.acct}`, [
        { label: 'Por 1 dia', onclick: () => muteAccount(account, 86400) },
        { label: 'Por 7 dias', onclick: () => muteAccount(account, 604800) },
        { label: 'Para sempre', onclick: () => muteAccount(account, 0) },
      ]) },
    blocked
      ? { label: `Desbloquear @${account.acct}`, icon: 'block', onclick: () => accountAction(account, 'unblock', 'Desbloqueado') }
      : { label: `Bloquear @${account.acct}`, icon: 'block', danger: true, onclick: () => openSheet(`Bloquear @${account.acct}?`, [
        { label: 'Bloquear', icon: 'block', danger: true, onclick: () => accountAction(account, 'block', `@${account.acct} bloqueado`) },
      ]) },
    { label: status ? 'Denunciar esta publicação' : `Denunciar @${account.acct}`, icon: 'flag', danger: true, onclick: () => reportSheet(account, status) },
  ];
}

async function accountMenu(account, rel) {
  openSheet(`@${account.acct}`, moderationItems(account, rel, null));
}

async function translateStatus(sh, btn) {
  btn.disabled = true; btn.textContent = 'Traduzindo…';
  try {
    const r = await api(`/api/v1/statuses/${sh.id}/translate`, { method: 'POST', body: { lang: (navigator.language || 'pt').slice(0, 2) } });
    translations.set(sh.id, { content: r.content, lang: r.detected_source_language, provider: r.provider, shown: true });
    replaceStatus(sh);
  } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = `Traduzir do ${sh.language.toUpperCase()}`; }
}

async function openHistory(sh) {
  openSheet('Histórico de edições', [], h('p', { class: 'muted' }, 'Carregando…'));
  try {
    const list = await api(`/api/v1/statuses/${sh.id}/history`);
    const box = h('div', { class: 'history' }, ...list.slice().reverse().map((v, i) => h('div', { class: 'hist-item' },
      h('div', { class: 'muted small' }, `${i === 0 ? 'Atual · ' : ''}${new Date(v.created_at).toLocaleString('pt-BR')}`),
      v.spoiler_text ? h('div', { class: 'hist-cw' }, emojiFragment(v.spoiler_text, v.emojis)) : null,
      h('div', { class: 'body' }, sanitizeHtml(v.content, v.emojis)))));
    openSheet('Histórico de edições', [], box);
  } catch (e) { toast(e.message); try { $('#sheet').close(); } catch { /* ignora */ } }
}

async function statusMenu(sh) {
  const own = sh.account.id === session.account.id;
  const items = [];
  const url = sh.url || sh.uri;
  if (own && (sh.visibility === 'public' || sh.visibility === 'unlisted')) {
    items.push({ label: sh.pinned ? 'Desafixar do perfil' : 'Fixar no perfil', icon: 'pin', onclick: async () => {
      try {
        const r = await api(`/api/v1/statuses/${sh.id}/${sh.pinned ? 'unpin' : 'pin'}`, { method: 'POST' });
        sh.pinned = r.pinned;
        toast(sh.pinned ? 'Fixada no perfil' : 'Desafixada');
        if (state.me) loadProfile(state.me);
        state.profiles.forEach((p) => { if (!p.type && p.id === session.account.id) loadProfile(p); });
      } catch (e) { toast(e.message); }
    } });
  }
  if (own) {
    if (!sh.poll) items.push({ label: 'Editar', icon: 'edit', onclick: () => openComposer({ edit: sh }) });
    items.push({ label: 'Excluir', icon: 'trash', danger: true, onclick: () => openSheet('Excluir esta publicação?', [{ label: 'Excluir', icon: 'trash', danger: true, onclick: async () => {
      try { await api(`/api/v1/statuses/${sh.id}`, { method: 'DELETE' }); removeStatus(sh.id); toast('Publicação excluída'); } catch (e) { toast(e.message); }
    } }]) });
  }
  if (own || (sh.mentions || []).some((m) => m.id === session.account.id)) {
    items.push({ label: sh.muted ? 'Reativar avisos desta conversa' : 'Silenciar esta conversa', icon: 'mute', onclick: async () => {
      try {
        const r = await api(`/api/v1/statuses/${sh.id}/${sh.muted ? 'unmute' : 'mute'}`, { method: 'POST' });
        sh.muted = r.muted;
        toast(sh.muted ? 'Conversa silenciada' : 'Avisos da conversa reativados');
      } catch (e) { toast(e.message); }
    } });
  }
  if (sh.favourites_count > 0) items.push({ label: `Quem favoritou (${sh.favourites_count})`, icon: 'fav', onclick: () => openAccountsEntry('Favoritaram', `/api/v1/statuses/${sh.id}/favourited_by`) });
  if (sh.reblogs_count > 0) items.push({ label: `Quem impulsionou (${sh.reblogs_count})`, icon: 'boost', onclick: () => openAccountsEntry('Impulsionaram', `/api/v1/statuses/${sh.id}/reblogged_by`) });
  items.push({ label: 'Copiar link', icon: 'copy', onclick: async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { toast(url); }
  } });
  if (navigator.share && (sh.visibility === 'public' || sh.visibility === 'unlisted')) items.push({ label: 'Compartilhar…', icon: 'share', onclick: async () => {
    try { await navigator.share({ url, text: plainText(sh.content).slice(0, 200) }); } catch { /* cancelado */ }
  } });
  items.push({ label: 'Abrir original', icon: 'external', href: url });
  if (!own) {
    busy(+1);
    let rel = null;
    try { rel = await relOf(sh.account); } catch { /* segue sem o estado atual */ } finally { busy(-1); }
    items.push(...moderationItems(sh.account, rel, sh));
  }
  openSheet(null, items);
}

function cardEl(c) {
  if (!c || !c.url || !(c.title || c.description)) return null;
  let host = '';
  try { host = new URL(c.url).hostname.replace(/^www\./, ''); } catch { return null; }
  const img = c.image ? h('img', { class: 'card-img', src: safeUrl(c.image), alt: '', loading: 'lazy', width: c.width || null, height: c.height || null }) : null;
  return h('a', { class: `link-card${img ? '' : ' no-img'}`, href: safeUrl(c.url), target: '_blank', rel: 'noopener noreferrer' },
    img,
    h('div', { class: 'card-text' },
      h('span', { class: 'card-site' }, c.provider_name || host),
      h('strong', { class: 'card-title' }, c.title || host),
      c.description ? h('span', { class: 'card-desc' }, c.description) : null));
}

function mediaEl(sh) {
  const items = (sh.media_attachments || []).filter((m) => safeUrl(m.url));
  if (!items.length) return null;
  const wrap = h('div', { class: `media${items.length === 1 ? ' one' : ''}${sh.sensitive && !prefs.showSensitive ? ' sensitive' : ''}` });
  for (const m of items) {
    const src = safeUrl(m.url);
    const preview = safeUrl(m.preview_url || '');
    let node;
    if (m.type === 'image') {
      node = h('img', { src: preview || src, alt: m.description || '', loading: 'lazy', class: 'zoomable' });
      node.addEventListener('click', (ev) => {
        if (wrap.classList.contains('sensitive')) return; // o primeiro toque só revela
        ev.stopPropagation();
        const imgs = items.filter((x) => x.type === 'image');
        openViewer(imgs.map((x) => ({ full: safeUrl(x.url), alt: x.description || '' })), imgs.indexOf(m));
      });
    } else if (m.type === 'gifv') {
      node = h('video', { src, poster: preview || null, autoplay: true, loop: true, muted: true, playsinline: true });
      node.muted = true;
    } else if (m.type === 'video') {
      node = h('video', { src, poster: preview || null, controls: true, playsinline: true, preload: 'metadata' });
    } else if (m.type === 'audio') {
      node = h('audio', { src, controls: true, preload: 'none' });
    } else {
      node = h('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, m.description || 'Anexo');
    }
    wrap.append(node);
  }
  if (sh.sensitive && !prefs.showSensitive) {
    wrap.title = 'Conteúdo sensível — toque para mostrar';
    wrap.addEventListener('click', () => wrap.classList.remove('sensitive'), { once: true });
  }
  return wrap;
}

// Filtros do servidor: publicações que casam com um filtro viram um aviso recolhido
const revealed = new Set();
const translations = new Map(); // id da publicação -> { content, lang, provider, shown }
function filterHits(s) {
  const sh = s.reblog || s;
  const list = (s.filtered && s.filtered.length ? s.filtered : sh.filtered) || [];
  return list.map((x) => x.filter).filter(Boolean);
}

function quoteEl(q, host) {
  const qs = q.quoted_status;
  if (!qs || q.state !== 'accepted') {
    const why = { pending: 'Citação aguardando aprovação', rejected: 'Citação não autorizada', revoked: 'Citação removida', deleted: 'Publicação citada excluída', unauthorized: 'Publicação citada indisponível', blocked_account: 'Publicação de conta bloqueada', blocked_domain: 'Publicação de domínio bloqueado', muted_account: 'Publicação de conta silenciada' }[q.state];
    return why ? h('div', { class: 'quote muted small' }, why) : null;
  }
  const a = qs.account;
  return h('div', { class: 'quote', role: 'button', tabindex: '0', onclick: () => openThread(qs, host), onkeydown: (e) => { if (e.key === 'Enter') openThread(qs, host); } },
    h('div', { class: 'quote-head' }, h('img', { class: 'avatar sm', src: safeUrl(a.avatar_static || a.avatar), alt: '', loading: 'lazy' }), h('strong', {}, nameNode(a)), h('span', { class: 'acct' }, '@' + a.acct)),
    qs.spoiler_text ? h('p', { class: 'muted small' }, qs.spoiler_text) : h('div', { class: 'quote-body' }, sanitizeHtml(qs.content, qs.emojis)));
}

function statusEl(s, { readonly = false, host = null } = {}) {
  const sh = s.reblog || s;
  const hits = revealed.has(sh.id) ? [] : filterHits(s);
  if (hits.length) {
    const names = [...new Set(hits.map((f) => f.title))].join(', ');
    const ph = h('article', { class: 'status filtered', 'data-id': sh.id },
      h('span', { class: 'muted' }, `Filtrado: ${names}`),
      h('button', { type: 'button', class: 'link', onclick: () => { revealed.add(sh.id); ph.replaceWith(statusEl(s, { readonly, host })); } }, 'Mostrar'));
    return ph;
  }
  const a = sh.account;
  const el = h('article', { class: 'status', 'data-id': sh.id });
  el._status = sh;
  el._host = host;

  if (s.reblog) {
    el.append(h('div', { class: 'boost-note' }, svgIcon('boost', 14), ' ', h('span', { class: 'link-name', role: 'button', tabindex: '0', onclick: () => openAccountFrom(s.account, host) }, nameNode(s.account)), ' impulsionou'));
  }

  if (sh.in_reply_to_id && !host) {
    const to = (sh.mentions || []).find((m) => m.id === sh.in_reply_to_account_id);
    el.append(h('div', { class: 'reply-note muted small', role: 'button', tabindex: '0', onclick: async (e) => {
      e.stopPropagation();
      try { openThread(await api(`/api/v1/statuses/${sh.in_reply_to_id}`)); } catch (err) { toast(err.message); }
    } }, svgIcon('reply', 14), ` Em resposta a ${to ? '@' + to.acct : 'uma publicação'}`));
  }
  el.append(h('header', {},
    h('div', { class: 'who-link', role: 'button', tabindex: '0', 'aria-label': `Abrir perfil de ${a.acct}`, onclick: () => openAccountFrom(a, host) },
      h('img', { class: 'avatar', src: safeUrl(a.avatar_static || a.avatar), alt: '', loading: 'lazy' }),
      h('div', { class: 'who' },
        h('div', { class: 'name' }, nameNode(a)),
        h('span', { class: 'acct' }, '@' + a.acct))),
    h('div', { class: 'when' },
      h('time', { datetime: sh.created_at, title: new Date(sh.created_at).toLocaleString('pt-BR') }, timeAgo(sh.created_at)),
      sh.edited_at && !host ? h('button', { type: 'button', class: 'edited', onclick: () => openHistory(sh) }, 'editado') : null),
  ));

  const body = h('div', { class: 'body' });
  const tr = translations.get(sh.id);
  body.append(sanitizeHtml(tr && tr.shown ? tr.content : sh.content, sh.emojis));
  const parts = [body];
  if (plainText(sh.content).length > 600 || (sh.content.match(/<br|<\/p>/g) || []).length > 10) {
    body.classList.add('clamp');
    parts.push(h('button', { type: 'button', class: 'link more-text', onclick: (e) => {
      const on = body.classList.toggle('clamp');
      e.currentTarget.textContent = on ? 'Mostrar mais' : 'Mostrar menos';
    } }, 'Mostrar mais'));
  }
  const myLang = (navigator.language || 'pt').slice(0, 2);
  if (!readonly && !host && limits.translation && sh.language && sh.language !== myLang && sh.content) {
    parts.push(tr
      ? h('div', { class: 'tr-note muted small' }, `Traduzido de ${tr.lang ? tr.lang.toUpperCase() : sh.language.toUpperCase()}${tr.provider ? ` por ${tr.provider}` : ''} · `,
        h('button', { type: 'button', class: 'link', onclick: () => { tr.shown = !tr.shown; replaceStatus(sh); } }, tr.shown ? 'Ver original' : 'Ver tradução'))
      : h('button', { type: 'button', class: 'link tr-btn', onclick: (e) => translateStatus(sh, e.currentTarget) }, `Traduzir do ${sh.language.toUpperCase()}`));
  }
  const media = mediaEl(sh);
  if (media) parts.push(media);
  if (sh.poll) parts.push(pollEl(sh, { readonly: readonly || !!host }));
  else if (!media && sh.card && !sh.quote) { const cd = cardEl(sh.card); if (cd) parts.push(cd); }
  if (sh.quote && !readonly) { const qe = quoteEl(sh.quote, host); if (qe) parts.push(qe); }

  if (sh.spoiler_text) {
    const summary = h('summary', {}, emojiFragment(sh.spoiler_text, sh.emojis));
    el.append(h('details', { class: 'cw', open: prefs.openCw || null }, summary, ...parts));
  } else {
    el.append(...parts);
  }

  const canBoost = sh.visibility === 'public' || sh.visibility === 'unlisted';
  const boostBtn = actionButton('boost', 'boost', sh.reblogs_count, sh.reblogged, (e) => (sh.reblogged ? toggle(e.currentTarget, sh, 'boost') : boostSheet(e.currentTarget, sh)), 'Impulsionar');
  if (!canBoost) boostBtn.disabled = true;
  const favBtn = actionButton('fav', 'fav', sh.favourites_count, sh.favourited, (e) => toggle(e.currentTarget, sh, 'fav'), 'Favoritar');
  const replyBtn = actionButton('reply', 'reply', sh.replies_count, false, () => openComposer({ replyTo: sh }), 'Responder');
  const open = h('a', { class: 'open', href: safeUrl(sh.url || sh.uri), target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Abrir original' }, svgIcon('external', 18));
  const markBtn = actionButton('bookmark', 'bookmark', 0, sh.bookmarked, (e) => toggleBookmark(e.currentTarget, sh), 'Salvar');
  const moreBtn = h('button', { type: 'button', class: 'more-btn', 'aria-label': 'Mais opções', onclick: () => statusMenu(sh) }, svgIcon('more', 20));
  el.append(h('div', { class: 'actions' }, ...(readonly ? [open] : [replyBtn, boostBtn, favBtn, markBtn, moreBtn])));
  return el;
}

const NOTIF_KINDS = {
  mention: 'mencionou você',
  status: 'publicou',
  reblog: 'impulsionou sua publicação',
  favourite: 'favoritou sua publicação',
  follow: 'seguiu você',
  follow_request: 'quer seguir você',
  poll: 'enquete encerrada',
  update: 'editou uma publicação',
  quote: 'citou sua publicação',
  quoted_update: 'editou uma publicação que você citou',
  'admin.sign_up': 'novo cadastro na instância',
  'admin.report': 'nova denúncia',
  severed_relationships: 'relações cortadas',
  moderation_warning: 'aviso de moderação',
};

const uniqAccounts = (ns) => { const seen = new Set(); return ns.map((n) => n.account).filter((x) => !seen.has(x.id) && seen.add(x.id)); };

// Junta favoritos/impulsos da mesma publicação (e seguidores seguidos na lista) numa só notificação
function groupNotifs(items) {
  const out = []; const byStatus = new Map();
  items.forEach((n) => {
    if ((n.type === 'reblog' || n.type === 'favourite') && n.status) {
      let g = byStatus.get(n.status.id);
      if (!g) { g = { group: true, status: n.status, by: {}, newest: n.created_at, ids: [] }; byStatus.set(n.status.id, g); out.push(g); }
      (g.by[n.type] = g.by[n.type] || []).push(n);
      g.ids.push(n.id);
    } else if (n.type === 'follow' && out.length && out[out.length - 1].follows) {
      out[out.length - 1].follows.push(n);
    } else if (n.type === 'follow') {
      out.push({ follows: [n] });
    } else out.push(n);
  });
  return out;
}

function namesNode(accs) {
  const shown = accs.slice(0, 2);
  const rest = accs.length - shown.length;
  const link = (a) => h('strong', { class: 'link-name', role: 'button', tabindex: '0', onclick: () => openProfile(a) }, nameNode(a));
  const nodes = [link(shown[0])];
  if (shown[1]) nodes.push(rest > 0 ? ', ' : ' e ', link(shown[1]));
  if (rest > 0) nodes.push(` e mais ${rest}`);
  return nodes;
}

const GROUP_VERBS = {
  reblog: ['impulsionou', 'impulsionaram', 'sua publicação'],
  favourite: ['favoritou', 'favoritaram', 'sua publicação'],
  follow: ['seguiu', 'seguiram', 'você'],
};

function avatarStack(accs) {
  const max = 6;
  return h('div', { class: 'notif-avatars' },
    ...accs.slice(0, max).map((a) => h('img', { class: 'avatar', src: safeUrl(a.avatar_static || a.avatar), alt: a.display_name || a.acct, loading: 'lazy', onclick: () => openProfile(a) })),
    accs.length > max ? h('span', { class: 'more-count' }, `+${accs.length - max}`) : null);
}

function notifLine(type, ns, when) {
  const accs = uniqAccounts(ns);
  const [one, many, obj] = GROUP_VERBS[type];
  return h('div', { class: 'notif-kind' }, ...namesNode(accs), ` ${accs.length > 1 ? many : one} ${obj}`, when ? ` · ${timeAgo(when)}` : '');
}

function notifGroupEl(g) {
  if (g.follows) {
    const accs = uniqAccounts(g.follows);
    if (accs.length === 1) return notifEl(g.follows[0]);
    return h('div', { class: 'notif group' }, avatarStack(accs), notifLine('follow', g.follows, g.follows[0].created_at));
  }
  const all = Object.values(g.by).flat();
  const wrap = h('div', { class: 'notif group' }, avatarStack(uniqAccounts(all)));
  let first = true;
  ['reblog', 'favourite'].forEach((t) => { if (g.by[t]) { wrap.append(notifLine(t, g.by[t], first ? g.newest : null)); first = false; } });
  wrap.append(statusEl(g.status));
  return wrap;
}

function notifItem(i) { return i.group || i.follows ? notifGroupEl(i) : notifEl(i); }

const NOTIF_TABS = [['all', 'Todos'], ['mentions', 'Menções'], ['dms', 'Mensagens']];

function setNotifTab(id) {
  state.notifTab = id;
  window.scrollTo(0, 0);
  render();
  const k = id === 'mentions' ? 'mentions' : id === 'dms' ? 'convs' : 'notifications';
  if (!state[k].items.length && !state[k].loading) loadList(k);
}

function notificationsView(view) {
  view.append(h('div', { class: 'seg-bar', role: 'tablist' }, ...NOTIF_TABS.map(([id, label]) =>
    h('button', { type: 'button', role: 'tab', class: `chip${state.notifTab === id ? ' active' : ''}`, 'aria-selected': state.notifTab === id ? 'true' : 'false', onclick: () => setNotifTab(id) }, label))));
  if (state.notifTab === 'mentions') renderList(view, 'mentions', notifEl);
  else if (state.notifTab === 'dms') renderList(view, 'convs', convEl);
  else renderList(view, 'notifications', notifItem, groupNotifs);
}

const plainText = (html) => { const d = new DOMParser().parseFromString(html || '', 'text/html').body; d.querySelectorAll('br').forEach((b) => b.replaceWith(' ')); return (d.textContent || '').replace(/\s+/g, ' ').trim(); };

function convEl(c) {
  const last = c.last_status;
  if (!last) return null;
  const accs = c.accounts && c.accounts.length ? c.accounts : [last.account];
  const row = h('div', { class: `conv${c.unread ? ' unread' : ''}`, role: 'button', tabindex: '0', onclick: async () => {
    if (c.unread) { c.unread = false; row.classList.remove('unread'); api(`/api/v1/conversations/${c.id}/read`, { method: 'POST' }).catch(() => {}); }
    openThread(last);
  } },
    avatarStack(accs),
    h('div', { class: 'conv-body' },
      h('div', { class: 'conv-top' }, h('strong', {}, accs.map((x) => x.display_name || x.acct).join(', ')), h('time', { class: 'muted small' }, timeAgo(last.created_at))),
      h('div', { class: 'conv-text muted' }, plainText(last.content) || (last.media_attachments && last.media_attachments.length ? '(mídia)' : ''))),
    c.unread ? h('span', { class: 'conv-dot', 'aria-label': 'Não lida' }) : null);
  return row;
}

function requestButtons(n, wrap) {
  const box = h('div', { class: 'req-actions' });
  const act = (verb, label, done, cls) => h('button', { type: 'button', class: cls, onclick: async () => {
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await api(`/api/v1/follow_requests/${n.account.id}/${verb}`, { method: 'POST' });
      box.replaceChildren(h('span', { class: 'muted' }, done));
    } catch (e) { toast(e.message); box.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
  } }, label);
  box.append(act('authorize', 'Aceitar', 'Pedido aceito', 'primary'), act('reject', 'Rejeitar', 'Pedido rejeitado', ''));
  return box;
}

function notifEl(n) {
  const wrap = h('div', { class: 'notif' });
  wrap.append(h('div', { class: 'notif-kind' },
    h('strong', { class: 'link-name', role: 'button', tabindex: '0', onclick: () => openProfile(n.account) }, nameNode(n.account)),
    ' ', NOTIF_KINDS[n.type] || n.type, ' · ', timeAgo(n.created_at)));
  if (n.status) wrap.append(statusEl(n.status));
  else wrap.append(accountRow(n.account));
  if (n.type === 'follow_request') wrap.append(requestButtons(n, wrap));
  return wrap;
}

function moreButton(kind) {
  const st = getList(kind);
  if (st.loading) return h('p', { class: 'empty' }, 'Carregando…');
  if (st.error) {
    return h('div', { class: 'empty' },
      h('p', { class: 'error' }, st.error),
      h('button', { type: 'button', onclick: () => loadList(kind, st.items.length > 0) }, 'Tentar de novo'));
  }
  if (!st.items.length) return h('p', { class: 'empty' }, 'Nada por aqui ainda.');
  if (!st.more) return h('p', { class: 'empty' }, 'Fim.');
  return h('button', { type: 'button', class: 'more', onclick: () => loadList(kind, true) }, 'Carregar mais');
}

/* ----- Conversas (threads) ----- */

function openThread(status, host = null) {
  state.profiles.push({
    type: 'thread', status, host, ancestors: [], descendants: [],
    loading: false, loaded: false, error: null, returnScroll: window.scrollY,
  });
  window.scrollTo(0, 0);
  render();
  loadThread(topEntry());
}

async function loadThread(t) {
  if (!t || t.loading) return;
  t.loading = true;
  t.error = null;
  busy(+1);
  render();
  try {
    const opts = { host: t.host, auth: !t.host };
    const [ctx, fresh] = await Promise.all([
      api(`/api/v1/statuses/${t.status.id}/context`, opts),
      api(`/api/v1/statuses/${t.status.id}`, opts).catch(() => null),
    ]);
    if (fresh) t.status = fresh.reblog || fresh;
    t.ancestors = ctx.ancestors || [];
    t.descendants = ctx.descendants || [];
    t.loaded = true;
  } catch (e) {
    t.error = e.status === 404 ? 'Esta publicação não está mais disponível.' : e.message;
  } finally {
    t.loading = false;
    busy(-1);
    if (session && state.profiles.includes(t)) {
      render();
      if (t.loaded && !t.scrolled) {
        t.scrolled = true;
        const f = document.querySelector('.thread-item.focal');
        if (f && t.ancestors.length) f.scrollIntoView({ block: 'start' });
      }
    }
  }
}

function threadView(view, t) {
  view.append(profileBar('Conversa', closeProfile));
  const opts = { readonly: !!t.host, host: t.host };
  const item = (cls, s, depth = 0) => {
    const el = statusEl(s, opts);
    const box = h('div', { class: `thread-item ${cls}`, style: `--d:${Math.min(depth, 5)}` }, el);
    if (cls === 'focal') {
      el.classList.add('focal');
      el.insertBefore(h('p', { class: 'muted small focal-date' }, new Date(s.created_at).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })), el.querySelector('.actions'));
    }
    return box;
  };
  t.ancestors.forEach((s) => view.append(item('ancestor', s)));
  view.append(item('focal', t.status));
  // A API não garante a ordem em árvore: monta a árvore pelas respostas (in_reply_to_id) e percorre em profundidade.
  const kids = new Map();
  const ids = new Set(t.descendants.map((s) => s.id));
  ids.add(t.status.id);
  t.descendants.forEach((s) => {
    const parent = ids.has(s.in_reply_to_id) ? s.in_reply_to_id : t.status.id; // órfãs ficam ligadas à publicação em foco
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(s);
  });
  const byDate = (x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0);
  kids.forEach((list) => list.sort(byDate));
  const walk = (id, d) => (kids.get(id) || []).forEach((s) => { view.append(item('reply', s, d)); walk(s.id, d + 1); });
  walk(t.status.id, 1);
  if (t.loading) view.append(h('p', { class: 'empty' }, 'Carregando conversa…'));
  else if (t.error) {
    view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, t.error),
      h('button', { type: 'button', onclick: () => loadThread(t) }, 'Tentar de novo')));
  } else if (t.loaded && !t.descendants.length) {
    view.append(h('p', { class: 'empty' }, t.ancestors.length ? 'Sem respostas ainda.' : 'Ninguém respondeu ainda.'));
  }
}

/* ---------- Cache local (abrir offline e voltar de onde parou) ---------- */

const CACHE_KINDS = ['home', 'notifications'];
const CACHE_MAX = 40;
const cacheKey = (kind) => `cache.${session.host}.${session.account.id}.${kind}`;

// mensagens diretas nunca ficam guardadas no aparelho (nem no cache de avisos)
const isDirect = (it) => ((it.status || it).visibility === 'direct') || (it.reblog && it.reblog.visibility === 'direct');
const cacheable = (items) => items.filter((it) => !isDirect(it)).slice(0, CACHE_MAX);

function saveCache(kind) {
  if (!session || !CACHE_KINDS.includes(kind)) return;
  const st = state[kind];
  if (st.cached) return; // ainda mostrando o que veio do cache: não regrava por cima
  store.set(cacheKey(kind), { at: Date.now(), items: cacheable(st.items) });
}

function hydrateFromCache(kind) {
  const st = state[kind];
  if (st.items.length) return false;
  const c = store.get(cacheKey(kind));
  if (!c || !Array.isArray(c.items) || !c.items.length) return false;
  st.items = c.items;
  st.more = true;
  st.cached = true;
  st.cachedAt = c.at;
  return true;
}

function clearCaches(s) {
  const pre = s ? [`pq.cache.${s.host}.${s.account.id}.`, `pq.scroll.${s.host}.${s.account.id}.`, `pq.mark.${s.host}.${s.account.id}`, `pq.draft.${s.host}.${s.account.id}`] : ['pq.cache.', 'pq.scroll.', 'pq.mark.', 'pq.draft.'];
  try {
    Object.keys(localStorage).filter((k) => pre.some((p) => k.startsWith(p))).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignora */ }
}

/* ----- Marcador do Início, sincronizado entre aparelhos (/api/v1/markers) ----- */
const markKey = () => `mark.${session.host}.${session.account.id}`;
function topVisibleItemId() {
  for (const el of document.querySelectorAll('#view .status[data-id]')) {
    if (el.getBoundingClientRect().bottom > 70) {
      const it = state.home.items.find((x) => (x.reblog || x).id === el.dataset.id);
      return it ? it.id : null;
    }
  }
  return null;
}
function saveHomeMarker() {
  if (!session || state.tab !== 'home' || state.homeList || state.profiles.length || window.scrollY < 40) return;
  const id = topVisibleItemId();
  if (!id || store.get(markKey()) === id) return;
  store.set(markKey(), id);
  api('/api/v1/markers', { method: 'POST', body: { home: { last_read_id: id } } }).catch(() => {});
}
let markTimer = null;
function scheduleMarker() { clearTimeout(markTimer); markTimer = setTimeout(saveHomeMarker, 2000); }
async function checkHomeMarker() {
  const pill = $('#mark-pill');
  pill.hidden = true;
  if (!session || state.homeList) return;
  try {
    const m = await api('/api/v1/markers', { params: { 'timeline[]': ['home'] } });
    const remote = m && m.home && m.home.last_read_id;
    if (!remote || remote === store.get(markKey())) return;
    const idx = state.home.items.findIndex((x) => x.id === remote);
    if (idx < 1) return;
    pill.textContent = 'Continuar de onde parou';
    pill.hidden = false;
    pill.onclick = () => {
      pill.hidden = true;
      store.set(markKey(), remote);
      const el = document.querySelector(`#view .status[data-id="${(state.home.items[idx].reblog || state.home.items[idx]).id}"]`);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
    };
  } catch { /* instância sem marcadores */ }
}

let focusedStatus = null;
function shortcutKey(e) {
  if (!session || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && t.matches && t.matches('input, textarea, select, [contenteditable]')) return;
  if ($('#composer').open || $('#sheet').open || $('#viewer').open) return;
  const list = [...document.querySelectorAll('#view .status[data-id]')];
  if (!list.length) return;
  const move = (d) => {
    let i = focusedStatus ? list.indexOf(focusedStatus) : -1;
    if (i < 0) i = Math.max(0, list.findIndex((el) => el.getBoundingClientRect().bottom > 70));
    else i = Math.max(0, Math.min(list.length - 1, i + d));
    focusedStatus = list[i];
    list.forEach((el) => el.classList.toggle('kbd', el === focusedStatus));
    window.scrollTo({ top: focusedStatus.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  };
  const act = (sel) => { if (focusedStatus) { const b = focusedStatus.querySelector(sel); if (b && !b.disabled) b.click(); } };
  if (e.key === 'j') move(1);
  else if (e.key === 'k') move(-1);
  else if (e.key === 'r') { e.preventDefault(); act('.actions .reply'); }
  else if (e.key === 'f') act('.actions .fav');
  else if (e.key === 'b') act('.actions .boost');
  else if (e.key === 'Enter' && focusedStatus && !(t && t.matches && t.matches('a, button, [role="button"]'))) focusedStatus.click();
  else return;
  if (e.key !== 'Enter') e.preventDefault();
}

function saveScroll() {
  saveHomeMarker();
  if (!session || state.profiles.length) return;
  const kind = state.tab === 'home' && !state.homeList ? 'home' : state.tab === 'notifications' ? 'notifications' : null;
  if (kind) store.set(scrollKey(kind), Math.round(window.scrollY));
}

// Traz publicações novas por cima do que está guardado, sem mexer onde o usuário está lendo
async function refreshWithCache(kind) {
  const st = state[kind];
  const spec = listSpec(kind);
  const y0 = window.scrollY;
  const h0 = document.documentElement.scrollHeight;
  st.loading = true; st.error = null;
  render();
  try {
    const data = await api(spec.path, { params: { limit: 30 } });
    const have = new Set(st.items.map((s) => s.id));
    const overlaps = data.some((s) => have.has(s.id));
    if (overlaps || !st.items.length) {
      const fresh = data.filter((s) => !have.has(s.id));
      st.items = fresh.concat(st.items);
    } else {
      st.items = data; // muito tempo fora: lacuna entre o guardado e o novo, recomeça do topo
      st.cleanSlate = true;
    }
    st.cached = false;
    store.set(cacheKey(kind), { at: Date.now(), items: cacheable(st.items) });
    if (kind === 'notifications' && state.tab === 'notifications') markNotificationsRead();
  } catch (e) {
    st.error = e.message; // segue mostrando o que está guardado
  } finally {
    st.loading = false;
    if (session && kind === 'home') setTimeout(checkHomeMarker, 300);
    if (session) {
      render();
      if (st.cleanSlate) { st.cleanSlate = false; window.scrollTo(0, 0); }
      else window.scrollTo(0, y0 + (document.documentElement.scrollHeight - h0)); // mantém o ponto de leitura
    }
  }
}

/* ---------- Visualizador de mídia (tela cheia) ---------- */

function openViewer(items, start = 0) {
  const d = $('#viewer');
  let cur = start;
  const slides = [];
  const track = h('div', { class: 'v-track' });
  const counter = h('span', { class: 'v-counter' });
  const alt = h('div', { class: 'v-alt', hidden: true });
  const bottom = h('div', { class: 'v-bottom' });
  const altBtn = h('button', { type: 'button', class: 'v-alt-btn', onclick: () => { alt.hidden = !alt.hidden; bottom.classList.toggle('open', !alt.hidden); altBtn.setAttribute('aria-pressed', String(!alt.hidden)); } }, 'ALT');
  const openLink = h('a', { class: 'icon-btn v-open', target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Abrir original' }, svgIcon('external', 22));
  const close = () => d.close();

  const apply = (s) => { s.img.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.s})`; };
  const bound = (s) => {
    const w = s.img.clientWidth, hh = s.img.clientHeight;
    const mx = Math.max(0, (w * s.s - slides[0].el.clientWidth) / 2), my = Math.max(0, (hh * s.s - slides[0].el.clientHeight) / 2);
    s.x = Math.min(mx, Math.max(-mx, s.x)); s.y = Math.min(my, Math.max(-my, s.y));
  };
  const setZoom = (s, v) => { s.s = v; if (v === 1) { s.x = 0; s.y = 0; } bound(s); apply(s); track.classList.toggle('zoomed', s.s > 1); };

  items.forEach((it) => {
    const img = h('img', { src: it.full, alt: it.alt || '', draggable: 'false' });
    const el = h('div', { class: 'v-slide' }, img);
    const s = { el, img, s: 1, x: 0, y: 0 };
    slides.push(s);
    track.append(el);
    let mode = null, p0 = null, d0 = 0, s0 = 1, lastTap = 0, dy = 0;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) { mode = 'pinch'; d0 = dist(e.touches); s0 = s.s; return; }
      const t = e.touches[0];
      p0 = { x: t.clientX, y: t.clientY, ox: s.x, oy: s.y };
      mode = s.s > 1 ? 'pan' : null;
      const now = Date.now();
      if (now - lastTap < 300) { setZoom(s, s.s > 1 ? 1 : 2.5); mode = 'done'; e.preventDefault(); }
      lastTap = now;
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      if (mode === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        setZoom(s, Math.min(5, Math.max(1, s0 * dist(e.touches) / d0)));
        return;
      }
      if (!p0 || mode === 'done') return;
      const t = e.touches[0];
      const dx = t.clientX - p0.x; dy = t.clientY - p0.y;
      if (mode === 'pan') { e.preventDefault(); s.x = p0.ox + dx; s.y = p0.oy + dy; bound(s); apply(s); return; }
      if (mode === null && Math.abs(dy) > Math.abs(dx) + 6 && dy > 0) mode = 'dismiss';
      if (mode === 'dismiss') {
        e.preventDefault();
        el.style.transform = `translateY(${Math.max(0, dy)}px)`;
        d.style.setProperty('--v-fade', String(Math.max(0.2, 1 - dy / 500)));
      }
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      if (mode === 'dismiss') {
        if (dy > 110) close();
        el.style.transform = ''; d.style.removeProperty('--v-fade');
      } else if (mode === 'pinch' && s.s < 1.05) setZoom(s, 1);
      if (e.touches.length === 0) { mode = null; p0 = null; dy = 0; }
    });
    el.addEventListener('dblclick', () => setZoom(s, s.s > 1 ? 1 : 2.5)); // mouse
  });

  const show = (i) => {
    cur = Math.max(0, Math.min(items.length - 1, i));
    counter.textContent = items.length > 1 ? `${cur + 1}/${items.length}` : '';
    const it = items[cur];
    openLink.href = safeUrl(it.full);
    altBtn.hidden = !it.alt;
    alt.hidden = true; bottom.classList.remove('open'); altBtn.setAttribute('aria-pressed', 'false');
    alt.textContent = it.alt || '';
  };
  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if (i !== cur) { slides.forEach((s) => { if (s.s !== 1) { s.s = 1; s.x = 0; s.y = 0; apply(s); } }); track.classList.remove('zoomed'); show(i); }
    });
  });
  const go = (n) => track.scrollTo({ left: n * track.clientWidth, behavior: 'smooth' });
  d.replaceChildren(
    track,
    h('div', { class: 'v-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, svgIcon('close', 24)), counter, openLink),
    items.length > 1 ? h('button', { type: 'button', class: 'v-nav prev', 'aria-label': 'Anterior', onclick: () => go(cur - 1) }, svgIcon('back', 26)) : null,
    items.length > 1 ? h('button', { type: 'button', class: 'v-nav next', 'aria-label': 'Próxima', onclick: () => go(cur + 1) }, svgIcon('back', 26)) : null,
    (bottom.append(altBtn, alt), bottom));
  d.showModal();
  track.scrollLeft = start * track.clientWidth;
  show(start);
}

/* ---------- Enquetes ---------- */

function fmtRemaining(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'encerrada';
  const m = Math.round(ms / 60000);
  if (m < 60) return `encerra em ${Math.max(1, m)} min`;
  const hr = Math.round(m / 60);
  if (hr < 48) return `encerra em ${hr} h`;
  return `encerra em ${Math.round(hr / 24)} dias`;
}

function pollEl(sh, { readonly = false } = {}) {
  const p = sh.poll;
  const box = h('div', { class: 'poll' });
  const hasCounts = p.options.every((o) => o.votes_count != null);
  const showBars = hasCounts && (readonly || p.voted || p.expired || p.options.some((o) => o.votes_count > 0) || sh.account.id === session.account.id);
  const canVote = !readonly && !p.voted && !p.expired && sh.account.id !== session.account.id;
  const base = (p.multiple ? p.voters_count : p.votes_count) || p.votes_count || 0;
  const picked = new Set();
  const rebuild = () => box.replaceWith(pollEl(sh, { readonly }));
  const mine = new Set(p.own_votes || []);

  if (canVote) {
    const voteBtn = h('button', { type: 'button', class: 'primary', disabled: true }, 'Votar');
    p.options.forEach((o, i) => {
      const b = h('button', { type: 'button', class: 'poll-choice', role: p.multiple ? 'checkbox' : 'radio', 'aria-checked': 'false' },
        h('span', { class: `pick-box${p.multiple ? '' : ' round'}` }), emojiFragment(o.title, p.emojis));
      b.addEventListener('click', () => {
        if (p.multiple) { if (picked.has(i)) picked.delete(i); else picked.add(i); }
        else { picked.clear(); picked.add(i); }
        box.querySelectorAll('.poll-choice').forEach((x, j) => {
          const on = picked.has(j);
          x.classList.toggle('on', on);
          x.setAttribute('aria-checked', on ? 'true' : 'false');
          x.querySelector('.pick-box').replaceChildren(...(on ? [svgIcon('check', 14)] : []));
        });
        voteBtn.disabled = picked.size === 0;
      });
      box.append(b);
    });
    voteBtn.addEventListener('click', async () => {
      voteBtn.disabled = true;
      try {
        sh.poll = await api(`/api/v1/polls/${p.id}/votes`, { method: 'POST', body: { choices: [...picked] } });
        rebuild();
      } catch (e) { toast(e.message); voteBtn.disabled = false; }
    });
    box.append(voteBtn);
  } else {
    p.options.forEach((o, i) => {
      const pct = showBars && base ? Math.round((o.votes_count / base) * 100) : 0;
      box.append(h('div', { class: `poll-row${mine.has(i) ? ' mine' : ''}` },
        showBars ? h('span', { class: 'poll-bar', style: `width:${pct}%` }) : null,
        h('span', { class: 'poll-label' }, mine.has(i) ? svgIcon('check', 14) : null, emojiFragment(o.title, p.emojis)),
        showBars ? h('span', { class: 'poll-pct' }, `${pct}%`) : null));
    });
  }
  const votes = p.voters_count != null ? p.voters_count : p.votes_count;
  const meta = [`${votes == null ? '?' : votes} ${votes === 1 ? 'voto' : 'votos'}`, p.expired ? 'encerrada' : fmtRemaining(p.expires_at)];
  const foot = h('div', { class: 'poll-foot muted small' }, meta.join(' · '));
  if (!readonly && !p.expired) {
    foot.append(' · ', h('button', { type: 'button', class: 'link', onclick: async () => {
      try { sh.poll = await api(`/api/v1/polls/${p.id}`); rebuild(); } catch (e) { toast(e.message); }
    } }, 'Atualizar'));
  }
  box.append(foot);
  return box;
}

/* ---------- Avisos não lidos (sino) ---------- */

const bellSlot = () => document.querySelector('#tabs button[data-tab="notifications"] [data-icon]');
let ringing = false;

// Um ciclo do sino tocando e volta ao ícone normal (o pontinho de "não lido" fica na aba)
function ringBell() {
  const slot = bellSlot();
  if (!slot || ringing) return;
  ringing = true;
  const ring = svgIcon('notifications-ring', Number(slot.dataset.size) || 24);
  ring.classList.add('ring');
  slot.replaceChildren(ring);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true; ringing = false;
    slot.replaceChildren(svgIcon('notifications', Number(slot.dataset.size) || 24));
  };
  ring.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 1800); // sem animação (reduzir movimento) o ícone também volta
}

function setUnread(on) {
  const btn = document.querySelector('#tabs button[data-tab="notifications"]');
  if (btn) {
    btn.classList.toggle('unread', on);
    btn.setAttribute('aria-label', on ? 'Avisos, há não lidos' : 'Avisos');
  }
}

const idGt = (a, b) => { try { return BigInt(a) > BigInt(b); } catch { return String(a) > String(b); } };

async function checkUnread() {
  if (!session || state.tab === 'notifications') return;
  try {
    const [m, latest] = await Promise.all([
      api('/api/v1/markers', { params: { 'timeline[]': ['notifications'] } }).catch(() => ({})),
      api('/api/v1/notifications', { params: { limit: 1 } }),
    ]);
    const newest = latest[0] && latest[0].id;
    if (!newest) { setUnread(false); return; }
    const marker = m && m.notifications && m.notifications.last_read_id;
    const local = store.get(seenKey());
    if (!marker && !local) { store.set(seenKey(), newest); setUnread(false); return; } // primeira vez: não toca por avisos antigos
    const seen = [marker, local].filter(Boolean).reduce((x, y) => (idGt(x, y) ? x : y));
    const unread = idGt(newest, seen);
    setUnread(unread);
    if (unread && state.tab !== 'notifications') ringBell();
  } catch { /* sem rede: mantém como está */ }
}

function markNotificationsRead() {
  const newest = state.notifications.items[0] && state.notifications.items[0].id;
  setUnread(false);
  if (!newest) return;
  store.set(seenKey(), newest);
  api('/api/v1/markers', { method: 'POST', body: { notifications: { last_read_id: newest } } }).catch(() => {});
}

/* ---------- Preferências ---------- */

const PREF_DEFAULTS = { live: true, theme: 'auto', textSize: 100, motion: 'auto', showSensitive: false, openCw: false, defaultVis: '' };
let prefs = { ...PREF_DEFAULTS, ...store.get('prefs', {}) };

function applyPrefs() {
  const root = document.documentElement;
  if (prefs.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = prefs.theme;
  if (prefs.motion === 'reduce') root.dataset.motion = 'reduce'; else root.removeAttribute('data-motion');
  root.style.setProperty('--text-adjust', `${prefs.textSize}%`);
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && !(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0b0a10' : '#f4f1fa';
}

function setPref(key, value) {
  prefs[key] = value;
  store.set('prefs', prefs);
  applyPrefs();
  if (key === 'live') { if (value) liveConnect(); else liveClose(); }
  render();
}

function prefChoice(label, key, options) {
  return h('div', { class: 'pref-group', role: 'group', 'aria-label': label },
    h('span', { class: 'muted small' }, label),
    h('div', { class: 'seg-row' }, ...options.map(([v, text]) =>
      h('button', { type: 'button', class: `chip${prefs[key] === v ? ' active' : ''}`, 'aria-pressed': prefs[key] === v ? 'true' : 'false', onclick: () => setPref(key, v) }, text))));
}

function prefSwitch(label, key) {
  const on = !!prefs[key];
  return h('button', { type: 'button', class: `pick-row${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: () => setPref(key, !on) },
    h('span', { class: 'pick-box' }, on ? svgIcon('check', 16) : null), label);
}

function prefsSection() {
  return h('div', { class: 'account-card' },
    h('strong', {}, 'Aparência e comportamento'),
    prefChoice('Tema', 'theme', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']]),
    prefChoice('Tamanho do texto', 'textSize', [[100, 'Padrão'], [112, 'Grande'], [125, 'Maior'], [140, 'Máximo']]),
    prefChoice('Animações', 'motion', [['auto', 'Padrão do sistema'], ['reduce', 'Reduzir']]),
    prefChoice('Visibilidade ao publicar', 'defaultVis', [['', 'Lembrar a última'], ['public', 'Pública'], ['unlisted', 'Não listada'], ['private', 'Só seguidores']]),
    prefSwitch('Mostrar mídia sensível sem desfocar', 'showSensitive'),
    prefSwitch('Abrir avisos de conteúdo já expandidos', 'openCw'),
    prefSwitch('Receber publicações e avisos em tempo real', 'live'));
}

/* ---------- Tempo real (streaming) ---------- */

const live = { ws: null, timer: null, tries: 0, gen: 0, base: '', query: false, wasHidden: false };

function liveClose() {
  live.gen++;
  clearTimeout(live.timer);
  if (live.ws) { try { live.ws.close(); } catch { /* ignora */ } live.ws = null; }
}

function liveRetry(gen) {
  if (gen !== live.gen) return;
  clearTimeout(live.timer);
  const wait = Math.min(30000, 1000 * 2 ** Math.min(live.tries, 5));
  live.tries++;
  live.timer = setTimeout(liveConnect, wait);
}

function liveConnect() {
  if (!session || !prefs.live || live.ws || document.visibilityState === 'hidden' || typeof WebSocket === 'undefined') return;
  clearTimeout(live.timer);
  const gen = ++live.gen;
  const base = (live.base || `wss://${session.host}`).replace(/^http/, 'ws').replace(/\/$/, '');
  const tok = session.token;
  let ws; let opened = false;
  try {
    // o token vai no subprotocolo (fora da URL); se a instância recusar, tenta pelo parâmetro
    ws = live.query ? new WebSocket(`${base}/api/v1/streaming?stream=user&access_token=${encodeURIComponent(tok)}`) : new WebSocket(`${base}/api/v1/streaming?stream=user`, tok);
  } catch { liveRetry(gen); return; }
  live.ws = ws;
  ws.onopen = () => { if (gen !== live.gen) return; opened = true; live.tries = 0; if (live.wasHidden) { live.wasHidden = false; liveCatchUp(); } };
  ws.onmessage = (ev) => { if (gen === live.gen) liveMessage(ev.data); };
  ws.onclose = () => {
    if (gen !== live.gen) return;
    live.ws = null;
    if (!opened && !live.query) live.query = true; // próxima tentativa pelo parâmetro
    liveRetry(gen);
  };
  ws.onerror = () => { /* o onclose cuida da nova tentativa */ };
}

function liveMessage(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  const data = () => { try { return JSON.parse(m.payload); } catch { return null; } };
  if (m.event === 'update') { const s = data(); if (s) liveHome(s); }
  else if (m.event === 'status.update') { const s = data(); if (s) replaceStatus(s); }
  else if (m.event === 'delete') { removeStatus(String(m.payload)); }
  else if (m.event === 'notification') { const n = data(); if (n) liveNotification(n); }
}

const atTop = () => window.scrollY < 80 && !$('#composer').open;

function liveHome(s) {
  const st = state.home;
  if (!st.items.length && !st.loaded) return; // ainda nem carregou: o carregamento já traz
  if (st.items.some((x) => x.id === s.id) || state.newPosts.some((x) => x.id === s.id)) return;
  const viewing = state.tab === 'home' && !state.homeList && state.profiles.length === 0;
  if (viewing && atTop()) { st.items.unshift(s); render(); return; }
  state.newPosts.unshift(s);
  updatePill();
}

function liveNotification(n) {
  const L = state.notifications;
  const viewing = state.tab === 'notifications' && state.profiles.length === 0;
  if (!L.items.some((x) => x.id === n.id) && (L.items.length || L.loaded)) { L.items.unshift(n); L.cached = false; }
  if (viewing) { render(); markNotificationsRead(); } else { setUnread(true); ringBell(); }
}

// Ao voltar para o app: busca o que chegou enquanto a conexão esteve fechada
async function liveCatchUp() {
  const top = state.home.items[0];
  if (!top) return;
  try {
    const fresh = await api('/api/v1/timelines/home', { params: { since_id: top.id, limit: 40 } });
    fresh.reverse().forEach((s) => { if (!state.home.items.some((x) => x.id === s.id) && !state.newPosts.some((x) => x.id === s.id)) state.newPosts.unshift(s); });
    updatePill();
  } catch { /* sem rede: segue */ }
}

function updatePill() {
  const pill = $('#new-pill');
  if (!pill) return;
  state.newPosts = state.newPosts.filter((p) => !state.home.items.some((x) => x.id === p.id));
  const n = state.newPosts.length;
  const show = n > 0 && !!session && state.tab === 'home' && !state.homeList && state.profiles.length === 0 && !$('#app').hidden;
  pill.hidden = !show;
  if (show) $('#new-pill-text').textContent = n === 1 ? '1 nova publicação' : `${n} novas publicações`;
}

function showNewPosts() {
  state.home.items = state.newPosts.concat(state.home.items);
  state.newPosts = [];
  window.scrollTo(0, 0);
  render();
}

/* ---------- Avisos no aparelho (Web Push) ---------- */

const PUSH_ALERTS = [
  ['mention', 'Menções e respostas'],
  ['follow', 'Novos seguidores'],
  ['reblog', 'Impulsos'],
  ['favourite', 'Favoritos'],
  ['status', 'Publicações de contas com o sininho'],
];
const pushState = { loading: false, supported: false, standalone: false, sub: null, error: null, loaded: false };

const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(s) {
  const bin = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function loadPush() {
  const ps = pushState;
  ps.supported = pushSupported();
  ps.standalone = isStandalone();
  ps.error = null;
  if (!ps.supported) { ps.loaded = true; return; }
  ps.loading = true;
  try {
    ps.sub = await api('/api/v1/push/subscription');
  } catch (e) {
    ps.sub = null;
    if (e.status !== 404) ps.error = e.message;
  } finally {
    ps.loading = false; ps.loaded = true;
    if (session) render();
  }
}

async function enablePush() {
  const ps = pushState;
  ps.error = null;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Permissão negada. Libere as notificações do Paquiderme nos Ajustes do iPhone.');
    const inst = await api('/api/v2/instance');
    const key = inst && inst.configuration && inst.configuration.vapid && inst.configuration.vapid.public_key;
    if (!key) throw new Error('Esta instância não oferece notificações push.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    ps.sub = await api('/api/v1/push/subscription', { method: 'POST', body: {
      subscription: { endpoint: sub.endpoint, keys: { p256dh: b64url(sub.getKey('p256dh')), auth: b64url(sub.getKey('auth')) } },
      data: { alerts: { mention: true, follow: true, follow_request: true, reblog: false, favourite: false, status: false, poll: false, update: false }, policy: 'all' },
    } });
    toast('Avisos ativados');
  } catch (e) { ps.error = e.message; }
  if (session) render();
}

async function disablePush() {
  const ps = pushState;
  try {
    await api('/api/v1/push/subscription', { method: 'DELETE' });
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    ps.sub = null;
    toast('Avisos desativados');
  } catch (e) { ps.error = e.message; }
  if (session) render();
}

async function setPushAlert(key, on) {
  const ps = pushState;
  const alerts = { ...ps.sub.alerts, [key]: on };
  if (key === 'follow') alerts.follow_request = on;
  try {
    ps.sub = await api('/api/v1/push/subscription', { method: 'PUT', body: { data: { alerts } } });
  } catch (e) { toast(e.message); }
  render();
}

function pushSection() {
  const ps = pushState;
  const box = h('div', { class: 'account-card' }, h('strong', {}, 'Avisos no aparelho'));
  if (!ps.loaded || ps.loading) { box.append(h('p', { class: 'muted small' }, 'Verificando…')); return box; }
  if (!ps.supported) {
    box.append(h('p', { class: 'muted small' }, 'Este navegador não oferece avisos push. No iPhone, adicione o Paquiderme à Tela de Início (iOS 16.4 ou mais novo) e abra por lá.'));
    return box;
  }
  if (/iPhone|iPad/.test(navigator.userAgent) && !ps.standalone) {
    box.append(h('p', { class: 'muted small' }, 'No iPhone os avisos só funcionam no app instalado: toque em Compartilhar › Adicionar à Tela de Início e abra por lá.'));
    return box;
  }
  if (ps.sub) {
    PUSH_ALERTS.forEach(([k, label]) => {
      const on = !!(ps.sub.alerts && ps.sub.alerts[k]);
      box.append(h('button', { type: 'button', class: `pick-row${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: () => setPushAlert(k, !on) },
        h('span', { class: 'pick-box' }, on ? svgIcon('check', 16) : null), label));
    });
    box.append(h('button', { type: 'button', onclick: disablePush }, 'Desativar avisos'));
  } else {
    box.append(h('p', { class: 'muted small' }, 'Receba menções e novos seguidores mesmo com o app fechado. A instância envia direto ao seu aparelho; o Paquiderme não tem servidor.'));
    box.append(h('button', { type: 'button', class: 'primary', onclick: enablePush }, 'Ativar avisos'));
  }
  if (ps.error) box.append(h('p', { class: 'error' }, ps.error));
  return box;
}

/* ----- Listas ----- */

async function loadLists(quiet = false) {
  const L = state.lists;
  if (L.loading) return;
  L.loading = true;
  L.error = null;
  if (!quiet) busy(+1);
  try {
    L.items = await api('/api/v1/lists');
    L.loaded = true;
    if (state.homeList && !L.items.some((l) => l.id === state.homeList)) { state.homeList = null; }
  } catch (e) {
    L.error = quiet ? null : e.message; // se a instância não tiver listas, o Início segue funcionando
  } finally {
    L.loading = false;
    if (!quiet) busy(-1);
    if (session) render();
  }
}

/* ----- Aviso rápido de problema no topo do Início ----- */
const alarm = { text: '', level: '', timer: null };
async function quickHealth() {
  if (!session) return;
  let text = '';
  if (!navigator.onLine) text = 'Sem conexão com a internet.';
  else {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(`https://${session.host}/api/v2/instance`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(to);
      if (r.status >= 500) text = `${session.host} está com problemas (erro ${r.status}).`;
      else {
        try { await api('/api/v1/accounts/verify_credentials'); } catch (e) { if ([401, 403].includes(e.status)) text = 'Sua sessão expirou. Entre de novo nesta conta.'; }
      }
    } catch { text = `Não foi possível falar com ${session.host}.`; }
  }
  if (text !== alarm.text) { alarm.text = text; if (session && state.tab === 'home' && !state.profiles.length) render(); }
}
function scheduleQuickHealth(ms = 1500) { clearTimeout(alarm.timer); alarm.timer = setTimeout(quickHealth, ms); }

function homeView(view) {
  const L = state.lists;
  if (alarm.text) view.append(h('div', { class: 'alarm', role: 'status' }, h('span', {}, alarm.text), h('button', { type: 'button', class: 'link', onclick: openHealth }, 'Ver status')));
  const chip = (id, label, extra) => h('button', {
    type: 'button', role: 'tab', class: `chip${(state.homeList || '') === id ? ' active' : ''}`,
    'aria-selected': (state.homeList || '') === id ? 'true' : 'false', onclick: () => setHomeList(id),
  }, label, extra);
  view.append(h('div', { class: 'seg-bar', role: 'tablist' },
    chip('', 'Início'),
    ...L.items.map((l) => chip(l.id, l.title)),
    h('button', { type: 'button', class: 'chip with-icon', 'aria-label': 'Gerenciar listas', onclick: openListsManage }, svgIcon('settings', 16), 'Listas')));
  renderList(view, state.homeList ? 'list' : 'home', (s) => statusEl(s));
}

function setHomeList(id) {
  state.homeList = id || null;
  state.listTl = mkList();
  window.scrollTo(0, 0);
  render();
  if (id) loadList('list');
  else if (!state.home.items.length) loadList('home');
}

function pushEntry(entry) {
  entry.returnScroll = window.scrollY;
  state.profiles.push(entry);
  window.scrollTo(0, 0);
  render();
  if (entry.reload) entry.reload();
}

function entryView(view, e) {
  if (e.type === 'thread') threadView(view, e);
  else if (e.type === 'lists') listsManageView(view, e);
  else if (e.type === 'members') membersView(view, e);
  else if (e.type === 'pick') listPickView(view, e);
  else if (e.type === 'accounts') accountsEntryView(view, e);
  else if (e.type === 'editprofile') editProfileView(view, e);
  else if (e.type === 'filters') filtersView(view, e);
  else if (e.type === 'scheduled') scheduledView(view, e);
  else if (e.type === 'health') healthView(view, e);
  else if (e.type === 'filteredit') filterEditView(view, e);
}

async function createList(title) {
  title = title.trim();
  if (!title) return;
  try {
    const l = await api('/api/v1/lists', { method: 'POST', body: { title } });
    state.lists.items.push(l);
    render();
  } catch (e) { toast(e.message); }
}

function createListForm() {
  const input = h('input', { placeholder: 'Nome da nova lista', maxlength: '100', 'aria-label': 'Nome da nova lista' });
  return h('form', { class: 'inst-form', onsubmit: async (ev) => { ev.preventDefault(); await createList(input.value); input.value = ''; } },
    input, h('button', { type: 'submit', class: 'primary' }, 'Criar'));
}

function openListsManage() {
  pushEntry({ type: 'lists', editing: null, confirm: null, reload: () => loadLists() });
}

function listsManageView(view, e) {
  view.append(profileBar('Listas', closeProfile));
  view.append(createListForm());
  const L = state.lists;
  if (L.error) view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, L.error), h('button', { type: 'button', onclick: () => loadLists() }, 'Tentar de novo')));
  else if (L.loading && !L.loaded) view.append(h('p', { class: 'empty' }, 'Carregando…'));
  else if (!L.items.length) view.append(h('p', { class: 'empty' }, 'Você ainda não tem listas. Crie uma acima e adicione contas que você segue.'));
  L.items.forEach((l) => view.append(listRow(l, e)));
}

function listRow(l, e) {
  if (e.editing === l.id) {
    const input = h('input', { value: l.title, maxlength: '100', 'aria-label': 'Novo nome da lista' });
    return h('form', { class: 'list-row', onsubmit: async (ev) => {
      ev.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      try {
        const u = await api(`/api/v1/lists/${l.id}`, { method: 'PUT', body: { title } });
        l.title = u.title;
        e.editing = null;
        render();
      } catch (err) { toast(err.message); }
    } },
    input,
    h('button', { type: 'submit', class: 'primary' }, 'Salvar'),
    h('button', { type: 'button', onclick: () => { e.editing = null; render(); } }, 'Cancelar'));
  }
  const confirming = e.confirm === l.id;
  return h('div', { class: 'list-row' },
    h('button', { type: 'button', class: 'list-title link', onclick: () => { state.profiles = []; setHomeList(l.id); } }, l.title),
    h('button', { type: 'button', onclick: () => openMembers(l) }, 'Membros'),
    h('button', { type: 'button', onclick: () => { e.editing = l.id; e.confirm = null; render(); } }, 'Renomear'),
    h('button', { type: 'button', class: confirming ? 'danger' : '', onclick: async () => {
      if (!confirming) { e.confirm = l.id; render(); setTimeout(() => { if (e.confirm === l.id) { e.confirm = null; if (topEntry() === e) render(); } }, 4000); return; }
      try {
        await api(`/api/v1/lists/${l.id}`, { method: 'DELETE' });
        state.lists.items = state.lists.items.filter((x) => x.id !== l.id);
        if (state.homeList === l.id) { state.homeList = null; state.listTl = mkList(); }
        e.confirm = null;
        render();
      } catch (err) { toast(err.message); }
    } }, confirming ? 'Confirmar' : 'Excluir'));
}

function openAccountsEntry(title, path, undoVerb, undoLabel) {
  const e = { type: 'accounts', title, path, undoVerb, undoLabel, items: [], next: null, more: false, loaded: false, loading: false, error: null };
  e.reload = () => loadAccountsEntry(e, false);
  pushEntry(e);
}

async function loadAccountsEntry(e, append) {
  if (e.loading) return;
  e.loading = true; e.error = null;
  if (!append) busy(+1);
  render();
  try {
    let headers = null;
    const params = { limit: 40 };
    if (append && e.next) params.max_id = e.next;
    const data = await api(e.path, { params, onHeaders: (hd) => { headers = hd; } });
    e.items = append ? e.items.concat(data) : data;
    e.next = parseNextMaxId(headers && headers.get('Link'));
    e.more = !!e.next;
    e.loaded = true;
  } catch (err) { e.error = err.message; } finally {
    e.loading = false;
    if (!append) busy(-1);
    if (session && state.profiles.includes(e)) render();
  }
}

function accountsEntryView(view, e) {
  view.append(profileBar(e.title, closeProfile));
  e.items.forEach((a) => view.append(personRow(a, e.undoLabel, async (btn) => {
    btn.disabled = true;
    try {
      await api(`/api/v1/accounts/${a.id}/${e.undoVerb}`, { method: 'POST' });
      e.items = e.items.filter((x) => x.id !== a.id);
      render();
    } catch (err) { toast(err.message); btn.disabled = false; }
  })));
  if (e.error) view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, e.error), h('button', { type: 'button', onclick: () => loadAccountsEntry(e, e.items.length > 0) }, 'Tentar de novo')));
  else if (e.loading) view.append(h('p', { class: 'empty' }, 'Carregando…'));
  else if (!e.items.length) view.append(h('p', { class: 'empty' }, 'Ninguém por aqui.'));
  else if (e.more) view.append(h('button', { type: 'button', class: 'more', onclick: () => loadAccountsEntry(e, true) }, 'Carregar mais'));
}

function openMembers(list) {
  const e = { type: 'members', list, items: [], loaded: false, loading: false, error: null, q: '', results: null };
  e.reload = () => loadMembers(e);
  pushEntry(e);
}

async function loadMembers(e) {
  if (e.loading) return;
  e.loading = true;
  e.error = null;
  busy(+1);
  render();
  try {
    e.items = await api(`/api/v1/lists/${e.list.id}/accounts`, { params: { limit: 0 } });
    e.loaded = true;
  } catch (err) {
    e.error = err.message;
  } finally {
    e.loading = false;
    busy(-1);
    if (session && state.profiles.includes(e)) render();
  }
}

function personRow(a, label, onclick, cls = '') {
  return h('div', { class: 'account-row', role: 'button', tabindex: '0', onclick: () => openProfile(a) },
    h('img', { class: 'avatar', src: safeUrl(a.avatar_static || a.avatar), alt: '', loading: 'lazy' }),
    h('div', { class: 'who' }, h('div', { class: 'name' }, nameNode(a)), h('span', { class: 'acct' }, '@' + a.acct)),
    h('button', { type: 'button', class: `row-btn ${cls}`, onclick: (ev) => { ev.stopPropagation(); onclick(ev.currentTarget); } }, label));
}

function membersView(view, e) {
  view.append(profileBar(e.list.title, closeProfile));
  const input = h('input', { placeholder: 'Buscar entre quem você segue', value: e.q, autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Buscar contas que você segue' });
  view.append(h('form', { class: 'inst-form', onsubmit: async (ev) => {
    ev.preventDefault();
    e.q = input.value.trim();
    if (!e.q) { e.results = null; render(); return; }
    try {
      e.results = await api('/api/v1/accounts/search', { params: { q: e.q, following: 'true', limit: 10 } });
    } catch (err) { toast(err.message); return; }
    render();
  } }, input, h('button', { type: 'submit', class: 'primary' }, 'Buscar')));

  const memberIds = new Set(e.items.map((m) => m.id));
  if (e.results) {
    view.append(h('h3', { class: 'section' }, 'Resultados'));
    if (!e.results.length) view.append(h('p', { class: 'empty' }, 'Ninguém encontrado entre quem você segue.'));
    e.results.forEach((a) => view.append(personRow(a, memberIds.has(a.id) ? 'Na lista' : 'Adicionar', async (btn) => {
      if (memberIds.has(a.id)) return;
      btn.disabled = true;
      try {
        await api(`/api/v1/lists/${e.list.id}/accounts`, { method: 'POST', body: { account_ids: [a.id] } });
        e.items.push(a);
        render();
      } catch (err) { toast(err.message); btn.disabled = false; }
    })));
  }
  view.append(h('h3', { class: 'section' }, `Membros${e.loaded ? ` (${e.items.length})` : ''}`));
  if (e.error) view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, e.error), h('button', { type: 'button', onclick: () => loadMembers(e) }, 'Tentar de novo')));
  else if (e.loading && !e.loaded) view.append(h('p', { class: 'empty' }, 'Carregando…'));
  else if (!e.items.length) view.append(h('p', { class: 'empty' }, 'Lista vazia. Busque acima uma conta que você segue.'));
  e.items.forEach((a) => view.append(personRow(a, 'Remover', async (btn) => {
    btn.disabled = true;
    try {
      await api(`/api/v1/lists/${e.list.id}/accounts`, { method: 'DELETE', body: { account_ids: [a.id] } });
      e.items = e.items.filter((x) => x.id !== a.id);
      render();
    } catch (err) { toast(err.message); btn.disabled = false; }
  })));
}

// Escolher em quais listas uma conta (que você segue) aparece
function openListPicker(account) {
  const e = { type: 'pick', account, member: new Set(), loaded: false, loading: false, error: null };
  e.reload = async () => {
    if (e.loading) return;
    e.loading = true; e.error = null; busy(+1); render();
    try {
      const [mine] = await Promise.all([
        api(`/api/v1/accounts/${account.id}/lists`),
        state.lists.loaded ? null : loadLists(true),
      ]);
      e.member = new Set(mine.map((l) => l.id));
      e.loaded = true;
    } catch (err) { e.error = err.message; } finally {
      e.loading = false; busy(-1);
      if (session && state.profiles.includes(e)) render();
    }
  };
  pushEntry(e);
}

function listPickView(view, e) {
  view.append(profileBar(`Listas de @${e.account.acct}`, closeProfile));
  view.append(createListForm());
  if (e.error) view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, e.error), h('button', { type: 'button', onclick: () => e.reload() }, 'Tentar de novo')));
  else if (!e.loaded) view.append(h('p', { class: 'empty' }, 'Carregando…'));
  else if (!state.lists.items.length) view.append(h('p', { class: 'empty' }, 'Crie uma lista acima para começar.'));
  if (!e.loaded) return;
  state.lists.items.forEach((l) => {
    const on = e.member.has(l.id);
    view.append(h('button', { type: 'button', class: `pick-row${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true;
      try {
        await api(`/api/v1/lists/${l.id}/accounts`, { method: on ? 'DELETE' : 'POST', body: { account_ids: [e.account.id] } });
        if (on) e.member.delete(l.id); else e.member.add(l.id);
        render();
      } catch (err) { toast(err.message); btn.disabled = false; }
    } }, h('span', { class: 'pick-box' }, on ? svgIcon('check', 16) : null), l.title));
  });
}

/* ----- Filtros ----- */

const FILTER_CTX = [['home', 'Início'], ['notifications', 'Avisos'], ['public', 'Públicas'], ['thread', 'Conversas'], ['account', 'Perfis']];
const FILTER_EXP = [['', 'Nunca'], [86400, '1 dia'], [604800, '1 semana'], [2592000, '30 dias']];
const ctxLabel = (c) => (FILTER_CTX.find((x) => x[0] === c) || [c, c])[1];

function openFilters() {
  const e = { type: 'filters', items: [], loaded: false, loading: false, error: null, confirm: null };
  e.reload = () => loadFilters(e);
  pushEntry(e);
  loadFilters(e);
}

async function loadFilters(e) {
  e.loading = true; e.error = null; busy(+1); render();
  try {
    e.items = await api('/api/v2/filters');
    e.loaded = true;
  } catch (err) { e.error = err.message; } finally {
    e.loading = false; busy(-1);
    if (session && state.profiles.includes(e)) render();
  }
}

function filtersView(view, e) {
  view.append(profileBar('Filtros', closeProfile));
  view.append(h('p', { class: 'muted small filters-note' }, 'Filtros ficam na sua conta da instância e valem em qualquer app. Publicações que casarem aparecem recolhidas, com um botão para mostrar.'));
  view.append(h('button', { type: 'button', class: 'with-icon primary add-filter', onclick: () => openFilterEdit(e, null) }, svgIcon('add', 18), 'Novo filtro'));
  if (e.error) { view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, e.error), h('button', { type: 'button', onclick: () => e.reload() }, 'Tentar de novo'))); return; }
  if (!e.loaded) { view.append(h('p', { class: 'empty' }, 'Carregando…')); return; }
  if (!e.items.length) { view.append(h('p', { class: 'empty' }, 'Nenhum filtro ainda.')); return; }
  e.items.forEach((f) => {
    const confirming = e.confirm === f.id;
    const kw = (f.keywords || []).map((k) => k.keyword).join(', ');
    const meta = [`${(f.context || []).map(ctxLabel).join(', ') || 'sem contexto'}`, f.filter_action === 'hide' ? 'oculta' : 'recolhe',
      f.expires_at ? `até ${new Date(f.expires_at).toLocaleDateString('pt-BR')}` : null].filter(Boolean).join(' · ');
    view.append(h('div', { class: 'filter-row' },
      h('div', { class: 'filter-info' }, h('strong', {}, f.title), h('span', { class: 'muted small' }, kw || 'sem palavras'), h('span', { class: 'muted small' }, meta)),
      h('div', { class: 'filter-actions' },
        h('button', { type: 'button', onclick: () => openFilterEdit(e, f) }, 'Editar'),
        h('button', { type: 'button', class: confirming ? 'danger' : '', onclick: async () => {
          if (!confirming) { e.confirm = f.id; render(); setTimeout(() => { if (e.confirm === f.id) { e.confirm = null; if (topEntry() === e) render(); } }, 4000); return; }
          try {
            await api(`/api/v2/filters/${f.id}`, { method: 'DELETE' });
            e.items = e.items.filter((x) => x.id !== f.id); e.confirm = null; render();
          } catch (err) { toast(err.message); }
        } }, confirming ? 'Confirmar' : 'Excluir'))));
  });
}

/* ---------- Status da instância ---------- */

async function timed(fn) {
  const t0 = performance.now();
  try { const value = await fn(); return { ok: true, ms: Math.round(performance.now() - t0), value }; }
  catch (err) { return { ok: false, ms: Math.round(performance.now() - t0), error: err }; }
}

function openHealth() {
  const e = { type: 'health', checks: null, running: false, at: null };
  e.reload = () => runHealth(e);
  pushEntry(e);
  runHealth(e);
}

async function runHealth(e) {
  if (e.running) return;
  e.running = true; e.checks = null; render();
  const host = session.host;
  const [inst, cred, tl] = await Promise.all([
    timed(async () => { const r = await fetch(`https://${host}/api/v2/instance`, { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    timed(() => api('/api/v1/accounts/verify_credentials')),
    timed(() => api('/api/v1/timelines/home', { params: { limit: 1 } })),
  ]);
  const checks = [];
  const speed = (ms) => (ms < 800 ? 'ok' : ms < 2500 ? 'warn' : 'bad');
  if (inst.ok) {
    const v = inst.value;
    checks.push({ name: 'Servidor', state: speed(inst.ms), text: `Respondendo em ${inst.ms} ms`, detail: `${v.title || host} · Mastodon ${v.version || '?'}` });
    const users = v.usage && v.usage.users && v.usage.users.active_month;
    if (users != null) checks.push({ name: 'Comunidade', state: 'info', text: `${users.toLocaleString('pt-BR')} pessoas ativas no mês`, detail: v.registrations ? (v.registrations.enabled ? (v.registrations.approval_required ? 'Cadastros com aprovação' : 'Cadastros abertos') : 'Cadastros fechados') : '' });
  } else {
    checks.push({ name: 'Servidor', state: 'bad', text: navigator.onLine ? 'Não respondeu' : 'Sem conexão com a internet', detail: inst.error && inst.error.message });
  }
  if (cred.ok) checks.push({ name: 'Sua sessão', state: speed(cred.ms), text: `Válida, como @${cred.value.acct}`, detail: `${cred.ms} ms` });
  else if (cred.error && [401, 403].includes(cred.error.status)) checks.push({ name: 'Sua sessão', state: 'bad', text: 'Token recusado: entre de novo nesta conta', detail: cred.error.message });
  else checks.push({ name: 'Sua sessão', state: 'bad', text: 'Não foi possível verificar', detail: cred.error && cred.error.message });
  if (tl.ok) checks.push({ name: 'Linha do tempo', state: speed(tl.ms), text: `Carregou em ${tl.ms} ms` });
  else checks.push({ name: 'Linha do tempo', state: 'bad', text: 'Falhou ao carregar', detail: tl.error && tl.error.message });
  if (!prefs.live) checks.push({ name: 'Tempo real', state: 'info', text: 'Desativado nas preferências' });
  else if (live.ws && live.ws.readyState === 1) checks.push({ name: 'Tempo real', state: 'ok', text: 'Conectado' });
  else checks.push({ name: 'Tempo real', state: 'warn', text: live.tries ? `Reconectando (tentativa ${live.tries})` : 'Sem conexão no momento', detail: 'O Início ainda atualiza ao puxar para baixo.' });
  e.checks = checks;
  e.at = new Date();
  e.running = false;
  if (session && state.profiles.includes(e)) render();
}

function healthView(view, e) {
  view.append(profileBar('Status da instância', closeProfile));
  if (!e.checks) { view.append(h('p', { class: 'empty' }, 'Verificando…')); return; }
  const worst = e.checks.some((c) => c.state === 'bad') ? 'bad' : e.checks.some((c) => c.state === 'warn') ? 'warn' : 'ok';
  const head = { ok: 'Tudo funcionando', warn: 'Funcionando com lentidão ou ressalvas', bad: 'Há problemas' }[worst];
  view.append(h('div', { class: `health-head ${worst}` }, h('span', { class: 'health-dot' }), h('strong', {}, head)));
  e.checks.forEach((c) => view.append(h('div', { class: 'health-row' },
    h('span', { class: `health-dot ${c.state}` }),
    h('div', {}, h('strong', {}, c.name), h('div', {}, c.text), c.detail ? h('div', { class: 'muted small' }, c.detail) : null))));
  view.append(h('div', { class: 'health-foot' },
    h('span', { class: 'muted small' }, `Verificado às ${e.at.toLocaleTimeString('pt-BR', { timeStyle: 'short' })}`),
    h('button', { type: 'button', onclick: () => e.reload() }, 'Verificar de novo'),
    h('a', { class: 'link', href: `https://${session.host}/about`, target: '_blank', rel: 'noopener noreferrer' }, 'Sobre a instância')));
}

function openScheduled() {
  const e = { type: 'scheduled', items: [], loaded: false, error: null, confirm: null };
  e.reload = () => loadScheduled(e);
  pushEntry(e);
  loadScheduled(e);
}

async function loadScheduled(e) {
  e.error = null; busy(+1); render();
  try {
    e.items = await api('/api/v1/scheduled_statuses');
    e.loaded = true;
  } catch (err) { e.error = err.message; } finally {
    busy(-1);
    if (session && state.profiles.includes(e)) render();
  }
}

function scheduledView(view, e) {
  view.append(profileBar('Publicações agendadas', closeProfile));
  if (e.error) { view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, e.error), h('button', { type: 'button', onclick: () => e.reload() }, 'Tentar de novo'))); return; }
  if (!e.loaded) { view.append(h('p', { class: 'empty' }, 'Carregando…')); return; }
  if (!e.items.length) { view.append(h('p', { class: 'empty' }, 'Nenhuma publicação agendada.')); return; }
  e.items.forEach((it) => {
    const confirming = e.confirm === it.id;
    const p = it.params || {};
    view.append(h('div', { class: 'filter-row' },
      h('div', { class: 'filter-info' },
        h('strong', {}, new Date(it.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })),
        h('span', {}, p.text || (it.media_attachments && it.media_attachments.length ? '(mídia)' : ''))),
      h('div', { class: 'filter-actions' },
        h('button', { type: 'button', class: confirming ? 'danger' : '', onclick: async () => {
          if (!confirming) { e.confirm = it.id; render(); setTimeout(() => { if (e.confirm === it.id) { e.confirm = null; if (topEntry() === e) render(); } }, 4000); return; }
          try {
            await api(`/api/v1/scheduled_statuses/${it.id}`, { method: 'DELETE' });
            e.items = e.items.filter((x) => x.id !== it.id); e.confirm = null; render();
          } catch (err) { toast(err.message); }
        } }, confirming ? 'Confirmar' : 'Cancelar'))));
  });
}

function openFilterEdit(parent, f) {
  const e = { type: 'filteredit', parent, filter: f, built: false, saving: false, error: '',
    form: {
      title: f ? f.title : '',
      words: f ? (f.keywords || []).map((k) => k.keyword).join('\n') : '',
      whole: f ? (f.keywords || []).every((k) => k.whole_word) && (f.keywords || []).length > 0 : true,
      context: new Set(f ? f.context : ['home', 'notifications', 'public', 'thread']),
      action: f && f.filter_action === 'hide' ? 'hide' : 'warn',
      exp: undefined, // undefined = manter o que já existe
    } };
  pushEntry(e);
}

function filterEditView(view, e) {
  const f = e.form;
  view.append(profileBar(e.filter ? 'Editar filtro' : 'Novo filtro', closeProfile));
  const title = h('input', { value: f.title, maxlength: '100', placeholder: 'Ex.: Spoilers', autocomplete: 'off' });
  title.addEventListener('input', () => { f.title = title.value; });
  const words = h('textarea', { rows: '5', placeholder: 'Uma palavra ou frase por linha', autocapitalize: 'none', spellcheck: 'false' }, f.words);
  words.addEventListener('input', () => { f.words = words.value; });
  const field = (label, el) => h('label', { class: 'edit-field' }, h('span', { class: 'muted small' }, label), el);
  const chips = (items, isOn, onTap) => h('div', { class: 'cp-row' }, ...items.map(([val, label]) => {
    const b = h('button', { type: 'button', class: `chip${isOn(val) ? ' active' : ''}`, 'aria-pressed': isOn(val) ? 'true' : 'false' }, label);
    b.addEventListener('click', () => { onTap(val); b.parentElement.querySelectorAll('.chip').forEach((c, i) => { const on = isOn(items[i][0]); c.classList.toggle('active', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); }); });
    return b;
  }));
  const whole = h('button', { type: 'button', class: `pick-row${f.whole ? ' on' : ''}`, role: 'switch', 'aria-checked': f.whole ? 'true' : 'false' },
    h('span', { class: 'pick-box' }, f.whole ? svgIcon('check', 16) : null), 'Só palavras inteiras');
  whole.addEventListener('click', () => {
    f.whole = !f.whole; whole.classList.toggle('on', f.whole); whole.setAttribute('aria-checked', String(f.whole));
    whole.querySelector('.pick-box').replaceChildren(...(f.whole ? [svgIcon('check', 16)] : []));
  });
  const expItems = [...(e.filter && e.filter.expires_at ? [['keep', `Manter (${new Date(e.filter.expires_at).toLocaleDateString('pt-BR')})`]] : []), ...FILTER_EXP];
  const expOn = (v) => (f.exp === undefined ? v === (e.filter && e.filter.expires_at ? 'keep' : '') : f.exp === v);
  view.append(h('div', { class: 'edit-form' },
    field('Nome do filtro', title),
    field('Palavras ou frases', words),
    whole,
    h('strong', {}, 'Onde vale'),
    chips(FILTER_CTX, (c) => f.context.has(c), (c) => { if (f.context.has(c)) f.context.delete(c); else f.context.add(c); }),
    h('strong', {}, 'O que fazer'),
    chips([['warn', 'Recolher com aviso'], ['hide', 'Ocultar']], (v) => f.action === v, (v) => { f.action = v; }),
    h('strong', {}, 'Duração'),
    chips(expItems, expOn, (v) => { f.exp = v === 'keep' ? undefined : v; })));
  view.append(h('p', { id: 'filter-error', class: 'error', role: 'alert' }, e.error || ''));
  view.append(h('div', { class: 'save-bar' }, h('button', { type: 'button', class: 'primary edit-save', onclick: () => saveFilter(e) }, 'Salvar')));
  e.built = true;
}

async function saveFilter(e) {
  const f = e.form;
  const err = $('#filter-error');
  const list = [...new Set(f.words.split('\n').map((x) => x.trim()).filter(Boolean))];
  if (!f.title.trim()) { err.textContent = 'Dê um nome ao filtro.'; return; }
  if (!list.length) { err.textContent = 'Inclua pelo menos uma palavra.'; return; }
  if (!f.context.size) { err.textContent = 'Escolha onde o filtro vale.'; return; }
  err.textContent = '';
  const body = { title: f.title.trim(), context: [...f.context], filter_action: f.action };
  if (f.exp !== undefined) body.expires_in = f.exp;
  const old = e.filter ? e.filter.keywords || [] : [];
  const attrs = [];
  old.forEach((k) => { if (!list.includes(k.keyword)) attrs.push({ id: k.id, _destroy: true }); else if (k.whole_word !== f.whole) attrs.push({ id: k.id, keyword: k.keyword, whole_word: f.whole }); });
  list.forEach((w) => { if (!old.some((k) => k.keyword === w)) attrs.push({ keyword: w, whole_word: f.whole }); });
  body.keywords_attributes = attrs;
  const btn = $('.edit-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    if (e.filter) await api(`/api/v2/filters/${e.filter.id}`, { method: 'PUT', body });
    else await api('/api/v2/filters', { method: 'POST', body });
    toast('Filtro salvo');
    closeProfile();
    e.parent.reload();
  } catch (ex) {
    e.error = ex.message; err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Salvar';
  }
}

/* ----- Editar perfil ----- */

// Reduz e recorta ao centro para caber no limite de upload da instância
async function prepImage(file, w, h2) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const ratio = w / h2;
  let sw = bmp.width, sh = bmp.height; // recorte central na proporção alvo
  if (sw / sh > ratio) sw = Math.round(sh * ratio); else sh = Math.round(sw / ratio);
  const sx = Math.round((bmp.width - sw) / 2), sy = Math.round((bmp.height - sh) / 2);
  const cw = Math.min(w, sw), ch = Math.round(cw / ratio); // nunca amplia
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  cv.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, cw, ch);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Não consegui processar a imagem.');
  return blob;
}

function openEditProfile() {
  const e = { type: 'editprofile', loaded: false, loading: false, error: null, saving: false, dirty: false, built: false,
    form: null, avatarBlob: null, headerBlob: null, avatarUrl: null, headerUrl: null, maxFields: 4 };
  e.reload = null;
  pushEntry(e);
  loadEditProfile(e);
}

async function loadEditProfile(e) {
  e.loading = true; e.error = null; busy(+1); render();
  try {
    const [acct, inst] = await Promise.all([
      api('/api/v1/accounts/verify_credentials'),
      api('/api/v2/instance').catch(() => null),
    ]);
    const max = inst && inst.configuration && inst.configuration.accounts && inst.configuration.accounts.max_profile_fields;
    if (max) e.maxFields = max;
    const src = acct.source || {};
    e.account = acct;
    e.form = {
      display_name: acct.display_name || '',
      note: src.note != null ? src.note : '',
      locked: !!acct.locked, bot: !!acct.bot, discoverable: acct.discoverable !== false && !!acct.discoverable,
      fields: Array.from({ length: e.maxFields }, (_, i) => {
        const f = (src.fields || acct.fields || [])[i];
        return { name: (f && f.name) || '', value: (f && (src.fields ? f.value : String(f.value || '').replace(/<[^>]*>/g, ''))) || '' };
      }),
    };
    e.avatarUrl = safeUrl(acct.avatar_static || acct.avatar);
    e.headerUrl = safeUrl(acct.header_static || acct.header);
    e.loaded = true;
  } catch (err) {
    e.error = err.message;
  } finally {
    e.loading = false; busy(-1);
    e.built = false;
    if (session && state.profiles.includes(e)) render();
  }
}

function closeEditProfile(e) {
  if (!e.dirty || e.saving) { closeProfile(); return; }
  openSheet('Descartar alterações do perfil?', [{ label: 'Descartar', danger: true, onclick: () => closeProfile() }]);
}

async function saveEditProfile(e) {
  if (e.saving || !e.loaded) return;
  e.saving = true;
  const btns = document.querySelectorAll('.edit-save');
  btns.forEach((b) => { b.disabled = true; b.textContent = 'Salvando…'; });
  const f = e.form;
  const fd = new FormData();
  fd.append('display_name', f.display_name);
  fd.append('note', f.note);
  fd.append('locked', String(f.locked));
  fd.append('bot', String(f.bot));
  fd.append('discoverable', String(f.discoverable));
  f.fields.forEach((x, i) => { fd.append(`fields_attributes[${i}][name]`, x.name); fd.append(`fields_attributes[${i}][value]`, x.value); });
  if (e.avatarBlob) fd.append('avatar', e.avatarBlob, 'avatar.jpg');
  if (e.headerBlob) fd.append('header', e.headerBlob, 'header.jpg');
  try {
    const acct = await api('/api/v1/accounts/update_credentials', { method: 'PATCH', form: fd });
    session.account = { ...session.account, ...acct };
    persistSession();
    [state.me, ...state.profiles].forEach((p) => { if (p && !p.type && p.id === acct.id) { p.account = acct; p.loaded = true; } });
    e.dirty = false;
    toast('Perfil atualizado');
    closeProfile();
    if (state.me) loadProfile(state.me);
  } catch (err) {
    e.saving = false;
    e.error = err.message;
    btns.forEach((b) => { b.disabled = false; b.textContent = 'Salvar'; });
    const box = document.querySelector('#edit-error');
    if (box) box.textContent = err.message;
  }
}

function editProfileView(view, e) {
  view.append(profileBar('Editar perfil', () => closeEditProfile(e)));
  if (e.error && !e.loaded) { view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, e.error), h('button', { type: 'button', onclick: () => loadEditProfile(e) }, 'Tentar de novo'))); return; }
  if (!e.loaded) { view.append(h('p', { class: 'empty' }, 'Carregando…')); return; }
  const f = e.form;
  const touch = () => { e.dirty = true; };

  // capa e avatar: o lápis sobre a imagem abre o seletor de arquivo
  const header = h('div', { class: 'banner edit-banner', style: e.headerUrl && !/missing\.png/.test(e.headerUrl) ? `background-image:url("${e.headerUrl}")` : null });
  const avatar = h('img', { class: 'profile-avatar', src: e.avatarUrl, alt: 'Foto atual' });
  const overlay = (label, kind, w, hh, onPreview) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': label });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const blob = await prepImage(file, w, hh);
        e[kind + 'Blob'] = blob;
        onPreview(URL.createObjectURL(blob));
        touch();
      } catch (err) { toast(err.message); }
      input.value = '';
    });
    return h('span', { class: `edit-overlay ${kind}` }, input,
      h('button', { type: 'button', 'aria-label': label, onclick: () => input.click() }, svgIcon('compose', 22)));
  };
  header.append(overlay('Trocar capa', 'header', 1500, 500, (url) => { header.style.backgroundImage = `url("${url}")`; }));
  view.append(header);
  view.append(h('div', { class: 'edit-media' },
    h('div', { class: 'edit-avatar' }, avatar, overlay('Trocar foto', 'avatar', 400, 400, (url) => { avatar.src = url; })),
    h('p', { class: 'muted small' }, 'Toque no lápis para trocar. As imagens são reduzidas e recortadas ao centro (foto quadrada, capa 3:1).')));

  const field = (label, el) => h('label', { class: 'edit-field' }, h('span', { class: 'muted small' }, label), el);
  const name = h('input', { value: f.display_name, maxlength: '30', autocomplete: 'off' });
  name.addEventListener('input', () => { f.display_name = name.value; touch(); });
  const note = h('textarea', { rows: '6', maxlength: '500' }, f.note);
  note.addEventListener('input', () => { f.note = note.value; touch(); });
  view.append(h('div', { class: 'edit-form' },
    field('Nome', name),
    field('Bio', note),
    h('strong', {}, 'Campos do perfil'),
    ...f.fields.map((x, i) => {
      const n = h('input', { value: x.name, placeholder: 'Rótulo (ex.: Site)', maxlength: '255', 'aria-label': `Campo ${i + 1}: rótulo` });
      const v = h('input', { value: x.value, placeholder: 'Conteúdo (ex.: https://…)', maxlength: '255', autocapitalize: 'none', 'aria-label': `Campo ${i + 1}: conteúdo` });
      n.addEventListener('input', () => { x.name = n.value; touch(); });
      v.addEventListener('input', () => { x.value = v.value; touch(); });
      return h('div', { class: 'edit-pair' }, n, v);
    })));
  const sw = (label, key) => {
    const b = h('button', { type: 'button', class: `pick-row${f[key] ? ' on' : ''}`, role: 'switch', 'aria-checked': f[key] ? 'true' : 'false' },
      h('span', { class: 'pick-box' }, f[key] ? svgIcon('check', 16) : null), label);
    b.addEventListener('click', () => {
      f[key] = !f[key]; touch();
      b.classList.toggle('on', f[key]); b.setAttribute('aria-checked', f[key] ? 'true' : 'false');
      b.querySelector('.pick-box').replaceChildren(...(f[key] ? [svgIcon('check', 16)] : []));
    });
    return b;
  };
  view.append(sw('Perfil fechado (aprovar quem pode me seguir)', 'locked'));
  view.append(sw('Conta automatizada (robô)', 'bot'));
  view.append(sw('Aparecer no diretório e nas sugestões', 'discoverable'));
  view.append(h('p', { id: 'edit-error', class: 'error', role: 'alert' }, e.error || ''));
  view.append(h('div', { class: 'save-bar' }, h('button', { type: 'button', class: 'primary edit-save', onclick: () => saveEditProfile(e) }, 'Salvar')));
  e.built = true;
}

/* ----- Perfis ----- */

const fmtCount = (n) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0);

const PROFILE_SEGS = [
  ['posts', 'Publicações'],
  ['replies', 'Com respostas'],
  ['media', 'Mídia'],
];
const OWN_SEGS = [['bookmarks', 'Salvos'], ['favourites', 'Favoritos']];
const profileSegs = (p) => (p.id === session.account.id ? [...PROFILE_SEGS, ...OWN_SEGS] : PROFILE_SEGS);

function mkProfile(account) {
  return {
    id: account.id, account, rel: null, loaded: false, error: null,
    seg: 'posts', people: null,
    posts: mkList(), replies: mkList(), media: mkList(), bookmarks: mkList(), favourites: mkList(), followers: mkList(), following: mkList(), pinned: [],
    returnScroll: 0,
  };
}

// A pilha `state.profiles` guarda perfis e conversas (type: 'thread') abertos por cima da aba.
function topEntry() {
  return state.profiles.length ? state.profiles[state.profiles.length - 1] : null;
}

function activeThread() {
  const t = topEntry();
  return t && t.type === 'thread' ? t : null;
}

function activeProfile() {
  const t = topEntry();
  if (t) return t.type ? null : t;
  return state.tab === 'account' ? state.me : null;
}

const fullAcct = (a) => (a.acct.includes('@') ? a.acct : `${a.acct}@${session.host}`);

function accountRow(a) {
  return h('div', { class: 'account-row', role: 'button', tabindex: '0', onclick: () => openProfile(a) },
    h('img', { class: 'avatar', src: safeUrl(a.avatar_static || a.avatar), alt: '', loading: 'lazy' }),
    h('div', { class: 'who' },
      h('div', { class: 'name' }, nameNode(a)),
      h('span', { class: 'acct' }, '@' + a.acct)));
}

function openProfile(account) {
  const p = mkProfile(account);
  p.returnScroll = window.scrollY;
  state.profiles.push(p);
  window.scrollTo(0, 0);
  render();
  loadProfile(p);
  ensureProfileLoaded(p);
}

// Contas vindas de outra instância têm ids que não valem na sua: resolvemos pelo endereço (usuário@instância).
function openAccountFrom(account, host) {
  if (!host) { openProfile(account); return; }
  openProfileByAcct(account.acct.includes('@') ? account.acct : `${account.acct}@${host}`);
}

async function openProfileByAcct(acct) {
  busy(+1);
  try {
    let a;
    try {
      a = await api('/api/v1/accounts/lookup', { params: { acct } });
    } catch (e) {
      if (e.status !== 404) throw e;
      const r = await api('/api/v2/search', { params: { q: '@' + acct.replace(/^@/, ''), resolve: 'true', type: 'accounts', limit: 1 } });
      a = r.accounts && r.accounts[0];
      if (!a) throw new Error('Conta não encontrada.');
    }
    openProfile(a);
  } catch (e) {
    toast(e.message);
  } finally {
    busy(-1);
  }
}

function closeProfile() {
  const p = state.profiles.pop();
  render();
  window.scrollTo(0, (p && p.returnScroll) || 0);
}

async function loadProfile(p) {
  if (!p) return;
  busy(+1);
  p.error = null;
  try {
    const self = p.id === session.account.id;
    const [acct, rels, pinned, featured] = await Promise.all([
      api(`/api/v1/accounts/${p.id}`),
      self ? Promise.resolve(null) : api('/api/v1/accounts/relationships', { params: { 'id[]': [p.id] } }),
      api(`/api/v1/accounts/${p.id}/statuses`, { params: { pinned: 'true' } }).catch(() => []),
      api(`/api/v1/accounts/${p.id}/featured_tags`).catch(() => []),
    ]);
    p.pinned = pinned;
    p.featured = featured;
    p.account = acct;
    p.rel = rels ? rels[0] : null;
    p.loaded = true;
  } catch (e) {
    p.error = e.message;
  } finally {
    busy(-1);
    if (session) render();
  }
}

function ensureProfileLoaded(p) {
  if (!p || activeProfile() !== p) return;
  const l = p[p.people || p.seg];
  if (!l) return;
  if (!l.items.length && !l.loading) loadList('p:' + (p.people || p.seg));
}

function setProfileSeg(p, id) {
  p.seg = id;
  p.people = null;
  window.scrollTo(0, 0);
  render();
  ensureProfileLoaded(p);
}

function openPeople(p, kind) {
  p.people = kind;
  p.peopleScroll = window.scrollY;
  window.scrollTo(0, 0);
  render();
  ensureProfileLoaded(p);
}

function closePeople(p) {
  p.people = null;
  render();
  window.scrollTo(0, p.peopleScroll || 0);
}

function followBtn(p) {
  const r = p.rel;
  const st = !r ? null : r.blocking ? 'blocked' : r.following ? 'following' : r.requested ? 'requested' : 'none';
  const label = { blocked: 'Bloqueado', following: 'Seguindo', requested: 'Pedido enviado', none: 'Seguir' }[st] || 'Seguir';
  return h('button', {
    type: 'button',
    class: st === 'none' || !st ? 'primary' : '',
    disabled: !r || st === 'blocked',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const verb = st === 'following' || st === 'requested' ? 'unfollow' : 'follow';
      try {
        p.rel = await api(`/api/v1/accounts/${p.id}/${verb}`, { method: 'POST' });
        render();
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    },
  }, label);
}

function profileBar(title, onBack, extra) {
  return h('div', { class: 'tag-head profile-bar' },
    onBack ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Voltar', onclick: onBack }, svgIcon('back', 22)) : null,
    h('strong', { class: 'profile-title' }, title),
    extra);
}

function accountRowEl(s) {
  const active = session && sameAcc(s, session);
  const acc = s.account;
  return h('button', { type: 'button', class: `acc-row${active ? ' active' : ''}`, 'aria-current': active ? 'true' : null,
    onclick: () => { if (active) { $('#sheet').close(); return; } activate(s); } },
    h('img', { class: 'avatar', src: safeUrl(acc.avatar), alt: '' }),
    h('span', { class: 'acc-info' },
      h('strong', {}, nameNode(acc)),
      h('span', { class: 'muted small' }, `@${acc.acct}@${s.host}`)),
    active ? svgIcon('check', 18) : null);
}

function addAccount() {
  try { $('#sheet').close(); } catch { /* ignora */ }
  state.settingsOpen = false;
  showLogin('', { add: true });
}

function accountsSheet() {
  openSheet('Contas', [
    { label: 'Adicionar conta', icon: 'user-add', onclick: addAccount },
  ], h('div', { class: 'acc-list' }, ...sessions().map(accountRowEl)));
}

function shareSection() {
  const base = `${APP_URL}?text=`;
  return h('div', { class: 'account-card' },
    h('strong', {}, 'Compartilhar para o Paquiderme'),
    h('p', { class: 'muted small' }, 'No Android, instalado o app, ele aparece no menu Compartilhar. No iPhone o sistema ainda não permite isso a apps da tela de início; dá para usar um atalho do app Atalhos:'),
    h('ol', { class: 'muted small share-steps' },
      h('li', {}, 'No Atalhos, crie um atalho novo e ative “Mostrar na Folha de Compartilhamento”.'),
      h('li', {}, 'Adicione a ação “Codificar URL” (entrada: Entrada do Atalho) e depois “Abrir URLs”.'),
      h('li', {}, 'Na URL, use o endereço abaixo seguido do resultado da codificação.')),
    h('code', { class: 'share-url' }, base),
    h('button', { type: 'button', class: 'with-icon', onclick: async () => { try { await navigator.clipboard.writeText(base); toast('Endereço copiado'); } catch { toast('Não consegui copiar'); } } }, svgIcon('copy', 18), 'Copiar endereço'),
    h('p', { class: 'muted small' }, 'Atenção: no iPhone “Abrir URLs” abre o Safari, não o app instalado. Nesse caso o login do Safari é separado do app.'));
}

function settingsView(view) {
  view.append(profileBar('Configurações', () => { state.settingsOpen = false; window.scrollTo(0, 0); render(); }));
  view.append(h('div', { class: 'account-card' },
    h('strong', {}, 'Contas'),
    h('div', { class: 'acc-list' }, ...sessions().map(accountRowEl)),
    h('button', { type: 'button', class: 'with-icon', onclick: addAccount }, svgIcon('user-add', 18), 'Adicionar conta'),
    h('a', { href: `https://${session.host}/settings/profile`, target: '_blank', rel: 'noopener noreferrer' }, 'Editar perfil e preferências na instância'),
    h('button', { type: 'button', class: 'with-icon', onclick: updateApp }, svgIcon('refresh', 18), 'Atualizar o app (limpar cache)'),
    h('button', { type: 'button', class: 'with-icon', onclick: () => logout() }, svgIcon('logout', 18), sessions().length > 1 ? 'Sair desta conta' : 'Sair'),
    h('p', { class: 'muted small' }, `${APP_NAME} · cliente estático, sem servidor próprio. O token fica só neste aparelho.`)));
  view.append(prefsSection());
  view.append(pushSection());
  view.append(shareSection());
  view.append(h('div', { class: 'account-card' },
    h('strong', {}, 'Conta e moderação'),
    h('button', { type: 'button', class: 'with-icon', onclick: openFilters }, svgIcon('filter', 18), 'Filtros de palavras'),
    h('button', { type: 'button', class: 'with-icon', onclick: openScheduled }, svgIcon('clock', 18), 'Publicações agendadas'),
    h('button', { type: 'button', class: 'with-icon', onclick: openHealth }, svgIcon('refresh', 18), 'Status da instância'),
    h('button', { type: 'button', class: 'with-icon', onclick: () => openAccountsEntry('Contas silenciadas', '/api/v1/mutes', 'unmute', 'Reativar') }, svgIcon('mute', 18), 'Contas silenciadas'),
    h('button', { type: 'button', class: 'with-icon', onclick: () => openAccountsEntry('Contas bloqueadas', '/api/v1/blocks', 'unblock', 'Desbloquear') }, svgIcon('block', 18), 'Contas bloqueadas')));
}

function profileView(view, p) {
  const isRoot = p === state.me && state.profiles.length === 0;
  if (isRoot && state.settingsOpen) { settingsView(view); return; }

  if (p.people) {
    view.append(profileBar(p.people === 'followers' ? 'Seguidores' : 'Seguindo', () => closePeople(p)));
    renderList(view, 'p:' + p.people, accountRow);
    return;
  }

  const a = p.account;
  const self = a.id === session.account.id;
  const gear = isRoot
    ? h('span', { class: 'push-right bar-actions' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Trocar de conta', onclick: accountsSheet }, svgIcon('users', 22)),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Configurações do app', onclick: () => { state.settingsOpen = true; window.scrollTo(0, 0); render(); loadPush(); } }, svgIcon('settings', 22)))
    : null;
  view.append(profileBar(nameNode(a), isRoot ? null : closeProfile, gear));

  const hdr = safeUrl(a.header_static || a.header);
  view.append(hdr && !/missing\.png/.test(hdr) ? h('img', { class: 'banner', src: hdr, alt: '' }) : h('div', { class: 'banner' }));

  const actions = self
    ? h('button', { type: 'button', onclick: openEditProfile }, 'Editar')
    : h('div', { class: 'profile-actions' },
      p.rel && p.rel.following ? h('button', { type: 'button', onclick: () => openListPicker(a) }, 'Listas') : null,
      followBtn(p),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mais opções da conta', onclick: () => accountMenu(a, p.rel) }, svgIcon('more', 22)));

  const badges = [];
  if (a.bot) badges.push(['Robô', 'bot']);
  if (a.group) badges.push(['Grupo']);
  if (a.locked) badges.push(['Perfil fechado', 'lock']);
  if (p.rel && p.rel.followed_by) badges.push(['Segue você']);
  if (p.rel && p.rel.muting) badges.push(['Silenciado']);
  if (p.rel && p.rel.blocked_by) badges.push(['Bloqueou você']);

  const fields = (a.fields || []).filter((f) => f.name || f.value).map((f) => h('div', { class: 'field' },
    h('dt', {}, emojiFragment(f.name || '', a.emojis)),
    h('dd', { class: f.verified_at ? 'verified' : '' }, sanitizeHtml(f.value, a.emojis), f.verified_at ? svgIcon('check', 16) : null)));

  view.append(h('section', { class: 'profile-head' },
    h('div', { class: 'profile-top' },
      h('img', { class: 'profile-avatar', src: safeUrl(a.avatar_static || a.avatar), alt: '' }),
      actions),
    h('h2', { class: 'profile-name' }, nameNode(a)),
    h('div', { class: 'handle' }, '@' + fullAcct(a)),
    badges.length ? h('div', { class: 'badges' }, ...badges.map(([label, icon]) => h('span', { class: 'badge' }, icon ? svgIcon(icon, 13) : null, label))) : null,
    a.moved ? h('p', { class: 'muted small' }, 'Mudou para ', h('span', { class: 'link-name', role: 'button', tabindex: '0', onclick: () => openProfile(a.moved) }, '@' + a.moved.acct)) : null,
    a.note ? h('div', { class: 'bio' }, sanitizeHtml(a.note, a.emojis)) : null,
    p.featured && p.featured.length ? h('div', { class: 'featured-tags' }, ...p.featured.map((t) => h('button', { type: 'button', class: 'chip', onclick: () => openTag(t.name) }, `#${t.name}`, t.statuses_count ? h('span', { class: 'muted small' }, ` ${t.statuses_count}`) : null))) : null,
    fields.length ? h('dl', { class: 'fields' }, ...fields) : null,
    h('div', { class: 'counts' },
      h('span', {}, h('strong', {}, fmtCount(a.statuses_count)), ' publicações'),
      h('button', { type: 'button', class: 'count-btn', onclick: () => openPeople(p, 'following') }, h('strong', {}, fmtCount(a.following_count)), ' seguindo'),
      h('button', { type: 'button', class: 'count-btn', onclick: () => openPeople(p, 'followers') }, h('strong', {}, fmtCount(a.followers_count)), ' seguidores')),
    h('p', { class: 'muted small' },
      a.created_at ? `Entrou em ${new Date(a.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · ` : '',
      h('a', { href: safeUrl(a.url), target: '_blank', rel: 'noopener noreferrer' }, 'abrir no navegador')),
    p.error ? h('p', { class: 'error' }, p.error) : null));

  view.append(h('div', { class: 'seg-bar under', role: 'tablist' }, ...profileSegs(p).map(([id, label]) =>
    h('button', { type: 'button', role: 'tab', class: `chip${p.seg === id ? ' active' : ''}`, 'aria-selected': p.seg === id ? 'true' : 'false', onclick: () => setProfileSeg(p, id) }, label))));
  if (a.locked && !self && !(p.rel && p.rel.following)) {
    view.append(h('p', { class: 'note muted small' }, 'Perfil fechado: siga a conta para ver as publicações.'));
  }
  const pinnedIds = new Set(p.pinned.map((s) => s.id));
  if (p.seg === 'posts') {
    p.pinned.forEach((s) => view.append(h('div', { class: 'pinned' },
      h('div', { class: 'pinned-note muted small' }, svgIcon('pin', 14), ' Fixada'), statusEl(s))));
  }
  renderList(view, 'p:' + p.seg, (s) => (p.seg === 'posts' && pinnedIds.has(s.id) ? null : statusEl(s)));
}


/* ----- Explorar ----- */

const SEGMENTS = [
  ['local', 'Minha instância'],
  ['global', 'Global'],
  ['trends', 'Em alta'],
  ['tags', 'Hashtags'],
  ['other', 'Outras'],
];

function getList(kind) {
  if (kind === 'list') return state.listTl;
  if (kind.startsWith('p:')) {
    const p = activeProfile();
    return p ? p[kind.slice(2)] : mkList();
  }
  return state[kind];
}

function renderList(view, kind, make, group) {
  const st = getList(kind);
  if (st.cached) {
    const when = st.cachedAt ? new Date(st.cachedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    view.append(h('p', { class: 'cache-note', role: 'status' },
      st.error ? `Sem conexão. Mostrando o que foi guardado em ${when}.` : `Mostrando o que foi guardado em ${when}. Atualizando…`));
  }
  (group ? group(st.items) : st.items).forEach((i) => { const n = make(i); if (n) view.append(n); });
  view.append(moreButton(kind));
}

function tagRow(tag) {
  const hist = tag.history || [];
  const two = hist.slice(0, 2);
  const people = two.reduce((n, d) => n + Number(d.accounts || 0), 0);
  const uses = two.reduce((n, d) => n + Number(d.uses || 0), 0);
  return h('button', { type: 'button', class: 'tag-row', onclick: () => openTag(tag.name) },
    h('div', { class: 'tag-info' },
      h('strong', {}, '#' + tag.name),
      h('span', { class: 'muted small' }, `${people} pessoas · ${uses} publicações nos últimos 2 dias`)),
    sparkline(hist.slice(0, 7).map((d) => Number(d.uses || 0)).reverse()));
}

function trendsView(view) {
  const t = state.trends;
  if (t.error) {
    view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, t.error),
      h('button', { type: 'button', onclick: loadTrends }, 'Tentar de novo')));
    return;
  }
  if (t.loading && !t.loaded) { view.append(h('p', { class: 'empty' }, 'Carregando…')); return; }
  t.notices.forEach((n) => view.append(h('div', { class: 'notice' },
    h('div', { class: 'notice-body' }, sanitizeHtml(n.content, n.emojis)),
    h('button', { type: 'button', class: 'link', onclick: async () => {
      try { await api(`/api/v1/announcements/${n.id}/dismiss`, { method: 'POST' }); t.notices = t.notices.filter((x) => x.id !== n.id); render(); } catch (e) { toast(e.message); }
    } }, 'Dispensar'))));
  if (t.people.length) {
    view.append(h('h3', { class: 'section' }, 'Sugestões de contas'));
    t.people.forEach((p) => { if (p.account) view.append(accountRow(p.account)); });
  }
  if (t.links.length) {
    view.append(h('h3', { class: 'section' }, 'Links em alta'));
    t.links.forEach((l) => { const c = cardEl(l); if (c) view.append(h('div', { class: 'trend-link' }, c)); });
  }
  view.append(h('h3', { class: 'section' }, 'Hashtags em alta'));
  if (!t.tags.length) view.append(h('p', { class: 'empty' }, 'Nenhuma hashtag em alta agora.'));
  t.tags.forEach((tag) => view.append(tagRow(tag)));
  if (t.statuses.length) {
    view.append(h('h3', { class: 'section' }, 'Publicações em alta'));
    t.statuses.forEach((st) => view.append(statusEl(st)));
  }
}

function otherView(view) {
  const ex = state.explore;
  const input = h('input', {
    placeholder: 'ex.: mastodon.social', value: ex.otherHost, autocapitalize: 'none', autocorrect: 'off',
    spellcheck: 'false', inputmode: 'url', 'aria-label': 'Endereço da instância',
  });
  view.append(h('form', { class: 'inst-form', onsubmit: (e) => { e.preventDefault(); goOther(input.value); } },
    input, h('button', { type: 'submit', class: 'primary' }, 'Ver')));
  const saved = store.get('otherHosts', []);
  if (saved.length) {
    view.append(h('div', { class: 'hosts' }, ...saved.map((host) =>
      h('button', { type: 'button', class: `chip${host === ex.otherHost ? ' active' : ''}`, onclick: () => goOther(host) }, host))));
  }
  view.append(h('p', { class: 'note muted small' },
    'Mostra a timeline local pública da instância escolhida, só para leitura. Para interagir, abra o original.'));
  if (ex.otherHost) renderList(view, 'other', (s) => statusEl(s, { readonly: true, host: ex.otherHost }));
}

/* ----- Busca ----- */

const SEARCH_TYPES = [['', 'Tudo'], ['accounts', 'Contas'], ['hashtags', 'Hashtags'], ['statuses', 'Publicações']];

async function runSearch(append = false) {
  const s = state.search;
  if (!s.q || s.loading) return;
  s.loading = true; s.error = null;
  if (!append) busy(+1);
  render();
  try {
    const params = { q: s.q, resolve: 'true', limit: s.type ? 20 : 5 };
    if (s.type) params.type = s.type;
    if (append && s.type) params.offset = s.res[s.type].length;
    const r = await api('/api/v2/search', { params });
    if (append && s.type) {
      s.res[s.type] = s.res[s.type].concat(r[s.type] || []);
      s.more = (r[s.type] || []).length > 0;
    } else {
      s.res = { accounts: r.accounts || [], hashtags: r.hashtags || [], statuses: r.statuses || [] };
      s.more = !!s.type && (r[s.type] || []).length >= 20;
    }
  } catch (e) {
    s.error = e.status === 422 || e.status === 400 ? 'A instância não aceitou esta busca.' : e.message;
  } finally {
    s.loading = false;
    if (!append) busy(-1);
    if (session) render();
  }
}

function startSearch(q) {
  const s = state.search;
  s.q = q.trim();
  s.res = null;
  s.active = !!s.q;
  window.scrollTo(0, 0);
  if (s.q) runSearch(); else { render(); ensureExploreLoaded(); }
  updateDock();
}

function closeSearch() {
  const s = state.search;
  s.q = ''; s.res = null; s.active = false; s.error = null;
  $('#search-input').value = '';
  window.scrollTo(0, 0);
  render(); ensureExploreLoaded(); updateDock();
}

// Barra de busca fixa na base do Explorar (ao alcance do polegar)
function updateDock() {
  const ex = state.explore;
  const show = !!session && state.tab === 'explore' && !ex.tag && state.profiles.length === 0 && !$('#app').hidden;
  const dock = $('#search-dock');
  dock.hidden = !show;
  document.body.classList.toggle('has-dock', show);
  $('#search-clear').hidden = !$('#search-input').value && !state.search.active;
}

function fitDock() {
  const dock = $('#search-dock');
  const vv = window.visualViewport;
  if (!vv) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  dock.style.bottom = kb > 80 ? `${kb + 8}px` : '';
  dock.classList.toggle('kb', kb > 80);
}

function bindDock() {
  const input = $('#search-input');
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); input.blur(); startSearch(input.value); });
  input.addEventListener('input', updateDock);
  $('#search-clear').addEventListener('click', () => { if (state.search.active) closeSearch(); else { input.value = ''; updateDock(); input.focus(); } });
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitDock); window.visualViewport.addEventListener('scroll', fitDock); }
}

function searchView(view) {
  const s = state.search;
  view.append(h('div', { class: 'hosts', role: 'group', 'aria-label': 'Tipo de resultado' }, ...SEARCH_TYPES.map(([id, label]) =>
    h('button', { type: 'button', class: `chip${s.type === id ? ' active' : ''}`, 'aria-pressed': s.type === id ? 'true' : 'false',
      onclick: () => { s.type = id; s.res = null; if (s.q) runSearch(); else render(); } }, label))));
  if (s.error) { view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, s.error), h('button', { type: 'button', onclick: () => runSearch() }, 'Tentar de novo'))); return; }
  if (s.loading && !s.res) { view.append(h('p', { class: 'empty' }, 'Buscando…')); return; }
  if (!s.res) return;
  const { accounts, hashtags, statuses } = s.res;
  if (!accounts.length && !hashtags.length && !statuses.length) { view.append(h('p', { class: 'empty' }, 'Nada encontrado.')); return; }
  if (accounts.length) {
    if (!s.type) view.append(h('h3', { class: 'section' }, 'Contas'));
    accounts.forEach((a) => view.append(accountRow(a)));
  }
  if (hashtags.length) {
    if (!s.type) view.append(h('h3', { class: 'section' }, 'Hashtags'));
    hashtags.forEach((t) => view.append(tagRow(t)));
  }
  if (statuses.length) {
    if (!s.type) view.append(h('h3', { class: 'section' }, 'Publicações'));
    statuses.forEach((st) => view.append(statusEl(st)));
  }
  if (s.type && s.more) view.append(h('button', { type: 'button', class: 'more', onclick: () => runSearch(true) }, s.loading ? 'Carregando…' : 'Carregar mais'));
}

function exploreView(view) {
  const ex = state.explore;
  if (ex.tag) {
    view.append(h('div', { class: 'tag-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Voltar', onclick: closeTag }, svgIcon('back', 22)),
      h('strong', {}, '#' + ex.tag),
      ex.tagFollowing === null ? null : h('button', { type: 'button', class: `chip push-right${ex.tagFollowing ? ' active' : ''}`, 'aria-pressed': ex.tagFollowing ? 'true' : 'false', onclick: () => toggleFollowTag(ex.tag) }, ex.tagFollowing ? 'Seguindo' : 'Seguir')));
    renderList(view, 'tag', (s) => statusEl(s));
    return;
  }
  if (state.search.active) { searchView(view); return; }
  view.append(h('div', { class: 'seg-bar', role: 'tablist' }, ...SEGMENTS.map(([id, label]) =>
    h('button', { type: 'button', role: 'tab', class: `chip${ex.seg === id ? ' active' : ''}`, 'aria-selected': ex.seg === id ? 'true' : 'false', onclick: () => setSeg(id) }, label))));
  if (ex.seg === 'trends') trendsView(view);
  else if (ex.seg === 'tags') tagsView(view);
  else if (ex.seg === 'other') otherView(view);
  else renderList(view, ex.seg, (s) => statusEl(s));
}

function setSeg(id) {
  state.explore.seg = id;
  store.set('seg', id);
  window.scrollTo(0, 0);
  render();
  ensureExploreLoaded();
}

function openTag(name) {
  state.explore.tag = name;
  state.explore.tagFollowing = null;
  loadTagInfo(name);
  state.tag = mkList();
  selectTab('explore');
}

async function loadTagInfo(name) {
  try {
    const t = await api(`/api/v1/tags/${encodeURIComponent(name)}`);
    if (state.explore.tag === name) { state.explore.tagFollowing = !!t.following; render(); }
  } catch { /* instância sem o recurso: some o botão */ }
}

async function toggleFollowTag(name) {
  const ex = state.explore;
  const was = ex.tagFollowing;
  ex.tagFollowing = !was; render();
  try {
    await api(`/api/v1/tags/${encodeURIComponent(name)}/${was ? 'unfollow' : 'follow'}`, { method: 'POST' });
    state.followedTags.loaded = false;
    toast(was ? `Deixou de seguir #${name}` : `Seguindo #${name}`);
  } catch (e) { ex.tagFollowing = was; render(); toast(e.message); }
}

async function loadFollowedTags() {
  const f = state.followedTags;
  if (f.loading) return;
  f.loading = true; f.error = null; busy(+1); render();
  try { f.items = await api('/api/v1/followed_tags', { params: { limit: 100 } }); f.loaded = true; } catch (e) { f.error = e.message; } finally { f.loading = false; busy(-1); if (session) render(); }
}

function tagsView(view) {
  const f = state.followedTags;
  if (f.error) { view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, f.error), h('button', { type: 'button', onclick: loadFollowedTags }, 'Tentar de novo'))); return; }
  if (!f.loaded) { view.append(h('p', { class: 'empty' }, 'Carregando…')); return; }
  if (!f.items.length) { view.append(h('p', { class: 'empty' }, 'Você ainda não segue hashtags. Abra uma hashtag e toque em Seguir: as publicações dela passam a aparecer no Início.')); return; }
  f.items.forEach((t) => view.append(h('div', { class: 'tag-row' },
    h('button', { type: 'button', class: 'tag-name', onclick: () => openTag(t.name) }, '#' + t.name),
    h('button', { type: 'button', onclick: async () => {
      try { await api(`/api/v1/tags/${encodeURIComponent(t.name)}/unfollow`, { method: 'POST' }); f.items = f.items.filter((x) => x.name !== t.name); render(); } catch (e) { toast(e.message); }
    } }, 'Deixar de seguir'))));
}

function closeTag() {
  state.explore.tag = null;
  state.tag = mkList();
  window.scrollTo(0, 0);
  render();
  ensureExploreLoaded();
}

function goOther(raw) {
  const host = normalizeHost(raw);
  if (!host) { toast('Endereço de instância inválido.'); return; }
  state.explore.otherHost = host;
  store.set('otherHost', host);
  store.set('otherHosts', [host, ...store.get('otherHosts', []).filter((x) => x !== host)].slice(0, 8));
  state.other = mkList();
  loadList('other');
}

function ensureExploreLoaded() {
  const ex = state.explore;
  const kind = ex.tag ? 'tag' : ex.seg;
  if (state.search.active && !ex.tag) {
    /* resultados da busca já carregados */
  } else if (kind === 'trends') {
    if (!state.trends.loaded && !state.trends.loading) loadTrends();
  } else if (kind === 'tags') {
    if (!state.followedTags.loaded && !state.followedTags.loading) loadFollowedTags();
  } else if (kind === 'other') {
    if (ex.otherHost && !state.other.items.length && !state.other.loading && !state.other.error) loadList('other');
  } else if (!state[kind].items.length && !state[kind].loading) {
    loadList(kind);
  }
}

/* ----- Render e carregamento ----- */

function render() {
  const view = $('#view');
  const y = window.scrollY;
  const top0 = topEntry();
  // não reconstrói o formulário de edição enquanto a pessoa digita (perderia o foco e o teclado)
  if (top0 && (top0.type === 'editprofile' || top0.type === 'filteredit') && top0.built && view.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
  view.replaceChildren();
  const top = topEntry();
  const prof = activeProfile();
  if (top && top.type) entryView(view, top);
  else if (prof) profileView(view, prof);
  else if (state.tab === 'home') homeView(view);
  else if (state.tab === 'notifications') notificationsView(view);
  else if (state.tab === 'explore') exploreView(view);
  window.scrollTo(0, y);
  updateDock();
  updatePill();
}

function listSpec(kind) {
  if (kind.startsWith('p:')) {
    const id = activeProfile().id;
    switch (kind.slice(2)) {
      case 'posts': return { path: `/api/v1/accounts/${id}/statuses`, extra: { exclude_replies: 'true' } };
      case 'replies': return { path: `/api/v1/accounts/${id}/statuses` };
      case 'media': return { path: `/api/v1/accounts/${id}/statuses`, extra: { only_media: 'true' } };
      case 'bookmarks': return { path: '/api/v1/bookmarks', link: true };
      case 'favourites': return { path: '/api/v1/favourites', link: true };
      case 'followers': return { path: `/api/v1/accounts/${id}/followers`, extra: { limit: 40 }, link: true };
      case 'following': return { path: `/api/v1/accounts/${id}/following`, extra: { limit: 40 }, link: true };
      default: throw new Error('lista de perfil desconhecida: ' + kind);
    }
  }
  switch (kind) {
    case 'home': return { path: '/api/v1/timelines/home' };
    case 'list': return { path: `/api/v1/timelines/list/${encodeURIComponent(state.homeList)}` };
    case 'notifications': return { path: '/api/v1/notifications' };
    case 'mentions': return { path: '/api/v1/notifications', extra: { 'types[]': 'mention' } };
    case 'convs': return { path: '/api/v1/conversations', extra: { limit: 20 } };
    case 'local': return { path: '/api/v1/timelines/public', extra: { local: 'true' } };
    case 'global': return { path: '/api/v1/timelines/public' };
    case 'tag': return { path: `/api/v1/timelines/tag/${encodeURIComponent(state.explore.tag || '')}` };
    case 'other': return { path: '/api/v1/timelines/public', extra: { local: 'true' }, host: state.explore.otherHost, auth: false };
    default: throw new Error('lista desconhecida: ' + kind);
  }
}

async function loadList(kind, append = false) {
  const st = getList(kind);
  if (st.loading) return;
  const spec = listSpec(kind);
  if (kind === 'other' && !spec.host) return;
  st.loading = true;
  st.error = null;
  if (!append) busy(+1);
  render();
  try {
    const params = { limit: 30, ...spec.extra };
    if (append) {
      if (spec.link) { if (st.next) params.max_id = st.next; } // seguidores/seguindo paginam pelo cabeçalho Link
      else if (st.items.length) params.max_id = st.items[st.items.length - 1].id;
    }
    let headers = null;
    const data = await api(spec.path, { params, host: spec.host, auth: spec.auth !== false, onHeaders: (hd) => { headers = hd; } });
    st.items = append ? st.items.concat(data) : data;
    st.loaded = true;
    if (spec.link) {
      st.next = parseNextMaxId(headers && headers.get('Link'));
      st.more = !!st.next;
    } else {
      st.more = data.length > 0;
    }
    if (!append) { st.cached = false; window.scrollTo(0, 0); }
    if (!append) saveCache(kind);
    if (kind === 'notifications' && !append && state.tab === 'notifications') markNotificationsRead();
  } catch (e) {
    st.error = kind === 'other' && [401, 403, 422].includes(e.status)
      ? 'Esta instância não libera a timeline pública sem login.'
      : e.message;
  } finally {
    st.loading = false;
    if (!append) busy(-1);
    if (session) render();
    if (session && kind === 'home' && !append && !st.error) setTimeout(checkHomeMarker, 300);
  }
}

async function loadTrends() {
  const t = state.trends;
  if (t.loading) return;
  t.loading = true;
  t.error = null;
  busy(+1);
  render();
  try {
    const [tags, statuses, links, people, notices] = await Promise.all([
      api('/api/v1/trends/tags', { params: { limit: 20 } }),
      api('/api/v1/trends/statuses', { params: { limit: 20 } }).catch(() => []),
      api('/api/v1/trends/links', { params: { limit: 10 } }).catch(() => []),
      api('/api/v2/suggestions', { params: { limit: 8 } }).catch(() => []),
      api('/api/v1/announcements').catch(() => []),
    ]);
    t.tags = tags;
    t.statuses = statuses;
    t.links = Array.isArray(links) ? links : [];
    t.people = Array.isArray(people) ? people : [];
    t.notices = (Array.isArray(notices) ? notices : []).filter((n) => !n.read);
    t.loaded = true;
  } catch (e) {
    t.error = e.message;
  } finally {
    t.loading = false;
    busy(-1);
    if (session) render();
  }
}

function currentKind() {
  const te = topEntry();
  if (te && te.type) return 'entry';
  const p = activeProfile();
  if (p) return (p === state.me && state.settingsOpen) ? null : 'p:' + (p.people || p.seg);
  if (state.tab === 'home') return state.homeList ? 'list' : 'home';
  if (state.tab === 'notifications') return state.notifTab === 'mentions' ? 'mentions' : state.notifTab === 'dms' ? 'convs' : 'notifications';
  if (state.tab === 'explore') return state.explore.tag ? 'tag' : state.search.active ? 'search' : state.explore.seg;
  return null;
}

function refreshCurrent() {
  const kind = currentKind();
  if (!kind) return;
  if (kind === 'entry') { const te = topEntry(); if (te.type === 'thread') loadThread(te); else if (te.reload) te.reload(); return; }
  if (kind === 'home' || kind === 'list') loadLists(true);
  if (kind.startsWith('p:')) loadProfile(activeProfile());
  if (kind === 'search') { runSearch(); return; }
  if (kind === 'tags') { loadFollowedTags(); return; }
  if (kind === 'trends') { loadTrends(); return; }
  loadList(kind);
}

function selectTab(tab) {
  state.tab = tab;
  if (tab === 'notifications') setUnread(false);
  state.profiles = [];
  state.settingsOpen = false;
  if (tab === 'account' && !state.me) state.me = mkProfile(session.account);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#fab').hidden = tab === 'account';
  window.scrollTo(0, 0);
  const icon = document.querySelector('#tabs button.active svg');
  if (icon) { icon.classList.remove('bump'); void icon.getBoundingClientRect(); icon.classList.add('bump'); }
  render();
  if (tab === 'home') {
    if (!state.lists.loaded) loadLists(true);
    const k = state.homeList ? 'list' : 'home';
    if (k === 'home' && hydrateFromCache('home')) { render(); window.scrollTo(0, store.get(scrollKey('home'), 0)); refreshWithCache('home'); }
    else if (!getList(k).items.length && !getList(k).loading) loadList(k);
  } else if (tab === 'notifications') {
    if (hydrateFromCache('notifications')) { render(); window.scrollTo(0, store.get(scrollKey('notifications'), 0)); refreshWithCache('notifications'); }
    else if (!state[tab].items.length && !state[tab].loading) loadList(tab);
  } else if (tab === 'explore') {
    ensureExploreLoaded();
  } else if (tab === 'account') {
    if (!state.me) state.me = mkProfile(session.account);
    if (!state.me.loaded) loadProfile(state.me);
    ensureProfileLoaded(state.me);
  }
}

/* ----- Puxar para atualizar ----- */

const HOLD = 56; // altura (px) em que o indicador fica parado enquanto carrega
let busyCount = 0;
let pulling = false;

function setPull(px, drag = false) {
  const ptr = $('#ptr');
  const view = $('#view');
  ptr.classList.toggle('dragging', drag);
  view.classList.toggle('dragging', drag);
  ptr.style.transform = `translateY(${px - 56}px)`;
  ptr.style.opacity = String(Math.min(1, px / 36));
  view.style.transform = px > 0 ? `translateY(${px}px)` : '';
  const ico = ptr.querySelector('.ico');
  if (ico) ico.style.transform = ptr.classList.contains('loading') ? '' : `rotate(${(px / HOLD) * 270}deg)`;
}

function busy(delta) {
  busyCount = Math.max(0, busyCount + delta);
  const on = busyCount > 0;
  $('#ptr').classList.toggle('loading', on);
  if (!pulling) setPull(on ? HOLD : 0);
}

function bindPullToRefresh() {
  let y0 = null;
  let pull = 0;
  const canPull = () => !(state.tab === 'account' && state.settingsOpen) && !$('#composer').open && !$('#app').hidden;

  document.addEventListener('touchstart', (e) => {
    y0 = (e.touches.length === 1 && window.scrollY <= 0 && canPull()) ? e.touches[0].clientY : null;
    pull = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) {
      if (pulling) { pulling = false; setPull(busyCount > 0 ? HOLD : 0); }
      if (window.scrollY > 0) y0 = null;
      return;
    }
    pulling = true;
    pull = Math.min(dy * 0.55, 110);
    if (e.cancelable) e.preventDefault(); // evita o "elástico" nativo do iOS
    setPull(Math.max(pull, busyCount > 0 ? HOLD : 0), true);
  }, { passive: false });

  const end = () => {
    if (y0 == null) return;
    const trigger = pulling && pull >= HOLD;
    pulling = false;
    y0 = null;
    if (trigger) refreshCurrent();
    setPull(busyCount > 0 ? HOLD : 0);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
}

/* ---------- Compositor ---------- */

const mkCompose = () => ({ replyTo: null, edit: null, key: null, media: [], poll: null, sensitive: false, scheduledAt: '', lang: store.get('lang', '') });
let compose = mkCompose();
let limits = { translation: false, maxChars: 500, maxMedia: 4, pollOptions: 4, pollChars: 50, pollMin: 300, pollMax: 2629746 };

const LANGS = [['', 'Automático (padrão da conta)'], ['pt', 'Português'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['ja', '日本語'], ['zh', '中文'], ['ru', 'Русский'], ['ar', 'العربية']];

const draftKey = () => `draft.${session.host}.${session.account.id}`;

function saveDraft() {
  if (compose.replyTo || compose.edit) return;
  const cw = $('#cw');
  store.set(draftKey(), { text: $('#text').value, cw: cw.hidden ? '' : cw.value, poll: compose.poll, lang: compose.lang });
}

function openComposer({ replyTo = null, edit = null, share = '', quote = null } = {}) {
  hideSuggest();
  compose.media.forEach((m) => m.preview && m.preview.startsWith('blob:') && URL.revokeObjectURL(m.preview));
  compose = mkCompose();
  compose.replyTo = replyTo;
  compose.edit = edit;
  compose.quote = quote;
  compose.key = crypto.randomUUID();
  $('#compose-error').textContent = '';
  setCw(false);
  closeVisMenu();
  const note = $('#reply-to');
  $('#text').disabled = false;
  $('#vis-menu').parentElement.hidden = !!edit;
  if (edit) {
    $('#text').value = '';
    $('#text').disabled = true;
    compose.lang = edit.language || '';
    compose.sensitive = !!edit.sensitive;
    compose.media = (edit.media_attachments || []).map((m) => ({ id: m.id, preview: m.preview_url || m.url, description: m.description || '', uploading: false, type: m.type, existing: true }));
    note.textContent = 'Editando publicação';
    note.hidden = false;
    api(`/api/v1/statuses/${edit.id}/source`).then((src) => {
      $('#text').value = src.text || '';
      $('#text').disabled = false;
      if (src.spoiler_text) { setCw(true); $('#cw').value = src.spoiler_text; }
      updateCount();
      $('#text').focus();
    }).catch((err) => { $('#compose-error').textContent = err.message; });
  } else if (replyTo) {
    const me = session.account.acct;
    const who = [...new Set([replyTo.account.acct, ...(replyTo.mentions || []).map((m) => m.acct)])].filter((x) => x !== me);
    $('#text').value = who.map((x) => `@${x}`).join(' ') + (who.length ? ' ' : '');
    setVisibility(replyTo.visibility);
    note.textContent = `Respondendo a @${replyTo.account.acct}`;
    note.hidden = false;
  } else if (quote) {
    $('#text').value = '';
    setVisibility(quote.visibility === 'public' ? (prefs.defaultVis || store.get('lastVisibility', 'public')) : quote.visibility);
    note.textContent = `Citando @${quote.account.acct}: ${plainText(quote.content).slice(0, 80)}`;
    note.hidden = false;
  } else {
    let d = store.get(draftKey(), '');
    if (typeof d === 'string') d = { text: d };
    $('#text').value = (d && d.text) || '';
    // um compartilhamento é uma publicação nova: não herda aviso de conteúdo nem enquete do rascunho antigo
    if (d && d.cw && !share) { setCw(true); $('#cw').value = d.cw; }
    if (d && d.poll && !share && (d.poll.options || []).some((o) => (o || '').trim())) compose.poll = d.poll;
    if (d && d.lang != null) compose.lang = d.lang;
    setVisibility(prefs.defaultVis || store.get('lastVisibility', 'public'));
    note.hidden = true;
    if (share) { const cur = $('#text').value.trimEnd(); $('#text').value = cur ? `${cur}\n\n${share}` : share; saveDraft(); }
  }
  renderComposeExtras();
  updateCount();
  $('#composer').showModal();
  fitComposer();
  fitText();
  const t = $('#text');
  if (!edit) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
}

// Anexos, enquete, idioma e botões que dependem deles
function renderComposeExtras() {
  const box = $('#compose-media');
  box.hidden = compose.media.length === 0;
  box.replaceChildren(...compose.media.map((m, i) => {
    const thumb = h('div', { class: `cm-item${m.uploading ? ' loading' : ''}` },
      m.type === 'video' || m.type === 'gifv' ? h('div', { class: 'cm-video' }, '▶') : h('img', { src: m.preview, alt: m.description || 'Anexo' }),
      m.uploading ? h('span', { class: 'cm-spin' }, svgIcon('refresh', 20)) : null,
      h('button', { type: 'button', class: 'cm-x', 'aria-label': 'Remover anexo', onclick: () => removeMedia(i) }, svgIcon('close', 14)),
      h('button', { type: 'button', class: `cm-alt${m.description ? ' set' : ''}`, disabled: m.uploading, 'aria-label': 'Descrição para acessibilidade', onclick: () => editAlt(m) }, 'ALT'));
    return thumb;
  }));
  $('#sens-btn').hidden = compose.media.length === 0;
  const sb = $('#sched-btn');
  if (sb) { sb.hidden = !!compose.edit; sb.classList.toggle('active', !!compose.scheduledAt); sb.setAttribute('aria-pressed', compose.scheduledAt ? 'true' : 'false'); sb.title = compose.scheduledAt ? `Agendada para ${new Date(compose.scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Agendar publicação'; }
  $('#sens-btn').setAttribute('aria-pressed', compose.sensitive ? 'true' : 'false');
  $('#sens-btn').classList.toggle('active', compose.sensitive);
  $('#media-btn').disabled = !!compose.poll || compose.media.length >= limits.maxMedia || (compose.edit && !!compose.edit.poll);
  const pollOk = !compose.media.length && !compose.edit;
  $('#poll-btn').disabled = !pollOk;
  $('#poll-btn').setAttribute('aria-pressed', compose.poll ? 'true' : 'false');
  renderPollEditor();
  const l = LANGS.find(([c]) => c === compose.lang);
  const lb = $('#lang-btn');
  lb.replaceChildren(...[svgIcon('language', 22), compose.lang ? h('span', { class: 'tool-badge' }, compose.lang.toUpperCase()) : null].filter(Boolean));
  lb.setAttribute('aria-pressed', compose.lang ? 'true' : 'false');
  lb.title = l ? l[1] : compose.lang;
}

function renderPollEditor() {
  const box = $('#compose-poll');
  const p = compose.poll;
  box.hidden = !p;
  if (!p) { box.replaceChildren(); return; }
  const durations = [[300, '5 min'], [1800, '30 min'], [3600, '1 h'], [21600, '6 h'], [86400, '1 dia'], [259200, '3 dias'], [604800, '7 dias']]
    .filter(([s]) => s >= limits.pollMin && s <= limits.pollMax);
  if (!durations.some(([s]) => s === p.expires_in)) p.expires_in = (durations[Math.min(4, durations.length - 1)] || [86400])[0];
  box.replaceChildren(
    ...p.options.map((t, i) => {
      const input = h('input', { value: t, maxlength: String(limits.pollChars), placeholder: `Opção ${i + 1}`, 'aria-label': `Opção ${i + 1}` });
      input.addEventListener('input', () => { p.options[i] = input.value; saveDraft(); });
      return h('div', { class: 'cp-opt' }, input,
        p.options.length > 2 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remover opção', onclick: () => { p.options.splice(i, 1); renderPollEditor(); saveDraft(); } }, svgIcon('close', 16)) : null);
    }),
    h('div', { class: 'cp-row' },
      p.options.length < limits.pollOptions ? h('button', { type: 'button', class: 'chip', onclick: () => { p.options.push(''); renderPollEditor(); } }, '+ Opção') : null,
      h('button', { type: 'button', class: `chip${p.multiple ? ' active' : ''}`, 'aria-pressed': p.multiple ? 'true' : 'false', onclick: () => { p.multiple = !p.multiple; renderPollEditor(); saveDraft(); } }, 'Múltipla escolha')),
    h('div', { class: 'cp-row', role: 'group', 'aria-label': 'Duração' }, ...durations.map(([s, label]) =>
      h('button', { type: 'button', class: `chip${p.expires_in === s ? ' active' : ''}`, 'aria-pressed': p.expires_in === s ? 'true' : 'false', onclick: () => { p.expires_in = s; renderPollEditor(); saveDraft(); } }, label))));
}

function togglePoll() {
  compose.poll = compose.poll ? null : { options: ['', ''], expires_in: 86400, multiple: false };
  renderComposeExtras();
  saveDraft();
  if (compose.poll) { const f = $('#compose-poll input'); if (f) f.focus(); }
}

function removeMedia(i) {
  const m = compose.media[i];
  if (m && m.preview && m.preview.startsWith('blob:')) URL.revokeObjectURL(m.preview);
  compose.media.splice(i, 1);
  renderComposeExtras();
}

function editAlt(m) {
  const t = h('textarea', { class: 'sheet-text', rows: '5', maxlength: '1500', placeholder: 'Descreva a imagem para quem não pode vê-la', 'aria-label': 'Descrição' }, m.description || '');
  openSheet('Descrição da mídia', [{ label: 'Salvar descrição', icon: 'check', onclick: async () => {
    m.description = t.value.trim();
    renderComposeExtras();
    if (m.id && !m.existing) { try { await api(`/api/v1/media/${m.id}`, { method: 'PUT', body: { description: m.description } }); } catch (e) { toast(e.message); } }
  } }], h('div', { class: 'sheet-form' }, t));
}

// Fotos grandes: reduz antes de enviar (envio mais rápido e dentro do limite da instância)
async function shrinkImage(file, maxEdge = 2400) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.88));
  return blob || file;
}

async function waitMedia(m) {
  for (let n = 0; n < 60; n++) {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await api(`/api/v1/media/${m.id}`);
    if (r && r.url) return r;
  }
  throw new Error('O processamento do vídeo demorou demais.');
}

async function addMedia(files) {
  for (const file of files) {
    if (compose.media.length >= limits.maxMedia) { toast(`Máximo de ${limits.maxMedia} anexos.`); break; }
    const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
    const item = { id: null, uploading: true, preview: URL.createObjectURL(file), description: '', type };
    compose.media.push(item);
    renderComposeExtras();
    try {
      const f = type === 'image' && file.type !== 'image/gif' && file.size > 2 * 1024 * 1024 ? await shrinkImage(file) : file;
      const fd = new FormData();
      fd.append('file', f, f.name || (type === 'image' ? 'foto.jpg' : 'arquivo'));
      const r = await api('/api/v2/media', { method: 'POST', form: fd });
      item.id = r.id;
      if (!r.url) await waitMedia(item);
      item.uploading = false;
    } catch (e) {
      const i = compose.media.indexOf(item);
      if (i >= 0) compose.media.splice(i, 1);
      toast(e.message);
    }
    renderComposeExtras();
  }
}

function langSheet() {
  openSheet('Idioma da publicação', LANGS.map(([code, label]) => ({
    label, icon: code === compose.lang ? 'check' : null,
    onclick: () => { compose.lang = code; store.set('lang', code); renderComposeExtras(); saveDraft(); },
  })));
}

function scheduleSheet() {
  const pad = (n) => String(n).padStart(2, '0');
  const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const min = new Date(Date.now() + 6 * 60000);
  const input = h('input', { type: 'datetime-local', class: 'sheet-text', 'aria-label': 'Data e hora', min: local(min),
    value: compose.scheduledAt ? local(new Date(compose.scheduledAt)) : local(new Date(Date.now() + 3600000)) });
  const err = h('p', { class: 'error small' });
  openSheet('Agendar publicação', [{
    label: 'Agendar', icon: 'clock',
    keepOpen: true,
    onclick: () => {
      const d = new Date(input.value);
      if (!input.value || isNaN(d) || d.getTime() < Date.now() + 5 * 60000) { err.textContent = 'Escolha um horário a pelo menos 5 minutos daqui.'; return false; }
      compose.scheduledAt = d.toISOString(); renderComposeExtras(); return true;
    },
  }, compose.scheduledAt ? { label: 'Remover agendamento', icon: 'close', onclick: () => { compose.scheduledAt = ''; renderComposeExtras(); } } : null].filter(Boolean),
  h('div', { class: 'sheet-form' }, input, err));
}

function fitText() {
  const t = $('#text');
  t.style.height = 'auto';
  t.style.height = `${Math.max(140, t.scrollHeight + 2)}px`; // cresce com o texto; quem rola é o corpo do formulário
}

/* ----- Autocompletar @menções, #hashtags e :emojis: ----- */

const suggest = { seq: 0, timer: null, emojis: null, emojiLoad: null };

function hideSuggest() {
  suggest.seq++;
  clearTimeout(suggest.timer);
  const box = $('#suggest');
  box.hidden = true;
  box.replaceChildren();
}

function suggestToken() {
  const t = $('#text');
  const pos = t.selectionStart;
  if (pos == null || pos !== t.selectionEnd) return null;
  const m = /(^|[\s(])([@#:])([\p{L}\p{N}_.@\-]*)$/u.exec(t.value.slice(0, pos));
  if (!m) return null;
  const kind = m[2], q = m[3];
  if (kind === ':' && q.length < 2) return null;
  if (kind === '@' && q.length < 1) return null;
  if (kind === '#' && q.length < 1) return null;
  return { kind, q, start: pos - q.length - 1, end: pos };
}

async function loadEmojis() {
  if (suggest.emojis) return suggest.emojis;
  if (!suggest.emojiLoad) suggest.emojiLoad = api('/api/v1/custom_emojis').then((l) => { suggest.emojis = l.filter((e) => e.visible_in_picker !== false); return suggest.emojis; }).catch(() => { suggest.emojis = []; return []; });
  return suggest.emojiLoad;
}

function suggestUpdate() {
  const tok = suggestToken();
  if (!tok || !$('#composer').open) { hideSuggest(); return; }
  const seq = ++suggest.seq;
  clearTimeout(suggest.timer);
  suggest.timer = setTimeout(async () => {
    let items = [];
    try {
      if (tok.kind === '@') {
        const r = await api('/api/v1/accounts/search', { params: { q: tok.q, limit: 6, resolve: false } });
        items = r.map((x) => ({ insert: `@${x.acct}`, label: nameNode(x), sub: `@${x.acct}`, img: x.avatar_static || x.avatar, round: true }));
      } else if (tok.kind === '#') {
        const r = await api('/api/v2/search', { params: { q: tok.q, type: 'hashtags', limit: 6 } });
        items = (r.hashtags || []).map((x) => ({ insert: `#${x.name}`, label: `#${x.name}`, sub: '' }));
        if (!items.some((i) => i.insert.toLowerCase() === `#${tok.q.toLowerCase()}`)) items.push({ insert: `#${tok.q}`, label: `#${tok.q}`, sub: '' });
      } else {
        const q = tok.q.toLowerCase();
        const all = await loadEmojis();
        const starts = all.filter((e) => e.shortcode.toLowerCase().startsWith(q));
        const has = all.filter((e) => !e.shortcode.toLowerCase().startsWith(q) && e.shortcode.toLowerCase().includes(q));
        items = starts.concat(has).slice(0, 8).map((e) => ({ insert: `:${e.shortcode}:`, label: `:${e.shortcode}:`, sub: '', img: e.static_url || e.url }));
      }
    } catch { items = []; }
    if (seq !== suggest.seq) return; // chegou depois de o texto mudar
    const box = $('#suggest');
    if (!items.length) { box.hidden = true; box.replaceChildren(); return; }
    box.replaceChildren(...items.map((it) => h('button', { type: 'button', class: 'sg-item', onclick: () => suggestPick(tok, it) },
      it.img ? h('img', { class: it.round ? 'avatar' : 'emoji-img', src: safeUrl(it.img), alt: '' }) : null,
      h('span', { class: 'sg-text' }, h('strong', {}, it.label), it.sub ? h('span', { class: 'muted small' }, it.sub) : null))));
    box.hidden = false;
    box.scrollLeft = 0;
  }, tok.kind === ':' ? 0 : 180);
}

function suggestPick(tok, it) {
  const t = $('#text');
  const cur = suggestToken(); // o texto pode ter mudado desde a busca
  const at = cur && cur.kind === tok.kind ? cur : tok;
  const after = t.value.slice(at.end);
  const ins = it.insert + (after.startsWith(' ') ? '' : ' ');
  t.value = t.value.slice(0, at.start) + ins + after;
  const caret = at.start + it.insert.length + 1;
  t.setSelectionRange(caret, caret);
  hideSuggest();
  t.dispatchEvent(new Event('input'));
  t.focus();
}

function updateCount() {
  const t = $('#text');
  fitText();
  $('#count').textContent = `${t.value.length}/${t.maxLength}`;
}

const VIS = [
  ['public', 'Pública', 'Todos veem e aparece nas timelines'],
  ['unlisted', 'Não listada', 'Todos veem, mas fica fora das timelines públicas'],
  ['private', 'Só seguidores', 'Apenas quem segue você'],
  ['direct', 'Menção direta', 'Apenas as pessoas mencionadas'],
];
let composeVis = 'public';

function setVisibility(v) {
  composeVis = VIS.some(([id]) => id === v) ? v : 'public';
  $('#vis-btn').replaceChildren(svgIcon('vis-' + composeVis, 22), svgIcon('chev', 14));
  $('#vis-btn').title = VIS.find(([id]) => id === composeVis)[1];
  $('#vis-menu').replaceChildren(...VIS.map(([id, label, desc]) =>
    h('button', {
      type: 'button', role: 'menuitemradio', 'aria-checked': id === composeVis ? 'true' : 'false',
      onclick: () => { setVisibility(id); closeVisMenu(); $('#text').focus(); },
    }, svgIcon('vis-' + id, 22), h('span', {}, label, h('small', {}, desc)), id === composeVis ? svgIcon('check', 18) : h('span'))));
}

function closeVisMenu() {
  $('#vis-menu').hidden = true;
  $('#vis-btn').setAttribute('aria-expanded', 'false');
}

function setCw(on) {
  const cw = $('#cw');
  cw.hidden = !on;
  if (!on) cw.value = '';
  $('#cw-btn').setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on) cw.focus();
}

// No iOS, ao abrir o teclado a janela visível encolhe e desloca; acompanhamos para o
// cabeçalho (Cancelar/Publicar) não ficar sob a barra de status.
// Arrastar a alça para baixo fecha o compositor (o rascunho fica guardado); tocar nela também fecha.
function bindComposerSwipe() {
  // com o compositor aberto, a página de trás não rola nem "estica": só o texto pode rolar
  document.addEventListener('touchmove', (e) => {
    if (!$('#composer').open) return;
    const ta = e.target.closest && e.target.closest('#text');
    if (ta && ta.scrollHeight > ta.clientHeight) return;
    const cb = e.target.closest && e.target.closest('#compose-body');
    if (cb && cb.scrollHeight > cb.clientHeight) return;
    e.preventDefault();
  }, { passive: false });
  const dlg = $('#composer');
  const head = $('#compose-head');
  let y0 = null, dy = 0, moved = false, t0 = 0;
  const reset = () => { dlg.style.transform = ''; dlg.classList.remove('dragging', 'settling'); };
  head.addEventListener('pointerdown', (e) => {
    y0 = e.clientY; dy = 0; moved = false; t0 = e.timeStamp;
    head.setPointerCapture(e.pointerId);
    dlg.classList.remove('settling');
    dlg.classList.add('dragging');
  });
  head.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    if (dy > 6) moved = true;
    dlg.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (y0 == null) return;
    const fast = dy / Math.max(1, e.timeStamp - t0) > 0.5; // px/ms
    y0 = null;
    if (!moved && e.type === 'pointerup') { reset(); dlg.close(); return; } // toque simples
    if (moved && (dy > 110 || (fast && dy > 40))) {
      dlg.classList.remove('dragging');
      dlg.classList.add('settling');
      dlg.style.transform = 'translateY(100%)';
      setTimeout(() => { dlg.close(); reset(); }, 200);
    } else {
      dlg.classList.remove('dragging');
      dlg.classList.add('settling');
      dlg.style.transform = '';
      setTimeout(reset, 240);
    }
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
  // acessibilidade (teclado/leitor de tela): Enter/espaço disparam click sem pointer events
  $('#cancel-compose').addEventListener('click', (e) => { if (e.detail === 0) dlg.close(); });
}

function fitComposer() {
  const d = $('#composer');
  const vv = window.visualViewport;
  if (!d.open || !vv) return;
  d.style.top = `${vv.offsetTop}px`;
  d.style.height = `${vv.height}px`;
  d.classList.toggle('kb', window.innerHeight - vv.height > 120);
}

async function submitCompose(e) {
  e.preventDefault();
  const text = $('#text').value.trim();
  const poll = compose.poll && { ...compose.poll, options: compose.poll.options.map((o) => o.trim()).filter(Boolean) };
  if (!text && !compose.media.length && !poll) return;
  if (poll && poll.options.length < 2) { $('#compose-error').textContent = 'A enquete precisa de pelo menos duas opções.'; return; }
  if (compose.media.some((m) => m.uploading)) { $('#compose-error').textContent = 'Aguarde o envio dos anexos terminar.'; return; }
  const btn = $('#post-btn');
  btn.disabled = true;
  $('#compose-error').textContent = '';
  const cw = (!$('#cw').hidden && $('#cw').value.trim()) || undefined;
  try {
    let saved;
    if (compose.edit) {
      saved = await api(`/api/v1/statuses/${compose.edit.id}`, { method: 'PUT', body: {
        status: text, spoiler_text: cw || '', sensitive: compose.media.length ? compose.sensitive : false,
        language: compose.lang || undefined, media_ids: compose.media.map((m) => m.id),
        media_attributes: compose.media.map((m) => ({ id: m.id, description: m.description })),
      } });
      replaceStatus(saved);
    } else {
      await api('/api/v1/statuses', {
        method: 'POST',
        headers: { 'Idempotency-Key': compose.key },
        body: {
          status: text || undefined,
          spoiler_text: cw,
          visibility: composeVis,
          in_reply_to_id: compose.replyTo ? compose.replyTo.id : undefined,
          quoted_status_id: compose.quote ? compose.quote.id : undefined,
          media_ids: compose.media.length ? compose.media.map((m) => m.id) : undefined,
          sensitive: compose.media.length && compose.sensitive ? true : undefined,
          poll: poll ? { options: poll.options, expires_in: poll.expires_in, multiple: poll.multiple } : undefined,
          language: compose.lang || undefined,
          scheduled_at: compose.scheduledAt || undefined,
        },
      });
      if (!compose.replyTo && !compose.quote) { store.del(draftKey()); store.set('lastVisibility', composeVis); }
    }
    $('#composer').close();
    toast(compose.edit ? 'Publicação editada' : compose.scheduledAt ? `Agendada para ${new Date(compose.scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Publicado');
    if (activeThread()) loadThread(activeThread());
    else if (!compose.edit && !compose.scheduledAt && state.tab === 'home' && !state.homeList) loadList('home');
  } catch (err) {
    $('#compose-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// Trocar/remover uma publicação em todas as listas já carregadas
function eachStatusList(fn) {
  const lists = ['home', 'local', 'global', 'tag', 'listTl', 'other'].map((k) => state[k]);
  [state.me, ...state.profiles].forEach((p) => {
    if (!p || p.type) return;
    lists.push(p.posts, p.replies, p.media, p.bookmarks, p.favourites);
  });
  lists.filter(Boolean).forEach(fn);
}

function replaceStatus(u) {
  const swap = (s) => (s.id === u.id ? u : (s.reblog && s.reblog.id === u.id ? { ...s, reblog: u } : s));
  eachStatusList((l) => { l.items = l.items.map(swap); });
  state.notifications.items = state.notifications.items.map((n) => (n.status ? { ...n, status: swap(n.status) } : n));
  [state.me, ...state.profiles].forEach((p) => {
    if (!p) return;
    if (p.type === 'thread') { p.status = swap(p.status); p.ancestors = p.ancestors.map(swap); p.descendants = p.descendants.map(swap); }
    else if (p.pinned) p.pinned = p.pinned.map(swap);
  });
  render();
}

function removeStatus(id) {
  const keep = (s) => s.id !== id && !(s.reblog && s.reblog.id === id);
  eachStatusList((l) => { l.items = l.items.filter(keep); });
  state.notifications.items = state.notifications.items.filter((n) => !n.status || keep(n.status));
  [state.me, ...state.profiles].forEach((p) => {
    if (!p) return;
    if (p.type === 'thread') { p.ancestors = p.ancestors.filter(keep); p.descendants = p.descendants.filter(keep); }
    else if (p.pinned) p.pinned = p.pinned.filter(keep);
  });
  const t = activeThread();
  if (t && t.status.id === id) { closeProfile(); return; }
  render();
}

/* ---------- App / PWA ---------- */

async function updateApp() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    for (const k of await caches.keys()) await caches.delete(k);
  } catch { /* segue para o reload */ }
  location.reload();
}

async function startApp() {
  appStarted = true;
  showApp();
  // aberto pelo toque numa notificação push
  const go = new URL(location.href).searchParams.get('go');
  if (go) history.replaceState(null, '', location.pathname);
  selectTab(go === 'notifications' ? 'notifications' : 'home');
  checkUnread();
  scheduleQuickHealth(3000);
  const shared = store.get('share');
  if (shared) { store.del('share'); openComposer({ share: shared }); }
  try {
    const res = await fetch(`https://${session.host}/api/v2/instance`);
    const cfg = (await res.json())?.configuration || {};
    if (cfg.urls?.streaming) live.base = cfg.urls.streaming;
    limits.translation = !!cfg.translation?.enabled;
    if (cfg.statuses?.max_characters) { limits.maxChars = cfg.statuses.max_characters; $('#text').maxLength = limits.maxChars; }
    if (cfg.statuses?.max_media_attachments) limits.maxMedia = cfg.statuses.max_media_attachments;
    if (cfg.polls) limits = { ...limits, pollOptions: cfg.polls.max_options || 4, pollChars: cfg.polls.max_characters_per_option || 50, pollMin: cfg.polls.min_expiration || 300, pollMax: cfg.polls.max_expiration || 2629746 };
  } catch { /* mantém os padrões */ }
  if (limits.translation && session) render();
  liveConnect();
}

function bindUi() {
  hydrateIcons();
  $('#login-form').addEventListener('submit', (e) => { e.preventDefault(); startLogin(false); });
  $('#manual-start').addEventListener('click', () => startLogin(true));
  $('#login-cancel').addEventListener('click', () => { if (!session) return; showApp(); if (!appStarted) startApp(); });
  $('#manual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.textContent = '';
    const code = $('#manual-code').value.trim();
    const pending = store.get('pending');
    if (!pending || !pending.manual) { err.textContent = 'Toque primeiro em “Abrir autorização manual”.'; return; }
    if (!code) { err.textContent = 'Cole o código exibido pela instância.'; return; }
    try {
      await finishLogin(code, pending, OOB);
      startApp();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });

  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  bindPullToRefresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { saveScroll(); liveClose(); live.wasHidden = true; } else { checkUnread(); liveConnect(); scheduleQuickHealth(); }
  });
  window.addEventListener('offline', () => scheduleQuickHealth(100));
  window.addEventListener('online', () => { scheduleQuickHealth(500); if (!live.ws) { live.tries = 0; liveConnect(); } });
  $('#new-pill').addEventListener('click', showNewPosts);
  window.addEventListener('pagehide', saveScroll);
  window.addEventListener('scroll', scheduleMarker, { passive: true });
  // elementos clicáveis com role="button" (avatares, nomes) também respondem a Enter/espaço (teclado, VoiceOver)
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"]:not(button)')) {
      e.preventDefault();
      e.target.click();
    }
  });
  store.del('draft'); // rascunho antigo, sem dono: agora é guardado por conta
  document.addEventListener('keydown', shortcutKey);
  const sheet = $('#sheet');
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open-notifications' && session) { selectTab('notifications'); loadList('notifications'); }
    });
  }
  $('#view').addEventListener('click', (e) => {
    // toque numa publicação (fora de links, botões, mídia e avisos de conteúdo) abre a conversa
    const card = e.target.closest && e.target.closest('.status');
    if (card && card._status && !card.classList.contains('focal')
        && !e.target.closest('a, button, summary, video, audio, .media, .who-link, .link-name, input')
        && !(window.getSelection && String(window.getSelection()))) {
      openThread(card._status, card._host);
      return;
    }
    const el = e.target.closest && e.target.closest('a.mention, a.hashtag');
    if (!el) return;
    if (el.classList.contains('hashtag')) {
      e.preventDefault();
      const name = (el.textContent || '').replace(/^#/, '').trim();
      if (name) openTag(name);
      return;
    }
    // menção: abre o perfil dentro do app; sem correspondência, o link segue normal
    const art = el.closest('.status');
    const st = art && art._status;
    const strip = (u) => String(u || '').replace(/\/$/, '');
    const m = st && (st.mentions || []).find((x) => strip(x.url) === strip(el.href));
    if (!m) return;
    e.preventDefault();
    openProfileByAcct(art._host && !m.acct.includes('@') ? `${m.acct}@${art._host}` : m.acct);
  });
  $('#fab').addEventListener('click', () => openComposer());
  bindComposerSwipe();
  bindDock();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitComposer);
    window.visualViewport.addEventListener('scroll', fitComposer);
  }
  $('#composer').addEventListener('close', () => { closeVisMenu(); hideSuggest(); });
  // não deixa os botões da barra tirarem o foco do texto (o teclado não fecha)
  $('#compose-tools').addEventListener('pointerdown', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  $('#vis-btn').addEventListener('click', () => {
    const open = $('#vis-menu').hidden;
    $('#vis-menu').hidden = !open;
    $('#vis-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('#cw-btn').addEventListener('click', () => { setCw($('#cw').hidden); saveDraft(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeVisMenu(); });
  $('#compose-form').addEventListener('submit', submitCompose);
  $('#text').addEventListener('input', () => { updateCount(); saveDraft(); suggestUpdate(); });
  $('#text').addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) suggestUpdate(); });
  $('#text').addEventListener('click', suggestUpdate);
  $('#suggest').addEventListener('pointerdown', (e) => e.preventDefault());
  $('#cw').addEventListener('input', saveDraft);
  $('#media-btn').addEventListener('click', () => $('#media-input').click());
  $('#media-input').addEventListener('change', (ev) => { const fs = [...ev.target.files]; ev.target.value = ''; addMedia(fs); });
  $('#poll-btn').addEventListener('click', togglePoll);
  $('#lang-btn').addEventListener('click', langSheet);
  $('#sched-btn').addEventListener('click', scheduleSheet);
  $('#sens-btn').addEventListener('click', () => { compose.sensitive = !compose.sensitive; renderComposeExtras(); });
}

// Recebe texto/link de outros apps: ?text=…&url=…&title=… (Android via share_target; iOS via Atalhos)
function sharedText(params) {
  if (params.has('code') || params.has('error')) return '';
  const title = (params.get('title') || '').trim();
  const text = (params.get('text') || '').trim();
  const url = (params.get('url') || '').trim();
  const out = [];
  if (title && title !== text && !text.includes(title)) out.push(title);
  if (text) out.push(text);
  if (url && !text.includes(url)) out.push(url);
  return out.join('\n').slice(0, 5000);
}

async function boot() {
  applyPrefs();
  bindUi();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const params = new URLSearchParams(location.search);
  const shared = sharedText(params);
  if (shared) { store.set('share', shared); ['title', 'text', 'url'].forEach((k) => params.delete(k)); history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '')); }
  if (params.has('code') || params.has('error')) await handleCallback(params);
  session = session || store.get('session');
  if (session && session.token) { persistSession(); startApp(); }
  else showLogin($('#login-error').textContent);
}

boot();

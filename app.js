import {
  OOB, b64url, randomString, pkceChallenge, normalizeHost,
  sanitizeHtml, emojiFragment, safeUrl, timeAgo, h, svgIcon, sparkline, parseNextMaxId,
} from './lib.js';

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

let session = null; // { host, token, account }

const mkSearch = () => ({ q: '', type: '', res: null, loading: false, error: null, more: false });
const mkList = () => ({ items: [], more: true, loading: false, error: null });
const mkState = () => ({
  tab: 'home',
  home: mkList(),
  notifications: mkList(),
  local: mkList(),
  global: mkList(),
  other: mkList(),
  tag: mkList(),
  search: mkSearch(),
  trends: { tags: [], statuses: [], loading: false, error: null, loaded: false },
  profiles: [],        // pilha de telas (perfis, conversas, listas) abertas por cima da aba atual
  lists: { items: [], loaded: false, loading: false, error: null },
  homeList: null,      // id da lista exibida no Início (null = timeline principal)
  listTl: mkList(),
  me: null,            // perfil da aba Conta
  settingsOpen: false,
  explore: {
    seg: store.get('seg', 'local'),
    tag: null,
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

function showLogin(message = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').textContent = message;
  const last = store.get('lastHost');
  if (last) $('#instance').value = last;
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
  store.set('session', session);
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

async function logout({ revoke = true, message = '' } = {}) {
  if (session && revoke) {
    const app = store.get('app.' + session.host);
    if (app) {
      try {
        await postForm(`https://${session.host}/oauth/revoke`, {
          client_id: app.client_id, client_secret: app.client_secret, token: session.token,
        });
      } catch { /* segue mesmo se falhar */ }
    }
  }
  clearCaches();
  store.del('session');
  session = null;
  state = mkState();
  showLogin(message);
}

/* ---------- API ---------- */

async function api(path, { method = 'GET', params, body, headers = {}, host, auth = true, onHeaders } = {}) {
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
  if (body) {
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

async function toggle(btn, sh, kind) {
  const isBoost = kind === 'boost';
  const was = isBoost ? sh.reblogged : sh.favourited;
  const verb = isBoost ? (was ? 'unreblog' : 'reblog') : (was ? 'unfavourite' : 'favourite');
  btn.disabled = true;
  try {
    const r = await api(`/api/v1/statuses/${sh.id}/${verb}`, { method: 'POST' });
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
      : h('button', { type: 'button', class: `sheet-item${it.danger ? ' danger' : ''}`, onclick: async () => { d.close(); await it.onclick(); } }, it.icon ? svgIcon(it.icon, 20) : null, it.label)),
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

function moderationItems(account, rel, status) {
  const muted = rel && rel.muting;
  const blocked = rel && rel.blocking;
  return [
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
  items.push({ label: 'Copiar link', icon: 'copy', onclick: async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { toast(url); }
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

function mediaEl(sh) {
  const items = (sh.media_attachments || []).filter((m) => safeUrl(m.url));
  if (!items.length) return null;
  const wrap = h('div', { class: `media${items.length === 1 ? ' one' : ''}${sh.sensitive && !prefs.showSensitive ? ' sensitive' : ''}` });
  for (const m of items) {
    const src = safeUrl(m.url);
    const preview = safeUrl(m.preview_url || '');
    let node;
    if (m.type === 'image') {
      node = h('img', { src: preview || src, alt: m.description || '', loading: 'lazy' });
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

function statusEl(s, { readonly = false, host = null } = {}) {
  const sh = s.reblog || s;
  const a = sh.account;
  const el = h('article', { class: 'status', 'data-id': sh.id });
  el._status = sh;
  el._host = host;

  if (s.reblog) {
    el.append(h('div', { class: 'boost-note' }, svgIcon('boost', 14), ' ', h('span', { class: 'link-name', role: 'button', tabindex: '0', onclick: () => openAccountFrom(s.account, host) }, nameNode(s.account)), ' impulsionou'));
  }

  el.append(h('header', {},
    h('div', { class: 'who-link', role: 'button', tabindex: '0', 'aria-label': `Abrir perfil de ${a.acct}`, onclick: () => openAccountFrom(a, host) },
      h('img', { class: 'avatar', src: safeUrl(a.avatar_static || a.avatar), alt: '', loading: 'lazy' }),
      h('div', { class: 'who' },
        h('div', { class: 'name' }, nameNode(a)),
        h('span', { class: 'acct' }, '@' + a.acct))),
    h('time', { datetime: sh.created_at, title: new Date(sh.created_at).toLocaleString('pt-BR') }, timeAgo(sh.created_at)),
  ));

  const body = h('div', { class: 'body' });
  body.append(sanitizeHtml(sh.content, sh.emojis));
  const parts = [body];
  const media = mediaEl(sh);
  if (media) parts.push(media);
  if (sh.poll) parts.push(h('p', { class: 'muted small' }, '📊 Enquete — abra no site para votar.'));

  if (sh.spoiler_text) {
    const summary = h('summary', {}, emojiFragment(sh.spoiler_text, sh.emojis));
    el.append(h('details', { class: 'cw', open: prefs.openCw || null }, summary, ...parts));
  } else {
    el.append(...parts);
  }

  const canBoost = sh.visibility === 'public' || sh.visibility === 'unlisted';
  const boostBtn = actionButton('boost', 'boost', sh.reblogs_count, sh.reblogged, (e) => toggle(e.currentTarget, sh, 'boost'), 'Impulsionar');
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

function notifEl(n) {
  const wrap = h('div', { class: 'notif' });
  wrap.append(h('div', { class: 'notif-kind' },
    h('strong', { class: 'link-name', role: 'button', tabindex: '0', onclick: () => openProfile(n.account) }, nameNode(n.account)),
    ' ', NOTIF_KINDS[n.type] || n.type, ' · ', timeAgo(n.created_at)));
  if (n.status) wrap.append(statusEl(n.status));
  else wrap.append(accountRow(n.account));
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

function saveCache(kind) {
  if (!session || !CACHE_KINDS.includes(kind)) return;
  const st = state[kind];
  if (st.cached) return; // ainda mostrando o que veio do cache: não regrava por cima
  store.set(cacheKey(kind), { at: Date.now(), items: st.items.slice(0, CACHE_MAX) });
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

function clearCaches() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('pq.cache.') || k.startsWith('pq.scroll.')).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignora */ }
}

function saveScroll() {
  if (!session || state.profiles.length) return;
  const kind = state.tab === 'home' && !state.homeList ? 'home' : state.tab === 'notifications' ? 'notifications' : null;
  if (kind) store.set(`scroll.${kind}`, Math.round(window.scrollY));
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
    store.set(cacheKey(kind), { at: Date.now(), items: st.items.slice(0, CACHE_MAX) });
    if (kind === 'notifications' && state.tab === 'notifications') markNotificationsRead();
  } catch (e) {
    st.error = e.message; // segue mostrando o que está guardado
  } finally {
    st.loading = false;
    if (session) {
      render();
      if (st.cleanSlate) { st.cleanSlate = false; window.scrollTo(0, 0); }
      else window.scrollTo(0, y0 + (document.documentElement.scrollHeight - h0)); // mantém o ponto de leitura
    }
  }
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
    const local = store.get('seenNotif');
    if (!marker && !local) { store.set('seenNotif', newest); setUnread(false); return; } // primeira vez: não toca por avisos antigos
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
  store.set('seenNotif', newest);
  api('/api/v1/markers', { method: 'POST', body: { notifications: { last_read_id: newest } } }).catch(() => {});
}

/* ---------- Preferências ---------- */

const PREF_DEFAULTS = { theme: 'auto', textSize: 100, motion: 'auto', showSensitive: false, openCw: false, defaultVis: '' };
let prefs = { ...PREF_DEFAULTS, ...store.get('prefs', {}) };

function applyPrefs() {
  const root = document.documentElement;
  if (prefs.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = prefs.theme;
  if (prefs.motion === 'reduce') root.dataset.motion = 'reduce'; else root.removeAttribute('data-motion');
  root.style.setProperty('--text-adjust', `${prefs.textSize}%`);
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && !(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#14121c' : '#f7f5fc';
}

function setPref(key, value) {
  prefs[key] = value;
  store.set('prefs', prefs);
  applyPrefs();
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
    prefSwitch('Abrir avisos de conteúdo já expandidos', 'openCw'));
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

function homeView(view) {
  const L = state.lists;
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
    const [acct, rels, pinned] = await Promise.all([
      api(`/api/v1/accounts/${p.id}`),
      self ? Promise.resolve(null) : api('/api/v1/accounts/relationships', { params: { 'id[]': [p.id] } }),
      api(`/api/v1/accounts/${p.id}/statuses`, { params: { pinned: 'true' } }).catch(() => []),
    ]);
    p.pinned = pinned;
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

function settingsView(view) {
  view.append(profileBar('Configurações', () => { state.settingsOpen = false; window.scrollTo(0, 0); render(); }));
  view.append(h('div', { class: 'account-card' },
    h('div', { class: 'muted' }, `Conectado como @${session.account.acct}@${session.host}`),
    h('a', { href: `https://${session.host}/settings/profile`, target: '_blank', rel: 'noopener noreferrer' }, 'Editar perfil e preferências na instância'),
    h('button', { type: 'button', class: 'with-icon', onclick: updateApp }, svgIcon('refresh', 18), 'Atualizar o app (limpar cache)'),
    h('button', { type: 'button', class: 'with-icon', onclick: () => logout() }, svgIcon('logout', 18), 'Sair'),
    h('p', { class: 'muted small' }, `${APP_NAME} · cliente estático, sem servidor próprio. O token fica só neste aparelho.`)));
  view.append(prefsSection());
  view.append(pushSection());
  view.append(h('div', { class: 'account-card' },
    h('strong', {}, 'Moderação pessoal'),
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
    ? h('button', { type: 'button', class: 'icon-btn push-right', 'aria-label': 'Configurações do app', onclick: () => { state.settingsOpen = true; window.scrollTo(0, 0); render(); loadPush(); } }, svgIcon('settings', 22))
    : null;
  view.append(profileBar(nameNode(a), isRoot ? null : closeProfile, gear));

  const hdr = safeUrl(a.header_static || a.header);
  view.append(hdr && !/missing\.png/.test(hdr) ? h('img', { class: 'banner', src: hdr, alt: '' }) : h('div', { class: 'banner' }));

  const actions = self
    ? h('a', { class: 'btn-link', href: `https://${session.host}/settings/profile`, target: '_blank', rel: 'noopener noreferrer' }, 'Editar')
    : h('div', { class: 'profile-actions' },
      p.rel && p.rel.following ? h('button', { type: 'button', onclick: () => openListPicker(a) }, 'Listas') : null,
      followBtn(p),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mais opções da conta', onclick: () => accountMenu(a, p.rel) }, svgIcon('more', 22)));

  const badges = [];
  if (a.bot) badges.push('Robô');
  if (a.group) badges.push('Grupo');
  if (a.locked) badges.push('Perfil fechado');
  if (p.rel && p.rel.followed_by) badges.push('Segue você');
  if (p.rel && p.rel.muting) badges.push('Silenciado');
  if (p.rel && p.rel.blocked_by) badges.push('Bloqueou você');

  const fields = (a.fields || []).filter((f) => f.name || f.value).map((f) => h('div', { class: 'field' },
    h('dt', {}, emojiFragment(f.name || '', a.emojis)),
    h('dd', { class: f.verified_at ? 'verified' : '' }, sanitizeHtml(f.value, a.emojis), f.verified_at ? svgIcon('check', 16) : null)));

  view.append(h('section', { class: 'profile-head' },
    h('div', { class: 'profile-top' },
      h('img', { class: 'profile-avatar', src: safeUrl(a.avatar_static || a.avatar), alt: '' }),
      actions),
    h('h2', { class: 'profile-name' }, nameNode(a)),
    h('div', { class: 'muted' }, '@' + fullAcct(a)),
    badges.length ? h('div', { class: 'badges' }, ...badges.map((b) => h('span', { class: 'badge' }, b))) : null,
    a.moved ? h('p', { class: 'muted small' }, 'Mudou para ', h('span', { class: 'link-name', role: 'button', tabindex: '0', onclick: () => openProfile(a.moved) }, '@' + a.moved.acct)) : null,
    a.note ? h('div', { class: 'bio' }, sanitizeHtml(a.note, a.emojis)) : null,
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
  ['other', 'Outras'],
  ['search', 'Buscar'],
];

function getList(kind) {
  if (kind === 'list') return state.listTl;
  if (kind.startsWith('p:')) {
    const p = activeProfile();
    return p ? p[kind.slice(2)] : mkList();
  }
  return state[kind];
}

function renderList(view, kind, make) {
  const st = getList(kind);
  if (st.cached) {
    const when = st.cachedAt ? new Date(st.cachedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    view.append(h('p', { class: 'cache-note', role: 'status' },
      st.error ? `Sem conexão. Mostrando o que foi guardado em ${when}.` : `Mostrando o que foi guardado em ${when}. Atualizando…`));
  }
  getList(kind).items.forEach((i) => { const n = make(i); if (n) view.append(n); });
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
  if (s.q) runSearch(); else render();
}

function searchView(view) {
  const s = state.search;
  const input = h('input', {
    type: 'search', placeholder: 'Contas, hashtags, publicações ou link', value: s.q, autocapitalize: 'none', autocorrect: 'off',
    spellcheck: 'false', enterkeyhint: 'search', 'aria-label': 'Buscar',
  });
  view.append(h('form', { class: 'search-form', role: 'search', onsubmit: (e) => { e.preventDefault(); input.blur(); startSearch(input.value); } },
    input, h('button', { type: 'submit', class: 'primary' }, 'Buscar')));
  view.append(h('div', { class: 'hosts', role: 'group', 'aria-label': 'Tipo de resultado' }, ...SEARCH_TYPES.map(([id, label]) =>
    h('button', { type: 'button', class: `chip${s.type === id ? ' active' : ''}`, 'aria-pressed': s.type === id ? 'true' : 'false',
      onclick: () => { s.type = id; s.res = null; if (s.q) runSearch(); else render(); } }, label))));
  if (s.error) { view.append(h('div', { class: 'empty' }, h('p', { class: 'error' }, s.error), h('button', { type: 'button', onclick: () => runSearch() }, 'Tentar de novo'))); return; }
  if (!s.q) { view.append(h('p', { class: 'empty' }, 'Busque por nomes, @usuario@instância, #hashtags, texto ou o link de uma publicação.')); return; }
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
      h('strong', {}, '#' + ex.tag)));
    renderList(view, 'tag', (s) => statusEl(s));
    return;
  }
  view.append(h('div', { class: 'seg-bar', role: 'tablist' }, ...SEGMENTS.map(([id, label]) =>
    h('button', { type: 'button', role: 'tab', class: `chip${ex.seg === id ? ' active' : ''}`, 'aria-selected': ex.seg === id ? 'true' : 'false', onclick: () => setSeg(id) }, label))));
  if (ex.seg === 'search') searchView(view);
  else if (ex.seg === 'trends') trendsView(view);
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
  state.tag = mkList();
  selectTab('explore');
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
  if (kind === 'search') {
    /* nada a carregar até o usuário buscar */
  } else if (kind === 'trends') {
    if (!state.trends.loaded && !state.trends.loading) loadTrends();
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
  view.replaceChildren();
  const top = topEntry();
  const prof = activeProfile();
  if (top && top.type) entryView(view, top);
  else if (prof) profileView(view, prof);
  else if (state.tab === 'home') homeView(view);
  else if (state.tab === 'notifications') renderList(view, 'notifications', notifEl);
  else if (state.tab === 'explore') exploreView(view);
  window.scrollTo(0, y);
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
    const [tags, statuses] = await Promise.all([
      api('/api/v1/trends/tags', { params: { limit: 20 } }),
      api('/api/v1/trends/statuses', { params: { limit: 20 } }).catch(() => []),
    ]);
    t.tags = tags;
    t.statuses = statuses;
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
  if (state.tab === 'notifications') return state.tab;
  if (state.tab === 'explore') return state.explore.tag ? 'tag' : state.explore.seg;
  return null;
}

function refreshCurrent() {
  const kind = currentKind();
  if (!kind) return;
  if (kind === 'entry') { const te = topEntry(); if (te.type === 'thread') loadThread(te); else if (te.reload) te.reload(); return; }
  if (kind === 'home' || kind === 'list') loadLists(true);
  if (kind.startsWith('p:')) loadProfile(activeProfile());
  if (kind === 'search') runSearch();
  else if (kind === 'trends') loadTrends();
  else loadList(kind);
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
    if (k === 'home' && hydrateFromCache('home')) { render(); window.scrollTo(0, store.get('scroll.home', 0)); refreshWithCache('home'); }
    else if (!getList(k).items.length && !getList(k).loading) loadList(k);
  } else if (tab === 'notifications') {
    if (hydrateFromCache('notifications')) { render(); window.scrollTo(0, store.get('scroll.notifications', 0)); refreshWithCache('notifications'); }
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

let compose = { replyTo: null, key: null };

function openComposer({ replyTo = null } = {}) {
  compose = { replyTo, key: crypto.randomUUID() };
  $('#compose-error').textContent = '';
  setCw(false);
  closeVisMenu();
  const note = $('#reply-to');
  if (replyTo) {
    const me = session.account.acct;
    const who = [...new Set([replyTo.account.acct, ...(replyTo.mentions || []).map((m) => m.acct)])].filter((x) => x !== me);
    $('#text').value = who.map((x) => `@${x}`).join(' ') + (who.length ? ' ' : '');
    setVisibility(replyTo.visibility);
    note.textContent = `Respondendo a @${replyTo.account.acct}`;
    note.hidden = false;
  } else {
    $('#text').value = store.get('draft', '');
    setVisibility(prefs.defaultVis || store.get('lastVisibility', 'public'));
    note.hidden = true;
  }
  updateCount();
  $('#composer').showModal();
  fitComposer();
  const t = $('#text');
  t.focus();
  t.setSelectionRange(t.value.length, t.value.length);
}

function updateCount() {
  const t = $('#text');
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
  if (!text) return;
  const btn = $('#post-btn');
  btn.disabled = true;
  $('#compose-error').textContent = '';
  try {
    await api('/api/v1/statuses', {
      method: 'POST',
      headers: { 'Idempotency-Key': compose.key },
      body: {
        status: text,
        spoiler_text: (!$('#cw').hidden && $('#cw').value.trim()) || undefined,
        visibility: composeVis,
        in_reply_to_id: compose.replyTo ? compose.replyTo.id : undefined,
      },
    });
    if (!compose.replyTo) { store.del('draft'); store.set('lastVisibility', composeVis); }
    $('#composer').close();
    toast('Publicado');
    if (activeThread()) loadThread(activeThread());
    else if (state.tab === 'home' && !state.homeList) loadList('home');
  } catch (err) {
    $('#compose-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
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
  showApp();
  // aberto pelo toque numa notificação push
  const go = new URL(location.href).searchParams.get('go');
  if (go) history.replaceState(null, '', location.pathname);
  selectTab(go === 'notifications' ? 'notifications' : 'home');
  checkUnread();
  try {
    const res = await fetch(`https://${session.host}/api/v1/instance`);
    const max = (await res.json())?.configuration?.statuses?.max_characters;
    if (max) $('#text').maxLength = max;
  } catch { /* mantém o padrão do HTML */ }
}

function bindUi() {
  hydrateIcons();
  $('#login-form').addEventListener('submit', (e) => { e.preventDefault(); startLogin(false); });
  $('#manual-start').addEventListener('click', () => startLogin(true));
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveScroll(); else checkUnread(); });
  window.addEventListener('pagehide', saveScroll);
  // elementos clicáveis com role="button" (avatares, nomes) também respondem a Enter/espaço (teclado, VoiceOver)
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"]:not(button)')) {
      e.preventDefault();
      e.target.click();
    }
  });
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
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitComposer);
    window.visualViewport.addEventListener('scroll', fitComposer);
  }
  $('#composer').addEventListener('close', closeVisMenu);
  // não deixa os botões da barra tirarem o foco do texto (o teclado não fecha)
  $('#compose-tools').addEventListener('pointerdown', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  $('#vis-btn').addEventListener('click', () => {
    const open = $('#vis-menu').hidden;
    $('#vis-menu').hidden = !open;
    $('#vis-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('#cw-btn').addEventListener('click', () => setCw($('#cw').hidden));
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeVisMenu(); });
  $('#compose-form').addEventListener('submit', submitCompose);
  $('#text').addEventListener('input', () => {
    updateCount();
    if (!compose.replyTo) store.set('draft', $('#text').value);
  });
}

async function boot() {
  applyPrefs();
  bindUi();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) await handleCallback(params);
  session = session || store.get('session');
  if (session && session.token) startApp();
  else showLogin($('#login-error').textContent);
}

boot();

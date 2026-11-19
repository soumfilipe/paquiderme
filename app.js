import {
  OOB, randomString, pkceChallenge, normalizeHost,
  sanitizeHtml, emojiFragment, safeUrl, timeAgo, h, svgIcon,
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
const state = {
  tab: 'home',
  home: { items: [], more: true, loading: false, error: null },
  notifications: { items: [], more: true, loading: false, error: null },
};

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
  store.del('session');
  session = null;
  state.home = { items: [], more: true, loading: false, error: null };
  state.notifications = { items: [], more: true, loading: false, error: null };
  showLogin(message);
}

/* ---------- API ---------- */

async function api(path, { method = 'GET', params, body, headers = {} } = {}) {
  const url = new URL(path, `https://${session.host}`);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const init = { method, headers: { Authorization: `Bearer ${session.token}`, ...headers } };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Sem conexão com a instância.');
  }
  if (res.status === 401) {
    await logout({ revoke: false, message: 'Sessão expirada. Entre de novo.' });
    throw new Error('Sessão expirada.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && json.error) || `Erro ${res.status}`);
  return json;
}

/* ---------- Renderização ---------- */

function nameNode(account) {
  return h('span', {}, emojiFragment(account.display_name || account.username, account.emojis));
}

function paintAction(btn, icon, count, on) {
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

function mediaEl(sh) {
  const items = (sh.media_attachments || []).filter((m) => safeUrl(m.url));
  if (!items.length) return null;
  const wrap = h('div', { class: `media${items.length === 1 ? ' one' : ''}${sh.sensitive ? ' sensitive' : ''}` });
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
  if (sh.sensitive) {
    wrap.title = 'Conteúdo sensível — toque para mostrar';
    wrap.addEventListener('click', () => wrap.classList.remove('sensitive'), { once: true });
  }
  return wrap;
}

function statusEl(s) {
  const sh = s.reblog || s;
  const a = sh.account;
  const el = h('article', { class: 'status', 'data-id': sh.id });

  if (s.reblog) {
    el.append(h('div', { class: 'boost-note' }, svgIcon('boost', 14), ' ', nameNode(s.account), ' impulsionou'));
  }

  el.append(h('header', {},
    h('img', { class: 'avatar', src: safeUrl(a.avatar_static || a.avatar), alt: '', loading: 'lazy' }),
    h('div', { class: 'who' },
      h('div', { class: 'name' }, nameNode(a)),
      h('span', { class: 'acct' }, '@' + a.acct)),
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
    el.append(h('details', { class: 'cw' }, summary, ...parts));
  } else {
    el.append(...parts);
  }

  const canBoost = sh.visibility === 'public' || sh.visibility === 'unlisted';
  const boostBtn = actionButton('boost', 'boost', sh.reblogs_count, sh.reblogged, (e) => toggle(e.currentTarget, sh, 'boost'), 'Impulsionar');
  if (!canBoost) boostBtn.disabled = true;
  const favBtn = actionButton('fav', 'fav', sh.favourites_count, sh.favourited, (e) => toggle(e.currentTarget, sh, 'fav'), 'Favoritar');
  const replyBtn = actionButton('reply', 'reply', sh.replies_count, false, () => openComposer({ replyTo: sh }), 'Responder');
  const open = h('a', { class: 'open', href: safeUrl(sh.url || sh.uri), target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Abrir original' }, svgIcon('external', 18));
  el.append(h('div', { class: 'actions' }, replyBtn, boostBtn, favBtn, open));
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
    h('strong', {}, nameNode(n.account)), ' ', NOTIF_KINDS[n.type] || n.type,
    ' · ', timeAgo(n.created_at)));
  if (n.status) wrap.append(statusEl(n.status));
  else wrap.append(h('div', { class: 'notif-kind' }, '@' + n.account.acct));
  return wrap;
}

function moreButton(kind) {
  const st = state[kind];
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

function accountView() {
  const a = session.account;
  const card = h('div', { class: 'account-card' },
    h('img', { src: safeUrl(a.avatar), alt: '' }),
    h('div', {}, h('strong', {}, nameNode(a)), h('div', { class: 'muted' }, `@${a.acct}@${session.host}`)),
    h('a', { href: safeUrl(a.url), target: '_blank', rel: 'noopener noreferrer' }, 'Abrir perfil no navegador'),
    h('button', { type: 'button', class: 'with-icon', onclick: updateApp }, svgIcon('refresh', 18), 'Atualizar o app (limpar cache)'),
    h('button', { type: 'button', class: 'with-icon', onclick: () => logout() }, svgIcon('logout', 18), 'Sair'),
    h('p', { class: 'muted small' }, `${APP_NAME} · cliente estático, sem servidor próprio. O token fica só neste aparelho.`),
  );
  return card;
}

function render() {
  const view = $('#view');
  const y = window.scrollY;
  view.replaceChildren();
  if (state.tab === 'home') {
    state.home.items.forEach((s) => view.append(statusEl(s)));
    view.append(moreButton('home'));
  } else if (state.tab === 'notifications') {
    state.notifications.items.forEach((n) => view.append(notifEl(n)));
    view.append(moreButton('notifications'));
  } else {
    view.append(accountView());
  }
  window.scrollTo(0, y);
}

async function loadList(kind, append = false) {
  const st = state[kind];
  if (st.loading) return;
  st.loading = true;
  st.error = null;
  $('#refresh').classList.add('spinning');
  render();
  try {
    const params = { limit: 30 };
    if (append && st.items.length) params.max_id = st.items[st.items.length - 1].id;
    const data = await api(kind === 'home' ? '/api/v1/timelines/home' : '/api/v1/notifications', { params });
    st.items = append ? st.items.concat(data) : data;
    st.more = data.length > 0;
    if (!append) window.scrollTo(0, 0);
  } catch (e) {
    st.error = e.message;
  } finally {
    st.loading = false;
    $('#refresh').classList.remove('spinning');
    if (session) render();
  }
}

const TITLES = { home: 'Início', notifications: 'Avisos', account: 'Conta' };

function selectTab(tab) {
  state.tab = tab;
  $('#title').textContent = TITLES[tab];
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#fab').hidden = tab === 'account';
  $('#refresh').hidden = tab === 'account';
  window.scrollTo(0, 0);
  const icon = document.querySelector('#tabs button.active svg');
  if (icon) { icon.classList.remove('bump'); void icon.getBoundingClientRect(); icon.classList.add('bump'); }
  render();
  if ((tab === 'home' || tab === 'notifications') && !state[tab].items.length && !state[tab].loading) loadList(tab);
}

/* ---------- Compositor ---------- */

let compose = { replyTo: null, key: null };

function openComposer({ replyTo = null } = {}) {
  compose = { replyTo, key: crypto.randomUUID() };
  $('#compose-error').textContent = '';
  $('#cw').value = '';
  const note = $('#reply-to');
  if (replyTo) {
    const me = session.account.acct;
    const who = [...new Set([replyTo.account.acct, ...(replyTo.mentions || []).map((m) => m.acct)])].filter((x) => x !== me);
    $('#text').value = who.map((x) => `@${x}`).join(' ') + (who.length ? ' ' : '');
    $('#visibility').value = replyTo.visibility === 'direct' ? 'direct' : replyTo.visibility;
    note.textContent = `Respondendo a @${replyTo.account.acct}`;
    note.hidden = false;
  } else {
    $('#text').value = store.get('draft', '');
    $('#visibility').value = store.get('lastVisibility', 'public');
    note.hidden = true;
  }
  updateCount();
  $('#composer').showModal();
  const t = $('#text');
  t.focus();
  t.setSelectionRange(t.value.length, t.value.length);
}

function updateCount() {
  const t = $('#text');
  $('#count').textContent = `${t.value.length}/${t.maxLength}`;
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
        spoiler_text: $('#cw').value.trim() || undefined,
        visibility: $('#visibility').value,
        in_reply_to_id: compose.replyTo ? compose.replyTo.id : undefined,
      },
    });
    if (!compose.replyTo) { store.del('draft'); store.set('lastVisibility', $('#visibility').value); }
    $('#composer').close();
    toast('Publicado');
    if (state.tab === 'home') loadList('home');
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
  selectTab('home');
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
  $('#refresh').addEventListener('click', () => { if (state.tab !== 'account') loadList(state.tab); });
  $('#fab').addEventListener('click', () => openComposer());
  $('#cancel-compose').addEventListener('click', () => $('#composer').close());
  $('#compose-form').addEventListener('submit', submitCompose);
  $('#text').addEventListener('input', () => {
    updateCount();
    if (!compose.replyTo) store.set('draft', $('#text').value);
  });
}

async function boot() {
  bindUi();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) await handleCallback(params);
  session = session || store.get('session');
  if (session && session.token) startApp();
  else showLogin($('#login-error').textContent);
}

boot();

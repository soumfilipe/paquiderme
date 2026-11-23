import {
  OOB, b64url, randomString, pkceChallenge, normalizeHost,
  sanitizeHtml, emojiFragment, safeUrl, timeAgo, h, svgIcon, sparkline, parseNextMaxId,
} from './lib.js';
import 'rochedo';
import './style.css';
import { estado, reiniciar } from './src/estado.svelte.js';
import { registrar, canon, atualizar, esquecer, limpar as limparPublicacoes } from './src/publicacoes.svelte.js';
import { ambiente } from './src/ambiente.svelte.js';
import Casca from './src/telas/Casca.svelte';
import Estado from './src/telas/Estado.svelte';
import Publicacao from './src/telas/Publicacao.svelte';
import { SvelteMap } from 'svelte/reactivity';
import { compose as composeEstado, limites, ui as composeUi, reiniciarCompose } from './src/composicao.svelte.js';
import ComposicaoExtras from './src/telas/ComposicaoExtras.svelte';
import ComposicaoSugestoes from './src/telas/ComposicaoSugestoes.svelte';
import ComposicaoFerramentas from './src/telas/ComposicaoFerramentas.svelte';
import Saude from './src/telas/Saude.svelte';
import Filtros from './src/telas/Filtros.svelte';
import HashtagsSeguidas from './src/telas/HashtagsSeguidas.svelte';
import OutraInstancia from './src/telas/OutraInstancia.svelte';
import BuscaTipos from './src/telas/BuscaTipos.svelte';
import FiltroEdicao from './src/telas/FiltroEdicao.svelte';
import Agendadas from './src/telas/Agendadas.svelte';
import ContasEntrada from './src/telas/ContasEntrada.svelte';
import Membros from './src/telas/Membros.svelte';
import Listas from './src/telas/Listas.svelte';
import EscolherListas from './src/telas/EscolherListas.svelte';
import Perfil from './src/telas/Perfil.svelte';
import PerfilEdicao from './src/telas/PerfilEdicao.svelte';
import AvisoAtualizacao from './src/telas/AvisoAtualizacao.svelte';
import { iniciarAtualizacao } from './src/atualizacao.svelte.js';
import { mount, unmount, flushSync } from 'svelte';
import Configuracoes from './src/telas/Configuracoes.svelte';
import { aviso } from 'rochedo/aviso.js';
import { confirmar } from 'rochedo/confirmar.js';
import { abrirFolha } from 'rochedo/folha.js';

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
const state = estado;
reiniciar(mkState());

/* Estados (Rochedo): vazio, erro com "tentar de novo", carregando */
/* Ação destrutiva em dois toques (Rochedo) */
function dangerBtn(label, confirmLabel, onConfirm) {
  const b = h('button', { class: 'ro-botao ro-botao--perigo', type: 'button' }, label);
  confirmar(b, onConfirm, { rotulo: confirmLabel });
  return b;
}

/* ---------- Avisos ---------- */

function toast(msg, opts) { return aviso(msg, opts); }

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
  reiniciar(mkState()); limparPublicacoes();
  Object.assign(pushState, { loading: false, supported: false, standalone: false, sub: null, error: null, loaded: false });
  setUnread(false);
  appStarted = false;
  closeSheet();
  if (casca) { unmount(casca); casca = null; }
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
  reiniciar(mkState()); limparPublicacoes();
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
  if (target === session.host) registrar(json);
  return json;
}

/* ---------- Renderização ---------- */

function nameNode(account) {
  return h('span', {}, emojiFragment(account.display_name || account.username, account.emojis));
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.replaceChildren(svgIcon(el.dataset.icon, Number(el.dataset.size) || 24));
  });
}

// A resposta da API já atualiza a publicação canônica; a tela reage sozinha.
async function toggle(btn, sh, kind, visibility) {
  const isBoost = kind === 'boost';
  const was = isBoost ? sh.reblogged : sh.favourited;
  const verb = isBoost ? (was ? 'unreblog' : 'reblog') : (was ? 'unfavourite' : 'favourite');
  btn.disabled = true;
  try {
    await api(`/api/v1/statuses/${sh.id}/${verb}`, { method: 'POST', body: verb === 'reblog' && visibility ? { visibility } : undefined });
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
    toast((r.reblog || r).bookmarked ? 'Salvo' : 'Removido dos salvos');
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Menu inferior (folha de ações) ---------- */

// Adaptador fino sobre a folha do Rochedo: mantém a assinatura antiga (label/icon/danger/onclick/keepOpen).
const sheetEl = () => document.querySelector('dialog.ro-folha[open]');
function closeSheet() { const d = sheetEl(); if (d) d.close(); }
function openSheet(title, items, content) {
  closeSheet();
  abrirFolha({
    titulo: title || undefined,
    conteudo: content || undefined,
    itens: items.map((it) => ({
      rotulo: it.label, icone: it.icon, perigo: it.danger, aoClicar: it.onclick, manterAberta: it.keepOpen,
      href: it.href ? safeUrl(it.href) : undefined,
    })),
  });
}

// Some das listas as publicações de uma conta que acabou de ser silenciada/bloqueada
function purgeAccount(id) {
  const keep = (s) => s.account.id !== id && !(s.reblog && s.reblog.account.id === id);
  ['home', 'local', 'global', 'tag', 'listTl'].forEach((k) => { state[k].items = state[k].items.filter(keep); });
  state.trends.statuses = state.trends.statuses.filter(keep);
  state.notifications.items = state.notifications.items.filter((n) => n.account.id !== id);
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
    if (verb === 'block' || verb === 'mute') purgeAccount(account.id);
    toast(msg);
  } catch (e) { toast(e.message); }
}

function reportSheet(account, status) {
  const comment = h('textarea', { class: 'sheet-text', rows: '4', maxlength: '1000', placeholder: 'O que há de errado? (opcional)', 'aria-label': 'Motivo da denúncia' });
  const remote = account.acct.includes('@');
  const fwd = h('input', { class: 'ro-caixa', type: 'checkbox', checked: true });
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
    remote ? h('label', { class: 'ro-opcao sheet-check' }, fwd, ` Encaminhar também à instância de @${account.acct.split('@')[1]}`) : null));
}

async function followOptions(account, patch, msg) {
  try {
    const rel = await api(`/api/v1/accounts/${account.id}/follow`, { method: 'POST', body: patch });
    applyRel(account, rel);
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

// Lança Error(mensagem) se a instância recusar; a publicação mostra o estado "Traduzindo…" sozinha.
async function translateStatus(sh) {
  const r = await api(`/api/v1/statuses/${sh.id}/translate`, { method: 'POST', body: { lang: (navigator.language || 'pt').slice(0, 2) } });
  translations.set(sh.id, { content: r.content, lang: r.detected_source_language, provider: r.provider, shown: true });
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
  } catch (e) { toast(e.message); closeSheet(); }
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

// Filtros do servidor: publicações que casam com um filtro viram um aviso recolhido
const revealed = new Set();
const translations = new SvelteMap(); // id da publicação -> { content, lang, provider, shown }
function filterHits(s) {
  const sh = s.reblog || s;
  const list = (s.filtered && s.filtered.length ? s.filtered : sh.filtered) || [];
  return list.map((x) => x.filter).filter(Boolean);
}

// Publicação (Svelte): tudo o que a tela precisa e ainda vive em JS passa por este objeto.
let publicacaoCtx = null;
const mkPublicacaoCtx = () => ({
  canon, revealed, translations, filterHits, sanitizeHtml, plainText, safeUrl, timeAgo, abrirVisualizador: openViewer,
  openAccountFrom, openHistory, openComposer, boostSheet, toggle, toggleBookmark, statusMenu, translateStatus, toast,
  limits: () => limits, prefs: () => prefs,
  enquete: {
    eu: () => session.account.id, restante: fmtRemaining, toast,
    votar: async (s, escolhas) => { const poll = await api(`/api/v1/polls/${s.poll.id}/votes`, { method: 'POST', body: { choices: escolhas } }); atualizar({ ...s, poll }); },
    atualizarEnquete: async (s) => { const poll = await api(`/api/v1/polls/${s.poll.id}`); atualizar({ ...s, poll }); },
  },
  citacao: { abrirConversa: openThread, html: sanitizeHtml },
  abrirRespondida: async (sh) => { try { openThread(await api(`/api/v1/statuses/${sh.in_reply_to_id}`)); } catch (err) { toast(err.message); } },
});


const NOTIF_TABS = [['all', 'Todos'], ['mentions', 'Menções'], ['dms', 'Mensagens']];

function setNotifTab(id) {
  state.notifTab = id;
  window.scrollTo(0, 0);
  const k = id === 'mentions' ? 'mentions' : id === 'dms' ? 'convs' : 'notifications';
  if (!state[k].items.length && !state[k].loading) loadList(k);
}

const plainText = (html) => { const d = new DOMParser().parseFromString(html || '', 'text/html').body; d.querySelectorAll('br').forEach((b) => b.replaceWith(' ')); return (d.textContent || '').replace(/\s+/g, ' ').trim(); };

// Lista de publicações em Svelte: reage sozinha a carregamentos e novas publicações.
// Tudo o que as telas de lista precisam do app (publicação + contas, hashtags e abertura de telas)
function ctxLista() {
  publicacaoCtx ||= mkPublicacaoCtx();
  return { ...publicacaoCtx, api, openProfile, openThread, openTag, sparkline };
}

/* ----- Conversas (threads) ----- */

function openThread(status, host = null) {
  state.profiles.push({
    uid: crypto.randomUUID(), type: 'thread', status, host, ancestors: [], descendants: [],
    loading: false, loaded: false, error: null, returnScroll: window.scrollY,
  });
  window.scrollTo(0, 0);
  loadThread(topEntry());
}

async function loadThread(t) {
  if (!t || t.loading) return;
  t.loading = true;
  t.error = null;
  busy(+1);
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
    if (session && aberta(t)) {
      if (t.loaded && !t.scrolled) {
        t.scrolled = true;
        // depois de a tela reagir aos dados novos
        setTimeout(() => { const f = document.querySelector('.thread-item.focal'); if (f && t.ancestors.length) f.scrollIntoView({ block: 'start' }); });
      }
    }
  }
}

/* ---------- Cache local (abrir offline e voltar de onde parou) ---------- */

const CACHE_KINDS = ['home', 'notifications'];
const CACHE_MAX = 40;
const cacheKey = (kind) => `cache.${session.host}.${session.account.id}.${kind}`;

// mensagens diretas nunca ficam guardadas no aparelho (nem no cache de avisos)
const isDirect = (it) => ((it.status || it).visibility === 'direct') || (it.reblog && it.reblog.visibility === 'direct');
const cacheable = (items) => items.filter((it) => !isDirect(it)).slice(0, CACHE_MAX).map(canon);

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
  if ($('#composer').open || sheetEl() || $('#viewer').open) return;
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
    h('div', { class: 'v-top' }, h('button', { type: 'button', class: 'ro-botao ro-botao--quieto ro-botao--icone icon-btn', 'aria-label': 'Fechar', onclick: close }, svgIcon('close', 24)), counter, openLink),
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
ambiente.outras = store.get('otherHosts', []);
ambiente.prefs = { ...PREF_DEFAULTS, ...store.get('prefs', {}) };
const prefs = ambiente.prefs;

function applyPrefs() {
  const root = document.documentElement;
  if (prefs.theme === 'auto') { root.removeAttribute('data-theme'); root.removeAttribute('data-tema'); }
  else { root.dataset.theme = prefs.theme; root.dataset.tema = prefs.theme === 'light' ? 'claro' : 'escuro'; } // data-tema é o do Rochedo
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
  if (m.event === 'update') { const s = data(); if (s) { registrar(s); liveHome(s); } }
  else if (m.event === 'status.update') { const s = data(); if (s) replaceStatus(s); }
  else if (m.event === 'delete') { removeStatus(String(m.payload)); }
  else if (m.event === 'notification') { const n = data(); if (n) { registrar(n); liveNotification(n); } }
}

const atTop = () => window.scrollY < 80 && !$('#composer').open;

function liveHome(s) {
  const st = state.home;
  if (!st.items.length && !st.loaded) return; // ainda nem carregou: o carregamento já traz
  if (st.items.some((x) => x.id === s.id) || state.newPosts.some((x) => x.id === s.id)) return;
  const viewing = state.tab === 'home' && !state.homeList && state.profiles.length === 0;
  if (viewing && atTop()) { st.items.unshift(s); return; }
  state.newPosts.unshift(s);
  updatePill();
}

function liveNotification(n) {
  const L = state.notifications;
  const viewing = state.tab === 'notifications' && state.profiles.length === 0;
  if (!L.items.some((x) => x.id === n.id) && (L.items.length || L.loaded)) { L.items.unshift(n); L.cached = false; }
  if (viewing) { markNotificationsRead(); } else { setUnread(true); ringBell(); }
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
  const novas = state.newPosts.filter((p) => !state.home.items.some((x) => x.id === p.id));
  if (novas.length !== state.newPosts.length) state.newPosts = novas;
  const n = state.newPosts.length;
  const show = n > 0 && !!session && state.tab === 'home' && !state.homeList && state.profiles.length === 0 && !$('#app').hidden;
  pill.hidden = !show;
  if (show) $('#new-pill-text').textContent = n === 1 ? '1 nova publicação' : `${n} novas publicações`;
}

function showNewPosts() {
  state.home.items = state.newPosts.concat(state.home.items);
  state.newPosts = [];
  window.scrollTo(0, 0);
}

/* ---------- Avisos no aparelho (Web Push) ---------- */

const PUSH_ALERTS = [
  ['mention', 'Menções e respostas'],
  ['follow', 'Novos seguidores'],
  ['reblog', 'Impulsos'],
  ['favourite', 'Favoritos'],
  ['status', 'Publicações de contas com o sininho'],
];
const pushState = ambiente.push;

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
}

async function setPushAlert(key, on) {
  const ps = pushState;
  const alerts = { ...ps.sub.alerts, [key]: on };
  if (key === 'follow') alerts.follow_request = on;
  try {
    ps.sub = await api('/api/v1/push/subscription', { method: 'PUT', body: { data: { alerts } } });
  } catch (e) { toast(e.message); }
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
  }
}

/* ----- Aviso rápido de problema no topo do Início ----- */
const alarm = { timer: null };
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
  if (text !== ambiente.alarme) ambiente.alarme = text;
}
function scheduleQuickHealth(ms = 1500) { clearTimeout(alarm.timer); alarm.timer = setTimeout(quickHealth, ms); }

function setHomeList(id) {
  state.homeList = id || null;
  state.listTl = mkList();
  window.scrollTo(0, 0);
  if (id) loadList('list');
  else if (!state.home.items.length) loadList('home');
}

// O estado é um proxy: a entrada guardada não é o mesmo objeto que o chamador tem, então compara-se pelo uid.
const aberta = (e) => state.profiles.some((p) => p.uid === e.uid);

function pushEntry(entry) {
  entry.uid = crypto.randomUUID();
  entry.returnScroll = window.scrollY;
  state.profiles.push(entry);
  window.scrollTo(0, 0);
  const viva = topEntry(); // o proxy do estado: de agora em diante mude ESTE objeto, não o original
  // adiado: quem chamou ainda vai trocar sua variável pelo proxy devolvido, e o reload deve mexer nele
  if (viva.reload) queueMicrotask(() => viva.reload());
  return viva;
}

function entradaTela(e) {
  switch (e.type) {
    case 'lists': return listsManageTela(e);
    case 'members': return membersTela(e);
    case 'pick': return listPickTela(e);
    case 'accounts': return accountsEntryTela(e);
    case 'editprofile': return editProfileTela(e);
    case 'filters': return filtersTela(e);
    case 'scheduled': return scheduledTela(e);
    case 'health': return healthTela(e);
    case 'filteredit': return filterEditTela(e);
    default: return null;
  }
}

async function createList(title) {
  title = title.trim();
  if (!title) return;
  try {
    const l = await api('/api/v1/lists', { method: 'POST', body: { title } });
    state.lists.items.push(l);
  } catch (e) { toast(e.message); }
}

function openListsManage() {
  pushEntry({ type: 'lists', editing: null, confirm: null, reload: () => loadLists() });
}

function listsManageTela(e) {
  return { titulo: 'Listas', aoVoltar: closeProfile, Tela: Listas, props: {
    L: state.lists, e, aoCriar: createList, aoRecarregar: () => loadLists(),
    aoAbrir: (l) => { state.profiles = []; setHomeList(l.id); },
    aoMembros: openMembers,
    aoEditar: (id) => { e.editing = id; },
    aoRenomear: async (l, title) => {
      try {
        const u = await api(`/api/v1/lists/${l.id}`, { method: 'PUT', body: { title } });
        l.title = u.title;
        e.editing = null;
      } catch (err) { toast(err.message); }
    },
    aoExcluir: async (l) => {
      try {
        await api(`/api/v1/lists/${l.id}`, { method: 'DELETE' });
        state.lists.items = state.lists.items.filter((x) => x.id !== l.id);
        if (state.homeList === l.id) { state.homeList = null; state.listTl = mkList(); }
      } catch (err) { toast(err.message); }
    },
  } };
}

function openAccountsEntry(title, path, undoVerb, undoLabel) {
  let e = { type: 'accounts', title, path, undoVerb, undoLabel, items: [], next: null, more: false, loaded: false, loading: false, error: null };
  e.reload = () => loadAccountsEntry(e, false);
  e = pushEntry(e);
}

async function loadAccountsEntry(e, append) {
  if (e.loading) return;
  e.loading = true; e.error = null;
  if (!append) busy(+1);
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
  }
}

function contaCtx() { return { url: safeUrl, abrir: openProfile }; }

function accountsEntryTela(e) {
  return { titulo: e.title, aoVoltar: closeProfile, Tela: ContasEntrada, props: {
    e, c: contaCtx(),
    aoRecarregar: () => loadAccountsEntry(e, e.items.length > 0),
    aoMais: () => loadAccountsEntry(e, true),
    aoDesfazer: async (a, btn) => {
      btn.disabled = true;
      try {
        await api(`/api/v1/accounts/${a.id}/${e.undoVerb}`, { method: 'POST' });
        e.items = e.items.filter((x) => x.id !== a.id);
      } catch (err) { toast(err.message); btn.disabled = false; }
    },
  } };
}

function openMembers(list) {
  let e = { type: 'members', list, items: [], loaded: false, loading: false, error: null, q: '', results: null };
  e.reload = () => loadMembers(e);
  e = pushEntry(e);
}

async function loadMembers(e) {
  if (e.loading) return;
  e.loading = true;
  e.error = null;
  busy(+1);
  try {
    e.items = await api(`/api/v1/lists/${e.list.id}/accounts`, { params: { limit: 0 } });
    e.loaded = true;
  } catch (err) {
    e.error = err.message;
  } finally {
    e.loading = false;
    busy(-1);
  }
}

function membersTela(e) {
  return { titulo: e.list.title, aoVoltar: closeProfile, Tela: Membros, props: {
    e, c: contaCtx(), aoRecarregar: () => loadMembers(e),
    aoBuscar: async (q) => {
      e.q = q;
      if (!q) { e.results = null; return; }
      try {
        e.results = await api('/api/v1/accounts/search', { params: { q, following: 'true', limit: 10 } });
      } catch (err) { toast(err.message); return; }
    },
    aoAdicionar: async (a, btn) => {
      btn.disabled = true;
      try {
        await api(`/api/v1/lists/${e.list.id}/accounts`, { method: 'POST', body: { account_ids: [a.id] } });
        e.items.push(a);
      } catch (err) { toast(err.message); btn.disabled = false; }
    },
    aoRemover: async (a, btn) => {
      btn.disabled = true;
      try {
        await api(`/api/v1/lists/${e.list.id}/accounts`, { method: 'DELETE', body: { account_ids: [a.id] } });
        e.items = e.items.filter((x) => x.id !== a.id);
      } catch (err) { toast(err.message); btn.disabled = false; }
    },
  } };
}

// Escolher em quais listas uma conta (que você segue) aparece
function openListPicker(account) {
  let e = { type: 'pick', account, member: new Set(), loaded: false, loading: false, error: null };
  e.reload = async () => {
    if (e.loading) return;
    e.loading = true; e.error = null; busy(+1);
    try {
      const [mine] = await Promise.all([
        api(`/api/v1/accounts/${account.id}/lists`),
        state.lists.loaded ? null : loadLists(true),
      ]);
      e.member = new Set(mine.map((l) => l.id));
      e.loaded = true;
    } catch (err) { e.error = err.message; } finally {
      e.loading = false; busy(-1);
    }
  };
  e = pushEntry(e);
}

function listPickTela(e) {
  return { titulo: `Listas de @${e.account.acct}`, aoVoltar: closeProfile, Tela: EscolherListas, props: {
    e, listas: state.lists.items, aoCriar: createList, aoRecarregar: () => e.reload(),
    alternar: async (l, nela, btn) => {
      btn.disabled = true;
      try {
        await api(`/api/v1/lists/${l.id}/accounts`, { method: nela ? 'DELETE' : 'POST', body: { account_ids: [e.account.id] } });
        e.member = new Set(e.member); // o Set dentro do estado não é reativo: troca por um novo
        if (nela) e.member.delete(l.id); else e.member.add(l.id);
        btn.disabled = false;
      } catch (err) { toast(err.message); btn.disabled = false; }
    },
  } };
}

/* ----- Filtros ----- */

const FILTER_CTX = [['home', 'Início'], ['notifications', 'Avisos'], ['public', 'Públicas'], ['thread', 'Conversas'], ['account', 'Perfis']];
const FILTER_EXP = [['', 'Nunca'], [86400, '1 dia'], [604800, '1 semana'], [2592000, '30 dias']];
const ctxLabel = (c) => (FILTER_CTX.find((x) => x[0] === c) || [c, c])[1];

function openFilters() {
  let e = { type: 'filters', items: [], loaded: false, loading: false, error: null, confirm: null };
  e.reload = () => loadFilters(e);
  e = pushEntry(e);
  loadFilters(e);
}

async function loadFilters(e) {
  e.loading = true; e.error = null; busy(+1);
  try {
    e.items = await api('/api/v2/filters');
    e.loaded = true;
  } catch (err) { e.error = err.message; } finally {
    e.loading = false; busy(-1);
  }
}

function filtersTela(e) {
  return { titulo: 'Filtros', aoVoltar: closeProfile, Tela: Filtros, props: {
    e, contexto: ctxLabel,
    aoNovo: () => openFilterEdit(e, null),
    aoEditar: (f) => openFilterEdit(e, f),
    aoExcluir: async (f) => {
      try {
        await api(`/api/v2/filters/${f.id}`, { method: 'DELETE' });
        e.items = e.items.filter((x) => x.id !== f.id);
      } catch (err) { toast(err.message); }
    },
  } };
}

/* ---------- Status da instância ---------- */

async function timed(fn) {
  const t0 = performance.now();
  try { const value = await fn(); return { ok: true, ms: Math.round(performance.now() - t0), value }; }
  catch (err) { return { ok: false, ms: Math.round(performance.now() - t0), error: err }; }
}

function openHealth() {
  let e = { type: 'health', checks: null, running: false, at: null };
  e.reload = () => runHealth(e);
  e = pushEntry(e);
  runHealth(e);
}

async function runHealth(e) {
  if (e.running) return;
  e.running = true; e.checks = null;
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
}

function healthTela(e) {
  return { titulo: 'Status da instância', aoVoltar: closeProfile, Tela: Saude, props: { e, host: session.host } };
}

function openScheduled() {
  let e = { type: 'scheduled', items: [], loaded: false, error: null, confirm: null };
  e.reload = () => loadScheduled(e);
  e = pushEntry(e);
  loadScheduled(e);
}

async function loadScheduled(e) {
  e.error = null; busy(+1);
  try {
    e.items = await api('/api/v1/scheduled_statuses');
    e.loaded = true;
  } catch (err) { e.error = err.message; } finally {
    busy(-1);
  }
}

function scheduledTela(e) {
  return { titulo: 'Publicações agendadas', aoVoltar: closeProfile, Tela: Agendadas, props: {
    e,
    aoCancelar: async (it) => {
      try {
        await api(`/api/v1/scheduled_statuses/${it.id}`, { method: 'DELETE' });
        e.items = e.items.filter((x) => x.id !== it.id);
      } catch (err) { toast(err.message); }
    },
  } };
}

function openFilterEdit(parent, f) {
  let e = { type: 'filteredit', parent, filter: f, built: false, saving: false, error: '',
    form: {
      title: f ? f.title : '',
      words: f ? (f.keywords || []).map((k) => k.keyword).join('\n') : '',
      whole: f ? (f.keywords || []).every((k) => k.whole_word) && (f.keywords || []).length > 0 : true,
      context: new Set(f ? f.context : ['home', 'notifications', 'public', 'thread']),
      action: f && f.filter_action === 'hide' ? 'hide' : 'warn',
      exp: undefined, // undefined = manter o que já existe
    } };
  e = pushEntry(e);
}

function filterEditTela(e) {
  return { titulo: e.filter ? 'Editar filtro' : 'Novo filtro', aoVoltar: closeProfile, Tela: FiltroEdicao, props: { e, contextos: FILTER_CTX, duracoes: FILTER_EXP, aoSalvar: (f) => saveFilter(e, f) } };
}

// Valida e grava; lança Error(mensagem) para a tela mostrar.
async function saveFilter(e, f) {
  const list = [...new Set(f.words.split('\n').map((x) => x.trim()).filter(Boolean))];
  if (!f.title.trim()) throw new Error('Dê um nome ao filtro.');
  if (!list.length) throw new Error('Inclua pelo menos uma palavra.');
  if (!f.context.size) throw new Error('Escolha onde o filtro vale.');
  const body = { title: f.title.trim(), context: [...f.context], filter_action: f.action };
  if (f.exp !== undefined) body.expires_in = f.exp;
  const old = e.filter ? e.filter.keywords || [] : [];
  const attrs = [];
  old.forEach((k) => { if (!list.includes(k.keyword)) attrs.push({ id: k.id, _destroy: true }); else if (k.whole_word !== f.whole) attrs.push({ id: k.id, keyword: k.keyword, whole_word: f.whole }); });
  list.forEach((w) => { if (!old.some((k) => k.keyword === w)) attrs.push({ keyword: w, whole_word: f.whole }); });
  body.keywords_attributes = attrs;
  if (e.filter) await api(`/api/v2/filters/${e.filter.id}`, { method: 'PUT', body });
  else await api('/api/v2/filters', { method: 'POST', body });
  toast('Filtro salvo');
  closeProfile();
  e.parent.reload();
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
  let e = { type: 'editprofile', loaded: false, loading: false, error: null, saving: false, dirty: false, built: false,
    form: null, avatarBlob: null, headerBlob: null, avatarUrl: null, headerUrl: null, maxFields: 4 };
  e.reload = null;
  e = pushEntry(e);
  loadEditProfile(e);
}

async function loadEditProfile(e) {
  e.loading = true; e.error = null; busy(+1);
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
  }
}

function closeEditProfile(e) {
  if (!e.dirty || e.saving) { closeProfile(); return; }
  openSheet('Descartar alterações do perfil?', [{ label: 'Descartar', danger: true, onclick: () => closeProfile() }]);
}

// Grava o perfil; lança Error(mensagem) para a tela mostrar.
async function saveEditProfile(e) {
  if (e.saving || !e.loaded) return;
  e.saving = true;
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
    throw err;
  }
}

function editProfileTela(e) {
  if (e.error && !e.loaded) return { titulo: 'Editar perfil', aoVoltar: () => closeEditProfile(e), Tela: Estado, props: { erro: e.error, aoTentar: () => loadEditProfile(e) } };
  if (!e.loaded) return { titulo: 'Editar perfil', aoVoltar: () => closeEditProfile(e), Tela: Estado, props: { carregando: true } };
  return { titulo: 'Editar perfil', aoVoltar: () => closeEditProfile(e), Tela: PerfilEdicao, props: { e, preparar: prepImage, aoSalvar: () => saveEditProfile(e), aoMudar: () => { e.dirty = true; }, aviso: toast } };
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

function openProfile(account) {
  const p = mkProfile(account);
  p.returnScroll = window.scrollY;
  p.uid = crypto.randomUUID();
  state.profiles.push(p);
  window.scrollTo(0, 0);
  const viva = topEntry();
  loadProfile(viva);
  ensureProfileLoaded(viva);
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
  ensureProfileLoaded(p);
}

function openPeople(p, kind) {
  p.people = kind;
  p.peopleScroll = window.scrollY;
  window.scrollTo(0, 0);
  ensureProfileLoaded(p);
}

function closePeople(p) {
  p.people = null;
  window.scrollTo(0, p.peopleScroll || 0);
}

function followBtn(p) {
  const r = p.rel;
  const st = !r ? null : r.blocking ? 'blocked' : r.following ? 'following' : r.requested ? 'requested' : 'none';
  const label = { blocked: 'Bloqueado', following: 'Seguindo', requested: 'Pedido enviado', none: 'Seguir' }[st] || 'Seguir';
  return h('button', {
    type: 'button',
    class: st === 'none' || !st ? 'ro-botao ro-botao--principal' : 'ro-botao',
    disabled: !r || st === 'blocked',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const verb = st === 'following' || st === 'requested' ? 'unfollow' : 'follow';
      try {
        p.rel = await api(`/api/v1/accounts/${p.id}/${verb}`, { method: 'POST' });
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    },
  }, label);
}


function accountRowEl(s) {
  const active = session && sameAcc(s, session);
  const acc = s.account;
  return h('button', { type: 'button', class: `ro-linha acc-row${active ? ' active' : ''}`, 'aria-current': active ? 'true' : null,
    onclick: () => { if (active) { closeSheet(); return; } activate(s); } },
    h('span', { class: 'ro-linha__inicio' }, h('img', { class: 'ro-avatar avatar', src: safeUrl(acc.avatar), alt: '' })),
    h('span', { class: 'ro-linha__corpo' },
      h('span', { class: 'ro-linha__titulo' }, nameNode(acc)),
      h('span', { class: 'ro-linha__sub' }, `@${acc.acct}@${s.host}`)),
    active ? h('span', { class: 'ro-linha__fim' }, svgIcon('check', 18)) : null);
}

function addAccount() {
  closeSheet();
  state.settingsOpen = false;
  showLogin('', { add: true });
}

function accountsSheet() {
  openSheet('Contas', [
    { label: 'Adicionar conta', icon: 'user-add', onclick: addAccount },
  ], h('div', { class: 'acc-list' }, ...sessions().map(accountRowEl)));
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

/* ----- Busca ----- */

const SEARCH_TYPES = [['', 'Tudo'], ['accounts', 'Contas'], ['hashtags', 'Hashtags'], ['statuses', 'Publicações']];

async function runSearch(append = false) {
  const s = state.search;
  if (!s.q || s.loading) return;
  s.loading = true; s.error = null;
  if (!append) busy(+1);
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
  }
}

function startSearch(q) {
  const s = state.search;
  s.q = q.trim();
  s.res = null;
  s.active = !!s.q;
  window.scrollTo(0, 0);
  if (s.q) runSearch(); else { ensureExploreLoaded(); }
  updateDock();
}

function closeSearch() {
  const s = state.search;
  s.q = ''; s.res = null; s.active = false; s.error = null;
  $('#search-input').value = '';
  window.scrollTo(0, 0); ensureExploreLoaded(); updateDock();
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

function setSeg(id) {
  state.explore.seg = id;
  store.set('seg', id);
  window.scrollTo(0, 0);
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
    if (state.explore.tag === name) { state.explore.tagFollowing = !!t.following; }
  } catch { /* instância sem o recurso: some o botão */ }
}

async function toggleFollowTag(name) {
  const ex = state.explore;
  const was = ex.tagFollowing;
  ex.tagFollowing = !was;
  try {
    await api(`/api/v1/tags/${encodeURIComponent(name)}/${was ? 'unfollow' : 'follow'}`, { method: 'POST' });
    state.followedTags.loaded = false;
    toast(was ? `Deixou de seguir #${name}` : `Seguindo #${name}`);
  } catch (e) { ex.tagFollowing = was; toast(e.message); }
}

async function loadFollowedTags() {
  const f = state.followedTags;
  if (f.loading) return;
  f.loading = true; f.error = null; busy(+1);
  try { f.items = await api('/api/v1/followed_tags', { params: { limit: 100 } }); f.loaded = true; } catch (e) { f.error = e.message; } finally { f.loading = false; busy(-1); }
}

function closeTag() {
  state.explore.tag = null;
  state.tag = mkList();
  window.scrollTo(0, 0);
  ensureExploreLoaded();
}

function goOther(raw) {
  const host = normalizeHost(raw);
  if (!host) { toast('Endereço de instância inválido.'); return; }
  state.explore.otherHost = host;
  store.set('otherHost', host);
  ambiente.outras = [host, ...ambiente.outras.filter((x) => x !== host)].slice(0, 8);
  store.set('otherHosts', ambiente.outras);
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


/* ----- Casca ----- */

let casca = null;

// O que a casca (Svelte) pede ao app: carregamentos, ações e os nós ainda feitos em JS.
function cascaCtx() {
  publicacaoCtx ||= mkPublicacaoCtx();
  const lista = ctxLista();
  const desmontar = () => { if (casca) { unmount(casca); casca = null; } };
  return {
    pub: publicacaoCtx, lista, desmontar,
    carregar: (tipo, mais) => loadList(tipo, mais),
    carregarConversa: (t) => loadThread(t),
        entrada: entradaTela,
    fecharPerfil: closeProfile,
    fecharGente: closePeople,
    fecharConfiguracoes: () => { state.settingsOpen = false; window.scrollTo(0, 0); },
    abrirConfiguracoes: () => { state.settingsOpen = true; window.scrollTo(0, 0); loadPush(); },
    contas: accountsSheet,
    contaId: session && session.account.id,
    segsPerfil: profileSegs,
    mudarSegPerfil: setProfileSeg,
    perfil: (p) => ({
      p, self: p.account.id === session.account.id, seguirNo: () => followBtn(p), url: safeUrl, html: sanitizeHtml,
      contar: fmtCount, arroba: fullAcct,
      editar: openEditProfile, listas: () => openListPicker(p.account), menu: () => accountMenu(p.account, p.rel),
      abrirPerfil: openProfile, abrirTag: openTag, abrirGente: (tipo) => openPeople(p, tipo),
    }),
    configuracoes: () => {
      const abrir = {
        filtros: openFilters, agendadas: openScheduled, saude: openHealth,
        silenciadas: () => openAccountsEntry('Contas silenciadas', '/api/v1/mutes', 'unmute', 'Reativar'),
        bloqueadas: () => openAccountsEntry('Contas bloqueadas', '/api/v1/blocks', 'unblock', 'Desbloquear'),
      };
      return {
        sessoes: sessions(), ehAtiva: (s) => session && sameAcc(s, session), trocarConta: activate,
        prefs, push: pushState, alertasPush: PUSH_ALERTS, appNome: APP_NAME, appUrl: APP_URL, host: session.host,
        url: safeUrl,
        definirPref: setPref, setPushAlert, ativarPush: enablePush, desativarPush: disablePush,
        adicionarConta: addAccount, atualizarApp: updateApp, sair: () => logout(),
        copiar: async (t) => { try { await navigator.clipboard.writeText(t); toast('Endereço copiado'); } catch { toast('Não consegui copiar'); } },
        abrir: (nome) => abrir[nome](),
      };
    },
    sincronizar: () => { updateDock(); updatePill(); },
    verStatus: openHealth,
    mudarLista: setHomeList,
    gerenciarListas: openListsManage,
    abasAvisos: NOTIF_TABS,
    mudarAbaAvisos: setNotifTab,
    segmentos: SEGMENTS,
    mudarSegmento: setSeg,
    fecharTag: closeTag,
    seguirTag: toggleFollowTag,
    tiposBusca: SEARCH_TYPES,
    escolherTipoBusca: (id) => { const s = state.search; s.type = id; s.res = null; if (s.q) runSearch(); },
    buscar: (mais) => runSearch(mais),
    carregarEmAlta: loadTrends,
    dispensarAviso: async (n) => {
      const t = state.trends;
      try { await api(`/api/v1/announcements/${n.id}/dismiss`, { method: 'POST' }); t.notices = t.notices.filter((x) => x.id !== n.id); } catch (e) { toast(e.message); }
    },
    carregarHashtags: loadFollowedTags,
    abrirTag: openTag,
    deixarTag: async (name) => {
      const f = state.followedTags;
      try { await api(`/api/v1/tags/${encodeURIComponent(name)}/unfollow`, { method: 'POST' }); f.items = f.items.filter((x) => x.name !== name); } catch (e) { toast(e.message); }
    },
    irOutra: goOther,
  };
}

function montarCasca() {
  if (casca) unmount(casca);
  const view = $('#view');
  view.replaceChildren();
  casca = mount(Casca, { target: view, props: { c: cascaCtx() } });
  flushSync();
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
    if (session && kind === 'home' && !append && !st.error) setTimeout(checkHomeMarker, 300);
  }
}

async function loadTrends() {
  const t = state.trends;
  if (t.loading) return;
  t.loading = true;
  t.error = null;
  busy(+1);
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
  document.querySelectorAll('#tabs button').forEach((b) => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#fab').hidden = tab === 'account';
  window.scrollTo(0, 0);
  const icon = document.querySelector('#tabs [aria-current="page"] svg');
  if (icon) { icon.classList.remove('bump'); void icon.getBoundingClientRect(); icon.classList.add('bump'); }
  if (tab === 'home') {
    if (!state.lists.loaded) loadLists(true);
    const k = state.homeList ? 'list' : 'home';
    if (k === 'home' && hydrateFromCache('home')) { window.scrollTo(0, store.get(scrollKey('home'), 0)); refreshWithCache('home'); }
    else if (!getList(k).items.length && !getList(k).loading) loadList(k);
  } else if (tab === 'notifications') {
    if (hydrateFromCache('notifications')) { window.scrollTo(0, store.get(scrollKey('notifications'), 0)); refreshWithCache('notifications'); }
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
const compose = composeEstado; // estado reativo (src/composicao.svelte.js)
reiniciarCompose(mkCompose());
const limits = limites;

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
  reiniciarCompose(mkCompose());
  compose.replyTo = replyTo;
  compose.edit = edit;
  compose.quote = quote;
  compose.key = crypto.randomUUID();
  $('#compose-error').textContent = '';
  setCw(false);
  closeVisMenu();
  const note = $('#reply-to');
  $('#text').disabled = false;
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
  updateCount();
  $('#composer').showModal();
  fitComposer();
  fitText();
  const t = $('#text');
  if (!edit) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
}

function togglePoll() {
  compose.poll = compose.poll ? null : { options: ['', ''], expires_in: 86400, multiple: false };
  saveDraft();
  if (compose.poll) setTimeout(() => { const f = $('#compose-poll input'); if (f) f.focus(); });
}

function removeMedia(i) {
  const m = compose.media[i];
  if (m && m.preview && m.preview.startsWith('blob:')) URL.revokeObjectURL(m.preview);
  compose.media.splice(i, 1);
}

function editAlt(m) {
  const t = h('textarea', { class: 'sheet-text', rows: '5', maxlength: '1500', placeholder: 'Descreva a imagem para quem não pode vê-la', 'aria-label': 'Descrição' }, m.description || '');
  openSheet('Descrição da mídia', [{ label: 'Salvar descrição', icon: 'check', onclick: async () => {
    m.description = t.value.trim();
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
    compose.media.push({ id: null, uploading: true, preview: URL.createObjectURL(file), description: '', type });
    const item = compose.media[compose.media.length - 1]; // o proxy do estado: mudanças nele chegam à tela
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
    }
}

function langSheet() {
  openSheet('Idioma da publicação', LANGS.map(([code, label]) => ({
    label, icon: code === compose.lang ? 'check' : null,
    onclick: () => { compose.lang = code; store.set('lang', code); saveDraft(); },
  })));
}

function scheduleSheet() {
  const pad = (n) => String(n).padStart(2, '0');
  const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const min = new Date(Date.now() + 6 * 60000);
  const input = h('input', { type: 'datetime-local', class: 'sheet-text', 'aria-label': 'Data e hora', min: local(min),
    value: compose.scheduledAt ? local(new Date(compose.scheduledAt)) : local(new Date(Date.now() + 3600000)) });
  const err = h('p', { class: 'error ro-faixa ro-faixa--erro' });
  openSheet('Agendar publicação', [{
    label: 'Agendar', icon: 'clock',
    keepOpen: true,
    onclick: () => {
      const d = new Date(input.value);
      if (!input.value || isNaN(d) || d.getTime() < Date.now() + 5 * 60000) { err.textContent = 'Escolha um horário a pelo menos 5 minutos daqui.'; return false; }
      compose.scheduledAt = d.toISOString(); return true;
    },
  }, compose.scheduledAt ? { label: 'Remover agendamento', icon: 'close', onclick: () => { compose.scheduledAt = ''; } } : null].filter(Boolean),
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
  composeUi.sugestoes = [];
  $('#suggest').hidden = true;
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
        items = r.map((x) => ({ insert: `@${x.acct}`, label: { conta: x }, sub: `@${x.acct}`, img: x.avatar_static || x.avatar, round: true }));
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
    if (!items.length) { hideSuggest(); return; }
    composeUi.sugestoes = items.map((it) => ({ ...it, tok }));
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
  composeUi.chars = t.value.length;
  composeUi.max = t.maxLength;
}

const VIS = [
  ['public', 'Pública', 'Todos veem e aparece nas timelines'],
  ['unlisted', 'Não listada', 'Todos veem, mas fica fora das timelines públicas'],
  ['private', 'Só seguidores', 'Apenas quem segue você'],
  ['direct', 'Menção direta', 'Apenas as pessoas mencionadas'],
];

function setVisibility(v) {
  composeUi.vis = VIS.some(([id]) => id === v) ? v : 'public';
}

function closeVisMenu() {
  composeUi.visMenu = false;
}

function setCw(on) {
  const cw = $('#cw');
  cw.hidden = !on;
  if (!on) cw.value = '';
  composeUi.cwOn = on;
  if (on) cw.focus();
}

// No iOS, ao abrir o teclado a janela visível encolhe e desloca; acompanhamos para o
// cabeçalho (Cancelar/Publicar) não ficar sob a barra de status.
// Arrastar a alça para baixo fecha o compositor (o rascunho fica guardado); tocar nela também fecha.
// Partes reativas do compositor (o texto e o aviso de conteúdo seguem nativos)
function mountComposicao() {
  mount(ComposicaoExtras, { target: $('#compose-extras'), props: {
    removerMidia: removeMedia, editarAlt: editAlt, rascunho: saveDraft,
  } });
  mount(ComposicaoSugestoes, { target: $('#suggest'), props: {
    escolher: (it) => suggestPick(it.tok, it), seguro: safeUrl,
  } });
  mount(ComposicaoFerramentas, { target: $('#compose-tools'), props: {
    visibilidades: VIS, idiomas: LANGS,
    aoVisibilidade: (id) => { setVisibility(id); closeVisMenu(); $('#text').focus(); },
    aoAviso: () => { setCw(!composeUi.cwOn); saveDraft(); },
    aoAnexos: addMedia, aoEnquete: togglePoll, aoAgendar: scheduleSheet, aoIdioma: langSheet,
  } });
}

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
          visibility: composeUi.vis,
          in_reply_to_id: compose.replyTo ? compose.replyTo.id : undefined,
          quoted_status_id: compose.quote ? compose.quote.id : undefined,
          media_ids: compose.media.length ? compose.media.map((m) => m.id) : undefined,
          sensitive: compose.media.length && compose.sensitive ? true : undefined,
          poll: poll ? { options: poll.options, expires_in: poll.expires_in, multiple: poll.multiple } : undefined,
          language: compose.lang || undefined,
          scheduled_at: compose.scheduledAt || undefined,
        },
      });
      if (!compose.replyTo && !compose.quote) { store.del(draftKey()); store.set('lastVisibility', composeUi.vis); }
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
  const t = activeThread();
  if (!(t && t.host)) atualizar(u); // thread de outra instância: os ids não são os nossos
}

function removeStatus(id) {
  const keep = (s) => s.id !== id && !(s.reblog && s.reblog.id === id);
  esquecer(id);
  eachStatusList((l) => { l.items = l.items.filter(keep); });
  state.notifications.items = state.notifications.items.filter((n) => !n.status || keep(n.status));
  [state.me, ...state.profiles].forEach((p) => {
    if (!p) return;
    if (p.type === 'thread') { p.ancestors = p.ancestors.filter(keep); p.descendants = p.descendants.filter(keep); }
    else if (p.pinned) p.pinned = p.pinned.filter(keep);
  });
  const t = activeThread();
  if (t && t.status.id === id) { closeProfile(); return; }
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
  montarCasca();
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
    if (cfg.polls) Object.assign(limits, { pollOptions: cfg.polls.max_options || 4, pollChars: cfg.polls.max_characters_per_option || 50, pollMin: cfg.polls.min_expiration || 300, pollMax: cfg.polls.max_expiration || 2629746 });
  } catch { /* mantém os padrões */ }
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
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeVisMenu(); });
  $('#compose-form').addEventListener('submit', submitCompose);
  $('#text').addEventListener('input', () => { updateCount(); saveDraft(); suggestUpdate(); });
  $('#text').addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) suggestUpdate(); });
  $('#text').addEventListener('click', suggestUpdate);
  $('#suggest').addEventListener('pointerdown', (e) => e.preventDefault());
  mountComposicao();
  $('#cw').addEventListener('input', saveDraft);
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
  iniciarAtualizacao();
  mount(AvisoAtualizacao, { target: document.body });
  const params = new URLSearchParams(location.search);
  const shared = sharedText(params);
  if (shared) { store.set('share', shared); ['title', 'text', 'url'].forEach((k) => params.delete(k)); history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '')); }
  if (params.has('code') || params.has('error')) await handleCallback(params);
  session = session || store.get('session');
  if (session && session.token) { persistSession(); startApp(); }
  else showLogin($('#login-error').textContent);
}

boot();

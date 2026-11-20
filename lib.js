// Funções puras/auxiliares, sem estado. Separadas do app.js para poderem ser testadas.

import { ICONS } from './icons.js';

export const OOB = 'urn:ietf:wg:oauth:2.0:oob';

/* ---------- PKCE ---------- */

export function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(bytes = 48) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

/* ---------- Utilitários ---------- */

export function normalizeHost(input) {
  const host = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '');
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(host)) return '';
  return host;
}

export function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
  } catch {
    return '';
  }
}

export function timeAgo(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d} d`;
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

/* ---------- Emojis personalizados ---------- */

export function emojiFragment(text, emojis = []) {
  const frag = document.createDocumentFragment();
  const map = new Map((emojis || []).map((e) => [e.shortcode, e]));
  if (!map.size) {
    frag.append(text);
    return frag;
  }
  let last = 0;
  for (const m of text.matchAll(/:([a-zA-Z0-9_]+):/g)) {
    const e = map.get(m[1]);
    const url = e && safeUrl(e.static_url || e.url);
    if (!url) continue;
    if (m.index > last) frag.append(text.slice(last, m.index));
    const img = document.createElement('img');
    img.className = 'emoji';
    img.src = url;
    img.alt = `:${m[1]}:`;
    img.title = img.alt;
    img.setAttribute('loading', 'lazy');
    frag.append(img);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/* ---------- Sanitização do HTML das publicações ----------
   O Mastodon já sanitiza no servidor, mas o conteúdo vem de qualquer
   instância federada; aqui fica uma segunda barreira com lista de permissão. */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'A', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'DEL', 'S',
  'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI',
]);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH']);
const ALLOWED_CLASSES = new Set(['invisible', 'ellipsis', 'mention', 'hashtag', 'u-url', 'h-card']);

function walk(src, out, emojis) {
  for (const node of src.childNodes) {
    if (node.nodeType === 3) {
      out.append(emojiFragment(node.nodeValue, emojis));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toUpperCase();
    if (DROP_TAGS.has(tag)) continue;
    if (!ALLOWED_TAGS.has(tag)) {
      walk(node, out, emojis); // desembrulha: mantém só o conteúdo
      continue;
    }
    const el = document.createElement(tag.toLowerCase());
    if (tag === 'A') {
      const href = safeUrl(node.getAttribute('href'));
      if (!href) {
        walk(node, out, emojis);
        continue;
      }
      el.setAttribute('href', href);
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'nofollow noopener noreferrer');
    }
    const classes = (node.getAttribute('class') || '')
      .split(/\s+/)
      .filter((c) => ALLOWED_CLASSES.has(c));
    if (classes.length) el.className = classes.join(' ');
    walk(node, el, emojis);
    out.append(el);
  }
}

export function sanitizeHtml(html, emojis = []) {
  const body = new DOMParser().parseFromString(html || '', 'text/html').body;
  const frag = document.createDocumentFragment();
  walk(body, frag, emojis);
  return frag;
}

/* ---------- Ícones (Hugeicons) ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgIcon(name, size = 22) {
  const parts = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ico');
  for (const [tag, attrs] of parts || []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/* ---------- Mini-gráfico (hashtags em alta) ---------- */

export function sparkline(values, w = 72, hgt = 26) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(hgt));
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  const nums = (values || []).map((v) => (Number.isFinite(v) ? v : 0));
  if (nums.length < 2) return svg;
  const max = Math.max(...nums, 1);
  const pad = 3;
  const pts = nums.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (nums.length - 1);
    const y = hgt - pad - (v / max) * (hgt - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);
  return svg;
}

/* ---------- Paginação por cabeçalho Link (seguidores/seguindo) ---------- */

export function parseNextMaxId(link) {
  const m = /<([^>]+)>\s*;\s*rel="next"/.exec(link || '');
  if (!m) return null;
  try {
    return new URL(m[1]).searchParams.get('max_id');
  } catch {
    return null;
  }
}

// Publicações canônicas da instância do usuário: a versão mais recente de cada status que já passou por uma resposta da API.
// Listas, threads, notificações e perfis guardam suas próprias cópias; ao exibir, `canon()` troca cada cópia pela versão daqui.
// Assim curtir, impulsionar ou editar atualiza um lugar só (antes `replaceStatus` varria todas as listas).
import { SvelteMap } from 'svelte/reactivity';

const MAX = 3000;
export const publicacoes = new SvelteMap();

const ehStatus = (o) => o && typeof o === 'object' && typeof o.id === 'string' && typeof o.content === 'string' && o.account && typeof o.visibility === 'string';

function guardarUm(s) {
  publicacoes.delete(s.id); // reinsere no fim: as mais antigas saem primeiro
  publicacoes.set(s.id, s);
  if (publicacoes.size > MAX) publicacoes.delete(publicacoes.keys().next().value);
  if (ehStatus(s.reblog)) guardarUm(s.reblog);
}

/** Registra todo status que aparecer dentro de uma resposta da API (lista, objeto, contexto, notificações, busca…). */
export function registrar(dado, nivel = 0) {
  if (!dado || typeof dado !== 'object' || nivel > 3) return;
  if (Array.isArray(dado)) { dado.forEach((x) => registrar(x, nivel + 1)); return; }
  if (ehStatus(dado)) { guardarUm(dado); return; }
  for (const k of ['status', 'last_status', 'ancestors', 'descendants', 'statuses']) if (dado[k]) registrar(dado[k], nivel + 1);
}

/** A versão mais recente de `s` (e do status que ele impulsiona). Devolve o próprio `s` se não houver. */
export function canon(s) {
  if (!s) return s;
  let w = publicacoes.get(s.id) || s;
  if (w.reblog) {
    const r = publicacoes.get(w.reblog.id);
    if (r && r !== w.reblog) w = { ...w, reblog: r };
  }
  return w;
}

/** Troca uma publicação (curtida, edição, tradução…): a mesma versão passa a valer em todas as telas. */
export function atualizar(u) { guardarUm(u); }

export function esquecer(id) { publicacoes.delete(id); }

export function limpar() { publicacoes.clear(); }

// Ilhas Svelte: telas feitas em Svelte montadas dentro do app em JS puro. O render() do app reconstrói a
// vista inteira a cada mudança; aqui cada ilha é montada de novo com os dados do momento e a anterior é desmontada.
import { mount, unmount } from 'svelte';

let vivas = [];

/** Tipos de lista cuja tela é reativa (Svelte) na vista atual: carregar essas listas não precisa reconstruir a vista. */
export const reativas = new Map(); // tipo -> objeto da lista mostrado

export function desmontarIlhas() {
  for (const i of vivas) unmount(i);
  vivas = [];
  reativas.clear();
}

/** Monta `Tela` dentro de `vista` com `props`. Chamar depois de desmontarIlhas() (o render() faz isso). */
export function ilha(vista, Tela, props = {}) {
  const alvo = document.createElement('div');
  vista.append(alvo);
  vivas.push(mount(Tela, { target: alvo, props }));
}

/** Monta `Tela` num contêiner solto (display: contents) e o devolve, para telas em JS que ainda montam a vista com nós de DOM. */
export function montar(Tela, props = {}) {
  const alvo = document.createElement('div');
  alvo.style.display = 'contents';
  vivas.push(mount(Tela, { target: alvo, props }));
  return alvo;
}

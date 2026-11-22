// Ilhas Svelte: telas feitas em Svelte montadas dentro do app em JS puro. O render() do app reconstrói a
// vista inteira a cada mudança; aqui cada ilha é montada de novo com os dados do momento e a anterior é desmontada.
import { mount, unmount } from 'svelte';

let vivas = [];

export function desmontarIlhas() {
  for (const i of vivas) unmount(i);
  vivas = [];
}

/** Monta `Tela` dentro de `vista` com `props`. Chamar depois de desmontarIlhas() (o render() faz isso). */
export function ilha(vista, Tela, props = {}) {
  const alvo = document.createElement('div');
  vista.append(alvo);
  vivas.push(mount(Tela, { target: alvo, props }));
}

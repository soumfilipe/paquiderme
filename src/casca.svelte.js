// Gatilho para o trecho legado da casca: telas empilhadas que ainda são montadas em JS (entryView) refazem-se quando muda.
// As telas em Svelte não precisam dele: reagem sozinhas ao estado.
export const gatilho = $state({ v: 0 });

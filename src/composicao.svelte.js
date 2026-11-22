// Estado reativo do compositor. O texto e o aviso de conteúdo continuam campos nativos (por causa do teclado do iOS);
// anexos, enquete, ferramentas, contador e sugestões leem daqui e se atualizam sozinhos.

export const compose = $state({});

/** Limites da instância (preenchidos ao iniciar). */
export const limites = $state({ translation: false, maxChars: 500, maxMedia: 4, pollOptions: 4, pollChars: 50, pollMin: 300, pollMax: 2629746 });

/** Estado de tela do compositor. */
export const ui = $state({ vis: 'public', visMenu: false, cwOn: false, chars: 0, max: 2000, sugestoes: [] });

/** Começa uma nova composição mantendo a mesma referência. */
export function reiniciarCompose(novo) {
  for (const k of Object.keys(compose)) if (!(k in novo)) delete compose[k];
  Object.assign(compose, novo);
}

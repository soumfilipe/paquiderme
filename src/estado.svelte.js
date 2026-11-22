// Estado reativo do app. Um único objeto `estado` (proxy de $state): componentes Svelte que o leem reagem a mudanças
// sem passar pelo render(). O app ainda chama render() à mão; isso sai nas próximas fases (ver documento de design).

export const estado = $state({});

/** Troca todo o conteúdo (login, troca de conta, saída) mantendo a mesma referência. */
export function reiniciar(novo) {
  for (const k of Object.keys(estado)) if (!(k in novo)) delete estado[k];
  Object.assign(estado, novo);
}

// Atualização do app (PWA), no mesmo fluxo do Life OS.
// O service worker novo baixa em segundo plano e fica esperando. Quando está pronto, o app mostra
// "nova versão do app · atualizar"; ao tocar, o SW novo assume e a página recarrega.
// Nada recarrega sozinho, para não perder um rascunho no compositor.
export const atualizacao = $state({ disponivel: false, dispensada: false, aplicando: false });

let registro;

function avisarSeEsperando(r) {
  // Só é atualização se já havia um SW controlando a página (na primeira instalação, não).
  if (r.waiting && navigator.serviceWorker.controller) {
    atualizacao.disponivel = true;
    atualizacao.dispensada = false;
  }
}

export async function iniciarAtualizacao() {
  if (!('serviceWorker' in navigator)) return;
  try {
    registro = await navigator.serviceWorker.register('sw.js');
  } catch {
    return; // sem SW o app funciona, só não abre offline
  }
  const r = registro;
  avisarSeEsperando(r);
  r.addEventListener('updatefound', () => {
    const novo = r.installing;
    novo?.addEventListener('statechange', () => { if (novo.state === 'installed') avisarSeEsperando(r); });
  });
  // app instalado fica dias aberto em segundo plano: procura versão nova ao voltar
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') r.update().catch(() => {});
  });
}

export function aplicarAtualizacao() {
  const esperando = registro?.waiting;
  if (!esperando) { location.reload(); return; }
  atualizacao.aplicando = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  esperando.postMessage({ type: 'SKIP_WAITING' });
}

export function dispensarAtualizacao() {
  atualizacao.dispensada = true;
}

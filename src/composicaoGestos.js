// Gestos e ajustes do compositor (janela <dialog id="composer">): arrastar a alça para fechar, não rolar a página de trás
// e acompanhar o teclado do iOS.

const janela = () => document.getElementById('composer');

/** Com o compositor aberto, a página de trás não rola nem "estica": só o texto e o corpo do formulário podem rolar. */
export function bloquearRolagemDeFundo() {
  const aoMover = (e) => {
    if (!janela().open) return;
    const ta = e.target.closest && e.target.closest('#text');
    if (ta && ta.scrollHeight > ta.clientHeight) return;
    const cb = e.target.closest && e.target.closest('#compose-body');
    if (cb && cb.scrollHeight > cb.clientHeight) return;
    e.preventDefault();
  };
  document.addEventListener('touchmove', aoMover, { passive: false });
  return () => document.removeEventListener('touchmove', aoMover);
}

/** Ação: arrastar a alça para baixo fecha o compositor (o rascunho fica guardado); tocar nela também fecha. */
export function arrastarParaFechar(alca) {
  const dlg = janela();
  let y0 = null, dy = 0, moved = false, t0 = 0;
  const reset = () => { dlg.style.transform = ''; dlg.classList.remove('dragging', 'settling'); };
  const down = (e) => {
    y0 = e.clientY; dy = 0; moved = false; t0 = e.timeStamp;
    alca.setPointerCapture(e.pointerId);
    dlg.classList.remove('settling');
    dlg.classList.add('dragging');
  };
  const move = (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    if (dy > 6) moved = true;
    dlg.style.transform = `translateY(${dy}px)`;
  };
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
  alca.addEventListener('pointerdown', down);
  alca.addEventListener('pointermove', move);
  alca.addEventListener('pointerup', end);
  alca.addEventListener('pointercancel', end);
  return { destroy() { alca.removeEventListener('pointerdown', down); alca.removeEventListener('pointermove', move); alca.removeEventListener('pointerup', end); alca.removeEventListener('pointercancel', end); } };
}

/** No iOS, ao abrir o teclado a janela visível encolhe e desloca: acompanha para o cabeçalho não ficar sob a barra de status. */
export function ajustarJanela() {
  const d = janela();
  const vv = window.visualViewport;
  if (!d.open || !vv) return;
  d.style.top = `${vv.offsetTop}px`;
  d.style.height = `${vv.height}px`;
  d.classList.toggle('kb', window.innerHeight - vv.height > 120);
}

export function acompanharTeclado() {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener('resize', ajustarJanela);
  vv.addEventListener('scroll', ajustarJanela);
  return () => { vv.removeEventListener('resize', ajustarJanela); vv.removeEventListener('scroll', ajustarJanela); };
}

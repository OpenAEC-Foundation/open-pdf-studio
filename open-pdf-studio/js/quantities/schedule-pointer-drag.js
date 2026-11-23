// Een staat uit het linkerpaneel op de pagina slepen. Dit loopt via
// pointer-events: op de desktop houdt Tauri de native drop van de webview
// bezet voor externe bestanden, waardoor een HTML5-drop de PDF nooit bereikt.
import { createOrganizerPointerDrag } from '../pdf/organizer-pointer-drag.js';

/** De staat onder een ingedrukte rij. Ook vanaf een knop: die liggen bij hover
 *  over de rij, en een klik blijft een klik zolang de muis niet beweegt. Alleen
 *  het naamveld sleept niet, daar selecteer je tekst. */
export function staatIdBijDoel(target) {
  if (!target?.closest || target.closest('input')) return null;
  return target.closest('.schedules-item')?.dataset?.scheduleId ?? null;
}

/** Mag hier geplaatst worden? In doorlopend moet het punt op een pagina liggen. */
export function isPaginaDoel(target, viewMode) {
  if (!target?.closest || !target.closest('#pdf-container')) return false;
  return viewMode !== 'continuous' || !!target.closest('.canvas-container-cont');
}

export function koppelStaatSlepen(lijst, { naam, plaats }) {
  const doc = lijst.ownerDocument;
  let beeld = null;
  let staatId = null;
  let sleep = null;

  const opruimen = () => {
    beeld?.remove();
    beeld = null;
    doc.removeEventListener('keydown', opEscape, true);
  };
  const zetBeeld = (x, y) => {
    if (beeld) beeld.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
  };
  function opEscape(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    sleep.cancel();
  }

  sleep = createOrganizerPointerDrag(lijst, {
    keyAt: staatIdBijDoel,
    start(id) {
      staatId = id;
      beeld = doc.createElement('div');
      beeld.className = 'schedules-drag-ghost';
      beeld.textContent = naam(id) ?? '';
      doc.body.appendChild(beeld);
      doc.addEventListener('keydown', opEscape, true);
    },
    move: (e) => zetBeeld(e.clientX, e.clientY),
    finish({ clientX, clientY, cancelled }) {
      opruimen();
      if (!cancelled) plaats(staatId, clientX, clientY);
    },
  });
  return () => { sleep.destroy(); opruimen(); };
}

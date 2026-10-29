import { Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { visible, message, progress, cancelHandler, cancelDisabled } from '../stores/loadingStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { koppelEscAnnuleren } from '../../ui/chrome/laad-annuleren.js';

export default function LoadingOverlay() {
  const { t } = useTranslation('common');
  // Eén klik op Annuleren is genoeg: daarna blijft de knop uit tot de
  // volgende taak (het werk stopt pas na de lopende stap).
  const [geannuleerd, setGeannuleerd] = createSignal(false);
  // Verschuiving na slepen; terug naar het midden bij de volgende taak.
  const [verschuiving, setVerschuiving] = createSignal({ x: 0, y: 0 });
  createEffect(() => {
    if (!visible()) { setGeannuleerd(false); setVerschuiving({ x: 0, y: 0 }); }
  });

  // Uit na een klik, of als het werk voorbij het punt zonder terugkeer is (#766).
  const kanAnnuleren = () => !!cancelHandler() && !cancelDisabled() && !geannuleerd();
  const annuleer = () => {
    if (!kanAnnuleren()) return;
    setGeannuleerd(true);
    cancelHandler()?.();
  };

  // Het venster is verplaatsbaar, zoals een gewoon modaal venster; de
  // cursor blijft de standaardcursor. Klikken ernaast sluit het niet.
  let sleep = null;
  const opBeweeg = (e) => {
    if (!sleep) return;
    setVerschuiving({ x: sleep.x + e.clientX - sleep.startX, y: sleep.y + e.clientY - sleep.startY });
  };
  const opLos = () => { sleep = null; };
  const opNeer = (e) => {
    if (e.button !== 0 || e.target.closest?.('button')) return;
    const { x, y } = verschuiving();
    sleep = { x, y, startX: e.clientX, startY: e.clientY };
    e.preventDefault();
  };

  // Esc = Annuleren (#766).
  let loskoppelen = null;
  onMount(() => {
    loskoppelen = koppelEscAnnuleren(window, {
      open: () => visible() && !!cancelHandler(),
      kan: kanAnnuleren,
      annuleer,
    });
    document.addEventListener('mousemove', opBeweeg);
    document.addEventListener('mouseup', opLos);
  });
  onCleanup(() => {
    loskoppelen?.();
    document.removeEventListener('mousemove', opBeweeg);
    document.removeEventListener('mouseup', opLos);
  });

  return (
    <div class="loading-overlay" classList={{ visible: visible() }}>
      <div class="loading-content"
        role={cancelHandler() ? 'dialog' : undefined}
        aria-modal={cancelHandler() ? 'true' : undefined}
        style={{ transform: `translate(${verschuiving().x}px, ${verschuiving().y}px)` }}
        onMouseDown={opNeer}>
        <Show when={progress() == null}>
          <div class="loading-spinner"></div>
        </Show>
        <div class="loading-text">{message()}</div>
        <Show when={progress() != null}>
          <div class="loading-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"
            aria-valuenow={Math.round((progress() || 0) * 100)}>
            <div class="loading-progress-fill" style={{ width: `${(progress() || 0) * 100}%` }}></div>
          </div>
        </Show>
        <Show when={cancelHandler()}>
          <button type="button" class="loading-cancel" disabled={!kanAnnuleren()}
            onClick={annuleer}>
            {t('cancel')}
          </button>
        </Show>
      </div>
    </div>
  );
}

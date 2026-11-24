import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { startCoordOriginTool } from '../../../tools/tools/coord-origin-tool.js';
import {
  zetPaginaNulpunt, zetNulpuntLinksonder, neemNulpuntOverVanOnderlegger,
  onderleggerNulpunt, huidigNulpunt,
} from '../../../annotations/coord-nulpunt-app.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// Nulpunt van de coördinaatlabels van het huidige blad kiezen: een punt op de
// tekening, linksonder, of het nulpunt van de onderlegger (CAD-modelmatrix).
export default function CoordOriginDialog() {
  const { t } = useTranslation('dialogs');
  const pagina = () => getActiveDocument()?.currentPage || 1;
  // Opnieuw lezen na elke handeling.
  const [versie, setVersie] = createSignal(0);
  const huidig = () => { versie(); return huidigNulpunt(pagina()); };
  const onderlegger = () => { versie(); return onderleggerNulpunt(pagina()); };

  const klaar = () => {
    redraw();
    setVersie(versie() + 1);
  };

  return (
    <Dialog title={t('coordOrigin.title')} dialogClass="coord-origin-dialog" onClose={() => closeDialog('coord-origin')}>
      <div class="coord-origin-body">
        <div class="coord-origin-state">
          <Show when={huidig()} fallback={t('coordOrigin.none', { page: pagina() })}>
            {t('coordOrigin.current', { page: pagina() })}
          </Show>
        </div>
        <div class="coord-origin-actions">
          <button class="pref-btn" onClick={() => { closeDialog('coord-origin'); startCoordOriginTool(); }}>
            {t('coordOrigin.pick')}
          </button>
          <button class="pref-btn" onClick={() => { zetNulpuntLinksonder(pagina()); klaar(); }}>
            {t('coordOrigin.lowerLeft')}
          </button>
          <button class="pref-btn" disabled={!onderlegger()}
            onClick={() => { neemNulpuntOverVanOnderlegger(pagina()); klaar(); }}>
            {t('coordOrigin.underlay')}
          </button>
          <button class="pref-btn" disabled={!huidig()} onClick={() => { zetPaginaNulpunt(pagina(), null); klaar(); }}>
            {t('coordOrigin.clear')}
          </button>
        </div>
        <div class="coord-origin-hint">{t('coordOrigin.hint')}</div>
      </div>
    </Dialog>
  );
}

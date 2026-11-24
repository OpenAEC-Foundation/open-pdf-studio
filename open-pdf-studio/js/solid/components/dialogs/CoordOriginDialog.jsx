import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { startCoordOriginTool } from '../../../tools/tools/coord-origin-tool.js';
import {
  zetPaginaNulpunt, zetNulpuntLinksonder, neemNulpuntOverVanOnderlegger,
  onderleggerNulpunt, huidigNulpunt, zetVolgendeWaarde, zetNulpuntWaarden, volgendeNulpuntWaarde,
} from '../../../annotations/coord-nulpunt-app.js';
import { leesGetalOfNull, toonGetal } from '../../../core/getal-invoer.js';
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

  // Waarden van het nulpunt (meeteenheden): standaard (0, 0), maar het punt kan
  // bijv. een RD-coördinaat zijn. Gevuld met de waarden van het huidige nulpunt.
  const start = huidigNulpunt(pagina()) || volgendeNulpuntWaarde();
  const [wx, setWx] = createSignal(toonGetal(start.wx ?? 0));
  const [wy, setWy] = createSignal(toonGetal(start.wy ?? 0));
  const waarden = () => ({ wx: leesGetalOfNull(wx()) ?? 0, wy: leesGetalOfNull(wy()) ?? 0 });
  const onthoud = () => { const w = waarden(); zetVolgendeWaarde(w.wx, w.wy); };

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
        <div class="coord-origin-values">
          <span>{t('coordOrigin.valuesTitle')}</span>
          <label>X <input type="text" value={wx()} onInput={(e) => setWx(e.currentTarget.value)} /></label>
          <label>Y <input type="text" value={wy()} onInput={(e) => setWy(e.currentTarget.value)} /></label>
          <button class="pref-btn" disabled={!huidig()}
            onClick={() => { const w = waarden(); onthoud(); zetNulpuntWaarden(pagina(), w.wx, w.wy); klaar(); }}>
            {t('coordOrigin.apply')}
          </button>
        </div>
        <div class="coord-origin-actions">
          <button class="pref-btn" onClick={() => { onthoud(); closeDialog('coord-origin'); startCoordOriginTool(); }}>
            {t('coordOrigin.pick')}
          </button>
          <button class="pref-btn" onClick={() => { onthoud(); zetNulpuntLinksonder(pagina()); klaar(); }}>
            {t('coordOrigin.lowerLeft')}
          </button>
          <button class="pref-btn" disabled={!onderlegger()}
            onClick={() => { onthoud(); neemNulpuntOverVanOnderlegger(pagina()); klaar(); }}>
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

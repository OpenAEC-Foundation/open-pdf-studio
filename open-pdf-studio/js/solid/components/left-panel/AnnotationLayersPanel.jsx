import { Show, Index, createSignal } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { layerRows } from '../../../annotations/annotatie-lagen.js';
import {
  panelVisible, setPanelVisible, layersVersion,
  addAnnotationLayer, renameAnnotationLayer, setAnnotationLayerFlag,
  setAnnotationLayerColor, moveAnnotationLayerBy, setCurrentAnnotationLayer,
  requestDeleteAnnotationLayer,
} from '../../stores/annotationLayersStore.js';

// "Markeringslagen" (#468): markeringen groeperen op benoemde lagen. Per laag
// een keuzerondje voor de huidige laag (daar landen nieuwe markeringen), een
// kleur, de naam, het aantal markeringen, en de schakelaars zichtbaar,
// afdrukbaar en vergrendeld. Gedockt links, naast Zichtbaarheid Elementen.
// De regels staan in annotations/annotatie-lagen.js; hier alleen de weergave.
// De rijen staan in een <Index>: de DOM per plek blijft staan als het paneel
// opnieuw rekent, zodat een open naamveld een verversing overleeft.

const ICOON = {
  add: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
  rename: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 13l1-3 7-7 2 2-7 7-3 1z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
  moveUp: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3l-4 5h8zM8 8v5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
  moveDown: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 13l-4-5h8zM8 8V3" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
  delete: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
};

export default function AnnotationLayersPanel() {
  const { t } = useTranslation('ribbon');
  const [gekozen, setGekozen] = createSignal(null);
  const [bewerkId, setBewerkId] = createSignal(null);
  const [fout, setFout] = createSignal('');

  const rows = () => {
    layersVersion();
    return layerRows(getActiveDocument(), t('annotationLayers.defaultName'));
  };
  const gekozenRij = () => rows().find((r) => r.id === gekozen()) || null;
  const gekozenIndex = () => rows().findIndex((r) => r.id === gekozen());

  const foutTekst = (code) => (code === 'name-taken'
    ? t('annotationLayers.nameTaken')
    : t('annotationLayers.nameEmpty'));

  function beginHernoemen(rij) {
    if (!rij || rij.isDefault) return;
    setFout('');
    setBewerkId(rij.id);
  }

  function hernoem(id, waarde) {
    const code = renameAnnotationLayer(id, waarde);
    if (code) {
      setFout(foutTekst(code));
      return false;
    }
    setFout('');
    setBewerkId(null);
    return true;
  }

  function nieuw() {
    const id = addAnnotationLayer();
    if (!id) return;
    setGekozen(id);
    setFout('');
    setBewerkId(id);
  }

  return (
    <Show when={panelVisible()}>
      <div class="annotation-layers-panel" id="annotation-layers-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>

        <div class="al-panel-header">
          <span class="al-panel-title">{t('annotationLayers.title')}</span>
          <button type="button" class="al-panel-close"
            title={t('annotationLayers.close')}
            onClick={() => setPanelVisible(false)}>&times;</button>
        </div>

        <div class="al-toolbar">
          <button type="button" class="al-tool" title={t('annotationLayers.add')}
            disabled={!getActiveDocument()} onClick={nieuw} innerHTML={ICOON.add} />
          <button type="button" class="al-tool" title={t('annotationLayers.rename')}
            disabled={!gekozenRij() || gekozenRij().isDefault}
            onClick={() => beginHernoemen(gekozenRij())} innerHTML={ICOON.rename} />
          <button type="button" class="al-tool" title={t('annotationLayers.moveUp')}
            disabled={gekozenIndex() <= 0}
            onClick={() => moveAnnotationLayerBy(gekozen(), -1)} innerHTML={ICOON.moveUp} />
          <button type="button" class="al-tool" title={t('annotationLayers.moveDown')}
            disabled={gekozenIndex() < 0 || gekozenIndex() >= rows().length - 1}
            onClick={() => moveAnnotationLayerBy(gekozen(), 1)} innerHTML={ICOON.moveDown} />
          <button type="button" class="al-tool" title={t('annotationLayers.delete')}
            disabled={!gekozenRij() || gekozenRij().isDefault}
            onClick={() => requestDeleteAnnotationLayer(gekozen())} innerHTML={ICOON.delete} />
        </div>

        <div class="al-column-head">
          <span class="al-col-cur" title={t('annotationLayers.setCurrent')}>{t('annotationLayers.colCurrent')}</span>
          <span class="al-col-name">{t('annotationLayers.colName')}</span>
          <span class="al-col-count">{t('annotationLayers.colCount')}</span>
          <span class="al-col-flag" title={t('annotationLayers.toggleVisible')}>{t('annotationLayers.colVisible')}</span>
          <span class="al-col-flag" title={t('annotationLayers.togglePrintable')}>{t('annotationLayers.colPrintable')}</span>
          <span class="al-col-flag" title={t('annotationLayers.toggleLocked')}>{t('annotationLayers.colLocked')}</span>
        </div>

        <div class="al-panel-body">
          <Index each={rows()}>
            {(rij) => (
              <div class="al-row"
                classList={{
                  'al-row-selected': gekozen() === rij().id,
                  'al-row-hidden': !rij().visible,
                  'al-row-current': rij().current,
                }}
                onClick={() => setGekozen(rij().id)}>
                <label class="al-cell-center" title={t('annotationLayers.setCurrent')}>
                  <input type="radio" name="al-current" checked={rij().current}
                    onChange={() => setCurrentAnnotationLayer(rij().id)} />
                </label>
                <div class="al-name-cell">
                  <input type="color" class="al-swatch" title={t('annotationLayers.color')}
                    value={rij().color || '#808080'}
                    onChange={(e) => setAnnotationLayerColor(rij().id, e.currentTarget.value)} />
                  <Show when={bewerkId() === rij().id} fallback={
                    <span class="al-name" title={rij().name}
                      onDblClick={() => beginHernoemen(rij())}>{rij().name}</span>
                  }>
                    {/* Niet aan value={} gebonden: een verversing van de rijen
                        zou de getypte tekst dan overschrijven. */}
                    <input type="text" class="al-name-input"
                      ref={(el) => { el.value = rij().name; queueMicrotask(() => { el.focus(); el.select(); }); }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') hernoem(rij().id, e.currentTarget.value);
                        else if (e.key === 'Escape') { setFout(''); setBewerkId(null); }
                      }}
                      onBlur={(e) => { if (!hernoem(rij().id, e.currentTarget.value)) { setFout(''); setBewerkId(null); } }} />
                  </Show>
                </div>
                <span class="al-count">{rij().count}</span>
                <label class="al-cell-center" title={t('annotationLayers.toggleVisible')}>
                  <input type="checkbox" checked={rij().visible}
                    onChange={(e) => setAnnotationLayerFlag(rij().id, 'visible', e.currentTarget.checked)} />
                </label>
                <label class="al-cell-center" title={t('annotationLayers.togglePrintable')}>
                  <input type="checkbox" checked={rij().printable}
                    onChange={(e) => setAnnotationLayerFlag(rij().id, 'printable', e.currentTarget.checked)} />
                </label>
                <label class="al-cell-center" title={t('annotationLayers.toggleLocked')}>
                  <input type="checkbox" checked={rij().locked}
                    onChange={(e) => setAnnotationLayerFlag(rij().id, 'locked', e.currentTarget.checked)} />
                </label>
              </div>
            )}
          </Index>
          <Show when={fout()}>
            <div class="al-error">{fout()}</div>
          </Show>
        </div>
      </div>
    </Show>
  );
}

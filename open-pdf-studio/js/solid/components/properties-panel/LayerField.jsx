import { createResource, For, Show } from 'solid-js';
import { annotProps, setAnnotationLayerProp } from '../../stores/propertiesStore.js';
import { layersVersion, defaultLayerName } from '../../stores/annotationLayersStore.js';
import { items as drawingLayerRows } from '../../stores/panels/layersStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { laagKeuzeOpties } from '../../../annotations/laag-keuze.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Laag van een markering (#377): een markeringslaag van de app, of een laag
// van de tekening (dan gaat de markering met die laag aan en uit, en krijgt
// ze bij het opslaan /OC naar die OCG).

async function tekeningLagen(doc) {
  if (!doc?.pdfDoc) return [];
  try {
    const [{ lagenLijst }, schakelen] = await Promise.all([
      import('../../../ui/panels/lagen-lijst.js'),
      import('../../../pdf/lagen-schakelen.js'),
    ]);
    const config = schakelen.eigenLaagConfig(doc) || await doc.pdfDoc.getOptionalContentConfig?.();
    const boom = await schakelen.lagenBoom(doc);
    return lagenLijst(config, { overslaan: doc._annotatieLaagOcgIds || new Set(), boom })
      .filter((r) => !r.kop)
      .map((r) => ({ id: r.id, name: r.name, visible: r.visible, depth: r.depth }));
  } catch {
    return [];
  }
}

export default function LayerField(props) {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const value = () => props.value ?? annotProps.layer;

  // Opnieuw bij een ander document, een wijziging aan de markeringslagen of
  // een nieuwe stand in het paneel Lagen.
  const [lagen] = createResource(
    () => ({ doc: getActiveDocument(), pdfDoc: getActiveDocument()?.pdfDoc, v: layersVersion(), rijen: drawingLayerRows() }),
    ({ doc }) => tekeningLagen(doc),
    { initialValue: [] },
  );

  const opties = () => {
    layersVersion();
    const doc = getActiveDocument();
    return doc ? laagKeuzeOpties(doc, lagen(), defaultLayerName()) : { markeringen: [], tekening: [] };
  };

  const kies = (waarde) => {
    const id = waarde.startsWith('o:') ? waarde.slice(2) : null;
    const laag = id ? lagen().find((l) => l.id === id) : null;
    setAnnotationLayerProp(waarde, laag ? { name: laag.name, visible: laag.visible } : {});
  };

  return (
    <div class={props.groupClass || 'property-group'}>
      <label for={props.id}>{props.label || t('general.layer')}</label>
      <select id={props.id} class={props.selectClass} title={props.title} value={value()}
        disabled={props.disabled}
        onChange={(e) => kies(e.target.value)}>
        <Show when={value() === 'mixed'}>
          <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
        </Show>
        <optgroup label={t('general.layerMarkupGroup')}>
          <For each={opties().markeringen}>
            {(o) => <option value={o.waarde} selected={o.waarde === value()}>{o.naam}</option>}
          </For>
        </optgroup>
        <Show when={opties().tekening.length}>
          <optgroup label={t('general.layerDocumentGroup')}>
            <For each={opties().tekening}>
              {(o) => <option value={o.waarde} selected={o.waarde === value()}>{o.naam}</option>}
            </For>
          </optgroup>
        </Show>
      </select>
    </div>
  );
}

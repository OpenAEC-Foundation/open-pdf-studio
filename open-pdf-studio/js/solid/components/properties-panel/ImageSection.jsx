import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, resetImageSize, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { PapierMaatInvoer, PapierEenheidKeuze, PapierEenheidLabel } from './PapierMaat.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import i18next from '../../../i18n/config.js';
import { getActiveDocument } from '../../../core/state.js';

// Linked image actions — the annotation refreshes its bitmap from this file
// (at link time, on demand and on document open).
function _selAnn() {
  const doc = getActiveDocument();
  const sel = doc?.selectedAnnotations || [];
  return sel.length === 1 ? sel[0] : null;
}

async function _linkImageFile() {
  const ann = _selAnn();
  if (!ann) return;
  try {
    const dlg = window.__TAURI__?.dialog;
    if (!dlg) return;
    const file = await dlg.open({
      title: i18next.t('image.linkImageTitle', { ns: 'properties' }),
      filters: [{ name: i18next.t('image.imageFilter', { ns: 'properties' }), extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }],
      multiple: false,
    });
    if (!file) return;
    const path = typeof file === 'string' ? file : file.path;
    updateAnnotProp('linkedPath', path);
    const m = await import('../../../annotations/image-drop.js');
    await m.refreshLinkedImage(ann);
  } catch (e) {
    console.warn('[linked-image] koppelen mislukt:', e);
  }
}

async function _refreshLinked() {
  const ann = _selAnn();
  if (!ann?.linkedPath) return;
  const m = await import('../../../annotations/image-drop.js');
  await m.refreshLinkedImage(ann);
}

export default function ImageSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.image}>
      <CollapsibleSection title={t('image.title')} name="image" id="prop-image-section">
        {/* Breedte en hoogte in de gekozen papiereenheid (#598); het model
            blijft in paginapunten. */}
        <div class="property-group">
          <label>{t('image.width')}</label>
          <PapierMaatInvoer pt={() => annotProps.imageWidth} bron={() => annotProps.id}
            disabled={isLocked()}
            onInvoer={(tekst) => updateAnnotProp('imageWidth', tekst)} />
          <PapierEenheidKeuze />
        </div>

        <div class="property-group">
          <label>{t('image.height')}</label>
          <PapierMaatInvoer pt={() => annotProps.imageHeight} bron={() => annotProps.id}
            disabled={isLocked()}
            onInvoer={(tekst) => updateAnnotProp('imageHeight', tekst)} />
          <PapierEenheidLabel />
        </div>

        <div class="property-group">
          <label>{t('image.lockAspectRatio')}</label>
          <select value={annotProps.lockAspectRatio ? 'yes' : 'no'}
            disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('lockAspectRatio', e.target.value === 'yes')}>
            <option value="no">{tCommon('no')}</option>
            <option value="yes">{tCommon('yes')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('image.rotation')}</label>
          <PrefComboBox
            value={() => annotProps.imageRotation}
            setValue={(val) => updateAnnotProp('imageRotation', val)}
            options={[0, 45, 90, 135, 180, 225, 270, 315]}
            min={-360} max={360} fallback={0} suffix="°"
            disabled={isLocked}
          />
        </div>

        <div class="property-group">
          <label>{t('image.tint')}</label>
          <div style={{ display: 'flex', gap: '4px', 'align-items': 'center' }}>
            <input type="color"
              value={annotProps.tintColor || '#ff0000'}
              disabled={isLocked()}
              style={{ width: '36px', height: '20px', padding: '0' }}
              onInput={(e) => updateAnnotProp('tintColor', e.target.value)} />
            <button type="button" class="prop-action-btn"
              disabled={isLocked() || !annotProps.tintColor}
              onClick={() => updateAnnotProp('tintColor', '')}>
              {t('image.tintNone')}
            </button>
          </div>
        </div>

        <div class="property-group">
          <label>{t('image.frameWidth')}</label>
          <PrefComboBox
            value={() => annotProps.frameWidth}
            setValue={(val) => updateAnnotProp('frameWidth', val)}
            options={[0, 0.5, 1, 2, 3, 4, 6, 8, 10]}
            min={0} max={30} fallback={0} suffix="pt"
            disabled={isLocked}
          />
        </div>

        <Show when={(parseFloat(annotProps.frameWidth) || 0) > 0}>
          <div class="property-group">
            <label>{t('image.frameColor')}</label>
            <input type="color"
              value={annotProps.frameColor || '#000000'}
              disabled={isLocked()}
              style={{ width: '36px', height: '20px', padding: '0' }}
              onInput={(e) => updateAnnotProp('frameColor', e.target.value)} />
          </div>
        </Show>

        <div class="property-group">
          <label></label>
          <button type="button" class="prop-action-btn"
            disabled={isLocked()}
            onClick={() => resetImageSize()}>
            {t('image.resetToOriginal')}
          </button>
        </div>

        {/* Bijsnijden (crop, issue #212): per zijde een percentage 0-90 van
            de bron dat wordt weggesneden — niet-destructief, zoals in
            gangbare kantoorsoftware. */}
        <div class="property-group">
          <label>{t('image.cropLeft')}</label>
          <input type="text" inputmode="decimal" data-getal min="0" max="90" step="1"
            value={annotProps.cropLeft} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('cropLeft', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('image.cropRight')}</label>
          <input type="text" inputmode="decimal" data-getal min="0" max="90" step="1"
            value={annotProps.cropRight} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('cropRight', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('image.cropTop')}</label>
          <input type="text" inputmode="decimal" data-getal min="0" max="90" step="1"
            value={annotProps.cropTop} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('cropTop', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('image.cropBottom')}</label>
          <input type="text" inputmode="decimal" data-getal min="0" max="90" step="1"
            value={annotProps.cropBottom} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('cropBottom', e.target.value)} />
        </div>

        <Show when={(parseFloat(annotProps.cropLeft) || 0) > 0 || (parseFloat(annotProps.cropRight) || 0) > 0 ||
                    (parseFloat(annotProps.cropTop) || 0) > 0 || (parseFloat(annotProps.cropBottom) || 0) > 0}>
          <div class="property-group">
            <label></label>
            <button type="button" class="prop-action-btn"
              disabled={isLocked()}
              onClick={() => {
                updateAnnotProp('cropLeft', 0);
                updateAnnotProp('cropRight', 0);
                updateAnnotProp('cropTop', 0);
                updateAnnotProp('cropBottom', 0);
              }}>
              {t('image.resetCrop')}
            </button>
          </div>
        </Show>

        <div class="property-group">
          <label>{t('image.linkedFile')}</label>
          <span title={annotProps.linkedPath || ''}
            style={{ 'font-size': '11px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', direction: 'rtl', 'text-align': 'left', color: annotProps.linkedPath ? 'inherit' : '#888' }}>
            {annotProps.linkedPath ? annotProps.linkedPath.split(/[\\/]/).pop() : t('image.notLinked')}
          </span>
        </div>

        <div class="property-group">
          <label></label>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button type="button" class="prop-action-btn" disabled={isLocked()}
              onClick={() => _linkImageFile()}>
              {t('image.linkFile')}
            </button>
            <Show when={annotProps.linkedPath}>
              <button type="button" class="prop-action-btn" disabled={isLocked()}
                onClick={() => _refreshLinked()}>
                {t('image.refreshLink')}
              </button>
              <button type="button" class="prop-action-btn" disabled={isLocked()}
                onClick={() => updateAnnotProp('linkedPath', '')}>
                {t('image.unlink')}
              </button>
            </Show>
          </div>
        </div>
      </CollapsibleSection>
    </Show>
  );
}

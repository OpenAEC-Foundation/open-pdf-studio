// Properties of a placed dynamic stamp (#629): its field values stay
// editable (e.g. correct the date); every change regenerates the stamp.
// "Lock stamp" makes it final: no more field edits, and the PDF gets the
// ReadOnly + Locked flags.
import { Show, For, createSignal, createMemo } from 'solid-js';
import { annotProps, getCurrentAnnotation } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { dynamicStampFields } from '../../../annotations/dynamic-stamp.js';
import {
  editDynamicStampField, refreshDynamicStamp, lockPlacedDynamicStamp,
} from '../../../annotations/dynamic-stamp-place.js';
import { showConfirm } from '../../../ui/chrome/confirm-dialog.js';
import { fieldLabel } from '../dialogs/DynamicStampFieldsDialog.jsx';

export default function DynamicStampSection() {
  const { t } = useTranslation('properties');
  const [rev, setRev] = createSignal(0);

  // Re-read on selection change, after an undo (modified changes) and after
  // our own edits (rev).
  const ann = createMemo(() => {
    annotProps.id; annotProps.modified; rev();
    const a = getCurrentAnnotation();
    return a && a.type === 'stamp' && a.dynamicStamp ? a : null;
  }, null, { equals: false });
  const fields = () => (ann() ? dynamicStampFields(ann().dynamicStamp) : []);
  const locked = () => !!ann()?.dynamicStamp?.locked;
  // A generally locked annotation (General section) is not edited either.
  const frozen = () => locked() || annotProps.locked === true;
  const bump = () => setRev((n) => n + 1);

  const onChange = (key, value) => {
    const a = ann();
    if (a && editDynamicStampField(a, key, value)) bump();
  };
  const onRefresh = async () => {
    const a = ann();
    if (a && await refreshDynamicStamp(a)) bump();
  };
  const onLock = async () => {
    const a = ann();
    if (!a) return;
    const ok = await showConfirm({ title: t('dynamicStamp.lock'), message: t('dynamicStamp.lockConfirm') });
    if (ok && lockPlacedDynamicStamp(a)) bump();
  };

  return (
    <Show when={ann()}>
      <CollapsibleSection title={t('dynamicStamp.title')} name="dynamicStamp" id="prop-dynamic-stamp-section">
        <div class="property-group">
          <label>{t('dynamicStamp.template')}</label>
          <input type="text" readonly value={ann()?.dynamicStamp?.template?.name || ''} />
        </div>
        <For each={fields()}>
          {(f) => (
            <div class="property-group">
              <label for={`prop-ds-${f.key}`}>{fieldLabel(f, t)}</label>
              <input
                id={`prop-ds-${f.key}`}
                type="text"
                value={f.value}
                disabled={frozen()}
                onChange={(e) => onChange(f.key, e.currentTarget.value)}
              />
            </div>
          )}
        </For>
        <Show when={!locked()} fallback={<div class="dynamic-stamp-locked-note">{t('dynamicStamp.locked')}</div>}>
          <div class="property-group dynamic-stamp-actions">
            <button type="button" class="pref-btn" id="prop-ds-refresh" disabled={frozen()} onClick={onRefresh}>{t('dynamicStamp.refresh')}</button>
            <button type="button" class="pref-btn" id="prop-ds-lock" disabled={frozen()} onClick={onLock}>{t('dynamicStamp.lock')}</button>
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}

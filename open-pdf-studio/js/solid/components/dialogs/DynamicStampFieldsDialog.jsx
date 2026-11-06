// Fill in the fields of a dynamic stamp before placing it (#629). The
// automatic fields (date, user, page ...) are filled in already and can be
// corrected here too.
import { For, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { templateFields, resolveStampValues } from '../../../annotations/dynamic-stamp.js';
import StampTemplatePreview from './StampTemplatePreview.jsx';

// Remembered per field name during the session: the next stamp proposes the
// last value (e.g. the project number).
const lastValues = new Map();

export function fieldLabel(field, tp) {
  if (!field.builtin) return field.name;
  const base = tp(`dynamicStamp.field.${field.builtin}`);
  return field.arg ? `${base} (${field.arg})` : base;
}

export default function DynamicStampFieldsDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('properties');
  const template = props.data?.template;
  const fields = templateFields(template);
  const given = {};
  for (const f of fields) if (!f.builtin && lastValues.has(f.name)) given[f.key] = lastValues.get(f.name);
  const [values, setValues] = createStore(resolveStampValues(template, props.data?.context || {}, given));
  const [first] = createSignal(fields.find((f) => !f.builtin)?.key);

  const close = () => closeDialog('dynamic-stamp-fields');
  const place = () => {
    const out = { ...values };
    for (const f of fields) if (!f.builtin) lastValues.set(f.name, out[f.key]);
    close();
    props.data?.onConfirm?.(out);
  };

  const footer = (
    <>
      <button class="pref-btn pref-btn-primary" onClick={place}>{t('stampFields.place')}</button>
      <button class="pref-btn pref-btn-secondary" onClick={close}>{tc('cancel')}</button>
    </>
  );

  return (
    <Dialog
      title={t('stampFields.title')}
      overlayClass="stamp-picker-overlay"
      dialogClass="dynamic-stamp-fields-dialog"
      onClose={close}
      footer={footer}
    >
      <div class="dynamic-stamp-fields-preview">
        <StampTemplatePreview template={template} values={{ ...values }} width={300} height={90} maxScale={2} />
      </div>
      <div class="dynamic-stamp-fields-grid">
        <For each={fields}>
          {(f) => (
            <>
              <label for={`dsf-${f.key}`} classList={{ 'dynamic-stamp-auto': !!f.builtin }}>{fieldLabel(f, tp)}</label>
              <input
                id={`dsf-${f.key}`}
                type="text"
                value={values[f.key] ?? ''}
                autofocus={f.key === first()}
                onInput={(e) => setValues(f.key, e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') place(); }}
              />
            </>
          )}
        </For>
      </div>
    </Dialog>
  );
}

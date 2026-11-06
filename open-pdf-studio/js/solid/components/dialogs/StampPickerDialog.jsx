import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { BUILT_IN_STAMPS } from '../../../annotations/stamps.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { stampTemplates } from '../../../annotations/stamp-template-backend.js';
import StampTemplatePreview from './StampTemplatePreview.jsx';

export default function StampPickerDialog(props) {
  const { t } = useTranslation('dialogs');

  const cancel = () => { closeDialog('stamp-picker'); };

  // Dynamic templates (#629): built-in, personal and shared.
  const [templates, setTemplates] = createSignal([]);
  let unsubscribe = null;
  let closed = false;
  onCleanup(() => { closed = true; unsubscribe?.(); });
  onMount(async () => {
    const store = await stampTemplates();
    if (closed) return;
    const update = () => setTemplates(store.list());
    update();
    unsubscribe = store.onChange(update);
  });

  function handleDynamicClick(template) {
    closeDialog('stamp-picker');
    if (props.data?.onDynamic) props.data.onDynamic(template);
  }

  function handleManageClick() {
    closeDialog('stamp-picker');
    if (props.data?.onManage) props.data.onManage();
  }

  function handleStampClick(stamp) {
    if (props.data?.onSelect) props.data.onSelect(stamp);
    closeDialog('stamp-picker');
  }

  function handleCustomClick() {
    if (props.data?.onCustom) props.data.onCustom();
    closeDialog('stamp-picker');
  }

  return (
    <Dialog
      title={t('stampPicker.title')}
      overlayClass="stamp-picker-overlay"
      dialogClass="stamp-picker-dialog"
      onClose={cancel}
    >
      <div style={{
        display: 'grid',
        'grid-template-columns': 'repeat(2, 1fr)',
        gap: '8px'
      }}>
        <For each={BUILT_IN_STAMPS}>
          {(stamp) => (
            <button
              style={{
                border: `2px solid ${stamp.color}`,
                background: 'transparent',
                padding: '8px 12px',
                cursor: 'pointer',
                'font-weight': 'bold',
                'font-size': '12px',
                color: stamp.color,
                'text-align': 'center',
                'letter-spacing': '1px',
                'border-radius': '0'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = stamp.color + '15'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              onClick={() => handleStampClick(stamp)}
            >
              {stamp.text}
            </button>
          )}
        </For>
        <button
          style={{
            border: '2px dashed #999',
            background: 'transparent',
            padding: '8px 12px',
            cursor: 'pointer',
            'font-size': '12px',
            color: '#666',
            'grid-column': 'span 2',
            'border-radius': '0'
          }}
          onClick={handleCustomClick}
        >
          {t('stampPicker.customFromImage')}
        </button>
      </div>
      <div class="stamp-picker-section">{t('stampPicker.dynamicTitle')}</div>
      <div class="stamp-picker-dynamic">
        <For each={templates()}>
          {(tpl) => (
            <button class="stamp-picker-dynamic-item" title={tpl.name} onClick={() => handleDynamicClick(tpl)}>
              <StampTemplatePreview template={tpl} width={150} height={48} maxScale={1.5} />
              <span class="stamp-picker-dynamic-name">{tpl.name}</span>
            </button>
          )}
        </For>
      </div>
      <Show when={props.data?.onManage}>
        <button class="pref-btn stamp-picker-manage" onClick={handleManageClick}>{t('stampPicker.manage')}</button>
      </Show>
    </Dialog>
  );
}

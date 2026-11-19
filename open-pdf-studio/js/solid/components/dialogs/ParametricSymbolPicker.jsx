// Modal listing available parametric symbol templates.
// Selecting one stores the symbolId in the parametricSymbolStore and
// switches the active tool to 'parametricSymbol' for drag-bbox placement.
import { Show, For, createSignal, onMount } from 'solid-js';
import {
  pickerOpen, setPickerOpen,
  setPendingSymbolId, getAvailableTemplates,
} from '../../stores/parametricSymbolStore.js';
import { setTool } from '../../../tools/manager.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

import { defaultParams } from '../../../symbols/registry.js';
import { renderParametricSymbolToPng } from '../../../annotations/rendering.js';

function SymbolPreview(props) {
  const [source, setSource] = createSignal('');
  onMount(() => {
    const template = props.template;
    const width = template.defaultSize?.width || 90;
    const height = template.defaultSize?.height || 90;
    const preview = renderParametricSymbolToPng({
      type: 'parametricSymbol', symbolId: template.id,
      params: defaultParams(template), x: 0, y: 0, width, height,
      strokeColor: '#222222', strokeWidth: 1, opacity: 1,
    }, 128 / Math.max(width, height));
    if (preview) setSource(preview.dataUrl);
  });
  return <Show when={source()}>
    <img src={source()} alt="" style="width:100%;height:56px;object-fit:contain;background:#fff" />
  </Show>;
}

export default function ParametricSymbolPicker() {
  const { t, language } = useTranslation('dialogs');
  // Built-in templates provide Dutch and English names; use English as
  // the fallback for other UI languages. Custom templates may have one name.
  const symbolName = (template) => /^nl(?:[-_]|$)/i.test(language())
    ? template.name || template.nameEn || template.id
    : template.nameEn || template.name || template.id;

  function pick(id) {
    setPendingSymbolId(id);
    setTool('parametricSymbol');
    setPickerOpen(false);
  }

  return (
    <Show when={pickerOpen()}>
      <div class="ops-modal-backdrop"
        style="position:fixed;inset:0;background:rgba(0,0,0,0.25);z-index:9000;display:flex;align-items:center;justify-content:center"
        onMouseDown={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}>
        <div class="ops-modal"
          style="background:#fff;border:1px solid #d4d4d4;width:420px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 4px 14px rgba(0,0,0,0.2);font-family:var(--ui-font)">
          <div class="ops-modal-header"
            style="background:linear-gradient(180deg,#ffffff,#f5f5f5);border-bottom:1px solid #d4d4d4;padding:6px 10px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600">
            <span>{t('parametricSymbolPicker.title')}</span>
            <button type="button" aria-label="Close"
              style="background:transparent;border:none;width:22px;height:20px;font-size:14px;cursor:pointer"
              onMouseEnter={(e) => { e.currentTarget.style.background = '#e81123'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = ''; }}
              onClick={() => setPickerOpen(false)}>x</button>
          </div>
          <div style="overflow:auto;padding:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <For each={getAvailableTemplates()}>{(template) => (
              <button type="button"
                style="border:1px solid #d4d4d4;background:#fafafa;padding:10px;text-align:left;cursor:pointer;font-size:12px;display:flex;flex-direction:column;gap:4px"
                onMouseEnter={(e) => e.currentTarget.style.background = '#eef5ff'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#fafafa'}
                onClick={() => pick(template.id)}>
                <SymbolPreview template={template} />
                <strong>{symbolName(template)}</strong>
                <small style="color:#666">{template.category}</small>
              </button>
            )}</For>
          </div>
          <div style="border-top:1px solid #d4d4d4;background:#f5f5f5;padding:6px;display:flex;justify-content:flex-end;gap:6px">
            <button type="button"
              style="padding:4px 12px;border:1px solid #d4d4d4;background:#fff;cursor:pointer;font-size:12px"
              onClick={() => setPickerOpen(false)}>{t('parametricSymbolPicker.cancel')}</button>
          </div>
        </div>
      </div>
    </Show>
  );
}

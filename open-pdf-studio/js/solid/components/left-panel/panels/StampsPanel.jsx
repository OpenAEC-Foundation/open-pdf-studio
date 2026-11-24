import { For, Show, createSignal, createMemo, createEffect, onMount, onCleanup } from 'solid-js';
import { activeTab, collapsed } from '../../../stores/leftPanelStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { BUILT_IN_STAMPS, kiesUitPalet, kiesStempelAfbeelding } from '../../../../annotations/stamps.js';
import { stampTemplates } from '../../../../annotations/stamp-template-backend.js';
import { stempelKiezerInhoud } from '../../../../annotations/stamp-picker-filter.js';
import { stempelKeuze } from '../../../../annotations/stamp-keuze.js';
import { zetPaletZichtbaar } from '../../../../annotations/stamp-palet-status.js';
import { state } from '../../../../core/state.js';
import { openDialog } from '../../../stores/dialogStore.js';
import StampTemplatePreview from '../../dialogs/StampTemplatePreview.jsx';

// Stamp palette: stays open next to the page. Click a stamp to choose it,
// then click on the page to place it (the choice stays for more clicks while
// the tool is kept active). The picker dialog is not opened while this panel
// is showing.
export default function StampsPanel() {
  const { t } = useTranslation('dialogs');
  const { t: tp } = useTranslation('properties');

  const zichtbaar = () => activeTab() === 'stamps' && !collapsed();
  createEffect(() => zetPaletZichtbaar(zichtbaar()));
  onCleanup(() => zetPaletZichtbaar(false));

  const [templates, setTemplates] = createSignal([]);
  const [loaded, setLoaded] = createSignal(false);
  // Which stamp is chosen now (re-read on every click).
  const [gekozen, setGekozen] = createSignal(null);
  let unsubscribe = null;
  let closed = false;
  onCleanup(() => { closed = true; unsubscribe?.(); });
  onMount(async () => {
    const store = await stampTemplates();
    if (closed) return;
    const update = () => setTemplates(store.list());
    update();
    setLoaded(true);
    unsubscribe = store.onChange(update);
  });

  const content = createMemo(() => stempelKiezerInhoud({
    hideBuiltIn: state.preferences?.hideBuiltInStamps === true,
    builtInStamps: BUILT_IN_STAMPS,
    templates: templates(),
    geladen: loaded(),
  }));

  const kies = async (keuze, sleutel) => {
    await kiesUitPalet(keuze);
    setGekozen(stempelKeuze() ? sleutel : null);
  };
  // The tool was left (Escape, other tool): nothing is chosen any more.
  const isGekozen = (sleutel) => state.currentTool === 'stamp' && gekozen() === sleutel;

  async function kiesAfbeelding() {
    const beeld = await kiesStempelAfbeelding();
    if (beeld) await kies({ soort: 'afbeelding', ...beeld }, 'afbeelding');
  }

  return (
    <div class={`left-panel-content${activeTab() === 'stamps' ? ' active' : ''}`} id="stamps-panel">
      <div class="left-panel-header">
        <span>{tp('leftPanel.stamps')}</span>
      </div>
      <div class="stamps-palette">
        <div class="stamps-palette-hint">{t('stampPalette.hint')}</div>
        <Show when={content().verborgen}>
          <div class="stamp-picker-hint">{t('stampPicker.builtInHidden')}</div>
        </Show>
        <Show when={content().builtInStamps.length > 0}>
          <div class="stamps-palette-grid">
            <For each={content().builtInStamps}>
              {(stamp) => (
                <button
                  class="stamps-palette-builtin"
                  classList={{ 'stamps-palette-chosen': isGekozen('v:' + stamp.name) }}
                  style={{ 'border-color': stamp.color, color: stamp.color }}
                  title={stamp.name}
                  onClick={() => kies({ soort: 'vast', stamp }, 'v:' + stamp.name)}
                >
                  {stamp.text}
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="stamps-palette-section">{t('stampPicker.dynamicTitle')}</div>
        <div class="stamps-palette-templates">
          <For each={content().templates}>
            {(tpl) => (
              <button
                class="stamp-picker-dynamic-item"
                classList={{ 'stamps-palette-chosen': isGekozen('t:' + (tpl.id ?? tpl.name)) }}
                title={tpl.name}
                onClick={() => kies({ soort: 'sjabloon', template: tpl }, 't:' + (tpl.id ?? tpl.name))}
              >
                <StampTemplatePreview template={tpl} width={150} height={48} maxScale={1.5} />
                <span class="stamp-picker-dynamic-name">{tpl.name}</span>
              </button>
            )}
          </For>
        </div>
        <Show when={content().hintGeenEigen}>
          <div class="stamp-picker-hint">{t('stampPicker.hideBuiltInNoOwn')}</div>
        </Show>
        <button class="pref-btn stamps-palette-btn" onClick={kiesAfbeelding}>
          {t('stampPicker.customFromImage')}
        </button>
        <button class="pref-btn stamps-palette-btn" onClick={() => openDialog('stamp-templates', {})}>
          {t('stampPicker.manage')}
        </button>
      </div>
    </div>
  );
}

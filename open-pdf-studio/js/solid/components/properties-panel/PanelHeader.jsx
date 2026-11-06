import { Show } from 'solid-js';
import { setPanelCollapsed } from '../../stores/propertiesStore.js';
import { sectieVolgordeIsStandaard, herstelSectieVolgorde } from '../../stores/sectieVolgordeStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function PanelHeader() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');

  return (
    <div id="prop-panel-header" class="prop-panel-header">
      <button class="prop-panel-collapse-btn" title={tCommon('collapse')}
        onClick={() => setPanelCollapsed(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2"/>
          <path d="M15 3v18"/>
          <path d="m8 9 3 3-3 3"/>
        </svg>
      </button>
      <h3 style="margin: 0; padding: 8px 0; background: none; flex: 1;">{t('title')}</h3>
      {/* Alleen na verslepen van een sectie (#967): standaardvolgorde terug. */}
      <Show when={!sectieVolgordeIsStandaard()}>
        <button class="prop-panel-collapse-btn" id="prop-reset-section-order" title={t('sectionOrder.reset')}
          onClick={herstelSectieVolgorde}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7"/>
            <path d="M3 4v5h5"/>
            <path d="M9 10h6M9 14h6"/>
          </svg>
        </button>
      </Show>
    </div>
  );
}

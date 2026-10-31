import { For, Show } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { items, countText, emptyMessage } from '../../../stores/panels/signaturesStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';

function SignatureIcon(props) {
  return (
    <Show when={props.status === 'valid'} fallback={
      <Show when={props.status === 'invalid'} fallback={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      }>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
      </Show>
    }>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    </Show>
  );
}

export default function SignaturesPanel() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');

  return (
    <div class={`left-panel-content${activeTab() === 'signatures' ? ' active' : ''}`} id="signatures-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.signatures')}</span>
      </div>
      <div class="signatures-container">
        <Show when={emptyMessage()}>
          <div class="signatures-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={items()}>
            {(sig) => (
              <div class="signature-list-item" onClick={() => {
                // Met een verificatie uit Rust: hetzelfde detailvenster als de balk.
                if (sig.info && sig.info.soort !== 'leeg-veld') {
                  import('../../../../pdf/handtekeningen/verificatie.js')
                    .then((m) => m.openHandtekeningDetails(JSON.parse(JSON.stringify(sig.info))));
                }
              }}>
                <div class={`signature-list-icon ${sig.status}`}>
                  <SignatureIcon status={sig.status} />
                </div>
                <div class="signature-list-info">
                  <div class="signature-list-name">{sig.name}</div>
                  <Show when={sig.reason}>
                    <div class="signature-list-detail">{t('leftPanel.reason')}: {sig.reason}</div>
                  </Show>
                  <Show when={sig.location}>
                    <div class="signature-list-detail">{t('leftPanel.location')}: {sig.location}</div>
                  </Show>
                  <Show when={sig.date}>
                    <div class="signature-list-detail">{t('leftPanel.date')}: {sig.date}</div>
                  </Show>
                  <Show when={sig.contactInfo}>
                    <div class="signature-list-detail">{t('leftPanel.contact')}: {sig.contactInfo}</div>
                  </Show>
                  <Show when={sig.page}>
                    <div class="signature-list-detail">{tCommon('page')} {sig.page}</div>
                  </Show>
                  <div class={`signature-list-status ${sig.status}`}>{sig.statusText}</div>
                  <Show when={sig.detailText}>
                    <div class="signature-list-detail">{sig.detailText}</div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="signatures-count">{countText()}</div>
    </div>
  );
}

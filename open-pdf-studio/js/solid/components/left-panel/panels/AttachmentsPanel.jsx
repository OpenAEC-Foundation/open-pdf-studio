import { For, Show, createSignal } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { items, countText, emptyMessage, selectedKey, toolbarDisabled } from '../../../stores/panels/attachmentsStore.js';

export default function AttachmentsPanel() {
  const [dragOver, setDragOver] = createSignal(false);
  const disabled = () => toolbarDisabled();

  return (
    <div class={`left-panel-content${activeTab() === 'attachments' ? ' active' : ''}`} id="attachments-panel">
      <div class="left-panel-header">
        <span>Attachments</span>
      </div>
      <div class="attachments-toolbar">
        <button
          class="attachments-toolbar-btn"
          title="Add attachment"
          disabled={disabled().add}
          onClick={() => import('../../../../ui/panels/attachments.js').then(m => m.addAttachment())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button
          class="attachments-toolbar-btn"
          title="Open attachment"
          disabled={disabled().open}
          onClick={() => import('../../../../ui/panels/attachments.js').then(m => m.openSelectedAttachment())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
        <button
          class="attachments-toolbar-btn"
          title="Save attachment"
          disabled={disabled().save}
          onClick={() => import('../../../../ui/panels/attachments.js').then(m => m.saveSelectedAttachment())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button
          class="attachments-toolbar-btn"
          title="Save all attachments"
          disabled={disabled().saveAll}
          onClick={() => import('../../../../ui/panels/attachments.js').then(m => m.saveAllAttachments())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="3" y1="3" x2="8" y2="3"/></svg>
        </button>
        <button
          class="attachments-toolbar-btn"
          title="Delete attachment"
          disabled={disabled().delete}
          onClick={() => import('../../../../ui/panels/attachments.js').then(m => m.deleteSelectedAttachment())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      <div
        class={`attachments-container${dragOver() ? ' drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false);
          import('../../../../ui/panels/attachments.js').then(m => m.handleFileDrop(e));
        }}
      >
        <Show when={emptyMessage()}>
          <div class="attachments-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={items()}>
            {(item) => (
              <div
                class={`attachment-list-item${selectedKey() === item.key ? ' selected' : ''}`}
                onClick={() => import('../../../../ui/panels/attachments.js').then(m => m.selectAttachment(item.key))}
                onDblClick={() => import('../../../../ui/panels/attachments.js').then(m => m.openAttachment(item.key))}
              >
                <div class="attachment-list-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div class="attachment-list-info">
                  <div class="attachment-list-name">{item.filename}</div>
                  <Show when={item.description}>
                    <div class="attachment-list-desc">{item.description}</div>
                  </Show>
                  <div class="attachment-list-meta">{item.metaText}</div>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="attachments-count">{countText()}</div>
    </div>
  );
}

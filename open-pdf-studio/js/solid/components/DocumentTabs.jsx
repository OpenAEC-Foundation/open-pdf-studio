import { For, Show } from 'solid-js';
import { state } from '../../core/state.js';

function handleTabClick(index) {
  import('../../ui/chrome/tabs.js').then(m => m.switchToTab(index));
}

function handleCloseTab(e, index) {
  e.stopPropagation();
  import('../../ui/chrome/tabs.js').then(m => m.closeTab(index));
}

function handleMiddleClick(e, index) {
  if (e.button === 1) {
    e.preventDefault();
    import('../../ui/chrome/tabs.js').then(m => m.closeTab(index));
  }
}

function handleAddClick() {
  import('../../pdf/loader.js').then(m => m.openPDFFile());
}

export default function DocumentTabs() {
  return (
    <div class="document-tabs" id="document-tabs">
      <Show when={state.documents.length === 0}>
        <div class="document-tabs-empty">No documents open</div>
      </Show>

      <For each={state.documents}>
        {(doc, i) => (
          <div
            class={'document-tab' + (i() === state.activeDocumentIndex ? ' active' : '')}
            data-index={i()}
            onClick={() => handleTabClick(i())}
            onAuxClick={(e) => handleMiddleClick(e, i())}
          >
            <span class="document-tab-modified">{doc.modified ? '*' : ''}</span>
            <span class="document-tab-title" title={doc.filePath || doc.fileName}>{doc.fileName}</span>
            <span class="document-tab-close" title="Close" onClick={(e) => handleCloseTab(e, i())}>&times;</span>
          </div>
        )}
      </For>

      <div class="document-tabs-add" title="Open PDF file" onClick={handleAddClick}>+</div>
    </div>
  );
}

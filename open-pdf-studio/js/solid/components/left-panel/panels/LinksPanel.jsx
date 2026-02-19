import { For, Show, createSignal } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { groups, countText, emptyMessage, selectedIndex, toolbarDisabled } from '../../../stores/panels/linksStore.js';

export default function LinksPanel() {
  const disabled = () => toolbarDisabled();

  const handleFilterChange = (e) => {
    import('../../../../ui/panels/links.js').then(m => m.filterLinks(e.target.value));
  };

  return (
    <div class={`left-panel-content${activeTab() === 'links' ? ' active' : ''}`} id="links-panel">
      <div class="left-panel-header">
        <span>Links</span>
        <div class="links-filter">
          <select onChange={handleFilterChange}>
            <option value="all">All Pages</option>
            <option value="current">Current Page</option>
            <option value="external">External Only</option>
            <option value="internal">Internal Only</option>
          </select>
        </div>
      </div>
      <div class="links-toolbar">
        <button
          class="links-toolbar-btn"
          title="Go to link source page"
          disabled={disabled().goto}
          onClick={() => import('../../../../ui/panels/links.js').then(m => m.gotoSelectedLink())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>
        </button>
        <button
          class="links-toolbar-btn"
          title="Open external URL"
          disabled={disabled().open}
          onClick={() => import('../../../../ui/panels/links.js').then(m => m.openSelectedLink())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
        <button
          class="links-toolbar-btn"
          title="Copy link URL"
          disabled={disabled().copy}
          onClick={() => import('../../../../ui/panels/links.js').then(m => m.copySelectedLink())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="1"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button
          class="links-toolbar-btn"
          title="Export all links to CSV"
          disabled={disabled().export}
          onClick={() => import('../../../../ui/panels/links.js').then(m => m.exportLinksToCSV())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>
      <div class="links-container">
        <Show when={emptyMessage()}>
          <div class="links-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={groups()}>
            {(group) => <LinkPageGroup group={group} />}
          </For>
        </Show>
      </div>
      <div class="links-count">{countText()}</div>
    </div>
  );
}

function LinkPageGroup(props) {
  const [collapsed, setCollapsed] = createSignal(false);

  return (
    <div class="links-page-group">
      <div
        class="links-page-header"
        onClick={() => setCollapsed(!collapsed())}
      >
        <span class="collapse-arrow">{collapsed() ? '\u25B6' : '\u25BC'}</span>
        <span>Page {props.group.pageNum}</span>
      </div>
      <div class={`links-page-items${collapsed() ? ' collapsed' : ''}`}>
        <For each={props.group.items}>
          {(item) => (
            <div
              class={`link-list-item${selectedIndex() === item.globalIndex ? ' selected' : ''}`}
              onClick={() => import('../../../../ui/panels/links.js').then(m => m.selectLink(item.globalIndex))}
              onDblClick={() => import('../../../../ui/panels/links.js').then(m => m.navigateToLink(item.globalIndex))}
            >
              <div class={`link-list-icon ${item.isExternal ? 'external' : 'internal'}`}>
                <Show when={item.isExternal} fallback={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 7h3a5 5 0 0 1 0 10h-3m-6 0H6a5 5 0 0 1 0-10h3"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                }>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </Show>
              </div>
              <div class="link-list-info">
                <div class="link-list-url">{item.label}</div>
                <div class="link-list-detail">{item.detail}</div>
                <Show when={item.appearance}>
                  <div class="link-list-appearance">
                    <Show when={item.borderColor}>
                      <span class="link-list-border-color" style={{ 'background-color': item.borderColor }}></span>
                    </Show>
                    <Show when={item.appearanceText}>
                      <span>{item.appearanceText}</span>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

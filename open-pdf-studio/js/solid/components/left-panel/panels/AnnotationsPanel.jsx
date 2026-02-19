import { For, Show } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { items, countText, emptyMessage } from '../../../stores/panels/annotationsStore.js';

export default function AnnotationsPanel() {
  const handleFilterChange = (e) => {
    import('../../../../ui/panels/annotations-list.js').then(m => m.updateAnnotationsList(e.target.value));
  };

  return (
    <div class={`left-panel-content${activeTab() === 'annotations' ? ' active' : ''}`} id="annotations-panel">
      <div class="left-panel-header">
        <span>Annotations</span>
        <div class="annotations-filter">
          <select onChange={handleFilterChange}>
            <option value="all">All Pages</option>
            <option value="current">Current Page</option>
          </select>
        </div>
      </div>
      <div class="annotations-list-content">
        <Show when={emptyMessage()}>
          <div class="annotations-list-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={items()}>
            {(item) => (
              <Show when={item.isHeader} fallback={
                <div
                  class={`annotation-list-item${item.selected ? ' selected' : ''}`}
                  onClick={() => {
                    import('../../../../ui/panels/annotations-list.js').then(m => m.selectAnnotationItem(item.id, item.page));
                  }}
                >
                  <div class="annotation-list-color" style={{ 'background-color': item.color }}></div>
                  <div class="annotation-list-info">
                    <div class="annotation-list-type">
                      {item.typeLabel}
                      <Show when={item.statusColor}>
                        <span style={{ color: item.statusColor, 'margin-left': '6px', 'font-size': '10px' }} title={item.statusTitle}>
                          {'\u25CF'}
                        </span>
                      </Show>
                      <Show when={item.replyCount > 0}>
                        <span style={{ 'margin-left': '6px', 'font-size': '10px', color: 'var(--theme-panel-tab-text)' }}>
                          ({item.replyCount})
                        </span>
                      </Show>
                    </div>
                    <Show when={item.text}>
                      <div class="annotation-list-preview">{item.text}</div>
                    </Show>
                    <div class="annotation-list-meta">{item.meta}</div>
                  </div>
                </div>
              }>
                <div class="annotations-list-page-header">Page {item.page}</div>
              </Show>
            )}
          </For>
        </Show>
      </div>
      <div class="annotations-list-count">{countText()}</div>
    </div>
  );
}

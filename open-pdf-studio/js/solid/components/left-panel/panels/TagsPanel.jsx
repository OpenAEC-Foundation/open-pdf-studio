import { For, Show, createSignal } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { tree, countText, emptyMessage } from '../../../stores/panels/tagsStore.js';

function TagNode(props) {
  const [expanded, setExpanded] = createSignal(true);
  const hasChildren = () => props.node.children && props.node.children.length > 0;
  const role = () => props.node.role || props.node.type || '';

  return (
    <div>
      <div class="tag-tree-item">
        <button
          class={`tag-tree-toggle${hasChildren() ? '' : ' leaf'}`}
          onClick={() => setExpanded(!expanded())}
        >
          {hasChildren() ? (expanded() ? '\u25BC' : '\u25B6') : ''}
        </button>
        <span class="tag-tree-label">
          {props.node.alt || props.node.role || props.node.type || 'Tag'}
        </span>
        <Show when={role()}>
          <span class="tag-tree-type">{role()}</span>
        </Show>
      </div>
      <Show when={hasChildren()}>
        <div class={`tag-tree-children${expanded() ? '' : ' collapsed'}`}>
          <For each={props.node.children}>
            {(child) => {
              if (typeof child === 'string') {
                return <div class="tag-tree-item"><span class="tag-tree-label" style={{ 'font-style': 'italic', 'padding-left': '20px' }}>{child}</span></div>;
              }
              return <TagNode node={child} />;
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function TagsPanel() {
  return (
    <div class={`left-panel-content${activeTab() === 'tags' ? ' active' : ''}`} id="tags-panel">
      <div class="left-panel-header">
        <span>Tags</span>
      </div>
      <div class="tags-container">
        <Show when={emptyMessage()}>
          <div class="tags-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={tree()}>
            {(node) => <TagNode node={node} />}
          </For>
        </Show>
      </div>
      <div class="tags-count">{countText()}</div>
    </div>
  );
}

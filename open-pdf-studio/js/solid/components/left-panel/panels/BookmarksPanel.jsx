import { For, Show, createSignal } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { tree, countText, emptyMessage, selectedId, toolbarDisabled } from '../../../stores/panels/bookmarksStore.js';
import { showBookmarkMenu } from '../../../stores/contextMenuStore.js';

function BookmarkNode(props) {
  const indent = () => props.depth * 16;

  return (
    <div>
      <div
        class={`bookmark-item${selectedId() === props.node.id ? ' selected' : ''}`}
        style={{ 'padding-left': `${indent()}px` }}
        onClick={() => {
          import('../../../../ui/panels/bookmarks.js').then(m => m.selectBookmark(props.node.id));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          import('../../../../ui/panels/bookmarks.js').then(m => {
            m.selectBookmark(props.node.id);
          });
          showBookmarkMenu(e.clientX, e.clientY);
        }}
      >
        <span
          class={`bookmark-arrow${props.node.hasChildren ? ' has-children' : ' empty'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (props.node.hasChildren) {
              import('../../../../ui/panels/bookmarks.js').then(m => m.toggleBookmarkExpand(props.node.id));
            }
          }}
        >
          {props.node.hasChildren ? (props.node.expanded ? '\u25BC' : '\u25B6') : ''}
        </span>
        <span class="bookmark-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </span>
        <span
          class={`bookmark-title${props.node.bold ? ' bold' : ''}${props.node.italic ? ' italic' : ''}`}
          style={props.node.color ? { color: props.node.color } : {}}
        >
          {props.node.title}
        </span>
      </div>
      <Show when={props.node.hasChildren && props.node.expanded}>
        <div class="bookmark-children">
          <For each={props.node.children}>
            {(child) => <BookmarkNode node={child} depth={props.depth + 1} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function BookmarksPanel() {
  const disabled = () => toolbarDisabled();

  return (
    <div class={`left-panel-content${activeTab() === 'bookmarks' ? ' active' : ''}`} id="bookmarks-panel">
      <div class="left-panel-header">
        <span>Bookmarks</span>
      </div>
      <div class="bookmarks-toolbar">
        <button
          class="bookmarks-toolbar-btn"
          title="Add bookmark"
          disabled={disabled().add}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.addBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button
          class="bookmarks-toolbar-btn"
          title="Add child bookmark"
          disabled={disabled().addChild}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.addChildBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="14" y1="7" x2="14" y2="17"/><line x1="9" y1="12" x2="19" y2="12"/><line x1="5" y1="5" x2="5" y2="19"/></svg>
        </button>
        <button
          class="bookmarks-toolbar-btn"
          title="Edit bookmark"
          disabled={disabled().edit}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.editBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button
          class="bookmarks-toolbar-btn"
          title="Delete bookmark"
          disabled={disabled().delete}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.deleteBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      <div
        class="bookmarks-container"
        onContextMenu={(e) => {
          e.preventDefault();
          showBookmarkMenu(e.clientX, e.clientY);
        }}
      >
        <Show when={emptyMessage()}>
          <div class="bookmarks-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={tree()}>
            {(node) => <BookmarkNode node={node} depth={0} />}
          </For>
        </Show>
      </div>
      <div class="bookmarks-count">{countText()}</div>
    </div>
  );
}

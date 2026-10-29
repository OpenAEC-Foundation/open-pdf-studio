import { For, Show, createSignal, createEffect, onMount } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { tree, countText, emptyMessage, selected, hasTree } from '../../../stores/panels/tagsStore.js';
import { openDialog } from '../../../stores/dialogStore.js';
import { noPdf } from '../../../../core/state.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';

const panel = () => import('../../../../ui/panels/tags.js');
// Open/closed per row, kept when the tree is rebuilt after an edit.
const expandedRows = new Map();

function ContentRow(props) {
  const { t } = useTranslation('properties');
  const [snippet, setSnippet] = createSignal('');
  onMount(() => {
    if (props.node.kind === 'mcid') panel().then((m) => m.contentSnippet(props.node.pageIndex, props.node.mcid)).then(setSnippet);
  });
  const page = () => (props.node.pageIndex != null ? props.node.pageIndex + 1 : '?');
  const label = () => (props.node.kind === 'objr'
    ? t('tagsPanel.annotationRef', { page: page() })
    : (snippet() || t('tagsPanel.content', { mcid: props.node.mcid, page: page() })));
  return (
    <div
      class={`tag-tree-item${selected()?.uid === props.node.uid ? ' selected' : ''}`}
      onClick={() => panel().then((m) => m.selectTag(props.node.uid))}
      onDblClick={() => panel().then((m) => m.goToTagPage(props.node.pageIndex))}
    >
      <span class="tag-tree-toggle leaf" />
      <span class="tag-tree-label tag-tree-content">{label()}</span>
      <span class="tag-tree-type">{props.node.kind === 'objr' ? 'OBJR' : `MCID ${props.node.mcid}`}</span>
    </div>
  );
}

function TagNode(props) {
  const { t } = useTranslation('properties');
  // Only the first levels start open: content rows fetch their page text
  // when they are shown, so a closed branch loads nothing.
  const [expanded, setExpandedSignal] = createSignal(expandedRows.get(props.node.uid) ?? (props.depth || 0) < 2);
  const setExpanded = (v) => { expandedRows.set(props.node.uid, v); setExpandedSignal(v); };
  const hasChildren = () => props.node.children && props.node.children.length > 0;
  const role = () => props.node.role || '';
  const mapped = () => (props.node.standardRole && props.node.standardRole !== props.node.role ? props.node.standardRole : '');
  const needsAlt = () => ['Figure', 'Formula'].includes(props.node.standardRole)
    && !(props.node.alt || '').trim() && !(props.node.actualText || '').trim();
  const text = () => props.node.alt || props.node.title || props.node.actualText || '';

  return (
    <div>
      <div
        class={`tag-tree-item${selected()?.uid === props.node.uid ? ' selected' : ''}`}
        onClick={() => panel().then((m) => m.selectTag(props.node.uid))}
        onDblClick={() => panel().then((m) => m.goToTagPage(props.node.pageIndex))}
      >
        <button
          class={`tag-tree-toggle${hasChildren() ? '' : ' leaf'}`}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded()); }}
        >
          {hasChildren() ? (expanded() ? '▼' : '▶') : ''}
        </button>
        <span class="tag-tree-label" title={mapped() ? t('tagsPanel.mappedTo', { role: role(), standard: mapped() }) : role()}>
          {`<${role()}>`}{mapped() ? ` → ${mapped()}` : ''}{text() ? ` ${text()}` : ''}
        </span>
        <Show when={needsAlt()}>
          <span class="tag-tree-warning" title={t('tagsPanel.noAlt')}>!</span>
        </Show>
      </div>
      <Show when={hasChildren() && expanded()}>
        <div class="tag-tree-children">
          <For each={props.node.children}>
            {(child) => (child.kind === 'element'
              ? <TagNode node={child} depth={(props.depth || 0) + 1} />
              : <ContentRow node={child} />)}
          </For>
        </div>
      </Show>
    </div>
  );
}

function AltEditor() {
  const { t } = useTranslation('properties');
  const [value, setValue] = createSignal('');
  createEffect(() => setValue(selected()?.alt || ''));
  const apply = () => panel().then((m) => m.setSelectedAlt(value()));
  return (
    <div class="tags-details">
      <div class="tags-details-row">
        <span class="tags-details-label">{t('tagsPanel.role')}</span>
        <span class="tags-details-value">
          {selected()?.role}{selected()?.standardRole && selected().standardRole !== selected().role ? ` → ${selected().standardRole}` : ''}
        </span>
      </div>
      <label class="tags-details-label" for="tags-alt-text">{t('tagsPanel.altText')}</label>
      <textarea
        id="tags-alt-text"
        class="tags-alt-text"
        rows="3"
        placeholder={selected()?.altRole ? t('tagsPanel.altTextPlaceholder') : ''}
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onChange={apply}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } }}
      />
    </div>
  );
}

export default function TagsPanel() {
  const { t } = useTranslation('properties');
  const canEdit = () => !!selected() && selected().kind === 'element';

  return (
    <div class={`left-panel-content${activeTab() === 'tags' ? ' active' : ''}`} id="tags-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.tags')}</span>
      </div>
      <div class="attachments-toolbar tags-toolbar">
        <button
          class="attachments-toolbar-btn"
          title={t('tagsPanel.moveUp')}
          disabled={!selected()?.canMoveUp}
          onClick={() => panel().then((m) => m.moveSelectedTag(-1))}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 14 12 8 18 14"/></svg>
        </button>
        <button
          class="attachments-toolbar-btn"
          title={t('tagsPanel.moveDown')}
          disabled={!selected()?.canMoveDown}
          onClick={() => panel().then((m) => m.moveSelectedTag(1))}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 10 12 16 18 10"/></svg>
        </button>
        <span class="tags-toolbar-sep" />
        <button
          class="attachments-toolbar-btn"
          title={t('tagsPanel.checkAccessibility')}
          disabled={noPdf()}
          onClick={() => openDialog('accessibility-report')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </button>
      </div>
      <div class="tags-container">
        <Show when={emptyMessage()}>
          <div class="tags-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage() && hasTree()}>
          <For each={tree()}>
            {(node) => (node.kind === 'element' ? <TagNode node={node} depth={0} /> : <ContentRow node={node} />)}
          </For>
        </Show>
      </div>
      <Show when={canEdit()}>
        <AltEditor />
      </Show>
      <div class="tags-count">{countText()}</div>
    </div>
  );
}

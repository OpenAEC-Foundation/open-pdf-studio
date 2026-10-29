import { For, Show, createSignal, onMount } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import {
  catalog, loaded, selectedSetId, selectedItemId, activeItemId,
  ensureToolSetsLoaded, selectSet, selectItem,
  createToolSet, renameToolSet, requestDeleteToolSet,
  renameToolSetItem, deleteToolSetItem, moveToolSetItem, useToolSetItem,
  exportToolSet, importToolSetFromFile,
} from '../../../stores/toolSetsStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { TYPE_LABEL_KEYS } from '../../../../annotations/tool-sets.js';

// Tool Sets (#311): saved measurement and markup presets in named tool
// sets. Click an item to draw with it; double-click (or F2) to rename. Items
// are saved from a placed annotation via its context menu ("Save to Tool
// Set").
//
// Moving an item to another tool set: the "Move to..." list in the toolbar is
// the dependable way (mouse, keyboard, touch). Dragging an item onto another
// set does the same, with HTML drag and drop inside the page as the bookmarks
// and page thumbnails use it on the desktop; the dragged item is kept here
// too, so the drop does not depend on custom data types in the drag data.

const ICON = {
  addSet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg>',
  rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20l1.5-4.5L16 5l3 3L8.5 18.5z"/></svg>',
  delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
};

const TYPE_GLYPH = {
  measureDistance: '↔',
  measureArea: '□',
  measurePerimeter: '△',
  measureAngle: '∠',
  line: '∕',
  arrow: '↗',
  polyline: '⦚',
  polygon: '⬠',
  box: '▭',
  circle: '○',
  cloud: '☁',
  filledArea: '▧',
  wall: '▄',
};

const DRAG_TYPE = 'application/x-opds-tool-set-item';

export default function ToolSetsPanel() {
  const { t } = useTranslation('properties');
  // { kind: 'set' | 'item', id } of the row with an open name field.
  const [editing, setEditing] = createSignal(null);
  const [error, setError] = createSignal('');
  const [collapsedSets, setCollapsedSets] = createSignal(new Set());
  const [dropSetId, setDropSetId] = createSignal(null);
  const [draggedItemId, setDraggedItemId] = createSignal(null);

  onMount(() => { ensureToolSetsLoaded(); });

  const itemCount = () => catalog().sets.reduce((n, s) => n + s.items.length, 0);
  const selectedSet = () => catalog().sets.find((s) => s.id === selectedSetId()) || null;
  const errorText = (code) => t(code === 'name-taken' ? 'toolSets.nameTaken' : 'toolSets.nameEmpty');

  const isCollapsed = (id) => collapsedSets().has(id);
  const toggleCollapsed = (id) => {
    const next = new Set(collapsedSets());
    if (next.has(id)) next.delete(id); else next.add(id);
    setCollapsedSets(next);
  };

  function beginRename() {
    setError('');
    if (selectedItemId()) setEditing({ kind: 'item', id: selectedItemId() });
    else if (selectedSetId()) setEditing({ kind: 'set', id: selectedSetId() });
  }

  function finishRename(kind, id, value) {
    const code = kind === 'set' ? renameToolSet(id, value) : renameToolSetItem(id, value);
    if (code) {
      setError(errorText(code));
      return false;
    }
    setError('');
    setEditing(null);
    return true;
  }

  function deleteSelected() {
    if (selectedItemId()) deleteToolSetItem(selectedItemId());
    else if (selectedSetId()) requestDeleteToolSet(selectedSetId());
  }

  async function newSet() {
    const id = await createToolSet();
    if (id) { setError(''); setEditing({ kind: 'set', id }); }
  }

  function onKeyDown(e) {
    if (editing()) return;
    if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); beginRename(); }
    else if (e.key === 'Delete' && (selectedItemId() || selectedSetId())) {
      e.preventDefault();
      e.stopPropagation();
      deleteSelected();
    }
  }

  const nameInput = (kind, id, current) => (
    // Not bound to value={}: a refresh of the list would overwrite the typing.
    <input type="text" class="toolset-name-input"
      ref={(el) => { el.value = current; queueMicrotask(() => { el.focus(); el.select(); }); }}
      onClick={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finishRename(kind, id, e.currentTarget.value);
        else if (e.key === 'Escape') { setError(''); setEditing(null); }
      }}
      onBlur={(e) => { if (!finishRename(kind, id, e.currentTarget.value)) { setError(''); setEditing(null); } }} />
  );

  const itemDetail = (item) => {
    const parts = [TYPE_LABEL_KEYS[item.type] ? t(TYPE_LABEL_KEYS[item.type]) : item.type];
    const unit = item.props?.measureUnit;
    if (unit) parts.push(String(unit).replace(/²$/, ''));
    if (item.layer?.name) parts.push(item.layer.name);
    return parts.join(' · ');
  };

  const swatch = (item) => {
    const c = item.props?.strokeColor && item.props.strokeColor !== 'none' ? item.props.strokeColor : item.props?.color;
    return typeof c === 'string' && c !== 'none' ? c : 'transparent';
  };

  return (
    <div class={`left-panel-content${activeTab() === 'tool-sets' ? ' active' : ''}`} id="tool-sets-panel"
      tabIndex={-1} on:keydown={onKeyDown}>
      <div class="left-panel-header">
        <span>{t('leftPanel.toolSets')}</span>
      </div>
      <div class="attachments-toolbar">
        <button class="attachments-toolbar-btn" title={t('toolSets.newSet')} onClick={newSet} innerHTML={ICON.addSet} />
        <button class="attachments-toolbar-btn" title={t('toolSets.rename')}
          disabled={!selectedItemId() && !selectedSetId()} onClick={beginRename} innerHTML={ICON.rename} />
        <button class="attachments-toolbar-btn" title={t('toolSets.delete')}
          disabled={!selectedItemId() && !selectedSetId()} onClick={deleteSelected} innerHTML={ICON.delete} />
        <span class="toolset-toolbar-sep" />
        <button class="attachments-toolbar-btn" title={t('toolSets.exportSet')}
          disabled={!selectedSet()} onClick={() => exportToolSet(selectedSetId())} innerHTML={ICON.export} />
        <button class="attachments-toolbar-btn" title={t('toolSets.importSet')}
          onClick={() => importToolSetFromFile()} innerHTML={ICON.import} />
        {/* Moving an item: the dependable way (also keyboard and touch). */}
        <select class="toolset-move-select" title={t('toolSets.moveTo')}
          disabled={!selectedItemId() || catalog().sets.length < 2}
          onChange={(e) => {
            const to = e.currentTarget.value;
            e.currentTarget.value = '';
            if (to && selectedItemId()) moveToolSetItem(selectedItemId(), to);
          }}>
          <option value="">{t('toolSets.moveTo')}</option>
          <For each={catalog().sets.filter((s) => s.id !== selectedSetId())}>
            {(s) => <option value={s.id}>{s.name}</option>}
          </For>
        </select>
      </div>
      <div class="toolset-container">
        <Show when={loaded() && catalog().sets.length === 0}>
          <div class="toolset-empty">{t('toolSets.empty')}</div>
        </Show>
        <For each={catalog().sets}>
          {(set) => (
            <div class="toolset-set"
              classList={{ 'toolset-drop-target': dropSetId() === set.id }}
              onDragOver={(e) => {
                if (!draggedItemId()) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropSetId(set.id);
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropSetId(null); }}
              onDrop={(e) => {
                const itemId = draggedItemId() || e.dataTransfer?.getData(DRAG_TYPE);
                setDropSetId(null);
                setDraggedItemId(null);
                if (!itemId) return;
                e.preventDefault();
                moveToolSetItem(itemId, set.id);
              }}>
              <div class="toolset-set-header"
                classList={{ 'toolset-selected': selectedSetId() === set.id && !selectedItemId() }}
                onClick={() => selectSet(set.id)}
                onDblClick={() => { selectSet(set.id); setError(''); setEditing({ kind: 'set', id: set.id }); }}>
                <button type="button" class="toolset-expander"
                  title={t('toolSets.toggleSet')}
                  onClick={(e) => { e.stopPropagation(); toggleCollapsed(set.id); }}>
                  {isCollapsed(set.id) ? '▸' : '▾'}
                </button>
                <Show when={editing()?.kind === 'set' && editing()?.id === set.id}
                  fallback={<span class="toolset-set-name" title={set.name}>{set.name}</span>}>
                  {nameInput('set', set.id, set.name)}
                </Show>
                <span class="toolset-set-count">{set.items.length}</span>
              </div>
              <Show when={!isCollapsed(set.id)}>
                <Show when={set.items.length === 0}>
                  <div class="toolset-set-empty">{t('toolSets.emptySet')}</div>
                </Show>
                <For each={set.items}>
                  {(item) => (
                    <div class="toolset-item"
                      classList={{
                        'toolset-selected': selectedItemId() === item.id,
                        'toolset-active': activeItemId() === item.id,
                      }}
                      title={t('toolSets.useItem')}
                      draggable={!(editing()?.kind === 'item' && editing()?.id === item.id)}
                      onDragStart={(e) => {
                        setDraggedItemId(item.id);
                        e.dataTransfer.setData(DRAG_TYPE, item.id);
                        e.dataTransfer.setData('text/plain', item.name);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => { setDropSetId(null); setDraggedItemId(null); }}
                      onClick={() => { selectItem(item.id); useToolSetItem(item.id); }}
                      onDblClick={() => { selectItem(item.id); setError(''); setEditing({ kind: 'item', id: item.id }); }}>
                      <span class="toolset-item-glyph" style={{ color: swatch(item) }}>{TYPE_GLYPH[item.type] || '◆'}</span>
                      <div class="toolset-item-info">
                        <Show when={editing()?.kind === 'item' && editing()?.id === item.id}
                          fallback={<div class="toolset-item-name">{item.name}</div>}>
                          {nameInput('item', item.id, item.name)}
                        </Show>
                        <div class="toolset-item-detail">{itemDetail(item)}</div>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          )}
        </For>
        <Show when={error()}>
          <div class="toolset-error">{error()}</div>
        </Show>
      </div>
      <div class="attachments-count">{t('toolSets.count', { sets: catalog().sets.length, items: itemCount() })}</div>
    </div>
  );
}

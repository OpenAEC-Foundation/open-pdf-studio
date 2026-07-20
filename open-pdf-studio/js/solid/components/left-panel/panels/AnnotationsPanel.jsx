import { For, Show, createSignal, onCleanup } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { items, countText, emptyMessage, sortMode, setSortMode, filterMode, setFilterMode, hiddenStatuses, toggleHiddenStatus, collapsedGroups, toggleGroup, expandAllGroups, collapseAllGroups } from '../../../stores/panels/annotationsStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { state, clearSelection, getActiveDocument } from '../../../../core/state.js';
import { commitAnnotationMutation } from '../../../../annotations/mutations.js';
import {
  cutIcon, copyIcon, deleteIcon, flattenIcon, exportIcon, deselectIcon, propertiesIcon
} from '../../../data/contextMenuIcons.js';

// Menu icons (codicon-style, viewBox 0 0 16 16, fill currentColor)
const expandAllIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M15 6v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3V4.27c.6.35 1 .99 1 1.73m-4 7H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2h7c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2m-7-1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1H4c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1m5.5-5H8V5.5a.5.5 0 0 0-1 0V7H5.5a.5.5 0 0 0 0 1H7v1.5a.5.5 0 0 0 1 0V8h1.5a.5.5 0 0 0 0-1"/></svg>`;
const collapseAllIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><g><path d="M14 4.27c.6.35 1 .99 1 1.73v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3zM9.5 7a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11 2c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2zM4 3c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1z"/></g></svg>`;
const summarizeIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5zM2 4v8h12V4zm1 1h6v1H3zm0 2h10v1H3zm0 2h8v1H3z"/></svg>`;
const importIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5M5.854 8.146a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L4.293 9H11.5a.5.5 0 0 1 0-1H4.293l3.146-3.146a.5.5 0 0 0-.707-.708l-4 4z"/></svg>`;
const exportCommentsIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5m8.646.146a.5.5 0 0 1 .707 0l4 4a.5.5 0 0 1 0 .707l-4 4a.5.5 0 0 1-.707-.707L13.293 8H4.5a.5.5 0 0 1 0-1h8.793l-3.146-3.146a.5.5 0 0 1 0-.707z"/></svg>`;
const groupByIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 2h-3a1 1 0 0 0-1 1v1H8v-.25A.75.75 0 0 0 7.25 3h-1.5a.75.75 0 0 0-.75.75v1.5c0 .413.337.75.75.75h1.5c.413 0 .75-.337.75-.75V5h2v1a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1M7 5H6V4h1zm7 1h-3V3h3zm0 2h-3a1 1 0 0 0-1 1v1H8v-.25A.75.75 0 0 0 7.25 9h-1.5a.75.75 0 0 0-.75.75v1.5c0 .413.337.75.75.75h1.5c.413 0 .75-.337.75-.75V11h2v1a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1m-7 3H6v-1h1zm7 1h-3V9h3z"/></svg>`;
const showIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.984 8.625a.5.5 0 0 1-.612.355c-.431-.114-.355-.611-.355-.611l.018-.062s.026-.084.047-.145a6.7 6.7 0 0 1 1.117-1.982C4.096 5.089 5.605 4 8 4s3.904 1.089 4.802 2.183a6.7 6.7 0 0 1 1.117 1.982a4 4 0 0 1 .06.187l.003.013v.006a.5.5 0 0 1-.966.258l-.008-.025l-.035-.109a5.7 5.7 0 0 0-.945-1.674C11.286 5.912 10.045 5 8 5s-3.285.912-4.028 1.817a5.7 5.7 0 0 0-.945 1.674l-.035.109zM8 7a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5M6.5 9.5a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1-3 0"/></svg>`;

const groupOptions = [
  { key: 'page', label: 'groupByPage' },
  { key: 'type', label: 'groupByType' },
  { key: 'modifiedDate', label: 'groupByModifiedDate' },
  { key: 'creationDate', label: 'groupByCreationDate' },
  { key: 'author', label: 'groupByAuthor' },
  { key: 'color', label: 'groupByColor' },
  { key: 'subject', label: 'groupBySubject' },
  { key: 'status', label: 'groupByStatus' },
  { key: 'statusAndAuthor', label: 'groupByStatusAndAuthor' },
  { key: 'lastStatusAuthor', label: 'groupByLastStatusAuthor' },
];

// Review-statussen voor het Tonen > Status-filter (#236). Sleutels in
// kleine letters — de filtering in annotations-list.js vergelijkt
// hoofdletter-ongevoelig. Labels komen uit de bestaande context-namespace.
const statusFilterOptions = [
  { key: 'none', label: 'annotation.statusNone' },
  { key: 'accepted', label: 'annotation.statusAccepted' },
  { key: 'cancelled', label: 'annotation.statusCancelled' },
  { key: 'completed', label: 'annotation.statusCompleted' },
  { key: 'rejected', label: 'annotation.statusRejected' },
];

export default function AnnotationsPanel() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const { t: tContext } = useTranslation('context');

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [menuPos, setMenuPos] = createSignal({ top: 0, left: 0 });
  let menuRef;
  let menuBtnRef;

  const closeMenu = (e) => {
    if (menuRef && !menuRef.contains(e.target) && menuBtnRef && !menuBtnRef.contains(e.target)) {
      setMenuOpen(false);
    }
  };

  document.addEventListener('mousedown', closeMenu);
  onCleanup(() => document.removeEventListener('mousedown', closeMenu));

  const closeAndRun = (fn) => {
    setMenuOpen(false);
    fn();
  };

  const applyFilter = (value) => {
    setFilterMode(value);
    import('../../../../ui/panels/annotations-list.js').then(m => m.updateAnnotationsList(value));
    setMenuOpen(false);
  };

  // Status aan/uit zetten sluit het menu bewust NIET, zodat meerdere
  // statussen achter elkaar (de)geselecteerd kunnen worden (#236).
  const toggleStatusFilter = (statusKey) => {
    toggleHiddenStatus(statusKey);
    import('../../../../ui/panels/annotations-list.js').then(m => m.updateAnnotationsList());
  };

  const applySort = (value) => {
    setSortMode(value);
    import('../../../../ui/panels/annotations-list.js').then(m => m.updateAnnotationsList());
    setMenuOpen(false);
  };

  const expandAll = () => expandAllGroups();

  const collapseAll = () => {
    const allKeys = items().filter(i => i.isHeader).map(i => i.groupKey);
    collapseAllGroups(allKeys);
  };

  const hasSelection = () => !!state.documents[state.activeDocumentIndex]?.selectedAnnotation;

  const cutSelected = () => {
    const doc = getActiveDocument();
    const ann = doc?.selectedAnnotation;
    if (!ann) return;
    import('../../../../annotations/clipboard.js').then(({ copyAnnotation }) => {
      import('../../../../core/undo-manager.js').then(({ recordDelete }) => {
        copyAnnotation(ann);
        const idx = doc.annotations.indexOf(ann);
        recordDelete(ann, idx);
        doc.annotations = doc.annotations.filter(x => x !== ann);
        if (doc) { doc.selectedAnnotation = null; doc.selectedAnnotations = []; }
        import('../../../../annotations/rendering.js').then(({ redrawAnnotations }) => redrawAnnotations());
        import('../../../../ui/panels/annotations-list.js').then(m => m.updateAnnotationsList());
      });
    });
  };

  const copySelected = () => {
    const doc = getActiveDocument();
    const ann = doc?.selectedAnnotation;
    if (!ann) return;
    import('../../../../annotations/clipboard.js').then(({ copyAnnotation }) => copyAnnotation(ann));
  };

  const deleteSelected = async () => {
    const doc = getActiveDocument();
    const ann = doc?.selectedAnnotation;
    if (!ann) return;
    const { showConfirm } = await import('../../../../ui/chrome/confirm-dialog.js');
    const confirmed = await showConfirm({
      title: t('deleteAnnotation.title'),
      message: t('deleteAnnotation.confirmSingle'),
      preferenceKey: 'confirmBeforeDelete'
    });
    if (confirmed) {
      import('../../../../core/undo-manager.js').then(({ recordDelete }) => {
        const idx = doc.annotations.indexOf(ann);
        recordDelete(ann, idx);
        doc.annotations = doc.annotations.filter(x => x !== ann);
        if (doc) { doc.selectedAnnotation = null; doc.selectedAnnotations = []; }
        import('../../../../annotations/rendering.js').then(({ redrawAnnotations }) => redrawAnnotations());
        import('../../../../ui/panels/annotations-list.js').then(m => m.updateAnnotationsList());
      });
    }
  };

  const flattenSelected = () => {
    const doc = getActiveDocument();
    const ann = doc?.selectedAnnotation;
    if (ann) {
      commitAnnotationMutation(ann, annotation => { annotation.flattened = true; });
      import('../../../../annotations/rendering.js').then(({ redrawAnnotations }) => redrawAnnotations());
    }
  };

  const deselectAll = () => {
    clearSelection();
    import('../../../../ui/panels/annotations-list.js').then(m => m.updateAnnotationsList());
    import('../../../../annotations/rendering.js').then(({ redrawAnnotations }) => redrawAnnotations());
  };

  const showProperties = () => {
    const doc = getActiveDocument();
    const ann = doc?.selectedAnnotation;
    if (ann) {
      import('../../../../ui/panels/properties-panel.js').then(m => m.showProperties(ann));
    }
  };

  const headerText = (item) => {
    if (item.sortMode === 'page') return `${tCommon('page')} ${item.page}`;
    if (item.sortMode === 'color') return '';
    return item.headerLabel || '';
  };

  return (
    <div class={`left-panel-content${activeTab() === 'annotations' ? ' active' : ''}`} id="annotations-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.annotations')}</span>
      </div>
      <div class="annotations-toolbar">
        <div class="annotations-toolbar-menu-wrapper">
          <button
            ref={menuBtnRef}
            class={`annotations-toolbar-btn${menuOpen() ? ' active' : ''}`}
            title={t('leftPanel.annotationsMenu')}
            onClick={() => {
              if (!menuOpen() && menuBtnRef) {
                const rect = menuBtnRef.getBoundingClientRect();
                const isRtl = document.documentElement.dir === 'rtl';
                if (isRtl) {
                  setMenuPos({ top: rect.bottom, right: window.innerWidth - rect.right });
                } else {
                  setMenuPos({ top: rect.bottom, left: rect.left });
                }
              }
              setMenuOpen(!menuOpen());
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="4" y1="6" x2="20" y2="6"/>
              <line x1="4" y1="12" x2="20" y2="12"/>
              <line x1="4" y1="18" x2="20" y2="18"/>
            </svg>
          </button>
          <Show when={menuOpen()}>
            <div class="annotations-menu" ref={menuRef} style={{
              top: `${menuPos().top}px`,
              ...(menuPos().right !== undefined ? { right: `${menuPos().right}px` } : { left: `${menuPos().left}px` })
            }}>
              {/* Cut / Copy / Delete / Flatten */}
              <div
                class={`annotations-menu-item${!hasSelection() ? ' disabled' : ''}`}
                onClick={() => hasSelection() && closeAndRun(cutSelected)}
              >
                <span class="annotations-menu-icon" innerHTML={cutIcon}></span>
                <span class="annotations-menu-label">{tCommon('cut')}</span>
                <span class="annotations-menu-shortcut">Ctrl+X</span>
              </div>
              <div
                class={`annotations-menu-item${!hasSelection() ? ' disabled' : ''}`}
                onClick={() => hasSelection() && closeAndRun(copySelected)}
              >
                <span class="annotations-menu-icon" innerHTML={copyIcon}></span>
                <span class="annotations-menu-label">{tCommon('copy')}</span>
                <span class="annotations-menu-shortcut">Ctrl+C</span>
              </div>
              <div
                class={`annotations-menu-item${!hasSelection() ? ' disabled' : ''}`}
                onClick={() => hasSelection() && closeAndRun(deleteSelected)}
              >
                <span class="annotations-menu-icon" innerHTML={deleteIcon}></span>
                <span class="annotations-menu-label">{tCommon('delete')}</span>
                <span class="annotations-menu-shortcut">Delete</span>
              </div>
              <div
                class={`annotations-menu-item${!hasSelection() ? ' disabled' : ''}`}
                onClick={() => hasSelection() && closeAndRun(flattenSelected)}
              >
                <span class="annotations-menu-icon" innerHTML={flattenIcon}></span>
                <span class="annotations-menu-label">{tCommon('flatten')}</span>
              </div>

              <div class="annotations-menu-separator"></div>

              {/* Expand / Collapse All */}
              <div class="annotations-menu-item" onClick={() => closeAndRun(expandAll)}>
                <span class="annotations-menu-icon" innerHTML={expandAllIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.expandAll')}</span>
              </div>
              <div class="annotations-menu-item" onClick={() => closeAndRun(collapseAll)}>
                <span class="annotations-menu-icon" innerHTML={collapseAllIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.collapseAll')}</span>
              </div>

              <div class="annotations-menu-separator"></div>

              {/* Summarize / Import / Export */}
              <div class="annotations-menu-item disabled">
                <span class="annotations-menu-icon" innerHTML={summarizeIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.summarize')}</span>
              </div>
              <div class="annotations-menu-item disabled">
                <span class="annotations-menu-icon" innerHTML={importIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.importComments')}</span>
              </div>
              <div class="annotations-menu-item disabled">
                <span class="annotations-menu-icon" innerHTML={exportCommentsIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.exportComments')}</span>
              </div>
              <div class="annotations-menu-item disabled">
                <span class="annotations-menu-icon" innerHTML={exportCommentsIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.exportSelectedComments')}</span>
              </div>

              <div class="annotations-menu-separator"></div>

              {/* Group By — submenu */}
              <div class="annotations-menu-item annotations-menu-submenu-trigger">
                <span class="annotations-menu-icon" innerHTML={groupByIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.groupBy')}</span>
                <svg class="annotations-menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
                <div class="annotations-submenu">
                  {groupOptions.map(opt => (
                    <div
                      class={`annotations-menu-item${sortMode() === opt.key ? ' checked' : ''}`}
                      onClick={() => applySort(opt.key)}
                    >
                      <span class="annotations-menu-check">{sortMode() === opt.key ? '\u2713' : ''}</span>
                      <span class="annotations-menu-label">{t(`leftPanel.${opt.label}`)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Show (filter) — submenu */}
              <div class="annotations-menu-item annotations-menu-submenu-trigger">
                <span class="annotations-menu-icon" innerHTML={showIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.show')}</span>
                <svg class="annotations-menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
                <div class="annotations-submenu">
                  <div
                    class={`annotations-menu-item${filterMode() === 'all' ? ' checked' : ''}`}
                    onClick={() => applyFilter('all')}
                  >
                    <span class="annotations-menu-check">{filterMode() === 'all' ? '\u2713' : ''}</span>
                    <span class="annotations-menu-label">{t('leftPanel.allPages')}</span>
                  </div>
                  <div
                    class={`annotations-menu-item${filterMode() === 'current' ? ' checked' : ''}`}
                    onClick={() => applyFilter('current')}
                  >
                    <span class="annotations-menu-check">{filterMode() === 'current' ? '\u2713' : ''}</span>
                    <span class="annotations-menu-label">{t('leftPanel.currentPage')}</span>
                  </div>

                  {/* Filter op review-status (#236) \u2014 vinkje = zichtbaar */}
                  <div class="annotations-menu-separator"></div>
                  <div class="annotations-menu-section">{tContext('annotation.status')}</div>
                  {statusFilterOptions.map(opt => (
                    <div
                      class={`annotations-menu-item${!hiddenStatuses().has(opt.key) ? ' checked' : ''}`}
                      onClick={() => toggleStatusFilter(opt.key)}
                    >
                      <span class="annotations-menu-check">{!hiddenStatuses().has(opt.key) ? '\u2713' : ''}</span>
                      <span class="annotations-menu-label">{tContext(opt.label)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div class="annotations-menu-separator"></div>

              {/* Deselect */}
              <div
                class={`annotations-menu-item${!hasSelection() ? ' disabled' : ''}`}
                onClick={() => hasSelection() && closeAndRun(deselectAll)}
              >
                <span class="annotations-menu-icon" innerHTML={deselectIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.deselect')}</span>
              </div>

              <div class="annotations-menu-separator"></div>

              {/* Properties */}
              <div
                class={`annotations-menu-item${!hasSelection() ? ' disabled' : ''}`}
                onClick={() => hasSelection() && closeAndRun(showProperties)}
              >
                <span class="annotations-menu-icon" innerHTML={propertiesIcon}></span>
                <span class="annotations-menu-label">{t('leftPanel.properties')}</span>
              </div>
            </div>
          </Show>
        </div>
        <div class="annotations-toolbar-spacer"></div>
        <button
          class="annotations-toolbar-btn"
          title={t('leftPanel.expandAll')}
          onClick={expandAll}
        >
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M15 6v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3V4.27c.6.35 1 .99 1 1.73m-4 7H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2h7c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2m-7-1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1H4c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1m5.5-5H8V5.5a.5.5 0 0 0-1 0V7H5.5a.5.5 0 0 0 0 1H7v1.5a.5.5 0 0 0 1 0V8h1.5a.5.5 0 0 0 0-1"/>
          </svg>
        </button>
        <button
          class="annotations-toolbar-btn"
          title={t('leftPanel.collapseAll')}
          onClick={collapseAll}
        >
          <svg viewBox="0 0 16 16" fill="currentColor">
            <g>
              <path d="M14 4.27c.6.35 1 .99 1 1.73v5c0 2.21-1.79 4-4 4H6c-.74 0-1.38-.4-1.73-1H11c1.65 0 3-1.35 3-3zM9.5 7a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1z"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M11 2c1.103 0 2 .897 2 2v7c0 1.103-.897 2-2 2H4c-1.103 0-2-.897-2-2V4c0-1.103.897-2 2-2zM4 3c-.551 0-1 .449-1 1v7c0 .552.449 1 1 1h7c.551 0 1-.448 1-1V4c0-.551-.449-1-1-1z"/>
            </g>
          </svg>
        </button>
      </div>
      <div class="annotations-list-content">
        <Show when={emptyMessage()}>
          <div class="annotations-list-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={items()}>
            {(item) => (
              <Show when={item.isHeader} fallback={
                <Show when={!collapsedGroups().has(item.groupKey)}>
                  <div
                    class={`annotation-list-item${item.selected ? ' selected' : ''}`}
                    on:click={(e) => {
                      const ctrlKey = e.ctrlKey || e.metaKey;
                      import('../../../../ui/panels/annotations-list.js').then(m => m.selectAnnotationItem(item.id, item.page, ctrlKey));
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
                </Show>
              }>
                <Show when={item.sortMode === 'color'}>
                  <div
                    class={`annotations-list-page-header annotations-list-color-header${collapsedGroups().has(item.groupKey) ? ' collapsed' : ''}`}
                    onClick={() => toggleGroup(item.groupKey)}
                  >
                    <svg class="annotations-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points={collapsedGroups().has(item.groupKey) ? "9 6 15 12 9 18" : "6 9 12 15 18 9"}/>
                    </svg>
                    <span class="annotations-list-color-swatch" style={{ 'background-color': item.headerColor }}></span>
                    <span>{item.headerColor}</span>
                  </div>
                </Show>
                <Show when={item.sortMode !== 'color'}>
                  <div
                    class={`annotations-list-page-header${collapsedGroups().has(item.groupKey) ? ' collapsed' : ''}`}
                    onClick={() => toggleGroup(item.groupKey)}
                  >
                    <svg class="annotations-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points={collapsedGroups().has(item.groupKey) ? "9 6 15 12 9 18" : "6 9 12 15 18 9"}/>
                    </svg>
                    {headerText(item)}
                  </div>
                </Show>
              </Show>
            )}
          </For>
        </Show>
      </div>
      <div class="annotations-list-count">{countText()}</div>
    </div>
  );
}

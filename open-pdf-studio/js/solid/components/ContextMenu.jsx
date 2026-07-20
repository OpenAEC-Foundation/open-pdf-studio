import { createEffect, onMount, onCleanup, Show, Switch, Match, For } from 'solid-js';
import { showConfirm } from '../../ui/chrome/confirm-dialog.js';
import {
  visible, menuType, position, targetAnnotation, multiSelectCount, targetPage, hideMenu, vertexContext
} from '../stores/contextMenuStore.js';
import {
  openPopupIcon, hidePopupIcon, resetPopupIcon, cutIcon, copyIcon, pasteIcon,
  deleteIcon, flattenIcon, addReplyIcon, lockedIcon, unlockedIcon, markedIcon, printableIcon,
  statusIcon, reviewHistoryIcon, layerIcon, arrangeIcon, flipLineIcon,
  convertMeasurementIcon, convertPolylineIcon, convertPolygonIcon,
  styleToolsIcon, exportIcon, propertiesIcon, transformIcon, duplicateIcon,
  bookmarkIcon, stickyNoteIcon, imageIcon, qrCodeIcon, handToolIcon,
  snapshotIcon, selectTextPageIcon, zoomIcon, pageCutIcon, pageCopyIcon,
  pagePasteIcon, pageDeleteIcon, selectAllIcon, deselectIcon, goToIcon,
  printIcon, findIcon, searchIcon,
  bringToFrontSvg, sendToBackSvg, bringForwardSvg, sendBackwardSvg,
  rotateLeftSvg, rotateRightSvg, flipHorizontalSvg, flipVerticalSvg
} from '../data/contextMenuIcons.js';

import { state, getActiveDocument, clearSelection, isSelected } from '../../core/state.js';
import { showProperties, hideProperties } from '../../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { copyAnnotation, copyAnnotations, pasteFromClipboard, pasteAnnotationsInPlace, duplicateAnnotation } from '../../annotations/clipboard.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { commitAnnotationMutation } from '../../annotations/mutations.js';
import { recordDelete, recordBulkDelete, recordModify } from '../../core/undo-manager.js';
import { bringToFront, sendToBack, bringForward, sendBackward, rotateAnnotation, flipHorizontal, flipVertical } from '../../annotations/z-order.js';
import { startTextEditing } from '../../tools/text-editing.js';
import { openStickyPopup, closeStickyPopup } from '../stores/stickyNotePopupStore.js';
import { createTextMarkupAnnotation, createCalloutFromSelection } from '../../text/text-markup.js';
import { setAsDefaultStyle, applyDefaultStyle } from '../../core/preferences.js';
import { setTool } from '../../tools/manager.js';
import { alignAnnotations } from '../../annotations/smart-guides.js';
import { getSelectedText, clearTextSelection } from '../../text/text-selection.js';
import { showCalibrationDialog } from '../../annotations/measurement.js';
import { openDialog } from '../stores/dialogStore.js';
import { getSelectedPagesArray, formatPageRangeString, selectAllPages, clearPageSelection } from '../stores/panels/thumbnailStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import {
  revealInFileManager,
  revealInFileManagerLabelKey,
  canRevealInFileManager,
} from '../../core/file-manager-reveal.js';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

function MenuItem(props) {
  const handleClick = (e) => {
    if (props.disabled) return;
    e.stopPropagation();
    hideMenu();
    if (props.onClick) props.onClick();
  };

  return (
    <div
      class={`context-menu-item${props.disabled ? ' disabled' : ''}${props.checkbox ? ' context-menu-checkbox' : ''}${props.checked ? ' checked' : ''}`}
      onClick={handleClick}
    >
      <span class="context-menu-icon" innerHTML={props.icon || ''} />
      <span class="context-menu-label">{props.label}</span>
      <Show when={props.shortcut}>
        <span class="context-menu-shortcut">{props.shortcut}</span>
      </Show>
      <Show when={props.checkbox}>
        <span class="context-menu-check">{props.checked ? '\u2713' : ''}</span>
      </Show>
    </div>
  );
}

function Separator() {
  return <div class="context-menu-separator" />;
}

function Submenu(props) {
  return (
    <div class={`context-menu-item context-menu-submenu${props.disabled ? ' disabled' : ''}`}>
      <span class="context-menu-icon" innerHTML={props.icon || ''} />
      <span class="context-menu-label">{props.label}</span>
      <span class="context-menu-arrow">{'\u25B6'}</span>
      <div class="context-menu-submenu-content">
        {props.children}
      </div>
    </div>
  );
}

function ArrangeButton(props) {
  const handleClick = (e) => {
    e.stopPropagation();
    hideMenu();
    if (props.onClick) props.onClick();
  };
  return (
    <button class="arrange-icon-btn" title={props.title} onClick={handleClick}>
      <span innerHTML={props.svg} />
    </button>
  );
}

function AnnotationMenuContent() {
  const { t } = useTranslation('context');
  const { t: tCommon } = useTranslation('common');
  const ann = () => targetAnnotation();
  const isLocked = () => ann()?.locked || false;
  const isLineType = () => ['line', 'arrow'].includes(ann()?.type);
  const isMeasureDistance = () => ann()?.type === 'measureDistance';
  const isMeasureArea = () => ann()?.type === 'measureArea' || ann()?.type === 'filledArea';

  const statusItems = [
    { key: 'None', label: () => t('annotation.statusNone') },
    { key: 'Accepted', label: () => t('annotation.statusAccepted') },
    { key: 'Cancelled', label: () => t('annotation.statusCancelled') },
    { key: 'Completed', label: () => t('annotation.statusCompleted') },
    { key: 'Rejected', label: () => t('annotation.statusRejected') },
  ];

  // Edit-contour vertex actions — only shown when right-clicking a vertex/edge
  // handle of the annotation that's currently in edit-contour mode.
  const renderVertexActions = () => {
    const v = vertexContext();
    const a = ann();
    if (!v || !a || a.id !== v.annotationId) return null;
    const isVertex = v.kind === 'vertex';
    const isEdge = v.kind === 'edge';
    const deleteLabel = t('contextMenu.deleteVertex') || 'Delete vertex';
    const insertLabel = t('contextMenu.insertVertex') || 'Insert vertex here';
    const toArcLabel = t('contextMenu.convertToArc') || 'Convert to arc';
    const toLineLabel = t('contextMenu.convertToLine') || 'Convert to line';
    // The vertex's `arc` flag determines the segment ENDING at this vertex
    // (i.e. previous vertex -> this vertex). See arcControlPoint() in
    // js/annotations/measurement.js.
    let clickedVertex = null;
    if (isVertex) {
      if (v.holeIndex != null && Array.isArray(a.holes) && a.holes[v.holeIndex]) {
        clickedVertex = a.holes[v.holeIndex][v.nodeIndex];
      } else if (Array.isArray(a.points)) {
        clickedVertex = a.points[v.nodeIndex];
      }
    }
    const isArcVertex = !!(clickedVertex && clickedVertex.arc);
    const handleDelete = () => {
      const before = cloneAnnotation(a);
      let ok = false;
      if (v.holeIndex != null && Array.isArray(a.holes) && a.holes[v.holeIndex]) {
        const hole = a.holes[v.holeIndex];
        if (hole.length > 3) { hole.splice(v.nodeIndex, 1); ok = true; }
      } else if (Array.isArray(a.points) && a.points.length > 3) {
        a.points.splice(v.nodeIndex, 1);
        ok = true;
      }
      if (ok) {
        a.modifiedAt = new Date().toISOString();
        recordModify(a.id, before, cloneAnnotation(a));
        redraw();
      }
      hideMenu();
    };
    const handleInsert = () => {
      const before = cloneAnnotation(a);
      const ei = v.edgeIndex;
      if (v.holeIndex != null && Array.isArray(a.holes) && a.holes[v.holeIndex]) {
        const hole = a.holes[v.holeIndex];
        if (ei >= 0 && ei < hole.length) {
          const p1 = hole[ei], p2 = hole[(ei + 1) % hole.length];
          hole.splice(ei + 1, 0, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
        }
      } else if (Array.isArray(a.points) && ei >= 0 && ei < a.points.length) {
        const p1 = a.points[ei], p2 = a.points[(ei + 1) % a.points.length];
        a.points.splice(ei + 1, 0, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
      }
      a.modifiedAt = new Date().toISOString();
      recordModify(a.id, before, cloneAnnotation(a));
      redraw();
      hideMenu();
    };
    const handleConvert = () => {
      if (!clickedVertex) { hideMenu(); return; }
      const before = cloneAnnotation(a);
      if (clickedVertex.arc) {
        clickedVertex.arc = false;
        delete clickedVertex.bulge;
      } else {
        clickedVertex.arc = true;
        clickedVertex.bulge = 0.5;
      }
      a.modifiedAt = new Date().toISOString();
      recordModify(a.id, before, cloneAnnotation(a));
      redraw();
      hideMenu();
    };
    return (
      <>
        <Show when={isVertex}>
          <MenuItem icon={deleteIcon} label={deleteLabel} onClick={handleDelete} />
          <MenuItem label={isArcVertex ? toLineLabel : toArcLabel} onClick={handleConvert} />
        </Show>
        <Show when={isEdge}>
          <MenuItem label={insertLabel} onClick={handleInsert} />
        </Show>
        <Separator />
      </>
    );
  };

  return (
    <>
      {renderVertexActions()}
      <MenuItem icon={openPopupIcon} label={t('annotation.openPopUpNote')} onClick={() => {
        const a = ann();
        if (a) openStickyPopup(a);
      }} />
      <MenuItem icon={hidePopupIcon} label={t('annotation.hidePopUpNote')} onClick={() => {
        const a = ann();
        if (a) closeStickyPopup(a.id);
      }} />
      <MenuItem icon={resetPopupIcon} label={t('annotation.resetPopUpLocation')} onClick={() => {
        const a = ann();
        if (a) {
          commitAnnotationMutation(a, annotation => {
            annotation.popupX = undefined;
            annotation.popupY = undefined;
          });
          // Re-open if currently open
          closeStickyPopup(a.id);
          openStickyPopup(a);
        }
      }} />

      <Separator />

      <Show when={['textbox', 'callout'].includes(ann()?.type)}>
        <MenuItem label={t('annotation.editText')} disabled={isLocked()} onClick={() => startTextEditing(ann())} />
        <Separator />
      </Show>

      <MenuItem icon={cutIcon} label={tCommon('cut')} shortcut="Ctrl+X" disabled={isLocked()} onClick={() => {
        const a = ann();
        const doc = getActiveDocument();
        copyAnnotation(a);
        const idx = (doc?.annotations || []).indexOf(a);
        recordDelete(a, idx);
        if (doc) doc.annotations = doc.annotations.filter(x => x !== a);
        hideProperties();
        redraw();
      }} />
      <MenuItem icon={copyIcon} label={tCommon('copy')} shortcut="Ctrl+C" onClick={() => copyAnnotation(ann())} />
      <MenuItem icon={pasteIcon} label={tCommon('paste')} shortcut="Ctrl+V" onClick={() => pasteFromClipboard()} />
      <MenuItem icon={pasteIcon} label={tCommon('pasteInPlace')} shortcut="Ctrl+Shift+V" onClick={() => pasteAnnotationsInPlace()} />

      <Separator />

      <Show when={ann()?.type === 'viewport'}>
        <Separator />
        <MenuItem label={t('annotation.editViewportScale') || 'Edit Viewport Scale'} onClick={() => {
          const a = ann();
          if (a) {
            import('../stores/dialogStore.js').then(m => m.openDialog('viewport-scale', {
              annotationId: a.id,
              pageNum: a.page,
            }));
          }
        }} />
        <Separator />
      </Show>

      <MenuItem icon={deleteIcon} label={tCommon('delete')} shortcut="Delete" disabled={isLocked()} onClick={async () => {
        const a = ann();
        const confirmed = await showConfirm({
          title: t('deleteAnnotation.title'),
          message: t('deleteAnnotation.confirmSingle'),
          preferenceKey: 'confirmBeforeDelete'
        });
        if (confirmed) {
          const doc = getActiveDocument();
          const idx = (doc?.annotations || []).indexOf(a);
          recordDelete(a, idx);
          if (doc) doc.annotations = doc.annotations.filter(x => x !== a);
          hideProperties();
          redraw();
        }
      }} />
      <MenuItem icon={flattenIcon} label={tCommon('flatten')} disabled={isLocked()} onClick={() => {
        const a = ann();
        if (a) {
          commitAnnotationMutation(a, annotation => { annotation.flattened = true; });
          redraw();
        }
      }} />

      <Separator />

      <MenuItem icon={addReplyIcon} label={t('annotation.addReply')} onClick={() => {
        const a = ann();
        if (a) {
          commitAnnotationMutation(a, annotation => {
            if (!annotation.replies) annotation.replies = [];
            annotation.replies.push({ author: state.preferences?.author || 'User', date: new Date().toISOString(), text: '' });
            annotation.popupOpen = true;
          });
          redraw();
        }
      }} />

      <Separator />

      <MenuItem icon={isLocked() ? lockedIcon : unlockedIcon} label={t('annotation.locked')} checkbox={true} checked={isLocked()} onClick={() => {
        const a = ann();
        if (a) {
          commitAnnotationMutation(a, annotation => { annotation.locked = !annotation.locked; });
          if (getActiveDocument()?.selectedAnnotation === a) showProperties(a);
        }
      }} />
      <MenuItem icon={markedIcon} label={t('annotation.marked')} checkbox={true} checked={ann()?.marked || false} onClick={() => {
        const a = ann();
        if (a) commitAnnotationMutation(a, annotation => { annotation.marked = !annotation.marked; });
      }} />
      <MenuItem icon={printableIcon} label={t('annotation.printable')} checkbox={true} checked={ann()?.printable !== false} onClick={() => {
        const a = ann();
        if (a) commitAnnotationMutation(a, annotation => { annotation.printable = annotation.printable === false; });
      }} />

      <Separator />

      <Submenu icon={statusIcon} label={t('annotation.status')}>
        <For each={statusItems}>
          {(s) => (
            <MenuItem label={s.label()} checkbox={true} checked={ann()?.status === s.key || (!ann()?.status && s.key === 'None')} onClick={() => {
              const a = ann();
              if (a) commitAnnotationMutation(a, annotation => {
                annotation.status = s.key === 'None' ? undefined : s.key;
              });
            }} />
          )}
        </For>
      </Submenu>
      <MenuItem icon={reviewHistoryIcon} label={t('annotation.reviewHistory')} onClick={() => {
        const a = ann();
        if (a) showProperties(a);
      }} />

      <Separator />

      <Submenu icon={layerIcon} label={<>{t('annotation.layer')} <span class="context-menu-value">{tCommon('none')}</span></>}>
        <MenuItem label={t('annotation.noLayersAvailable')} disabled={true} />
      </Submenu>

      <Submenu icon={arrangeIcon} label={t('annotation.arrange')}>
        <div class="arrange-icon-grid">
          <ArrangeButton svg={bringToFrontSvg} title={t('annotation.bringToFront')} onClick={() => bringToFront(ann())} />
          <ArrangeButton svg={sendToBackSvg} title={t('annotation.sendToBack')} onClick={() => sendToBack(ann())} />
          <ArrangeButton svg={bringForwardSvg} title={t('annotation.bringForward')} onClick={() => bringForward(ann())} />
          <ArrangeButton svg={sendBackwardSvg} title={t('annotation.sendBackward')} onClick={() => sendBackward(ann())} />
        </div>
        <div class="arrange-icon-grid">
          <ArrangeButton svg={rotateLeftSvg} title={t('annotation.rotateLeft90')} onClick={() => {
            const a = ann(); if (!a) return;
            const old = cloneAnnotation(a);
            rotateAnnotation(a, -90);
            recordModify(a.id, old, a);
          }} />
          <ArrangeButton svg={rotateRightSvg} title={t('annotation.rotateRight90')} onClick={() => {
            const a = ann(); if (!a) return;
            const old = cloneAnnotation(a);
            rotateAnnotation(a, 90);
            recordModify(a.id, old, a);
          }} />
          <ArrangeButton svg={flipHorizontalSvg} title={t('annotation.flipHorizontal')} onClick={() => {
            const a = ann(); if (!a) return;
            const old = cloneAnnotation(a);
            flipHorizontal(a);
            recordModify(a.id, old, a);
          }} />
          <ArrangeButton svg={flipVerticalSvg} title={t('annotation.flipVertical')} onClick={() => {
            const a = ann(); if (!a) return;
            const old = cloneAnnotation(a);
            flipVertical(a);
            recordModify(a.id, old, a);
          }} />
        </div>
        <Separator />
        <MenuItem icon={transformIcon} label={t('annotation.transform')} onClick={() => showProperties(ann())} />
        <MenuItem icon={duplicateIcon} label={tCommon('duplicate')} onClick={() => {
          const _d = getActiveDocument();
          const _a = ann();
          if (_d && _a) { _d.selectedAnnotation = _a; _d.selectedAnnotations = [_a]; }
          duplicateAnnotation();
        }} />
      </Submenu>

      <Separator />

      <Show when={isLineType()}>
        <MenuItem icon={flipLineIcon} label={t('annotation.flipLine')} onClick={() => {
          const a = ann();
          if (a) {
            commitAnnotationMutation(a, annotation => {
              const startX = annotation.startX;
              const startY = annotation.startY;
              annotation.startX = annotation.endX;
              annotation.startY = annotation.endY;
              annotation.endX = startX;
              annotation.endY = startY;
            });
            redraw();
          }
        }} />
        <Separator />
        <MenuItem icon={convertMeasurementIcon} label={t('annotation.convertToMeasurement')} onClick={() => {
          const a = ann();
          if (a) {
            commitAnnotationMutation(a, annotation => { annotation.type = 'measureDistance'; });
            redraw();
          }
        }} />
        <MenuItem icon={convertPolylineIcon} label={t('annotation.convertToPolyline')} onClick={() => {
          const a = ann();
          if (a) {
            commitAnnotationMutation(a, annotation => {
              annotation.type = 'polyline';
              annotation.points = [
                { x: annotation.startX, y: annotation.startY },
                { x: annotation.endX, y: annotation.endY },
              ];
            });
            redraw();
          }
        }} />
        <MenuItem icon={convertPolygonIcon} label={t('annotation.convertToPolygon')} onClick={() => {
          const a = ann();
          if (a) {
            commitAnnotationMutation(a, annotation => {
              annotation.type = 'polygon';
              annotation.points = [
                { x: annotation.startX, y: annotation.startY },
                { x: annotation.endX, y: annotation.endY },
              ];
            });
            redraw();
          }
        }} />
        <Separator />
      </Show>

      <Show when={isMeasureDistance()}>
        <MenuItem icon={convertMeasurementIcon} label={t('annotation.calibrateFromLine')} onClick={() => {
          const a = ann();
          if (a) {
            const px = a.measurePixels || Math.sqrt(
              (a.endX - a.startX) ** 2 + (a.endY - a.startY) ** 2
            );
            showCalibrationDialog(px);
          }
        }} />
        <MenuItem icon={convertMeasurementIcon} label={t('annotation.setScale')} onClick={() => {
          const a = ann();
          if (a) {
            const px = a.measurePixels || Math.sqrt(
              (a.endX - a.startX) ** 2 + (a.endY - a.startY) ** 2
            );
            const annUnit = a.measureUnit || 'mm';
            const currentText = a.measureText || '';
            openDialog('scale', { pixelLength: px, currentText, currentUnit: annUnit, annotation: a });
          }
        }} />
        <Separator />
      </Show>

      <Show when={isMeasureArea()}>
        <MenuItem icon={convertMeasurementIcon} label={t('annotation.addHole')} disabled={isLocked()} onClick={() => {
          const a = ann();
          if (a) {
            state.addHoleTargetId = a.id;
            state.addHolePoints = [];
            setTool('addHole');
          }
        }} />
        <Separator />
      </Show>

      <Submenu icon={styleToolsIcon} label={t('annotation.styleTools')}>
        <MenuItem label={t('annotation.setAsDefaultStyle')} onClick={() => setAsDefaultStyle(ann())} />
        <MenuItem label={t('annotation.applyDefaultStyle')} onClick={() => {
          const a = ann();
          if (a) {
            commitAnnotationMutation(a, annotation => applyDefaultStyle(annotation));
            redraw();
          }
        }} />
      </Submenu>

      <Submenu icon={exportIcon} label={t('annotation.exportSubmenu')}>
        <MenuItem label={t('annotation.exportAsImage')} onClick={async () => {
          const a = ann();
          if (a) {
            const { exportAnnotationAsImage } = await import('../../pdf/exporter.js');
            await exportAnnotationAsImage(a);
          }
        }} />
      </Submenu>

      <Separator />

      <MenuItem icon={propertiesIcon} label={t('annotation.properties')} onClick={() => showProperties(ann())} />
    </>
  );
}

function MultiAnnotationMenuContent() {
  const { t } = useTranslation('context');
  const count = () => multiSelectCount();

  return (
    <>
      <MenuItem icon={copyIcon} label={t('multiSelect.copyAnnotations', { count: count() })} onClick={() => {
        const _d = getActiveDocument();
        copyAnnotations(_d ? _d.selectedAnnotations : []);
      }} />
      <MenuItem icon={cutIcon} label={t('multiSelect.cutAnnotations', { count: count() })} onClick={() => {
        const _d = getActiveDocument();
        const _sel = _d ? _d.selectedAnnotations : [];
        copyAnnotations(_sel);
        recordBulkDelete(_sel);
        const toDelete = new Set(_sel);
        if (_d) _d.annotations = _d.annotations.filter(a => !toDelete.has(a));
        clearSelection();
        hideProperties();
        redraw();
      }} />

      <Separator />

      <MenuItem label={t('multiSelect.bringAllToFront')} onClick={() => {
        const _d = getActiveDocument();
        bringToFront(_d ? _d.selectedAnnotations : []);
      }} />
      <MenuItem label={t('multiSelect.sendAllToBack')} onClick={() => {
        const _d = getActiveDocument();
        sendToBack(_d ? _d.selectedAnnotations : []);
      }} />

      <Separator />

      <MenuItem label={t('multiSelect.alignLeft')} onClick={() => { alignAnnotations('left'); redraw(); }} />
      <MenuItem label={t('multiSelect.alignRight')} onClick={() => { alignAnnotations('right'); redraw(); }} />
      <MenuItem label={t('multiSelect.alignTop')} onClick={() => { alignAnnotations('top'); redraw(); }} />
      <MenuItem label={t('multiSelect.alignBottom')} onClick={() => { alignAnnotations('bottom'); redraw(); }} />
      <MenuItem label={t('multiSelect.centerHorizontally')} onClick={() => { alignAnnotations('center'); redraw(); }} />
      <MenuItem label={t('multiSelect.centerVertically')} onClick={() => { alignAnnotations('middle'); redraw(); }} />

      <Show when={count() >= 3}>
        <MenuItem label={t('multiSelect.distributeHorizontally')} onClick={() => { alignAnnotations('distribute-h'); redraw(); }} />
        <MenuItem label={t('multiSelect.distributeVertically')} onClick={() => { alignAnnotations('distribute-v'); redraw(); }} />
      </Show>

      <Separator />

      <MenuItem icon={deleteIcon} label={t('multiSelect.deleteAnnotations', { count: count() })} onClick={async () => {
        const confirmed = await showConfirm({
          title: t('multiSelect.deleteTitle'),
          message: t('multiSelect.deleteConfirm', { count: count() }),
          preferenceKey: 'confirmBeforeDelete'
        });
        if (confirmed) {
          const _d = getActiveDocument();
          const _sel = _d ? _d.selectedAnnotations : [];
          recordBulkDelete(_sel);
          const toDelete = new Set(_sel);
          if (_d) _d.annotations = _d.annotations.filter(a => !toDelete.has(a));
          clearSelection();
          hideProperties();
          redraw();
        }
      }} />
    </>
  );
}

function PageMenuContent() {
  const { t } = useTranslation('context');
  const { t: tCommon } = useTranslation('common');
  const isCurrentTool = (tool) => state.currentTool === tool;
  const revealInFolderIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31zM2.19 4a1 1 0 0 0-.996 1.09l.637 7a1 1 0 0 0 .995.91h10.348a1 1 0 0 0 .995-.91l.637-7A1 1 0 0 0 13.81 4H2.19zm4.69-1.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707z"/></svg>';

  return (
    <>
      <MenuItem icon={bookmarkIcon} label={t('page.addBookmark')} shortcut="Ctrl+Shift+B" onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => {
          if (m.addBookmarkAtCurrentPage) m.addBookmarkAtCurrentPage();
        });
      }} />
      <MenuItem icon={stickyNoteIcon} label={t('page.addStickyNote')} onClick={() => setTool('stickyNote')} />

      <Separator />

      <MenuItem icon={imageIcon} label={t('page.addImage')} onClick={() => setTool('image')} />
      <MenuItem icon={qrCodeIcon} label={t('page.addQrCode')} onClick={() => setTool('qrCode')} />

      <Separator />

      <MenuItem icon={handToolIcon} label={t('page.handTool')} checkbox={true} checked={isCurrentTool('hand')} onClick={() => setTool('hand')} />
      <MenuItem icon={snapshotIcon} label={t('page.snapshotTool')} checkbox={true} checked={isCurrentTool('snapshot')} onClick={() => setTool('snapshot')} />
      <MenuItem icon={selectTextPageIcon} label={t('page.selectText')} checkbox={true} checked={isCurrentTool('selectText')} onClick={() => setTool('selectText')} />
      <MenuItem icon={zoomIcon} label={t('page.zoomInOutTool')} checkbox={true} checked={isCurrentTool('zoom')} onClick={() => setTool('zoom')} />

      <Separator />

      <MenuItem icon={pageCutIcon} label={tCommon('cut')} shortcut="Ctrl+X" disabled={true} />
      <MenuItem icon={pageCopyIcon} label={tCommon('copy')} shortcut="Ctrl+C" disabled={true} />
      <MenuItem icon={pagePasteIcon} label={tCommon('paste')} shortcut="Ctrl+V" onClick={() => pasteFromClipboard()} />
      <MenuItem icon={pagePasteIcon} label={tCommon('pasteInPlace')} shortcut="Ctrl+Shift+V" onClick={() => pasteAnnotationsInPlace()} />

      <Separator />

      <MenuItem icon={pageDeleteIcon} label={tCommon('delete')} shortcut="Delete" disabled={true} />

      <Separator />

      <MenuItem icon={selectAllIcon} label={tCommon('select')} onClick={() => setTool('select')} />
      <MenuItem icon={deselectIcon} label={tCommon('deselect')} onClick={() => clearSelection()} />

      <Separator />

      <Submenu icon={goToIcon} label={t('page.goTo')}>
        <MenuItem label={t('page.firstPage')} onClick={() => {
          import('../../pdf/renderer.js').then(m => m.renderPage && m.renderPage(1));
        }} />
        <MenuItem label={t('page.lastPage')} onClick={() => {
          import('../../pdf/renderer.js').then(m => {
            const doc = getActiveDocument();
            if (doc?.pdfDoc && m.renderPage) m.renderPage(doc.pdfDoc.numPages);
          });
        }} />
        <MenuItem label={t('page.previousPage')} onClick={() => {
          import('../../pdf/renderer.js').then(m => {
            const doc = getActiveDocument();
            if (doc && doc.currentPage > 1 && m.renderPage) m.renderPage(doc.currentPage - 1);
          });
        }} />
        <MenuItem label={t('page.nextPage')} onClick={() => {
          import('../../pdf/renderer.js').then(m => {
            const doc = getActiveDocument();
            if (doc?.pdfDoc && doc.currentPage < doc.pdfDoc.numPages && m.renderPage) m.renderPage(doc.currentPage + 1);
          });
        }} />
      </Submenu>

      <Separator />

      <MenuItem icon={printIcon} label={t('page.printMenu')} shortcut="Ctrl+P" onClick={() => {
        import('../stores/dialogStore.js').then(m => m.openDialog('print'));
      }} />
      <MenuItem icon={findIcon} label={t('page.findMenu')} shortcut="Ctrl+F" onClick={() => {
        const findBar = document.getElementById('find-bar');
        const findInput = document.getElementById('find-input');
        if (findBar) { findBar.style.display = 'flex'; if (findInput) findInput.focus(); }
      }} />
      <MenuItem icon={searchIcon} label={t('page.searchMenu')} shortcut="Ctrl+Shift+F" onClick={() => {
        const findBar = document.getElementById('find-bar');
        const findInput = document.getElementById('find-input');
        if (findBar) { findBar.style.display = 'flex'; if (findInput) findInput.focus(); }
      }} />

      <Separator />

      <MenuItem icon={propertiesIcon} label={t('page.propertiesMenu')} onClick={() => {
        import('../stores/dialogStore.js').then(m => m.openDialog('doc-properties'));
      }} />

      {/* Toon het geopende bestand in de bestandsbeheerder van het OS —
          alleen voor documenten met een echt bestandspad (dus niet voor
          naamloze/nieuwe documenten in een temp-bestand). */}
      <Show when={canRevealInFileManager(getActiveDocument())}>
        <Separator />
        <MenuItem
          icon={revealInFolderIcon}
          label={t(revealInFileManagerLabelKey())}
          onClick={() => {
            const doc = getActiveDocument();
            if (doc?.filePath) revealInFileManager(doc.filePath);
          }} />
      </Show>
    </>
  );
}

function BookmarkMenuContent() {
  const { t } = useTranslation('context');

  return (
    <>
      <MenuItem label={t('bookmark.addBookmark')} onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.addBookmark());
      }} />
      <MenuItem label={t('bookmark.addChildBookmark')} onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.addChildBookmark());
      }} />
      <Separator />
      <MenuItem label={t('bookmark.editBookmark')} onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.editBookmark());
      }} />
      <MenuItem label={t('bookmark.deleteBookmark')} onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.deleteBookmark());
      }} />
      <Separator />
      <MenuItem label={t('bookmark.expandAll')} onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.expandAll());
      }} />
      <MenuItem label={t('bookmark.collapseAll')} onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.collapseAll());
      }} />
    </>
  );
}

function ThumbnailMenuContent() {
  const { t } = useTranslation('context');
  const { t: tCommon } = useTranslation('common');
  const pageNum = () => targetPage();

  const pages = () => getSelectedPagesArray();
  const count = () => pages().length;
  const isMulti = () => count() > 1;
  const numPages = () => state.documents[state.activeDocumentIndex]?.pdfDoc?.numPages || 1;
  // Build a reorderPages() permutation that swaps the target page with its
  // neighbour (dir -1 = up, +1 = down). Returns null at the ends.
  const swapOrder = (p, dir) => {
    const N = numPages();
    const a = p - 1, b = a + dir;
    if (b < 0 || b >= N) return null;
    const order = Array.from({ length: N }, (_, i) => i + 1);
    [order[a], order[b]] = [order[b], order[a]];
    return order;
  };
  const moveUpIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 13a.5.5 0 0 0 1 0V4.707l3.146 3.147a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 1 0 .708.708L7.5 4.707V13z"/></svg>';
  const moveDownIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.5 3a.5.5 0 0 0-1 0v8.293L4.354 8.146a.5.5 0 1 0-.708.708l4 4a.5.5 0 0 0 .708 0l4-4a.5.5 0 0 0-.708-.708L8.5 11.293V3z"/></svg>';

  const thumbnailCutIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5a2.5 2.5 0 1 1 3.164 2.414L8.5 7.25l1.336-2.336a2.5 2.5 0 1 1 1.414 0L9.914 7.25 13 12.5V14H3v-1.5L6.086 7.25 4.75 4.914A2.5 2.5 0 0 1 4 2.5zm2.5 1a1 1 0 1 0-2 0 1 1 0 0 0 2 0zm5 0a1 1 0 1 0-2 0 1 1 0 0 0 2 0z"/></svg>';
  const thumbnailCopyIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6z"/><path d="M2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z"/></svg>';
  const thumbnailPasteIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10 1.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-1zm-5 0A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5v1A1.5 1.5 0 0 1 9.5 4h-3A1.5 1.5 0 0 1 5 2.5v-1zm-2 0h1v1A2.5 2.5 0 0 0 6.5 5h3A2.5 2.5 0 0 0 12 2.5v-1h1a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3.5a2 2 0 0 1 2-2z"/></svg>';
  const thumbnailInsertIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 0h5.5L14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5H9.5V1z"/><path d="M8 6.5a.5.5 0 0 1 .5.5v1.5H10a.5.5 0 0 1 0 1H8.5V11a.5.5 0 0 1-1 0V9.5H6a.5.5 0 0 1 0-1h1.5V7a.5.5 0 0 1 .5-.5z"/></svg>';
  const thumbnailExtractIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 0h5.5L14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5H9.5V1z"/><path d="M8 12a.5.5 0 0 0 .5-.5V8.207l1.146 1.147a.5.5 0 0 0 .708-.708l-2-2a.5.5 0 0 0-.708 0l-2 2a.5.5 0 1 0 .708.708L7.5 8.207V11.5a.5.5 0 0 0 .5.5z"/></svg>';
  const thumbnailReplaceIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1 11.5a.5.5 0 0 0 .5.5h11.793l-3.147 3.146a.5.5 0 0 0 .708.708l4-4a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 11H1.5a.5.5 0 0 0-.5.5zm14-7a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 1 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 4H14.5a.5.5 0 0 1 .5.5z"/></svg>';
  const thumbnailDeleteIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1z"/></svg>';
  const thumbnailRotateLeftIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/></svg>';
  const thumbnailRotateRightIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>';
  const thumbnailPropertiesIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>';
  const selectAllIcon = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2zm10.03 4.97a.75.75 0 0 1 .011 1.05l-4.5 4.75a.75.75 0 0 1-1.072.014L4.22 8.53a.75.75 0 1 1 1.06-1.06l1.705 1.705L10.97 4.98a.75.75 0 0 1 1.06-.01z"/></svg>';

  return (
    <>
      <MenuItem icon={thumbnailCutIcon}
        label={isMulti() ? t('thumbnail.cutPages', { count: count() }) : tCommon('cut')}
        disabled={state.documents[state.activeDocumentIndex]?.pdfDoc?.numPages <= count()}
        onClick={async () => {
          const pm = await import('../../pdf/page-manager.js');
          if (isMulti()) {
            await pm.cutPages(pages());
          } else {
            await pm.cutPage(pages()[0]);
          }
        }} />
      <MenuItem icon={thumbnailCopyIcon}
        label={isMulti() ? t('thumbnail.copyPages', { count: count() }) : tCommon('copy')}
        onClick={async () => {
          const pm = await import('../../pdf/page-manager.js');
          if (isMulti()) {
            await pm.copyPages(pages());
          } else {
            await pm.copyPage(pages()[0]);
          }
        }} />
      <MenuItem icon={thumbnailPasteIcon} label={tCommon('paste')} onClick={async () => {
        const { pastePage } = await import('../../pdf/page-manager.js');
        await pastePage(pageNum());
      }} />

      <Separator />

      <MenuItem icon={thumbnailRotateLeftIcon}
        label={isMulti() ? t('thumbnail.rotateLeftPages', { count: count() }) : t('thumbnail.rotateLeft')}
        onClick={async () => {
          const { rotatePage } = await import('../../pdf/renderer.js');
          for (const p of pages()) await rotatePage(-90, p);
        }} />
      <MenuItem icon={thumbnailRotateRightIcon}
        label={isMulti() ? t('thumbnail.rotateRightPages', { count: count() }) : t('thumbnail.rotateRight')}
        onClick={async () => {
          const { rotatePage } = await import('../../pdf/renderer.js');
          for (const p of pages()) await rotatePage(90, p);
        }} />

      <Separator />

      <MenuItem icon={moveUpIcon}
        label={t('thumbnail.moveUp')}
        disabled={isMulti() || pageNum() <= 1}
        onClick={async () => {
          const { reorderPages } = await import('../../pdf/page-manager.js');
          const order = swapOrder(pageNum(), -1);
          if (order) await reorderPages(order);
        }} />
      <MenuItem icon={moveDownIcon}
        label={t('thumbnail.moveDown')}
        disabled={isMulti() || pageNum() >= numPages()}
        onClick={async () => {
          const { reorderPages } = await import('../../pdf/page-manager.js');
          const order = swapOrder(pageNum(), 1);
          if (order) await reorderPages(order);
        }} />

      <Separator />

      <MenuItem icon={thumbnailInsertIcon} label={t('thumbnail.insertPages')} onClick={() => {
        import('../../ui/chrome/dialogs.js').then(m => m.showInsertPageDialog());
      }} />
      <Submenu icon={thumbnailInsertIcon} label={t('thumbnail.insertFromFile')}>
        <MenuItem label={t('thumbnail.insertFromFileBefore')} onClick={async () => {
          const { insertPagesFromFile } = await import('../../pdf/page-manager.js');
          await insertPagesFromFile(pageNum(), 'before');
        }} />
        <MenuItem label={t('thumbnail.insertFromFileAfter')} onClick={async () => {
          const { insertPagesFromFile } = await import('../../pdf/page-manager.js');
          await insertPagesFromFile(pageNum(), 'after');
        }} />
      </Submenu>
      <MenuItem icon={thumbnailExtractIcon} label={t('thumbnail.extractPages')} onClick={() => {
        const rangeStr = formatPageRangeString(pages());
        import('../stores/dialogStore.js').then(m => m.openDialog('extract-pages', {
          totalPages: state.documents[state.activeDocumentIndex]?.pdfDoc?.numPages, currentPage: pageNum(), pageRange: rangeStr
        }));
      }} />
      <MenuItem icon={thumbnailReplaceIcon} label={t('thumbnail.replacePages')} disabled={isMulti()} onClick={async () => {
        const { replacePages } = await import('../../pdf/page-manager.js');
        replacePages(pageNum());
      }} />
      <MenuItem icon={thumbnailDeleteIcon}
        label={isMulti() ? t('thumbnail.deletePagesMulti', { count: count() }) : t('thumbnail.deletePages')}
        disabled={state.documents[state.activeDocumentIndex]?.pdfDoc?.numPages <= count()}
        onClick={() => {
          const rangeStr = formatPageRangeString(pages());
          import('../stores/dialogStore.js').then(m => m.openDialog('delete-pages', {
            totalPages: state.documents[state.activeDocumentIndex]?.pdfDoc?.numPages, currentPage: pageNum(), pageRange: rangeStr
          }));
        }} />

      <Separator />

      <MenuItem icon={selectAllIcon} label={t('thumbnail.selectAll')} onClick={() => selectAllPages()} />
      <MenuItem label={t('thumbnail.deselectAll')} onClick={() => clearPageSelection()} />

      <Separator />

      <MenuItem icon={thumbnailPropertiesIcon} label={t('thumbnail.properties')} disabled={isMulti()} onClick={() => {
        import('../stores/dialogStore.js').then(m => m.openDialog('page-properties', { pageNum: pageNum() }));
      }} />
    </>
  );
}

function TextSelectionMenuContent() {
  const { t } = useTranslation('context');
  const { t: tCommon } = useTranslation('common');

  return (
    <>
      <MenuItem label={t('textSelection.curvedLeaderSelection')} onClick={() => {
        createCalloutFromSelection();
        clearTextSelection();
      }} />

      <Separator />

      <MenuItem icon={copyIcon} label={tCommon('copy')} onClick={async () => {
        const selectedText = getSelectedText();
        if (!selectedText) return;
        try {
          await navigator.clipboard.writeText(selectedText);
        } catch {
          const textarea = document.createElement('textarea');
          textarea.value = selectedText;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
      }} />

      <Separator />

      <MenuItem label={t('textSelection.highlightSelection')} onClick={() => {
        createTextMarkupAnnotation('textHighlight', '#FFFF00', 0.3);
        clearTextSelection();
      }} />
      <MenuItem label={t('textSelection.strikethroughSelection')} onClick={() => {
        createTextMarkupAnnotation('textStrikethrough', '#FF0000', 1.0);
        clearTextSelection();
      }} />
      <MenuItem label={t('textSelection.underlineSelection')} onClick={() => {
        createTextMarkupAnnotation('textUnderline', '#0000FF', 1.0);
        clearTextSelection();
      }} />

    </>
  );
}

export default function ContextMenu() {
  let menuRef;

  // Position the menu when it becomes visible
  createEffect(() => {
    if (visible()) {
      const pos = position();
      requestAnimationFrame(() => {
        if (!menuRef) return;
        menuRef.style.left = `${pos.x}px`;
        menuRef.style.top = `${pos.y}px`;

        const rect = menuRef.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
          menuRef.style.left = `${Math.max(0, window.innerWidth - rect.width - 10)}px`;
        }
        if (rect.bottom > window.innerHeight) {
          menuRef.style.top = `${Math.max(0, window.innerHeight - rect.height - 10)}px`;
        }
      });
    }
  });

  // Dismiss when clicking outside the menu.
  // mousedown on document handles clicks on ribbon, panels, title bar, etc.
  // Canvas clicks are handled by the tool dispatcher (which calls hideMenu).
  function handleOutsideClick(e) {
    if (!visible()) return;
    if (menuRef && menuRef.contains(e.target)) return;
    hideMenu();
  }

  function handleEscape(e) {
    if (e.key === 'Escape' && visible()) {
      hideMenu();
    }
  }

  function handleWindowBlur() {
    if (visible()) hideMenu();
  }

  onMount(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('blur', handleWindowBlur);
  });

  onCleanup(() => {
    document.removeEventListener('mousedown', handleOutsideClick);
    document.removeEventListener('keydown', handleEscape);
    window.removeEventListener('blur', handleWindowBlur);
  });

  return (
    <div
      ref={menuRef}
      class="context-menu"
      classList={{ visible: visible() }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Switch>
        <Match when={menuType() === 'annotation'}>
          <AnnotationMenuContent />
        </Match>
        <Match when={menuType() === 'annotationMulti'}>
          <MultiAnnotationMenuContent />
        </Match>
        <Match when={menuType() === 'page'}>
          <PageMenuContent />
        </Match>
        <Match when={menuType() === 'textSelection'}>
          <TextSelectionMenuContent />
        </Match>
        <Match when={menuType() === 'bookmark'}>
          <BookmarkMenuContent />
        </Match>
        <Match when={menuType() === 'thumbnail'}>
          <ThumbnailMenuContent />
        </Match>
      </Switch>
    </div>
  );
}

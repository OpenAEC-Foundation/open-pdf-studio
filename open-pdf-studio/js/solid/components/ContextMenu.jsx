import { createEffect, onMount, onCleanup, Show, Switch, Match, For } from 'solid-js';
import {
  visible, menuType, position, targetAnnotation, multiSelectCount, targetPage, hideMenu
} from '../stores/contextMenuStore.js';
import {
  openPopupIcon, hidePopupIcon, resetPopupIcon, cutIcon, copyIcon, pasteIcon,
  deleteIcon, flattenIcon, addReplyIcon, lockedIcon, markedIcon, printableIcon,
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

import { state, clearSelection, isSelected } from '../../core/state.js';
import { showProperties, hideProperties } from '../../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { copyAnnotation, copyAnnotations, pasteFromClipboard, duplicateAnnotation } from '../../annotations/clipboard.js';
import { recordDelete, recordBulkDelete } from '../../core/undo-manager.js';
import { bringToFront, sendToBack, bringForward, sendBackward, rotateAnnotation, flipHorizontal, flipVertical } from '../../annotations/z-order.js';
import { startTextEditing } from '../../tools/text-editing.js';
import { createTextMarkupAnnotation } from '../../text/text-markup.js';
import { setAsDefaultStyle } from '../../core/preferences.js';
import { setTool } from '../../tools/manager.js';
import { alignAnnotations } from '../../annotations/smart-guides.js';
import { getSelectedText, clearTextSelection } from '../../text/text-selection.js';

function redraw() {
  if (state.viewMode === 'continuous') {
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
      <Show when={props.icon}>
        <span class="context-menu-icon" innerHTML={props.icon} />
      </Show>
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
      <Show when={props.icon}>
        <span class="context-menu-icon" innerHTML={props.icon} />
      </Show>
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
  const ann = () => targetAnnotation();
  const isLocked = () => ann()?.locked || false;
  const isLineType = () => ['line', 'arrow'].includes(ann()?.type);

  return (
    <>
      <MenuItem icon={openPopupIcon} label="Open Pop-Up Note" onClick={() => {
        const a = ann();
        if (a) { a.popupOpen = true; redraw(); }
      }} />
      <MenuItem icon={hidePopupIcon} label="Hide Pop-Up Note" onClick={() => {
        const a = ann();
        if (a) { a.popupOpen = false; redraw(); }
      }} />
      <MenuItem icon={resetPopupIcon} label="Reset Pop-Up Note Location" onClick={() => {
        const a = ann();
        if (a) { a.popupX = undefined; a.popupY = undefined; redraw(); }
      }} />

      <Separator />

      <Show when={['textbox', 'callout'].includes(ann()?.type)}>
        <MenuItem label="Edit Text..." disabled={isLocked()} onClick={() => startTextEditing(ann())} />
        <Separator />
      </Show>

      <MenuItem icon={cutIcon} label="Cut" shortcut="Ctrl+X" disabled={isLocked()} onClick={() => {
        const a = ann();
        copyAnnotation(a);
        const idx = state.annotations.indexOf(a);
        recordDelete(a, idx);
        state.annotations = state.annotations.filter(x => x !== a);
        hideProperties();
        redraw();
      }} />
      <MenuItem icon={copyIcon} label="Copy" shortcut="Ctrl+C" onClick={() => copyAnnotation(ann())} />
      <MenuItem icon={pasteIcon} label="Paste" shortcut="Ctrl+V" onClick={() => pasteFromClipboard()} />

      <Separator />

      <MenuItem icon={deleteIcon} label="Delete" shortcut="Delete" disabled={isLocked()} onClick={async () => {
        const a = ann();
        let confirmed = false;
        if (window.__TAURI__?.dialog?.ask) {
          confirmed = await window.__TAURI__.dialog.ask('Delete this annotation?', { title: 'Delete Annotation', kind: 'warning' });
        } else {
          confirmed = confirm('Delete this annotation?');
        }
        if (confirmed) {
          const idx = state.annotations.indexOf(a);
          recordDelete(a, idx);
          state.annotations = state.annotations.filter(x => x !== a);
          hideProperties();
          redraw();
        }
      }} />
      <MenuItem icon={flattenIcon} label="Flatten" disabled={isLocked()} onClick={() => {
        const a = ann();
        if (a) { a.flattened = true; redraw(); }
      }} />

      <Separator />

      <MenuItem icon={addReplyIcon} label="Add Reply" onClick={() => {
        const a = ann();
        if (a) {
          if (!a.replies) a.replies = [];
          a.replies.push({ author: state.preferences?.author || 'User', date: new Date().toISOString(), text: '' });
          a.popupOpen = true;
          redraw();
        }
      }} />

      <Separator />

      <MenuItem icon={lockedIcon} label="Locked" checkbox={true} checked={isLocked()} onClick={() => {
        const a = ann();
        if (a) {
          a.locked = !a.locked;
          a.modifiedAt = new Date().toISOString();
          if (state.selectedAnnotation === a) showProperties(a);
        }
      }} />
      <MenuItem icon={markedIcon} label="Marked" checkbox={true} checked={ann()?.marked || false} onClick={() => {
        const a = ann();
        if (a) { a.marked = !a.marked; a.modifiedAt = new Date().toISOString(); }
      }} />
      <MenuItem icon={printableIcon} label="Printable" checkbox={true} checked={ann()?.printable !== false} onClick={() => {
        const a = ann();
        if (a) { a.printable = a.printable === false; a.modifiedAt = new Date().toISOString(); }
      }} />

      <Separator />

      <Submenu icon={statusIcon} label="Status">
        <For each={['None', 'Accepted', 'Cancelled', 'Completed', 'Rejected']}>
          {(s) => (
            <MenuItem label={s} checkbox={true} checked={ann()?.status === s || (!ann()?.status && s === 'None')} onClick={() => {
              const a = ann();
              if (a) { a.status = s === 'None' ? undefined : s; a.modifiedAt = new Date().toISOString(); }
            }} />
          )}
        </For>
      </Submenu>
      <MenuItem icon={reviewHistoryIcon} label="Review History..." onClick={() => {
        const a = ann();
        if (a) showProperties(a);
      }} />

      <Separator />

      <Submenu icon={layerIcon} label={<>Layer: <span class="context-menu-value">None</span></>}>
        <MenuItem label="No layers available" disabled={true} />
      </Submenu>

      <Submenu icon={arrangeIcon} label="Arrange">
        <div class="arrange-icon-grid">
          <ArrangeButton svg={bringToFrontSvg} title="Bring to Front" onClick={() => bringToFront(ann())} />
          <ArrangeButton svg={sendToBackSvg} title="Send to Back" onClick={() => sendToBack(ann())} />
          <ArrangeButton svg={bringForwardSvg} title="Bring Forward" onClick={() => bringForward(ann())} />
          <ArrangeButton svg={sendBackwardSvg} title="Send Backward" onClick={() => sendBackward(ann())} />
        </div>
        <div class="arrange-icon-grid">
          <ArrangeButton svg={rotateLeftSvg} title="Rotate Left 90\u00B0" onClick={() => rotateAnnotation(ann(), -90)} />
          <ArrangeButton svg={rotateRightSvg} title="Rotate Right 90\u00B0" onClick={() => rotateAnnotation(ann(), 90)} />
          <ArrangeButton svg={flipHorizontalSvg} title="Flip Horizontal" onClick={() => flipHorizontal(ann())} />
          <ArrangeButton svg={flipVerticalSvg} title="Flip Vertical" onClick={() => flipVertical(ann())} />
        </div>
        <Separator />
        <MenuItem icon={transformIcon} label="Transform..." onClick={() => showProperties(ann())} />
        <MenuItem icon={duplicateIcon} label="Duplicate" onClick={() => {
          state.selectedAnnotation = ann();
          duplicateAnnotation();
        }} />
      </Submenu>

      <Separator />

      <Show when={isLineType()}>
        <MenuItem icon={flipLineIcon} label="Flip Line" onClick={() => {
          const a = ann();
          if (a) {
            const tmp = { x1: a.x1, y1: a.y1 };
            a.x1 = a.x2; a.y1 = a.y2;
            a.x2 = tmp.x1; a.y2 = tmp.y1;
            redraw();
          }
        }} />
        <Separator />
        <MenuItem icon={convertMeasurementIcon} label="Convert to Measurement" onClick={() => {
          const a = ann();
          if (a) { a.type = 'measureDistance'; a.modifiedAt = new Date().toISOString(); redraw(); }
        }} />
        <MenuItem icon={convertPolylineIcon} label="Convert to Polyline" onClick={() => {
          const a = ann();
          if (a) {
            a.type = 'polyline';
            a.points = [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }];
            a.modifiedAt = new Date().toISOString();
            redraw();
          }
        }} />
        <MenuItem icon={convertPolygonIcon} label="Convert to Polygon" onClick={() => {
          const a = ann();
          if (a) {
            a.type = 'polygon';
            a.points = [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }];
            a.modifiedAt = new Date().toISOString();
            redraw();
          }
        }} />
        <Separator />
      </Show>

      <Submenu icon={styleToolsIcon} label="Style Tools">
        <MenuItem label="Set as Default Style" onClick={() => setAsDefaultStyle(ann())} />
        <MenuItem label="Apply Default Style" onClick={() => {
          const a = ann();
          if (a) {
            const prefs = state.preferences;
            const prefix = a.type;
            if (prefs[prefix + 'StrokeColor']) a.strokeColor = prefs[prefix + 'StrokeColor'];
            if (prefs[prefix + 'FillColor']) a.fillColor = prefs[prefix + 'FillColor'];
            if (prefs[prefix + 'LineWidth']) a.lineWidth = prefs[prefix + 'LineWidth'];
            if (prefs[prefix + 'Opacity'] !== undefined) a.opacity = prefs[prefix + 'Opacity'] / 100;
            a.modifiedAt = new Date().toISOString();
            redraw();
          }
        }} />
      </Submenu>

      <Submenu icon={exportIcon} label="Export">
        <MenuItem label="Export as Image..." onClick={() => {
          const a = ann();
          if (a) showProperties(a);
        }} />
      </Submenu>

      <Separator />

      <MenuItem icon={propertiesIcon} label="Properties..." onClick={() => showProperties(ann())} />
    </>
  );
}

function MultiAnnotationMenuContent() {
  const count = () => multiSelectCount();

  return (
    <>
      <MenuItem icon={copyIcon} label={`Copy ${count()} Annotations`} onClick={() => {
        copyAnnotations(state.selectedAnnotations);
      }} />
      <MenuItem icon={cutIcon} label={`Cut ${count()} Annotations`} onClick={() => {
        copyAnnotations(state.selectedAnnotations);
        recordBulkDelete(state.selectedAnnotations);
        const toDelete = new Set(state.selectedAnnotations);
        state.annotations = state.annotations.filter(a => !toDelete.has(a));
        clearSelection();
        hideProperties();
        redraw();
      }} />

      <Separator />

      <MenuItem label="Bring All to Front" onClick={() => {
        for (const a of state.selectedAnnotations) bringToFront(a);
      }} />
      <MenuItem label="Send All to Back" onClick={() => {
        for (const a of [...state.selectedAnnotations].reverse()) sendToBack(a);
      }} />

      <Separator />

      <MenuItem label="Align Left" onClick={() => { alignAnnotations('left'); redraw(); }} />
      <MenuItem label="Align Right" onClick={() => { alignAnnotations('right'); redraw(); }} />
      <MenuItem label="Align Top" onClick={() => { alignAnnotations('top'); redraw(); }} />
      <MenuItem label="Align Bottom" onClick={() => { alignAnnotations('bottom'); redraw(); }} />
      <MenuItem label="Center Horizontally" onClick={() => { alignAnnotations('center'); redraw(); }} />
      <MenuItem label="Center Vertically" onClick={() => { alignAnnotations('middle'); redraw(); }} />

      <Show when={count() >= 3}>
        <MenuItem label="Distribute Horizontally" onClick={() => { alignAnnotations('distribute-h'); redraw(); }} />
        <MenuItem label="Distribute Vertically" onClick={() => { alignAnnotations('distribute-v'); redraw(); }} />
      </Show>

      <Separator />

      <MenuItem icon={deleteIcon} label={`Delete ${count()} Annotations`} onClick={async () => {
        let confirmed = false;
        if (window.__TAURI__?.dialog?.ask) {
          confirmed = await window.__TAURI__.dialog.ask(`Delete ${count()} annotations?`, { title: 'Delete Annotations', kind: 'warning' });
        } else {
          confirmed = confirm(`Delete ${count()} annotations?`);
        }
        if (confirmed) {
          recordBulkDelete(state.selectedAnnotations);
          const toDelete = new Set(state.selectedAnnotations);
          state.annotations = state.annotations.filter(a => !toDelete.has(a));
          clearSelection();
          hideProperties();
          redraw();
        }
      }} />
    </>
  );
}

function PageMenuContent() {
  const isCurrentTool = (tool) => state.currentTool === tool;

  return (
    <>
      <MenuItem icon={bookmarkIcon} label="Add Bookmark" shortcut="Ctrl+Shift+B" onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => {
          if (m.addBookmarkAtCurrentPage) m.addBookmarkAtCurrentPage();
        });
      }} />
      <MenuItem icon={stickyNoteIcon} label="Add Sticky Note" onClick={() => setTool('stickyNote')} />

      <Separator />

      <MenuItem icon={imageIcon} label="Add Image..." onClick={() => setTool('image')} />
      <MenuItem icon={qrCodeIcon} label="Add QR Code..." onClick={() => setTool('qrCode')} />

      <Separator />

      <MenuItem icon={handToolIcon} label="Hand Tool" checkbox={true} checked={isCurrentTool('hand')} onClick={() => setTool('hand')} />
      <MenuItem icon={snapshotIcon} label="Snapshot Tool" checkbox={true} checked={isCurrentTool('snapshot')} onClick={() => setTool('snapshot')} />
      <MenuItem icon={selectTextPageIcon} label="Select Text" checkbox={true} checked={isCurrentTool('selectText')} onClick={() => setTool('selectText')} />
      <MenuItem icon={zoomIcon} label="Zoom In/Out Tool" checkbox={true} checked={isCurrentTool('zoom')} onClick={() => setTool('zoom')} />

      <Separator />

      <MenuItem icon={pageCutIcon} label="Cut" shortcut="Ctrl+X" disabled={true} />
      <MenuItem icon={pageCopyIcon} label="Copy" shortcut="Ctrl+C" disabled={true} />
      <MenuItem icon={pagePasteIcon} label="Paste" shortcut="Ctrl+V" onClick={() => pasteFromClipboard()} disabled={!state.clipboardAnnotation && !navigator.clipboard} />

      <Separator />

      <MenuItem icon={pageDeleteIcon} label="Delete" shortcut="Delete" disabled={true} />

      <Separator />

      <MenuItem icon={selectAllIcon} label="Select" onClick={() => setTool('select')} />
      <MenuItem icon={deselectIcon} label="Deselect" onClick={() => clearSelection()} />

      <Separator />

      <Submenu icon={goToIcon} label="Go To">
        <MenuItem label="First Page" onClick={() => {
          import('../../pdf/renderer.js').then(m => m.renderPage && m.renderPage(1));
        }} />
        <MenuItem label="Last Page" onClick={() => {
          import('../../pdf/renderer.js').then(m => {
            if (state.pdfDoc && m.renderPage) m.renderPage(state.pdfDoc.numPages);
          });
        }} />
        <MenuItem label="Previous Page" onClick={() => {
          import('../../pdf/renderer.js').then(m => {
            if (state.currentPage > 1 && m.renderPage) m.renderPage(state.currentPage - 1);
          });
        }} />
        <MenuItem label="Next Page" onClick={() => {
          import('../../pdf/renderer.js').then(m => {
            if (state.pdfDoc && state.currentPage < state.pdfDoc.numPages && m.renderPage) m.renderPage(state.currentPage + 1);
          });
        }} />
      </Submenu>

      <Separator />

      <MenuItem icon={printIcon} label="Print..." shortcut="Ctrl+P" onClick={() => {
        import('../stores/dialogStore.js').then(m => m.openDialog('print'));
      }} />
      <MenuItem icon={findIcon} label="Find..." shortcut="Ctrl+F" onClick={() => {
        const findBar = document.getElementById('find-bar');
        const findInput = document.getElementById('find-input');
        if (findBar) { findBar.style.display = 'flex'; if (findInput) findInput.focus(); }
      }} />
      <MenuItem icon={searchIcon} label="Search..." shortcut="Ctrl+Shift+F" onClick={() => {
        const findBar = document.getElementById('find-bar');
        const findInput = document.getElementById('find-input');
        if (findBar) { findBar.style.display = 'flex'; if (findInput) findInput.focus(); }
      }} />

      <Separator />

      <MenuItem icon={propertiesIcon} label="Properties..." onClick={() => {
        import('../stores/dialogStore.js').then(m => m.openDialog('doc-properties'));
      }} />
    </>
  );
}

function BookmarkMenuContent() {
  return (
    <>
      <MenuItem label="Add Bookmark" onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.addBookmark());
      }} />
      <MenuItem label="Add Child Bookmark" onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.addChildBookmark());
      }} />
      <Separator />
      <MenuItem label="Edit Bookmark" onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.editBookmark());
      }} />
      <MenuItem label="Delete Bookmark" onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.deleteBookmark());
      }} />
      <Separator />
      <MenuItem label="Expand All" onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.expandAll());
      }} />
      <MenuItem label="Collapse All" onClick={() => {
        import('../../ui/panels/bookmarks.js').then(m => m.collapseAll());
      }} />
    </>
  );
}

function ThumbnailMenuContent() {
  const pageNum = () => targetPage();

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

  return (
    <>
      <MenuItem icon={thumbnailCutIcon} label="Cut" onClick={async () => {
        const { cutPage } = await import('../../pdf/page-manager.js');
        await cutPage(pageNum());
      }} disabled={state.pdfDoc?.numPages <= 1} />
      <MenuItem icon={thumbnailCopyIcon} label="Copy" onClick={async () => {
        const { copyPage } = await import('../../pdf/page-manager.js');
        await copyPage(pageNum());
      }} />
      <MenuItem icon={thumbnailPasteIcon} label="Paste" onClick={async () => {
        const { pastePage } = await import('../../pdf/page-manager.js');
        await pastePage(pageNum());
      }} />

      <Separator />

      <MenuItem icon={thumbnailRotateLeftIcon} label="Rotate Left" onClick={async () => {
        const { rotatePage } = await import('../../pdf/renderer.js');
        await rotatePage(-90, pageNum());
      }} />
      <MenuItem icon={thumbnailRotateRightIcon} label="Rotate Right" onClick={async () => {
        const { rotatePage } = await import('../../pdf/renderer.js');
        await rotatePage(90, pageNum());
      }} />

      <Separator />

      <MenuItem icon={thumbnailInsertIcon} label="Insert Pages..." onClick={() => {
        import('../../ui/chrome/dialogs.js').then(m => m.showInsertPageDialog());
      }} />
      <MenuItem icon={thumbnailExtractIcon} label="Extract Pages..." onClick={() => {
        import('../../ui/chrome/dialogs.js').then(m => m.showExtractPagesDialog());
      }} />
      <MenuItem icon={thumbnailReplaceIcon} label="Replace Pages..." onClick={async () => {
        const { replacePages } = await import('../../pdf/page-manager.js');
        replacePages(pageNum());
      }} />
      <MenuItem icon={thumbnailDeleteIcon} label="Delete Pages" disabled={state.pdfDoc?.numPages <= 1} onClick={async () => {
        const confirmed = await window.__TAURI__?.dialog?.ask(`Delete page ${pageNum()}?`, { title: 'Delete Page', kind: 'warning' });
        if (confirmed) {
          const { deletePages } = await import('../../pdf/page-manager.js');
          await deletePages([pageNum()]);
        }
      }} />

      <Separator />

      <MenuItem icon={thumbnailPropertiesIcon} label="Properties" onClick={async () => {
        const { showPageProperties } = await import('../../ui/panels/left-panel.js');
        await showPageProperties(pageNum());
      }} />
    </>
  );
}

function TextSelectionMenuContent() {
  return (
    <>
      <MenuItem icon={copyIcon} label="Copy" onClick={async () => {
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

      <MenuItem label="Highlight Selection" onClick={() => {
        createTextMarkupAnnotation('textHighlight', '#FFFF00', 0.3);
        clearTextSelection();
      }} />
      <MenuItem label="Strikethrough Selection" onClick={() => {
        createTextMarkupAnnotation('textStrikethrough', '#FF0000', 1.0);
        clearTextSelection();
      }} />
      <MenuItem label="Underline Selection" onClick={() => {
        createTextMarkupAnnotation('textUnderline', '#0000FF', 1.0);
        clearTextSelection();
      }} />
    </>
  );
}

export default function ContextMenu() {
  let menuRef;

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

  const handleOutsideClick = (e) => {
    if (visible() && menuRef && !menuRef.contains(e.target)) {
      hideMenu();
    }
  };

  const handleEscape = (e) => {
    if (e.key === 'Escape' && visible()) {
      hideMenu();
    }
  };

  onMount(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
  });

  onCleanup(() => {
    document.removeEventListener('mousedown', handleOutsideClick);
    document.removeEventListener('keydown', handleEscape);
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

import { state, getActiveDocument, selectAllOnPage, clearSelection } from '../core/state.js';
import { undo, redo, recordAdd, recordBulkDelete, recordDelete, recordModify, recordBulkModify, recordClearPage } from '../core/undo-manager.js';
import { setTool } from './manager.js';
import { showPreferencesDialog, setAsDefaultStyle } from '../core/preferences.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { copyAndMove } from './edit-ops.js';
import { showDocPropertiesDialog, showNewDocDialog } from '../ui/chrome/dialogs.js';
import { copyAnnotation, copyAnnotations, pasteAnnotation, pasteAnnotations } from '../annotations/clipboard.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { applyMove } from '../annotations/transforms.js';
import { createMeasureAreaAnnotation, createMeasurePerimeterAnnotation } from './annotation-creators.js';
import { openPDFFile, isPdfAReadOnly } from '../pdf/loader.js';
import { actualSize, fitWidth, fitPage, goToPage } from '../pdf/renderer.js';
import { activeTab } from '../solid/stores/leftPanelStore.js';
import { savePDF, savePDFAs } from '../pdf/saver.js';
import { toggleAnnotationsListPanel } from '../ui/panels/annotations-list.js';
import { toggleLeftPanel } from '../ui/panels/left-panel.js';
import { switchRibbonTab as switchToTab } from '../bridge.js';
import { openFindBar, closeFindBar, onFindNext } from '../search/find-bar.js';
import { closeActiveTab } from '../ui/chrome/tabs.js';
import { hideProperties, showProperties, showMultiSelectionProperties, togglePropertiesPanel } from '../ui/panels/properties-panel.js';
import { openDialog, getDialogs } from '../bridge.js';
import { getTool } from './tool-registry.js';
import { resolvePointerCoords, buildToolContext, isModalOpen } from './tool-context.js';
import { tryStartGMove, isGMoveModeActive } from './g-move-mode.js';
import { tryStartGRotate, isGRotateModeActive } from './g-rotate-mode.js';
import { toggleFullscreen, exitFullscreen, getFullscreenState } from '../ui/chrome/fullscreen.js';
import { typeLengthActive, consumeKey as typeLengthConsumeKey, typeLengthCursor } from './type-length-input.js';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// Live preview while TYPING a measurement: re-fire the normal pointermove
// pipeline at the last known cursor position so the active tool re-renders
// its rubber-band with the new constrained length ("5" → "50" → "500" grows
// on screen as you type). One generic mechanism for every tool — line,
// arrow, dimension, area, hatch area, polyline — no per-tool preview code.
function _refreshTypeLengthPreview(srcEvent) {
  try {
    const pos = typeLengthCursor();
    if (!pos || (pos.x === 0 && pos.y === 0)) { redraw(); return; }
    let target = document.elementFromPoint(pos.x, pos.y);
    target = target && target.closest
      ? (target.closest('#annotation-canvas') || target.closest('.annotation-canvas'))
      : null;
    if (!target) target = document.getElementById('annotation-canvas');
    if (!target) { redraw(); return; }
    const ev = new PointerEvent('pointermove', {
      clientX: pos.x,
      clientY: pos.y,
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
      shiftKey: !!srcEvent?.shiftKey,
      ctrlKey: !!srcEvent?.ctrlKey,
      altKey: !!srcEvent?.altKey,
    });
    target.dispatchEvent(ev);
  } catch (_) {
    redraw();
  }
}

// ── Escape → tool-afronding (GitHub #273) ─────────────────────────────────
// Bouw een VOLWAARDIGE tool-context voor de Escape-afhandeling, zodat een
// tool zijn onEscape-hook met exact dezelfde context kan draaien als de
// rechtermuisklik-afronding in de dispatcher (createAnnotation, recordAdd,
// createMeasureAreaAnnotation, redraw, ...). De coördinaten komen van de
// laatst bekende cursorpositie (typeLengthCursor-tracker); de afrondroutines
// gebruiken die niet voor het committen zelf.
function _buildEscapeToolContext() {
  try {
    const pos = typeLengthCursor();
    let target = null;
    if (pos && (pos.x || pos.y) && document.elementFromPoint) {
      const el = document.elementFromPoint(pos.x, pos.y);
      target = el && el.closest
        ? (el.closest('#annotation-canvas') || el.closest('.annotation-canvas'))
        : null;
    }
    if (!target) {
      target = document.getElementById('annotation-canvas')
        || document.querySelector('.annotation-canvas');
    }
    if (!target) return null;
    const fakeEvent = {
      clientX: pos ? pos.x : 0,
      clientY: pos ? pos.y : 0,
      button: 2,
      detail: 0,
      target,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      preventDefault() {}, stopPropagation() {},
    };
    const coords = resolvePointerCoords(fakeEvent);
    return buildToolContext(fakeEvent, coords);
  } catch (_) {
    return null;
  }
}

// ── CAD-style two-letter command chords (AutoCAD-style command line) ──
// Map of command → action. Two-letter codes win over one-letter codes; if a
// one-letter prefix is also a valid command, the timeout fires it after CHORD_MS.
const CAD_CHORDS = {
  'tr': () => setTool('trim'),
  'ex': () => setTool('extend'),
  'tx': () => setTool('textbox'),
  'cs': () => createSimilarFromSelection(),
  // 'mv' = Move: same engine as the G key, but AutoCAD-style — first click
  // picks the (object-snapped) BASE point, second click drops. ALL
  // interactive moving funnels through g-move-mode.js (one move session,
  // applyMove as the single per-type primitive).
  'mv': () => tryStartGMove({ basePoint: true }),
  // 'tl' = Toggle Lineweight display (CAD LWDISPLAY): draw everything with a
  // max 1pt hairline instead of true widths. Pure display toggle —
  // annotation lineWidth values stay untouched.
  'tl': () => {
    state.preferences.thinLines = !state.preferences.thinLines;
    // '[render]' prefix lands in the MCP console ring → observable in tests.
    console.log('[render] thinLines =', state.preferences.thinLines);
    import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
    redraw();
  },
  // 'co' = Copy: duplicate + move via the EDIT-OPS layer (edit-ops.js) —
  // the one place where target resolution, cloning and the move session
  // live. Never reimplement copying per-tool or per-type.
  'co': () => copyAndMove(),
  // 'ro' = Rotate: interactive rotate session around the joint selection
  // centre (g-rotate-mode.js — applyRotateGeneric as the single per-type
  // primitive, same walker tables as move). Shift = angle snap.
  'ro': () => tryStartGRotate(),
  // Reserved for future: 'l' line, 'c' circle, 'mi' mirror, 'ar' array, etc.
};

// "CS" — Create Similar (BricsCAD-style): take the selected annotation,
// persist its style as the default for its type, and activate the tool that
// draws that type. The next annotation the user draws comes out identical in
// style to the selected one. Works for every annotation type that has a
// matching tool (which is all built-ins: annotation.type === tool name).
function createSimilarFromSelection() {
  const doc = getActiveDocument();
  const selArr = doc?.selectedAnnotations || [];
  const sel = selArr.length >= 1 ? selArr[0] : (doc?.selectedAnnotation || null);
  if (!sel) return; // nothing selected → no-op

  // Style of the selected annotation becomes the tool default for its type
  // (same mechanism as the context-menu "Set as Default Style").
  try { setAsDefaultStyle(sel); } catch (_) {}

  // Walls carry their material + thickness through toolOverrides (the same
  // channel the palette uses) so the NEXT wall comes out identical.
  if (sel.type === 'wall') {
    state.toolOverrides = {
      wallPattern: sel.hatchPattern || 'nen47-metselwerk-baksteen',
      wallDikteMm: sel.dikteMm || 100,
      wallIsolatieType: sel.isolatieType,
    };
  }

  // Built-in annotation types share their tool's name; plugin types resolve
  // via the annotation-type registry (the dispatcher handles those tools).
  const toolName = sel.type;
  if (getTool(toolName) || getAnnotationType(toolName)) {
    setTool(toolName);
  }
}
const CHORD_MS = 1200;
let _chordBuffer = '';
let _chordTimer = null;

function _resetChord() {
  _chordBuffer = '';
  if (_chordTimer) { clearTimeout(_chordTimer); _chordTimer = null; }
}

// Returns true if the keystroke was consumed by the chord system.
function _cadChordTry(letter) {
  // Skip if a single-key tool shortcut would handle this letter alone (G is
  // already returned-on earlier; A toggles arc-mode; Esc/Tab handled separately).
  if (letter === 'g' || letter === 'a') return false;

  const next = _chordBuffer + letter;

  // Exact match (multi-letter): fire and clear.
  if (CAD_CHORDS[next]) {
    _resetChord();
    try { CAD_CHORDS[next](); } catch (_) {}
    return true;
  }

  // Prefix of some longer chord? Buffer and wait.
  const isPrefix = Object.keys(CAD_CHORDS).some(k => k.startsWith(next) && k !== next);
  if (isPrefix) {
    _chordBuffer = next;
    if (_chordTimer) clearTimeout(_chordTimer);
    _chordTimer = setTimeout(() => {
      // Timeout: if the buffer itself is a valid (single-letter) command, fire it.
      if (CAD_CHORDS[_chordBuffer]) {
        try { CAD_CHORDS[_chordBuffer](); } catch (_) {}
      }
      _resetChord();
    }, CHORD_MS);
    return true;
  }

  // No match and not a prefix → reset and let the keystroke fall through.
  _resetChord();
  return false;
}

// Handle keydown events
export async function handleKeydown(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const shortcutKey = typeof e.key === 'string' ? e.key.toLowerCase() : '';

  // Allow certain shortcuts even when in input fields
  const isInInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  const isFindInput = e.target.id === 'find-input';

  // Keep Select All scoped to an active text-edit session, even when focus
  // temporarily moved to the properties panel or the document itself.
  if (ctrl && !shift && !e.altKey && shortcutKey === 'a'
      && (state.isEditingText || state.pdfTextEditState)) {
    const editor = document.querySelector('.inline-text-editor, .pdf-text-editor');
    if (editor && typeof editor.select === 'function') {
      e.preventDefault();
      e.stopPropagation();
      editor.focus();
      editor.select();
      return;
    }
  }

  // Handle find-related shortcuts even in inputs
  if (ctrl && e.key === 'f') {
    e.preventDefault();
    openFindBar();
    return;
  }



  if (e.key === 'F3' && !isFindInput) {
    e.preventDefault();
    if (e.shiftKey) {
      // Shift+F3: toggle master Object Snap (OSNAP) setting
      try {
        state.preferences.enableObjectSnap = !state.preferences.enableObjectSnap;
        import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
      } catch (_) {}
      return;
    }
    if (state.search.isOpen) {
      onFindNext();
    } else {
      openFindBar();
    }
    return;
  }

  // Skip other shortcuts if typing in an input field (except find input which handles its own keys)
  if (isInInput && !isFindInput) {
    return;
  }

  // Type-length capture (CAD-style "type length"). Active when a tool that
  // supports it has called enterTypeLengthMode after committing the start
  // point. We forward digits / '.' / ',' / Backspace / Enter / Escape to the
  // capture module. Enter triggers the active tool's _typeLengthCommit hook
  // (set by the tool when it activates the mode).
  if (typeLengthActive()) {
    const result = typeLengthConsumeKey(e.key);
    if (result.handled) {
      e.preventDefault();
      if (result.committed && typeof state._typeLengthCommit === 'function') {
        state._typeLengthCommit(result.length);
      } else {
        // Buffer changed → re-run the tool's preview at the current cursor so
        // the rubber-band live-updates to the typed length while typing.
        _refreshTypeLengthPreview(e);
      }
      return;
    }
  }

  // A — in edit-contour mode, toggle "next inserted vertex is an arc vertex"
  // flag. The flag is consumed (reset) by select-tool.js when an edge-midpoint
  // click inserts a new vertex.
  if ((e.key === 'a' || e.key === 'A') && !ctrl && !e.altKey && !shift && state.editingContour) {
    e.preventDefault();
    state._editArcMode = !state._editArcMode;
    redraw();
    return;
  }

  // Tab — toggle "edit contour" mode for a single selected filledArea annotation
  if (e.key === 'Tab' && !ctrl && !e.altKey) {
    const _doc = getActiveDocument();
    const _sel = _doc ? _doc.selectedAnnotations : [];
    if (_sel.length === 1 && _sel[0].type === 'filledArea') {
      e.preventDefault();
      if (state.editingContour === _sel[0].id) {
        state.editingContour = null;
        state._editArcMode = false;
      } else {
        state.editingContour = _sel[0].id;
      }
      redraw();
      return;
    }
  }

  // G-key Blender-style move mode (issue #210) — only trigger when not already
  // in G-mode (g-move-mode.js intercepts subsequent keys at capture phase).
  if (!ctrl && !shift && !e.altKey && !isGMoveModeActive() && !isGRotateModeActive() && (e.key === 'g' || e.key === 'G')) {
    if (tryStartGMove()) {
      e.preventDefault();
      return;
    }
  }

  // CAD-style two-letter command chords (AutoCAD-style: "TR"=Trim, "EX"=Extend,
  // "L"=Line, "C"=Circle, "M"=Move, "CO"=Copy, "TR"=Trim, "EX"=Extend, ...).
  // Buffer alphabetic keys for ~1.2s; on each keystroke check for a match.
  // No modifier keys (ctrl/alt) and not while a tool is mid-operation.
  if (!ctrl && !e.altKey && /^[a-zA-Z]$/.test(e.key) && !isGMoveModeActive() && !isGRotateModeActive() && !typeLengthActive()) {
    if (_cadChordTry(e.key.toLowerCase())) {
      e.preventDefault();
      return;
    }
  }

  // Find input handles Enter, Shift+Enter, and Escape internally
  if (isFindInput) {
    return;
  }

  // Delegate keydown to active tool (e.g. arc mode toggle for measureArea)
  const _activeTool = getTool(state.currentTool);
  if (_activeTool && _activeTool.onKeyDown) {
    // Build a minimal context for tool key handlers
    const _keyCtx = { state, redraw };
    _activeTool.onKeyDown(_keyCtx, e);
    if (e.defaultPrevented) return;
  }

  // Enter key - complete area/perimeter measurement
  if (e.key === 'Enter' && state.measurePoints && state.measurePoints.length >= 2) {
    e.preventDefault();
    const points = [...state.measurePoints];
    let ann;
    if (state.currentTool === 'measureArea' && points.length >= 3) {
      ann = createMeasureAreaAnnotation(points);
    } else if (state.currentTool === 'measurePerimeter' && points.length >= 2) {
      ann = createMeasurePerimeterAnnotation(points);
    }
    if (ann) {
      const doc = getActiveDocument();
      if (doc) doc.annotations.push(ann);
      recordAdd(ann);
    }
    state.measurePoints = null;
    redraw();
    return;
  }

  // File shortcuts
  if (ctrl && e.key === 'n') {
    e.preventDefault();
    showNewDocDialog();
  } else if (ctrl && e.key === 'o') {
    e.preventDefault();
    openPDFFile();
  } else if (ctrl && shift && e.key === 'S') {
    e.preventDefault();
    savePDFAs();
  } else if (ctrl && e.key === 's') {
    e.preventDefault();
    savePDF();
  } else if (ctrl && e.key === 'w') {
    e.preventDefault();
    closeActiveTab();
  }
  // Ctrl+P is intercepted earlier in the capture phase (main.js
  // disableBrowserShortcuts) so it can suppress WebView2's native print
  // dialog; handling it here as well would open ours twice.

  // Edit shortcuts
  else if (ctrl && !shift && shortcutKey === 'z') {
    e.preventDefault();
    undo();
  } else if (ctrl && shortcutKey === 'y') {
    e.preventDefault();
    redo();
  } else if (ctrl && shift && shortcutKey === 'z') {
    e.preventDefault();
    redo();
  } else if (ctrl && !shift && e.key === 'a') {
    // Ctrl+A: Select all annotations on current page
    e.preventDefault();
    const _selDoc = getActiveDocument();
    if (_selDoc?.pdfDoc) {
      selectAllOnPage();
      const _selAnns = _selDoc.selectedAnnotations;
      if (_selAnns.length === 1) {
        showProperties(_selAnns[0]);
      } else if (_selAnns.length > 1) {
        showMultiSelectionProperties();
      }
      redraw();
    }
  } else if (e.key === 'Delete') {
    e.preventDefault();
    if (isPdfAReadOnly()) { /* block */ }
    else if ((getActiveDocument()?.selectedAnnotations || []).length > 0) {
      const selected = [...getActiveDocument().selectedAnnotations];
      // Single locked check
      if (selected.length === 1 && selected[0].locked) return;

      // Confirmation dialog
      {
        const { showConfirm } = await import('../ui/chrome/confirm-dialog.js');
        const msg = selected.length > 1
          ? `Delete ${selected.length} annotations?`
          : 'Delete this annotation?';
        const title = selected.length > 1 ? 'Delete Annotations' : 'Delete Annotation';
        const confirmed = await showConfirm({ title, message: msg, preferenceKey: 'confirmBeforeDelete' });
        if (!confirmed) return;
      }

      const doc = getActiveDocument();
      if (selected.length > 1) {
        recordBulkDelete(selected);
      } else {
        recordDelete(selected[0], (doc?.annotations || []).indexOf(selected[0]));
      }
      const toDelete = new Set(selected);
      if (doc) doc.annotations = doc.annotations.filter(a => !toDelete.has(a));
      clearSelection();
      hideProperties();
      redraw();
    }
  }
  // Arrow keys: nudge selected annotations (skip when Ctrl held)
  else if (!ctrl && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (isPdfAReadOnly()) { /* block nudge */ }
    else if ((getActiveDocument()?.selectedAnnotations || []).length > 0 && getActiveDocument()?.pdfDoc) {
      // Text markup annotations are anchored to text — skip nudge
      const movable = getActiveDocument().selectedAnnotations.filter(a =>
        !['textHighlight', 'textStrikethrough', 'textUnderline'].includes(a.type));
      if (movable.length === 0) return;

      e.preventDefault();
      const nudgeDoc = getActiveDocument();
      const step = (shift ? 10 : 1) / (nudgeDoc?.scale || 1);
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;

      if (movable.length > 1) {
        const originals = movable.map(a => ({ ...a }));
        for (const ann of movable) applyMove(ann, dx, dy);
        recordBulkModify(movable, originals);
      } else {
        const original = { ...movable[0] };
        applyMove(movable[0], dx, dy);
        recordModify(movable[0].id, original, movable[0]);
      }
      redraw();
    }
    // Inhoudsopgave (TOC / bladwijzers) actief → met pijl omhoog/omlaag pagina-voor-
    // pagina door het document lopen i.p.v. de bladwijzerlijst te scrollen (GitHub #248).
    // Draait alleen als de nudge de toets niet al gebruikte (geen selectie) — ook read-only.
    if (!e.defaultPrevented && (e.key === 'ArrowDown' || e.key === 'ArrowUp')
        && ['thumbnails', 'bookmarks'].includes(activeTab())
        && !['INPUT', 'TEXTAREA'].includes(e.target?.tagName) && !e.target?.isContentEditable) {
      e.preventDefault();
      const navDoc = getActiveDocument();
      if (navDoc?.pdfDoc) {
        const total = navDoc.pdfDoc.numPages || 1;
        const cur = navDoc.currentPage || 1;
        const next = e.key === 'ArrowDown' ? Math.min(total, cur + 1) : Math.max(1, cur - 1);
        if (next !== cur) goToPage(next);
      }
    }
  }

  else if (ctrl && shift && e.key === 'C') {
    e.preventDefault();
    let confirmed = false;
    if (window.__TAURI__?.dialog?.ask) {
      confirmed = await window.__TAURI__.dialog.ask('Clear all annotations on current page?', { title: 'Clear Page', kind: 'warning' });
    } else {
      confirmed = confirm('Clear all annotations on current page?');
    }
    if (confirmed) {
      const cpDoc = getActiveDocument();
      const cpPage = cpDoc ? cpDoc.currentPage : 1;
      recordClearPage(cpPage, cpDoc?.annotations || []);
      if (cpDoc) cpDoc.annotations = cpDoc.annotations.filter(a => a.page !== cpPage);
      hideProperties();
      redraw();
    }
  } else if (ctrl && !shift && e.key === 'c') {
    // Copy selected annotations (if none selected, let native copy handle text selection)
    const _copyDoc = getActiveDocument();
    const selected = _copyDoc ? _copyDoc.selectedAnnotations : [];
    if (selected.length > 0) {
      e.preventDefault();
      if (selected.length > 1) copyAnnotations(selected);
      else copyAnnotation(selected[0]);
    }
  } else if (ctrl && shift && (e.key === 'V' || e.key === 'v')) {
    // Plakken op plaats (paste in place) — GitHub #269: plak het interne
    // clipboard op de HUIDIGE pagina op exact de gekopieerde coördinaten.
    // preventDefault mag hier wél — dit pad gebruikt alleen het interne
    // annotatie-clipboard, geen native paste-event.
    e.preventDefault();
    if (!getActiveDocument()?.pdfDoc) return;
    if (isPdfAReadOnly()) return;
    import('../annotations/clipboard.js').then(({ pasteAnnotationsInPlace }) => pasteAnnotationsInPlace());
  } else if (ctrl && !shift && e.key === 'v') {
    // An annotation copied inside the app must be pasted directly. Asking the
    // native Clipboard API first can open a WebView permission prompt and
    // indefinitely postpone the internal paste (notably for line annotations).
    const internalClips = state.clipboardAnnotations;
    if ((internalClips && internalClips.length > 0) || state.clipboardAnnotation) {
      e.preventDefault();
      if (!getActiveDocument()?.pdfDoc) return;
      if (isPdfAReadOnly()) return;
      if (internalClips && internalClips.length > 1) pasteAnnotations();
      else pasteAnnotation();
      return;
    }
    // Don't preventDefault — let native paste event fire so handlePaste can
    // read clipboardData.items (required on Linux/WebKitGTK where the async
    // Clipboard API is unavailable).
    //
    // Fallback: in some Tauri webview contexts the native 'paste' event does
    // not fire when no editable element has focus (canvas focused, or no focus
    // at all). Schedule a deferred check — if the native handler did not run,
    // try the async Clipboard API for image data, then fall back to the
    // internal annotation clipboard.
    const beforeMark = state._lastNativePasteAt || 0;
    setTimeout(async () => {
      const afterMark = state._lastNativePasteAt || 0;
      if (afterMark > beforeMark) return; // native paste already handled
      if (!getActiveDocument()?.pdfDoc) return;
      if (isPdfAReadOnly()) return;
      // Try async Clipboard API for image data
      let handledImage = false;
      try {
        if (navigator.clipboard?.read) {
          const items = await navigator.clipboard.read();
          for (const it of items) {
            const imgType = it.types.find(t => t.startsWith('image/'));
            if (imgType) {
              const blob = await it.getType(imgType);
              const { pasteImageFromBlob } = await import('../annotations/clipboard.js');
              await pasteImageFromBlob(blob);
              handledImage = true;
              break;
            }
          }
        }
      } catch (_) { /* permission denied or no focus — fall through */ }
      if (handledImage) return;
      // No image — fall back to internal annotation clipboard
      const { pasteAnnotation, pasteAnnotations } = await import('../annotations/clipboard.js');
      const clips = state.clipboardAnnotations;
      if (clips && clips.length > 1) pasteAnnotations();
      else if ((clips && clips.length === 1) || state.clipboardAnnotation) pasteAnnotation();
    }, 50);
  } else if (ctrl && e.key === ',') {
    e.preventDefault();
    showPreferencesDialog();
  } else if (ctrl && e.key === 'd') {
    e.preventDefault();
    showDocPropertiesDialog();
  } else if (ctrl && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault();
    toggleFullscreen();
  }

  // ── ESC — prioriteitsladder (GitHub #273) ────────────────────────────────
  // 1. Open dialoog/overlay/editor → die context handelt Escape zelf af
  //    (Dialog.jsx, app-menu, crop-overlay, Edit-Type, CompareView). Geen
  //    tool-wissel, geen selectie-reset.
  // 2. Actieve tekening/bewerking → afronden zoals de rechtermuisklik dat
  //    doet (tool.onEscape → zelfde afrondroutines), daarna selectietool.
  // 3. Teken-tool actief zonder actieve tekening → selectietool.
  // 4. Selectietool actief → selectie legen (bestaand gedrag).
  else if (e.key === 'Escape') {
    // Trede 1: modale dialogen (vanilla overlays + Solid dialogStore), de
    // Edit-Type-editor en de crop-modus handelen Escape volledig zelf af.
    if (isModalOpen()
        || (typeof getDialogs === 'function' && (getDialogs() || []).length > 0)
        || state.imageCropMode
        || document.querySelector('.ste-overlay')) {
      return;
    }
    e.preventDefault();
    // End an in-progress text edit (commit the typed text) and return to the
    // select tool — Esc as an alternative to right-click / clicking away.
    if (state.isEditingText) {
      import('./text-editing.js').then(m => { m.finishTextEditing(); setTool('select'); });
      return;
    }
    // Cancel an in-progress grip-stretch / resize: restore the original
    // annotation snapshot and exit resize mode without recording undo.
    if (state.isResizing && state.originalAnnotation) {
      const _doc = getActiveDocument();
      const _sel = _doc ? _doc.selectedAnnotations : [];
      const ann = _sel.length === 1 ? _sel[0] : null;
      if (ann) {
        // Restore annotation to its pre-stretch state
        Object.assign(ann, state.originalAnnotation);
      }
      state.isResizing = false;
      state.isDragging = false;
      state.activeHandle = null;
      state.originalAnnotation = null;
      state.originalAnnotations = [];
      state._editContourBefore = null;
      state.lastSnapResult = null;
      state.dragCursor = null;
      redraw();
      return;
    }
    // Exit fullscreen first if active
    if (getFullscreenState()) {
      exitFullscreen();
      return;
    }
    // First check if find bar is open
    if (state.search.isOpen) {
      closeFindBar();
      return;
    }
    // Exit edit-contour mode if active
    if (state.editingContour) {
      state.editingContour = null;
      state._editArcMode = false;
      redraw();
      return;
    }
    // Trede 2: actieve tekening/bewerking van de huidige tool → afronden of
    // annuleren via de tool's onEscape-hook. Elke hook roept EXACT dezelfde
    // afrondroutine aan als de rechtermuisklik-tak van die tool (polyline/
    // spline/wolk/meting committen punten-tot-nu-toe; lijn/dimensie/hoek/
    // kalibratie/schaalgebied annuleren). Daarna valt de flow door naar de
    // selectietool-wissel onderaan. Plugin-polylijnen mappen op de native
    // polyline-tool, zelfde mapping als de dispatcher.
    let escTool = getTool(state.currentTool);
    if (!escTool && getAnnotationType(state.currentTool)?.drawMode === 'polyline') {
      escTool = getTool('polyline');
    }
    if (escTool && typeof escTool.onEscape === 'function') {
      const escCtx = _buildEscapeToolContext();
      if (escCtx) {
        try { escTool.onEscape(escCtx, e); }
        catch (err) { console.error('[keyboard] tool onEscape error', err); }
      }
    }
    // Vangnet voor tools zonder onEscape-hook: ruim bekende teken-state op
    // (zelfde opruiming als voorheen), maar val daarna door naar de
    // selectietool-wissel in plaats van hier te stoppen.
    if (state.isDrawingDimension) {
      state.dimPoints = [];
      state.isDrawingDimension = false;
      redraw();
    }
    if (state.measurePoints) {
      state.measurePoints = null;
      redraw();
    }
    // Always clear any lingering polar anchor on Escape
    import('./snap-engine.js').then(m => m.clearPolarAnchor && m.clearPolarAnchor()).catch(() => {});
    // ESC always jumps to the select tool, regardless of whether
    // annotations are selected. Selection is also cleared in the same
    // gesture (so a second ESC isn't needed). Ribbon tab stays put.
    if ((getActiveDocument()?.selectedAnnotations || []).length > 0) {
      clearSelection();
      hideProperties();
      redraw();
    }
    setTool('select');
    // Arm the marquee so a drag immediately after Escape starts a
    // cross-selection (even when it begins on an element), mirroring the
    // Select ribbon button. Consumed on the next pointerdown in select-tool.
    state.armedMarquee = true;
  }

  // View shortcuts
  else if (ctrl && e.key === '=') {
    e.preventDefault();
    import('../pdf/renderer.js').then(m => m.zoomIn());
  } else if (ctrl && e.key === '-') {
    e.preventDefault();
    import('../pdf/renderer.js').then(m => m.zoomOut());
  } else if (ctrl && e.key === '0') {
    e.preventDefault();
    actualSize();
  } else if (ctrl && e.key === '1') {
    e.preventDefault();
    fitWidth();
  } else if (ctrl && e.key === '2') {
    e.preventDefault();
    fitPage();
  } else if (ctrl && e.key === '5') {
    e.preventDefault();
    state.preferences.thinLines = !state.preferences.thinLines;
    if (getActiveDocument()?.pdfDoc) {
      if (getActiveDocument()?.viewMode === 'continuous') {
        import('../pdf/renderer.js').then(m => m.renderContinuous());
      } else {
        import('../pdf/renderer.js').then(m => m.renderPage(getActiveDocument()?.currentPage || 1));
      }
    }
  }

  // Tool shortcuts (only if PDF is loaded)
  else if (getActiveDocument()?.pdfDoc) {
    const pdfaLocked = isPdfAReadOnly();
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      setTool('select');
    } else if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      setTool('hand');
    } else if (!pdfaLocked && (e.key === '1')) {
      e.preventDefault();
      setTool('highlight');
    } else if (!pdfaLocked && (e.key === '2')) {
      e.preventDefault();
      setTool('draw');
    } else if (!pdfaLocked && (e.key === '3')) {
      e.preventDefault();
      setTool('line');
    } else if (!pdfaLocked && (e.key === '4')) {
      e.preventDefault();
      setTool('box');
    } else if (!pdfaLocked && (e.key === '5')) {
      e.preventDefault();
      setTool('circle');
    } else if (!pdfaLocked && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      setTool('textbox');
    } else if (!pdfaLocked && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      setTool('comment');
    }
  }

  // Help / drafting shortcuts
  if (e.key === 'F1') {
    e.preventDefault();
    openDialog('shortcuts');
  } else if (e.key === 'F7') {
    // F7 — toggle dot grid visibility (AutoCAD convention)
    e.preventDefault();
    state.preferences.showGrid = !state.preferences.showGrid;
    import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
    redraw();
  } else if (e.key === 'F8') {
    // F8 — toggle the document outline / left panel (was F9)
    e.preventDefault();
    toggleLeftPanel();
  } else if (e.key === 'F9') {
    // F9 — toggle snap-to-grid (AutoCAD convention)
    e.preventDefault();
    state.preferences.enableGridSnap = !state.preferences.enableGridSnap;
    import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
    redraw();
  } else if (e.key === 'F10') {
    // F10 — toggle polar tracking (AutoCAD convention)
    e.preventDefault();
    state.preferences.polarTrackingEnabled = !state.preferences.polarTrackingEnabled;
    import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
    redraw();
  } else if (e.key === 'F12') {
    e.preventDefault();
    togglePropertiesPanel();
  } else if (e.key === 'F11') {
    e.preventDefault();
    toggleAnnotationsListPanel();
  }
}

// Handle native paste event — works reliably on all platforms including Linux/WebKitGTK
function handlePaste(e) {
  if (!getActiveDocument()?.pdfDoc) return;
  if (isPdfAReadOnly()) return;
  const isInInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (isInInput) return;

  // Mark that the native paste fired so the Ctrl+V keydown fallback skips itself.
  state._lastNativePasteAt = Date.now();

  // Must preventDefault synchronously before any async work
  e.preventDefault();

  // Check for image data in the native clipboard event
  const items = e.clipboardData?.items;
  if (items) {
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          import('../annotations/clipboard.js').then(({ pasteImageFromBlob }) => {
            pasteImageFromBlob(blob);
          });
        }
        return;
      }
    }
  }

  // No image found — paste from internal annotation clipboard
  import('../annotations/clipboard.js').then(({ pasteAnnotation, pasteAnnotations }) => {
    const clips = state.clipboardAnnotations;
    if (clips && clips.length > 1) {
      pasteAnnotations();
    } else if ((clips && clips.length === 1) || state.clipboardAnnotation) {
      pasteAnnotation();
    }
  });
}

// Initialize keyboard handlers
export function initKeyboardHandlers() {
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('paste', handlePaste);
  // G-move-mode requires knowing the current cursor position when G is pressed,
  // so install a passive tracker that updates state._lastMouseAppX/Y on every
  // mousemove. This is cheap (just two assignments + rect calc).
  import('./g-move-mode.js').then(m => m.installGMoveMouseTracker());
}

import { state, getActiveDocument, getPageRotation } from '../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { hasFill } from '../annotations/fill-utils.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { recordAdd, recordModify, execute } from '../core/undo-manager.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { injectSyntheticTextSpans } from '../text/text-layer.js';
import { invertPageRotation, resolveTextEditPageGeometry } from '../text/text-edit-appearance.js';
import { annotationCanvas } from '../ui/dom-elements.js';
import { viewport as vpState } from '../pdf/pdf-viewport.js';
import {
  showTextEditOverlay, hideTextEditOverlay,
  getTextEditValue as getTextValue, getTextEditHeightGrowth as getHeightGrowth,
  openStickyPopup,
} from '../bridge.js';

// Start inline text editing for textbox/callout
export function startTextEditing(annotation) {
  // Idempotency guard: if already editing this same annotation, do nothing.
  // Without this, double-firing handlers (select-tool dblclick + dispatcher dblclick)
  // call finishTextEditing on a freshly-opened overlay, wiping the existing text.
  if (state.isEditingText && state.editingAnnotation === annotation) {
    return;
  }
  if (state.isEditingText) {
    finishTextEditing();
  }

  if (!['textbox', 'callout'].includes(annotation.type)) return;
  if (annotation.locked) return;

  const canvas = annotationCanvas || document.getElementById('annotation-canvas');
  if (!canvas) return;

  state.isEditingText = true;
  state.editingAnnotation = annotation;
  state._textEditSnapshot = cloneAnnotation(annotation);

  // Get canvas position
  const canvasRect = canvas.getBoundingClientRect();

  // Calculate position based on annotation.
  // Viewport mode (vector renderer): annotations are placed at
  //   screen = canvasRect + offset + ann_pos * zoom
  // Legacy mode: annotations are placed at
  //   screen = canvasRect + ann_pos * scale
  // The textarea overlay must use the SAME math the annotation canvas uses,
  // otherwise it appears off-screen and the user can't find/edit the text.
  const doc = getActiveDocument();
  const useViewport = vpState && vpState.active;
  const scale = useViewport ? vpState.zoom : (doc?.scale || 1.5);
  const offX = useViewport ? vpState.offsetX : 0;
  const offY = useViewport ? vpState.offsetY : 0;
  const width = annotation.width || 150;
  const height = annotation.height || 50;
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;

  // Calculate center position of the annotation
  const centerX = canvasRect.left + offX + (annotation.x + width / 2) * scale;
  const centerY = canvasRect.top + offY + (annotation.y + height / 2) * scale;

  // Build a CSS font-family fallback chain matching shapes.js
  // drawTextboxContent — some editors emit "SegoeUI" (no space)
  // which neither Canvas nor CSS resolves to the installed Segoe UI family
  // without the camelCase-expanded variant in the fallback list. Without
  // this, edit-mode textarea silently falls back to the browser default
  // (Times Serif on Windows), giving a font that differs from what the
  // canvas renders → user sees one shape while editing, another after
  // commit.
  const rawFontFamily = annotation.fontFamily || 'Arial';
  const _cssQuote = s => `"${s.replace(/"/g, '\\"')}"`;
  const _expanded = rawFontFamily.replace(/([a-z])([A-Z])/g, '$1 $2');
  const _chain = [];
  if (_expanded !== rawFontFamily) _chain.push(_cssQuote(_expanded));
  _chain.push(/[\s"',]/.test(rawFontFamily) ? _cssQuote(rawFontFamily) : rawFontFamily);
  _chain.push('sans-serif');
  const cssFontFamily = _chain.join(', ');

  // Match the canvas padding (lineWidth, no minimum) so wrap-points line
  // up. Was `2 * scale` which added a 2pt margin the canvas no longer has.
  const editPadding = (annotation.lineWidth ?? 0) * scale;

  // Build style object for the textarea overlay
  const styleObj = {
    position: 'fixed',
    left: `${centerX}px`,
    top: `${centerY}px`,
    width: `${scaledWidth}px`,
    height: `${scaledHeight}px`,
    'font-size': `${(annotation.fontSize || 14) * scale}px`,
    'font-family': cssFontFamily,
    color: annotation.textColor || annotation.color || '#000000',
    'background-color': hasFill(annotation.fillColor) ? annotation.fillColor : '#ffffff',
    border: `${(annotation.lineWidth ?? 1) * scale}px solid ${annotation.strokeColor || '#000000'}`,
    padding: `${editPadding}px`,
    'box-sizing': 'border-box',
    resize: 'none',
    outline: 'none',
    'z-index': '1200',
    overflow: 'hidden',
    transform: annotation.rotation
      ? `translate(-50%, -50%) rotate(${annotation.rotation}deg)`
      : 'translate(-50%, -50%)'
  };

  // Apply text styles
  if (annotation.fontBold) styleObj['font-weight'] = 'bold';
  if (annotation.fontItalic) styleObj['font-style'] = 'italic';
  if (annotation.textAlign) styleObj['text-align'] = annotation.textAlign;
  // Line spacing: CSS line-height adds half-leading above first line.
  // To show spacing only below text, we shift the textarea up inside a clipping wrapper.
  // Match shapes.js DEFAULT_LINE_SPACING (=1.2) so the edit overlay shows
  // the same line gap the canvas will draw on commit.
  const ls = annotation.lineSpacing || 1.2;
  styleObj['line-height'] = ls;
  const halfLeading = ((ls - 1) * (annotation.fontSize || 14) * scale) / 2;
  // Pass halfLeading offset to the overlay component via a custom property
  styleObj['--text-offset'] = `${halfLeading}px`;

  const initialText = annotation.text || '';

  // Commit function: update annotation and refresh display
  const commitFn = (newText) => {
    if (!state.isEditingText || !state.editingAnnotation) return;

    const ann = state.editingAnnotation;
    ann.text = newText;
    ann.modifiedAt = new Date().toISOString();

    // Apply auto-grown height back to annotation
    const growth = getHeightGrowth();
    if (growth > 0) {
      const commitDoc = getActiveDocument();
      const commitScale = commitDoc?.scale || 1.5;
      ann.height = (ann.height || 50) + growth / commitScale;
    }

    if (state._textEditSnapshot && ann.id) {
      // Formatting toggles (bold/italic/underline/textColor/fontFamily/fontSize)
      // are recorded by their own panel-edit recordModify calls. The text-edit
      // session should only record text + height changes, so align the snapshot's
      // formatting fields with the current annotation before recording.
      const snap = state._textEditSnapshot;
      ['fontBold', 'fontItalic', 'fontUnderline', 'textColor', 'fontFamily', 'fontSize',
       'fillColor', 'strokeColor', 'lineWidth', 'textAlign', 'lineSpacing', 'rotation', 'opacity']
        .forEach(k => { if (k in ann) snap[k] = ann[k]; });
      recordModify(ann.id, snap, ann);
    }

    state.isEditingText = false;
    state.editingAnnotation = null;
    state.textEditElement = null;
    state._textEditSnapshot = null;

    if (getActiveDocument()?.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    const _doc = getActiveDocument();
    if (_doc && _doc.selectedAnnotation === ann) {
      showProperties(ann);
    }
  };

  // Cancel function: restore original text, reset state, refresh display
  const cancelFn = () => {
    if (!state.isEditingText || !state.editingAnnotation) return;

    const ann = state.editingAnnotation;

    state.isEditingText = false;
    state.editingAnnotation = null;
    state.textEditElement = null;
    state._textEditSnapshot = null;

    if (getActiveDocument()?.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    const _doc = getActiveDocument();
    if (_doc && _doc.selectedAnnotation === ann) {
      showProperties(ann);
    }
  };

  showTextEditOverlay(styleObj, initialText, commitFn, cancelFn);
  state.textEditElement = true;
}

// Finish inline text editing (called externally, e.g. when switching tools)
export function finishTextEditing() {
  if (!state.isEditingText || !state.editingAnnotation) return;

  const annotation = state.editingAnnotation;

  // Get the current text value from the Solid store
  const currentText = getTextValue();
  annotation.text = currentText;
  annotation.modifiedAt = new Date().toISOString();

  // Apply auto-grown height back to annotation
  const growth = getHeightGrowth();
  if (growth > 0) {
    const doc = getActiveDocument();
    const finishScale = doc?.scale || 1.5;
    annotation.height = (annotation.height || 50) + growth / finishScale;
  }

  if (state._textEditSnapshot && annotation.id) {
    // Align formatting fields with the current annotation so this recordModify
    // only captures text/height changes — formatting toggles have their own
    // recordModify entries from the property panel/keyboard shortcuts.
    const snap = state._textEditSnapshot;
    ['fontBold', 'fontItalic', 'fontUnderline', 'textColor', 'fontFamily', 'fontSize',
     'fillColor', 'strokeColor', 'lineWidth', 'textAlign', 'lineSpacing', 'rotation', 'opacity']
      .forEach(k => { if (k in annotation) snap[k] = annotation[k]; });
    recordModify(annotation.id, snap, annotation);
  }

  hideTextEditOverlay();

  // Reset state
  state.isEditingText = false;
  state.editingAnnotation = null;
  state.textEditElement = null;
  state._textEditSnapshot = null;

  // Refresh display
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  // Update properties panel
  const _doc2 = getActiveDocument();
  if (_doc2 && _doc2.selectedAnnotation === annotation) {
    showProperties(annotation);
  }
}

// Show the text annotation dialog and return a promise with the result
function showTextAnnotationDialog() {
  return new Promise((resolve) => {
    import('../solid/stores/dialogStore.js').then(({ openDialog }) => {
      openDialog('text-annotation', { onResult: resolve });
    });
  });
}

// Add PDF content text at position (stored as textEdit, burned into PDF on save)
export async function addTextAnnotation(x, y, pageNum, canvasEl) {
  const result = await showTextAnnotationDialog();
  if (!result) return;

  const doc = getActiveDocument();
  const page = pageNum || (doc ? doc.currentPage : 1);

  // Determine page height for coordinate conversion
  const addTextScale = doc?.scale || 1.5;
  const dpr = window.devicePixelRatio || 1;
  const activeCanvas = canvasEl || annotationCanvas || document.getElementById('annotation-canvas');
  if (!activeCanvas) return;
  const geometry = resolveTextEditPageGeometry(
    doc?.pageDims?.[page],
    activeCanvas.width / (addTextScale * dpr),
    activeCanvas.height / (addTextScale * dpr),
    getPageRotation(page),
  );
  const unrotatedPoint = invertPageRotation(
    x,
    y,
    geometry.pageWidth,
    geometry.pageHeight,
    geometry.rotation,
  );

  // Convert visual page coordinates to PDF user-space (origin at bottom-left).
  const pdfX = unrotatedPoint.x;
  const pdfY = geometry.pageHeight - unrotatedPoint.y;

  // Map dialog font family + bold/italic to standard PDF font name
  const fn = (result.fontFamily || 'Arial').toLowerCase();
  const isBold = result.fontBold || false;
  const isItalic = result.fontItalic || false;
  let fontFamily;
  if (fn.includes('courier') || fn.includes('consolas') || fn.includes('mono')) {
    fontFamily = isBold && isItalic ? 'Courier-BoldOblique'
      : isBold ? 'Courier-Bold'
      : isItalic ? 'Courier-Oblique'
      : 'Courier';
  } else if (fn.includes('times') || fn.includes('garamond') || fn.includes('georgia')
      || fn.includes('palatino') || fn.includes('cambria') || fn.includes('bookman')) {
    fontFamily = isBold && isItalic ? 'TimesRoman-BoldItalic'
      : isBold ? 'TimesRoman-Bold'
      : isItalic ? 'TimesRoman-Italic'
      : 'TimesRoman';
  } else {
    fontFamily = isBold && isItalic ? 'Helvetica-BoldOblique'
      : isBold ? 'Helvetica-Bold'
      : isItalic ? 'Helvetica-Oblique'
      : 'Helvetica';
  }

  const fontSize = result.fontSize || 16;

  const editRecord = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    page,
    originalText: '',
    newText: result.text,
    pdfX,
    pdfY,
    pdfWidth: 0,
    fontSize,
    lineSpacing: fontSize * 1.2,
    numOriginalLines: 0,
    fontFamily,
    loadedFontName: '',
    pdfFontName: '',
    color: result.color || '#000000',
    originalSpanTexts: []
  };

  if (doc) {
    if (!doc.textEdits) doc.textEdits = [];
    doc.textEdits.push(editRecord);
    execute({ type: 'addTextEdit', textEdit: { ...editRecord } });
    markDocumentModified();
  }

  // Inject synthetic text layer span so the text is selectable and editable
  const textLayer = document.querySelector(`.textLayer[data-page="${page}"]`)
    || document.querySelector('.textLayer');
  if (textLayer) {
    if (activeCanvas) {
      const pw = activeCanvas.width / addTextScale;
      const ph = activeCanvas.height / addTextScale;
      injectSyntheticTextSpans(textLayer, page, pw, ph);
    }
  }

  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Add comment/sticky note at position and open popup for editing
export function addComment(x, y) {
  const annotation = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    type: 'comment',
    page: getActiveDocument()?.currentPage || 1,
    x: x,
    y: y,
    width: 24,
    height: 24,
    text: '',
    color: state.preferences.commentColor || '#FFFF00',
    fillColor: state.preferences.commentColor || '#FFFF00',
    icon: state.preferences.commentIcon || 'comment',
    author: state.defaultAuthor,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    locked: false,
    printable: true,
    popupOpen: true
  };

  const doc = getActiveDocument();
  if (doc) doc.annotations.push(annotation);
  recordAdd(annotation);

  if (doc?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  // Open popup immediately for text entry
  openStickyPopup(annotation);
}

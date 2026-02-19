import { state, getActiveDocument } from '../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { recordAdd, recordModify, execute } from '../core/undo-manager.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { injectSyntheticTextSpans } from '../text/text-layer.js';
import { annotationCanvas } from '../ui/dom-elements.js';
import { showTextEditOverlay, hideTextEditOverlay, getTextValue } from '../solid/stores/textEditOverlayStore.js';

// Start inline text editing for textbox/callout
export function startTextEditing(annotation) {
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

  // Calculate position based on annotation
  const width = annotation.width || 150;
  const height = annotation.height || 50;
  const scaledWidth = width * state.scale;
  const scaledHeight = height * state.scale;

  // Calculate center position of the annotation
  const centerX = canvasRect.left + (annotation.x + width / 2) * state.scale;
  const centerY = canvasRect.top + (annotation.y + height / 2) * state.scale;

  // Build style object for the textarea overlay
  const styleObj = {
    position: 'fixed',
    left: `${centerX}px`,
    top: `${centerY}px`,
    width: `${scaledWidth}px`,
    height: `${scaledHeight}px`,
    'font-size': `${(annotation.fontSize || 14) * state.scale}px`,
    'font-family': annotation.fontFamily || 'Arial',
    color: annotation.textColor || annotation.color || '#000000',
    'background-color': annotation.fillColor && annotation.fillColor !== 'transparent'
      ? annotation.fillColor : '#ffffff',
    border: `${(annotation.lineWidth || 1) * state.scale}px solid ${annotation.strokeColor || '#000000'}`,
    padding: '5px',
    'box-sizing': 'border-box',
    resize: 'none',
    outline: 'none',
    'z-index': '10000',
    overflow: 'hidden',
    transform: annotation.rotation
      ? `translate(-50%, -50%) rotate(${annotation.rotation}deg)`
      : 'translate(-50%, -50%)'
  };

  // Apply text styles
  if (annotation.fontBold) styleObj['font-weight'] = 'bold';
  if (annotation.fontItalic) styleObj['font-style'] = 'italic';
  if (annotation.textAlign) styleObj['text-align'] = annotation.textAlign;
  if (annotation.lineSpacing) styleObj['line-height'] = annotation.lineSpacing;

  const initialText = annotation.text || '';

  // Commit function: update annotation and refresh display
  const commitFn = (newText) => {
    if (!state.isEditingText || !state.editingAnnotation) return;

    const ann = state.editingAnnotation;
    ann.text = newText;
    ann.modifiedAt = new Date().toISOString();

    if (state._textEditSnapshot && ann.id) {
      recordModify(ann.id, state._textEditSnapshot, ann);
    }

    state.isEditingText = false;
    state.editingAnnotation = null;
    state.textEditElement = null;
    state._textEditSnapshot = null;

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    if (state.selectedAnnotation === ann) {
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

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    if (state.selectedAnnotation === ann) {
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

  if (state._textEditSnapshot && annotation.id) {
    recordModify(annotation.id, state._textEditSnapshot, annotation);
  }

  hideTextEditOverlay();

  // Reset state
  state.isEditingText = false;
  state.editingAnnotation = null;
  state.textEditElement = null;
  state._textEditSnapshot = null;

  // Refresh display
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  // Update properties panel
  if (state.selectedAnnotation === annotation) {
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

  const page = pageNum || state.currentPage;

  // Determine page height for coordinate conversion
  let pageHeight;
  if (canvasEl) {
    pageHeight = canvasEl.height / state.scale;
  } else {
    const canvas = annotationCanvas || document.getElementById('annotation-canvas');
    if (canvas) {
      pageHeight = canvas.height / state.scale;
    } else {
      return;
    }
  }

  // Convert canvas coords to PDF user-space (origin at bottom-left)
  const pdfX = x;
  const pdfY = pageHeight - y;

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

  const doc = getActiveDocument();
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
    const activeCanvas = canvasEl || annotationCanvas || document.getElementById('annotation-canvas');
    if (activeCanvas) {
      const pw = activeCanvas.width / state.scale;
      const ph = activeCanvas.height / state.scale;
      injectSyntheticTextSpans(textLayer, page, pw, ph);
    }
  }

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Add comment/sticky note at position
export function addComment(x, y) {
  const text = prompt('Enter comment:');
  if (text !== null) { // Allow empty comments
    const annotation = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
      type: 'comment',
      page: state.currentPage,
      x: x,
      y: y,
      width: 24,
      height: 24,
      text: text,
      color: state.preferences.commentColor || '#FFFF00',
      fillColor: state.preferences.commentColor || '#FFFF00',
      icon: state.preferences.commentIcon || 'comment',
      author: state.defaultAuthor,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      locked: false,
      printable: true
    };

    state.annotations.push(annotation);
    recordAdd(annotation);

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

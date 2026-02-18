import { state, getActiveDocument } from '../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { recordAdd, recordModify, execute } from '../core/undo-manager.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { injectSyntheticTextSpans } from '../text/text-layer.js';

// Start inline text editing for textbox/callout
export function startTextEditing(annotation) {
  if (state.isEditingText) {
    finishTextEditing();
  }

  if (!['textbox', 'callout'].includes(annotation.type)) return;
  if (annotation.locked) return;

  // Get canvas element dynamically (not from import, which may be null)
  const canvas = document.getElementById('annotation-canvas');
  if (!canvas) return;

  state.isEditingText = true;
  state.editingAnnotation = annotation;
  state._textEditSnapshot = cloneAnnotation(annotation);

  // Create textarea overlay
  const textarea = document.createElement('textarea');
  textarea.className = 'inline-text-editor';
  textarea.value = annotation.text || '';

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

  // Style the textarea - position by center using transform
  textarea.style.position = 'fixed';
  textarea.style.left = `${centerX}px`;
  textarea.style.top = `${centerY}px`;
  textarea.style.width = `${scaledWidth}px`;
  textarea.style.height = `${scaledHeight}px`;
  textarea.style.fontSize = `${(annotation.fontSize || 14) * state.scale}px`;
  textarea.style.fontFamily = annotation.fontFamily || 'Arial';
  textarea.style.color = annotation.textColor || annotation.color || '#000000';
  textarea.style.backgroundColor = annotation.fillColor && annotation.fillColor !== 'transparent'
    ? annotation.fillColor : '#ffffff';
  textarea.style.border = `${(annotation.lineWidth || 1) * state.scale}px solid ${annotation.strokeColor || '#000000'}`;
  textarea.style.padding = '5px';
  textarea.style.boxSizing = 'border-box';
  textarea.style.resize = 'none';
  textarea.style.outline = 'none';
  textarea.style.zIndex = '10000';
  textarea.style.overflow = 'hidden';

  // Apply transform: center the element and optionally rotate
  if (annotation.rotation) {
    textarea.style.transform = `translate(-50%, -50%) rotate(${annotation.rotation}deg)`;
  } else {
    textarea.style.transform = 'translate(-50%, -50%)';
  }

  // Apply text styles
  if (annotation.fontBold) textarea.style.fontWeight = 'bold';
  if (annotation.fontItalic) textarea.style.fontStyle = 'italic';
  if (annotation.textAlign) textarea.style.textAlign = annotation.textAlign;
  if (annotation.lineSpacing) textarea.style.lineHeight = annotation.lineSpacing;

  // Add to document
  document.body.appendChild(textarea);
  state.textEditElement = textarea;

  // Focus and select all
  textarea.focus();
  textarea.select();

  // Handle keydown events
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Cancel editing
      state.textEditElement.value = annotation.text || '';
      finishTextEditing();
    }
    // Don't propagate keyboard events during editing
    e.stopPropagation();
  });

  // Add blur listener after a short delay to prevent immediate blur from mouseup
  setTimeout(() => {
    if (state.textEditElement === textarea) {
      textarea.addEventListener('blur', finishTextEditing);
    }
  }, 100);
}

// Finish inline text editing
export function finishTextEditing() {
  if (!state.isEditingText || !state.editingAnnotation) return;

  const annotation = state.editingAnnotation;
  const textarea = state.textEditElement;

  if (textarea) {
    // Update annotation text
    annotation.text = textarea.value;
    annotation.modifiedAt = new Date().toISOString();

    // Record the modification for undo
    if (state._textEditSnapshot && annotation.id) {
      recordModify(annotation.id, state._textEditSnapshot, annotation);
    }

    // Remove textarea
    textarea.remove();
  }

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
    const overlay = document.getElementById('text-annot-dialog');
    if (!overlay) { resolve(null); return; }

    const dialog = overlay.querySelector('.text-annot-dialog');
    const input = document.getElementById('text-annot-input');
    const preview = document.getElementById('text-annot-preview');
    const charCount = document.getElementById('text-annot-char-count');
    const fontFamily = document.getElementById('text-annot-font-family');
    const fontSize = document.getElementById('text-annot-font-size');
    const colorInput = document.getElementById('text-annot-color');
    const colorPreview = document.getElementById('text-annot-color-preview');
    const boldBtn = document.getElementById('text-annot-bold');
    const italicBtn = document.getElementById('text-annot-italic');
    const underlineBtn = document.getElementById('text-annot-underline');
    const alignLeftBtn = document.getElementById('text-annot-align-left');
    const alignCenterBtn = document.getElementById('text-annot-align-center');
    const alignRightBtn = document.getElementById('text-annot-align-right');
    const okBtn = document.getElementById('text-annot-ok-btn');
    const cancelBtn = document.getElementById('text-annot-cancel-btn');
    const closeBtn = document.getElementById('text-annot-close-btn');

    // State
    let isBold = false;
    let isItalic = false;
    let isUnderline = false;
    let textAlign = 'left';

    // Reset dialog to defaults
    const prefs = state.preferences || {};
    input.value = '';
    fontFamily.value = 'Arial';
    fontSize.value = String(prefs.defaultFontSize || 16);
    colorInput.value = prefs.defaultAnnotationColor || '#000000';
    colorPreview.style.backgroundColor = colorInput.value;
    boldBtn.classList.remove('active');
    italicBtn.classList.remove('active');
    underlineBtn.classList.remove('active');
    alignLeftBtn.classList.add('active');
    alignCenterBtn.classList.remove('active');
    alignRightBtn.classList.remove('active');

    // Reset textarea styling
    input.style.fontFamily = 'Arial';
    input.style.fontSize = (prefs.defaultFontSize || 16) + 'px';
    input.style.color = colorInput.value;
    input.style.fontWeight = 'normal';
    input.style.fontStyle = 'normal';
    input.style.textDecoration = 'none';
    input.style.textAlign = 'left';

    // Reset position
    if (dialog) {
      dialog.style.left = '50%';
      dialog.style.top = '50%';
      dialog.style.transform = 'translate(-50%, -50%)';
      dialog.style.position = 'absolute';
    }

    function updatePreview() {
      if (!preview) return;
      const text = input.value || 'Sample text';
      const style = (isItalic ? 'italic ' : '') + (isBold ? 'bold ' : '');
      const decoration = isUnderline ? 'underline' : 'none';
      preview.style.fontFamily = fontFamily.value;
      preview.style.fontSize = fontSize.value + 'px';
      preview.style.color = colorInput.value;
      preview.style.fontStyle = isItalic ? 'italic' : 'normal';
      preview.style.fontWeight = isBold ? 'bold' : 'normal';
      preview.style.textDecoration = decoration;
      preview.style.textAlign = textAlign;
      preview.textContent = text;
    }

    function updateCharCount() {
      if (charCount) charCount.textContent = input.value.length;
    }

    function cleanup() {
      overlay.classList.remove('visible');
      input.removeEventListener('input', onInput);
      fontFamily.removeEventListener('change', updatePreview);
      fontSize.removeEventListener('change', updatePreview);
      colorInput.removeEventListener('input', onColorChange);
      boldBtn.removeEventListener('click', onBold);
      italicBtn.removeEventListener('click', onItalic);
      underlineBtn.removeEventListener('click', onUnderline);
      alignLeftBtn.removeEventListener('click', onAlignLeft);
      alignCenterBtn.removeEventListener('click', onAlignCenter);
      alignRightBtn.removeEventListener('click', onAlignRight);
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeydown);
    }

    function onInput() {
      updatePreview();
      updateCharCount();
      // Sync textarea style to match formatting
      input.style.fontFamily = fontFamily.value;
      input.style.fontSize = fontSize.value + 'px';
      input.style.color = colorInput.value;
      input.style.fontWeight = isBold ? 'bold' : 'normal';
      input.style.fontStyle = isItalic ? 'italic' : 'normal';
      input.style.textDecoration = isUnderline ? 'underline' : 'none';
      input.style.textAlign = textAlign;
    }

    function onColorChange() {
      colorPreview.style.backgroundColor = colorInput.value;
      input.style.color = colorInput.value;
      updatePreview();
    }

    function onBold() {
      isBold = !isBold;
      boldBtn.classList.toggle('active', isBold);
      input.style.fontWeight = isBold ? 'bold' : 'normal';
      updatePreview();
    }

    function onItalic() {
      isItalic = !isItalic;
      italicBtn.classList.toggle('active', isItalic);
      input.style.fontStyle = isItalic ? 'italic' : 'normal';
      updatePreview();
    }

    function onUnderline() {
      isUnderline = !isUnderline;
      underlineBtn.classList.toggle('active', isUnderline);
      input.style.textDecoration = isUnderline ? 'underline' : 'none';
      updatePreview();
    }

    function setAlign(align) {
      textAlign = align;
      alignLeftBtn.classList.toggle('active', align === 'left');
      alignCenterBtn.classList.toggle('active', align === 'center');
      alignRightBtn.classList.toggle('active', align === 'right');
      input.style.textAlign = align;
      updatePreview();
    }

    function onAlignLeft() { setAlign('left'); }
    function onAlignCenter() { setAlign('center'); }
    function onAlignRight() { setAlign('right'); }

    function onOk() {
      const text = input.value;
      if (!text.trim()) { cleanup(); resolve(null); return; }
      cleanup();
      resolve({
        text,
        fontFamily: fontFamily.value,
        fontSize: parseInt(fontSize.value),
        color: colorInput.value,
        fontBold: isBold,
        fontItalic: isItalic,
        fontUnderline: isUnderline,
        textAlign: textAlign
      });
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onKeydown(e) {
      if (!overlay.classList.contains('visible')) return;
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && e.ctrlKey) {
        onOk();
      } else if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        onBold();
      } else if (e.ctrlKey && e.key === 'i') {
        e.preventDefault();
        onItalic();
      } else if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        onUnderline();
      }
    }

    // Wire up events
    input.addEventListener('input', onInput);
    fontFamily.addEventListener('change', () => { onInput(); updatePreview(); });
    fontSize.addEventListener('change', () => { onInput(); updatePreview(); });
    colorInput.addEventListener('input', onColorChange);
    boldBtn.addEventListener('click', onBold);
    italicBtn.addEventListener('click', onItalic);
    underlineBtn.addEventListener('click', onUnderline);
    alignLeftBtn.addEventListener('click', onAlignLeft);
    alignCenterBtn.addEventListener('click', onAlignCenter);
    alignRightBtn.addEventListener('click', onAlignRight);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeydown);

    // Make dialog draggable
    initTextAnnotDialogDrag(overlay, dialog);

    // Show
    overlay.classList.add('visible');
    updatePreview();
    updateCharCount();
    input.focus();
  });
}

// Drag functionality for the text annotation dialog (initialized once)
let _textAnnotDragInitialized = false;
function initTextAnnotDialogDrag(overlay, dialog) {
  if (_textAnnotDragInitialized) return;
  _textAnnotDragInitialized = true;

  const header = dialog.querySelector('.text-annot-header');
  if (!header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.text-annot-close-btn')) return;
    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const overlayRect = overlay.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;
    const dialogRect = dialog.getBoundingClientRect();
    const maxX = overlayRect.width - dialogRect.width;
    const maxY = overlayRect.height - dialogRect.height;
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));
    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
    dialog.style.position = 'absolute';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
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
    const canvas = document.getElementById('annotation-canvas');
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
    const activeCanvas = canvasEl || document.getElementById('annotation-canvas');
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

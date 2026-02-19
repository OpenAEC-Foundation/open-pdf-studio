import { state, getActiveDocument } from '../core/state.js';
import { execute } from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { showTextEditProperties, hideProperties } from '../ui/panels/properties-panel.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { canvasContainer, continuousContainer, pdfCanvas } from '../ui/dom-elements.js';
import { showPdfTextEditor, hidePdfTextEditor, getEditorText } from '../solid/stores/pdfTextEditStore.js';

let activeEditor = null;
let hoverListeners = [];
let textLayerObserver = null;
let blockGroupsCache = new Map();
// WeakMap: span -> block group, for fast lookup on hover/click
let spanToBlock = new WeakMap();

function rgbToHex(rgbStr) {
  const m = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

export function activateEditTextTool() {
  state.isEditingPdfText = true;
  // Overlay layers (annotation canvas z-index, form/link pointer-events) are
  // managed centrally by setAnnotationCanvasForTextAccess() in manager.js.
  enableTextLayerHover();
  startObservingTextLayers();
}

export function deactivateEditTextTool() {
  finishPdfTextEditing();
  disableTextLayerHover();
  stopObservingTextLayers();
  blockGroupsCache.clear();
  spanToBlock = new WeakMap();
  state.isEditingPdfText = false;
  state.pdfTextEditState = null;
  // Overlay layers are restored by setAnnotationCanvasForTextAccess() in manager.js
}

// ── MutationObserver: re-attach when text layers are recreated ──

function startObservingTextLayers() {
  stopObservingTextLayers();
  const container = canvasContainer || document.getElementById('canvas-container');
  const continuous = continuousContainer || document.getElementById('continuous-container');
  const targets = [container, continuous].filter(Boolean);
  if (targets.length === 0) return;

  textLayerObserver = new MutationObserver(() => {
    if (state.isEditingPdfText && state.currentTool === 'editText') {
      blockGroupsCache.clear();
      spanToBlock = new WeakMap();
      enableTextLayerHover();
    }
  });
  for (const target of targets) {
    textLayerObserver.observe(target, { childList: true, subtree: true });
  }
}

function stopObservingTextLayers() {
  if (textLayerObserver) {
    textLayerObserver.disconnect();
    textLayerObserver = null;
  }
}

// ── Block grouping: spans → lines → multi-line blocks ──
//
// All grouping decisions use PDF user-space coordinates (from the transform
// matrix stored on each span).  DOM measurements are only used at the end
// to build the bounding rect the editor needs for positioning.

function getBlockGroups(layer) {
  if (blockGroupsCache.has(layer)) return blockGroupsCache.get(layer);

  const spans = Array.from(layer.querySelectorAll('span[data-pdf-transform]'));
  if (spans.length === 0) { blockGroupsCache.set(layer, []); return []; }

  const layerRect = layer.getBoundingClientRect();

  const items = spans.map(span => {
    const r = span.getBoundingClientRect();
    const transform = JSON.parse(span.dataset.pdfTransform);
    const fontSize = Math.sqrt(transform[2] ** 2 + transform[3] ** 2);
    return {
      span,
      // DOM coords – only for editor placement later
      domLeft: r.left - layerRect.left,
      domTop: r.top - layerRect.top,
      domRight: r.right - layerRect.left,
      domBottom: r.bottom - layerRect.top,
      // PDF coords – used for all grouping logic
      pdfX: transform[4],
      pdfY: transform[5],
      pdfWidth: parseFloat(span.dataset.pdfWidth) || 0,
      fontSize
    };
  });

  // ── Step 1: group spans into lines by pdfY ──
  // Sort by pdfY descending (reading order: top line first)
  items.sort((a, b) => b.pdfY - a.pdfY || a.pdfX - b.pdfX);

  const lines = [];
  let curLine = [items[0]];
  for (let i = 1; i < items.length; i++) {
    const tolerance = curLine[0].fontSize * 0.3;
    if (Math.abs(items[i].pdfY - curLine[0].pdfY) <= tolerance) {
      curLine.push(items[i]);
    } else {
      lines.push(curLine);
      curLine = [items[i]];
    }
  }
  lines.push(curLine);

  // Sort each line left → right by pdfX
  for (const line of lines) line.sort((a, b) => a.pdfX - b.pdfX);

  // ── Step 1b: split lines at large horizontal gaps (column boundaries) ──
  const splitLines = [];
  for (const line of lines) {
    let segment = [line[0]];
    for (let j = 1; j < line.length; j++) {
      const prev = segment[segment.length - 1];
      const curr = line[j];
      const prevRight = prev.pdfX + prev.pdfWidth;
      const gap = curr.pdfX - prevRight;
      const avgFs = (prev.fontSize + curr.fontSize) / 2;

      if (gap > avgFs * 3) {
        // Large gap — treat as separate column
        splitLines.push(segment);
        segment = [curr];
      } else {
        segment.push(curr);
      }
    }
    splitLines.push(segment);
  }

  // ── Step 2: group consecutive lines into blocks ──
  //
  // Two adjacent lines belong to the same block only when ALL of:
  //   a) font sizes match closely   (ratio > 0.92)
  //   b) baseline gap is reasonable  (0.5× – 1.8× fontSize)
  //   c) left edges are aligned      (within 1× fontSize)
  const blocks = [];
  let curBlock = [splitLines[0]];

  for (let i = 1; i < splitLines.length; i++) {
    const prevLine = curBlock[curBlock.length - 1];
    const nextLine = splitLines[i];

    const prevFs = prevLine[0].fontSize;
    const nextFs = nextLine[0].fontSize;
    const fontRatio = Math.min(prevFs, nextFs) / Math.max(prevFs, nextFs);

    // Baseline-to-baseline distance in PDF units (positive = going down)
    const baselineGap = prevLine[0].pdfY - nextLine[0].pdfY;
    const avgFs = (prevFs + nextFs) / 2;

    // Left-edge proximity in PDF units
    const prevLeft = Math.min(...prevLine.map(it => it.pdfX));
    const nextLeft = Math.min(...nextLine.map(it => it.pdfX));

    const sameBlock =
      fontRatio > 0.92 &&
      baselineGap > avgFs * 0.5 &&
      baselineGap < avgFs * 1.8 &&
      Math.abs(nextLeft - prevLeft) < avgFs * 1.0;

    if (sameBlock) {
      curBlock.push(nextLine);
    } else {
      blocks.push(curBlock);
      curBlock = [nextLine];
    }
  }
  blocks.push(curBlock);

  // ── Build group objects ──
  // Find the PDF canvas to sample text colors
  const pdfCanvasEl = layer.parentElement?.querySelector('canvas.pdf-canvas')
    || pdfCanvas || document.getElementById('pdf-canvas');
  const canvasCtx = pdfCanvasEl?.getContext('2d', { willReadFrequently: true });

  const groups = blocks.map(block => {
    const allItems = block.flat();
    const allSpans = allItems.map(it => it.span);

    // DOM bounding rect (for editor placement)
    const minLeft = Math.min(...allItems.map(it => it.domLeft));
    const minTop = Math.min(...allItems.map(it => it.domTop));
    const maxRight = Math.max(...allItems.map(it => it.domRight));
    const maxBottom = Math.max(...allItems.map(it => it.domBottom));

    const lineData = block.map(lineItems => {
      const firstSpan = lineItems[0].span;
      // Use actual font name from commonObjs (stored on dataset by text-layer.js)
      const pdfFontFamily = firstSpan.dataset.pdfFontFamily || 'sans-serif';
      const pdfFontName = firstSpan.dataset.pdfFontName || '';
      const actualFontName = firstSpan.dataset.pdfActualFontName || '';
      const loadedFontName = firstSpan.dataset.pdfLoadedFontName || '';
      const isBold = firstSpan.dataset.pdfBold === 'true';
      const isItalic = firstSpan.dataset.pdfItalic === 'true';

      // Sample text color from the rendered canvas
      let color = '#000000';
      if (canvasCtx) {
        const sampleX = Math.round(lineItems[0].domLeft + 2);
        const sampleY = Math.round((lineItems[0].domTop + lineItems[0].domBottom) / 2);
        if (sampleX >= 0 && sampleY >= 0 && sampleX < pdfCanvasEl.width && sampleY < pdfCanvasEl.height) {
          const pixel = canvasCtx.getImageData(sampleX, sampleY, 1, 1).data;
          // Only use sampled color if it's not white/near-white (background)
          if (pixel[0] < 240 || pixel[1] < 240 || pixel[2] < 240) {
            color = '#' + ((1 << 24) | (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]).toString(16).slice(1);
          }
        }
      }

      return {
        text: lineItems.map(it => it.span.textContent).join(''),
        pdfX: lineItems[0].pdfX,
        pdfY: lineItems[0].pdfY,
        pdfWidth: lineItems.reduce((s, it) => s + it.pdfWidth, 0),
        fontSize: lineItems[0].fontSize,
        spans: lineItems.map(it => it.span),
        fontFamily: pdfFontFamily,
        pdfFontName,
        actualFontName,
        loadedFontName,
        isBold,
        isItalic,
        color
      };
    });

    // Baseline-to-baseline spacing in PDF units
    let lineSpacing = lineData[0].fontSize * 1.2;
    if (lineData.length > 1) {
      let total = 0;
      for (let i = 1; i < lineData.length; i++) {
        total += lineData[i - 1].pdfY - lineData[i].pdfY;
      }
      lineSpacing = total / (lineData.length - 1);
    }

    const group = {
      spans: allSpans,
      lineData,
      lineSpacing,
      rect: { left: minLeft, top: minTop, width: maxRight - minLeft, height: maxBottom - minTop }
    };

    for (const sp of allSpans) spanToBlock.set(sp, group);
    return group;
  });

  blockGroupsCache.set(layer, groups);
  return groups;
}

// ── Hover & click wiring ──

function enableTextLayerHover() {
  const textLayers = document.querySelectorAll('.textLayer');
  const alreadyAttached = new Set(hoverListeners.map(h => h.span));

  textLayers.forEach(layer => {
    layer.style.pointerEvents = 'auto';
    // Force block computation so spanToBlock is populated
    getBlockGroups(layer);

    const pageNum = parseInt(layer.dataset.page) || state.currentPage;
    const spans = layer.querySelectorAll('span');
    spans.forEach(span => {
      if (alreadyAttached.has(span)) return;
      span.style.pointerEvents = 'auto';
      span.style.cursor = 'text';
      span.classList.add('edit-text-hoverable');

      const enterHandler = () => {
        const block = spanToBlock.get(span);
        if (block) block.spans.forEach(s => s.classList.add('edit-text-block-hover'));
      };
      const leaveHandler = () => {
        const block = spanToBlock.get(span);
        if (block) block.spans.forEach(s => s.classList.remove('edit-text-block-hover'));
      };
      const clickHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        startPdfTextEditing(span, pageNum);
      };
      span.addEventListener('mouseenter', enterHandler);
      span.addEventListener('mouseleave', leaveHandler);
      span.addEventListener('click', clickHandler);
      hoverListeners.push({ span, enter: enterHandler, leave: leaveHandler, click: clickHandler });
    });
  });
}

function disableTextLayerHover() {
  // If switching to the select tool, preserve pointer-events for text selection
  // (this runs asynchronously after setTool() has already applied select-tool state)
  const keepTextAccess = state.currentTool === 'select';

  for (const h of hoverListeners) {
    h.span.removeEventListener('mouseenter', h.enter);
    h.span.removeEventListener('mouseleave', h.leave);
    h.span.removeEventListener('click', h.click);
    h.span.classList.remove('edit-text-hoverable', 'edit-text-block-hover');
    h.span.style.pointerEvents = keepTextAccess ? 'auto' : '';
    h.span.style.cursor = keepTextAccess ? 'text' : '';
  }
  hoverListeners = [];

  document.querySelectorAll('.textLayer').forEach(layer => {
    layer.style.pointerEvents = keepTextAccess ? 'auto' : '';
  });
}

// ── Inline editor ──

function startPdfTextEditing(span, pageNum) {
  finishPdfTextEditing();

  const textLayer = span.closest('.textLayer');
  if (!textLayer) return;

  const block = spanToBlock.get(span);
  if (!block || block.spans.length === 0) return;

  // Remove block hover highlight (we're now editing)
  block.spans.forEach(s => s.classList.remove('edit-text-block-hover'));

  const { lineData, lineSpacing } = block;

  // Combined text with line breaks
  const combinedText = lineData.map(l => l.text).join('\n');

  // PDF metadata from first line (top of block in reading order, highest pdfY)
  const pdfX = lineData[0].pdfX;
  const pdfY = lineData[0].pdfY;
  const fontSize = lineData[0].fontSize;
  const pdfWidth = Math.max(...lineData.map(l => l.pdfWidth));
  const groupRect = block.rect;

  // Derive font size from the visual height of the block, not from span CSS
  // (spans use scaleX transforms that a textarea doesn't have)
  const numLines = lineData.length;
  const visualLineHeight = groupRect.height / numLines;
  const editorFontSize = Math.round(visualLineHeight * 0.82);

  // Place editor in the textLayer's parent container (not in the textLayer itself)
  // because .textLayer has opacity: 0.25 which makes all children semi-transparent
  const editorContainer = textLayer.parentElement || textLayer;
  const containerRect = editorContainer.getBoundingClientRect();
  const layerRect = textLayer.getBoundingClientRect();
  const offsetX = layerRect.left - containerRect.left;
  const offsetY = layerRect.top - containerRect.top;

  const padX = 4;
  const padY = 4;

  // Use PDF.js loaded font if available (exact visual match), else map to standard CSS font
  const loadedFont = lineData[0].loadedFontName || '';
  const actualName = (lineData[0].actualFontName || '').toLowerCase();
  const fallback = (lineData[0].fontFamily || 'sans-serif').toLowerCase();
  let cssFallbackFont;
  if (actualName.includes('courier') || actualName.includes('consolas') || actualName.includes('mono') || fallback === 'monospace') {
    cssFallbackFont = '"Courier New", Courier, monospace';
  } else if (actualName.includes('times') || actualName.includes('garamond') || actualName.includes('georgia')
      || actualName.includes('palatino') || actualName.includes('cambria') || actualName.includes('bookman')
      || fallback === 'serif') {
    cssFallbackFont = '"Times New Roman", Times, serif';
  } else {
    cssFallbackFont = 'Helvetica, Arial, sans-serif';
  }
  const editorFont = loadedFont ? `"${loadedFont}", ${cssFallbackFont}` : cssFallbackFont;

  // Build style object for the Solid overlay
  // Use fixed positioning based on container's viewport position
  const styleObj = {
    position: 'fixed',
    left: `${containerRect.left + groupRect.left + offsetX - padX}px`,
    top: `${containerRect.top + groupRect.top + offsetY - padY}px`,
    width: `${Math.max(groupRect.width + padX * 2 + 4, 80)}px`,
    height: `${Math.max(groupRect.height + padY * 2 + 6, 24)}px`,
    'font-size': `${editorFontSize}px`,
    'line-height': `${visualLineHeight}px`,
    'font-family': editorFont,
    color: lineData[0].color || '#000000',
    'z-index': '1000'
  };
  if (lineData[0].isBold) styleObj['font-weight'] = 'bold';
  if (lineData[0].isItalic) styleObj['font-style'] = 'italic';

  // Hide all spans BEFORE showing editor so text doesn't double-render
  for (const s of block.spans) s.style.visibility = 'hidden';

  activeEditor = {
    block,
    pageNum,
    originalText: combinedText,
    pdfX,
    pdfY,
    pdfWidth,
    fontSize,
    lineSpacing,
    numOriginalLines: lineData.length
  };

  state.pdfTextEditState = activeEditor;

  // Show text properties in the right panel
  showTextEditProperties({
    text: combinedText,
    fontSize,
    fontFamily: lineData[0].actualFontName || lineData[0].pdfFontName || cssFallbackFont,
    color: lineData[0].color || '#000000',
    isBold: lineData[0].isBold || false,
    isItalic: lineData[0].isItalic || false,
    page: pageNum
  });

  // Define handlers for the store
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancelPdfTextEditing();
    }
    // Enter commits only if single-line block; otherwise allow newlines
    if (e.key === 'Enter' && !e.shiftKey && lineData.length === 1) {
      e.preventDefault();
      e.stopPropagation();
      finishPdfTextEditing();
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (activeEditor) {
        // Don't close if focus moved to the properties panel.
        // Use the static mount point from index.html (not the Solid-rendered element).
        const activeEl = document.activeElement;
        const propsRoot = document.getElementById('properties-panel-root');
        if (activeEl && propsRoot && propsRoot.contains(activeEl)) {
          return;
        }
        finishPdfTextEditing();
      }
    }, 150);
  };

  showPdfTextEditor(styleObj, combinedText, {
    onCommit: null,
    onCancel: null,
    onKeyDown: handleKeyDown,
    onBlur: handleBlur
  });
}

function finishPdfTextEditing() {
  if (!activeEditor) return;

  // If this editor was started via startTextEditEditing, delegate to its own finish handler
  if (activeEditor._finishEditing) {
    activeEditor._finishEditing();
    return;
  }

  const {
    block, pageNum, originalText,
    pdfX, pdfY, pdfWidth, fontSize, lineSpacing, numOriginalLines
  } = activeEditor;
  const newText = getEditorText();

  hidePdfTextEditor();

  // Show all spans again
  for (const s of block.spans) s.style.visibility = '';

  if (newText !== originalText && newText.trim() !== '') {
    const { lineData } = block;
    const pdfFontFamily = lineData[0].fontFamily || 'sans-serif';
    const pdfFontName = lineData[0].pdfFontName || '';
    const actualFontName = lineData[0].actualFontName || '';
    const isBold = lineData[0].isBold || false;
    const isItalic = lineData[0].isItalic || false;

    // Map actual PDF font name to closest standard font for saving
    const an = actualFontName.toLowerCase();
    const fl = pdfFontFamily.toLowerCase();
    let fontFamily;
    if (an.includes('courier') || an.includes('consolas') || an.includes('mono') || fl === 'monospace') {
      fontFamily = isBold && isItalic ? 'Courier-BoldOblique'
        : isBold ? 'Courier-Bold'
        : isItalic ? 'Courier-Oblique'
        : 'Courier';
    } else if (an.includes('times') || an.includes('garamond') || an.includes('georgia')
        || an.includes('palatino') || an.includes('cambria') || an.includes('bookman')
        || fl === 'serif') {
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
    // Capture original span texts before modifying
    const originalSpanTexts = lineData.map(ld =>
      ld.spans.map(s => s.textContent)
    );

    // Store the PDF.js loaded font name for canvas rendering (exact visual match)
    const loadedFontName = lineData[0].loadedFontName || '';

    const editRecord = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      page: pageNum,
      originalText,
      newText,
      pdfX,
      pdfY,
      pdfWidth,
      fontSize,
      lineSpacing,
      numOriginalLines,
      fontFamily,
      loadedFontName,
      pdfFontName,
      color: lineData[0].color || '#000000',
      originalSpanTexts
    };

    const doc = getActiveDocument();
    if (doc) {
      if (!doc.textEdits) doc.textEdits = [];
      doc.textEdits.push(editRecord);

      // Update span text visually: put all new text in first span, blank the rest
      const newLines = newText.split('\n');
      for (let li = 0; li < lineData.length; li++) {
        const lineSpans = lineData[li].spans;
        if (li < newLines.length) {
          lineSpans[0].textContent = newLines[li];
          for (let si = 1; si < lineSpans.length; si++) lineSpans[si].textContent = '';
        } else {
          for (const s of lineSpans) s.textContent = '';
        }
      }

      execute({ type: 'addTextEdit', textEdit: { ...editRecord, originalSpanTexts } });
      markDocumentModified();

      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
  }

  activeEditor = null;
  state.pdfTextEditState = null;
  hideProperties();
}

function cancelPdfTextEditing() {
  if (!activeEditor) return;

  const { block } = activeEditor;
  hidePdfTextEditor();
  for (const s of block.spans) s.style.visibility = '';

  activeEditor = null;
  state.pdfTextEditState = null;
  hideProperties();
}

export function findTextEditAtPosition(x, y, pageNum, canvasEl) {
  const doc = getActiveDocument();
  if (!doc || !doc.textEdits || doc.textEdits.length === 0) return null;

  const pageEdits = doc.textEdits.filter(e => e.page === pageNum);
  if (pageEdits.length === 0) return null;

  const pageHeight = canvasEl.height / state.scale;

  for (const edit of pageEdits) {
    const fontSize = edit.fontSize;
    const ls = edit.lineSpacing || fontSize * 1.2;
    const newLines = edit.newText.split('\n');
    const numLines = newLines.length;

    const firstBaseY = pageHeight - edit.pdfY;
    const editLeft = edit.pdfX;
    const editTop = firstBaseY - fontSize;
    const editHeight = (numLines - 1) * ls + fontSize * 1.3;
    const maxCharCount = Math.max(...newLines.map(l => l.length), 1);
    const editWidth = Math.max(edit.pdfWidth || 0, fontSize * 0.6 * maxCharCount) + fontSize * 0.5;

    if (x >= editLeft && x <= editLeft + editWidth &&
        y >= editTop && y <= editTop + editHeight) {
      return edit;
    }
  }
  return null;
}

export function startTextEditEditing(textEdit, pageNum, canvasEl) {
  finishPdfTextEditing();

  const pageHeight = canvasEl.height / state.scale;
  const fontSize = textEdit.fontSize;
  const ls = textEdit.lineSpacing || fontSize * 1.2;
  const newLines = textEdit.newText.split('\n');
  const numLines = newLines.length;

  const firstBaseY = pageHeight - textEdit.pdfY;
  const editTop = firstBaseY - fontSize;
  const editHeight = (numLines - 1) * ls + fontSize * 1.3;
  const maxCharCount = Math.max(...newLines.map(l => l.length), 1);
  const editWidth = Math.max(textEdit.pdfWidth || 0, fontSize * 0.6 * maxCharCount) + fontSize * 0.5;

  // Find the container to place the editor in
  const container = canvasEl.parentElement;
  if (!container) return;
  const containerRect = container.getBoundingClientRect();
  const canvasRect = canvasEl.getBoundingClientRect();
  const offsetX = canvasRect.left - containerRect.left;
  const offsetY = canvasRect.top - containerRect.top;

  const padX = 4;
  const padY = 4;
  const scaledLeft = textEdit.pdfX * state.scale;
  const scaledTop = editTop * state.scale;
  const scaledWidth = editWidth * state.scale;
  const scaledHeight = editHeight * state.scale;
  const editorFontSize = Math.round(fontSize * state.scale * 0.82);
  const visualLineHeight = (scaledHeight / numLines);

  // Map font family to CSS
  const ff = (textEdit.fontFamily || 'Helvetica').toLowerCase();
  let cssFontFamily;
  if (ff.includes('courier')) {
    cssFontFamily = '"Courier New", Courier, monospace';
  } else if (ff.includes('times')) {
    cssFontFamily = '"Times New Roman", Times, serif';
  } else {
    cssFontFamily = 'Helvetica, Arial, sans-serif';
  }

  // Build style object using fixed positioning
  const styleObj = {
    position: 'fixed',
    left: `${containerRect.left + scaledLeft + offsetX - padX}px`,
    top: `${containerRect.top + scaledTop + offsetY - padY}px`,
    width: `${Math.max(scaledWidth + padX * 2 + 4, 80)}px`,
    height: `${Math.max(scaledHeight + padY * 2 + 6, 24)}px`,
    'font-size': `${editorFontSize}px`,
    'line-height': `${visualLineHeight}px`,
    'font-family': cssFontFamily,
    color: textEdit.color || '#000000',
    'z-index': '1000'
  };
  if (ff.includes('bold')) styleObj['font-weight'] = 'bold';
  if (ff.includes('italic') || ff.includes('oblique')) styleObj['font-style'] = 'italic';

  const oldTextEdit = { ...textEdit };

  const finishEditing = () => {
    const newText = getEditorText();
    hidePdfTextEditor();

    if (newText !== oldTextEdit.newText && newText.trim() !== '') {
      textEdit.newText = newText;
      execute({ type: 'modifyTextEdit', oldTextEdit, newTextEdit: { ...textEdit } });
      markDocumentModified();

      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }

    activeEditor = null;
    state.pdfTextEditState = null;
    hideProperties();
  };

  const cancelEditing = () => {
    hidePdfTextEditor();
    activeEditor = null;
    state.pdfTextEditState = null;
    hideProperties();
  };

  activeEditor = {
    block: { spans: [] },
    pageNum,
    originalText: textEdit.newText,
    pdfX: textEdit.pdfX,
    pdfY: textEdit.pdfY,
    pdfWidth: textEdit.pdfWidth || 0,
    fontSize,
    lineSpacing: ls,
    numOriginalLines: numLines,
    _finishEditing: finishEditing,
    _cancelEditing: cancelEditing
  };
  state.pdfTextEditState = activeEditor;

  // Show text properties in the right panel
  const ffLower = (textEdit.fontFamily || 'Helvetica').toLowerCase();
  showTextEditProperties({
    text: textEdit.newText,
    fontSize: textEdit.fontSize,
    fontFamily: textEdit.fontFamily || 'Helvetica',
    color: textEdit.color || '#000000',
    isBold: ffLower.includes('bold'),
    isItalic: ffLower.includes('italic') || ffLower.includes('oblique'),
    page: pageNum
  });

  // Define handlers for the store
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancelEditing();
    }
    if (e.key === 'Enter' && !e.shiftKey && numLines === 1) {
      e.preventDefault();
      e.stopPropagation();
      finishEditing();
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (activeEditor && activeEditor._finishEditing === finishEditing) {
        // Don't close if focus moved to the properties panel.
        // Use the static mount point from index.html (not the Solid-rendered element).
        const activeEl = document.activeElement;
        const propsRoot = document.getElementById('properties-panel-root');
        if (activeEl && propsRoot && propsRoot.contains(activeEl)) {
          return;
        }
        finishEditing();
      }
    }, 150);
  };

  showPdfTextEditor(styleObj, textEdit.newText, {
    onCommit: null,
    onCancel: null,
    onKeyDown: handleKeyDown,
    onBlur: handleBlur
  });
}

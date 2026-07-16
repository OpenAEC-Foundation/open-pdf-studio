import { state, getActiveDocument, getPageRotation } from '../core/state.js';
import { execute } from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { showTextEditProperties, hideProperties } from '../ui/panels/properties-panel.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { canvasContainer, continuousContainer, pdfCanvas } from '../ui/dom-elements.js';
import { showPdfTextEditor, hidePdfTextEditor, getPdfEditorText as getEditorText,
  updatePdfEditorStyle, shiftPdfEditorPosition } from '../bridge.js';
import { injectSyntheticTextSpans } from '../text/text-layer.js';
import {
  applyPageRotation,
  getPageRotationMatrix,
  invertPageRotation,
  restoreTextEditSnapshot,
  resolveTextEditPageGeometry,
  sampleTextColor,
} from '../text/text-edit-appearance.js';

let activeEditor = null;
let hoverListeners = [];
let textLayerObserver = null;
let blockGroupsCache = new Map();
// WeakMap: span -> block group, for fast lookup on hover/click
let spanToBlock = new WeakMap();

// ── Font mapping shared by the text-edit sessions ──
// Map a display / actual font name + bold/italic flags to a pdf-lib StandardFont
// name (the value stored on the text-edit record and used by the saver).
function toStandardFontName(displayName, isBold, isItalic) {
  const n = (displayName || '').toLowerCase();
  if (n.includes('courier') || n.includes('consolas') || n.includes('mono')) {
    return isBold && isItalic ? 'Courier-BoldOblique'
      : isBold ? 'Courier-Bold'
      : isItalic ? 'Courier-Oblique'
      : 'Courier';
  }
  if (n.includes('times') || n.includes('garamond') || n.includes('georgia')
      || n.includes('palatino') || n.includes('cambria') || n.includes('bookman') || n.includes('serif')) {
    return isBold && isItalic ? 'TimesRoman-BoldItalic'
      : isBold ? 'TimesRoman-Bold'
      : isItalic ? 'TimesRoman-Italic'
      : 'TimesRoman';
  }
  return isBold && isItalic ? 'Helvetica-BoldOblique'
    : isBold ? 'Helvetica-Bold'
    : isItalic ? 'Helvetica-Oblique'
    : 'Helvetica';
}

// CSS font-family for the live editor / synthetic span, from a font name.
function cssFamilyFor(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('courier') || n.includes('consolas') || n.includes('mono')) return '"Courier New", Courier, monospace';
  if (n.includes('times') || n.includes('garamond') || n.includes('georgia')
      || n.includes('palatino') || n.includes('cambria') || n.includes('bookman') || n.includes('serif')) return '"Times New Roman", Times, serif';
  return 'Helvetica, Arial, sans-serif';
}

// Re-inject the synthetic text-layer spans for added text on a page (after the
// record's content/style/position changed) and repaint the annotation canvas.
function reRenderAddedText(pageNum) {
  const textLayer = document.querySelector(`.textLayer[data-page="${pageNum}"]`)
    || document.querySelector('.textLayer');
  const canvasEl = textLayer?.parentElement?.querySelector('canvas.pdf-canvas')
    || pdfCanvas || document.getElementById('pdf-canvas');
  if (textLayer && canvasEl) {
    const sc = getActiveDocument()?.scale || 1.5;
    const pw = canvasEl.width / sc;
    const ph = canvasEl.height / sc;
    injectSyntheticTextSpans(textLayer, pageNum, pw, ph);
  }
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// Apply the accumulated style state (family/size/colour/bold/italic) onto a
// text-edit record. Returns true when any field actually changed.
function applyStyleStateToRecord(rec, st) {
  if (!rec || !st) return false;
  let changed = false;
  if (st.size != null && rec.fontSize !== st.size) { rec.fontSize = st.size; rec.lineSpacing = st.size * 1.2; changed = true; }
  if (st.color != null && rec.color !== st.color) { rec.color = st.color; changed = true; }
  const std = toStandardFontName(st.family, st.bold, st.italic);
  if (rec.fontFamily !== std) { rec.fontFamily = std; changed = true; }
  return changed;
}

// Live-update the open editor's CSS from the style state (colour/weight/style/
// family — size is left to the record re-render so the box geometry stays put).
function applyStyleStateToEditor(st) {
  if (!st) return;
  updatePdfEditorStyle({
    color: st.color || '#000000',
    'font-weight': st.bold ? 'bold' : 'normal',
    'font-style': st.italic ? 'italic' : 'normal',
    'font-family': cssFamilyFor(st.family),
  });
}

function getTextEditGeometry(pageNum, canvasEl) {
  const doc = getActiveDocument();
  const scale = doc?.scale || 1;
  const dpr = window.devicePixelRatio || 1;
  const displayWidth = canvasEl?.width ? canvasEl.width / (scale * dpr) : 0;
  const displayHeight = canvasEl?.height ? canvasEl.height / (scale * dpr) : 0;
  return resolveTextEditPageGeometry(
    doc?.pageDims?.[pageNum],
    displayWidth,
    displayHeight,
    getPageRotation(pageNum),
  );
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

      const color = sampleTextColor(pdfCanvasEl, firstSpan.getBoundingClientRect());

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

    const pageNum = parseInt(layer.dataset.page) || (getActiveDocument()?.currentPage || 1);
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

  // Added text (synthetic span) → re-open the SAME textEdit record instead of
  // creating a duplicate edit-of-an-edit. This makes inserted text properly
  // re-editable (content, style, position, delete) via startTextEditEditing.
  const editId = span.dataset.editId;
  if (editId) {
    const doc = getActiveDocument();
    const rec = doc?.textEdits?.find(e => String(e.id) === editId);
    if (rec) {
      const canvasEl = textLayer.parentElement?.querySelector('canvas.pdf-canvas')
        || pdfCanvas || document.getElementById('pdf-canvas');
      if (canvasEl) { startTextEditEditing(rec, pageNum, canvasEl); return; }
    }
  }

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
    kind: 'existingText',
    originalText: combinedText,
    pdfX,
    pdfY,
    pdfWidth,
    fontSize,
    lineSpacing,
    numOriginalLines: lineData.length,
    scale: getActiveDocument()?.scale || 1.5,
    // Accumulated style state edited via the properties panel; seeded from the
    // block's detected formatting. Persisted onto the edit record on commit.
    styleState: {
      family: lineData[0].actualFontName || lineData[0].pdfFontName || cssFallbackFont,
      size: fontSize,
      color: lineData[0].color || '#000000',
      bold: lineData[0].isBold || false,
      italic: lineData[0].isItalic || false,
    },
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
      return;
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
    pdfX, pdfY, pdfWidth, fontSize, lineSpacing, numOriginalLines, styleState
  } = activeEditor;
  const newText = getEditorText();

  hidePdfTextEditor();

  // Show all spans again
  for (const s of block.spans) s.style.visibility = '';

  const st = styleState || {};
  // Did the panel change any formatting relative to the detected block style?
  const styleChanged =
    (st.size != null && st.size !== fontSize) ||
    (st.color != null && st.color !== (block.lineData[0].color || '#000000')) ||
    (st.bold != null && st.bold !== (block.lineData[0].isBold || false)) ||
    (st.italic != null && st.italic !== (block.lineData[0].isItalic || false));

  // Persist when the text OR the formatting changed (a pure re-style of
  // existing PDF text must be saveable too).
  if ((newText !== originalText || styleChanged) && newText.trim() !== '') {
    const { lineData } = block;
    const pdfFontName = lineData[0].pdfFontName || '';

    // Final formatting: panel-edited style state wins over the detected block
    // style (seeded identically, so unchanged edits reproduce the original).
    const finalSize = st.size != null ? st.size : fontSize;
    const finalColor = st.color != null ? st.color : (lineData[0].color || '#000000');
    const finalBold = st.bold != null ? st.bold : (lineData[0].isBold || false);
    const finalItalic = st.italic != null ? st.italic : (lineData[0].isItalic || false);
    const fontFamily = toStandardFontName(
      st.family != null ? st.family : (lineData[0].actualFontName || lineData[0].fontFamily),
      finalBold, finalItalic
    );
    // Capture original span texts before modifying
    const originalSpanTexts = lineData.map(ld =>
      ld.spans.map(s => s.textContent)
    );

    // Store the PDF.js loaded font name for canvas rendering (exact visual
    // match). Drop it when the family/weight was changed in the panel so the
    // new StandardFont is used instead of the stale embedded font.
    const loadedFontName = (st.family != null || finalBold !== (lineData[0].isBold || false)
      || finalItalic !== (lineData[0].isItalic || false)) ? '' : (lineData[0].loadedFontName || '');

    const editRecord = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      page: pageNum,
      originalText,
      newText,
      pdfX,
      pdfY,
      pdfWidth,
      fontSize: finalSize,
      lineSpacing,
      numOriginalLines,
      fontFamily,
      loadedFontName,
      pdfFontName,
      color: finalColor,
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

      if (getActiveDocument()?.viewMode === 'continuous') {
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

  if (activeEditor._cancelEditing) {
    activeEditor._cancelEditing();
    return;
  }

  const { block } = activeEditor;
  hidePdfTextEditor();
  for (const s of block.spans) s.style.visibility = '';

  activeEditor = null;
  state.pdfTextEditState = null;
  hideProperties();
}

/**
 * Programmatically replace text within a single span on the current page.
 * Used by Find & Replace. Uses the span's own PDF coordinates and font data
 * so the cover rectangle matches only that span, not the entire text block.
 *
 * @param {number} pageNum - Page number
 * @param {string} originalText - The original span text
 * @param {string} newText - The replacement span text
 * @param {HTMLElement} matchSpan - The span element containing the text to replace
 * @returns {{ editRecord: Object } | null}
 */
export function createReplaceTextEdit(pageNum, originalText, newText, matchSpan) {
  // Read PDF coordinates directly from the span's data attributes
  let transform;
  try {
    transform = JSON.parse(matchSpan.dataset.pdfTransform);
  } catch (_) {
    return null;
  }
  if (!transform) return null;

  const fontSize = Math.sqrt(transform[2] ** 2 + transform[3] ** 2) || 12;
  const pdfX = transform[4];
  const pdfY = transform[5]; // baseline Y in PDF space
  const pdfWidth = parseFloat(matchSpan.dataset.pdfWidth) || fontSize * originalText.length * 0.5;

  // Detect font from span data attributes (set by text-layer.js)
  const pdfFontFamily = matchSpan.dataset.pdfFontFamily || 'sans-serif';
  const actualFontName = matchSpan.dataset.pdfActualFontName || '';
  const loadedFontName = matchSpan.dataset.pdfLoadedFontName || '';
  const pdfFontName = matchSpan.dataset.pdfFontName || '';
  const isBold = matchSpan.dataset.pdfBold === 'true';
  const isItalic = matchSpan.dataset.pdfItalic === 'true';

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

  const textLayer = matchSpan.closest('.textLayer');
  const canvasEl = textLayer?.parentElement?.querySelector('canvas.pdf-canvas')
    || document.getElementById('pdf-canvas');
  const color = sampleTextColor(canvasEl, matchSpan.getBoundingClientRect());

  const editRecord = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    page: pageNum,
    originalText,
    newText,
    pdfX,
    pdfY,
    pdfWidth,
    fontSize: Math.round(fontSize),
    lineSpacing: fontSize * 1.2,
    numOriginalLines: 1,
    fontFamily,
    loadedFontName,
    pdfFontName,
    color,
    originalSpanTexts: [[originalText]]
  };

  // Update span text visually
  matchSpan.textContent = newText;

  return { editRecord };
}

export function findTextEditAtPosition(x, y, pageNum, canvasEl) {
  const doc = getActiveDocument();
  if (!doc || !doc.textEdits || doc.textEdits.length === 0) return null;

  const pageEdits = doc.textEdits.filter(e => e.page === pageNum);
  if (pageEdits.length === 0) return null;

  const geometry = getTextEditGeometry(pageNum, canvasEl);
  const unrotatedPoint = invertPageRotation(
    x,
    y,
    geometry.pageWidth,
    geometry.pageHeight,
    geometry.rotation,
  );
  const pageHeight = geometry.pageHeight;

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

    if (unrotatedPoint.x >= editLeft && unrotatedPoint.x <= editLeft + editWidth &&
        unrotatedPoint.y >= editTop && unrotatedPoint.y <= editTop + editHeight) {
      return edit;
    }
  }
  return null;
}

export function startTextEditEditing(textEdit, pageNum, canvasEl) {
  finishPdfTextEditing();

  const editDoc = getActiveDocument();
  const editScale = editDoc?.scale || 1.5;
  const geometry = getTextEditGeometry(pageNum, canvasEl);
  const pageHeight = geometry.pageHeight;
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
  const rotatedTopLeft = applyPageRotation(
    textEdit.pdfX,
    editTop,
    geometry.pageWidth,
    geometry.pageHeight,
    geometry.rotation,
  );
  const scaledLeft = rotatedTopLeft.x * editScale;
  const scaledTop = rotatedTopLeft.y * editScale;
  const scaledWidth = editWidth * editScale;
  const scaledHeight = editHeight * editScale;
  const editorFontSize = Math.round(fontSize * editScale * 0.82);
  const visualLineHeight = (scaledHeight / numLines);
  const activeViewport = window.__pdfViewport;
  const useViewport = activeViewport?.active && editDoc?.filePath;
  const pageOffsetX = useViewport ? activeViewport.offsetX : offsetX;
  const pageOffsetY = useViewport ? activeViewport.offsetY : offsetY;

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
    left: `${containerRect.left + scaledLeft + pageOffsetX - padX}px`,
    top: `${containerRect.top + scaledTop + pageOffsetY - padY}px`,
    width: `${Math.max(scaledWidth + padX * 2 + 4, 80)}px`,
    height: `${Math.max(scaledHeight + padY * 2 + 6, 24)}px`,
    'font-size': `${editorFontSize}px`,
    'line-height': `${visualLineHeight}px`,
    'font-family': cssFontFamily,
    color: textEdit.color || '#000000',
    transform: `rotate(${geometry.rotation}deg)`,
    'transform-origin': '0 0',
    'z-index': '1000'
  };
  if (ff.includes('bold')) styleObj['font-weight'] = 'bold';
  if (ff.includes('italic') || ff.includes('oblique')) styleObj['font-style'] = 'italic';

  const oldTextEdit = { ...textEdit };
  const isAddedText = oldTextEdit.originalText === '';

  const finishEditing = () => {
    const newText = getEditorText();
    hidePdfTextEditor();

    // Clearing all the text of an INSERTED edit deletes it entirely — this is
    // how the user removes inserted text (issue #264).
    if (isAddedText && newText.trim() === '') {
      removeTextEditRecord(textEdit);
      activeEditor = null;
      state.pdfTextEditState = null;
      hideProperties();
      return;
    }

    if (newText.trim() !== '') textEdit.newText = newText;
    // Persist when content, style, or position changed. Style/position edits
    // were applied live to `textEdit`, so compare the whole record.
    const changed = JSON.stringify({ ...textEdit }) !== JSON.stringify(oldTextEdit);
    if (changed) {
      execute({ type: 'modifyTextEdit', oldTextEdit, newTextEdit: { ...textEdit } });
      markDocumentModified();
      reRenderAddedText(pageNum);
    }

    activeEditor = null;
    state.pdfTextEditState = null;
    hideProperties();
  };

  const cancelEditing = () => {
    restoreTextEditSnapshot(textEdit, oldTextEdit);
    hidePdfTextEditor();
    reRenderAddedText(pageNum);
    activeEditor = null;
    state.pdfTextEditState = null;
    hideProperties();
  };

  activeEditor = {
    block: { spans: [] },
    pageNum,
    kind: 'record',
    _recordRef: textEdit,
    originalText: textEdit.newText,
    pdfX: textEdit.pdfX,
    pdfY: textEdit.pdfY,
    pdfWidth: textEdit.pdfWidth || 0,
    fontSize,
    lineSpacing: ls,
    numOriginalLines: numLines,
    scale: editScale,
    styleState: {
      family: textEdit.fontFamily || 'Helvetica',
      size: textEdit.fontSize,
      color: textEdit.color || '#000000',
      bold: ff.includes('bold'),
      italic: ff.includes('italic') || ff.includes('oblique'),
    },
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
      return;
    }
    // Alt+Arrow nudges the inserted text (Alt keeps normal caret arrows free).
    if (e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 5 : 1;
      nudgeActiveTextEdit(
        e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
      );
      return;
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

// ── Management of the ACTIVE text edit (called from the properties panel) ──

// Apply a formatting change from the properties panel to the text edit that is
// currently open in the inline editor. Works for both inserted text (a live
// textEdit record) and existing PDF text (persisted on commit).
export function applyActiveTextEditStyle(key, value) {
  if (!activeEditor || !activeEditor.styleState) return;
  const st = activeEditor.styleState;
  switch (key) {
    case 'fontFamily': st.family = value; break;
    case 'textFontSize':
    case 'fontSize': { const n = parseInt(value); if (!isNaN(n) && n > 0) st.size = n; break; }
    case 'textColor':
    case 'color': st.color = value; break;
    case 'fontBold': st.bold = !!value; break;
    case 'fontItalic': st.italic = !!value; break;
    default: return;
  }
  applyStyleStateToEditor(st);
  // Record sessions (inserted text or an existing edit record) update live so
  // the user sees the restyle immediately.
  if (activeEditor._recordRef) {
    applyStyleStateToRecord(activeEditor._recordRef, st);
    reRenderAddedText(activeEditor._recordRef.page);
  }
}

// Delete the text edit that is currently open in the inline editor.
export function deleteActiveTextEdit() {
  if (!activeEditor) return;
  hidePdfTextEditor();
  // Restore any spans the existing-text session hid.
  if (activeEditor.block && activeEditor.block.spans) {
    for (const s of activeEditor.block.spans) s.style.visibility = '';
  }
  if (activeEditor._recordRef) {
    // Inserted text / existing edit record → drop the record.
    removeTextEditRecord(activeEditor._recordRef);
  } else if (activeEditor.kind === 'existingText' && activeEditor.originalText) {
    // Existing PDF text with no record yet → cover it (empty replacement) so
    // the underlying text is removed from the page on save.
    coverExistingText(activeEditor);
  }
  activeEditor = null;
  state.pdfTextEditState = null;
  hideProperties();
}

// Move the active text edit by a PDF-unit delta (Alt+Arrow keys).
function nudgeActiveTextEdit(dxPdf, dyPdf) {
  if (!activeEditor) return;
  const scale = activeEditor.scale || (getActiveDocument()?.scale || 1.5);
  // Convert the PDF-space nudge into the rotated display frame.
  const canvasEl = pdfCanvas || document.getElementById('pdf-canvas');
  const geometry = getTextEditGeometry(activeEditor.pageNum, canvasEl);
  const [a, b, c, d] = getPageRotationMatrix(
    geometry.pageWidth,
    geometry.pageHeight,
    geometry.rotation,
  );
  const unrotatedDy = -dyPdf;
  shiftPdfEditorPosition(
    (a * dxPdf + c * unrotatedDy) * scale,
    (b * dxPdf + d * unrotatedDy) * scale,
  );
  if (activeEditor._recordRef) {
    activeEditor._recordRef.pdfX += dxPdf;
    activeEditor._recordRef.pdfY += dyPdf;
    reRenderAddedText(activeEditor._recordRef.page);
  } else {
    // Existing-text session: coords are read from activeEditor on commit.
    activeEditor.pdfX += dxPdf;
    activeEditor.pdfY += dyPdf;
  }
}

// Remove a textEdit record from the document (undoable).
function removeTextEditRecord(rec) {
  const doc = getActiveDocument();
  if (!doc || !doc.textEdits) return;
  const index = doc.textEdits.findIndex(e => e.id === rec.id);
  if (index === -1) return;
  execute({ type: 'removeTextEdit', textEdit: { ...rec }, index });
  markDocumentModified();
  reRenderAddedText(rec.page);
}

// Cover existing PDF text with an empty replacement edit (deletes the text).
function coverExistingText(ed) {
  const { block, pageNum, originalText, pdfX, pdfY, pdfWidth, fontSize, lineSpacing, numOriginalLines, styleState } = ed;
  if (!originalText) return;
  const st = styleState || {};
  const doc = getActiveDocument();
  if (!doc) return;

  const editRecord = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    page: pageNum,
    originalText,
    newText: '',
    pdfX, pdfY, pdfWidth,
    fontSize: st.size != null ? st.size : fontSize,
    lineSpacing,
    numOriginalLines,
    fontFamily: toStandardFontName(
      st.family != null ? st.family : (block.lineData[0].actualFontName || block.lineData[0].fontFamily),
      st.bold || false, st.italic || false
    ),
    loadedFontName: '',
    pdfFontName: block.lineData[0].pdfFontName || '',
    color: st.color != null ? st.color : (block.lineData[0].color || '#000000'),
    originalSpanTexts: block.lineData.map(ld => ld.spans.map(s => s.textContent)),
  };

  if (!doc.textEdits) doc.textEdits = [];
  doc.textEdits.push(editRecord);
  // Blank the covered spans in the text layer.
  for (const ld of block.lineData) for (const s of ld.spans) s.textContent = '';
  execute({ type: 'addTextEdit', textEdit: { ...editRecord } });
  markDocumentModified();
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

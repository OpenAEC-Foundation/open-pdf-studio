import { state, getActiveDocument } from '../core/state.js';
import { execute } from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';

let activeEditor = null;
let hoverListeners = [];
let textLayerObserver = null;
let blockGroupsCache = new Map();
// WeakMap: span -> block group, for fast lookup on hover/click
let spanToBlock = new WeakMap();

export function activateEditTextTool() {
  state.isEditingPdfText = true;
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
}

// ── MutationObserver: re-attach when text layers are recreated ──

function startObservingTextLayers() {
  stopObservingTextLayers();
  const container = document.getElementById('canvas-container');
  const continuous = document.getElementById('continuous-container');
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

  // ── Step 2: group consecutive lines into blocks ──
  //
  // Two adjacent lines belong to the same block only when ALL of:
  //   a) font sizes match closely   (ratio > 0.92)
  //   b) baseline gap is reasonable  (0.5× – 1.8× fontSize)
  //   c) left edges are aligned      (within 1× fontSize)
  const blocks = [];
  let curBlock = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prevLine = curBlock[curBlock.length - 1];
    const nextLine = lines[i];

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
  const groups = blocks.map(block => {
    const allItems = block.flat();
    const allSpans = allItems.map(it => it.span);

    // DOM bounding rect (for editor placement)
    const minLeft = Math.min(...allItems.map(it => it.domLeft));
    const minTop = Math.min(...allItems.map(it => it.domTop));
    const maxRight = Math.max(...allItems.map(it => it.domRight));
    const maxBottom = Math.max(...allItems.map(it => it.domBottom));

    const lineData = block.map(lineItems => ({
      text: lineItems.map(it => it.span.textContent).join(''),
      pdfX: lineItems[0].pdfX,
      pdfY: lineItems[0].pdfY,
      pdfWidth: lineItems.reduce((s, it) => s + it.pdfWidth, 0),
      fontSize: lineItems[0].fontSize,
      spans: lineItems.map(it => it.span)
    }));

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
  for (const h of hoverListeners) {
    h.span.removeEventListener('mouseenter', h.enter);
    h.span.removeEventListener('mouseleave', h.leave);
    h.span.removeEventListener('click', h.click);
    h.span.classList.remove('edit-text-hoverable', 'edit-text-block-hover');
    h.span.style.pointerEvents = '';
    h.span.style.cursor = '';
  }
  hoverListeners = [];

  document.querySelectorAll('.textLayer').forEach(layer => {
    layer.style.pointerEvents = '';
  });
}

// ── Inline editor ──

function startPdfTextEditing(span, pageNum) {
  finishPdfTextEditing();

  const container = span.closest('.textLayer');
  if (!container) return;

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

  // Create multi-line editor covering the whole block
  const editor = document.createElement('textarea');
  editor.className = 'pdf-text-editor';
  editor.value = combinedText;
  editor.style.position = 'absolute';
  editor.style.left = `${groupRect.left}px`;
  editor.style.top = `${groupRect.top}px`;
  editor.style.width = `${Math.max(groupRect.width + 4, 80)}px`;
  editor.style.height = `${Math.max(groupRect.height + 6, 24)}px`;
  editor.style.fontSize = `${editorFontSize}px`;
  editor.style.lineHeight = `${visualLineHeight}px`;
  editor.style.fontFamily = 'sans-serif';
  editor.style.zIndex = '1000';

  // Hide all spans BEFORE appending editor so text doesn't double-render
  for (const s of block.spans) s.style.visibility = 'hidden';

  container.appendChild(editor);
  editor.focus();
  editor.select();

  activeEditor = {
    editor,
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

  editor.addEventListener('keydown', (e) => {
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
  });

  editor.addEventListener('blur', () => {
    setTimeout(() => {
      if (activeEditor && activeEditor.editor === editor) {
        finishPdfTextEditing();
      }
    }, 150);
  });
}

function finishPdfTextEditing() {
  if (!activeEditor) return;

  const {
    editor, block, pageNum, originalText,
    pdfX, pdfY, pdfWidth, fontSize, lineSpacing, numOriginalLines
  } = activeEditor;
  const newText = editor.value;

  editor.remove();

  // Show all spans again
  for (const s of block.spans) s.style.visibility = '';

  if (newText !== originalText && newText.trim() !== '') {
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
      fontFamily: 'Helvetica',
      color: '#000000'
    };

    const doc = getActiveDocument();
    if (doc) {
      if (!doc.textEdits) doc.textEdits = [];
      doc.textEdits.push(editRecord);

      // Update span text visually: put all new text in first span, blank the rest
      const { lineData } = block;
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

      execute({ type: 'addTextEdit', textEdit: { ...editRecord } });
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
}

function cancelPdfTextEditing() {
  if (!activeEditor) return;

  const { editor, block } = activeEditor;
  editor.remove();
  for (const s of block.spans) s.style.visibility = '';

  activeEditor = null;
  state.pdfTextEditState = null;
}

import { state, getActiveDocument, getPageRotation } from '../core/state.js';
import { execute } from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { showTextEditProperties, hideProperties } from '../ui/panels/properties-panel.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { canvasContainer, continuousContainer, pdfCanvas } from '../ui/dom-elements.js';
import { showPdfTextEditor, hidePdfTextEditor, getPdfEditorText as getEditorText,
  getPdfEditorLineRuns as getEditorLineRuns,
  updatePdfEditorStyle, shiftPdfEditorPosition } from '../bridge.js';
import { injectSyntheticTextSpans, resolveTextLayerFonts } from '../text/text-layer.js';
import {
  applyPageRotation,
  getPageRotationMatrix,
  invertPageRotation,
  restoreTextEditSnapshot,
  resolveTextEditPageGeometry,
  sampleTextColor,
  buildLineSegments,
  DEFAULT_TAB_GRID_PT,
  layoutSegmentsOnTabGrid,
  normalizeBulletText,
  resolveTextEditLineStyle,
  splitRunsIntoSegments,
  textEditAngleFromTransform,
  reflowBlockLines,
  detectBlockAlignment,
  normalizeRuns,
  pdfDeltaFromScreenDelta,
  nieuwTekstblokRecord,
} from '../text/text-edit-appearance.js';

let activeEditor = null;
let hoverListeners = [];
let textLayerObserver = null;
// Cache per laag en per groeperingsmodus. 'strict' (standaard klik) groepeert
// behoudend: harde grens bij font-/vetheidswissel (kop vs broodtekst), bij een
// regelafstand-sprong en bij tabelachtige structuren (opeenvolgende regels met
// kolom-segmenten worden per rij gegroepeerd). 'loose' is de ruime, oude
// groepering — bereikbaar met Ctrl/Cmd+klik voor wie het hele blok wil pakken.
let blockGroupsCache = new Map(); // layer -> { strict: groups|null, loose: groups|null }
// WeakMap per modus: span -> blokgroep, voor snelle lookup bij hover/klik
let spanToBlockByMode = { strict: new WeakMap(), loose: new WeakMap() };

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

function isInternalPdfFontName(name) {
  return /^g_d\d+_f\d+$/i.test(name || '');
}

function editableFontName(line, cssFallbackFont) {
  if (line.actualFontName) return line.actualFontName;
  if (line.pdfFontName && !isInternalPdfFontName(line.pdfFontName)) return line.pdfFontName;
  if ((line.fontFamily || '').toLowerCase() === 'monospace') return 'Courier New';
  if ((line.fontFamily || '').toLowerCase() === 'serif') return 'Times New Roman';
  return cssFallbackFont.includes('Courier') ? 'Courier New'
    : cssFallbackFont.includes('Times') ? 'Times New Roman'
    : 'Arial';
}

// Meest voorkomende kolomoffset (afgerond op 0.5pt-clusters) — één CSS
// tab-size kan maar één raster aan; de dominante kolom laat de meeste regels
// exact uitlijnen. Bij gelijkspel wint de kleinste offset.
function dominantColumnOffset(offsets) {
  if (!offsets || offsets.length === 0) return 0;
  const telling = new Map();
  for (const v of offsets) {
    const key = Math.round(v * 2) / 2;
    telling.set(key, (telling.get(key) || 0) + 1);
  }
  let beste = 0;
  let besteN = 0;
  for (const [key, n] of telling) {
    if (n > besteN || (n === besteN && key < beste)) { beste = key; besteN = n; }
  }
  return beste;
}

// CSS-fallback-keten voor een familie-klasse (zelfde mapping als de editor).
function cssFallbackFor(actualNameLower, fallbackLower) {
  if (actualNameLower.includes('courier') || actualNameLower.includes('consolas')
      || actualNameLower.includes('mono') || fallbackLower === 'monospace') {
    return '"Courier New", Courier, monospace';
  }
  if (actualNameLower.includes('times') || actualNameLower.includes('garamond')
      || actualNameLower.includes('georgia') || actualNameLower.includes('palatino')
      || actualNameLower.includes('cambria') || actualNameLower.includes('bookman')
      || fallbackLower === 'serif') {
    return '"Times New Roman", Times, serif';
  }
  return 'Helvetica, Arial, sans-serif';
}

// Font-family-keten voor een tekstlaag-regel: het door PDF.js geladen
// (embedded) font eerst, met de standaardfamilie als nette terugval.
function lineEditorFontFamily(ld) {
  const loaded = ld?.loadedFontName || '';
  const fb = cssFallbackFor(
    String(ld?.actualFontName || '').toLowerCase(),
    String(ld?.fontFamily || 'sans-serif').toLowerCase(),
  );
  return loaded ? `"${loaded}", ${fb}` : fb;
}

// Tekstbreedte in PDF-punten, gemeten met dezelfde font-keten als de editor
// toont (canvas-px bij font-size in punten == punten).
function measureTextWidthPt(text, family, sizePt, bold, italic) {
  if (!fontMetricsContext) {
    fontMetricsContext = document.createElement('canvas').getContext('2d');
  }
  if (!fontMetricsContext) return String(text || '').length * sizePt * 0.5;
  const w = bold ? 'bold ' : '';
  const st = italic ? 'italic ' : '';
  fontMetricsContext.font = `${st}${w}${sizePt}px ${family}`;
  return fontMetricsContext.measureText(String(text || '')).width;
}

// Laatste pointerdown-doel in het document: het blur-commit-pad gebruikt dit
// om kliks op opmaak-UI (paneel, kleurkiezers, ribbon) NIET als 'klik buiten'
// te behandelen. Een blur zonder voorafgaande pointerdown (bv. een native
// kleur-dialoog die focus steelt) commit evenmin.
// Laatste (niet-collapsed) selectie binnen de tekst-editor: een klik op het
// eigenschappenpaneel laat de live selectie collapsen voordat de kleurkeuze
// binnenkomt; met deze snapshot kleuren we alsnog precies de woorden die de
// gebruiker geselecteerd had.
let lastEditorSelectionRange = null;
let lastEditorSelectionAt = 0;
let lastEditorCaretRange = null;
let lastEditorCaretAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('selectionchange', () => {
    const ed = document.querySelector('.pdf-text-editor');
    if (!ed) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!ed.contains(range.commonAncestorContainer)) return;
    if (range.collapsed) {
      lastEditorCaretRange = range.cloneRange();
      lastEditorCaretAt = Date.now();
    } else {
      lastEditorSelectionRange = range.cloneRange();
      lastEditorSelectionAt = Date.now();
    }
  });
}

let lastPointerDownTarget = null;
let lastPointerDownAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    lastPointerDownTarget = e.target;
    lastPointerDownAt = Date.now();
    // Klik buiten de editor en buiten de opmaak-UI = COMMIT — direct op de
    // pointerdown, want op blur is niet te vertrouwen: het canvas-mousedown-
    // pad doet preventDefault, waardoor de contenteditable zijn focus (en
    // dus zijn blur-event) nooit verliest en een zojuist getypte wijziging
    // "nergens verscheen" bij wegklikken. Kliks op een ander tekstblok
    // committen hier ook eerst; de klik opent daarna gewoon het volgende
    // blok. Kliks in het paneel/ribbon/kleurkiezers (KEEP_EDITOR_SELECTOR)
    // laten de editor met rust, net als voorheen.
    if (activeEditor) {
      const t = e.target;
      const inEditorOfOpmaak = t && t.closest && t.closest(KEEP_EDITOR_SELECTOR);
      if (!inEditorOfOpmaak) finishPdfTextEditing();
    }
  }, true);
}

const KEEP_EDITOR_SELECTOR = [
  '#properties-panel-root',
  '.properties-panel-outer',
  '.properties-panel',
  '.pdf-text-editor',
  '.ribbon',
  '[class*="ribbon"]',
  '[class*="color-picker"]',
  '[class*="color-palette"]',
  '[class*="colorPicker"]',
  'input[type="color"]',
  '[data-keep-text-editor]',
].join(', ');

// Mag het blur-commit-pad de editor sluiten? Nee wanneer de focus of de
// laatste klik in opmaak-UI ligt, of wanneer er helemaal geen klik was
// (native dialoog).
function blurShouldCommit() {
  const activeEl = document.activeElement;
  if (activeEl && activeEl !== document.body && activeEl.closest
      && activeEl.closest(KEEP_EDITOR_SELECTOR)) return false;
  const recentClick = Date.now() - lastPointerDownAt < 1500;
  if (!recentClick) return false;
  const t = lastPointerDownTarget;
  if (t && t.closest && t.closest(KEEP_EDITOR_SELECTOR)) return false;
  return true;
}

let fontMetricsContext = null;

// Return the browser baseline offset inside a CSS line box. Canvas and CSS use
// the same font metrics, so anchoring the textarea by its baseline keeps its
// glyphs on top of the PDF canvas glyphs instead of relying on a magic offset.
function cssBaselineOffset(fontFamily, fontSize, lineHeight, isBold = false, isItalic = false) {
  if (!fontMetricsContext) {
    fontMetricsContext = document.createElement('canvas').getContext('2d');
  }
  if (!fontMetricsContext) return fontSize * 0.8 + (lineHeight - fontSize) / 2;

  const fontWeight = isBold ? 'bold ' : '';
  const fontStyle = isItalic ? 'italic ' : '';
  fontMetricsContext.font = `${fontStyle}${fontWeight}${fontSize}px ${fontFamily}`;
  const metrics = fontMetricsContext.measureText('Mg');
  const ascent = Number.isFinite(metrics.fontBoundingBoxAscent)
    ? metrics.fontBoundingBoxAscent
    : (metrics.actualBoundingBoxAscent || fontSize * 0.8);
  const descent = Number.isFinite(metrics.fontBoundingBoxDescent)
    ? metrics.fontBoundingBoxDescent
    : (metrics.actualBoundingBoxDescent || fontSize * 0.2);
  return ascent + (lineHeight - ascent - descent) / 2;
}

// Re-inject the synthetic text-layer spans for added text on a page (after the
// record's content/style/position changed) and repaint the annotation canvas.
function reRenderAddedText(pageNum) {
  const textLayer = document.querySelector(`.textLayer[data-page="${pageNum}"]`)
    || document.querySelector('.textLayer');
  const canvasEl = textLayer?.parentElement?.querySelector('canvas.pdf-canvas')
    || pdfCanvas || document.getElementById('pdf-canvas');
  if (textLayer && canvasEl) {
    const doc = getActiveDocument();
    const vp = window.__pdfViewport;
    const useViewport = vp?.active && doc?.filePath && vp.pageW > 0 && vp.pageH > 0;
    const sc = doc?.scale || 1.5;
    const pw = useViewport ? vp.pageW : canvasEl.width / sc;
    const ph = useViewport ? vp.pageH : canvasEl.height / sc;
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
  if (st.underline != null && rec.fontUnderline !== st.underline) { rec.fontUnderline = st.underline; changed = true; }
  if (st.strikethrough != null && rec.fontStrikethrough !== st.strikethrough) { rec.fontStrikethrough = st.strikethrough; changed = true; }
  const std = toStandardFontName(st.family, st.bold, st.italic);
  if (rec.fontFamily !== std) { rec.fontFamily = std; changed = true; }
  // Een record-brede stijlwijziging vervangt de per-regel stijlen — anders
  // zouden de oude lineStyles de nieuwe uniforme stijl blijven overrulen.
  if (changed && rec.lineStyles) delete rec.lineStyles;
  if (changed && rec.baked) delete rec.baked;
  // Stijl geldt record-breed: eerder als 'ongewijzigd' gemarkeerde regels
  // moeten nu wél hertekend worden.
  if (changed && rec.unchangedLines) delete rec.unchangedLines;
  return changed;
}

// Live-update the open editor's CSS and keep its baseline anchored while font
// metrics or line height change.
function applyStyleStateToEditor(st) {
  if (!st) return;
  const decorations = [];
  if (st.underline) decorations.push('underline');
  if (st.strikethrough) decorations.push('line-through');
  const family = !st.fontFaceChanged && st.cssFamily
    ? st.cssFamily
    : cssFamilyFor(st.family);
  const style = {
    color: st.color || '#000000',
    'font-weight': st.bold ? 'bold' : 'normal',
    'font-style': st.italic ? 'italic' : 'normal',
    'font-family': family,
    'text-decoration-line': decorations.length ? decorations.join(' ') : 'none',
    'text-decoration-thickness': '0.06em',
    'text-underline-offset': '0.08em',
  };

  if (activeEditor && st.size > 0) {
    const visualScale = activeEditor.visualScale || activeEditor.scale || 1;
    const fontSizePx = st.size * visualScale;
    const lineHeightPx = (activeEditor.lineSpacing || st.size * 1.2) * visualScale;
    style['font-size'] = `${fontSizePx}px`;
    style['line-height'] = `${lineHeightPx}px`;
    style.height = `${Math.max(getEditorText().split('\n').length * lineHeightPx, 24)}px`;
    const baselineOffset = cssBaselineOffset(
      family, fontSizePx, lineHeightPx, st.bold, st.italic
    );
    if (Number.isFinite(activeEditor.editorBaseline)) {
      style.top = `${activeEditor.editorBaseline - baselineOffset}px`;
    } else if (activeEditor.editorBaseline) {
      const baseline = activeEditor.editorBaseline;
      style.left = `${baseline.left - baseline.rotationC * baselineOffset}px`;
      style.top = `${baseline.top - baseline.rotationD * baselineOffset}px`;
    }
  }

  updatePdfEditorStyle(style);
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
  spanToBlockByMode = { strict: new WeakMap(), loose: new WeakMap() };
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
      spanToBlockByMode = { strict: new WeakMap(), loose: new WeakMap() };
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

function getBlockGroups(layer, mode = 'strict') {
  const cached = blockGroupsCache.get(layer);
  if (cached && cached[mode]) return cached[mode];

  const spans = Array.from(layer.querySelectorAll('span[data-pdf-transform]'));
  if (spans.length === 0) {
    blockGroupsCache.set(layer, { strict: [], loose: [] });
    return [];
  }

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
      fontSize,
      // Baseline-richting (graden CCW) van de originele run — nodig om de
      // vervangtekst in dezelfde richting terug te schrijven (/Rotate-pagina's
      // en intrinsiek geroteerde labels).
      angle: textEditAngleFromTransform(transform)
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

  // ── Step 1c (alleen strict): zelfde-rij-fragmenten weer samenvoegen ──
  // Een tabelrij is bij het bewerken één eenheid: fragmenten op dezelfde
  // baseline met een beperkte tussenruimte (≤ 6× fontgrootte) worden weer
  // samengevoegd; de kolomstructuur blijft via buildLineSegments behouden.
  // Echte pagina-kolommen (grote goot) blijven gescheiden.
  let groupLines = splitLines;
  if (mode === 'strict') {
    const rowUnits = [];
    for (const frag of splitLines) {
      const prev = rowUnits[rowUnits.length - 1];
      if (prev) {
        const sameRow = Math.abs(frag[0].pdfY - prev[0].pdfY) <= prev[0].fontSize * 0.3;
        const last = prev[prev.length - 1];
        const gap = frag[0].pdfX - (last.pdfX + last.pdfWidth);
        const avgFs = (last.fontSize + frag[0].fontSize) / 2;
        if (sameRow && gap <= avgFs * 6) { prev.push(...frag); continue; }
      }
      rowUnits.push([...frag]);
    }
    groupLines = rowUnits;
  }

  // Per regel-eenheid: kolomachtig? en de dominante font-identiteit (voor de
  // strikte kop-vs-broodtekst-grens).
  const lineMeta = groupLines.map(li => {
    const seg = buildLineSegments(
      li.map(it => ({
        text: it.span.textContent,
        pdfX: it.pdfX,
        pdfY: it.pdfY,
        pdfWidth: it.pdfWidth,
        fontSize: it.fontSize,
      })),
      li[0].angle || 0,
    );
    const dom = li.reduce((beste, it) => {
      const len = (it.span.textContent || '').trim().length;
      return len > beste.len ? { it, len } : beste;
    }, { it: li[0], len: (li[0].span.textContent || '').trim().length }).it;
    return {
      kolomachtig: Array.isArray(seg.segments) && seg.segments.length >= 2,
      // Fontidentiteit op de OPGELOSTE basisnaam (actualFontName): het ruwe
      // resource-naam-alternatief bevat per pdf-lib-tekenactie een uniek
      // suffix (Helvetica-123…), waardoor regels van één blok onterecht als
      // verschillende fonts zouden splitsen.
      fontKey: `${dom.span.dataset.pdfActualFontName || dom.span.dataset.pdfFontName || ''}`
        + `|${dom.span.dataset.pdfBold || ''}|${dom.span.dataset.pdfItalic || ''}`,
    };
  });

  // ── Step 2: group consecutive lines into blocks ──
  //
  // Two adjacent lines belong to the same block only when ALL of:
  //   a) font sizes match closely   (ratio > 0.92)
  //   b) baseline gap is reasonable  (0.5× – 1.8× fontSize)
  //   c) left edges are aligned      (within 1× fontSize)
  // In de strikte modus komen daar harde grenzen bij:
  //   d) geen stapeling van twee kolomachtige regels (tabel → per rij)
  //   e) zelfde dominante font-identiteit (kop vs broodtekst splitst)
  //   f) consistente regelafstand binnen het blok (sprong = grens)
  const blocks = [];
  let curBlock = [groupLines[0]];
  let curBlockMeta = [0];
  let prevGap = null;

  for (let i = 1; i < groupLines.length; i++) {
    const prevLine = curBlock[curBlock.length - 1];
    const nextLine = groupLines[i];

    const prevFs = prevLine[0].fontSize;
    const nextFs = nextLine[0].fontSize;
    const fontRatio = Math.min(prevFs, nextFs) / Math.max(prevFs, nextFs);

    // Baseline-to-baseline distance in PDF units (positive = going down)
    const baselineGap = prevLine[0].pdfY - nextLine[0].pdfY;
    const avgFs = (prevFs + nextFs) / 2;

    // Left-edge proximity in PDF units
    const prevLeft = Math.min(...prevLine.map(it => it.pdfX));
    const nextLeft = Math.min(...nextLine.map(it => it.pdfX));

    let sameBlock =
      fontRatio > 0.92 &&
      baselineGap > avgFs * 0.5 &&
      baselineGap < avgFs * 1.8 &&
      Math.abs(nextLeft - prevLeft) < avgFs * 1.0;

    if (sameBlock && mode === 'strict') {
      const mPrev = lineMeta[curBlockMeta[curBlockMeta.length - 1]];
      const mNext = lineMeta[i];
      if (mPrev.kolomachtig && mNext.kolomachtig) {
        sameBlock = false; // tabel: per rij groeperen
      } else if (mPrev.fontKey !== mNext.fontKey) {
        sameBlock = false; // kop vs broodtekst (ander font/vetheid)
      } else if (prevGap != null
          && Math.abs(baselineGap - prevGap) > Math.max(1, prevGap * 0.25)) {
        sameBlock = false; // regelafstand-sprong
      }
    }

    if (sameBlock) {
      curBlock.push(nextLine);
      curBlockMeta.push(i);
      prevGap = baselineGap;
    } else {
      blocks.push(curBlock);
      curBlock = [nextLine];
      curBlockMeta = [i];
      prevGap = null;
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
      // Regelstijl van de DOMINANTE span (meeste tekst) i.p.v. blind de
      // eerste: een bullet-glyph uit een Symbol/Dingbats-font mag de
      // fontkeuze van de hele regel niet laten omslaan.
      const styleSpan = lineItems.reduce((beste, it) => {
        const len = (it.span.textContent || '').trim().length;
        return len > beste.len ? { span: it.span, len } : beste;
      }, { span: firstSpan, len: (firstSpan.textContent || '').trim().length }).span;
      // Use actual font name from commonObjs (stored on dataset by text-layer.js)
      const pdfFontFamily = styleSpan.dataset.pdfFontFamily || 'sans-serif';
      const pdfFontName = styleSpan.dataset.pdfFontName || '';
      const actualFontName = styleSpan.dataset.pdfActualFontName || '';
      const loadedFontName = styleSpan.dataset.pdfLoadedFontName || '';
      const isBold = styleSpan.dataset.pdfBold === 'true';
      const isItalic = styleSpan.dataset.pdfItalic === 'true';

      const color = sampleTextColor(pdfCanvasEl, styleSpan.getBoundingClientRect());

      // Kolomstructuur binnen de regel (tab-uitlijning) detecteren: de
      // regeltekst krijgt een TAB op elke duidelijke horizontale sprong en de
      // segment-startposities blijven bewaard voor painter en saver.
      const lineSeg = buildLineSegments(
        lineItems.map(it => ({
          text: normalizeBulletText(it.span.textContent),
          pdfX: it.pdfX,
          pdfY: it.pdfY,
          pdfWidth: it.pdfWidth,
          fontSize: it.fontSize,
        })),
        lineItems[0].angle || 0,
      );
      return {
        text: lineSeg.text,
        segments: lineSeg.segments,
        // Stukken per bron-span (concat == text): basis voor de per-woord-
        // opmaak-reconstructie bij het openen van de editor.
        pieces: (lineSeg.pieces || []).map(pc => ({
          text: pc.text,
          span: lineItems[pc.item]?.span || null,
        })),
        domTop: Math.min(...lineItems.map(it => it.domTop)),
        domBottom: Math.max(...lineItems.map(it => it.domBottom)),
        pdfX: lineItems[0].pdfX,
        pdfY: lineItems[0].pdfY,
        pdfWidth: lineItems.reduce((s, it) => s + it.pdfWidth, 0),
        fontSize: lineItems[0].fontSize,
        angle: lineItems[0].angle || 0,
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

    for (const sp of allSpans) spanToBlockByMode[mode].set(sp, group);
    return group;
  });

  const entry = blockGroupsCache.get(layer) || { strict: null, loose: null };
  entry[mode] = groups;
  blockGroupsCache.set(layer, entry);
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

    // Klik op een LEGE plek (de laag zelf, geen span) opent een leeg
    // tekstblok op die positie: nieuwe paginatekst toevoegen met dezelfde
    // inline editor. De guard slaat de klik over die zojuist een open editor
    // gecommit heeft (klik-buiten = alleen sluiten, niet meteen een nieuw
    // blok beginnen).
    if (!layer._opdsLeegKlik) {
      layer._opdsLeegKlik = true;
      layer.addEventListener('click', (e) => {
        if (e.target !== layer) return;
        if (!state.isEditingPdfText || state.currentTool !== 'editText') return;
        if (activeEditor) return;
        if (Date.now() - _laatsteFinishOp < 400) return;
        startNewTextBlockAt(e, layer, pageNum);
      });
    }
    const spans = layer.querySelectorAll('span');
    spans.forEach(span => {
      if (alreadyAttached.has(span)) return;
      span.style.pointerEvents = 'auto';
      span.style.cursor = 'text';
      span.classList.add('edit-text-hoverable');

      const enterHandler = () => {
        const block = spanToBlockByMode.strict.get(span);
        if (block) block.spans.forEach(s => s.classList.add('edit-text-block-hover'));
      };
      const leaveHandler = () => {
        const block = spanToBlockByMode.strict.get(span);
        if (block) block.spans.forEach(s => s.classList.remove('edit-text-block-hover'));
      };
      const clickHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const doc = getActiveDocument();
        try {
          const page = await doc?.pdfDoc?.getPage(pageNum);
          if (page) await resolveTextLayerFonts(page, layer);
        } catch (_) {
          // Keep editing available with a standard fallback if a font cannot
          // be resolved (damaged or unsupported embedded font).
        }
        if (!state.isEditingPdfText || state.currentTool !== 'editText') return;
        // Gewone klik: strikte groep (kop/tabelrij apart). Ctrl/Cmd+klik:
        // het ruime blok (oude gedrag) voor wie alles ineens wil bewerken.
        const groupMode = (e.ctrlKey || e.metaKey) ? 'loose' : 'strict';
        blockGroupsCache.delete(layer);
        getBlockGroups(layer, groupMode);
        startPdfTextEditing(span, pageNum, groupMode);
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

function startPdfTextEditing(span, pageNum, groupMode = 'strict') {
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

  const block = spanToBlockByMode[groupMode].get(span)
    || spanToBlockByMode.strict.get(span)
    || spanToBlockByMode.loose.get(span);
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

  // Match the PDF.js line box exactly. The previous 0.82 multiplier made the
  // live text visibly shrink and move as soon as editing started.
  const numLines = lineData.length;
  const editorFontSize = Math.max(1, lineData[0].domBottom - lineData[0].domTop);
  const visualLineHeight = numLines > 1
    ? Math.abs(lineData[1].domTop - lineData[0].domTop)
    : editorFontSize * (lineSpacing / fontSize);

  // Place editor in the textLayer's parent container (not in the textLayer itself)
  // because .textLayer has opacity: 0.25 which makes all children semi-transparent
  const editorContainer = textLayer.parentElement || textLayer;
  const containerRect = editorContainer.getBoundingClientRect();
  const layerRect = textLayer.getBoundingClientRect();
  const offsetX = layerRect.left - containerRect.left;
  const offsetY = layerRect.top - containerRect.top;

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
  const displayFontName = editableFontName(lineData[0], cssFallbackFont);
  const editorBold = lineData[0].isBold || false;
  const editorItalic = lineData[0].isItalic || false;
  const targetBaseline = containerRect.top + groupRect.top + offsetY
    + cssBaselineOffset(editorFont, editorFontSize, editorFontSize, editorBold, editorItalic);
  const editorTop = targetBaseline
    - cssBaselineOffset(editorFont, editorFontSize, visualLineHeight, editorBold, editorItalic);

  // Build style object for the Solid overlay
  // Use fixed positioning based on container's viewport position
  const styleObj = {
    position: 'fixed',
    left: `${containerRect.left + groupRect.left + offsetX}px`,
    top: `${editorTop}px`,
    width: `${Math.max(groupRect.width + 4, 80)}px`,
    height: `${Math.max(numLines * visualLineHeight, 24)}px`,
    'font-size': `${editorFontSize}px`,
    'line-height': `${visualLineHeight}px`,
    'font-family': editorFont,
    color: lineData[0].color || '#000000',
    'z-index': '1000'
  };
  // NB: geen container-brede font-weight/style meer — de per-regel runs
  // (initialLines met <b>/<i>) bepalen de weergave, zodat een blok met een
  // vette kop en gewone broodtekst beide correct toont en de DOM-parse de
  // absolute bold/italic-vlaggen teruggeeft.

  // Kolom-tab-stops: laat de TAB in de editor naar de werkelijke kolom-x
  // springen. CSS tab-size (px) zet stops op veelvouden; met de kleinste
  // kolomoffset klopt het gangbare geval (labels + waarden op één kolom-x).
  const columnOffsets = lineData
    .filter(l => Array.isArray(l.segments) && l.segments.length > 1)
    .map(l => l.segments[1].start)
    .filter(v => Number.isFinite(v) && v > 0);
  const dominantOffset = dominantColumnOffset(columnOffsets) || DEFAULT_TAB_GRID_PT;
  {
    // Ook zonder bestaande kolom een vast raster tonen: een nieuw getypte
    // tab springt dan in de editor naar dezelfde stop als bij commit.
    const tabPx = dominantOffset * (editorFontSize / fontSize);
    if (tabPx > 1) styleObj['tab-size'] = `${tabPx.toFixed(2)}px`;
  }

  // Bestaande inline opmaak als beginweergave in de editor — per SPAN-RUN,
  // niet per regel: een regel kan runs in andere font-varianten (vet/cursief)
  // en kleuren bevatten die al als echte paginatekst in het bestand staan
  // (bv. na een eerdere in-place-save). Opeenvolgende stukken met gelijke
  // stijl worden samengevoegd; witruimte is stijl-neutraal en plakt aan de
  // vorige run. Zo toont de editor de opmaak en behoudt het record de runs
  // bij commit — herbewerken zonder opmaakverlies.
  const kleurCanvas = textLayer.parentElement?.querySelector('canvas.pdf-canvas')
    || pdfCanvas || document.getElementById('pdf-canvas');
  const bouwSpanRuns = (l) => {
    const basisBold = l.isBold || false;
    const basisItalic = l.isItalic || false;
    const basisKleur = (l.color || '#000000').toLowerCase();
    const stukken = Array.isArray(l.pieces) ? l.pieces : null;
    if (!stukken || stukken.length === 0) {
      return [{ text: l.text, bold: basisBold, italic: basisItalic }];
    }
    const runs = [];
    for (const stuk of stukken) {
      if (!stuk.text) continue;
      let bold = basisBold;
      let italic = basisItalic;
      let kleur = null;
      const sp = stuk.span;
      if (sp && stuk.text.trim()) {
        bold = sp.dataset.pdfBold === 'true';
        italic = sp.dataset.pdfItalic === 'true';
        const c = sampleTextColor(kleurCanvas, sp.getBoundingClientRect());
        if (c && c.toLowerCase() !== basisKleur) kleur = c;
      } else if (runs.length) {
        const vorige = runs[runs.length - 1];
        bold = vorige.bold;
        italic = vorige.italic;
        kleur = vorige.color || null;
      }
      const vorige = runs[runs.length - 1];
      if (vorige && vorige.bold === bold && vorige.italic === italic
          && (vorige.color || null) === (kleur || null)) {
        vorige.text += stuk.text;
      } else {
        runs.push({ text: stuk.text, bold, italic, ...(kleur ? { color: kleur } : {}) });
      }
    }
    return runs.length ? runs : [{ text: l.text, bold: basisBold, italic: basisItalic }];
  };
  const initialLineRuns = lineData.map(bouwSpanRuns);
  // Kolom-doelposities per tab, in editor-px vanaf de blok-linkerrand: de
  // editor legt elke tab-spacer precies zo breed dat het volgende segment op
  // zijn ECHTE kolom-x staat (een tabelrij heeft meerdere, verschillende
  // kolomafstanden — het uniforme tab-size-raster kon er maar één leggen).
  const blockMinPdfX = Math.min(...lineData.map(l => l.pdfX));
  const editorPxPerPt = editorFontSize / fontSize;
  const editorInitialLines = lineData.map((l, li) => ({
    runs: initialLineRuns[li],
    ...(Array.isArray(l.segments) && l.segments.length > 1 ? {
      tabStops: l.segments.slice(1).map(sg =>
        ((l.pdfX - blockMinPdfX) + sg.start) * editorPxPerPt),
    } : {}),
    style: {
      fontFamily: lineEditorFontFamily(l),
      fontSizePx: l.fontSize * (editorFontSize / fontSize),
      color: l.color || '#000000',
    },
  }));

  // Hide all spans BEFORE showing editor so text doesn't double-render
  for (const s of block.spans) s.style.visibility = 'hidden';

  activeEditor = {
    block,
    pageNum,
    kind: 'existingText',
    originalText: combinedText,
    // Gedetecteerde beginopmaak per regel: referentie voor de commit —
    // alleen ECHT gewijzigde opmaak telt als wijziging.
    initialLineRuns,
    pdfX,
    pdfY,
    pdfWidth,
    fontSize,
    lineSpacing,
    numOriginalLines: lineData.length,
    scale: getActiveDocument()?.scale || 1.5,
    visualScale: editorFontSize / fontSize,
    editorBaseline: targetBaseline,
    // Accumulated style state edited via the properties panel; seeded from the
    // block's detected formatting. Persisted onto the edit record on commit.
    styleState: {
      family: displayFontName,
      cssFamily: editorFont,
      fontFaceChanged: false,
      size: fontSize,
      color: lineData[0].color || '#000000',
      bold: lineData[0].isBold || false,
      italic: lineData[0].isItalic || false,
      underline: false,
      strikethrough: false,
    },
  };

  state.pdfTextEditState = activeEditor;

  // Show text properties in the right panel
  showTextEditProperties({
    text: combinedText,
    fontSize,
    fontFamily: displayFontName,
    color: lineData[0].color || '#000000',
    isBold: lineData[0].isBold || false,
    isItalic: lineData[0].isItalic || false,
    isUnderline: false,
    isStrikethrough: false,
    page: pageNum
  });

  // Define handlers for the store
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancelPdfTextEditing();
      return;
    }
    // Alt+Arrow verplaatst ook een bestaand-tekst-blok (pariteit met het
    // record-pad); de commit leest de verplaatste coords uit activeEditor.
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
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      finishPdfTextEditing();
      return;
    }
    if (e.key === 'Enter') {
      // A normal Enter always creates a real PDF line break. Ctrl/Cmd+Enter
      // commits; blur still commits as before.
      e.stopPropagation();
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (activeEditor) {
        // Kliks in opmaak-UI (paneel, kleurkiezers, ribbon) of een native
        // dialoog die focus steelt sluiten de editor niet.
        if (!blurShouldCommit()) return;
        finishPdfTextEditing();
      }
    }, 150);
  };

  showPdfTextEditor(styleObj, combinedText, {
    onCommit: null,
    onCancel: null,
    onKeyDown: handleKeyDown,
    onBlur: handleBlur,
    initialLines: editorInitialLines,
    dragHandlers: maakDragHandlers(),
  });
}

let _laatsteFinishOp = 0;

function finishPdfTextEditing() {
  if (!activeEditor) return;
  _laatsteFinishOp = Date.now();

  // If this editor was started via startTextEditEditing, delegate to its own finish handler
  if (activeEditor._finishEditing) {
    activeEditor._finishEditing();
    return;
  }

  const {
    block, pageNum, originalText,
    pdfX, pdfY, pdfWidth, fontSize, lineSpacing, numOriginalLines, styleState,
    initialLineRuns: initialRuns,
  } = activeEditor;
  const newText = getEditorText();

  hidePdfTextEditor();

  // Show all spans again
  for (const s of block.spans) s.style.visibility = '';

  const st = styleState || {};
  // Verplaatst (grip of Alt+pijltjes)? De commit-anker (activeEditor.pdfX/Y)
  // wijkt dan af van het gedetecteerde blok-anker. Een pure verplaatsing
  // zonder tekst-/stijlwijziging moet OOK persisteren.
  const moved = Math.abs(pdfX - block.lineData[0].pdfX) > 0.01
    || Math.abs(pdfY - block.lineData[0].pdfY) > 0.01;
  // Did the panel change any formatting relative to the detected block style?
  const styleChanged =
    (st.size != null && st.size !== fontSize) ||
    (st.color != null && st.color !== (block.lineData[0].color || '#000000')) ||
    (st.bold != null && st.bold !== (block.lineData[0].isBold || false)) ||
    (st.italic != null && st.italic !== (block.lineData[0].isItalic || false)) ||
    st.fontFaceChanged === true ||
    st.underline === true ||
    st.strikethrough === true;

  // Inline opmaak (vet/cursief per woord via Ctrl+B/I) telt ook als
  // wijziging — anders gaat een pure opmaak-edit zonder tekstwijziging
  // verloren bij commit. Vergelijk tegen de GEDETECTEERDE beginopmaak
  // (initialLineRuns): bestaande per-woord-runs die de editor toont zijn
  // geen wijziging; alleen daadwerkelijk aangepaste opmaak telt.
  const _runsGelijk = (a, b) => {
    const na = normalizeRuns(a || []);
    const nb = normalizeRuns(b || []);
    if (na.length !== nb.length) return false;
    return na.every((r, k) => r.text === nb[k].text
      && !!r.bold === !!nb[k].bold
      && !!r.italic === !!nb[k].italic
      && (r.color || null) === (nb[k].color || null));
  };
  const _peekRuns = getEditorLineRuns();
  const inlineFormattingChanged = Array.isArray(_peekRuns) && _peekRuns.some((runs, i) => {
    if (!Array.isArray(runs) || runs.length === 0) return false;
    if (Array.isArray(initialRuns) && initialRuns[i]) {
      return !_runsGelijk(runs, initialRuns[i]);
    }
    const baseBold = block.lineData[i]?.isBold || false;
    const baseItalic = block.lineData[i]?.isItalic || false;
    return runs.length > 1
      || runs[0].bold !== baseBold
      || runs[0].italic !== baseItalic;
  });

  // Persist when the text OR the formatting changed (a pure re-style of
  // existing PDF text must be saveable too).
  if ((newText !== originalText || styleChanged || inlineFormattingChanged || moved) && newText.trim() !== '') {
    const { lineData } = block;
    const pdfFontName = lineData[0].pdfFontName || '';

    // Final formatting: panel-edited style state wins over the detected block
    // style (seeded identically, so unchanged edits reproduce the original).
    const finalSize = st.size != null ? st.size : fontSize;
    const finalColor = st.color != null ? st.color : (lineData[0].color || '#000000');
    const finalBold = st.bold != null ? st.bold : (lineData[0].isBold || false);
    const finalItalic = st.italic != null ? st.italic : (lineData[0].isItalic || false);
    const finalUnderline = st.underline === true;
    const finalStrikethrough = st.strikethrough === true;
    const finalLineSpacing = finalSize !== fontSize ? finalSize * 1.2 : lineSpacing;
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
    const loadedFontName = st.fontFaceChanged ? '' : (lineData[0].loadedFontName || '');

    // Per-regel stijl: zolang het panel de opmaak NIET overschreef, behoudt
    // elke regel zijn eigen gedetecteerde font/grootte/kleur. Zonder dit werd
    // een heel blok hertekend in de stijl van regel 1 (kop-kleur/vetheid over
    // de hele alinea). Bij een panel-override wint de uniforme record-stijl.
    const lineStyles = styleChanged ? undefined : lineData.map(ld => ({
      fontFamily: toStandardFontName(
        ld.actualFontName || ld.fontFamily,
        ld.isBold || false,
        ld.isItalic || false,
      ),
      fontSize: ld.fontSize,
      color: ld.color || '#000000',
      loadedFontName: ld.loadedFontName || '',
    }));

    // ── Kolom-segmenten en inline opmaak-runs per regel ──
    // Segmenten behouden hun oorspronkelijke x-positie (langs de baseline)
    // zolang de gebruiker de tab-structuur niet doorbrak; runs bewaren
    // vet/cursief per woord. Regels zonder beide krijgen null (fallback op
    // het bestaande doorlopende gedrag).
    const blockAngleRad = (lineData[0].angle || 0) * Math.PI / 180;
    const projDx = (x, y) =>
      ((Number(x) || 0) - pdfX) * Math.cos(blockAngleRad)
      + ((Number(y) || 0) - pdfY) * Math.sin(blockAngleRad);
    const blockTabGrid = dominantColumnOffset(
      lineData.flatMap(l => (Array.isArray(l.segments) && l.segments.length > 1)
        ? [l.segments[1].start] : [])
    ) || DEFAULT_TAB_GRID_PT;
    const editorRuns = getEditorLineRuns();

    // ── C2: reflow binnen het bewerkte blok ──
    // Alleen voor gewone alinea's (geen kolom-segmenten, geen tabs, geen
    // inline opmaak-runs): als een bewerkte regel breder wordt dan het blok,
    // herverdeel de woorden vanaf de eerste gewijzigde regel over de regels
    // van het blok. Loopt het resultaat buiten het blok: waarschuwen, nooit
    // stilletjes afkappen.
    let finalNewText = newText;
    let lineJustifyTw = null;
    let justifyWidth = 0;
    let alignSegsOverride = null;
    const origLinesArr = originalText.split('\n');
    const isPlainParagraph = !newText.includes('\t')
      && !inlineFormattingChanged
      && numOriginalLines >= 2
      && lineData.every(l => !l.segments)
      // Gemengde per-woord-opmaak (meerdere runs op een regel): niet
      // reflowen — het herverdelen van woorden over regels zou de
      // run-indeling verhaspelen (runs zijn per oorspronkelijke regel).
      && (!Array.isArray(initialLineRuns)
        || initialLineRuns.every(r => !Array.isArray(r) || r.length <= 1));
    if (isPlainParagraph) {
      const blockLeft = Math.min(...lineData.map(l => l.pdfX));
      const blockRight = Math.max(...lineData.map(l => l.pdfX + (l.pdfWidth || 0)));
      const blockWidth = blockRight - blockLeft;
      const meet = (t) => measureTextWidthPt(
        t, lineEditorFontFamily(lineData[0]), finalSize, finalBold, finalItalic,
      );
      const reflow = reflowBlockLines(origLinesArr, newText.split('\n'), {
        maxWidth: blockWidth,
        measure: meet,
      });
      if (reflow.changed) {
        finalNewText = reflow.lines.join('\n');
        if (reflow.overflow > 0) {
          console.warn(
            `[text-edit] Bewerkte tekst is ${reflow.overflow} regel(s) hoger dan ` +
            'het originele blok; de tekst wordt volledig getoond (niet afgekapt).',
          );
        }
      }
      // Uitlijning van het originele blok benaderen: rechts via segment-dx,
      // uitgevuld via woordspatie-verdeling (Tw) op de gewijzigde regels.
      const align = detectBlockAlignment(
        lineData.map(l => ({ x: l.pdfX, width: l.pdfWidth || 0 })),
        { tol: Math.max(1.5, fontSize * 0.25) },
      );
      const finalLines = finalNewText.split('\n');
      if (align === 'right') {
        alignSegsOverride = finalLines.map(ln => ([{
          text: ln,
          dx: (blockRight - meet(ln)) - pdfX,
        }]));
      } else if (align === 'justify') {
        justifyWidth = blockWidth;
        lineJustifyTw = finalLines.map((ln, li) => {
          if (li === finalLines.length - 1) return null; // laatste regel niet uitvullen
          if (li < origLinesArr.length && ln === origLinesArr[li]) return null;
          const spaties = (ln.match(/ /g) || []).length;
          if (!spaties) return null;
          const tw = (blockWidth - meet(ln)) / spaties;
          return (tw > 0.05 && tw < finalSize * 2) ? tw : null;
        });
        if (!lineJustifyTw.some(v => v != null)) { lineJustifyTw = null; justifyWidth = 0; }
      }
    }
    // ── C3: welke regels zijn écht ongewijzigd? ──
    // Ongewijzigde regels van het blok worden bij een geslaagde in-place-save
    // fysiek met rust gelaten (behoudt o.a. de oorspronkelijke uitvulling).
    // Een record-brede stijl-/opmaakwijziging maakt alle regels 'gewijzigd'.
    // Bij een verplaatsing moeten ALLE regels geknipt en op het nieuwe anker
    // hertekend worden — 'tekstueel ongewijzigd' telt dan niet.
    const unchangedLines = (styleChanged || inlineFormattingChanged || moved)
      ? null
      : finalNewText.split('\n').map((ln, li) =>
        li < origLinesArr.length && ln === origLinesArr[li]);

    const recordNewLines = finalNewText.split('\n');
    const lineSegments = alignSegsOverride || recordNewLines.map((ln, i) => {
      const origSegs = lineData[i]?.segments || null;
      const baseBold = lineData[i]?.isBold || false;
      const baseItalic = lineData[i]?.isItalic || false;
      const rawRuns = Array.isArray(editorRuns?.[i]) ? editorRuns[i] : null;
      const interestingRuns = rawRuns && (
        rawRuns.length > 1
        || (rawRuns[0] && (rawRuns[0].bold !== baseBold || rawRuns[0].italic !== baseItalic))
        || rawRuns.some(r => r && r.color)
      );

      const parts = ln.split('\t');
      const segRuns = rawRuns ? splitRunsIntoSegments(rawRuns, parts.length) : null;
      const withRuns = (arr) => arr.map((sg, j) => ({
        ...sg,
        ...(segRuns && segRuns[j] && interestingRuns ? { runs: segRuns[j] } : {}),
      }));
      const lineDx = origSegs
        ? projDx(origSegs[0].x, origSegs[0].y)
        : (lineData[i] ? projDx(lineData[i].pdfX, lineData[i].pdfY) : 0);
      if (parts.length > 1) {
        if (origSegs && parts.length === origSegs.length) {
          // Tab-aantal ongewijzigd: originele kolom-x-posities behouden.
          return withRuns(origSegs.map((sg, j) => ({ text: parts[j], dx: projDx(sg.x, sg.y) })));
        }
        // Nieuwe of extra tabs: leg de segmenten op het tab-stop-raster,
        // precies zoals de editor ze toont (getypte tab = kolomscheiding).
        const ldRef = lineData[i] || lineData[0];
        const laid = layoutSegmentsOnTabGrid(parts, {
          grid: blockTabGrid,
          baseDx: lineDx,
          measure: (t) => measureTextWidthPt(
            t, lineEditorFontFamily(ldRef), ldRef.fontSize || fontSize,
            ldRef.isBold, ldRef.isItalic,
          ),
        });
        return withRuns(laid);
      }
      if (origSegs) {
        // Tab verwijderd: segmenten samengevoegd, doorlopend vanaf segment 1.
        return withRuns([{ text: ln, dx: lineDx }]);
      }
      if (interestingRuns) return [{ text: ln, dx: lineDx, runs: rawRuns }];
      return null;
    });
    const hasLineSegments = lineSegments.some(Boolean);

    const editRecord = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      page: pageNum,
      originalText,
      newText: finalNewText,
      pdfX,
      pdfY,
      pdfWidth,
      fontSize: finalSize,
      lineSpacing: finalLineSpacing,
      numOriginalLines,
      fontFamily,
      loadedFontName,
      pdfFontName,
      color: finalColor,
      fontUnderline: finalUnderline,
      fontStrikethrough: finalStrikethrough,
      textAngle: lineData[0].angle || 0,
      ...(lineStyles ? { lineStyles } : {}),
      ...(hasLineSegments ? { lineSegments } : {}),
      ...(lineJustifyTw ? { lineJustifyTw, justifyWidth } : {}),
      ...(unchangedLines ? { unchangedLines } : {}),
      ...(moved ? { moved: true } : {}),
      // Per-regel origineel anker + ruwe tekst: hiermee kan de saver de
      // originele show-text-operatoren in de content stream terugvinden om
      // ze in-place te vervangen (het échte bewerken).
      originalLineInfo: lineData.map((ld, li) => ({
        x: ld.pdfX,
        y: ld.pdfY,
        width: ld.pdfWidth,
        fontSize: ld.fontSize,
        angle: ld.angle || 0,
        text: (originalSpanTexts[li] || []).join(''),
      })),
      originalSpanTexts
    };

    const doc = getActiveDocument();
    if (doc) {
      if (!doc.textEdits) doc.textEdits = [];
      doc.textEdits.push(editRecord);

      // Update span text visually: put all new text in first span, blank the rest.
      // Regels met behouden kolomstructuur verdelen hun segment-teksten over de
      // oorspronkelijke segment-spans zodat de selectie-uitlijning blijft kloppen.
      // Koppel de spans ook aan het record via dataset.editId: een volgende
      // klik heropent dan HET record (incl. kolom-segmenten en vet/cursief-
      // runs) via startTextEditEditing, in plaats van een verse block-edit.
      for (const sp of block.spans) sp.dataset.editId = String(editRecord.id);
      const newLines = newText.split('\n');
      for (let li = 0; li < lineData.length; li++) {
        const lineSpans = lineData[li].spans;
        const origSegs = lineData[li].segments;
        const savedSegs = li < newLines.length ? lineSegments[li] : null;
        if (li < newLines.length && origSegs && savedSegs && savedSegs.length === origSegs.length) {
          lineSpans.forEach((sp, idx) => {
            const segK = origSegs.findIndex(sg => sg.spanStart === idx);
            if (segK >= 0) sp.textContent = savedSegs[segK].text;
            else if (sp.textContent.trim()) sp.textContent = '';
            // witruimte-spans blijven staan: zij houden de kolomruimte selecteerbaar
          });
        } else if (li < newLines.length) {
          lineSpans[0].textContent = newLines[li].replace(/\t/g, ' ');
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
    textAngle: textEditAngleFromTransform(transform),
    // Anker + ruwe tekst voor de in-place-route van de saver.
    originalLineInfo: [{
      x: pdfX,
      y: pdfY,
      width: pdfWidth,
      fontSize,
      angle: textEditAngleFromTransform(transform),
      text: originalText,
    }],
    originalSpanTexts: [[originalText]]
  };

  // Update span text visually
  matchSpan.textContent = newText;

  return { editRecord };
}

function getTextEditViewGeometry(canvasEl, doc) {
  const vp = window.__pdfViewport;
  if (vp?.active && doc?.filePath && vp.pageH > 0 && vp.zoom > 0) {
    return {
      pageHeight: vp.pageH,
      visualScale: vp.zoom,
      offsetX: vp.offsetX || 0,
      offsetY: vp.offsetY || 0,
    };
  }

  const dpr = window.devicePixelRatio || 1;
  const visualScale = doc?.scale || 1.5;
  return {
    pageHeight: canvasEl.height / (visualScale * dpr),
    visualScale,
    offsetX: 0,
    offsetY: 0,
  };
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

    const firstBaseY = (geometry.offsetYPt || 0) + pageHeight - edit.pdfY;
    const editLeft = edit.pdfX - (geometry.offsetXPt || 0);
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
  const geometry = getTextEditGeometry(pageNum, canvasEl);
  const pageHeight = geometry.pageHeight;
  const viewGeometry = getTextEditViewGeometry(canvasEl, editDoc);
  const editScale = viewGeometry.visualScale;
  const fontSize = textEdit.fontSize;
  const ls = textEdit.lineSpacing || fontSize * 1.2;
  const newLines = textEdit.newText.split('\n');
  const numLines = newLines.length;

  const firstBaseY = (geometry.offsetYPt || 0) + pageHeight - textEdit.pdfY;
  const maxCharCount = Math.max(...newLines.map(l => l.length), 1);
  const editWidth = Math.max(textEdit.pdfWidth || 0, fontSize * 0.6 * maxCharCount) + fontSize * 0.5;

  // Find the container to place the editor in
  const container = canvasEl.parentElement;
  if (!container) return;
  const containerRect = container.getBoundingClientRect();
  const canvasRect = canvasEl.getBoundingClientRect();
  const offsetX = canvasRect.left - containerRect.left;
  const offsetY = canvasRect.top - containerRect.top;

  const rotatedBaseline = applyPageRotation(
    textEdit.pdfX - (geometry.offsetXPt || 0),
    firstBaseY,
    geometry.pageWidth,
    geometry.pageHeight,
    geometry.rotation,
  );
  const scaledWidth = editWidth * editScale;
  const editorFontSize = fontSize * editScale;
  const visualLineHeight = ls * editScale;
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
  const editorFontFamily = textEdit.loadedFontName
    ? `"${textEdit.loadedFontName}", ${cssFontFamily}`
    : cssFontFamily;

  const editorBold = ff.includes('bold');
  const editorItalic = ff.includes('italic') || ff.includes('oblique');
  const baselineOffset = cssBaselineOffset(
    editorFontFamily, editorFontSize, visualLineHeight, editorBold, editorItalic
  );
  const [, , rotationC, rotationD] = getPageRotationMatrix(
    geometry.pageWidth,
    geometry.pageHeight,
    geometry.rotation,
  );
  const baselineLeft = containerRect.left + pageOffsetX + rotatedBaseline.x * editScale;
  const baselineTop = containerRect.top + pageOffsetY + rotatedBaseline.y * editScale;
  const editorLeft = baselineLeft - rotationC * baselineOffset;
  const editorTop = baselineTop - rotationD * baselineOffset;

  // Build style object using fixed positioning
  const styleObj = {
    position: 'fixed',
    left: `${editorLeft}px`,
    top: `${editorTop}px`,
    width: `${Math.max(scaledWidth + 4, 80)}px`,
    height: `${Math.max(numLines * visualLineHeight, 24)}px`,
    'font-size': `${editorFontSize}px`,
    'line-height': `${visualLineHeight}px`,
    'font-family': editorFontFamily,
    color: textEdit.color || '#000000',
    transform: `rotate(${geometry.rotation}deg)`,
    'transform-origin': '0 0',
    'z-index': '1000'
  };
  // Container-brede font-weight/style vervalt: de per-regel initialLines
  // (met <b>/<i>-runs) bepalen de weergave in de contenteditable.
  // Kolom-tab-stops uit de opgeslagen segmentstructuur.
  const segTabOffsets = (textEdit.lineSegments || [])
    .filter(sg => Array.isArray(sg) && sg.length > 1)
    .map(sg => (Number(sg[1].dx) || 0) - (Number(sg[0].dx) || 0))
    .filter(v => v > 0);
  const segDominant = dominantColumnOffset(segTabOffsets) || DEFAULT_TAB_GRID_PT;
  {
    const tabPx = segDominant * editScale;
    if (tabPx > 1) styleObj['tab-size'] = `${tabPx.toFixed(2)}px`;
  }
  const decorations = [];
  if (textEdit.fontUnderline) decorations.push('underline');
  if (textEdit.fontStrikethrough) decorations.push('line-through');
  styleObj['text-decoration-line'] = decorations.length ? decorations.join(' ') : 'none';
  styleObj['text-decoration-thickness'] = '0.06em';
  styleObj['text-underline-offset'] = '0.08em';

  const oldTextEdit = { ...textEdit };
  const isAddedText = oldTextEdit.originalText === '';

  const finishEditing = () => {
    const newText = getEditorText();
    hidePdfTextEditor();

    // Clearing all the text of an INSERTED edit deletes it entirely — this is
    // how the user removes inserted text (issue #264).
    if (isAddedText && newText.trim() === '') {
      if (textEdit._pendingNew) {
        // Nieuw blok dat nooit inhoud kreeg: stilletjes opruimen (er is nog
        // geen undo-stap voor aangemaakt).
        const docNu = getActiveDocument();
        const idx = docNu?.textEdits?.findIndex(e => e.id === textEdit.id) ?? -1;
        if (idx >= 0) docNu.textEdits.splice(idx, 1);
        reRenderAddedText(pageNum);
      } else {
        removeTextEditRecord(textEdit);
      }
      activeEditor = null;
      state.pdfTextEditState = null;
      hideProperties();
      return;
    }

    if (newText.trim() !== '') {
      if (textEdit.newText !== newText) {
        delete textEdit.unchangedLines;
        delete textEdit.lineJustifyTw;
        delete textEdit.justifyWidth;
      }
      textEdit.newText = newText;
    }
    // Segment- en run-structuur meesynchroniseren met de bewerkte tekst:
    // kolommen behouden zolang de tab-structuur intact is; inline opmaak
    // (vet/cursief per woord) uit de editor overnemen.
    {
      const edRuns = getEditorLineRuns();
      const lines = textEdit.newText.split('\n');
      const oudeSegs = Array.isArray(textEdit.lineSegments) ? textEdit.lineSegments : null;
      const reopenTabGrid = dominantColumnOffset(
        (oudeSegs || []).filter(sg => Array.isArray(sg) && sg.length > 1)
          .map(sg => (Number(sg[1].dx) || 0) - (Number(sg[0].dx) || 0))
          .filter(v => v > 0)
      ) || DEFAULT_TAB_GRID_PT;
      const nieuw = lines.map((ln, i) => {
        const segs = oudeSegs?.[i] || null;
        const runs = Array.isArray(edRuns?.[i]) ? edRuns[i] : null;
        const st = resolveTextEditLineStyle(textEdit, i);
        const baseBold = /bold/i.test(st.fontFamily || '');
        const baseItalic = /oblique|italic/i.test(st.fontFamily || '');
        const interesting = runs && (
          runs.length > 1
          || (runs[0] && (runs[0].bold !== baseBold || runs[0].italic !== baseItalic))
          || runs.some(r => r && r.color)
        );
        const parts = ln.split('\t');
        const segRuns = runs ? splitRunsIntoSegments(runs, parts.length) : null;
        const withRuns = (arr) => arr.map((sg, j) => ({
          ...sg,
          ...(segRuns && segRuns[j] && interesting ? { runs: segRuns[j] } : {}),
        }));
        const lineDx = Number(segs?.[0]?.dx) || 0;
        if (parts.length > 1) {
          if (segs && parts.length === segs.length) {
            return withRuns(segs.map((sg, j) => ({ text: parts[j], dx: sg.dx })));
          }
          // Nieuwe/extra tab tijdens herbewerken: raster-layout zoals de
          // editor toont.
          const fam = cssFamilyFor(st.fontFamily);
          const sizePt = st.fontSize || textEdit.fontSize || 12;
          const laid = layoutSegmentsOnTabGrid(parts, {
            grid: reopenTabGrid,
            baseDx: lineDx,
            measure: (t) => measureTextWidthPt(t, fam, sizePt, baseBold, baseItalic),
          });
          return withRuns(laid);
        }
        if (segs && segs.length) return withRuns([{ text: ln, dx: lineDx }]);
        if (interesting) return [{ text: ln, dx: lineDx, runs }];
        return null;
      });
      if (nieuw.some(Boolean)) textEdit.lineSegments = nieuw;
      else if (oudeSegs) delete textEdit.lineSegments;
    }
    // Verplaatst tijdens deze sessie (grip of Alt+pijltjes)? Markeer het
    // record: de saver weigert dan het afdekvlak-surrogaat en alle regels
    // worden op het nieuwe anker hertekend.
    if (textEdit.pdfX !== oldTextEdit.pdfX || textEdit.pdfY !== oldTextEdit.pdfY) {
      if (textEdit.originalText) textEdit.moved = true;
      delete textEdit.unchangedLines;
    }
    // Persist when content, style, or position changed. Style/position edits
    // were applied live to `textEdit`, so compare the whole record.
    const changed = JSON.stringify({ ...textEdit }) !== JSON.stringify(oldTextEdit);
    // Een gewijzigd, eerder ingebakken record moet bij de volgende save
    // opnieuw meegebakken worden (de nieuwe versie dekt de oude af).
    if (changed && textEdit.baked) delete textEdit.baked;
    if (changed || textEdit._pendingNew) {
      if (textEdit._pendingNew) {
        // Eerste echte commit van een nieuw tekstblok: nu pas de undo-stap.
        delete textEdit._pendingNew;
        execute({ type: 'addTextEdit', textEdit: { ...textEdit } });
      } else {
        execute({ type: 'modifyTextEdit', oldTextEdit, newTextEdit: { ...textEdit } });
      }
      markDocumentModified();
      reRenderAddedText(pageNum);
    }

    activeEditor = null;
    state.pdfTextEditState = null;
    hideProperties();
  };

  const cancelEditing = () => {
    if (textEdit._pendingNew) {
      // Nieuw blok geannuleerd vóór de eerste commit: record verwijderen.
      const docNu = getActiveDocument();
      const idx = docNu?.textEdits?.findIndex(e => e.id === textEdit.id) ?? -1;
      if (idx >= 0) docNu.textEdits.splice(idx, 1);
    } else {
      restoreTextEditSnapshot(textEdit, oldTextEdit);
    }
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
    visualScale: editScale,
    editorBaseline: {
      left: baselineLeft,
      top: baselineTop,
      rotationC,
      rotationD,
    },
    styleState: {
      family: textEdit.fontFamily || 'Helvetica',
      cssFamily: editorFontFamily,
      fontFaceChanged: false,
      size: textEdit.fontSize,
      color: textEdit.color || '#000000',
      bold: ff.includes('bold'),
      italic: ff.includes('italic') || ff.includes('oblique'),
      underline: textEdit.fontUnderline === true,
      strikethrough: textEdit.fontStrikethrough === true,
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
    isUnderline: textEdit.fontUnderline === true,
    isStrikethrough: textEdit.fontStrikethrough === true,
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
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      finishEditing();
      return;
    }
    if (e.key === 'Enter') {
      e.stopPropagation();
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (activeEditor && activeEditor._finishEditing === finishEditing) {
        // Kliks in opmaak-UI (paneel, kleurkiezers, ribbon) of een native
        // dialoog die focus steelt sluiten de editor niet.
        if (!blurShouldCommit()) return;
        finishEditing();
      }
    }, 150);
  };

  // Beginweergave: opgeslagen segmenten/runs terug de editor in, zodat
  // eerder aangebrachte vet/cursief-opmaak bij herbewerken zichtbaar blijft.
  const reopenBaseFlags = (i) => {
    const st = resolveTextEditLineStyle(textEdit, i);
    return {
      bold: /bold/i.test(st.fontFamily || ''),
      italic: /oblique|italic/i.test(st.fontFamily || ''),
    };
  };
  const reopenInitialLines = textEdit.newText.split('\n').map((ln, i) => {
    const { bold, italic } = reopenBaseFlags(i);
    const segs = Array.isArray(textEdit.lineSegments) ? textEdit.lineSegments[i] : null;
    const st = resolveTextEditLineStyle(textEdit, i);
    const rowStyle = {
      fontFamily: cssFamilyFor(st.fontFamily),
      fontSizePx: (st.fontSize || textEdit.fontSize || 12) * editScale,
      color: st.color || textEdit.color || '#000000',
    };
    if (segs && segs.length) {
      const runs = [];
      segs.forEach((sg, j) => {
        if (j > 0) runs.push({ text: '\t', bold, italic });
        if (Array.isArray(sg.runs) && sg.runs.length) {
          runs.push(...sg.runs.map(r => ({
            text: r.text,
            bold: !!r.bold,
            italic: !!r.italic,
            ...(r.color ? { color: r.color } : {}),
          })));
        } else if (sg.text) {
          runs.push({ text: sg.text, bold, italic });
        }
      });
      if (runs.length) {
        return {
          runs,
          style: rowStyle,
          // Doel-x per tab in editor-px (dx is al relatief aan het
          // record-anker = linkerrand van de editor).
          tabStops: segs.slice(1).map(sg => (Number(sg.dx) || 0) * editScale),
        };
      }
    }
    return { runs: [{ text: ln, bold, italic }], style: rowStyle };
  });

  showPdfTextEditor(styleObj, textEdit.newText, {
    onCommit: null,
    onCancel: null,
    onKeyDown: handleKeyDown,
    onBlur: handleBlur,
    initialLines: reopenInitialLines,
    dragHandlers: maakDragHandlers(),
  });
}

// ── Management of the ACTIVE text edit (called from the properties panel) ──

// Apply a formatting change from the properties panel to the text edit that is
// currently open in the inline editor. Works for both inserted text (a live
// textEdit record) and existing PDF text (persisted on commit).
// Pas een kleur uit het eigenschappenpaneel toe op de actieve selectie in de
// tekst-editor (per-run, zoals Ctrl+B/I). Retourneert false wanneer er geen
// niet-lege selectie in de editor staat; de aanroeper valt dan terug op de
// record-brede kleur.
function applyColorToEditorSelection(color) {
  const ed = document.querySelector('.pdf-text-editor');
  if (!ed || !ed.isContentEditable) return false;
  const sel = window.getSelection();
  // 1) live selectie; 2) bewaarde selectie (paneel-klik liet hem collapsen);
  // 3) alleen een cursor: kleur de hele regel waar hij staat; 4) geen
  // caret-informatie: alle regels (via runs, nooit record-breed).
  let range = null;
  if (sel && sel.rangeCount > 0) {
    const live = sel.getRangeAt(0);
    if (!live.collapsed && ed.contains(live.commonAncestorContainer)) range = live.cloneRange();
  }
  // De bewaarde selectie geldt alleen als er sindsdien geen NIEUWERE caret
  // is gezet: wie het laatst klikte bepaalt het doel (woorden vs regel).
  if (!range && lastEditorSelectionRange
      && lastEditorSelectionAt >= lastEditorCaretAt
      && ed.contains(lastEditorSelectionRange.commonAncestorContainer)) {
    range = lastEditorSelectionRange.cloneRange();
  }
  if (!range) {
    let regel = null;
    const caret = (sel && sel.rangeCount > 0 && ed.contains(sel.getRangeAt(0).commonAncestorContainer))
      ? sel.getRangeAt(0)
      : (lastEditorCaretRange && ed.contains(lastEditorCaretRange.commonAncestorContainer)
        ? lastEditorCaretRange : null);
    if (caret) {
      let el = caret.commonAncestorContainer;
      if (el.nodeType !== Node.ELEMENT_NODE) el = el.parentElement;
      regel = el ? el.closest('div') : null;
    }
    range = document.createRange();
    if (regel && ed.contains(regel)) range.selectNodeContents(regel);
    else range.selectNodeContents(ed);
  }
  if (range.collapsed) return false;
  // Focus- en selectieherstel: de paneel-klik nam de focus; zet de cursor
  // terug waar hij stond en kleur de selectie.
  ed.focus();
  sel.removeAllRanges();
  sel.addRange(range);
  try { document.execCommand('styleWithCSS', false, true); } catch (_) { /* best effort */ }
  document.execCommand('foreColor', false, color);
  try { document.execCommand('styleWithCSS', false, false); } catch (_) { /* best effort */ }
  ed.dispatchEvent(new Event('input', { bubbles: true }));
  try {
    lastEditorSelectionRange = window.getSelection().getRangeAt(0).cloneRange();
    lastEditorSelectionAt = Date.now();
  } catch (_) { /* selectie optioneel */ }
  return true;
}

export function applyActiveTextEditStyle(key, value) {
  if (!activeEditor || !activeEditor.styleState) return;
  const st = activeEditor.styleState;
  switch (key) {
    case 'fontFamily':
      if (st.family !== value) st.fontFaceChanged = true;
      st.family = value;
      break;
    case 'textFontSize':
    case 'fontSize': {
      const n = parseInt(value);
      if (!isNaN(n) && n > 0) {
        st.size = n;
        activeEditor.lineSpacing = n * 1.2;
      }
      break;
    }
    case 'textColor':
    case 'color': {
      // Editor open: kleur ALTIJD via het run-/regelmechanisme (selectie,
      // anders de cursorregel) — nooit record-breed, dat zou lineStyles en
      // runs wissen en het hele blok kleuren.
      if (document.querySelector('.pdf-text-editor')) {
        applyColorToEditorSelection(value);
        return;
      }
      st.color = value;
      break;
    }
    case 'fontBold':
      if (st.bold !== !!value) st.fontFaceChanged = true;
      st.bold = !!value;
      break;
    case 'fontItalic':
      if (st.italic !== !!value) st.fontFaceChanged = true;
      st.italic = !!value;
      break;
    case 'fontUnderline': st.underline = !!value; break;
    case 'fontStrikethrough': st.strikethrough = !!value; break;
    default: return;
  }
  applyStyleStateToEditor(st);
  // Record sessions (inserted text or an existing edit record) update live so
  // the user sees the restyle immediately.
  if (activeEditor._recordRef) {
    applyStyleStateToRecord(activeEditor._recordRef, st);
    if (st.fontFaceChanged) activeEditor._recordRef.loadedFontName = '';
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

// ── Nieuw tekstblok toevoegen (klik op lege plek met de Tekst bewerken-tool) ──
// Maakt een leeg edit-record (originalText '') op het aangeklikte punt en
// opent daar de bestaande record-editor. De eerste commit met inhoud maakt de
// undo-stap aan; leeg committen of Escape ruimt het record stilletjes op.
// De saver schrijft het blok als echte paginatekst (BT/ET, Standard-14) en na
// save/heropenen is het gewone, opnieuw bewerk- en verplaatsbare tekst.
function startNewTextBlockAt(e, layer, pageNum) {
  const doc = getActiveDocument();
  if (!doc) return;
  const canvasEl = layer.parentElement?.querySelector('canvas.pdf-canvas')
    || pdfCanvas || document.getElementById('pdf-canvas');
  if (!canvasEl) return;

  // Klikpunt → onggeroteerde paginacoördinaten (pt, oorsprong linksboven),
  // daarna naar PDF-user-space (oorsprong linksonder).
  const rect = layer.getBoundingClientRect();
  const geometry = getTextEditGeometry(pageNum, canvasEl);
  const dispW = (geometry.rotation === 90 || geometry.rotation === 270)
    ? geometry.pageHeight : geometry.pageWidth;
  const dispH = (geometry.rotation === 90 || geometry.rotation === 270)
    ? geometry.pageWidth : geometry.pageHeight;
  const vx = (e.clientX - rect.left) / rect.width * dispW;
  const vy = (e.clientY - rect.top) / rect.height * dispH;
  const punt = invertPageRotation(vx, vy, geometry.pageWidth, geometry.pageHeight, geometry.rotation);
  // App-ruimte → ECHTE user-space: de box-oorsprong meenemen, anders landt een
  // nieuw blok op een CAD-plot (MediaBox rond de oorsprong) volledig mis.
  const pdfX = punt.x + (geometry.offsetXPt || 0);
  const pdfY = (geometry.offsetYPt || 0) + geometry.pageHeight - punt.y;

  const record = nieuwTekstblokRecord({ page: pageNum, pdfX, pdfY });
  // Op een /Rotate-pagina moet nieuwe tekst met de paginarotatie mee
  // geschreven worden, anders staat hij op het scherm (en op papier) gekanteld
  // — dezelfde conventie als bestaande tekst op zulke pagina's (textAngle).
  if (geometry.rotation) record.textAngle = geometry.rotation;
  if (!doc.textEdits) doc.textEdits = [];
  doc.textEdits.push(record);
  startTextEditEditing(record, pageNum, canvasEl);
}

// Versleep-grip-handlers voor de editor-overlay: scherm-deltas omrekenen
// naar PDF-punten en via de bestaande nudge record + editor live meebewegen.
// Escape tijdens het slepen draait de totale verplaatsing terug.
function maakDragHandlers() {
  return {
    onDragBy: (sxPx, syPx) => {
      if (!activeEditor) return;
      const canvasEl = pdfCanvas || document.getElementById('pdf-canvas');
      const geometry = getTextEditGeometry(activeEditor.pageNum, canvasEl);
      const m = getPageRotationMatrix(
        geometry.pageWidth, geometry.pageHeight, geometry.rotation,
      );
      const scale = activeEditor.scale || (getActiveDocument()?.scale || 1.5);
      const { dx, dy } = pdfDeltaFromScreenDelta(sxPx, syPx, scale, m);
      const tot = activeEditor._dragTotaal || { x: 0, y: 0 };
      activeEditor._dragTotaal = { x: tot.x + dx, y: tot.y + dy };
      nudgeActiveTextEdit(dx, dy);
    },
    onDragEnd: () => {
      if (activeEditor) activeEditor._dragTotaal = null;
    },
    onDragCancel: () => {
      const tot = activeEditor?._dragTotaal;
      if (tot && (tot.x || tot.y)) nudgeActiveTextEdit(-tot.x, -tot.y);
      if (activeEditor) activeEditor._dragTotaal = null;
    },
  };
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
  const shiftX = (a * dxPdf + c * unrotatedDy) * scale;
  const shiftY = (b * dxPdf + d * unrotatedDy) * scale;
  shiftPdfEditorPosition(shiftX, shiftY);
  if (Number.isFinite(activeEditor.editorBaseline)) {
    activeEditor.editorBaseline += shiftY;
  } else if (activeEditor.editorBaseline) {
    activeEditor.editorBaseline.left += shiftX;
    activeEditor.editorBaseline.top += shiftY;
  }
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

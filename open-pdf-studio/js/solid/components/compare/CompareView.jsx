import { createEffect, createMemo, createSignal, onCleanup, onMount, For, Show } from 'solid-js';
import {
  compareActive,
  compareOldPath,
  compareNewPath,
  compareMode,
  compareOldPage,
  compareNewPage,
  compareOldPageCount,
  compareNewPageCount,
  compareOffset,
  compareZoom,
  compareChanges,
  compareFocusedChange,
  compareShowAdded,
  compareShowRemoved,
  compareShowModified,
  compareShowBox,
  compareShowContour,
  compareFocused,
  compareFitRequest,
  compareDetecting,
  setCompareShowAdded,
  setCompareShowRemoved,
  setCompareShowModified,
  setCompareShowBox,
  setCompareShowContour,
  setFocusedChange,
  exitCompare,
  nextPagePair,
  prevPagePair,
  canNextPagePair,
  canPrevPagePair,
  setCompareZoom,
  setCompareOffset,
  requestCompareFit,
  requestCompareReset,
  comparePanelTab,
  setComparePanelTab,
  compareTextChanges,
  compareTextComparing,
  setCompareTextChanges,
  setCompareTextComparing,
  setPagePair,
  setCompareMode,
  compareAlignInfo,
  compareAlignPending,
  compareAutoAlign,
  setCompareAutoAlign,
  requestAutoAlign,
  resetCompareAlignment,
  comparePreset,
  setComparePreset,
  comparePairs,
  comparePairing,
  setComparePairing,
  setComparePairs,
  assignComparePair,
  gotoComparePair,
  compareMatchedIndex,
  compareMatchedCount,
  compareTruncated,
  compareMethod,
  compareMethodUsed,
  setCompareMethod,
} from '../../../compare/compare-store.js';
import {
  renderCompareSideBySide,
  renderCompareOverlay,
  paintHighlights,
  clearCompareDocCache,
  autoPairPages,
  pageNames,
} from '../../../compare/compare-viewport.js';
import { alignmentCss, normalizeAlignment } from '../../../compare/alignment.js';
import { SENSITIVITY_PRESETS, MM_PER_PT } from '../../../compare/detect-plan.js';
import { indexPairs } from '../../../compare/page-pairing.js';
import {
  collectReport, exportReportCsv, exportReportPdf, canPlaceClouds, placeChangeClouds,
} from '../../../compare/compare-report-run.js';
import { clearCompareSources } from '../../../compare/compare-sources.js';
import { runTextCompare, clearTextCompareCache } from '../../../compare/text-compare.js';
import { diffWords } from '../../../compare/text-diff.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { leesGetal } from '../../../core/getal-invoer.js';
import { state } from '../../../core/state.js';
import { diffAnnotationsForPair } from '../../../compare/compare-annotations.js';
import {
  isSinglePaneMode,
  splitFraction,
  screenPx,
} from '../../../compare/split-line.js';

// Verticale scheidingslijn tussen toolbar-groepen — Windows/Visual-Studio-stijl.
function Sep() {
  return <span style="width:1px; align-self:stretch; margin:2px 4px; background:#d4d4d4;"></span>;
}

export default function CompareView() {
  const { t } = useTranslation('ribbon');
  let oldCanvasRef;
  let newCanvasRef;
  let oldHiCanvasRef;   // side-by-side: diff overlay on OLD page
  let newHiCanvasRef;   // side-by-side: diff overlay on NEW page
  let overlayNewCanvasRef;
  // Split line: OLD page on top of NEW, shown left of the line only.
  let splitOldCanvasRef;
  let overlayHighlightCanvasRef;
  let bodyRef;
  let overlayWrapRef;
  // Side-by-side: elk document in een EIGEN scroll-paneel, met gespiegelde
  // scrollpositie — zo toont links en rechts altijd dezelfde plek, ook diep
  // ingezoomd (één gedeelde scroller schoof het andere document uit beeld).
  let oldPaneRef;
  let newPaneRef;
  let oldWrapRef;  // scaled wrapper holding OLD page + its diff overlay
  let newWrapRef;  // scaled wrapper holding NEW page + its diff overlay
  let _scrollSyncing = false;
  // Spiegel de scrollpositie proportioneel: de twee pagina's kunnen
  // verschillende afmetingen hebben, dus een absolute pixel-kopie zou
  // uiteenlopen. We rekenen met de fractie van de scrollbare ruimte zodat
  // "midden van links" ook "midden van rechts" toont.
  const syncScroll = (src, dst) => {
    if (_scrollSyncing || !src || !dst) return;
    _scrollSyncing = true;
    const sx = src.scrollWidth - src.clientWidth;
    const sy = src.scrollHeight - src.clientHeight;
    const dx = dst.scrollWidth - dst.clientWidth;
    const dy = dst.scrollHeight - dst.clientHeight;
    dst.scrollLeft = sx > 0 ? (src.scrollLeft / sx) * dx : src.scrollLeft;
    dst.scrollTop = sy > 0 ? (src.scrollTop / sy) * dy : src.scrollTop;
    requestAnimationFrame(() => { _scrollSyncing = false; });
  };
  // Pannen door slepen in een paneel; de scroll-sync spiegelt de beweging
  // automatisch naar het andere paneel. Pointer-capture zorgt dat snelle
  // sleepbewegingen buiten het element niet verloren gaan.
  const startPanDrag = (e, pane) => {
    // Left button or middle button drags to pan.
    if (!pane || (e.button !== 0 && e.button !== 1)) return;
    const rect = pane.getBoundingClientRect();
    // Klik op de scrollbalk zelf niet kapen.
    if (e.clientX - rect.left > pane.clientWidth || e.clientY - rect.top > pane.clientHeight) return;
    e.preventDefault();
    try { pane.setPointerCapture?.(e.pointerId); } catch {}
    let lastX = e.clientX;
    let lastY = e.clientY;
    const move = (ev) => {
      pane.scrollLeft -= ev.clientX - lastX;
      pane.scrollTop -= ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
    };
    const up = () => {
      try { pane.releasePointerCapture?.(e.pointerId); } catch {}
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // Middle mouse button (button 1) over a scrollable pane otherwise triggers the
  // browser's autoscroll, which hijacks the gesture so the pointer-based pan in
  // startPanDrag never runs. preventDefault() on pointerdown does NOT stop it —
  // for a mouse the autoscroll is a default of the separate mousedown event. So
  // suppress it here, bound as a DIRECT native listener (on:mousedown) so the
  // preventDefault is honoured before the default action fires.
  const killMiddleAutoscroll = (e) => { if (e.button === 1) e.preventDefault(); };
  const [highlight, setHighlight] = createSignal(null); // {x,y,w,h} flash highlight
  // Split line position as a fraction of the NEW page width (0 = all new, 1 = all old).
  const [splitPos, setSplitPos] = createSignal(0.5);
  // Page sizes in points in split mode (from the rendered bitmaps): the OLD
  // page is placed with the same alignment transform as the detection uses.
  const [splitBase, setSplitBase] = createSignal({ ow: 0, oh: 0, nw: 0, nh: 0, v: 1 });
  // Overlay and split line share one scroll body and one page wrapper.
  const singlePane = () => isSinglePaneMode(compareMode());
  let highlightTimer = null;

  // Instant CSS-transform preview while zooming. The bitmap stays at the
  // last hi-quality render scale; we visually scale the wrapper so the user
  // sees an immediate response. After a short debounce we trigger a true
  // re-render at the new scale and reset cssScale back to 1.
  const [cssScale, setCssScale] = createSignal(1);
  // The compareZoom value at which the current bitmap was rendered.
  let renderedZoom = compareZoom();
  let zoomDebounceTimer = null;
  const ZOOM_DEBOUNCE_MS = 150;
  // Set true when a zoom already re-anchored the scroll position itself (e.g.
  // cursor-anchored wheel, center-anchored +/− buttons). In that case the
  // post-render f-multiply must be skipped: the scroll is already expressed in
  // final visual terms, and the bitmap swap keeps the same visual size, so
  // re-scaling the scroll would double-apply the zoom factor and drift.
  let _scrollAlreadyAnchored = false;

  const visibleTypes = () => ({
    added: compareShowAdded(),
    removed: compareShowRemoved(),
    modified: compareShowModified(),
  });

  // Detection-px -> bitmap-px ratio. Maps a change bbox (measured in the fixed
  // detection raster) onto the CURRENTLY RENDERED bitmap. We use renderedZoom,
  // not the live zoom, because the highlight canvas is sized to the bitmap and
  // rides the same CSS `scale(cssScale)` wrapper as the page canvas — so any
  // in-progress zoom preview is applied once, by the wrapper, to both.
  // Change records are in page points (#465), like annotation and text
  // records, so one ratio maps them all onto the bitmap.
  const highlightRatio = () => 1.5 * renderedZoom;

  // Structurele annotatie-verschillen — los van de pixel-diff van de PDF-inhoud.
  // De app-annotaties zitten in een aparte overlay (doc.annotations), niet in
  // het gerenderde PDF-raster, dus de pixel-diff ziet ze niet. Reactief op het
  // pagina-paar én op de annotaties van beide documenten.
  const annotationChanges = createMemo(() =>
    compareActive()
      ? diffAnnotationsForPair(compareOldPath(), compareOldPage(), compareNewPath(), compareNewPage())
      : []
  );
  // Gecombineerde lijst voor het wijzigingen-paneel: PDF-inhoud + annotaties.
  const allChanges = createMemo(() => [...(compareChanges() || []), ...annotationChanges()]);
  // Navigatie/flash-ratio: annotatie-records staan in pagina-coördinaten
  // (× visualScale), inhouds-records in detectie-px (× highlightRatio).
  const changeRatio = () => highlightRatio();

  // ── Tekstmodus-arcering ────────────────────────────────────────────────
  // Met de Tekst-tab actief vervangt de tekststroom-diff de pixel-diff op de
  // pagina's: pixel-detectie slaat op tekstdocumenten vals af op elke
  // sub-pixel-verschuiving, terwijl de tekst-diff exact weet welke regels
  // veranderd zijn. Rects staan in pagina-weergaveruimte (schaal 1, oorsprong
  // linksboven) → ratio 1.5 × renderedZoom, gelijk aan de pagina-bitmap.
  const textModeActive = () => comparePanelTab() === 'text' && Array.isArray(compareTextChanges());
  // Pseudo-change-records (drawHighlights-vorm) voor één zijde/pagina.
  const textPaneChanges = (side) => {
    const page = side === 'old' ? compareOldPage() : compareNewPage();
    const out = [];
    for (const c of compareTextChanges() || []) {
      const rects = side === 'old' ? c.oldRects : c.newRects;
      for (const r of rects || []) {
        if (r.page !== page) continue;
        out.push({ type: c.type, x: r.x, y: r.y, width: r.w, height: r.h, _rec: c });
      }
    }
    return out;
  };
  // Omsluitende bbox van de rects van een tekst-record op één zijde/pagina —
  // voor het selectie-accent en het inzoomen bij klik.
  const textChangeBBox = (c, side) => {
    const page = side === 'old' ? compareOldPage() : compareNewPage();
    const rects = (side === 'old' ? c.oldRects : c.newRects) || [];
    let bb = null;
    for (const r of rects) {
      if (r.page !== page) continue;
      if (!bb) bb = { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h };
      else {
        bb.x1 = Math.min(bb.x1, r.x);
        bb.y1 = Math.min(bb.y1, r.y);
        bb.x2 = Math.max(bb.x2, r.x + r.w);
        bb.y2 = Math.max(bb.y2, r.y + r.h);
      }
    }
    return bb ? { type: c.type, source: 'text', x: bb.x1, y: bb.y1, width: bb.x2 - bb.x1, height: bb.y2 - bb.y1 } : null;
  };
  const paintTextHighlights = (canvas, side) => {
    const sel = compareFocusedChange();
    const selBBox = sel && sel.source === 'text' ? textChangeBBox(sel, side) : null;
    paintHighlights(canvas, textPaneChanges(side), {
      ratio: 1.5 * renderedZoom,
      visibleTypes: { added: true, removed: true, modified: true },
      showBox: true,
      showContour: false,
      selected: selBBox,
      clear: true,
    });
  };

  // Paint one highlight canvas restricted to a subset of change types. Used by
  // both modes: overlay shows all three; side-by-side shows removed+modified on
  // OLD and added+modified on NEW so each edit lands on the page it belongs to.
  // On the OLD page a content change is drawn at its place on the old sheet
  // (alignment and scale applied in reverse).
  const onOldPage = (c) => (c && c.old ? { ...c, x: c.old.x, y: c.old.y, width: c.old.width, height: c.old.height } : c);
  const paintPaneHighlights = (canvas, allow, side = 'new') => {
    if (!canvas) return;
    const v = visibleTypes();
    const sel0 = compareFocusedChange();
    const sel = side === 'old' ? onOldPage(sel0) : sel0;
    // Only draw the selection accent on a pane that shows the selected type,
    // so a "removed" selection doesn't get a border on the NEW pane.
    const selForPane = sel && allow[sel.type] && v[sel.type] ? sel : null;
    const vis = {
      added: !!v.added && !!allow.added,
      removed: !!v.removed && !!allow.removed,
      modified: !!v.modified && !!allow.modified,
    };
    const style = { showBox: compareShowBox(), showContour: compareShowContour() };
    // Content changes are measured in detection-px → highlightRatio(). This call
    // clears the canvas first.
    const content = side === 'old' ? (compareChanges() || []).map(onOldPage) : compareChanges();
    paintHighlights(canvas, content, {
      ratio: highlightRatio(), visibleTypes: vis, ...style,
      selected: selForPane && selForPane.source !== 'annotation' ? selForPane : null,
      clear: true,
    });
    // Annotation changes are measured in page-points (scale 1) → 1.5*renderedZoom,
    // the SAME mapping the page render uses. Previously these weren't painted at
    // all (only listed), and a selected annotation got drawn with the content
    // ratio — landing in the wrong place. Layer them on top without clearing.
    paintHighlights(canvas, annotationChanges(), {
      ratio: 1.5 * renderedZoom, visibleTypes: vis, ...style,
      selected: selForPane && selForPane.source === 'annotation' ? selForPane : null,
      clear: false,
    });
  };

  // Keep every highlight canvas the same pixel size as its page canvas, then
  // repaint. Runs after a render and whenever the change list/toggles change.
  const repaintHighlights = () => {
    // Tekstmodus: alléén de tekststroom-diff arceren (rood = verwijderd op
    // OUD, groen = toegevoegd op NIEUW, amber = gewijzigd op beide zijden);
    // de pixel-diff-laag blijft in deze modus onzichtbaar zodat er geen twee
    // tegenstrijdige markeringen door elkaar lopen.
    const textMode = textModeActive();
    if (singlePane()) {
      if (!overlayHighlightCanvasRef || !overlayNewCanvasRef) return;
      overlayHighlightCanvasRef.width = overlayNewCanvasRef.width;
      overlayHighlightCanvasRef.height = overlayNewCanvasRef.height;
      if (textMode) paintTextHighlights(overlayHighlightCanvasRef, 'new');
      else paintPaneHighlights(overlayHighlightCanvasRef, { added: true, removed: true, modified: true });
    } else {
      if (oldHiCanvasRef && oldCanvasRef) {
        oldHiCanvasRef.width = oldCanvasRef.width;
        oldHiCanvasRef.height = oldCanvasRef.height;
        if (textMode) paintTextHighlights(oldHiCanvasRef, 'old');
        else paintPaneHighlights(oldHiCanvasRef, { added: false, removed: true, modified: true }, 'old');
      }
      if (newHiCanvasRef && newCanvasRef) {
        newHiCanvasRef.width = newCanvasRef.width;
        newHiCanvasRef.height = newCanvasRef.height;
        if (textMode) paintTextHighlights(newHiCanvasRef, 'new');
        else paintPaneHighlights(newHiCanvasRef, { added: true, removed: false, modified: true });
      }
    }
  };

  // Scroll a single pane so the change's centre lands in the middle of the
  // viewport. Shared by overlay (bodyRef) and side-by-side (both panes).
  const scrollPaneToChange = (pane, wrap, c, smooth = true) => {
    if (!pane || !wrap) return;
    // highlightRatio() maps to bitmap-px; the wrapper's CSS scale turns that
    // into on-screen (content) px, so fold cssScale in to hit the right spot
    // even if a zoom preview is still in flight.
    const ratio = changeRatio(c) * cssScale();
    const cx = wrap.offsetLeft + (c.x + c.width / 2) * ratio;
    const cy = wrap.offsetTop + (c.y + c.height / 2) * ratio;
    pane.scrollTo({
      left: Math.max(0, cx - pane.clientWidth / 2),
      top: Math.max(0, cy - pane.clientHeight / 2),
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  // Click a change → center it in the pane(s) AND zoom in so it fills a
  // comfortable part of the viewport. Reuses scrollPaneToChange (instant centre)
  // + zoomAnchored (keeps that centre fixed while scaling), so both panes stay
  // in sync via the existing scroll/zoom mirroring. Only ever zooms IN.
  const zoomToChange = (c) => {
    const isOverlay = singlePane();
    const pairs = isOverlay
      ? [[bodyRef, overlayWrapRef]]
      : [[oldPaneRef, oldWrapRef], [newPaneRef, newWrapRef]];
    const refPane = pairs[0][0];
    if (!refPane) return;
    // 1. instantly centre the change in each pane at the current zoom
    _scrollSyncing = true;
    for (const [pane, wrap] of pairs) scrollPaneToChange(pane, wrap, pane === oldPaneRef ? onOldPage(c) : c, false);
    requestAnimationFrame(() => { _scrollSyncing = false; });
    // 2. zoom so the change fills ~55% of the pane — clamp to zoom-in only
    const curW = Math.max(1, c.width * changeRatio(c));
    const curH = Math.max(1, c.height * changeRatio(c));
    const frac = 0.55;
    let factor = Math.min(refPane.clientWidth * frac / curW, refPane.clientHeight * frac / curH);
    factor = Math.min(factor, 8 / Math.max(0.01, compareZoom())); // never past max zoom
    if (factor <= 1.02) return; // already large enough → leave it centred
    // 3. zoom around the pane centre, where the change now sits
    const rect = refPane.getBoundingClientRect();
    zoomAnchored(refPane, rect.left + refPane.clientWidth / 2, rect.top + refPane.clientHeight / 2, factor);
  };

  const focusOnChange = (c) => {
    // Toggle selection if same record clicked again.
    const cur = compareFocusedChange();
    if (cur === c) {
      setFocusedChange(null);
      repaintHighlights();
      return;
    }
    setFocusedChange(c);

    // Centre + zoom in on the clicked change (both panes / overlay).
    zoomToChange(c);

    if (singlePane() && bodyRef && overlayWrapRef) {
      const ratio = changeRatio(c);
      setHighlight({ x: c.x * ratio, y: c.y * ratio, w: c.width * ratio, h: c.height * ratio });
      if (highlightTimer) clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => setHighlight(null), 1000);
    }
    repaintHighlights();
  };

  let busy = false;
  let pending = false;
  // When set, the next doRender() will skip change detection. Used by zoom-
  // only re-renders since detection bboxes are computed in a fixed
  // detection-px space and are independent of the display scale.
  let pendingSkipDetection = false;

  const doRender = async (opts2 = {}) => {
    if (busy) {
      pending = true;
      // Keep skip flag sticky-true so zoom-only renders never trigger
      // detection, but if any non-zoom render is requested while busy, clear
      // it so detection runs once after the busy render.
      if (!opts2.skipDetection) pendingSkipDetection = false;
      return;
    }
    busy = true;
    const skipDetection = !!opts2.skipDetection || pendingSkipDetection;
    pendingSkipDetection = false;
    const zoomAtRender = compareZoom();
    try {
      const opts = {
        oldPath: compareOldPath(),
        newPath: compareNewPath(),
        oldPage: compareOldPage(),
        newPage: compareNewPage(),
        scale: 1.5 * zoomAtRender,
        offset: compareOffset(),
        preset: comparePreset(),
        method: compareMethod(),
        autoAlign: compareAlignPending(),
        skipDetection,
      };
      if (!opts.oldPath || !opts.newPath) return;
      if (compareMode() === 'split') {
        // Both pages rendered visibly; the CSS clip shows OLD left of the line.
        if (splitOldCanvasRef && overlayNewCanvasRef) {
          await renderCompareSideBySide(splitOldCanvasRef, overlayNewCanvasRef, opts);
          const v = opts.scale;
          setSplitBase({
            ow: splitOldCanvasRef.width / v, oh: splitOldCanvasRef.height / v,
            nw: overlayNewCanvasRef.width / v, nh: overlayNewCanvasRef.height / v, v,
          });
          repaintHighlights();
        }
      } else if (compareMode() === 'overlay') {
        if (overlayNewCanvasRef && overlayHighlightCanvasRef) {
          await renderCompareOverlay(
            null,
            overlayNewCanvasRef,
            opts,
            overlayHighlightCanvasRef,
          );
          repaintHighlights();
        }
      } else {
        if (oldCanvasRef && newCanvasRef) {
          await renderCompareSideBySide(oldCanvasRef, newCanvasRef, opts);
          repaintHighlights();
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[compare] render failed', err);
    } finally {
      busy = false;
      // The freshly painted bitmap matches zoomAtRender. Reset CSS preview
      // so what the user sees is the crisp HQ bitmap (not a CSS-stretched
      // copy). We also remember the zoom so further wheel events can compute
      // a fresh CSS-only delta from this baseline.
      const prevZoom = renderedZoom;
      renderedZoom = zoomAtRender;
      // Zoom-anker: de content is een factor f groter/kleiner geworden —
      // schaal de scrollposities mee zodat beide panelen (en de overlay)
      // dezelfde plek blijven tonen i.p.v. naar linksboven te driften.
      // Dit vertaalt de scrollpositie uit de CSS-preview-ruimte (bitmap nog op
      // de oude schaal) naar de nieuwe native-bitmap-ruimte. Bij cursor-zoom
      // is de scroll al op het cursor-punt gezet in preview-ruimte; deze factor
      // houdt datzelfde punt vast wanneer de scherpe bitmap de preview vervangt.
      const f = prevZoom > 0 ? zoomAtRender / prevZoom : 1;
      if (_scrollAlreadyAnchored) {
        // Scroll was pre-set to hold a specific anchor; the visual size is
        // unchanged by the bitmap swap, so leave scroll untouched.
        _scrollAlreadyAnchored = false;
      } else if (Math.abs(f - 1) > 1e-4) {
        _scrollSyncing = true;
        for (const pane of [oldPaneRef, newPaneRef, bodyRef]) {
          if (!pane) continue;
          pane.scrollLeft *= f;
          pane.scrollTop *= f;
        }
        requestAnimationFrame(() => { _scrollSyncing = false; });
      }
      // If the user kept zooming during render, recompute cssScale relative
      // to the new baseline so the preview stays consistent.
      const cur = compareZoom();
      setCssScale(cur === renderedZoom ? 1 : cur / renderedZoom);
      // Repaint highlights at the crisp scale (ratio changed with the bitmap).
      repaintHighlights();
      if (pending) {
        pending = false;
        doRender();
      }
    }
  };

  const scheduleHQRender = () => {
    if (zoomDebounceTimer) clearTimeout(zoomDebounceTimer);
    zoomDebounceTimer = setTimeout(() => {
      zoomDebounceTimer = null;
      // Zoom-only re-render: skip change detection entirely. Bbox results
      // are in detection-pixel space and don't change with display scale.
      doRender({ skipDetection: true });
    }, ZOOM_DEBOUNCE_MS);
  };

  // Non-zoom deps trigger an immediate HQ render. Zoom is handled in a
  // separate effect below with debouncing + CSS-transform preview.
  createEffect(() => {
    compareOldPath();
    compareNewPath();
    compareMode();
    compareOldPage();
    compareNewPage();
    compareOffset();
    comparePreset();
    compareMethod();
    compareAlignPending();
    if (compareActive()) {
      // Reset CSS preview state — after a path/page/mode change the bitmap
      // baseline is whatever the next render produces.
      setCssScale(1);
      if (zoomDebounceTimer) {
        clearTimeout(zoomDebounceTimer);
        zoomDebounceTimer = null;
      }
      queueMicrotask(doRender);
    }
  });

  // Zoom: instant CSS preview + debounced HQ re-render.
  createEffect(() => {
    const z = compareZoom();
    if (!compareActive()) return;
    // Visual scale relative to whatever the bitmap was last rendered at.
    if (renderedZoom > 0) {
      setCssScale(z / renderedZoom);
    }
    scheduleHQRender();
  });

  // Repaint highlight overlay when the changes list, visibility toggles, or
  // selection change — without re-running the full PDF render. Runs in BOTH
  // modes now (side-by-side paints per pane, overlay paints one canvas).
  createEffect(() => {
    compareChanges();
    annotationChanges();
    compareShowAdded();
    compareShowRemoved();
    compareShowModified();
    compareShowBox();
    compareShowContour();
    compareFocusedChange();
    compareMode();
    comparePanelTab();
    compareTextChanges();
    compareOldPage();
    compareNewPage();
    if (compareActive()) {
      queueMicrotask(repaintHighlights);
    }
  });

  // Fit / reset requests from the toolbar. Compute a zoom that makes the NEW
  // page fill the available viewport (fit) or snap to 100% (reset).
  createEffect(() => {
    const req = compareFitRequest();
    if (!req.kind || !compareActive()) return;
    // Reset scroll to the top-left so the (re)fitted page is fully framed
    // rather than left scrolled where the previous zoom sat. Flag the upcoming
    // render to keep this scroll instead of scaling the old one.
    const resetScroll = () => {
      _scrollAlreadyAnchored = true;
      _scrollSyncing = true;
      for (const p of [oldPaneRef, newPaneRef, bodyRef]) { if (p) { p.scrollLeft = 0; p.scrollTop = 0; } }
      requestAnimationFrame(() => { _scrollSyncing = false; });
    };
    if (req.kind === 'reset') {
      setCompareZoom(1);
      resetScroll();
      return;
    }
    // Fit: the rendered bitmap is (natural * 1.5 * renderedZoom) px. Work out
    // the natural (scale-1.5) size, then pick a zoom so it fits the pane.
    queueMicrotask(() => {
      const baseCanvas = singlePane() ? overlayNewCanvasRef : newCanvasRef;
      const pane = singlePane() ? bodyRef : newPaneRef;
      if (!baseCanvas || !pane || renderedZoom <= 0) return;
      const naturalW = baseCanvas.width / renderedZoom;   // px at zoom=1
      const naturalH = baseCanvas.height / renderedZoom;
      if (naturalW <= 0 || naturalH <= 0) return;
      const padding = 28; // breathing room inside the pane
      const availW = Math.max(1, pane.clientWidth - padding);
      const availH = Math.max(1, pane.clientHeight - padding);
      const z = Math.min(availW / naturalW, availH / naturalH);
      setCompareZoom(z);
      resetScroll();
    });
  });

  // Na het sluiten: geen pdf.js-documenten, maskers of tekst-diffs van deze
  // sessie vasthouden (een eerdere versie kan intussen anders zijn).
  createEffect(() => {
    if (!compareActive()) {
      clearCompareDocCache();
      clearTextCompareCache();
    }
  });

  onCleanup(() => {
    if (zoomDebounceTimer) {
      clearTimeout(zoomDebounceTimer);
      zoomDebounceTimer = null;
    }
    clearCompareDocCache();
    clearTextCompareCache();
    clearCompareSources();
  });

  // Tekstvergelijking: draait één keer per documentpaar zodra de gebruiker de
  // Tekst-tab opent (lazy — extractie van alle pagina's is niet gratis).
  let _textRunSeq = 0;
  createEffect(() => {
    if (comparePanelTab() !== 'text' || !compareActive()) return;
    if (compareTextChanges() !== null || compareTextComparing()) return;
    const oldP = compareOldPath();
    const newP = compareNewPath();
    if (!oldP || !newP) return;
    const seq = ++_textRunSeq;
    setCompareTextComparing(true);
    runTextCompare(oldP, newP)
      .then((list) => { if (seq === _textRunSeq) setCompareTextChanges(list); })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[compare] text compare failed', err);
        if (seq === _textRunSeq) setCompareTextChanges([]);
      })
      .finally(() => { if (seq === _textRunSeq) setCompareTextComparing(false); });
  });

  // Automatische paginakoppeling (#465): één keer per documentpaar, op de
  // achtergrond. Tot hij klaar is gelden de index-paren.
  const [pageInfo, setPageInfo] = createSignal({ old: new Map(), new: new Map() });
  let _pairRunSeq = 0;
  createEffect(() => {
    if (!compareActive()) return;
    const oldP = compareOldPath();
    const newP = compareNewPath();
    if (!oldP || !newP) return;
    const seq = ++_pairRunSeq;
    setComparePairing(true);
    setPageInfo({ old: new Map(), new: new Map() });
    autoPairPages(oldP, newP, () => seq === _pairRunSeq && compareActive())
      .then((res) => {
        if (!res || seq !== _pairRunSeq) return;
        setPageInfo({ old: pageNames(res.oldPages), new: pageNames(res.newPages) });
        setComparePairs(res.pairs);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[compare] page pairing failed', err);
        if (seq === _pairRunSeq) setComparePairs(indexPairs(compareOldPageCount(), compareNewPageCount()));
      })
      .finally(() => { if (seq === _pairRunSeq) setComparePairing(false); });
  });

  // ── Wijzigingsrapport (#465) ──────────────────────────────────────────
  const [reportBusy, setReportBusy] = createSignal(null); // null | { done, total }
  const [reportMenu, setReportMenu] = createSignal(false);
  const [statusMsg, setStatusMsg] = createSignal('');
  let _statusTimer = null;
  const flash = (msg) => {
    setStatusMsg(msg);
    if (_statusTimer) clearTimeout(_statusTimer);
    _statusTimer = setTimeout(() => setStatusMsg(''), 5000);
  };
  const reportPairs = () => {
    const list = (comparePairs() || []).filter((p) => p.old != null && p.new != null);
    return list.length ? list : [{ old: compareOldPage(), new: compareNewPage() }];
  };
  const runReport = async (kind) => {
    setReportMenu(false);
    if (reportBusy()) return;
    const o = { oldPath: compareOldPath(), newPath: compareNewPath(), preset: comparePreset(), method: compareMethod() };
    setReportBusy({ done: 0, total: reportPairs().length });
    try {
      const results = await collectReport({
        ...o,
        pairs: reportPairs(),
        autoAlign: compareAutoAlign(),
        sheets: pageInfo().new,
        onProgress: (done, total) => setReportBusy({ done, total }),
        isCancelled: () => !compareActive(),
      });
      if (!results) return;
      const ok = kind === 'csv'
        ? await exportReportCsv(o, results)
        : await exportReportPdf(o, results, { onProgress: (done, total) => setReportBusy({ done, total }) });
      if (ok) flash(t('compare.report.saved') || 'Report saved');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[compare] report failed', err);
      flash(t('compare.report.failed') || 'The report could not be created');
    } finally {
      setReportBusy(null);
    }
  };
  // Wijzigingen aangevinkt in de lijst, voor wolken op het nieuwe document.
  const [checked, setChecked] = createSignal(new Set());
  createEffect(() => { compareChanges(); compareOldPage(); compareNewPage(); setChecked(new Set()); });
  const toggleChecked = (c) => {
    const next = new Set(checked());
    if (next.has(c)) next.delete(c); else next.add(c);
    setChecked(next);
  };
  const placeClouds = async () => {
    setReportMenu(false);
    const list = (allChanges() || []).filter((c) => checked().has(c) && c.source !== 'annotation');
    if (!list.length) return;
    const n = await placeChangeClouds(compareNewPath(), compareNewPage(), list);
    if (n) flash((t('compare.report.cloudsPlaced', { count: n }) || `${n}`));
  };

  // Klik op een tekstverschil → spring naar de betreffende pagina('s), licht
  // de bijbehorende arcering op (selectie-accent) en centreer/zoom erop.
  const gotoTextChange = (c) => {
    const op = c.oldPage != null ? c.oldPage : c.newPage;
    const np = c.newPage != null ? c.newPage : c.oldPage;
    setPagePair(op, np);
    setFocusedChange(c);
    // Na de paginawissel (render is async, maar de rect-coördinaten zijn
    // schaal-onafhankelijk) centreren op de nieuwe zijde als die bestaat,
    // anders op de oude.
    queueMicrotask(() => {
      const bb = textChangeBBox(c, c.newRects?.length ? 'new' : 'old');
      if (bb) zoomToChange(bb);
      repaintHighlights();
    });
  };

  // Esc closes compare mode (capture phase so it wins over other Esc handlers).
  // PageDown/PageUp bladert door de pagina-paren — met 28 pagina's is alleen
  // de kleine ‹/›-knop onwerkbaar. Toetsen in invoervelden (dx/dy/rot) blijven
  // met rust.
  onMount(() => {
    const onKey = (e) => {
      if (!compareActive() || !compareFocused()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitCompare();
        return;
      }
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Ctrl+PageUp/PageDown is de tabwissel (#539), geen paginapaar.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'PageDown') {
        e.preventDefault();
        e.stopPropagation();
        nextPagePair();
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        e.stopPropagation();
        prevPagePair();
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  // Cursor-anchored wheel zoom, matching the main viewer's feel: the point
  // under the cursor stays put while zooming. Works without Ctrl (the previous
  // implementation was a no-op unless Ctrl was held — the main reason zoom felt
  // "limited"). Shift+wheel keeps native scrolling; Ctrl+wheel still zooms.
  // Zoom by `factor`, keeping the viewport point (ax, ay) — expressed in the
  // pane's client coordinates — fixed on screen. Immediately adjusts scroll so
  // the anchor holds through the CSS preview; flags the render to skip its
  // post-swap re-scale so the factor isn't double-applied.
  const zoomAnchored = (pane, ax, ay, factor) => {
    if (!pane) { setCompareZoom(compareZoom() * factor); return; }
    const rect = pane.getBoundingClientRect();
    const offX = ax - rect.left;
    const offY = ay - rect.top;
    // Point under the anchor, in the current rendered coordinate space.
    const px = pane.scrollLeft + offX;
    const py = pane.scrollTop + offY;
    const z0 = compareZoom();
    const z1 = Math.max(0.1, Math.min(8, z0 * factor));
    const applied = z1 / z0;
    if (Math.abs(applied - 1) < 1e-6) return;
    const newLeft = Math.max(0, px * applied - offX);
    const newTop = Math.max(0, py * applied - offY);
    _scrollAlreadyAnchored = true;
    setCompareZoom(z1);
    _scrollSyncing = true;
    pane.scrollLeft = newLeft;
    pane.scrollTop = newTop;
    if (compareMode() === 'side') {
      const other = pane === oldPaneRef ? newPaneRef : oldPaneRef;
      if (other) { other.scrollLeft = newLeft; other.scrollTop = newTop; }
    }
    requestAnimationFrame(() => { _scrollSyncing = false; });
  };

  // The pane the cursor/interaction is currently over (side-by-side) or the
  // overlay scroll body.
  const activePane = (clientX) => {
    if (compareMode() !== 'side') return bodyRef;
    if (clientX == null || !oldPaneRef || !newPaneRef) return oldPaneRef;
    return clientX < oldPaneRef.getBoundingClientRect().right ? oldPaneRef : newPaneRef;
  };

  // Wiel-paginanavigatie zoals de enkelpagina-weergave (navigation-events.js):
  // gewoon scrollen beweegt binnen de pagina; onderaan + verder scrollen →
  // volgend pagina-paar, bovenaan + terugscrollen → vorig paar. Beide zijden
  // wisselen samen (nextPagePair/prevPagePair — de scroll-sync spiegelt de
  // scrollpositie al). Ctrl+wiel (of de wheelZoomWithoutCtrl-voorkeur) zoomt
  // cursor-veranker(d), net als de hoofd-viewer.
  let _wheelNavCooldown = false;
  const WHEEL_EDGE_SLACK = 2;
  const _navPanes = () => (compareMode() === 'side' ? [oldPaneRef, newPaneRef] : [bodyRef]);
  const _alignAfterNav = (toTop) => {
    const apply = () => {
      _scrollSyncing = true;
      for (const p of _navPanes()) {
        if (!p) continue;
        p.scrollTop = toTop ? 0 : Math.max(0, p.scrollHeight - p.clientHeight);
      }
      requestAnimationFrame(() => { _scrollSyncing = false; });
    };
    apply();
    // Na de (async) render van de nieuwe pagina kan de hoogte anders zijn —
    // nog één keer uitlijnen zodra de nieuwe bitmap er staat.
    setTimeout(apply, 250);
  };
  const tryWheelPageNav = (pane, deltaY) => {
    if (!pane || _wheelNavCooldown || !deltaY) return false;
    const canScroll = pane.scrollHeight > pane.clientHeight + 1;
    const atBottom = !canScroll
      || pane.scrollTop + pane.clientHeight >= pane.scrollHeight - WHEEL_EDGE_SLACK;
    const atTop = !canScroll || pane.scrollTop <= WHEEL_EDGE_SLACK;
    if (deltaY > 0 && atBottom && canNextPagePair()) {
      _wheelNavCooldown = true;
      nextPagePair();
      _alignAfterNav(true);
      setTimeout(() => { _wheelNavCooldown = false; }, 350);
      return true;
    }
    if (deltaY < 0 && atTop && canPrevPagePair()) {
      _wheelNavCooldown = true;
      prevPagePair();
      _alignAfterNav(false);
      setTimeout(() => { _wheelNavCooldown = false; }, 350);
      return true;
    }
    return false;
  };

  const handleWheel = (e) => {
    // Wheels over the change-list side panel scroll that list natively.
    if (e.target?.closest?.('.compare-change-list')) return;
    // Shift+wheel: let the browser scroll natively (horizontal), don't zoom.
    if (e.shiftKey) return;
    if (e.ctrlKey || e.metaKey || state.preferences?.wheelZoomWithoutCtrl) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAnchored(activePane(e.clientX), e.clientX, e.clientY, factor);
      return;
    }
    // Gewoon wiel: native scroll binnen het paneel (de onScroll-sync spiegelt
    // de andere zijde); op de rand → doorbladeren naar het volgende/vorige
    // pagina-paar.
    if (tryWheelPageNav(activePane(e.clientX), e.deltaY)) e.preventDefault();
  };

  // +/− buttons zoom around the centre of the (first) pane so the view doesn't
  // lurch toward the top-left corner.
  const zoomButton = (factor) => {
    const pane = compareMode() === 'side' ? oldPaneRef : bodyRef;
    if (!pane) { setCompareZoom(compareZoom() * factor); return; }
    const rect = pane.getBoundingClientRect();
    zoomAnchored(pane, rect.left + pane.clientWidth / 2, rect.top + pane.clientHeight / 2, factor);
  };

  // Drag the split line. The wrapper's rect already includes the CSS zoom
  // preview, so the fraction is right at any zoom.
  const startSplitDrag = (e) => {
    if (e.button !== 0 || !overlayWrapRef) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    try { target.setPointerCapture?.(e.pointerId); } catch {}
    const move = (ev) => {
      if (!overlayWrapRef) return;
      const rect = overlayWrapRef.getBoundingClientRect();
      const f = splitFraction(ev.clientX, rect.left, rect.width);
      if (f != null) setSplitPos(f);
    };
    const up = () => {
      try { target.releasePointerCapture?.(e.pointerId); } catch {}
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    move(e);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // OLD page placement in split mode: the same dx/dy/rot alignment the change
  // detection applies (bitmap px, rotation about the NEW page centre).
  const oldSplitTransform = () => {
    const b = splitBase();
    return alignmentCss(compareOffset(), { width: b.ow, height: b.oh }, { width: b.nw, height: b.nh }, b.v);
  };

  // Labels and handle keep their screen size while the wrapper is CSS-scaled.
  const px = (n) => screenPx(n, cssScale());

  // Click outside the change list deselects the focused change.
  const handleBodyClick = () => {
    setReportMenu(false);
    if (compareFocusedChange()) setFocusedChange(null);
  };

  return (
    <Show when={compareActive()}>
      <div
        class="compare-view"
        style={`position:absolute; inset:0; display:${compareFocused() ? 'flex' : 'none'}; flex-direction:column; background:var(--page-area-bg, #2a2a2a);`}
        onWheel={handleWheel}
      >
        <div
          class="compare-toolbar"
          style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:5px 10px; background:linear-gradient(#ffffff, #f5f5f5); border-bottom:1px solid #d4d4d4; color:#222; font-size:12px;"
        >
          {/* Titel + weergavemodus */}
          <strong>{t('compare.title') || 'Compare PDFs'}</strong>
          <select
            style="font-size:12px;"
            onChange={(e) => setCompareMode(e.currentTarget.value)}
          >
            <option value="overlay" selected={compareMode() === 'overlay'}>{t('compare.overlay') || 'Overlay'}</option>
            <option value="side" selected={compareMode() === 'side'}>{t('compare.sideBySide') || 'Side-by-side'}</option>
            <option value="split" selected={compareMode() === 'split'}>{t('compare.split') || 'Split line'}</option>
          </select>

          <Sep />

          {/* Paginanavigatie */}
          <span style="color:#555;">{t('compare.page') || 'Page'}</span>
          <button class="pref-btn pref-btn-secondary" disabled={!canPrevPagePair()} title={t('compare.page') || 'Page'} onClick={prevPagePair}>{'‹'}</button>
          <span
            style="min-width:58px; text-align:center; font-variant-numeric:tabular-nums;"
            title={compareMatchedCount() ? `${t('compare.pair') || 'Pair'} ${compareMatchedIndex() + 1}/${compareMatchedCount()}` : ''}
          >{compareOldPage()}/{compareOldPageCount()} · {compareNewPage()}/{compareNewPageCount()}</span>
          <button class="pref-btn pref-btn-secondary" disabled={!canNextPagePair()} title={t('compare.page') || 'Page'} onClick={nextPagePair}>{'›'}</button>

          <Sep />

          {/* Zoom */}
          <span style="color:#555;">{t('compare.zoom') || 'Zoom'}</span>
          <button class="pref-btn pref-btn-secondary" title="-" onClick={() => zoomButton(1 / 1.2)}>−</button>
          <span style="min-width:42px; text-align:center; font-variant-numeric:tabular-nums;">{Math.round(compareZoom() * 100)}%</span>
          <button class="pref-btn pref-btn-secondary" title="+" onClick={() => zoomButton(1.2)}>+</button>
          <button class="pref-btn pref-btn-secondary" title={t('compare.fit') || 'Passend'} onClick={requestCompareFit}>{t('compare.fit') || 'Passend'}</button>
          <button class="pref-btn pref-btn-secondary" title={t('compare.reset') || '100%'} onClick={requestCompareReset}>{t('compare.reset') || '100%'}</button>

          <Sep />

          {/* Markering */}
          <span style="color:#555;">{t('compare.marking') || 'Markering'}</span>
          <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer;" title={t('compare.boxHint') || 'Toon wijzigingen als gevuld vlak'}>
            <input type="checkbox" checked={compareShowBox()} onChange={(e) => setCompareShowBox(e.currentTarget.checked)} />
            {t('compare.box') || 'Vlak'}
          </label>
          <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer;" title={t('compare.contourHint') || 'Toon wijzigingen met een omtreklijn'}>
            <input type="checkbox" checked={compareShowContour()} onChange={(e) => setCompareShowContour(e.currentTarget.checked)} />
            {t('compare.contour') || 'Contour'}
          </label>

          <Sep />

          {/* Gevoeligheid (#465): drempel, minimale clustergrootte en
              samenvoegafstand samen. */}
          <span style="color:#555;">{t('compare.sensitivity') || 'Sensitivity'}</span>
          <select
            style="font-size:12px;"
            title={t('compare.sensitivityHint') || 'Threshold, minimum change size and merge distance'}
            onChange={(e) => setComparePreset(e.currentTarget.value)}
          >
            <For each={Object.keys(SENSITIVITY_PRESETS)}>
              {(k) => <option value={k} selected={comparePreset() === k}>{t(`compare.preset.${k}`) || k}</option>}
            </For>
          </select>
          <label
            style="display:inline-flex; align-items:center; gap:3px;"
            title={t('compare.methodVectorHint') || 'Compare the drawn paths exactly where both pages are vector drawings'}
          >
            <input type="checkbox" checked={compareMethod() === 'vector'} onChange={(e) => setCompareMethod(e.currentTarget.checked ? 'vector' : 'pixel')} />
            {t('compare.methodVector') || 'Vector'}
            <Show when={compareMethod() === 'vector' && compareMethodUsed() !== 'vector' && !compareDetecting()}>
              <span style="color:#b45309;">({t('compare.methodPixelFallback') || 'pixels: not a vector page'})</span>
            </Show>
          </label>

          <Sep />

          {/* Uitlijnen: automatisch (met betrouwbaarheid) of met de hand. */}
          <span style="color:#555;">{t('compare.align') || 'Align'}</span>
          <button
            class="pref-btn pref-btn-secondary"
            disabled={compareAlignPending()}
            title={t('compare.autoAlignHint') || 'Estimate shift, rotation and scale from the drawings'}
            onClick={requestAutoAlign}
          >
            {compareAlignPending() ? '…' : (t('compare.autoAlign') || 'Align automatically')}
          </button>
          <label style="display:inline-flex; align-items:center; gap:3px;" title={t('compare.autoAlignEachHint') || 'Align every page pair automatically on first view'}>
            <input type="checkbox" checked={compareAutoAlign()} onChange={(e) => setCompareAutoAlign(e.currentTarget.checked)} />
            {t('compare.autoAlignEach') || 'Auto'}
          </label>
          <AlignField label="dx" unit="mm" value={() => compareOffset().dx} onSet={(v) => setCompareOffset({ dx: v })} />
          <AlignField label="dy" unit="mm" value={() => compareOffset().dy} onSet={(v) => setCompareOffset({ dy: v })} />
          <AlignField label={t('compare.rotation') || 'rot'} unit="°" value={() => compareOffset().rotation} onSet={(v) => setCompareOffset({ rotation: v })} />
          <AlignField label={t('compare.scale') || 'scale'} unit="%" value={() => normalizeAlignment(compareOffset()).scale * 100}
            onSet={(v) => { if (v > 0) setCompareOffset({ scale: v / 100 }); }} />
          <button class="pref-btn pref-btn-secondary" title={t('compare.resetAlignHint') || 'No alignment'} onClick={resetCompareAlignment}>0</button>
          <ConfidenceBadge t={t} info={compareAlignInfo} pending={compareAlignPending} />

          <Sep />

          {/* Rapport: CSV, PDF-samenvatting, wolken op het nieuwe document. */}
          <div style="position:relative; display:inline-block;">
            <button
              class="pref-btn pref-btn-secondary"
              disabled={!!reportBusy()}
              onClick={(e) => { e.stopPropagation(); setReportMenu(!reportMenu()); }}
            >
              {reportBusy()
                ? `${t('compare.report.button') || 'Report'} ${reportBusy().done}/${reportBusy().total}`
                : `${t('compare.report.button') || 'Report'} ▾`}
            </button>
            <Show when={reportMenu()}>
              <div
                onClick={(e) => e.stopPropagation()}
                style="position:absolute; top:100%; left:0; z-index:20; min-width:220px; background:#fff; border:1px solid #d4d4d4; box-shadow:0 2px 6px rgba(0,0,0,.2); padding:2px 0;"
              >
                <MenuItem onClick={() => runReport('csv')}>{t('compare.report.csv') || 'Export change list (CSV)…'}</MenuItem>
                <MenuItem onClick={() => runReport('pdf')}>{t('compare.report.pdf') || 'Export PDF summary…'}</MenuItem>
                <MenuItem
                  disabled={!canPlaceClouds(compareNewPath()) || checked().size === 0}
                  title={canPlaceClouds(compareNewPath()) ? '' : (t('compare.report.cloudsNeedTab') || 'The new document must be open in a tab')}
                  onClick={placeClouds}
                >
                  {`${t('compare.report.clouds') || 'Place selected changes as clouds'} (${checked().size})`}
                </MenuItem>
              </div>
            </Show>
          </div>
          <Show when={statusMsg()}>
            <span style="color:#555; white-space:nowrap;">{statusMsg()}</span>
          </Show>

          <span style="flex:1;"></span>
          <button
            onClick={exitCompare}
            style="background:#dc2626; color:#fff; border:1px solid #b91c1c; padding:4px 14px; font-size:12px; font-weight:600; cursor:default;"
            title="Esc"
          >
            ✕ {t('compare.exit') || 'Vergelijken sluiten'}
          </button>
        </div>
        <div style="flex:1; display:flex; min-height:0;">
          <div
            class="compare-body"
            ref={bodyRef}
            onClick={handleBodyClick}
            on:mousedown={killMiddleAutoscroll}
            onPointerDown={(e) => { if (compareMode() !== 'side') startPanDrag(e, bodyRef); }}
            style={compareMode() === 'side'
              ? 'flex:1; overflow:hidden; display:flex; align-items:stretch; padding:0; gap:0;'
              : 'flex:1; overflow:auto; display:flex; align-items:flex-start; justify-content:center; padding:14px; gap:14px;'}
          >
            <Show
              when={compareMode() === 'side'}
              fallback={
                <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                  {/* Overlay: NEW page rendered normally; diff regions drawn as
                      translucent rectangles on a separate highlight canvas. */}
                  <div
                    ref={overlayWrapRef}
                    style={`position:relative; background:#ffffff; box-shadow:0 0 0 1px #444; line-height:0; transform:scale(${cssScale()}); transform-origin:0 0;`}
                  >
                    <canvas ref={overlayNewCanvasRef} style="display:block;"></canvas>
                    <Show when={compareMode() === 'split'}>
                      {/* OLD left of the line: a clip box as wide as the
                          split, so the alignment transform on the canvas
                          does not turn the clip with it. */}
                      {/* White clip background: where dx/dy/rot moves the OLD
                          page away from an edge the strip stays white (as in
                          the change detection) instead of showing NEW. */}
                      <div style={`position:absolute; left:0; top:0; bottom:0; width:${splitPos() * 100}%; overflow:hidden; pointer-events:none; background:#ffffff;`}>
                        <canvas
                          ref={splitOldCanvasRef}
                          style={`display:block; background:#ffffff; transform:${oldSplitTransform()}; transform-origin:0 0;`}
                        ></canvas>
                      </div>
                    </Show>
                    {/* OLD page is rasterized for change detection only via
                        an offscreen canvas in compare-viewport.js — no DOM
                        element required. */}
                    <canvas
                      ref={overlayHighlightCanvasRef}
                      style="position:absolute; left:0; top:0; pointer-events:none;"
                    ></canvas>
                    <Show when={compareMode() === 'split'}>
                      <div
                        class="compare-split-line"
                        title={t('compare.splitDesc') || 'Drag the line to reveal old and new'}
                        onPointerDown={startSplitDrag}
                        onClick={(e) => e.stopPropagation()}
                        style={`position:absolute; top:0; bottom:0; left:${splitPos() * 100}%; width:${px(18)}; transform:translateX(-50%); cursor:ew-resize; z-index:3; line-height:normal;`}
                      >
                        <div style={`position:absolute; top:0; bottom:0; left:50%; width:${px(2)}; transform:translateX(-50%); background:#0078d4;`}></div>
                        <div style={`position:absolute; top:50%; left:50%; width:${px(28)}; height:${px(28)}; transform:translate(-50%, -50%); border-radius:50%; background:#0078d4; border:${px(2)} solid #fff; box-sizing:border-box; box-shadow:0 1px 4px rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; color:#fff; font-size:${px(14)};`}>{'\u2194'}</div>
                      </div>
                      <div style={`position:absolute; top:${px(6)}; left:${px(6)}; padding:${px(2)} ${px(8)}; background:rgba(40,40,40,0.85); color:#ddd; font-size:${px(11)}; line-height:normal; pointer-events:none; z-index:2;`}>{t('compare.oldDoc') || 'Old'}</div>
                      <div style={`position:absolute; top:${px(6)}; right:${px(6)}; padding:${px(2)} ${px(8)}; background:rgba(40,40,40,0.85); color:#ddd; font-size:${px(11)}; line-height:normal; pointer-events:none; z-index:2;`}>{t('compare.newDoc') || 'New'}</div>
                    </Show>
                    <Show when={highlight()}>
                      {(h) => (
                        <div
                          style={`position:absolute; left:${h().x}px; top:${h().y}px; width:${h().w}px; height:${h().h}px; border:2px solid #ffd700; background:rgba(255,215,0,0.15); pointer-events:none; box-sizing:border-box;`}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              }
            >
              <div style="flex:1 1 50%; min-width:0; position:relative; display:flex; border-right:1px solid #555;">
                <div style="position:absolute; top:6px; left:8px; z-index:2; padding:2px 8px; background:rgba(40,40,40,0.85); color:#ddd; font-size:11px; pointer-events:none;">
                  {t('compare.oldDoc') || 'Old'}
                </div>
                <div
                  ref={oldPaneRef}
                  class="compare-pane compare-pane-old"
                  onScroll={() => syncScroll(oldPaneRef, newPaneRef)}
                  on:mousedown={killMiddleAutoscroll}
                  onPointerDown={(e) => startPanDrag(e, oldPaneRef)}
                  style="flex:1; overflow:auto;"
                >
                  <div style="padding:14px; display:inline-block; line-height:0;">
                    {/* Page + diff overlay share a scaled wrapper so the red/
                        yellow highlights stay pixel-aligned with the render. */}
                    <div
                      ref={oldWrapRef}
                      style={`position:relative; line-height:0; transform:scale(${cssScale()}); transform-origin:0 0;`}
                    >
                      <canvas
                        ref={oldCanvasRef}
                        style="display:block; background:#ffffff; box-shadow:0 0 0 1px #444;"
                      ></canvas>
                      <canvas
                        ref={oldHiCanvasRef}
                        style="position:absolute; left:0; top:0; pointer-events:none;"
                      ></canvas>
                    </div>
                  </div>
                </div>
              </div>
              <div style="flex:1 1 50%; min-width:0; position:relative; display:flex;">
                <div style="position:absolute; top:6px; left:8px; z-index:2; padding:2px 8px; background:rgba(40,40,40,0.85); color:#ddd; font-size:11px; pointer-events:none;">
                  {t('compare.newDoc') || 'New'}
                </div>
                <div
                  ref={newPaneRef}
                  class="compare-pane compare-pane-new"
                  onScroll={() => syncScroll(newPaneRef, oldPaneRef)}
                  on:mousedown={killMiddleAutoscroll}
                  onPointerDown={(e) => startPanDrag(e, newPaneRef)}
                  style="flex:1; overflow:auto;"
                >
                  <div style="padding:14px; display:inline-block; line-height:0;">
                    <div
                      ref={newWrapRef}
                      style={`position:relative; line-height:0; transform:scale(${cssScale()}); transform-origin:0 0;`}
                    >
                      <canvas
                        ref={newCanvasRef}
                        style="display:block; background:#ffffff; box-shadow:0 0 0 1px #444;"
                      ></canvas>
                      <canvas
                        ref={newHiCanvasRef}
                        style="position:absolute; left:0; top:0; pointer-events:none;"
                      ></canvas>
                    </div>
                  </div>
                </div>
              </div>
            </Show>
          </div>
          <ChangeListPanel
            t={t}
            changes={allChanges}
            onFocus={focusOnChange}
            focused={compareFocusedChange}
            onTextFocus={gotoTextChange}
            checked={checked}
            onCheck={toggleChecked}
            pageInfo={pageInfo}
          />
        </div>
      </div>
    </Show>
  );
}

// Eén uitlijnwaarde; wordt pas toegepast bij Enter of verlaten van het veld,
// zodat een half getypt getal ("-") geen detectie start.
function AlignField(props) {
  const shown = () => {
    const v = props.value();
    return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0';
  };
  const commit = (e) => {
    const v = leesGetal(e.currentTarget.value);
    if (Number.isFinite(v)) props.onSet(v);
    else e.currentTarget.value = shown();
  };
  return (
    <span style="display:inline-flex; align-items:center; gap:2px;">
      <span style="color:#777;">{props.label}</span>
      <input
        type="text" inputmode="decimal" data-getal
        style="width:52px;"
        value={shown()}
        onChange={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(e); }}
      />
      <span style="color:#777;">{props.unit}</span>
    </span>
  );
}

// Betrouwbaarheid van de automatische uitlijning.
function ConfidenceBadge(props) {
  const info = () => props.info() || {};
  const text = () => {
    if (props.pending()) return '…';
    const i = info();
    if (i.source === 'manual') return props.t('compare.alignManual') || 'manual';
    if (i.source !== 'auto' || !Number.isFinite(i.confidence)) return '';
    return `${Math.round(i.confidence * 100)}%`;
  };
  const color = () => {
    const c = info().confidence;
    if (info().source !== 'auto' || !Number.isFinite(c)) return '#555';
    return c >= 0.8 ? '#15803d' : c >= 0.5 ? '#b45309' : '#b91c1c';
  };
  const title = () => {
    const i = info();
    if (i.source !== 'auto') return props.t('compare.confidenceHint') || 'Share of the ink that lines up after alignment';
    const m = i.method === 'measure' ? (props.t('compare.alignByMeasure') || 'scale from the measuring scales')
      : i.method === 'identity' ? (props.t('compare.alignNone') || 'already aligned') : (props.t('compare.alignByContent') || 'from the drawing content');
    return `${props.t('compare.confidence') || 'Confidence'}: ${text()} — ${m}`;
  };
  return (
    <Show when={text()}>
      <span title={title()} style={`padding:1px 6px; border:1px solid ${color()}; color:${color()}; font-variant-numeric:tabular-nums;`}>{text()}</span>
    </Show>
  );
}

function MenuItem(props) {
  return (
    <div
      title={props.title || ''}
      onClick={() => { if (!props.disabled) props.onClick?.(); }}
      style={`padding:5px 12px; white-space:nowrap; color:${props.disabled ? '#999' : '#222'};`}
      onMouseEnter={(e) => { if (!props.disabled) e.currentTarget.style.background = '#e5f1fb'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
    >
      {props.children}
    </div>
  );
}

const fmtMm = (pt) => (Math.round(pt * MM_PER_PT * 10) / 10).toString();

function ChangeListPanel(props) {
  const typeLabel = (type) => {
    const k = type === 'added' ? 'compare.added'
      : type === 'removed' ? 'compare.removed'
      : 'compare.modified';
    return props.t(k) || (type === 'added' ? 'Toegevoegd' : type === 'removed' ? 'Verwijderd' : 'Gewijzigd');
  };
  const typeIcon = (type) => type === 'added' ? '+' : type === 'removed' ? '−' : 'Δ';
  const typeColor = (type) => type === 'added' ? '#16a34a' : type === 'removed' ? '#dc2626' : '#ca8a04';

  // Per-type collapse state (default: expanded).
  const [collapsed, setCollapsed] = createSignal({ added: false, removed: false, modified: false });
  const toggleCollapsed = (type) => {
    setCollapsed({ ...collapsed(), [type]: !collapsed()[type] });
  };

  const groupedByType = () => {
    const result = { added: [], removed: [], modified: [] };
    const list = props.changes() || [];
    list.forEach((c, idx) => {
      // Preserve original index for stable numbering.
      const type = result[c.type] ? c.type : 'modified';
      result[type].push({ change: c, index: idx });
    });
    return result;
  };

  const visibleFor = (type) => {
    if (type === 'added') return compareShowAdded();
    if (type === 'removed') return compareShowRemoved();
    return compareShowModified();
  };
  const setVisibleFor = (type, val) => {
    if (type === 'added') setCompareShowAdded(val);
    else if (type === 'removed') setCompareShowRemoved(val);
    else setCompareShowModified(val);
  };

  const TypeToggle = (tProps) => (
    <button
      onClick={() => setVisibleFor(tProps.type, !visibleFor(tProps.type))}
      title={typeLabel(tProps.type)}
      style={`flex:1; display:flex; align-items:center; justify-content:center; gap:4px; padding:4px 6px; border:1px solid #b5b5b5; background:${visibleFor(tProps.type) ? '#ffffff' : '#e5e5e5'}; cursor:pointer; font-size:11px; color:${visibleFor(tProps.type) ? '#222' : '#888'};`}
    >
      <span
        style={`width:10px; height:10px; display:inline-block; background:${visibleFor(tProps.type) ? typeColor(tProps.type) : '#bbb'}; border:1px solid #555;`}
      ></span>
      {typeLabel(tProps.type)} ({tProps.count})
    </button>
  );

  const total = () => (props.changes() || []).length;

  return (
    <div
      class="compare-change-list"
      onClick={(e) => e.stopPropagation()}
      style="width:260px; background:#f5f5f5; border-left:1px solid #d4d4d4; display:flex; flex-direction:column; color:#222; font-size:12px;"
    >
      {/* Tab-strip: visuele wijzigingen vs. tekstvergelijking. */}
      <div style="display:flex; background:linear-gradient(#ffffff, #f5f5f5); border-bottom:1px solid #d4d4d4;">
        <For each={['changes', 'text', 'pages']}>
          {(tab) => (
            <button
              onClick={() => setComparePanelTab(tab)}
              style={`flex:1; padding:6px 8px; font-size:12px; font-weight:${comparePanelTab() === tab ? 'bold' : 'normal'}; border:none; border-bottom:2px solid ${comparePanelTab() === tab ? '#0078d4' : 'transparent'}; background:${comparePanelTab() === tab ? '#ffffff' : 'transparent'}; color:#222; cursor:pointer;`}
            >
              {tab === 'changes'
                ? `${props.t('compare.changes') || 'Wijzigingen'} (${compareDetecting() ? '…' : total()})`
                : tab === 'text'
                  ? `${props.t('compare.textTab') || 'Tekst'}${compareTextChanges() ? ` (${compareTextChanges().length})` : ''}`
                  : `${props.t('compare.pagesTab') || 'Pages'}${comparePairing() ? ' …' : ''}`}
            </button>
          )}
        </For>
      </div>
      <Show when={comparePanelTab() === 'text'}>
        <TextDiffList t={props.t} onFocus={props.onTextFocus} focused={props.focused} />
      </Show>
      <Show when={comparePanelTab() === 'pages'}>
        <PairingList t={props.t} pageInfo={props.pageInfo} />
      </Show>
      <Show when={comparePanelTab() === 'changes'}>
      <Show when={compareTruncated()}>
        <div style="padding:6px 10px; background:#fff4ce; border-bottom:1px solid #d4d4d4; color:#5c4400; font-size:11px;">
          {props.t('compare.truncated') || 'Too many differences: check the alignment or the sensitivity.'}
        </div>
      </Show>
      <div style="display:flex; gap:4px; padding:6px 8px; border-bottom:1px solid #d4d4d4; background:#fafafa;">
        <TypeToggle type="added" count={groupedByType().added.length} />
        <TypeToggle type="removed" count={groupedByType().removed.length} />
        <TypeToggle type="modified" count={groupedByType().modified.length} />
      </div>
      <div style="flex:1; overflow:auto;">
        <Show
          when={total() > 0}
          fallback={
            <div style="padding:14px; color:#666; font-style:italic;">
              {/* Tijdens een lopende detectie is "Geen wijzigingen" misleidend —
                  toon dan een neutrale bezig-indicator (geen i18n-key nodig). */}
              {compareDetecting() ? '…' : (props.t('compare.noChanges') || 'Geen wijzigingen')}
            </div>
          }
        >
          <For each={['added', 'removed', 'modified']}>
            {(type) => (
              <Show when={visibleFor(type) && groupedByType()[type].length > 0}>
                <div>
                  <div
                    onClick={() => toggleCollapsed(type)}
                    style={`padding:5px 10px; background:#e8e8e8; border-bottom:1px solid #d4d4d4; cursor:pointer; display:flex; align-items:center; gap:6px; font-weight:bold; user-select:none;`}
                  >
                    <span style="width:10px; display:inline-block;">{collapsed()[type] ? '▶' : '▼'}</span>
                    <span
                      style={`width:10px; height:10px; display:inline-block; background:${typeColor(type)}; border:1px solid #555;`}
                    ></span>
                    <span>{typeLabel(type)} ({groupedByType()[type].length})</span>
                  </div>
                  <Show when={!collapsed()[type]}>
                    <For each={groupedByType()[type]}>
                      {(item) => {
                        const c = item.change;
                        const isFocused = () => props.focused() === c;
                        return (
                          <div
                            onClick={(e) => { e.stopPropagation(); props.onFocus(c); }}
                            style={`height:50px; padding:6px 10px; border-bottom:1px solid #e0e0e0; display:flex; align-items:center; gap:8px; cursor:pointer; background:${isFocused() ? '#dbeafe' : '#ffffff'};`}
                            onMouseEnter={(e) => { if (!isFocused()) e.currentTarget.style.background = '#eaf3ff'; }}
                            onMouseLeave={(e) => { if (!isFocused()) e.currentTarget.style.background = '#ffffff'; }}
                          >
                            <Show when={c.source !== 'annotation'}>
                              <input
                                type="checkbox"
                                title={props.t('compare.selectForClouds') || 'Select for clouds on the new document'}
                                checked={props.checked().has(c)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => props.onCheck(c)}
                              />
                            </Show>
                            <div
                              style={`width:22px; height:22px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; background:${typeColor(c.type)}; color:#fff; font-weight:bold; font-size:13px;`}
                            >
                              {typeIcon(c.type)}
                            </div>
                            <div style="flex:1; min-width:0;">
                              <div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                {item.index + 1}. {c.source === 'annotation' ? c.label : typeLabel(c.type)}
                              </div>
                              <div style="color:#666; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                {c.source === 'annotation'
                                  ? `✎ ${props.t('compare.annotation') || 'Annotatie'}`
                                  : `${fmtMm(c.width)} × ${fmtMm(c.height)} mm @ (${fmtMm(c.x)}, ${fmtMm(c.y)}) mm`}
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </Show>
            )}
          </For>
        </Show>
      </div>
      </Show>
    </div>
  );
}

// Lijst van tekstverschillen (Tekst-tab). Elk record toont paginanummer(s),
// soort en de tekst oud → nieuw; klik springt naar het betreffende
// pagina-paar. Bij 'modified' worden de gewijzigde woorden geaccentueerd.
function TextDiffList(props) {
  const typeColor = (type) => type === 'added' ? '#16a34a' : type === 'removed' ? '#dc2626' : '#ca8a04';
  const typeIcon = (type) => type === 'added' ? '+' : type === 'removed' ? '−' : 'Δ';
  const typeLabel = (type) => props.t(
    type === 'added' ? 'compare.added' : type === 'removed' ? 'compare.removed' : 'compare.modified'
  ) || type;
  const pageLabel = (c) => {
    const pg = props.t('compare.page') || 'Pagina';
    if (c.type === 'added') return `${pg} ${c.newPage}`;
    if (c.type === 'removed') return `${pg} ${c.oldPage}`;
    return c.oldPage === c.newPage ? `${pg} ${c.oldPage}` : `${pg} ${c.oldPage} → ${c.newPage}`;
  };
  // Accentueer de gewijzigde woorden binnen een modified-record.
  const renderParts = (parts, color) => (
    <For each={parts}>
      {(p, idx) => (
        <>
          {idx() > 0 ? ' ' : ''}
          {p.changed
            ? <span style={`background:${color}; color:#fff; padding:0 1px;`}>{p.text}</span>
            : <span>{p.text}</span>}
        </>
      )}
    </For>
  );
  const textStyle = 'font-size:11px; white-space:pre-wrap; word-break:break-word; max-height:88px; overflow:hidden;';
  // Filter op soort (#465).
  const [show, setShow] = createSignal({ added: true, removed: true, modified: true });
  const countOf = (type) => (compareTextChanges() || []).filter((c) => c.type === type).length;
  const filtered = () => (compareTextChanges() || []).filter((c) => show()[c.type] !== false);
  return (
    <div style="flex:1; overflow:auto; display:flex; flex-direction:column;">
      <div style="display:flex; gap:4px; padding:6px 8px; border-bottom:1px solid #d4d4d4; background:#fafafa;">
        <For each={['added', 'removed', 'modified']}>
          {(type) => (
            <button
              onClick={() => setShow({ ...show(), [type]: !show()[type] })}
              title={typeLabel(type)}
              style={`flex:1; display:flex; align-items:center; justify-content:center; gap:4px; padding:4px 6px; border:1px solid #b5b5b5; background:${show()[type] ? '#ffffff' : '#e5e5e5'}; font-size:11px; color:${show()[type] ? '#222' : '#888'};`}
            >
              <span style={`width:10px; height:10px; display:inline-block; background:${show()[type] ? typeColor(type) : '#bbb'}; border:1px solid #555;`}></span>
              {typeLabel(type)} ({countOf(type)})
            </button>
          )}
        </For>
      </div>
      <div style="flex:1; overflow:auto;">
      <Show
        when={!compareTextComparing()}
        fallback={<div style="padding:14px; color:#666; font-style:italic;">…</div>}
      >
        <Show
          when={(compareTextChanges() || []).length > 0}
          fallback={
            <div style="padding:14px; color:#666; font-style:italic;">
              {props.t('compare.noTextChanges') || 'Geen tekstverschillen'}
            </div>
          }
        >
          <For each={filtered()}>
            {(c, i) => {
              const words = () => c.type === 'modified' ? diffWords(c.oldText, c.newText) : null;
              const isFocused = () => props.focused?.() === c;
              return (
                <div
                  onClick={(e) => { e.stopPropagation(); props.onFocus?.(c); }}
                  style={`padding:6px 10px; border-bottom:1px solid #e0e0e0; cursor:pointer; background:${isFocused() ? '#dbeafe' : '#ffffff'};`}
                  onMouseEnter={(e) => { if (!isFocused()) e.currentTarget.style.background = '#eaf3ff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isFocused() ? '#dbeafe' : '#ffffff'; }}
                >
                  <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">
                    <span
                      style={`width:16px; height:16px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; background:${typeColor(c.type)}; color:#fff; font-weight:bold; font-size:11px;`}
                    >
                      {typeIcon(c.type)}
                    </span>
                    <span style="font-weight:bold;">{i() + 1}. {typeLabel(c.type)}</span>
                    <span style="margin-left:auto; color:#666; font-size:11px;">{pageLabel(c)}</span>
                  </div>
                  <Show when={c.oldText}>
                    <div style={`${textStyle} color:#991b1b;`}>
                      <Show when={words()} fallback={c.oldText}>
                        {renderParts(words().oldParts, '#dc2626')}
                      </Show>
                    </div>
                  </Show>
                  <Show when={c.oldText && c.newText}>
                    <div style="color:#888; font-size:10px; line-height:1; padding:1px 0;">↓</div>
                  </Show>
                  <Show when={c.newText}>
                    <div style={`${textStyle} color:#14532d;`}>
                      <Show when={words()} fallback={c.newText}>
                        {renderParts(words().newParts, '#16a34a')}
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </Show>
      </div>
    </div>
  );
}

// Paginakoppeling (#465): de gevonden paren, en pagina's die alleen in het
// oude of alleen in het nieuwe document staan. Een paar is te corrigeren door
// een andere pagina te kiezen; "—" ontkoppelt.
function PairingList(props) {
  const reasonLabel = (r) => props.t(`compare.pairReason.${r}`) || r;
  const name = (side, page) => {
    const info = props.pageInfo()[side].get(page);
    const extra = info?.sheet || (info?.label && info.label !== String(page) ? info.label : '');
    return extra ? `${page} (${extra})` : String(page);
  };
  const oldPages = () => Array.from({ length: compareOldPageCount() }, (_, i) => i + 1);
  const newPages = () => Array.from({ length: compareNewPageCount() }, (_, i) => i + 1);
  const isCurrent = (r) => r.old === compareOldPage() && r.new === compareNewPage();
  const rows = () => {
    const list = comparePairs() || [];
    return list.length ? list : indexPairs(compareOldPageCount(), compareNewPageCount());
  };
  const PageSelect = (p) => (
    <select
      style="font-size:11px; max-width:96px;"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.currentTarget.value === '' ? null : parseInt(e.currentTarget.value, 10);
        if (p.side === 'old') assignComparePair(v, p.row.new);
        else assignComparePair(p.row.old, v);
      }}
    >
      <option value="" selected={p.row[p.side] == null}>—</option>
      <For each={p.side === 'old' ? oldPages() : newPages()}>
        {(n) => <option value={n} selected={p.row[p.side] === n}>{name(p.side, n)}</option>}
      </For>
    </select>
  );
  return (
    <div style="flex:1; overflow:auto;">
      <Show when={comparePairing()}>
        <div style="padding:6px 10px; color:#666; font-style:italic;">{props.t('compare.pairing') || 'Matching pages…'}</div>
      </Show>
      <div style="display:flex; gap:6px; padding:4px 10px; color:#555; font-size:11px; border-bottom:1px solid #d4d4d4; background:#fafafa;">
        <span style="flex:1;">{props.t('compare.oldDoc') || 'Old'}</span>
        <span style="flex:1;">{props.t('compare.newDoc') || 'New'}</span>
      </div>
      <For each={rows()}>
        {(r) => {
          const onlyOld = r.new == null;
          const onlyNew = r.old == null;
          const bg = () => (isCurrent(r) ? '#dbeafe' : onlyOld ? '#fef2f2' : onlyNew ? '#f0fdf4' : '#ffffff');
          return (
            <div
              onClick={() => { if (!onlyOld && !onlyNew) gotoComparePair(r.old, r.new); }}
              style={`padding:5px 10px; border-bottom:1px solid #e0e0e0; background:${bg()};`}
            >
              <div style="display:flex; gap:6px; align-items:center;">
                <span style="flex:1;"><PageSelect side="old" row={r} /></span>
                <span style="color:#888;">↔</span>
                <span style="flex:1;"><PageSelect side="new" row={r} /></span>
              </div>
              <div style={`font-size:10px; margin-top:2px; color:${onlyOld ? '#b91c1c' : onlyNew ? '#15803d' : '#777'};`}>
                {onlyOld ? (props.t('compare.onlyInOld') || 'Only in old')
                  : onlyNew ? (props.t('compare.onlyInNew') || 'Only in new')
                  : reasonLabel(r.reason)}
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}

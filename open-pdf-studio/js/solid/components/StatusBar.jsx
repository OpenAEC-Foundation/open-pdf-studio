import { readRenderDiagnostics, subscribeRenderDiagnostics } from '../../pdf/render-diagnostics.js';
import { Show, createSignal, onCleanup } from 'solid-js';
import { watchState, onWatchState } from '../../workflows/watch-status.js';
import { reviewStatus, onReviewStatus } from '../../review/shared-review-status.js';
import { state, getActiveDocument } from '../../core/state.js';
import { labelVan, heeftEigenLabel } from '../../pdf/pagina-labels.js';
import { useTranslation, localizeNumber, language } from '../../i18n/useTranslation.js';

// All page navigation goes through goToPage() so the side effects
// (active thumbnail update, hide properties, fire events) happen in one
// place. Calling renderPage() directly would skip the thumbnail-active
// update and the highlight in the left panel would lag the actual page.

async function goFirst() {
  const { goToPage } = await import('../../pdf/renderer.js');
  const doc = getActiveDocument();
  if (doc?.pdfDoc && doc.currentPage !== 1) {
    await goToPage(1);
  }
}

async function goPrev() {
  const { goToPage } = await import('../../pdf/renderer.js');
  const doc = getActiveDocument();
  if (doc && doc.currentPage > 1) {
    await goToPage(doc.currentPage - 1);
  }
}

async function goNext() {
  const { goToPage } = await import('../../pdf/renderer.js');
  const doc = getActiveDocument();
  if (doc?.pdfDoc && doc.currentPage < doc.pdfDoc.numPages) {
    await goToPage(doc.currentPage + 1);
  }
}

async function goLast() {
  const { goToPage } = await import('../../pdf/renderer.js');
  const doc = getActiveDocument();
  if (doc?.pdfDoc && doc.currentPage !== doc.pdfDoc.numPages) {
    await goToPage(doc.pdfDoc.numPages);
  }
}

async function handlePageInput(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const pageNum = parseInt(e.target.value, 10);
  const doc = getActiveDocument();
  if (doc?.pdfDoc && pageNum >= 1 && pageNum <= doc.pdfDoc.numPages) {
    const { goToPage } = await import('../../pdf/renderer.js');
    await goToPage(pageNum);
  } else if (doc) {
    e.target.value = doc.currentPage;
  }
  e.target.blur();
}

async function handlePageBlur(e) {
  const doc = getActiveDocument();
  if (doc?.pdfDoc) {
    const pageNum = parseInt(e.target.value, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > doc.pdfDoc.numPages) {
      e.target.value = doc.currentPage;
    }
  }
}

// Paginaweergave-modi (issue #164): dezelfde knoppen als in de Beeld-ribbon,
// nu ook in de statusbalk zoals klassieke PDF-lezers. Hergebruikt setViewMode()
// uit renderer.js — GEEN tweede render-pad. 'book' is intern een layout-variant
// van 'continuous' (doc.bookSpread), zie setViewMode().
async function applyViewMode(mode) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const { setViewMode } = await import('../../pdf/renderer.js');
  await setViewMode(mode);
}

// Weergave draaien (#200): de statusbalk toont het zolang de weergave
// gedraaid staat; een klik zet hem terug. Alleen de weergave, niet het document.
async function resetViewRotation() {
  const { zetWeergaveRotatie } = await import('../../pdf/weergave-draaien.js');
  await zetWeergaveRotatie(0);
}

async function handleZoomIn() {
  const { zoomIn } = await import('../../pdf/renderer.js');
  zoomIn();
}

async function handleZoomOut() {
  const { zoomOut } = await import('../../pdf/renderer.js');
  zoomOut();
}

async function handleZoomInput(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  // Komma en punt allebei als decimaalteken: "62,5" en "62.5" (zoom-display.js).
  const pct = leesZoomInvoer(e.target.value);
  if (pct != null) {
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) {
      // Vector viewport mode is the source of truth — setZoom() handles
      // the dispatch (viewport.setZoomAtPoint vs legacy doc.scale path).
      const { setZoom } = await import('../../pdf/renderer.js');
      await setZoom(percentToScale(pct));
    }
  }
  e.target.blur();
}

async function handleZoomBlur(e) {
  const pct = leesZoomInvoer(e.target.value);
  if (pct == null) {
    const doc = state.documents[state.activeDocumentIndex];
    e.target.value = scaleToPercent(doc ? doc.scale : 1.5) + '%';
  } else if (!e.target.value.includes('%')) {
    e.target.value = toonGetal(pct, language()) + '%';
  }
}

import { engineFor } from '../stores/engineStatusStore.js';
import { scaleToPercent, percentToScale, leesZoomInvoer } from '../../core/zoom-display.js';
import { toonGetal } from '../../core/getal-invoer.js';

// Stops the document-workflow folder watch (it keeps running after its dialog closes).
async function openSharedReview() {
  const { openDialog } = await import('../stores/dialogStore.js');
  openDialog('shared-review');
}

async function stopFolderWatch() {
  const { stopWorkflow } = await import('../../workflows/workflow-service.js');
  stopWorkflow();
}

export default function StatusBar() {
  const { t } = useTranslation('statusbar');
  const [diagnosticTick, setDiagnosticTick] = createSignal(0);
  onCleanup(subscribeRenderDiagnostics(() => setDiagnosticTick(n => n + 1)));
  const findings = () => {
    diagnosticTick();
    return readRenderDiagnostics(getActiveDocument()?.filePath).pages.flatMap(p => p.findings);
  };
  let nextFinding = 0;
  const showFinding = async () => {
    const list = findings();
    if (!list.length) return;
    const doc = getActiveDocument();
    const item = list[nextFinding++ % list.length];
    const { goToPage } = await import('../../pdf/renderer.js');
    if (getActiveDocument() !== doc) return;
    await goToPage(item.page);
    if (getActiveDocument() !== doc) return;
    const { showMessage } = await import('../stores/dialogStore.js');
    showMessage(t('renderDiagnostics.detail', { page: item.page, code: item.code }));
  };
  const [watching, setWatching] = createSignal(watchState());
  onCleanup(onWatchState(setWatching));
  const watchFolder = () => String(watching()?.input || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  // Gedeelde beoordeling (#237): zichtbaar zolang ze voor dit document loopt.
  const [reviewTick, setReviewTick] = createSignal(0);
  onCleanup(onReviewStatus(() => setReviewTick((n) => n + 1)));
  const review = () => { reviewTick(); return reviewStatus(state.documents[state.activeDocumentIndex]?.filePath); };

  const toolName = () => {
    const key = `tools.${state.currentTool}`;
    const translated = t(key);
    return translated !== key ? translated : state.currentTool;
  };
  const currentPage = () => {
    const doc = state.documents[state.activeDocumentIndex];
    return doc ? doc.currentPage : 1;
  };
  // Bladnaam van de huidige pagina, als het document paginalabels heeft (#580).
  const currentLabel = () => {
    const doc = state.documents[state.activeDocumentIndex];
    const page = doc?.currentPage || 1;
    return heeftEigenLabel(doc?.pageLabels, page) ? labelVan(doc.pageLabels, page) : '';
  };
  const totalPages = () => {
    const doc = state.documents[state.activeDocumentIndex];
    return localizeNumber(doc?.pdfDoc?.numPages || 0);
  };
  const zoomText = () => {
    const doc = state.documents[state.activeDocumentIndex];
    // 100% is the effective dpi (zoom-display.js): the screen calibration
    // (#520) when this screen has one, else the zoomDpi preference. Both are
    // read from state.preferences inside this call, so the label follows them.
    return localizeNumber(scaleToPercent(doc ? doc.scale : 1.5)) + '%';
  };
  const viewMode = () => state.documents[state.activeDocumentIndex]?.viewMode || 'single';
  const viewRotation = () => {
    const r = Number(state.documents[state.activeDocumentIndex]?.viewRotation) || 0;
    return ((r % 360) + 360) % 360;
  };
  const bookSpread = () => !!state.documents[state.activeDocumentIndex]?.bookSpread;
  const facingSpread = () => !!state.documents[state.activeDocumentIndex]?.facingSpread;
  const annotationText = () => {
    const annotations = state.documents[state.activeDocumentIndex]?.annotations || [];
    if ((state.documents[state.activeDocumentIndex]?.viewMode || 'single') === 'continuous') {
      return localizeNumber(annotations.length);
    }
    const pageCount = annotations.filter(a => a.page === (state.documents[state.activeDocumentIndex]?.currentPage || 1)).length;
    return t('annotationsCount', { count: pageCount, total: annotations.length });
  };

  return (
    <div class="status-bar">
      <div class="status-bar-left">
        {/* Engine label chip removed — duplicated info with the engine
            dropdown on the right (status-bar-right). The dropdown is the
            source of truth; user picks engine there and the colored
            background of the SELECT element reflects the active engine. */}
        <div class="status-item">
          <span class="status-item-label">{t('toolLabel')}</span>
          <span class="status-item-value">{toolName()}</span>
        </div>
        <div class="status-separator"></div>
        <div class="status-item">
          <span class="status-item-label">{t('annotationsLabel')}</span>
          <span class="status-item-value">{annotationText()}</span>
        </div>
      </div>

      <Show when={!!state.documents[state.activeDocumentIndex]?.pdfDoc}>
        <div class="status-bar-center">
          <button class="status-nav-btn" tabIndex={-1} title={t('firstPage')} onClick={goFirst}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7M18 19l-7-7 7-7"/>
            </svg>
          </button>

          <button class="status-nav-btn" tabIndex={-1} title={t('previousPage')} onClick={goPrev}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>

          <span class="status-page-info">
            {t('page')} <input type="text" inputmode="decimal" data-getal class="status-page-input" tabIndex={-1} value={currentPage()} min="1" onKeyDown={handlePageInput} onBlur={handlePageBlur} /> / <span>{totalPages()}</span>
            <Show when={currentLabel()}>
              <span class="status-page-label" title={currentLabel()}>{currentLabel()}</span>
            </Show>
          </span>

          <button class="status-nav-btn" tabIndex={-1} title={t('nextPage')} onClick={goNext}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </button>

          <button class="status-nav-btn" tabIndex={-1} title={t('lastPage')} onClick={goLast}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M6 5l7 7-7 7"/>
            </svg>
          </button>

          {/* Paginaweergave-modi (issue #164) — enkel / doorlopend / twee
              pagina's doorlopend (boek) / twee pagina's naast elkaar
              (facing, niet-doorlopend). Reflecteren doc.viewMode +
              bookSpread + facingSpread; precies één knop tegelijk actief. */}
          <div class="status-viewmode-controls">
            <button class="status-nav-btn" classList={{ active: viewMode() === 'single' }} tabIndex={-1} title={t('viewSingle')} onClick={() => applyViewMode('single')}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="3" width="12" height="18" rx="1" stroke-width="2"/>
              </svg>
            </button>

            <button class="status-nav-btn" classList={{ active: viewMode() === 'continuous' && !bookSpread() && !facingSpread() }} tabIndex={-1} title={t('viewContinuous')} onClick={() => applyViewMode('continuous')}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="2" width="12" height="9" rx="1" stroke-width="2"/>
                <rect x="6" y="13" width="12" height="9" rx="1" stroke-width="2"/>
              </svg>
            </button>

            <button class="status-nav-btn" classList={{ active: viewMode() === 'continuous' && bookSpread() && !facingSpread() }} tabIndex={-1} title={t('viewBook')} onClick={() => applyViewMode('book')}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="4" width="8" height="16" rx="1" stroke-width="2"/>
                <rect x="13" y="4" width="8" height="16" rx="1" stroke-width="2"/>
              </svg>
            </button>

            {/* 4e modus: twee pagina's naast elkaar als één spread tegelijk,
                niet-doorlopend (bladert per spread). Eén omkaderd venster met
                een centrale rug — onderscheidt zich van de losse rechthoeken
                van de doorlopende boek-knop. */}
            <button class="status-nav-btn" classList={{ active: viewMode() === 'continuous' && facingSpread() }} tabIndex={-1} title={t('viewFacing')} onClick={() => applyViewMode('facing')}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="16" rx="1" stroke-width="2"/>
                <line x1="12" y1="4" x2="12" y2="20" stroke-width="2"/>
              </svg>
            </button>
          </div>

          <div class="status-zoom-controls">
            <button class="status-nav-btn" tabIndex={-1} title={t('zoomOut')} onClick={handleZoomOut}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
              </svg>
            </button>

            <input type="text" class="status-zoom-input" tabIndex={-1} value={zoomText()} onKeyDown={handleZoomInput} onBlur={handleZoomBlur} />

            <button class="status-nav-btn" tabIndex={-1} title={t('zoomIn')} onClick={handleZoomIn}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
            </button>
          </div>

          <Show when={viewRotation() !== 0}>
            <button class="status-view-rotation" id="status-view-rotation" tabIndex={-1}
              title={t('viewRotatedTitle', { degrees: localizeNumber(viewRotation()) })}
              onClick={resetViewRotation}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>
              </svg>
              <span>{localizeNumber(viewRotation())}°</span>
            </button>
          </Show>
        </div>
      </Show>

      <div class="status-bar-right">
        <Show when={findings().length > 0}>
          <button class="status-nav-btn status-item status-render-findings" tabIndex={-1} onClick={showFinding} title={t('renderDiagnostics.title')}>
            {t('renderDiagnostics.count', { count: findings().length })}
          </button>
        </Show>
        <Show when={review()}>
          <button class="status-view-rotation status-watch status-review" classList={{ 'status-watch-error': !!review()?.error, 'status-review-new': review()?.unseen > 0 }} tabIndex={-1}
            title={t('sharedReviewTitle', { folder: review()?.folder })}
            onClick={openSharedReview}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="8" cy="12" r="3" stroke-width="2"/><circle cx="16" cy="12" r="3" stroke-width="2"/>
            </svg>
            <span>{review()?.error ? t('sharedReviewError') : review()?.unseen > 0 ? t('sharedReviewUpdates', { n: localizeNumber(review().unseen) }) : t('sharedReviewActive')}</span>
          </button>
        </Show>
        <Show when={watching()}>
          <button class="status-view-rotation status-watch" classList={{ 'status-watch-error': !!watching()?.error }} tabIndex={-1}
            title={t('watchTitle', { input: watching()?.input, output: watching()?.output })}
            onClick={stopFolderWatch}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" stroke-width="2"/>
            </svg>
            <span>{watching()?.error ? t('watchFailed', { folder: watchFolder() }) : t('watchActive', { folder: watchFolder() })}</span>
          </button>
        </Show>
        <div class="status-item">
          <Show when={state.statusMessageVisible}>
            {state.statusMessage}
          </Show>
        </div>
        {/* Passieve weergave-engine-indicator: de render-paden melden welke
            engine de huidige weergave levert (PDFium / eigen tegel-engine /
            vector-replay). Alleen zichtbaarheid, geen keuze. */}
        <Show when={(() => { const d = state.documents[state.activeDocumentIndex]; return engineFor(d?.filePath, d?.currentPage); })()}>
          <div
            class="status-item"
            title={t('engineTitle')}
            style={`padding:1px 8px; border:1px solid #b5b5b5; font-size:11px; background:${
              (() => { const d = state.documents[state.activeDocumentIndex]; return engineFor(d?.filePath, d?.currentPage); })() === 'scene' ? '#dcfce7' : (() => { const d = state.documents[state.activeDocumentIndex]; return engineFor(d?.filePath, d?.currentPage); })() === 'vector' ? '#dbeafe' : '#f0f0f0'
            }; color:#222;`}
          >
            {t(`engine.${(() => { const d = state.documents[state.activeDocumentIndex]; return engineFor(d?.filePath, d?.currentPage); })()}`)}
          </div>
        </Show>
        {/* Zoom % chip removed — duplicated info with the editable zoom
            input in the center status bar (status-zoom-input). That input
            is the source of truth (also lets the user type a value).
            Canvas/DPR tooltip was secondary diagnostic info; can be
            re-added on the input later if needed. */}
        {/* Engine selector removed — PDFium is hardcoded as the only
            engine (see state.ts: renderEngineOverride='pdfium' + the
            init guard in App.jsx that overwrites any persisted value).
            Vector / Open PDF.rs paths remain in the code for diagnostic
            re-enable via devtools, but no UI affordance exposes them. */}
      </div>
    </div>
  );
}

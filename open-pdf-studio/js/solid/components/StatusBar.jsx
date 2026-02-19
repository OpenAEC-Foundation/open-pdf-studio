import { Show } from 'solid-js';
import { state } from '../../core/state.js';

const TOOL_NAMES = {
  'select': 'Select Tool',
  'selectComments': 'Select Comments',
  'hand': 'Hand Tool',
  'highlight': 'Highlight',
  'draw': 'Freehand',
  'line': 'Line',
  'arrow': 'Arrow',
  'circle': 'Ellipse',
  'box': 'Rectangle',
  'polygon': 'Polygon',
  'cloud': 'Cloud',
  'polyline': 'Polyline',
  'textbox': 'Text Box',
  'callout': 'Callout',
  'comment': 'Sticky Note',
  'text': 'Text'
};

async function goFirst() {
  const { renderPage } = await import('../../pdf/renderer.js');
  const { hideProperties } = await import('../../ui/panels/properties-panel.js');
  if (state.pdfDoc && state.currentPage !== 1) {
    state.currentPage = 1;
    hideProperties();
    await renderPage(state.currentPage);
  }
}

async function goPrev() {
  const { renderPage } = await import('../../pdf/renderer.js');
  const { hideProperties } = await import('../../ui/panels/properties-panel.js');
  if (state.currentPage > 1) {
    state.currentPage--;
    hideProperties();
    await renderPage(state.currentPage);
  }
}

async function goNext() {
  const { renderPage } = await import('../../pdf/renderer.js');
  const { hideProperties } = await import('../../ui/panels/properties-panel.js');
  if (state.pdfDoc && state.currentPage < state.pdfDoc.numPages) {
    state.currentPage++;
    hideProperties();
    await renderPage(state.currentPage);
  }
}

async function goLast() {
  const { renderPage } = await import('../../pdf/renderer.js');
  const { hideProperties } = await import('../../ui/panels/properties-panel.js');
  if (state.pdfDoc && state.currentPage !== state.pdfDoc.numPages) {
    state.currentPage = state.pdfDoc.numPages;
    hideProperties();
    await renderPage(state.currentPage);
  }
}

async function handlePageInput(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const { renderPage } = await import('../../pdf/renderer.js');
  const { hideProperties } = await import('../../ui/panels/properties-panel.js');
  const pageNum = parseInt(e.target.value, 10);
  if (state.pdfDoc && pageNum >= 1 && pageNum <= state.pdfDoc.numPages) {
    state.currentPage = pageNum;
    hideProperties();
    await renderPage(state.currentPage);
  } else {
    e.target.value = state.currentPage;
  }
  e.target.blur();
}

async function handlePageBlur(e) {
  if (state.pdfDoc) {
    const pageNum = parseInt(e.target.value, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > state.pdfDoc.numPages) {
      e.target.value = state.currentPage;
    }
  }
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
  const { renderPage, renderContinuous } = await import('../../pdf/renderer.js');
  let val = e.target.value.replace('%', '').trim();
  let pct = parseInt(val, 10);
  if (!isNaN(pct) && pct >= 10 && pct <= 500) {
    state.scale = pct / 100;
    if (state.viewMode === 'continuous') {
      await renderContinuous();
    } else if (state.pdfDoc) {
      await renderPage(state.currentPage);
    }
  }
  e.target.blur();
}

async function handleZoomBlur(e) {
  let val = e.target.value.replace('%', '').trim();
  let pct = parseInt(val, 10);
  if (isNaN(pct) || pct < 10 || pct > 500) {
    e.target.value = Math.round(state.scale * 100) + '%';
  } else if (!e.target.value.includes('%')) {
    e.target.value = pct + '%';
  }
}

export default function StatusBar() {
  const toolName = () => TOOL_NAMES[state.currentTool] || state.currentTool;
  const totalPages = () => state.pdfDoc?.numPages || 0;
  const zoomText = () => Math.round(state.scale * 100) + '%';
  const annotationText = () => {
    if (state.viewMode === 'continuous') {
      return `${state.annotations.length}`;
    }
    const pageCount = state.annotations.filter(a => a.page === state.currentPage).length;
    return `${pageCount} (${state.annotations.length} total)`;
  };

  return (
    <div class="status-bar">
      <div class="status-bar-left">
        <div class="status-item">
          <span class="status-item-label">Tool:</span>
          <span class="status-item-value">{toolName()}</span>
        </div>
        <div class="status-separator"></div>
        <div class="status-item">
          <span class="status-item-label">Annotations:</span>
          <span class="status-item-value">{annotationText()}</span>
        </div>
      </div>

      <Show when={!!state.pdfDoc}>
        <div class="status-bar-center">
          <button class="status-nav-btn" title="First Page" onClick={goFirst}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7M18 19l-7-7 7-7"/>
            </svg>
          </button>

          <button class="status-nav-btn" title="Previous Page" onClick={goPrev}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>

          <span class="status-page-info">
            Page <input type="number" class="status-page-input" value={state.currentPage} min="1" onKeyDown={handlePageInput} onBlur={handlePageBlur} /> / <span>{totalPages()}</span>
          </span>

          <button class="status-nav-btn" title="Next Page" onClick={goNext}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </button>

          <button class="status-nav-btn" title="Last Page" onClick={goLast}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M6 5l7 7-7 7"/>
            </svg>
          </button>

          <div class="status-zoom-controls">
            <button class="status-nav-btn" title="Zoom Out" onClick={handleZoomOut}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
              </svg>
            </button>

            <input type="text" class="status-zoom-input" value={zoomText()} onKeyDown={handleZoomInput} onBlur={handleZoomBlur} />

            <button class="status-nav-btn" title="Zoom In" onClick={handleZoomIn}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
            </button>
          </div>
        </div>
      </Show>

      <div class="status-bar-right">
        <div class="status-item">
          <Show when={state.statusMessageVisible}>
            {state.statusMessage}
          </Show>
        </div>
      </div>
    </div>
  );
}

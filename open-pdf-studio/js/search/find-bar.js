/**
 * Find Bar - UI component for PDF text search
 */

import { state, getActiveDocument } from '../core/state.js';
import { executeSearch, executeProgressiveSearch, findNext, findPrevious, getCurrentResult, clearSearch, getResultsForPage } from './find-controller.js';
import { renderPage, renderContinuous } from '../pdf/renderer.js';
import {
  setFindBarVisible as setVisible, setFindBarResultsText as setResultsText,
  setFindBarMessageText as setMessageText, setFindBarNotFound as setNotFound,
  setFindBarNavDisabled as setNavDisabled,
  setFindBarSearching as setSearching,
} from '../bridge.js';

// Debounce timer for search input
let searchDebounceTimer = null;

// Cancel function for the current progressive search
let cancelProgressiveSearch = null;

/**
 * Initialize the find bar (no-op, retained for backward compatibility).
 * Event binding is now handled by the Solid.js FindBar component.
 */
export function initFindBar() {
  // No-op: DOM caching and event binding moved to FindBar.jsx
}

/**
 * Open the find bar
 */
export function openFindBar() {
  setVisible(true);
  state.search.isOpen = true;

  // If there's existing search text, re-run search
  if (state.search.query) {
    executeSearchAndUpdate();
  }
}

/**
 * Close the find bar
 */
export function closeFindBar() {
  setVisible(false);
  state.search.isOpen = false;

  // Cancel any in-progress search
  if (cancelProgressiveSearch) {
    cancelProgressiveSearch();
    cancelProgressiveSearch = null;
  }
  setSearching(false);

  // Clear highlights but keep search state
  clearHighlights();
}

/**
 * Toggle the find bar
 */
export function toggleFindBar() {
  if (state.search.isOpen) {
    closeFindBar();
  } else {
    openFindBar();
  }
}

/**
 * Handle search input (called from component)
 * @param {string} value - The current input value
 */
export function handleSearchInput(value) {
  const query = value;
  state.search.query = query;

  // Cancel any in-progress search
  if (cancelProgressiveSearch) {
    cancelProgressiveSearch();
    cancelProgressiveSearch = null;
  }

  // Debounce search
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  if (!query) {
    clearSearch();
    setSearching(false);
    updateUI();
    clearHighlights();
    return;
  }

  searchDebounceTimer = setTimeout(() => {
    executeSearchAndUpdate();
  }, 300);
}

/**
 * Handle find next button click
 */
export async function onFindNext() {
  // Cancel any pending debounce and use current query
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  if (state.search.results.length === 0) {
    // If no results yet, execute search first
    if (state.search.query) {
      await executeSearchAndUpdate();
    }
    return;
  }

  const result = findNext();
  if (result) {
    await navigateToResult(result);
    updateUI();
    highlightResults();
  }
}

/**
 * Trigger search from external call (e.g., Enter key press before debounce)
 */
export async function triggerSearch() {
  if (state.search.query) {
    await executeSearchAndUpdate();
  }
}

/**
 * Handle find previous button click
 */
export async function onFindPrevious() {
  // Cancel any pending debounce and use current query
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  if (state.search.results.length === 0) {
    if (state.search.query) {
      await executeSearchAndUpdate();
    }
    return;
  }

  const result = findPrevious();
  if (result) {
    await navigateToResult(result);
    updateUI();
    highlightResults();
  }
}

/**
 * Handle options change (match case, whole word)
 * @param {{ matchCase: boolean, wholeWord: boolean }} options
 */
export function onOptionsChange(options) {
  state.search.matchCase = options.matchCase;
  state.search.wholeWord = options.wholeWord;

  // Cancel any in-progress search
  if (cancelProgressiveSearch) {
    cancelProgressiveSearch();
    cancelProgressiveSearch = null;
  }

  if (state.search.query) {
    // Reset results before re-searching
    state.search.results = [];
    state.search.totalMatches = 0;
    state.search.currentIndex = -1;
    executeSearchAndUpdate();
  }
}

/**
 * Handle highlight all checkbox change
 * @param {boolean} highlightAll
 */
export function onHighlightChange(highlightAll) {
  state.search.highlightAll = highlightAll;
  highlightResults();
}

/**
 * Execute search and update UI progressively
 */
async function executeSearchAndUpdate() {
  // Cancel any in-progress search
  if (cancelProgressiveSearch) {
    cancelProgressiveSearch();
    cancelProgressiveSearch = null;
  }

  const query = state.search.query;
  if (!query) return;

  // Reset state
  state.search.results = [];
  state.search.totalMatches = 0;
  state.search.currentIndex = -1;

  setSearching(true);
  setResultsText('Searching...');
  setMessageText('');
  setNotFound(false);
  setNavDisabled(true);

  let navigatedToFirst = false;
  // Track the matchText of the result we navigated to so we can find it after re-sort
  let navigatedMatchPage = -1;
  let navigatedMatchPos = -1;

  cancelProgressiveSearch = executeProgressiveSearch((results, searchedPages, totalPages, done) => {
    // Update state
    state.search.results = results;
    state.search.totalMatches = results.length;

    // Set currentIndex to first result on current page (or first overall)
    if (results.length > 0 && state.search.currentIndex === -1) {
      const doc = getActiveDocument();
      const currentPage = doc ? doc.currentPage : 1;
      let firstIndex = results.findIndex(r => r.pageNum >= currentPage);
      if (firstIndex === -1) firstIndex = 0;
      state.search.currentIndex = firstIndex;
    }

    // Update results count with page progress
    if (results.length > 0) {
      const idx = state.search.currentIndex;
      if (done) {
        setResultsText(`${idx + 1} of ${results.length}`);
      } else {
        setResultsText(`${results.length}+ (${searchedPages}/${totalPages})`);
      }
      setNavDisabled(false);
      setNotFound(false);
    } else if (done) {
      setResultsText('No results');
      setNotFound(true);
      setMessageText('Phrase not found');
    } else {
      setResultsText(`${searchedPages}/${totalPages} pages...`);
    }

    // Navigate to first result as soon as we have one
    if (!navigatedToFirst && results.length > 0) {
      navigatedToFirst = true;
      const result = getCurrentResult();
      if (result) {
        navigatedMatchPage = result.pageNum;
        navigatedMatchPos = result.startPos;
        navigateToResult(result);
      }
      highlightResults();
    }

    if (done) {
      setSearching(false);
      cancelProgressiveSearch = null;

      if (results.length > 0) {
        // After re-sort by page order, find the result we originally navigated to
        let newIdx = results.findIndex(r =>
          r.pageNum === navigatedMatchPage && r.startPos === navigatedMatchPos
        );
        if (newIdx === -1) {
          const doc = getActiveDocument();
          const currentPage = doc ? doc.currentPage : 1;
          newIdx = results.findIndex(r => r.pageNum >= currentPage);
          if (newIdx === -1) newIdx = 0;
        }
        state.search.currentIndex = newIdx;
        setResultsText(`${newIdx + 1} of ${results.length}`);
      }
      setMessageText(results.length === 0 && query ? 'Phrase not found' : '');
      highlightResults();
    }
  });
}

/**
 * Navigate to a search result
 */
async function navigateToResult(result) {
  if (!result) return;

  // Switch to the page if needed
  const doc = getActiveDocument();
  const docPage = doc ? doc.currentPage : 1;
  if (result.pageNum !== docPage) {
    if (doc) doc.currentPage = result.pageNum;

    if (getActiveDocument()?.viewMode === 'continuous') {
      // Scroll to page in continuous mode
      const pageWrapper = document.querySelector(`.page-wrapper[data-page="${result.pageNum}"]`);
      if (pageWrapper) {
        pageWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      // Render the page in single page mode
      await renderPage(result.pageNum);
    }
  }

  // Scroll to the match after a short delay to ensure rendering is complete
  setTimeout(() => {
    scrollToMatch(result);
  }, 100);
}

/**
 * Scroll to a specific match on the current page
 */
function scrollToMatch(result) {
  if (!result || !result.items || result.items.length === 0) return;

  // Find the highlight element for the current match
  const highlights = document.querySelectorAll('.search-highlight.current');
  if (highlights.length > 0) {
    highlights[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
}

/**
 * Update the find bar UI via store signals
 */
function updateUI() {
  const { results, currentIndex, totalMatches, query } = state.search;

  // Update results count
  if (totalMatches > 0) {
    setResultsText(`${currentIndex + 1} of ${totalMatches}`);
  } else if (query) {
    setResultsText('No results');
  } else {
    setResultsText('');
  }

  // Update message
  if (query && totalMatches === 0) {
    setMessageText('Phrase not found');
  } else {
    setMessageText('');
  }

  // Update not-found state (drives input + message styling)
  setNotFound(!!query && totalMatches === 0);

  // Update nav button disabled state
  setNavDisabled(totalMatches === 0);
}

/**
 * Highlight search results on the current page
 */
export function highlightResults() {
  // Clear existing highlights first
  clearHighlights();

  if (!state.search.highlightAll || state.search.results.length === 0) {
    // Still highlight current match even if highlightAll is off
    const currentResult = getCurrentResult();
    if (currentResult && currentResult.pageNum === (getActiveDocument()?.currentPage || 1)) {
      highlightMatch(currentResult, true);
    }
    return;
  }

  // Get results for the current page (or all pages in continuous mode)
  let pageResults;
  if (getActiveDocument()?.viewMode === 'continuous') {
    pageResults = state.search.results;
  } else {
    pageResults = getResultsForPage(getActiveDocument()?.currentPage || 1);
  }

  const currentResult = getCurrentResult();

  // Highlight all matches on the page
  pageResults.forEach(result => {
    const isCurrent = currentResult && result.index === currentResult.index;
    highlightMatch(result, isCurrent);
  });
}

/**
 * Highlight search results on a page.
 *
 * Highlights are positioned from the matched items' own PDF-space geometry
 * (transform/width/height captured at text extraction), NOT from measuring
 * DOM spans. The three text-layer builders (custom single-page PDF.js,
 * stock PDF.js TextLayer in continuous mode, Rust-extracted spans in vector
 * mode) produce different span structures — only one of them carries
 * data-item-index — so any DOM-based lookup breaks on the other two.
 * Item geometry is layer-type independent, and because the rects live in
 * layer-local coordinates they ride along with the viewport's zoom
 * transform instead of needing re-measurement.
 */
function highlightMatch(result, isCurrent) {
  if (!result || !result.items || result.items.length === 0) return;

  const pageNum = result.pageNum;
  const doc = getActiveDocument();

  // Get the text layer for this page
  let textLayer;
  if (doc?.viewMode === 'continuous') {
    const wrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
    textLayer = wrapper?.querySelector('.textLayer');
  } else {
    if (doc && doc.currentPage !== pageNum) return;
    textLayer = document.querySelector('.textLayer');
  }
  if (!textLayer) return;

  // Layer-local px per PDF point. Every layer builder sets
  // --total-scale-factor on the layer or an ancestor: 1 in vector mode
  // (layout px = PDF pt, zoom applied via CSS transform), viewport.scale
  // for the PDF.js-built layers (laid out at scaled size).
  const scale = parseFloat(
    getComputedStyle(textLayer).getPropertyValue('--total-scale-factor')
  ) || 1;
  const pageHeightPt = textLayer.offsetHeight / scale;

  for (const item of result.items) {
    const t = item.transform;
    if (!t) continue; // synthetic (Add Text) items carry no geometry

    const startInItem = Math.max(0, result.startPos - item.startPos);
    const endInItem = Math.min(item.str.length, result.endPos - item.startPos);
    if (endInItem <= startInItem) continue;

    // Partial matches inside an item: slice the run width proportionally
    // by character count. Approximate for proportional fonts, but close
    // enough for a highlight and independent of DOM/font availability.
    const len = item.str.length || 1;
    const itemH = item.height || Math.abs(t[3]) || 10;
    const itemW = item.width || 0;
    const x0 = t[4] + itemW * (startInItem / len);
    const x1 = t[4] + itemW * (endInItem / len);
    // t[5] is the baseline; ascent ≈ 0.8em above it (same convention the
    // vector-mode span builder uses), Y flipped into top-left space.
    const topPt = pageHeightPt - t[5] - itemH * 0.8;

    const highlight = document.createElement('div');
    highlight.className = 'search-highlight' + (isCurrent ? ' current' : '');
    highlight.dataset.resultIndex = result.index;
    highlight.style.left = (x0 * scale) + 'px';
    highlight.style.top = (topPt * scale) + 'px';
    highlight.style.width = (Math.max(x1 - x0, 2) * scale) + 'px';
    highlight.style.height = (itemH * scale) + 'px';
    textLayer.appendChild(highlight);
  }
}

/**
 * Clear all search highlights
 */
export function clearHighlights() {
  const highlights = document.querySelectorAll('.search-highlight');
  highlights.forEach(h => h.remove());
}

/**
 * Re-highlight after page render.
 * Uses requestAnimationFrame to ensure the text layer is fully laid out
 * before measuring positions, preventing highlights from flashing at
 * wrong positions during zoom.
 */
export function onPageRendered() {
  if (state.search.isOpen && state.search.results.length > 0) {
    requestAnimationFrame(() => {
      highlightResults();
    });
  }
}

// ==================== Replace handlers ====================

export async function onReplace() {
  try {
    const { replaceCurrentMatch, clearTextCache, getCurrentResult } = await import('./find-controller.js');
    const replaceWith = state.search.replaceQuery || '';

    // Ensure we're on the correct page
    const currentResult = getCurrentResult();
    if (currentResult) {
      const doc = getActiveDocument();
      if (doc && currentResult.pageNum !== doc.currentPage) {
        await navigateToResult(currentResult);
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const replaced = await replaceCurrentMatch(replaceWith);
    if (replaced) {
      const { markDocumentModified } = await import('../ui/chrome/tabs.js');
      markDocumentModified();

      const doc = getActiveDocument();
      if (doc) clearTextCache(doc.id);

      if (getActiveDocument()?.viewMode === 'continuous') {
        await renderContinuous();
      } else {
        await renderPage(getActiveDocument()?.currentPage || 1);
      }
      await executeSearchAndUpdate();
    }
  } catch (err) {
    console.error('[onReplace]', err);
  }
}

export async function onReplaceAll() {
  const { replaceAllMatches, clearTextCache } = await import('./find-controller.js');
  const replaceWith = state.search.replaceQuery || '';

  const count = await replaceAllMatches(replaceWith);
  if (count > 0) {
    const { markDocumentModified } = await import('../ui/chrome/tabs.js');
    markDocumentModified();

    const doc = getActiveDocument();
    if (doc) clearTextCache(doc.id);

    // Re-render to show the text edits
    if (getActiveDocument()?.viewMode === 'continuous') {
      const { redrawContinuous } = await import('../annotations/rendering.js');
      redrawContinuous();
    } else {
      await renderPage(getActiveDocument()?.currentPage || 1);
    }

    // Re-search
    await executeSearchAndUpdate();

    setMessageText(`Replaced ${count} occurrences`);
  } else {
    setMessageText('No replacements made');
  }
}

export function handleReplaceInput(value) {
  state.search.replaceQuery = value;
}

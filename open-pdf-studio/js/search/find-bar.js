/**
 * Find Bar - UI component for PDF text search
 */

import { state, getActiveDocument } from '../core/state.js';
import { executeSearch, executeProgressiveSearch, findNext, findPrevious, getCurrentResult, clearSearch, getResultsForPage, findDomSpanForItem } from './find-controller.js';
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
 * Highlight search results on a page
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
    textLayer = document.querySelector('.textLayer');
  }

  if (!textLayer) return;
  const layerRect = textLayer.getBoundingClientRect();

  // The textLayer is laid out in unscaled PDF points and zoomed via a CSS
  // transform on the layer itself (pdf-viewport.js). Range/element rects are
  // visual (post-transform) pixels, so offsets must be divided by the
  // effective scale before being used as child left/top — the layer's
  // transform is applied to the highlight divs on top of whatever we set.
  const scaleX = textLayer.offsetWidth ? layerRect.width / textLayer.offsetWidth : 1;
  const scaleY = textLayer.offsetHeight ? layerRect.height / textLayer.offsetHeight : 1;

  // Highlight exactly the matched glyphs. The search result already knows
  // which text items it covers (result.items, with page-text offsets and
  // itemIndex mapping to span[data-item-index]); positioning from those is
  // correct regardless of the page's content-stream order. The previous
  // approach re-scanned the DOM for the match text and paired the Nth
  // stream-order result with the Nth visual-order occurrence, which lands
  // on the wrong occurrence whenever those orders differ (multi-column
  // layouts, tables, headers drawn last, ...).
  for (const item of result.items) {
    const span = findDomSpanForItem(item, pageNum, doc);
    const textNode = span?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

    const nodeLen = textNode.textContent.length;
    const startInItem = Math.max(0, result.startPos - item.startPos);
    const endInItem = Math.min(item.str.length, result.endPos - item.startPos);
    if (endInItem <= startInItem) continue;

    let rect;
    try {
      const range = document.createRange();
      range.setStart(textNode, Math.min(startInItem, nodeLen));
      range.setEnd(textNode, Math.min(endInItem, nodeLen));
      rect = range.getBoundingClientRect();
    } catch (_) {
      rect = span.getBoundingClientRect();
    }
    if (!rect || rect.width <= 0) continue;

    const highlight = document.createElement('div');
    highlight.className = 'search-highlight' + (isCurrent ? ' current' : '');
    highlight.dataset.resultIndex = result.index;
    highlight.style.left = ((rect.left - layerRect.left) / scaleX) + 'px';
    highlight.style.top = ((rect.top - layerRect.top) / scaleY) + 'px';
    highlight.style.width = (rect.width / scaleX) + 'px';
    highlight.style.height = (rect.height / scaleY) + 'px';
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

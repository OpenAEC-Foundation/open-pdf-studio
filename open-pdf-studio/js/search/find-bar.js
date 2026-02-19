/**
 * Find Bar - UI component for PDF text search
 */

import { state } from '../core/state.js';
import { executeSearch, findNext, findPrevious, getCurrentResult, clearSearch, getResultsForPage } from './find-controller.js';
import { renderPage, renderContinuous } from '../pdf/renderer.js';
import { setVisible, setResultsText, setMessageText, setNotFound, setNavDisabled } from '../solid/stores/findBarStore.js';

// Debounce timer for search input
let searchDebounceTimer = null;

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

  // Debounce search
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  if (!query) {
    clearSearch();
    updateUI();
    clearHighlights();
    return;
  }

  searchDebounceTimer = setTimeout(() => {
    executeSearchAndUpdate();
  }, 150);
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

  if (state.search.query) {
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
 * Execute search and update UI
 */
async function executeSearchAndUpdate() {
  await executeSearch();
  updateUI();

  // Navigate to first result if found
  const result = getCurrentResult();
  if (result) {
    await navigateToResult(result);
  }

  highlightResults();
}

/**
 * Navigate to a search result
 */
async function navigateToResult(result) {
  if (!result) return;

  // Switch to the page if needed
  if (result.pageNum !== state.currentPage) {
    state.currentPage = result.pageNum;

    if (state.viewMode === 'continuous') {
      // Scroll to page in continuous mode
      const pageWrapper = document.querySelector(`[data-page-num="${result.pageNum}"]`);
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
    if (currentResult && currentResult.pageNum === state.currentPage) {
      highlightMatch(currentResult, true);
    }
    return;
  }

  // Get results for the current page (or all pages in continuous mode)
  let pageResults;
  if (state.viewMode === 'continuous') {
    pageResults = state.search.results;
  } else {
    pageResults = getResultsForPage(state.currentPage);
  }

  const currentResult = getCurrentResult();

  // Highlight all matches on the page
  pageResults.forEach(result => {
    const isCurrent = currentResult && result.index === currentResult.index;
    highlightMatch(result, isCurrent);
  });
}

/**
 * Find all occurrences of search text in the text layer and return their positions
 */
function findAllMatchPositions(textLayer, searchText, matchCase) {
  const positions = [];
  const textSpans = textLayer.querySelectorAll('span');
  const compareSearchText = matchCase ? searchText : searchText.toLowerCase();

  for (const span of textSpans) {
    const spanText = span.textContent;
    if (!spanText) continue;

    const compareSpanText = matchCase ? spanText : spanText.toLowerCase();
    let startIndex = 0;

    while (true) {
      const matchIndex = compareSpanText.indexOf(compareSearchText, startIndex);
      if (matchIndex === -1) break;

      const textNode = span.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        try {
          // Get span's position within the text layer (from its style)
          const spanLeft = parseFloat(span.style.left) || 0;
          const spanTop = parseFloat(span.style.top) || 0;

          // Get the scaleX factor from transform if present
          let scaleX = 1;
          const transform = span.style.transform;
          if (transform) {
            const scaleMatch = transform.match(/scaleX\(([^)]+)\)/);
            if (scaleMatch) {
              scaleX = parseFloat(scaleMatch[1]) || 1;
            }
          }

          // Measure the width of text before the match (in original coordinates)
          let preWidth = 0;
          if (matchIndex > 0) {
            const preRange = document.createRange();
            preRange.setStart(textNode, 0);
            preRange.setEnd(textNode, matchIndex);
            preWidth = preRange.getBoundingClientRect().width;
          }

          // Measure the width of the match itself
          const matchRange = document.createRange();
          matchRange.setStart(textNode, matchIndex);
          matchRange.setEnd(textNode, matchIndex + searchText.length);
          const matchRect = matchRange.getBoundingClientRect();

          // Get span's visual bounding rect
          const spanRect = span.getBoundingClientRect();
          const textLayerRect = span.parentElement.getBoundingClientRect();

          // Calculate position relative to text layer using visual coordinates
          const highlightLeft = matchRect.left - textLayerRect.left;
          const highlightTop = matchRect.top - textLayerRect.top;

          // Store position data
          positions.push({
            span,
            highlightLeft,
            highlightTop,
            matchWidth: matchRect.width,
            matchHeight: matchRect.height,
            matchIndex,
            spanText,
            // Also store viewport rect for sorting
            viewportTop: matchRect.top,
            viewportLeft: matchRect.left
          });
        } catch (e) {
          console.warn('Range error:', e);
        }
      }

      startIndex = matchIndex + 1;
    }
  }

  // Sort by position (top to bottom, left to right)
  positions.sort((a, b) => {
    if (Math.abs(a.viewportTop - b.viewportTop) > 5) {
      return a.viewportTop - b.viewportTop;
    }
    return a.viewportLeft - b.viewportLeft;
  });

  return positions;
}

/**
 * Highlight search results on a page
 */
function highlightMatch(result, isCurrent) {
  if (!result || !result.matchText) return;

  const pageNum = result.pageNum;

  // Get the text layer for this page
  let textLayer;
  if (state.viewMode === 'continuous') {
    textLayer = document.querySelector(`[data-page-num="${pageNum}"] .textLayer`);
  } else {
    textLayer = document.querySelector('.textLayer');
  }

  if (!textLayer) return;

  // Find all match positions in the text layer
  const positions = findAllMatchPositions(textLayer, result.matchText, state.search.matchCase);

  // Count which occurrence this result is on this page
  const pageResults = state.search.results.filter(r => r.pageNum === pageNum);
  const occurrenceIndex = pageResults.findIndex(r => r.index === result.index);

  if (occurrenceIndex >= 0 && occurrenceIndex < positions.length) {
    const pos = positions[occurrenceIndex];

    const highlight = document.createElement('div');
    highlight.className = 'search-highlight' + (isCurrent ? ' current' : '');
    highlight.dataset.resultIndex = result.index;

    // Position using calculated visual coordinates
    highlight.style.left = pos.highlightLeft + 'px';
    highlight.style.top = pos.highlightTop + 'px';
    highlight.style.width = pos.matchWidth + 'px';
    highlight.style.height = pos.matchHeight + 'px';

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
 * Re-highlight after page render
 */
export function onPageRendered() {
  if (state.search.isOpen && state.search.results.length > 0) {
    highlightResults();
  }
}

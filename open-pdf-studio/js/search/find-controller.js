/**
 * Find Controller - Core search logic for PDF text search
 */

import { state, getActiveDocument } from '../core/state.js';

// Cache for extracted text content per document
const textCache = new Map();

/**
 * Extract text content from all pages of a PDF document
 * @param {Object} pdfDoc - PDF.js document object
 * @returns {Promise<Array>} Array of page text data
 */
async function extractAllText(pdfDoc) {
  console.log('extractAllText called');
  const docId = getActiveDocument()?.id;
  console.log('docId:', docId, 'cached:', textCache.has(docId));

  // Check cache first
  if (docId && textCache.has(docId)) {
    console.log('Returning cached text');
    return textCache.get(docId);
  }

  const pagesText = [];
  console.log('Extracting text from', pdfDoc.numPages, 'pages');

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    console.log('Extracting page', pageNum);
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Build full page text with character mapping
    let pageText = '';
    const items = [];

    let spanIndex = 0;
    textContent.items.forEach((item) => {
      if (item.str) {
        // Track span index only for items that text-layer.js will render
        // text-layer skips items where str.trim() === ''
        const hasSpan = item.str.trim() !== '';
        items.push({
          str: item.str,
          startPos: pageText.length,
          endPos: pageText.length + item.str.length,
          transform: item.transform,
          width: item.width,
          height: item.height,
          itemIndex: hasSpan ? spanIndex : -1
        });
        if (hasSpan) spanIndex++;
        pageText += item.str;
      }
    });

    pagesText.push({
      pageNum,
      text: pageText,
      items
    });
  }

  // Cache the result
  if (docId) {
    textCache.set(docId, pagesText);
  }

  return pagesText;
}

/**
 * Clear text cache for a document
 * @param {string} docId - Document ID
 */
export function clearTextCache(docId) {
  if (docId) {
    textCache.delete(docId);
  }
}

/**
 * Perform search across all pages
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Array of search results
 */
export async function performSearch(query, options = {}) {
  console.log('performSearch called, query:', query, 'pdfDoc exists:', !!state.pdfDoc);
  if (!query || !state.pdfDoc) {
    console.log('performSearch: no query or no pdfDoc, returning empty');
    return [];
  }

  const { matchCase = false, wholeWord = false } = options;

  state.search.isSearching = true;

  try {
    const pagesText = await extractAllText(state.pdfDoc);
    const results = [];

    // Prepare search pattern
    let searchQuery = query;
    if (!matchCase) {
      searchQuery = query.toLowerCase();
    }

    // Word boundary regex for whole word matching
    const wordBoundary = wholeWord ? '\\b' : '';
    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(wordBoundary + escapedQuery + wordBoundary, matchCase ? 'g' : 'gi');

    for (const pageData of pagesText) {
      const { pageNum, text, items } = pageData;

      // Find all matches on this page
      let match;
      const pageText = matchCase ? text : text.toLowerCase();

      // Reset regex
      pattern.lastIndex = 0;

      while ((match = pattern.exec(text)) !== null) {
        const startPos = match.index;
        const endPos = startPos + query.length;

        // Find which text items this match spans
        const matchItems = items.filter(item =>
          (item.startPos < endPos && item.endPos > startPos)
        );

        if (matchItems.length > 0) {
          results.push({
            pageNum,
            startPos,
            endPos,
            matchText: text.substring(startPos, endPos),
            items: matchItems,
            index: results.length
          });
        }
      }
    }

    return results;
  } finally {
    state.search.isSearching = false;
  }
}

/**
 * Execute a search with the current query and options
 */
export async function executeSearch() {
  const { query, matchCase, wholeWord } = state.search;
  console.log('executeSearch called, query:', query, 'pdfDoc:', !!state.pdfDoc);

  if (!query) {
    state.search.results = [];
    state.search.totalMatches = 0;
    state.search.currentIndex = -1;
    return;
  }

  console.log('Calling performSearch...');
  const results = await performSearch(query, { matchCase, wholeWord });
  console.log('performSearch returned, results:', results.length);

  state.search.results = results;
  state.search.totalMatches = results.length;

  if (results.length > 0) {
    // Find first match on current page or after
    const currentPage = state.currentPage;
    let firstIndex = results.findIndex(r => r.pageNum >= currentPage);
    if (firstIndex === -1) firstIndex = 0;

    state.search.currentIndex = firstIndex;
  } else {
    state.search.currentIndex = -1;
  }
}

/**
 * Navigate to the next search result
 */
export function findNext() {
  const { results, currentIndex } = state.search;

  if (results.length === 0) return null;

  let nextIndex = currentIndex + 1;
  if (nextIndex >= results.length) {
    nextIndex = 0; // Wrap around
  }

  state.search.currentIndex = nextIndex;
  return results[nextIndex];
}

/**
 * Navigate to the previous search result
 */
export function findPrevious() {
  const { results, currentIndex } = state.search;

  if (results.length === 0) return null;

  let prevIndex = currentIndex - 1;
  if (prevIndex < 0) {
    prevIndex = results.length - 1; // Wrap around
  }

  state.search.currentIndex = prevIndex;
  return results[prevIndex];
}

/**
 * Get the current search result
 */
export function getCurrentResult() {
  const { results, currentIndex } = state.search;

  if (currentIndex >= 0 && currentIndex < results.length) {
    return results[currentIndex];
  }

  return null;
}

/**
 * Get all results for a specific page
 * @param {number} pageNum - Page number
 */
export function getResultsForPage(pageNum) {
  return state.search.results.filter(r => r.pageNum === pageNum);
}

/**
 * Clear search results
 */
export function clearSearch() {
  state.search.query = '';
  state.search.results = [];
  state.search.totalMatches = 0;
  state.search.currentIndex = -1;
}

/**
 * Check if search wrapped around
 */
export function didSearchWrap(direction) {
  const { results, currentIndex } = state.search;

  if (results.length === 0) return false;

  if (direction === 'next') {
    return currentIndex === 0;
  } else {
    return currentIndex === results.length - 1;
  }
}

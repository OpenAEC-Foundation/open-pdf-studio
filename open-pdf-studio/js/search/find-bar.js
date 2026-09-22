/**
 * Find Bar - UI component for PDF text search
 */

import { state, getActiveDocument } from '../core/state.js';
import { executeSearch, executeProgressiveSearch, findNext, findPrevious, getCurrentResult, clearSearch, getResultsForPage } from './find-controller.js';
import { renderPage, renderContinuous } from '../pdf/renderer.js';
import { matchFractions, matchBoxInPageFrame, boxToLayerPercent } from './match-rect.js';
import { groepeerPerPagina, BRON_ANNOTATIE } from './search-sources.js';
import { annotationBounds } from '../annotations/spatial-index.js';
import {
  setFindBarResultGroups as setResultGroups,
  setFindBarCurrentResultPage as setCurrentResultPage,
  setFindBarSourcesOff as setSourcesOff,
  setFindBarSearchInText as setSearchInText,
  setFindBarSearchInAnnotations as setSearchInAnnotations,
} from '../bridge.js';
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
 * Zoekbronnen aan/uit (tekst en annotaties). De keuze blijft bewaard in de
 * voorkeuren, zodat hij een herstart overleeft.
 */
export function onSourcesChange({ tekst, annotaties }) {
  state.search.sources = { tekst: !!tekst, annotaties: !!annotaties };
  setSearchInText(!!tekst);
  setSearchInAnnotations(!!annotaties);
  state.preferences.searchInText = !!tekst;
  state.preferences.searchInAnnotations = !!annotaties;
  import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});

  if (cancelProgressiveSearch) {
    cancelProgressiveSearch();
    cancelProgressiveSearch = null;
  }
  state.search.results = [];
  state.search.totalMatches = 0;
  state.search.currentIndex = -1;
  clearHighlights();
  if (state.search.query) {
    executeSearchAndUpdate();
  } else {
    updateUI();
  }
}

/** Zet de opgeslagen bronkeuze terug bij het opstarten. */
export function applySourcePreferences() {
  const tekst = state.preferences.searchInText !== false;
  const annotaties = state.preferences.searchInAnnotations !== false;
  state.search.sources = { tekst, annotaties };
  setSearchInText(tekst);
  setSearchInAnnotations(annotaties);
}

/**
 * Spring naar de eerste treffer op een pagina uit de resultatenlijst.
 */
export async function goToResultIndex(index) {
  const results = state.search.results;
  if (!Number.isInteger(index) || index < 0 || index >= results.length) return;
  state.search.currentIndex = index;
  await navigateToResult(results[index]);
  updateUI();
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

  // Geen bron aangevinkt: geen zoekopdracht, wel een duidelijke toestand.
  const bronnen = state.search.sources;
  if (bronnen && !bronnen.tekst && !bronnen.annotaties) {
    state.search.results = [];
    state.search.totalMatches = 0;
    state.search.currentIndex = -1;
    setSearching(false);
    clearHighlights();
    updateUI();
    return;
  }

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

    // De lijst onder de zoekbalk groeit mee met de progressieve zoektocht.
    publiceerResultatenlijst();
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
  if (!result) return;

  // Find the highlight element for the current match
  const highlights = document.querySelectorAll('.search-highlight.current');
  if (highlights.length === 0) return;
  if (panViewportToElement(highlights[0])) return;
  highlights[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
}

/**
 * Enkele pagina: de pagina hangt in de viewport (canvas + eigen verschuiving),
 * niet in een scrollbare container — scrollIntoView doet daar niets. Ligt de
 * treffer buiten beeld, dan schuift de viewport hem naar het midden. De
 * render-lus klemt daarna zelf af op de paginaranden.
 * @returns {boolean} true als de viewport de verplaatsing heeft afgehandeld
 */
function panViewportToElement(el) {
  const vp = window.__pdfViewport;
  const canvas = document.getElementById('pdf-canvas');
  if (!vp || !vp.active || !canvas) return false;
  const cr = canvas.getBoundingClientRect();
  const hr = el.getBoundingClientRect();
  if (!(cr.width > 0 && cr.height > 0)) return false;
  const marge = 12;
  const buitenBeeld = hr.left < cr.left + marge || hr.right > cr.right - marge
    || hr.top < cr.top + marge || hr.bottom > cr.bottom - marge;
  if (buitenBeeld) {
    vp.offsetX += (cr.left + cr.width / 2) - (hr.left + hr.width / 2);
    vp.offsetY += (cr.top + cr.height / 2) - (hr.top + hr.height / 2);
    vp.dirty = true;
  }
  return true;
}

/**
 * Update the find bar UI via store signals
 */
function updateUI() {
  const { results, currentIndex, totalMatches, query } = state.search;
  publiceerResultatenlijst();
  const bronnenUit = state.search.sources
    && !state.search.sources.tekst && !state.search.sources.annotaties;
  setSourcesOff(!!bronnenUit);
  if (bronnenUit) {
    setResultsText('');
    setMessageText('');
    setNotFound(false);
    setNavDisabled(true);
    return;
  }

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
 * (transform/width captured at text extraction), NOT from measuring DOM
 * spans: the text-layer builders (PDF.js layer on a single page, stock
 * PDF.js TextLayer in continuous mode, Rust-extracted spans in vector mode)
 * produce different span structures.
 *
 * All of those layers are laid out in the unrotated page box (origin at the
 * box's top-left, Y down) and apply rotation + zoom themselves. The rects are
 * therefore set in PERCENT of that box (see match-rect.js), like PDF.js does
 * for its spans: no layer scale or layer height is read. Those values were
 * unreliable right after a (re)build — the scale came from an ancestor and
 * the height from the container until the viewport sync ran — which put the
 * highlights at the wrong spot and size.
 */
function highlightMatch(result, isCurrent) {
  if (!result) return;
  const view = result.pageView;
  if (!view) return;

  const pageNum = result.pageNum;
  const doc = getActiveDocument();
  const textLayer = tekstlaagVanPagina(pageNum, doc);
  if (!textLayer) return;

  // Annotatietreffer: een kader om de annotatie zelf; de tekst ervan staat
  // niet in de tekstlaag, dus er is geen letterpositie om op te mikken.
  if (result.bron === BRON_ANNOTATIE) {
    const ann = doc?.annotations?.find(a => a.id === result.annotationId);
    const doos = ann ? annotationBounds(ann) : null;
    if (!doos) return;
    const el = maakMarkering(result, isCurrent);
    el.classList.add('search-highlight-annotation');
    const W = view[2] - view[0];
    const H = view[3] - view[1];
    el.style.left = (100 * doos.x) / W + '%';
    el.style.top = (100 * doos.y) / H + '%';
    el.style.width = (100 * doos.width) / W + '%';
    el.style.height = (100 * doos.height) / H + '%';
    el.style.transformOrigin = '0 0';
    el.style.transform = 'none';
    textLayer.appendChild(el);
    return;
  }

  if (!result.items || result.items.length === 0) return;

  for (const item of result.items) {
    if (!item.transform) continue; // synthetic (Add Text) items carry no geometry

    const startInItem = Math.max(0, result.startPos - item.startPos);
    const endInItem = Math.min(item.str.length, result.endPos - item.startPos);
    if (endInItem <= startInItem) continue;

    const [fracStart, fracEnd] = matchFractions(item.str, startInItem, endInItem, textMeasurer(item));
    const box = matchBoxInPageFrame(item.transform, item.width, item.height, fracStart, fracEnd, view);
    if (!box) continue;
    const pct = boxToLayerPercent(box, view);

    const highlight = maakMarkering(result, isCurrent);
    highlight.style.left = pct.left + '%';
    highlight.style.top = pct.top + '%';
    highlight.style.width = pct.width + '%';
    highlight.style.height = pct.height + '%';
    // Inline transform: the layer's generic span rule would otherwise apply
    // its scale/rotate variables to this div as well.
    highlight.style.transformOrigin = '0 0';
    highlight.style.transform = pct.angle ? `rotate(${pct.angle}rad)` : 'none';
    textLayer.appendChild(highlight);
  }
}

/** De tekstlaag van een pagina in de huidige weergave. */
function tekstlaagVanPagina(pageNum, doc) {
  if (doc?.viewMode === 'continuous') {
    const wrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
    return wrapper?.querySelector('.textLayer') || null;
  }
  if (doc && doc.currentPage !== pageNum) return null;
  // Scoped: the hidden continuous layers stay in the DOM after a view switch.
  return document.querySelector('#canvas-container .textLayer');
}

/** Leeg markeringselement met de juiste klassen. */
function maakMarkering(result, isCurrent) {
  const el = document.createElement('div');
  el.className = 'search-highlight' + (isCurrent ? ' current' : '');
  el.dataset.resultIndex = result.index;
  return el;
}

// Share of a partial match within its run, measured in the run's (generic)
// font family instead of by character count.
let _measureCtx = null;
function textMeasurer(item) {
  if (typeof document === 'undefined') return null;
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  if (!_measureCtx) return null;
  const family = item.fontFamily || 'sans-serif';
  return (str) => {
    _measureCtx.font = `100px ${family}`;
    return _measureCtx.measureText(str).width;
  };
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

/**
 * De resultatenlijst onder de zoekbalk: treffers per pagina plus de pagina van
 * de huidige treffer. Wordt ook tijdens de progressieve zoektocht bijgewerkt,
 * zodat de lijst meegroeit.
 */
function publiceerResultatenlijst() {
  const { results, currentIndex } = state.search;
  setResultGroups(groepeerPerPagina(results));
  const huidig = results[currentIndex];
  setCurrentResultPage(huidig ? huidig.pageNum : 0);
}

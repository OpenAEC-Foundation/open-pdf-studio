import { state, getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { isTauri, saveFileDialog, writeBinaryFile, openExternal } from '../../core/platform.js';
import { setGroups, setCountText, setEmptyMessage, setSelectedIndex, setToolbarDisabled } from '../../solid/stores/panels/linksStore.js';

// State
let allLinks = [];          // Full list of parsed link objects
let selectedLinkIndex = -1; // Index into allLinks

const HIGHLIGHT_LABELS = {
  N: 'None',
  I: 'Invert',
  O: 'Outline',
  P: 'Inset'
};

const BORDER_STYLE_LABELS = {
  S: 'Solid',
  D: 'Dashed',
  B: 'Beveled',
  I: 'Inset',
  U: 'Underline'
};

// --- Init (no-op, kept for caller compatibility) ---

export function initLinks() {
  return;
}

// --- Selection ---

function getSelectedLink() {
  if (selectedLinkIndex >= 0 && selectedLinkIndex < allLinks.length) {
    return allLinks[selectedLinkIndex];
  }
  return null;
}

export function selectLink(index) {
  selectedLinkIndex = index;
  setSelectedIndex(index);
  updateToolbarState();
}

function updateToolbarState() {
  const link = getSelectedLink();
  const hasSelection = !!link;
  const isExternal = hasSelection && !!link.url;

  setToolbarDisabled({
    goto: !hasSelection,
    open: !isExternal,
    copy: !hasSelection,
    export: allLinks.length === 0
  });
}

// --- Link parsing ---

function colorArrayToCSS(color) {
  if (!color) return null;
  if (Array.isArray(color)) {
    if (color.length === 3) {
      return `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;
    }
  }
  return null;
}

function getHighlightLabel(mode) {
  return HIGHLIGHT_LABELS[mode] || mode || '';
}

function getBorderStyleLabel(style) {
  return BORDER_STYLE_LABELS[style] || style || '';
}

async function scanAllLinks(pdfDoc) {
  const links = [];
  const numPages = pdfDoc.numPages;

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const annotations = await page.getAnnotations();

    for (const annot of annotations) {
      if (annot.subtype !== 'Link') continue;

      const linkInfo = {
        sourcePage: i,
        url: null,
        destPage: null,
        destName: null,
        rect: annot.rect || null,
        borderColor: colorArrayToCSS(annot.color),
        borderWidth: annot.borderStyle?.width ?? null,
        borderStyle: annot.borderStyle?.style !== undefined ? getBorderStyleLabel(String(annot.borderStyle.style)) : null,
        highlightMode: getHighlightLabel(annot.annotationFlags?.highlight || annot.highlight),
      };

      // External URL
      if (annot.url) {
        linkInfo.url = annot.url;
      }
      // Internal destination (explicit)
      else if (annot.dest) {
        if (Array.isArray(annot.dest) && annot.dest[0]) {
          try {
            const pageRef = annot.dest[0];
            if (pageRef.num !== undefined) {
              const pageIndex = await pdfDoc.getPageIndex(pageRef);
              linkInfo.destPage = pageIndex + 1;
            }
          } catch {
            // Could not resolve page ref
          }
        } else if (typeof annot.dest === 'string') {
          linkInfo.destName = annot.dest;
        }
      }

      links.push(linkInfo);
    }
  }

  return links;
}

// --- Label helpers ---

function getLinkLabel(link) {
  if (link.url) return link.url;
  if (link.destPage !== null) return `Go to Page ${link.destPage}`;
  if (link.destName) return `Destination: ${link.destName}`;
  return 'Internal Link';
}

function getLinkType(link) {
  if (link.url) return 'URL';
  if (link.destPage !== null) return 'Page Link';
  if (link.destName) return 'Named Dest';
  return 'Link';
}

// --- Filtering & store push ---

export function filterLinks(filterValue) {
  const currentPage = state.currentPage;

  const filtered = allLinks.filter(link => {
    if (filterValue === 'current') return link.sourcePage === currentPage;
    if (filterValue === 'external') return !!link.url;
    if (filterValue === 'internal') return !link.url;
    return true;
  });

  if (filtered.length === 0) {
    let msg = 'No links in this document';
    if (filterValue === 'current') msg = 'No links on current page';
    else if (filterValue === 'external') msg = 'No external links';
    else if (filterValue === 'internal') msg = 'No internal links';

    setGroups([]);
    setCountText(`0 of ${allLinks.length} links`);
    setEmptyMessage(msg);
    selectedLinkIndex = -1;
    setSelectedIndex(-1);
    updateToolbarState();
    return;
  }

  // Group by page
  const linksByPage = new Map();
  for (const link of filtered) {
    if (!linksByPage.has(link.sourcePage)) {
      linksByPage.set(link.sourcePage, []);
    }
    linksByPage.get(link.sourcePage).push(link);
  }

  const sortedPages = [...linksByPage.keys()].sort((a, b) => a - b);

  const groupsArray = sortedPages.map(pageNum => {
    const pageLinks = linksByPage.get(pageNum);

    const items = pageLinks.map(link => {
      const globalIndex = allLinks.indexOf(link);
      const isExternal = !!link.url;

      const appearanceParts = [];
      if (link.borderStyle) appearanceParts.push(link.borderStyle);
      if (link.borderWidth !== null && link.borderWidth > 0) appearanceParts.push(`${link.borderWidth}px`);
      if (link.highlightMode) appearanceParts.push(link.highlightMode);

      const hasAppearance = appearanceParts.length > 0 || !!link.borderColor;

      return {
        globalIndex,
        isExternal,
        label: getLinkLabel(link),
        detail: `Page ${link.sourcePage} \u00B7 ${getLinkType(link)}`,
        borderColor: link.borderColor || null,
        appearance: hasAppearance,
        appearanceText: appearanceParts.length > 0 ? appearanceParts.join(' \u00B7 ') : ''
      };
    });

    return { pageNum, items };
  });

  setGroups(groupsArray);
  setEmptyMessage('');

  // Count text
  if (filtered.length === allLinks.length) {
    setCountText(`${allLinks.length} link${allLinks.length !== 1 ? 's' : ''}`);
  } else {
    setCountText(`${filtered.length} of ${allLinks.length} links`);
  }

  // Preserve or reset selection
  if (selectedLinkIndex >= 0 && !filtered.includes(allLinks[selectedLinkIndex])) {
    selectedLinkIndex = -1;
    setSelectedIndex(-1);
  }
  updateToolbarState();
}

// --- Navigation helpers ---

export async function navigateToLink(index) {
  if (index < 0 || index >= allLinks.length) return;
  const link = allLinks[index];
  const isExternal = !!link.url;

  if (isExternal && link.url) {
    openExternal(link.url);
  } else if (link.destPage !== null) {
    goToPage(link.destPage);
  } else if (link.destName) {
    const activeDoc = getActiveDocument();
    const pdfDoc = activeDoc?.pdfDoc;
    if (pdfDoc) {
      try {
        const dest = await pdfDoc.getDestination(link.destName);
        if (dest && Array.isArray(dest) && dest[0]) {
          const pageIndex = await pdfDoc.getPageIndex(dest[0]);
          goToPage(pageIndex + 1);
        }
      } catch (e) {
        console.warn('Failed to resolve named destination:', e);
      }
    }
  } else {
    goToPage(link.sourcePage);
  }
}

export function gotoSelectedLink() {
  const link = getSelectedLink();
  if (link) goToPage(link.sourcePage);
}

export function openSelectedLink() {
  const link = getSelectedLink();
  if (link && link.url) {
    openExternal(link.url);
  }
}

export async function copySelectedLink() {
  const link = getSelectedLink();
  if (!link) return;
  const text = link.url || (link.destPage !== null ? `Page ${link.destPage}` : link.destName || '');
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }
}

// --- Export to CSV ---

export async function exportLinksToCSV() {
  if (allLinks.length === 0) return;

  const rows = [['Page', 'Type', 'URL / Destination', 'Border Color', 'Border Style', 'Border Width', 'Highlight']];

  for (const link of allLinks) {
    rows.push([
      link.sourcePage,
      getLinkType(link),
      link.url || (link.destPage !== null ? `Page ${link.destPage}` : link.destName || ''),
      link.borderColor || '',
      link.borderStyle || '',
      link.borderWidth !== null ? link.borderWidth : '',
      link.highlightMode || ''
    ]);
  }

  const csv = rows.map(row =>
    row.map(cell => {
      const str = String(cell);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  ).join('\n');

  if (isTauri()) {
    try {
      const savePath = await saveFileDialog('links.csv', [{ name: 'CSV Files', extensions: ['csv'] }]);
      if (savePath) {
        const encoder = new TextEncoder();
        await writeBinaryFile(savePath, encoder.encode(csv));
      }
    } catch (e) {
      console.warn('Failed to save CSV:', e);
    }
  } else {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'links.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// --- Main update ---

export async function updateLinksList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    allLinks = [];
    selectedLinkIndex = -1;
    setSelectedIndex(-1);
    setGroups([]);
    setCountText('0 links');
    setEmptyMessage('No document open');
    updateToolbarState();
    return;
  }

  setGroups([]);
  setEmptyMessage('Loading...');
  setCountText('0 links');
  selectedLinkIndex = -1;
  setSelectedIndex(-1);
  updateToolbarState();

  try {
    allLinks = await scanAllLinks(activeDoc.pdfDoc);
    filterLinks('all');
  } catch (e) {
    console.warn('Failed to load links:', e);
    allLinks = [];
    setGroups([]);
    setCountText('0 links');
    setEmptyMessage('Could not load links');
    updateToolbarState();
  }
}

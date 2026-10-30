import { heeftEigenLabel, labelVan, normaliseerLabels } from './pagina-labels.js';
import { boomVolgorde } from '../ui/panels/bladwijzer-boom.js';

// The deepest destination wins; tree order breaks ties, including collapsed
// branches. Ignore malformed destinations and cyclic/unreachable bookmarks.
export function bookmarksByPage(bookmarks, pageCount) {
  const byId = new Map(bookmarks.map(b => [b.id, b]));
  const chosen = new Map();
  for (const id of boomVolgorde(bookmarks)) {
    const b = byId.get(id);
    if (!Number.isInteger(b.page) || b.page < 1 || b.page > pageCount) continue;
    let depth = 0; let parent = byId.get(b.parentId); const seen = new Set([id]);
    while (parent && !seen.has(parent.id)) { seen.add(parent.id); depth++; parent = byId.get(parent.parentId); }
    if (!chosen.has(b.page) || depth > chosen.get(b.page).depth) chosen.set(b.page, { bookmark: b, depth });
  }
  return new Map([...chosen].map(([page, value]) => [page, value.bookmark]));
}

export function previewBookmarkNames(bookmarks, labels, pageCount, direction) {
  const chosen = bookmarksByPage(bookmarks, pageCount);
  const rows = [];
  for (let page = 1; page <= pageCount; page++) {
    const b = chosen.get(page);
    if (direction === 'bookmarks') {
      if (heeftEigenLabel(labels, page)) rows.push({ page, title: labelVan(labels, page), bookmarkId: b?.id ?? null });
    } else if (direction === 'labels' && b) rows.push({ page, title: String(b.title ?? ''), bookmarkId: b.id });
  }
  return rows;
}

export function bookmarksFromNames(bookmarks, rows, { replace = false } = {}) {
  const result = replace ? [] : bookmarks.map(b => ({ ...b }));
  const ids = new Set(bookmarks.map(b => b.id));
  let next = 1;
  let order = result.reduce((max, b) => !b.parentId || !ids.has(b.parentId) ? Math.max(max, b.sortOrder || 0) : max, -1) + 1;
  for (const row of rows) {
    const title = String(row.title ?? '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const existing = !replace && result.find(b => b.id === row.bookmarkId && b.page === row.page);
    if (existing) { existing.title = title; continue; }
    let id;
    do { id = `bm_labels_${next++}`; } while (ids.has(id));
    ids.add(id);
    result.push({ id, title, page: row.page, parentId: null, sortOrder: order++, expanded: true });
  }
  return result;
}

export function labelsFromNames(labels, rows, pageCount) {
  const result = Array.from({ length: pageCount }, (_, i) => labelVan(labels, i + 1));
  for (const row of rows) if (Number.isInteger(row.page) && row.page >= 1 && row.page <= pageCount) result[row.page - 1] = row.title;
  return normaliseerLabels(result, pageCount);
}

export function nameSourceSnapshot(doc) {
  return JSON.stringify([doc?.pdfDoc?.numPages, doc?.bookmarks || [], doc?.pageLabels || null]);
}

import { state } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { redrawAnnotations } from './rendering.js';
import { recordAdd } from '../core/undo-manager.js';

// Apply all redaction annotations permanently (flatten them)
export function applyRedactions() {
  const redactions = state.annotations.filter(a => a.page === state.currentPage && a.type === 'redaction');
  if (redactions.length === 0) {
    alert('No redaction marks on the current page to apply.');
    return;
  }

  const count = redactions.length;
  const confirmed = confirm(
    `Apply ${count} redaction${count > 1 ? 's' : ''} on page ${state.currentPage}?\n\n` +
    'This will permanently black out the marked areas. This action cannot be undone.'
  );

  if (!confirmed) return;

  // Convert redaction marks to permanent black rectangles (type 'box' with black fill)
  for (const r of redactions) {
    const idx = state.annotations.indexOf(r);
    if (idx !== -1) {
      state.annotations.splice(idx, 1);
    }
    // Add a permanent black filled box in its place
    state.annotations.push(createAnnotation({
      type: 'box',
      page: r.page,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      color: r.overlayColor || '#000000',
      strokeColor: r.overlayColor || '#000000',
      fillColor: r.overlayColor || '#000000',
      lineWidth: 0,
      opacity: 1,
      locked: true,
      redacted: true // Mark as applied redaction
    }));
  }

  redrawAnnotations();
}

// Apply all redactions across all pages
export function applyAllRedactions() {
  const allRedactions = state.annotations.filter(a => a.type === 'redaction');
  if (allRedactions.length === 0) {
    alert('No redaction marks in the document to apply.');
    return;
  }

  const count = allRedactions.length;
  const pages = [...new Set(allRedactions.map(a => a.page))].sort((a, b) => a - b);
  const confirmed = confirm(
    `Apply ${count} redaction${count > 1 ? 's' : ''} across ${pages.length} page${pages.length > 1 ? 's' : ''}?\n\n` +
    'This will permanently black out all marked areas. This action cannot be undone.'
  );

  if (!confirmed) return;

  for (const r of allRedactions) {
    const idx = state.annotations.indexOf(r);
    if (idx !== -1) {
      state.annotations.splice(idx, 1);
    }
    state.annotations.push(createAnnotation({
      type: 'box',
      page: r.page,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      color: r.overlayColor || '#000000',
      strokeColor: r.overlayColor || '#000000',
      fillColor: r.overlayColor || '#000000',
      lineWidth: 0,
      opacity: 1,
      locked: true,
      redacted: true
    }));
  }

  redrawAnnotations();
}

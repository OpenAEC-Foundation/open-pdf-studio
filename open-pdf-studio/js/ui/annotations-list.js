import { state, isSelected } from '../core/state.js';
import { annotationsListPanel, annotationsListContent, annotationsListFilter, annotationsListCount } from './dom-elements.js';
import { getTypeDisplayName, formatDate } from '../utils/helpers.js';
import { showProperties } from './properties-panel.js';
import { goToPage } from '../pdf/renderer.js';

// Toggle annotations list panel visibility
export function toggleAnnotationsListPanel() {
  if (annotationsListPanel) {
    annotationsListPanel.classList.toggle('visible');
    if (annotationsListPanel.classList.contains('visible')) {
      updateAnnotationsList();
    }
  }
}

// Show annotations list panel
export function showAnnotationsListPanel() {
  if (annotationsListPanel) {
    annotationsListPanel.classList.add('visible');
    updateAnnotationsList();
  }
}

// Hide annotations list panel
export function hideAnnotationsListPanel() {
  if (annotationsListPanel) {
    annotationsListPanel.classList.remove('visible');
  }
}

// Update annotations list
export function updateAnnotationsList() {
  if (!annotationsListContent || !annotationsListPanel.classList.contains('visible')) return;

  // Get filter value
  const filterValue = annotationsListFilter?.value || 'all';

  // Filter annotations
  let filteredAnnotations = [...state.annotations];

  if (filterValue === 'current') {
    filteredAnnotations = filteredAnnotations.filter(a => a.page === state.currentPage);
  } else if (filterValue !== 'all') {
    filteredAnnotations = filteredAnnotations.filter(a => a.type === filterValue);
  }

  // Update count
  if (annotationsListCount) {
    annotationsListCount.textContent = `${filteredAnnotations.length} annotation${filteredAnnotations.length !== 1 ? 's' : ''}`;
  }

  // Sort by page, then by creation date
  filteredAnnotations.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  // Build list HTML
  annotationsListContent.innerHTML = '';

  if (filteredAnnotations.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'annotations-list-empty';
    emptyMsg.textContent = 'No annotations found';
    emptyMsg.style.cssText = 'padding: 20px; text-align: center; color: #888; font-style: italic;';
    annotationsListContent.appendChild(emptyMsg);
    return;
  }

  // Group by page
  const pageGroups = {};
  filteredAnnotations.forEach(ann => {
    if (!pageGroups[ann.page]) {
      pageGroups[ann.page] = [];
    }
    pageGroups[ann.page].push(ann);
  });

  // Render each page group
  Object.keys(pageGroups).sort((a, b) => a - b).forEach(pageNum => {
    const pageHeader = document.createElement('div');
    pageHeader.className = 'annotations-list-page-header';
    pageHeader.textContent = `Page ${pageNum}`;
    pageHeader.style.cssText = `
      padding: 8px 12px;
      background: #f0f0f0;
      font-weight: bold;
      font-size: 12px;
      color: #666;
      border-bottom: 1px solid #ddd;
      cursor: pointer;
    `;
    pageHeader.addEventListener('click', async () => {
      await goToPage(parseInt(pageNum));
    });
    annotationsListContent.appendChild(pageHeader);

    pageGroups[pageNum].forEach(ann => {
      const item = createAnnotationListItem(ann);
      annotationsListContent.appendChild(item);
    });
  });
}

// Create annotation list item
function createAnnotationListItem(annotation) {
  const item = document.createElement('div');
  item.className = 'annotation-list-item';
  item.style.cssText = `
    padding: 8px 12px;
    border-bottom: 1px solid #eee;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  // Color indicator
  const colorDot = document.createElement('span');
  colorDot.style.cssText = `
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background-color: ${annotation.color || annotation.strokeColor || '#000'};
    flex-shrink: 0;
    border: 1px solid rgba(0,0,0,0.2);
  `;
  item.appendChild(colorDot);

  // Content container
  const content = document.createElement('div');
  content.style.cssText = 'flex: 1; min-width: 0;';

  // Type and preview
  const typeSpan = document.createElement('div');
  typeSpan.style.cssText = 'font-weight: 500; font-size: 13px; color: #333;';
  typeSpan.textContent = getTypeDisplayName(annotation.type);
  content.appendChild(typeSpan);

  // Text preview if available
  if (annotation.text) {
    const preview = document.createElement('div');
    preview.style.cssText = 'font-size: 11px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    preview.textContent = annotation.text.substring(0, 50) + (annotation.text.length > 50 ? '...' : '');
    content.appendChild(preview);
  }

  // Author and date
  const meta = document.createElement('div');
  meta.style.cssText = 'font-size: 10px; color: #aaa;';
  meta.textContent = `${annotation.author || 'User'} - ${formatDate(annotation.modifiedAt)}`;
  content.appendChild(meta);

  item.appendChild(content);

  // Status indicator
  if (annotation.status && annotation.status !== 'none') {
    const statusColors = {
      'accepted': '#22c55e',
      'rejected': '#ef4444',
      'cancelled': '#6b7280',
      'completed': '#3b82f6',
      'reviewed': '#8b5cf6'
    };
    const statusDot = document.createElement('span');
    statusDot.style.cssText = `
      width: 8px; height: 8px; border-radius: 50%;
      background-color: ${statusColors[annotation.status] || '#888'};
      flex-shrink: 0;
    `;
    statusDot.title = annotation.status.charAt(0).toUpperCase() + annotation.status.slice(1);
    item.appendChild(statusDot);
  }

  // Reply count
  if (annotation.replies && annotation.replies.length > 0) {
    const replyBadge = document.createElement('span');
    replyBadge.style.cssText = 'font-size: 10px; color: #0078d4; flex-shrink: 0;';
    replyBadge.textContent = `${annotation.replies.length}`;
    replyBadge.title = `${annotation.replies.length} replies`;
    item.appendChild(replyBadge);
  }

  // Lock indicator
  if (annotation.locked) {
    const lockIcon = document.createElement('span');
    lockIcon.textContent = '🔒';
    lockIcon.style.cssText = 'font-size: 12px;';
    item.appendChild(lockIcon);
  }

  // Selection state
  if (isSelected(annotation)) {
    item.style.backgroundColor = '#e3f2fd';
  }

  // Click to select
  item.addEventListener('click', async () => {
    // Navigate to page if needed
    if (annotation.page !== state.currentPage) {
      await goToPage(annotation.page);
    }
    state.selectedAnnotation = annotation;
    showProperties(annotation);
    updateAnnotationsList(); // Refresh to show selection
  });

  // Hover effect
  item.addEventListener('mouseenter', () => {
    if (!isSelected(annotation)) {
      item.style.backgroundColor = '#f5f5f5';
    }
  });
  item.addEventListener('mouseleave', () => {
    if (!isSelected(annotation)) {
      item.style.backgroundColor = 'transparent';
    }
  });

  return item;
}

// Initialize annotations list panel
export function initAnnotationsList() {
  // Close button
  const closeBtn = annotationsListPanel?.querySelector('.panel-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideAnnotationsListPanel);
  }

  // Filter change
  if (annotationsListFilter) {
    annotationsListFilter.addEventListener('change', updateAnnotationsList);
  }
}

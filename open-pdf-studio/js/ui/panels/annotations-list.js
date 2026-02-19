import { state, isSelected } from '../../core/state.js';
import { getTypeDisplayName, formatDate } from '../../utils/helpers.js';
import { showProperties } from './properties-panel.js';
import { goToPage } from '../../pdf/renderer.js';
import { switchLeftPanelTab } from './left-panel.js';
import { collapsed as leftPanelCollapsed, activeTab } from '../../solid/stores/leftPanelStore.js';
import { setItems, setCountText, setEmptyMessage } from '../../solid/stores/panels/annotationsStore.js';

const statusColors = {
  'accepted': '#22c55e',
  'rejected': '#ef4444',
  'cancelled': '#6b7280',
  'completed': '#3b82f6',
  'reviewed': '#8b5cf6'
};

// Toggle annotations list panel visibility
export function toggleAnnotationsListPanel() {
  const isAnnotationsActive = activeTab() === 'annotations';

  if (isAnnotationsActive && !leftPanelCollapsed()) {
    // Already showing annotations and panel is expanded - switch to thumbnails
    switchLeftPanelTab('thumbnails');
  } else {
    // Switch to annotations tab (also expands if collapsed)
    switchLeftPanelTab('annotations');
  }
}

// Show annotations list panel
export function showAnnotationsListPanel() {
  switchLeftPanelTab('annotations');
}

// Hide annotations list panel
export function hideAnnotationsListPanel() {
  switchLeftPanelTab('thumbnails');
}

// Update annotations list - pushes data to the Solid.js store
export function updateAnnotationsList(filterValue = 'all') {
  // Filter annotations
  let filteredAnnotations = [...state.annotations];

  if (filterValue === 'current') {
    filteredAnnotations = filteredAnnotations.filter(a => a.page === state.currentPage);
  } else if (filterValue !== 'all') {
    filteredAnnotations = filteredAnnotations.filter(a => a.type === filterValue);
  }

  // Update count text
  setCountText(`${filteredAnnotations.length} annotation${filteredAnnotations.length !== 1 ? 's' : ''}`);

  // Sort by page, then by creation date
  filteredAnnotations.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  if (filteredAnnotations.length === 0) {
    setEmptyMessage('No annotations found');
    setItems([]);
    return;
  }

  // Clear empty message so the list renders
  setEmptyMessage('');

  // Group by page
  const pageGroups = {};
  filteredAnnotations.forEach(ann => {
    if (!pageGroups[ann.page]) {
      pageGroups[ann.page] = [];
    }
    pageGroups[ann.page].push(ann);
  });

  // Build flat items array for the store
  const flatItems = [];

  Object.keys(pageGroups).sort((a, b) => a - b).forEach(pageNum => {
    // Page header entry
    flatItems.push({ isHeader: true, page: parseInt(pageNum) });

    // Annotation item entries
    pageGroups[pageNum].forEach(ann => {
      const hasStatus = ann.status && ann.status !== 'none';
      const replyCount = (ann.replies && ann.replies.length) || 0;

      flatItems.push({
        isHeader: false,
        id: ann.id,
        page: ann.page,
        type: ann.type,
        typeLabel: getTypeDisplayName(ann.type),
        color: ann.color || ann.strokeColor || '#000',
        text: ann.text ? ann.text.substring(0, 50) + (ann.text.length > 50 ? '...' : '') : null,
        meta: `${ann.author || 'User'} - ${formatDate(ann.modifiedAt)}`,
        statusColor: hasStatus ? (statusColors[ann.status] || '#888') : null,
        statusTitle: hasStatus ? ann.status.charAt(0).toUpperCase() + ann.status.slice(1) : null,
        replyCount,
        selected: isSelected(ann)
      });
    });
  });

  setItems(flatItems);
}

// Select an annotation item - navigates to its page and selects it
export async function selectAnnotationItem(id, page) {
  const annotation = state.annotations.find(a => a.id === id);
  if (!annotation) return;

  if (annotation.page !== state.currentPage) {
    await goToPage(annotation.page);
  }
  state.selectedAnnotation = annotation;
  showProperties(annotation);
  updateAnnotationsList();
}

// Initialize annotations list panel (no-op, filter is handled by the component)
export function initAnnotationsList() {
}

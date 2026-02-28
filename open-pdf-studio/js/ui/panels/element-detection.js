import { state } from '../../core/state.js';
import { detectElements, clearDetectionCache } from '../../tools/pdf-element-detector.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import {
  setWalls, setRooms, setGrids,
  setIsDetecting, setDetectedPage,
  setShowWalls, setShowRooms, setShowGrids,
  setSelectedElement,
  setCountText, setEmptyMessage,
  setFilteredStats,
} from '../../solid/stores/panels/elementDetectionStore.js';

/**
 * Run element detection on the current page.
 * Called from the Detect button in the panel.
 */
export async function runDetection() {
  const pageNum = state.currentPage;
  if (!state.pdfDoc || !pageNum) return;

  setIsDetecting(true);
  setEmptyMessage(null);
  setSelectedElement(null);

  try {
    const result = await detectElements(pageNum);

    setWalls(result.walls);
    setRooms(result.rooms);
    setGrids(result.grids);
    setFilteredStats(result.filteredStats || null);
    setDetectedPage(pageNum);

    const total = result.walls.length + result.rooms.length + result.grids.length;
    setCountText(`${total} element${total !== 1 ? 's' : ''} detected`);

    if (total === 0) {
      setEmptyMessage('No walls or rooms detected on this page');
    }

    // Trigger canvas redraw to show overlay
    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  } catch (e) {
    console.warn('Element detection failed:', e);
    setEmptyMessage('Detection failed');
    setWalls([]);
    setRooms([]);
  } finally {
    setIsDetecting(false);
  }
}

/**
 * Clear detection results and cache.
 */
export function clearDetection() {
  setWalls([]);
  setRooms([]);
  setGrids([]);
  setFilteredStats(null);
  setDetectedPage(null);
  setSelectedElement(null);
  setCountText('0 elements');
  setEmptyMessage('Click "Detect" to find walls and rooms');
  clearDetectionCache();

  // Trigger canvas redraw to remove overlay
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

/**
 * Toggle visibility of a specific element type and redraw canvas.
 */
export function toggleTypeVisibility(type, value) {
  const setters = { walls: setShowWalls, rooms: setShowRooms, grids: setShowGrids };
  const setter = setters[type];
  if (setter) setter(value);
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

/**
 * Select/deselect an element and redraw canvas to show highlight.
 */
export function selectElement(element) {
  setSelectedElement(prev => prev?.id === element.id ? null : element);
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

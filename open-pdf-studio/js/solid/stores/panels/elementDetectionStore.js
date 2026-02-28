import { createSignal } from 'solid-js';

const [walls, setWalls] = createSignal([]);
const [rooms, setRooms] = createSignal([]);
const [grids, setGrids] = createSignal([]);
const [isDetecting, setIsDetecting] = createSignal(false);
const [detectedPage, setDetectedPage] = createSignal(null);
const [showWalls, setShowWalls] = createSignal(true);
const [showRooms, setShowRooms] = createSignal(true);
const [showGrids, setShowGrids] = createSignal(true);
const [selectedElement, setSelectedElement] = createSignal(null);
const [countText, setCountText] = createSignal('0 elements');
const [emptyMessage, setEmptyMessage] = createSignal('Click "Detect" to find walls and rooms');
const [filteredStats, setFilteredStats] = createSignal(null);

export {
  walls, setWalls,
  rooms, setRooms,
  grids, setGrids,
  isDetecting, setIsDetecting,
  detectedPage, setDetectedPage,
  showWalls, setShowWalls,
  showRooms, setShowRooms,
  showGrids, setShowGrids,
  selectedElement, setSelectedElement,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  filteredStats, setFilteredStats,
};

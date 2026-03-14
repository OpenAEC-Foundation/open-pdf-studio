import { createSignal } from 'solid-js';

const [pdfObjects, setPdfObjects] = createSignal([]);
const [selectedPdfObject, setSelectedPdfObject] = createSignal(null);
const [selectedPdfObjects, setSelectedPdfObjects] = createSignal([]);
const [hoveredPdfObject, setHoveredPdfObject] = createSignal(null);
const [isExtracting, setIsExtracting] = createSignal(false);
const [extractedPage, setExtractedPage] = createSignal(null);
const [showImages, setShowImages] = createSignal(true);
const [showText, setShowText] = createSignal(true);
const [showVectors, setShowVectors] = createSignal(true);
const [isDraggingObject, setIsDraggingObject] = createSignal(false);
const [dragPreview, setDragPreview] = createSignal(null);

export {
  pdfObjects, setPdfObjects,
  selectedPdfObject, setSelectedPdfObject,
  selectedPdfObjects, setSelectedPdfObjects,
  hoveredPdfObject, setHoveredPdfObject,
  isExtracting, setIsExtracting,
  extractedPage, setExtractedPage,
  showImages, setShowImages,
  showText, setShowText,
  showVectors, setShowVectors,
  isDraggingObject, setIsDraggingObject,
  dragPreview, setDragPreview,
};

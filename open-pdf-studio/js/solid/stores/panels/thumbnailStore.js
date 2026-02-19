import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

const [pageCount, setPageCount] = createSignal(0);
const [activePage, setActivePage] = createSignal(1);
const [placeholderSize, setPlaceholderSize] = createSignal({ width: 150, height: 212 });

// Map of pageNum -> dataURL for rendered thumbnails
const [thumbnailData, setThumbnailData] = createStore({});

// Drag state
const [draggedPage, setDraggedPage] = createSignal(null);
const [dropTarget, setDropTarget] = createSignal(null); // { page, position: 'before'|'after' }

export function setThumbnailImage(pageNum, imageData) {
  setThumbnailData(String(pageNum), imageData);
}

export function clearAllThumbnails() {
  setThumbnailData(reconcile({}));
  setPageCount(0);
}

export function removeThumbnailImage(pageNum) {
  setThumbnailData(String(pageNum), undefined);
}

export {
  pageCount, setPageCount,
  activePage, setActivePage,
  placeholderSize, setPlaceholderSize,
  thumbnailData,
  draggedPage, setDraggedPage,
  dropTarget, setDropTarget
};

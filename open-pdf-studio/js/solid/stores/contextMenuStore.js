import { createSignal } from 'solid-js';

const [visible, setVisible] = createSignal(false);
const [menuType, setMenuType] = createSignal('annotation');
const [position, setPosition] = createSignal({ x: 0, y: 0 });
const [targetAnnotation, setTargetAnnotation] = createSignal(null);
const [multiSelectCount, setMultiSelectCount] = createSignal(0);
const [targetPage, setTargetPage] = createSignal(null);

export function showAnnotationMenu(x, y, annotation) {
  setTargetAnnotation(annotation);
  setMenuType('annotation');
  setPosition({ x, y });
  setVisible(true);
}

export function showMultiAnnotationMenu(x, y, count) {
  setMultiSelectCount(count);
  setMenuType('annotationMulti');
  setPosition({ x, y });
  setVisible(true);
}

export function showPageMenu(x, y) {
  setMenuType('page');
  setPosition({ x, y });
  setVisible(true);
}

export function showTextSelectionMenu(x, y) {
  setMenuType('textSelection');
  setPosition({ x, y });
  setVisible(true);
}

export function showBookmarkMenu(x, y) {
  setMenuType('bookmark');
  setPosition({ x, y });
  setVisible(true);
}

export function showThumbnailMenu(x, y, pageNum) {
  setTargetPage(pageNum);
  setMenuType('thumbnail');
  setPosition({ x, y });
  setVisible(true);
}

export function hideMenu() {
  setVisible(false);
}

export {
  visible, menuType, position, targetAnnotation, multiSelectCount, targetPage
};

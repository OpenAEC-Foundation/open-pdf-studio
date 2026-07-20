import { For, Show, onMount, onCleanup, createSignal, createEffect } from 'solid-js';
import { getOpenPopups, closeStickyPopup, updatePopupText, updatePopupPosition } from '../stores/stickyNotePopupStore.js';
import { showAnnotationMenu } from '../stores/contextMenuStore.js';
import { storeShowProperties, updateAnnotProp } from '../stores/propertiesStore.js';
import { state, getActiveDocument } from '../../core/state.js';
import { annotationCanvas } from '../../ui/dom-elements.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordModify } from '../../core/undo-manager.js';

// Icon name to label mapping
const ICON_LABELS = {
  comment: 'Comment', note: 'Note', help: 'Help',
  insert: 'Insert Text', key: 'Key', newparagraph: 'New Paragraph',
  paragraph: 'Paragraph', check: 'Check', circle: 'Circle',
  cross: 'Cross', star: 'Star'
};

function lighten(hex, amount = 0.85) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r + (255 - r) * amount)},${Math.round(g + (255 - g) * amount)},${Math.round(b + (255 - b) * amount)})`;
}

function darken(hex, amount = 0.15) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 1 - amount;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

function StickyNotePopup(props) {
  let headerRef;
  let textareaRef;
  let popupRef;
  const [dragging, setDragging] = createSignal(false);
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });
  const [localPos, setLocalPos] = createSignal({ x: 0, y: 0 });
  const initW = props.entry.annotation?.popupWidth || 230;
  const initH = props.entry.annotation?.popupHeight || 150;
  const [size, setSize] = createSignal({ w: initW, h: initH });
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(true); // starts focused on mount
  const [locked, setLocked] = createSignal(props.entry.annotation?.locked || false);

  const ann = () => props.entry.annotation;
  const isActive = () => hovered() || focused() || dragging();

  // Calculate initial position
  createEffect(() => {
    const a = ann();
    if (!a) return;
    const canvas = annotationCanvas || document.getElementById('annotation-canvas');
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const scale = state.documents?.[state.activeDocumentIndex]?.scale || 1.5;

    const px = a.popupX !== undefined ? a.popupX : a.x + 30;
    const py = a.popupY !== undefined ? a.popupY : a.y;

    setLocalPos({
      x: canvasRect.left + px * scale,
      y: canvasRect.top + py * scale
    });
  });

  // Sync active state to annotation for canvas leader rendering
  createEffect(() => {
    const active = isActive();
    const a = ann();
    if (a) {
      a._popupFocused = active;
      if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
      else redrawAnnotations(true);
    }
  });

  const handleOutsideClick = (e) => {
    if (popupRef && !popupRef.contains(e.target)) {
      setFocused(false);
      if (textareaRef) textareaRef.blur();
    }
  };

  onMount(() => {
    if (textareaRef) {
      textareaRef.focus();
    }
    document.addEventListener('mousedown', handleOutsideClick);
  });

  onCleanup(() => {
    document.removeEventListener('mousedown', handleOutsideClick);
    const a = ann();
    if (a) a._popupFocused = false;
  });

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const before = cloneAnnotation(ann());
    setDragging(true);
    const pos = localPos();
    setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });

    const handleMouseMove = (e) => {
      if (!dragging()) return;
      const newPos = {
        x: e.clientX - dragOffset().x,
        y: e.clientY - dragOffset().y
      };
      setLocalPos(newPos);

      // Update annotation position live so leader line follows during drag
      const canvas = annotationCanvas || document.getElementById('annotation-canvas');
      if (canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        const scale = state.documents?.[state.activeDocumentIndex]?.scale || 1.5;
        updatePopupPosition(
          ann().id,
          (newPos.x - canvasRect.left) / scale,
          (newPos.y - canvasRect.top) / scale
        );
        if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
        else redrawAnnotations(true);
      }
    };

    const handleMouseUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      const a = ann();
      if (a && (a.popupX !== before.popupX || a.popupY !== before.popupY)) {
        a.modifiedAt = new Date().toISOString();
        recordModify(a.id, before, a);
      }

      // Final redraw (non-lightweight)
      if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
      else redrawAnnotations();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Resize from any edge or corner
  const handleEdgeResize = (edge, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startSize = size();
    const startPos = localPos();
    const before = cloneAnnotation(ann());
    let resized = false;

    const handleMouseMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newW = startSize.w, newH = startSize.h;
      let newX = startPos.x, newY = startPos.y;

      if (edge.includes('r')) newW = Math.max(160, startSize.w + dx);
      if (edge.includes('b')) newH = Math.max(100, startSize.h + dy);
      if (edge.includes('l')) {
        newW = Math.max(160, startSize.w - dx);
        if (newW > 160) newX = startPos.x + dx;
      }
      if (edge.includes('t')) {
        newH = Math.max(100, startSize.h - dy);
        if (newH > 100) newY = startPos.y + dy;
      }

      setSize({ w: newW, h: newH });
      setLocalPos({ x: newX, y: newY });
      resized = newW !== startSize.w || newH !== startSize.h ||
        newX !== startPos.x || newY !== startPos.y;
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Save dimensions to annotation for next open
      const s = size();
      const a = ann();
      if (a && resized) {
        a.popupWidth = s.w;
        a.popupHeight = s.h;
        a.modifiedAt = new Date().toISOString();
        recordModify(a.id, before, a);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeStickyPopup(ann().id);
    }
    // Prevent keyboard shortcuts while typing
    e.stopPropagation();
  };

  const handleInput = (e) => {
    updatePopupText(ann().id, e.target.value);
  };

  const handleClose = () => {
    closeStickyPopup(ann().id);
    if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();
  };

  const accentColor = () => ann()?.color || ann()?.fillColor || '#FFFF00';
  const bgColor = () => lighten(accentColor(), 0.85);
  const headerBg = () => accentColor();
  const borderColor = () => darken(accentColor(), 0.3);

  const iconLabel = () => ICON_LABELS[(ann()?.icon || 'comment').toLowerCase()] || 'Note';

  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mon = months[d.getMonth()];
      const yr = String(d.getFullYear()).slice(-2);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${day}-${mon}-${yr}, ${h}:${m}:${s}`;
    } catch {
      return '';
    }
  };

  return (
    <div
      ref={popupRef}
      class="sticky-popup"
      style={{
        left: `${localPos().x}px`,
        top: `${localPos().y}px`,
        width: `${size().w}px`,
        height: `${size().h}px`,
        'border-color': borderColor(),
        background: headerBg(),
        opacity: isActive() ? 1 : 0.75
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        const a = ann();
        if (a) {
          const _d = getActiveDocument();
          if (_d) { _d.selectedAnnotations = [a]; _d.selectedAnnotation = a; }
          storeShowProperties(a);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusIn={() => setFocused(true)}
      onFocusOut={() => setFocused(false)}
    >
      <div
        class="sticky-popup-header"
        ref={headerRef}
        style={{ background: headerBg(), 'border-color': borderColor() }}
        onMouseDown={handleMouseDown}
      >
        <div class="sticky-popup-title-row">
          <span class="sticky-popup-label">
            <b>{iconLabel()}</b> - [{ann()?.author || 'User'}]
          </span>
          <span class="sticky-popup-date">
            {formatDate(ann()?.modifiedAt || ann()?.createdAt)}
          </span>
        </div>
        <button class="sticky-popup-close" onClick={handleClose}>&times;</button>
      </div>
      <textarea
        ref={textareaRef}
        class="sticky-popup-textarea"
        dir="auto"
        style={{ background: bgColor() }}
        value={ann()?.text || ''}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />
      <div class="sticky-popup-footer" style={{ background: headerBg(), 'border-color': borderColor() }}>
        <div class="sticky-popup-footer-left">
          <button
            class="sticky-popup-menu-btn"
            title="Options"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const _d2 = getActiveDocument();
              if (_d2) { _d2.selectedAnnotations = [ann()]; _d2.selectedAnnotation = ann(); }
              showAnnotationMenu(rect.left, rect.top - 4, ann());
            }}
          >&#8230;</button>
          <button
            class="sticky-popup-lock-btn"
            title={locked() ? 'Locked' : 'Unlocked'}
            onClick={(e) => {
              e.stopPropagation();
              const a = ann();
              if (!a) return;
              const newVal = !a.locked;
              // Update via properties store for undo support + panel sync
              const _d3 = getActiveDocument();
              if (_d3) { _d3.selectedAnnotations = [a]; _d3.selectedAnnotation = a; }
              storeShowProperties(a);
              updateAnnotProp('locked', newVal);
              setLocked(newVal);
            }}
          >{locked() ? '\u{1F512}' : '\u{1F513}'}</button>
        </div>
        <button class="sticky-popup-reply-btn" style={{ 'border-color': borderColor() }}>Reply</button>
      </div>
      {/* Edge resize handles */}
      <div class="sticky-popup-edge edge-t" onMouseDown={(e) => handleEdgeResize('t', e)} />
      <div class="sticky-popup-edge edge-b" onMouseDown={(e) => handleEdgeResize('b', e)} />
      <div class="sticky-popup-edge edge-l" onMouseDown={(e) => handleEdgeResize('l', e)} />
      <div class="sticky-popup-edge edge-r" onMouseDown={(e) => handleEdgeResize('r', e)} />
      <div class="sticky-popup-edge edge-tl" onMouseDown={(e) => handleEdgeResize('tl', e)} />
      <div class="sticky-popup-edge edge-tr" onMouseDown={(e) => handleEdgeResize('tr', e)} />
      <div class="sticky-popup-edge edge-bl" onMouseDown={(e) => handleEdgeResize('bl', e)} />
      <div class="sticky-popup-edge edge-br" onMouseDown={(e) => handleEdgeResize('br', e)} />
    </div>
  );
}

export default function StickyNotePopupHost() {
  return (
    <For each={getOpenPopups()}>
      {(entry) => <StickyNotePopup entry={entry} />}
    </For>
  );
}

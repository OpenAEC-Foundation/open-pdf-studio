import { Show, createSignal, createEffect } from 'solid-js';

// Drag-draw overlay for the Straighten (deskew) tool (tools/straighten-select.js).
// The user drags along a feature on the page that SHOULD be perfectly
// horizontal or vertical (a ruled line, a table edge); releasing freezes the
// guide line in place (drag again to redraw it) and Enter opens the confirm
// dialog — same "review before it happens" pattern as the freeform crop
// tool's CropSelectOverlay, since this is a page-structure edit, not
// something to apply the instant the mouse lifts.
export default function StraightenOverlay(props) {
  let overlayRef;
  let isDragging = false;

  const [line, setLine] = createSignal(null); // { x1, y1, x2, y2 } in overlay-local CSS px

  const isValidLine = () => {
    const l = line();
    if (!l) return false;
    const dx = l.x2 - l.x1;
    const dy = l.y2 - l.y1;
    return Math.hypot(dx, dy) > 10;
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    overlayRef.focus();
    const rect = overlayRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setLine({ x1: x, y1: y, x2: x, y2: y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const rect = overlayRef.getBoundingClientRect();
    setLine((prev) => prev && ({ ...prev, x2: e.clientX - rect.left, y2: e.clientY - rect.top }));
  };

  const handleMouseUp = () => {
    isDragging = false;
  };

  const confirm = (applyTo) => {
    if (!isValidLine()) return;
    const l = line();
    props.onConfirm?.(l, applyTo);
  };

  const cancel = () => {
    props.onCancel?.();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Shift+Enter skips the Apply-to dropdown and straightens every page
      // immediately — the common case when a whole batch was scanned on the
      // same crooked feeder.
      confirm(e.shiftKey ? 'all' : 'current');
    } else if (e.key === 'Escape') {
      cancel();
    }
  };

  createEffect(() => {
    if (overlayRef) overlayRef.focus();
  });

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        'z-index': '500',
        'pointer-events': 'auto',
        cursor: 'crosshair',
        'user-select': 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDblClick={confirm}
      onKeyDown={handleKeyDown}
      tabIndex="-1"
    >
      <div style={{
        position: 'absolute',
        top: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.75)',
        color: 'white',
        padding: '6px 14px',
        'font-size': '12px',
        'z-index': '501',
        'pointer-events': 'none',
        'white-space': 'nowrap',
      }}>
        {isValidLine()
          ? props.confirmHint || 'Enter: straighten this page · Shift+Enter: straighten all pages · Esc: cancel. Drag again to redraw the line.'
          : props.drawHint || 'Drag along a line that should be horizontal or vertical. Press Esc to cancel.'}
      </div>
      <Show when={line()}>
        {(l) => (
          <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 'pointer-events': 'none' }}>
            <line x1={l().x1} y1={l().y1} x2={l().x2} y2={l().y2} stroke="#0078d7" stroke-width="2" stroke-dasharray="6 4" />
            <circle cx={l().x1} cy={l().y1} r="4" fill="#0078d7" />
            <circle cx={l().x2} cy={l().y2} r="4" fill="#0078d7" />
          </svg>
        )}
      </Show>
    </div>
  );
}

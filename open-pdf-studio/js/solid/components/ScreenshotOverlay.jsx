import { Show, createEffect, onCleanup } from 'solid-js';
import { active, selectionRect, setSelectionRect, onComplete, onCancel, endScreenshot } from '../stores/screenshotStore.js';

export default function ScreenshotOverlay() {
  let overlayRef;
  let isDragging = false;
  let startX = 0, startY = 0;

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    const rect = overlayRef.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    setSelectionRect({ left: startX, top: startY, width: 0, height: 0 });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const rect = overlayRef.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    setSelectionRect({
      left: Math.min(startX, curX),
      top: Math.min(startY, curY),
      width: Math.abs(curX - startX),
      height: Math.abs(curY - startY)
    });
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    const sel = selectionRect();
    if (sel && sel.width > 5 && sel.height > 5) {
      const completeFn = onComplete();
      if (completeFn) completeFn(sel);
    }
    endScreenshot();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      const cancelFn = onCancel();
      if (cancelFn) cancelFn();
      endScreenshot();
    }
  };

  // Focus the overlay when it becomes active so it receives keyboard events
  createEffect(() => {
    if (active() && overlayRef) {
      overlayRef.focus();
    }
  });

  return (
    <Show when={active()}>
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          'z-index': '500',
          cursor: 'crosshair',
          'user-select': 'none'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        tabIndex="-1"
      >
        <Show when={!selectionRect()}>
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
            'white-space': 'nowrap'
          }}>
            Click and drag to select region. Press Esc to cancel.
          </div>
        </Show>
        <Show when={selectionRect()}>
          {(rect) => (
            <div style={{
              position: 'absolute',
              left: rect().left + 'px',
              top: rect().top + 'px',
              width: rect().width + 'px',
              height: rect().height + 'px',
              border: '2px dashed #0078d7',
              background: 'rgba(0, 120, 215, 0.1)',
              'pointer-events': 'none'
            }} />
          )}
        </Show>
      </div>
    </Show>
  );
}

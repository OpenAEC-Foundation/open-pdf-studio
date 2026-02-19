import { onMount, onCleanup } from 'solid-js';

export default function Dialog(props) {
  let overlayRef;
  let dialogRef;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function onHeaderMouseDown(e) {
    if (e.target.closest('.modal-close-btn')) return;
    isDragging = true;
    const rect = dialogRef.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const overlayRect = overlayRef.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;
    const dialogRect = dialogRef.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, overlayRect.width - dialogRect.width));
    newY = Math.max(0, Math.min(newY, overlayRect.height - dialogRect.height));
    dialogRef.style.left = newX + 'px';
    dialogRef.style.top = newY + 'px';
    dialogRef.style.transform = 'none';
    dialogRef.style.position = 'absolute';
  }

  function onMouseUp() {
    isDragging = false;
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      props.onClose?.();
    }
  }

  onMount(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div
      ref={overlayRef}
      class={`modal-overlay ${props.overlayClass || ''}`}
      style="display:flex"
    >
      <div ref={dialogRef} class={`modal-dialog ${props.dialogClass || ''}`}>
        <div
          class={`modal-header ${props.headerClass || ''}`}
          onMouseDown={onHeaderMouseDown}
        >
          <h2>{props.title}</h2>
          <button class="modal-close-btn" onClick={() => props.onClose?.()}>&times;</button>
        </div>
        <div class={`modal-body ${props.bodyClass || ''}`}>
          {props.children}
        </div>
        {props.footer && (
          <div class={`modal-footer ${props.footerClass || ''}`}>
            {props.footer}
          </div>
        )}
      </div>
    </div>
  );
}

import { onMount, onCleanup } from 'solid-js';

// Track when the window last gained focus (shared across all Dialog instances)
let lastFocusTime = 0;
function onWindowFocus() { lastFocusTime = Date.now(); }
window.addEventListener('focus', onWindowFocus);

// Open dialogen in volgorde van openen. Escape sluit alleen de bovenste: een
// dialoog die vanuit een andere geopend is (bv. de schermkalibratie vanuit de
// voorkeuren) nam anders bij Escape het venster eronder mee.
const openDialogen = [];

export default function Dialog(props) {
  const eigen = {};
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

  // Keep the dialog inside the window. Runs after mount (dialog may be larger
  // than a small window — CSS centering would push the title bar off-screen)
  // and on window resize (a dragged dialog keeps absolute coords). Top-left
  // wins the clamp so the draggable title bar always stays reachable.
  function clampToViewport() {
    if (!dialogRef || !overlayRef) return;
    const overlayRect = overlayRef.getBoundingClientRect();
    const dialogRect = dialogRef.getBoundingClientRect();
    const curX = dialogRect.left - overlayRect.left;
    const curY = dialogRect.top - overlayRect.top;
    const newX = Math.max(0, Math.min(curX, overlayRect.width - dialogRect.width));
    const newY = Math.max(0, Math.min(curY, overlayRect.height - dialogRect.height));
    if (Math.abs(newX - curX) < 0.5 && Math.abs(newY - curY) < 0.5) return;
    dialogRef.style.left = newX + 'px';
    dialogRef.style.top = newY + 'px';
    dialogRef.style.transform = 'none';
    dialogRef.style.position = 'absolute';
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      // Eén Escape sluit één dialoog, ook als het sluiten de volgende
      // dialoog tijdens dezelfde toetsaanslag bovenaan zet.
      if (e.__dialoogGesloten) return;
      if (openDialogen[openDialogen.length - 1] !== eigen) return;
      e.__dialoogGesloten = true;
      props.onClose?.();
    }
  }

  function triggerBump() {
    if (!dialogRef) return;
    // Remove class first to allow re-triggering
    dialogRef.classList.remove('bump');
    // Force reflow so the animation restarts
    void dialogRef.offsetWidth;
    dialogRef.classList.add('bump');
    // Play system alert sound via Rust backend
    if (window.__TAURI__?.core?.invoke) {
      window.__TAURI__.core.invoke('play_alert_sound').catch(() => {});
    }
  }

  function onOverlayMouseDown(e) {
    // If the window just gained focus from this click, only activate — don't interact
    if (Date.now() - lastFocusTime < 300) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Only trigger bump if click is directly on the overlay (not the dialog)
    if (e.target === overlayRef) {
      e.preventDefault();
      e.stopPropagation();
      triggerBump();
    }
  }

  function onOverlayDblClick(e) {
    // Block double-click on overlay from reaching the window behind
    if (e.target === overlayRef) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  onMount(() => {
    openDialogen.push(eigen);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', clampToViewport);
    // Clamp after first layout (content height is only known then)
    requestAnimationFrame(clampToViewport);
  });

  onCleanup(() => {
    const i = openDialogen.indexOf(eigen);
    if (i >= 0) openDialogen.splice(i, 1);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', clampToViewport);
  });

  return (
    <div
      ref={overlayRef}
      class={`modal-overlay ${props.overlayClass || ''}`}
      style="display:flex"
      onMouseDown={onOverlayMouseDown}
      onDblClick={onOverlayDblClick}
    >
      <div
        ref={dialogRef}
        class={`modal-dialog ${props.dialogClass || ''}`}
        role="dialog"
        aria-modal={props.modal === false ? "false" : "true"}
        aria-label={props.title}
        onAnimationEnd={() => dialogRef?.classList.remove('bump')}
      >
        <div
          class={`modal-header ${props.headerClass || ''}`}
          onMouseDown={onHeaderMouseDown}
        >
          <h2>{props.title}</h2>
          <button class="modal-close-btn" onClick={() => props.onClose?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
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

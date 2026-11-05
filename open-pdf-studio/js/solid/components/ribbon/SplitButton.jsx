import { createSignal, onMount, onCleanup } from 'solid-js';
import { autoShrinkLabel } from './autoShrinkLabel.js';
import { volgPopup } from './ribbon-popup.js';

export default function SplitButton(props) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  let containerRef;
  // Het menu staat met position: fixed buiten de klip van de ribbon (#617).
  let menuRef;
  volgPopup(() => menuRef, () => containerRef, menuOpen);

  onMount(() => {
    const handler = (e) => {
      if (containerRef && !containerRef.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', handler);
    onCleanup(() => document.removeEventListener('click', handler));
  });

  return (
    <div class="ribbon-split-btn" id={props.id} ref={containerRef}>
      {/* `main`: een eigen hoofdknop (een RibbonButton met vast id, zodat hij
          een sneltoets kan dragen, #714); anders de eenvoudige knop hieronder. */}
      {props.main || (
        <button class="ribbon-btn" title={props.mainTitle} disabled={props.disabled} onClick={props.onMainClick}>
          <div class="ribbon-btn-icon" ref={el => { if (props.mainIcon) el.innerHTML = props.mainIcon; }}></div>
          <span class="ribbon-btn-label" ref={el => autoShrinkLabel(el)}>{props.mainLabel}</span>
        </button>
      )}
      <button
        class="ribbon-split-btn-arrow"
        title={props.dropdownTitle}
        disabled={props.disabled}
        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen()); }}
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="8" height="8">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <div class={`ribbon-split-btn-menu${menuOpen() ? ' show' : ''}`} ref={menuRef} onClick={() => setMenuOpen(false)}>
        {props.children}
      </div>
    </div>
  );
}

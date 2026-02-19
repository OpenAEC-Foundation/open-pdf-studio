import { createSignal, onMount, onCleanup } from 'solid-js';

export default function SplitButton(props) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  let containerRef;

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
      <button class="ribbon-btn" title={props.mainTitle} onClick={props.onMainClick}>
        <div class="ribbon-btn-icon" ref={el => { if (props.mainIcon) el.innerHTML = props.mainIcon; }}></div>
        <span class="ribbon-btn-label">{props.mainLabel}</span>
      </button>
      <button
        class="ribbon-split-btn-arrow"
        title={props.dropdownTitle}
        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen()); }}
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="8" height="8">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <div class={`ribbon-split-btn-menu${menuOpen() ? ' show' : ''}`}>
        {props.children}
      </div>
    </div>
  );
}

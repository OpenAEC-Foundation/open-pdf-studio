import { createSignal, createEffect, onMount, onCleanup, children as resolveChildren, Show } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { naLettertypen } from './na-lettertypen.js';
import { uiSchaalFactor, UI_SCHAAL_EVENT } from '../../../core/ui-scale.js';

/**
 * AdaptiveGroups
 *
 * Wraps the list of <RibbonGroup> children for a ribbon tab and adaptively
 * collapses the rightmost groups into a single "More" overflow button when
 * the available horizontal space is insufficient (single overflow flyout).
 *
 * Implementation:
 * - Children are mounted normally inside the inline container.
 * - On resize, we measure each group's offsetWidth from left to right and
 *   determine the largest prefix that fits within (containerWidth - reserve).
 *   Groups beyond that index are "overflow" groups.
 * - Overflow groups are visually hidden inline (display:none) but stay
 *   mounted there (preserving Solid identity / event handlers).
 * - When the user opens the flyout, we move the overflow group DOM nodes
 *   into the flyout panel. When the flyout closes (or the layout changes),
 *   we move them back. Solid never re-renders them; we just move the same
 *   nodes — bindings and signals stay intact.
 * - measure() is throttled to once per animation frame.
 */
const OVERFLOW_RESERVE_PX = 80; // width of the "More" button incl. spacing

export default function AdaptiveGroups(props) {
  const { t } = useTranslation('ribbon');
  const moreLabel = () => t('common.more', 'More') || 'More';

  const [overflowStart, setOverflowStart] = createSignal(Infinity);
  const [iconOnly, setIconOnly] = createSignal(false);
  const [open, setOpen] = createSignal(false);

  let containerRef;
  let inlineHostRef;   // holds the children inline
  let flyoutHostRef;   // holds the overflowed children when flyout is open
  let flyoutRef;       // the fixed-position flyout panel itself
  let overflowBtnRef;
  let rafId = 0;

  // The flyout uses position:fixed so it escapes the adaptive container's
  // `overflow:hidden` (which is required to clip horizontally collapsing
  // groups — an absolutely-positioned flyout would be clipped and invisible).
  // Because fixed is viewport-relative, we compute its top/left from the
  // overflow button's rect and keep the flyout's right edge aligned with the
  // button, clamped inside the viewport.
  const positionFlyout = () => {
    if (!flyoutRef || !overflowBtnRef) return;
    const btn = overflowBtnRef.getBoundingClientRect();
    // Reset any previous width clamp so we can read the natural width.
    flyoutRef.style.left = '0px';
    flyoutRef.style.top = '-9999px';
    const fw = flyoutRef.offsetWidth;
    const margin = 4;
    // Right-align the flyout with the button's right edge.
    let left = Math.round(btn.right - fw);
    // Clamp inside the viewport (keep a small margin on both sides).
    const maxLeft = window.innerWidth - fw - margin;
    if (left > maxLeft) left = maxLeft;
    if (left < margin) left = margin;
    flyoutRef.style.left = left + 'px';
    flyoutRef.style.top = Math.round(btn.bottom) + 'px';
  };

  const schedulePosition = () => {
    if (!open()) return;
    requestAnimationFrame(positionFlyout);
  };

  // Resolve children once so we get a stable list of DOM nodes (groups)
  const resolved = resolveChildren(() => props.children);

  const groupNodes = () => {
    const list = resolved();
    const arr = Array.isArray(list) ? list : (list != null ? [list] : []);
    return arr.filter(n => n instanceof Element);
  };

  // Move overflow nodes into the flyout when it is open; otherwise put
  // them back inline (where they are kept hidden via display:none).
  const syncDom = () => {
    const nodes = groupNodes();
    const start = overflowStart();
    const showFlyout = open() && start < nodes.length;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isOverflow = i >= start;
      if (isOverflow && showFlyout && flyoutHostRef) {
        // Show full size in flyout
        node.style.display = '';
        if (node.parentNode !== flyoutHostRef) flyoutHostRef.appendChild(node);
      } else {
        // Inline placement — hidden if overflow, visible if not
        node.style.display = isOverflow ? 'none' : '';
        if (inlineHostRef && node.parentNode !== inlineHostRef) {
          inlineHostRef.appendChild(node);
        }
      }
    }
  };

  const measure = () => {
    if (!containerRef) return;
    // Only measure based on inline placement: temporarily put any flyout
    // nodes back inline so widths are correct.
    const nodes = groupNodes();
    if (nodes.length === 0) {
      setOverflowStart(Infinity);
      return;
    }
    for (const n of nodes) {
      if (inlineHostRef && n.parentNode !== inlineHostRef) inlineHostRef.appendChild(n);
      n.style.display = '';
    }

    const containerW = containerRef.clientWidth;

    // Pass 1 — measure with full labels.
    containerRef.classList.remove('ribbon-groups-icon-only');
    let total = 0;
    for (const n of nodes) total += n.offsetWidth;

    // If the labelled groups don't all fit, drop to icon-only first and
    // re-measure the (smaller) widths — "shrink, then collapse".
    let useIconOnly = false;
    if (total > containerW) {
      containerRef.classList.add('ribbon-groups-icon-only');
      useIconOnly = true;
      total = 0;
      for (const n of nodes) total += n.offsetWidth;
    }
    setIconOnly(useIconOnly);

    // Compute overflow cutoff on the decided (labelled or icon-only) widths.
    let cutoff;
    if (total <= containerW) {
      cutoff = nodes.length; // everything fits
    } else {
      // The "More" button grows with the interface size (#883).
      const budget = Math.max(0, containerW - OVERFLOW_RESERVE_PX * uiSchaalFactor());
      let used = 0;
      cutoff = nodes.length;
      for (let i = 0; i < nodes.length; i++) {
        const w = nodes[i].offsetWidth;
        if (used + w > budget) { cutoff = i; break; }
        used += w;
      }
    }
    setOverflowStart(cutoff);
    // After updating, sync visibility / parenting.
    syncDom();
  };

  const scheduleMeasure = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      measure();
    });
  };

  const onDocClick = (e) => {
    if (!open()) return;
    if (flyoutHostRef && flyoutHostRef.contains(e.target)) return;
    if (overflowBtnRef && overflowBtnRef.contains(e.target)) return;
    setOpen(false);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && open()) setOpen(false);
  };

  onMount(() => {
    const ro = new ResizeObserver(scheduleMeasure);
    if (containerRef) ro.observe(containerRef);
    const mo = new MutationObserver(scheduleMeasure);
    if (inlineHostRef) mo.observe(inlineHostRef, { childList: true });
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    // Keep the fixed-position flyout under the button when the layout shifts.
    window.addEventListener('resize', schedulePosition, true);
    window.addEventListener('scroll', schedulePosition, true);
    // Initial measure (after children mounted). The very first measure can run
    // before the layout has fully settled — before the UI font is applied and
    // before the icon-only widths have reflowed — which yields inflated group
    // widths and can wrongly push groups into the overflow flyout. Because the
    // container width does not change afterwards, the ResizeObserver never
    // re-fires, so that premature result would stick. Re-measure once the DOM
    // has painted (double rAF) and again once web fonts are ready, so any
    // early miscount self-corrects.
    //
    // The first measure runs in the next frame, not in a microtask: reading
    // layout here (or even reading document.fonts.ready) forced a full style
    // and layout pass in the middle of the startup task (#707). The frame
    // runs that layout anyway, before the first paint.
    let disposed = false;
    scheduleMeasure();
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!disposed) measure(); }));
    const stopFonts = naLettertypen(() => { if (!disposed) measure(); });
    // Another interface size (#883): group widths change while the container
    // width may not. Measure after the labels have been shrunk again.
    const naSchaal = () => requestAnimationFrame(() => requestAnimationFrame(() => { if (!disposed) measure(); }));
    window.addEventListener(UI_SCHAAL_EVENT, naSchaal);
    onCleanup(() => {
      disposed = true;
      stopFonts();
      window.removeEventListener(UI_SCHAAL_EVENT, naSchaal);
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener('mousedown', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', schedulePosition, true);
      window.removeEventListener('scroll', schedulePosition, true);
      if (rafId) cancelAnimationFrame(rafId);
    });
  });

  // Whenever open() / overflowStart() change, sync DOM placement and (if the
  // flyout is open) reposition it — its width depends on the groups that were
  // just moved in, so position after the DOM settles.
  createEffect(() => {
    open();
    overflowStart();
    syncDom();
    schedulePosition();
  });

  return (
    <div class="ribbon-groups ribbon-groups-adaptive" classList={{ 'ribbon-groups-icon-only': iconOnly() }} ref={containerRef}>
      <div class="ribbon-groups-inline" ref={inlineHostRef} style="display:contents;">
        {resolved()}
      </div>
      <Show when={overflowStart() < groupNodes().length}>
        <div class="ribbon-group ribbon-group-overflow" ref={overflowBtnRef}>
          <div class="ribbon-group-content">
            <button
              type="button"
              class={`ribbon-overflow-btn${open() ? ' open' : ''}`}
              title={moreLabel()}
              onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
            >
              <span class="ribbon-overflow-btn-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </span>
              <span class="ribbon-overflow-btn-label">{moreLabel()}</span>
              <span class="ribbon-overflow-btn-chevron" aria-hidden="true">
                <svg width="8" height="6" viewBox="0 0 8 6"><path d="M0 0 L4 5 L8 0 Z" fill="currentColor"/></svg>
              </span>
            </button>
          </div>
          <div class="ribbon-group-label">{moreLabel()}</div>
          <Show when={open()}>
            <div class="ribbon-overflow-flyout" ref={flyoutRef}>
              <div class="ribbon-overflow-flyout-inner" ref={flyoutHostRef}></div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

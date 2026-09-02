import { createSignal, For, Show, onCleanup, onMount } from 'solid-js';

// Screencast keystroke overlay — shows pressed keys/shortcuts as large chips
// in the bottom-RIGHT corner OF THE CANVAS AREA, so viewers of a recorded
// video can follow along with what is being typed without the chips landing
// on the panels. Toggled from the Beeld (View) ribbon tab.
//
// Display rules:
//   * outside input fields: every key is shown ("G", "X", "Esc", "Ctrl+S");
//   * inside input fields: only modifier combos (Ctrl/Alt+…) are shown, so
//     typed text content doesn't flood the overlay;
//   * a repeat of the same key bumps a ×N counter instead of adding a chip;
//   * chips fade out automatically after a short delay.

const [visible, setVisible] = createSignal(false);
const [keys, setKeys] = createSignal([]); // [{ id, label, count }]

let _nextId = 1;
const CHIP_TTL_MS = 2200;
const MAX_CHIPS = 5;

export function keystrokeOverlayVisible() { return visible(); }

export function toggleKeystrokeOverlay() {
  setVisible(!visible());
  if (!visible()) setKeys([]);
}

// Pretty-print a KeyboardEvent as a compact chip label.
function formatKey(e) {
  const special = {
    ' ': 'Space', 'Escape': 'Esc', 'ArrowUp': '↑', 'ArrowDown': '↓',
    'ArrowLeft': '←', 'ArrowRight': '→', 'Enter': 'Enter', 'Tab': 'Tab',
    'Backspace': '⌫', 'Delete': 'Del', 'Home': 'Home', 'End': 'End',
    'PageUp': 'PgUp', 'PageDown': 'PgDn', 'CapsLock': 'Caps',
  };
  let k = e.key;
  // Bare modifier presses show as the modifier itself
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return null;
  k = special[k] ?? (k.length === 1 ? k.toUpperCase() : k);

  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && k.length > 1) parts.push('Shift'); // letters already show case via Shift
  parts.push(k);
  return parts.join('+');
}

function pushKey(label) {
  setKeys(prev => {
    const now = [...prev];
    const last = now[now.length - 1];
    if (last && last.label === label) {
      // Same key again → bump the counter on the existing chip
      last.count += 1;
      last.id = _nextId++; // refresh identity so its TTL restarts
      scheduleExpiry(last.id);
      return [...now.slice(0, -1), { ...last }];
    }
    const chip = { id: _nextId++, label, count: 1 };
    now.push(chip);
    scheduleExpiry(chip.id);
    return now.slice(-MAX_CHIPS);
  });
}

function scheduleExpiry(id) {
  setTimeout(() => {
    setKeys(prev => prev.filter(c => c.id !== id));
  }, CHIP_TTL_MS);
}

function onKeyDown(e) {
  if (!visible()) return;
  const label = formatKey(e);
  if (!label) return;
  const inInput = e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA'
    || e.target?.isContentEditable;
  // In text inputs only surface real shortcuts, not typed content.
  if (inInput && !(e.ctrlKey || e.metaKey || e.altKey)) return;
  pushKey(label);
}

// Rechteronderhoek van het CANVASGEBIED (#pdf-container), in fixed-
// coördinaten. Zo blijven de chips binnen de tekening en vallen ze niet
// over het eigenschappenpaneel of de statusbalk — ook niet als panelen
// open/dicht gaan of het venster van maat verandert.
const RAND = 16;
const [anker, setAnker] = createSignal({ right: RAND, bottom: RAND + 24 });

function meetAnker() {
  const el = document.getElementById('pdf-container');
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return;
  setAnker({
    right: Math.max(RAND, window.innerWidth - r.right + RAND),
    bottom: Math.max(RAND, window.innerHeight - r.bottom + RAND),
  });
}

export default function KeystrokeOverlay() {
  document.addEventListener('keydown', onKeyDown, true);
  onCleanup(() => document.removeEventListener('keydown', onKeyDown, true));

  onMount(() => {
    meetAnker();
    const el = document.getElementById('pdf-container');
    // Panelen die open/dicht gaan veranderen de canvasbreedte zonder dat het
    // venster verandert — vandaar een ResizeObserver naast de resize-listener.
    const ro = (typeof ResizeObserver !== 'undefined' && el) ? new ResizeObserver(meetAnker) : null;
    if (ro && el) ro.observe(el);
    window.addEventListener('resize', meetAnker);
    onCleanup(() => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', meetAnker);
    });
  });

  return (
    <Show when={visible()}>
      <div class="keystroke-overlay" style={{
        position: 'fixed',
        right: `${anker().right}px`,
        bottom: `${anker().bottom}px`,
        'z-index': 4000,
        display: 'flex',
        gap: '8px',
        'align-items': 'flex-end',
        'justify-content': 'flex-end',
        'pointer-events': 'none',
      }}>
        <For each={keys()}>
          {(chip) => (
            <div class="keystroke-chip" style={{
              background: 'rgba(20, 20, 20, 0.85)',
              color: '#ffffff',
              border: '1px solid rgba(255,255,255,0.25)',
              padding: '8px 14px',
              'font-size': '20px',
              'font-weight': 600,
              'font-family': 'Segoe UI, Arial, sans-serif',
              'box-shadow': '0 2px 8px rgba(0,0,0,0.4)',
              'white-space': 'nowrap',
            }}>
              {chip.label}{chip.count > 1 ? ` ×${chip.count}` : ''}
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

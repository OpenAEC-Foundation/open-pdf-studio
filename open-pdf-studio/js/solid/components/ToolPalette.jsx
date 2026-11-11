import { createSignal, Show, For, onMount, onCleanup } from 'solid-js';
import { klemPaletPositie } from './palette-grenzen.js';
import { state, noPdf } from '../../core/state.js';
import { setTool } from '../../tools/manager.js';
import { ClipboardWindow, clipboardWindowOpen, toggleClipboardWindow, clipboardIcon } from './ClipboardHistory.jsx';
import { highlightMode, highlightActive, markeringKnop } from '../../tools/highlight-mode.js';
import { isPdfAReadOnly } from '../../pdf/loader.js';
import {
  highlightIcon, textHighlightIcon, freehandIcon, lineIcon, arrowIcon, polylineIcon,
  rectIcon, ellipseIcon, polygonIcon, cloudIcon, cloudPolylineIcon,
  textboxIcon, calloutIcon, noteIcon, linkIcon,
  stampIcon, signatureIcon,
  measureDistanceIcon, measureAreaIcon, measurePerimeterIcon
} from '../data/ribbonIcons.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { LINK_TOOL } from '../../annotations/link/link-maken.js';
import { savePreferences } from '../../core/preferences.js';
import { registerPaletteDock, unregisterPaletteDock } from '../stores/paletteOrder.js';
import { leesOpslag, schrijfOpslag } from '../../core/opslag.js';
import { uiSchaalFactor, UI_SCHAAL_EVENT } from '../../core/ui-scale.js';

const handIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"/></svg>`;
const selectIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"/></svg>`;

// --- State ---
const [paletteVisible, setPaletteVisible] = createSignal(true);
const [paletteMode, setPaletteMode] = createSignal('docked-left');
const [floatPos, setFloatPos] = createSignal({ x: 200, y: 150 });
const [isDragging, setIsDragging] = createSignal(false);
const [dockPreview, setDockPreview] = createSignal(null); // null | 'left' | 'right'

// Tool palette icon size: 'small' (default) or 'large'
const storedPaletteIconSize = leesOpslag('paletteIconSize') || 'small';
const [paletteIconSize, setPaletteIconSizeRaw] = createSignal(storedPaletteIconSize);

function setPaletteIconSize(size) {
  setPaletteIconSizeRaw(size);
  try { schrijfOpslag('paletteIconSize', size); } catch { /* alleen deze sessie */ }
}

export { paletteVisible, paletteMode, paletteIconSize, showPaletteCtxMenu, PaletteContextMenu };

function savePaletteState() {
  state.preferences.toolPaletteVisible = paletteVisible();
  state.preferences.toolPaletteMode = paletteMode();
  const pos = floatPos();
  state.preferences.toolPaletteFloatX = pos.x;
  state.preferences.toolPaletteFloatY = pos.y;
  savePreferences();
}

export function toggleToolPalette() {
  const willBeVisible = !paletteVisible();
  setPaletteVisible(willBeVisible);
  const mode = paletteMode();
  if (willBeVisible && mode.startsWith('docked-')) {
    registerPaletteDock('tool', mode.replace('docked-', ''));
  } else {
    unregisterPaletteDock('tool');
  }
  savePaletteState();
}

export function initToolPalette() {
  const prefs = state.preferences;
  setPaletteVisible(prefs.toolPaletteVisible);
  const mode = prefs.toolPaletteMode || 'docked-left';
  setPaletteMode(mode);
  setFloatPos({ x: prefs.toolPaletteFloatX ?? 200, y: prefs.toolPaletteFloatY ?? 150 });
  if (prefs.toolPaletteVisible && mode.startsWith('docked-')) {
    registerPaletteDock('tool', mode.replace('docked-', ''));
  }
  // Clamp after first render in case saved position is outside current viewport
  if (mode === 'float') {
    requestAnimationFrame(() => requestAnimationFrame(clampFloatPosition));
  }
}

window.__toggleToolPalette = toggleToolPalette;

// --- Clamp floating palette within viewport on window resize ---
function clampFloatPosition() {
  if (paletteMode() !== 'float' || !paletteVisible()) return;
  const el = document.querySelector('.tp-float:not(.tp-ext)');
  const w = el ? el.offsetWidth : 80;
  const h = el ? el.offsetHeight : 40;
  const pos = floatPos();
  const { x: nx, y: ny } = klemPaletPositie(pos, w, h);
  if (nx !== pos.x || ny !== pos.y) {
    setFloatPos({ x: nx, y: ny });
    savePaletteState();
  }
}

let _resizeRafId = null;
window.addEventListener('resize', () => {
  if (_resizeRafId) return;
  _resizeRafId = requestAnimationFrame(() => {
    _resizeRafId = null;
    clampFloatPosition();
  });
});

const DOCK_STRIP_WIDTH = 34;
// A palette docks as soon as one of its edges comes within DOCK_SNAP of an
// edge of the page view, while it is still being dragged; it only comes off
// again once it is DOCK_RELEASE away, so it does not flicker at the edge.
const DOCK_SNAP = 60;
const DOCK_RELEASE = 100;
// Size of the floating palette, kept for the snap test while it is docked.
let laatsteZweefMaat = { w: 80, h: 420 };

const tools = [
  { tool: 'hand', key: 'home.hand', icon: handIcon, group: 0 },
  { tool: 'select', key: 'home.select', icon: selectIcon, group: 0 },
  { tool: 'highlight', key: 'comment.highlight', icon: highlightIcon, group: 1 },
  { tool: 'draw', key: 'comment.freehand', icon: freehandIcon, group: 1 },
  { tool: 'line', key: 'comment.line', icon: lineIcon, group: 1 },
  { tool: 'arrow', key: 'comment.arrow', icon: arrowIcon, group: 1 },
  { tool: 'polyline', key: 'comment.polyline', icon: polylineIcon, group: 1 },
  { tool: 'box', key: 'comment.rect', icon: rectIcon, group: 2 },
  { tool: 'circle', key: 'comment.ellipse', icon: ellipseIcon, group: 2 },
  { tool: 'polygon', key: 'comment.polygon', icon: polygonIcon, group: 2 },
  { tool: 'cloud', key: 'comment.cloud', icon: cloudIcon, group: 2 },
  { tool: 'cloudPolyline', key: 'comment.cloudPolyline', icon: cloudPolylineIcon, group: 2 },
  { tool: 'textbox', key: 'comment.textBox', icon: textboxIcon, group: 3 },
  { tool: 'callout', key: 'comment.callout', icon: calloutIcon, group: 3 },
  { tool: 'comment', key: 'comment.note', icon: noteIcon, group: 3 },
  // Hyperlink (#953): uit de tekstselectie (link-tool.js, onActivate),
  // anders een vak slepen.
  { tool: LINK_TOOL, key: 'comment.link', icon: linkIcon, group: 3 },
  { tool: 'stamp', key: 'comment.stamp', icon: stampIcon, group: 4 },
  { tool: 'signature', key: 'comment.signature', icon: signatureIcon, group: 4 },
  { tool: 'measureDistance', key: 'comment.measureDistance', icon: measureDistanceIcon, group: 5 },
  { tool: 'measureArea', key: 'comment.measureArea', icon: measureAreaIcon, group: 5 },
  { tool: 'measurePerimeter', key: 'comment.measurePerimeter', icon: measurePerimeterIcon, group: 5 },
];

// --- Shared drag logic ---
function startDrag(e, fromDocked) {
  if (e.button !== 0) return;
  e.preventDefault();
  const mainViewEl = document.querySelector('.main-view');
  if (!mainViewEl) return;
  let hasMoved = false;
  const startCX = e.clientX;
  const startCY = e.clientY;
  // For floating: offset from palette origin
  const offsetX = fromDocked ? 17 : (e.clientX - floatPos().x);
  const offsetY = fromDocked ? 12 : (e.clientY - floatPos().y);

  setIsDragging(true);

  // The side the palette is docked to during this drag (null = floating).
  let gedokt = null;
  // The page view's rectangle with no palette docked: docking shrinks it,
  // and measuring the shrunk view would undock the palette straight away.
  let kader = null;

  function snapSide(px, py, pw, ph, cx, cy) {
    const r = kader || mainViewEl.getBoundingClientRect();
    // Distance of the palette's (and the pointer's) edges to each view edge.
    const afstand = {
      left: Math.min(px - r.left, cx - r.left),
      right: Math.min(r.right - (px + pw), r.right - cx),
      top: Math.min(py - r.top, cy - r.top),
      bottom: Math.min(r.bottom - (py + ph), r.bottom - cy),
    };
    if (gedokt && afstand[gedokt] < DOCK_RELEASE) return gedokt;
    let beste = null;
    for (const [kant, d] of Object.entries(afstand)) {
      if (d < DOCK_SNAP && (beste === null || d < afstand[beste])) beste = kant;
    }
    return beste;
  }

  function dock(kant) {
    if (kant === gedokt) return;
    gedokt = kant;
    if (kant) {
      setPaletteMode(`docked-${kant}`);
      registerPaletteDock('tool', kant);
    } else {
      setPaletteMode('float');
      unregisterPaletteDock('tool');
    }
  }

  function onMove(ev) {
    if (!hasMoved) {
      const dx = Math.abs(ev.clientX - startCX);
      const dy = Math.abs(ev.clientY - startCY);
      if (dx < 4 && dy < 4) return; // dead zone
      hasMoved = true;
      if (fromDocked) {
        setPaletteMode('float');
        unregisterPaletteDock('tool');
      }
      kader = null;
      requestAnimationFrame(() => { kader = mainViewEl.getBoundingClientRect(); });
    }

    const el = gedokt ? null : document.querySelector('.tp-float:not(.tp-ext)');
    if (el && el.offsetWidth > 0) laatsteZweefMaat = { w: el.offsetWidth, h: el.offsetHeight };
    const { w: pw, h: ph } = laatsteZweefMaat;
    const { x: nx, y: ny } = klemPaletPositie({ x: ev.clientX - offsetX, y: ev.clientY - offsetY }, pw, ph);
    setFloatPos({ x: nx, y: ny });
    // Snap while dragging: the palette docks the moment it reaches an edge,
    // without letting go, and floats again when dragged away.
    const kant = snapSide(nx, ny, pw, ph, ev.clientX, ev.clientY);
    dock(kant);
    setDockPreview(kant);
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    setIsDragging(false);
    setDockPreview(null);
    if (!hasMoved) return;
    savePaletteState();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// --- Context menu for icon size toggle ---
const [paletteCtxMenu, setPaletteCtxMenu] = createSignal(null);

function showPaletteCtxMenu(e) {
  e.preventDefault();
  setPaletteCtxMenu({ x: e.clientX, y: e.clientY });
}

// Global mousedown/keydown listeners for the palette context menu (registered once)
let _ctxListenersRegistered = false;
function ensureCtxListeners() {
  if (_ctxListenersRegistered) return;
  _ctxListenersRegistered = true;
  document.addEventListener('mousedown', (e) => {
    if (!paletteCtxMenu()) return;
    if (e.target.closest('.tp-ctx-menu')) return;
    setPaletteCtxMenu(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setPaletteCtxMenu(null);
  });
}

function PaletteContextMenu() {
  const { t } = useTranslation('ribbon');
  onMount(ensureCtxListeners);

  return (
    <Show when={paletteCtxMenu()}>
      <div
        class="tp-ctx-menu"
        style={{ left: `${paletteCtxMenu().x}px`, top: `${paletteCtxMenu().y}px` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          class={`tp-ctx-menu-item${paletteIconSize() === 'small' ? ' checked' : ''}`}
          onClick={() => { setPaletteIconSize('small'); setPaletteCtxMenu(null); }}
        >
          <span class="tp-ctx-check">{paletteIconSize() === 'small' ? '\u2713' : ''}</span>
          <span>{t('palette.smallIcons')}</span>
        </div>
        <div
          class={`tp-ctx-menu-item${paletteIconSize() === 'large' ? ' checked' : ''}`}
          onClick={() => { setPaletteIconSize('large'); setPaletteCtxMenu(null); }}
        >
          <span class="tp-ctx-check">{paletteIconSize() === 'large' ? '\u2713' : ''}</span>
          <span>{t('palette.largeIcons')}</span>
        </div>
      </div>
    </Show>
  );
}

// --- Components ---

function ToolBtn(props) {
  const toolDisabled = () => noPdf() || isPdfAReadOnly();
  const alwaysEnabled = props.tool === 'hand' || props.tool === 'select';
  // Markeren (#927): gebied of tekst (highlight-mode.js). Nog eens klikken
  // als hij aan staat wisselt van modus; pictogram en tooltip tonen welke.
  const isHighlight = props.tool === 'highlight';
  // Tekst markeren draait op Selecteren; dan staat alleen Markeren aan.
  const isActive = () => (isHighlight
    ? highlightActive()
    : state.currentTool === props.tool && !(props.tool === 'select' && state.textHighlightMode)) && !state.toolOverrides;
  const icon = () => (isHighlight && highlightMode() === 'text' ? textHighlightIcon : props.icon);
  const title = () => (isHighlight
    ? `${highlightMode() === 'text' ? props.textTitle : props.areaTitle}\n${props.switchTip}`
    : props.title);
  return (
    <button
      class={`tp-btn ${isActive() ? 'active' : ''}`}
      disabled={!alwaysEnabled && toolDisabled()}
      onClick={() => (isHighlight ? markeringKnop() : setTool(props.tool))}
      title={title()}
      innerHTML={icon()}
    />
  );
}

function ToolList() {
  const { t } = useTranslation('ribbon');
  let lastGroup = -1;
  return (
    <>
      <For each={tools}>
        {(item) => {
          const showSep = lastGroup !== -1 && lastGroup !== item.group;
          lastGroup = item.group;
          return (
            <>
              {showSep && <div class="tp-sep" />}
              <ToolBtn tool={item.tool} title={t(item.key)} icon={item.icon}
                areaTitle={`${t('comment.areaHighlight')}: ${t('comment.areaHighlightTitle')}`}
                textTitle={`${t('comment.textHighlight')}: ${t('comment.textHighlightTitle')}`}
                switchTip={t('comment.highlightSwitchTip')} />
            </>
          );
        }}
      </For>
      {/* Klembord (#929): de kopieen van deze sessie in een venster naast de palet. */}
      <div class="tp-sep" />
      <button
        class={`tp-btn ${clipboardWindowOpen() ? 'active' : ''}`}
        id="tp-clipboard"
        title={`${t('clipboardPalette.title')}\n${t('clipboardPalette.tip')}`}
        onClick={(e) => toggleClipboardWindow(e.currentTarget)}
        innerHTML={clipboardIcon}
      />
      <ClipboardWindow />
    </>
  );
}

// Height needed for all tools in a single column
const SINGLE_COL_HEIGHT_SMALL = 702;  // 22 btns × 30px + 6 seps × 7px
const SINGLE_COL_HEIGHT_LARGE = 1010; // 22 btns × 44px + 6 seps × 7px

// Docked strip — sits in the flex layout
export function DockedToolPalette(props) {
  const { t } = useTranslation('ribbon');
  const side = () => props.side;
  const shouldShow = () => paletteVisible() && paletteMode() === `docked-${side()}`;
  const [twoCol, setTwoCol] = createSignal(false);
  let observer = null;

  let paletteEl = null;
  // Button sizes follow the interface size (#883), so the pixel heights do too.
  function updateColumns() {
    if (!paletteEl) return;
    if (side() === 'top' || side() === 'bottom') { setTwoCol(false); return; }
    const schaal = uiSchaalFactor();
    const available = paletteEl.clientHeight - 46 * schaal;
    const threshold = (paletteIconSize() === 'large' ? SINGLE_COL_HEIGHT_LARGE : SINGLE_COL_HEIGHT_SMALL) * schaal;
    setTwoCol(available < threshold);
  }
  window.addEventListener(UI_SCHAAL_EVENT, updateColumns);
  onCleanup(() => window.removeEventListener(UI_SCHAAL_EVENT, updateColumns));

  function bindRef(el) {
    if (observer) { observer.disconnect(); observer = null; }
    paletteEl = el || null;
    if (!el) return;
    observer = new ResizeObserver(updateColumns);
    observer.observe(el);
    updateColumns();
  }

  return (
    <Show when={shouldShow()}>
      <div class={`tp-docked tp-docked-${side()}${paletteIconSize() === 'large' ? ' tp-large' : ''}`} ref={bindRef} onContextMenu={showPaletteCtxMenu}>
        <div class="tp-grip" onMouseDown={(e) => startDrag(e, true)}>
          <svg width="10" height="16" viewBox="0 0 10 16">
            <circle cx="3" cy="2" r="1.2" fill="currentColor"/><circle cx="7" cy="2" r="1.2" fill="currentColor"/>
            <circle cx="3" cy="6" r="1.2" fill="currentColor"/><circle cx="7" cy="6" r="1.2" fill="currentColor"/>
            <circle cx="3" cy="10" r="1.2" fill="currentColor"/><circle cx="7" cy="10" r="1.2" fill="currentColor"/>
            <circle cx="3" cy="14" r="1.2" fill="currentColor"/><circle cx="7" cy="14" r="1.2" fill="currentColor"/>
          </svg>
        </div>
        <div class={`tp-docked-tools${twoCol() ? ' two-col' : ''}`}>
          <ToolList />
        </div>
        <button class="tp-close" title={t('palette.settings')} style={{ color: 'var(--theme-text-secondary)' }}
          onClick={(e) => showPaletteCtxMenu({ preventDefault: () => {}, clientX: e.clientX, clientY: e.clientY })}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="2"/><path d="M8 1v2m0 10v2M1 8h2m10 0h2M3 3l1.5 1.5m7 7L13 13M3 13l1.5-1.5m7-7L13 3"/>
          </svg>
        </button>
        <button class="tp-close" title={t('view.closePalette')} onClick={() => { setPaletteVisible(false); unregisterPaletteDock('tool'); savePaletteState(); }}>
          <svg width="8" height="8" viewBox="0 0 10 10">
            <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/>
            <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </button>
      </div>
    </Show>
  );
}

// Floating palette — fixed position, draggable
export function FloatingToolPalette() {
  const { t } = useTranslation('ribbon');
  const shouldShow = () => paletteVisible() && paletteMode() === 'float';
  let paletteRef;

  return (
    <Show when={shouldShow()}>
      <div
        ref={paletteRef}
        class={`tp-float${paletteIconSize() === 'large' ? ' tp-large' : ''}`}
        style={`left:${floatPos().x}px; top:${floatPos().y}px`}
        onContextMenu={showPaletteCtxMenu}
      >
        <div class="tp-float-header" onMouseDown={(e) => {
          if (e.target.closest('.tp-float-close')) return;
          startDrag(e, false);
        }}>
          <span class="tp-float-title">{t('view.toolPaletteLabel')}</span>
          <button class="tp-float-close" onClick={() => { setPaletteVisible(false); savePaletteState(); }}>
            <svg width="8" height="8" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5"/>
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
        </div>
        <div class="tp-float-body">
          <ToolList />
        </div>
      </div>
    </Show>
  );
}

// Dock targets — shown inside .main-view when dragging
const DOCK_ICONEN = {
  left: '<rect x="1" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>',
  right: '<rect x="13" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>',
  top: '<rect x="1" y="1" width="18" height="6" rx="1" fill="currentColor" opacity="0.4"/>',
  bottom: '<rect x="1" y="13" width="18" height="6" rx="1" fill="currentColor" opacity="0.4"/>',
};

export function DockTargets() {
  return (
    <For each={['left', 'right', 'top', 'bottom']}>
      {(kant) => (
        <>
          <div class={`tp-dock-target tp-dock-target-${kant} ${isDragging() ? 'visible' : ''} ${dockPreview() === kant ? 'active' : ''}`}>
            <div class="tp-dock-target-icon">
              <svg width="20" height="20" viewBox="0 0 20 20"
                innerHTML={`<rect x="1" y="1" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>${DOCK_ICONEN[kant]}`} />
            </div>
          </div>
          <div class={`tp-dock-preview tp-dock-preview-${kant} ${dockPreview() === kant ? 'active' : ''}`} />
        </>
      )}
    </For>
  );
}

export default DockedToolPalette;

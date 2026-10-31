/**
 * ExtensionToolPalette — generic, data-driven tool palette for plugins.
 *
 * Each registered palette descriptor gets its own instance of this component
 * with independent docking, floating, visibility, and drag state.
 */

import { createSignal, createEffect, Show, For, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';

import { state, noPdf } from '../../core/state.js';
import { setTool } from '../../tools/manager.js';
import { isPdfAReadOnly } from '../../pdf/loader.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { savePreferences } from '../../core/preferences.js';
import { registerPaletteDock, unregisterPaletteDock } from '../stores/paletteOrder.js';
import { hasAnnotationType } from '../../plugins/annotation-type-registry.js';
import { paletteIconSize, showPaletteCtxMenu } from './ToolPalette.jsx';
import { getActiveSubTool, setActiveSubTool } from '../../plugins/tool-group-state.js';

// Single-active-group open-state across the whole app (only one sub-menu open at a time).
const [openGroupId, setOpenGroupId] = createSignal(null);

const DOCK_SNAP = 60;

// Per-palette state keyed by palette id
const paletteStates = {};

function getOrCreateState(id, defaults) {
  if (!paletteStates[id]) {
    const prefs = state.preferences;
    const prefKey = `ext_${id}`;
    paletteStates[id] = {
      visible:     createSignal(prefs[`${prefKey}_visible`]     ?? (defaults?.defaultVisible ?? false)),
      mode:        createSignal(prefs[`${prefKey}_mode`]        ?? (defaults?.defaultMode ?? 'docked-left')),
      floatPos:    createSignal({ x: prefs[`${prefKey}_floatX`] ?? 260, y: prefs[`${prefKey}_floatY`] ?? 150 }),
      isDragging:  createSignal(false),
      dockPreview: createSignal(null),
    };
  }
  return paletteStates[id];
}

function savePalettePrefs(id) {
  const ps = paletteStates[id];
  if (!ps) return;
  const prefKey = `ext_${id}`;
  state.preferences[`${prefKey}_visible`] = ps.visible[0]();
  state.preferences[`${prefKey}_mode`] = ps.mode[0]();
  const pos = ps.floatPos[0]();
  state.preferences[`${prefKey}_floatX`] = pos.x;
  state.preferences[`${prefKey}_floatY`] = pos.y;
  savePreferences();
}

export function initExtPalette(id, defaults) {
  const ps = getOrCreateState(id, defaults);
  const mode = ps.mode[0]();
  if (ps.visible[0]() && mode.startsWith('docked-')) {
    registerPaletteDock(id, mode.replace('docked-', ''));
  }
  // Clamp after first render in case saved position is outside current viewport
  if (ps.visible[0]() && mode === 'float') {
    requestAnimationFrame(() => requestAnimationFrame(clampAllExtFloatPositions));
  }
}

export function toggleExtPalette(id) {
  const ps = getOrCreateState(id);
  const willBeVisible = !ps.visible[0]();
  ps.visible[1](willBeVisible);
  const mode = ps.mode[0]();
  if (willBeVisible && mode.startsWith('docked-')) {
    registerPaletteDock(id, mode.replace('docked-', ''));
  } else {
    unregisterPaletteDock(id);
  }
  savePalettePrefs(id);
}

export function isExtPaletteVisible(id) {
  const ps = paletteStates[id];
  return ps ? ps.visible[0]() : false;
}

// --- Clamp all floating extension palettes within viewport on window resize ---
function clampAllExtFloatPositions() {
  for (const id of Object.keys(paletteStates)) {
    const ps = paletteStates[id];
    if (ps.mode[0]() !== 'float' || !ps.visible[0]()) continue;
    const el = document.querySelector('.tp-float.tp-ext');
    const w = el ? el.offsetWidth : 80;
    const h = el ? el.offsetHeight : 40;
    const pos = ps.floatPos[0]();
    const nx = Math.max(0, Math.min(pos.x, window.innerWidth - w));
    const ny = Math.max(0, Math.min(pos.y, window.innerHeight - h));
    if (nx !== pos.x || ny !== pos.y) {
      ps.floatPos[1]({ x: nx, y: ny });
      savePalettePrefs(id);
    }
  }
}

let _extResizeRafId = null;
window.addEventListener('resize', () => {
  if (_extResizeRafId) return;
  _extResizeRafId = requestAnimationFrame(() => {
    _extResizeRafId = null;
    clampAllExtFloatPositions();
  });
});

// --- Drag logic (per palette instance) ---
function startExtDrag(id, e, fromDocked) {
  if (e.button !== 0) return;
  e.preventDefault();
  const ps = paletteStates[id];
  if (!ps) return;
  const mainViewEl = document.querySelector('.main-view');
  if (!mainViewEl) return;
  let hasMoved = false;
  const startCX = e.clientX;
  const startCY = e.clientY;
  const offsetX = fromDocked ? 17 : (e.clientX - ps.floatPos[0]().x);
  const offsetY = fromDocked ? 12 : (e.clientY - ps.floatPos[0]().y);

  ps.isDragging[1](true);

  function getSnapSide(cx) {
    const rect = mainViewEl.getBoundingClientRect();
    const relL = cx - rect.left;
    const relR = rect.right - cx;
    if (relL < DOCK_SNAP) return 'left';
    if (relR < DOCK_SNAP) return 'right';
    return null;
  }

  function onMove(ev) {
    if (!hasMoved) {
      const dx = Math.abs(ev.clientX - startCX);
      const dy = Math.abs(ev.clientY - startCY);
      if (dx < 4 && dy < 4) return;
      hasMoved = true;
      if (fromDocked) {
        ps.mode[1]('float');
        unregisterPaletteDock(id);
      }
    }
    const el = document.querySelector('.tp-float.tp-ext');
    const pw = el ? el.offsetWidth : 80;
    const ph = el ? el.offsetHeight : 40;
    const nx = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - pw));
    const ny = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - ph));
    ps.floatPos[1]({ x: nx, y: ny });
    ps.dockPreview[1](getSnapSide(ev.clientX));
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    ps.isDragging[1](false);
    ps.dockPreview[1](null);
    if (!hasMoved) return;
    const snap = getSnapSide(ev.clientX);
    if (snap) {
      ps.mode[1](`docked-${snap}`);
      registerPaletteDock(id, snap);
    } else {
      unregisterPaletteDock(id);
    }
    savePalettePrefs(id);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Compare two override-objects for shallow equality. Treats null/undefined as
// equivalent to "no overrides" so an absent map equals an empty/null map.
function overridesEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k]);
}

// --- Tool button ---
function ExtToolBtn(props) {
  const toolDisabled = () => noPdf() || isPdfAReadOnly();
  const isActive = () => {
    if (state.currentTool !== props.tool) return false;
    return overridesEqual(props.overrides || null, state.toolOverrides || null);
  };
  return (
    <button
      class={`tp-btn ${isActive() ? 'active' : ''}`}
      disabled={toolDisabled()}
      onClick={() => { setTool(props.tool); if (props.overrides) state.toolOverrides = props.overrides; }}
      title={props.title}
      innerHTML={props.icon}
    />
  );
}

// --- Tool-group button (B1+P1: morphing main + pop-out sub-menu) ---
function ExtToolGroupBtn(props) {
  const { t } = useTranslation('ribbon');
  const toolDisabled = () => noPdf() || isPdfAReadOnly();

  const groupDef = () => props.groupDef;
  const activeSub = () => getActiveSubTool(groupDef());

  // Main button is "active" when current tool/overrides match the active sub-tool.
  const isActive = () => {
    const sub = activeSub();
    if (state.currentTool !== sub.tool) return false;
    return overridesEqual(sub.overrides || null, state.toolOverrides || null);
  };

  const isOpen = () => openGroupId() === groupDef().id;

  // Activate sub-tool: fire setTool + apply overrides.
  const activateSub = (sub) => {
    setTool(sub.tool);
    state.toolOverrides = sub.overrides || null;
  };

  // Sub-menu lives in a Portal (escapes docked-palette overflow:hidden), so we
  // compute viewport-fixed coordinates from the wrap's bounding rect on open.
  let wrapRef;
  let menuRef;
  const [pos, setPos] = createSignal({ top: 0, left: 0 });

  const recomputePos = () => {
    if (!wrapRef) return;
    const rect = wrapRef.getBoundingClientRect();
    if (props.side === 'right') {
      // Docked-right palette: anchor menu to the right of the viewport so it
      // grows leftward from the wrap's left edge. Menu width is unknown here.
      setPos({ top: rect.top, right: window.innerWidth - rect.left + 6 });
    } else {
      // Docked-left or float: pop out to the right of the wrap.
      setPos({ top: rect.top, left: rect.right + 6 });
    }
  };

  const onMainClick = () => {
    const sub = activeSub();
    activateSub(sub);
    if (!isOpen()) recomputePos();
    setOpenGroupId(isOpen() ? null : groupDef().id);
  };

  const onSubClick = (sub) => {
    setActiveSubTool(groupDef().id, sub.id);
    activateSub(sub);
    setOpenGroupId(null);
  };

  // Outside-click + Escape handling, mounted only while the menu is open.
  const onDocMouseDown = (e) => {
    // Click inside the portal'd menu: keep open.
    if (menuRef && menuRef.contains(e.target)) return;
    // Click on main button (inside the wrap): its own onClick handles toggle.
    if (wrapRef && wrapRef.contains(e.target)) return;
    setOpenGroupId(null);
  };
  const onDocKey = (e) => {
    if (e.key === 'Escape') setOpenGroupId(null);
  };
  let listenersAttached = false;
  const ensureListeners = () => {
    if (listenersAttached) return;
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKey);
    listenersAttached = true;
  };
  const removeListeners = () => {
    if (!listenersAttached) return;
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('keydown', onDocKey);
    listenersAttached = false;
  };
  // Reactively attach/detach listeners when the menu opens/closes. Also
  // re-compute position on window resize while the menu is open.
  createEffect(() => {
    if (isOpen()) {
      ensureListeners();
      const onResize = () => recomputePos();
      window.addEventListener('resize', onResize);
      onCleanup(() => window.removeEventListener('resize', onResize));
    } else {
      removeListeners();
    }
  });
  onCleanup(removeListeners);

  // Sub-menu position class based on palette docked side (kept for any
  // future side-specific visual tweaks; positioning itself is now inline).
  const sideClass = () => {
    const s = props.side;
    if (s === 'left') return 'from-docked-left';
    if (s === 'right') return 'from-docked-right';
    return 'from-float';
  };

  const subTitle = (sub) => {
    if (sub.translationKey) {
      const tr = t(sub.translationKey);
      if (tr && tr !== sub.translationKey) return tr;
    }
    return sub.label || sub.id;
  };

  const submenuStyle = () => {
    const p = pos();
    const s = { position: 'fixed', top: `${p.top}px` };
    if (p.left !== undefined) s.left = `${p.left}px`;
    if (p.right !== undefined) s.right = `${p.right}px`;
    return s;
  };

  return (
    <div ref={wrapRef} class="tp-btn-group-wrap">
      <button
        class={`tp-btn has-sub ${isActive() ? 'active' : ''}`}
        disabled={toolDisabled()}
        onClick={onMainClick}
        title={props.title}
        aria-haspopup="menu"
        aria-expanded={isOpen() ? 'true' : 'false'}
        innerHTML={activeSub().icon}
      />
      <span class="tp-btn-chevron" aria-hidden="true">▸</span>
      <Show when={isOpen()}>
        <Portal>
          <div ref={menuRef} class={`tp-submenu ${sideClass()}`} style={submenuStyle()}>
            <For each={groupDef().subTools}>
              {(sub) => {
                const subActive = () =>
                  state.currentTool === sub.tool &&
                  overridesEqual(sub.overrides || null, state.toolOverrides || null);
                return (
                  <button
                    class={`tp-btn ${subActive() ? 'active' : ''}`}
                    disabled={toolDisabled()}
                    onClick={() => onSubClick(sub)}
                    title={subTitle(sub)}
                    innerHTML={sub.icon}
                  />
                );
              }}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

// --- Tool list with separators ---
function ExtToolList(props) {
  const { t } = useTranslation('ribbon');
  let lastGroup = -1;
  return (
    <For each={props.tools}>
      {(item) => {
        const showSep = lastGroup !== -1 && lastGroup !== item.group;
        lastGroup = item.group;
        // A function, so the tooltip follows a later language change (#882).
        const title = () => {
          const translated = item.translationKey ? t(item.translationKey) : null;
          return (translated && translated !== item.translationKey) ? translated : item.label;
        };
        const isGroup = Array.isArray(item.subTools) && item.subTools.length > 0;
        return (
          <>
            {showSep && <div class="tp-sep" />}
            <Show
              when={isGroup}
              fallback={
                <ExtToolBtn tool={item.tool} title={title()} icon={item.icon} overrides={item.overrides || null} />
              }
            >
              <ExtToolGroupBtn groupDef={item} title={title()} side={props.side} />
            </Show>
          </>
        );
      }}
    </For>
  );
}

// --- Grip SVG (shared) ---
function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16">
      <circle cx="3" cy="2" r="1.2" fill="currentColor"/><circle cx="7" cy="2" r="1.2" fill="currentColor"/>
      <circle cx="3" cy="6" r="1.2" fill="currentColor"/><circle cx="7" cy="6" r="1.2" fill="currentColor"/>
      <circle cx="3" cy="10" r="1.2" fill="currentColor"/><circle cx="7" cy="10" r="1.2" fill="currentColor"/>
      <circle cx="3" cy="14" r="1.2" fill="currentColor"/><circle cx="7" cy="14" r="1.2" fill="currentColor"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10">
      <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/>
      <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  );
}

// --- Docked palette ---
export function DockedExtPalette(props) {
  const id = () => props.descriptor.id;

  onMount(() => initExtPalette(id(), props.descriptor));

  const ps = () => getOrCreateState(id(), props.descriptor);
  const side = () => props.side;
  const shouldShow = () => ps().visible[0]() && ps().mode[0]() === `docked-${side()}`;

  return (
    <Show when={shouldShow()}>
      <div class={`tp-docked tp-ext tp-docked-${side()}${paletteIconSize() === 'large' ? ' tp-large' : ''}${props.descriptor.cssClass ? ' ' + props.descriptor.cssClass : ''}`} onContextMenu={showPaletteCtxMenu}>
        <div class="tp-grip" onMouseDown={(e) => startExtDrag(id(), e, true)}>
          <GripIcon />
        </div>
        <Show when={props.descriptor.logo}>
          <div class="tp-logo" innerHTML={props.descriptor.logo} />
        </Show>
        <div class="tp-docked-tools">
          <ExtToolList tools={props.descriptor.tools} side={side()} />
        </div>
        <button class="tp-close" onClick={() => {
          ps().visible[1](false);
          unregisterPaletteDock(id());
          savePalettePrefs(id());
        }}>
          <CloseIcon />
        </button>
      </div>
    </Show>
  );
}

// --- Floating palette ---
export function FloatingExtPalette(props) {
  const { t } = useTranslation('ribbon');
  const id = () => props.descriptor.id;
  const ps = () => getOrCreateState(id(), props.descriptor);
  const shouldShow = () => ps().visible[0]() && ps().mode[0]() === 'float';

  const title = () => {
    if (props.descriptor.translationKey) {
      const translated = t(props.descriptor.translationKey);
      return translated !== props.descriptor.translationKey ? translated : props.descriptor.label;
    }
    return props.descriptor.label;
  };

  return (
    <Show when={shouldShow()}>
      <div
        class={`tp-float tp-ext${paletteIconSize() === 'large' ? ' tp-large' : ''}${props.descriptor.cssClass ? ' ' + props.descriptor.cssClass : ''}`}
        style={`left:${ps().floatPos[0]().x}px; top:${ps().floatPos[0]().y}px`}
        onContextMenu={showPaletteCtxMenu}
      >
        <div class="tp-float-header" onMouseDown={(e) => {
          if (e.target.closest('.tp-float-close')) return;
          startExtDrag(id(), e, false);
        }}>
          <span class="tp-float-title">{title()}</span>
          <button class="tp-float-close" onClick={() => {
            ps().visible[1](false);
            unregisterPaletteDock(id());
            savePalettePrefs(id());
          }}>
            <svg width="8" height="8" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5"/>
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
        </div>
        <Show when={props.descriptor.logo}>
          <div class="tp-logo" innerHTML={props.descriptor.logo} />
        </Show>
        <div class="tp-float-body">
          <ExtToolList tools={props.descriptor.tools} side="float" />
        </div>
      </div>
    </Show>
  );
}

// --- Dock targets ---
export function ExtDockTargets(props) {
  const id = () => props.descriptor.id;
  const ps = () => getOrCreateState(id(), props.descriptor);

  return (
    <>
      <div class={`tp-dock-target tp-dock-target-left ${ps().isDragging[0]() ? 'visible' : ''} ${ps().dockPreview[0]() === 'left' ? 'active' : ''}`}>
        <div class="tp-dock-target-icon">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <rect x="1" y="1" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <rect x="1" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>
          </svg>
        </div>
      </div>
      <div class={`tp-dock-target tp-dock-target-right ${ps().isDragging[0]() ? 'visible' : ''} ${ps().dockPreview[0]() === 'right' ? 'active' : ''}`}>
        <div class="tp-dock-target-icon">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <rect x="1" y="1" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <rect x="13" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>
          </svg>
        </div>
      </div>
      <div class={`tp-dock-preview tp-dock-preview-left ${ps().dockPreview[0]() === 'left' ? 'active' : ''}`} />
      <div class={`tp-dock-preview tp-dock-preview-right ${ps().dockPreview[0]() === 'right' ? 'active' : ''}`} />
    </>
  );
}

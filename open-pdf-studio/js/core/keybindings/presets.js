// Ready-made keyboard shortcut sets (#886), chosen under Preferences >
// Keyboard Shortcuts > Load preset. A preset is a set of overrides in the
// same form as the preferences and the shortcuts file (io.js): only the
// commands whose keys differ from the defaults. Loading one replaces the
// working copy, like Import; Save applies it, Cancel throws it away.
//
// "Markup-style shortcuts" gives the single-letter drawing keys and the
// Alt+Shift measurement keys that are common in markup and takeoff tools
// for drawings (H highlight, R rectangle, Alt+Shift+L length, ...). Commands
// whose default key it takes over get another key (Hand moves to Shift+V,
// the annotations list to Alt+L); every other command keeps its default.
// Contextual tools, mouse gestures and reserved keys are not part of it.
//
// Pure data.

export const SHORTCUT_PRESETS = Object.freeze([
  Object.freeze({
    id: 'markup-style',
    labelKey: 'keyboardShortcuts.presets.markupStyle',
    label: 'Markup-style shortcuts',
    shortcuts: Object.freeze({
      'app.preferences': ['Ctrl+K'],
      'drafting.grid': ['Shift+F9'],
      'drafting.gridSnap': ['Ctrl+Shift+F9'],
      'file.close': ['Ctrl+F4'],
      'panels.annotationsList': ['Alt+L'],
      'panels.properties': ['Alt+P'],
      'ribbon:#dr-arrow': ['A'],
      'ribbon:#dr-cloud': ['C'],
      'ribbon:#dr-count': ['Alt+Shift+C'],
      'ribbon:#dr-image': ['I'],
      'ribbon:#dr-polyline': ['Shift+N'],
      'ribbon:#extract-pages': ['Ctrl+Shift+X'],
      'ribbon:#tool-callout': ['Q'],
      'ribbon:#tool-measure-angle': ['Alt+Shift+G'],
      'ribbon:#tool-measure-area': ['Alt+Shift+A'],
      'ribbon:#tool-measure-distance': ['Alt+Shift+L'],
      'ribbon:#tool-measure-perimeter': ['Alt+Shift+P'],
      'ribbon:#tool-stamp': ['S'],
      'tool.box': ['R'],
      'tool.circle': ['E'],
      'tool.comment': ['N'],
      'tool.draw': ['P'],
      'tool.hand': ['Shift+V'],
      'tool.highlight': ['H'],
      'tool.line': ['L'],
      'tool.select': ['V'],
      'tool.textbox': ['T'],
      'view.actualSize': ['Ctrl+8'],
      'view.fitPage': ['Ctrl+9'],
      'view.fitWidth': ['Ctrl+0'],
      'view.fullscreen': ['F11'],
      'view.nextPage': ['Ctrl+ArrowRight'],
      'view.previousPage': ['Ctrl+ArrowLeft'],
      'view.splitHorizontal': ['Ctrl+H'],
      'view.splitVertical': ['Ctrl+2'],
      'view.unsplit': ['Ctrl+Shift+2'],
    }),
  }),
]);

export function presetById(id) {
  return SHORTCUT_PRESETS.find((p) => p.id === id) || null;
}

/** A fresh, mutable copy of a preset's overrides (the working copy may be edited). */
export function presetOverrides(preset) {
  const uit = {};
  for (const [id, lijst] of Object.entries(preset?.shortcuts || {})) uit[id] = [...lijst];
  return uit;
}

function zelfdeSet(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  return ka.every((id) => {
    const x = a[id];
    const y = b?.[id];
    return Array.isArray(y) && x.length === y.length && x.every((c) => y.includes(c));
  });
}

/**
 * True when replacing the working copy `huidig` by `nieuw` (Import, Load
 * preset) would drop or change shortcuts the user set up: then the user is
 * asked first. Nothing to lose (only defaults, or the same set) asks nothing.
 */
export function vervangtEigenSneltoetsen(huidig, nieuw) {
  if (!huidig || Object.keys(huidig).length === 0) return false;
  return !zelfdeSet(huidig, nieuw);
}

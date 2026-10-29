// The built-in commands with a keyboard shortcut (#714), with the keys they
// have always had. These defaults are the keys that tools/keyboard-handlers.js
// (and main.js for Ctrl+P, proofreading-mode.js for F2) handle; that code
// still does the work and asks the registry whether its key still belongs to
// the command. default-commands.test.mjs holds the list of the keys as they
// were before #714 and checks that nothing changed.
//
// Labels reuse the existing translations where the app already names the
// command ('ns:key'); a trailing "(Ctrl+2)" in such a text is removed when it
// is shown (labels.js), the current shortcut is shown next to it instead.
//
// Pure data.

export const CATEGORY_ORDER = Object.freeze([
  'file', 'edit', 'view', 'search', 'tools', 'drafting', 'panels', 'review', 'help',
  'ribbon:home', 'ribbon:view', 'ribbon:drawing', 'ribbon:comment', 'ribbon:organize', 'ribbon:arrange', 'ribbon:help',
  'extensions',
]);

export const CORE_COMMANDS = Object.freeze([
  // File
  { id: 'file.new', category: 'file', labelKey: 'dialogs:newDoc.title', label: 'New Document', defaults: ['Ctrl+N'] },
  { id: 'file.open', category: 'file', labelKey: 'appMenu:open', label: 'Open', defaults: ['Ctrl+O'] },
  { id: 'file.save', category: 'file', labelKey: 'appMenu:save', label: 'Save', defaults: ['Ctrl+S'] },
  { id: 'file.saveAs', category: 'file', labelKey: 'appMenu:saveAs', label: 'Save As...', defaults: ['Ctrl+Shift+S'] },
  { id: 'file.print', category: 'file', labelKey: 'appMenu:print', label: 'Print', defaults: ['Ctrl+P'] },
  { id: 'file.close', category: 'file', labelKey: 'common:tabs.closeTab', label: 'Close tab', defaults: ['Ctrl+W'] },
  { id: 'file.properties', category: 'file', labelKey: 'appMenu:docProperties', label: 'Document Properties', defaults: ['Ctrl+D'] },
  { id: 'app.preferences', category: 'file', labelKey: 'appMenu:preferences', label: 'Preferences', defaults: ['Ctrl+,'] },

  // Edit
  { id: 'edit.undo', category: 'edit', labelKey: 'common:undo', label: 'Undo', defaults: ['Ctrl+Z'] },
  { id: 'edit.redo', category: 'edit', labelKey: 'common:redo', label: 'Redo', defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'edit.cut', category: 'edit', labelKey: 'common:cut', label: 'Cut', defaults: ['Ctrl+X'] },
  { id: 'edit.copy', category: 'edit', labelKey: 'common:copy', label: 'Copy', defaults: ['Ctrl+C'] },
  { id: 'edit.paste', category: 'edit', labelKey: 'common:paste', label: 'Paste', defaults: ['Ctrl+V'] },
  { id: 'edit.pasteInPlace', category: 'edit', labelKey: 'common:pasteInPlace', label: 'Paste in Place', defaults: ['Ctrl+Shift+V'] },
  { id: 'edit.selectAll', category: 'edit', labelKey: 'ribbon:drawing.selectAll', label: 'Select All', defaults: ['Ctrl+A'] },
  { id: 'edit.delete', category: 'edit', labelKey: 'context:deleteAnnotation.title', label: 'Delete Annotation', defaults: ['Delete'] },
  { id: 'edit.clearPage', category: 'edit', labelKey: 'ribbon:comment.clearPageAnnotations', label: 'Clear Page Annotations', defaults: ['Ctrl+Shift+C'] },

  // View
  { id: 'view.zoomIn', category: 'view', labelKey: 'ribbon:home.zoomIn', label: 'Zoom In', defaults: ['Ctrl+='] },
  { id: 'view.zoomOut', category: 'view', labelKey: 'ribbon:home.zoomOut', label: 'Zoom Out', defaults: ['Ctrl+-'] },
  { id: 'view.actualSize', category: 'view', labelKey: 'ribbon:home.actualSize', label: 'Actual Size', defaults: ['Ctrl+0'] },
  { id: 'view.fitWidth', category: 'view', labelKey: 'ribbon:home.fitWidth', label: 'Fit Width', defaults: ['Ctrl+1'] },
  { id: 'view.fitPage', category: 'view', labelKey: 'ribbon:home.fitPageLabel', label: 'Fit Page', defaults: ['Ctrl+2'] },
  { id: 'view.thinLines', category: 'view', labelKey: 'ribbon:view.thinLines', label: 'Thin Lines', defaults: ['Ctrl+5'] },
  { id: 'view.fullscreen', category: 'view', labelKey: 'ribbon:view.fullscreen', label: 'Fullscreen', defaults: ['Ctrl+L'] },
  { id: 'view.rotatePageRight', category: 'view', labelKey: 'ribbon:home.rotateRight', label: 'Rotate Right', defaults: ['Ctrl+Shift+=', 'Ctrl+Shift+NumpadAdd'] },
  { id: 'view.rotatePageLeft', category: 'view', labelKey: 'ribbon:home.rotateLeft', label: 'Rotate Left', defaults: ['Ctrl+Shift+-', 'Ctrl+Shift+NumpadSubtract'] },
  { id: 'view.nextPage', category: 'view', labelKey: 'common:pageNav.nextPage', label: 'Next Page', defaults: ['PageDown'] },
  { id: 'view.previousPage', category: 'view', labelKey: 'common:pageNav.previousPage', label: 'Previous Page', defaults: ['PageUp'] },
  // Split view (#858); the keys are recognised in split-view/split-sneltoets.js.
  { id: 'view.splitVertical', category: 'view', labelKey: 'ribbon:view.splitVertical', label: 'Split Vertical', defaults: ['Ctrl+\\'] },
  { id: 'view.splitHorizontal', category: 'view', labelKey: 'ribbon:view.splitHorizontal', label: 'Split Horizontal', defaults: ['Ctrl+Shift+\\'] },
  { id: 'view.unsplit', category: 'view', labelKey: 'ribbon:view.unsplit', label: 'Unsplit' },
  { id: 'view.splitPaneLarger', category: 'view', labelKey: 'preferences:keyboardShortcuts.commands.splitPaneLarger', label: 'Make Active Pane Larger' },
  { id: 'view.splitPaneSmaller', category: 'view', labelKey: 'preferences:keyboardShortcuts.commands.splitPaneSmaller', label: 'Make Active Pane Smaller' },

  // Find (also while typing in a text field)
  { id: 'search.find', category: 'search', labelKey: 'ribbon:home.find', label: 'Find', defaults: ['Ctrl+F'], allowInInput: true },
  { id: 'search.findNext', category: 'search', labelKey: 'preferences:keyboardShortcuts.commands.findNext', label: 'Find Next', defaults: ['F3'], allowInInput: true },

  // Tools (only with a document open)
  { id: 'tool.select', category: 'tools', labelKey: 'ribbon:home.select', label: 'Select', defaults: ['V'] },
  { id: 'tool.hand', category: 'tools', labelKey: 'ribbon:home.handTool', label: 'Hand Tool', defaults: ['H'] },
  { id: 'tool.highlight', category: 'tools', labelKey: 'ribbon:comment.highlight', label: 'Highlight', defaults: ['1'] },
  { id: 'tool.draw', category: 'tools', labelKey: 'ribbon:comment.freehand', label: 'Freehand', defaults: ['2'] },
  { id: 'tool.line', category: 'tools', labelKey: 'ribbon:comment.line', label: 'Line', defaults: ['3'] },
  { id: 'tool.box', category: 'tools', labelKey: 'ribbon:comment.rectangle', label: 'Rectangle', defaults: ['4'] },
  { id: 'tool.circle', category: 'tools', labelKey: 'ribbon:comment.ellipse', label: 'Ellipse', defaults: ['5'] },
  { id: 'tool.textbox', category: 'tools', labelKey: 'ribbon:comment.textBox', label: 'Text Box', defaults: ['T'] },
  { id: 'tool.comment', category: 'tools', labelKey: 'ribbon:comment.note', label: 'Note', defaults: ['N'] },

  // Drawing aids
  { id: 'drafting.objectSnap', category: 'drafting', labelKey: 'preferences:behavior.objectSnapping', label: 'Object Snapping', defaults: ['Shift+F3'], allowInInput: true },
  { id: 'drafting.grid', category: 'drafting', labelKey: 'preferences:behavior.showGridOverlay', label: 'Show Grid Overlay', defaults: ['F7'] },
  { id: 'drafting.gridSnap', category: 'drafting', labelKey: 'preferences:behavior.enableGridSnapping', label: 'Enable Grid Snapping', defaults: ['F9'] },
  { id: 'drafting.polarTracking', category: 'drafting', labelKey: 'preferences:behavior.enablePolarTracking', label: 'Enable polar tracking', defaults: ['F10'] },

  // Panels
  { id: 'panels.navigation', category: 'panels', labelKey: 'ribbon:view.navigationPanel', label: 'Navigation Panel', defaults: ['F8'] },
  { id: 'panels.annotationsList', category: 'panels', labelKey: 'ribbon:view.annotationsList', label: 'Annotations List', defaults: ['F11'] },
  { id: 'panels.properties', category: 'panels', labelKey: 'ribbon:view.propertiesPanel', label: 'Properties Panel', defaults: ['F12'] },

  // Review
  { id: 'review.proofreading', category: 'review', labelKey: 'ribbon:proofread.button', label: 'Proofread', defaults: ['F2'] },

  // Help
  { id: 'help.shortcuts', category: 'help', labelKey: 'preferences:keyboardShortcuts.title', label: 'Keyboard Shortcuts', defaults: ['F1'] },
]);

/**
 * Keys with a fixed meaning that are listed in the shortcuts overview (F1)
 * but cannot be changed (see RESERVED in dispatch.js).
 */
export const FIXED_SHORTCUTS = Object.freeze([
  { labelKey: 'common:tabs.nextTab', label: 'Next Tab', keys: ['Ctrl+Tab', 'Ctrl+PageDown'] },
  { labelKey: 'common:tabs.previousTab', label: 'Previous Tab', keys: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'] },
]);

/**
 * Ribbon buttons that run a built-in command: they share its shortcut (and
 * its tooltip shows it) instead of being listed a second time.
 */
export const RIBBON_ALIASES = Object.freeze({
  'btn-home-new': 'file.new',
  'tool-hand': 'tool.hand',
  'dr-pan': 'tool.hand',
  'tool-select': 'tool.select',
  'dr-select': 'tool.select',
  'zoom-in-ribbon': 'view.zoomIn',
  'zoom-out-ribbon': 'view.zoomOut',
  'fit-width': 'view.fitWidth',
  'actual-size-ribbon': 'view.actualSize',
  'fit-page-ribbon': 'view.fitPage',
  'ribbon-find': 'search.find',
  'ribbon-preferences': 'app.preferences',
  'thin-lines-toggle': 'view.thinLines',
  'ribbon-nav-panel': 'panels.navigation',
  'ribbon-properties-panel': 'panels.properties',
  'ribbon-annotations-list': 'panels.annotationsList',
  'ribbon-fullscreen': 'view.fullscreen',
  'prev-page-ribbon': 'view.previousPage',
  'next-page-ribbon': 'view.nextPage',
  'rotate-left': 'view.rotatePageLeft',
  'rotate-right': 'view.rotatePageRight',
  'dr-draw': 'tool.draw',
  'dr-line': 'tool.line',
  'dr-rect': 'tool.box',
  'dr-circle': 'tool.circle',
  'dr-text': 'tool.textbox',
  'tool-textbox': 'tool.textbox',
  'dr-note': 'tool.comment',
  'tool-comment': 'tool.comment',
  'tool-highlight': 'tool.highlight',
  'tool-proofread': 'review.proofreading',
  'ribbon-shortcuts': 'help.shortcuts',
  'dr-paste-in-place': 'edit.pasteInPlace',
});

// Scale stylesheet dimensions in the desktop chrome, leaving PDF layout,
// text/form layers, mobile styles and inline screen coordinates untouched.
// Context menus and the assistant keep their existing size: their separate
// popup/submenu positioning needs its own accessibility pass.
const files = new Set(['titlebar.css', 'app-menu.css', 'ribbon.css', 'document-tabs.css',
  'properties-panel.css', 'panels.css', 'dialogs.css',
  'tool-palette.css', 'symbol-palette.css', 'schedule-panel.css',
  'mini-log.css', 'status-bar.css', 'find-bar.css']);
const dimensions = /^(?:font-size|line-height|width|min-width|max-width|height|min-height|max-height|padding(?:-.+)?|margin(?:-.+)?|gap|row-gap|column-gap|top|right|bottom|left|flex-basis)$/;
export function scaleUiValue(property, value) {
  if (!dimensions.test(property) || value.includes('--ui-scale')) return value;
  return value.replace(/(-?(?:\d*\.)?\d+)px\b/g, (_, n) => Number(n) === 0 ? '0px' : `calc(${n}px * var(--ui-scale, 1))`);
}
export function uiScaleCss() {
  return { postcssPlugin: 'opds-ui-scale', Declaration(decl) {
    const file = decl.source?.input?.file?.replaceAll('\\', '/').split('/').at(-1);
    const selector = decl.parent?.selector || '';
    const leftPanel = file === 'layout.css' && /^\.(?:left-panel|panel-resize-handle)/.test(selector);
    if (files.has(file) || leftPanel) decl.value = scaleUiValue(decl.prop, decl.value);
  } };
}

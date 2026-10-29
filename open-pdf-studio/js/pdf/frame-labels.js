// Display names for drawing-frame styles in the New Document dialog.
//
// Frame files are named <stijl>_<formaat>_<richting>.pdf (see frames.js). The
// built-in styles have a translated name; any other prefix (user or tenant
// frames) keeps its own file-name prefix with a capital first letter. The
// list of built-in styles is explicit so a prefix such as "constructor" never
// reaches an object-property lookup in the translation tables.

export const BUILTIN_FRAME_STYLES = Object.freeze(['grootformaat', 'detailblad', 'voorblad']);

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Name shown for a frame style. `t` is a translator for the dialogs namespace. */
export function frameStyleLabel(style, t) {
  return BUILTIN_FRAME_STYLES.includes(style) ? t(`newDoc.frameStyles.${style}`) : capitalize(style);
}

/**
 * Caption under the page preview.
 * dims: { widthMm, heightMm, label }; frame: resolved frame or null;
 * orientation: 'portrait' | 'landscape'.
 */
export function framePreviewText({ dims, frame, orientation, t }) {
  if (!frame) return `${dims.widthMm} x ${dims.heightMm} mm (${dims.label})`;
  return t('newDoc.framePreview', {
    style: frameStyleLabel(frame.stijl, t),
    paper: dims.label,
    orientation: t(`newDoc.frameOrientation.${orientation === 'portrait' ? 'portrait' : 'landscape'}`),
    width: dims.widthMm,
    height: dims.heightMm,
  });
}

import { state, getActiveDocument, clearSelection, addToSelection } from '../../core/state.js';
import { copyStyleFromSelection, applyStyleToSelection } from '../../bridge.js';
import { flushPropertyChange } from '../../core/undo-manager.js';
import { isPdfAReadOnly } from '../../pdf/loader.js';
import { setTool } from '../manager.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';

// A captured style is immutable for one activation. Changing the selection as
// targets are painted must never turn a target into the next style source.
let session = null;

export function startStylePainter() {
  const doc = getActiveDocument();
  const source = doc?.selectedAnnotations?.[0] || doc?.selectedAnnotation;
  if (!doc?.pdfDoc || !source || isPdfAReadOnly() || state.isEditingText || state.pdfTextEditState) return false;
  const props = copyStyleFromSelection();
  if (!props) return false;
  flushPropertyChange();
  setTool('stylePainter');
  if (state.currentTool !== 'stylePainter') return false;
  session = { doc, props: { ...props }, visited: new Set([source.id]) };
  updateStatusMessage(i18next.t('properties:stylePresets.stylePainterHint'), 15000);
  return true;
}

function paint(ctx, e) {
  if (!session) return;
  if (session.doc !== getActiveDocument() || isPdfAReadOnly()) {
    session = null;
    setTool('select');
    return;
  }
  // Hover paints; navigation gestures (middle/right button or touch drag) do
  // not. The normal hit test also excludes hidden and locked-layer objects.
  if (e.buttons || e.pointerType === 'touch') return;
  const ann = ctx.findAnnotationAt(ctx.x, ctx.y, ctx.pageNum);
  if (!ann || ann.locked || session.visited.has(ann.id)) return;
  session.visited.add(ann.id);
  clearSelection();
  addToSelection(ann);
  applyStyleToSelection(session.props);
  // One undo step per target, even when the pointer crosses several targets
  // within the property panel's debounce interval.
  flushPropertyChange();
}

export const stylePainterTool = {
  name: 'stylePainter',
  cursor: 'copy',
  onPointerMove: paint,
  onPointerDown(ctx, e) {
    if (e.button === 2) { session = null; setTool('select'); }
  },
  onEscape() { session = null; },
  onDeactivate() { session = null; updateStatusMessage(''); },
};

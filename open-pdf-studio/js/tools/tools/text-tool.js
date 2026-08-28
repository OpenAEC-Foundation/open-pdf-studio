import { applyToolTransform } from '../tool-context.js';
import { SYMBOL_STAMP_DEFAULT_SIZE } from '../../annotations/stamp-defaults.js';
import { svgRealSizeMm, stampPlacementSize } from '../../annotations/svg-real-size.js';
import { stampPxPerMm } from '../../annotations/stamp-scale.js';
import { getActiveDocument } from '../../core/state.js';

/**
 * Text tools — comment, text, stamp, signature, editText
 * These are single-click placement tools that delegate to existing modules
 */
export const commentTool = {
  name: 'comment',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    ctx.addComment(ctx.x, ctx.y);
    // Auto-reset to select tool
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },
};

export const textTool = {
  name: 'text',
  cursor: 'text',

  onPointerDown(ctx) {
    const { state, pageNum, canvas } = ctx;
    if (ctx.viewMode === 'continuous') {
      ctx.addTextAnnotation(ctx.x, ctx.y, pageNum, canvas);
    } else {
      ctx.addTextAnnotation(ctx.x, ctx.y);
    }
  },
};

export const stampTool = {
  name: 'stamp',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e && e.button === 2) return;
    const { state } = ctx;
    if (state.toolOverrides?.stampSvg || state.toolOverrides?.stampImage) {
      ctx.placeOverrideStamp(ctx.x, ctx.y);
      // Auto-reset to select tool
      import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
    } else {
      ctx.showStampPicker(ctx.x, ctx.y);
    }
  },

  onPointerMove(ctx) {
    const { state } = ctx;
    const previewImg = state.toolOverrides?._previewImg;
    if (!previewImg || !ctx.canvasCtx) return;

    // Zelfde maatbepaling als placeOverrideStamp, zodat de spookafbeelding
    // onder de cursor precies dekt wat er straks geplaatst wordt.
    const ov = state.toolOverrides;
    const page = getActiveDocument()?.currentPage || 1;
    const { width: w, height: h } = stampPlacementSize({
      mm: svgRealSizeMm(ov.stampSvg),
      pxPerMm: stampPxPerMm(page, ctx.x, ctx.y),
      aspect: previewImg.naturalWidth / previewImg.naturalHeight,
      defaultWidth: ov.stampWidth,
      defaultHeight: ov.stampHeight || SYMBOL_STAMP_DEFAULT_SIZE,
    });

    // Redraw existing annotations then overlay the preview
    ctx.redraw();

    const canvasCtx = ctx.canvasCtx;
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.globalAlpha = 0.6;
    canvasCtx.drawImage(previewImg, ctx.x - w / 2, ctx.y - h / 2, w, h);
    canvasCtx.restore();
  },

  onDeactivate(ctx) {
    // Clear preview when switching away from stamp tool
    ctx.redraw();
  },
};

export const signatureTool = {
  name: 'signature',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    ctx.showSignatureDialog(ctx.x, ctx.y);
    // Auto-reset to select tool
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },
};

export const editTextTool = {
  name: 'editText',
  cursor: 'text',

  onPointerDown(ctx) {
    const { x, y, pageNum, canvas } = ctx;
    const hitEdit = ctx.findTextEditAtPosition(x, y, pageNum, canvas);
    if (hitEdit) {
      ctx.startTextEditEditing(hitEdit, pageNum, canvas);
    }
  },
};

import { applyToolTransform } from '../tool-context.js';
import { overrideStampMaat } from '../../annotations/svg-real-size.js';
import { huidigeSymboolSchaal } from '../../symbols/symbol-scale-store.js';
import { symbolInsertPreviewStyle } from '../../symbols/symbol-insert-format-store.js';
import { stampPxPerMm } from '../../annotations/stamp-scale.js';
import { getActiveDocument } from '../../core/state.js';
import { zetRechtopRond } from '../../pdf/weergave-ruimte.js';
import { blendCanvasWaarde } from '../../annotations/blend-modes.js';

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

// Bijlage-annotatie (#376): klik, kies een bestand, het pictogram staat er.
export const fileAttachmentTool = {
  name: 'fileAttachment',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e && (e.button === 2 || e.detail === 2)) return;
    const { x, y, pageNum } = ctx;
    import('../../ui/bijlage-annotaties.js')
      .then((m) => m.plaatsBijlageAnnotatie(x, y, pageNum))
      .catch((err) => console.error('[fileAttachment] place failed', err))
      .finally(() => import('../../tools/manager.js').then((m) => m.maybeRevertToSelect && m.maybeRevertToSelect()));
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
    // onder de cursor precies dekt wat er straks geplaatst wordt — ook met
    // de gekozen symboolschaal uit het palet (issue #357).
    const ov = state.toolOverrides;
    const page = getActiveDocument()?.currentPage || 1;
    const { width: w, height: h } = overrideStampMaat(ov, {
      pxPerMm: stampPxPerMm(page, ctx.x, ctx.y),
      aspect: previewImg.naturalWidth / previewImg.naturalHeight,
      schaal: huidigeSymboolSchaal(),
    });

    // Redraw existing annotations then overlay the preview
    ctx.redraw();

    const canvasCtx = ctx.canvasCtx;
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    // Zoals hij geplaatst wordt: rechtop op het scherm, ook gedraaid (#200).
    zetRechtopRond(canvasCtx, ctx.x, ctx.y);
    // Gekozen dekking en mengmodus uit de invoegsessie (#587) tellen mee;
    // kleur en lijndikte zitten al in het voorbeeldraster.
    const stijl = symbolInsertPreviewStyle();
    canvasCtx.globalAlpha = 0.6 * stijl.opacity;
    canvasCtx.globalCompositeOperation = blendCanvasWaarde(stijl.blendMode);
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

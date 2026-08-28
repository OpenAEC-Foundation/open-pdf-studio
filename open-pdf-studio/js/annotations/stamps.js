import { state, getActiveDocument, imageCache } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { openDialog } from '../bridge.js';
import { BUILTIN_STAMP_DEFAULT_WIDTH, BUILTIN_STAMP_DEFAULT_HEIGHT, OVERRIDE_STAMP_DEFAULT_HEIGHT } from './stamp-defaults.js';
import { svgRealSizeMm, stampPlacementSize } from './svg-real-size.js';
import { stampPxPerMm } from './stamp-scale.js';

// Built-in stamp definitions
export const BUILT_IN_STAMPS = [
  { name: 'Approved', color: '#22c55e', text: 'APPROVED' },
  { name: 'Rejected', color: '#ef4444', text: 'REJECTED' },
  { name: 'Draft', color: '#3b82f6', text: 'DRAFT' },
  { name: 'Confidential', color: '#ef4444', text: 'CONFIDENTIAL' },
  { name: 'Final', color: '#22c55e', text: 'FINAL' },
  { name: 'For Review', color: '#f59e0b', text: 'FOR REVIEW' },
  { name: 'Not Approved', color: '#ef4444', text: 'NOT APPROVED' },
  { name: 'Void', color: '#6b7280', text: 'VOID' },
  { name: 'As Is', color: '#6b7280', text: 'AS IS' },
  { name: 'Revised', color: '#8b5cf6', text: 'REVISED' }
];

// Show stamp picker dialog
export function showStampPicker(x, y) {
  openDialog('stamp-picker', {
    onSelect: (stamp) => placeStamp(stamp, x, y),
    onCustom: () => loadCustomStamp(x, y)
  });
}

// Place a built-in stamp
function placeStamp(stamp, x, y) {
  if (!getActiveDocument()?.pdfDoc) return;

  const width = BUILTIN_STAMP_DEFAULT_WIDTH;
  const height = BUILTIN_STAMP_DEFAULT_HEIGHT;

  const ann = createAnnotation({
    type: 'stamp',
    page: getActiveDocument()?.currentPage || 1,
    x: x - width / 2,
    y: y - height / 2,
    width: width,
    height: height,
    stampName: stamp.name,
    stampText: stamp.text,
    stampColor: stamp.color,
    color: stamp.color,
    strokeColor: stamp.color,
    opacity: 0.85,
    rotation: 0
  });

  const _doc = getActiveDocument();
  if (_doc) _doc.annotations.push(ann);
  recordAdd(ann);

  if (state.preferences.autoSelectAfterCreate) {
    if (_doc) { _doc.selectedAnnotation = ann; _doc.selectedAnnotations = [ann]; }
    showProperties(ann);
  }

  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage(`Stamp "${stamp.name}" placed`);
}

// When an SVG references external images via <image href="http(s):..."> or
// <image xlink:href="...">, those sub-resources are NOT reliably loaded when the
// SVG itself is loaded as an <img src="blob:..."> (security context + onload
// timing race). Pre-fetch each external href and inline it as a data: URL so
// the rasterized PNG actually contains the symbol instead of a broken-image
// placeholder. NEN 1414 symbols rely on this.
async function inlineSvgExternalImages(svgString) {
  if (!/<image\b[^>]*\bhref=/i.test(svgString)) return svgString;
  const hrefRegex = /(<image\b[^>]*\b(?:xlink:href|href)=)(["'])([^"']+)\2/gi;
  const matches = [...svgString.matchAll(hrefRegex)];
  const replacements = await Promise.all(matches.map(async (m) => {
    const url = m[3];
    if (url.startsWith('data:')) return null; // already inline
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      return { match: m[0], replacement: m[1] + m[2] + dataUrl + m[2] };
    } catch (_) {
      return null;
    }
  }));
  let out = svgString;
  for (const r of replacements) if (r) out = out.replace(r.match, r.replacement);
  return out;
}

// Rasterize an SVG string to a PNG data URL for PDF embedding
async function rasterizeSvg(svgString) {
  const inlined = await inlineSvgExternalImages(svgString);
  return new Promise((resolve) => {
    const blob = new Blob([inlined], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const svgImg = new Image();
    svgImg.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 3;
      // SVG without explicit width/height in xml may report naturalWidth=0 in
      // some engines — fall back to a sane default based on viewBox or 64.
      const naturalW = svgImg.naturalWidth || 64;
      const naturalH = svgImg.naturalHeight || 64;
      canvas.width = naturalW * scale;
      canvas.height = naturalH * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(svgImg, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/png');
      // Create a proper rasterized PNG image for reliable canvas rendering
      const pngImg = new Image();
      pngImg.onload = () => resolve({ img: pngImg, dataUrl });
      pngImg.onerror = () => resolve({ img: svgImg, dataUrl });
      pngImg.src = dataUrl;
    };
    svgImg.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    svgImg.src = url;
  });
}

// Place a preconfigured image stamp from tool overrides (used by extensions).
// Supports stampSvg (SVG string) or stampImage (data URL) in state.toolOverrides.
export async function placeOverrideStamp(x, y) {
  if (!getActiveDocument()?.pdfDoc) return;

  const overrides = state.toolOverrides;
  if (!overrides?.stampSvg && !overrides?.stampImage) {
    updateStatusMessage('No stamp data provided');
    return;
  }

  let img, dataUrl;

  if (overrides.stampSvg) {
    const result = await rasterizeSvg(overrides.stampSvg);
    if (!result) {
      updateStatusMessage('Failed to render stamp SVG');
      return;
    }
    img = result.img;
    dataUrl = result.dataUrl;
  } else {
    // stampImage is already a data URL (PNG/JPG)
    img = new Image();
    img.src = overrides.stampImage;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    dataUrl = overrides.stampImage;
  }

  const aspect = img.naturalWidth / img.naturalHeight;
  let stampHeight, stampWidth, stampX, stampY;

  if (overrides.stampFillPage) {
    // Fill the page with margin
    const canvas = document.getElementById('annotation-canvas') || document.getElementById('pdf-canvas');
    const doc = getActiveDocument();
    const stampScale = doc?.scale || 1.5;
    const dpr = window.devicePixelRatio || 1;
    const pageW = canvas ? canvas.width / (stampScale * dpr) : 600;
    const pageH = canvas ? canvas.height / (stampScale * dpr) : 800;
    const margin = overrides.stampPageMargin || 20;
    stampWidth = Math.round(pageW - margin * 2);
    stampHeight = Math.round(pageH - margin * 2);
    stampX = margin;
    stampY = margin;
  } else {
    // Declareert de SVG-root een echte eenheid (bv. width="65mm"), dan telt
    // die maat, omgerekend met de plaatselijke tekeningschaal. Zonder echte
    // maat (alle meegeleverde symbolen) blijft het bestaande gedrag gelden:
    // de standaardhoogte, met de breedte uit de beeldverhouding.
    const page = getActiveDocument()?.currentPage || 1;
    const size = stampPlacementSize({
      mm: svgRealSizeMm(overrides.stampSvg),
      pxPerMm: stampPxPerMm(page, x, y),
      aspect,
      defaultWidth: overrides.stampWidth,
      defaultHeight: overrides.stampHeight || OVERRIDE_STAMP_DEFAULT_HEIGHT,
    });
    stampWidth = size.width;
    stampHeight = size.height;
    stampX = x - stampWidth / 2;
    stampY = y - stampHeight / 2;
  }

  const imageId = 'stamp_' + Date.now();
  imageCache.set(imageId, img);

  // Also store on a non-reactive property for rendering perf
  const _imgRef = img;

  const ann = createAnnotation({
    type: 'stamp',
    page: getActiveDocument()?.currentPage || 1,
    x: stampX,
    y: stampY,
    width: stampWidth,
    height: stampHeight,
    stampName: overrides.stampName || 'Custom',
    stampText: '',
    stampSvg: overrides.stampSvg || null,
    // Original (unedited) source SVG for this symbol type. Kept so the
    // "Edit Type" editor can resolve/update the correct type override even
    // after the stamp's rendered geometry has been replaced.
    stampBaseSvg: overrides.stampBaseSvg || overrides.stampSvg || null,
    stampSvgBuilder: overrides.stampSvgBuilder || null,
    imageId: imageId,
    imageData: dataUrl,
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    color: '#000000',
    opacity: 1,
    rotation: 0,
    lockAspectRatio: overrides.lockAspectRatio !== false,
    // IFC-categorie uit de symbool-metadata (mapping-laag) → hoeveelheden.
    ifcCategory: overrides.ifcCategory || undefined,
    // Palette-symbool-id (bv. 'nen1414-Tb1.003') + IFC PredefinedType,
    // zodat saver/loader en het IFC-report de herkomst behouden.
    symbolId: overrides.symbolId || undefined,
    ifcPredefinedType: overrides.ifcPredefinedType || undefined,
  });

  // Store image reference directly on annotation for rendering
  ann._cachedImg = _imgRef;

  // Copy custom fields (e.g., tb* for title blocks)
  for (const key of Object.keys(overrides)) {
    if (key.startsWith('tb')) ann[key] = overrides[key];
  }

  const _doc2 = getActiveDocument();
  if (_doc2) _doc2.annotations.push(ann);
  recordAdd(ann);

  if (state.preferences.autoSelectAfterCreate) {
    if (_doc2) { _doc2.selectedAnnotation = ann; _doc2.selectedAnnotations = [ann]; }
    showProperties(ann);
  }

  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();

  updateStatusMessage(`${overrides.stampName || 'Stamp'} placed`);
}

/**
 * Re-rasterize a stamp annotation from a new SVG string and update its image.
 */
export async function updateStampImage(ann, svgString) {
  const result = await rasterizeSvg(svgString);
  if (!result) return;
  const imageId = 'stamp_' + Date.now();
  imageCache.set(imageId, result.img);
  ann.imageId = imageId;
  ann.imageData = result.dataUrl;
  ann.originalWidth = result.img.naturalWidth;
  ann.originalHeight = result.img.naturalHeight;
  ann.modifiedAt = new Date().toISOString();
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// Load custom stamp from image file
async function loadCustomStamp(x, y) {
  try {
    const { openFileDialog } = await import('../core/platform.js');
    const filePath = await openFileDialog(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'svg']);
    if (!filePath) return;

    const { readBinaryFile } = await import('../core/platform.js');
    const data = await readBinaryFile(filePath);
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

    const { generateImageId } = await import('../utils/helpers.js');
    const imageId = generateImageId();
    imageCache.set(imageId, img);

    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const maxSize = 200;
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width *= ratio;
      height *= ratio;
    }

    const ann = createAnnotation({
      type: 'stamp',
      page: getActiveDocument()?.currentPage || 1,
      x: x - width / 2,
      y: y - height / 2,
      width: width,
      height: height,
      stampName: 'Custom',
      stampText: '',
      imageId: imageId,
      imageData: url,
      originalWidth: img.naturalWidth,
      originalHeight: img.naturalHeight,
      color: '#000000',
      opacity: 1,
      rotation: 0
    });

    const _doc3 = getActiveDocument();
    if (_doc3) _doc3.annotations.push(ann);
    recordAdd(ann);

    if (state.preferences.autoSelectAfterCreate) {
      if (_doc3) { _doc3.selectedAnnotation = ann; _doc3.selectedAnnotations = [ann]; }
      showProperties(ann);
    }

    if (getActiveDocument()?.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    updateStatusMessage('Custom stamp placed');
  } catch (err) {
    console.error('Failed to load custom stamp:', err);
  }
}

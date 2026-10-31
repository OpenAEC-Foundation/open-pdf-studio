import { huidigeSymboolSchaal } from '../symbols/symbol-scale-store.js';
import { symbolInsertStampFormat } from '../symbols/symbol-insert-format-store.js';
import { state, getActiveDocument, imageCache } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { openDialog } from '../bridge.js';
import { BUILTIN_STAMP_DEFAULT_WIDTH, BUILTIN_STAMP_DEFAULT_HEIGHT, BUILT_IN_STAMPS } from './stamp-defaults.js';
import { overrideStampMaat } from './svg-real-size.js';
import { stampPxPerMm } from './stamp-scale.js';
import { rasterizeSvg } from './svg-raster.js';
import { AFBEELDING_EXTENSIES } from './afbeelding-bron.js';
import { paginaMaat, rechtopRotatie } from '../pdf/weergave-ruimte.js';

// Built-in stamp definitions
// (in stamp-defaults.js, zodat ook de loader ze kan lezen)
export { BUILT_IN_STAMPS };

// Show stamp picker dialog
export function showStampPicker(x, y) {
  openDialog('stamp-picker', {
    onSelect: (stamp) => placeStamp(stamp, x, y),
    onCustom: () => loadCustomStamp(x, y),
    // Template with fields (#629): date, user, page ... and own fields.
    onDynamic: (template) => import('./dynamic-stamp-place.js')
      .then((m) => m.placeDynamicStamp(template, x, y))
      .catch((err) => console.error('Failed to place dynamic stamp:', err)),
    onManage: () => openDialog('stamp-templates', {})
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
    // Rechtop op het scherm, ook in een gedraaide weergave (#200).
    rotation: rechtopRotatie()
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
    // Paginamaat in de paginaruimte; het canvas is in de viewport-weergave het
    // venster en kan gedraaid zijn (#200) — alleen nog als terugval.
    const maat = paginaMaat(doc?.currentPage || 1, doc);
    const pageW = maat ? maat.breedte : (canvas ? canvas.width / (stampScale * dpr) : 600);
    const pageH = maat ? maat.hoogte : (canvas ? canvas.height / (stampScale * dpr) : 800);
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
    // Zelfde berekening als de spookafbeelding van het stempelgereedschap
    // (tools/text-tool.js), inclusief de gekozen symboolschaal (#357).
    const size = overrideStampMaat(overrides, {
      pxPerMm: stampPxPerMm(page, x, y),
      aspect,
      schaal: huidigeSymboolSchaal(),
    });
    stampWidth = size.width;
    stampHeight = size.height;
    stampX = x - stampWidth / 2;
    stampY = y - stampHeight / 2;
  }

  // Opmaak uit de invoegsessie (#587): kleur en lijndikte gaan de SVG-bron
  // in (een symbool wordt als raster getekend), dekking en mengmodus op de
  // annotatie. De lijndikte rekent met de werkelijke plaatsingsbreedte; de
  // beeldverhouding verandert niet, dus de maat hierboven blijft geldig.
  let stampSvg = overrides.stampSvg || null;
  const opmaak = stampSvg ? symbolInsertStampFormat(overrides, stampWidth) : null;
  if (opmaak && opmaak.svg && opmaak.svg !== stampSvg) {
    const opgemaakt = await rasterizeSvg(opmaak.svg);
    if (opgemaakt) {
      img = opgemaakt.img;
      dataUrl = opgemaakt.dataUrl;
      stampSvg = opmaak.svg;
    }
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
    stampSvg,
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
    ...(opmaak ? opmaak.props : {}),
    // Rechtop op het scherm in een gedraaide weergave (#200); een stempel die
    // de pagina vult, volgt de pagina.
    rotation: overrides.stampFillPage ? 0 : rechtopRotatie(),
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

// Load custom stamp from image file.
// Same loader as an inserted image (#749): imageData is a PNG/JPEG data URL
// that the saver embeds in the appearance stream, and the bitmap comes from
// that data URL. It used to be an untyped blob: URL — an SVG did not load at
// all (no stamp on the page), and a GIF/BMP/SVG could not be embedded, so the
// stamp was gone after save and reopen.
async function loadCustomStamp(x, y) {
  try {
    const { openFileDialog } = await import('../core/platform.js');
    const filePath = await openFileDialog(AFBEELDING_EXTENSIES);
    if (!filePath || typeof filePath !== 'string') return;

    const { laadAfbeeldingUitPad } = await import('./image-drop.js');
    const { img, dataUrl } = await laadAfbeeldingUitPad(filePath);

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
      imageData: dataUrl,
      originalWidth: img.naturalWidth,
      originalHeight: img.naturalHeight,
      color: '#000000',
      opacity: 1,
      // Rechtop op het scherm, ook in een gedraaide weergave (#200).
      rotation: rechtopRotatie(),
      lockAspectRatio: true
    });
    ann._cachedImg = img;

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
    updateStatusMessage('Could not load the image for the stamp');
  }
}

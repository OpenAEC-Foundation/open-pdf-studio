export function normalizePageRotation(rotation) {
  const normalized = ((Number(rotation) || 0) % 360 + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

export function getPageRotationMatrix(pageWidth, pageHeight, rotation) {
  switch (normalizePageRotation(rotation)) {
    case 90:
      return [0, 1, -1, 0, pageHeight, 0];
    case 180:
      return [-1, 0, 0, -1, pageWidth, pageHeight];
    case 270:
      return [0, -1, 1, 0, 0, pageWidth];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

export function getTextLayerCssMatrix(
  pageWidth,
  pageHeight,
  rotation,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
) {
  const [a, b, c, d, e, f] = getPageRotationMatrix(pageWidth, pageHeight, rotation);
  return [
    a * zoom,
    b * zoom,
    c * zoom,
    d * zoom,
    offsetX + e * zoom,
    offsetY + f * zoom,
  ];
}

export function applyPageRotation(x, y, pageWidth, pageHeight, rotation) {
  const [a, b, c, d, e, f] = getPageRotationMatrix(pageWidth, pageHeight, rotation);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export function invertPageRotation(x, y, pageWidth, pageHeight, rotation) {
  switch (normalizePageRotation(rotation)) {
    case 90:
      return { x: y, y: pageHeight - x };
    case 180:
      return { x: pageWidth - x, y: pageHeight - y };
    case 270:
      return { x: pageWidth - y, y: x };
    default:
      return { x, y };
  }
}

export function getRotatedPageSize(pageWidth, pageHeight, rotation) {
  const quarterTurn = normalizePageRotation(rotation) % 180 !== 0;
  return quarterTurn
    ? { width: pageHeight, height: pageWidth }
    : { width: pageWidth, height: pageHeight };
}

export function resolveTextEditPageGeometry(dims, displayWidth, displayHeight, extraRotation = 0) {
  const intrinsicRotation = Number(dims?.rotation) || 0;
  const rotation = normalizePageRotation(intrinsicRotation + extraRotation);
  const hasStoredDimensions = Number(dims?.widthPt) > 0 && Number(dims?.heightPt) > 0;
  const pageWidth = hasStoredDimensions
    ? Number(dims.widthPt)
    : (rotation % 180 ? displayHeight : displayWidth);
  const pageHeight = hasStoredDimensions
    ? Number(dims.heightPt)
    : (rotation % 180 ? displayWidth : displayHeight);
  const displaySize = getRotatedPageSize(pageWidth, pageHeight, rotation);
  return {
    pageWidth,
    pageHeight,
    rotation,
    displayWidth: displaySize.width,
    displayHeight: displaySize.height,
  };
}

export function elementRectToCanvasPixels(elementRect, canvasRect, canvasWidth, canvasHeight) {
  if (!canvasRect?.width || !canvasRect?.height || !canvasWidth || !canvasHeight) return null;
  const scaleX = canvasWidth / canvasRect.width;
  const scaleY = canvasHeight / canvasRect.height;
  const left = Math.max(0, Math.floor((elementRect.left - canvasRect.left) * scaleX));
  const top = Math.max(0, Math.floor((elementRect.top - canvasRect.top) * scaleY));
  const right = Math.min(canvasWidth, Math.ceil((elementRect.right - canvasRect.left) * scaleX));
  const bottom = Math.min(canvasHeight, Math.ceil((elementRect.bottom - canvasRect.top) * scaleY));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function componentHex(value) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
}

export function selectTextColor(pixels, fallback = '#000000', width = 0, height = 0) {
  if (!pixels || pixels.length < 4) return fallback;
  const clusters = new Map();
  const hasBounds = width > 1 && height > 1 && width * height * 4 <= pixels.length;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 32) continue;
    if (hasBounds) {
      const pixelIndex = i / 4;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
    }
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const key = `${r >> 3},${g >> 3},${b >> 3}`;
    const cluster = clusters.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    cluster.count++;
    cluster.r += r;
    cluster.g += g;
    cluster.b += b;
    clusters.set(key, cluster);
  }

  if (clusters.size === 0) return fallback;
  const background = [...clusters.values()].reduce((largest, cluster) =>
    !largest || cluster.count > largest.count ? cluster : largest
  , null);
  const backgroundColor = [
    background.r / background.count,
    background.g / background.count,
    background.b / background.count,
  ];

  let best = null;
  let bestDistance = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 32) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const distance = (backgroundColor[0] - r) ** 2
      + (backgroundColor[1] - g) ** 2
      + (backgroundColor[2] - b) ** 2;
    if (distance > bestDistance) {
      bestDistance = distance;
      best = [r, g, b];
    }
  }

  if (!best || bestDistance <= 3 * 4 ** 2) return fallback;
  const [r, g, b] = best;
  if (Math.max(r, g, b) <= 24 && Math.max(r, g, b) - Math.min(r, g, b) <= 4) {
    return '#000000';
  }
  return `#${componentHex(r)}${componentHex(g)}${componentHex(b)}`;
}

// ── WinAnsi-sanering ──
// pdf-lib's Standard-14-fonts encoderen via WinAnsi (cp1252). Eén teken
// daarbuiten (≤, Cyrillisch, ligaturen, U+FFFD …) liet voorheen de HELE
// savePDF() falen. Deze helper vervangt per teken door een naaste
// WinAnsi-equivalent, of '?' als er geen zinvolle vervanging is.

// Unicode-codepoints van de cp1252-tekens boven 0x7F (het 0x80–0x9F-blok).
const WINANSI_EXTRA = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
  0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
]);

// Naaste-equivalent-vervangingen voor veelvoorkomende niet-WinAnsi-tekens.
const WINANSI_REPLACEMENTS = new Map([
  ['≤', '<='], // less-than or equal
  ['≥', '>='], // greater-than or equal
  ['≠', '!='], // not equal
  ['−', '-'],  // minus sign
  ['→', '->'], // rightwards arrow
  ['←', '<-'], // leftwards arrow
  ['➔', '->'], // heavy rightwards arrow
  ['⇒', '=>'], // rightwards double arrow
  ['⁄', '/'],  // fraction slash
  ['∕', '/'],  // division slash
  ['‑', '-'],  // non-breaking hyphen
  [' ', ' '],  // thin space
  [' ', ' '],  // hair space
  [' ', ' '],  // narrow no-break space
  [' ', ' '],  // figure space
  ['​', ''],   // zero-width space
  ['﻿', ''],   // BOM / zero-width no-break space
  ['ﬀ', 'ff'],  // ff-ligatuur
  ['ﬁ', 'fi'],  // fi-ligatuur
  ['ﬂ', 'fl'],  // fl-ligatuur
  ['ﬃ', 'ffi'], // ffi-ligatuur
  ['ﬄ', 'ffl'], // ffl-ligatuur
  ['′', "'"],  // prime
  ['″', '"'],  // double prime
  ['ʼ', "'"],  // modifier apostrophe
]);

export function isWinAnsiCodePoint(cp) {
  if (cp === 0x0A || cp === 0x0D || cp === 0x09) return true; // regelstructuur
  if (cp >= 0x20 && cp <= 0x7E) return true;
  if (cp >= 0xA0 && cp <= 0xFF) return true;
  return WINANSI_EXTRA.has(cp);
}

// Vervangt niet-WinAnsi-tekens door een naaste equivalent (of '?').
// Retourneert { text, replaced } waarbij replaced de originele tekens bevat.
export function sanitizeWinAnsiText(text) {
  const input = String(text ?? '');
  let out = '';
  const replaced = [];
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (isWinAnsiCodePoint(cp)) {
      out += ch;
      continue;
    }
    const repl = WINANSI_REPLACEMENTS.has(ch) ? WINANSI_REPLACEMENTS.get(ch) : '?';
    out += repl;
    replaced.push(ch);
  }
  return { text: out, replaced };
}

// ── Tekst-richting (glyph-hoek) ──
// De span-matrix [a,b,c,d,e,f] bevat de baseline-richting van de originele
// tekstrun. Tekst die authored is voor een /Rotate-pagina — of intrinsiek
// geroteerde labels — heeft a/b ≠ [1,0]. De hoek (graden, CCW in PDF-ruimte)
// moet mee in het edit-record zodat painter én saver de vervangtekst in
// dezelfde richting zetten als het origineel.
export function textEditAngleFromTransform(transform) {
  if (!Array.isArray(transform) || transform.length < 4) return 0;
  const [a, b] = transform;
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return 0;
  const deg = Math.atan2(b, a) * 180 / Math.PI;
  // Snap vrijwel-rechte hoeken zodat float-ruis geen schuine tekst geeft.
  const snapped = Math.round(deg / 90) * 90;
  return Math.abs(deg - snapped) <= 1 ? ((snapped % 360) + 360) % 360 : ((deg % 360) + 360) % 360;
}

// Ankerpunt (PDF-user-space) van regel i van een edit, rekening houdend met
// de tekst-richting: regels verschuiven loodrecht op de baseline.
export function textEditLineAnchor(pdfX, pdfY, lineIndex, lineSpacing, angleDeg = 0) {
  if (!angleDeg) return { x: pdfX, y: pdfY - lineIndex * lineSpacing };
  const rad = angleDeg * Math.PI / 180;
  const down = lineIndex * lineSpacing;
  return {
    x: pdfX + down * Math.sin(rad),
    y: pdfY - down * Math.cos(rad),
  };
}

// ── Per-regel stijl ──
// Het edit-record kan per regel de oorspronkelijke stijl bewaren
// (lineStyles[i] = { fontFamily, fontSize, color, loadedFontName }).
// Deze resolver valt terug op de record-brede stijl; extra regels (meer
// nieuwe dan originele regels) krijgen de stijl van de laatste bekende regel.
export function resolveTextEditLineStyle(edit, lineIndex) {
  const base = {
    fontFamily: edit?.fontFamily || 'Helvetica',
    fontSize: edit?.fontSize,
    color: edit?.color || '#000000',
    loadedFontName: edit?.loadedFontName || '',
  };
  const styles = edit?.lineStyles;
  if (!Array.isArray(styles) || styles.length === 0) return base;
  const entry = styles[Math.min(lineIndex, styles.length - 1)];
  if (!entry) return base;
  return {
    fontFamily: entry.fontFamily || base.fontFamily,
    fontSize: Number(entry.fontSize) > 0 ? Number(entry.fontSize) : base.fontSize,
    color: entry.color || base.color,
    loadedFontName: entry.loadedFontName ?? base.loadedFontName,
  };
}

export function restoreTextEditSnapshot(record, snapshot) {
  if (!record || !snapshot) return;
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(snapshot, key)) delete record[key];
  }
  Object.assign(record, snapshot);
}

export function sampleTextColor(canvas, elementRect, fallback = '#000000') {
  if (!canvas || !elementRect) return fallback;
  try {
    const bounds = elementRectToCanvasPixels(
      elementRect,
      canvas.getBoundingClientRect(),
      canvas.width,
      canvas.height,
    );
    if (!bounds) return fallback;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return fallback;
    const image = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    return selectTextColor(image.data, fallback, bounds.width, bounds.height);
  } catch (_) {
    return fallback;
  }
}

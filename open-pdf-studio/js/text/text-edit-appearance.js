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
  // Oorsprong van de pagina-box in user-space. Meestal (0,0), maar CAD-plots
  // hebben vaak een MediaBox rond de oorsprong (bv. [-846 -595 846 595]).
  // PDF.js-tekstposities staan in ECHTE user-space (dus met die offset),
  // terwijl de tekenlagen in app-ruimte 0..breedte/hoogte werken — zonder
  // deze offset landt tekst-bewerking buiten beeld.
  const offsetXPt = Number.isFinite(Number(dims?.offsetXPt)) ? Number(dims.offsetXPt) : 0;
  const offsetYPt = Number.isFinite(Number(dims?.offsetYPt)) ? Number(dims.offsetYPt) : 0;
  return {
    pageWidth,
    pageHeight,
    rotation,
    offsetXPt,
    offsetYPt,
    displayWidth: displaySize.width,
    displayHeight: displaySize.height,
  };
}

// User-space (PDF, oorsprong linksonder van de pagina-BOX) → app-ruimte
// (oorsprong linksboven van de pagina, 0..breedte/hoogte). Neemt de
// box-oorsprong mee; bij de gebruikelijke (0,0)-box is dit de oude formule.
export function userSpaceToApp(pdfX, pdfY, geometry) {
  const offX = Number(geometry?.offsetXPt) || 0;
  const offY = Number(geometry?.offsetYPt) || 0;
  const h = Number(geometry?.pageHeight) || 0;
  return { x: pdfX - offX, y: (offY + h) - pdfY };
}

// App-ruimte → user-space (inverse van userSpaceToApp).
export function appToUserSpace(appX, appY, geometry) {
  const offX = Number(geometry?.offsetXPt) || 0;
  const offY = Number(geometry?.offsetYPt) || 0;
  const h = Number(geometry?.pageHeight) || 0;
  return { x: appX + offX, y: (offY + h) - appY };
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
  // Doorstreepte/puntloze letters hebben geen NFD-ontbinding, dus die kunnen
  // niet door stripDiacritics() worden afgehandeld.
  ['ı', 'i'],  // dotless i (tr)
  ['ł', 'l'],  // l with stroke (pl)
  ['Ł', 'L'],
  ['đ', 'd'],  // d with stroke (hr/vi)
  ['Đ', 'D'],
]);

export function isWinAnsiCodePoint(cp) {
  if (cp === 0x0A || cp === 0x0D || cp === 0x09) return true; // regelstructuur
  if (cp >= 0x20 && cp <= 0x7E) return true;
  if (cp >= 0xA0 && cp <= 0xFF) return true;
  return WINANSI_EXTRA.has(cp);
}

// Ontbindt een letter met diakritisch teken en houdt alleen het basisteken
// over, mits dat basisteken zelf WinAnsi is: 'ā' -> 'a', 'č' -> 'c'. Dekt heel
// Latin Extended zonder een tabel per teken. Retourneert null als er niets
// bruikbaars overblijft.
function stripDiacritics(ch) {
  const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
  if (!base || base === ch) return null;
  for (const c of base) {
    if (!isWinAnsiCodePoint(c.codePointAt(0))) return null;
  }
  return base;
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
    const repl = WINANSI_REPLACEMENTS.has(ch)
      ? WINANSI_REPLACEMENTS.get(ch)
      : (stripDiacritics(ch) ?? '?');
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

// ── Regel-segmenten (tab-/kolomstructuur) ──
// Een regel in de tekstlaag bestaat vaak uit meerdere spans; een duidelijke
// horizontale sprong ertussen (tab-uitlijning: "Offerte:    AC294") ging
// verloren doordat de teksten met join('') werden samengevoegd. Deze helper
// bouwt de regel op als segmenten met hun eigen startpositie, gescheiden door
// een TAB-teken, zodat de kolom tijdens het bewerken zichtbaar blijft en bij
// het opslaan gereconstrueerd kan worden.
//
// items: [{ text, pdfX, pdfY?, pdfWidth, fontSize }] — spans van één regel,
//        gesorteerd in leesvolgorde.
// angleDeg: baseline-richting (zie textEditAngleFromTransform) — afstanden
//        worden langs de leesrichting geprojecteerd.
// Retour: { text, segments } waarbij segments null is als er geen kolom-
//        structuur is (dan is text de ongewijzigde join zoals voorheen).
//        segments[j] = { text, x, y, start, spanStart } met start = afstand
//        langs de baseline vanaf het eerste regel-item (PDF-punten) en
//        spanStart = index van de eerste span van het segment.
export function buildLineSegments(items, angleDeg = 0, gapFactor = 0.5) {
  const plainText = (items || []).map(it => it?.text ?? '').join('');
  if (!Array.isArray(items) || items.length < 2) {
    return {
      text: plainText,
      segments: null,
      pieces: (items || []).map((it, i) => ({ text: it?.text ?? '', item: i })).filter(p => p.text !== ''),
    };
  }
  const rad = (Number(angleDeg) || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x0 = Number(items[0].pdfX) || 0;
  const y0 = Number(items[0].pdfY) || 0;
  const project = (it) => {
    const dx = (Number(it.pdfX) || 0) - x0;
    const dy = (Number(it.pdfY) || 0) - y0;
    return dx * cos + dy * sin;
  };

  const segments = [];
  let cur = null;
  let lastContentEnd = 0;
  let pendingWs = '';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const text = it?.text ?? '';
    const isWs = !text.trim();
    const start = project(it);
    const end = start + (Number(it.pdfWidth) || 0);
    if (cur === null) {
      if (isWs) continue; // leading witruimte: de segment-x vangt de positie op
      cur = { text, x: it.pdfX, y: it.pdfY ?? 0, start, spanStart: i, pieces: [{ text, item: i }] };
      lastContentEnd = end;
      continue;
    }
    if (isWs) {
      // Witruimte-spans onder de gap-drempel horen bij het lopende segment
      // (gewone woordspaties); erboven worden ze de tab.
      pendingWs += text;
      continue;
    }
    const gap = start - lastContentEnd;
    const threshold = (Number(it.fontSize) || 10) * gapFactor;
    if (gap > threshold) {
      cur.end = lastContentEnd;
      segments.push(cur);
      cur = { text, x: it.pdfX, y: it.pdfY ?? 0, start, spanStart: i, pieces: [{ text, item: i }] };
    } else {
      cur.text += pendingWs + text;
      // Voor de run-reconstructie: witruimte plakt aan het volgende stuk
      // (witruimte is stijl-neutraal).
      cur.pieces.push({ text: pendingWs + text, item: i });
    }
    pendingWs = '';
    lastContentEnd = end;
  }
  if (cur !== null) { cur.end = lastContentEnd; segments.push(cur); }

  // Stukken (per bron-span) waarvan de concatenatie exact de regeltekst is —
  // nodig om bij heropenen per-woord-opmaak (vet/cursief/kleur) uit de spans
  // te reconstrueren. Scheidingstekens tussen segmenten plakken aan het
  // eerste stuk van het volgende segment.
  const piecesMet = (sep) => segments.flatMap((sg, j) => (
    j === 0 ? sg.pieces : [{ text: sep + sg.pieces[0].text, item: sg.pieces[0].item },
      ...sg.pieces.slice(1)]
  ));

  if (segments.length < 2) {
    return { text: plainText, segments: null, pieces: piecesMet('') };
  }

  // Gespatieerde tekst herkennen (uitgevulde regels, brede woordspatiëring):
  // veel segmenten met vrijwel uniforme tussenruimtes zijn géén kolommen maar
  // woorden. Die regel wordt als gewone tekst (met spaties) teruggegeven,
  // zodat de alinea normaal groepeert, reflowt en uitgevuld kan blijven.
  if (segments.length >= 4) {
    const gaps = [];
    for (let j = 1; j < segments.length; j++) {
      gaps.push(segments[j].start - segments[j - 1].end);
    }
    const gem = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const fs = Number(items[0].fontSize) || 10;
    const uniform = gem > 0 && gem < fs * 2.5
      && gaps.every(g => Math.abs(g - gem) <= Math.max(1.5, gem * 0.5));
    if (uniform) {
      return { text: segments.map(s => s.text).join(' '), segments: null, pieces: piecesMet(' ') };
    }
  }
  return { text: segments.map(s => s.text).join('\t'), segments, pieces: piecesMet('\t') };
}

// Standaard tab-raster (PDF-punten) voor blokken zonder bestaande kolom.
export const DEFAULT_TAB_GRID_PT = 36;

// Leg segment-teksten van één regel op een tab-stop-raster, zoals de editor
// (CSS tab-size) dat toont: segment j>0 begint op de eerstvolgende raster-stop
// ná het einde van de voorgaande tekst. Een in de editor getypte tab wordt zo
// een volwaardige kolomscheiding — wat de gebruiker ziet is wat er gecommit
// wordt.
// parts: segment-teksten (regel gesplitst op \t); grid: rasterafstand in
// punten; baseDx: dx van de regelstart t.o.v. het blok-anker; measure(text):
// tekstbreedte in punten.
export function layoutSegmentsOnTabGrid(parts, { grid, baseDx = 0, measure }) {
  const g = Number(grid) > 0 ? Number(grid) : DEFAULT_TAB_GRID_PT;
  const out = [];
  let pen = 0; // positie t.o.v. de regelstart
  for (let j = 0; j < parts.length; j++) {
    if (j > 0) {
      pen = (Math.floor(pen / g) + 1) * g; // strikt volgende stop
    }
    out.push({ text: parts[j], dx: baseDx + pen });
    pen += Math.max(0, Number(measure(parts[j])) || 0);
  }
  return out;
}

// ── Inline opmaak-runs ──
// Een regel kan uit runs bestaan: { text, bold, italic }. Runs zijn absoluut
// (de vlag beschrijft de gewenste weergave, niet een omkering t.o.v. de
// basisstijl) en leven binnen segmenten: lineSegments[i][j].runs.

// Voeg aangrenzende runs met gelijke stijl samen en verwijder lege runs.
// Runs kunnen optioneel een color dragen (hex, '#rrggbb'); alleen runs met
// gelijke kleur worden samengevoegd.
export function normalizeRuns(runs) {
  const out = [];
  for (const run of runs || []) {
    const text = String(run?.text ?? '');
    if (!text) continue;
    const bold = !!run?.bold;
    const italic = !!run?.italic;
    const color = run?.color || null;
    const underline = !!run?.underline;
    const strikethrough = !!run?.strikethrough;
    const prev = out[out.length - 1];
    if (prev && prev.bold === bold && prev.italic === italic && (prev.color || null) === color
      && !!prev.underline === underline && !!prev.strikethrough === strikethrough) {
      prev.text += text;
    } else {
      out.push({
        text, bold, italic, ...(color ? { color } : {}),
        ...(underline ? { underline: true } : {}),
        ...(strikethrough ? { strikethrough: true } : {}),
      });
    }
  }
  return out;
}

// Is de opmaak van een regel in de editor anders dan bij het openen? Alleen
// de stijlreeks telt (vet, cursief, kleur, onder-/doorstreping per run), niet
// de tekst. Eerder werden de runs inclusief tekst vergeleken: elke getypte
// letter gold dan als opmaakwijziging, waardoor het herverdelen van een
// alinea (C2) en het ongemoeid laten van ongewijzigde regels (C3) nooit
// gebeurden.
export function opmaakGewijzigd(runs, beginRuns) {
  const a = normalizeRuns(runs || []);
  const b = normalizeRuns(beginRuns || []);
  if (a.length !== b.length) return true;
  return a.some((r, k) => !!r.bold !== !!b[k].bold
    || !!r.italic !== !!b[k].italic
    || (r.color || null) !== (b[k].color || null)
    || !!r.underline !== !!b[k].underline
    || !!r.strikethrough !== !!b[k].strikethrough);
}

// Wist de gebruiker alle tekst van een bestaande run (en niet van een nieuw
// toegevoegd blok)? Dan is de bewerking: de oude tekst verwijderen.
export function tekstGewist(nieuweTekst, origineleTekst) {
  return String(origineleTekst ?? '').trim() !== '' && String(nieuweTekst ?? '').trim() === '';
}

// ── Opsommings-glyfs ──
// Bullets komen in PDF's vaak uit Symbol/ZapfDingbats(-subsets); de tekstlaag
// levert dan een PUA-codepoint (U+F0xx) of een geometrisch teken dat in de
// editor-font als blokje of vreemd glyph rendert. Map bekende varianten naar
// een leesbare bullet (WinAnsi-veilig: • = 0x95 in WinAnsi).
const BULLET_CHAR_MAP = new Map([
  ['', '•'], // Symbol/Wingdings 0xB7: bullet
  ['', '•'], // Wingdings 0xA7: klein zwart vierkant
  ['', '•'], // Wingdings 0x6C: filled circle
  ['', '•'],
  ['', '•'], // Wingdings 0xFC: vinkje, in lijsten als bullet gebruikt
  ['', '•'],
  ['', '•'],
  ['∙', '•'], // bullet operator
  ['●', '•'], // black circle
  ['▪', '•'], // black small square (geen WinAnsi)
  ['⚫', '•'],
  ['⬤', '•'],
]);

// Vervang bekende bullet-glyfvarianten door een leesbare bullet.
export function normalizeBulletText(text) {
  let s = String(text ?? '');
  for (const [van, naar] of BULLET_CHAR_MAP) {
    if (s.includes(van)) s = s.split(van).join(naar);
  }
  return s;
}

// Platte tekst van een run-reeks.
export function runsPlainText(runs) {
  return (runs || []).map(r => String(r?.text ?? '')).join('');
}

// Splits de runs van één regel op TAB-tekens in segment-run-reeksen.
// Retourneert een array met per segment zijn runs (tabs zelf vervallen),
// of null wanneer het aantal gevonden segmenten niet gelijk is aan
// expectedCount (de gebruiker heeft de tab-structuur doorbroken).
export function splitRunsIntoSegments(runs, expectedCount) {
  const parts = [[]];
  for (const run of runs || []) {
    const chunks = String(run?.text ?? '').split('\t');
    for (let c = 0; c < chunks.length; c++) {
      if (c > 0) parts.push([]);
      if (chunks[c]) {
        parts[parts.length - 1].push({
          text: chunks[c],
          bold: !!run?.bold,
          italic: !!run?.italic,
          ...(run?.color ? { color: run.color } : {}),
        });
      }
    }
  }
  if (expectedCount != null && parts.length !== expectedCount) return null;
  return parts.map(normalizeRuns);
}

// Kies de Standard-14-variant voor een basisfamilie plus bold/italic-vlaggen.
// baseName mag elke eerder opgeslagen Standard-14-naam zijn (variant-suffix
// wordt genegeerd): 'Helvetica-Bold' + italic → 'Helvetica-BoldOblique'.
export function standardFontVariant(baseName, bold, italic) {
  const n = String(baseName || '').toLowerCase();
  if (n.includes('courier')) {
    return bold && italic ? 'Courier-BoldOblique'
      : bold ? 'Courier-Bold'
      : italic ? 'Courier-Oblique'
      : 'Courier';
  }
  if (n.includes('times')) {
    return bold && italic ? 'TimesRoman-BoldItalic'
      : bold ? 'TimesRoman-Bold'
      : italic ? 'TimesRoman-Italic'
      : 'TimesRoman';
  }
  return bold && italic ? 'Helvetica-BoldOblique'
    : bold ? 'Helvetica-Bold'
    : italic ? 'Helvetica-Oblique'
    : 'Helvetica';
}

// ── Fontklasse uit een (PDF-)fontnaam ──
// PDF.js geeft voor een niet-ingebed of (nog) niet opgelost font de
// terugvalfamilie 'sans-serif' mee. Die naam bevat 'serif': een kale
// includes('serif') maakte er Times van, zodat bewerkte tekst in een tabel
// in Helvetica als schreefletter terugkwam, live én in het bestand (#669).
function fontKlasse(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('courier') || n.includes('consolas') || n.includes('mono')) return 'mono';
  if (n.includes('times') || n.includes('garamond') || n.includes('georgia')
      || n.includes('palatino') || n.includes('cambria') || n.includes('bookman')
      || (n.includes('serif') && !n.includes('sans'))) return 'serif';
  return 'sans';
}

// Standard-14-naam (zoals op het edit-record en in de saver) voor een
// weergave- of PDF-fontnaam plus bold/italic.
export function toStandardFontName(displayName, isBold, isItalic) {
  const klasse = fontKlasse(displayName);
  const basis = klasse === 'mono' ? 'Courier' : klasse === 'serif' ? 'TimesRoman' : 'Helvetica';
  return standardFontVariant(basis, !!isBold, !!isItalic);
}

// CSS-font-family-keten voor de live editor en synthetische spans.
export function cssFamilyForFontName(name) {
  const klasse = fontKlasse(name);
  if (klasse === 'mono') return '"Courier New", Courier, monospace';
  if (klasse === 'serif') return '"Times New Roman", Times, serif';
  return 'Helvetica, Arial, sans-serif';
}

// ── Afdekvlakken van een tekstbewerking (#669) ──
// Waar de oude tekst stond moet iets over de oude glyfen heen: in de
// weergave tot de bewerking opgeslagen is, en in het bestand op het
// terugval-pad van de saver (originele run niet in-place te knippen). Eén
// ruim vlak over het hele blok nam de tabellijnen tussen en rond de cellen
// mee: een tabelrij is één blok, en de breedte kwam uit een tekenaantal-
// schatting plus een halve fontgrootte. Hier per originele tekstrun een
// strak vlak langs de baseline: de advance-breedte van de run met een kleine
// marge voor overhangende glyfen, en van de descender tot boven de accenten.
export const COVER_MARGIN_EM = 0.1;
export const COVER_DESCENT_EM = 0.25;
export const COVER_ASCENT_EM = 1.0;

// Runs van één originele regel uit de spans van de tekstlaag: afstand langs
// de baseline vanaf het regel-anker (dx) en advance-breedte, in punten.
// Spans met alleen witruimte vullen in de tekstlaag de gaten tussen
// kolommen: die tellen niet mee. Runs die op woordafstand op elkaar volgen,
// worden één run (glyf-voor-glyf-gepositioneerde tekst geeft anders een
// vlak per letter).
// items: [{ text, pdfX, pdfY, pdfWidth, fontSize? }]; anchor: { x, y }.
export function originalLineRuns(items, anchor, angleDeg = 0) {
  if (!Array.isArray(items) || !anchor) return [];
  const rad = (Number(angleDeg) || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ax = Number(anchor.x) || 0;
  const ay = Number(anchor.y) || 0;
  const losse = [];
  for (const it of items) {
    if (!String(it?.text ?? '').trim()) continue;
    const breedte = Number(it.pdfWidth);
    if (!(breedte > 0)) continue;
    const dx = ((Number(it.pdfX) || 0) - ax) * cos + ((Number(it.pdfY) || 0) - ay) * sin;
    losse.push({ dx, width: breedte, fs: Number(it.fontSize) > 0 ? Number(it.fontSize) : 0 });
  }
  losse.sort((a, b) => a.dx - b.dx);
  const runs = [];
  for (const r of losse) {
    const vorige = runs[runs.length - 1];
    const woordAfstand = 0.25 * (r.fs || vorige?.fs || 10);
    if (vorige && r.dx - (vorige.dx + vorige.width) <= woordAfstand) {
      vorige.width = Math.max(vorige.width, r.dx + r.width - vorige.dx);
      continue;
    }
    runs.push({ ...r });
  }
  return runs.map(r => ({ dx: r.dx, width: r.width }));
}

// Afdekvlakken van een edit-record: [{ x, y, width, height, angle }] in
// user-space. (x, y) is de hoek vóór de run onder de baseline; het vlak loopt
// `width` langs de leesrichting en `height` langs de ascender-richting, zoals
// pdf-lib drawRectangle met rotate. Bronnen per regel, in volgorde van
// voorkeur: originalLineInfo[i].runs, de regelbreedte originalLineInfo[i].
// width, en voor oudere records de tekenaantal-schatting.
export function textEditCoverRects(edit) {
  if (!edit || !edit.originalText) return [];
  const origLines = String(edit.originalText).split('\n');
  const recordFs = Number(edit.fontSize) > 0 ? Number(edit.fontSize) : 12;
  const recordAngle = Number(edit.textAngle) || 0;
  const ls = Number(edit.lineSpacing) > 0 ? Number(edit.lineSpacing) : recordFs * 1.2;
  const info = Array.isArray(edit.originalLineInfo) && edit.originalLineInfo.length
    ? edit.originalLineInfo : null;
  const aantal = info ? info.length : origLines.length;
  const rects = [];
  for (let i = 0; i < aantal; i++) {
    const li = info ? info[i] : null;
    const tekst = String(li?.text ?? origLines[i] ?? '');
    if (!tekst.trim()) continue;
    const fs = Number(li?.fontSize) > 0 ? Number(li.fontSize) : recordFs;
    const angle = li ? (Number(li.angle) || 0) : recordAngle;
    const anker = li
      ? { x: Number(li.x) || 0, y: Number(li.y) || 0 }
      : textEditLineAnchor(Number(edit.pdfX) || 0, Number(edit.pdfY) || 0, i, ls, recordAngle);
    let runs = Array.isArray(li?.runs) ? li.runs.filter(r => Number(r?.width) > 0) : [];
    if (!runs.length) {
      const breedte = Number(li?.width) > 0 ? Number(li.width)
        : (aantal === 1 && Number(edit.pdfWidth) > 0) ? Number(edit.pdfWidth)
          : fs * 0.6 * tekst.length;
      runs = [{ dx: 0, width: breedte }];
    }
    const rad = angle * Math.PI / 180;
    const lees = { x: Math.cos(rad), y: Math.sin(rad) };
    const op = { x: -Math.sin(rad), y: Math.cos(rad) };
    const marge = fs * COVER_MARGIN_EM;
    const v0 = -fs * COVER_DESCENT_EM;
    for (const run of runs) {
      const u0 = (Number(run.dx) || 0) - marge;
      rects.push({
        x: anker.x + lees.x * u0 + op.x * v0,
        y: anker.y + lees.y * u0 + op.y * v0,
        width: Number(run.width) + 2 * marge,
        height: fs * (COVER_DESCENT_EM + COVER_ASCENT_EM),
        angle,
      });
    }
  }
  return rects;
}

// Omhullende van afdekvlakken in het tekenkader van de painter: x naar
// rechts vanaf de linkerrand van de pagina-box, y omlaag vanaf de bovenrand
// (frameX = x - offX, frameY = top - y). Retour { x, y, width, height } of
// null zonder vlakken.
export function coverRectsFrameBounds(rects, offX, top) {
  if (!Array.isArray(rects) || rects.length === 0) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const r of rects) {
    const rad = (Number(r.angle) || 0) * Math.PI / 180;
    const lees = { x: Math.cos(rad), y: Math.sin(rad) };
    const op = { x: -Math.sin(rad), y: Math.cos(rad) };
    const hoeken = [
      [r.x, r.y],
      [r.x + lees.x * r.width, r.y + lees.y * r.width],
      [r.x + op.x * r.height, r.y + op.y * r.height],
      [r.x + lees.x * r.width + op.x * r.height, r.y + lees.y * r.width + op.y * r.height],
    ];
    for (const [ux, uy] of hoeken) {
      const fx = ux - offX;
      const fy = top - uy;
      x0 = Math.min(x0, fx); x1 = Math.max(x1, fx);
      y0 = Math.min(y0, fy); y1 = Math.max(y1, fy);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
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

/**
 * De tekenafstand (Tc, punten) van regel `lineIndex` van een tekstbewerking
 * (#718): gespatieerde tekst houdt zijn afstand, ook op de terugvalroute en
 * live. 0 zonder `lineCharSpacing`; nieuwe regels erven die van de laatste.
 */
export function textEditLineCharSpacing(edit, lineIndex) {
  const lijst = edit?.lineCharSpacing;
  if (!Array.isArray(lijst) || lijst.length === 0) return 0;
  const tc = Number(lijst[Math.min(Math.max(0, lineIndex), lijst.length - 1)]);
  return Number.isFinite(tc) && tc > 0 ? tc : 0;
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

// ── Reflow binnen het bewerkte blok (fase C) ──
//
// Herverdeelt de woorden van een alinea-blok over de regels wanneer een
// bewerkte regel breder werd dan het blok toelaat. Alleen de regels vanaf de
// EERSTE gewijzigde regel worden herverdeeld; eerdere (ongewijzigde) regels
// behouden hun oorspronkelijke inhoud en lay-out.
//
// origLines/newLines: regel-arrays (zonder \n); maxWidth in PDF-punten;
// measure(text) → breedte in punten. Retour: { lines, changed, overflow } —
// overflow = aantal regels dat buiten het originele blok valt (waarschuwen,
// niet afkappen).
export function reflowBlockLines(origLines, newLines, { maxWidth, measure, tolerance = 1.02 } = {}) {
  const geen = { lines: newLines, changed: false, overflow: 0 };
  if (!Array.isArray(origLines) || !Array.isArray(newLines)) return geen;
  if (!(Number(maxWidth) > 0) || typeof measure !== 'function') return geen;

  // eerste gewijzigde regel
  let k = -1;
  const minLen = Math.min(origLines.length, newLines.length);
  for (let i = 0; i < minLen; i++) {
    if (origLines[i] !== newLines[i]) { k = i; break; }
  }
  if (k === -1 && origLines.length !== newLines.length) k = minLen;
  if (k === -1) return geen;

  // alleen reflowen als een gewijzigde regel te breed is
  const teBreed = newLines.slice(k).some(l => measure(l) > maxWidth * tolerance);
  if (!teBreed) return geen;
  // lege regels in de staart zijn alinea-scheidingen: niet samenvoegen
  if (newLines.slice(k).some(l => l.trim() === '')) return geen;

  const head = newLines.slice(0, k);
  const words = newLines.slice(k).join(' ').split(/\s+/).filter(Boolean);
  const wrapped = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cur && measure(cand) > maxWidth) {
      wrapped.push(cur);
      cur = w;
    } else {
      cur = cand;
    }
  }
  if (cur) wrapped.push(cur);

  const lines = head.concat(wrapped);
  const gelijk = lines.length === newLines.length && lines.every((l, i) => l === newLines[i]);
  return {
    lines,
    changed: !gelijk,
    overflow: Math.max(0, lines.length - origLines.length),
  };
}

// Detecteert de uitlijning van een blok uit de originele regel-geometrie.
// lineInfos: [{ x, width }] per regel. Retour: 'left' | 'right' | 'justify'.
// 'justify' vergt ≥3 regels waarvan alle behalve de laatste zowel links als
// rechts uitlijnen; 'right' vergt rechts-uitlijning zonder links-uitlijning.
export function detectBlockAlignment(lineInfos, { tol = 2 } = {}) {
  if (!Array.isArray(lineInfos) || lineInfos.length < 2) return 'left';
  const lefts = lineInfos.map(l => Number(l.x) || 0);
  const rights = lineInfos.map(l => (Number(l.x) || 0) + (Number(l.width) || 0));
  const L = Math.min(...lefts);
  const R = Math.max(...rights);
  const leftAligned = (idxs) => idxs.every(i => Math.abs(lefts[i] - L) <= tol);
  const rightAligned = (idxs) => idxs.every(i => Math.abs(rights[i] - R) <= tol);
  const alle = lineInfos.map((_, i) => i);
  const nietLaatste = alle.slice(0, -1);

  if (lineInfos.length >= 3 && leftAligned(nietLaatste) && rightAligned(nietLaatste)
      && Math.abs(lefts[lefts.length - 1] - L) <= tol) {
    return 'justify';
  }
  if (rightAligned(alle) && !leftAligned(alle)) return 'right';
  return 'left';
}

// ── Verplaatsen: scherm-delta → PDF-delta ──
// Inverse van de nudge-mapping in text-edit-tool (shiftX/shiftY berekening):
// een sleep-delta in schermpixels wordt een delta in PDF-user-space-punten,
// rekening houdend met paginarotatie (rotationMatrix = getPageRotationMatrix)
// en zoom. De rotatiematrix is orthonormaal, dus de inverse is de transpose.
export function pdfDeltaFromScreenDelta(shiftX, shiftY, scale, rotationMatrix) {
  const [a, b, c, d] = rotationMatrix || [1, 0, 0, 1];
  const s = Number(scale) > 0 ? Number(scale) : 1;
  return {
    dx: (a * shiftX + b * shiftY) / s,
    dy: -((c * shiftX + d * shiftY) / s),
  };
}

// ── Nieuw tekstblok: record-fabriek ──
// Het lege edit-record waarmee een nieuw blok paginatekst begint
// (originalText '' → geen knip/afdekvlak; de saver emitteert een vers
// BT/ET-blok op het anker). Puur zodat de vorm unit-getest is.
export function nieuwTekstblokRecord({ page, pdfX, pdfY, fontSize = 12, color = '#000000' }) {
  return {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    page,
    originalText: '',
    newText: '',
    pdfX,
    pdfY,
    pdfWidth: 0,
    fontSize,
    lineSpacing: fontSize * 1.2,
    numOriginalLines: 0,
    fontFamily: 'Helvetica',
    loadedFontName: '',
    pdfFontName: '',
    color,
    originalSpanTexts: [],
    _pendingNew: true,
  };
}

// PDF angles are counter-clockwise; CSS uses a downward Y axis. Keep the
// first baseline fixed while rotating the editor, including non-right angles.
export function textEditScreenRotation(pageRotation, textAngle = 0) {
  const angle = (Number(pageRotation) || 0) - (Number(textAngle) || 0);
  const rad = angle * Math.PI / 180;
  return { angle, rotationC: -Math.sin(rad), rotationD: Math.cos(rad) };
}

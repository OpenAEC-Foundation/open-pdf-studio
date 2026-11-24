// Screenshot (Home tab): the rules behind the capture dialog, without DOM or
// app state so they can be tested under node:test. The DOM, the rendering and
// the clipboard live in tools/screenshot.js; the dialog in
// solid/components/dialogs/ScreenshotDialog.jsx.
//
// A capture is ONE piece of ONE page: the selection is clipped to the page it
// overlaps most. The image is rendered again from that page at the chosen
// resolution (dpi = pixels per inch of paper), so 300 dpi means the same thing
// whatever the zoom level was when the area was selected.

/** Resolution choices in the dialog, in menu order. */
export const RESOLUTIES = Object.freeze(['screen', 96, 150, 300, 600, 'custom']);
export const FORMATEN = Object.freeze(['png', 'jpeg']);
export const ACTIES = Object.freeze(['copy', 'paste', 'save']);

export const MIN_DPI = 10;
export const MAX_DPI = 2400;
/** Longest image side and pixel count the app will produce (canvas and memory limits). */
export const MAX_ZIJDE = 16384;
export const MAX_PIXELS = 64 * 1024 * 1024;

export const STANDAARD_KEUZE = Object.freeze({
  resolutie: 'screen',
  eigenDpi: 300,
  formaat: 'png',
  kwaliteit: 90,
  actie: 'copy',
});

const geheel = (v, min, max, terugval) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : terugval;
};

/**
 * Validate the remembered choices (preferences may hold anything).
 * Unknown values fall back to the defaults one by one.
 */
export function normaliseerKeuze(ruw) {
  const r = ruw && typeof ruw === 'object' ? ruw : {};
  let resolutie = r.resolutie;
  if (typeof resolutie === 'string' && /^\d+$/.test(resolutie)) resolutie = Number(resolutie);
  if (!RESOLUTIES.includes(resolutie)) resolutie = STANDAARD_KEUZE.resolutie;
  return {
    resolutie,
    eigenDpi: geheel(r.eigenDpi, MIN_DPI, MAX_DPI, STANDAARD_KEUZE.eigenDpi),
    formaat: FORMATEN.includes(r.formaat) ? r.formaat : STANDAARD_KEUZE.formaat,
    kwaliteit: geheel(r.kwaliteit, 1, 100, STANDAARD_KEUZE.kwaliteit),
    actie: ACTIES.includes(r.actie) ? r.actie : STANDAARD_KEUZE.actie,
  };
}

/** Choices as stored in the preferences (flat keys). */
export function keuzeUitVoorkeuren(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  return normaliseerKeuze({
    resolutie: p.screenshotResolution,
    eigenDpi: p.screenshotCustomDpi,
    formaat: p.screenshotFormat,
    kwaliteit: p.screenshotJpegQuality,
    actie: p.screenshotDefaultAction,
  });
}

export function keuzeNaarVoorkeuren(keuze) {
  const k = normaliseerKeuze(keuze);
  return {
    screenshotResolution: k.resolutie,
    screenshotCustomDpi: k.eigenDpi,
    screenshotFormat: k.formaat,
    screenshotJpegQuality: k.kwaliteit,
    screenshotDefaultAction: k.actie,
  };
}

/**
 * The resolution of the screen view, in dpi of paper: `cssPxPerPt` CSS pixels
 * per PDF point at the current zoom, times the device pixel ratio.
 */
export function schermDpi(cssPxPerPt, dpr = 1) {
  const s = Number(cssPxPerPt) * (Number(dpr) > 0 ? Number(dpr) : 1);
  if (!(s > 0) || !Number.isFinite(s)) return 96;
  return Math.min(MAX_DPI, Math.max(MIN_DPI, Math.round(72 * s)));
}

/** The dpi the dialog choice stands for. */
export function gekozenDpi(keuze, schermwaarde) {
  const k = normaliseerKeuze(keuze);
  if (k.resolutie === 'screen') return schermDpi(Number(schermwaarde) / 72, 1);
  if (k.resolutie === 'custom') return k.eigenDpi;
  return k.resolutie;
}

/**
 * Pixel size of a page area of `breedtePt` × `hoogtePt` points at `dpi`,
 * reduced (keeping the aspect ratio) when it would exceed the limits.
 * @returns {{breedte:number, hoogte:number, dpi:number, schaal:number, beperkt:boolean} | null}
 *   schaal = pixels per point actually used; dpi = 72 · schaal, rounded.
 */
export function uitvoerMaat(breedtePt, hoogtePt, dpi, { maxZijde = MAX_ZIJDE, maxPixels = MAX_PIXELS } = {}) {
  const w = Number(breedtePt);
  const h = Number(hoogtePt);
  const d = Number(dpi);
  if (!(w > 0) || !(h > 0) || !(d > 0)) return null;
  let schaal = d / 72;
  let beperkt = false;
  const grootste = Math.max(w, h);
  if (grootste * schaal > maxZijde) {
    schaal = maxZijde / grootste;
    beperkt = true;
  }
  if (w * h * schaal * schaal > maxPixels) {
    schaal = Math.sqrt(maxPixels / (w * h));
    beperkt = true;
  }
  // Whole pixels; never round a limited size back over the limit.
  const rond = beperkt ? Math.floor : Math.round;
  const breedte = Math.max(1, rond(w * schaal));
  const hoogte = Math.max(1, rond(h * schaal));
  return { breedte, hoogte, dpi: Math.round(72 * schaal), schaal, beperkt };
}

/** The dpi that gives an image `px` pixels wide for an area `breedtePt` points wide. */
export function dpiVoorBreedte(breedtePt, px) {
  const w = Number(breedtePt);
  const p = Number(px);
  if (!(w > 0) || !(p > 0)) return null;
  return Math.min(MAX_DPI, Math.max(MIN_DPI, Math.round((p * 72) / w)));
}

/** Overlap of two {left, top, width, height} rectangles, or null. */
export function snijRechthoeken(a, b) {
  if (!a || !b) return null;
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (!(right > left) || !(bottom > top)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Which page does the selection capture? The one it overlaps most; the
 * selection is clipped to that page. `paginas` = [{ pageNum, rect }] with the
 * page rectangles in the same (screen) coordinates as `selectie`.
 * @returns {{ pageNum:number, rect:{left,top,width,height}, afgesneden:boolean } | null}
 */
export function kiesPagina(selectie, paginas) {
  let beste = null;
  for (const p of paginas || []) {
    const s = snijRechthoeken(selectie, p?.rect);
    if (!s) continue;
    const opp = s.width * s.height;
    if (!beste || opp > beste.opp) beste = { pageNum: p.pageNum, rect: s, opp };
  }
  if (!beste) return null;
  const afgesneden = Math.abs(beste.rect.width - selectie.width) > 0.5
    || Math.abs(beste.rect.height - selectie.height) > 0.5;
  return { pageNum: beste.pageNum, rect: beste.rect, afgesneden };
}

/** Tiles of at most `tegel` px covering [0,w) × [0,h) exactly, row by row. */
export function tegelRaster(w, h, tegel) {
  const t = Math.max(1, Math.floor(tegel));
  const uit = [];
  for (let y = 0; y < h; y += t) {
    for (let x = 0; x < w; x += t) uit.push({ x, y, breedte: Math.min(t, w - x), hoogte: Math.min(t, h - y) });
  }
  return uit;
}

/** Suggested file name: "<document>-p<page>-<dpi>dpi.<ext>". */
export function bestandsnaam(documentNaam, pageNum, dpi, formaat) {
  const basis = String(documentNaam || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.pdf$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .trim() || 'screenshot';
  const ext = formaat === 'jpeg' ? 'jpg' : 'png';
  return `${basis}-p${pageNum || 1}-${Math.round(dpi) || 96}dpi.${ext}`;
}

/** MIME type for the canvas encoder. */
export function mimeType(formaat) {
  return formaat === 'jpeg' ? 'image/jpeg' : 'image/png';
}

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Arguments of the MCP tool app_capture_region. Without x/y/width/height the
 * whole page; the rectangle is in app points (page space, top-left origin).
 * @returns {{page:number, rect:{x,y,width,height}|null, dpi:number, formaat:string,
 *            kwaliteit:number, pad:string|null} | {error:string}}
 */
export function leesOpnameArgumenten(params, { aantalPaginas, huidigePagina } = {}) {
  const p = params && typeof params === 'object' ? params : {};
  if (!(aantalPaginas >= 1)) return { error: 'no active document' };
  const page = p.page === undefined || p.page === null ? (huidigePagina || 1) : p.page;
  if (!Number.isInteger(page) || page < 1 || page > aantalPaginas) {
    return { error: `page ${page} out of range (doc has ${aantalPaginas} pages)` };
  }
  const delen = [p.x, p.y, p.width, p.height];
  const gegeven = delen.filter((v) => v !== undefined && v !== null).length;
  let rect = null;
  if (gegeven) {
    if (gegeven !== 4 || !delen.every(isGetal)) return { error: 'give x, y, width and height together (app points), or none for the whole page' };
    if (!(p.width > 0) || !(p.height > 0)) return { error: 'width and height must be positive' };
    rect = { x: p.x, y: p.y, width: p.width, height: p.height };
  }
  const dpi = p.dpi === undefined || p.dpi === null ? 150 : p.dpi;
  if (!isGetal(dpi) || dpi < MIN_DPI || dpi > MAX_DPI) return { error: `dpi must be between ${MIN_DPI} and ${MAX_DPI}` };
  const formaat = p.format === undefined || p.format === null ? 'png' : p.format;
  if (!FORMATEN.includes(formaat)) return { error: 'format must be "png" or "jpeg"' };
  const kwaliteit = p.quality === undefined || p.quality === null ? 90 : p.quality;
  if (!Number.isInteger(kwaliteit) || kwaliteit < 1 || kwaliteit > 100) return { error: 'quality must be an integer from 1 to 100' };
  let pad = null;
  if (p.path !== undefined && p.path !== null) {
    if (typeof p.path !== 'string' || !/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p.path)) return { error: 'path must be an absolute file path' };
    pad = p.path;
  }
  return { page, rect, dpi: Math.round(dpi), formaat, kwaliteit, pad };
}

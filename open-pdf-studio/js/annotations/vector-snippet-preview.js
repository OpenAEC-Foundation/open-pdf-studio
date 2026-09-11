// Voorvertoning van een vectorknipsel.
//
// In het bestand is een knipsel vector; op het scherm tekenen we een raster,
// net als de paginaweergave zelf. Bij inzoomen komt er een scherpere versie
// voor in de plaats.
//
// De pdfium-worker rendert vanaf een PAD (zie pdfium-worker/src/main.rs), dus
// de mini-PDF gaat één keer per sleutel naar de tijdelijke map. De store
// onthoudt waar.

import { padVan, bytesVan } from './vector-snippet-store.js';
import { weergaveVak, paginaRotatie } from '../pdf/vector-embed.js';

/** Zoomniveaus waarop we rasteren. Tussenliggende zoom gebruikt de eerstvolgende. */
const NIVEAUS = [1, 2, 4, 8, 16];

/** Boven deze pixelmaat wordt niet verder verscherpt — anders lopen zware
 *  knipsels het geheugen in. */
const MAX_PIXELS = 4096;

const _bitmaps = new Map();   // `${sleutel}|${vakSleutel}|${niveau}` -> ImageBitmap
const _bezig = new Map();     // dezelfde sleutel -> lopende belofte (in-flight dedupe)
const _bladen = new Map();    // snippetKey -> belofte van { cropBox, rotatie } van de mini-PDF
let _opnieuwTekenen = null;

/** De tekenlaag geeft hier zijn hertekenfunctie af, zodat een net binnengekomen
 *  tegel meteen zichtbaar wordt. */
export function bijNieuweTegel(fn) {
  _opnieuwTekenen = typeof fn === 'function' ? fn : null;
}

export function niveauVoor(zoom) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return NIVEAUS.find((n) => n >= z) || NIVEAUS[NIVEAUS.length - 1];
}

const vakSleutel = (vak) =>
  `${Math.round(vak.left)}_${Math.round(vak.bottom)}_${Math.round(vak.right)}_${Math.round(vak.top)}`;

/**
 * De beste bitmap die er NU is voor dit knipsel, of null. Ontbreekt het
 * gevraagde niveau, dan wordt het op de achtergrond gerenderd en zolang een
 * grover niveau teruggegeven — hetzelfde gedrag als de paginaweergave.
 *
 * @param {object} ann  de vectorSnippet-annotatie
 * @param {number} zoom huidige zoom
 * @returns {ImageBitmap|null}
 */
export function bitmapVoor(ann, zoom) {
  if (!ann?.snippetKey || !ann?.srcBox) return null;
  const vs = vakSleutel(ann.srcBox);
  const gevraagd = niveauVoor(zoom);
  const sleutel = `${ann.snippetKey}|${vs}|${gevraagd}`;

  const klaar = _bitmaps.get(sleutel);
  if (klaar) return klaar;

  vraagAan(ann, gevraagd, sleutel);

  // Val terug op het beste grovere niveau dat er al is.
  for (let i = NIVEAUS.indexOf(gevraagd) - 1; i >= 0; i--) {
    const b = _bitmaps.get(`${ann.snippetKey}|${vs}|${NIVEAUS[i]}`);
    if (b) return b;
  }
  return null;
}

function vraagAan(ann, niveau, sleutel) {
  if (_bezig.has(sleutel)) return;          // in-flight dedupe
  const belofte = render(ann, niveau)
    .then((bmp) => {
      if (bmp) {
        _bitmaps.set(sleutel, bmp);
        if (_opnieuwTekenen) _opnieuwTekenen();
      }
    })
    .catch(() => { /* stil: de placeholder blijft staan */ })
    .finally(() => { _bezig.delete(sleutel); });
  _bezig.set(sleutel, belofte);
}

async function schrijfNaarTijdelijkeMap(sleutel, bytes) {
  const t = window.__TAURI__;
  if (!t?.path?.tempDir) return null;
  const map = await t.path.tempDir();
  const scheiding = (map.endsWith('\\') || map.endsWith('/')) ? '' : '/';
  const pad = `${map}${scheiding}opds-knipsel-${sleutel}.pdf`;
  await t.fs.writeFile(pad, bytes);
  return pad;
}

/** CropBox en rotatie van de mini-PDF, één keer per knipsel uitgelezen. */
function bladVan(sleutel) {
  if (!_bladen.has(sleutel)) {
    _bladen.set(sleutel, (async () => {
      const bytes = bytesVan(sleutel);
      if (!bytes) return null;
      const { PDFDocument } = await import('pdf-lib');
      const pagina = (await PDFDocument.load(bytes)).getPage(0);
      return { cropBox: pagina.getCropBox(), rotatie: paginaRotatie(pagina) };
    })().catch(() => null));
  }
  return _bladen.get(sleutel);
}

async function render(ann, niveau) {
  const pad = await padVan(ann.snippetKey, schrijfNaarTijdelijkeMap);
  if (!pad) return null;
  const blad = await bladVan(ann.snippetKey);
  if (!blad) return null;

  // De worker wil de regio in WEERGAVE-ruimte (linksboven, y omlaag, ná de
  // /Rotate) — niet het PDF-vak zelf. Zie pdfium-worker/src/render.rs.
  const regio = weergaveVak(ann.srcBox, blad.cropBox, blad.rotatie);
  const b = regio.width;
  const h = regio.height;
  if (!(b > 0) || !(h > 0)) return null;

  // Niet verder verscherpen dan MAX_PIXELS aan de langste zijde.
  const schaal = Math.min(niveau, MAX_PIXELS / Math.max(b, h));
  if (!(schaal > 0)) return null;

  const { invoke } = await import('../core/platform.js');
  const res = await invoke('render_pdf_page_region', {
    path: pad,
    pageIndex: 0,
    scale: schaal,
    rotation: 0,
    regionXPt: regio.x,
    regionYPt: regio.y,
    regionWPt: b,
    regionHPt: h,
  });

  const bytes = res instanceof Uint8Array ? res : new Uint8Array(res);
  if (!bytes || bytes.length <= 8) return null;
  // Kopformaat van de worker: breedte en hoogte als uint32 LE, daarna RGBA.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const w = dv.getUint32(0, true);
  const hh = dv.getUint32(4, true);
  if (w * hh * 4 !== bytes.length - 8) return null;
  const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, w * hh * 4);
  return await createImageBitmap(new ImageData(rgba, w, hh));
}

/** Gooit de bitmaps van knipsels weg die niet meer bestaan. */
export function wisOngebruikteBitmaps(gebruikteSleutels) {
  const houden = new Set(gebruikteSleutels || []);
  for (const k of [..._bitmaps.keys()]) {
    if (houden.has(k.split('|')[0])) continue;
    const bmp = _bitmaps.get(k);
    if (bmp && typeof bmp.close === 'function') bmp.close();
    _bitmaps.delete(k);
  }
}

export function leegmaken() {
  for (const bmp of _bitmaps.values()) if (bmp && typeof bmp.close === 'function') bmp.close();
  _bitmaps.clear();
  _bezig.clear();
  _bladen.clear();
}

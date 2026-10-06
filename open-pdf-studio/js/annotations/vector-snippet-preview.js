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
const NIVEAUS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16];

/** Boven deze pixelmaat wordt niet verder verscherpt — anders lopen zware
 *  knipsels het geheugen in. */
const MAX_PIXELS = 4096;

const _bitmaps = new Map();   // `${sleutel}|${vakSleutel}|${niveau}` -> ImageBitmap
const _bezig = new Map();     // dezelfde sleutel -> lopende belofte (in-flight dedupe)
const _bladData = new Map();
const _bladen = new Map();    // snippetKey -> belofte van { cropBox, rotatie } van de mini-PDF
let _opnieuwTekenen = null;
let _generatie = 0;
let _redrawGepland = false;
const MAX_BYTES = 128 * 1024 * 1024;

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
  `${vak.left}_${vak.bottom}_${vak.right}_${vak.top}`;

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
  const blad = _bladData.get(ann.snippetKey);
  const regio = blad ? weergaveVak(ann.srcBox, blad.cropBox, blad.rotatie)
    : { width: ann.srcBox.right - ann.srcBox.left, height: ann.srcBox.top - ann.srcBox.bottom };
  const verhouding = Math.max(ann.width / regio.width, ann.height / regio.height);
  const gevraagd = Math.min(niveauVoor(zoom * (window.devicePixelRatio || 1) * verhouding), MAX_PIXELS / Math.max(regio.width, regio.height));
  const sleutel = `${ann.snippetKey}|${vs}|${gevraagd}`;
  const klaar = _bitmaps.get(sleutel);
  if (klaar) {
    _bitmaps.delete(sleutel); _bitmaps.set(sleutel, klaar);
    return klaar;
  }
  vraagAan(ann, gevraagd, sleutel);
  // Ook een scherper bestaand beeld is bruikbaar tijdens uitzoomen.
  const prefix = `${ann.snippetKey}|${vs}|`;
  let beste = null, afstand = Infinity;
  for (const [key, bmp] of _bitmaps) {
    if (!key.startsWith(prefix)) continue;
    const d = Math.abs(Math.log(Number(key.slice(prefix.length)) / gevraagd));
    if (d < afstand) { beste = bmp; afstand = d; }
  }
  return beste;
}

function vraagAan(ann, niveau, sleutel) {
  if (_bezig.has(sleutel)) return;
  const generatie = _generatie;
  const belofte = render(ann, niveau)
    .then((bmp) => {
      if (!bmp) return;
      if (generatie !== _generatie || !bytesVan(ann.snippetKey)) { bmp.close(); return; }
      _bitmaps.set(sleutel, bmp);
      let bytes = [..._bitmaps.values()].reduce((n, b) => n + b.width * b.height * 4, 0);
      for (const [key, b] of _bitmaps) {
        if (bytes <= MAX_BYTES) break;
        if (key === sleutel) continue;
        bytes -= b.width * b.height * 4;
        b.close(); _bitmaps.delete(key);
      }
      if (!_redrawGepland) {
        _redrawGepland = true;
        requestAnimationFrame(() => { _redrawGepland = false; _opnieuwTekenen?.(); });
      }
    })
    .catch(() => { /* schermvoorvertoning mag later opnieuw proberen */ })
    .finally(() => { if (_bezig.get(sleutel) === belofte) _bezig.delete(sleutel); });
  _bezig.set(sleutel, belofte);
}

/** Voor MCP-screenshots: voltooi previews ook als RAF gepauzeerd is. */
export async function wachtOpKnipselPreviews(annotaties, zoom) {
  const knipsels = annotaties.filter(a => a.type === 'vectorSnippet' && !a.hidden);
  for (const ann of knipsels) bitmapVoor(ann, zoom);
  await Promise.all([..._bezig.values()]);
  for (const ann of knipsels) {
    if (!bitmapVoor(ann, zoom)) throw new Error('Vectorknipsel-preview is niet gereed');
  }
}

/** Uitvoer wacht onafhankelijk van schermzoom/RAF op alle benodigde knipsels.
 * De aanroeper sluit de tijdelijke bitmaps na het tekenen. Mislukken breekt
 * de uitvoer af: nooit ongemerkt een placeholder afdrukken.
 */
export async function bereidKnipselsVoorUitvoer(annotaties, schaal) {
  const beelden = new Map();
  try {
    for (const ann of annotaties) {
      if (ann.type !== 'vectorSnippet' || ann.hidden) continue;
      const blad = await bladVan(ann.snippetKey);
      if (!blad) throw new Error('Vectorknipsel: bron ontbreekt');
      const regio = weergaveVak(ann.srcBox, blad.cropBox, blad.rotatie);
      const niveau = schaal * Math.max(ann.width / regio.width, ann.height / regio.height);
      const bmp = await render(ann, niveau);
      if (!bmp) throw new Error('Vectorknipsel kon niet worden gerenderd');
      beelden.set(ann, bmp);
    }
    return beelden;
  } catch (err) {
    for (const bmp of beelden.values()) bmp.close();
    throw err;
  }
}

async function schrijfNaarTijdelijkeMap(sleutel, bytes) {
  const t = window.__TAURI__;
  if (!t?.path?.tempDir) return null;
  const map = await t.path.tempDir();
  const scheiding = (map.endsWith('\\') || map.endsWith('/')) ? '' : '/';
  const pad = `${map}${scheiding}opds-knipsel-${sleutel}.pdf`;
  // De tijdelijke map staat niet vanzelf in de fs-scope; zonder dit lukt het
  // schrijven alleen als iets anders hem eerder vrijgaf, en blijft een
  // heropend knipsel een leeg kader.
  await t.core.invoke('allow_fs_scope', { path: pad });
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
      const blad = { cropBox: pagina.getCropBox(), rotatie: paginaRotatie(pagina) };
      if (bytesVan(sleutel) === bytes) _bladData.set(sleutel, blad);
      return blad;
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

  return rasterVanPad(pad, { x: regio.x, y: regio.y, width: b, height: h }, schaal);
}

/**
 * Rastert een gebied van de eerste pagina van een PDF op schijf via de
 * pdfium-worker. `regio` staat in weergaveruimte (punten, linksboven, y
 * omlaag). Ook de voorbeeldweergave van de CAD-import gebruikt dit (#400),
 * zodat er één renderroute is.
 * @returns {Promise<ImageBitmap|null>}
 */
export async function rasterVanPad(pad, regio, schaal, paginaIndex = 0) {
  const beeld = await rasterBytesVanPad(pad, regio, schaal, paginaIndex);
  if (!beeld) return null;
  return await createImageBitmap(new ImageData(beeld.rgba, beeld.breedte, beeld.hoogte));
}

/**
 * Als `rasterVanPad`, maar geeft de ruwe beeldpunten (RGBA) terug, voor wie ze
 * nog wil bewerken.
 * @returns {Promise<{breedte:number, hoogte:number, rgba:Uint8ClampedArray}|null>}
 */
export async function rasterBytesVanPad(pad, regio, schaal, paginaIndex = 0) {
  if (!pad || !(regio?.width > 0) || !(regio?.height > 0) || !(schaal > 0)) return null;
  const { invoke } = await import('../core/platform.js');
  const res = await invoke('render_pdf_page_region', {
    path: pad,
    pageIndex: paginaIndex,
    scale: schaal,
    rotation: 0,
    regionXPt: regio.x || 0,
    regionYPt: regio.y || 0,
    regionWPt: regio.width,
    regionHPt: regio.height,
  });

  const bytes = res instanceof Uint8Array ? res : new Uint8Array(res);
  if (!bytes || bytes.length <= 8) return null;
  // Kopformaat van de worker: breedte en hoogte als uint32 LE, daarna RGBA.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const w = dv.getUint32(0, true);
  const hh = dv.getUint32(4, true);
  if (w * hh * 4 !== bytes.length - 8) return null;
  const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, w * hh * 4);
  return { breedte: w, hoogte: hh, rgba };
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
  _generatie++;
  _redrawGepland = false;
  for (const bmp of _bitmaps.values()) if (bmp && typeof bmp.close === 'function') bmp.close();
  _bitmaps.clear();
  _bezig.clear();
  _bladen.clear();
  _bladData.clear();
}

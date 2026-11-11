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

/** De hele overzichtsbitmap blijft begrensd; zichtbare details krijgen tegels. */
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

function vraagAan(ann, niveau, sleutel, regio = null) {
  if (_bezig.has(sleutel)) return;
  const generatie = _generatie;
  const belofte = (regio ? renderDetail(ann, regio, niveau) : render(ann, niveau))
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

// Kleine detailtegels houden zowel worker-berichten als het aantal lopende
// renders begrensd. De bestaande LRU-cache deelt zijn budget met het overzicht.
const DETAIL_PIXELS = 512;
const MAX_VISIBLE_TILES = 48;
const MAX_PENDING_DETAILS = 4;

/** Teken de schermpreview op de werkelijke canvasresolutie. De aanroeper heeft
 * pagina-, weergave- en annotatierotatie al in de canvastransform gezet.
 * Alleen de zichtbare uitsnede krijgt scherpe tegels; afdruk/export gebruikt
 * deze route niet. Transparante tegels vervangen het overzicht, niet eroverheen. */
export function tekenSchermPreview(ctx, ann, overzicht) {
  // Lijnwerk in één kleur (#1024), ook in de scherpe detailtegels (#1023).
  const kleur = (b) => (ann.lijnKleur ? gekleurdeTegel(b, ann.lijnKleur) : b);
  overzicht = kleur(overzicht);
  const fallback = () => ctx.drawImage(overzicht, ann.x, ann.y, ann.width, ann.height);
  const blad = _bladData.get(ann.snippetKey);
  if (!blad || !(ann.width > 0 && ann.height > 0)) { fallback(); return; }
  const regio = weergaveVak(ann.srcBox, blad.cropBox, blad.rotatie);
  const m = ctx.getTransform();
  const schaal = Math.max(Math.hypot(m.a, m.b) * ann.width / regio.width,
    Math.hypot(m.c, m.d) * ann.height / regio.height);
  if (!(schaal > 0) || !Number.isFinite(schaal) || !(Math.abs(m.a*m.d-m.b*m.c) > 0)) {
    fallback(); return;
  }
  // Een trap boven 16 blijft mogelijk: het betreft een klein brongebied,
  // niet een steeds groter wordende bitmap van het hele knipsel.
  let niveau = 2 ** Math.ceil(Math.log2(schaal));
  if (niveau <= Math.min(16, MAX_PIXELS / Math.max(regio.width, regio.height))) {
    fallback(); return;
  }
  let x0 = 0, y0 = 0, x1 = ctx.canvas.width, y1 = ctx.canvas.height;
  // Een legacy paginacanvas kan groter zijn dan het venster. Ook daar alleen
  // zichtbare pixels aanvragen; losse export/testcanvassen gebruiken hun maat.
  if (ctx.canvas.isConnected) {
    const r = ctx.canvas.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      x0 = Math.max(0, -r.left) * ctx.canvas.width / r.width;
      y0 = Math.max(0, -r.top) * ctx.canvas.height / r.height;
      x1 = Math.min(r.width, window.innerWidth-r.left) * ctx.canvas.width / r.width;
      y1 = Math.min(r.height, window.innerHeight-r.top) * ctx.canvas.height / r.height;
    }
  }
  if (x1 <= x0 || y1 <= y0) return;
  const inverse = m.inverse();
  const corners = [[x0,y0],[x1,y0],[x0,y1],[x1,y1]].map(([x,y]) => inverse.transformPoint({x,y}));
  const left = Math.max(0, (Math.min(...corners.map(p => p.x))-ann.x) / ann.width * regio.width);
  const top = Math.max(0, (Math.min(...corners.map(p => p.y))-ann.y) / ann.height * regio.height);
  const right = Math.min(regio.width, (Math.max(...corners.map(p => p.x))-ann.x) / ann.width * regio.width);
  const bottom = Math.min(regio.height, (Math.max(...corners.map(p => p.y))-ann.y) / ann.height * regio.height);
  if (right <= left || bottom <= top) return;
  const grid = () => ({ left: Math.floor(left*niveau/DETAIL_PIXELS), top: Math.floor(top*niveau/DETAIL_PIXELS),
    right: Math.ceil(right*niveau/DETAIL_PIXELS), bottom: Math.ceil(bottom*niveau/DETAIL_PIXELS) });
  let g = grid();
  // Ook extreem uitgerekte knipsels of enorme schermen blijven binnen de LRU.
  while ((g.right-g.left)*(g.bottom-g.top) > MAX_VISIBLE_TILES) { niveau /= 2; g = grid(); }
  const prefix = `${ann.snippetKey}|${vakSleutel(ann.srcBox)}|detail|${niveau}|`;
  for (let row=g.top; row<g.bottom; row++) {
    for (let col=g.left; col<g.right; col++) {
      const x = col*DETAIL_PIXELS/niveau, y = row*DETAIL_PIXELS/niveau;
      const w = Math.min(DETAIL_PIXELS/niveau, regio.width-x);
      const h = Math.min(DETAIL_PIXELS/niveau, regio.height-y);
      const key = `${prefix}${col}_${row}`;
      const bmp = _bitmaps.get(key);
      const dx = ann.x+x/regio.width*ann.width, dy = ann.y+y/regio.height*ann.height;
      const dw = w/regio.width*ann.width, dh = h/regio.height*ann.height;
      if (bmp) {
        _bitmaps.delete(key); _bitmaps.set(key,bmp);
        // Eén pixel rondom laat bilineaire filtering over de tegelrand kijken.
        ctx.drawImage(kleur(bmp), 1, 1, w*niveau, h*niveau, dx, dy, dw, dh);
      } else {
        if (_bezig.size < MAX_PENDING_DETAILS) {
          vraagAan(ann, niveau, key, { x: regio.x+x-1/niveau, y: regio.y+y-1/niveau,
            width: w+2/niveau, height: h+2/niveau });
        }
        ctx.drawImage(overzicht, x/regio.width*overzicht.width, y/regio.height*overzicht.height,
          w/regio.width*overzicht.width, h/regio.height*overzicht.height, dx, dy, dw, dh);
      }
    }
  }
}

async function renderDetail(ann, regio, niveau) {
  const pad = await padVan(ann.snippetKey, schrijfNaarTijdelijkeMap);
  return pad ? rasterVanPad(pad, regio, niveau) : null;
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

/** Foutcode van een knipsel dat niet in de uitvoer kan; exporter.js maakt er
 *  een melding voor de gebruiker van. */
export const KNIPSEL_UITVOER_FOUT = 'KNIPSEL_UITVOER';

function uitvoerFout(tekst, oorzaak) {
  const fout = oorzaak
    ? new Error(`${tekst}: ${oorzaak?.message || oorzaak}`, { cause: oorzaak })
    : new Error(tekst);
  fout.code = KNIPSEL_UITVOER_FOUT;
  return fout;
}

/** Beeldpunten voor alle knipsels van één uitvoerpagina samen (256 MB RGBA). */
const UITVOER_BUDGET = 64 * 1024 * 1024;
/** Langste zijde van een uitvoerbeeld: de grens van een canvas. */
const UITVOER_MAX_ZIJDE = 16384;

/** Uitvoer wacht onafhankelijk van schermzoom/RAF op alle benodigde knipsels.
 * De aanroeper sluit de tijdelijke bitmaps na het tekenen. Mislukken breekt
 * de uitvoer af: nooit ongemerkt een placeholder afdrukken (#511).
 *
 * Anders dan het scherm is de uitvoer niet begrensd op MAX_PIXELS: een knipsel
 * wordt gerenderd op de resolutie van de uitvoer, in tegels die elk in het
 * gedeelde geheugen van de worker passen. Alleen als alle knipsels van de
 * pagina samen meer dan UITVOER_BUDGET beeldpunten zouden vragen, gaan ze naar
 * evenredig omlaag.
 */
export async function bereidKnipselsVoorUitvoer(annotaties, schaal) {
  const beelden = new Map();
  try {
    const plan = [];
    for (const ann of annotaties) {
      if (ann.type !== 'vectorSnippet' || ann.hidden) continue;
      const blad = await bladVan(ann.snippetKey);
      if (!blad) throw uitvoerFout('Vectorknipsel: bron ontbreekt');
      const regio = weergaveVak(ann.srcBox, blad.cropBox, blad.rotatie);
      if (!(regio.width > 0) || !(regio.height > 0)) throw uitvoerFout('Vectorknipsel: leeg gebied');
      plan.push({ ann, regio, niveau: schaal * Math.max(ann.width / regio.width, ann.height / regio.height) });
    }
    const gevraagd = plan.reduce((n, p) => n + p.regio.width * p.regio.height * p.niveau ** 2, 0);
    const factor = gevraagd > UITVOER_BUDGET ? Math.sqrt(UITVOER_BUDGET / gevraagd) : 1;
    for (const { ann, regio, niveau } of plan) {
      let bmp;
      try {
        bmp = await renderVoorUitvoer(ann, regio, niveau * factor);
      } catch (err) {
        throw uitvoerFout('Vectorknipsel kon niet worden gerenderd', err);
      }
      if (!bmp) throw uitvoerFout('Vectorknipsel kon niet worden gerenderd');
      beelden.set(ann, bmp);
    }
    return beelden;
  } catch (err) {
    for (const bmp of beelden.values()) bmp.close();
    throw err;
  }
}

/**
 * Het knipsel op schaal `niveau` (beeldpunten per punt). Past het in één tegel
 * van MAX_PIXELS, dan in één keer; anders in tegels, samengevoegd op één canvas.
 * @returns {Promise<ImageBitmap|null>}
 */
async function renderVoorUitvoer(ann, regio, niveau) {
  const pad = await padVan(ann.snippetKey, schrijfNaarTijdelijkeMap);
  if (!pad) return null;
  const s = Math.min(niveau, UITVOER_MAX_ZIJDE / Math.max(regio.width, regio.height));
  if (!(s > 0)) return null;
  const breedte = Math.ceil(regio.width * s);
  const hoogte = Math.ceil(regio.height * s);
  if (breedte <= MAX_PIXELS && hoogte <= MAX_PIXELS) {
    return rasterVanPad(pad, { x: regio.x, y: regio.y, width: regio.width, height: regio.height }, s);
  }
  const canvas = new OffscreenCanvas(breedte, hoogte);
  const ctx = canvas.getContext('2d');
  for (let ty = 0; ty < hoogte; ty += MAX_PIXELS) {
    for (let tx = 0; tx < breedte; tx += MAX_PIXELS) {
      const tb = Math.min(MAX_PIXELS, breedte - tx);
      const th = Math.min(MAX_PIXELS, hoogte - ty);
      const tegel = await rasterBytesVanPad(pad, { x: regio.x + tx / s, y: regio.y + ty / s, width: tb / s, height: th / s }, s);
      if (!tegel) return null;
      // De worker rondt de tegelmaat naar boven af: het teveel valt buiten het vak.
      ctx.putImageData(new ImageData(tegel.rgba, tegel.breedte, tegel.hoogte), tx, ty,
        0, 0, Math.min(tb, tegel.breedte), Math.min(th, tegel.hoogte));
    }
  }
  return await createImageBitmap(canvas);
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

// ─── Lijnwerk in één kleur (#1024) ────────────────────────────────────────
// Schermbeeld van een knipsel met een lijnkleur: elke pixel wordt de kleur,
// met als dekking zijn donkerte (inkt = de kleur, wit wordt doorzichtig,
// grijs een lichtere tint). Precies wat het luminantie-masker doet dat de
// saver schrijft, zodat scherm en bestand gelijk zijn. Per tegel en kleur één
// keer gerekend.
const _gekleurd = new WeakMap();

export function gekleurdeTegel(bmp, kleur) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(kleur || ''));
  if (!bmp || !m) return bmp;
  const vorig = _gekleurd.get(bmp);
  if (vorig && vorig.kleur === kleur) return vorig.canvas;
  const w = bmp.width, h = bmp.height;
  if (!(w > 0 && h > 0)) return bmp;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const beeld = ctx.getImageData(0, 0, w, h);
  const d = beeld.data;
  const kr = parseInt(m[1].slice(0, 2), 16), kg = parseInt(m[1].slice(2, 4), 16), kb = parseInt(m[1].slice(4, 6), 16);
  for (let i = 0; i < d.length; i += 4) {
    const inkt = 1 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    d[i] = kr;
    d[i + 1] = kg;
    d[i + 2] = kb;
    d[i + 3] = Math.round(d[i + 3] * inkt);
  }
  ctx.putImageData(beeld, 0, 0);
  _gekleurd.set(bmp, { kleur, canvas });
  return canvas;
}

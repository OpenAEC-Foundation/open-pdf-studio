// Meetschaal uit de PDF zelf: `/VP`-viewports met een `/Measure`-woordenboek
// (ISO 32000, 12.9). CAD-programma's schrijven ze bij het plotten, en de
// DWG/DXF-import van deze app ook (#400). De maatvoering gebruikt ze nu
// meteen, zonder dat de gebruiker hoeft te kalibreren (zie getMeasureScale).
//
// De viewports worden alleen gelezen; de PDF blijft ongewijzigd.

import { PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString } from 'pdf-lib';

/** Millimeters per eenheid voor de eenheden die in een `/U`-label voorkomen. */
const MM_PER = Object.freeze({ mm: 1, cm: 10, dm: 100, m: 1000, km: 1000000, in: 25.4, ft: 304.8, yd: 914.4, mi: 1609344 });

/**
 * Eenheid uit het vrije `/U`-label van een getalopmaak. Leeg of onbekend geeft
 * null (de aanroeper neemt dan millimeters aan, zoals CAD-plots met een leeg
 * label bedoelen).
 * @param {string} label
 */
export function eenheidUitLabel(label) {
  const u = String(label ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!u) return null;
  if (u === 'mm' || u === 'millimeter' || u === 'millimetre') return 'mm';
  if (u === 'cm' || u === 'centimeter' || u === 'centimetre') return 'cm';
  if (u === 'dm' || u === 'decimeter' || u === 'decimetre') return 'dm';
  if (u === 'm' || u === 'meter' || u === 'metre') return 'm';
  if (u === 'km') return 'km';
  if (u === 'in' || u === 'inch' || u === 'inches' || u === '"' || u === "''") return 'in';
  if (u === 'ft' || u === 'feet' || u === 'foot' || u === "'") return 'ft';
  if (u === 'yd' || u === 'yard' || u === 'yards') return 'yd';
  if (u === 'mi' || u === 'mile' || u === 'miles') return 'mi';
  return null;
}

/**
 * Meetschaal in de vorm van de app uit de eerste getalopmaak van `/X`:
 * `C` eenheden per punt, eenheid uit `U`.
 * @param {number} c
 * @param {string} u
 * @returns {{pixelsPerUnit:number, unit:string, mmPerPoint:number} | null}
 */
export function schaalUitMeasure(c, u) {
  const factor = Number(c);
  if (!(factor > 0) || !Number.isFinite(factor)) return null;
  const eenheid = eenheidUitLabel(u) || 'mm';
  const mmPerPoint = factor * MM_PER[eenheid];
  // De app kent mm, cm, m, in en ft; km, yd en mi gaan naar m of ft.
  switch (eenheid) {
    case 'km': return { pixelsPerUnit: 1 / (factor * 1000), unit: 'm', mmPerPoint };
    // De app kent geen decimeters; tien keer zoveel centimeters.
    case 'dm': return { pixelsPerUnit: 1 / (factor * 10), unit: 'cm', mmPerPoint };
    case 'yd': return { pixelsPerUnit: 1 / (factor * 3), unit: 'ft', mmPerPoint };
    case 'mi': return { pixelsPerUnit: 1 / (factor * 5280), unit: 'ft', mmPerPoint };
    default: return { pixelsPerUnit: 1 / factor, unit: eenheid, mmPerPoint };
  }
}

/**
 * Eén punt uit de PDF-gebruikersruimte naar de app-ruimte (zie naarAppRuimte).
 * @returns {[number, number]}
 */
export function puntNaarAppRuimte(x, y, viewBox, rotatie) {
  const [vx0, vy0, vx1, vy1] = viewBox;
  const W = vx1 - vx0;
  const H = vy1 - vy0;
  const r = (((Number(rotatie) || 0) % 360) + 360) % 360;
  const u = x - vx0;
  const v = y - vy0;
  switch (r) {
    case 90: return [v, u];
    case 180: return [W - u, v];
    case 270: return [H - v, W - u];
    default: return [u, H - v];
  }
}

/**
 * Rechthoek in PDF-gebruikersruimte naar de app-ruimte: de weergegeven pagina
 * (/Rotate toegepast), oorsprong linksboven van de zichtbare box, y omlaag.
 * @param {number[]} bbox     [x0, y0, x1, y1] in gebruikersruimte
 * @param {number[]} viewBox  zichtbare box [x0, y0, x1, y1] (CropBox ∩ MediaBox)
 * @param {number} rotatie    /Rotate
 */
export function naarAppRuimte(bbox, viewBox, rotatie) {
  const punt = (x, y) => puntNaarAppRuimte(x, y, viewBox, rotatie);
  const a = punt(bbox[0], bbox[1]);
  const b = punt(bbox[2], bbox[3]);
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}

function getal(obj) {
  return obj instanceof PDFNumber ? obj.asNumber() : null;
}

function tekst(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try { return obj.decodeText(); } catch { return ''; }
  }
  return '';
}

function rechthoek(arr) {
  if (!(arr instanceof PDFArray) || arr.size() < 4) return null;
  const v = [0, 1, 2, 3].map((i) => getal(arr.lookup(i)));
  return v.every((n) => n !== null && Number.isFinite(n)) ? v : null;
}

/** Hoogste aantal hoekpunten dat uit een `/OPS_Clip` gelezen wordt. */
const MAX_VEELHOEK = 4096;

/**
 * De eigen vorm van een viewport (`/OPS_Clip [x0 y0 x1 y1 …]`, geschreven door
 * de DWG/DXF-import bij een niet-rechthoekig venster) als punten in app-ruimte.
 * Alles wat niet klopt (oneven aantal, geen getal, te veel punten) geeft null:
 * dan geldt de omhullende.
 */
function veelhoekUit(arr, viewBox, rotatie) {
  if (!(arr instanceof PDFArray)) return null;
  const n = arr.size();
  if (n < 6 || n % 2 !== 0 || n > 2 * MAX_VEELHOEK) return null;
  const punten = [];
  for (let i = 0; i < n; i += 2) {
    const x = getal(arr.lookup(i));
    const y = getal(arr.lookup(i + 1));
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    punten.push(puntNaarAppRuimte(x, y, viewBox, rotatie));
  }
  return punten;
}

/** Ligt het punt binnen de veelhoek (even-oneven, rand telt mee als binnen)? */
export function puntInVeelhoek(veelhoek, x, y) {
  let binnen = false;
  for (let i = 0, j = veelhoek.length - 1; i < veelhoek.length; j = i++) {
    const [xi, yi] = veelhoek[i];
    const [xj, yj] = veelhoek[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) binnen = !binnen;
  }
  return binnen;
}

function doorsnede(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2]));
  const y0 = Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3]));
  const x1 = Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2]));
  const y1 = Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3]));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : a;
}

/** Zoekt een geërfde paginasleutel (MediaBox, CropBox, Rotate) op. */
function geerfd(node, naam) {
  let n = node;
  for (let i = 0; n && i < 32; i++) {
    const v = n.lookup(PDFName.of(naam));
    if (v !== undefined && v !== null) return v;
    const ouder = n.lookup(PDFName.of('Parent'));
    n = ouder instanceof PDFDict ? ouder : null;
  }
  return null;
}

/**
 * Viewports met een meetschaal van één pdf-lib-pagina, in app-ruimte.
 * @param {import('pdf-lib').PDFPage} pagina
 * @returns {Array<{x:number,y:number,width:number,height:number,
 *   pixelsPerUnit:number, unit:string, mmPerPoint:number, ratio:string, name:string}>}
 */
export function leesViewportsVanPagina(pagina) {
  const lijst = [];
  try {
    const node = pagina.node;
    const vp = node.lookup(PDFName.of('VP'));
    if (!(vp instanceof PDFArray)) return lijst;
    const media = rechthoek(geerfd(node, 'MediaBox'));
    if (!media) return lijst;
    const view = doorsnede(media, rechthoek(geerfd(node, 'CropBox')));
    const rot = getal(geerfd(node, 'Rotate')) || 0;
    for (let j = 0; j < vp.size(); j++) {
      const d = vp.lookup(j);
      if (!(d instanceof PDFDict)) continue;
      const measure = d.lookup(PDFName.of('Measure'));
      const bbox = rechthoek(d.lookup(PDFName.of('BBox')));
      if (!(measure instanceof PDFDict) || !bbox) continue;
      const sub = measure.lookup(PDFName.of('Subtype'));
      if (sub && sub.toString() !== '/RL') continue;
      const x = measure.lookup(PDFName.of('X'));
      if (!(x instanceof PDFArray) || x.size() < 1) continue;
      const opmaak = x.lookup(0);
      if (!(opmaak instanceof PDFDict)) continue;
      const schaal = schaalUitMeasure(getal(opmaak.lookup(PDFName.of('C'))), tekst(opmaak.lookup(PDFName.of('U'))));
      if (!schaal) continue;
      const rect = naarAppRuimte(bbox, view, rot);
      if (!(rect.width > 0 && rect.height > 0)) continue;
      const viewport = {
        ...rect,
        ...schaal,
        ratio: tekst(measure.lookup(PDFName.of('R'))).trim(),
        name: tekst(d.lookup(PDFName.of('Name'))).trim(),
      };
      const veelhoek = veelhoekUit(d.lookup(PDFName.of('OPS_Clip')), view, rot);
      if (veelhoek) viewport.veelhoek = veelhoek;
      lijst.push(viewport);
    }
  } catch {
    // Een kapotte viewport op één pagina mag de rest niet tegenhouden.
  }
  return lijst;
}

/**
 * Viewports van een reeks pagina's, genummerd vanaf `eerstePagina`.
 * @param {import('pdf-lib').PDFPage[]} paginas
 * @param {number} eerstePagina  1-gebaseerd nummer van de eerste pagina
 */
export function viewportsVanPaginas(paginas, eerstePagina = 1) {
  const uit = {};
  (paginas || []).forEach((pagina, i) => {
    const lijst = leesViewportsVanPagina(pagina);
    if (lijst.length) uit[eerstePagina + i] = lijst;
  });
  return uit;
}

/**
 * Leest alle viewports met een meetschaal uit een pdf-lib-document.
 * @param {import('pdf-lib').PDFDocument} pdfLibDoc
 * @returns {Record<number, ReturnType<typeof leesViewportsVanPagina>>}
 *   per 1-gebaseerd paginanummer; pagina's zonder viewports ontbreken
 */
export function leesPdfViewports(pdfLibDoc) {
  let paginas;
  try { paginas = pdfLibDoc.getPages(); } catch { return {}; }
  return viewportsVanPaginas(paginas, 1);
}

// ── Achtergrondlezing ───────────────────────────────────────────────────────
// De viewports worden op de achtergrond gelezen (bij openen, na bijsnijden,
// rechtzetten, ongedaan maken). Komt er intussen een andere versie van het
// document, dan mag de oude lezing niet alsnog binnenkomen, en moet wie de
// nieuwe versie zet weten dát er nog een lezing openstond: de tussenwaarde is
// dan afgeleid van viewports die zelf nog niet bijgewerkt waren (#400).

let lezingTeller = 0;

/**
 * Begint een lezing voor dit document en maakt elke eerdere ongeldig.
 * @param {object} doc  het document uit de app-state
 * @returns {number} kenmerk van deze lezing
 */
export function beginViewportLezing(doc) {
  lezingTeller += 1;
  doc._viewportLezing = lezingTeller;
  return lezingTeller;
}

/** Staat er voor dit document nog een lezing open? */
export function viewportLezingLoopt(doc) {
  return doc?._viewportLezing != null;
}

/**
 * Rondt een lezing af. Alleen de laatst begonnen lezing mag haar uitkomst
 * zetten; `viewports` is `null` als het lezen mislukte.
 * @returns {boolean} true als de uitkomst gezet is (of de mislukking verwerkt)
 */
export function rondViewportLezingAf(doc, kenmerk, viewports) {
  if (!doc || doc._viewportLezing !== kenmerk) return false;
  doc._viewportLezing = null;
  if (viewports) doc.pdfViewports = Object.keys(viewports).length ? viewports : undefined;
  return true;
}

/**
 * Viewports na een wijziging in de paginavolgorde (invoegen, verwijderen,
 * verplaatsen, vervangen), zonder het document opnieuw te lezen: de bestaande
 * viewports verhuizen mee volgens `pageMapping` (oud → nieuw, `null` =
 * verdwenen) en de viewports van nieuwe pagina's komen erbij.
 * @param {Record<number, any[]>|undefined} oud
 * @param {Record<number, number|null>} pageMapping
 * @param {Record<number, any[]>} [nieuw]  viewports van nieuwe pagina's, op hun nieuwe nummer
 * @returns {Record<number, any[]>|undefined}  undefined als er geen enkele is
 */
export function herschikViewports(oud, pageMapping, nieuw = {}) {
  const uit = {};
  for (const [pagina, lijst] of Object.entries(oud || {})) {
    const naar = pageMapping?.[pagina];
    if (naar == null) continue;
    uit[naar] = lijst;
  }
  for (const [pagina, lijst] of Object.entries(nieuw || {})) {
    if (lijst?.length) uit[pagina] = lijst;
  }
  return Object.keys(uit).length ? uit : undefined;
}

/**
 * De binnenste viewport die het punt bevat (kleinste oppervlak eerst), of null.
 * Een viewport met een eigen vorm (`veelhoek`) bevat het punt alleen als het
 * binnen die vorm ligt: de lege hoek van zijn omhullende is van de buren.
 * @param {Array<{x:number,y:number,width:number,height:number,veelhoek?:number[][]}>} viewports
 */
export function viewportOp(viewports, x, y) {
  if (!Array.isArray(viewports) || x == null || y == null) return null;
  let beste = null;
  for (const v of viewports) {
    if (x < v.x || x > v.x + v.width || y < v.y || y > v.y + v.height) continue;
    if (Array.isArray(v.veelhoek) && v.veelhoek.length >= 3 && !puntInVeelhoek(v.veelhoek, x, y)) continue;
    if (!beste || v.width * v.height < beste.width * beste.height) beste = v;
  }
  return beste;
}

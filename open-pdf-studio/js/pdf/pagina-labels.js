// Paginalabels (bladnamen): "S-101 - BEGANE GROND" in plaats van 1, 2, 3.
//
// De labels staan op het document als `doc.pageLabels` (lijst, index 0 =
// pagina 1; null = gewone paginanummers) en gaan bij het opslaan als de
// standaard /PageLabels-getallenboom in de catalogus (ISO 32000, 12.4.2), zodat
// andere PDF-lezers dezelfde namen tonen. Alleen pdf-lib en pure rekenwerk:
// node-testbaar. De koppeling met de app staat in pagina-labels-app.js.
//
// De naambouwer leest per pagina de tekst uit een paar vakken (bladnummer,
// bladtitel). Eerst de tekstlaag van de PDF (snel en exact voor CAD-uitvoer);
// alleen waar een vak leeg is OCR. Het vak van een tekstloop volgt de eigen
// richting van die loop (itemBox): CAD-bladen staan vaak ongedraaid met
// /Rotate 90 opgeslagen, hun onderhoektekst loopt dan in PDF-ruimte omhoog.

import { PDFName, PDFNumber, PDFHexString } from 'pdf-lib';
import { itemBox, pageTextSpans } from '../text/mcp-page-text.js';

// ── Labels als lijst ─────────────────────────────────────────────────────

/** Gewone nummering 1..N: dan bewaart het document null. */
export function zijnGewoneNummers(labels) {
  return Array.isArray(labels) && labels.every((l, i) => l === String(i + 1));
}

/**
 * Een volledige lijst van `aantal` labels: leeg of ontbrekend wordt het
 * paginanummer, witruimte wordt één spatie. Alleen gewone nummers → null.
 */
export function normaliseerLabels(labels, aantal) {
  if (!Array.isArray(labels) || !(aantal > 0)) return null;
  const uit = Array.from({ length: aantal }, (_, i) => {
    const l = labels[i];
    const s = typeof l === 'string' ? l.replace(/\s+/g, ' ').trim() : '';
    return s || String(i + 1);
  });
  return zijnGewoneNummers(uit) ? null : uit;
}

/** Label van een pagina, of haar nummer als ze er geen heeft. */
export function labelVan(labels, pageNum) {
  const l = labels?.[pageNum - 1];
  return typeof l === 'string' && l ? l : String(pageNum);
}

/** Toont de pagina een naam in plaats van haar nummer? */
export function heeftEigenLabel(labels, pageNum) {
  const l = labels?.[pageNum - 1];
  return typeof l === 'string' && !!l && l !== String(pageNum);
}

/**
 * Labels na invoegen, verwijderen of verplaatsen van pagina's. `pageMapping`
 * is oud paginanummer → nieuw paginanummer (null = verwijderd), zoals de
 * paginabeheerder hem bouwt. Een naam verhuist mee met zijn pagina; een label
 * dat gewoon het oude paginanummer was, wordt het nieuwe nummer. Nieuwe
 * pagina's krijgen hun nummer.
 */
export function herschikLabels(labels, pageMapping, aantal) {
  if (!Array.isArray(labels) || !pageMapping) return labels ?? null;
  const uit = new Array(aantal).fill('');
  for (const [oudTekst, nieuw] of Object.entries(pageMapping)) {
    const oud = Number(oudTekst);
    if (nieuw == null || !(nieuw >= 1 && nieuw <= aantal)) continue;
    const l = labels[oud - 1];
    if (typeof l === 'string' && l && l !== String(oud)) uit[nieuw - 1] = l;
  }
  return normaliseerLabels(uit, aantal);
}

/**
 * Labels van ingevoegde pagina's erbij (samenvoegen): `ingevoegd` is
 * paginanummer → label, zoals het samengevoegde bestand ze heeft. De andere
 * pagina's houden hun label, of hun nummer.
 */
export function vulLabelsAan(labels, ingevoegd, aantal) {
  if (!(ingevoegd instanceof Map) || ingevoegd.size === 0) return labels ?? null;
  const uit = Array.from({ length: aantal }, (_, i) => labelVan(labels, i + 1));
  for (const [pagina, label] of ingevoegd) {
    if (pagina >= 1 && pagina <= aantal && typeof label === 'string') uit[pagina - 1] = label;
  }
  return normaliseerLabels(uit, aantal);
}

// ── Labels als /PageLabels-reeksen ───────────────────────────────────────

const ROMEINS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

function romeins(n) {
  let rest = n;
  let uit = '';
  for (const [waarde, teken] of ROMEINS) {
    while (rest >= waarde) { uit += teken; rest -= waarde; }
  }
  return uit;
}

function vanRomeins(tekst) {
  const waarde = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const t = tekst.toUpperCase();
  let som = 0;
  for (let i = 0; i < t.length; i++) {
    const nu = waarde[t[i]];
    const volgende = waarde[t[i + 1]] || 0;
    som += nu < volgende ? -nu : nu;
  }
  return som > 0 && romeins(som) === t ? som : 0;
}

// Letters zoals PDF-lezers ze tellen: A..Z, AA..ZZ, AAA..
function letters(n, klein) {
  const i = n - 1;
  return String.fromCharCode((klein ? 97 : 65) + (i % 26)).repeat(Math.floor(i / 26) + 1);
}

/**
 * De tekst die een PDF-lezer toont voor nummer `nummer` van een reeks
 * { S, P }: voorvoegsel plus het nummer in de stijl van de reeks (D, R, r,
 * A, a); zonder stijl alleen het voorvoegsel.
 */
export function labelInReeks(reeks, nummer) {
  const p = reeks.P || '';
  switch (reeks.S) {
    case 'D': return p + nummer;
    case 'R': return p + romeins(nummer);
    case 'r': return p + romeins(nummer).toLowerCase();
    case 'A': return p + letters(nummer, false);
    case 'a': return p + letters(nummer, true);
    default: return p;
  }
}

// Mogelijke beschrijvingen van één label als begin van een reeks. Een kaal
// getal staat vooraan: bij gelijkspel blijft een paginanummer een nummer.
function kandidaten(label) {
  const uit = [{ P: label, St: 1 }];
  let m = /^(.*?)([1-9]\d*)$/.exec(label);
  if (m && Number.isSafeInteger(Number(m[2]))) {
    const d = { S: 'D', P: m[1], St: Number(m[2]) };
    if (m[1]) uit.push(d); else uit.unshift(d);
  }
  m = /^(.*?)([ivxlcdm]+)$/.exec(label);
  if (m && vanRomeins(m[2])) uit.push({ S: 'r', P: m[1], St: vanRomeins(m[2]) });
  m = /^(.*?)([IVXLCDM]+)$/.exec(label);
  if (m && vanRomeins(m[2])) uit.push({ S: 'R', P: m[1], St: vanRomeins(m[2]) });
  m = /^(.*?)(([a-z])\3*)$/.exec(label);
  if (m) uit.push({ S: 'a', P: m[1], St: (m[2].length - 1) * 26 + (m[3].charCodeAt(0) - 97) + 1 });
  m = /^(.*?)(([A-Z])\3*)$/.exec(label);
  if (m) uit.push({ S: 'A', P: m[1], St: (m[2].length - 1) * 26 + (m[3].charCodeAt(0) - 65) + 1 });
  return uit.filter((k) => labelInReeks(k, k.St) === label);
}

/**
 * Zo weinig mogelijk reeksen die precies `labels` opleveren. Per startpagina
 * wint de beschrijving die de meeste volgende pagina's dekt; bij gelijkspel
 * het kale voorvoegsel. Zo blijven romeinse en doorlopende nummers na een
 * bewerking ook als nummering in het bestand staan.
 * @returns {Array<{index:number, S?:string, P:string, St:number}>}
 */
export function paginaLabelReeksen(labels) {
  const reeksen = [];
  let i = 0;
  while (i < labels.length) {
    let beste = null;
    let besteLengte = 0;
    for (const k of kandidaten(labels[i])) {
      let n = 1;
      while (i + n < labels.length && labelInReeks(k, k.St + n) === labels[i + n]) n++;
      if (n > besteLengte) { beste = k; besteLengte = n; }
    }
    reeksen.push({ index: i, ...beste });
    i += besteLengte;
  }
  return reeksen;
}

/**
 * Schrijft `labels` als /PageLabels in de catalogus van een pdf-lib-document;
 * null of gewone nummers halen de sleutel weg.
 */
export function schrijfPaginaLabels(pdfDocLib, labels) {
  const context = pdfDocLib.context;
  const catalogus = context.lookup(context.trailerInfo.Root);
  if (!catalogus) return;
  const lijst = normaliseerLabels(labels, pdfDocLib.getPageCount());
  if (!lijst) {
    catalogus.delete(PDFName.of('PageLabels'));
    return;
  }
  const nums = [];
  for (const r of paginaLabelReeksen(lijst)) {
    const dict = {};
    if (r.S) dict.S = PDFName.of(r.S);
    if (r.P) dict.P = PDFHexString.fromText(r.P);
    if (r.S && r.St !== 1) dict.St = PDFNumber.of(r.St);
    nums.push(PDFNumber.of(r.index), context.obj(dict));
  }
  catalogus.set(PDFName.of('PageLabels'), context.obj({ Nums: nums }));
}

/**
 * Bij het opslaan: alleen bewerkte labels gaan het bestand in. Een bestand
 * waarvan de /PageLabels een andere nummering gebruiken (romeins, met
 * voorvoegsel) blijft dan precies zoals het was.
 */
export function slaPaginaLabelsOp(pdfDocLib, doc) {
  if (!doc?.pageLabelsDirty) return false;
  schrijfPaginaLabels(pdfDocLib, doc.pageLabels ? Array.from(doc.pageLabels) : null);
  return true;
}

// ── Tekst in een vak ─────────────────────────────────────────────────────

function middenBinnen(b, r) {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
}

/**
 * Tekstvakken ({x, y, width, height, text}) als één regel: per regel van links
 * naar rechts, regels van boven naar onder, met spaties ertussen. Een titel
 * over twee regels wordt zo één naam.
 */
export function regelsTotTekst(vakken) {
  const lijst = (vakken || [])
    .filter((v) => typeof v?.text === 'string' && v.text.trim())
    .sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x);
  const regels = [];
  for (const v of lijst) {
    const cy = v.y + v.height / 2;
    const regel = regels.find((r) => Math.abs(r.cy - cy) < Math.max(1, Math.min(r.h, v.height) * 0.5));
    if (regel) regel.vakken.push(v);
    else regels.push({ cy, h: v.height, vakken: [v] });
  }
  return regels
    .sort((a, b) => a.cy - b.cy)
    .map((r) => r.vakken.sort((a, b) => a.x - b.x).map((v) => v.text.trim()).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tekst uit de tekstlaag binnen `vak` ({x, y, width, height} in app-ruimte:
 * pagina linksboven, y omlaag, schaal 1, met de paginadraaiing). `viewport`
 * is de PDF.js-viewport op schaal 1 in diezelfde ruimte. Een tekstloop telt
 * mee als zijn midden in het vak ligt; losse letters (CAD) worden weer woorden.
 */
export function tekstInGebied(items, viewport, vak) {
  const raak = [];
  for (const item of items || []) {
    if (typeof item?.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) continue;
    if (middenBinnen(itemBox(item, viewport), vak)) raak.push(item);
  }
  if (!raak.length) return '';
  const spans = pageTextSpans(raak, {}, viewport, 'paginalabel', 0);
  return regelsTotTekst(spans.map((s) => ({ ...s.bbox, text: s.text })));
}

/**
 * Een vak op een pagina van `breedte` × `hoogte` (y omlaag) rechtsom gedraaid
 * met `graden` (90, 180, 270), samen met die pagina.
 */
export function draaiVak(vak, breedte, hoogte, graden) {
  const { x, y, width: w, height: h } = vak;
  switch (((graden % 360) + 360) % 360) {
    case 90: return { x: hoogte - (y + h), y: x, width: h, height: w };
    case 180: return { x: breedte - (x + w), y: hoogte - (y + h), width: w, height: h };
    case 270: return { x: y, y: breedte - (x + w), width: h, height: w };
    default: return { x, y, width: w, height: h };
  }
}

/** Tekst van OCR-woorden ({text, left, top, width, height}) binnen `vak`. */
export function woordenInGebied(woorden, vak) {
  const vakken = (woorden || [])
    .map((w) => ({ x: w.left, y: w.top, width: w.width, height: w.height, text: w.text }))
    .filter((b) => typeof b.text === 'string' && b.text.trim() && middenBinnen(b, vak));
  return regelsTotTekst(vakken);
}

// ── Verticale tekst via OCR (#954) ───────────────────────────────────────
// Tesseract leest alleen liggende regels. Een bladnummer dat in het
// tekeningstempel een kwartslag gedraaid staat, komt bij 0° leeg of als
// onzin met lage zekerheid terug. Dan lezen we de pagina nog eens een
// kwartslag rechtsom en linksom gedraaid en nemen de zekerste lezing.

/** Extra draaiingen (rechtsom, graden) die geprobeerd worden. */
export const OCR_DRAAIINGEN = [90, 270];
/** Vanaf deze gemiddelde zekerheid (0..100) is een lezing bij 0° goed genoeg. */
export const OCR_GOED_GENOEG = 70;
/** Een gedraaide lezing moet zoveel punten zekerder zijn om te winnen. */
export const OCR_MARGE = 5;

/**
 * Lezing van OCR-woorden ({text, left, top, width, height, confidence})
 * binnen `vak`: de tekst en de gemiddelde zekerheid, gewogen naar het aantal
 * tekens (null als geen woord een zekerheid heeft).
 * @returns {{tekst:string, score:number|null, graden:number}}
 */
export function ocrLezing(woorden, vak, graden = 0) {
  const raak = (woorden || []).filter((w) => typeof w?.text === 'string' && w.text.trim()
    && middenBinnen({ x: w.left, y: w.top, width: w.width, height: w.height }, vak));
  const tekst = regelsTotTekst(raak.map((w) => ({ x: w.left, y: w.top, width: w.width, height: w.height, text: w.text })));
  let tekens = 0;
  let som = 0;
  for (const w of raak) {
    if (!Number.isFinite(w.confidence)) continue;
    const n = w.text.trim().length;
    tekens += n;
    som += n * Math.max(0, Math.min(100, w.confidence));
  }
  return { tekst, score: tekens ? som / tekens : null, graden };
}

/** Moet het vak ook gedraaid gelezen worden? Leeg of onzeker bij 0°. */
export function moetGedraaidLezen(lezing) {
  if (!lezing?.tekst) return true;
  return lezing.score !== null && lezing.score < OCR_GOED_GENOEG;
}

/**
 * De beste lezing: de eerste niet-lege, tenzij een latere duidelijk (meer dan
 * OCR_MARGE) zekerder is. Zet de ongedraaide lezing dus vooraan.
 * @returns {{tekst:string, score:number|null, graden:number}|null}
 */
export function kiesBesteOcrLezing(lezingen) {
  let beste = null;
  for (const l of lezingen || []) {
    if (!l?.tekst) continue;
    if (!beste || (l.score ?? -1) > (beste.score ?? -1) + OCR_MARGE) beste = l;
  }
  return beste;
}

/**
 * Een vak in app-ruimte (pagina met /Rotate én de draaiing `extra` uit de
 * app) naar de ruimte van dezelfde pagina met alleen /Rotate plus `graden`
 * rechtsom: de ruimte waarin OCR met die draaiing zijn woorden teruggeeft.
 * `breedte` × `hoogte`: de pagina met /Rotate, zonder app-draaiing.
 */
export function vakNaarOcrDraaiing(vak, breedte, hoogte, extra, graden) {
  const gedraaid = ((extra % 360) + 360) % 180 !== 0;
  const w = gedraaid ? hoogte : breedte;
  const h = gedraaid ? breedte : hoogte;
  return draaiVak(vak, w, h, (((graden - extra) % 360) + 360) % 360);
}

// ── Naamsjabloon ─────────────────────────────────────────────────────────

/** De vaknummers die een sjabloon gebruikt ({OCR1} → 1). */
export function plaatshouders(sjabloon) {
  const uit = new Set();
  for (const m of String(sjabloon || '').matchAll(/\{OCR(\d+)\}/gi)) uit.add(Number(m[1]));
  return [...uit];
}

const SCHEIDING = '[-\\u2013\\u2014|:;,/_]';

/**
 * Label uit een getypt sjabloon: {OCR1}, {OCR2}... staan voor de tekst uit vak
 * 1, 2... (`teksten` = { [n]: tekst }). Blijft een vak leeg, dan verdwijnt het
 * scheidingsteken dat er los bij kwam te staan ("S-101 - " → "S-101").
 */
export function vulSjabloon(sjabloon, teksten) {
  let leeg = false;
  let uit = String(sjabloon || '').replace(/\{OCR(\d+)\}/gi, (_, n) => {
    const t = String(teksten?.[Number(n)] ?? '').replace(/\s+/g, ' ').trim();
    if (!t) leeg = true;
    return t;
  });
  uit = uit.replace(/\s+/g, ' ').trim();
  if (leeg) {
    uit = uit
      .replace(new RegExp(`(\\s${SCHEIDING})(?:\\s${SCHEIDING})+(?=\\s)`, 'g'), '$1')
      .replace(new RegExp(`^(?:${SCHEIDING}|\\s)+|(?:${SCHEIDING}|\\s)+$`, 'g'), '')
      .trim();
  }
  return uit;
}

// De OCR-tekstlaag zonder pdf-lib (#880): waar een herkend woord op de pagina
// komt, en welke herkende woorden nog niet in het geladen document staan.
//
// Plaatsing. De OCR-woorden staan in de ruimte van de pagina ZOALS ZE GETOOND
// WORDT (oorsprong linksboven, punten op schaal 1, met de eigen /Rotate van
// de pagina): de ingebouwde engine leest een PDFium-render, een extensie een
// pdf.js-viewport, en beide draaien de pagina. De tekstlaag schreef ze eerst
// alsof de pagina ongedraaid was: op een liggend gescande pagina (/Rotate 90
// of 270) viel de tekst dan naast de pagina en liep ze dwars op het beeld.
// Elk woord wordt nu naar het ongedraaide paginakader omgerekend en de
// tekstrichting draait mee.
//
// Stand. Herkende woorden gaan pas bij het opslaan het bestand in. Tot dan
// vond zoeken in de app ze niet: OCR meldde "klaar", maar de pagina bleef
// onvindbaar. `ongeschrevenOcrWoorden` geeft de woorden van een pagina die nog
// niet in het geladen document staan, zodat zoeken ze meeneemt; wat er wél in
// staat, houdt de saver bij in `doc.ocrLaagInBestand` (handtekening per pagina).

import { _rotVisualMapper } from './saver/rotatie-mapper.js';

/** 0, 90, 180 of 270. */
export function normaalHoek(graden) {
  const g = Math.round((Number(graden) || 0) / 90) * 90;
  return ((g % 360) + 360) % 360;
}

/**
 * Waar een herkend woord in PDF-ruimte komt.
 * @param {{left:number, top:number, width:number, height:number}} word
 *   in de getoonde paginaruimte (zie boven)
 * @param {{ rotation?: number, cropBox: {x:number, y:number, width:number, height:number} }} opties
 *   rotation: de draaiing waarin de woorden gemeten zijn (de eigen /Rotate);
 *   cropBox: het ongedraaide paginakader in PDF-ruimte
 * @returns {{ x:number, y:number, cos:number, sin:number, grootte:number }}
 *   het beginpunt op de onderrand van het woord (PDF-ruimte, y omhoog), de
 *   tekstrichting en de lettergrootte (~ de hoogte van het woordvak)
 */
export function ocrWoordPlaatsing(word, { rotation = 0, cropBox }) {
  const hoek = normaalHoek(rotation);
  const naarOngedraaid = _rotVisualMapper(hoek, cropBox.width, cropBox.height);
  const p = naarOngedraaid(word.left, word.top + word.height);
  const rad = (hoek * Math.PI) / 180;
  return {
    x: cropBox.x + p.x,
    y: cropBox.y + cropBox.height - p.y,
    cos: Math.round(Math.cos(rad)),
    sin: Math.round(Math.sin(rad)),
    grootte: Math.max(1, word.height),
  };
}

/**
 * Een korte vingerafdruk van OCR-uitkomsten: gelijke vingerafdrukken
 * betekenen dat de saver dezelfde OCR-lagen en nakijkgegevens schrijft.
 */
export function ocrSignature(results) {
  const text = JSON.stringify(results || {});
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

/**
 * De handtekening per pagina van de woorden die in het bestand staan.
 * @param {Record<number, object[]>} results  doc.ocrResults
 * @param {number[]|null} [paginas]  alleen deze pagina's (de pagina's met een
 *   eigen laag); zonder: elke pagina met woorden
 * @returns {Record<number, string>}
 */
export function ocrPaginaSignaturen(results, paginas = null) {
  const uit = {};
  const toegestaan = Array.isArray(paginas) ? new Set(paginas.map(Number)) : null;
  for (const [sleutel, woorden] of Object.entries(results || {})) {
    const pagina = Number(sleutel);
    if (!Array.isArray(woorden) || !woorden.length) continue;
    if (toegestaan && !toegestaan.has(pagina)) continue;
    uit[pagina] = ocrSignature(woorden);
  }
  return uit;
}

/**
 * De herkende woorden van een pagina die nog niet in het geladen document
 * staan (nog niet opgeslagen, of na het opslaan opnieuw herkend). Leeg als er
 * niets herkend is of als precies deze woorden al in het bestand staan.
 */
export function ongeschrevenOcrWoorden(doc, pageNum) {
  const woorden = doc?.ocrResults?.[pageNum];
  if (!Array.isArray(woorden) || !woorden.length) return [];
  if (doc.ocrLaagInBestand?.[pageNum] === ocrSignature(woorden)) return [];
  return woorden.filter((w) => w && typeof w.text === 'string' && w.text.trim()
    && [w.left, w.top, w.width, w.height].every(Number.isFinite));
}

/** Heeft het document herkende woorden die nog niet in het geladen document staan? */
export function heeftOngeschrevenOcr(doc) {
  return Object.keys(doc?.ocrResults || {}).some((p) => ongeschrevenOcrWoorden(doc, Number(p)).length > 0);
}

/**
 * Zoektekst van een pagina aangevuld met haar nog niet opgeslagen OCR-woorden
 * (de opbouw van find-controller.js extractPageText). Geeft een nieuw object;
 * het origineel (uit de tekstcache) blijft zoals het was. De items krijgen een
 * pdf.js-achtige transform in PDF-ruimte, zodat de zoekmarkering op het woord
 * valt.
 * @param {{ pageNum:number, text:string, items:object[], view?:number[], rotation?:number }} pageData
 */
export function metOcrWoorden(pageData, doc) {
  if (!pageData) return pageData;
  const woorden = ongeschrevenOcrWoorden(doc, pageData.pageNum);
  if (!woorden.length) return pageData;
  const view = Array.isArray(pageData.view) ? pageData.view : null;
  const cropBox = view
    ? { x: view[0], y: view[1], width: view[2] - view[0], height: view[3] - view[1] }
    : null;
  let text = pageData.text || '';
  const items = [...(pageData.items || [])];
  for (const w of woorden) {
    const str = w.text.trim();
    if (text.length && !/\s$/.test(text)) text += ' ';
    let transform = null;
    if (cropBox) {
      const p = ocrWoordPlaatsing(w, { rotation: pageData.rotation || 0, cropBox });
      transform = [p.grootte * p.cos, p.grootte * p.sin, -p.grootte * p.sin, p.grootte * p.cos, p.x, p.y];
    }
    items.push({
      str,
      startPos: text.length,
      endPos: text.length + str.length,
      transform,
      width: w.width,
      height: Math.max(1, w.height),
      fontName: '',
      fontFamily: '',
      itemIndex: -1, // geen span in de tekstlaag
      ocr: true,
    });
    text += str;
  }
  return { ...pageData, text, items };
}

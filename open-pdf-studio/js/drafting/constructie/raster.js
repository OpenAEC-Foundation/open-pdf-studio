// Constructieraster — PURE rekenmodule (geen UI-, DOM- of app-state-imports;
// los testbaar onder node --test).
//
// Een constructietekening begint bij het stramien: twee reeksen rasterlijnen
// met daartussen de velden. Alles wat daarna volgt (kolommen op de knopen,
// balken op de lijnen, vloervelden in de vakken) hangt aan dezelfde
// rekenslag. Die slag staat hier, één keer, zodat de assistent hem nooit zelf
// hoeft te doen.
//
// EENHEDEN
//   - Invoer: WERKELIJKE millimeters (veldmaten, uitloop).
//   - Uitvoer: PAGINAPUNTEN in app-annotatieruimte (linksboven = oorsprong,
//     y naar beneden, schaal 1 — precies wat app_create_annotation verwacht).
//   - De brug tussen beide is de TEKENINGSCHAAL: 1 werkelijke mm is 1/N
//     papier-mm, en 1 papier-mm is MM_TO_PX punten. De pagina ís het papier.

import { MM_TO_PX } from '../tekeningtype.js';

export { MM_TO_PX };

/** Uitloop van een rasterlijn voorbij het buitenste veld (werkelijke mm). */
export const STANDAARD_UITLOOP_MM = 1500;

/** Kleinste veldmaat die als millimeters wordt geaccepteerd. Kleiner betekent
 *  vrijwel zeker dat iemand meters bedoelde (5,4 in plaats van 5400). */
export const MIN_VELD_MM = 50;

/** Grootste aantal velden per richting in één keer. */
export const MAX_VELDEN = 60;

/** Fout met een machine-leesbare code, zodat de aanroeper hem kan doorgeven. */
export class RasterFout extends Error {
  constructor(code, boodschap) {
    super(boodschap);
    this.name = 'RasterFout';
    this.code = code;
  }
}

/**
 * Noemer N uit een schaalaanduiding: "1:100" → 100. Een kaal getal telt als
 * de noemer zelf (100 → 1:100). "1/50" mag ook.
 * @param {string|number} schaal
 * @returns {number} N > 0
 */
export function schaalNoemer(schaal) {
  if (typeof schaal === 'number') {
    if (Number.isFinite(schaal) && schaal > 0) return schaal;
    throw new RasterFout('schaal', `ongeldige schaal: ${schaal}`);
  }
  const tekst = String(schaal ?? '').trim();
  const verhouding = tekst.match(/^(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)$/);
  if (verhouding) {
    const teller = parseFloat(verhouding[1].replace(',', '.'));
    const noemer = parseFloat(verhouding[2].replace(',', '.'));
    if (teller > 0 && noemer > 0) return noemer / teller;
    throw new RasterFout('schaal', `ongeldige schaal: ${tekst}`);
  }
  const kaal = parseFloat(tekst.replace(',', '.'));
  if (Number.isFinite(kaal) && kaal > 0) return kaal;
  throw new RasterFout('schaal', `ongeldige schaal: ${tekst} (verwacht bijvoorbeeld "1:100")`);
}

/** Paginapunten per werkelijke millimeter op deze tekeningschaal. */
export function pxPerMmOpSchaal(schaal) {
  return MM_TO_PX / schaalNoemer(schaal);
}

/** Werkelijke millimeters → paginapunten op deze tekeningschaal. */
export function mmNaarPunten(mm, schaal) {
  return Number(mm) * pxPerMmOpSchaal(schaal);
}

/** Paginapunten → werkelijke millimeters op deze tekeningschaal. */
export function puntenNaarMm(px, schaal) {
  return Number(px) / pxPerMmOpSchaal(schaal);
}

/**
 * Meetschaal-ijking voor app_set_measure_scale: hoeveel paginapunten één
 * millimeter werkelijkheid is. Zo meet de app in dezelfde werkelijkheid als
 * waarin het raster is uitgezet.
 */
export function meetschaalVoor(schaal) {
  return { pixelsPerUnit: pxPerMmOpSchaal(schaal), unit: 'mm' };
}

function leesMaat(tekst) {
  const n = parseFloat(String(tekst).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Veldmaten uit een compacte opgave.
 *
 * Toegestaan:
 *   [5400, 5400, 6000]          — kant en klaar
 *   "5400 5400 6000"            — gescheiden door spatie, komma, puntkomma of +
 *   "3x5400, 6000"              — aantal × maat
 *   "5400x3"                    — maat × aantal (wordt herkend aan de groottes)
 *
 * @param {number[]|string|number} spec
 * @returns {number[]} veldmaten in werkelijke millimeters
 */
export function parseVelden(spec) {
  const uit = [];
  const voegToe = (mm, aantal = 1) => {
    if (!Number.isFinite(mm) || mm < MIN_VELD_MM) {
      throw new RasterFout('veldmaat', `veldmaat ${mm} is geen bruikbare maat in millimeters (minimaal ${MIN_VELD_MM})`);
    }
    if (!Number.isInteger(aantal) || aantal < 1) {
      throw new RasterFout('veldaantal', `ongeldig aantal velden: ${aantal}`);
    }
    for (let i = 0; i < aantal; i++) uit.push(mm);
  };

  if (typeof spec === 'number') voegToe(spec);
  else if (Array.isArray(spec)) {
    for (const item of spec) {
      if (typeof item === 'string') { for (const mm of parseVelden(item)) uit.push(mm); continue; }
      voegToe(leesMaat(item));
    }
  } else if (typeof spec === 'string') {
    const stukken = spec.split(/[,;+]|\s+/).map(s => s.trim()).filter(Boolean);
    if (!stukken.length) throw new RasterFout('velden', 'geen veldmaten opgegeven');
    for (const stuk of stukken) {
      const paar = stuk.match(/^(\d+(?:[.,]\d+)?)\s*[x×*@]\s*(\d+(?:[.,]\d+)?)$/i);
      if (paar) {
        const a = leesMaat(paar[1]);
        const b = leesMaat(paar[2]);
        // "3x5400" (aantal eerst) en "5400x3" (maat eerst) zijn allebei
        // gangbaar; de groottes wijzen uit wat bedoeld is.
        if (Number.isInteger(a) && a <= MAX_VELDEN && b >= MIN_VELD_MM) voegToe(b, a);
        else if (Number.isInteger(b) && b <= MAX_VELDEN && a >= MIN_VELD_MM) voegToe(a, b);
        else throw new RasterFout('velden', `onbegrepen veldopgave: ${stuk}`);
        continue;
      }
      voegToe(leesMaat(stuk));
    }
  } else {
    throw new RasterFout('velden', 'veldmaten ontbreken');
  }

  if (!uit.length) throw new RasterFout('velden', 'geen veldmaten opgegeven');
  if (uit.length > MAX_VELDEN) {
    throw new RasterFout('veldaantal', `te veel velden in één richting: ${uit.length} (maximaal ${MAX_VELDEN})`);
  }
  return uit;
}

/**
 * Rasterlabels voor n lijnen.
 *   'letters' → A, B, … Z, AA, AB (spreadsheet-telling)
 *   'cijfers' → 1, 2, 3, …
 * @param {number} n
 * @param {'letters'|'cijfers'} stijl
 * @returns {string[]}
 */
export function rasterLabels(n, stijl = 'letters') {
  const uit = [];
  for (let i = 0; i < n; i++) {
    uit.push(stijl === 'cijfers' ? String(i + 1) : letterLabel(i));
  }
  return uit;
}

function letterLabel(index) {
  let i = index;
  let uit = '';
  do {
    uit = String.fromCharCode(65 + (i % 26)) + uit;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return uit;
}

/** Cumulatieve posities (mm) van n+1 lijnen bij n velden. */
function lijnPosities(velden) {
  const uit = [0];
  let som = 0;
  for (const v of velden) { som += v; uit.push(som); }
  return uit;
}

/**
 * Zet een constructieraster uit.
 *
 * @param {object} spec
 * @param {{x:number,y:number}} spec.oorsprong  Snijpunt van de EERSTE lijn in
 *        beide richtingen, in paginapunten (linksboven van het raster).
 * @param {number[]|string} spec.veldenX  Veldmaten links→rechts (mm).
 * @param {number[]|string} spec.veldenY  Veldmaten boven→onder (mm).
 * @param {string|number} [spec.schaal='1:100']
 * @param {'letters'|'cijfers'} [spec.labelStijlX='letters']
 * @param {'letters'|'cijfers'} [spec.labelStijlY='cijfers']
 * @param {boolean} [spec.labelsYVanOnder=true]  Tekenkamer-gewoonte: de
 *        ONDERSTE horizontale lijn is nummer 1.
 * @param {number} [spec.uitloopMm=1500]
 */
export function maakRaster(spec = {}) {
  const noemer = schaalNoemer(spec.schaal ?? '1:100');
  const pxPerMm = MM_TO_PX / noemer;
  const mm = (v) => v * pxPerMm;

  const oorsprong = spec.oorsprong || {};
  const x0 = Number(oorsprong.x);
  const y0 = Number(oorsprong.y);
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) {
    throw new RasterFout('oorsprong', 'oorsprong.x en oorsprong.y zijn verplicht (paginapunten)');
  }

  const veldenX = parseVelden(spec.veldenX);
  const veldenY = parseVelden(spec.veldenY);
  const uitloopMm = Number.isFinite(Number(spec.uitloopMm)) && Number(spec.uitloopMm) >= 0
    ? Number(spec.uitloopMm) : STANDAARD_UITLOOP_MM;
  const uitloop = mm(uitloopMm);

  const posX = lijnPosities(veldenX);
  const posY = lijnPosities(veldenY);
  const breedteMm = posX[posX.length - 1];
  const hoogteMm = posY[posY.length - 1];

  const labelsX = rasterLabels(posX.length, spec.labelStijlX || 'letters');
  const labelsYRuw = rasterLabels(posY.length, spec.labelStijlY || 'cijfers');
  // De tekenkamer nummert van onder naar boven; de pagina loopt van boven naar
  // beneden. Draaien we de labelreeks om, dan klopt beide tegelijk.
  const vanOnder = spec.labelsYVanOnder !== false;
  const labelsY = vanOnder ? [...labelsYRuw].reverse() : labelsYRuw;

  const yBoven = y0 - uitloop;
  const yOnder = y0 + mm(hoogteMm) + uitloop;
  const xLinks = x0 - uitloop;
  const xRechts = x0 + mm(breedteMm) + uitloop;

  const lijnenX = posX.map((p, i) => ({
    index: i, label: labelsX[i], richting: 'x',
    afstandMm: p, x: x0 + mm(p), yBoven, yOnder,
  }));
  const lijnenY = posY.map((p, i) => ({
    index: i, label: labelsY[i], richting: 'y',
    afstandMm: p, y: y0 + mm(p), xLinks, xRechts,
  }));

  const knopen = [];
  for (const ly of lijnenY) {
    for (const lx of lijnenX) {
      knopen.push({
        ix: lx.index, iy: ly.index,
        label: `${lx.label}-${ly.label}`,
        x: lx.x, y: ly.y,
      });
    }
  }

  const velden = [];
  for (let iy = 0; iy < veldenY.length; iy++) {
    for (let ix = 0; ix < veldenX.length; ix++) {
      const links = lijnenX[ix], rechts = lijnenX[ix + 1];
      const boven = lijnenY[iy], onder = lijnenY[iy + 1];
      // Veldlabel volgt de tekenkamer: de lijn LINKS en de lijn ONDER.
      const label = `${links.label}${vanOnder ? onder.label : boven.label}`;
      velden.push({
        ix, iy, label,
        x: links.x, y: boven.y,
        breedte: rechts.x - links.x, hoogte: onder.y - boven.y,
        breedteMm: veldenX[ix], hoogteMm: veldenY[iy],
        midden: { x: (links.x + rechts.x) / 2, y: (boven.y + onder.y) / 2 },
        hoeken: {
          linksboven: `${links.label}-${boven.label}`,
          rechtsonder: `${rechts.label}-${onder.label}`,
        },
      });
    }
  }

  return {
    schaal: { tekst: `1:${noemer}`, noemer, pxPerMm },
    oorsprong: { x: x0, y: y0 },
    uitloopMm, uitloop,
    veldenX, veldenY,
    lijnenX, lijnenY, knopen, velden,
    maat: {
      breedteMm, hoogteMm,
      breedte: mm(breedteMm), hoogte: mm(hoogteMm),
      x0, y0, x1: x0 + mm(breedteMm), y1: y0 + mm(hoogteMm),
      buiten: { x: xLinks, y: yBoven, breedte: xRechts - xLinks, hoogte: yOnder - yBoven },
    },
  };
}

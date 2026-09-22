// Rekenregels van de voorbeeldweergave van het importvenster (#400).
//
// Geen imports uit de app: de unit-tests draaien hier onder node op.

/** Wachttijd na de laatste wijziging voordat het voorbeeld opnieuw loopt. */
export const VOORBEELD_VERTRAGING_MS = 300;

/** Grootste zijde van het voorbeeld in beeldpunten. */
export const VOORBEELD_MAX_PIXELS = 1400;

/** Kleinste sleep die als venster telt (beeldpunten). */
export const VOORBEELD_MIN_SLEEP = 6;

/**
 * Voert alleen het laatste plan uit, `ms` nadat het binnenkwam.
 * @returns {{plan: (fn: Function) => void, stop: () => void}}
 */
export function maakVertrager(ms = VOORBEELD_VERTRAGING_MS) {
  let teller = null;
  return {
    plan(fn) {
      if (teller) clearTimeout(teller);
      teller = setTimeout(() => {
        teller = null;
        fn();
      }, ms);
    },
    stop() {
      if (teller) clearTimeout(teller);
      teller = null;
    },
  };
}

/**
 * Maat van het voorbeeld: de pagina passend in het paneel, met een bovengrens
 * aan het aantal beeldpunten.
 * @param {{breedte:number, hoogte:number}|null} paginaMm
 * @param {{breedte:number, hoogte:number}} vakPx
 * @returns {{breedte:number, hoogte:number, pixelsPerMm:number}|null}
 */
export function voorbeeldMaat(paginaMm, vakPx, maxPx = VOORBEELD_MAX_PIXELS) {
  const pb = Number(paginaMm?.breedte);
  const ph = Number(paginaMm?.hoogte);
  if (!(pb > 0) || !(ph > 0)) return null;
  const vb = Math.max(1, Number(vakPx?.breedte) || 1);
  const vh = Math.max(1, Number(vakPx?.hoogte) || 1);
  let pixelsPerMm = Math.min(vb / pb, vh / ph);
  pixelsPerMm = Math.min(pixelsPerMm, maxPx / Math.max(pb, ph));
  if (!(pixelsPerMm > 0) || !Number.isFinite(pixelsPerMm)) return null;
  return {
    breedte: Math.max(1, Math.floor(pb * pixelsPerMm)),
    hoogte: Math.max(1, Math.floor(ph * pixelsPerMm)),
    pixelsPerMm,
  };
}

/**
 * Een gesleept vak in het voorbeeld naar een venster in tekeningeenheden.
 *
 * Het voorbeeld toont de pagina van linksboven naar rechtsonder; de tekening
 * heeft y omhoog. `pagina` is het verslag van de omzetting voor deze pagina
 * (`heightMm`, `scale`, `offset`): `offset` is het punt van de tekening dat op
 * de oorsprong van de pagina (linksonder) ligt. Is de tekening gedraaid op het
 * papier gezet (`draaiing`, graden tegen de klok in, zoals de omzetter), dan
 * is het venster de omhullende van het teruggedraaide vak.
 * @returns {{x0:number,y0:number,x1:number,y1:number}|null}
 */
export function vensterUitVoorbeeld(rect, pagina, mmPerEenheid, pixelsPerMm, draaiing = 0) {
  const schaal = Number(pagina?.scale);
  const hoogteMm = Number(pagina?.heightMm);
  const offset = pagina?.offset;
  const k = Number(mmPerEenheid) > 0 ? Number(mmPerEenheid) : 1;
  if (!(schaal > 0) || !(hoogteMm > 0) || !Array.isArray(offset) || !(pixelsPerMm > 0)) return null;
  if (!(rect?.breedte > 2) || !(rect?.hoogte > 2)) return null;
  // Beeldpunt → papier-mm (y omhoog) → tekeningeenheden, teruggedraaid.
  const perMm = schaal / k;
  const hoek = ((Number(draaiing) || 0) * Math.PI) / 180;
  const c = Math.cos(hoek);
  const s = Math.sin(hoek);
  const punt = (px, py) => {
    const mx = (px / pixelsPerMm) * perMm;
    const my = (hoogteMm - py / pixelsPerMm) * perMm;
    return [offset[0] + c * mx + s * my, offset[1] - s * mx + c * my];
  };
  const hoeken = [
    punt(rect.x, rect.y),
    punt(rect.x + rect.breedte, rect.y),
    punt(rect.x + rect.breedte, rect.y + rect.hoogte),
    punt(rect.x, rect.y + rect.hoogte),
  ];
  const xs = hoeken.map((p) => p[0]);
  const ys = hoeken.map((p) => p[1]);
  const uit = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (!uit.every((v) => Number.isFinite(v))) return null;
  const rond = (v) => Math.round(v * 1000) / 1000;
  return { x0: rond(uit[0]), y0: rond(uit[1]), x1: rond(uit[2]), y1: rond(uit[3]) };
}

/** Alles wat het beeld bepaalt; het doelbestand telt niet mee. */
export function voorbeeldSleutel(args) {
  if (!args) return '';
  const { outputPath, ...rest } = args;
  void outputPath;
  return JSON.stringify(rest);
}

/**
 * Bewaakt het beeld van het voorbeeld: in welke volgorde een nieuw beeld het
 * oude aflost, en welk beeld nog getekend mag worden.
 *
 * Een gesloten ImageBitmap tekenen gooit ("the image source is detached"). En
 * de maat of het beeld zetten laat het venster meteen opnieuw tekenen. Het
 * oude beeld mag dus pas dicht als het nieuwe al staat — anders tekent het
 * venster een gesloten beeld, valt het voorbeeld uit en blijft dat zo.
 * @returns {{wissel: Function, sluit: Function, tekenbaar: Function}}
 */
export function maakBeeldwissel() {
  const dicht = new WeakSet();
  const sluit = (beeld) => {
    if (!beeld || typeof beeld !== 'object' || dicht.has(beeld)) return;
    dicht.add(beeld);
    try { beeld.close?.(); } catch { /* al weg */ }
  };
  return {
    /**
     * Zet `nieuw` met `zet` (die maat en beeld in één keer hoort te zetten) en
     * sluit daarna pas `oud`.
     */
    wissel(oud, nieuw, zet) {
      zet(nieuw);
      if (oud !== nieuw) sluit(oud);
    },
    sluit,
    /** Alleen een open beeld met een maat is te tekenen. */
    tekenbaar(beeld) {
      return !!beeld && !dicht.has(beeld) && beeld.width !== 0 && beeld.height !== 0;
    },
  };
}

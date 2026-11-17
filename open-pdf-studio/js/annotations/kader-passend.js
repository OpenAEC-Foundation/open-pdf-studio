// Kader passend maken (#1144): het vak van een tekstvak of aanhaalvak
// (callout) krijgt de maat van zijn tekst.
//
// De regel:
//  - Breekt de tekst in het huidige vak af (een alinea loopt over meer dan
//    een regel), dan blijft de BREEDTE staan en past alleen de hoogte zich aan.
//  - Breekt er niets af, dan krijgt het vak ook de breedte van de langste
//    regel. Een typemachine-tekst (noWrap) breekt nooit af en volgt dus altijd
//    zijn langste regel.
//  - Een leeg vak krijgt de kleinste maat van een tekstvak (een teken op een
//    regel, zie tekstvakMinimum).
//  - Tekst, lettertype en lettergrootte veranderen niet.
//
// Het anker: de tekst blijft staan waar hij staat. Links uitgelijnde tekst
// houdt de linkerrand van het vak vast, gecentreerde het midden, rechts
// uitgelijnde de rechterrand; verticaal net zo (boven, midden, onder). Een
// gedraaid of gespiegeld vak houdt hetzelfde punt op het scherm vast: het vak
// draait om zijn midden, dus het midden schuift mee met de nieuwe maat.
//
// Puur: het meten van tekst komt binnen als `measure(text, bold, italic)`,
// dezelfde functie waarmee het canvas en de opgeslagen appearance afbreken
// (layoutTextboxLines). Zo knipt het passende vak na opslaan geen tekst af.

import { layoutTextboxLines, textboxTekstInzet, STANDAARD_REGELAFSTAND } from './rendering/textbox-layout.js';
import { tekstvakMinimum } from './minimummaat.js';

/** De soorten met een tekstkader. */
export const KADER_SOORTEN = Object.freeze(['textbox', 'callout']);

// Speling op de breedte (paginapunten): het afbreken telt woordbreedtes op,
// de regelbreedte is in een keer gemeten; zonder speling kan een regel die
// precies past na afronding in het bestand toch afbreken.
export const BREEDTE_SPELING_PT = 0.5;

const omhoog = (n) => Math.ceil(n * 100 - 1e-6) / 100;

/** Heeft deze annotatie een tekstkader dat passend gemaakt kan worden? */
export function heeftTekstkader(ann) {
  return !!ann && KADER_SOORTEN.includes(ann.type);
}

function regelsBij(ann, breedte, hoogte, measure) {
  const kandidaat = { ...ann, width: breedte, height: hoogte };
  const inzet = textboxTekstInzet(kandidaat);
  const regels = layoutTextboxLines(kandidaat, Math.max(1, breedte - 2 * inzet), measure);
  return { inzet, regels };
}

/**
 * De passende maat van het vak, zonder positie.
 * @param {object} ann tekstvak of aanhaalvak
 * @param {(text: string, bold: boolean, italic: boolean) => number} measure
 * @returns {{ width: number, height: number, afgebroken: boolean, leeg: boolean }}
 */
export function passendeMaat(ann, measure) {
  const breedte0 = ann.width || 150;
  const hoogte0 = ann.height || 50;
  const fontSize = ann.fontSize || 14;
  const regelHoogte = fontSize * (ann.lineSpacing || STANDAARD_REGELAFSTAND);
  const { minBreedte, minHoogte } = tekstvakMinimum(ann);

  const nu = regelsBij(ann, breedte0, hoogte0, measure);
  if (!nu.regels.some(r => r.chunks.length)) {
    return { width: minBreedte, height: minHoogte, afgebroken: false, leeg: true };
  }

  // Zonder afbreken: een regel per alinea, in zijn volle breedte.
  const vrij = layoutTextboxLines({ ...ann, noWrap: true }, Infinity, measure);
  const langste = vrij.reduce((m, r) => Math.max(m, r.width), 0);
  const afgebroken = !ann.noWrap && nu.regels.length > vrij.length;

  let breedte = breedte0;
  let hoogte = hoogte0;
  // De inzet van een afgerond of ovaal vak hangt van de maat af: herhalen tot
  // de maat stilstaat (een rechthoek is na een ronde klaar).
  for (let i = 0; i < 12; i++) {
    const { inzet, regels } = regelsBij(ann, breedte, hoogte, measure);
    let nieuweBreedte;
    let aantal = regels.length;
    if (afgebroken) {
      // Breedte blijft; alleen een woord dat breder is dan het vak rekt hem op.
      const breedsteRegel = regels.reduce((m, r) => Math.max(m, r.width), 0);
      nieuweBreedte = Math.max(breedte0, omhoog(breedsteRegel + 2 * inzet + BREEDTE_SPELING_PT));
    } else {
      nieuweBreedte = omhoog(langste + 2 * inzet + BREEDTE_SPELING_PT);
      aantal = vrij.length;
    }
    nieuweBreedte = Math.max(nieuweBreedte, minBreedte);
    const nieuweHoogte = Math.max(omhoog(2 * inzet + aantal * regelHoogte), minHoogte);
    const klaar = Math.abs(nieuweBreedte - breedte) < 0.005 && Math.abs(nieuweHoogte - hoogte) < 0.005;
    // Bij een afgebroken tekst nooit krimpen binnen de herhaling: een hogere
    // inzet geeft meer regels, en die mogen niet weer wegvallen.
    breedte = nieuweBreedte;
    hoogte = afgebroken && i > 0 ? Math.max(hoogte, nieuweHoogte) : nieuweHoogte;
    if (klaar) break;
  }

  if (!afgebroken) {
    // Controle met de echte afbreekregel: past elke alinea nu op een regel?
    for (let i = 0; i < 8; i++) {
      const { inzet, regels } = regelsBij(ann, breedte, hoogte, measure);
      if (regels.length <= vrij.length) break;
      breedte = omhoog(breedte + 1);
      hoogte = Math.max(hoogte, omhoog(2 * inzet + vrij.length * regelHoogte));
    }
  }
  return { width: breedte, height: hoogte, afgebroken, leeg: false };
}

/**
 * Welk punt van het vak blijft staan, als fractie van breedte en hoogte
 * (0 = links/boven, 0.5 = midden, 1 = rechts/onder). `rtl`: de tekst loopt
 * van rechts naar links en heeft geen eigen uitlijning (dan staat hij rechts).
 */
export function ankerVan(ann, { rtl = false, pastInHoogte = true } = {}) {
  const h = ann.textAlign || (rtl ? 'right' : 'left');
  const fx = h === 'center' ? 0.5 : h === 'right' ? 1 : 0;
  // Tekst die niet in het vak past begint bovenaan (verticaleVerschuiving).
  const v = pastInHoogte ? ann.textVAlign : 'top';
  const fy = v === 'middle' ? 0.5 : v === 'bottom' ? 1 : 0;
  return { fx, fy };
}

/**
 * Het passende kader met positie: { x, y, width, height }.
 * @param {object} ann
 * @param {Function} measure zie passendeMaat
 * @param {{ rtl?: boolean }} [opties]
 */
export function passendKader(ann, measure, opties = {}) {
  if (!heeftTekstkader(ann) || typeof measure !== 'function') return null;
  const b0 = ann.width || 150;
  const h0 = ann.height || 50;
  const maat = passendeMaat(ann, measure);

  const fontSize = ann.fontSize || 14;
  const regelHoogte = fontSize * (ann.lineSpacing || STANDAARD_REGELAFSTAND);
  const nu = regelsBij(ann, b0, h0, measure);
  const pastInHoogte = nu.regels.length * regelHoogte <= h0 - 2 * nu.inzet + 1e-6;
  const { fx, fy } = ankerVan(ann, { rtl: !!opties.rtl, pastInHoogte });

  // Het ankerpunt ten opzichte van het midden, voor en na, in de eigen
  // (ongedraaide) ruimte van het vak; daarna gespiegeld en gedraaid.
  const hoek = ((Number(ann.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(hoek);
  const sin = Math.sin(hoek);
  const sx = ann.flipX ? -1 : 1;
  const sy = ann.flipY ? -1 : 1;
  const naarBlad = (px, py) => ({ x: px * sx * cos - py * sy * sin, y: px * sx * sin + py * sy * cos });
  const voor = naarBlad((fx - 0.5) * b0, (fy - 0.5) * h0);
  const na = naarBlad((fx - 0.5) * maat.width, (fy - 0.5) * maat.height);
  const cx = (ann.x || 0) + b0 / 2 + voor.x - na.x;
  const cy = (ann.y || 0) + h0 / 2 + voor.y - na.y;
  const rond = (n) => Math.round(n * 1000) / 1000;
  return {
    x: rond(cx - maat.width / 2),
    y: rond(cy - maat.height / 2),
    width: maat.width,
    height: maat.height,
  };
}

/**
 * Maakt het kader van een annotatie passend. De aanhaallijn van een
 * aanhaalvak volgt via `herberekenAanhaallijn` (dezelfde regel als bij een
 * maatgreep: de punt blijft staan, aanzet en knie volgen de vakrand).
 * @returns {boolean} true als de annotatie veranderde
 */
export function maakKaderPassend(ann, measure, opties = {}) {
  const kader = passendKader(ann, measure, opties);
  if (!kader) return false;
  const gelijk = (a, b) => Math.abs((a || 0) - b) < 0.005;
  if (gelijk(ann.x, kader.x) && gelijk(ann.y, kader.y)
    && gelijk(ann.width || 150, kader.width) && gelijk(ann.height || 50, kader.height)) return false;
  ann.x = kader.x;
  ann.y = kader.y;
  ann.width = kader.width;
  ann.height = kader.height;
  if (ann.type === 'callout' && typeof opties.herberekenAanhaallijn === 'function') {
    opties.herberekenAanhaallijn(ann);
  }
  return true;
}

/**
 * Het hele commando op een selectie: alleen tekstvakken en aanhaalvakken die
 * bewerkt mogen worden (`magBewerken`), de rest blijft staan.
 * @returns {object[]} de veranderde annotaties
 */
export function maakKadersPassend(annotaties, { measureVoor, magBewerken = () => true, rtlVoor = () => false, herberekenAanhaallijn } = {}) {
  const gewijzigd = [];
  for (const ann of annotaties || []) {
    if (!heeftTekstkader(ann) || !magBewerken(ann)) continue;
    const measure = measureVoor(ann);
    if (maakKaderPassend(ann, measure, { rtl: rtlVoor(ann), herberekenAanhaallijn })) gewijzigd.push(ann);
  }
  return gewijzigd;
}

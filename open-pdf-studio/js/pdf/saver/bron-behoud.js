// Een annotatie die de gebruiker niet veranderde, wordt bij opslaan niet
// opnieuw uit het model opgebouwd (#629, #619, #621).
//
// De lader zet elke annotatie om naar het model, en de saver schreef uit dat
// model bij elke save een nieuw woordenboek. Wat het model niet precies kent
// — een tweede inktstreek, de streeplengte van een rand, een /DA van een
// ander programma, de volgorde van hoekpunten, een statusgeschiedenis — ging
// zo verloren of veranderde, ook als niemand de annotatie aanraakte.
//
// Daarom legt de lader per annotatie vast waar ze vandaan komt (`pdfBron` op
// het model, gewone JSON: het model wordt gekloond bij ongedaan maken):
//   ref    het object in het bestand (pdf.js-id, bijv. '16R')
//   id     het model-id; een kopie (ander id) is een nieuwe annotatie
//   dfp    vingerafdruk van het woordenboek zoals het in het bestand staat
//   velden vingerafdruk per modelveld zoals de lader het model opleverde
//   anker  het eerste punt van de vorm, om een verplaatsing te herkennen
//   mee    de annotaties die bij deze horen en die de lader in het model
//          opnam: statusantwoorden, eigen antwoorden, aanhaallijnen
//
// Bij opslaan (planBron) per annotatie:
//   'gelijk'  niets veranderd: het oorspronkelijke object blijft staan, met
//             alles wat erbij hoort;
//   'deels'   alleen de vorm en/of iets wat niet tekent (auteur, opmerking,
//             naam, vlaggen, laag, status) veranderd: het oorspronkelijke
//             woordenboek met alleen die sleutels nieuw, plus /M, en bij een
//             andere vorm /AP (samenvoegen). Een zuivere verplaatsing schuift
//             de bestaande getallen op en houdt de appearance (die volgt
//             /Rect);
//   'anders'  iets anders veranderd: opnieuw uit het model, maar op hetzelfde
//             objectnummer, zodat antwoorden, popups en groepen die ernaar
//             wijzen blijven kloppen; de soort, de bedoeling (/IT), de
//             aanmaakdatum en de vlaggen die de app niet kent, blijven
//             (houdSoort, bewaarBronSleutels).
// Een woordenboek dat niet meer is wat de lader las (dfp), krijgt geen van
// drie: dan is het model de waarheid, zoals voorheen.
//
// Na een geslaagde save beschrijft `pdfBron` het nieuwe bestand
// (bronNaOpslaan), zodat ook de volgende save niets herbouwt wat niet
// veranderde.
//
// Alleen pdf-lib: ook in node te testen.

import { PDFName, PDFRef, PDFDict, PDFArray, PDFNumber, PDFString, PDFHexString } from 'pdf-lib';
import { applyMoveGeneric } from '../../annotations/transforms.js';
import {
  dictVingerafdruk, veldVingerafdrukken, verschillendeVelden, VORM_VELDEN, STATUS_VELDEN, META_VELDEN, ANKER_PAREN,
} from './bron-vingerafdruk.js';
import { SOORTEN_MET_EIGEN_TEKST } from '../loader/annotatie-opmerking.js';
import { GEOMETRIE_SLEUTELS } from './ruwe-sleutels.js';

export { dictVingerafdruk, veldVingerafdrukken };

const N = (n) => PDFName.of(n);

function huidigAnker(ann, veld) {
  const paar = ANKER_PAREN.find(([kx]) => kx === veld);
  if (paar) {
    const [kx, ky] = paar;
    return typeof ann[kx] === 'number' && typeof ann[ky] === 'number' ? { x: ann[kx], y: ann[ky] } : null;
  }
  const p = Array.isArray(ann[veld]) ? ann[veld][0] : null;
  return p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null;
}

// ── bij het opslaan ─────────────────────────────────────────────────────────

/** pdf.js-id ('16R', '16R2') of 'n g R' -> PDFRef. */
export function refUitId(id) {
  const m = /^(\d+)R(\d*)$/.exec(String(id || '')) || /^(\d+) (\d+) R$/.exec(String(id || ''));
  return m ? PDFRef.of(Number(m[1]), Number(m[2] || 0)) : null;
}
const pdfjsId = (ref) => (ref.generationNumber ? `${ref.objectNumber}R${ref.generationNumber}` : `${ref.objectNumber}R`);

/**
 * Wat de saver met elke annotatie van een pagina doet die uit het bestand
 * komt. Alleen annotaties die de saver anders zou weghalen en herschrijven
 * (`teVervangen`, op ref.tag) doen mee.
 * @param {import('pdf-lib').PDFContext} context
 * @param {object[]} annotaties  de modellen van de pagina
 * @param {Set<string>} teVervangen  ref.tag van de woordenboeken die de saver vervangt
 * @param {(ann: object) => PDFRef|null} [verwachteLaag]  de OCG die de saver zou schrijven
 * @param {PDFRef|null} [standaardLaag]  de OCG van de standaardlaag
 * @returns {Map<string, object>} model-id -> plan
 */
export function planBronnen(context, annotaties, teVervangen, { verwachteLaag = () => null, standaardLaag = null } = {}) {
  const plannen = new Map();
  const geclaimd = new Set();
  for (const ann of annotaties || []) {
    const b = ann?.pdfBron;
    if (!b || typeof b !== 'object' || b.id !== ann.id || plannen.has(ann.id)) continue;
    const ref = refUitId(b.ref);
    if (!ref || !teVervangen.has(ref.tag) || geclaimd.has(ref.tag)) continue;
    const dict = context.lookup(ref);
    if (!(dict instanceof PDFDict) || dictVingerafdruk(dict) !== b.dfp) continue;
    geclaimd.add(ref.tag);

    const nu = veldVingerafdrukken(ann);
    const anders = verschillendeVelden(b.velden, nu);
    // Een opmerking is bij een soort met eigen tekst de tekst zelf: die tekent mee.
    const isMeta = (k) => META_VELDEN.has(k) && !(k === 'subject' && SOORTEN_MET_EIGEN_TEKST.has(ann.type));
    let staat = 'anders';
    if (anders.length === 0) staat = 'gelijk';
    else if (anders.every((k) => VORM_VELDEN.has(k) || isMeta(k))) staat = 'deels';
    // Zonder appearance in het bestand: die van de app erbij, verder niets.
    const apErbij = dict.get(N('AP')) === undefined;
    if (staat === 'gelijk' && apErbij) staat = 'deels';
    // De laag: zou de saver een andere /OC schrijven, dan is dat een wijziging.
    if (staat !== 'anders' && !anders.includes('layerId')) {
      const verwacht = verwachteLaag(ann);
      const oc = dict.get(N('OC'));
      const zelfde = !verwacht
        || (oc instanceof PDFRef && oc.tag === verwacht.tag)
        || (oc === undefined && standaardLaag && verwacht.tag === standaardLaag.tag);
      if (!zelfde) staat = 'anders';
    }
    const plan = {
      ref, dict, staat, velden: nu, houd: [], gewijzigd: anders, apErbij,
      vorm: anders.some((k) => VORM_VELDEN.has(k)),
      metaSleutels: [...new Set(anders.filter(isMeta).flatMap((k) => META_VELDEN.get(k)))],
    };
    // Wat erbij hoort, blijft als het deel van het model waar het uit komt
    // niet veranderde, en het nog precies is wat de lader las.
    const houdbaar = (soort, velden) => {
      const lijst = b.mee?.[soort];
      if (!lijst?.length) return null;
      if (velden && velden.some((k) => anders.includes(k))) return null;
      const refs = [];
      for (const m of lijst) {
        const r = refUitId(m.ref);
        if (!r || !teVervangen.has(r.tag) || geclaimd.has(r.tag)) return null;
        if (dictVingerafdruk(context.lookup(r)) !== m.dfp) return null;
        refs.push(r);
      }
      return refs;
    };
    plan.status = houdbaar('status', STATUS_VELDEN);
    plan.antwoorden = houdbaar('antwoorden', ['replies']);
    // Aanhaallijnen schrijft de saver bij elke andere staat opnieuw.
    plan.leiders = staat === 'gelijk' ? houdbaar('leiders', null) : null;
    for (const r of [...(plan.status || []), ...(plan.antwoorden || []), ...(plan.leiders || [])]) {
      geclaimd.add(r.tag);
      plan.houd.push(r);
    }
    plannen.set(ann.id, plan);
  }
  return plannen;
}

/**
 * Of een verplaatsing de enige wijziging is: het model, terug geschoven,
 * is weer het model van het laden. Geeft dan de verschuiving in de weergave.
 */
export function zuivereVerschuiving(ann) {
  const b = ann?.pdfBron;
  if (!b?.anker) return null;
  const nu = huidigAnker(ann, b.anker.veld);
  if (!nu) return null;
  const dx = nu.x - b.anker.x;
  const dy = nu.y - b.anker.y;
  let kopie;
  try { kopie = JSON.parse(JSON.stringify(ann)); } catch { return null; }
  applyMoveGeneric(kopie, -dx, -dy);
  return verschillendeVelden(b.velden, veldVingerafdrukken(kopie)).length === 0 ? { dx, dy } : null;
}

// Sleutels met coördinaten op de pagina: [x y x y …], of een array daarvan.
const PLAT = ['Rect', 'L', 'Vertices', 'QuadPoints', 'CL', 'Curves'];
const GENEST = ['InkList', 'Path', 'CLEx'];
// Wat een vormwijziging in het woordenboek mag veranderen.
export const VORM_SLEUTELS = new Set([...PLAT, ...GENEST, 'RD', 'M', 'AP']);

function schuifPlat(context, arr, pdx, pdy) {
  if (!(arr instanceof PDFArray)) return arr;
  const uit = context.obj([]);
  arr.asArray().forEach((v, i) => {
    const w = context.lookup(v);
    uit.push(w instanceof PDFNumber ? PDFNumber.of(rond(w.asNumber() + (i % 2 === 0 ? pdx : pdy))) : v);
  });
  return uit;
}
const rond = (v) => Math.round(v * 10000) / 10000;

// Bits van /F die de app beheert: Print, ReadOnly, Locked (computeAnnotFlags).
const EIGEN_VLAGGEN = 4 | 64 | 128;

/** /F van het bestand met alleen de bits die de app beheert uit het nieuwe woordenboek. */
function samengevoegdeVlaggen(context, origineel, nieuw) {
  const oud = context.lookup(origineel.get(N('F')));
  const nw = context.lookup(nieuw.get(N('F')));
  const o = oud instanceof PDFNumber ? oud.asNumber() : 0;
  const n = nw instanceof PDFNumber ? nw.asNumber() : 0;
  return PDFNumber.of((o & ~EIGEN_VLAGGEN) | (n & EIGEN_VLAGGEN));
}

/** Dezelfde tekst of waarde: dan blijft de schrijfwijze van het bestand. */
function zelfdeWaarde(a, b) {
  if (a === undefined || b === undefined) return a === b;
  const tekstVan = (v) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null);
  const ta = tekstVan(a);
  const tb = tekstVan(b);
  if (ta !== null && tb !== null) return ta === tb;
  return a.toString() === b.toString();
}

/**
 * Het oorspronkelijke woordenboek met alleen wat veranderde (staat 'deels').
 * - De vorm (`vorm`): bij een zuivere verschuiving (`verschuiving` in
 *   PDF-punten) schuiven de getallen van het bestand op en blijft de
 *   appearance; die volgt /Rect. Anders komen /Rect, de geometrie, /RD en /AP
 *   uit het opnieuw opgebouwde woordenboek; een sleutel die het bestand niet
 *   had, komt er niet bij. Een eigen sleutel (OPS_) die beide hebben, volgt
 *   het nieuwe.
 * - `metaSleutels` (auteur, opmerking, naam, vlaggen, laag …): zoals het
 *   nieuwe woordenboek ze heeft; dezelfde tekst houdt de schrijfwijze van het
 *   bestand, en van /F alleen de bits die de app beheert.
 * - `apErbij`: had het bestand geen appearance, dan die van de app.
 * /M wordt nu (alleen als het model veranderde, `gewijzigd`); al het andere
 * blijft zoals het bestand het had.
 * @returns {PDFDict}
 */
export function samenvoegen(context, origineel, nieuw, { vorm = false, verschuiving = null, metaSleutels = [], apErbij = false, gewijzigd = true } = {}) {
  const uit = context.obj({});
  for (const [k, v] of origineel.entries()) uit.set(k, v);
  if (vorm && verschuiving) {
    const { pdx, pdy } = verschuiving;
    for (const k of PLAT) {
      const v = context.lookup(uit.get(N(k)));
      if (v instanceof PDFArray) uit.set(N(k), schuifPlat(context, v, pdx, pdy));
    }
    for (const k of GENEST) {
      const v = context.lookup(uit.get(N(k)));
      if (!(v instanceof PDFArray)) continue;
      const lijst = context.obj([]);
      for (const deel of v.asArray()) lijst.push(schuifPlat(context, context.lookup(deel), pdx, pdy));
      uit.set(N(k), lijst);
    }
  } else if (vorm && nieuw instanceof PDFDict) {
    for (const k of VORM_SLEUTELS) {
      if (k === 'M') continue;
      const v = nieuw.get(N(k));
      if (v !== undefined && (origineel.get(N(k)) !== undefined || k === 'Rect' || k === 'AP')) uit.set(N(k), v);
    }
    // Vorm van een ander programma die bij de oude vorm hoort (een kromme,
    // een tweede arm …, #621): weg, tenzij de app hem zelf opnieuw schreef.
    for (const k of GEOMETRIE_SLEUTELS) {
      if (nieuw.get(N(k)) === undefined) uit.delete(N(k));
      else uit.set(N(k), nieuw.get(N(k)));
    }
  }
  // Een annotatie zonder appearance krijgt die van de app (andere lezers
  // tekenen haar anders niet, of anders dan de app).
  if (apErbij && nieuw instanceof PDFDict && uit.get(N('AP')) === undefined && nieuw.get(N('AP')) !== undefined) {
    uit.set(N('AP'), nieuw.get(N('AP')));
  }
  if (vorm && nieuw instanceof PDFDict) {
    for (const [k, v] of nieuw.entries()) {
      if (k.decodeText().startsWith('OPS_') && origineel.get(k) !== undefined) uit.set(k, v);
    }
  }
  if (nieuw instanceof PDFDict) {
    for (const naam of metaSleutels) {
      const k = N(naam);
      if (naam === 'F') { uit.set(k, samengevoegdeVlaggen(context, origineel, nieuw)); continue; }
      const v = nieuw.get(k);
      if (v === undefined) uit.delete(k);
      else if (!zelfdeWaarde(origineel.get(k), v)) uit.set(k, v);
    }
  }
  if (gewijzigd) uit.set(N('M'), PDFString.fromDate(new Date()));
  return uit;
}

// Soorten die een rechthoekige wolk als /BE op hun vak dragen; de app
// tekent zo'n wolk als 'cloud' en schrijft die als /Polygon.
const VAK_SOORTEN = new Set(['/Square', '/Circle']);

/**
 * De soort en de bedoeling van een herschreven annotatie blijven die van het
 * bestand (#629), zolang de soort in de app niet veranderde: een /IT met een
 * andere schrijfwijze gaat terug, en een wolk op een rechthoek of ellips
 * blijft een /Square of /Circle met /BE in plaats van een /Polygon. Vóór de
 * ruwe sleutels aanroepen: die gaan alleen terug op dezelfde soort.
 */
export function houdSoort(context, origineel, nieuw, ann, plan) {
  if (!(origineel instanceof PDFDict) || !(nieuw instanceof PDFDict)) return;
  if (plan?.gewijzigd?.includes('type')) return;
  const it = origineel.get(N('IT'));
  if (it instanceof PDFName && nieuw.get(N('IT')) instanceof PDFName && nieuw.get(N('IT')) !== it) nieuw.set(N('IT'), it);
  else if (it === undefined && nieuw.get(N('IT')) !== undefined) nieuw.delete(N('IT'));
  const soort = origineel.get(N('Subtype'))?.toString();
  if (VAK_SOORTEN.has(soort) && nieuw.get(N('Subtype'))?.toString() === '/Polygon'
      && ann?.type === 'cloud' && !Array.isArray(ann.points) && !ann.rotation) {
    nieuw.set(N('Subtype'), origineel.get(N('Subtype')));
    nieuw.delete(N('Vertices'));
    for (const k of ['BE', 'RD']) {
      const v = origineel.get(N(k));
      if (v !== undefined && nieuw.get(N(k)) === undefined) nieuw.set(N(k), v);
    }
  }
}

// Sleutel -> de modelvelden waaruit de saver hem schrijft.
const ONVERANDERDE_TEKST = [
  ['Subj', ['subject', 'pdfSubject', 'stampName']],
  ['Contents', ['subject', 'text', 'runs', 'stampText', 'stampName']],
  ['Name', ['stampName', 'stampText', 'icon']],
];

/**
 * Een herschreven annotatie (staat 'anders') houdt wat nooit verandert: haar
 * aanmaakdatum, haar popup (als die nog naar haar wijst), de bits van /F
 * die de app niet beheert, een expliciete /RT, en /Subj, /Contents en /Name
 * zolang hun bron in het model niet veranderde. Aanmaakdatum en popup alleen als het nieuwe
 * woordenboek ze niet zelf heeft.
 */
export function bewaarBronSleutels(context, origineel, nieuw, ref, plan = null) {
  if (!(origineel instanceof PDFDict) || !(nieuw instanceof PDFDict)) return;
  // Zonder laag in het bestand en met dezelfde laag in de app: geen /OC erbij
  // (de standaardlaag is ook zonder /OC de standaardlaag).
  if (origineel.get(N('OC')) === undefined && plan && !plan.gewijzigd?.includes('layerId')) nieuw.delete(N('OC'));
  // De vlaggen die de app niet kent (Hidden, NoZoom, NoRotate …) blijven.
  if (origineel.get(N('F')) !== undefined) nieuw.set(N('F'), samengevoegdeVlaggen(context, origineel, nieuw));
  // Tekstsleutels waarvan de bron in het model niet veranderde, houden de
  // waarde en schrijfwijze van het bestand: een stempel schreef anders zijn
  // naam als /Subj en zijn tekst alleen in een eigen sleutel.
  for (const [sleutel, velden] of ONVERANDERDE_TEKST) {
    const oud = origineel.get(N(sleutel));
    if (oud === undefined || !plan || velden.some((k) => plan.gewijzigd?.includes(k))) continue;
    nieuw.set(N(sleutel), oud);
  }
  // Een expliciete /RT /R (antwoord) blijft als de koppeling niet veranderde.
  const rt = origineel.get(N('RT'));
  if (rt !== undefined && nieuw.get(N('RT')) === undefined && origineel.get(N('IRT')) !== undefined
      && !plan?.gewijzigd?.some((k) => k === 'inReplyTo' || k === 'replyType')) nieuw.set(N('RT'), rt);
  const cd = origineel.get(N('CreationDate'));
  if (cd !== undefined && nieuw.get(N('CreationDate')) === undefined) nieuw.set(N('CreationDate'), cd);
  const popup = origineel.get(N('Popup'));
  if (popup instanceof PDFRef && nieuw.get(N('Popup')) === undefined) {
    const p = context.lookup(popup);
    const ouder = p instanceof PDFDict ? p.get(N('Parent')) : undefined;
    if (ouder instanceof PDFRef && ref instanceof PDFRef && ouder.tag === ref.tag) nieuw.set(N('Popup'), popup);
  }
}

/**
 * Na een geslaagde save: de bron van elk geschreven model wijst naar zijn
 * object in het nieuwe bestand. Aanroepen na het opruimen en hernummeren
 * (saver/objecten-opruimen.js), vlak voor pdfDoc.save().
 * @param {import('pdf-lib').PDFContext} context
 * @param {Array<{ann: object, dict: PDFDict, velden: object, mee?: object}>} geschreven
 * @returns {Array<[object, object]>} [model, nieuwe bron]; zet ze pas na het wegschrijven
 */
export function bronNaOpslaan(context, geschreven) {
  const refVan = new Map();
  for (const [ref, obj] of context.enumerateIndirectObjects()) refVan.set(obj, ref);
  const uit = [];
  for (const { ann, dict, velden, anker, mee } of geschreven || []) {
    const ref = refVan.get(dict);
    if (!ref || !ann || ann.id == null) continue;
    const bron = { ref: pdfjsId(ref), id: ann.id, dfp: dictVingerafdruk(dict), velden };
    if (anker) bron.anker = anker;
    const lijst = {};
    let volledig = true;
    for (const [soort, dicts] of Object.entries(mee || {})) {
      const met = (dicts || []).map((d) => {
        const r = refVan.get(d);
        return r ? { ref: pdfjsId(r), dfp: dictVingerafdruk(d) } : null;
      });
      if (met.some((m) => !m)) { volledig = false; break; }
      if (met.length) lijst[soort] = met;
    }
    if (!volledig) continue;
    if (Object.keys(lijst).length) bron.mee = lijst;
    uit.push([ann, bron]);
  }
  return uit;
}

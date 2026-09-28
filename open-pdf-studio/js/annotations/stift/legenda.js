// De legenda van een plattegrond: welke regels, in welke volgorde, hoe het
// blok is ingedeeld en hoe het getekend wordt. Puur; dezelfde opdrachten
// gaan naar het canvas en naar de appearance stream.
//
// Opmaak zoals 3052-CP-21: een kop met groene vulling en vetgedrukte
// hoofdletters, daaronder per regel een voorbeeld van de stift en een groen
// vak met de omschrijving. Elk vak is 15 pt hoog, 2 mm marge links en rechts
// van de tekst, 2 mm tussen de regels.

import { SOORTEN, mmNaarPt } from './definities.js';
import { stiftMidden } from './geometrie.js';
import {
  stiftTekenopdrachten, helveticaBreedte, LEGENDA_GROEN, LEGENDA_TEKST, BASISLIJN,
} from './tekenopdrachten.js';

export const LEGENDA_MAAT = Object.freeze({
  rij: 15,
  marge: mmNaarPt(2),
  tussen: mmNaarPt(2),
  voorbeeld: mmNaarPt(25),
  kruisBreedte: mmNaarPt(8),
  grootte: 12,
});

const SOORT_VOLGORDE = new Map(SOORTEN.map((s, i) => [s.id, i]));

/**
 * De regels van een legenda: de definities die binnen het kader gebruikt
 * worden (op dezelfde pagina), in de volgorde van de soorten en daarbinnen
 * die van het paneel. Een stift telt mee als het midden van zijn geometrie
 * binnen het kader ligt; zonder kader telt de hele pagina.
 * @returns {{definitie: object, tekst: string}[]}
 */
export function legendaRegels(legenda, annotaties, definities) {
  const perId = new Map((definities || []).map((d, i) => [d.id, { d, i }]));
  const k = legenda.kader;
  const gebruikt = new Set();
  for (const a of annotaties || []) {
    if (a?.type !== 'stift' || a.page !== legenda.page || !perId.has(a.stiftDefId)) continue;
    if (k) {
      const [mx, my] = stiftMidden(a);
      if (mx < k.x || mx > k.x + k.width || my < k.y || my > k.y + k.height) continue;
    }
    gebruikt.add(a.stiftDefId);
  }
  return [...gebruikt]
    .map((id) => perId.get(id))
    .sort((a, b) => ((SOORT_VOLGORDE.get(a.d.soort) ?? 99) - (SOORT_VOLGORDE.get(b.d.soort) ?? 99)) || (a.i - b.i))
    .map(({ d }) => ({
      definitie: d,
      tekst: d.soort === 'vloer' && d.letter ? `${d.letter}  ${d.omschrijving}` : d.omschrijving,
    }));
}

/**
 * Indeling van het blok vanaf de linkerbovenhoek (legenda.x, legenda.y).
 * @param {(tekst: string, grootte: number, vet: boolean) => number} [meet]
 */
export function legendaIndeling(legenda, regels, meet = helveticaBreedte) {
  const M = LEGENDA_MAAT;
  const kopTekst = String(legenda.kop || 'CONSTRUCTIE').toUpperCase();
  const kolommen = legenda.kolommen === 2 && regels.length > 1 ? 2 : 1;
  const splits = Math.ceil(regels.length / kolommen);
  const perKolom = kolommen === 2 ? [regels.slice(0, splits), regels.slice(splits)] : [regels];
  const tekstVakken = perKolom.map((kol) => Math.max(0, ...kol.map((r) => meet(r.tekst, M.grootte, false))) + 2 * M.marge);
  const kolomBreedtes = tekstVakken.map((b) => M.voorbeeld + M.tussen + b);
  const inhoud = kolomBreedtes.reduce((s, b) => s + b, 0) + (kolommen - 1) * 2 * M.tussen;
  const breedte = Math.max(inhoud, meet(kopTekst, M.grootte, true) + 2 * M.marge);
  const rijen = [];
  let kx = legenda.x;
  perKolom.forEach((kol, k) => {
    kol.forEach((regel, i) => {
      const y = legenda.y + M.rij + M.tussen + i * (M.rij + M.tussen);
      rijen.push({
        ...regel,
        voorbeeldVak: { x: kx, y, b: M.voorbeeld, h: M.rij },
        tekstVak: { x: kx + M.voorbeeld + M.tussen, y, b: tekstVakken[k], h: M.rij },
      });
    });
    kx += kolomBreedtes[k] + 2 * M.tussen;
  });
  const aantal = perKolom[0].length;
  const hoogte = M.rij + (aantal ? M.tussen + aantal * M.rij + (aantal - 1) * M.tussen : 0);
  return {
    x: legenda.x, y: legenda.y, breedte, hoogte, kolommen,
    kop: { x: legenda.x, y: legenda.y, b: breedte, h: M.rij, tekst: kopTekst },
    rijen,
  };
}

/** Een voorbeeldstift die in het voorbeeldvak van een regel past. */
export function voorbeeldStift(definitie, vak) {
  const soort = SOORTEN.find((s) => s.id === definitie.soort);
  const cy = vak.y + vak.h / 2;
  const marge = mmNaarPt(1);
  switch (soort?.vorm) {
    case 'pijl':
      return { type: 'stift', vorm: 'pijl', startX: vak.x + marge, startY: cy, endX: vak.x + vak.b - marge, endY: cy };
    case 'punt':
      return { type: 'stift', vorm: 'punt', x: vak.x + vak.b / 2, y: cy };
    case 'kruis': {
      const b = LEGENDA_MAAT.kruisBreedte;
      return { type: 'stift', vorm: 'kruis', x: vak.x + (vak.b - b) / 2, y: vak.y + 1, width: b, height: vak.h - 2 };
    }
    default:
      return { type: 'stift', vorm: 'lijn', points: [{ x: vak.x + marge, y: cy }, { x: vak.x + vak.b - marge, y: cy }] };
  }
}

/** Tekenopdrachten van het hele blok. */
export function legendaTekenopdrachten(indeling, meet = helveticaBreedte) {
  const M = LEGENDA_MAAT;
  const tekst = (x, vak, inhoud, vet) => ({
    soort: 'tekst', x, y: vak.y + vak.h / 2 + M.grootte * BASISLIJN, tekst: inhoud, grootte: M.grootte,
    vet, kleur: LEGENDA_TEKST, uitlijning: 'links', breedte: meet(inhoud, M.grootte, vet),
  });
  const kop = indeling.kop;
  const opdrachten = [
    { soort: 'rechthoek', x: kop.x, y: kop.y, b: kop.b, h: kop.h, vulling: LEGENDA_GROEN },
    tekst(kop.x + M.marge, kop, kop.tekst, true),
  ];
  for (const r of indeling.rijen) {
    opdrachten.push(...stiftTekenopdrachten(voorbeeldStift(r.definitie, r.voorbeeldVak), r.definitie, { meet }));
    const t = r.tekstVak;
    opdrachten.push({ soort: 'rechthoek', x: t.x, y: t.y, b: t.b, h: t.h, vulling: LEGENDA_GROEN });
    opdrachten.push(tekst(t.x + M.marge, t, r.tekst, false));
  }
  return opdrachten;
}

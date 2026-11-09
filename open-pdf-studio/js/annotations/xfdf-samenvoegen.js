// Uitwisselen per auteur via XFDF (#629, zie ook #237). Puur: geen DOM, geen
// app-state.
//
// Exporteren: de auteurs die in de annotaties voorkomen, en de annotaties van
// de gekozen auteurs. Elk element krijgt een naam (de /NM van de annotatie,
// anders haar id), zodat een ontvanger dezelfde annotatie later herkent.
//
// Importeren: bestanden van meerdere beoordelaars samenvoegen zonder dubbelen.
// Een annotatie die er al is (zelfde naam, of anders dezelfde vingerafdruk:
// soort, pagina, positie, auteur en tekst) komt niet nog eens; wel komen haar
// antwoorden mee die er nog niet onder staan.

/** De auteursnaam zoals XFDF hem schrijft (`title`). */
export function auteurVan(ann) {
  const naam = typeof ann?.author === 'string' ? ann.author.trim() : '';
  return naam || 'User';
}

/** De auteurs in de annotaties met hun aantal, op naam gesorteerd. */
export function auteursIn(annotaties) {
  const per = new Map();
  for (const a of annotaties || []) {
    if (!a) continue;
    const naam = auteurVan(a);
    per.set(naam, (per.get(naam) || 0) + 1);
  }
  return [...per].map(([naam, aantal]) => ({ naam, aantal }))
    .sort((x, y) => x.naam.localeCompare(y.naam));
}

/**
 * Alleen de annotaties van `auteurs` (namen). Zonder keuze (null) alles.
 * Antwoorden blijven bij hun annotatie.
 */
export function vanAuteurs(annotaties, auteurs) {
  const lijst = (annotaties || []).filter(Boolean);
  if (!Array.isArray(auteurs)) return lijst;
  const gekozen = new Set(auteurs);
  return lijst.filter((a) => gekozen.has(auteurVan(a)));
}

/**
 * De annotaties zoals de XFDF-export ze schrijft: met als id hun naam (/NM)
 * als ze die hebben en die nog niet gebruikt is, anders hun eigen id. Het
 * origineel blijft ongemoeid (een kopie per gewijzigde annotatie).
 */
export function metXfdfNamen(annotaties) {
  const gebruikt = new Set();
  return (annotaties || []).map((a) => {
    const nm = typeof a?.nm === 'string' && a.nm.trim() ? a.nm : null;
    const id = nm && !gebruikt.has(nm) ? nm : a?.id;
    if (id) gebruikt.add(id);
    return id === a?.id ? a : { ...a, id };
  });
}

// De soort zoals een XFDF-rondgang hem teruggeeft: een markering komt terug
// als tekstmarkering, een masker als rechthoek, een callout als tekstvak.
const RONDGANG_SOORT = Object.freeze({ highlight: 'textHighlight', mask: 'box', callout: 'textbox' });

const rond = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : '');
const schoon = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function tekstVan(ann) {
  switch (ann.type) {
    case 'comment':
    case 'textbox':
    case 'callout':
      return ann.text;
    case 'stamp':
      return ann.stampText;
    case 'scaleRegion':
      return ann.label;
    default:
      return ann.subject;
  }
}

// De plek: het eerste punt dat XFDF exact bewaart. Breedte en hoogte niet:
// een notitie komt altijd als 24 × 24 terug.
function plekVan(ann) {
  if (ann.startX !== undefined) return [ann.startX, ann.startY, ann.endX, ann.endY].map(rond).join(',');
  if (ann.type === 'draw' && Array.isArray(ann.path) && ann.path.length) {
    const a = ann.path[0];
    const b = ann.path[ann.path.length - 1];
    return [a.x, a.y, b.x, b.y, ann.path.length].map(rond).join(',');
  }
  return [ann.x, ann.y].map(rond).join(',');
}

/** Vingerafdruk voor annotaties zonder (bruikbare) naam. */
export function xfdfVingerafdruk(ann) {
  if (!ann?.type) return '';
  const soort = RONDGANG_SOORT[ann.type] || ann.type;
  return [soort, ann.page ?? '', plekVan(ann), auteurVan(ann).toLowerCase(), schoon(tekstVan(ann)).toLowerCase()].join('|');
}

const antwoordSleutel = (r) => `${auteurVan(r).toLowerCase()}|${schoon(r?.text).toLowerCase()}`;

/**
 * Voegt geïmporteerde annotaties samen met wat het document al heeft.
 *
 * @param {object[]} bestaande  de annotaties van het document (alleen gelezen)
 * @param {{ann: object, naam?: string|null}[]} binnen  uit alle bestanden, in volgorde
 * @returns {{
 *   nieuw: {ann: object, naam?: string|null}[],
 *   dubbel: number,
 *   antwoorden: {doel: object, nieuw: object[]}[],
 * }} `antwoorden`: per bestaande (of eerder in deze import nieuwe) annotatie de
 *   antwoorden die er nog niet onder staan. Mutatie laat de functie aan de
 *   aanroeper.
 */
export function voegXfdfSamen(bestaande, binnen) {
  const opNaam = new Map();
  const opAfdruk = new Map();
  const onthoud = (ann, extraNaam) => {
    for (const n of [ann?.nm, ann?.id, extraNaam]) {
      if (typeof n === 'string' && n && !opNaam.has(n)) opNaam.set(n, ann);
    }
    const afdruk = xfdfVingerafdruk(ann);
    if (afdruk && !opAfdruk.has(afdruk)) opAfdruk.set(afdruk, ann);
  };
  for (const a of bestaande || []) if (a) onthoud(a);

  const nieuw = [];
  const extraAntwoorden = new Map();
  let dubbel = 0;
  for (const item of binnen || []) {
    const ann = item?.ann;
    if (!ann) continue;
    const naam = typeof item.naam === 'string' && item.naam ? item.naam : null;
    const doel = (naam && opNaam.get(naam)) || opAfdruk.get(xfdfVingerafdruk(ann));
    if (!doel) {
      nieuw.push(item);
      onthoud(ann, naam);
      continue;
    }
    dubbel++;
    const binnenAntwoorden = Array.isArray(ann.replies) ? ann.replies : [];
    if (!binnenAntwoorden.length) continue;
    const lijst = extraAntwoorden.get(doel) || [];
    const al = new Set([...(Array.isArray(doel.replies) ? doel.replies : []), ...lijst].map(antwoordSleutel));
    for (const r of binnenAntwoorden) {
      const sleutel = antwoordSleutel(r);
      if (al.has(sleutel)) continue;
      al.add(sleutel);
      lijst.push(r);
    }
    if (lijst.length) extraAntwoorden.set(doel, lijst);
  }
  return {
    nieuw,
    dubbel,
    antwoorden: [...extraAntwoorden].map(([doel, lijst]) => ({ doel, nieuw: lijst })),
  };
}

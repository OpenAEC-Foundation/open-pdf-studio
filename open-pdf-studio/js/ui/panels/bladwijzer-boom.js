// Bladwijzers selecteren, verplaatsen en nesten (#690). Puur: geen imports
// uit de app, zodat de unit-tests de boomlogica zonder browser draaien.
//
// Het model is een platte lijst (doc.bookmarks) met `parentId` en
// `sortOrder`; de saver bouwt daar de outline-boom uit. Verplaatsen past dus
// alleen `parentId` aan en nummert `sortOrder` per oudergroep opnieuw.
// Een `parentId` die niet (meer) bestaat telt als wortel, net als in
// buildTree van bookmarks.js en de saver.

function index(bookmarks) {
  const opId = new Map();
  for (const b of bookmarks || []) opId.set(b.id, b);
  return opId;
}

/** De echte ouder: null als parentId leeg is of niet bestaat. */
function ouderVan(opId, id) {
  const b = opId.get(id);
  if (!b || b.parentId == null || !opId.has(b.parentId) || b.parentId === id) return null;
  return b.parentId;
}

/** Kinderen per ouder (null = wortel), op sortOrder, bij gelijkspel op lijstvolgorde. */
function groepen(bookmarks) {
  const opId = index(bookmarks);
  const perOuder = new Map();
  (bookmarks || []).forEach((b, i) => {
    const ouder = ouderVan(opId, b.id);
    if (!perOuder.has(ouder)) perOuder.set(ouder, []);
    perOuder.get(ouder).push({ b, i });
  });
  for (const lijst of perOuder.values()) {
    lijst.sort((x, y) => ((x.b.sortOrder || 0) - (y.b.sortOrder || 0)) || (x.i - y.i));
  }
  const kinderen = new Map();
  for (const [ouder, lijst] of perOuder) kinderen.set(ouder, lijst.map(x => x.b.id));
  return { opId, kinderen };
}

/**
 * Ids in boomvolgorde (ouder vóór zijn kinderen). Met `alleenZichtbaar`
 * worden kinderen van ingeklapte bladwijzers overgeslagen, zoals in het paneel.
 */
export function boomVolgorde(bookmarks, alleenZichtbaar = false) {
  const { opId, kinderen } = groepen(bookmarks);
  const uit = [];
  const gezien = new Set();
  const loop = (ouder) => {
    for (const id of kinderen.get(ouder) || []) {
      if (gezien.has(id)) continue;
      gezien.add(id);
      uit.push(id);
      if (!alleenZichtbaar || opId.get(id).expanded) loop(id);
    }
  };
  loop(null);
  return uit;
}

/** Shift+klik: alle zichtbare bladwijzers van `vanId` t/m `totId`, in boomvolgorde. */
export function selectieBereik(bookmarks, vanId, totId) {
  const zichtbaar = boomVolgorde(bookmarks, true);
  const a = zichtbaar.indexOf(vanId);
  const b = zichtbaar.indexOf(totId);
  if (b === -1) return [];
  if (a === -1) return [totId];
  return zichtbaar.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Is `voorouderId` een (over)ouder van `id`? */
export function isVoorouder(bookmarks, voorouderId, id) {
  const opId = index(bookmarks);
  const gezien = new Set();
  let p = ouderVan(opId, id);
  while (p != null && !gezien.has(p)) {
    if (p === voorouderId) return true;
    gezien.add(p);
    p = ouderVan(opId, p);
  }
  return false;
}

/**
 * De bladwijzers die echt verplaatst worden: geselecteerd, zonder de
 * geselecteerde die al onder een andere geselecteerde hangen (die blijven
 * onder hun ouder). In boomvolgorde.
 */
export function topSelectie(bookmarks, ids) {
  const set = new Set(ids || []);
  const opId = index(bookmarks);
  return boomVolgorde(bookmarks).filter((id) => {
    if (!set.has(id)) return false;
    const gezien = new Set();
    let p = ouderVan(opId, id);
    while (p != null && !gezien.has(p)) {
      if (set.has(p)) return false;
      gezien.add(p);
      p = ouderVan(opId, p);
    }
    return true;
  });
}

/**
 * Mag de selectie op/naast `doelId` vallen? Niet op zichzelf en niet in
 * een eigen (klein)kind. `doelId` null = einde van de lijst (altijd goed).
 */
export function dropToegestaan(bookmarks, ids, doelId) {
  const tops = topSelectie(bookmarks, ids);
  if (tops.length === 0) return false;
  if (doelId == null) return true;
  if (!index(bookmarks).has(doelId)) return false;
  if (tops.includes(doelId)) return false;
  return !tops.some((t) => isVoorouder(bookmarks, t, doelId));
}

/** Plaats van een drop als { ouder, voor }: invoegen vóór `voor` onder `ouder` (voor null = achteraan). */
export function dropPlaats(bookmarks, ids, doelId, positie) {
  const { opId, kinderen } = groepen(bookmarks);
  const weg = new Set(topSelectie(bookmarks, ids));
  const volgende = (ouder, naId) => {
    const rij = (kinderen.get(ouder) || []).filter((id) => !weg.has(id));
    const i = rij.indexOf(naId);
    return i === -1 ? null : (rij[i + 1] ?? null);
  };
  if (doelId == null || positie === 'end') return { ouder: null, voor: null };
  const doel = opId.get(doelId);
  if (!doel) return null;
  if (positie === 'inside') return { ouder: doelId, voor: null };
  if (positie === 'before') return { ouder: ouderVan(opId, doelId), voor: doelId };
  if (positie === 'after') {
    // De streep onder een opengeklapte ouder ligt tussen hem en zijn eerste
    // kind: daar wordt het het eerste kind.
    const eigenKinderen = (kinderen.get(doelId) || []).filter((id) => !weg.has(id));
    if (doel.expanded && eigenKinderen.length > 0) return { ouder: doelId, voor: eigenKinderen[0] };
    const ouder = ouderVan(opId, doelId);
    return { ouder, voor: volgende(ouder, doelId) };
  }
  return null;
}

/**
 * Zet de (top-)selectie onder `ouder`, vóór `voor` (null = achteraan), in de
 * oorspronkelijke volgorde, elk met zijn eigen kinderen. Nummert sortOrder per
 * groep opnieuw. Geeft een nieuwe lijst (kopieën) of null als het niet mag of
 * niets verandert. Een nieuwe ouder klapt open.
 */
export function plaatsBladwijzers(bookmarks, ids, { ouder = null, voor = null } = {}) {
  const lijst = Array.isArray(bookmarks) ? bookmarks : [];
  const tops = topSelectie(lijst, ids);
  if (tops.length === 0) return null;
  const { opId, kinderen } = groepen(lijst);
  if (ouder != null && !opId.has(ouder)) return null;
  if (ouder != null && (tops.includes(ouder) || tops.some((t) => isVoorouder(lijst, t, ouder)))) return null;
  const weg = new Set(tops);
  if (voor != null && (weg.has(voor) || ouderVan(opId, voor) !== ouder)) return null;

  // Nieuwe volgorde per groep.
  const nieuweKinderen = new Map();
  for (const [p, rij] of kinderen) nieuweKinderen.set(p, rij.filter((id) => !weg.has(id)));
  const doelRij = nieuweKinderen.get(ouder) || [];
  const plek = voor == null ? doelRij.length : doelRij.indexOf(voor);
  doelRij.splice(plek, 0, ...tops);
  nieuweKinderen.set(ouder, doelRij);

  // Verandert er iets?
  const oudeRij = kinderen.get(ouder) || [];
  const zelfde = tops.every((t) => ouderVan(opId, t) === ouder)
    && oudeRij.length === doelRij.length && oudeRij.every((id, i) => id === doelRij[i]);
  if (zelfde) return null;

  const nieuw = new Map();
  for (const [p, rij] of nieuweKinderen) {
    rij.forEach((id, i) => nieuw.set(id, { parentId: p, sortOrder: i }));
  }
  return lijst.map((b) => {
    const n = nieuw.get(b.id);
    const kopie = { ...b };
    if (n) {
      // Een wees (parentId naar niets) wordt een gewone wortel: zelfde plek.
      kopie.parentId = n.parentId;
      kopie.sortOrder = n.sortOrder;
    }
    if (b.id === ouder) kopie.expanded = true;
    return kopie;
  });
}

/** Slepen: de selectie vóór/na/op `doelId` ('before' | 'after' | 'inside' | 'end'). */
export function verplaatsBladwijzers(bookmarks, ids, doelId, positie) {
  if (!dropToegestaan(bookmarks, ids, doelId)) return null;
  const plaats = dropPlaats(bookmarks, ids, doelId, positie);
  if (!plaats) return null;
  return plaatsBladwijzers(bookmarks, ids, plaats);
}

/** Inspringen: de selectie wordt kind (achteraan) van de bladwijzer net erboven. */
export function inspringDoel(bookmarks, ids) {
  const tops = topSelectie(bookmarks, ids);
  if (tops.length === 0) return null;
  const { opId, kinderen } = groepen(bookmarks);
  const rij = kinderen.get(ouderVan(opId, tops[0])) || [];
  const i = rij.indexOf(tops[0]);
  return i > 0 ? rij[i - 1] : null;
}

export function springIn(bookmarks, ids) {
  const doel = inspringDoel(bookmarks, ids);
  if (doel == null) return null;
  return plaatsBladwijzers(bookmarks, ids, { ouder: doel, voor: null });
}

/** Uitspringen: elke bladwijzer één niveau omhoog, direct na zijn vroegere ouder. */
export function springUit(bookmarks, ids) {
  let lijst = Array.isArray(bookmarks) ? bookmarks : [];
  const tops = topSelectie(lijst, ids);
  const opId = index(lijst);
  // Per vroegere ouder, in boomvolgorde; de wortel blijft staan.
  const perOuder = new Map();
  for (const t of tops) {
    const p = ouderVan(opId, t);
    if (p == null) continue;
    if (!perOuder.has(p)) perOuder.set(p, []);
    perOuder.get(p).push(t);
  }
  if (perOuder.size === 0) return null;
  for (const [p, groep] of perOuder) {
    const { opId: o, kinderen } = groepen(lijst);
    const grootouder = ouderVan(o, p);
    const rij = (kinderen.get(grootouder) || []).filter((id) => !groep.includes(id));
    const voor = rij[rij.indexOf(p) + 1] ?? null;
    const volgende = plaatsBladwijzers(lijst, groep, { ouder: grootouder, voor });
    if (volgende) lijst = volgende;
  }
  return lijst === bookmarks ? null : lijst;
}

/** Kan de selectie uitspringen (staat er minstens één niet in de wortel)? */
export function kanUitspringen(bookmarks, ids) {
  const opId = index(bookmarks);
  return topSelectie(bookmarks, ids).some((t) => ouderVan(opId, t) != null);
}

/**
 * Nesten onder een nieuwe bladwijzer: `nieuw` komt op de plaats van de eerste
 * geselecteerde, en de selectie gaat eronder (in volgorde).
 */
export function nestOnderNieuw(bookmarks, ids, nieuw) {
  const lijst = Array.isArray(bookmarks) ? bookmarks : [];
  const tops = topSelectie(lijst, ids);
  if (tops.length === 0 || !nieuw?.id) return null;
  const opId = index(lijst);
  const ouder = ouderVan(opId, tops[0]);
  const eerste = opId.get(tops[0]);
  const met = [...lijst, { ...nieuw, parentId: ouder, sortOrder: (eerste.sortOrder || 0) - 0.5, expanded: true }];
  // Eerst de nieuwe op zijn plek (vóór de eerste geselecteerde) ...
  const geplaatst = plaatsBladwijzers(met, [nieuw.id], { ouder, voor: tops[0] }) || met;
  // ... dan de selectie eronder.
  return plaatsBladwijzers(geplaatst, tops, { ouder: nieuw.id, voor: null });
}

/** Verwijderen: de selectie met alles eronder. */
export function verwijderBladwijzers(bookmarks, ids) {
  const lijst = Array.isArray(bookmarks) ? bookmarks : [];
  const tops = topSelectie(lijst, ids);
  const weg = new Set(tops);
  for (const b of lijst) if (tops.some((t) => isVoorouder(lijst, t, b.id))) weg.add(b.id);
  return {
    bookmarks: lijst.filter((b) => !weg.has(b.id)).map((b) => ({ ...b })),
    verwijderd: lijst.filter((b) => weg.has(b.id)).map((b) => ({ ...b })),
    aantalGeselecteerd: tops.length,
  };
}

/**
 * Waar valt een sleep binnen een rij? Bovenste kwart: ervoor, onderste
 * kwart: erna, het midden: erin (nesten).
 * @param {number} top     bovenkant van de rij (clientY)
 * @param {number} hoogte  hoogte van de rij
 * @param {number} y       clientY van de muis
 */
export function sleepPositie(top, hoogte, y) {
  const rel = hoogte > 0 ? (y - top) / hoogte : 0.5;
  if (rel < 0.25) return 'before';
  if (rel > 0.75) return 'after';
  return 'inside';
}

/**
 * Hernoemen in de lijst (#891): de nieuwe titel, of null als er niets te doen
 * is. Leeg of alleen spaties houdt de oude titel, net als ongewijzigd. Een
 * verdwenen bladwijzer of een titel die intussen anders is dan bij het begin
 * van het bewerken (Edit Bookmark, undo) wordt niet overschreven.
 */
export function nieuweTitel(bookmarks, id, waarde, oorspronkelijk) {
  const titel = String(waarde ?? '').trim();
  if (!titel || titel === oorspronkelijk) return null;
  const b = (bookmarks || []).find(x => x.id === id);
  if (!b || b.title !== oorspronkelijk) return null;
  return titel;
}

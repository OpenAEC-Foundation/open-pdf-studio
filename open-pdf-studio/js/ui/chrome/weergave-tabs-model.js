// Hetzelfde document in meer tabbladen (#919): de boekhouding, zonder DOM.
//
// Een tabblad van een document is een WEERGAVE: een eigen pagina, zoom en
// scrollstand op één en hetzelfde document. Het document (annotaties,
// bewerkingen, ongedaan maken, gewijzigd, opslaan) blijft één object in
// state.documents; extra tabbladen voegen alleen weergaven toe. Bewerken in
// het ene tabblad staat dus meteen in het andere, en opslaan vanuit welk
// tabblad ook schrijft het ene bestand.
//
// Op het document:
//   doc.weergaven       ids van de tabbladen, in volgorde; afwezig of één
//                       id = gewoon één tabblad (zoals altijd);
//   doc.actieveWeergave het id van de weergave die de viewer nu toont.
// De stand (pagina, zoom, scroll) van de weergave die voor ligt, IS de
// viewer; die van de andere weergaven bewaart weergave-tabs.js.
//
// Altijd nieuwe arrays toewijzen (geen push): het document is een Solid-store.

let _teller = 0;

/** Een nieuw weergave-id. */
export function nieuwWeergaveId() {
  _teller += 1;
  return `w${Date.now().toString(36)}_${_teller}`;
}

/** De weergaven van een document: [] als het één tabblad heeft. */
export function weergavenVan(doc) {
  const w = Array.isArray(doc?.weergaven) ? doc.weergaven : [];
  return w.length > 1 ? [...w] : [];
}

/** Heeft het document meer dan één tabblad? */
export function heeftMeerWeergaven(doc) {
  return weergavenVan(doc).length > 1;
}

/** Het id van de weergave die voor ligt (null bij één tabblad). */
export function actieveWeergaveVan(doc) {
  const w = weergavenVan(doc);
  if (!w.length) return null;
  return w.includes(doc.actieveWeergave) ? doc.actieveWeergave : w[0];
}

/**
 * De tabbladen van de tabbalk: per document één, of één per weergave, direct
 * na elkaar.
 * @returns {{index:number, weergave:string|null, nummer:number, aantal:number}[]}
 */
export function tabItems(documenten) {
  const uit = [];
  (documenten || []).forEach((doc, index) => {
    const w = weergavenVan(doc);
    if (!w.length) { uit.push({ index, weergave: null, nummer: 1, aantal: 1 }); return; }
    w.forEach((id, i) => uit.push({ index, weergave: id, nummer: i + 1, aantal: w.length }));
  });
  return uit;
}

/** Is dit tabblad het actieve? */
export function isActiefTabItem(item, documenten, actieveIndex) {
  if (!item || item.index !== actieveIndex) return false;
  const doc = documenten?.[item.index];
  if (!item.weergave) return !heeftMeerWeergaven(doc);
  return actieveWeergaveVan(doc) === item.weergave;
}

/**
 * Voeg een weergave toe direct na de actieve en maak hem actief. Een
 * document met één tabblad krijgt eerst een id voor dat tabblad.
 * @returns {{van:string, naar:string}} de weergave die voor lag en de nieuwe
 */
export function voegWeergaveToe(doc, maakId = nieuwWeergaveId) {
  let w = weergavenVan(doc);
  let van = actieveWeergaveVan(doc);
  if (!w.length) {
    van = maakId();
    w = [van];
  }
  const naar = maakId();
  const plek = w.indexOf(van) + 1;
  doc.weergaven = [...w.slice(0, plek), naar, ...w.slice(plek)];
  doc.actieveWeergave = naar;
  return { van, naar };
}

/**
 * Haal weergave `id` weg. Was het de laatste, dan sluit het document (de
 * aanroeper sluit het echte tabblad). Was hij actief, dan komt de buur
 * rechts (of links) voor.
 * @returns {{sluitDocument:boolean, wasActief:boolean, nieuweActief:string|null}}
 */
export function verwijderWeergave(doc, id) {
  const w = weergavenVan(doc);
  if (!w.length || !w.includes(id)) return { sluitDocument: true, wasActief: true, nieuweActief: null };
  const actief = actieveWeergaveVan(doc);
  const plek = w.indexOf(id);
  const over = w.filter((x) => x !== id);
  const wasActief = actief === id;
  const nieuweActief = wasActief ? over[Math.min(plek, over.length - 1)] : actief;
  if (over.length <= 1) {
    doc.weergaven = undefined;
    doc.actieveWeergave = undefined;
  } else {
    doc.weergaven = over;
    doc.actieveWeergave = nieuweActief;
  }
  return { sluitDocument: false, wasActief, nieuweActief };
}

/**
 * Wat een klik op een tabblad moet doen.
 * @returns {'niets'|'document'|'weergave'} 'document': naar een ander
 *   document wisselen (daarna eventueel de weergave); 'weergave': binnen het
 *   actieve document naar een andere weergave
 */
export function klikActie(item, documenten, actieveIndex) {
  if (!item) return 'niets';
  if (item.index !== actieveIndex) return 'document';
  if (isActiefTabItem(item, documenten, actieveIndex)) return 'niets';
  return item.weergave ? 'weergave' : 'niets';
}

/** De sleutel van een bewaarde stand. */
export function standSleutel(doc, id) {
  return `${doc?.id ?? ''}|${id ?? ''}`;
}

// Van wie is een momentopname, wat wordt aangeboden en wat mag weg?
//
// Pure regels (getest in beleid.test.mjs). Meerdere instanties delen de
// herstelmap: de hoofdinstantie, losgemaakte tabbladen (tweede instantie) en
// testinstanties met OPDS_DETACHED. Elke momentopname en markering draagt de
// instantie die haar schreef (pid + starttijd). De regel is steeds: wat van
// een LEVENDE andere instantie is, blijft onaangeroerd.
//
// Momentopnamen van deze instantie:
//  * van de eigen frontendsessie: beheert de bewaking zelf (herstel.js);
//  * van een eerdere sessie in hetzelfde proces (de WebView is uitgevallen en
//    opnieuw geladen): wees, wordt aangeboden.
// Momentopnamen van een andere instantie:
//  * die nog draait: blijven staan;
//  * die niet meer draait: wees, wordt aangeboden. Een nette afsluiting ruimt
//    haar eigen momentopnamen op, dus een wees betekent: crash, of eerder
//    "Later" gekozen.
// Opruimen:
//  * wezen ouder dan MAX_LEEFTIJD_MS (14 dagen) gaan weg;
//  * onvolledige mappen (geen geldig manifest of geen PDF) ouder dan een dag
//    gaan weg, tenzij een levende andere instantie de eigenaar is;
//  * staat er samen meer dan MAX_TOTAAL_BYTES, dan gaan de oudste wezen weg
//    tot het weer past.

export const MAX_LEEFTIJD_MS = 14 * 24 * 60 * 60 * 1000;
export const ONVOLLEDIG_NA_MS = 24 * 60 * 60 * 1000;
export const MAX_TOTAAL_BYTES = 2 * 1024 * 1024 * 1024;

/** Instantie-id uit de sleutel (`<pid>-<start>_<sessie>_<doc>`), voor mappen zonder manifest. */
export function instantieUitSleutel(sleutel) {
  const m = /^(\d+-\d+)_/.exec(String(sleutel || ''));
  return m ? m[1] : null;
}

export function sessieUitSleutel(sleutel) {
  const m = /^\d+-\d+_([A-Za-z0-9-]+)_/.exec(String(sleutel || ''));
  return m ? m[1] : null;
}

/** `{pid, gestartMs}` uit een instantie-id `<pid>-<start>`. */
export function procesUitId(id) {
  const m = /^(\d+)-(\d+)$/.exec(String(id || ''));
  return m ? { id, pid: Number(m[1]), gestartMs: Number(m[2]) } : null;
}

/**
 * Deel de momentopnamen in.
 * @param {Array<{sleutel:string, manifest:object|null, onvolledig:boolean, grootte:number, gewijzigdMs:number}>} items
 * @param {object} o
 * @param {{id:string, sessie:string}} o.eigen
 * @param {(instantieId:string)=>boolean} o.leeft  leeft die (andere) instantie?
 * @param {number} o.nu
 * @returns {{eigen:object[], anderLevend:object[], wees:object[], verwijderen:{sleutel:string, reden:string}[]}}
 */
export function deelIn(items, {
  eigen, leeft, nu,
  maxLeeftijd = MAX_LEEFTIJD_MS, onvolledigNa = ONVOLLEDIG_NA_MS, maxTotaal = MAX_TOTAAL_BYTES,
}) {
  const uit = { eigen: [], anderLevend: [], wees: [], verwijderen: [] };
  const eigenSessie = String(eigen?.sessie || '').slice(0, 8);
  for (const item of items || []) {
    const instantieId = item.manifest?.instantie?.id || instantieUitSleutel(item.sleutel);
    const sessie = item.manifest ? String(item.manifest.sessie || '').slice(0, 8) : sessieUitSleutel(item.sleutel);
    const vanMij = instantieId === eigen?.id;
    const eigenaarLeeft = vanMij ? true : (instantieId ? !!leeft(instantieId) : false);
    const leeftijd = nu - (item.manifest?.tijdMs || item.gewijzigdMs || nu);

    if (item.onvolledig) {
      // Een opname die net geschreven wordt heeft heel even nog geen manifest.
      if (vanMij && sessie === eigenSessie) uit.eigen.push(item);
      else if (!vanMij && eigenaarLeeft) uit.anderLevend.push(item);
      else if (nu - (item.gewijzigdMs || nu) > onvolledigNa) uit.verwijderen.push({ sleutel: item.sleutel, reden: 'onvolledig' });
      continue;
    }
    if (vanMij && sessie === eigenSessie) { uit.eigen.push(item); continue; }
    if (!vanMij && eigenaarLeeft) { uit.anderLevend.push(item); continue; }
    if (leeftijd > maxLeeftijd) { uit.verwijderen.push({ sleutel: item.sleutel, reden: 'verlopen' }); continue; }
    uit.wees.push(item);
  }
  // Totale omvang: de oudste wezen eerst weg.
  const weg = new Set(uit.verwijderen.map((v) => v.sleutel));
  let totaal = (items || []).filter((i) => !weg.has(i.sleutel)).reduce((s, i) => s + (i.grootte || 0), 0);
  if (totaal > maxTotaal) {
    const oudsteEerst = [...uit.wees].sort((a, b) => (a.manifest.tijdMs || 0) - (b.manifest.tijdMs || 0));
    for (const w of oudsteEerst) {
      if (totaal <= maxTotaal) break;
      totaal -= w.grootte || 0;
      uit.verwijderen.push({ sleutel: w.sleutel, reden: 'te-groot' });
      uit.wees = uit.wees.filter((x) => x !== w);
    }
  }
  // Nieuwste eerst aanbieden.
  uit.wees.sort((a, b) => (b.manifest.tijdMs || 0) - (a.manifest.tijdMs || 0));
  return uit;
}

/**
 * Markeringen "deze instantie draait": welke horen bij een instantie die
 * niet meer draait (= niet netjes afgesloten)? De eigen markering telt nooit,
 * die van een levende andere instantie ook niet.
 * @param {Array<{id:string, pid:number, gestartMs:number, leeft:boolean}>} markers
 * @param {{eigenId:string}} o
 */
export function beoordeelMarkers(markers, { eigenId }) {
  const uit = { onrein: [], levend: [], eigen: null };
  for (const m of markers || []) {
    if (m.id === eigenId) uit.eigen = m;
    else if (m.leeft) uit.levend.push(m);
    else uit.onrein.push(m);
  }
  return uit;
}

// ─── Eén keer vanzelf aanbieden ────────────────────────────────────────────
// Een achtergebleven document werd veertien dagen lang bij elke start
// opnieuw aangeboden. Wie "Later" koos of het venster sloot, kreeg het dus
// steeds weer te zien. Nu onthoudt de app welke documenten al zijn
// aangeboden en uitgesteld: die blijven bewaard en staan in het menu
// Bestand, maar openen het venster niet meer uit zichzelf.

/** De sleutels die het venster bij de start nog mogen openen. */
export function nogNietUitgesteld(sleutels, uitgesteld) {
  const al = new Set(Array.isArray(uitgesteld) ? uitgesteld : []);
  return (sleutels || []).filter((s) => !al.has(s));
}

/**
 * De nieuwe lijst met uitgestelde sleutels: wat er al stond plus `nieuw`,
 * zonder wat niet meer in het aanbod zit (`bestaand`).
 */
export function werkUitgesteldBij(uitgesteld, nieuw, bestaand) {
  const er = new Set(bestaand || []);
  const samen = new Set([...(Array.isArray(uitgesteld) ? uitgesteld : []), ...(nieuw || [])]);
  return [...samen].filter((s) => er.has(s));
}

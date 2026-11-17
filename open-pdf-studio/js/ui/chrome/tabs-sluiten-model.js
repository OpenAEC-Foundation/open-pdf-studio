// Alle tabbladen sluiten / andere tabbladen sluiten (#1156): de volgorde,
// zonder DOM en zonder de app.
//
// Het sluiten zelf doet de aanroeper met het bestaande pad voor één tabblad
// (closeTab, sluitTabItem): dat stelt per gewijzigd document de vraag
// Opslaan / Niet opslaan / Annuleren en bewaakt al het andere. Hier staat
// alleen WAT er dicht moet, in WELKE volgorde, en wanneer het ophoudt:
// een stap die niet sluit (geannuleerd, opslaan mislukt of afgebroken)
// stopt de rest; wat al dicht is, blijft dicht.

/** Aantal tabbladen in de tabbalk: documenttabbladen plus het vergelijkingstabblad. */
function aantalTabs({ aantalTabItems = 0, vergelijkActief = false } = {}) {
  return Math.max(0, aantalTabItems) + (vergelijkActief ? 1 : 0);
}

/** "Alles sluiten" doet iets zodra er één tabblad is. */
export function kanAllesSluiten(toestand) {
  return aantalTabs(toestand) > 0;
}

/** "Andere tabbladen sluiten" doet iets zodra er naast dit tabblad nog een is. */
export function kanAndereSluiten(toestand) {
  return aantalTabs(toestand) > 1;
}

/**
 * De stappen, in volgorde.
 *
 * Alles sluiten: de documenten in de volgorde van de tabbalk, met het actieve
 * document als laatste (zo wisselt de viewer niet bij elke stap naar een
 * document dat daarna ook dichtgaat), en dan het vergelijkingstabblad.
 *
 * Andere sluiten (`behoud` = het aangeklikte tabblad): eerst de andere
 * tabbladen van hetzelfde document (weergaven, #919; daar valt niets te
 * vragen), dan de andere documenten in de volgorde van de tabbalk, dan het
 * vergelijkingstabblad.
 *
 * @param {object} p
 * @param {object[]} p.documenten  de open documenten, in tabvolgorde
 * @param {number} p.actieveIndex
 * @param {(doc:object)=>string[]} [p.weergavenVan]  ids van de tabbladen van een document ([] bij één)
 * @param {{doc:object, weergave:string|null}|null} [p.behoud]
 * @param {boolean} [p.vergelijkActief]
 * @returns {{soort:'weergave'|'document'|'vergelijking', doc?:object, weergave?:string}[]}
 */
export function sluitPlan({ documenten = [], actieveIndex = -1, weergavenVan = () => [], behoud = null, vergelijkActief = false } = {}) {
  const plan = [];
  if (behoud) {
    if (!documenten.includes(behoud.doc)) return [];
    const weergaven = weergavenVan(behoud.doc) || [];
    // Zonder (geldige) weergave blijft de eerste staan.
    const blijft = weergaven.includes(behoud.weergave) ? behoud.weergave : weergaven[0];
    for (const id of weergaven) {
      if (id !== blijft) plan.push({ soort: 'weergave', doc: behoud.doc, weergave: id });
    }
    for (const doc of documenten) {
      if (doc !== behoud.doc) plan.push({ soort: 'document', doc });
    }
  } else {
    const actief = documenten[actieveIndex];
    for (const doc of documenten) {
      if (doc !== actief) plan.push({ soort: 'document', doc });
    }
    if (actief) plan.push({ soort: 'document', doc: actief });
  }
  if (vergelijkActief) plan.push({ soort: 'vergelijking' });
  return plan;
}

/**
 * Voer het plan uit, stap voor stap.
 *
 * @param {ReturnType<typeof sluitPlan>} plan
 * @param {object} acties
 * @param {(doc:object)=>Promise<boolean>|boolean} acties.sluitDocument  het
 *   bestaande sluiten van één document; false = bleef open
 * @param {(doc:object, weergave:string)=>Promise<boolean>|boolean} [acties.sluitWeergave]
 * @param {()=>Promise<void>|void} [acties.sluitVergelijking]
 * @param {()=>Promise<boolean>|boolean} [acties.maakActief]  vooraf: het
 *   tabblad dat blijft naar voren; false = lukte niet, dan gebeurt er niets
 * @param {()=>Promise<void>|void} [acties.naAfloop]  na de laatste stap of na
 *   een stop (het tabblad dat blijft weer naar voren)
 * @returns {Promise<{gesloten:number, gestopt:boolean, bij:object|null}>}
 *   `bij` is de stap die niet sluit en de rest tegenhield
 */
export async function voerSluitPlanUit(plan, acties = {}) {
  const uit = { gesloten: 0, gestopt: false, bij: null };
  if (acties.maakActief) {
    let ok = false;
    try { ok = (await acties.maakActief()) !== false; } catch { ok = false; }
    if (!ok) return { ...uit, gestopt: true };
  }
  for (const stap of plan || []) {
    let dicht = false;
    try {
      if (stap.soort === 'document') dicht = (await acties.sluitDocument(stap.doc)) === true;
      else if (stap.soort === 'weergave') dicht = (await acties.sluitWeergave(stap.doc, stap.weergave)) === true;
      else if (stap.soort === 'vergelijking') { await acties.sluitVergelijking?.(); dicht = true; }
    } catch {
      // Een fout bij het sluiten is geen reden om door te gaan met de rest.
      dicht = false;
    }
    if (!dicht) { uit.gestopt = true; uit.bij = stap; break; }
    uit.gesloten += 1;
  }
  try { await acties.naAfloop?.(uit); } catch { /* de uitkomst staat al vast */ }
  return uit;
}

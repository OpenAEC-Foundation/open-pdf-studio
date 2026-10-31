// De brug naar de gastpagina over postMessage (#694, onderdeel van #691).
//
// Het opslagcontract van #546 (`window.__OPDS_HOST__`, zie core/platform.js)
// moest de gastpagina tot nu toe zelf vóór de app neerzetten. In een iframe
// op een andere site kan dat alleen met een eigen script in index.html, en
// dan is de gepubliceerde bundel niet meer ongewijzigd. Daarom zet de gehoste
// bouw het contract hier zelf neer, als de pagina geopend is met
//
//   #ouder=<oorsprong van de gastpagina>&app=pdf&bestand=<id>
//
// Elk verzoek gaat dan als bericht naar de gastpagina, die zelf met de opslag
// praat: geen token, cookie of sessie komt ooit in het iframe.
//
// Het protocol volgt de werkplek van de OpenAEC SuperCloud (#704; de
// gastpagina is daar leidend):
//  - Verzoek:  { werkplek: 1, id: <getal>, soort: <tekst>, ...velden }
//  - Antwoord: { werkplek: 1, antwoord: <id>, ok: true,  waarde: … }
//              { werkplek: 1, antwoord: <id>, ok: false, fout: '<melding>'[, code] }
//  - Handdruk: elke 250 ms soort "hallo" tot de gastpagina antwoordt (die mag
//    later laden dan het iframe); na 60 s opgeven. Het antwoord mag
//    `waarde: { soorten: [...] }` meegeven: de optionele soorten die de
//    gastpagina kent. Alleen met "opslaan_als" daarin krijgt het contract
//    storage.saveAs (#726); anders blijft Opslaan als een download.
//  - Soorten:
//      open { bestand, versie? }   -> { bestand, naam, versie, alleen_lezen, bytes }
//                                     (bytes: overgedragen ArrayBuffer); met
//                                     `versie` (een volgnummer uit versies) die
//                                     versie, altijd alleen-lezen en zonder
//                                     slot (#712). Opslaan weigert dan met code
//                                     versie_alleen_lezen; een ongeldig
//                                     nummer geeft versie_ongeldig.
//      opslaan { bestand, bytes }  -> { bestand, naam, versie, conflict, melding, vergrendeld }
//      lijst { map? }              -> [{ id, name, modified, soort?, schrijfbaar? }]
//                                     soort "map" is een map (#726); zonder
//                                     `map` de map van het geopende document
//      opslaan_als { naam, map?, bytes } (optioneel, #726)
//                                  -> { bestand, naam, versie, hernoemd }
//                                     een NIEUW bestand (alleen .pdf); bestaat
//                                     de naam al, dan een kopie met een andere
//                                     naam en hernoemd: true, nooit
//                                     overschrijven. Weigeren met een `code`:
//                                     alleen_lezen, ongeldige_naam, te_groot,
//                                     quotum (of de Engelse namen uit #726).
//      versies { bestand }         -> [{ version, modified, author }]
//      geopend { bestand }         -> true (ter informatie)
//      melding { tekst, toon }     -> true (de gastpagina toont hem)
//      ai.vraag { vraag }          -> { bericht, stop, vraag_id } (OpenAI-chatvorm;
//                                     een fout heeft een `code`)
//  - Elk verzoek heeft 120 s; daarna geeft het op.
//
// Strikt op oorsprong: `ouder` alleen als scheme://host[:poort]; waar de
// browser location.ancestorOrigins kent, moet de eerste daarvan `ouder` zijn;
// alleen berichten met event.source === window.parent én
// event.origin === ouder tellen; en we sturen alleen naar `ouder`.
//
// De app vraagt de gastpagina nooit om een adres en haalt zelf niets op bij
// de host: in de werkplek staat connect-src alleen de eigen bundel toe.
//
// Een `__OPDS_HOST__` die er al staat, wint: dan doet de brug niets.
//
// Pure logica: venster en klok komen van buiten, zodat dit zonder DOM te
// testen is (host-brug.test.mjs). De koppeling met de app staat in
// core/host-brug-start.js.

export const WERKPLEK = 1;
export const HALLO_INTERVAL_MS = 250;
export const HALLO_OPGEVEN_MS = 60_000;
export const VERZOEK_TIMEOUT_MS = 120_000;

/** De tonen die de gastpagina kent voor een melding; standaard 'fout'. */
export const MELDING_TONEN = Object.freeze(['info', 'succes', 'waarschuwing', 'fout']);

/** De foutcodes van `ai.vraag` (de gastpagina en de AI-dienst erachter). */
export const AI_FOUTCODES = Object.freeze([
  'ongeldige_vraag', 'te_groot', 'geen_tegoed', 'plafond_bereikt', 'te_druk',
  'te_veel_vragen', 'al_bezig', 'opnieuw_inloggen', 'dienst_onbereikbaar',
]);

/**
 * Foutcodes van de gastpagina met een eigen, vertaalde melding (#712); de
 * `fout`-tekst van de gastpagina is de terugval.
 */
export const HOST_FOUTCODES = Object.freeze({
  versie_alleen_lezen: 'hostVersionReadOnlyRefused',
  versie_ongeldig: 'hostVersionInvalid',
});

/** De vertaalsleutel voor een fout van de gastpagina, of null. */
export function hostFoutSleutel(fout) {
  const code = fout && typeof fout === 'object' ? fout.hostCode : null;
  return typeof code === 'string' && Object.hasOwn(HOST_FOUTCODES, code) ? HOST_FOUTCODES[code] : null;
}

/**
 * De melding voor de gebruiker bij een fout van de gastpagina met een
 * bekende code: vertaald, met de tekst van de gastpagina als terugval. Null
 * als de code onbekend is.
 * @param {(sleutel: string, opties?: object) => string} t
 */
export function hostFoutMelding(fout, t) {
  const sleutel = hostFoutSleutel(fout);
  if (!sleutel) return null;
  const terugval = typeof fout?.message === 'string' && fout.message ? fout.message : sleutel;
  const tekst = t(sleutel, { defaultValue: terugval });
  return typeof tekst === 'string' && tekst && tekst !== sleutel ? tekst : terugval;
}

/**
 * Een versienummer voor `open { versie }`: een geheel getal blijft een getal
 * (ook als tekst, zoals de versielijst ze heeft); al het andere gaat zoals
 * het is, en de gastpagina weigert het met versie_ongeldig.
 */
export function versieVoorOpen(versie) {
  if (typeof versie === 'string' && /^\s*\d+\s*$/.test(versie)) return Number(versie);
  return versie;
}

/** Een fout van de brug, met een code voor de koppeling. */
export class BrugFout extends Error {
  /**
   * @param {'geen-contact'|'geweigerd'|'time-out'|'host'|'antwoord'} code
   * @param {string} bericht
   * @param {string|null} [hostCode] de `code` uit het foutantwoord van de
   *   gastpagina (bv. geen_tegoed bij ai.vraag), anders null
   */
  constructor(code, bericht, hostCode = null) {
    super(bericht);
    this.name = 'BrugFout';
    this.code = code;
    this.hostCode = hostCode;
  }
}

/**
 * Is `waarde` precies een oorsprong `scheme://host[:poort]` (http of https),
 * zonder pad, query, fragment of inloggegevens?
 */
export function isGeldigeOorsprong(waarde) {
  if (typeof waarde !== 'string' || waarde === '') return false;
  let url;
  try {
    url = new URL(waarde);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // URL normaliseert (kleine letters, standaardpoort weg, een '/' erachter):
  // alleen wat al precies de oorsprong is, telt.
  return url.origin === waarde;
}

/**
 * Lees `#ouder=…&app=pdf&bestand=…`.
 * @returns {{ ouder: string, bestand: string|null } | null} null zonder geldige ouder
 */
export function leesBrugHash(hash) {
  if (typeof hash !== 'string') return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const ouder = params.get('ouder');
  if (!isGeldigeOorsprong(ouder)) return null;
  // Een hash voor een ander gereedschap van de werkplek is niet voor ons.
  const app = params.get('app');
  if (app !== null && app !== 'pdf') return null;
  const bestand = params.get('bestand');
  return { ouder, bestand: bestand === null || bestand === '' ? null : bestand };
}

/**
 * Mag de brug in dit venster draaien, en met welke ouder?
 * @param {Window|object} venster
 * @returns {{ ouder: string, bestand: string|null } | null}
 */
export function brugGegevens(venster) {
  if (!venster) return null;
  // Buiten een iframe: gewone browsermodus.
  const ouderVenster = venster.parent;
  if (!ouderVenster || ouderVenster === venster) return null;
  const gegevens = leesBrugHash(venster.location?.hash);
  if (!gegevens) return null;
  // Waar de browser het weet: de pagina erboven moet echt `ouder` zijn.
  const voorouders = venster.location?.ancestorOrigins;
  if (voorouders && typeof voorouders.length === 'number') {
    if (voorouders.length < 1 || voorouders[0] !== gegevens.ouder) return null;
  }
  return gegevens;
}

const standaardKlok = () => ({
  setTimeout: (f, ms) => globalThis.setTimeout(f, ms),
  clearTimeout: (t) => globalThis.clearTimeout(t),
  setInterval: (f, ms) => globalThis.setInterval(f, ms),
  clearInterval: (t) => globalThis.clearInterval(t),
});

/** Een kopie van de bytes in een eigen ArrayBuffer, om over te dragen. */
function eigenBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  if (ArrayBuffer.isView(bytes)) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  throw new BrugFout('antwoord', 'Nothing to save');
}

/** De bytes uit het antwoord op `open`, of null als er geen staan. */
function bytesUit(waarde) {
  if (waarde instanceof ArrayBuffer) return new Uint8Array(waarde);
  if (ArrayBuffer.isView(waarde)) return new Uint8Array(waarde.buffer, waarde.byteOffset, waarde.byteLength);
  return null;
}

// Engels als er geen vertaling is meegegeven (zoals in de tests).
const STANDAARD_TEKSTEN = {
  hostOpenFailed: 'The file could not be read from storage. Try again.',
  hostNoContact: 'The page around Open PDF Studio does not respond, so files cannot be opened or saved. Reload the page and try again.',
  hostVersionInvalid: 'This version of the file cannot be opened: the version number is not valid.',
  hostVersionReadOnlyRefused: 'The site did not save the file: an older version of it is open read-only. Open the current version again to save, or use Save As to download a copy.',
};
const standaardTekst = (sleutel, opties) => STANDAARD_TEKSTEN[sleutel] || opties?.defaultValue || sleutel;

const tekst = (v) => (v === undefined || v === null ? undefined : String(v));

const MAP_SOORTEN = new Set(['map', 'folder', 'directory']);

/**
 * Een lijst van de gastpagina in de vorm van het contract ({ id, name,
 * modified, kind?, writable? }); `soort: "map"` wordt kind 'folder' (#726).
 */
function normaliseerLijst(waarde) {
  if (!Array.isArray(waarde)) return [];
  return waarde
    .filter((d) => d && typeof d === 'object' && d.id !== undefined && d.id !== null)
    .map((d) => {
      const item = { ...d, id: String(d.id), name: tekst(d.name ?? d.naam) };
      const soort = tekst(d.kind ?? d.soort);
      if (soort !== undefined) item.kind = MAP_SOORTEN.has(soort.toLowerCase()) ? 'folder' : 'file';
      const schrijfbaar = d.writable ?? d.schrijfbaar;
      if (typeof schrijfbaar === 'boolean') item.writable = schrijfbaar;
      return item;
    });
}

/** Het antwoord op `opslaan_als` in de vorm van het contract ({ id, name, version, renamed }). */
export function normaliseerOpslaanAlsAntwoord(waarde, gevraagd) {
  const w = waarde && typeof waarde === 'object' ? waarde : {};
  const id = w.bestand ?? w.id;
  if (id === undefined || id === null || String(id) === '') {
    throw new BrugFout('antwoord', 'The host page returned no id for the new file');
  }
  const name = tekst(w.naam ?? w.name) || String(gevraagd ?? '');
  return {
    id: String(id),
    name,
    version: w.versie ?? w.version ?? null,
    renamed: w.hernoemd === true || w.renamed === true || (!!gevraagd && name !== gevraagd),
  };
}

/** De optionele soorten uit het antwoord op hallo. */
function soortenUit(waarde) {
  const lijst = waarde && typeof waarde === 'object' ? waarde.soorten : null;
  return new Set(Array.isArray(lijst) ? lijst.filter((s) => typeof s === 'string') : []);
}

/** Versies van de gastpagina in de vorm van het contract ({ version, modified, author }). */
function normaliseerVersies(waarde) {
  if (!Array.isArray(waarde)) return [];
  return waarde
    .filter((v) => v && typeof v === 'object')
    .map((v) => ({ ...v, version: tekst(v.version ?? v.versie) }));
}

/**
 * Het antwoord op `opslaan` in een vaste vorm. `vergrendeld` blijft null als
 * de gastpagina er niets over zegt; alleen een uitdrukkelijke false betekent
 * dat het bestand niet (meer) voor ons vastgezet is.
 */
export function normaliseerOpslaan(waarde) {
  const w = waarde && typeof waarde === 'object' ? waarde : {};
  return {
    bestand: tekst(w.bestand) ?? null,
    naam: tekst(w.naam) ?? null,
    versie: w.versie === undefined || w.versie === null ? null : w.versie,
    conflict: w.conflict === true,
    melding: typeof w.melding === 'string' && w.melding.trim() ? w.melding.trim() : null,
    vergrendeld: typeof w.vergrendeld === 'boolean' ? w.vergrendeld : null,
  };
}

/**
 * Wat de gebruiker na het opslaan te horen krijgt, of null als er niets te
 * melden is. Een conflict: de gastpagina bewaarde onze versie als kopie (naam
 * erbij; volgende opslagen gaan daarheen). Een bestand dat niet voor ons
 * vastgezet is (`vergrendeld: false`): één keer per bestand, want dat blijft
 * zo. En de melding van de gastpagina zelf, ongewijzigd.
 * @param {ReturnType<typeof normaliseerOpslaan>} uitkomst
 * @param {(sleutel: string, opties?: object) => string} t
 * @param {Set<string>} [alGemeld] bestanden waarvoor `vergrendeld` al gemeld is
 */
export function opslaanMelding(uitkomst, t, alGemeld = new Set()) {
  if (!uitkomst) return null;
  const delen = [];
  if (uitkomst.conflict) delen.push(t('hostSaveConflict', { name: uitkomst.naam || '' }));
  const sleutel = uitkomst.bestand ?? '';
  if (uitkomst.vergrendeld === false && !alGemeld.has(sleutel)) {
    alGemeld.add(sleutel);
    delen.push(t('hostSaveNotLocked'));
  }
  if (uitkomst.melding) delen.push(uitkomst.melding);
  return delen.length ? delen.join('\n\n') : null;
}

/**
 * De brug zelf.
 * @param {object} o
 * @param {string} o.ouder         oorsprong van de gastpagina
 * @param {object} o.ouderVenster  window.parent
 * @param {object} o.venster       het eigen venster (voor 'message')
 * @param {object} [o.klok]        { setTimeout, clearTimeout, setInterval, clearInterval }
 * @param {Function} [o.bijGeenContact] als de handdruk opgeeft (de koppeling
 *                                toont dan een melding)
 * @param {Function} [o.bijOpslaan] met de uitkomst van elk geslaagd opslaan
 *                                (normaliseerOpslaan); de koppeling toont een
 *                                conflict of een melding
 * @param {Function} [o.vertaal]   sleutel -> tekst voor de gebruiker
 * @param {object} [o.limieten]    { halloInterval, halloOpgeven, verzoek } in ms
 */
export function maakHostBrug({
  ouder, ouderVenster, venster,
  klok = standaardKlok(), bijGeenContact = null, bijOpslaan = null, vertaal = standaardTekst, limieten = {},
}) {
  if (!isGeldigeOorsprong(ouder)) throw new Error('Invalid parent origin');
  const halloInterval = limieten.halloInterval ?? HALLO_INTERVAL_MS;
  const halloOpgeven = limieten.halloOpgeven ?? HALLO_OPGEVEN_MS;
  const verzoekTimeout = limieten.verzoek ?? VERZOEK_TIMEOUT_MS;

  let volgendId = 1;
  let soorten = new Set(); // optionele soorten van de gastpagina (uit hallo)
  const wachtend = new Map(); // id -> { klaar, mis, timer }
  const halloIds = new Set();
  let toestand = 'nieuw'; // nieuw | wacht | verbonden | opgegeven | gestopt
  let halloTimer = null;
  let opgevenTimer = null;
  let verbindingKlaar;
  let verbindingMis;
  const verbinding = new Promise((klaar, mis) => { verbindingKlaar = klaar; verbindingMis = mis; });
  // Wie niet op de verbinding wacht, krijgt geen onafgehandelde weigering.
  verbinding.catch(() => {});

  function stuur(bericht, overdracht) {
    // Alleen naar `ouder`: staat er intussen een andere pagina boven ons, dan
    // laat de browser het bericht vallen.
    if (overdracht && overdracht.length) ouderVenster.postMessage(bericht, ouder, overdracht);
    else ouderVenster.postMessage(bericht, ouder);
  }

  function stopHanddruk() {
    if (halloTimer !== null) klok.clearInterval(halloTimer);
    if (opgevenTimer !== null) klok.clearTimeout(opgevenTimer);
    halloTimer = null;
    opgevenTimer = null;
    halloIds.clear();
  }

  function zegHallo() {
    const id = volgendId++;
    halloIds.add(id);
    stuur({ werkplek: WERKPLEK, id, soort: 'hallo' });
  }

  function geefOp(fout) {
    if (toestand !== 'wacht') return;
    toestand = 'opgegeven';
    stopHanddruk();
    verbindingMis(fout);
    if (fout.code === 'geen-contact' && typeof bijGeenContact === 'function') {
      // Eén melding voor de gebruiker; wie daarna nog op de verbinding
      // wachtte (bv. het openen bij de start), toont hem niet nog eens.
      fout.gemeld = true;
      try { bijGeenContact(fout); } catch (e) { console.warn('[brug] melding mislukt:', e); }
    }
  }

  function ontvang(event) {
    // Alleen de pagina direct boven ons, op precies de oorsprong uit de hash.
    if (!event || event.source !== ouderVenster || event.origin !== ouder) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.werkplek !== WERKPLEK) return;
    const id = data.antwoord;
    if (typeof id !== 'number') return;

    if (halloIds.has(id)) {
      if (toestand !== 'wacht') return;
      if (data.ok === true) {
        toestand = 'verbonden';
        stopHanddruk();
        // Wat de gastpagina optioneel kent; pas dan bestaat de aanroep (#726).
        soorten = soortenUit(data.waarde);
        if (soorten.has('opslaan_als')) opslag.saveAs = opslaanAls;
        verbindingKlaar();
      } else {
        geefOp(new BrugFout('geweigerd', typeof data.fout === 'string' ? data.fout : 'The host refused the connection'));
      }
      return;
    }

    const verzoek = wachtend.get(id);
    if (!verzoek) return; // onbekend, al beantwoord of al opgegeven
    wachtend.delete(id);
    klok.clearTimeout(verzoek.timer);
    if (data.ok === true) verzoek.klaar(data.waarde);
    else {
      verzoek.mis(new BrugFout(
        'host',
        typeof data.fout === 'string' && data.fout ? data.fout : 'The host could not handle the request',
        typeof data.code === 'string' && data.code ? data.code : null,
      ));
    }
  }

  /** Begin de handdruk. */
  function start() {
    if (toestand !== 'nieuw') return;
    toestand = 'wacht';
    venster.addEventListener('message', ontvang);
    zegHallo();
    halloTimer = klok.setInterval(zegHallo, halloInterval);
    opgevenTimer = klok.setTimeout(() => geefOp(new BrugFout(
      'geen-contact', `No reply from the host page at ${ouder}`,
    )), halloOpgeven);
  }

  /** Alles los: luisteren stopt, lopende verzoeken geven op. */
  function stop() {
    // Bewust gestopt: wie wacht, faalt, maar zonder melding voor de gebruiker.
    if (toestand === 'wacht' || toestand === 'nieuw') verbindingMis(new BrugFout('geen-contact', 'The bridge was stopped'));
    toestand = 'gestopt';
    stopHanddruk();
    venster.removeEventListener('message', ontvang);
    for (const [id, v] of wachtend) {
      klok.clearTimeout(v.timer);
      v.mis(new BrugFout('geen-contact', 'The bridge was stopped'));
      wachtend.delete(id);
    }
  }

  /**
   * Eén verzoek aan de gastpagina; wacht eerst op de handdruk.
   * @returns {Promise<unknown>} de `waarde` uit het antwoord
   */
  async function verzoek(soort, velden = {}, overdracht = undefined) {
    await verbinding;
    if (toestand !== 'verbonden') throw new BrugFout('geen-contact', 'The bridge was stopped');
    const id = volgendId++;
    return new Promise((klaar, mis) => {
      const timer = klok.setTimeout(() => {
        if (!wachtend.has(id)) return;
        wachtend.delete(id);
        mis(new BrugFout('time-out', `The host page did not answer "${soort}" in time`));
      }, verzoekTimeout);
      wachtend.set(id, { klaar, mis, timer });
      try {
        stuur({ ...velden, werkplek: WERKPLEK, id, soort }, overdracht);
      } catch (e) {
        wachtend.delete(id);
        klok.clearTimeout(timer);
        mis(e);
      }
    });
  }

  /** Het opslagcontract van #546, over de brug. */
  const opslag = {
    /**
     * Met `versie`: die versie van het bestand, alleen-lezen en zonder slot (#712).
     * @returns {Promise<{ name: string, data: Uint8Array, versie: unknown, alleenLezen: boolean, bestand: string }>}
     */
    async open(bestand, versie = undefined) {
      try {
        const velden = { bestand: String(bestand) };
        if (versie !== undefined && versie !== null) velden.versie = versieVoorOpen(versie);
        const waarde = await verzoek('open', velden);
        const data = waarde && typeof waarde === 'object' ? bytesUit(waarde.bytes) : null;
        if (!data) throw new BrugFout('antwoord', 'The host page returned no bytes for the file');
        return {
          name: tekst(waarde.naam) || 'document.pdf',
          data,
          versie: waarde.versie ?? null,
          // Een oudere versie is altijd alleen-lezen, ook als de gastpagina
          // het veld vergeet.
          alleenLezen: waarde.alleen_lezen === true || 'versie' in velden,
          bestand: tekst(waarde.bestand) ?? String(bestand),
        };
      } catch (e) {
        // Wat de gebruiker ziet bij een mislukte open (pdf/host-document.js);
        // de technische oorzaak blijft in de melding voor de console.
        // Een fout met een bekende code (versie_ongeldig) krijgt zijn eigen
        // melding, met de tekst van de gastpagina als terugval.
        if (e && typeof e === 'object' && !e.gemeld) {
          e.gebruikersMelding = hostFoutMelding(e, vertaal) || vertaal('hostOpenFailed');
        }
        throw e;
      }
    },
    /** @returns {Promise<ReturnType<typeof normaliseerOpslaan>>} */
    async save(bestand, bytes) {
      const buffer = eigenBuffer(bytes);
      const uitkomst = normaliseerOpslaan(await verzoek('opslaan', { bestand: String(bestand), bytes: buffer }, [buffer]));
      if (typeof bijOpslaan === 'function') {
        try { bijOpslaan(uitkomst); } catch (e) { console.warn('[brug] melding na opslaan mislukt:', e); }
      }
      return uitkomst;
    },
    /** Zonder `map` de map van het geopende document; met `map` die map (#726). */
    async list(map = undefined) {
      const velden = map === undefined || map === null || map === '' ? {} : { map: String(map) };
      return normaliseerLijst(await verzoek('lijst', velden));
    },
    async versions(bestand) {
      return normaliseerVersies(await verzoek('versies', { bestand: String(bestand) }));
    },
  };

  /**
   * Een nieuw bestand op de site (#726). Alleen als de gastpagina
   * "opslaan_als" in de handdruk noemde, staat dit als storage.saveAs in het
   * contract. Een weigering draagt de `code` van de gastpagina als hostCode.
   * @returns {Promise<{ id: string, name: string, version: unknown, renamed: boolean }>}
   */
  async function opslaanAls(bytes, { name, folder } = {}) {
    const naam = String(name ?? '').trim();
    if (!naam) throw new BrugFout('antwoord', 'The new file has no name', 'ongeldige_naam');
    const buffer = eigenBuffer(bytes);
    const velden = { naam, bytes: buffer };
    if (folder !== undefined && folder !== null && folder !== '') velden.map = String(folder);
    return normaliseerOpslaanAlsAntwoord(await verzoek('opslaan_als', velden, [buffer]), naam);
  }

  /** De app meldt het document dat open staat (alleen ter informatie). */
  async function geopend(bestand) {
    await verzoek('geopend', bestand === undefined || bestand === null ? {} : { bestand: String(bestand) });
    return true;
  }

  /** Een melding in de statusbalk van de gastpagina. */
  async function melding(tekstVoorHost, toon = 'fout') {
    const t = String(tekstVoorHost ?? '').trim();
    if (!t) return false;
    await verzoek('melding', { tekst: t, toon: MELDING_TONEN.includes(toon) ? toon : 'fout' });
    return true;
  }

  /**
   * De assistent: een vraag in OpenAI-chatvorm ({ messages, tools?, model?,
   * max_tokens? }). Terug komt { bericht, stop, vraag_id }; `bericht` gaat in
   * de volgende beurt ongewijzigd mee. Een fout draagt `hostCode`.
   */
  const ai = {
    async vraag(vraag) {
      if (!vraag || typeof vraag !== 'object' || !Array.isArray(vraag.messages)) {
        throw new BrugFout('antwoord', 'The question has no messages', 'ongeldige_vraag');
      }
      const waarde = await verzoek('ai.vraag', { vraag });
      if (!waarde || typeof waarde !== 'object' || !waarde.bericht || typeof waarde.bericht !== 'object') {
        throw new BrugFout('antwoord', 'The host page returned no answer from the assistant');
      }
      return { bericht: waarde.bericht, stop: waarde.stop ?? null, vraag_id: waarde.vraag_id ?? null };
    },
  };

  return {
    ouder,
    start,
    stop,
    verzoek,
    opslag,
    geopend,
    melding,
    ai,
    /** Belofte die vervult zodra de gastpagina de handdruk beantwoordt. */
    verbinding,
    /** Kent de gastpagina deze optionele soort (uit het antwoord op hallo)? */
    kent(soort) { return soorten.has(soort); },
    get toestand() { return toestand; },
  };
}

/**
 * Zet `venster.__OPDS_HOST__` neer via de brug, als dat mag: in een iframe,
 * met een geldige `#ouder=…`, en alleen als er nog geen contract staat.
 * @returns {ReturnType<typeof maakHostBrug> | null}
 */
export function installeerHostBrug({ venster, ...opties } = {}) {
  if (!venster || venster.__OPDS_HOST__) return null;
  const gegevens = brugGegevens(venster);
  if (!gegevens) return null;
  const brug = maakHostBrug({ ...opties, ouder: gegevens.ouder, ouderVenster: venster.parent, venster });
  venster.__OPDS_HOST__ = {
    storage: brug.opslag,
    ai: brug.ai,
    geopend: brug.geopend,
    melding: brug.melding,
    ...(gegevens.bestand !== null ? { document: gegevens.bestand } : {}),
  };
  brug.start();
  return brug;
}

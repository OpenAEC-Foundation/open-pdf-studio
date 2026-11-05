// Het hostcontract van de OpenAEC SuperCloud: `window.openaecHost` (#977).
//
// Het contract (OpenAEC-Blueprint docs/supercloud-koppeling.md):
//
//   interface HostFileRef { id: string; name: string; version: string | number }
//   window.openaecHost = {
//     taal?, thema?, initialFileId?,
//     open(id, version?)  -> HostFileRef & { readOnly: boolean, bytes: ArrayBuffer | Uint8Array }
//     save(bytes, { id?, name?, expectedVersion? }) -> HostFileRef
//                          met `id` een nieuwe versie, met `name` een nieuw
//                          bestand naast het geopende (Opslaan als); een
//                          conflict geeft een kopie (een ander id)
//     list()              -> [{ id, name, modified }]
//     versions(id)        -> [{ version, modified, author? }]
//   }
//   en het event `openaec-host-ready` als het object later komt.
//
// De app zelf praat intern met het opslagcontract van #546
// (`window.__OPDS_HOST__`, core/platform.js). Deze module koppelt de twee:
//  - zet de SuperCloud `window.openaecHost` neer (vóór de start, of later met
//    het event), dan wordt dat het opslagcontract (opslagUitSiteHost): Openen,
//    Opslaan, Opslaan als en de lijst gaan erover in plaats van over een
//    download;
//  - start de app zelf de brug uit de hash (`#ouder=…&app=pdf&bestand=…`,
//    core/host-brug.js, #694), dan staat `window.openaecHost` er ook, in de
//    vorm van het contract (siteHostUitBrug), zodat de SuperCloud
//    index.html niet hoeft aan te passen;
//  - een `__OPDS_HOST__` van de gastpagina zelf wint altijd.
//
// Pure logica (venster van buiten), te testen zonder DOM (site-host.test.mjs).

export const HOST_KLAAR_EVENT = 'openaec-host-ready';

/** Is dit een `openaecHost` waarmee de app kan openen en opslaan? */
export function isSiteHost(host) {
  return !!host && typeof host === 'object' && typeof host.open === 'function' && typeof host.save === 'function';
}

const tekst = (v) => (v === undefined || v === null ? null : String(v));

function bytesUit(waarde) {
  if (waarde instanceof Uint8Array) return waarde;
  if (waarde instanceof ArrayBuffer) return new Uint8Array(waarde);
  if (ArrayBuffer.isView(waarde)) return new Uint8Array(waarde.buffer, waarde.byteOffset, waarde.byteLength);
  return null;
}

/** De `code` van de host ook als `hostCode`, zoals de meldingen van de app hem lezen. */
function metHostCode(fout) {
  if (fout && typeof fout === 'object' && typeof fout.code === 'string' && fout.hostCode === undefined) {
    try { fout.hostCode = fout.code; } catch { /* bevroren fout: dan zonder */ }
  }
  return fout;
}

/**
 * Het opslagcontract van de app (`__OPDS_HOST__`) uit `window.openaecHost`.
 * Opslaan geeft het laatst bekende versienummer mee als `expectedVersion`;
 * geeft de host een ander id terug (een conflict: een kopie), dan gaan de
 * volgende opslagen naar die kopie en hoort de gebruiker de naam ervan
 * (`bijOpslaan`, dezelfde vorm als normaliseerOpslaan in core/host-brug.js).
 * @param {object} host
 * @param {{ bijOpslaan?: (uitkomst: object) => void }} [opties]
 */
export function opslagUitSiteHost(host, { bijOpslaan = null } = {}) {
  if (!isSiteHost(host)) throw new TypeError('openaecHost has no open/save');
  const versies = new Map(); // id -> laatst bekende versie
  const kopieVan = new Map(); // id -> id van de kopie na een conflict

  function huidigId(id) {
    let x = String(id);
    const gezien = new Set();
    while (kopieVan.has(x) && !gezien.has(x)) {
      gezien.add(x);
      x = kopieVan.get(x);
    }
    return x;
  }

  const storage = {
    async open(id, versie = undefined) {
      const metVersie = versie !== undefined && versie !== null;
      let ref;
      try {
        ref = metVersie ? await host.open(String(id), versie) : await host.open(String(id));
      } catch (e) {
        throw metHostCode(e);
      }
      const data = bytesUit(ref?.bytes ?? ref?.data);
      if (!data) throw new Error('The site returned no bytes for the file');
      const bestand = tekst(ref?.id) ?? String(id);
      const version = ref?.version ?? null;
      // Alleen de huidige versie telt als basis voor de volgende opslag.
      if (!metVersie && version !== null) versies.set(bestand, version);
      return {
        name: tekst(ref?.name) || 'document.pdf',
        data,
        versie: version,
        alleenLezen: metVersie || ref?.readOnly === true,
        bestand,
      };
    },

    async save(id, bytes) {
      const doel = huidigId(id);
      const opties = { id: doel };
      if (versies.has(doel)) opties.expectedVersion = versies.get(doel);
      let ref;
      try {
        ref = await host.save(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), opties);
      } catch (e) {
        throw metHostCode(e);
      }
      const nieuw = tekst(ref?.id) ?? doel;
      const conflict = nieuw !== doel;
      if (conflict) {
        kopieVan.set(doel, nieuw);
        if (String(id) !== doel) kopieVan.set(String(id), nieuw);
      }
      if (ref?.version !== undefined && ref?.version !== null) versies.set(nieuw, ref.version);
      const uitkomst = {
        bestand: nieuw,
        naam: tekst(ref?.name),
        versie: ref?.version ?? null,
        conflict,
        melding: null,
        vergrendeld: null,
      };
      if (typeof bijOpslaan === 'function') {
        try { bijOpslaan(uitkomst); } catch (e) { console.warn('[site] melding na opslaan mislukt:', e); }
      }
      return uitkomst;
    },

    /** De bestanden van deze tool in dezelfde map; het contract kent geen mappen. */
    async list(map = undefined) {
      if (map !== undefined && map !== null && map !== '') return [];
      if (typeof host.list !== 'function') return [];
      const lijst = await host.list();
      return (Array.isArray(lijst) ? lijst : [])
        .filter((d) => d && typeof d === 'object' && d.id !== undefined && d.id !== null)
        .map((d) => ({ ...d, id: String(d.id), name: tekst(d.name) ?? '', kind: 'file' }));
    },

    async versions(id) {
      if (typeof host.versions !== 'function') return [];
      const lijst = await host.versions(String(huidigId(id)));
      return Array.isArray(lijst) ? lijst.filter((v) => v && typeof v === 'object') : [];
    },

    /** Opslaan als: `save(bytes, { name })`, een nieuw bestand naast het geopende. */
    async saveAs(bytes, { name } = {}) {
      const naam = String(name ?? '').trim();
      if (!naam) throw Object.assign(new Error('The new file has no name'), { code: 'invalid_name' });
      let ref;
      try {
        ref = await host.save(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { name: naam });
      } catch (e) {
        throw metHostCode(e);
      }
      const id = tekst(ref?.id);
      if (!id) throw Object.assign(new Error('The site returned no id for the new file'), { code: 'invalid_response' });
      if (ref?.version !== undefined && ref?.version !== null) versies.set(id, ref.version);
      const definitief = tekst(ref?.name) || naam;
      return { id, name: definitief, version: ref?.version ?? null, renamed: definitief !== naam };
    },
  };

  const contract = { storage };
  const begin = tekst(host.initialFileId);
  if (begin) contract.document = begin;
  return contract;
}

/** Optionele `taal` en `thema` uit de hash van de brug. */
export function voorkeurenUitHash(hash) {
  if (typeof hash !== 'string') return {};
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const uit = {};
  const taal = params.get('taal');
  const thema = params.get('thema');
  if (taal && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(taal)) uit.taal = taal;
  if (thema === 'light' || thema === 'dark') uit.thema = thema;
  return uit;
}

/**
 * `window.openaecHost` in de vorm van het contract, op de brug uit de hash
 * (core/host-brug.js): dezelfde verzoeken aan de gastpagina als de app zelf doet.
 * @param {ReturnType<import('./host-brug.js').maakHostBrug>} brug
 * @param {{ bestand?: string|null, taal?: string, thema?: string }} [extra]
 */
export function siteHostUitBrug(brug, { bestand = null, taal, thema } = {}) {
  const opslag = brug.opslag;
  const host = {
    async open(id, version = undefined) {
      const r = version === undefined || version === null ? await opslag.open(id) : await opslag.open(id, version);
      return { id: r.bestand, name: r.name, version: r.versie, readOnly: r.alleenLezen, bytes: r.data };
    },
    async save(bytes, { id, name } = {}) {
      if (id !== undefined && id !== null && id !== '') {
        const u = await opslag.save(String(id), bytes);
        return { id: u.bestand ?? String(id), name: u.naam ?? (name ? String(name) : ''), version: u.versie };
      }
      if (name) {
        // Pas na de handdruk, en alleen als de gastpagina opslaan_als kent.
        if (typeof opslag.saveAs !== 'function') {
          throw Object.assign(new Error('The site cannot save new files'), { code: 'niet_ondersteund' });
        }
        const u = await opslag.saveAs(bytes, { name: String(name) });
        return { id: u.id, name: u.name, version: u.version };
      }
      throw Object.assign(new Error('save needs an id or a name'), { code: 'ongeldige_argumenten' });
    },
    async list() {
      const lijst = await opslag.list();
      return lijst
        .filter((d) => d.kind !== 'folder')
        .map((d) => ({ id: d.id, name: d.name ?? '', modified: d.modified ?? '' }));
    },
    async versions(id) {
      return opslag.versions(id);
    },
  };
  if (bestand) host.initialFileId = String(bestand);
  if (taal) host.taal = taal;
  if (thema) host.thema = thema;
  return host;
}

/**
 * Kies en koppel het hostcontract bij de start.
 * @param {object} o
 * @param {object} o.venster
 * @param {() => object|null} o.installeerBrug  start de brug uit de hash
 *   (installeerHostBrug); geeft de brug of null
 * @param {(uitkomst: object) => void} [o.bijOpslaan] na elke opslag via openaecHost
 * @param {() => void} [o.bijLaat] als `openaecHost` pas na de start kwam (het
 *   event): de app opent dan het document van de host
 * @returns {{ soort: 'gast'|'site'|'brug'|'wacht'|null, brug?: object }}
 */
export function koppelHost({ venster, installeerBrug, bijOpslaan = null, bijLaat = null }) {
  if (!venster) return { soort: null };
  // Een contract van de gastpagina zelf wint.
  if (venster.__OPDS_HOST__) return { soort: 'gast' };
  // De SuperCloud zette het contract vóór de start neer.
  if (isSiteHost(venster.openaecHost)) {
    venster.__OPDS_HOST__ = opslagUitSiteHost(venster.openaecHost, { bijOpslaan });
    return { soort: 'site' };
  }
  // De app zet het zelf neer uit de hash.
  const brug = typeof installeerBrug === 'function' ? installeerBrug() : null;
  if (brug) {
    if (!venster.openaecHost) {
      venster.openaecHost = siteHostUitBrug(brug, {
        bestand: venster.__OPDS_HOST__?.document ?? null,
        ...voorkeurenUitHash(venster.location?.hash),
      });
    }
    return { soort: 'brug', brug };
  }
  // Anders: misschien komt het contract nog (`openaec-host-ready`).
  if (typeof venster.addEventListener === 'function') {
    const luister = () => {
      if (venster.__OPDS_HOST__ || !isSiteHost(venster.openaecHost)) return;
      venster.removeEventListener?.(HOST_KLAAR_EVENT, luister);
      venster.__OPDS_HOST__ = opslagUitSiteHost(venster.openaecHost, { bijOpslaan });
      if (typeof bijLaat === 'function') {
        try { bijLaat(); } catch (e) { console.warn('[site] openen na openaec-host-ready mislukt:', e); }
      }
    };
    venster.addEventListener(HOST_KLAAR_EVENT, luister);
    return { soort: 'wacht' };
  }
  return { soort: null };
}

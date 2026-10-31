// "Opslaan als" in de opslag van de gastsite (#726).
//
// Het opslagcontract (core/platform.js) kent sinds #726 een optionele aanroep
//
//   storage.saveAs(bytes, { name, folder? })
//     -> Promise<{ id, name, version, renamed? }>
//
//  - `folder` is een id uit storage.list(); weggelaten = de map van het
//    geopende document.
//  - De site bepaalt de definitieve naam: bestaat de naam al, dan maakt hij
//    een kopie ("plan (2).pdf") en meldt `renamed: true`; nooit overschrijven.
//  - Een fout is een geweigerde belofte met een `code` (read_only,
//    invalid_name, too_large, quota_exceeded, …), zodat de app een eigen
//    melding toont. Over de brug van de werkplek heet dat veld `hostCode`.
//  - Alleen .pdf; een naam met stuur- of richtingstekens weigert de site.
//
// En storage.list(folder?) mag mappen geven: [{ id, name, kind: 'folder',
// writable? }] naast de bestanden. Zonder `folder` de map van het geopende
// document.
//
// Kent de site geen saveAs, dan blijft alles zoals het was: een download.
//
// Hier staat alleen pure logica (namen, mappen, fouten, antwoorden), zonder
// DOM of vertalingen, zodat het zonder browser te testen is
// (host-opslaan-als.test.mjs).

/**
 * @typedef {object} HostOpslaanAlsOpties
 * @property {string} name     de gewenste bestandsnaam, eindigt op .pdf
 * @property {string} [folder] een map-id uit storage.list(); weg = de map van
 *                             het geopende document
 */

/**
 * @typedef {object} HostOpslaanAlsUitkomst
 * @property {string} id       het id van het nieuwe bestand op de site
 * @property {string} name     de naam die de site gaf (kan afwijken)
 * @property {number|string|null} version
 * @property {boolean} renamed true als de site een andere naam koos
 */

/**
 * @typedef {object} HostMapItem
 * @property {string} id
 * @property {string} name
 * @property {'folder'|'file'} kind
 * @property {boolean|null} writable null: de site zegt er niets over
 */

// Stuurtekens (C0, DEL, C1) en tekens voor de schrijfrichting: die weigert de
// site, dus de app weigert ze al bij het typen.
// eslint-disable-next-line no-control-regex
const VERBODEN_TEKENS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
// Een scheidingsteken van een pad hoort niet in een naam.
const PAD_TEKENS = /[\\/]/;

const tekst = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * Een naam voor de site: getrimd, met .pdf erachter als die ontbreekt.
 * @returns {{ naam: string, fout: null | 'leeg' | 'tekens' }}
 */
export function controleerNaam(invoer) {
  const kaal = tekst(invoer).trim();
  if (!kaal || /^\.pdf$/i.test(kaal) || /^\.+$/.test(kaal)) return { naam: '', fout: 'leeg' };
  if (VERBODEN_TEKENS.test(kaal) || PAD_TEKENS.test(kaal)) return { naam: kaal, fout: 'tekens' };
  return { naam: /\.pdf$/i.test(kaal) ? kaal : `${kaal}.pdf`, fout: null };
}

/** De naam zonder .pdf. */
export function basisNaam(naam) {
  return tekst(naam).trim().replace(/\.pdf$/i, '');
}

/**
 * De voorgestelde naam voor Opslaan als: "<naam> (copy).pdf". `opmaak` maakt
 * van de basisnaam de vertaalde kopienaam (standaard "<naam> (copy)").
 */
export function kopieNaam(naam, opmaak = (b) => `${b} (copy)`) {
  const basis = basisNaam(naam) || 'document';
  const nieuw = tekst(opmaak(basis)).trim() || `${basis} (copy)`;
  return controleerNaam(nieuw).naam || `${basis} (copy).pdf`;
}

/**
 * Het antwoord van saveAs in de vorm van het contract. Accepteert ook de
 * velden van de brug (bestand, naam, versie, hernoemd).
 * @param {unknown} waarde
 * @param {string} gevraagd de naam die de app vroeg
 * @returns {HostOpslaanAlsUitkomst}
 */
export function normaliseerOpslaanAls(waarde, gevraagd) {
  const w = waarde && typeof waarde === 'object' ? waarde : {};
  const id = w.id ?? w.bestand;
  if (id === undefined || id === null || String(id) === '') {
    throw Object.assign(new Error('The site returned no id for the new file'), { code: 'invalid_response' });
  }
  const name = tekst(w.name ?? w.naam).trim() || tekst(gevraagd);
  const version = w.version ?? w.versie ?? null;
  // De site meldt het; een andere naam zonder melding telt ook.
  const renamed = w.renamed === true || w.hernoemd === true || (!!gevraagd && name !== gevraagd);
  return { id: String(id), name, version, renamed };
}

/**
 * Een lijst van de site als mappen en bestanden. Een item is een map als het
 * `kind`/`type`/`soort` 'folder'/'map'/'directory' zegt, of `folder: true`.
 * @returns {HostMapItem[]} mappen eerst, dan bestanden, elk op naam
 */
export function normaliseerMapLijst(lijst) {
  if (!Array.isArray(lijst)) return [];
  const isMap = (d) => {
    const soort = tekst(d.kind ?? d.type ?? d.soort).toLowerCase();
    return d.folder === true || d.isFolder === true || ['folder', 'map', 'directory', 'dir'].includes(soort);
  };
  const schrijfbaar = (d) => {
    const w = d.writable ?? d.schrijfbaar;
    if (typeof w === 'boolean') return w;
    if (d.readOnly === true || d.alleen_lezen === true || d.alleenLezen === true) return false;
    return null;
  };
  const items = lijst
    .filter((d) => d && typeof d === 'object' && d.id !== undefined && d.id !== null && String(d.id) !== '')
    .map((d) => ({
      id: String(d.id),
      name: tekst(d.name ?? d.naam).trim() || String(d.id),
      kind: isMap(d) ? 'folder' : 'file',
      writable: schrijfbaar(d),
    }));
  const opNaam = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  return [
    ...items.filter((i) => i.kind === 'folder').sort(opNaam),
    ...items.filter((i) => i.kind === 'file').sort(opNaam),
  ];
}

// Foutcodes van de site (Engels uit het voorstel, Nederlands van de werkplek)
// naar een soort met een eigen melding.
const CODES = {
  alleen_lezen: ['read_only', 'readonly', 'forbidden', 'permission_denied', 'no_permission', 'not_allowed',
    'alleen_lezen', 'geen_rechten', 'geen_schrijfrechten', 'geweigerd', 'niet_toegestaan'],
  ongeldige_naam: ['invalid_name', 'bad_name', 'ongeldige_naam', 'naam_ongeldig', 'invalid_type', 'alleen_pdf'],
  te_groot: ['too_large', 'payload_too_large', 'file_too_large', 'te_groot'],
  quotum: ['quota', 'quota_exceeded', 'storage_full', 'insufficient_storage', 'no_space',
    'quotum', 'quotum_bereikt', 'geen_ruimte', 'opslag_vol'],
  netwerk: ['network', 'network_error', 'offline', 'timeout', 'unavailable',
    'netwerk', 'dienst_onbereikbaar', 'time-out', 'geen-contact'],
  niet_ondersteund: ['unsupported', 'not_supported', 'unknown_request', 'onbekende_soort', 'niet_ondersteund'],
};
const CODE_NAAR_SOORT = new Map(Object.entries(CODES).flatMap(([soort, codes]) => codes.map((c) => [c, soort])));

/**
 * De soort van een fout van saveAs.
 * @returns {'alleen_lezen'|'ongeldige_naam'|'te_groot'|'quotum'|'netwerk'|'niet_ondersteund'|'onbekend'}
 */
export function foutSoort(fout) {
  if (!fout || typeof fout !== 'object') return 'onbekend';
  // Eerst de code van de site, dan die van de brug (time-out, geen-contact).
  for (const veld of ['hostCode', 'code']) {
    const code = typeof fout[veld] === 'string' ? fout[veld].trim().toLowerCase() : '';
    if (code && CODE_NAAR_SOORT.has(code)) return CODE_NAAR_SOORT.get(code);
  }
  // Een site met HTTP-codes.
  const status = Number(fout.status ?? fout.statusCode);
  if (status === 401 || status === 403) return 'alleen_lezen';
  if (status === 413) return 'te_groot';
  if (status === 507) return 'quotum';
  // fetch() faalt met een TypeError als het netwerk weg is.
  if (fout.name === 'TypeError' && /fetch|network/i.test(tekst(fout.message))) return 'netwerk';
  if (fout.name === 'AbortError') return 'netwerk';
  return 'onbekend';
}

/** De vertaalsleutel (common:hostSaveAs.*) per soort. */
export const FOUT_SLEUTELS = Object.freeze({
  alleen_lezen: 'hostSaveAs.errorReadOnly',
  ongeldige_naam: 'hostSaveAs.errorInvalidName',
  te_groot: 'hostSaveAs.errorTooLarge',
  quotum: 'hostSaveAs.errorQuota',
  netwerk: 'hostSaveAs.errorNetwork',
  niet_ondersteund: 'hostSaveAs.errorUnsupported',
  onbekend: 'hostSaveAs.errorFailed',
});

/**
 * De melding voor de gebruiker bij een mislukte saveAs.
 * @param {(sleutel: string, opties?: object) => string} t
 */
export function foutMelding(fout, t) {
  const soort = foutSoort(fout);
  const melding = typeof fout?.message === 'string' && fout.message.trim() ? fout.message.trim() : String(fout ?? '');
  return t(FOUT_SLEUTELS[soort], { error: melding });
}

/** Vragen de filters van een opslaandialoog om een PDF (of zijn er geen)? */
export function filtersZijnPdf(filters) {
  if (filters === undefined || filters === null) return true;
  if (!Array.isArray(filters) || !filters.length) return false;
  return filters.every((f) => Array.isArray(f?.extensions) && f.extensions.length > 0
    && f.extensions.every((e) => String(e).toLowerCase().replace(/^\./, '') === 'pdf'));
}

/**
 * Wat de gebruiker na een geslaagde saveAs hoort: waar het bestand staat, en
 * als de site een andere naam koos, dat er niets overschreven is.
 * @param {(sleutel: string, opties?: object) => string} t
 */
export function opgeslagenMelding(uitkomst, t) {
  const name = tekst(uitkomst?.name);
  return uitkomst?.renamed ? t('hostSaveAs.renamed', { name }) : t('hostSaveAs.saved', { name });
}

// Extensiecatalogus (#969): één gedeelde lijst `extensions.json` in de
// repository van het project, waar auteurs hun extensie met een pull request
// aan toevoegen. Elke regel wijst naar de eigen repository van de auteur (de
// `.oppx` van de nieuwste GitHub-release wordt geïnstalleerd) of naar een vaste
// pakketlink met versie en SHA-256. Gebruikers kunnen eigen catalogi toevoegen
// (bijvoorbeeld een bedrijfscatalogus) en elke extensie via een link
// installeren ("eigen link"); die is niet beoordeeld.
//
// Deze module is zuiver: geen Tauri, geen app-state. Ophalen, installeren en
// voorkeuren bewaren komen binnen via `maakCatalogusDienst({...})`; de app
// koppelt ze in extension-catalog-app.js. Zo zijn ontleden, controleren,
// versievergelijking en bronnenadministratie in Node te testen.
//
// Het formaat staat ook als JSON-schema in /extensions.schema.json (voor
// editors); de controle hier is de maatstaf, ook voor de CI-test van
// /extensions.json.

/** De catalogus van het project: het bestand op de main-tak van deze repository. */
export const STANDAARD_CATALOGUS = 'https://raw.githubusercontent.com/OpenAEC-Foundation/open-pdf-studio/main/extensions.json';
/** Waar auteurs zien hoe ze hun extensie aanmelden. */
export const CATALOGUS_PAGINA = 'https://github.com/OpenAEC-Foundation/open-pdf-studio/blob/main/extensions.json';

export const CATALOGUS_FORMAAT = 1;
export const MAX_BESCHRIJVING = 400;
export const MAX_TAGS = 8;
const MAX_NAAM = 80;
const MAX_AUTEUR = 80;
const MAX_TAG = 32;
const MAX_VERSIE = 64;
const MAX_URL = 2048;
const MAX_ITEMS = 1000;

// Gelijk aan is_strikt_id in src-tauri/src/extensie_installatie.rs: segmenten
// gescheiden door '.', elk begint en eindigt met een kleine letter of cijfer.
const ID = /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/;
const PAKKET = /^https:\/\/[^\s?#]+\.oppx(?:\?[^\s#]*)?$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const VELDEN = new Set(['id', 'name', 'description', 'author', 'repo', 'package', 'version', 'sha256', 'homepage', 'tags']);

export const isExtensieId = (id) => typeof id === 'string' && ID.test(id);

/** Een https-adres zonder spaties; geen http, geen file:, geen javascript:. */
export function isHttpsUrl(v) {
  if (typeof v !== 'string' || v.length > MAX_URL || /\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** `https://github.com/eigenaar/repo` → { eigenaar, repo }, anders null. */
export function githubRepo(link) {
  const m = GITHUB_REPO.exec(String(link ?? '').trim());
  if (!m || m[2] === '.' || m[2] === '..') return null;
  return { eigenaar: m[1], repo: m[2] };
}

export const isPakketLink = (link) => isHttpsUrl(String(link ?? '').trim()) && PAKKET.test(String(link).trim());

const normaleVersie = (v) => String(v ?? '').trim().replace(/^v(?=\d)/i, '');

// ─── Catalogus controleren ──────────────────────────────────────────────

/**
 * Controleer één catalogusregel. Geeft { item, fouten }: `item` is de
 * genormaliseerde regel, of null als er een fout is.
 */
export function controleerItem(e, plek = 'entry') {
  const fouten = [];
  const fout = (tekst) => fouten.push(`${plek}: ${tekst}`);
  if (!e || typeof e !== 'object' || Array.isArray(e)) {
    fout('must be an object');
    return { item: null, fouten };
  }
  for (const k of Object.keys(e)) if (!VELDEN.has(k)) fout(`unknown field "${k}"`);

  if (!isExtensieId(e.id)) fout('"id" must be a valid extension id (lowercase letters, digits, "-" and ".", 1-64 characters), equal to the id in plugin.json');
  const tekst = (veld, max) => {
    const v = e[veld];
    if (typeof v !== 'string' || !v.trim()) fout(`"${veld}" is required`);
    else if (v.length > max) fout(`"${veld}" is longer than ${max} characters`);
  };
  tekst('name', MAX_NAAM);
  tekst('description', MAX_BESCHRIJVING);
  tekst('author', MAX_AUTEUR);

  const heeftRepo = e.repo !== undefined;
  const heeftPakket = e.package !== undefined;
  if (!heeftRepo && !heeftPakket) fout('either "repo" or "package" is required');
  if (heeftRepo && !githubRepo(e.repo)) fout('"repo" must be a GitHub repository link (https://github.com/owner/repo)');
  if (heeftPakket && !isPakketLink(e.package)) fout('"package" must be an https:// link to a .oppx file');
  if (heeftPakket) {
    if (e.version === undefined) fout('"version" is required with "package"');
  }
  if (e.version !== undefined) {
    if (typeof e.version !== 'string' || !e.version.trim() || e.version.length > MAX_VERSIE || vergelijkVersies(e.version, e.version) === null) {
      fout('"version" must be a version like 1.2.0');
    }
  }
  if (e.sha256 !== undefined && (typeof e.sha256 !== 'string' || !SHA256.test(e.sha256))) fout('"sha256" must be 64 hexadecimal characters');
  if (e.sha256 !== undefined && !heeftPakket) fout('"sha256" only applies to a fixed "package" link');
  if (e.homepage !== undefined && !isHttpsUrl(e.homepage)) fout('"homepage" must be an https:// link');
  if (e.tags !== undefined) {
    if (!Array.isArray(e.tags)) fout('"tags" must be a list');
    else {
      if (e.tags.length > MAX_TAGS) fout(`at most ${MAX_TAGS} tags`);
      for (const t of e.tags) {
        if (typeof t !== 'string' || !t.trim() || t.length > MAX_TAG) fout(`each tag must be a text of 1-${MAX_TAG} characters`);
      }
    }
  }
  if (fouten.length) return { item: null, fouten };

  const repo = heeftRepo ? e.repo.trim().replace(/\.git$|\/$/g, '') : '';
  return {
    item: {
      id: e.id,
      name: e.name.trim(),
      description: e.description.trim(),
      author: e.author.trim(),
      repo,
      package: heeftPakket ? e.package.trim() : '',
      version: e.version !== undefined ? normaleVersie(e.version) : '',
      sha256: e.sha256 ? e.sha256.toLowerCase() : '',
      homepage: (e.homepage ?? '').trim() || repo,
      tags: [...new Set((e.tags ?? []).map((t) => t.trim()))],
    },
    fouten,
  };
}

/**
 * Controleer een hele catalogus (het geparste JSON-object). `items` bevat de
 * goede regels, `fouten` alles wat niet klopt; `ok` alleen als er geen enkele
 * fout is (de CI-test eist dat voor /extensions.json).
 */
export function controleerCatalogus(data) {
  const fouten = [];
  const items = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, items, fouten: ['the catalogue must be a JSON object'] };
  }
  for (const k of Object.keys(data)) {
    if (k !== 'version' && k !== 'extensions' && k !== '$schema') fouten.push(`unknown top-level field "${k}"`);
  }
  if (data.version !== CATALOGUS_FORMAAT) fouten.push(`"version" must be ${CATALOGUS_FORMAAT}`);
  if (!Array.isArray(data.extensions)) {
    fouten.push('"extensions" must be a list');
    return { ok: false, items, fouten };
  }
  if (data.extensions.length > MAX_ITEMS) fouten.push(`at most ${MAX_ITEMS} extensions`);
  const gezien = new Set();
  data.extensions.slice(0, MAX_ITEMS).forEach((e, i) => {
    const plek = `extensions[${i}]${e && typeof e.id === 'string' ? ` (${e.id})` : ''}`;
    const r = controleerItem(e, plek);
    fouten.push(...r.fouten);
    if (!r.item) return;
    if (gezien.has(r.item.id)) {
      fouten.push(`${plek}: duplicate id "${r.item.id}"`);
      return;
    }
    gezien.add(r.item.id);
    items.push(r.item);
  });
  return { ok: fouten.length === 0, items, fouten };
}

/** Catalogustekst ontleden; een kapotte regel valt weg, de rest blijft. */
export function leesCatalogus(tekst, url = '') {
  let data;
  try {
    data = JSON.parse(String(tekst ?? '').replace(/^﻿/, ''));
  } catch (e) {
    return { items: [], fouten: [`not valid JSON: ${e.message}`] };
  }
  const r = controleerCatalogus(data);
  return { items: r.items.map((i) => ({ ...i, catalogus: url })), fouten: r.fouten };
}

// ─── Versies ────────────────────────────────────────────────────────────

function ontleedVersie(v) {
  const s = normaleVersie(v);
  if (!s || s.length > MAX_VERSIE) return null;
  const zonderBuild = s.split('+')[0];
  const streep = zonderBuild.indexOf('-');
  const kern = streep < 0 ? zonderBuild : zonderBuild.slice(0, streep);
  const pre = streep < 0 ? null : zonderBuild.slice(streep + 1);
  const delen = kern.split('.');
  if (delen.length < 1 || delen.length > 4 || delen.some((d) => !/^\d{1,15}$/.test(d))) return null;
  const getallen = delen.map(Number);
  while (getallen.length < 3) getallen.push(0);
  if (pre !== null && !/^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/.test(pre)) return null;
  return { getallen, pre: pre === null ? null : pre.split('.') };
}

/**
 * Vergelijk twee versies (semver-volgorde, een voorloop-`v` mag, ontbrekende
 * delen tellen als 0: `v1.2` = `1.2.0`). -1, 0 of 1; null als een van de twee
 * geen versie is.
 */
export function vergelijkVersies(a, b) {
  const x = ontleedVersie(a);
  const y = ontleedVersie(b);
  if (!x || !y) return null;
  const n = Math.max(x.getallen.length, y.getallen.length);
  for (let i = 0; i < n; i++) {
    const d = (x.getallen[i] ?? 0) - (y.getallen[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    let c;
    if (pn && qn) c = Number(p) - Number(q);
    else if (pn) c = -1;
    else if (qn) c = 1;
    else c = p < q ? -1 : p > q ? 1 : 0;
    if (c) return Math.sign(c);
  }
  return Math.sign(x.pre.length - y.pre.length);
}

/** Is `beschikbaar` nieuwer dan `geinstalleerd`? Onleesbaar = nee. */
export const isNieuwer = (beschikbaar, geinstalleerd) => vergelijkVersies(beschikbaar, geinstalleerd) === 1;

// ─── Links en GitHub-releases ───────────────────────────────────────────

/**
 * Wat er achter een link zit: een vaste `.oppx` (soort 'pakket') of een
 * GitHub-repository (soort 'github', met het API-adres van de nieuwste
 * release). Gooit bij iets anders, ook bij http://.
 */
export function ontleedLink(link) {
  const l = String(link ?? '').trim();
  if (/^http:\/\//i.test(l)) throw new Error('Only https:// links are allowed');
  if (isPakketLink(l)) return { soort: 'pakket', url: l };
  const g = githubRepo(l);
  if (g) {
    return {
      soort: 'github', ...g,
      api: `https://api.github.com/repos/${g.eigenaar}/${g.repo}/releases/latest`,
    };
  }
  throw new Error('Use a GitHub repository link (https://github.com/owner/repo) or an https:// link to a .oppx file');
}

/**
 * Kies uit de JSON van een GitHub-release de `.oppx` om te installeren: bij
 * meer dan één de `<id>.oppx` als het id bekend is. `sha256` is de digest die
 * GitHub voor het bestand opgeeft (als die er is).
 */
export function kiesReleasePakket(release, verwachtId = '', naam = '') {
  if (!release || typeof release !== 'object') throw new Error('Unexpected answer from GitHub');
  const pakketten = (Array.isArray(release.assets) ? release.assets : [])
    .filter((a) => a && /\.oppx$/i.test(a.name || '') && isHttpsUrl(a.browser_download_url));
  if (!pakketten.length) throw new Error(`The latest release${naam ? ` of ${naam}` : ''} has no .oppx file`);
  const pakket = (verwachtId && pakketten.find((a) => a.name.toLowerCase() === `${verwachtId}.oppx`)) || pakketten[0];
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(pakket.digest || '')?.[1]?.toLowerCase() || '';
  const versie = normaleVersie(release.tag_name);
  return {
    url: pakket.browser_download_url,
    version: vergelijkVersies(versie, versie) === null ? '' : versie,
    sha256: digest,
  };
}

// ─── Catalogi en bronnen in de voorkeuren ───────────────────────────────

/** De catalogi in gebruik: de standaard plus de eigen (alleen https, uniek). */
export function catalogiUit(voorkeuren) {
  const eigen = Array.isArray(voorkeuren?.extensionCatalogs) ? voorkeuren.extensionCatalogs : [];
  const lijst = [STANDAARD_CATALOGUS];
  for (const u of eigen) {
    const s = typeof u === 'string' ? u.trim() : '';
    if (isHttpsUrl(s) && !lijst.includes(s)) lijst.push(s);
  }
  return lijst;
}

/** Nieuwe eigen-catalogi-lijst met `url` erbij; gooit bij een ongeldige link. */
export function metCatalogus(voorkeuren, url) {
  const u = String(url ?? '').trim();
  if (!isHttpsUrl(u)) throw new Error('A catalogue link must be an https:// link');
  const eigen = catalogiUit(voorkeuren).slice(1);
  if (u === STANDAARD_CATALOGUS || eigen.includes(u)) return eigen;
  return [...eigen, u];
}

/** Nieuwe eigen-catalogi-lijst zonder `url`; de standaard blijft altijd. */
export function zonderCatalogus(voorkeuren, url) {
  return catalogiUit(voorkeuren).slice(1).filter((u) => u !== url);
}

/**
 * Waar elke extensie vandaan komt: { id: { soort: 'catalog'|'custom', link,
 * catalogus, version, sha256 } }. Kapotte regels vallen weg.
 */
export function bronnenUit(voorkeuren) {
  const ruw = voorkeuren?.extensionSources;
  const uit = {};
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) return uit;
  for (const [id, b] of Object.entries(ruw)) {
    if (!isExtensieId(id) || !b || typeof b !== 'object' || typeof b.link !== 'string') continue;
    uit[id] = {
      soort: b.soort === 'catalog' ? 'catalog' : 'custom',
      link: b.link,
      catalogus: typeof b.catalogus === 'string' ? b.catalogus : '',
      ...(typeof b.version === 'string' && b.version ? { version: b.version } : {}),
    };
  }
  return uit;
}

/** Nieuwe bronnenlijst met de bron van `id` vastgelegd. */
export function metBron(voorkeuren, id, bron) {
  return { ...bronnenUit(voorkeuren), [id]: bronnenUit({ extensionSources: { [id]: bron } })[id] };
}

/** Nieuwe bronnenlijst zonder `id` (na verwijderen). */
export function zonderBron(voorkeuren, id) {
  const b = bronnenUit(voorkeuren);
  delete b[id];
  return b;
}

/**
 * Het label voor een geïnstalleerde extensie: 'catalog' (uit een catalogus),
 * 'custom' (eigen link, niet beoordeeld) of null (uit een bestand; dan zegt
 * de catalogus misschien wel waar updates vandaan komen).
 */
export function bronSoort(bronnen, id) {
  return bronnen?.[id]?.soort ?? null;
}

/**
 * Waar een update van `id` vandaan komt: de regel uit de catalogus als die er
 * is (ook bij een uit een bestand geïnstalleerde extensie), anders de eigen
 * link waarmee hij is geïnstalleerd. null als er niets te volgen is.
 */
export function updateBron(id, bronnen, items) {
  const bron = bronnen?.[id];
  const lijst = (items || []).filter((i) => i.id === id);
  const item = lijst.find((i) => bron?.catalogus && i.catalogus === bron.catalogus) || lijst[0];
  if (bron?.soort === 'custom') return { soort: 'custom', link: bron.link };
  if (item) return { soort: 'catalog', item };
  if (bron?.link) return { soort: bron.soort, link: bron.link, catalogus: bron.catalogus };
  return null;
}

// ─── De dienst: ophalen, installeren, updates ───────────────────────────

/**
 * @param {object} d
 * @param {(url: string) => Promise<string>} d.haalTekst        - https-tekst (max 2 MB)
 * @param {(a: {url, sha256, verwachtId}) => Promise<{pad, id, version}>} d.haalPakket - download + controle naar een tijdelijk bestand
 * @param {(pad: string) => Promise<{id, name, version}>} d.installeer - de bestaande transactionele installatie
 * @param {(pad: string) => Promise<void>} [d.ruimOp]           - tijdelijk bestand weg
 * @param {() => object} d.voorkeuren                           - de huidige voorkeuren
 * @param {(wijziging: object) => Promise<void>|void} d.bewaar  - velden samenvoegen en opslaan
 */
export function maakCatalogusDienst(d) {
  const { haalTekst, haalPakket, installeer, ruimOp = async () => {}, voorkeuren, bewaar } = d;

  async function laadCatalogi() {
    const items = [];
    const problemen = [];
    for (const url of catalogiUit(voorkeuren())) {
      try {
        const r = leesCatalogus(await haalTekst(url), url);
        for (const item of r.items) if (!items.some((i) => i.id === item.id)) items.push(item);
        if (r.fouten.length) problemen.push({ url, error: r.fouten.slice(0, 3).join('; ') + (r.fouten.length > 3 ? ` (+${r.fouten.length - 3})` : '') });
      } catch (e) {
        problemen.push({ url, error: String(e?.message ?? e) });
      }
    }
    return { items, problemen };
  }

  /** Link → het pakket om te downloaden: { url, version, sha256 }. */
  async function losOp(link, { sha256 = '', version = '', verwachtId = '' } = {}) {
    const l = ontleedLink(link);
    if (l.soort === 'pakket') return { url: l.url, version, sha256 };
    let release;
    try {
      release = JSON.parse(await haalTekst(l.api));
    } catch (e) {
      throw new Error(`Could not read the latest release of ${l.eigenaar}/${l.repo}: ${e?.message ?? e}`);
    }
    const p = kiesReleasePakket(release, verwachtId, `${l.eigenaar}/${l.repo}`);
    return { ...p, sha256: sha256 || p.sha256 };
  }

  async function installeerVan(link, { soort, catalogus = '', sha256 = '', version = '', verwachtId = '' }) {
    const pakket = await losOp(link, { sha256, version, verwachtId });
    const download = await haalPakket({ url: pakket.url, sha256: pakket.sha256 || null, verwachtId: verwachtId || null });
    let manifest;
    try {
      manifest = await installeer(download.pad);
    } finally {
      await Promise.resolve(ruimOp(download.pad)).catch(() => {});
    }
    await bewaar({
      extensionSources: metBron(voorkeuren(), manifest.id, {
        soort, link: String(link).trim(), catalogus, version: manifest.version || pakket.version || '',
      }),
    });
    return manifest;
  }

  /** Eén klik vanuit de catalogus. */
  function installeerItem(item) {
    return installeerVan(item.package || item.repo, {
      soort: 'catalog', catalogus: item.catalogus, sha256: item.sha256, version: item.version, verwachtId: item.id,
    });
  }

  /** Eigen link (niet beoordeeld): GitHub-repository of `.oppx`. */
  function installeerLink(link) {
    return installeerVan(link, { soort: 'custom' });
  }

  /**
   * De nieuwste versie voor elke geïnstalleerde extensie met een bron:
   * { id: versie } voor wie een update heeft.
   */
  async function zoekUpdates(geinstalleerd, items) {
    const bronnen = bronnenUit(voorkeuren());
    const uit = {};
    for (const ext of geinstalleerd || []) {
      if (!ext?.id || !ext.version) continue;
      const b = updateBron(ext.id, bronnen, items);
      if (!b) continue;
      let nieuwste = '';
      try {
        if (b.item?.package) nieuwste = b.item.version;
        else if (b.item) nieuwste = (await losOp(b.item.repo, { verwachtId: ext.id })).version;
        else if (!isPakketLink(b.link)) nieuwste = (await losOp(b.link, { verwachtId: ext.id })).version;
      } catch {
        nieuwste = '';
      }
      if (nieuwste && isNieuwer(nieuwste, ext.version)) uit[ext.id] = nieuwste;
    }
    return uit;
  }

  /** Bijwerken vanaf dezelfde bron als de update-controle. */
  function werkBij(id, items) {
    const b = updateBron(id, bronnenUit(voorkeuren()), items);
    if (!b) return Promise.reject(new Error('No source to update from'));
    if (b.item) return installeerItem(b.item);
    return installeerVan(b.link, { soort: b.soort, catalogus: b.catalogus || '', verwachtId: id });
  }

  return {
    laadCatalogi,
    losOp,
    installeerItem,
    installeerLink,
    zoekUpdates,
    werkBij,

    async voegCatalogusToe(url) {
      await bewaar({ extensionCatalogs: metCatalogus(voorkeuren(), url) });
    },

    async verwijderCatalogus(url) {
      await bewaar({ extensionCatalogs: zonderCatalogus(voorkeuren(), url) });
    },

    /** Na verwijderen van een extensie: de bron vergeten. */
    async vergeetBron(id) {
      if (!bronnenUit(voorkeuren())[id]) return;
      await bewaar({ extensionSources: zonderBron(voorkeuren(), id) });
    },
  };
}

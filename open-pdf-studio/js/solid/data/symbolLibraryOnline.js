// Online symboolbibliotheek — pure parse/convert-laag.
//
// De app haalt één index.json op uit de content-repo
// (OpenAEC-Foundation/open-pdf-studio-library) en downloadt collecties
// on-demand. Deze module bevat uitsluitend pure functies (geen Solid-,
// Tauri- of app-state-imports) zodat de laag rechtstreeks in node testbaar is:
// zie scripts/test-symbol-library-online.mjs.
//
// De netwerk/Solid-kant zit in stores/symbolLibraryOnlineStore.js.

import { saneerSvg, saneerSvgDetail } from '../../core/svg-veilig.js';

export const LIBRARY_REPO = 'OpenAEC-Foundation/open-pdf-studio-library';
export const LIBRARY_BRANCH = 'main';
export const LIBRARY_RAW_BASE = `https://raw.githubusercontent.com/${LIBRARY_REPO}/${LIBRARY_BRANCH}/`;
export const LIBRARY_INDEX_URL = `${LIBRARY_RAW_BASE}index.json`;
// GitHub contents-API: de index kent per collectie wel een symbolCount maar
// geen bestandsnamen; de listing van symbols/*.svg komt hier vandaan.
export const LIBRARY_CONTENTS_API = `https://api.github.com/repos/${LIBRARY_REPO}/contents/`;

// De index noemt alleen sector-ids; nette NL-labels horen bij de app.
export const SECTOR_LABELS = {
  aec: 'AEC (Bouw)',
  electrical: 'Elektrotechniek',
  process: 'Proces / P&ID',
  mep: 'Installatietechniek (MEP)',
  infra: 'Infra',
};

export function sectorLabel(id) {
  return SECTOR_LABELS[id] || id;
}

// Gelokaliseerd naam-object ({ en, nl, … }) → naam in de app-taal, met
// fallback naar Engels en anders de eerste beschikbare waarde.
export function pickLocalized(nameObj, lang) {
  if (!nameObj) return '';
  if (typeof nameObj === 'string') return nameObj;
  const short = String(lang || 'en').slice(0, 2).toLowerCase();
  return nameObj[short] || nameObj.en || Object.values(nameObj)[0] || '';
}

// index.json (formatVersion 1: regions → countries → sectors.collections)
// → platte structuur voor de UI:
//   { countries: [{ id, names, flag, region, sectors: { aec: [ids], … } }],
//     sectors: ['aec', …], collections: { id: meta } }
export function parseLibraryIndex(raw) {
  if (!raw || raw.formatVersion !== 1 || !Array.isArray(raw.regions)) {
    throw new Error('Onbekend indexformaat van de symboolbibliotheek');
  }
  const countries = [];
  const sectorIds = new Set();
  for (const region of raw.regions) {
    for (const c of region.countries || []) {
      if (!c || !c.id) continue;
      const sectors = {};
      for (const [sec, def] of Object.entries(c.sectors || {})) {
        const ids = Array.isArray(def && def.collections) ? def.collections : [];
        sectors[sec] = ids;
        sectorIds.add(sec);
      }
      countries.push({
        id: c.id,
        names: c.name || {},
        flag: c.flag || '',
        region: region.id || '',
        sectors,
      });
    }
  }
  return {
    countries,
    sectors: [...sectorIds].sort(),
    collections: raw.collections || {},
  };
}

// Raw-URLs volgens het data-format van de bibliotheek-repo.
export function collectionJsonUrl(collectionId) {
  return `${LIBRARY_RAW_BASE}collections/${collectionId}/collection.json`;
}
export function symbolsListApiUrl(collectionId) {
  return `${LIBRARY_CONTENTS_API}collections/${collectionId}/symbols?ref=${LIBRARY_BRANCH}`;
}
export function symbolRawUrl(collectionId, fileName) {
  return `${LIBRARY_RAW_BASE}collections/${collectionId}/symbols/${encodeURIComponent(fileName)}`;
}
export function stampsJsonUrl(collectionId) {
  return `${LIBRARY_RAW_BASE}collections/${collectionId}/stamps.json`;
}
export function parametricJsonUrl(collectionId) {
  return `${LIBRARY_RAW_BASE}collections/${collectionId}/parametric.json`;
}

// Bestandsnaam is het symbool-id (kebab-case): 'anti-paniekverlichting.svg'
// → 'Anti paniekverlichting'.
export function titleFromFileName(fileName) {
  const base = String(fileName).replace(/\.svg$/i, '');
  const words = base.replace(/[-_]+/g, ' ').trim();
  if (!words) return base;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Strikte controle: true als de SVG door de allowlist-saneerder komt zonder
// dat er iets weggehaald moest worden. Het data-format eist self-contained
// SVG's (geen scripts, geen externe verwijzingen); wat de app toont is altijd
// de door saneerSvg opnieuw uitgeschreven versie (zie collectionToGroup).
export function isSafeSymbolSvg(svg) {
  const r = saneerSvgDetail(svg);
  return r.svg !== null && r.verwijderd.length === 0;
}

// Stempel { id, text, color } → palette-SVG. De bibliotheek levert stempels
// als tekst+kleur; het omkaderde stempelvlak tekenen we zelf.
export function stampToSvg(stamp) {
  const text = String(stamp.text || '');
  const color = /^#[0-9a-fA-F]{6}$/.test(stamp.color || '') ? stamp.color : '#d00';
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fontSize = text.length > 14 ? 6 : text.length > 10 ? 7.5 : text.length > 7 ? 9 : 11;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="2" y="21" width="60" height="22" rx="3" fill="none" stroke="${color}" stroke-width="2.5"/>` +
    `<text x="32" y="35.5" font-size="${fontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" fill="${color}" stroke="none">${esc}</text>` +
    `</svg>`;
}

// Collectie-metadata + opgehaalde content → palette-groep, in exact de vorm
// van de bestaande categorieën/custom groups: { id, name, symbols: [{id,
// name, svg}] }. De store zet daar de locale-tags (industry/country als
// ARRAYS — één collectie geldt vaak voor meerdere landen/sectoren) en het
// persist-mechanisme bovenop.
export function collectionToGroup(collectionId, meta, contents, lang) {
  const symbols = [];
  for (const f of (contents && contents.svgFiles) || []) {
    if (!f || !f.name) continue;
    // Alleen bekende tekenelementen en attributen; wat er niet door komt valt
    // weg (en een SVG die niet te lezen is, slaan we helemaal over).
    const svg = saneerSvg(f.svg);
    if (!svg) continue;
    const base = String(f.name).replace(/\.svg$/i, '');
    symbols.push({
      id: `lib-${collectionId}-${base}`,
      name: titleFromFileName(f.name),
      svg,
    });
  }
  for (const st of (contents && contents.stamps) || []) {
    if (!st || !st.id || !st.text) continue;
    symbols.push({
      id: `lib-${collectionId}-stamp-${st.id}`,
      name: String(st.text),
      svg: stampToSvg(st),
    });
  }
  return {
    id: `lib-${collectionId}`,
    name: pickLocalized(meta && meta.name, lang) || collectionId,
    online: true,
    collectionId,
    version: (meta && meta.version) || null,
    symbols,
  };
}

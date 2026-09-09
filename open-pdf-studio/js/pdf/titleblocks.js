// Onderhoeken (titelblokken) — vinden, toevoegen en op een kader plaatsen.
//
// Een onderhoek is een gewoon PDF-bestand van één pagina, op ware grootte
// getekend (de OpenAEC-onderhoek is 190 x 110 mm). Kaders zijn kaal: de
// onderhoek wordt er bij het aanmaken van een document in gezet. Zo kan
// iedereen zijn eigen bedrijfsonderhoek gebruiken zonder de kaders aan te
// raken.
//
// Gescand uit dezelfde drie lagen als de kaders (zie frames.js), eerste
// treffer per bestandsnaam wint:
//   1. <appData>\onderhoeken     — hier landt wat de gebruiker toevoegt
//   2. de tenant-repo (dev)
//   3. <resourceDir>\onderhoeken — meegeleverd met de installatie

const DEV_DIR =
  'C:\\Users\\rickd\\Documents\\GitHub\\openaec-tenants\\tenants\\openaec_foundation\\title_blocks';

import { composeFrameWithTitleBlock, KADER_MARGE_PT } from './titleblock-compose.js';
export { composeFrameWithTitleBlock, KADER_MARGE_PT };

function _tauri() {
  return window.__TAURI__ || {};
}

async function _allowDir(dir) {
  try {
    await _tauri().core?.invoke('allow_fs_scope', { path: dir + '\\_scope.pdf' });
  } catch { /* best-effort */ }
}

async function _exists(path) {
  try { return await _tauri().fs?.exists(path); } catch { return false; }
}

/** Kandidaat-mappen in prioriteitsvolgorde (alleen bestaande). */
export async function getTitleBlockDirs() {
  const t = _tauri();
  const dirs = [];
  try {
    const appData = await t.path.appDataDir();
    const sep = appData.endsWith('\\') || appData.endsWith('/') ? '' : '\\';
    const userDir = `${appData}${sep}onderhoeken`;
    await _allowDir(userDir);
    if (await _exists(userDir)) dirs.push(userDir);
  } catch { /* geen appData (browser) */ }
  await _allowDir(DEV_DIR);
  if (await _exists(DEV_DIR)) dirs.push(DEV_DIR);
  try {
    const res = await t.path.resourceDir();
    const sep = res.endsWith('\\') || res.endsWith('/') ? '' : '\\';
    const bundled = `${res}${sep}onderhoeken`;
    await _allowDir(bundled);
    if (await _exists(bundled)) dirs.push(bundled);
  } catch { /* geen resource dir */ }
  return dirs;
}

/** De map waarin de gebruiker onderhoeken beheert; wordt zo nodig gemaakt. */
export async function getUserTitleBlockDir() {
  if (await _exists(DEV_DIR)) return DEV_DIR;
  const t = _tauri();
  const appData = await t.path.appDataDir();
  const sep = appData.endsWith('\\') || appData.endsWith('/') ? '' : '\\';
  const userDir = `${appData}${sep}onderhoeken`;
  await _allowDir(userDir);
  if (!(await _exists(userDir))) {
    try { await t.fs.mkdir(userDir, { recursive: true }); } catch { /* laat staan */ }
  }
  return userDir;
}

/** Open de onderhoeken-map in de verkenner. */
export async function openTitleBlocksFolder() {
  const dir = await getUserTitleBlockDir();
  try {
    await _tauri().core.invoke('open_pdf_in_default_viewer', { path: dir });
  } catch (e) {
    console.warn('[onderhoeken] map openen mislukt:', e);
  }
}

/** Bestandsnaam → toonbare naam: 'mijn_bedrijf.pdf' → 'Mijn bedrijf'. */
export function titleBlockLabel(fileName) {
  const kaal = String(fileName || '').replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  return kaal ? kaal.charAt(0).toUpperCase() + kaal.slice(1) : fileName;
}

async function _scanDir(dir, out, seen) {
  let entries = [];
  try { entries = await _tauri().fs.readDir(dir); } catch { return; }
  for (const en of entries || []) {
    const full = `${dir}\\${en.name}`;
    if (en.isDirectory) {
      await _allowDir(full);
      await _scanDir(full, out, seen);
      continue;
    }
    if (!en.name?.toLowerCase().endsWith('.pdf')) continue;
    const key = en.name.toLowerCase();
    if (seen.has(key)) continue; // hogere laag wint
    seen.add(key);
    out.push({ path: full, fileName: en.name, label: titleBlockLabel(en.name) });
  }
}

/** Alle beschikbare onderhoeken, op naam gesorteerd. */
export async function scanTitleBlocks() {
  const out = [];
  const seen = new Set();
  for (const dir of await getTitleBlockDirs()) {
    await _scanDir(dir, out, seen);
  }
  out.sort((a, b) => a.label.localeCompare(b.label, 'nl'));
  return out;
}

/**
 * Voeg een PDF toe als onderhoek: kopieer hem naar de gebruikersmap.
 * Bestaat de naam daar al, dan krijgt de kopie een volgnummer — een
 * bestaande onderhoek overschrijven zou stilletjes andermans sjabloon
 * kunnen wissen.
 *
 * @returns {Promise<{path:string, fileName:string, label:string}>}
 */
export async function addTitleBlockFile(bronPad) {
  const t = _tauri();
  const dir = await getUserTitleBlockDir();
  const basis = String(bronPad).split(/[\\/]/).pop() || 'onderhoek.pdf';
  const stam = basis.replace(/\.pdf$/i, '');
  let naam = `${stam}.pdf`;
  let n = 2;
  while (await _exists(`${dir}\\${naam}`)) {
    naam = `${stam}-${n}.pdf`;
    n += 1;
  }
  const doel = `${dir}\\${naam}`;
  try { await t.core.invoke('allow_fs_scope', { path: bronPad }); } catch { /* best-effort */ }
  try { await t.core.invoke('allow_fs_scope', { path: doel }); } catch { /* best-effort */ }
  const bytes = await t.fs.readFile(bronPad);
  await t.fs.writeFile(doel, new Uint8Array(bytes));
  return { path: doel, fileName: naam, label: titleBlockLabel(naam) };
}


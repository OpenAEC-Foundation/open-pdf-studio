// Verkenner-rechtermuisknop (#945): "Combineren tot één PDF" op PDF's,
// "Omzetten naar PDF" en "Omzetten en combineren" op afbeeldingen en
// tekeningen. Installer: src-tauri/nsis/hooks.nsh; opdrachtregel en wachtrij:
// src-tauri/src/verkenner_acties.rs; rekenregels: shell-acties-logica.js.
//
// Verkenner start de app een keer per geselecteerd bestand. De eerste start
// brengt zijn eigen bestand mee, de volgende bereiken de draaiende app via de
// single-instance-plugin. Elke start staat in de wachtrij aan de Rust-kant
// (get_shell_action); het event "shell-action" zegt alleen "er is meer". Zo
// gaat een start tijdens het opstarten nooit verloren. De bestanden van één
// selectie worden even verzameld (VERZAMEL_MS na de laatste start) en dan
// samen afgehandeld.
import { invoke, isTauri } from './platform.js';
import {
  AFBEELDING, CAD, naamVan, natuurlijkGesorteerd, verdeelActies, maakVerzamelaar,
  schrijfNaastBron, paginaMaatVoorAfbeelding,
} from './shell-acties-logica.js';

const wachtrij = { combine: [], convert: [] };
let klaar = false;
let openBestanden = null;

const verzamelaar = maakVerzamelaar(() => {
  verwerk().catch((e) => console.error('[shell-action] failed:', e));
});

async function staToe(pad) {
  try { await invoke('allow_fs_scope', { path: pad }); } catch { /* scope is best-effort */ }
}

// Alles ophalen wat sinds de vorige keer in de Rust-wachtrij kwam.
async function haalOp() {
  let acties = [];
  try {
    acties = (await invoke('get_shell_action')) || [];
  } catch (e) {
    console.warn('[shell-action] queue unavailable', e);
    return;
  }
  const { combine, convert } = verdeelActies(acties);
  for (const f of combine) if (!wachtrij.combine.includes(f)) wachtrij.combine.push(f);
  for (const f of convert) if (!wachtrij.convert.includes(f)) wachtrij.convert.push(f);
  if (combine.length || convert.length) verzamelaar.seintje();
}

async function verwerk() {
  const combineren = natuurlijkGesorteerd(wachtrij.combine.splice(0));
  const omzetten = natuurlijkGesorteerd(wachtrij.convert.splice(0));
  if (combineren.length) {
    // Afbeeldingen in de selectie ("Omzetten en combineren") worden een PDF
    // in een tijdelijke map, onder hun eigen naam: naast de afbeelding komt
    // niets, en het venster toont de naam zoals hij is.
    const files = [];
    for (const pad of combineren) {
      try { files.push(AFBEELDING.test(pad) ? await afbeeldingNaarTijdelijkePdf(pad) : pad); }
      catch (e) { console.error('[combine] image skipped', pad, e); }
    }
    if (files.length) {
      const { openDialog, closeDialog, getDialogs } = await import('../solid/stores/dialogStore.js');
      // Een gewoon samenvoegvenster dat al open staat maakt plaats; het
      // combineervenster komt altijd met precies deze selectie.
      if (getDialogs().some((d) => d.name === 'merge-pdfs')) closeDialog('merge-pdfs');
      openDialog('merge-pdfs', { files, combineNew: true });
    }
  }
  const geschreven = [];
  for (const pad of omzetten) {
    try {
      if (CAD.test(pad)) {
        const { openAlsCadTekening } = await import('../pdf/cad-import.js');
        await openAlsCadTekening(pad);
        continue;
      }
      geschreven.push(await afbeeldingNaarPdfNaastBron(pad));
    } catch (e) {
      console.error('[convert-to-pdf]', pad, e);
    }
  }
  if (geschreven.length && openBestanden) openBestanden(geschreven);
}

// Een afbeelding wordt een PDF ernaast: zelfde naam, `.pdf`, en `naam (2).pdf`
// enz. als die al bestaat. Een bestaand bestand wordt nooit overschreven.
async function afbeeldingNaarPdfNaastBron(pad) {
  await staToe(pad);
  const { readBinaryFile, writeBinaryFileNew } = await import('./platform.js');
  const pdfBytes = await afbeeldingNaarPdf(new Uint8Array(await readBinaryFile(pad)), pad);
  const doel = await schrijfNaastBron(pad, pdfBytes, async (kandidaat, bytes) => {
    await staToe(kandidaat);
    await writeBinaryFileNew(kandidaat, bytes);
  });
  await staToe(doel);
  return doel;
}

let tijdelijkeMap = null;

async function afbeeldingNaarTijdelijkePdf(pad) {
  await staToe(pad);
  const { readBinaryFile, writeBinaryFileNew } = await import('./platform.js');
  const pdfBytes = await afbeeldingNaarPdf(new Uint8Array(await readBinaryFile(pad)), pad);
  if (!tijdelijkeMap) {
    const temp = await window.__TAURI__.path.tempDir();
    const map = `${temp}${/[\\/]$/.test(temp) ? '' : '/'}opds-combine-${Date.now()}`;
    await staToe(map);
    await window.__TAURI__.fs.mkdir(map, { recursive: true });
    tijdelijkeMap = map;
  }
  // Twee afbeeldingen met dezelfde naam (foto.jpg en foto.png) krijgen
  // foto.pdf en foto (2).pdf.
  return schrijfNaastBron(`${tijdelijkeMap}/${naamVan(pad)}`, pdfBytes, async (kandidaat, bytes) => {
    await staToe(kandidaat);
    await writeBinaryFileNew(kandidaat, bytes);
  });
}

// Afbeelding naar een PDF van één pagina, zo groot als de afbeelding op 96 dpi.
// JPEG en PNG gaan er zoals ze zijn in; andere formaten (en een JPEG/PNG die
// pdf-lib niet leest) worden eerst via een canvas een PNG.
async function afbeeldingNaarPdf(bytes, pad) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  let beeld = null;
  try {
    if (/\.jpe?g$/i.test(pad)) beeld = await pdf.embedJpg(bytes);
    else if (/\.png$/i.test(pad)) beeld = await pdf.embedPng(bytes);
  } catch (e) {
    console.warn('[convert-to-pdf] direct embed failed, via canvas', pad, e);
    beeld = null;
  }
  if (!beeld) beeld = await pdf.embedPng(await naarPng(bytes));
  const { breedte, hoogte } = paginaMaatVoorAfbeelding(beeld.width, beeld.height);
  const pagina = pdf.addPage([breedte, hoogte]);
  pagina.drawImage(beeld, { x: 0, y: 0, width: breedte, height: hoogte });
  pdf.setTitle(naamVan(pad).replace(/\.[^.]+$/, ''));
  return pdf.save();
}

async function naarPng(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas.toBlob failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// Alleen het hoofdvenster haalt de wachtrij leeg (een ander venster in
// hetzelfde proces zou de acties anders wegnemen).
function isHoofdvenster() {
  try {
    const label = window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.()?.label;
    return !label || label === 'main';
  } catch {
    return true;
  }
}

/**
 * Aanroepen zodra de app documenten en vensters kan openen.
 * @param {{ openFiles?: (paden: string[]) => void }} opties - `openFiles`
 *   opent de omgezette PDF's (de gewone open-wachtrij van main.js).
 */
export async function startShellActies({ openFiles = null } = {}) {
  if (!isTauri() || !isHoofdvenster()) return;
  openBestanden = openFiles;
  klaar = true;
  await haalOp();
}

// Starts die de draaiende app bereiken; vóór de start wacht de rij gewoon.
if (typeof window !== 'undefined' && window.__TAURI__?.event) {
  window.__TAURI__.event.listen('shell-action', () => {
    if (klaar) haalOp();
  });
}

// De staat van de modus "Pagina's bewerken" (#764).
//
// Het plan, de selectie, de zoom en de geschiedenis (Ctrl+Z / Ctrl+Y binnen de
// modus) leven hier; de Solid-component PagesOrganizer.jsx tekent ze en het
// lint opent de modus met openOrganizer(). Het document zelf verandert pas
// bij bewaarOrganizer(); annuleren gooit het plan weg.
//
// De geschiedenis bestaat uit hele plannen. Elk plan is onveranderlijk — de
// model-functies geven een nieuw plan terug — dus een oude stand bewaren is
// genoeg om precies terug te kunnen.

import { createSignal } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';
import {
  maakPlan, planOngewijzigd, positieVan, verplaats, doelIndexVoorGap, draai, verwijder,
  voegBlancoIn, voegBestandToe, wisselSplitsing, samenvatting,
} from '../../pagina-organizer/organizer-model.js';
import { A4, telPaginas } from '../../pagina-organizer/organizer-apply.js';

const [actief, setActief] = createSignal(false);
const [plan, setPlan] = createSignal(null);
const [selectie, setSelectie] = createSignal(new Set());
const [zoom, setZoom] = createSignal(1);
const [bezig, setBezig] = createSignal(false);
const [melding, setMelding] = createSignal(null);
const [aantalPaginas, setAantalPaginas] = createSignal(0);
const [maat, setMaat] = createSignal('a4');
const [verledenAantal, setVerledenAantal] = createSignal(0);
const [toekomstAantal, setToekomstAantal] = createSignal(0);
// De id's die op dit moment gesleept worden (één kaart of de hele selectie).
const [gesleept, setGesleept] = createSignal([]);

/** De maten waaruit de + tussen de kaarten een blanco pagina maakt. */
export const BLANCO_MATEN = Object.freeze({
  a4: { label: 'A4', breedte: A4.breedte, hoogte: A4.hoogte },
  a4l: { label: 'A4 landscape', breedte: A4.hoogte, hoogte: A4.breedte },
  a3: { label: 'A3', breedte: 841.89, hoogte: 1190.55 },
  letter: { label: 'Letter', breedte: 612, hoogte: 792 },
});

const MAX_GESCHIEDENIS = 60;
let verleden = [];
let toekomst = [];
let meldingTimer = null;

export {
  actief as organizerActief,
  plan as organizerPlan,
  selectie as organizerSelectie,
  zoom as organizerZoom,
  bezig as organizerBezig,
  melding as organizerMelding,
  aantalPaginas as organizerAantalPaginas,
  maat as organizerMaat,
  verledenAantal as organizerKanOngedaan,
  toekomstAantal as organizerKanOpnieuw,
  gesleept as organizerGesleept,
};

export function zetOrganizerMaat(id) {
  if (BLANCO_MATEN[id]) setMaat(id);
}

export function zetOrganizerZoom(waarde) {
  setZoom(Math.max(0.5, Math.min(2, Math.round(waarde * 100) / 100)));
}

function meld(tekst) {
  setMelding(tekst || null);
  if (meldingTimer) clearTimeout(meldingTimer);
  if (tekst) meldingTimer = setTimeout(() => setMelding(null), 5000);
}

/** Een nieuwe stand: de oude gaat naar de geschiedenis, opnieuw-doen vervalt. */
function wijzig(nieuw) {
  const huidig = plan();
  if (!huidig || !nieuw || nieuw === huidig) return false;
  verleden.push(huidig);
  if (verleden.length > MAX_GESCHIEDENIS) verleden.shift();
  toekomst = [];
  setPlan(nieuw);
  setVerledenAantal(verleden.length);
  setToekomstAantal(0);
  // Houd de selectie bij wat er nog is.
  const ids = new Set(nieuw.items.map((i) => i.id));
  const nu = selectie();
  const volgend = new Set([...nu].filter((id) => ids.has(id)));
  if (volgend.size !== nu.size) setSelectie(volgend);
  return true;
}

/** Open de organizer voor het actieve document. */
export function openOrganizer() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    meld('Open a PDF first');
    return false;
  }
  setAantalPaginas(doc.pdfDoc.numPages);
  verleden = [];
  toekomst = [];
  setVerledenAantal(0);
  setToekomstAantal(0);
  setSelectie(new Set());
  setGesleept([]);
  setMelding(null);
  setPlan(maakPlan(doc.pdfDoc.numPages));
  setActief(true);
  return true;
}

/** Sluit de organizer; het document blijft zoals het was. */
export function sluitOrganizer() {
  setActief(false);
  setPlan(null);
  setSelectie(new Set());
  setGesleept([]);
  setMelding(null);
  verleden = [];
  toekomst = [];
  setVerledenAantal(0);
  setToekomstAantal(0);
  import('../../pagina-organizer/organizer-thumbs.js')
    .then((m) => m.sluitMiniaturen())
    .catch(() => {});
}

/** De samenvatting voor de kopregel van de organizer. */
export function organizerSamenvatting() {
  const p = plan();
  if (!p) return null;
  return samenvatting(p, aantalPaginas());
}

/** Staat er iets te bewaren? */
export function organizerGewijzigd() {
  const p = plan();
  return !!p && !planOngewijzigd(p, aantalPaginas());
}

// ── selectie ──────────────────────────────────────────────────────────────

let anker = null;

/**
 * Een klik op een kaart: alleen, met Ctrl (bij/af) of met Shift (bereik vanaf
 * de vorige klik) — zoals het miniaturenpaneel het doet.
 */
export function klikItem(id, { ctrl = false, shift = false } = {}) {
  const p = plan();
  if (!p) return;
  const index = positieVan(p, id);
  if (index < 0) return;

  if (shift && anker !== null) {
    const [van, tot] = anker <= index ? [anker, index] : [index, anker];
    const bereik = p.items.slice(van, tot + 1).map((i) => i.id);
    setSelectie(ctrl ? new Set([...selectie(), ...bereik]) : new Set(bereik));
    return;
  }
  anker = index;
  if (ctrl) {
    const nu = new Set(selectie());
    if (nu.has(id)) nu.delete(id);
    else nu.add(id);
    setSelectie(nu);
    return;
  }
  setSelectie(new Set([id]));
}

export function selecteerAlles() {
  const p = plan();
  if (p) setSelectie(new Set(p.items.map((i) => i.id)));
}

export function wisSelectie() {
  setSelectie(new Set());
  anker = null;
}

// ── wijzigingen op het plan ───────────────────────────────────────────────

/** Draai de selectie (of één pagina) over `graden`. */
export function draaiSelectie(graden, ids = null) {
  const p = plan();
  if (!p) return false;
  const doel = ids || [...selectie()];
  if (!doel.length) return false;
  return wijzig(draai(p, doel, graden));
}

/** Verwijder de selectie; het laatste blad blijft staan. */
export function verwijderSelectie(ids = null) {
  const p = plan();
  if (!p) return false;
  const doel = ids || [...selectie()];
  if (!doel.length) return false;
  const uit = verwijder(p, doel);
  if (!uit.ok) {
    meld('At least one page must remain');
    return false;
  }
  return wijzig(uit.plan);
}

/** Verplaats pagina's naar een gap tussen twee kaarten ("vóór kaart n"). */
export function verplaatsNaarGap(ids, gapIndex) {
  const p = plan();
  if (!p || !ids?.length) return false;
  return wijzig(verplaats(p, ids, doelIndexVoorGap(p, ids, gapIndex)));
}

/** De pagina's die nu gesleept worden (voor de drop-afhandeling). */
export function sleepStart(ids) {
  setGesleept(ids);
}

export function sleepStop() {
  setGesleept([]);
}

/** Voeg een blanco pagina in op een gap, met de gekozen maat. */
export function voegBlancoInOp(index, maatId = null) {
  const p = plan();
  if (!p) return false;
  const m = BLANCO_MATEN[maatId || maat()] || BLANCO_MATEN.a4;
  return wijzig(voegBlancoIn(p, index, { breedte: m.breedte, hoogte: m.hoogte, aantal: 1, maatId }));
}

/** Voeg de pagina's van een PDF toe op een gap (bytes zijn al ingelezen). */
export async function voegPdfToe(index, { naam, bytes }, { stil = false } = {}) {
  const p = plan();
  if (!p) return false;
  try {
    const aantal = await telPaginas(bytes);
    if (!aantal) {
      if (!stil) meld(`${naam}: no pages`);
      return false;
    }
    const bestandId = `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    return wijzig(voegBestandToe(p, index, { bestandId, naam, bytes, aantalPaginas: aantal }));
  } catch (e) {
    console.warn('[organizer] invoegen mislukt:', e);
    if (!stil) meld(`${naam}: not a readable PDF`);
    return false;
  }
}

/** Voeg een PDF van schijf toe (Tauri-bestandsleep). */
export async function voegPdfPadToe(pad, index = null) {
  const p = plan();
  if (!p) return false;
  const { leesInvoegBestand } = await import('../../pagina-organizer/organizer-apply.js');
  try {
    const gelezen = await leesInvoegBestand(pad);
    const naam = String(pad).split(/[\\/]/).pop() || 'document.pdf';
    const at = index == null ? p.items.length : index;
    const bestandId = `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    return wijzig(voegBestandToe(p, at, { bestandId, naam, ...gelezen }));
  } catch (e) {
    console.warn('[organizer] bestand invoegen mislukt:', e);
    meld('That PDF could not be read');
    return false;
  }
}

/** Zet of haal een splitspunt vóór een pagina. */
export function wisselSplitsingBij(id) {
  const p = plan();
  if (!p) return false;
  const uit = wisselSplitsing(p, id);
  if (uit.plan === p) return false;
  return wijzig(uit.plan);
}

/** Zet een splitspunt vóór elke geselecteerde pagina (behalve de eerste). */
export function splitsSelectie() {
  const p = plan();
  if (!p) return false;
  let nieuw = p;
  for (const id of selectie()) {
    const uit = wisselSplitsing(nieuw, id);
    if (uit.aan) nieuw = uit.plan;
  }
  return wijzig(nieuw);
}

// ── ongedaan maken / opnieuw doen (binnen de modus) ───────────────────────

export function ongedaanMaken() {
  const p = plan();
  if (!p || !verleden.length) return false;
  toekomst.push(p);
  const vorige = verleden.pop();
  setPlan(vorige);
  setVerledenAantal(verleden.length);
  setToekomstAantal(toekomst.length);
  const ids = new Set(vorige.items.map((i) => i.id));
  setSelectie(new Set([...selectie()].filter((id) => ids.has(id))));
  return true;
}

export function opnieuwDoen() {
  const p = plan();
  if (!p || !toekomst.length) return false;
  verleden.push(p);
  const volgende = toekomst.pop();
  setPlan(volgende);
  setVerledenAantal(verleden.length);
  setToekomstAantal(toekomst.length);
  const ids = new Set(volgende.items.map((i) => i.id));
  setSelectie(new Set([...selectie()].filter((id) => ids.has(id))));
  return true;
}

// ── bewaren ───────────────────────────────────────────────────────────────

/** De geselecteerde pagina's als nieuw PDF-bestand wegschrijven. */
export async function exporteerNu() {
  const p = plan();
  if (!p || !selectie().size) return false;
  const { exporteerSelectie } = await import('../../pagina-organizer/organizer-apply.js');
  const pad = await exporteerSelectie(p, [...selectie()]);
  if (pad) meld(`Written: ${String(pad).split(/[\\/]/).pop()}`);
  return !!pad;
}

/**
 * Het plan toepassen op het document: één ongedaan-maakstap, en elk deel als
 * eigen bestand als er splitspunten staan.
 */
export async function bewaarOrganizer() {
  const p = plan();
  const doc = getActiveDocument();
  if (!p || !doc?.pdfDoc || bezig()) return false;

  if (!organizerGewijzigd()) {
    sluitOrganizer();
    return true;
  }

  setBezig(true);
  try {
    const { pasPlanToe } = await import('../../pagina-organizer/organizer-apply.js');
    const uit = await pasPlanToe(p);
    if (!uit.toegepast) {
      meld('The changes could not be applied');
      return false;
    }
    const geschreven = uit.delen?.length || 0;
    sluitOrganizer();
    if (geschreven) {
      const { showMessage } = await import('../../bridge.js');
      showMessage(`${geschreven} files written`);
    }
    return true;
  } finally {
    setBezig(false);
  }
}

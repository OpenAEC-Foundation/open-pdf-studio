// Wat een export NIET meeneemt (#629): voordat de gebruiker exporteert naar
// een formaat dat informatie verliest, zegt de app concreet wat er niet
// overleeft. Deze module is puur: (soort export, samenvatting van de inhoud
// van het document) → lijst van verliezen. Geen DOM, geen app-state.
//
// De samenvatting maakt export-verlies-inhoud.js uit het open document; de
// vraag aan de gebruiker stelt ui/chrome/export-verlies-bevestigen.js met het
// venster ExportVerliesDialog.jsx. Elk verlies is { code, aantal?, soorten? }:
// de tekst staat onder dialogs:exportLoss.<code>, met {{count}} en {{types}}.
//
// Alleen wat het document echt bevat telt: geen formuliervelden, dan ook geen
// waarschuwing over formuliervelden.

export const EXPORT_SOORTEN = Object.freeze([
  'xfdf', 'bcf', 'flattened', 'docx', 'odt', 'xlsx', 'pdfx', 'pdfa', 'raster', 'cad',
]);

/**
 * De annotatiesoorten die xfdf.js schrijft (de takken van annotationToXFDF).
 * Een tekening ('draw') alleen met minstens twee punten.
 */
export const XFDF_SOORTEN = Object.freeze(new Set([
  'highlight', 'textHighlight', 'textStrikethrough', 'textUnderline', 'box', 'mask', 'scaleRegion',
  'circle', 'line', 'arrow', 'draw', 'comment', 'textbox', 'callout', 'stamp', 'parametricSymbol',
]));

// Soorten die XFDF wel schrijft, maar met minder uiterlijk dan in de app:
// een stempel alleen naam en tekst (geen afbeelding), een tekstvak zonder
// lettertype en tekstkleur, een vorm zonder randstijl, draaiing en
// vul-doorzichtigheid, een tekstmarkering als één rechthoek in plaats van
// per regel.
const XFDF_MINDER_UITERLIJK = Object.freeze(new Set([
  'stamp', 'textbox', 'callout', 'box', 'circle', 'mask', 'highlight', 'textHighlight',
  'textStrikethrough', 'textUnderline', 'draw',
]));

// Soorten met gegevens die alleen deze app leest (eigen XFDF-attributen):
// een ander programma ziet er een gewone rechthoek in.
const EIGEN_SOORTEN = Object.freeze(new Set(['parametricSymbol', 'scaleRegion']));

// Soorten die PDF/A-1 niet kent (Polygon, PolyLine, Caret, FileAttachment,
// Redact): de conversie maakt ze plat in de pagina (pdfa/conversie.js, stap 4).
const PDFA1_PLAT = Object.freeze(new Set([
  'polygon', 'cloud', 'polyline', 'measureArea', 'measurePerimeter', 'caret', 'fileAttachment',
  'redaction', 'arc', 'splineArrow',
]));

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);

/** Is de annotatie (deels) doorzichtig? */
export function isDoorzichtig(ann) {
  if (!ann) return false;
  return (isGetal(ann.opacity) && ann.opacity < 1) || (isGetal(ann.fillOpacity) && ann.fillOpacity < 1);
}

/** Schrijft xfdf.js deze annotatie? */
export function xfdfSchrijft(ann) {
  if (!ann || !XFDF_SOORTEN.has(ann.type)) return false;
  if (ann.type === 'draw') return Array.isArray(ann.path) && ann.path.length >= 2;
  return true;
}

/** Aantal per soort, in volgorde van eerste voorkomen: [{ type, aantal }]. */
export function telSoorten(annotaties) {
  const per = new Map();
  for (const a of annotaties || []) {
    if (!a?.type) continue;
    per.set(a.type, (per.get(a.type) || 0) + 1);
  }
  return [...per].map(([type, aantal]) => ({ type, aantal }));
}

/** Het aantal antwoorden onder de annotaties. */
function telAntwoorden(annotaties) {
  return annotaties.reduce((n, a) => n + (Array.isArray(a?.replies) ? a.replies.length : 0), 0);
}

function met(lijst, code, aantal, soorten) {
  const item = { code };
  if (aantal !== undefined) item.aantal = aantal;
  if (soorten) item.soorten = soorten;
  lijst.push(item);
}

/** Een verlies over een deel van de annotaties, alleen als dat deel niet leeg is. */
function overSoorten(lijst, code, deel) {
  if (deel.length) met(lijst, code, deel.length, telSoorten(deel));
}

/**
 * De verliezen van een export.
 *
 * @param {string} soort  een van EXPORT_SOORTEN
 * @param {object} inhoud  samenvatting van het document:
 *   { paginas, tekst, annotaties: object[], formuliervelden, lagen, bijlagen,
 *     bladwijzers, scripts, gewijzigd }
 * @param {object} [opties]  per export: { deel } (PDF/A 1-3), { conformance }
 *   ('X-3' | 'X-4'), { afbeeldingen } (paginabeelden in een tekstdocument),
 *   { annotaties } (CAD: markeringen meenemen)
 * @returns {{code: string, aantal?: number, soorten?: {type: string, aantal: number}[]}[]}
 */
export function exportVerliezen(soort, inhoud = {}, opties = {}) {
  const i = inhoud || {};
  const anns = (Array.isArray(i.annotaties) ? i.annotaties : []).filter((a) => a && a.type);
  const paginas = Number(i.paginas) || 0;
  const lagen = Number(i.lagen) || 0;
  const bijlagen = Number(i.bijlagen) || 0;
  const uit = [];

  switch (soort) {
    case 'xfdf': {
      if (paginas > 0) met(uit, 'pageContent');
      if (i.formuliervelden) met(uit, 'formFieldValues');
      overSoorten(uit, 'typesNotExported', anns.filter((a) => !xfdfSchrijft(a)));
      const geschreven = anns.filter(xfdfSchrijft);
      overSoorten(uit, 'xfdfAppearance', geschreven.filter((a) => XFDF_MINDER_UITERLIJK.has(a.type)));
      const status = geschreven.filter((a) => a.status && String(a.status).toLowerCase() !== 'none');
      if (status.length) met(uit, 'reviewStatus', status.length);
      overSoorten(uit, 'appSpecific', geschreven.filter((a) => EIGEN_SOORTEN.has(a.type)));
      break;
    }
    case 'bcf': {
      if (paginas > 0) met(uit, 'bcfPageSnapshot');
      if (anns.length) met(uit, 'bcfOnlyIssues', anns.length);
      break;
    }
    case 'flattened': {
      if (i.formuliervelden) met(uit, 'formFieldValues');
      if (anns.length) met(uit, 'editability', anns.length);
      const notities = anns.filter((a) => a.type === 'comment');
      const antwoorden = telAntwoorden(anns);
      if (notities.length || antwoorden) met(uit, 'noteText', notities.length + antwoorden);
      break;
    }
    case 'docx':
    case 'odt':
    case 'xlsx': {
      if (paginas > 0) met(uit, 'layout');
      if (paginas > 0 && i.tekst === false) met(uit, 'noText');
      if (anns.length) met(uit, 'annotationsNotExported', anns.length);
      if (soort === 'xlsx') {
        if (paginas > 0) met(uit, 'drawingsNotInSheet');
      } else if (paginas > 0) {
        met(uit, opties.afbeeldingen ? 'drawingsAsImage' : 'drawingsNotExported');
      }
      if (i.formuliervelden) met(uit, 'formFieldValues');
      break;
    }
    case 'pdfx': {
      if (i.gewijzigd) met(uit, 'unsavedChanges');
      if (opties.conformance !== 'X-4') {
        const doorzichtig = anns.filter(isDoorzichtig);
        if (doorzichtig.length) met(uit, 'pdfxTransparency', doorzichtig.length);
        if (lagen) met(uit, 'pdfxLayers', lagen);
      }
      break;
    }
    case 'pdfa': {
      const deel = Number(opties.deel) || 2;
      if (i.scripts) met(uit, 'scriptsRemoved');
      const verborgen = anns.filter((a) => a.hidden);
      if (verborgen.length) met(uit, 'hiddenRemoved', verborgen.length);
      if (deel === 1) {
        if (bijlagen) met(uit, 'attachmentsRemoved', bijlagen);
        if (lagen) met(uit, 'layersMerged', lagen);
        const doorzichtig = anns.filter(isDoorzichtig);
        if (doorzichtig.length) met(uit, 'pdfaTransparency', doorzichtig.length);
        overSoorten(uit, 'pdfaFlattened', anns.filter((a) => PDFA1_PLAT.has(a.type)));
      } else if (deel === 2) {
        if (bijlagen) met(uit, 'attachmentsOnlyPdfa', bijlagen);
      }
      break;
    }
    case 'raster': {
      if (paginas > 0 && i.tekst !== false) met(uit, 'textAsImage');
      if (paginas > 0) met(uit, 'vectorsAsPixels');
      if (anns.length) met(uit, 'markupsBurnedIn', anns.length);
      if (i.formuliervelden) met(uit, 'formFieldsAsImage');
      if (i.bladwijzers) met(uit, 'bookmarks');
      if (bijlagen) met(uit, 'attachments', bijlagen);
      if (lagen) met(uit, 'layers', lagen);
      break;
    }
    case 'cad': {
      if (anns.length && opties.annotaties === false) {
        met(uit, 'cadAnnotationsOff', anns.length);
        break;
      }
      if (i.gewijzigd && anns.length) met(uit, 'unsavedChanges');
      const notities = anns.filter((a) => a.type === 'comment');
      if (notities.length) met(uit, 'cadNotes', notities.length);
      const verborgen = anns.filter((a) => a.hidden);
      if (verborgen.length) met(uit, 'cadHidden', verborgen.length);
      break;
    }
    default:
      break;
  }
  return uit;
}

/** Alle codes die exportVerliezen kan geven (voor de vertaaltests). */
export const VERLIES_CODES = Object.freeze([
  'pageContent', 'formFieldValues', 'typesNotExported', 'xfdfAppearance', 'reviewStatus', 'appSpecific',
  'bcfPageSnapshot', 'bcfOnlyIssues', 'editability', 'noteText', 'layout', 'noText',
  'annotationsNotExported', 'drawingsNotInSheet', 'drawingsAsImage', 'drawingsNotExported',
  'unsavedChanges', 'pdfxTransparency', 'pdfxLayers', 'scriptsRemoved', 'hiddenRemoved',
  'attachmentsRemoved', 'layersMerged', 'pdfaTransparency', 'pdfaFlattened', 'attachmentsOnlyPdfa',
  'textAsImage', 'vectorsAsPixels', 'markupsBurnedIn', 'formFieldsAsImage', 'bookmarks', 'attachments',
  'layers', 'cadAnnotationsOff', 'cadNotes', 'cadHidden',
]);

/**
 * Moet het venster komen? Bij verliezen (tenzij de gebruiker "niet meer
 * vragen" koos), of als er een auteur te kiezen is (XFDF met meer dan één
 * auteur): die keuze kan niet onthouden worden.
 * @returns {{tonen: boolean, verliezenTonen: boolean, auteursTonen: boolean}}
 */
export function vensterNodig({ verliezen = [], auteurs = [], nietVragen = false } = {}) {
  const verliezenTonen = verliezen.length > 0 && !nietVragen;
  const auteursTonen = auteurs.length > 1;
  return { tonen: verliezenTonen || auteursTonen, verliezenTonen, auteursTonen };
}

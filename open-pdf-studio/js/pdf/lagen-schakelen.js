// Lagen aan- en uitzetten vanuit het paneel Lagen (#684).
//
// De stand staat per document in een OptionalContentConfig van pdf.js: die
// kent de lagen, hun beginstand en de keuzegroepen (/RBGroups: één laag aan
// zet de andere van de groep uit). Het paneel leest hem, de PDF.js-paden
// (webversie, voorvertoning, miniaturen) tekenen ermee.
//
// Op de desktop tekent PDFium, uit het bestand. Daar maakt elke wissel een
// weergavekopie (laagstand.js: het bestand plus één incrementele update met de
// nieuwe /OFF-lijst) in de tijdelijke map, en leidt Rust de render-opdrachten
// van het document daarheen (set_layer_view). Het document zelf, zijn pad en
// opslaan blijven ongemoeid: de laagstand is een weergave, zoals in andere
// PDF-lezers, en gaat niet mee in het bestand.
//
// De stand hoort bij één PDF.js-document en één pad. Vervangt een
// paginabewerking de bytes (nieuw pdfDoc, nieuw werkbestand), dan geldt weer
// de beginstand van het document. Opslaan als verhuist hem naar het nieuwe
// pad (verhuisLaagstand).
//
// Bewaren als standaard (#377): "Als standaard instellen" in het paneel zet de
// huidige stand klaar; de volgende keer opslaan schrijft hem als /D /ON /OFF
// (pdf/lagen-boom.js, schrijfStandaardLaagstand). Daarna is die stand de
// beginstand van het bestand (`stand.begin`).
//
// Afdrukken en exporteren volgen de stand ook: de PDF.js-paden via
// pdfjsLaagOpties, de vectorafdruk via bytesMetLaagstand (dezelfde
// incrementele update als de weergavekopie).

import { getActiveDocument } from '../core/state.js';
import { laagstandBasis, laagstandUpdate, uitgezet, weergaveBytes } from './laagstand.js';

/** doc.id → { pdfDoc, pad, config, begin, kopie, basis, bytes, rij } */
const standen = new Map();
/** Paden waarvoor Rust nu uit een weergavekopie tekent. */
const omgeleid = new Set();

function geldig(doc, stand) {
  return !!stand && stand.pdfDoc === doc?.pdfDoc && stand.pad === (doc?.filePath || null);
}

/** Tekent Rust de pagina's van dit pad nu uit een weergavekopie? */
export function tekentUitKopie(pad) {
  return omgeleid.has(pad);
}

/**
 * De laagstand van het document om te tonen en mee te tekenen: de eigen stand
 * na een wissel, anders null (dan geldt de beginstand van het document).
 */
export function eigenLaagConfig(doc = getActiveDocument()) {
  const stand = doc ? standen.get(doc.id) : null;
  return geldig(doc, stand) ? stand.config : null;
}

/** Extra opties voor `page.render()` van PDF.js: de eigen laagstand. */
export function pdfjsLaagOpties(doc = getActiveDocument()) {
  const config = eigenLaagConfig(doc);
  return config ? { optionalContentConfigPromise: Promise.resolve(config) } : {};
}

/** Wijkt de stand af van de beginstand van het bestand (`begin`: uit-id's)? */
function wijktAf(stand) {
  const uit = new Set(uitgezet(stand.config));
  return uit.size !== stand.begin.size || [...uit].some((id) => !stand.begin.has(id));
}

/** Is er een eigen stand die afwijkt van de beginstand van het bestand? */
export function heeftAfwijkendeStand(doc = getActiveDocument()) {
  const stand = doc ? standen.get(doc.id) : null;
  return geldig(doc, stand) && wijktAf(stand);
}

/** De bytes waaruit het document nu getoond wordt (zoals saver.js ze zoekt). */
async function bronBytes(doc) {
  const { getCachedPdfBytes } = await import('./loader.js');
  let bytes = doc.filePath ? getCachedPdfBytes(doc.filePath) : undefined;
  if (!bytes) bytes = getCachedPdfBytes(`__memory__${doc.id}`);
  if (!bytes && doc.filePath) {
    const { readBinaryFile } = await platform();
    bytes = new Uint8Array(await readBinaryFile(doc.filePath));
  }
  return bytes || null;
}

/** pdfDoc → Promise<boom|null> (pdf/lagen-boom.js), één keer per document. */
const bomen = new WeakMap();

/**
 * De lagenboom van het document uit het bestand: de structuur van /Order,
 * /Locked en /RBGroups die pdf.js niet (volledig) geeft. null als het bestand
 * niet te lezen is; het paneel valt dan terug op de volgorde van pdf.js.
 */
export function lagenBoom(doc = getActiveDocument()) {
  const pdfDoc = doc?.pdfDoc;
  if (!pdfDoc) return Promise.resolve(null);
  if (!bomen.has(pdfDoc)) {
    bomen.set(pdfDoc, (async () => {
      try {
        const bytes = await bronBytes(doc);
        if (!bytes) return null;
        const [{ PDFDocument }, { leesLagenBoom }] = await Promise.all([import('pdf-lib'), import('./lagen-boom.js')]);
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
        return leesLagenBoom(pdf);
      } catch (e) {
        console.warn('[lagen] boom niet gelezen:', e);
        return null;
      }
    })());
  }
  return bomen.get(pdfDoc);
}

/**
 * Zet de huidige stand klaar om als standaardconfiguratie mee te gaan bij de
 * volgende keer opslaan. @returns {boolean} of er iets klaarstaat
 */
export function markeerStandAlsStandaard(doc = getActiveDocument()) {
  if (!heeftAfwijkendeStand(doc)) return false;
  doc._laagStandBewaren = true;
  return true;
}

/**
 * Voor de saver: de stand die als standaard bewaard moet worden (pdf.js-id →
 * zichtbaar, alle lagen), of null.
 */
export function standaardOmTeBewaren(doc) {
  if (!doc?._laagStandBewaren) return null;
  const stand = standen.get(doc.id);
  if (!geldig(doc, stand)) return null;
  return new Map([...stand.config].map(([id, groep]) => [id, groep?.visible !== false]));
}

/**
 * Na een geslaagde save: de bytes zijn nieuw. Was de stand bewaard, dan is
 * hij nu de beginstand van het bestand. Een weergavekopie wordt opnieuw
 * gemaakt uit de nieuwe bytes (of vervalt als de stand nu de beginstand is).
 */
export async function naOpslaan(doc, { standBewaard = false } = {}) {
  if (!doc) return;
  if (standBewaard) doc._laagStandBewaren = false;
  const stand = standen.get(doc.id);
  if (!geldig(doc, stand)) return;
  if (standBewaard) {
    stand.begin = new Set(uitgezet(stand.config));
    // Het paneel: "Als standaard instellen" is weer niet nodig.
    if (doc === getActiveDocument()) {
      import('../ui/panels/layers.js').then((m) => m.updateLayersList()).catch(() => {});
    }
  }
  stand.bytes = null;
  stand.basis = undefined;
  if (!stand.kopie && !wijktAf(stand)) return;
  const klaar = stand.rij.then(() => pasStandToe(doc, stand));
  stand.rij = klaar.catch(() => {});
  try {
    await klaar;
  } catch (e) {
    console.warn('[lagen] weergavekopie na opslaan niet bijgewerkt:', e);
  }
}

/**
 * Opslaan als: het document heeft een nieuw pad, met dezelfde inhoud en
 * hetzelfde pdf.js-document. De stand verhuist mee, zoals de viewport
 * (pdf-viewport.js wisselBestandspad), in plaats van als verouderd te
 * vervallen: het paneel blijft tonen wat de gebruiker had, en "Als standaard
 * instellen" blijft kunnen. Op de desktop leidt Rust het oude pad niet meer om
 * en het nieuwe pad naar een kopie van het nieuwe bestand.
 * Moet direct na het wisselen van doc.filePath, vóór het paneel de stand leest.
 * @returns {boolean} of er een stand verhuisd is
 */
export function verhuisLaagstand(doc, oudPad, nieuwPad) {
  const stand = doc ? standen.get(doc.id) : null;
  if (!stand || !nieuwPad || oudPad === nieuwPad) return false;
  if (stand.pdfDoc !== doc.pdfDoc || stand.pad !== (oudPad || null)) return false;
  stand.pad = nieuwPad;
  // De kopie komt voortaan uit de bytes van het nieuwe bestand.
  stand.bytes = null;
  stand.basis = undefined;
  const klaar = stand.rij.then(async () => {
    if (oudPad && omgeleid.has(oudPad)) await meldKopie(oudPad, null);
    if (stand.kopie || wijktAf(stand)) await pasStandToe(doc, stand);
  });
  stand.rij = klaar.catch((e) => console.warn('[lagen] stand niet verhuisd naar het nieuwe pad:', e));
  return true;
}

/**
 * De bytes voor een afdruk of export die de PDF zelf meeneemt (de
 * vectorafdruk): met de geschakelde stand als /D, anders de bytes zelf.
 */
export async function bytesMetLaagstand(doc, bytes) {
  const stand = doc ? standen.get(doc.id) : null;
  if (!geldig(doc, stand) || !wijktAf(stand)) return bytes;
  try {
    const basis = await laagstandBasis(bytes);
    if (!basis) return bytes;
    return weergaveBytes(bytes, laagstandUpdate(basis, uitgezet(stand.config)));
  } catch (e) {
    console.warn('[lagen] afdruk zonder laagstand:', e);
    return bytes;
  }
}

async function platform() {
  return import('../core/platform.js');
}

/** Ruimt een weergavekopie op: Rust-caches, vasthouden en het bestand. */
async function ruimKopieOp(doc, kopie) {
  if (!kopie) return;
  const vrijgave = await import('./document-release.js');
  vrijgave.laatWerkbestandLos(kopie);
  await vrijgave.ruimWerkbestandenOp(doc, [kopie]);
}

/** Alle beelden van dit pad weg, en wat er nu te zien is opnieuw tekenen. */
async function tekenOpnieuw(doc, pad) {
  const [bitmaps, tegels, renderer, vector] = await Promise.all([
    import('./page-bitmap-cache.js'),
    import('./tile-cache.js'),
    import('./renderer.js'),
    import('./vector-renderer.js'),
  ]);
  if (pad) {
    bitmaps.invalidateDocumentBitmaps(pad);
    tegels.tileCacheClearForFile(pad);
    renderer.clearBitmapJSCacheForFile(pad);
    vector.invalidateDocumentCache(pad);
  }
  renderer.clearLowResCache();
  try {
    const paneel = await import('../ui/panels/left-panel.js');
    const aantal = doc.pdfDoc?.numPages || 0;
    paneel.invalidateThumbnails(Array.from({ length: aantal }, (_, i) => i + 1));
  } catch (e) {
    console.warn('[lagen] miniaturen niet ververst:', e);
  }
  if (doc !== getActiveDocument()) return;
  // Zelfde verversing als bij Thin Lines: het beeld van de huidige weergave,
  // en wat later in beeld komt mist de cache vanzelf.
  const { refreshAfterThinLinesChange } = await import('./thin-lines.js');
  await refreshAfterThinLinesChange();
}

/** Meldt de kopie voor dit pad aan bij Rust (of af met null). */
async function meldKopie(pad, kopie) {
  const { invoke } = await platform();
  await invoke('set_layer_view', { path: pad, view: kopie });
  if (kopie) omgeleid.add(pad);
  else omgeleid.delete(pad);
}

/** Schrijft de weergavekopie voor deze stand; null als de beginstand geldt. */
async function schrijfKopie(doc, stand) {
  if (!wijktAf(stand)) return null;
  const { readBinaryFile, writeBinaryFile, invoke } = await platform();
  if (!stand.bytes) {
    const { getCachedPdfBytes } = await import('./loader.js');
    stand.bytes = getCachedPdfBytes(stand.pad) || new Uint8Array(await readBinaryFile(stand.pad));
  }
  if (stand.basis === undefined) stand.basis = await laagstandBasis(stand.bytes);
  if (!stand.basis) throw new Error('document heeft geen /OCProperties /D');
  const bytes = weergaveBytes(stand.bytes, laagstandUpdate(stand.basis, uitgezet(stand.config)));

  const map = await window.__TAURI__.path.tempDir();
  const sep = (map.endsWith('/') || map.endsWith('\\')) ? '' : '/';
  const kopie = `${map}${sep}opds-lagen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
  try { await invoke('allow_fs_scope', { path: kopie }); } catch { /* scope bestaat al */ }
  await writeBinaryFile(kopie, bytes);
  const vrijgave = await import('./document-release.js');
  vrijgave.houdWerkbestandVast(kopie);
  vrijgave.onthoudWerkbestand(doc, kopie);
  return kopie;
}

/**
 * De stand van het document, aangemaakt bij de eerste wissel. Een stand van
 * een vorige versie van het document (andere bytes of ander pad) gaat eerst
 * weg, met zijn kopie.
 */
async function standVoor(doc) {
  const oud = standen.get(doc.id);
  if (geldig(doc, oud)) return oud;
  standen.delete(doc.id);
  if (oud) await laatOudeStandLos(doc, oud);
  const config = await doc.pdfDoc.getOptionalContentConfig();
  // pdf.js geeft bij elke aanroep een verse config in de beginstand.
  const begin = new Set(uitgezet(await doc.pdfDoc.getOptionalContentConfig()));
  const stand = { pdfDoc: doc.pdfDoc, pad: doc.filePath || null, config, begin, kopie: null, basis: undefined, bytes: null, rij: Promise.resolve() };
  standen.set(doc.id, stand);
  return stand;
}

async function laatOudeStandLos(doc, oud) {
  doc._laagStandBewaren = false;
  try {
    if (oud.pad && oud.kopie && omgeleid.has(oud.pad)) await meldKopie(oud.pad, null);
    await ruimKopieOp(doc, oud.kopie);
  } catch (e) {
    console.warn('[lagen] oude weergavekopie niet opgeruimd:', e);
  }
}

/**
 * Is er een stand van een vorige versie van dit document? Dan geldt weer de
 * beginstand (het paneel roept dit aan voor het de lijst opbouwt).
 */
export async function vergeetVerouderdeStand(doc = getActiveDocument()) {
  if (!doc) return;
  const oud = standen.get(doc.id);
  if (!oud || geldig(doc, oud)) return;
  standen.delete(doc.id);
  await laatOudeStandLos(doc, oud);
}

/**
 * Zet een laag aan of uit en tekent de weergave opnieuw. Wissels na elkaar
 * lopen in volgorde; elke wissel tekent uit de stand na alle wissels ervoor.
 * @returns {Promise<boolean>} de stand van de laag na de wissel
 */
export async function zetLaagZichtbaar(doc, id, zichtbaar) {
  if (!doc?.pdfDoc) return false;
  const stand = await standVoor(doc);
  stand.config.setVisibility(id, !!zichtbaar);
  const klaar = stand.rij.then(() => pasStandToe(doc, stand));
  stand.rij = klaar.catch(() => {});
  await klaar;
  return stand.config.getGroup(id)?.visible !== false;
}

async function pasStandToe(doc, stand) {
  if (!geldig(doc, stand)) return;
  const { isTauri } = await platform();
  if (isTauri() && stand.pad) {
    const vorige = stand.kopie;
    const kopie = await schrijfKopie(doc, stand);
    await meldKopie(stand.pad, kopie);
    stand.kopie = kopie;
    console.log('[lagen] uit:', uitgezet(stand.config).join(',') || '-', kopie ? `kopie ${kopie}` : 'beginstand');
    await tekenOpnieuw(doc, stand.pad);
    await ruimKopieOp(doc, vorige);
  } else {
    await tekenOpnieuw(doc, null);
  }
}

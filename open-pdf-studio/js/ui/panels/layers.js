import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import {
  setLayerItems as setItems, setLayerCountText as setCountText, setLayerEmptyMessage as setEmptyMessage,
  setLayerDefaultPending as setDefaultPending, setLayerCanSetDefault as setCanSetDefault,
  annotationLayersChanged,
} from '../../bridge.js';
import { lagenLijst } from './lagen-lijst.js';
import {
  eigenLaagConfig, vergeetVerouderdeStand, zetLaagZichtbaar, lagenBoom,
  heeftAfwijkendeStand, markeerStandAlsStandaard,
} from '../../pdf/lagen-schakelen.js';
import { getLayers, updateLayer } from '../../annotations/annotatie-lagen.js';
import { ocgVoorAnnotatieLaagId } from '../../pdf/laag-ids.js';

function geenLagen(melding) {
  setItems([]);
  setCountText(i18next.t('leftPanel.layersCount', { count: 0 }));
  setEmptyMessage(melding);
  setCanSetDefault(false);
  setDefaultPending(false);
}

/** De stand van het document: de eigen stand na schakelen, anders de beginstand. */
async function laagConfig(doc) {
  return eigenLaagConfig(doc) || (typeof doc.pdfDoc.getOptionalContentConfig === 'function'
    ? await doc.pdfDoc.getOptionalContentConfig()
    : null);
}

// Het paneel toont de lagen en hun stand: de beginstand van het document, of
// de stand na het schakelen (#684, zie pdf/lagen-schakelen.js). De boom komt
// uit het bestand (pdf/lagen-boom.js, #377): is die niet meteen gelezen, dan
// staat de lijst er eerst in de volgorde van pdf.js en daarna in die van
// /Order, met vergrendelde lagen en keuzegroepen.
export async function updateLayersList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    geenLagen(i18next.t('leftPanel.noDocumentOpen'));
    return;
  }

  setEmptyMessage(i18next.t('loading'));

  try {
    const pdfDoc = activeDoc.pdfDoc;
    await vergeetVerouderdeStand(activeDoc);
    const toon = async (boom) => {
      const ocConfig = await laagConfig(activeDoc);
      // De annotatielagen van deze app zijn ook OCG's (#468), maar staan in het
      // paneel Markeringslagen; hier alleen de lagen van de tekening zelf.
      const regels = lagenLijst(ocConfig, { overslaan: activeDoc._annotatieLaagOcgIds || new Set(), boom });
      const aantal = regels.filter((r) => !r.kop).length;
      if (!aantal) {
        geenLagen(i18next.t('leftPanel.noLayers'));
        return false;
      }
      setEmptyMessage(null);
      setItems(regels);
      setCountText(i18next.t('leftPanel.layersCount', { count: aantal }));
      setCanSetDefault(heeftAfwijkendeStand(activeDoc));
      setDefaultPending(!!activeDoc._laagStandBewaren);
      return true;
    };
    const boomBelofte = lagenBoom(activeDoc);
    const eerst = await Promise.race([boomBelofte, new Promise((r) => { setTimeout(() => r(undefined), 150); })]);
    if (eerst !== undefined) {
      await toon(eerst);
      return;
    }
    if (!(await toon(null))) return;
    const boom = await boomBelofte;
    if (boom && getActiveDocument() === activeDoc && activeDoc.pdfDoc === pdfDoc) await toon(boom);
  } catch (e) {
    console.warn('Failed to load layers:', e);
    geenLagen(i18next.t('leftPanel.noLayers'));
  }
}

/**
 * Markeringen op een laag van de tekening (#377) hebben een annotatielaag
 * `ocg-<object>-<generatie>` met dezelfde OCG. Zijn zichtbaarheid volgt de
 * laag in dit paneel, zodat die markeringen met hun laag aan en uit gaan.
 * @returns {boolean} of er een annotatielaag veranderde
 */
export function volgAnnotatieLagen(doc, config) {
  if (!doc || !config) return false;
  let veranderd = false;
  for (const laag of getLayers(doc)) {
    const ocg = ocgVoorAnnotatieLaagId(laag.id);
    const groep = ocg ? config.getGroup?.(ocg) : null;
    if (!groep) continue;
    const zichtbaar = groep.visible !== false;
    if (laag.visible === zichtbaar) continue;
    if (updateLayer(doc, laag.id, { visible: zichtbaar }).ok) veranderd = true;
  }
  return veranderd;
}

/** Vinkje in het paneel: laag aan of uit, daarna de lijst opnieuw (#684). */
export async function toggleLayer(id, zichtbaar) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;
  try {
    const boom = await lagenBoom(activeDoc);
    // Vergrendeld (/Locked): niet te schakelen.
    if (boom?.locked?.has(id)) {
      await updateLayersList();
      return;
    }
    await zetLaagZichtbaar(activeDoc, id, zichtbaar);
    if (volgAnnotatieLagen(activeDoc, eigenLaagConfig(activeDoc))) {
      await annotationLayersChanged({ modified: false });
    }
  } catch (e) {
    console.warn('[lagen] schakelen mislukt:', e);
  }
  await updateLayersList();
}

/**
 * "Als standaard instellen": de huidige stand gaat bij de volgende keer
 * opslaan als standaardconfiguratie (/D) het bestand in (#377).
 * @returns {Promise<boolean>} of er iets klaarstaat
 */
export async function setLayerStateAsDefault() {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return false;
  if (!markeerStandAlsStandaard(activeDoc)) return false;
  try {
    const { markDocumentModified } = await import('../chrome/tabs.js');
    markDocumentModified(activeDoc);
  } catch (e) {
    console.warn('[lagen] document niet als gewijzigd gemarkeerd:', e);
  }
  await updateLayersList();
  return true;
}

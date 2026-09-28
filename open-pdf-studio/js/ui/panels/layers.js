import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import { setLayerItems as setItems, setLayerCountText as setCountText, setLayerEmptyMessage as setEmptyMessage } from '../../bridge.js';
import { lagenLijst } from './lagen-lijst.js';

function geenLagen(melding) {
  setItems([]);
  setCountText(i18next.t('leftPanel.layersCount', { count: 0 }));
  setEmptyMessage(melding);
}

// Het paneel toont de lagen en hun stand volgens het document. Aan- en
// uitzetten volgt nog: de pagina tekent met PDFium uit het bestand zelf, en
// dat pad kent (nog) geen andere laagstand dan die van het document.
export async function updateLayersList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    geenLagen(i18next.t('leftPanel.noDocumentOpen'));
    return;
  }

  setEmptyMessage(i18next.t('loading'));

  try {
    const pdfDoc = activeDoc.pdfDoc;
    const ocConfig = typeof pdfDoc.getOptionalContentConfig === 'function'
      ? await pdfDoc.getOptionalContentConfig()
      : null;
    // De annotatielagen van deze app zijn ook OCG's (#468), maar staan in het
    // paneel Markeringslagen; hier alleen de lagen van de tekening zelf.
    const regels = lagenLijst(ocConfig, { overslaan: activeDoc._annotatieLaagOcgIds || new Set() });
    const aantal = regels.filter((r) => !r.kop).length;
    if (!aantal) {
      geenLagen(i18next.t('leftPanel.noLayers'));
      return;
    }
    setEmptyMessage(null);
    setItems(regels);
    setCountText(i18next.t('leftPanel.layersCount', { count: aantal }));
  } catch (e) {
    console.warn('Failed to load layers:', e);
    geenLagen(i18next.t('leftPanel.noLayers'));
  }
}

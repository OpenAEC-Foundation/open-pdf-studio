import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import { setLayerItems as setItems, setLayerCountText as setCountText, setLayerEmptyMessage as setEmptyMessage } from '../../bridge.js';

let currentOCConfig = null;

export async function toggleLayerVisibility(id, checked) {
  try {
    if (currentOCConfig && typeof currentOCConfig.setVisibility === 'function') {
      await currentOCConfig.setVisibility(id, checked);
    }
    const activeDoc = getActiveDocument();
    if (activeDoc && activeDoc.pdfDoc) {
      const event = new CustomEvent('layers-changed');
      document.dispatchEvent(event);
    }
  } catch (e) {
    console.warn('Failed to toggle layer visibility:', e);
  }
}

export async function updateLayersList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    setItems([]);
    setCountText(i18next.t('leftPanel.layersCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noDocumentOpen'));
    currentOCConfig = null;
    return;
  }

  setEmptyMessage(i18next.t('loading'));

  try {
    const pdfDoc = activeDoc.pdfDoc;

    if (typeof pdfDoc.getOptionalContentConfig !== 'function') {
      setItems([]);
      setCountText(i18next.t('leftPanel.layersCount', { count: 0 }));
      setEmptyMessage(i18next.t('leftPanel.noLayers'));
      return;
    }

    const ocConfig = await pdfDoc.getOptionalContentConfig();
    currentOCConfig = ocConfig;

    if (!ocConfig) {
      setItems([]);
      setCountText(i18next.t('leftPanel.layersCount', { count: 0 }));
      setEmptyMessage(i18next.t('leftPanel.noLayers'));
      return;
    }

    const groups = ocConfig.getGroups();
    if (!groups || Object.keys(groups).length === 0) {
      setItems([]);
      setCountText(i18next.t('leftPanel.layersCount', { count: 0 }));
      setEmptyMessage(i18next.t('leftPanel.noLayers'));
      return;
    }

    const layerItems = [];
    // De annotatielagen van deze app zijn ook OCG's (#468), maar staan in het
    // paneel Markeringslagen; hier alleen de lagen van de tekening zelf.
    const annotatieLagen = activeDoc._annotatieLaagOcgIds || new Set();
    for (const [id, group] of Object.entries(groups)) {
      if (annotatieLagen.has(id)) continue;
      layerItems.push({
        id,
        name: group.name || `Layer ${layerItems.length + 1}`,
        visible: ocConfig.isVisible(group) !== false
      });
    }

    setEmptyMessage(layerItems.length ? null : i18next.t('leftPanel.noLayers'));
    setItems(layerItems);
    setCountText(i18next.t('leftPanel.layersCount', { count: layerItems.length }));
  } catch (e) {
    console.warn('Failed to load layers:', e);
    setItems([]);
    setCountText(i18next.t('leftPanel.layersCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noLayers'));
    currentOCConfig = null;
  }
}

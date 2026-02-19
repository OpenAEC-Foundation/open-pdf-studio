import { getActiveDocument } from '../../core/state.js';
import { setItems, setCountText, setEmptyMessage } from '../../solid/stores/panels/layersStore.js';

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
    setCountText('0 layers');
    setEmptyMessage('No document open');
    currentOCConfig = null;
    return;
  }

  setEmptyMessage('Loading...');

  try {
    const pdfDoc = activeDoc.pdfDoc;

    if (typeof pdfDoc.getOptionalContentConfig !== 'function') {
      setItems([]);
      setCountText('0 layers');
      setEmptyMessage('No layers in this document');
      return;
    }

    const ocConfig = await pdfDoc.getOptionalContentConfig();
    currentOCConfig = ocConfig;

    if (!ocConfig) {
      setItems([]);
      setCountText('0 layers');
      setEmptyMessage('No layers in this document');
      return;
    }

    const groups = ocConfig.getGroups();
    if (!groups || Object.keys(groups).length === 0) {
      setItems([]);
      setCountText('0 layers');
      setEmptyMessage('No layers in this document');
      return;
    }

    const layerItems = [];
    for (const [id, group] of Object.entries(groups)) {
      layerItems.push({
        id,
        name: group.name || `Layer ${layerItems.length + 1}`,
        visible: ocConfig.isVisible(group) !== false
      });
    }

    setEmptyMessage(null);
    setItems(layerItems);
    setCountText(`${layerItems.length} layer${layerItems.length !== 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('Failed to load layers:', e);
    setItems([]);
    setCountText('0 layers');
    setEmptyMessage('No layers in this document');
    currentOCConfig = null;
  }
}

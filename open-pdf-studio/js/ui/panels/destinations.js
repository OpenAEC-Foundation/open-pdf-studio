import { getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { setItems, setCountText, setEmptyMessage } from '../../solid/stores/panels/destinationsStore.js';

let destinationsMap = {};

export async function navigateToDestination(name) {
  try {
    const dest = destinationsMap[name];
    if (dest && Array.isArray(dest) && dest[0]) {
      const pageRef = dest[0];
      if (pageRef.num !== undefined) {
        const activeDoc = getActiveDocument();
        if (activeDoc && activeDoc.pdfDoc) {
          const pageIndex = await activeDoc.pdfDoc.getPageIndex(pageRef);
          goToPage(pageIndex + 1);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to navigate to destination:', e);
  }
}

export async function updateDestinationsList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    destinationsMap = {};
    setItems([]);
    setCountText('0 destinations');
    setEmptyMessage('No document open');
    return;
  }

  setEmptyMessage('Loading...');

  try {
    const pdfDoc = activeDoc.pdfDoc;

    if (typeof pdfDoc.getDestinations !== 'function') {
      destinationsMap = {};
      setItems([]);
      setCountText('0 destinations');
      setEmptyMessage('No named destinations in this document');
      return;
    }

    const destinations = await pdfDoc.getDestinations();

    if (!destinations || Object.keys(destinations).length === 0) {
      destinationsMap = {};
      setItems([]);
      setCountText('0 destinations');
      setEmptyMessage('No named destinations in this document');
      return;
    }

    destinationsMap = destinations;
    const names = Object.keys(destinations).sort();

    setEmptyMessage(null);
    setItems(names.map(name => {
      const dest = destinations[name];
      let fitType = '';
      if (dest && Array.isArray(dest) && dest.length > 1) {
        fitType = dest[1]?.name || '';
      }
      return { name, fitType };
    }));
    setCountText(`${names.length} destination${names.length !== 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('Failed to load destinations:', e);
    destinationsMap = {};
    setItems([]);
    setCountText('0 destinations');
    setEmptyMessage('Could not load destinations');
  }
}
